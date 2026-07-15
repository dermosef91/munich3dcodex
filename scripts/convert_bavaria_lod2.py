#!/usr/bin/env python3
"""Normalize Bavarian LoD2 CityGML into Munich3D world coordinates.

The converter intentionally uses only the Python standard library. It streams
CityGML members, applies a building-level spatial clip, preserves semantic
surfaces and source identifiers, and writes an intermediate JSON document for
the later tile/GLB build stage.

Horizontal input coordinates must be ETRS89 / UTM zone 32N (EPSG:25832).
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from typing import BinaryIO, Dict, Iterable, Iterator, List, Optional, Sequence, Set, Tuple
import xml.etree.ElementTree as ET
import zipfile


SCHEMA_VERSION = "munich3d-lod2-normalized-v1"
DEFAULT_ORIGIN_LAT = 48.151
DEFAULT_ORIGIN_LON = 11.572
METERS_PER_DEGREE = 111_320.0
DEFAULT_ATTRIBUTION = (
    "Bayerische Vermessungsverwaltung - www.geodaten.bayern.de; "
    "licensed under CC BY 4.0; modified for Munich3D."
)

GML_ID = "{http://www.opengis.net/gml}id"
XLINK_HREF = "{http://www.w3.org/1999/xlink}href"

SEMANTIC_SURFACES = {
    "WallSurface": "wall",
    "RoofSurface": "roof",
    "GroundSurface": "ground",
    "ClosureSurface": "closure",
    "OuterFloorSurface": "outerFloor",
    "OuterCeilingSurface": "outerCeiling",
}
BUILDING_OBJECTS = {"Building", "BuildingPart"}
MEMBER_ELEMENTS = {"cityObjectMember", "featureMember"}

SourcePoint = Tuple[float, float, float]
WorldPoint = List[float]


class ConversionError(RuntimeError):
    """A user-facing validation or conversion failure."""


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)


def parse_pair(value: str, label: str) -> Tuple[float, float]:
    try:
        parts = [float(part.strip()) for part in value.split(",")]
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{label} must contain decimal numbers") from exc
    if len(parts) != 2 or not all(math.isfinite(part) for part in parts):
        raise argparse.ArgumentTypeError(f"{label} must be LON,LAT")
    return parts[0], parts[1]


def parse_bbox(value: str) -> Tuple[float, float, float, float]:
    try:
        parts = [float(part.strip()) for part in value.split(",")]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("bbox must contain decimal numbers") from exc
    if len(parts) != 4 or not all(math.isfinite(part) for part in parts):
        raise argparse.ArgumentTypeError("bbox must be WEST,SOUTH,EAST,NORTH")
    west, south, east, north = parts
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise argparse.ArgumentTypeError("bbox is not a valid WGS84 rectangle")
    return west, south, east, north


def parse_origin(value: str) -> Tuple[float, float]:
    return parse_pair(value, "origin")


def round_number(value: float, precision: int) -> float:
    rounded = round(value, precision)
    # Avoid emitting -0.0, which is legal JSON but creates noisy diffs.
    return 0.0 if rounded == 0 else rounded


def utm32_to_wgs84(easting: float, northing: float) -> Tuple[float, float]:
    """Convert EPSG:25832 coordinates to longitude/latitude on GRS80.

    ETRS89 uses the GRS80 ellipsoid. At this scale it is effectively aligned
    with WGS84, which is the geographic frame used by the browser prototype.
    Formulae follow the standard inverse Transverse Mercator series.
    """

    if not (100_000 <= easting <= 900_000 and 0 <= northing <= 10_000_000):
        raise ConversionError(
            f"coordinate ({easting}, {northing}) is outside plausible EPSG:25832 bounds"
        )

    semi_major = 6_378_137.0
    eccentricity_squared = 0.006_694_380_022_90  # GRS80
    eccentricity_prime_squared = eccentricity_squared / (1.0 - eccentricity_squared)
    scale = 0.9996

    x = easting - 500_000.0
    meridional_arc = northing / scale
    mu = meridional_arc / (
        semi_major
        * (
            1.0
            - eccentricity_squared / 4.0
            - 3.0 * eccentricity_squared**2 / 64.0
            - 5.0 * eccentricity_squared**3 / 256.0
        )
    )

    e1 = (1.0 - math.sqrt(1.0 - eccentricity_squared)) / (
        1.0 + math.sqrt(1.0 - eccentricity_squared)
    )
    phi1 = (
        mu
        + (3.0 * e1 / 2.0 - 27.0 * e1**3 / 32.0) * math.sin(2.0 * mu)
        + (21.0 * e1**2 / 16.0 - 55.0 * e1**4 / 32.0) * math.sin(4.0 * mu)
        + (151.0 * e1**3 / 96.0) * math.sin(6.0 * mu)
        + (1097.0 * e1**4 / 512.0) * math.sin(8.0 * mu)
    )

    sin_phi1 = math.sin(phi1)
    cos_phi1 = math.cos(phi1)
    tan_phi1 = math.tan(phi1)
    n1 = semi_major / math.sqrt(1.0 - eccentricity_squared * sin_phi1**2)
    r1 = (
        semi_major
        * (1.0 - eccentricity_squared)
        / (1.0 - eccentricity_squared * sin_phi1**2) ** 1.5
    )
    t1 = tan_phi1**2
    c1 = eccentricity_prime_squared * cos_phi1**2
    d = x / (n1 * scale)

    latitude = phi1 - (n1 * tan_phi1 / r1) * (
        d**2 / 2.0
        - (5.0 + 3.0 * t1 + 10.0 * c1 - 4.0 * c1**2 - 9.0 * eccentricity_prime_squared)
        * d**4
        / 24.0
        + (
            61.0
            + 90.0 * t1
            + 298.0 * c1
            + 45.0 * t1**2
            - 252.0 * eccentricity_prime_squared
            - 3.0 * c1**2
        )
        * d**6
        / 720.0
    )
    longitude = math.radians(9.0) + (
        d
        - (1.0 + 2.0 * t1 + c1) * d**3 / 6.0
        + (
            5.0
            - 2.0 * c1
            + 28.0 * t1
            - 3.0 * c1**2
            + 8.0 * eccentricity_prime_squared
            + 24.0 * t1**2
        )
        * d**5
        / 120.0
    ) / cos_phi1

    return math.degrees(longitude), math.degrees(latitude)


class WorldTransform:
    """EPSG:25832 to the local coordinate convention in src/world/geo.ts."""

    def __init__(
        self,
        origin_lon: float,
        origin_lat: float,
        vertical_origin: float,
        precision: int,
    ) -> None:
        self.origin_lon = origin_lon
        self.origin_lat = origin_lat
        self.vertical_origin = vertical_origin
        self.precision = precision
        self.longitude_scale = math.cos(math.radians(origin_lat))
        self._horizontal_cache: Dict[Tuple[float, float], Tuple[float, float, float, float]] = {}

    def horizontal(self, easting: float, northing: float) -> Tuple[float, float, float, float]:
        key = (easting, northing)
        cached = self._horizontal_cache.get(key)
        if cached is not None:
            return cached
        longitude, latitude = utm32_to_wgs84(easting, northing)
        world_x = (
            (longitude - self.origin_lon) * METERS_PER_DEGREE * self.longitude_scale
        )
        world_z = -(latitude - self.origin_lat) * METERS_PER_DEGREE
        result = longitude, latitude, world_x, world_z
        self._horizontal_cache[key] = result
        return result

    def point(self, point: SourcePoint) -> WorldPoint:
        easting, northing, elevation = point
        _, _, world_x, world_z = self.horizontal(easting, northing)
        return [
            round_number(world_x, self.precision),
            round_number(elevation - self.vertical_origin, self.precision),
            round_number(world_z, self.precision),
        ]


def numbers(text: Optional[str]) -> List[float]:
    if not text:
        return []
    try:
        values = [float(value) for value in text.replace(",", " ").split()]
    except ValueError as exc:
        raise ConversionError("encountered non-numeric GML coordinates") from exc
    if not all(math.isfinite(value) for value in values):
        raise ConversionError("encountered non-finite GML coordinates")
    return values


def coordinate_dimension(element: ET.Element, value_count: int) -> int:
    for candidate in (element, *list(element.iter())):
        raw = candidate.attrib.get("srsDimension") or candidate.attrib.get("dimension")
        if raw:
            try:
                dimension = int(raw)
            except ValueError:
                continue
            if dimension in (2, 3):
                return dimension
    # Bavarian LoD2 is 3D. Use 2D only when the value count cannot be 3D.
    return 3 if value_count % 3 == 0 else 2


def points_from_values(values: Sequence[float], dimension: int) -> List[SourcePoint]:
    if not values or len(values) % dimension != 0:
        raise ConversionError(
            f"coordinate list length {len(values)} is not divisible by dimension {dimension}"
        )
    result: List[SourcePoint] = []
    for offset in range(0, len(values), dimension):
        easting = values[offset]
        northing = values[offset + 1]
        elevation = values[offset + 2] if dimension == 3 else 0.0
        result.append((easting, northing, elevation))
    return result


def parse_linear_ring(ring: ET.Element) -> List[SourcePoint]:
    for child in ring.iter():
        if local_name(child.tag) == "posList":
            values = numbers(child.text)
            points = points_from_values(values, coordinate_dimension(child, len(values)))
            return clean_ring(points)

    positions: List[SourcePoint] = []
    for child in ring.iter():
        if local_name(child.tag) == "pos":
            values = numbers(child.text)
            dimension = coordinate_dimension(child, len(values))
            positions.extend(points_from_values(values, dimension))
    if positions:
        return clean_ring(positions)

    # CityGML 1-era documents may still use gml:coordinates tuples.
    for child in ring.iter():
        if local_name(child.tag) == "coordinates":
            raw_tuples = (child.text or "").split()
            parsed: List[SourcePoint] = []
            for raw_tuple in raw_tuples:
                values = [float(value) for value in raw_tuple.split(",")]
                if len(values) not in (2, 3):
                    raise ConversionError("unsupported gml:coordinates tuple")
                parsed.append((values[0], values[1], values[2] if len(values) == 3 else 0.0))
            return clean_ring(parsed)
    return []


def clean_ring(points: Sequence[SourcePoint]) -> List[SourcePoint]:
    result: List[SourcePoint] = []
    for point in points:
        if not result or point != result[-1]:
            result.append(point)
    if len(result) > 1 and result[0] == result[-1]:
        result.pop()
    return result if len(result) >= 3 else []


def descendant_ring(container: ET.Element) -> Optional[ET.Element]:
    return next(
        (element for element in container.iter() if local_name(element.tag) == "LinearRing"),
        None,
    )


def parse_polygon(polygon: ET.Element) -> Optional[Dict[str, object]]:
    exterior: List[SourcePoint] = []
    holes: List[List[SourcePoint]] = []
    for child in polygon:
        name = local_name(child.tag)
        if name not in {"exterior", "interior"}:
            continue
        ring_element = descendant_ring(child)
        if ring_element is None:
            continue
        ring = parse_linear_ring(ring_element)
        if not ring:
            continue
        if name == "exterior":
            exterior = ring
        else:
            holes.append(ring)
    if not exterior:
        return None
    return {
        "sourceId": polygon.attrib.get(GML_ID),
        "exteriorSource": exterior,
        "holesSource": holes,
    }


def gml_id(element: ET.Element) -> Optional[str]:
    return element.attrib.get(GML_ID) or next(
        (value for key, value in element.attrib.items() if local_name(key) == "id"),
        None,
    )


def element_texts(root: ET.Element, wanted_name: str) -> List[str]:
    result: List[str] = []
    for element in root.iter():
        if local_name(element.tag) == wanted_name and element.text and element.text.strip():
            value = element.text.strip()
            if value not in result:
                result.append(value)
    return result


def scalar_metadata(root: ET.Element) -> Dict[str, object]:
    metadata: Dict[str, object] = {}
    for name in (
        "class",
        "function",
        "usage",
        "roofType",
        "yearOfConstruction",
        "storeysAboveGround",
        "storeysBelowGround",
        "measuredHeight",
    ):
        values = element_texts(root, name)
        if not values:
            continue
        value: object = values[0] if len(values) == 1 else values
        if name in {"storeysAboveGround", "storeysBelowGround", "measuredHeight"} and len(values) == 1:
            try:
                value = float(values[0])
            except ValueError:
                pass
        metadata[name] = value

    generic: Dict[str, object] = {}
    for element in root.iter():
        if not local_name(element.tag).endswith("Attribute"):
            continue
        name = element.attrib.get("name")
        value_element = next(
            (child for child in element.iter() if local_name(child.tag) == "value"),
            None,
        )
        if name and value_element is not None and value_element.text:
            generic[name] = value_element.text.strip()
    if generic:
        metadata["genericAttributes"] = generic
    return metadata


def parse_surfaces(building: ET.Element, stats: Dict[str, int]) -> List[Dict[str, object]]:
    surfaces: List[Dict[str, object]] = []
    consumed_polygons: Set[int] = set()

    for element in building.iter():
        source_type = local_name(element.tag)
        semantic_type = SEMANTIC_SURFACES.get(source_type)
        if semantic_type is None:
            continue
        parsed_polygons: List[Dict[str, object]] = []
        for polygon in element.iter():
            if local_name(polygon.tag) != "Polygon" or id(polygon) in consumed_polygons:
                continue
            consumed_polygons.add(id(polygon))
            parsed = parse_polygon(polygon)
            if parsed is not None:
                parsed_polygons.append(parsed)
        if parsed_polygons:
            surfaces.append(
                {
                    "sourceId": gml_id(element),
                    "type": semantic_type,
                    "polygonsSource": parsed_polygons,
                }
            )

    unclassified: List[Dict[str, object]] = []
    for polygon in building.iter():
        if local_name(polygon.tag) != "Polygon" or id(polygon) in consumed_polygons:
            continue
        parsed = parse_polygon(polygon)
        if parsed is not None:
            unclassified.append(parsed)
    if unclassified:
        surfaces.append(
            {"sourceId": None, "type": "unknown", "polygonsSource": unclassified}
        )

    stats["unresolvedXlinks"] += sum(
        1
        for element in building.iter()
        if XLINK_HREF in element.attrib and not any(
            local_name(child.tag) == "Polygon" for child in element.iter()
        )
    )
    return surfaces


def source_points(surfaces: Sequence[Dict[str, object]]) -> Iterator[SourcePoint]:
    for surface in surfaces:
        for polygon in surface["polygonsSource"]:  # type: ignore[index]
            yield from polygon["exteriorSource"]  # type: ignore[index]
            for hole in polygon["holesSource"]:  # type: ignore[index]
                yield from hole


def geographic_bounds(
    points: Sequence[SourcePoint], transform: WorldTransform
) -> Tuple[float, float, float, float]:
    longitudes: List[float] = []
    latitudes: List[float] = []
    for easting, northing, _ in points:
        longitude, latitude, _, _ = transform.horizontal(easting, northing)
        longitudes.append(longitude)
        latitudes.append(latitude)
    return min(longitudes), min(latitudes), max(longitudes), max(latitudes)


def passes_clip(
    bounds: Tuple[float, float, float, float],
    clip: Tuple[float, float, float, float],
    mode: str,
) -> bool:
    west, south, east, north = bounds
    clip_west, clip_south, clip_east, clip_north = clip
    if mode == "contained":
        return (
            west >= clip_west
            and east <= clip_east
            and south >= clip_south
            and north <= clip_north
        )
    if mode == "centroid":
        center_lon = (west + east) / 2.0
        center_lat = (south + north) / 2.0
        return clip_west <= center_lon <= clip_east and clip_south <= center_lat <= clip_north
    return not (
        east < clip_west or west > clip_east or north < clip_south or south > clip_north
    )


def normalize_surfaces(
    source_surfaces: Sequence[Dict[str, object]],
    transform: WorldTransform,
    building_id: str,
) -> List[Dict[str, object]]:
    normalized: List[Dict[str, object]] = []
    for surface_index, source_surface in enumerate(source_surfaces):
        surface_id = source_surface.get("sourceId") or f"{building_id}:surface:{surface_index}"
        polygons: List[Dict[str, object]] = []
        for polygon_index, source_polygon in enumerate(source_surface["polygonsSource"]):  # type: ignore[index]
            polygon_id = source_polygon.get("sourceId") or f"{surface_id}:polygon:{polygon_index}"
            polygons.append(
                {
                    "id": polygon_id,
                    "exterior": [
                        transform.point(point)
                        for point in source_polygon["exteriorSource"]  # type: ignore[index]
                    ],
                    "holes": [
                        [transform.point(point) for point in hole]
                        for hole in source_polygon["holesSource"]  # type: ignore[index]
                    ],
                }
            )
        normalized.append(
            {
                "id": surface_id,
                "type": source_surface["type"],
                "polygons": polygons,
            }
        )
    return normalized


def world_bounds(surfaces: Sequence[Dict[str, object]]) -> Tuple[List[float], List[float]]:
    points: List[WorldPoint] = []
    for surface in surfaces:
        for polygon in surface["polygons"]:  # type: ignore[index]
            points.extend(polygon["exterior"])  # type: ignore[index]
            for hole in polygon["holes"]:  # type: ignore[index]
                points.extend(hole)
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return minimum, maximum


def first_building_object(member: ET.Element) -> Optional[ET.Element]:
    for child in member:
        if local_name(child.tag) in BUILDING_OBJECTS:
            return child
    return next(
        (element for element in member.iter() if local_name(element.tag) in BUILDING_OBJECTS),
        None,
    )


def document_streams(path: Path) -> Iterator[Tuple[str, BinaryIO]]:
    suffixes = [suffix.lower() for suffix in path.suffixes]
    if suffixes and suffixes[-1] == ".zip":
        with zipfile.ZipFile(path) as archive:
            members = sorted(
                name
                for name in archive.namelist()
                if Path(name).suffix.lower() in {".gml", ".xml"} and not name.endswith("/")
            )
            if not members:
                raise ConversionError(f"{path} contains no .gml or .xml documents")
            for member in members:
                with archive.open(member, "r") as stream:
                    yield f"{path.name}!{member}", stream
        return
    if suffixes and suffixes[-1] == ".gz":
        with gzip.open(path, "rb") as stream:
            yield path.name, stream
        return
    with path.open("rb") as stream:
        yield path.name, stream


def validate_crs_hints(hints: Set[str], source_name: str) -> None:
    for hint in hints:
        normalized = hint.upper().replace(" ", "")
        if "UTM32" in normalized or "25832" in normalized:
            continue
        codes = {int(code) for code in re.findall(r"EPSG[^0-9]+([0-9]{4,5})", normalized)}
        # 7837 is the DHHN2016 vertical component sometimes included alongside 25832.
        unsupported = codes - {25832, 7837}
        if unsupported:
            raise ConversionError(
                f"{source_name} declares unsupported CRS {hint!r}; expected EPSG:25832"
            )


def convert_document(
    stream: BinaryIO,
    source_name: str,
    source_sha256: str,
    transform: WorldTransform,
    clip: Tuple[float, float, float, float],
    clip_mode: str,
    attribution: str,
    dataset: str,
    seen_ids: Set[str],
    buildings: List[Dict[str, object]],
    stats: Dict[str, int],
) -> None:
    crs_hints: Set[str] = set()
    try:
        iterator = ET.iterparse(stream, events=("start", "end"))
        for event, element in iterator:
            if event == "start":
                srs_name = element.attrib.get("srsName")
                if srs_name:
                    crs_hints.add(srs_name)
                continue
            if local_name(element.tag) not in MEMBER_ELEMENTS:
                continue

            building = first_building_object(element)
            if building is None:
                element.clear()
                continue
            stats["buildingObjectsRead"] += 1
            building_id = gml_id(building)
            if not building_id:
                stats["missingIds"] += 1
                building_id = f"anonymous:{source_name}:{stats['buildingObjectsRead']}"
            dedupe_key = building_id
            if dedupe_key in seen_ids:
                stats["duplicatesSkipped"] += 1
                element.clear()
                continue

            parsed_surfaces = parse_surfaces(building, stats)
            all_source_points = list(source_points(parsed_surfaces))
            if not parsed_surfaces or not all_source_points:
                stats["invalidGeometry"] += 1
                element.clear()
                continue

            geo_bounds = geographic_bounds(all_source_points, transform)
            if not passes_clip(geo_bounds, clip, clip_mode):
                stats["outsideClip"] += 1
                element.clear()
                continue

            normalized_surfaces = normalize_surfaces(parsed_surfaces, transform, building_id)
            bounds_min, bounds_max = world_bounds(normalized_surfaces)
            source_elevations = [point[2] for point in all_source_points]
            part_ids = [
                candidate
                for candidate in (
                    gml_id(part)
                    for part in building.iter()
                    if local_name(part.tag) == "BuildingPart"
                )
                if candidate
            ]
            metadata = scalar_metadata(building)
            measured_height = metadata.get("measuredHeight")
            computed_height = max(source_elevations) - min(source_elevations)
            height = measured_height if isinstance(measured_height, (int, float)) else computed_height

            west, south, east, north = geo_bounds
            buildings.append(
                {
                    "id": building_id,
                    "parts": part_ids,
                    "provenance": {
                        "dataset": dataset,
                        "sourceDocument": source_name,
                        "sourceSha256": source_sha256,
                        "sourceCrs": "EPSG:25832",
                        "gmlId": building_id,
                        "license": "CC-BY-4.0",
                        "attribution": attribution,
                    },
                    "metadata": metadata,
                    "geographicBounds": {
                        "west": west,
                        "south": south,
                        "east": east,
                        "north": north,
                    },
                    "bbox": {"min": bounds_min, "max": bounds_max},
                    "centroid": [
                        round_number((bounds_min[0] + bounds_max[0]) / 2.0, transform.precision),
                        round_number((bounds_min[1] + bounds_max[1]) / 2.0, transform.precision),
                        round_number((bounds_min[2] + bounds_max[2]) / 2.0, transform.precision),
                    ],
                    "height": round_number(float(height), transform.precision),
                    "groundElevationDHHN2016": round_number(
                        min(source_elevations), transform.precision
                    ),
                    "roofElevationDHHN2016": round_number(
                        max(source_elevations), transform.precision
                    ),
                    "surfaces": normalized_surfaces,
                }
            )
            seen_ids.add(dedupe_key)
            stats["buildingsEmitted"] += 1
            stats["surfacesEmitted"] += len(normalized_surfaces)
            stats["polygonsEmitted"] += sum(
                len(surface["polygons"]) for surface in normalized_surfaces
            )
            element.clear()
    except ET.ParseError as exc:
        raise ConversionError(f"could not parse {source_name}: {exc}") from exc

    validate_crs_hints(crs_hints, source_name)


def atomic_json_write(path: Path, payload: Dict[str, object], pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as stream:
        temporary_path = Path(stream.name)
        json.dump(
            payload,
            stream,
            ensure_ascii=False,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
        )
        stream.write("\n")
    os.replace(temporary_path, path)


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Stream Bavarian CityGML LoD2 (EPSG:25832), select complete buildings "
            "intersecting a WGS84 bbox, and emit Munich3D-normalized JSON."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        type=Path,
        help="CityGML .gml/.xml, gzip-compressed XML, or .zip archive(s)",
    )
    parser.add_argument("--output", "-o", required=True, type=Path, help="output JSON file")
    parser.add_argument(
        "--bbox",
        required=True,
        type=parse_bbox,
        metavar="WEST,SOUTH,EAST,NORTH",
        help="WGS84 building-selection rectangle",
    )
    parser.add_argument(
        "--clip-mode",
        choices=("intersects", "centroid", "contained"),
        default="intersects",
        help="building-level spatial selection; geometry itself is kept complete",
    )
    parser.add_argument(
        "--origin",
        type=parse_origin,
        default=(DEFAULT_ORIGIN_LON, DEFAULT_ORIGIN_LAT),
        metavar="LON,LAT",
        help="WGS84 origin matching src/world/geo.ts",
    )
    parser.add_argument(
        "--vertical-origin",
        type=float,
        default=0.0,
        metavar="METERS",
        help="DHHN2016 elevation subtracted from every output Y coordinate",
    )
    parser.add_argument(
        "--precision",
        type=int,
        choices=range(0, 7),
        default=3,
        metavar="0..6",
        help="decimal places retained in world coordinates",
    )
    parser.add_argument(
        "--dataset",
        default="Bavarian Surveying Administration LoD2",
        help="dataset label copied into per-building provenance",
    )
    parser.add_argument(
        "--attribution",
        default=DEFAULT_ATTRIBUTION,
        help="attribution copied into output provenance",
    )
    parser.add_argument("--pretty", action="store_true", help="indent JSON for inspection")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = create_parser()
    args = parser.parse_args(argv)
    if not math.isfinite(args.vertical_origin):
        parser.error("--vertical-origin must be finite")

    missing = [str(path) for path in args.inputs if not path.is_file()]
    if missing:
        parser.error(f"input file(s) not found: {', '.join(missing)}")

    origin_lon, origin_lat = args.origin
    transform = WorldTransform(
        origin_lon=origin_lon,
        origin_lat=origin_lat,
        vertical_origin=args.vertical_origin,
        precision=args.precision,
    )
    stats = {
        "inputFiles": len(args.inputs),
        "documentsRead": 0,
        "buildingObjectsRead": 0,
        "buildingsEmitted": 0,
        "outsideClip": 0,
        "duplicatesSkipped": 0,
        "missingIds": 0,
        "invalidGeometry": 0,
        "unresolvedXlinks": 0,
        "surfacesEmitted": 0,
        "polygonsEmitted": 0,
    }
    buildings: List[Dict[str, object]] = []
    seen_ids: Set[str] = set()
    source_files: List[Dict[str, object]] = []

    try:
        for input_path in args.inputs:
            source_sha256 = sha256_file(input_path)
            source_files.append(
                {
                    "file": input_path.name,
                    "sha256": source_sha256,
                    "bytes": input_path.stat().st_size,
                }
            )
            for source_name, stream in document_streams(input_path):
                stats["documentsRead"] += 1
                convert_document(
                    stream=stream,
                    source_name=source_name,
                    source_sha256=source_sha256,
                    transform=transform,
                    clip=args.bbox,
                    clip_mode=args.clip_mode,
                    attribution=args.attribution,
                    dataset=args.dataset,
                    seen_ids=seen_ids,
                    buildings=buildings,
                    stats=stats,
                )
    except (ConversionError, OSError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    buildings.sort(key=lambda building: str(building["id"]))
    west, south, east, north = args.bbox
    payload: Dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "dataset": args.dataset,
            "license": "CC-BY-4.0",
            "attribution": args.attribution,
            "files": source_files,
        },
        "coordinateSystem": {
            "sourceHorizontalCrs": "EPSG:25832",
            "sourceVerticalDatum": "DHHN2016",
            "outputAxes": {"x": "east", "y": "up", "z": "south"},
            "originWgs84": {"lon": origin_lon, "lat": origin_lat},
            "verticalOriginDHHN2016": args.vertical_origin,
            "horizontalMapping": "src/world/geo.ts lonLatToWorld",
            "units": "meters",
        },
        "clip": {
            "crs": "EPSG:4326",
            "mode": args.clip_mode,
            "semantics": "complete-building selection; polygon geometry is not cut",
            "bounds": {"west": west, "south": south, "east": east, "north": north},
        },
        "stats": stats,
        "buildings": buildings,
    }

    try:
        atomic_json_write(args.output, payload, args.pretty)
    except OSError as exc:
        print(f"error: could not write {args.output}: {exc}", file=sys.stderr)
        return 2

    print(
        f"Wrote {stats['buildingsEmitted']} buildings, {stats['surfacesEmitted']} surfaces, "
        f"and {stats['polygonsEmitted']} polygons to {args.output}"
    )
    if stats["unresolvedXlinks"]:
        print(
            f"warning: encountered {stats['unresolvedXlinks']} unresolved xlink geometry references",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

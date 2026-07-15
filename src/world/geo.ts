import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export const MUNICH_ORIGIN = {
  lat: 48.151_000,
  lon: 11.572_000,
} as const;

const METERS_PER_DEGREE = 111_320;
const LONGITUDE_SCALE = Math.cos((MUNICH_ORIGIN.lat * Math.PI) / 180);

export function lonLatToWorld(lon: number, lat: number, elevation = 0): Vector3 {
  return new Vector3(
    (lon - MUNICH_ORIGIN.lon) * METERS_PER_DEGREE * LONGITUDE_SCALE,
    elevation,
    -(lat - MUNICH_ORIGIN.lat) * METERS_PER_DEGREE,
  );
}

export function worldToLonLat(position: Vector3): { lat: number; lon: number } {
  return {
    lat: MUNICH_ORIGIN.lat - position.z / METERS_PER_DEGREE,
    lon: MUNICH_ORIGIN.lon + position.x / (METERS_PER_DEGREE * LONGITUDE_SCALE),
  };
}

export const DISTRICTS = {
  center: {
    label: "Center",
    subtitle: "Marienplatz",
    position: lonLatToWorld(11.575_49, 48.137_39, 2.1),
  },
  maxvorstadt: {
    label: "Maxvorstadt",
    subtitle: "Königsplatz",
    position: lonLatToWorld(11.565_43, 48.145_17, 2.1),
  },
  schwabing: {
    label: "Schwabing",
    subtitle: "Elisabethstraße 46",
    // Playable sidewalk position in front of the geocoded address point.
    position: lonLatToWorld(11.566_189_3, 48.159_471_6, 2.1),
  },
} as const;

export type DistrictId = keyof typeof DISTRICTS;

export function closestDistrict(position: Vector3): DistrictId {
  let closest: DistrictId = "maxvorstadt";
  let distance = Number.POSITIVE_INFINITY;

  for (const [id, district] of Object.entries(DISTRICTS) as [DistrictId, (typeof DISTRICTS)[DistrictId]][]) {
    const nextDistance = Vector3.DistanceSquared(position, district.position);
    if (nextDistance < distance) {
      distance = nextDistance;
      closest = id;
    }
  }

  return closest;
}

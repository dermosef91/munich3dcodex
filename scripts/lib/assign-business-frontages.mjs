const WALK_ONLY_ROADS = new Set(["footway", "path", "steps", "cycleway", "bridleway"]);

function tileIdFor(point, tileSize) {
  return `${Math.floor(point[0] / tileSize)}_${Math.floor(point[1] / tileSize)}`;
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area * 0.5;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const prior = ring[previous];
    if ((current[1] > point[1]) === (prior[1] > point[1])) continue;
    const crossingX = ((prior[0] - current[0]) * (point[1] - current[1]))
      / (prior[1] - current[1]) + current[0];
    if (point[0] < crossingX) inside = !inside;
  }
  return inside;
}

function projectToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const raw = lengthSquared > 1e-9
    ? ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared
    : 0;
  const t = Math.max(0, Math.min(1, raw));
  const projected = [start[0] + dx * t, start[1] + dz * t];
  return { point: projected, t, distance: Math.hypot(point[0] - projected[0], point[1] - projected[1]) };
}

function ringDistance(point, ring) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    distance = Math.min(distance, projectToSegment(point, ring[index], ring[(index + 1) % ring.length]).distance);
  }
  return distance;
}

function nearbyTiles(tiles, point, tileSize) {
  const baseX = Math.floor(point[0] / tileSize);
  const baseZ = Math.floor(point[1] / tileSize);
  const result = [];
  for (let x = baseX - 1; x <= baseX + 1; x += 1) {
    for (let z = baseZ - 1; z <= baseZ + 1; z += 1) {
      const tile = tiles.get(`${x}_${z}`);
      if (tile) result.push(tile);
    }
  }
  return result;
}

function nearestRoad(point, roads) {
  let best;
  for (const road of roads) {
    if (WALK_ONLY_ROADS.has(road.kind)) continue;
    for (let index = 0; index < road.points.length - 1; index += 1) {
      const projected = projectToSegment(point, road.points[index], road.points[index + 1]);
      if (!best || projected.distance < best.distance) best = projected;
    }
  }
  return best;
}

function desiredWidth(category) {
  if (["restaurant", "cafe", "bar", "grocery"].includes(category)) return 5.6;
  if (category === "bakery") return 4.8;
  return 4.2;
}

function chooseBuilding(business, buildings) {
  let containing;
  let containingArea = Number.POSITIVE_INFINITY;
  let nearest;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const building of buildings) {
    const ring = building.outline ?? [];
    if (ring.length < 3) continue;
    const distance = ringDistance(business.point, ring);
    if (pointInRing(business.point, ring)) {
      const area = Math.abs(signedArea(ring));
      if (area < containingArea) {
        containing = building;
        containingArea = area;
      }
    } else if (distance < nearestDistance && distance <= 18) {
      nearest = building;
      nearestDistance = distance;
    }
  }
  return containing ?? nearest;
}

function chooseFrontage(business, building, roads) {
  const ring = building.outline;
  const winding = signedArea(ring) >= 0 ? 1 : -1;
  const inside = pointInRing(business.point, ring);
  let best;

  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz);
    if (length < 2.4) continue;
    const tangent = [dx / length, dz / length];
    const outward = [(dz / length) * winding, (-dx / length) * winding];
    const businessProjection = projectToSegment(business.point, start, end);
    const edgeMidpoint = [(start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5];
    const road = nearestRoad(edgeMidpoint, roads);
    const roadDistance = road?.distance ?? 40;
    const towardRoad = road
      ? (road.point[0] - edgeMidpoint[0]) * outward[0] + (road.point[1] - edgeMidpoint[1]) * outward[1]
      : 0;
    const wrongSidePenalty = towardRoad < -0.2 ? 22 : 0;
    const score = inside && businessProjection.distance > 8
      ? roadDistance + businessProjection.distance * 0.12 + wrongSidePenalty
      : businessProjection.distance * 1.25 + roadDistance * 0.35 + wrongSidePenalty;
    if (!best || score < best.score) {
      best = { edgeIndex: index, start, end, length, tangent, outward, projection: businessProjection, score };
    }
  }
  if (!best) return undefined;

  const width = Math.min(desiredWidth(business.category), Math.max(2.4, best.length - 0.7));
  const edgeInset = Math.min(0.45, width / Math.max(best.length * 2, 0.001));
  const t = Math.max(edgeInset, Math.min(1 - edgeInset, best.projection.t));
  return {
    buildingId: building.id,
    anchor: [
      Math.round((best.start[0] + (best.end[0] - best.start[0]) * t) * 1_000) / 1_000,
      Math.round((best.start[1] + (best.end[1] - best.start[1]) * t) * 1_000) / 1_000,
    ],
    tangent: best.tangent.map((value) => Math.round(value * 1_000_000) / 1_000_000),
    outward: best.outward.map((value) => Math.round(value * 1_000_000) / 1_000_000),
    width: Math.round(width * 100) / 100,
    _edgeIndex: best.edgeIndex,
    _edgeStart: best.start,
    _edgeLength: best.length,
    _edgeT: t,
  };
}

function resolveFrontageConflicts(businesses) {
  const groups = new Map();
  for (const business of businesses) {
    const frontage = business.frontage;
    if (!frontage) continue;
    const key = `${frontage.buildingId}/${frontage._edgeIndex}`;
    const group = groups.get(key) ?? [];
    group.push(business);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.frontage._edgeT - b.frontage._edgeT);
    if (group.length > 1) {
      const edgeLength = group[0].frontage._edgeLength;
      const margin = Math.min(0.35, edgeLength * 0.08);
      const rawCenters = group.map((business) => business.frontage._edgeT * edgeLength);
      for (let index = 0; index < group.length; index += 1) {
        const left = index === 0 ? margin : (rawCenters[index - 1] + rawCenters[index]) * 0.5 + 0.10;
        const right = index === group.length - 1
          ? edgeLength - margin
          : (rawCenters[index] + rawCenters[index + 1]) * 0.5 - 0.10;
        const available = Math.max(1.6, right - left);
        const frontage = group[index].frontage;
        const center = Math.max(margin, Math.min(edgeLength - margin, (left + right) * 0.5));
        frontage.width = Math.round(Math.min(frontage.width, available) * 100) / 100;
        frontage.anchor = [
          Math.round((frontage._edgeStart[0] + frontage.tangent[0] * center) * 1_000) / 1_000,
          Math.round((frontage._edgeStart[1] + frontage.tangent[1] * center) * 1_000) / 1_000,
        ];
      }
    }

    for (const business of group) {
      delete business.frontage._edgeIndex;
      delete business.frontage._edgeStart;
      delete business.frontage._edgeLength;
      delete business.frontage._edgeT;
    }
  }
}

function deduplicateBusinesses(businesses) {
  const result = [];
  for (const business of businesses.sort((a, b) => a.id.localeCompare(b.id))) {
    const normalizedName = business.name.toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
    const duplicate = result.some((candidate) => (
      candidate.name.toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim() === normalizedName
      && Math.hypot(candidate.point[0] - business.point[0], candidate.point[1] - business.point[1]) < 4
    ));
    if (!duplicate) result.push(business);
  }
  return result;
}

/**
 * Snaps real OSM business points to the most likely road-facing edge of the
 * current runtime building geometry. Call again after LoD2 replaces OSM shells.
 */
export function assignBusinessFrontages(tiles, tileSize) {
  const businesses = deduplicateBusinesses([...tiles.values()].flatMap((tile) => tile.businesses ?? []));
  for (const tile of tiles.values()) tile.businesses = [];
  let assigned = 0;

  for (const business of businesses) {
    const localTiles = nearbyTiles(tiles, business.point, tileSize);
    const buildings = localTiles.flatMap((tile) => tile.buildings ?? []);
    const roads = localTiles.flatMap((tile) => tile.roads ?? []);
    const building = chooseBuilding(business, buildings);
    business.frontage = building ? chooseFrontage(business, building, roads) : undefined;
    if (business.frontage) assigned += 1;
  }

  resolveFrontageConflicts(businesses);
  for (const business of businesses) {
    const targetPoint = business.frontage?.anchor ?? business.point;
    tiles.get(tileIdFor(targetPoint, tileSize))?.businesses.push(business);
  }

  return { businesses: businesses.length, assigned };
}

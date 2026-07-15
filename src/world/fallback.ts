import type { MunichTile, Point2 } from "./types";

function rectangle(centerX: number, centerZ: number, width: number, depth: number): Point2[] {
  return [
    [centerX - width / 2, centerZ - depth / 2],
    [centerX + width / 2, centerZ - depth / 2],
    [centerX + width / 2, centerZ + depth / 2],
    [centerX - width / 2, centerZ + depth / 2],
  ];
}

export function createFallbackTile(id: string, center: Point2, tileSize: number): MunichTile {
  const buildings: MunichTile["buildings"] = [];
  const roads: MunichTile["roads"] = [];
  const block = 92;
  let buildingId = 1;

  for (let x = -tileSize / 2 + block / 2; x < tileSize / 2; x += block) {
    roads.push({
      kind: "residential",
      width: 8,
      points: [
        [center[0] + x - block / 2, center[1] - tileSize / 2],
        [center[0] + x - block / 2, center[1] + tileSize / 2],
      ],
    });

    for (let z = -tileSize / 2 + block / 2; z < tileSize / 2; z += block) {
      const inset = 14;
      const width = block - inset * 2;
      const depth = block - inset * 2;
      buildings.push({
        id: buildingId++,
        outline: rectangle(center[0] + x, center[1] + z, width, depth),
        height: 12 + ((buildingId * 7) % 15),
      });
    }
  }

  for (let z = -tileSize / 2; z <= tileSize / 2; z += block) {
    roads.push({
      kind: "residential",
      width: 8,
      points: [
        [center[0] - tileSize / 2, center[1] + z],
        [center[0] + tileSize / 2, center[1] + z],
      ],
    });
  }

  return { id, center, buildings, roads, greens: [] };
}

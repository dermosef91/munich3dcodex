export type FacadeColor = readonly [red: number, green: number, blue: number];
export type FacadePoint = readonly [x: number, z: number];

export const ELISABETHSTRASSE_46_ID = 108881086;

export interface FacadeProvenance {
  method: "original-art" | "licensed-photo" | "procedural";
  reviewStatus: "prototype" | "approved";
  note: string;
}

export interface BuildingFacadeDefinition {
  label: string;
  styleFamily: string;
  textureUrl: string;
  frontEdgeIndex: number;
  frontEdge?: readonly [start: FacadePoint, end: FacadePoint];
  sideColor: FacadeColor;
  provenance: FacadeProvenance;
}

export const buildingFacadeRegistry: ReadonlyMap<number, BuildingFacadeDefinition> = new Map([
  [
    ELISABETHSTRASSE_46_ID,
    {
      label: "Elisabethstrasse 46",
      styleFamily: "Munich post-war residential / ochre stucco",
      textureUrl: "/assets/textures/elisabethstrasse-46-facade-v1.png",
      frontEdgeIndex: 0,
      // Bayerische Vermessungsverwaltung LoD2 DEBY_LOD2_4909212.
      frontEdge: [[-433.463, -950.42], [-403.328, -943.483]],
      sideColor: [0.72, 0.54, 0.18],
      provenance: {
        method: "original-art",
        reviewStatus: "prototype",
        note: "Original synthetic facade from user-supplied architectural traits; no map imagery pixels are embedded.",
      },
    },
  ],
]);

export function getBuildingFacade(buildingId: number): BuildingFacadeDefinition | undefined {
  return buildingFacadeRegistry.get(buildingId);
}

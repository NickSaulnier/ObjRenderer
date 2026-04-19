export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface SceneEventMap {
  'meshes-changed': { version: number };
  'bounds-changed': { version: number };
  'stats-changed': { version: number };
}

export type SceneEventName = keyof SceneEventMap;

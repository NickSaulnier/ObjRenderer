import { useSyncExternalStore } from 'react';
import type { Scene } from '../../scene/Scene';

export interface MeshSnapshot {
  id: string;
  name: string;
  visible: boolean;
  vertexCount: number;
  triangleCount: number;
}

export interface SceneSnapshot {
  version: number;
  meshes: MeshSnapshot[];
  stats: { vertices: number; triangles: number; visibleTriangles: number };
  boundsSize: [number, number, number];
}

const empty: SceneSnapshot = {
  version: 0,
  meshes: [],
  stats: { vertices: 0, triangles: 0, visibleTriangles: 0 },
  boundsSize: [0, 0, 0],
};

let cacheVersion = -1;
let cache: SceneSnapshot = empty;

function snapshotScene(scene: Scene): SceneSnapshot {
  const v = scene.versions.meshes;
  if (v === cacheVersion) return cache;
  const stats = scene.getStats();
  const bounds = scene.getBounds(true);
  cacheVersion = v;
  cache = {
    version: v,
    meshes: scene.getMeshes().map((m) => ({
      id: m.id,
      name: m.name,
      visible: m.visible,
      vertexCount: m.vertexCount,
      triangleCount: m.triangleCount,
    })),
    stats,
    boundsSize: [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ],
  };
  return cache;
}

export function useSceneSnapshot(scene: Scene | null): SceneSnapshot {
  return useSyncExternalStore(
    (listener) => {
      if (!scene) return () => {};
      const u1 = scene.on('meshes-changed', () => listener());
      return () => u1();
    },
    () => (scene ? snapshotScene(scene) : empty),
    () => (scene ? snapshotScene(scene) : empty),
  );
}

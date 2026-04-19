import { buildBVH, type BuildInput } from '../bvh/BVH';

export interface BvhWorkerMeshInput {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface BvhWorkerRequest {
  id: number;
  meshes: BvhWorkerMeshInput[];
}

export interface BvhWorkerResponse {
  id: number;
  ok: true;
  nodeCount: number;
  triCount: number;
  nodes: Float32Array;
  triangles: Float32Array;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

export interface BvhWorkerError {
  id: number;
  ok: false;
  error: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<BvhWorkerRequest>) => {
  const { id, meshes } = event.data;
  try {
    const inputs: BuildInput[] = meshes.map((m) => ({
      positions: m.positions,
      normals: m.normals,
      indices: m.indices,
    }));
    const result = buildBVH(inputs);
    const response: BvhWorkerResponse = {
      id,
      ok: true,
      nodeCount: result.nodeCount,
      triCount: result.triCount,
      nodes: result.nodes,
      triangles: result.triangles,
      boundsMin: result.boundsMin,
      boundsMax: result.boundsMax,
    };
    ctx.postMessage(response, [result.nodes.buffer, result.triangles.buffer]);
  } catch (err) {
    const response: BvhWorkerError = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
});

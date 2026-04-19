import { parseObj, type ParsedObjGroup } from '../loaders/objLoader';

export interface ObjWorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  fallbackName: string;
}

export interface ObjWorkerResponseGroup {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface ObjWorkerResponse {
  id: number;
  ok: true;
  groups: ObjWorkerResponseGroup[];
}

export interface ObjWorkerError {
  id: number;
  ok: false;
  error: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<ObjWorkerRequest>) => {
  const { id, buffer, fallbackName } = event.data;
  try {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    const parsed = parseObj(text, fallbackName);
    const groups: ObjWorkerResponseGroup[] = parsed.groups.map((g: ParsedObjGroup) => ({
      name: g.name,
      positions: g.positions,
      normals: g.normals,
      indices: g.indices,
    }));
    const transfers: Transferable[] = [];
    for (const g of groups) {
      transfers.push(g.positions.buffer, g.normals.buffer, g.indices.buffer);
    }
    const response: ObjWorkerResponse = { id, ok: true, groups };
    ctx.postMessage(response, transfers);
  } catch (err) {
    const response: ObjWorkerError = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
});

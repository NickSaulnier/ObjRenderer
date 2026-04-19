import { Mesh, emptyBounds, isEmptyBounds, unionBounds } from './Mesh';
import type { AABB, SceneEventMap, SceneEventName } from './types';

type Listener<K extends SceneEventName> = (ev: SceneEventMap[K]) => void;

export class Scene {
  private meshes: Mesh[] = [];
  private listeners = new Map<SceneEventName, Set<Listener<SceneEventName>>>();
  private meshVersion = 0;
  private boundsVersion = 0;
  private statsVersion = 0;

  addMesh(mesh: Mesh): void {
    this.meshes.push(mesh);
    this.bumpMeshes();
  }

  removeMesh(id: string): void {
    const idx = this.meshes.findIndex((m) => m.id === id);
    if (idx >= 0) {
      this.meshes.splice(idx, 1);
      this.bumpMeshes();
    }
  }

  clear(): void {
    if (this.meshes.length === 0) return;
    this.meshes = [];
    this.bumpMeshes();
  }

  getMeshes(): readonly Mesh[] {
    return this.meshes;
  }

  getMesh(id: string): Mesh | undefined {
    return this.meshes.find((m) => m.id === id);
  }

  setMeshVisibility(id: string, visible: boolean): void {
    const mesh = this.getMesh(id);
    if (!mesh || mesh.visible === visible) return;
    mesh.visible = visible;
    this.bumpMeshes();
  }

  get visibleMeshes(): Mesh[] {
    return this.meshes.filter((m) => m.visible);
  }

  getBounds(includeHidden: boolean = false): AABB {
    let bounds = emptyBounds();
    for (const mesh of this.meshes) {
      if (!includeHidden && !mesh.visible) continue;
      bounds = unionBounds(bounds, mesh.bounds);
    }
    if (isEmptyBounds(bounds)) return { min: [-1, -1, -1], max: [1, 1, 1] };
    return bounds;
  }

  getStats(): { vertices: number; triangles: number; visibleTriangles: number } {
    let vertices = 0;
    let triangles = 0;
    let visibleTriangles = 0;
    for (const mesh of this.meshes) {
      vertices += mesh.vertexCount;
      triangles += mesh.triangleCount;
      if (mesh.visible) visibleTriangles += mesh.triangleCount;
    }
    return { vertices, triangles, visibleTriangles };
  }

  get versions(): {
    meshes: number;
    bounds: number;
    stats: number;
  } {
    return {
      meshes: this.meshVersion,
      bounds: this.boundsVersion,
      stats: this.statsVersion,
    };
  }

  on<K extends SceneEventName>(name: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as Listener<SceneEventName>);
    return () => {
      set!.delete(listener as Listener<SceneEventName>);
    };
  }

  private emit<K extends SceneEventName>(name: K, ev: SceneEventMap[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const l of set) (l as Listener<K>)(ev);
  }

  private bumpMeshes(): void {
    this.meshVersion++;
    this.boundsVersion++;
    this.statsVersion++;
    this.emit('meshes-changed', { version: this.meshVersion });
    this.emit('bounds-changed', { version: this.boundsVersion });
    this.emit('stats-changed', { version: this.statsVersion });
  }
}

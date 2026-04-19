import { mat4, vec3 } from 'gl-matrix';

export interface CameraSnapshot {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovY: number;
  aspect: number;
  near: number;
  far: number;
  viewProj: Float32Array;
  view: Float32Array;
  invView: Float32Array;
  invProj: Float32Array;
}

export class Camera {
  position = vec3.fromValues(0, 0, 3);
  target = vec3.fromValues(0, 0, 0);
  up = vec3.fromValues(0, 1, 0);
  fovY = (45 * Math.PI) / 180;
  aspect = 1;
  near = 0.01;
  far = 1000;

  private view = mat4.create();
  private proj = mat4.create();
  private viewProj = mat4.create();
  private invView = mat4.create();
  private invProj = mat4.create();

  private dirty = true;
  private version = 0;

  markDirty(): void {
    this.dirty = true;
    this.version++;
  }

  getVersion(): number {
    return this.version;
  }

  setAspect(aspect: number): void {
    if (this.aspect !== aspect) {
      this.aspect = aspect;
      this.markDirty();
    }
  }

  update(): void {
    if (!this.dirty) return;
    mat4.lookAt(this.view, this.position, this.target, this.up);
    mat4.perspective(this.proj, this.fovY, this.aspect, this.near, this.far);
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.invert(this.invView, this.view);
    mat4.invert(this.invProj, this.proj);
    this.dirty = false;
  }

  snapshot(): CameraSnapshot {
    this.update();
    return {
      position: [this.position[0], this.position[1], this.position[2]],
      target: [this.target[0], this.target[1], this.target[2]],
      up: [this.up[0], this.up[1], this.up[2]],
      fovY: this.fovY,
      aspect: this.aspect,
      near: this.near,
      far: this.far,
      viewProj: this.viewProj as Float32Array,
      view: this.view as Float32Array,
      invView: this.invView as Float32Array,
      invProj: this.invProj as Float32Array,
    };
  }
}

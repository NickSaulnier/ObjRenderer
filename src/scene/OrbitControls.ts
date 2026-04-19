import { vec3 } from 'gl-matrix';
import type { Camera } from './Camera';
import type { AABB } from './types';

type ChangeListener = () => void;

interface OrbitState {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
}

export class OrbitControls {
  private state: OrbitState = {
    yaw: Math.PI * 0.25,
    pitch: Math.PI * 0.15,
    distance: 3,
    target: [0, 0, 0],
  };
  private listeners = new Set<ChangeListener>();
  private attached: HTMLElement | null = null;
  private activeButton: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private minDistance = 0.05;
  private maxDistance = 1e6;
  private rotateSpeed = 0.005;
  private panSpeed = 0.0025;
  private zoomSpeed = 0.0015;

  constructor(private camera: Camera) {
    this.applyToCamera();
  }

  attach(element: HTMLElement): void {
    if (this.attached) this.detach();
    this.attached = element;
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    const el = this.attached;
    if (!el) return;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    this.attached = null;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  frameBounds(bounds: AABB, paddingRatio = 1.5): void {
    const cx = (bounds.min[0] + bounds.max[0]) * 0.5;
    const cy = (bounds.min[1] + bounds.max[1]) * 0.5;
    const cz = (bounds.min[2] + bounds.max[2]) * 0.5;
    const ex = bounds.max[0] - bounds.min[0];
    const ey = bounds.max[1] - bounds.min[1];
    const ez = bounds.max[2] - bounds.min[2];
    const radius = 0.5 * Math.sqrt(ex * ex + ey * ey + ez * ez);
    const fov = this.camera.fovY;
    const fovMin = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const safeRadius = Math.max(radius, 1e-4);
    const dist = (safeRadius / Math.sin(Math.max(fovMin, 1e-3) * 0.5)) * paddingRatio;
    this.state.target = [cx, cy, cz];
    this.state.distance = clamp(dist, this.minDistance, this.maxDistance);
    this.applyToCamera();
    this.notify();
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.attached) return;
    if (ev.button !== 0 && ev.button !== 1 && ev.button !== 2) return;
    this.attached.setPointerCapture(ev.pointerId);
    this.activeButton = ev.button;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    ev.preventDefault();
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.activeButton === null) return;
    const dx = ev.clientX - this.lastX;
    const dy = ev.clientY - this.lastY;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    const isPan = this.activeButton === 2 || this.activeButton === 1 || ev.shiftKey;
    if (isPan) {
      this.pan(dx, dy);
    } else {
      this.rotate(dx, dy);
    }
    this.applyToCamera();
    this.notify();
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (this.activeButton === null) return;
    this.activeButton = null;
    this.attached?.releasePointerCapture(ev.pointerId);
  };

  private onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const factor = Math.exp(ev.deltaY * this.zoomSpeed);
    this.state.distance = clamp(this.state.distance * factor, this.minDistance, this.maxDistance);
    this.applyToCamera();
    this.notify();
  };

  private onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
  };

  private rotate(dx: number, dy: number): void {
    this.state.yaw -= dx * this.rotateSpeed;
    this.state.pitch -= dy * this.rotateSpeed;
    const eps = 0.001;
    const limit = Math.PI * 0.5 - eps;
    if (this.state.pitch > limit) this.state.pitch = limit;
    if (this.state.pitch < -limit) this.state.pitch = -limit;
  }

  private pan(dx: number, dy: number): void {
    const { position, target } = this.camera;
    const forward = vec3.sub(vec3.create(), target, position);
    vec3.normalize(forward, forward);
    const right = vec3.cross(vec3.create(), forward, this.camera.up);
    vec3.normalize(right, right);
    const up = vec3.cross(vec3.create(), right, forward);
    vec3.normalize(up, up);
    const scale = this.state.distance * this.panSpeed;
    const delta = vec3.create();
    vec3.scaleAndAdd(delta, delta, right, -dx * scale);
    vec3.scaleAndAdd(delta, delta, up, dy * scale);
    this.state.target[0] += delta[0];
    this.state.target[1] += delta[1];
    this.state.target[2] += delta[2];
  }

  private applyToCamera(): void {
    const { yaw, pitch, distance, target } = this.state;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const ox = distance * cp * sy;
    const oy = distance * sp;
    const oz = distance * cp * cy;
    this.camera.target[0] = target[0];
    this.camera.target[1] = target[1];
    this.camera.target[2] = target[2];
    this.camera.position[0] = target[0] + ox;
    this.camera.position[1] = target[1] + oy;
    this.camera.position[2] = target[2] + oz;
    this.camera.markDirty();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

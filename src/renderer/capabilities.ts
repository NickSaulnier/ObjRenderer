import type { BackendKind } from './Renderer';

export interface BackendCapabilities {
  webgpu: boolean;
  webgl: boolean;
  webgpuError?: string;
  webglError?: string;
  defaultBackend: BackendKind;
}

export async function probeCapabilities(): Promise<BackendCapabilities> {
  const webgl = probeWebGL2();
  const webgpu = await probeWebGPU();
  const availableBackend: BackendKind | null = webgpu.available
    ? 'webgpu'
    : webgl.available
      ? 'webgl'
      : null;
  if (!availableBackend) {
    throw new Error(
      'Neither WebGPU nor WebGL2 (with EXT_color_buffer_float) is available in this browser.',
    );
  }
  const caps: BackendCapabilities = {
    webgpu: webgpu.available,
    webgl: webgl.available,
    defaultBackend: availableBackend,
  };
  if (webgpu.error) caps.webgpuError = webgpu.error;
  if (webgl.error) caps.webglError = webgl.error;
  return caps;
}

function probeWebGL2(): { available: boolean; error?: string } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return { available: false, error: 'WebGL2 not supported' };
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) {
      return {
        available: false,
        error: 'WebGL2 missing EXT_color_buffer_float',
      };
    }
    return { available: true };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeWebGPU(): Promise<{ available: boolean; error?: string }> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return { available: false, error: 'navigator.gpu is not defined' };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: false, error: 'No WebGPU adapter' };
    return { available: true };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

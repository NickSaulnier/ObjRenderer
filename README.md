# OBJ Path Tracer

A TypeScript Monte-Carlo path tracer that renders `.obj` files in the browser, with two fully featured runtime-switchable backends:

- **WebGPU** — WGSL compute-shader path tracer
- **WebGL2** — fragment-shader path tracer (data-textures for BVH + triangles)

Heavy work (OBJ parsing, SAH BVH construction) runs in dedicated web workers so the UI stays responsive while large models load.

## Requirements

- **Node.js** ≥ 18.18 (tested on 20.x and 22.x; Vite 5 supports `^18.0.0 || >=20.0.0`).
- A browser with **WebGL2** and `EXT_color_buffer_float` (every modern desktop browser). **WebGPU** is optional — if unavailable, the app starts in WebGL2 and the backend toggle disables the WebGPU option.

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>.

### Scripts

| Script                 | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Vite dev server with HMR                              |
| `npm run build`        | Type-check then produce a production bundle in `dist` |
| `npm run preview`      | Serve the production build locally                    |
| `npm run typecheck`    | `tsc -b --noEmit` without emitting files              |
| `npm run lint`         | ESLint over the whole project                         |
| `npm run lint:fix`     | ESLint with auto-fix                                  |
| `npm run format`       | Rewrite files with Prettier                           |
| `npm run format:check` | CI-friendly Prettier check                            |

## Using the app

- Click **Open** (or drag-and-drop) a `.obj` file onto the viewport.
- **Left-drag** to orbit, **right-drag / shift-drag** to pan, **wheel** to zoom.
- The left panel lists loaded meshes — toggle the eye icon to hide/show, click the frame icon to fit-to-view, the trash icon to remove.
- The bottom strip controls the path tracer:
  - **SPP target** — samples per pixel to accumulate before pausing
  - **Max bounces** — ray-depth cap (Russian roulette kicks in after bounce 3)
  - **Reset** — clear the accumulation buffer
- **Save PNG** on the toolbar downloads the currently accumulated frame.
- The backend toggle switches between WebGPU / WebGL2 at runtime (tears down the old renderer and re-uploads scene data).

## How it works

- **Path tracer** — pinhole camera with jittered AA, closest-hit BVH traversal with a 32-deep local stack, Lambertian BRDF with a default gray albedo, cosine-weighted hemisphere sampling, Russian roulette after 3 bounces, procedural sky gradient as the only light source. PCG hash RNG seeded from `(pixel, frameIndex, sampleIndex)`. ACES tone-map + sRGB gamma at present time.
- **BVH** — SAH builder producing a flat GPU-friendly layout (bounds as `vec4` pairs + child/tri indices per node) consumed identically by both backends.
- **Accumulation** — WebGPU uses an `rgba32float` storage texture; WebGL2 ping-pongs two `RGBA32F` framebuffers. Any camera change or render-setting change resets the buffer; once the SPP target is reached the render loop parks itself.
- **Engine boundary** — React owns the UI, an imperative `Engine` instance owns the canvas, scene data, workers, and active renderer. React subscribes to it via `useSyncExternalStore` so per-frame stats updates never re-render components.

### Limitations (v1)

- Positions + (optional) normals only — no `.mtl`, no textures, no UVs.
- No explicit lights (sky-only illumination).
- Single-material diffuse shading.

The BVH / renderer interfaces leave room for materials, textures, and light sampling.

## Project layout

```
src/
  main.tsx                      React entry
  index.css                     Global styles
  app/                          React UI
    App.tsx / App.module.css
    AppContext.tsx              Engine + capabilities context
    hooks/
      useEngineState.ts         Subscribes to Engine events
      useSceneStore.ts          Subscribes to Scene events
    components/
      Toolbar.tsx               Open / Fit / Save / Clear
      MeshPanel.tsx             Loaded-mesh list
      DetailsPanel.tsx          Live stats
      RenderControls.tsx        SPP, bounces, reset, progress
      BackendToggle.tsx         WebGPU ↔ WebGL2 switch
      Viewport.tsx              Canvas host + drag-drop
      ErrorBanner.tsx           Transient error toasts
  engine/Engine.ts              Orchestrator: scene, workers, renderer lifecycle
  scene/                        Plain TS: Scene, Mesh, Camera, OrbitControls
  loaders/objLoader.ts
  bvh/BVH.ts                    SAH builder + flat layout
  workers/
    objWorker.ts                OBJ parsing off the main thread
    bvhWorker.ts                BVH construction off the main thread
  renderer/
    Renderer.ts                 Shared interface
    capabilities.ts             Probes navigator.gpu / WebGL2
    webgpu/
      WebGPURenderer.ts
      pathtrace.wgsl
      present.wgsl
    webgl/
      WebGLRenderer.ts
      fullscreen.vert
      pathtrace.frag
      present.frag
```

## Tooling

- **Vite 5** + `@vitejs/plugin-react` for dev server / bundling.
- **TypeScript** in strict mode (`tsc -b` project references).
- **ESLint 9** flat config with `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, and `eslint-config-prettier`.
- **Prettier** (`.prettierrc.json`) — 100-col, single quotes, trailing commas, LF.

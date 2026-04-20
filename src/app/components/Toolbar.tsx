import { useRef } from 'react';
import styles from './Toolbar.module.css';
import { useEngine } from '../AppContext';
import { useEngineState } from '../hooks/useEngineState';

export function Toolbar(): React.ReactNode {
  const engine = useEngine();
  const state = useEngineState(engine);
  const fileRef = useRef<HTMLInputElement>(null);

  const onOpenClick = () => {
    fileRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.toLowerCase().endsWith('.obj')) {
        void engine.loadObjFile(file);
      }
    }
    e.target.value = '';
  };

  const onSavePng = async () => {
    const blob = await engine.saveImage();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'render.png';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onSaveRaw = async () => {
    const capture = await engine.capture();
    if (!capture) return;
    const rgbUrl = URL.createObjectURL(capture.rgbPng);
    const rawUrl = URL.createObjectURL(capture.rawPng);
    const meta = new Blob([JSON.stringify(capture.metadata, null, 2)], {
      type: 'application/json',
    });
    const metaUrl = URL.createObjectURL(meta);
    download(rgbUrl, 'capture-rgb.png');
    download(rawUrl, 'capture-raw.png');
    download(metaUrl, 'capture-raw.json');
    URL.revokeObjectURL(rgbUrl);
    URL.revokeObjectURL(rawUrl);
    URL.revokeObjectURL(metaUrl);
  };

  const onFitAll = () => {
    engine.fitAll();
  };

  const onClear = () => {
    engine.clearScene();
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.title}>OBJ PATH TRACER</div>
      <div className={styles.group}>
        <button className={styles.button} onClick={onOpenClick} title="Open .obj file">
          Open .obj
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".obj"
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
        <button className={styles.button} onClick={onFitAll} title="Frame scene bounds">
          Fit all
        </button>
        <button className={styles.button} onClick={onSavePng} title="Save current render as PNG">
          Save RGB
        </button>
        {state.cameraMode === 'sensor-capture' ? (
          <button className={styles.button} onClick={onSaveRaw} title="Save RGB + RAW + metadata">
            Save RAW + JSON
          </button>
        ) : null}
        <button className={styles.button} onClick={onClear} title="Remove all meshes">
          Clear
        </button>
      </div>
    </div>
  );
}

function download(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

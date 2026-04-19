import { useEffect, useRef } from 'react';
import styles from './Viewport.module.css';
import { useEngine } from '../AppContext';

export function Viewport(): React.ReactNode {
  const engine = useEngine();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      container.classList.add(styles.dragOver!);
    };
    const onDragLeave = () => {
      container.classList.remove(styles.dragOver!);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      container.classList.remove(styles.dragOver!);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.name.toLowerCase().endsWith('.obj')) {
          void engine.loadObjFile(f);
        }
      }
    };
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);
    return () => {
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('dragleave', onDragLeave);
      container.removeEventListener('drop', onDrop);
    };
  }, [engine]);

  return <div className={styles.viewport} ref={containerRef} data-engine-container />;
}

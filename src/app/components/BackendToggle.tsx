import styles from './BackendToggle.module.css';
import { useAppContext, useEngine } from '../AppContext';
import { useEngineState } from '../hooks/useEngineState';
import type { BackendKind } from '../../renderer/Renderer';

export function BackendToggle(): React.ReactNode {
  const engine = useEngine();
  const { capabilities } = useAppContext();
  const state = useEngineState(engine);

  const onSwitch = (backend: BackendKind) => {
    if (state.backend === backend) return;
    void engine.switchBackend(backend);
  };

  return (
    <div className={styles.toggle}>
      <button
        className={styles.button}
        data-active={state.backend === 'webgpu'}
        disabled={!capabilities.webgpu}
        onClick={() => onSwitch('webgpu')}
        title={
          capabilities.webgpu
            ? 'Use WebGPU compute backend'
            : capabilities.webgpuError || 'WebGPU not available'
        }
      >
        WebGPU
      </button>
      <button
        className={styles.button}
        data-active={state.backend === 'webgl'}
        disabled={!capabilities.webgl}
        onClick={() => onSwitch('webgl')}
        title={
          capabilities.webgl
            ? 'Use WebGL2 fragment-shader backend'
            : capabilities.webglError || 'WebGL2 not available'
        }
      >
        WebGL2
      </button>
    </div>
  );
}

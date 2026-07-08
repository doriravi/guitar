// Async renderer factory for R3F v9's `gl` prop. React Three Fiber v9 accepts a
// callback that returns a Promise, which is exactly what WebGPURenderer needs
// (it initializes asynchronously). WebGPURenderer transparently falls back to
// WebGL2 when WebGPU isn't available on the device, so a single code path covers
// both backends — we don't branch on capability here.
//
// Usage in a <Canvas>:
//   <Canvas gl={makeWebGPURenderer({ alpha: true })} ...>
//
// The returned function receives the default canvas/context props from R3F and
// merges our overrides, then awaits init() before handing the renderer back.
import { WebGPURenderer } from 'three/webgpu';

export function makeWebGPURenderer(overrides = {}) {
  return async (props) => {
    const renderer = new WebGPURenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
      ...props,
      ...overrides,
    });
    await renderer.init();
    return renderer;
  };
}

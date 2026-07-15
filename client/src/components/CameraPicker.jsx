// CameraPicker — a compact <select> for choosing which camera the fretboard
// vision uses. Only renders when more than one camera exists (so phones with a
// single rear cam don't see clutter; laptops/desktops with multiple webcams or
// an external cam get to switch). Driven by useFretboardCam's `cameras` list +
// `switchCamera` action.

import { useT } from '../lib/i18n';

export default function CameraPicker({ cam, lang }) {
  const tr = useT(lang);
  if (!cam.cameras || cam.cameras.length < 2) return null;
  return (
    <div className="flex items-center gap-2 justify-center mt-2">
      <span className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>📷 {tr.cameraSource || 'Camera'}</span>
      <select
        value={cam.cameraId || ''}
        onChange={(e) => cam.switchCamera(e.target.value)}
        className="text-xs px-2 py-1 rounded-lg"
        style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink)', border: '1px solid var(--color-surface-550)' }}
      >
        {cam.cameras.map((c) => (
          <option key={c.deviceId} value={c.deviceId}>{c.label}</option>
        ))}
      </select>
    </div>
  );
}

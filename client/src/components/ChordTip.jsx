// Hover chord map — wraps any displayed chord name so hovering (or keyboard
// focus) shows the chord's SHAPE as a floating fretboard diagram. This is the
// CLAUDE.md rule made reusable: no chord name anywhere in the app renders as
// plain text. Names resolve through lookupVoicings, so real-sheet spellings
// (F7M, D4, Am/G, B74/9…) show their closest playable shape too.

import { useState } from 'react';
import { lookupVoicings } from '../lib/voicingLookup';
import FretboardDiagram from './FretboardDiagram';

export default function ChordTip({ name, children, className, style }) {
  const [tip, setTip] = useState(null); // { voicing, x, y }

  const show = (e) => {
    const v = lookupVoicings(name).slice().sort((a, b) => a.score - b.score)[0];
    if (!v) return;   // nothing on file even after normalization → no tooltip
    const r = e.currentTarget.getBoundingClientRect();
    const tipW = 150;
    setTip({
      voicing: v,
      x: r.right + 8 + tipW > window.innerWidth ? r.left - tipW - 6 : r.right + 8,
      y: Math.max(8, r.top - 10),
    });
  };
  const hide = () => setTip(null);

  return (
    <span className={className} style={style}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {tip && (
        <span className="fixed z-50 block rounded-xl p-3 pointer-events-none"
          style={{ left: tip.x, top: tip.y, background: 'var(--color-surface-700)', border: '1px solid var(--color-surface-550)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          <span className="block text-xs mb-1 text-center" style={{ color: 'var(--color-ink-faint)' }}>
            {tip.voicing.name}{tip.voicing.name !== name ? ` (for ${name})` : ''}{tip.voicing.type ? ` · ${tip.voicing.type}` : ''}
          </span>
          <FretboardDiagram chord={tip.voicing} />
        </span>
      )}
    </span>
  );
}

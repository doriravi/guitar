// Vitest spec for practiceAdvice — the after-attempt coaching summary derived
// from a fused camera×mic verdict. Pure logic, so we assert exact copy branches.

import { describe, it, expect } from 'vitest';
import {
  attemptScore,
  primaryTip,
  positiveNote,
  buildAttemptAdvice,
} from './practiceAdvice';

const verdict = (status, perString = []) => ({ status, perString });

describe('attemptScore', () => {
  it('scores each verdict tier', () => {
    expect(attemptScore(verdict('both'))).toBe(5);
    expect(attemptScore(verdict('shape-only'))).toBe(3);
    expect(attemptScore(verdict('sound-only'))).toBe(2);
    expect(attemptScore(verdict('none'))).toBe(1);
    expect(attemptScore(null)).toBe(1);
  });
});

describe('primaryTip', () => {
  it('has no tip on a clean chord', () => {
    expect(primaryTip(verdict('both'), 'Am')).toBeNull();
  });

  it('calls out a shaped-but-muted string (headline case)', () => {
    const v = verdict('shape-only', [
      { string: 4, label: 'B', cam: 'ok', mic: 'muted' },
      { string: 2, label: 'D', cam: 'ok', mic: 'correct' },
    ]);
    const tip = primaryTip(v, 'Am');
    expect(tip).toContain('B');
    expect(tip.toLowerCase()).toContain('behind the fret');
  });

  it('calls out a wrong-fret string', () => {
    const v = verdict('none', [{ string: 3, label: 'G', cam: 'wrong', mic: 'wrong' }]);
    expect(primaryTip(v, 'Am')).toContain('wrong fret');
  });

  it('calls out a missing string', () => {
    const v = verdict('none', [{ string: 3, label: 'G', cam: 'missing', mic: 'missing' }]);
    expect(primaryTip(v, 'Am')).toContain('not covering');
  });

  it('tells sound-only attempts to reposition the camera', () => {
    expect(primaryTip(verdict('sound-only'), 'Am').toLowerCase()).toContain('reposition');
  });
});

describe('positiveNote', () => {
  it('praises a clean chord', () => {
    expect(positiveNote(verdict('both'), 'C')).toContain('nailed it');
  });
  it('praises a correct shape even if the sound was off', () => {
    expect(positiveNote(verdict('shape-only'), 'C')).toContain('shape is correct');
  });
  it('counts strings already in place', () => {
    const v = verdict('none', [
      { string: 2, label: 'D', cam: 'ok', mic: 'correct' },
      { string: 3, label: 'G', cam: 'wrong', mic: 'wrong' },
    ]);
    expect(positiveNote(v, 'Am')).toContain('1 string');
  });
  it('returns null when nothing is in place', () => {
    const v = verdict('none', [{ string: 3, label: 'G', cam: 'wrong', mic: 'wrong' }]);
    expect(positiveNote(v, 'Am')).toBeNull();
  });
});

describe('buildAttemptAdvice', () => {
  it('assembles a full mastered summary', () => {
    const a = buildAttemptAdvice(verdict('both'), 'Am');
    expect(a.stars).toBe(5);
    expect(a.mastered).toBe(true);
    expect(a.headline).toContain('Verified');
    expect(a.tip).toBeNull();
    expect(a.positive).toContain('Am');
  });

  it('assembles a corrective summary with a tip', () => {
    const v = verdict('shape-only', [{ string: 4, label: 'B', cam: 'ok', mic: 'muted' }]);
    const a = buildAttemptAdvice(v, 'Am');
    expect(a.mastered).toBe(false);
    expect(a.stars).toBe(3);
    expect(a.tip).toContain('B');
    expect(a.positive).toContain('shape is correct');
  });
});

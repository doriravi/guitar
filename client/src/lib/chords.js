// Chord definitions — fretted notes only (open strings and muted strings excluded)
// Strings: 0=E(low), 1=A, 2=D, 3=G, 4=B, 5=e(high)
// tab: 6-char EADGBe string — 'x'=muted, '0'=open, digit=fret

export const CHORDS = [

  // ─── Open major ───────────────────────────────────────────────
  { name: 'C',      type: 'Major',          tab: 'x32010', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:4,fret:1 }] },
  { name: 'A',      type: 'Major',          tab: 'x02220', notes: [{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:2 }] },
  { name: 'G',      type: 'Major',          tab: '320003', notes: [{ string:0,fret:3 },{ string:1,fret:2 },{ string:5,fret:3 }] },
  { name: 'E',      type: 'Major',          tab: '022100', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:3,fret:1 }] },
  { name: 'D',      type: 'Major',          tab: 'xx0232', notes: [{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  // F without barre (high strings only)
  { name: 'F',      type: 'Major (easy)',   tab: 'xx3211', notes: [{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:1 }] },

  // ─── Open minor ───────────────────────────────────────────────
  { name: 'Am',     type: 'Minor',          tab: 'x02210', notes: [{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:1 }] },
  { name: 'Em',     type: 'Minor',          tab: '022000', notes: [{ string:1,fret:2 },{ string:2,fret:2 }] },
  { name: 'Dm',     type: 'Minor',          tab: 'xx0231', notes: [{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:1 }] },

  // ─── Dominant 7th ─────────────────────────────────────────────
  { name: 'G7',     type: 'Dom 7',          tab: '320001', notes: [{ string:0,fret:3 },{ string:1,fret:2 },{ string:5,fret:1 }] },
  { name: 'C7',     type: 'Dom 7',          tab: 'x32310', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:3,fret:3 },{ string:4,fret:1 }] },
  { name: 'E7',     type: 'Dom 7',          tab: '020100', notes: [{ string:1,fret:2 },{ string:3,fret:1 }] },
  { name: 'A7',     type: 'Dom 7',          tab: 'x02020', notes: [{ string:2,fret:2 },{ string:4,fret:2 }] },
  { name: 'D7',     type: 'Dom 7',          tab: 'xx0212', notes: [{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:2 }] },
  { name: 'B7',     type: 'Dom 7',          tab: 'x21202', notes: [{ string:1,fret:2 },{ string:2,fret:1 },{ string:3,fret:2 },{ string:5,fret:2 }] },

  // ─── Minor 7th ────────────────────────────────────────────────
  { name: 'Am7',    type: 'Minor 7',        tab: 'x02010', notes: [{ string:2,fret:2 },{ string:4,fret:1 }] },
  { name: 'Em7',    type: 'Minor 7',        tab: '022030', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:4,fret:3 }] },
  { name: 'Dm7',    type: 'Minor 7',        tab: 'xx0211', notes: [{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'Bm7',    type: 'Minor 7',        tab: 'x24232', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  { name: 'F#m7',   type: 'Minor 7 (barre)',tab: '242222', notes: [{ string:0,fret:2 },{ string:1,fret:4 },{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'Gm7',    type: 'Minor 7 (barre)',tab: '353333', notes: [{ string:0,fret:3 },{ string:1,fret:5 },{ string:2,fret:3 },{ string:3,fret:3 },{ string:4,fret:3 },{ string:5,fret:3 }] },
  { name: 'Cm7',    type: 'Minor 7 (barre)',tab: 'x35343', notes: [{ string:1,fret:3 },{ string:2,fret:5 },{ string:3,fret:3 },{ string:4,fret:4 },{ string:5,fret:3 }] },

  // ─── Major 7th ────────────────────────────────────────────────
  { name: 'Cmaj7',  type: 'Maj 7',          tab: 'x32000', notes: [{ string:1,fret:3 },{ string:2,fret:2 }] },
  { name: 'Gmaj7',  type: 'Maj 7',          tab: '320002', notes: [{ string:0,fret:3 },{ string:1,fret:2 },{ string:5,fret:2 }] },
  { name: 'Dmaj7',  type: 'Maj 7',          tab: 'xx0222', notes: [{ string:3,fret:2 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'Amaj7',  type: 'Maj 7',          tab: 'x02120', notes: [{ string:2,fret:2 },{ string:3,fret:1 },{ string:4,fret:2 }] },
  { name: 'Emaj7',  type: 'Maj 7',          tab: '021100', notes: [{ string:1,fret:2 },{ string:2,fret:1 },{ string:3,fret:1 }] },
  { name: 'Fmaj7',  type: 'Maj 7',          tab: 'xx3210', notes: [{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:1 }] },

  // ─── 6th chords ───────────────────────────────────────────────
  { name: 'A6',     type: '6th',            tab: 'x02222', notes: [{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'D6',     type: '6th',            tab: 'xx0202', notes: [{ string:3,fret:2 },{ string:5,fret:2 }] },
  { name: 'E6',     type: '6th',            tab: '022120', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:3,fret:1 },{ string:4,fret:2 }] },
  { name: 'Am6',    type: 'Minor 6',        tab: 'x02212', notes: [{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:2 }] },
  { name: 'Em6',    type: '6th',            tab: '022020', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:4,fret:2 }] },
  { name: 'G6',     type: '6th',            tab: '320000', notes: [{ string:0,fret:3 },{ string:1,fret:2 }] },
  { name: 'C6',     type: '6th',            tab: 'x32210', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:1 }] },

  // ─── 9th chords ───────────────────────────────────────────────
  { name: 'E9',     type: '9th',            tab: '020102', notes: [{ string:1,fret:2 },{ string:3,fret:1 },{ string:5,fret:2 }] },
  { name: 'G9',     type: '9th',            tab: '3x0201', notes: [{ string:0,fret:3 },{ string:3,fret:2 },{ string:5,fret:1 }] },
  { name: 'Aadd9',  type: 'Add9',           tab: 'x02420', notes: [{ string:2,fret:2 },{ string:3,fret:4 },{ string:4,fret:2 }] },
  { name: 'Cadd9',  type: 'Add9',           tab: 'x32033', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:4,fret:3 },{ string:5,fret:3 }] },
  { name: 'Gadd9',  type: 'Add9',           tab: '320033', notes: [{ string:0,fret:3 },{ string:1,fret:2 },{ string:4,fret:3 },{ string:5,fret:3 }] },
  { name: 'Eadd9',  type: 'Add9',           tab: '022102', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:3,fret:1 },{ string:5,fret:2 }] },
  { name: 'Dadd9',  type: 'Add9',           tab: 'xx4230', notes: [{ string:2,fret:4 },{ string:3,fret:2 },{ string:4,fret:3 }] },
  { name: 'C9',     type: '9th',            tab: 'x32330', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:3,fret:3 },{ string:4,fret:3 }] },
  { name: 'Em9',    type: '9th',            tab: '022032', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:4,fret:3 },{ string:5,fret:2 }] },

  // ─── Augmented ────────────────────────────────────────────────
  { name: 'Eaug',   type: 'Augmented',      tab: '032110', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:3,fret:1 },{ string:4,fret:1 }] },
  { name: 'Daug',   type: 'Augmented',      tab: 'xx0332', notes: [{ string:3,fret:3 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  { name: 'Aaug',   type: 'Augmented',      tab: 'x03221', notes: [{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:2 },{ string:5,fret:1 }] },

  // ─── Diminished ───────────────────────────────────────────────
  { name: 'Bdim',   type: 'Diminished',     tab: 'x2343x', notes: [{ string:1,fret:2 },{ string:2,fret:3 },{ string:3,fret:4 },{ string:4,fret:3 }] },
  { name: 'Adim',   type: 'Diminished',     tab: 'x0121x', notes: [{ string:2,fret:1 },{ string:3,fret:2 },{ string:4,fret:1 }] },
  { name: 'Ddim',   type: 'Diminished',     tab: 'xx0131', notes: [{ string:3,fret:1 },{ string:4,fret:3 },{ string:5,fret:1 }] },
  { name: 'Edim',   type: 'Diminished',     tab: '012020', notes: [{ string:1,fret:1 },{ string:2,fret:2 },{ string:4,fret:2 }] },

  // ─── Half-diminished (m7b5) ───────────────────────────────────
  { name: 'Bm7b5',  type: 'Half-dim',       tab: 'x2323x', notes: [{ string:1,fret:2 },{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:3 }] },
  { name: 'Em7b5',  type: 'Half-dim',       tab: '010030', notes: [{ string:1,fret:1 },{ string:4,fret:3 }] },

  // ─── Suspended ────────────────────────────────────────────────
  { name: 'Asus2',  type: 'Sus2',           tab: 'x02200', notes: [{ string:2,fret:2 },{ string:3,fret:2 }] },
  { name: 'Asus4',  type: 'Sus4',           tab: 'x02230', notes: [{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:3 }] },
  { name: 'Dsus2',  type: 'Sus2',           tab: 'xx0230', notes: [{ string:3,fret:2 },{ string:4,fret:3 }] },
  { name: 'Dsus4',  type: 'Sus4',           tab: 'xx0233', notes: [{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:3 }] },
  { name: 'Esus4',  type: 'Sus4',           tab: '022200', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:3,fret:2 }] },
  { name: 'Gsus4',  type: 'Sus4',           tab: '330013', notes: [{ string:0,fret:3 },{ string:1,fret:3 },{ string:4,fret:1 },{ string:5,fret:3 }] },
  { name: 'Csus2',  type: 'Sus2',           tab: 'x30010', notes: [{ string:1,fret:3 },{ string:4,fret:1 }] },
  { name: 'Gsus2',  type: 'Sus2',           tab: '3x0233', notes: [{ string:0,fret:3 },{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:3 }] },
  { name: 'Fsus2',  type: 'Sus2',           tab: 'x33011', notes: [{ string:1,fret:3 },{ string:2,fret:3 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'Bsus4',  type: 'Sus4',           tab: 'x24452', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:4 },{ string:4,fret:5 },{ string:5,fret:2 }] },

  // ─── 7sus4 ────────────────────────────────────────────────────
  { name: 'G7sus4', type: '7sus4',          tab: '330011', notes: [{ string:0,fret:3 },{ string:1,fret:3 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'D7sus4', type: '7sus4',          tab: 'xx0213', notes: [{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:3 }] },
  { name: 'A7sus4', type: '7sus4',          tab: 'x02030', notes: [{ string:2,fret:2 },{ string:4,fret:3 }] },

  // ─── Barre chords ─────────────────────────────────────────────
  { name: 'F',      type: 'Major (barre)',   tab: '133211', notes: [{ string:0,fret:1 },{ string:1,fret:3 },{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'Fm',     type: 'Minor (barre)',   tab: '133111', notes: [{ string:0,fret:1 },{ string:1,fret:3 },{ string:2,fret:3 },{ string:3,fret:1 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'F7',     type: 'Dom 7 (barre)',   tab: '131211', notes: [{ string:0,fret:1 },{ string:1,fret:3 },{ string:2,fret:1 },{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'B',      type: 'Major (barre)',   tab: 'x24442', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:4 },{ string:4,fret:4 },{ string:5,fret:2 }] },
  { name: 'Bm',     type: 'Minor (barre)',   tab: 'x24432', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:4 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  { name: 'Bb',     type: 'Major (barre)',   tab: 'x13331', notes: [{ string:1,fret:1 },{ string:2,fret:3 },{ string:3,fret:3 },{ string:4,fret:3 },{ string:5,fret:1 }] },
  { name: 'F#m',    type: 'Minor (barre)',   tab: '244222', notes: [{ string:0,fret:2 },{ string:1,fret:4 },{ string:2,fret:4 },{ string:3,fret:2 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'Gm',     type: 'Minor (barre)',   tab: '355333', notes: [{ string:0,fret:3 },{ string:1,fret:5 },{ string:2,fret:5 },{ string:3,fret:3 },{ string:4,fret:3 },{ string:5,fret:3 }] },
  { name: 'Cm',     type: 'Minor (barre)',   tab: 'x35543', notes: [{ string:1,fret:3 },{ string:2,fret:5 },{ string:3,fret:5 },{ string:4,fret:4 },{ string:5,fret:3 }] },
  { name: 'Ab',     type: 'Major (barre)',   tab: '466544', notes: [{ string:0,fret:4 },{ string:1,fret:6 },{ string:2,fret:6 },{ string:3,fret:5 },{ string:4,fret:4 },{ string:5,fret:4 }] },
  { name: 'Eb',     type: 'Major (barre)',   tab: 'x68886', notes: [{ string:1,fret:6 },{ string:2,fret:8 },{ string:3,fret:8 },{ string:4,fret:8 },{ string:5,fret:6 }] },

  // ─── Slash / bass note chords ─────────────────────────────────
  { name: 'G/B',    type: 'Slash',           tab: 'x20003', notes: [{ string:1,fret:2 },{ string:5,fret:3 }] },
  { name: 'C/G',    type: 'Slash',           tab: '332010', notes: [{ string:0,fret:3 },{ string:1,fret:3 },{ string:2,fret:2 },{ string:4,fret:1 }] },
  { name: 'D/F#',   type: 'Slash',           tab: '200232', notes: [{ string:0,fret:2 },{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  { name: 'Am/G',   type: 'Slash',           tab: '302210', notes: [{ string:0,fret:3 },{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:1 }] },
  { name: 'D/A',    type: 'Slash',           tab: 'x00232', notes: [{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  { name: 'F/C',    type: 'Slash',           tab: 'x33211', notes: [{ string:1,fret:3 },{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'Am/E',   type: 'Slash',           tab: '002210', notes: [{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:1 }] },
  { name: 'E/B',    type: 'Slash',           tab: 'x22100', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:3,fret:1 }] },

  // ─── Power chords ─────────────────────────────────────────────
  { name: 'E5',     type: 'Power',           tab: '022xxx', notes: [{ string:1,fret:2 },{ string:2,fret:2 }] },
  { name: 'A5',     type: 'Power',           tab: 'x022xx', notes: [{ string:2,fret:2 },{ string:3,fret:2 }] },
  { name: 'D5',     type: 'Power',           tab: 'xx022x', notes: [{ string:3,fret:2 },{ string:4,fret:2 }] },
  { name: 'G5',     type: 'Power',           tab: '355xxx', notes: [{ string:0,fret:3 },{ string:1,fret:5 },{ string:2,fret:5 }] },
  { name: 'C5',     type: 'Power',           tab: 'x355xx', notes: [{ string:1,fret:3 },{ string:2,fret:5 },{ string:3,fret:5 }] },
  { name: 'B5',     type: 'Power',           tab: 'x244xx', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:4 }] },
  { name: 'F5',     type: 'Power',           tab: '133xxx', notes: [{ string:0,fret:1 },{ string:1,fret:3 },{ string:2,fret:3 }] },
  { name: 'F#5',    type: 'Power',           tab: '244xxx', notes: [{ string:0,fret:2 },{ string:1,fret:4 },{ string:2,fret:4 }] },
  { name: 'Bb5',    type: 'Power',           tab: 'x133xx', notes: [{ string:1,fret:1 },{ string:2,fret:3 },{ string:3,fret:3 }] },
  { name: 'Ab5',    type: 'Power',           tab: '466xxx', notes: [{ string:0,fret:4 },{ string:1,fret:6 },{ string:2,fret:6 }] },

  // ─── More open / easy major ───────────────────────────────────
  { name: 'B',      type: 'Major (open)',    tab: 'x24442', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:4 },{ string:4,fret:4 },{ string:5,fret:2 }] },

  // ─── More barre major ─────────────────────────────────────────
  { name: 'C',      type: 'Major (barre)',   tab: 'x35553', notes: [{ string:1,fret:3 },{ string:2,fret:5 },{ string:3,fret:5 },{ string:4,fret:5 },{ string:5,fret:3 }] },
  { name: 'D',      type: 'Major (barre)',   tab: 'x57775', notes: [{ string:1,fret:5 },{ string:2,fret:7 },{ string:3,fret:7 },{ string:4,fret:7 },{ string:5,fret:5 }] },
  { name: 'F#',     type: 'Major (barre)',   tab: '244322', notes: [{ string:0,fret:2 },{ string:1,fret:4 },{ string:2,fret:4 },{ string:3,fret:3 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'Db',     type: 'Major (barre)',   tab: 'x46664', notes: [{ string:1,fret:4 },{ string:2,fret:6 },{ string:3,fret:6 },{ string:4,fret:6 },{ string:5,fret:4 }] },
  { name: 'Gb',     type: 'Major (barre)',   tab: '244322', notes: [{ string:0,fret:2 },{ string:1,fret:4 },{ string:2,fret:4 },{ string:3,fret:3 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'G#',     type: 'Major (barre)',   tab: '466544', notes: [{ string:0,fret:4 },{ string:1,fret:6 },{ string:2,fret:6 },{ string:3,fret:5 },{ string:4,fret:4 },{ string:5,fret:4 }] },

  // ─── More barre minor ─────────────────────────────────────────
  { name: 'Bbm',    type: 'Minor (barre)',   tab: 'x13321', notes: [{ string:1,fret:1 },{ string:2,fret:3 },{ string:3,fret:3 },{ string:4,fret:2 },{ string:5,fret:1 }] },
  { name: 'Ebm',    type: 'Minor (barre)',   tab: 'x68876', notes: [{ string:1,fret:6 },{ string:2,fret:8 },{ string:3,fret:8 },{ string:4,fret:7 },{ string:5,fret:6 }] },
  { name: 'Abm',    type: 'Minor (barre)',   tab: '466444', notes: [{ string:0,fret:4 },{ string:1,fret:6 },{ string:2,fret:6 },{ string:3,fret:4 },{ string:4,fret:4 },{ string:5,fret:4 }] },
  { name: 'C#m',    type: 'Minor (barre)',   tab: 'x46654', notes: [{ string:1,fret:4 },{ string:2,fret:6 },{ string:3,fret:6 },{ string:4,fret:5 },{ string:5,fret:4 }] },
  { name: 'Dbm',    type: 'Minor (barre)',   tab: 'x46654', notes: [{ string:1,fret:4 },{ string:2,fret:6 },{ string:3,fret:6 },{ string:4,fret:5 },{ string:5,fret:4 }] },

  // ─── More dominant 7th ────────────────────────────────────────
  { name: 'F7',     type: 'Dom 7',           tab: '131211', notes: [{ string:0,fret:1 },{ string:1,fret:3 },{ string:2,fret:1 },{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'Bb7',    type: 'Dom 7 (barre)',   tab: 'x13131', notes: [{ string:1,fret:1 },{ string:2,fret:3 },{ string:3,fret:1 },{ string:4,fret:3 },{ string:5,fret:1 }] },
  { name: 'Eb7',    type: 'Dom 7 (barre)',   tab: 'x68686', notes: [{ string:1,fret:6 },{ string:2,fret:8 },{ string:3,fret:6 },{ string:4,fret:8 },{ string:5,fret:6 }] },
  { name: 'Ab7',    type: 'Dom 7 (barre)',   tab: '464544', notes: [{ string:0,fret:4 },{ string:1,fret:6 },{ string:2,fret:4 },{ string:3,fret:5 },{ string:4,fret:4 },{ string:5,fret:4 }] },
  { name: 'F#7',    type: 'Dom 7 (barre)',   tab: '242322', notes: [{ string:0,fret:2 },{ string:1,fret:4 },{ string:2,fret:2 },{ string:3,fret:3 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'C#7',    type: 'Dom 7 (barre)',   tab: 'x43444', notes: [{ string:1,fret:4 },{ string:2,fret:3 },{ string:3,fret:4 },{ string:4,fret:4 },{ string:5,fret:4 }] },

  // ─── More major 7th ───────────────────────────────────────────
  { name: 'Bbmaj7', type: 'Maj 7 (barre)',   tab: 'x13231', notes: [{ string:1,fret:1 },{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:1 }] },
  { name: 'Bmaj7',  type: 'Maj 7',           tab: 'x24342', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:3 },{ string:4,fret:4 },{ string:5,fret:2 }] },
  { name: 'Abmaj7', type: 'Maj 7 (barre)',   tab: '465544', notes: [{ string:0,fret:4 },{ string:1,fret:6 },{ string:2,fret:5 },{ string:3,fret:5 },{ string:4,fret:4 },{ string:5,fret:4 }] },
  { name: 'Ebmaj7', type: 'Maj 7 (barre)',   tab: 'x67786', notes: [{ string:1,fret:6 },{ string:2,fret:7 },{ string:3,fret:7 },{ string:4,fret:8 },{ string:5,fret:6 }] },
  { name: 'C#maj7', type: 'Maj 7 (barre)',   tab: 'x46564', notes: [{ string:1,fret:4 },{ string:2,fret:6 },{ string:3,fret:5 },{ string:4,fret:6 },{ string:5,fret:4 }] },

  // ─── More minor 7th ───────────────────────────────────────────
  { name: 'Bbm7',   type: 'Minor 7 (barre)', tab: 'x13121', notes: [{ string:1,fret:1 },{ string:2,fret:3 },{ string:3,fret:1 },{ string:4,fret:2 },{ string:5,fret:1 }] },
  { name: 'Ebm7',   type: 'Minor 7 (barre)', tab: 'x68676', notes: [{ string:1,fret:6 },{ string:2,fret:8 },{ string:3,fret:6 },{ string:4,fret:7 },{ string:5,fret:6 }] },
  { name: 'Abm7',   type: 'Minor 7 (barre)', tab: '464444', notes: [{ string:0,fret:4 },{ string:1,fret:6 },{ string:2,fret:4 },{ string:3,fret:4 },{ string:4,fret:4 },{ string:5,fret:4 }] },
  { name: 'C#m7',   type: 'Minor 7 (barre)', tab: 'x46454', notes: [{ string:1,fret:4 },{ string:2,fret:6 },{ string:3,fret:4 },{ string:4,fret:5 },{ string:5,fret:4 }] },
  { name: 'F#m7',   type: 'Minor 7',         tab: '020200', notes: [{ string:1,fret:2 },{ string:3,fret:2 }] },

  // ─── Diminished 7th ───────────────────────────────────────────
  { name: 'Bdim7',  type: 'Dim 7',           tab: 'x2343x', notes: [{ string:1,fret:2 },{ string:2,fret:3 },{ string:3,fret:4 },{ string:4,fret:3 }] },
  { name: 'Edim7',  type: 'Dim 7',           tab: '012020', notes: [{ string:1,fret:1 },{ string:2,fret:2 },{ string:4,fret:2 }] },
  { name: 'Adim7',  type: 'Dim 7',           tab: 'x01212', notes: [{ string:2,fret:1 },{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:2 }] },
  { name: 'Ddim7',  type: 'Dim 7',           tab: 'xx0131', notes: [{ string:3,fret:1 },{ string:4,fret:3 },{ string:5,fret:1 }] },
  { name: 'Gdim7',  type: 'Dim 7',           tab: '3x2323', notes: [{ string:0,fret:3 },{ string:2,fret:2 },{ string:3,fret:3 },{ string:4,fret:2 },{ string:5,fret:3 }] },
  { name: 'Cdim7',  type: 'Dim 7',           tab: 'x3424x', notes: [{ string:1,fret:3 },{ string:2,fret:4 },{ string:3,fret:2 },{ string:4,fret:4 }] },

  // ─── More half-diminished (m7b5) ──────────────────────────────
  { name: 'Am7b5',  type: 'Half-dim',        tab: 'x01213', notes: [{ string:2,fret:1 },{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:3 }] },
  { name: 'Dm7b5',  type: 'Half-dim',        tab: 'xx0111', notes: [{ string:3,fret:1 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'Gm7b5',  type: 'Half-dim',        tab: '3x3333', notes: [{ string:0,fret:3 },{ string:2,fret:3 },{ string:3,fret:3 },{ string:4,fret:3 },{ string:5,fret:3 }] },
  { name: 'Cm7b5',  type: 'Half-dim',        tab: 'x3434x', notes: [{ string:1,fret:3 },{ string:2,fret:4 },{ string:3,fret:3 },{ string:4,fret:4 }] },
  { name: 'F#m7b5', type: 'Half-dim',        tab: '2x221x', notes: [{ string:0,fret:2 },{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:1 }] },

  // ─── More augmented ───────────────────────────────────────────
  { name: 'Caug',   type: 'Augmented',       tab: 'x3221x', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:1 }] },
  { name: 'Gaug',   type: 'Augmented',       tab: '321003', notes: [{ string:0,fret:3 },{ string:1,fret:2 },{ string:2,fret:1 },{ string:5,fret:3 }] },
  { name: 'Faug',   type: 'Augmented',       tab: 'xx3221', notes: [{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:2 },{ string:5,fret:1 }] },
  { name: 'Baug',   type: 'Augmented',       tab: 'x2110x', notes: [{ string:1,fret:2 },{ string:2,fret:1 },{ string:3,fret:1 }] },
  { name: 'Bbaug',  type: 'Augmented',       tab: 'x1000x', notes: [{ string:1,fret:1 },{ string:2,fret:0 },{ string:3,fret:0 }] },

  // ─── More diminished (triad) ──────────────────────────────────
  { name: 'Cdim',   type: 'Diminished',      tab: 'x3424x', notes: [{ string:1,fret:3 },{ string:2,fret:4 },{ string:3,fret:2 },{ string:4,fret:4 }] },
  { name: 'Fdim',   type: 'Diminished',      tab: 'xx3101', notes: [{ string:2,fret:3 },{ string:3,fret:1 },{ string:5,fret:1 }] },
  { name: 'Gdim',   type: 'Diminished',      tab: 'xx5353', notes: [{ string:2,fret:5 },{ string:3,fret:3 },{ string:4,fret:5 },{ string:5,fret:3 }] },
  { name: 'C#dim',  type: 'Diminished',      tab: 'x4535x', notes: [{ string:1,fret:4 },{ string:2,fret:5 },{ string:3,fret:3 },{ string:4,fret:5 }] },
  { name: 'F#dim',  type: 'Diminished',      tab: '1x121x', notes: [{ string:0,fret:1 },{ string:2,fret:1 },{ string:3,fret:2 },{ string:4,fret:1 }] },

  // ─── Major 9th ────────────────────────────────────────────────
  { name: 'Cmaj9',  type: 'Maj 9',           tab: 'x32030', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:4,fret:3 }] },
  { name: 'Gmaj9',  type: 'Maj 9',           tab: '3x2432', notes: [{ string:0,fret:3 },{ string:2,fret:2 },{ string:3,fret:4 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  { name: 'Dmaj9',  type: 'Maj 9',           tab: 'xx0424', notes: [{ string:3,fret:4 },{ string:4,fret:2 },{ string:5,fret:4 }] },
  { name: 'Amaj9',  type: 'Maj 9',           tab: 'x02122', notes: [{ string:2,fret:2 },{ string:3,fret:1 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'Emaj9',  type: 'Maj 9',           tab: '024100', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:1 }] },
  { name: 'Fmaj9',  type: 'Maj 9',           tab: 'xx3210', notes: [{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:1 }] },

  // ─── Minor 9th ────────────────────────────────────────────────
  { name: 'Am9',    type: 'Minor 9',         tab: 'x02413', notes: [{ string:2,fret:2 },{ string:3,fret:4 },{ string:4,fret:1 },{ string:5,fret:3 }] },
  { name: 'Dm9',    type: 'Minor 9',         tab: 'xx0213', notes: [{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:3 }] },
  { name: 'Em9',    type: 'Minor 9',         tab: '020032', notes: [{ string:1,fret:2 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  { name: 'Bm9',    type: 'Minor 9',         tab: 'x20232', notes: [{ string:1,fret:2 },{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  { name: 'Cm9',    type: 'Minor 9',         tab: 'x35343', notes: [{ string:1,fret:3 },{ string:2,fret:5 },{ string:3,fret:3 },{ string:4,fret:4 },{ string:5,fret:3 }] },

  // ─── Dominant 9th ─────────────────────────────────────────────
  { name: 'A9',     type: 'Dom 9',           tab: 'x02423', notes: [{ string:2,fret:2 },{ string:3,fret:4 },{ string:4,fret:2 },{ string:5,fret:3 }] },
  { name: 'D9',     type: 'Dom 9',           tab: 'xx0212', notes: [{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:2 }] },
  { name: 'B9',     type: 'Dom 9',           tab: 'x21222', notes: [{ string:1,fret:2 },{ string:2,fret:1 },{ string:3,fret:2 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'F9',     type: 'Dom 9',           tab: '131013', notes: [{ string:0,fret:1 },{ string:1,fret:3 },{ string:2,fret:1 },{ string:4,fret:1 },{ string:5,fret:3 }] },
  { name: 'Bb9',    type: 'Dom 9',           tab: 'x13131', notes: [{ string:1,fret:1 },{ string:2,fret:3 },{ string:3,fret:1 },{ string:4,fret:3 },{ string:5,fret:1 }] },

  // ─── 7#9 (Hendrix chord) ──────────────────────────────────────
  { name: 'E7#9',   type: '7#9',             tab: '020130', notes: [{ string:1,fret:2 },{ string:3,fret:1 },{ string:4,fret:3 }] },
  { name: 'A7#9',   type: '7#9',             tab: 'x02023', notes: [{ string:2,fret:2 },{ string:4,fret:2 },{ string:5,fret:3 }] },
  { name: 'D7#9',   type: '7#9',             tab: 'xx0213', notes: [{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:3 }] },

  // ─── 7b9 ──────────────────────────────────────────────────────
  { name: 'E7b9',   type: '7b9',             tab: '020101', notes: [{ string:1,fret:2 },{ string:3,fret:1 },{ string:5,fret:1 }] },
  { name: 'A7b9',   type: '7b9',             tab: 'x02021', notes: [{ string:2,fret:2 },{ string:4,fret:2 },{ string:5,fret:1 }] },
  { name: 'B7b9',   type: '7b9',             tab: 'x21201', notes: [{ string:1,fret:2 },{ string:2,fret:1 },{ string:3,fret:2 },{ string:5,fret:1 }] },

  // ─── 13th chords ──────────────────────────────────────────────
  { name: 'A13',    type: '13th',            tab: 'x02426', notes: [{ string:2,fret:2 },{ string:3,fret:4 },{ string:4,fret:2 },{ string:5,fret:6 }] },
  { name: 'E13',    type: '13th',            tab: '020102', notes: [{ string:1,fret:2 },{ string:3,fret:1 },{ string:5,fret:2 }] },
  { name: 'G13',    type: '13th',            tab: '3x3455', notes: [{ string:0,fret:3 },{ string:2,fret:3 },{ string:3,fret:4 },{ string:4,fret:5 },{ string:5,fret:5 }] },
  { name: 'D13',    type: '13th',            tab: 'xx0214', notes: [{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:4 }] },

  // ─── More sus2 ────────────────────────────────────────────────
  { name: 'Esus2',  type: 'Sus2',            tab: '022200', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:3,fret:2 }] },
  { name: 'Bsus2',  type: 'Sus2',            tab: 'x24422', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:4 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'F#sus2', type: 'Sus2',            tab: '244422', notes: [{ string:0,fret:2 },{ string:1,fret:4 },{ string:2,fret:4 },{ string:3,fret:4 },{ string:4,fret:2 },{ string:5,fret:2 }] },

  // ─── More sus4 ────────────────────────────────────────────────
  { name: 'Csus4',  type: 'Sus4',            tab: 'x33011', notes: [{ string:1,fret:3 },{ string:2,fret:3 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'Fsus4',  type: 'Sus4',            tab: 'xx3311', notes: [{ string:2,fret:3 },{ string:3,fret:3 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'Bsus4',  type: 'Sus4',            tab: 'x24452', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:4 },{ string:4,fret:5 },{ string:5,fret:2 }] },

  // ─── More 7sus4 ───────────────────────────────────────────────
  { name: 'E7sus4', type: '7sus4',           tab: '022030', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:4,fret:3 }] },
  { name: 'B7sus4', type: '7sus4',           tab: 'x24252', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:2 },{ string:4,fret:5 },{ string:5,fret:2 }] },
  { name: 'C7sus4', type: '7sus4',           tab: 'x33311', notes: [{ string:1,fret:3 },{ string:2,fret:3 },{ string:3,fret:3 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'F7sus4', type: '7sus4',           tab: '131311', notes: [{ string:0,fret:1 },{ string:1,fret:3 },{ string:2,fret:1 },{ string:3,fret:3 },{ string:4,fret:1 },{ string:5,fret:1 }] },

  // ─── More slash chords ────────────────────────────────────────
  { name: 'E/G#',   type: 'Slash',           tab: '422100', notes: [{ string:0,fret:4 },{ string:1,fret:2 },{ string:2,fret:2 },{ string:3,fret:1 }] },
  { name: 'C/E',    type: 'Slash',           tab: '032010', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:4,fret:1 }] },
  { name: 'G/D',    type: 'Slash',           tab: 'xx0003', notes: [{ string:5,fret:3 }] },
  { name: 'A/C#',   type: 'Slash',           tab: 'x42220', notes: [{ string:1,fret:4 },{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:2 }] },
  { name: 'F/A',    type: 'Slash',           tab: 'x03211', notes: [{ string:2,fret:3 },{ string:3,fret:2 },{ string:4,fret:1 },{ string:5,fret:1 }] },
  { name: 'Bb/D',   type: 'Slash',           tab: 'xx0331', notes: [{ string:3,fret:3 },{ string:4,fret:3 },{ string:5,fret:1 }] },
  { name: 'C/B',    type: 'Slash',           tab: 'x22010', notes: [{ string:1,fret:2 },{ string:2,fret:2 },{ string:4,fret:1 }] },
  { name: 'Dm/F',   type: 'Slash',           tab: '100231', notes: [{ string:0,fret:1 },{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:1 }] },
  { name: 'G/F#',   type: 'Slash',           tab: '2x0003', notes: [{ string:0,fret:2 },{ string:5,fret:3 }] },
  { name: 'Am/C',   type: 'Slash',           tab: 'x32210', notes: [{ string:1,fret:3 },{ string:2,fret:2 },{ string:3,fret:2 },{ string:4,fret:1 }] },

  // ─── Minor 6th ────────────────────────────────────────────────
  { name: 'Dm6',    type: 'Minor 6',         tab: 'xx0201', notes: [{ string:3,fret:2 },{ string:5,fret:1 }] },
  { name: 'Gm6',    type: 'Minor 6',         tab: '3x0333', notes: [{ string:0,fret:3 },{ string:2,fret:0 },{ string:3,fret:3 },{ string:4,fret:3 },{ string:5,fret:3 }] },
  { name: 'Bm6',    type: 'Minor 6',         tab: 'x24232', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:2 }] },
  { name: 'Cm6',    type: 'Minor 6',         tab: 'x35353', notes: [{ string:1,fret:3 },{ string:2,fret:5 },{ string:3,fret:3 },{ string:4,fret:5 },{ string:5,fret:3 }] },

  // ─── Add9 (more) ──────────────────────────────────────────────
  { name: 'Fadd9',  type: 'Add9',            tab: 'xx3013', notes: [{ string:2,fret:3 },{ string:4,fret:1 },{ string:5,fret:3 }] },
  { name: 'Badd9',  type: 'Add9',            tab: 'x24422', notes: [{ string:1,fret:2 },{ string:2,fret:4 },{ string:3,fret:4 },{ string:4,fret:2 },{ string:5,fret:2 }] },
  { name: 'Amadd9', type: 'Add9',            tab: 'x02413', notes: [{ string:2,fret:2 },{ string:3,fret:4 },{ string:4,fret:1 },{ string:5,fret:3 }] },
  { name: 'Dmadd9', type: 'Add9',            tab: 'xx0231', notes: [{ string:3,fret:2 },{ string:4,fret:3 },{ string:5,fret:1 }] },
];

// ─── Easier-version substitutions ───────────────────────────────
// When a chord is too hard for the user's hand, suggest a lower-difficulty
// voicing that preserves the same harmony (same root + same chord quality).

// Enharmonic root spellings map to one canonical pitch class so e.g. Bb and A#
// are treated as the same root.
const ENHARMONIC = {
  'A#': 'Bb', 'Db': 'C#', 'D#': 'Eb', 'Gb': 'F#', 'G#': 'Ab',
};

/**
 * Split a chord name into its root pitch class and quality suffix.
 * e.g. 'F#m7' → { root: 'F#', suffix: 'm7' }, 'A/C#' → { root: 'A', suffix: '/C#' }
 * Returns null if the name doesn't start with a note letter.
 */
export function parseChordName(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  if (!m) return null;
  const root = ENHARMONIC[m[1]] || m[1];
  return { root, suffix: m[2] };
}

// How close a candidate quality is to the target quality as a musical
// substitute (0 = identical, higher = looser). Same root is always required;
// this orders the "cheat" alternatives so the closest-sounding one ranks first.
//
// Families collapse a quality to its harmonic core: a plain triad substitutes
// well for its extended/added forms (e.g. play 'F' instead of barre 'Fmaj7'),
// and a 7th substitutes for richer dominant/extended colours.
function qualityFamily(suffix) {
  if (suffix.startsWith('/')) return 'slash';
  if (/^m(?!aj)/.test(suffix)) {
    // minor family — check half-diminished first so 'm7b5' isn't read as 'm7'
    if (/^m7b5|^mb5/.test(suffix)) return 'dim';
    if (suffix === 'm') return 'min';
    return 'min-ext';
  }
  if (suffix.startsWith('dim')) return 'dim';
  if (suffix.startsWith('aug')) return 'aug';
  if (suffix.startsWith('sus')) return 'sus';
  if (suffix === '') return 'maj';
  if (/^(maj7|maj9|6|add9|9|7|13|11|5)/.test(suffix)) return 'maj-ext';
  return 'maj-ext';
}

// Preferred fallback family for each family — what a too-hard chord can be
// simplified TO while staying musically acceptable.
const FAMILY_RANK = {
  'maj':     ['maj', 'maj-ext'],
  'maj-ext': ['maj-ext', 'maj'],
  'min':     ['min', 'min-ext'],
  'min-ext': ['min-ext', 'min'],
  'dim':     ['dim', 'min'],
  'aug':     ['aug', 'maj'],
  'sus':     ['sus', 'maj'],
  'slash':   ['slash', 'maj', 'maj-ext'],
};

/**
 * Find easier substitutions for a chord that's too hard to play.
 *
 * Suggestions share the same root and stay within a musically acceptable
 * quality family (an exact-quality voicing is always preferred, then a close
 * harmonic substitute like a plain triad for an extended chord). Results are
 * ranked easiest-first, breaking ties toward the closest-sounding quality.
 *
 * @param {object}   chord     - the source chord ({ name, notes, ... })
 * @param {function} scoreFn   - (notes) => personal difficulty (1-10)
 * @param {object}   [opts]
 * @param {number}   [opts.minGain=1] - only suggest if at least this much easier
 * @param {number}   [opts.limit=3]   - max suggestions to return
 * @returns {Array<{ chord, score, exact }>} ranked easier alternatives (may be empty)
 */
export function findEasierVoicings(chord, scoreFn, opts = {}) {
  const { minGain = 1, limit = 3 } = opts;
  const parsed = parseChordName(chord.name);
  if (!parsed) return [];

  const currentScore = scoreFn(chord.notes);
  const targetFamily = qualityFamily(parsed.suffix);
  const acceptable = FAMILY_RANK[targetFamily] || [targetFamily];

  return CHORDS
    .filter(c => c.name !== chord.name)
    .map(c => ({ c, p: parseChordName(c.name) }))
    .filter(({ p }) => p && p.root === parsed.root)
    .map(({ c, p }) => {
      const exact = p.suffix === parsed.suffix;
      const famIdx = acceptable.indexOf(qualityFamily(p.suffix));
      return { chord: c, score: scoreFn(c.notes), exact, famIdx };
    })
    .filter(({ score, famIdx }) => famIdx >= 0 && score <= currentScore - minGain)
    .sort((a, b) =>
      a.score - b.score ||            // easiest first
      Number(b.exact) - Number(a.exact) || // exact quality wins ties
      a.famIdx - b.famIdx)            // then closest family
    .slice(0, limit)
    .map(({ chord, score, exact }) => ({ chord, score, exact }));
}

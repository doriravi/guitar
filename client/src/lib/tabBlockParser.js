// Parse ASCII guitar-tab blocks (the "six lines of dashes with fret numbers"
// format) out of a pasted/imported song sheet into structured, timed note
// events the rest of the app already understands.
//
// A tab block looks like this (a solo/riff, high-e string on top):
//
//   e|---0-0-1-3-1-------0-0-1-3-1---|
//   B|-3-------------3-3-----------3-|
//   G|------------------------------|
//   D|------------------------------|
//   A|------------------------------|
//   E|------------------------------|
//
// Output uses the SAME conventions as the tab service / audio engine:
//   • string index 0 = low E … 5 = high e
//   • an event is { string, fret, col }  (col = character column = play order)
// Timing (a `time` in beats/seconds) is assigned later, by the timeline builder,
// so this module stays purely about "what notes, in what order" and never needs
// to know the song's bpm.

// The six string labels, written low→high and high→low. Sheets almost always
// print them high-e-on-top (e B G D A E), but we accept either order and map
// each printed row to the correct app string index (0=low E … 5=high e).
const STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E']; // top→bottom, the common order
const LABEL_TO_STRING = { e: 5, b: 3, g: 2, d: 1, a: 0, E: 0 };

// Map a tab row's leading label to an app string index (0=low E … 5=high e).
// Case matters for E vs e (low vs high) and B vs b, so we check exact case first
// then fall back to a position-based guess handled by the caller.
function labelToString(label) {
  if (label === 'e') return 5; // high e
  if (label === 'E') return 0; // low E
  if (label === 'B' || label === 'b') return 3;
  if (label === 'G' || label === 'g') return 2;
  if (label === 'D' || label === 'd') return 1;
  if (label === 'A' || label === 'a') return 0; // ambiguous with low E if unlabeled; A wins when labeled
  return null;
}

// Does a line look like one row of a tab staff? It must contain a run of tab
// characters — dashes, digits, and the common articulation glyphs — and be
// mostly made of them, so ordinary lyric/chord lines are never mistaken for tab.
// Examples that match: "e|---0-0-1-3-1---|", "|-3---5h7---|", "G|3-3-0-2-----"
const TAB_BODY_RE = /^[\s|]*[|]?[-\d\s|xXhHpPbBrR/\\~^().*=<>]+[|]?\s*$/;

function looksLikeTabRow(line) {
  const t = line.replace(/\s+$/, '');
  if (!t.trim()) return false;
  // Must contain at least a few dashes AND at least one digit or fret marker —
  // a run of dashes with the odd number is the signature of a tab row.
  const dashes = (t.match(/-/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  if (dashes < 3) return false;
  // Reject lines that are clearly prose (lots of letters that aren't tab glyphs).
  const letters = (t.match(/[a-zA-Z]/g) || []).length;
  const tabLetters = (t.match(/[xXhHpPbBrRsSeE]/g) || []).length; // articulation + string labels
  if (letters - tabLetters > 2) return false;
  return digits > 0 || dashes >= 6; // a pure "----" row (a silent string) is fine inside a block
}

// Strip an optional leading string label + bar separator, returning
//   { label, body, bodyStart }
// where bodyStart is the column offset of `body` within the original line, so
// note columns stay aligned across the six rows of a staff.
function splitRow(line) {
  // e.g. "e|---0---" → label "e", then "|", then the body.
  const m = line.match(/^(\s*)([eEbBgGdDaA]?)(\s*)(\|?)(.*)$/);
  if (!m) return { label: '', body: line, bodyStart: 0 };
  const [, lead, label, gap, bar, rest] = m;
  const bodyStart = lead.length + label.length + gap.length + bar.length;
  return { label, body: rest, bodyStart };
}

// Read the fret number that STARTS at column `c` of a body string (frets can be
// two digits, e.g. "12"). Returns { fret, len } or null if no digit there.
function fretAt(body, c) {
  if (!/\d/.test(body[c])) return null;
  let s = c;
  while (s > 0 && /\d/.test(body[s - 1])) s--;   // rewind to the digit run's start
  if (s !== c) return null;                       // we're mid-number, not at its start
  let e = c;
  while (e + 1 < body.length && /\d/.test(body[e + 1])) e++;
  const fret = parseInt(body.slice(s, e + 1), 10);
  if (Number.isNaN(fret) || fret > 24) return null;
  return { fret, len: e - s + 1 };
}

/**
 * Parse a group of 1–6 aligned tab rows (one tab staff) into note events.
 * Rows are given TOP→BOTTOM as printed. Returns events sorted by column.
 * @param {Array<{stringIdx:number, body:string, offset:number}>} rows
 * @returns {Array<{string:number, fret:number, col:number}>}
 */
function parseStaff(rows) {
  const events = [];
  for (const row of rows) {
    const { stringIdx, body, offset } = row;
    for (let c = 0; c < body.length; c++) {
      const hit = fretAt(body, c);
      if (!hit) continue;
      events.push({ string: stringIdx, fret: hit.fret, col: offset + c });
      c += hit.len - 1; // skip the rest of a multi-digit fret
    }
  }
  events.sort((a, b) => a.col - b.col || a.string - b.string);
  return events;
}

/**
 * Scan raw song text for ASCII tab staves and extract each as a solo block.
 *
 * @param {string[]} rawLines  the sheet split into lines (no trailing \r)
 * @returns {{ blocks: Array<{ atLine:number, events:Array, rowCount:number }>,
 *            tabLineSet: Set<number> }}
 *   • blocks    — one per detected staff, in document order. `atLine` is the
 *                 index of the block's first row (so callers can place it in the
 *                 song relative to the surrounding lyrics).
 *   • tabLineSet — every raw-line index that belonged to a tab staff, so the
 *                 chord-sheet parser can skip those lines when reading lyrics.
 */
export function extractTabBlocks(rawLines) {
  const blocks = [];
  const tabLineSet = new Set();

  let i = 0;
  while (i < rawLines.length) {
    if (!looksLikeTabRow(rawLines[i])) { i++; continue; }

    // Gather the consecutive run of tab rows (a staff is up to 6, but sheets
    // sometimes stack several staves back-to-back — we split on blank lines and
    // on runs longer than 6 by string-label cycling).
    const runStart = i;
    const run = [];
    while (i < rawLines.length && looksLikeTabRow(rawLines[i])) {
      run.push({ line: i, raw: rawLines[i] });
      i++;
    }
    if (run.length < 2) continue; // a lone dashed line isn't a real staff

    // Split the run into 6-row staves. Prefer label cues: a row labeled 'e'
    // (high e) starts a new staff. Otherwise chunk by 6.
    let staffRows = [];
    const flush = () => {
      if (staffRows.length >= 2) {
        const parsed = buildStaff(staffRows);
        if (parsed.events.length) {
          blocks.push({ atLine: staffRows[0].line, rowCount: staffRows.length, events: parsed.events });
          for (const r of staffRows) tabLineSet.add(r.line);
        }
      }
      staffRows = [];
    };

    for (const r of run) {
      const { label } = splitRow(r.raw);
      // A high-e label after we already have rows means a new staff began.
      if (label === 'e' && staffRows.length) flush();
      staffRows.push(r);
      if (staffRows.length === 6) flush();
    }
    flush();
    if (i === runStart) i++; // safety: never stall
  }

  return { blocks, tabLineSet };
}

// Turn a run of raw tab rows into { events } with correct string indices.
// When rows are labeled, trust the labels; otherwise assume the conventional
// high→low order (e B G D A E) mapped onto whatever rows are present.
function buildStaff(staffRows) {
  const withLabels = staffRows.map(r => ({ ...r, ...splitRow(r.raw) }));
  const anyLabeled = withLabels.some(r => r.label);

  const rows = withLabels.map((r, idx) => {
    let stringIdx = anyLabeled ? labelToString(r.label) : null;
    if (stringIdx == null) {
      // Fall back to positional order: top row = high e (5), going down.
      // If there are exactly 6 rows this is the full staff; fewer rows still map
      // top→bottom onto the high strings, which is the common partial-tab case.
      stringIdx = 5 - idx;
      if (stringIdx < 0) stringIdx = 0;
    }
    return { stringIdx, body: r.body, offset: r.bodyStart };
  });

  return { events: parseStaff(rows) };
}

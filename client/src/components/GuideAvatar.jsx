import { useState, useRef, useEffect, useCallback } from 'react';
import { explain as explainApi } from '../lib/api';
import './GuideAvatar.css';

// ─── Guess gender from a first name (so the avatar matches the user) ──────────
// Tiny heuristic — names list + an "-a/-e ending" fallback. Unknown → 'neutral'.
const FEMALE = new Set(['maria','anna','anne','sarah','sara','emma','olivia','sophia','sophie','mia','isabella','emily','ava','laura','julia','nina','lea','noa','tamar','yael','michal','shira','dana','rinat','sigal','rachel','rebecca','hannah','leah','ruth','esther','nicole','michelle','jessica','ashley','amanda','elizabeth','linda','susan','karen','lisa','nancy','betty','sandra','helen','grace','chloe','zoe','lily','ella']);
const MALE = new Set(['john','david','michael','james','robert','william','richard','joseph','daniel','dan','thomas','mark','paul','steven','andrew','kevin','brian','george','edward','ronald','tom','jack','noah','liam','ethan','mason','lucas','henry','alex','adam','eitan','omer','yossi','avi','moshe','david','dor','dori','itay','guy','nir','ido','tal','ben','ron','amit','oz','eyal','gil']);

function guessGender(name) {
  if (!name) return 'neutral';
  const first = name.trim().toLowerCase().split(/\s+/)[0];
  if (FEMALE.has(first)) return 'female';
  if (MALE.has(first)) return 'male';
  if (/(a|ah|ette|elle|ine|een)$/.test(first)) return 'female';
  return 'neutral';
}

// ─── The full-body SVG character ──────────────────────────────────────────────
// A standing person, ~7 heads tall, drawn with soft shading so it reads as human
// rather than a cartoon blob. gender drives hair + clothing accent + build;
// `talking` animates the mouth. The animation hook classes (.ga-eyes, .ga-mouth,
// .ga-think, ga-exp-*) are preserved so the CSS reactions still work.
//
// viewBox is 100×220 (tall). Head is centered on x≈50, crown near y≈14,
// chin near y≈58 — everything below hangs off that.
function Character({ gender, talking, expression = 'idle' }) {
  const skin = '#eac9a6';
  const skinShade = '#d8b189';   // shadow side of skin
  const accent = gender === 'female' ? '#e06aa0' : gender === 'male' ? '#5b8def' : '#c9a96e';
  const accentDk = gender === 'female' ? '#c04d84' : gender === 'male' ? '#4570cf' : '#a9884f'; // clothing shadow
  const hair = gender === 'female' ? '#6b4a2f' : '#3a2a1d';
  const hairHi = gender === 'female' ? '#8a6440' : '#50392a';
  const pants = '#39424f';       // trousers / skirt shade
  const pantsDk = '#2b333d';
  const shoe = '#26201b';
  const exp = talking ? 'talking' : expression;

  // Head geometry
  const cx = 50, eyeY = 34;

  // Eye shapes per expression (almond eyes with iris + highlight → more human)
  const Eye = ({ ex, wink }) => {
    if (wink && exp === 'wink') return <path d={`M${ex - 4} ${eyeY} q4 -3 8 0`} stroke="#3a2a20" strokeWidth="1.8" fill="none" strokeLinecap="round" />;
    if (exp === 'happy') return <path d={`M${ex - 4} ${eyeY + 1} q4 -4 8 0`} stroke="#3a2a20" strokeWidth="1.8" fill="none" strokeLinecap="round" />;
    const r = exp === 'surprised' ? 3.1 : 2.5;
    return (
      <g>
        {/* eye-white almond */}
        <ellipse cx={ex} cy={eyeY} rx="4.2" ry={exp === 'surprised' ? 3.6 : 3} fill="#fbf7f2" />
        {/* iris + pupil */}
        <circle cx={ex} cy={eyeY} r={r} fill="#5a4632" />
        <circle cx={ex} cy={eyeY} r={r - 1.3} fill="#241a12" />
        {/* catch-light */}
        <circle cx={ex + 1} cy={eyeY - 1} r="0.8" fill="#fff" opacity="0.9" />
      </g>
    );
  };

  // Brow offset for personality
  const browY = exp === 'surprised' ? 26 : exp === 'thinking' ? 27 : 28.5;
  const browTilt = exp === 'thinking' ? -4 : 0;

  // Mouth per expression
  const mouthY = 47;
  const mouth = () => {
    if (exp === 'talking') return <ellipse className="ga-mouth is-talking" cx={cx} cy={mouthY} rx="4" ry="3.4" fill="#8a4a48" />;
    if (exp === 'happy') return <path d={`M${cx - 8} ${mouthY - 1} q8 8 16 0`} stroke="#8a4a48" strokeWidth="2.4" fill="none" strokeLinecap="round" />;
    if (exp === 'surprised') return <ellipse cx={cx} cy={mouthY + 1} rx="3" ry="4" fill="#8a4a48" />;
    if (exp === 'wink') return <path d={`M${cx - 7} ${mouthY} q7 5 14 0`} stroke="#8a4a48" strokeWidth="2.2" fill="none" strokeLinecap="round" />;
    if (exp === 'thinking') return <path d={`M${cx - 6} ${mouthY + 1} q6 -2 12 0`} stroke="#8a4a48" strokeWidth="2" fill="none" strokeLinecap="round" />;
    return <path className="ga-mouth" d={`M${cx - 5} ${mouthY} q5 3 10 0`} stroke="#8a4a48" strokeWidth="2" fill="none" strokeLinecap="round" />;
  };

  return (
    <svg viewBox="0 0 100 220" className={`ga-char ga-exp-${exp}`} aria-hidden>
      <defs>
        <linearGradient id="ga-shirt" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={accent} />
          <stop offset="1" stopColor={accentDk} />
        </linearGradient>
        <linearGradient id="ga-legs" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={pants} />
          <stop offset="1" stopColor={pantsDk} />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx={cx} cy="212" rx="26" ry="5" fill="rgba(0,0,0,0.28)" />

      {/* ── LEGS ── */}
      {gender === 'female' ? (
        // skirt + legs
        <>
          <path d="M34 118 L28 150 L72 150 L66 118 Z" fill="url(#ga-legs)" />
          <rect x="42" y="150" width="7" height="46" rx="3.5" fill={skin} />
          <rect x="51" y="150" width="7" height="46" rx="3.5" fill={skinShade} />
        </>
      ) : (
        <>
          <rect x="40" y="120" width="9" height="80" rx="4.5" fill="url(#ga-legs)" />
          <rect x="51" y="120" width="9" height="80" rx="4.5" fill={pantsDk} />
        </>
      )}
      {/* shoes */}
      <path d="M38 198 q-2 6 3 6 h9 v-8 h-12 Z" fill={shoe} />
      <path d="M50 198 h9 q5 0 3 6 h-12 Z" fill="#332a22" />

      {/* ── ARMS (behind torso) ── */}
      <rect x="20" y="86" width="9" height="46" rx="4.5" fill={accentDk} transform="rotate(8 24 86)" />
      <rect x="71" y="86" width="9" height="46" rx="4.5" fill={accentDk} transform="rotate(-8 76 86)" />
      {/* hands */}
      <circle cx="20" cy="132" r="5.5" fill={skin} />
      <circle cx="80" cy="132" r="5.5" fill={skin} />

      {/* ── TORSO / shirt ── */}
      <path d="M32 88 C32 74 40 66 50 66 C60 66 68 74 68 88 L70 122 C70 126 66 128 62 128 L38 128 C34 128 30 126 30 122 Z"
            fill="url(#ga-shirt)" />
      {/* shirt fold highlight */}
      <path d="M50 68 L45 126 L55 126 Z" fill="rgba(255,255,255,0.14)" />
      {/* collar */}
      <path d="M42 68 L50 78 L58 68 Z" fill={accentDk} />

      {/* ── NECK ── */}
      <path d="M44 58 h12 v9 q-6 4 -12 0 Z" fill={skinShade} />
      <rect x="44" y="56" width="12" height="7" rx="3" fill={skin} />

      {/* ── HEAD ── */}
      {/* back hair / shadow behind head */}
      {gender === 'female' && (
        <path d="M28 34 C24 14 76 14 72 34 C74 54 70 66 66 70 L62 60 C68 52 68 44 68 40 L32 40 C32 44 32 52 38 60 L34 70 C30 66 26 54 28 34 Z" fill={hair} />
      )}
      {/* face — oval, not a perfect circle */}
      <ellipse cx={cx} cy="38" rx="19" ry="21" fill={skin} />
      {/* jaw / cheek shading on one side */}
      <path d="M50 15 A19 21 0 0 1 50 59 Q60 50 60 38 Q60 24 50 15 Z" fill={skinShade} opacity="0.35" />
      {/* ears */}
      <ellipse cx="31" cy="39" rx="3.5" ry="5" fill={skin} />
      <ellipse cx="69" cy="39" rx="3.5" ry="5" fill={skinShade} />

      {/* hair (front) — a proper high hairline that frames the forehead but
          never dips over the eyes (that made it look like a mask). */}
      {gender === 'female' ? (
        <path d="M30 40 C28 15 72 15 70 40 C70 28 63 22 50 22 C37 22 30 28 30 40 Z" fill={hair} />
      ) : (
        // short crop: cap of hair sitting on top of the head, hairline ~y26
        <path d="M31 33 C31 17 69 17 69 33 C69 27 62 23 50 23 C38 23 31 27 31 33 Z" fill={hair} />
      )}
      {/* hair highlight */}
      <path d="M40 21 Q50 18 60 21" stroke={hairHi} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />

      {/* nose */}
      <path d={`M${cx} 36 q-2 5 -1 6 q1 1.5 2 0`} stroke={skinShade} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* eyes (blink wrapper) */}
      <g className="ga-eyes"><Eye ex={42} /><Eye ex={58} wink /></g>
      {/* eyebrows */}
      <path d={`M38 ${browY} q4 -2 8 0`} stroke={hair} strokeWidth="1.8" fill="none" strokeLinecap="round" transform={`rotate(${browTilt} 42 ${browY})`} />
      <path d={`M54 ${browY} q4 -2 8 0`} stroke={hair} strokeWidth="1.8" fill="none" strokeLinecap="round" transform={`rotate(${-browTilt} 58 ${browY})`} />

      {/* mouth */}
      {mouth()}
      {/* cheeks (flush brighter when happy) */}
      <ellipse cx="38" cy="43" rx="3.2" ry="2.4" fill="#e8907f" opacity={exp === 'happy' ? 0.55 : 0.28} />
      <ellipse cx="62" cy="43" rx="3.2" ry="2.4" fill="#e8907f" opacity={exp === 'happy' ? 0.55 : 0.28} />

      {/* thinking bubble dots */}
      {exp === 'thinking' && (
        <g className="ga-think" fill="#cfc8bd">
          <circle cx="74" cy="24" r="1.6" /><circle cx="80" cy="19" r="2.2" /><circle cx="87" cy="13" r="2.8" />
        </g>
      )}
    </svg>
  );
}

// ─── Speech (browser TTS) ─────────────────────────────────────────────────────
// Centralized so it can later be swapped for a premium provider in ONE place.
function speak(text, gender, onStart, onEnd) {
  if (!('speechSynthesis' in window)) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0; u.pitch = gender === 'female' ? 1.18 : gender === 'male' ? 0.92 : 1.0;
  // Try to pick a voice matching the gender (best-effort; names vary by OS).
  const voices = window.speechSynthesis.getVoices();
  const pickByHint = (hints) => voices.find(v => hints.some(h => v.name.toLowerCase().includes(h)));
  const v = gender === 'female'
    ? pickByHint(['female','zira','samantha','victoria','google uk english female','karen'])
    : gender === 'male'
      ? pickByHint(['male','david','daniel','google uk english male','alex'])
      : null;
  if (v) u.voice = v;
  u.onstart = () => onStart?.();
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

// ─── Find the explainable element + label under a point ───────────────────────
// Infer a plain-language explanation from an element's semantics when it has no
// explicit data-explain. Covers the common controls so the guide can explain
// almost anything, not just hand-tagged elements.
function infer(el) {
  const tag = el.tagName.toLowerCase();
  const txt = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const role = el.getAttribute('role');

  if (tag === 'select' || role === 'listbox' || role === 'combobox') {
    const opts = el.tagName === 'SELECT' ? `, with ${el.options.length} choices` : '';
    return `This is a dropdown menu${opts}. Open it to pick one of the options${txt ? `, currently “${el.value || txt}”` : ''}.`;
  }
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'range') return `This is a slider. Drag it to change a value${el.getAttribute('aria-label') ? ` — ${el.getAttribute('aria-label')}` : ''}.`;
    if (type === 'checkbox') return 'This is a checkbox — click to turn this option on or off.';
    if (type === 'radio') return 'This is a radio option — pick one choice from the group.';
    if (type === 'file') return 'This lets you choose a file from your device to upload.';
    if (type === 'range') return 'This is a slider you drag to set a value.';
    const ph = el.getAttribute('placeholder');
    return `This is a text box where you type${ph ? ` — ${ph}` : ''}.`;
  }
  if (tag === 'textarea') return 'This is a text area for typing longer text.';
  if (tag === 'button' || role === 'button') {
    return txt ? `This is the “${txt}” button. Click it to ${txt.toLowerCase().startsWith('play') ? 'play the sound' : 'do that action'}.`
               : 'This is a button — click it to perform an action.';
  }
  if (tag === 'a') return txt ? `This is a link to “${txt}”. Click to open it.` : 'This is a link.';

  // Domain-specific: a chord cell / fret diagram (monospace chord names, svg diagrams)
  const cls = el.className?.toString?.() || '';
  if (el.querySelector?.('svg') && /chord|fret|voicing|diagram/i.test(cls + ' ' + (el.id || ''))) {
    return 'This is a chord diagram. The dots show where to put your fingers on the fretboard; the number rates how hard the shape is for your hand.';
  }
  if (/font-mono/.test(cls) && /^[A-G][#b]?m?(maj|sus|dim|aug|add|7|9|6)?/.test(txt)) {
    return `This is the chord “${txt}”. Hover or tap it to see the shape and how hard it is for your hand.`;
  }
  if (txt && txt.length > 1) return `This shows “${txt}”.`;
  return null;
}

// Gather rich context about an element for the AI explainer.
function contextFor(node) {
  const tag = node.tagName?.toLowerCase() || '';
  const role = node.getAttribute?.('role') || '';
  const label = (node.getAttribute?.('aria-label') || node.getAttribute?.('title')
    || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  // nearby context: the closest section heading + the active tab label
  const activeTab = document.querySelector('[data-explain][class*="rounded-lg"][style*="c9a96e"]')?.textContent?.trim()
    || document.querySelector('h2, h3')?.textContent?.trim() || '';
  const heading = node.closest('section, .rounded-2xl, .rounded-xl')?.querySelector('h2,h3,p')?.textContent?.trim().slice(0, 90) || '';
  return { tag, role, label, tab: activeTab.slice(0, 60), context: heading };
}

function explainAt(x, y) {
  let el = document.elementFromPoint(x, y);
  // 1) walk up for an explicit data-explain (curated copy wins — no AI needed)
  let node = el;
  while (node && node !== document.body) {
    if (node.dataset && node.dataset.explain) {
      return { text: node.dataset.explain, rect: node.getBoundingClientRect(), node, curated: true };
    }
    node = node.parentElement;
  }
  // 2) otherwise pick the nearest interactive/meaningful element for AI + a quick guess
  node = el;
  while (node && node !== document.body) {
    const t = node.tagName?.toLowerCase();
    if (['button', 'a', 'select', 'input', 'textarea'].includes(t) ||
        node.getAttribute?.('role') ||
        node.querySelector?.(':scope > svg')) {
      return { text: infer(node), rect: node.getBoundingClientRect(), node, curated: false, ctx: contextFor(node) };
    }
    node = node.parentElement;
  }
  // 3) last resort: whatever is directly under the cursor
  if (el) {
    return { text: infer(el), rect: el.getBoundingClientRect(), node: el, curated: false, ctx: contextFor(el) };
  }
  return null;
}

// ─── Guide avatar ─────────────────────────────────────────────────────────────
const DISMISS_KEY = 'guideAvatarClosed';

export default function GuideAvatar({ userName }) {
  // Closed by the user? Persist it so the guide stays gone across reloads —
  // but leave a tiny "?" tab so it's never lost for good.
  const [closed, setClosed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [gender, setGender] = useState(() => guessGender(userName));
  const [pos, setPos] = useState({ x: window.innerWidth - 90, y: window.innerHeight - 200 });
  const [dragging, setDragging] = useState(false);
  const [pointMode, setPointMode] = useState(false); // click-to-explain armed
  const [talking, setTalking] = useState(false);
  const [bubble, setBubble] = useState(null);       // { text, x, y }
  const [hint, setHint] = useState(true);           // first-run nudge
  const [expression, setExpression] = useState('happy'); // current funny face
  const dragInfo = useRef({ moved: false, offX: 0, offY: 0 });
  const aiCache = useRef(new Map());   // ctx-key → AI explanation
  const reqId = useRef(0);             // guards against stale async responses
  const posRef = useRef(pos);          // latest position without re-creating callbacks
  useEffect(() => { posRef.current = pos; }, [pos]);

  useEffect(() => setGender(guessGender(userName)), [userName]);

  // Close the guide (and remember it); reopen from the little tab.
  const closeGuide = useCallback(() => {
    window.speechSynthesis?.cancel();
    setTalking(false);
    setBubble(null);
    setPointMode(false);
    setClosed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  }, []);
  const reopenGuide = useCallback(() => {
    setClosed(false);
    setHint(true);
    setExpression('happy');
    try { localStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
  }, []);

  // Briefly flash an expression, then drift back to a neutral idle.
  const flash = useCallback((exp, ms = 1400) => {
    setExpression(exp);
    clearTimeout(flash._t);
    flash._t = setTimeout(() => setExpression('idle'), ms);
  }, []);

  // Idle personality: every few seconds pull a random funny face (unless busy).
  useEffect(() => {
    const faces = ['happy', 'wink', 'thinking', 'surprised', 'idle', 'idle'];
    const id = setInterval(() => {
      if (talking || dragging || pointMode) return;
      setExpression(faces[Math.floor(Math.random() * faces.length)]);
    }, 4200);
    return () => clearInterval(id);
  }, [talking, dragging, pointMode]);

  // Prime voices list (some browsers load it async).
  useEffect(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }, []);

  const showExplanation = useCallback((found) => {
    if (!found) {
      setExpression('surprised');
      setBubble({ text: "Hmm, nothing to explain there. Drop me on a button, menu, or chord!", x: posRef.current.x, y: posRef.current.y });
      return;
    }
    const { rect, curated, ctx } = found;
    const bx = rect.left + rect.width / 2, by = rect.top;
    setHint(false);

    const say = (text, exp = 'happy') => {
      setExpression(exp);
      setBubble({ text, x: bx, y: by });
      speak(text, gender, () => setTalking(true), () => setTalking(false));
    };

    // Curated copy → use as-is, no AI call.
    if (curated && found.text) { say(found.text); return; }

    // Cached AI answer → use it.
    const key = ctx ? `${ctx.tab}|${ctx.tag}|${ctx.role}|${ctx.label}` : null;
    if (key && aiCache.current.has(key)) { say(aiCache.current.get(key)); return; }

    // Otherwise: speak the quick local guess now, fetch a better AI one, then upgrade.
    const placeholder = found.text || "Let me take a look…";
    say(placeholder, 'thinking');

    if (!ctx) return;
    const myReq = ++reqId.current;
    explainApi.get(ctx).then(ai => {
      if (!ai || myReq !== reqId.current) return;   // stale or failed → keep placeholder
      aiCache.current.set(key, ai);
      // Re-show with the AI explanation (re-speak, since it's better).
      window.speechSynthesis?.cancel();
      say(ai);
    });
  }, [gender]);

  // ── drag ──
  const onPointerDown = (e) => {
    e.preventDefault();
    dragInfo.current = { moved: false, offX: e.clientX - pos.x, offY: e.clientY - pos.y };
    setDragging(true);
    setExpression('surprised');     // "whee!" while picked up
    window.speechSynthesis?.cancel();
    setBubble(null);
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (e) => {
      dragInfo.current.moved = true;
      setPos({ x: e.clientX - dragInfo.current.offX, y: e.clientY - dragInfo.current.offY });
      // live-highlight whatever the guide would explain under its "hand"
      const found = explainAt(e.clientX, e.clientY - 30);
      document.querySelectorAll('.ga-target').forEach(el => el.classList.remove('ga-target'));
      if (found?.node) { found.node.classList.add('ga-target'); setExpression('thinking'); }
      else setExpression('surprised');
    };
    const up = (e) => {
      setDragging(false);
      document.querySelectorAll('.ga-target').forEach(el => el.classList.remove('ga-target'));
      if (dragInfo.current.moved) {
        showExplanation(explainAt(e.clientX, e.clientY - 30));
      } else {
        // treated as a click → arm point mode
        setPointMode(p => !p);
        setExpression('thinking');
        setBubble(null);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragging, showExplanation]);

  // ── click-to-explain mode ──
  useEffect(() => {
    if (!pointMode) return;
    const onClick = (e) => {
      if (e.target.closest('.ga-root')) return; // ignore clicks on the avatar itself
      const found = explainAt(e.clientX, e.clientY);
      if (found) {
        e.preventDefault(); e.stopPropagation();
        showExplanation(found);
        setPointMode(false);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [pointMode, showExplanation]);

  const bubbleStyle = bubble ? {
    left: Math.min(Math.max(12, bubble.x), window.innerWidth - 260),
    top: Math.max(12, bubble.y - 16),
  } : null;

  // Dismissed: show only a small tab to bring the guide back.
  if (closed) {
    return (
      <button className="ga-reopen" onClick={reopenGuide} title="Show the guide">
        <span aria-hidden>💬</span>
        <span className="ga-reopen-label">Guide</span>
      </button>
    );
  }

  return (
    <>
      {/* speech bubble */}
      {bubble && (
        <div className="ga-bubble" style={bubbleStyle} role="status">
          <button className="ga-bubble-x" onClick={() => { setBubble(null); window.speechSynthesis?.cancel(); setTalking(false); }}>×</button>
          <p>{bubble.text}</p>
          <button className="ga-replay" onClick={() => speak(bubble.text, gender, () => setTalking(true), () => setTalking(false))}>🔊 Replay</button>
        </div>
      )}

      <div
        className={`ga-root ${dragging ? 'is-dragging' : ''} ${pointMode ? 'is-pointing' : ''}`}
        style={{ left: pos.x, top: pos.y }}
      >
        {hint && !bubble && (
          <div className="ga-hint">Drag me onto anything — I'll explain it.</div>
        )}
        {pointMode && <div className="ga-hint ga-hint-point">Now click any button or menu.</div>}

        <div className="ga-figure" onPointerDown={onPointerDown}
          onMouseEnter={() => !talking && !dragging && flash('happy', 1200)}
          title="Drag me onto a component, or click me then click a component">
          <Character gender={gender} talking={talking} expression={expression} />
        </div>

        {/* tiny gender switch (heuristic isn't perfect) */}
        <button
          className="ga-swap"
          onClick={(e) => { e.stopPropagation(); setGender(g => g === 'female' ? 'male' : g === 'male' ? 'neutral' : 'female'); }}
          title="Switch guide"
        >⟳</button>

        {/* close the guide (reopen from the tab it leaves behind) */}
        <button
          className="ga-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); closeGuide(); }}
          title="Close the guide"
          aria-label="Close the guide"
        >×</button>
      </div>
    </>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { useHandProfile, useAIFingers, useLang } from '../App';
import { abilityLabel, recommendedMaxDifficulty } from '../lib/handProfile';
import { advise } from '../lib/api';
import { useT } from '../lib/i18n';

// Floating AI advisor: a bottom-right bubble that expands into a multi-turn chat
// panel. It's a music-theory + guitar + this-app consultant, and it knows the
// user's current screen and hand profile so its advice is reach-aware.
//
// `activeTab` is the app's current tab id. `composition` (optional) is a snapshot
// of the Composer state ({ key, beats:[{chordLabel, tab}] }) when available.
export default function AdvisorWidget({ activeTab, composition }) {
  const lang = useLang();
  const tr = useT(lang);
  const handProfile = useHandProfile();
  const aiFingers = useAIFingers();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', content }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const buildContext = useCallback(() => {
    const ability = abilityLabel(handProfile);
    return {
      tab: activeTab,
      lang,
      hand: {
        abilityLabel: ability.label,
        recommendedMaxDifficulty: recommendedMaxDifficulty(handProfile),
        thumbToIndex: handProfile.thumbToIndex,
        indexToMiddle: handProfile.indexToMiddle,
        middleToRing: handProfile.middleToRing,
        ringToLittle: handProfile.ringToLittle,
        fingerCapability: aiFingers ?? undefined,
      },
      composition: composition ?? undefined,
    };
  }, [activeTab, lang, handProfile, aiFingers, composition]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setUnavailable(false);

    const reply = await advise.ask({
      messages: nextMessages,
      context: buildContext(),
    });
    setLoading(false);

    if (reply) {
      setMessages(m => [...m, { role: 'assistant', content: reply }]);
    } else {
      setUnavailable(true);
    }
  }, [input, loading, messages, buildContext]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ── Collapsed bubble ──────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={tr.advisorTitle}
        className="fixed z-50 flex items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
        style={{
          right: 20, bottom: 20, width: 58, height: 58,
          background: 'linear-gradient(135deg, #a78bfa, #38bdf8)',
          boxShadow: '0 6px 20px rgba(56,189,248,0.4)',
        }}
      >
        <span style={{ fontSize: 26 }}>🎓</span>
      </button>
    );
  }

  // ── Expanded chat panel ───────────────────────────────────────────────────
  return (
    <div
      className="fixed z-50 flex flex-col rounded-2xl overflow-hidden"
      style={{
        right: 20, bottom: 20,
        width: 'min(380px, calc(100vw - 40px))',
        height: 'min(560px, calc(100vh - 100px))',
        background: 'var(--color-surface-850)',
        border: '1px solid var(--color-surface-550)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ background: 'linear-gradient(135deg, rgba(167,139,250,0.18), rgba(56,189,248,0.18))', borderBottom: '1px solid var(--color-surface-550)' }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 18 }}>🎓</span>
          <div>
            <p className="text-sm font-bold text-ink">{tr.advisorTitle}</p>
            <p className="text-[10px] text-ink-muted">{tr.advisorSubtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setUnavailable(false); }}
              title={tr.advisorClear}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs text-ink-muted">↺</button>
          )}
          <button onClick={() => setOpen(false)} aria-label={tr.close}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm text-ink-muted">✕</button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5">
        {messages.length === 0 && !loading && (
          <div className="text-center px-3 py-6">
            <p className="text-sm font-semibold mb-1 text-brand">{tr.advisorGreeting}</p>
            <p className="text-xs mb-3 text-ink-subtle">{tr.advisorHint}</p>
            <div className="flex flex-col gap-1.5">
              {advisorPrompts(tr).map((p, i) => (
                <button key={i} onClick={() => { setInput(p); inputRef.current?.focus(); }}
                  className="text-left text-xs px-3 py-2 rounded-lg transition-all bg-surface-750 text-ink-muted border border-surface-600">
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i}
            className="max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap"
            style={m.role === 'user'
              ? { alignSelf: 'flex-end', background: 'var(--color-info)', color: 'var(--color-surface-base)', borderBottomRightRadius: 4 }
              : { alignSelf: 'flex-start', background: 'var(--color-surface-700)', color: 'var(--color-ink)', border: '1px solid var(--color-surface-550)', borderBottomLeftRadius: 4 }}>
            {m.content}
          </div>
        ))}

        {loading && (
          <div className="max-w-[85%] px-3 py-2 rounded-2xl text-xs text-ink-muted"
            style={{ alignSelf: 'flex-start', background: 'var(--color-surface-700)', border: '1px solid var(--color-surface-550)' }}>
            {tr.advisorThinking}
          </div>
        )}

        {unavailable && !loading && (
          <div className="text-[11px] text-center py-2 text-ink-subtle">
            {tr.advisorUnavailable}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-2.5 flex items-end gap-2" style={{ borderTop: '1px solid var(--color-surface-550)' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={tr.advisorPlaceholder}
          className="flex-1 resize-none px-3 py-2 rounded-xl text-xs outline-none bg-surface-750 text-ink border border-surface-550"
          style={{ maxHeight: 96 }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all ${input.trim() && !loading ? 'bg-accent text-surface-base' : 'bg-surface-750 text-ink-ghost cursor-not-allowed'}`}>
          {tr.advisorSend}
        </button>
      </div>
    </div>
  );
}

// Suggested starter prompts shown on an empty chat.
function advisorPrompts(tr) {
  return [
    tr.advisorPrompt1,
    tr.advisorPrompt2,
    tr.advisorPrompt3,
  ].filter(Boolean);
}

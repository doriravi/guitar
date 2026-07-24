import { useT } from '../lib/i18n';
import { TIERS } from '../lib/levelPlan';
import { TIER_META } from './LevelPlan';

// "Where are you starting from?" — the one-time step a brand-new user sees right
// after registering, before the hand-measurement onboarding. Picking a level does
// NOT change any scoring or auto-complete milestones; it only tells the Level Plan
// which tier to bring into view first (see getDeclaredTier / setDeclaredTier and
// the focus effect in LevelPlan.jsx). onPick(tier) is called with a tier string,
// or with null when the user skips.

// Plain-language, honest one-liners per tier. Kept here (not i18n.js) per the
// project convention: fallback English inline, translated later via tr keys.
const BLURBS = {
  Beginner:     { key: 'levelPickBeginnerBlurb',     text: 'Just starting out — first open chords and a steady strum.' },
  Intermediate: { key: 'levelPickIntermediateBlurb', text: 'I know open chords and I’m working on barre chords and full songs.' },
  Advanced:     { key: 'levelPickAdvancedBlurb',     text: 'Comfortable across the neck — refining technique and harder pieces.' },
  Master:       { key: 'levelPickMasterBlurb',       text: 'Fluent — polishing advanced material and performance.' },
};

// Human tier names carry an inline translation too, so the whole card localizes.
const TIER_LABEL_KEY = {
  Beginner: 'tierBeginner',
  Intermediate: 'tierIntermediate',
  Advanced: 'tierAdvanced',
  Master: 'tierMaster',
};

export default function LevelPicker({ lang, onPick }) {
  const tr = useT(lang);

  return (
    <div className="min-h-screen bg-surface-base">
      <main className="max-w-lg mx-auto px-4 py-10 sm:py-14">
        <div className="mb-6 text-center">
          <div className="text-4xl mb-3" aria-hidden="true">🗺️</div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink mb-2">
            {tr.levelPickTitle || 'Where are you starting from?'}
          </h1>
          <p className="text-sm leading-relaxed text-ink-subtle">
            {tr.levelPickIntro ||
              'This just points your plan at the right place — you can explore any level anytime.'}
          </p>
        </div>

        <div className="flex flex-col gap-3" role="radiogroup"
          aria-label={tr.levelPickTitle || 'Where are you starting from?'}>
          {TIERS.map((tier) => {
            const meta = TIER_META[tier] || {};
            const blurb = BLURBS[tier] || {};
            const label = tr[TIER_LABEL_KEY[tier]] || tier;
            return (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked="false"
                onClick={() => onPick(tier)}
                className="text-left rounded-2xl p-4 border transition-transform active:scale-[0.99]
                  hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                style={{ background: meta.tint, borderColor: meta.edge }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl" aria-hidden="true">{meta.emoji}</span>
                  <div className="min-w-0">
                    <div className="font-bold text-ink">{label}</div>
                    <div className="text-xs leading-relaxed text-ink-subtle">
                      {tr[blurb.key] || blurb.text}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => onPick(null)}
            className="text-sm text-ink-faint hover:text-ink-subtle underline underline-offset-2
              focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded px-2 py-1"
          >
            {tr.levelPickSkip || 'Skip for now'}
          </button>
        </div>
      </main>
    </div>
  );
}

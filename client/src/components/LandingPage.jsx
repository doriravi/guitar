import { useEffect } from 'react';
import './LandingPage.css';

// The landing page is a self-contained animated explainer served as a static
// asset (client/public/explainer.html — canvas FX, embedded intro video, and
// its own scripted scenes). We render it full-screen in an iframe so the
// animation runs exactly as authored, and overlay the app's own controls:
//   • a "Get started" button + language picker (top-right)
//   • the explainer's in-frame "Open the app" CTA posts a message back to us,
//     which we route to onGetStarted (the in-app sign-in flow).
export default function LandingPage({ onGetStarted, langSlot }) {
  // The embedded explainer signals "open the app" via postMessage (see the
  // script appended to explainer.html). Route it to the in-app sign-in flow.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.data && e.data.type === 'fretfit:getStarted') onGetStarted?.();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onGetStarted]);

  return (
    <div className="lp-embed-root">
      <iframe
        src="/explainer.html"
        title="FretFit — the full story"
        className="lp-embed-frame"
        allow="autoplay; fullscreen; encrypted-media"
      />

      {/* Overlay controls — sit above the iframe, top-right. */}
      <div className="lp-embed-controls">
        {langSlot}
        <button className="lp-embed-cta" onClick={onGetStarted}>Get started</button>
      </div>
    </div>
  );
}

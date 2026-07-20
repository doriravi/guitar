import { useEffect, useRef, useState, useCallback } from 'react';
import { subscriptions as subscriptionsApi } from '../lib/api';
import { useT } from '../lib/i18n';

// The $10/year access pass, paid through PayPal.
//
// This screen is the ONLY way to pay. It loads PayPal's JS SDK on demand (never
// bundled — it's a third-party script and shouldn't cost anything to users who
// are already paid) and renders PayPal's own Smart Buttons, which run the whole
// approval flow in a popup PayPal controls. We never see a card number.
//
// The money decision is NOT made here: the browser only relays an order id, and
// the SERVER re-verifies status/owner/amount with PayPal before granting access
// (see SubscriptionService.capturePayPalOrder). Tampering with this component
// cannot unlock anything.

const SDK_ID = 'paypal-sdk';

/**
 * Loads the PayPal JS SDK once and resolves with window.paypal. Concurrent
 * callers share the same in-flight promise, and the script tag is reused so
 * mounting the paywall twice doesn't load PayPal twice.
 */
let _sdkPromise = null;
function loadPayPalSdk(clientId, currency = 'USD') {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.paypal) return Promise.resolve(window.paypal);
  if (_sdkPromise) return _sdkPromise;

  _sdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SDK_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.paypal));
      existing.addEventListener('error', () => reject(new Error('PayPal SDK failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.id = SDK_ID;
    // `intent=capture` matches the server's one-off order; disabling funding
    // sources we don't support keeps the button set honest.
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}`
      + `&currency=${encodeURIComponent(currency)}&intent=capture`;
    s.async = true;
    s.onload = () => resolve(window.paypal);
    s.onerror = () => {
      _sdkPromise = null;           // allow a retry after a network blip
      reject(new Error('PayPal SDK failed to load'));
    };
    document.head.appendChild(s);
  });
  return _sdkPromise;
}

/**
 * @param {object} props
 *   onPaid    — called with the fresh subscription once access is granted
 *   onClose   — optional; when present a dismiss control is shown
 *   compact   — render inline (inside Account settings) rather than full-screen
 */
export default function Paywall({ lang, onPaid, onClose, compact = false }) {
  const tr = useT(lang);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | paying | paid | error
  const [error, setError] = useState(null);
  const buttonsRef = useRef(null);
  const renderedRef = useRef(false);
  // The capture callback is re-created on each render; keep the latest in a ref
  // so the PayPal buttons (rendered once, imperatively) always call the current
  // one instead of closing over a stale render's props.
  const onPaidRef = useRef(onPaid);
  useEffect(() => { onPaidRef.current = onPaid; }, [onPaid]);

  // 1. Ask the server what PayPal config to use (client id, price, availability).
  useEffect(() => {
    let alive = true;
    subscriptionsApi.paypalConfig()
      .then(cfg => {
        if (!alive) return;
        setConfig(cfg);
        if (!cfg.configured) {
          setStatus('error');
          setError(tr.payUnavailable
            || 'Payments are not available on this server right now. Please try again later.');
        } else {
          setStatus('ready');
        }
      })
      .catch(err => {
        if (!alive) return;
        setStatus('error');
        setError(err.message || (tr.payConfigFailed || 'Could not reach the payment service.'));
      });
    return () => { alive = false; };
  }, [tr.payUnavailable, tr.payConfigFailed]);

  const capture = useCallback(async (orderId) => {
    setStatus('paying');
    try {
      const sub = await subscriptionsApi.capturePayPalOrder(orderId);
      setStatus('paid');
      onPaidRef.current?.(sub);
    } catch (err) {
      setStatus('error');
      // A capture that fails AFTER PayPal took the money is the worst case, so
      // say plainly that no access was granted and point at support rather than
      // implying the user simply try again and pay twice.
      setError(err.message
        || (tr.payCaptureFailed
          || 'We could not confirm your payment. If you were charged, contact support and we will sort it out — do not pay again.'));
    }
  }, [tr.payCaptureFailed]);

  // 2. Once configured, load the SDK and render PayPal's buttons exactly once.
  useEffect(() => {
    if (status !== 'ready' || !config?.configured || renderedRef.current) return;
    let alive = true;

    loadPayPalSdk(config.clientId, config.currency || 'USD')
      .then(paypal => {
        if (!alive || !buttonsRef.current || renderedRef.current) return;
        renderedRef.current = true;
        paypal.Buttons({
          style: { layout: 'vertical', shape: 'pill', label: 'paypal' },
          // Ask OUR server to create the order — the price lives server-side so
          // the browser can never propose its own amount.
          createOrder: () => subscriptionsApi.createPayPalOrder().then(r => r.orderId),
          onApprove: (data) => capture(data.orderID),
          onCancel: () => {
            // Not an error — the user simply backed out. Stay on the paywall.
            setError(null);
          },
          onError: (err) => {
            setStatus('error');
            setError(String(err?.message || err)
              || (tr.payFailed || 'PayPal could not complete the payment.'));
          },
        }).render(buttonsRef.current).catch(() => {
          if (!alive) return;
          renderedRef.current = false;
          setStatus('error');
          setError(tr.payButtonsFailed || 'Could not show the PayPal button.');
        });
      })
      .catch(err => {
        if (!alive) return;
        setStatus('error');
        setError(err.message || (tr.paySdkFailed || 'Could not load PayPal.'));
      });

    return () => { alive = false; };
  }, [status, config, capture, tr.payFailed, tr.payButtonsFailed, tr.paySdkFailed]);

  const price = config?.priceUsd || '10.00';

  const body = (
    <div className="w-full max-w-md rounded-2xl p-6 bg-surface-base border border-surface-550">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-lg font-bold text-ink">
          {tr.payTitle || 'Unlock your account'}
        </h2>
        {onClose && (
          <button onClick={onClose} aria-label={tr.close || 'Close'}
            className="text-xl leading-none opacity-60 shrink-0">×</button>
        )}
      </div>

      <p className="text-xs mb-4 text-ink-subtle">
        {tr.payIntro
          || 'Your account, saved songs, recordings and AI features run on our server. Keeping it running costs money, so full access is a flat yearly fee.'}
      </p>

      <div className="rounded-xl p-4 mb-4 bg-surface-900 border border-surface-650 text-center">
        <div className="text-3xl font-bold text-brand">
          ${price}
          <span className="text-sm font-semibold text-ink-muted"> / {tr.payPerYear || 'year'}</span>
        </div>
        <p className="text-[11px] mt-1 text-ink-faint">
          {tr.payOneOff || 'A single payment for 12 months. Nothing auto-renews — you choose to pay again.'}
        </p>
      </div>

      {status === 'paid' ? (
        <div className="rounded-xl px-4 py-3 text-xs text-center" style={{
          background: 'rgba(74,222,128,0.1)',
          border: '1px solid rgba(74,222,128,0.3)',
          color: 'var(--color-success)',
        }}>
          {tr.payThanks || 'Payment received — your account is unlocked. Thank you! 🎸'}
        </div>
      ) : (
        <>
          {/* PayPal renders its own buttons into this node. */}
          <div ref={buttonsRef} aria-busy={status === 'loading'} />

          {status === 'loading' && (
            <p className="text-xs text-center text-ink-muted">{tr.loading || 'Loading…'}</p>
          )}
          {status === 'paying' && (
            <p className="text-xs text-center mt-2 text-ink-muted">
              {tr.payConfirming || 'Confirming your payment — please don’t close this window…'}
            </p>
          )}
        </>
      )}

      {error && (
        <p className="text-xs mt-3 text-danger" role="alert">{error}</p>
      )}

      <p className="text-[11px] mt-4 text-ink-ghost">
        {tr.paySecureNote
          || 'Payment is handled entirely by PayPal — we never see your card details.'}
      </p>
    </div>
  );

  if (compact) return body;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.7)' }}>
      {body}
    </div>
  );
}

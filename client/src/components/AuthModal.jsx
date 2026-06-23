import { useState, useEffect, useRef } from 'react';
import { auth } from '../lib/api';
import { useT } from '../lib/i18n';

// Small helper: read a translation key, falling back to an English default so
// the 9 non-English language blocks don't render `undefined` for the new
// email-first sign-in strings (only the `en` block defines them).
function tk(tr, key, fallback) {
  return tr[key] != null ? tr[key] : fallback;
}

export default function AuthModal({ onSuccess, onClose, onForgotPassword, lang, fullPage = false }) {
  const tr = useT(lang);

  // step: 'email' (enter email) -> 'auth' (password / name)
  const [step, setStep] = useState('email');
  // mode within the auth step
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState({ google: false, facebook: false });

  const googleBtnRef = useRef(null);

  // Discover which social providers the server has credentials for.
  useEffect(() => {
    let alive = true;
    auth.oauthConfig()
      .then(cfg => { if (alive && cfg) setProviders(cfg); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Initialize the Facebook SDK once it has loaded, if an app id is configured
  // at build time. Polls briefly because the SDK script is async.
  useEffect(() => {
    const appId = import.meta.env.VITE_FACEBOOK_APP_ID;
    if (!appId) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (window.FB) {
        try { window.FB.init({ appId, cookie: true, xfbml: false, version: 'v19.0' }); } catch { /* already init'd */ }
        clearInterval(timer);
      } else if (++tries > 40) {
        clearInterval(timer);
      }
    }, 150);
    return () => clearInterval(timer);
  }, []);

  // Render the official Google button when Google is enabled and its SDK is
  // present (loaded via index.html). Falls back to the styled stub button
  // otherwise.
  useEffect(() => {
    if (step !== 'email' || !providers.google) return;
    const g = window.google?.accounts?.id;
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!g || !clientId || !googleBtnRef.current) return;
    try {
      g.initialize({
        client_id: clientId,
        callback: (resp) => handleOAuth('google', resp.credential),
      });
      g.renderButton(googleBtnRef.current, { theme: 'filled_black', size: 'large', width: 320, text: 'continue_with' });
    } catch { /* SDK shape changed — keep stub */ }
  }, [step, providers.google]);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  function emailValid(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function goToAuthStep(e) {
    e.preventDefault();
    setError('');
    if (!emailValid(form.email)) {
      setError(tk(tr, 'invalidEmail', 'Please enter a valid email address.'));
      return;
    }
    setStep('auth');
  }

  // Explicit "Create account" path from the first screen for new users.
  function goToRegisterStep() {
    setError('');
    if (!emailValid(form.email)) {
      setError(tk(tr, 'invalidEmail', 'Please enter a valid email address.'));
      return;
    }
    setMode('register');
    setStep('auth');
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = mode === 'login'
        ? await auth.login(form.email, form.password)
        : await auth.register(form.email, form.password, form.name);
      onSuccess(user);
    } catch (err) {
      // The email-first flow can't know up front whether an account exists, so
      // recover from the two "wrong mode" cases instead of showing a raw error:
      //   409 on register  -> account already exists, switch to sign-in
      //   401 on login      -> tell the user the password is wrong (or offer signup)
      if (mode === 'register' && err.status === 409) {
        setMode('login');
        setError(tk(tr, 'accountExistsSignIn',
          'An account with this email already exists. Please enter your password to sign in.'));
      } else if (mode === 'login' && err.status === 401) {
        setError(tk(tr, 'wrongPassword',
          'Incorrect password. Try again, or use "Forgot your password".'));
      } else {
        setError(err.message || tk(tr, 'somethingWrong', 'Something went wrong'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider, token) {
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const user = provider === 'google'
        ? await auth.oauthGoogle(token)
        : await auth.oauthFacebook(token);
      onSuccess(user);
    } catch (err) {
      if (err.status === 503) {
        setError(tk(tr, 'providerNotConfigured', 'This sign-in option is not available yet.'));
      } else {
        setError(err.message || tk(tr, 'somethingWrong', 'Something went wrong'));
      }
    } finally {
      setLoading(false);
    }
  }

  // Click handlers for the styled social buttons (used when the provider SDK
  // isn't loaded — e.g. credentials not yet added). They surface a clear
  // "not available" message rather than failing silently.
  function onGoogleClick() {
    const g = window.google?.accounts?.id;
    if (providers.google && g) { g.prompt(); return; }
    setError(tk(tr, 'providerNotConfigured', 'This sign-in option is not available yet.'));
  }

  async function onFacebookClick() {
    if (providers.facebook && window.FB) {
      window.FB.login((resp) => {
        if (resp.authResponse?.accessToken) {
          handleOAuth('facebook', resp.authResponse.accessToken);
        }
      }, { scope: 'email' });
      return;
    }
    setError(tk(tr, 'providerNotConfigured', 'This sign-in option is not available yet.'));
  }

  function onInstitutionClick() {
    setError('');
    setInfo(tk(tr, 'institutionComingSoon',
      'Institutional sign-in is coming soon. Please contact your group administrator for access.'));
  }

  const inputStyle = {
    background: '#111', border: '1px solid #333', color: '#f0ede8',
  };
  const goldBtn = {
    background: '#c9a96e', color: '#0f0f0f',
  };

  // As a landing-page gate (fullPage) there's no overlay or close button — the
  // login screen IS the page. As a modal it dims the app behind and closes on
  // backdrop click.
  const wrapperClass = fullPage
    ? 'min-h-screen flex items-center justify-center p-4'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4';

  return (
    <div
      className={wrapperClass}
      style={fullPage ? { background: '#0f0f0f' } : undefined}
      onClick={e => { if (!fullPage && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-sm rounded-xl p-7"
        style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}
      >
        {!fullPage && (
          <button
            onClick={onClose}
            className="absolute right-6 top-6 text-xl leading-none"
            style={{ color: '#888' }}
            aria-label="Close"
          >×</button>
        )}

        {step === 'email' && (
          <>
            <h2
              className="mb-6 text-center text-base font-medium leading-snug"
              style={{ color: '#f0ede8' }}
            >
              {tk(tr, 'enterEmailPrompt',
                'Please enter your email to sign in or create a new account.')}
            </h2>

            <form onSubmit={goToAuthStep} className="flex flex-col gap-2">
              <label className="text-xs" style={{ color: '#999' }}>
                {tk(tr, 'yourEmail', 'Your Email')}
              </label>
              <input
                name="email" type="email" autoFocus
                placeholder={tk(tr, 'emailPlaceholder', 'email@address.com')}
                value={form.email} onChange={handleChange} required
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={inputStyle}
              />

              {error && <p className="text-sm" style={{ color: '#e87070' }}>{error}</p>}
              {info && <p className="text-sm" style={{ color: '#9cc69c' }}>{info}</p>}

              <button
                type="submit"
                className="mt-2 w-full rounded-lg py-2.5 text-sm font-semibold transition-opacity"
                style={goldBtn}
              >
                {tk(tr, 'continueBtn', 'Continue')}
              </button>
            </form>

            <p className="mt-3 text-center text-xs" style={{ color: '#888' }}>
              {tk(tr, 'newHere', 'New here?')}{' '}
              <button type="button" onClick={goToRegisterStep} className="underline font-semibold" style={{ color: '#c9a96e' }}>
                {tk(tr, 'createAccount', 'Create account')}
              </button>
            </p>

            <p className="mt-1 text-center text-xs" style={{ color: '#888' }}>
              {tk(tr, 'forgotEmailOrPassword', 'Forgot your')}{' '}
              <button onClick={onForgotPassword} className="underline" style={{ color: '#c9a96e' }}>
                {tk(tr, 'passwordWord', 'password?')}
              </button>
            </p>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: '#333' }} />
              <span className="text-[10px] tracking-widest" style={{ color: '#666' }}>
                {tk(tr, 'orUse', 'OR USE')}
              </span>
              <div className="h-px flex-1" style={{ background: '#333' }} />
            </div>

            <div className="flex flex-col gap-2">
              {/* Official Google button renders here when SDK + client id present */}
              <div ref={googleBtnRef} />
              {!window.google?.accounts?.id && (
                <button
                  onClick={onGoogleClick}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium"
                  style={{ background: '#222', border: '1px solid #333', color: '#f0ede8' }}
                >
                  <span style={{ fontWeight: 700 }}>G</span>
                  {tk(tr, 'continueWithGoogle', 'Google')}
                </button>
              )}
              <button
                onClick={onFacebookClick}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium"
                style={{ background: '#222', border: '1px solid #333', color: '#f0ede8' }}
              >
                <span style={{ color: '#4267B2', fontWeight: 700 }}>f</span>
                {tk(tr, 'continueWithFacebook', 'Facebook')}
              </button>
            </div>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: '#333' }} />
              <span className="text-[10px] tracking-widest" style={{ color: '#666' }}>
                {tk(tr, 'orUse', 'OR USE')}
              </span>
              <div className="h-px flex-1" style={{ background: '#333' }} />
            </div>

            <p className="text-center text-xs" style={{ color: '#888' }}>
              {tk(tr, 'groupSubscriptionPrompt', 'Accessing a group subscription?')}
              <br />
              <button onClick={onInstitutionClick} className="underline" style={{ color: '#c9a96e' }}>
                {tk(tr, 'signInThroughInstitution', 'Sign in')}
              </button>{' '}
              {tk(tr, 'throughYourInstitution', 'through your institution')}
            </p>
          </>
        )}

        {step === 'auth' && (
          <>
            <h2 className="mb-1 text-center text-lg font-semibold" style={{ color: '#f0ede8' }}>
              {mode === 'login'
                ? tk(tr, 'welcomeBack', 'Welcome back')
                : tk(tr, 'createYourAccount', 'Create your account')}
            </h2>
            <p className="mb-5 text-center text-xs" style={{ color: '#888' }}>
              {(mode === 'login'
                ? tk(tr, 'enterPasswordFor', 'Enter your password for')
                : tk(tr, 'choosePasswordFor', 'Choose a password for')) + ' '}
              <span style={{ color: '#c9a96e' }}>{form.email}</span>
            </p>

            <form onSubmit={handleAuthSubmit} className="flex flex-col gap-3">
              {mode === 'register' && (
                <input
                  name="name" type="text" placeholder={tr.yourName}
                  value={form.name} onChange={handleChange} required
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                />
              )}
              <input
                name="password" type="password" autoFocus
                placeholder={mode === 'register' ? tr.passwordHint : tr.password}
                value={form.password} onChange={handleChange} required
                minLength={mode === 'register' ? 8 : undefined}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />

              {error && <p className="text-sm" style={{ color: '#e87070' }}>{error}</p>}

              <button
                type="submit" disabled={loading}
                className="w-full rounded-lg py-2.5 text-sm font-semibold transition-opacity"
                style={{ ...goldBtn, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                {loading ? tr.pleaseWait : mode === 'login' ? tr.signIn : tr.createAccount}
              </button>
            </form>

            {mode === 'login' && (
              <p className="mt-3 text-center text-xs">
                <button onClick={onForgotPassword} className="underline" style={{ color: '#888' }}>
                  {tr.forgotPassword}
                </button>
              </p>
            )}

            <p className="mt-3 text-center text-xs" style={{ color: '#666' }}>
              {mode === 'login' ? tr.noAccount : tr.haveAccount}{' '}
              <button
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
                className="underline" style={{ color: '#c9a96e' }}
              >
                {mode === 'login' ? tr.signUp : tr.signIn}
              </button>
            </p>

            <p className="mt-4 text-center text-xs">
              <button
                onClick={() => { setStep('email'); setError(''); setForm(f => ({ ...f, password: '' })); }}
                className="underline" style={{ color: '#888' }}
              >
                ← {tk(tr, 'back', 'Back')}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

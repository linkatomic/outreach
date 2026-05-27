import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Icon } from '../data.jsx'

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('Wrong email or password. Try again.');
      setLoading(false);
    }
    // On success, App.jsx auth listener handles the redirect automatically
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 380, padding: 24 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 48, height: 48, borderRadius: 12,
            background: 'var(--accent)', color: 'var(--accent-ink)',
            fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em',
            marginBottom: 14,
          }}>R</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' }}>Relay</div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-faint)' }}>
            Outreach ops · Amrytt
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 22 }}>Sign in</div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Email
              </label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@amrytt.com"
                style={{ width: '100%' }}
                autoFocus
                autoComplete="email"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ width: '100%', paddingRight: 40 }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: 2 }}
                >
                  <Icon name={showPass ? 'eye' : 'eye'} size={14} />
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                padding: '9px 12px', borderRadius: 6,
                background: 'rgba(255, 80, 80, 0.1)',
                border: '1px solid rgba(255, 80, 80, 0.25)',
                color: '#ff7070', fontSize: 13,
              }}>
                {error}
              </div>
            )}

            <button
              className="btn primary"
              type="submit"
              style={{ width: '100%', height: 40, fontSize: 14, fontWeight: 600, marginTop: 4 }}
              disabled={loading || !email || !password}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6 }}>
          No account? Ask your team lead.<br />
          <span style={{ opacity: 0.5 }}>Accounts are managed by the admin.</span>
        </div>
      </div>
    </div>
  );
}

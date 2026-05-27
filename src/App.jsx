import { useState, useEffect } from 'react'
import { TEAM, ACCENT_PRESETS, reportToday } from './data.jsx'
import { supabase, getProfile } from './lib/supabase.js'
import { useTweaks, TweaksPanel, TweakSection, TweakToggle } from './components/TweaksPanel.jsx'
import { Sidebar, Topbar, CommandPalette, Toast, ShortcutsPage } from './components/Shell.jsx'
import { MemberHome, LeadHome } from './pages/Home.jsx'
import { DailyReportPage } from './pages/Report.jsx'
import { EmailLogPage } from './pages/Emails.jsx'
import { AnalyticsPage, TeamPage, LeaderboardPage, ReviewPage, MemberDetailPanel, SettingsPage } from './pages/Rest.jsx'
import { BriefPage } from './pages/Brief.jsx'
import { LoginPage } from './pages/Login.jsx'

const TWEAK_DEFAULTS = { dark: true };

export default function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const theme = t.dark ? 'dark' : 'light';

  // Accent color
  const [accent, setAccentRaw] = useState(() => localStorage.getItem('relay-accent') || 'lime');
  function setAccent(id) {
    setAccentRaw(id);
    const preset = ACCENT_PRESETS.find(p => p.id === id) || ACCENT_PRESETS[0];
    document.documentElement.style.setProperty('--accent', preset.hex);
    document.documentElement.style.setProperty('--accent-ink', preset.ink);
    localStorage.setItem('relay-accent', id);
  }
  useEffect(() => { setAccent(accent); }, []); // apply on mount

  // Auth state
  const [authLoading, setAuthLoading] = useState(true);
  const [me, setMe] = useState(null);

  // App state
  const [route, setRoute] = useState('home');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [emailFocus, setEmailFocus] = useState(0);
  const [bulkPaste, setBulkPaste] = useState(0);

  const role = me?.role || 'member';
  const todayDone = me ? !!reportToday(me.id) : false;

  // Check session on mount and listen for auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) loadProfile(session.user.id);
      else setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) loadProfile(session.user.id);
      else { setMe(null); setAuthLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    try {
      const profile = await getProfile(userId);
      const teamMember = TEAM.find(m => m.id === profile.member_id);
      setMe(teamMember || null);
    } catch {
      setMe(null);
    } finally {
      setAuthLoading(false);
    }
  }

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  // Role class on body
  useEffect(() => {
    document.body.setAttribute('data-role', role);
  }, [role]);

  // Global hotkeys (only when logged in)
  useEffect(() => {
    if (!me) return;
    let gPressed = false;
    let gTimer = null;
    function onKey(e) {
      const tag = e.target.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(o => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setTweak('dark', !t.dark); return; }
      if (inField) return;
      if (e.key === '?') { e.preventDefault(); setRoute('shortcuts'); return; }
      if (e.key === '/') { e.preventDefault(); setCmdOpen(true); return; }
      if (gPressed) {
        const map = { h: 'home', r: 'report', e: 'emails', a: 'analytics', t: 'team' };
        const m = map[e.key.toLowerCase()];
        if (m) { e.preventDefault(); setRoute(m); }
        gPressed = false;
        clearTimeout(gTimer);
        return;
      }
      if (e.key.toLowerCase() === 'g') { gPressed = true; gTimer = setTimeout(() => { gPressed = false; }, 800); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [me, t.dark, setTweak]);

  function showToast(msg) { setToast(msg); }

  function openModal(action) {
    if (action.startsWith('toast:')) { showToast(action.slice(6)); }
    else if (action === 'toggleTheme') { setTweak('dark', !t.dark); }
    else if (action === 'focusEmail') { setEmailFocus(c => c + 1); }
    else if (action === 'bulkPaste') { setBulkPaste(c => c + 1); }
    else if (action.startsWith('focusMember:')) { setDetail(action.slice('focusMember:'.length)); }
  }

  function renderPage() {
    switch (route) {
      case 'home': return role === 'lead' ? <LeadHome me={me} setRoute={setRoute} /> : <MemberHome me={me} setRoute={setRoute} />;
      case 'report': return <DailyReportPage me={me} setRoute={setRoute} showToast={showToast} />;
      case 'emails': return <EmailLogPage me={me} setRoute={setRoute} showToast={showToast} focusEmailOnMount={emailFocus} bulkPasteOnMount={bulkPaste} />;
      case 'analytics': return <AnalyticsPage setRoute={setRoute} />;
      case 'team': return <TeamPage role={role} me={me} setRoute={setRoute} openDetailFor={setDetail} />;
      case 'leaderboard': return <LeaderboardPage setRoute={setRoute} openDetailFor={setDetail} />;
      case 'review': return <ReviewPage setRoute={setRoute} showToast={showToast} />;
      case 'settings': return <SettingsPage theme={theme} toggleTheme={() => setTweak('dark', !t.dark)} role={role} accent={accent} setAccent={setAccent} />;
      case 'shortcuts': return <ShortcutsPage />;
      case 'brief': return role === 'lead' ? <BriefPage /> : <MemberHome me={me} setRoute={setRoute} />;
      default: return <MemberHome me={me} setRoute={setRoute} />;
    }
  }

  // Loading splash while checking session
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'var(--accent)', color: 'var(--accent-ink)',
            display: 'grid', placeItems: 'center',
            fontSize: 20, fontWeight: 800,
          }}>R</div>
          <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>Loading…</div>
        </div>
      </div>
    );
  }

  // Not logged in — show login page
  if (!me) {
    return (
      <>
        <LoginPage />
        <Toast msg={toast} onDone={() => setToast(null)} />
        <TweaksPanel>
          <TweakSection label="Appearance" />
          <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak('dark', v)} />
        </TweaksPanel>
      </>
    );
  }

  // Logged in — full app
  return (
    <div className="app">
      <Sidebar route={route} setRoute={setRoute} role={role} me={me}
               openCmdK={() => setCmdOpen(true)} todayDone={todayDone}
               onLogout={() => supabase.auth.signOut()} />
      <div className="main">
        <Topbar route={route} role={role}
                theme={theme} toggleTheme={() => setTweak('dark', !t.dark)}
                openCmdK={() => setCmdOpen(true)}
                notifOpen={notifOpen} setNotifOpen={setNotifOpen}
                onLogout={() => supabase.auth.signOut()} />
        <div className="canvas" onClick={() => { if (notifOpen) setNotifOpen(false); }}>
          {renderPage()}
        </div>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)}
                      setRoute={setRoute} openModal={openModal} role={role} />

      {detail && (
        <div className="modal-back" onClick={() => setDetail(null)} style={{ background: 'rgba(0,0,0,.4)' }}>
          <MemberDetailPanel memberId={detail} onClose={() => setDetail(null)} setRoute={setRoute} />
        </div>
      )}

      <Toast msg={toast} onDone={() => setToast(null)} />

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak('dark', v)} />
      </TweaksPanel>
    </div>
  );
}

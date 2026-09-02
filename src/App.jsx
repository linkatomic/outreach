import { useState, useEffect, useRef } from 'react'
import { TEAM, ACCENT_PRESETS, reportToday, hasDualAccess } from './data.jsx'
import { LC_STAFF } from './pages/LiveChatTeam.jsx'
import { supabase, getProfile, getProfileByMemberId, saveUserAccent } from './lib/supabase.js'
import { useTweaks, TweaksPanel, TweakSection, TweakToggle } from './components/TweaksPanel.jsx'
import { Sidebar, Topbar, CommandPalette, Toast, ShortcutsPage } from './components/Shell.jsx'
import { MemberHome, LeadHome } from './pages/Home.jsx'
import { DailyReportPage } from './pages/Report.jsx'
import { EmailLogPage } from './pages/Emails.jsx'
import { AnalyticsPage, TeamPage, LeaderboardPage, ReviewPage, MemberDetailPanel, SettingsPage } from './pages/Rest.jsx'
import { BriefPage } from './pages/Brief.jsx'
import { LoginPage } from './pages/Login.jsx'
import { IdeasPage } from './pages/Ideas.jsx'
import { TasksPage } from './pages/Tasks.jsx'
import { ToolsPage } from './pages/Tools.jsx'
import { LiveChatHome } from './pages/LiveChatHome.jsx'
import { LiveChatTeam } from './pages/LiveChatTeam.jsx'
import { LiveChatToolsPage, LiveChatClients } from './pages/LiveChat.jsx'
import { LiveChatOrderSheet } from './pages/LiveChatOrderSheet.jsx'
import { OnlinePage } from './pages/OnlinePage.jsx'
import { LcHistory } from './pages/LcHistory.jsx'
import { LcNotion } from './pages/LcNotion.jsx'
import { LcNotionHistory } from './pages/LcNotionHistory.jsx'
import { LcGuide } from './pages/LcGuide.jsx'
import { AdminPage } from './pages/AdminPage.jsx'
import { UrlFetcherPage } from './pages/UrlFetcher.jsx'
import { DomainExtractorPage } from './pages/DomainExtractor.jsx'
import { AnchorExtractorPage } from './pages/AnchorExtractor.jsx'
import { PublicToolsPage } from './pages/PublicTools.jsx'

const TWEAK_DEFAULTS = { dark: true };

function applyAccentCssVars(id) {
  const preset = ACCENT_PRESETS.find(p => p.id === id) || ACCENT_PRESETS[0];
  document.documentElement.style.setProperty('--accent', preset.hex);
  document.documentElement.style.setProperty('--accent-ink', preset.ink);
}

export default function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const theme = t.dark ? 'dark' : 'light';

  // Auth state
  const [authLoading, setAuthLoading] = useState(true);
  const [me, setMe]       = useState(null);   // real logged-in user
  const userIdRef         = useRef(null);      // Supabase auth UUID for DB writes
  const [accent, setAccentRaw] = useState('lime');

  // Super-user impersonation — persisted in sessionStorage so token-refresh / page reload doesn't drop it
  const [impersonatedId, setImpersonatedIdRaw] = useState(
    () => sessionStorage.getItem('relay_impersonated') || null
  );
  function setImpersonatedId(id) {
    setImpersonatedIdRaw(id);
    if (id) sessionStorage.setItem('relay_impersonated', id);
    else sessionStorage.removeItem('relay_impersonated');
  }
  const superAccentRef = useRef('lime'); // remembers super's own accent for restoration

  // ── Presence (who's online) ─────────────────────────
  const presenceChanRef  = useRef(null)
  const routeRef         = useRef('home')
  const [onlineIds,     setOnlineIds]     = useState(new Set())
  const [presenceData,  setPresenceData]  = useState({})

  // App state
  const [route, setRoute]           = useState('home');
  const [dept, setDept]             = useState('outreach');
  const [cmdOpen, setCmdOpen]       = useState(false);
  const [toast, setToast]           = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [notifOpen, setNotifOpen]   = useState(false);
  const [detail, setDetail]         = useState(null);
  const [emailFocus, setEmailFocus] = useState(0);
  const [bulkPaste, setBulkPaste]   = useState(0);

  // All users across both departments (deduped by id) — used for super impersonation
  const ALL_USERS = [...TEAM, ...LC_STAFF].filter((m, i, a) => a.findIndex(x => x.id === m.id) === i);

  // Effective user: when super is impersonating, pages see the impersonated member
  const effectiveMe = (me?.role === 'super' && impersonatedId)
    ? { ...ALL_USERS.find(m => m.id === impersonatedId) }
    : me;

  // Role used for nav guards (reflects effectiveMe when impersonating)
  const role = effectiveMe?.role || 'member';
  const todayDone = effectiveMe ? !!reportToday(effectiveMe.id) : false;

  // livechat-only users always land in the livechat department
  useEffect(() => {
    if (role === 'livechat') setDept('livechat');
  }, [role]);

  // Keep routeRef current so presence can always read the latest route
  useEffect(() => { routeRef.current = route; }, [route]);

  // Set up Supabase Realtime presence channel when logged in
  useEffect(() => {
    if (!me) {
      if (presenceChanRef.current) { supabase.removeChannel(presenceChanRef.current); presenceChanRef.current = null; }
      setOnlineIds(new Set()); setPresenceData({});
      return;
    }
    const channel = supabase.channel('relay-presence');
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const ids = new Set(); const data = {};
      Object.values(state).forEach(arr => arr.forEach(p => {
        if (p.user_id) { ids.add(p.user_id); data[p.user_id] = p; }
      }));
      setOnlineIds(new Set(ids)); setPresenceData({ ...data });
    });
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ user_id: me.id, name: me.name, role: me.role, route: routeRef.current });
      }
    });
    presenceChanRef.current = channel;
    return () => { supabase.removeChannel(channel); presenceChanRef.current = null; };
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Broadcast route changes so the Active Users page shows what each person is doing
  useEffect(() => {
    const ch = presenceChanRef.current;
    if (!ch || !me) return;
    ch.track({ user_id: me.id, name: me.name, role: me.role, route }).catch(() => {});
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accent ─────────────────────────────────────────
  function setAccent(id) {
    setAccentRaw(id);
    applyAccentCssVars(id);
    if (!impersonatedId) {
      superAccentRef.current = id;
      // Per-user localStorage key — not shared between users on same browser
      if (me?.id) localStorage.setItem(`relay_accent_${me.id}`, id);
      // DB write for cross-device sync
      if (userIdRef.current) saveUserAccent(userIdRef.current, id).catch(() => {});
    }
  }

  // When impersonating, load that user's saved accent; restore own on exit
  useEffect(() => {
    if (!me || me.role !== 'super') return;
    if (!impersonatedId) {
      // Restore super's own accent
      setAccentRaw(superAccentRef.current);
      applyAccentCssVars(superAccentRef.current);
      return;
    }
    getProfileByMemberId(impersonatedId).then(profile => {
      const col = profile?.accent
        || localStorage.getItem(`relay_accent_${impersonatedId}`)
        || 'lime';
      setAccentRaw(col);
      applyAccentCssVars(col);
    }).catch(() => {
      const col = localStorage.getItem(`relay_accent_${impersonatedId}`) || 'lime';
      setAccentRaw(col);
      applyAccentCssVars(col);
    });
  }, [impersonatedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth ────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) loadProfile(session.user.id);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) loadProfile(session.user.id);
      else { setMe(null); setImpersonatedIdRaw(null); setAuthLoading(false); setAccentRaw('lime'); applyAccentCssVars('lime'); superAccentRef.current = 'lime'; }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(uid) {
    try {
      const profile = await getProfile(uid);
      // Resolve base member info — fall back for HR/super users not in TEAM array
      let base = TEAM.find(m => m.id === profile.member_id);
      if (!base) {
        base = {
          id: profile.member_id,
          name: profile.name || 'Unknown',
          short: profile.short || '??',
          color: profile.color || 'a',
          email: '',
        };
      }
      // DB role always wins (overrides TEAM array hardcoded role)
      const meObj = { ...base, role: profile.role || base.role || 'member' };
      setMe(meObj);
      userIdRef.current = uid;
      // Restore impersonation after token refresh (sessionStorage survives SIGNED_OUT→SIGNED_IN)
      if (meObj.role === 'super') {
        const saved = sessionStorage.getItem('relay_impersonated');
        if (saved) setImpersonatedIdRaw(saved);
      }

      // Load accent: localStorage is instant, DB is authoritative for cross-device
      // DB wins when present; localStorage is the reliable local fallback
      const dbAccent    = profile.accent;
      const localAccent = localStorage.getItem(`relay_accent_${profile.member_id}`);
      const savedAccent = dbAccent || localAccent || 'lime';
      setAccentRaw(savedAccent);
      applyAccentCssVars(savedAccent);
      superAccentRef.current = savedAccent;
      // Keep localStorage in sync so it's always current
      localStorage.setItem(`relay_accent_${profile.member_id}`, savedAccent);
      // If localStorage had it but DB didn't, write it back to DB
      if (!dbAccent && localAccent && uid) saveUserAccent(uid, localAccent).catch(() => {});

      // On token refresh, loadProfile re-runs and overwrites the impersonated accent.
      // Re-apply the impersonated user's accent if a session is still active.
      const activeImpersonation = meObj.role === 'super'
        ? sessionStorage.getItem('relay_impersonated')
        : null;
      if (activeImpersonation) {
        getProfileByMemberId(activeImpersonation).then(p => {
          const col = p?.accent || localStorage.getItem(`relay_accent_${activeImpersonation}`) || 'lime';
          setAccentRaw(col);
          applyAccentCssVars(col);
        }).catch(() => {
          const col = localStorage.getItem(`relay_accent_${activeImpersonation}`) || 'lime';
          setAccentRaw(col);
          applyAccentCssVars(col);
        });
      }
    } catch (err) {
      setMe(null);
      setLoginError(err?.message || 'Failed to load profile. Contact your admin.');
    } finally {
      setAuthLoading(false);
    }
  }

  // ── Theme ───────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.body.setAttribute('data-role', role);
  }, [role]);

  // ── Global hotkeys ──────────────────────────────────
  useEffect(() => {
    if (!me) return;
    let gPressed = false, gTimer = null;
    function onKey(e) {
      const tag = e.target.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(o => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setTweak('dark', !t.dark); return; }
      if (inField) return;
      if (e.key === '?') { e.preventDefault(); setRoute('shortcuts'); return; }
      if (e.key === '/') { e.preventDefault(); setCmdOpen(true); return; }
      if (gPressed) {
        const map = { h: 'home', r: 'report', e: 'emails', a: 'analytics', t: 'team', i: 'ideas', k: 'tasks', w: 'tools' };
        const dest = map[e.key.toLowerCase()];
        if (dest) { e.preventDefault(); setRoute(dest); }
        gPressed = false; clearTimeout(gTimer); return;
      }
      if (e.key.toLowerCase() === 'g') { gPressed = true; gTimer = setTimeout(() => { gPressed = false; }, 800); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [me, t.dark, setTweak]);

  function showToast(msg) { setToast(msg); }

  function openModal(action) {
    if (action.startsWith('toast:'))       showToast(action.slice(6));
    else if (action === 'toggleTheme')     setTweak('dark', !t.dark);
    else if (action === 'focusEmail')      setEmailFocus(c => c + 1);
    else if (action === 'bulkPaste')       setBulkPaste(c => c + 1);
    else if (action.startsWith('focusMember:')) setDetail(action.slice('focusMember:'.length));
  }

  function renderPage() {
    // Pages all receive effectiveMe so impersonation is transparent
    const m = effectiveMe;
    const isLcOnly = m.role === 'livechat' && !hasDualAccess(m.id);
    const isManager = ['lead', 'super', 'hr'].includes(m.role);

    // livechat-only users can't access outreach routes (dual-access livechat members are exempt)
    if (isLcOnly && !route.startsWith('lc-') && route !== 'settings' && route !== 'shortcuts') {
      return <LiveChatHome me={m} />;
    }

    // tools-only users get exactly the Tools page and nothing else — no exceptions, regardless
    // of what `route` holds (stale state, a keyboard shortcut, the command palette, etc.)
    if (m.role === 'tools-only') {
      return <ToolsPage me={m} role={role} />;
    }

    switch (route) {
      case 'home':       return isManager ? <LeadHome me={m} setRoute={setRoute} /> : <MemberHome me={m} setRoute={setRoute} />;
      case 'report':     return <DailyReportPage me={m} setRoute={setRoute} showToast={showToast} />;
      case 'emails':     return <EmailLogPage me={m} setRoute={setRoute} showToast={showToast} focusEmailOnMount={emailFocus} bulkPasteOnMount={bulkPaste} />;
      case 'analytics':  return <AnalyticsPage setRoute={setRoute} />;
      case 'team':       return <TeamPage role={role} me={m} setRoute={setRoute} openDetailFor={setDetail} />;
      case 'leaderboard': return <LeaderboardPage setRoute={setRoute} openDetailFor={setDetail} />;
      case 'review':     return <ReviewPage setRoute={setRoute} showToast={showToast} />;
      case 'settings':   return <SettingsPage theme={theme} toggleTheme={() => setTweak('dark', !t.dark)} role={role} accent={accent} setAccent={setAccent} />;
      case 'shortcuts':  return <ShortcutsPage />;
      case 'brief':      return isManager ? <BriefPage /> : <MemberHome me={m} setRoute={setRoute} />;
      case 'ideas':      return <IdeasPage me={m} showToast={showToast} />;
      case 'tasks':      return <TasksPage me={m} showToast={showToast} />;
      case 'tools':      return <ToolsPage me={m} role={role} />;
      case 'lc-home':    return <LiveChatHome me={m} />;
      case 'lc-clients': return <LiveChatClients me={m} />;
      case 'lc-orders':  return <LiveChatOrderSheet me={m} />;
      case 'lc-notion':         return <LcNotion me={m} />;
      case 'lc-notion-history': return <LcNotionHistory />;
      case 'lc-history':        return <LcHistory />;
      case 'lc-team':    return <LiveChatTeam />;
      case 'lc-guide':   return <LcGuide />;
      case 'admin':      return ['lead', 'super'].includes(me.role) ? <AdminPage /> : <MemberHome me={m} setRoute={setRoute} />;
      case 'online':     return ['lead', 'super'].includes(me.role)
                           ? <OnlinePage allUsers={ALL_USERS} onlineIds={onlineIds} presenceData={presenceData} />
                           : <MemberHome me={m} setRoute={setRoute} />;
      default:           return isLcOnly ? <LiveChatHome me={m} /> : <MemberHome me={m} setRoute={setRoute} />;
    }
  }

  // ── Public pages (no login required) ────────────────
  if (window.location.pathname === '/url-fetcher') {
    return <UrlFetcherPage />;
  }
  if (window.location.pathname === '/domain-extractor') {
    return <DomainExtractorPage />;
  }
  if (window.location.pathname === '/anchor-extractor') {
    return <AnchorExtractorPage />;
  }
  if (window.location.pathname === '/public') {
    return <PublicToolsPage />;
  }

  // ── Loading splash ───────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 800 }}>R</div>
          <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>Loading…</div>
        </div>
      </div>
    );
  }

  // ── Login ────────────────────────────────────────────
  if (!me) {
    return (
      <>
        <LoginPage profileError={loginError} onClearError={() => setLoginError(null)} />
        <Toast msg={toast} onDone={() => setToast(null)} />
        <TweaksPanel>
          <TweakSection label="Appearance" />
          <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak('dark', v)} />
        </TweaksPanel>
      </>
    );
  }

  // ── Full app ─────────────────────────────────────────
  return (
    <div className="app">
      <Sidebar route={route} setRoute={setRoute} role={role} me={me} allUsers={ALL_USERS}
               impersonatedId={impersonatedId}
               openCmdK={() => setCmdOpen(true)} todayDone={todayDone}
               onLogout={() => { setImpersonatedId(null); supabase.auth.signOut(); }}
               dept={dept} setDept={setDept} onlineIds={onlineIds} />
      <div className="main">
        <Topbar route={route} role={role}
                theme={theme} toggleTheme={() => setTweak('dark', !t.dark)}
                openCmdK={() => setCmdOpen(true)}
                notifOpen={notifOpen} setNotifOpen={setNotifOpen}
                onLogout={() => { setImpersonatedId(null); supabase.auth.signOut(); }}
                me={me} allUsers={ALL_USERS}
                impersonatedId={impersonatedId} setImpersonatedId={setImpersonatedId} />
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

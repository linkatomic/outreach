// app.jsx — Root App

const { useState: aUseState, useEffect: aUseEffect, useRef: aUseRef, useCallback: aUseCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const theme = t.dark ? 'dark' : 'light';

  const [route, setRoute] = aUseState('home');
  const [role, setRole] = aUseState('member'); // 'member' | 'lead'
  const [cmdOpen, setCmdOpen] = aUseState(false);
  const [toast, setToast] = aUseState(null);
  const [notifOpen, setNotifOpen] = aUseState(false);
  const [detail, setDetail] = aUseState(null); // memberId
  const [emailFocus, setEmailFocus] = aUseState(0); // bump counter
  const [bulkPaste, setBulkPaste] = aUseState(0);

  const me = role === 'lead' ? TEAM[0] : TEAM[1]; // Dev as lead, Neha as member sample
  const todayDone = !!reportToday(me.id);

  // Theme application
  aUseEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  // Role on body for CSS
  aUseEffect(() => {
    document.body.setAttribute('data-role', role);
  }, [role]);

  // Global hotkeys
  aUseEffect(() => {
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
      // G + letter chord
      if (gPressed) {
        const map = { h: 'home', r: 'report', e: 'emails', a: 'analytics', t: 'team' };
        const m = map[e.key.toLowerCase()];
        if (m) { e.preventDefault(); setRoute(m); }
        gPressed = false;
        clearTimeout(gTimer);
        return;
      }
      if (e.key.toLowerCase() === 'g') { gPressed = true; gTimer = setTimeout(() => gPressed = false, 800); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [t.dark, setTweak]);

  function showToast(msg) { setToast(msg); }
  function openModal(action) {
    if (action.startsWith('toast:')) { showToast(action.slice(6)); }
    else if (action === 'toggleTheme') { setTweak('dark', !t.dark); }
    else if (action === 'focusEmail') { setEmailFocus(c => c + 1); }
    else if (action === 'bulkPaste') { setBulkPaste(c => c + 1); }
    else if (action.startsWith('focusMember:')) { setDetail(action.slice('focusMember:'.length)); }
  }

  // Page render
  function renderPage() {
    switch (route) {
      case 'home': return role === 'lead' ? <LeadHome me={me} setRoute={setRoute} /> : <MemberHome me={me} setRoute={setRoute} />;
      case 'report': return <DailyReportPage me={me} setRoute={setRoute} showToast={showToast} />;
      case 'emails': return <EmailLogPage me={me} setRoute={setRoute} showToast={showToast} focusEmailOnMount={emailFocus} bulkPasteOnMount={bulkPaste} />;
      case 'analytics': return <AnalyticsPage setRoute={setRoute} />;
      case 'team': return <TeamPage role={role} me={me} setRoute={setRoute} openDetailFor={setDetail} />;
      case 'leaderboard': return <LeaderboardPage setRoute={setRoute} openDetailFor={setDetail} />;
      case 'review': return <ReviewPage setRoute={setRoute} showToast={showToast} />;
      case 'settings': return <SettingsPage theme={theme} toggleTheme={() => setTweak('dark', !t.dark)} role={role} />;
      case 'shortcuts': return <ShortcutsPage />;
      case 'brief': return <BriefPage />;
      default: return <MemberHome me={me} setRoute={setRoute} />;
    }
  }

  return (
    <div className="app">
      <Sidebar route={route} setRoute={setRoute} role={role} me={me}
               openCmdK={() => setCmdOpen(true)} todayDone={todayDone} />
      <div className="main">
        <Topbar route={route} role={role} setRole={setRole}
                theme={theme} toggleTheme={() => setTweak('dark', !t.dark)}
                openCmdK={() => setCmdOpen(true)}
                notifOpen={notifOpen} setNotifOpen={setNotifOpen} />
        <div className="canvas" onClick={() => { if (notifOpen) setNotifOpen(false); }}>
          {renderPage()}
        </div>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)}
                      setRoute={setRoute} openModal={openModal} role={role} />

      {detail && <div className="modal-back" onClick={() => setDetail(null)} style={{ background: 'rgba(0,0,0,.4)' }}>
        <MemberDetailPanel memberId={detail} onClose={() => setDetail(null)} setRoute={setRoute} />
      </div>}

      <Toast msg={toast} onDone={() => setToast(null)} />

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak('dark', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

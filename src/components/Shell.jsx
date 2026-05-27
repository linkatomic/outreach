import { useState, useEffect, useMemo, useRef } from 'react'
import { TEAM, Icon, fmtDateShort, fmtRel } from '../data.jsx'

// ────────────────────── Sidebar ──────────────────────
export function Sidebar({ route, setRoute, role, me, openCmdK, todayDone }) {
  const navItems = [
    { id: 'home',      label: 'Home',         icon: 'home',   kbd: 'G H' },
    { id: 'report',    label: 'Daily Report', icon: 'report', kbd: 'G R', badge: todayDone ? 'done' : 'todo' },
    { id: 'emails',    label: 'Email Log',    icon: 'mail',   kbd: 'G E' },
    { id: 'analytics', label: 'Analytics',    icon: 'chart',  kbd: 'G A' },
    { id: 'team',      label: 'Team',         icon: 'users',  kbd: 'G T' },
  ];
  const leadItems = [
    { id: 'review',      label: 'Review Queue', icon: 'eye',    badge: 3 },
    { id: 'leaderboard', label: 'Leaderboard',  icon: 'trophy' },
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <span>Relay</span>
        <span className="brand-meta">v0.4</span>
      </div>

      <div className="nav-section">
        <button className="btn" style={{ justifyContent: 'flex-start', padding: '6px 10px', height: 30, gap: 8 }}
                onClick={openCmdK}>
          <Icon name="search" size={14} />
          <span style={{ color: 'var(--text-faint)', fontSize: 12, fontWeight: 400 }}>Search or run…</span>
          <span style={{ marginLeft: 'auto' }} className="kbd">⌘K</span>
        </button>
      </div>

      <div className="nav-section">
        <div className="nav-section-title">Workspace</div>
        {navItems.map(it => (
          <div key={it.id}
               className={`nav-item ${route === it.id ? 'active' : ''}`}
               onClick={() => setRoute(it.id)}>
            <Icon name={it.icon} size={15} />
            <span>{it.label}</span>
            {it.badge === 'done' && <span className="badge" style={{ background: 'transparent', color: 'var(--accent)' }}>✓</span>}
            {it.badge === 'todo' && <span className="badge accent">!</span>}
          </div>
        ))}
      </div>

      {role === 'lead' && (
        <div className="nav-section">
          <div className="nav-section-title">Manage</div>
          {leadItems.map(it => (
            <div key={it.id}
                 className={`nav-item ${route === it.id ? 'active' : ''}`}
                 onClick={() => setRoute(it.id)}>
              <Icon name={it.icon} size={15} />
              <span>{it.label}</span>
              {typeof it.badge === 'number' && <span className="badge">{it.badge}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="nav-section">
        <div className="nav-section-title">More</div>
        <div className={`nav-item ${route === 'shortcuts' ? 'active' : ''}`} onClick={() => setRoute('shortcuts')}>
          <Icon name="keyboard" size={15} /><span>Shortcuts</span><span className="kbd" style={{ marginLeft: 'auto' }}>?</span>
        </div>
        <div className={`nav-item ${route === 'brief' ? 'active' : ''}`} onClick={() => setRoute('brief')}>
          <Icon name="layers" size={15} /><span>Design Brief</span>
        </div>
        <div className={`nav-item ${route === 'settings' ? 'active' : ''}`} onClick={() => setRoute('settings')}>
          <Icon name="settings" size={15} /><span>Settings</span>
        </div>
      </div>

      <div className="sidebar-foot">
        <div className={`avatar ${me.color}`}>{me.short}</div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{role === 'lead' ? 'Team Lead' : 'Member'}</div>
        </div>
      </div>
    </aside>
  );
}

// ────────────────────── Topbar ──────────────────────
export function Topbar({ route, role, theme, toggleTheme, openCmdK, notifOpen, setNotifOpen, onLogout }) {
  const crumbs = {
    home: ['Home'], report: ['Daily Report'], emails: ['Email Log'],
    analytics: ['Analytics'], team: ['Team'], review: ['Manage', 'Review Queue'],
    leaderboard: ['Manage', 'Leaderboard'], settings: ['Settings'],
    shortcuts: ['Shortcuts'], brief: ['Design Brief'],
  }[route] || ['Home'];

  return (
    <div className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span className="sep">/</span>}
            {i === crumbs.length - 1 ? <b>{c}</b> : <span>{c}</span>}
          </span>
        ))}
      </div>
      <span className="faint" style={{ fontSize: 11, marginLeft: 8 }}>
        · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </span>

      <div className="spacer"></div>

      <button className="search-trigger" onClick={openCmdK}>
        <Icon name="search" size={13} />
        <span>Search anything…</span>
        <span className="kbd" style={{ marginLeft: 'auto' }}>⌘K</span>
      </button>

      <button className="icon-btn" title="Notifications" onClick={() => setNotifOpen(o => !o)}>
        <Icon name="bell" size={15} />
        <span className="dot"></span>
      </button>
      <button className="icon-btn" title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggleTheme}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
      </button>
      <button className="icon-btn" title="Sign out" onClick={onLogout} style={{ color: 'var(--text-faint)' }}>
        <Icon name="arrow" size={15} style={{ transform: 'rotate(180deg)' }} />
      </button>

      {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}
    </div>
  );
}

function NotificationsPanel({ onClose }) {
  const items = [
    { who: 'Neha M', what: 'submitted daily report', t: '12m', neu: true, meta: '60 emails, 12 sites' },
    { who: 'Preeti S', what: 'pending report for today', t: '2h', neu: true },
    { who: 'System', what: 'Weekly summary ready for May 18–24', t: '4h', neu: true },
    { who: 'Keyur D', what: 'flagged a duplicate vendor entry', t: '1d', neu: false, meta: 'Acme Imports · 3 matches' },
    { who: 'Arjun M', what: 'hit weekly target (210 emails)', t: '1d', neu: false },
  ];
  return (
    <div className="notif-panel" onClick={(e) => e.stopPropagation()}>
      <div className="notif-head">
        <h4>Notifications</h4>
        <button className="btn ghost" onClick={onClose}><Icon name="x" size={12} /></button>
      </div>
      <div className="notif-list">
        {items.map((it, i) => (
          <div className="notif-row" key={i}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={it.neu ? 'new' : ''}><b style={{ fontWeight: 500 }}>{it.who}</b> <span className="muted">{it.what}</span></div>
              {it.meta && <div className="faint mono" style={{ fontSize: 11, marginTop: 2 }}>{it.meta}</div>}
            </div>
            <span className="t">{it.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────── Command Palette ──────────────────────
export function CommandPalette({ open, onClose, setRoute, openModal, role }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  const commands = useMemo(() => {
    const base = [
      { group: 'Navigate', cmds: [
        { id: 'go-home',      label: 'Go to Home',        icon: 'home',   kbd: ['G','H'], do: () => setRoute('home') },
        { id: 'go-report',    label: 'Go to Daily Report', icon: 'report', kbd: ['G','R'], do: () => setRoute('report') },
        { id: 'go-emails',    label: 'Go to Email Log',   icon: 'mail',   kbd: ['G','E'], do: () => setRoute('emails') },
        { id: 'go-analytics', label: 'Go to Analytics',   icon: 'chart',  kbd: ['G','A'], do: () => setRoute('analytics') },
        { id: 'go-team',      label: 'Go to Team',        icon: 'users',  kbd: ['G','T'], do: () => setRoute('team') },
      ]},
      { group: 'Actions', cmds: [
        { id: 'new-email',  label: 'Log new email',           desc: 'Add a Missive entry',      icon: 'plus',   kbd: ['N'], do: () => { setRoute('emails'); setTimeout(() => openModal('focusEmail'), 50); } },
        { id: 'file-report',label: "File today's report",     desc: 'Open the quick-log',        icon: 'flash',  kbd: ['R'], do: () => setRoute('report') },
        { id: 'bulk-paste', label: 'Bulk paste from Missive', desc: 'Paste 20+ links at once',   icon: 'upload', kbd: ['B'], do: () => { setRoute('emails'); setTimeout(() => openModal('bulkPaste'), 50); } },
        { id: 'export',     label: 'Export current view as CSV',                                  icon: 'download',kbd: ['E'],do: () => openModal('toast:Exported 312 rows to CSV') },
      ]},
      { group: 'Jump to person', cmds: TEAM.map(m => ({
        id: 'p-' + m.id, label: m.name, desc: m.role === 'lead' ? 'Team Lead' : 'Member',
        icon: 'users', do: () => { setRoute('team'); openModal('focusMember:' + m.id); }
      }))},
    ];
    if (role === 'lead') {
      base[0].cmds.push({ id: 'go-review', label: 'Go to Review Queue', icon: 'eye',    do: () => setRoute('review') });
      base[0].cmds.push({ id: 'go-ldr',    label: 'Go to Leaderboard',  icon: 'trophy', do: () => setRoute('leaderboard') });
    }
    base.push({ group: 'Settings', cmds: [
      { id: 'shortcuts', label: 'Show keyboard shortcuts', icon: 'keyboard', kbd: ['?'], do: () => setRoute('shortcuts') },
      { id: 'theme',     label: 'Toggle theme',            icon: 'sun',                  do: () => openModal('toggleTheme') },
    ]});
    return base;
  }, [role, setRoute, openModal]);

  const filtered = useMemo(() => {
    if (!q) return commands;
    const ql = q.toLowerCase();
    return commands.map(g => ({
      ...g,
      cmds: g.cmds.filter(c => c.label.toLowerCase().includes(ql) || (c.desc || '').toLowerCase().includes(ql))
    })).filter(g => g.cmds.length);
  }, [q, commands]);

  const flat = useMemo(() => filtered.flatMap(g => g.cmds), [filtered]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); flat[sel] && (flat[sel].do(), onClose()); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  if (!open) return null;
  let idx = -1;
  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="cmdk-input">
          <Icon name="search" size={16} />
          <input ref={inputRef} placeholder="Type a command, page, or person…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="kbd">esc</span>
        </div>
        <div className="cmdk-list">
          {filtered.map(g => (
            <div key={g.group}>
              <div className="cmdk-group-title">{g.group}</div>
              {g.cmds.map(c => {
                idx++; const isSel = idx === sel;
                return (
                  <div key={c.id} className={`cmdk-item ${isSel ? 'sel' : ''}`}
                       onMouseEnter={() => setSel(idx)}
                       onClick={() => { c.do(); onClose(); }}>
                    <Icon name={c.icon} size={14} />
                    <span>{c.label}</span>
                    {c.desc && <span className="desc">{c.desc}</span>}
                    {c.kbd && <span className="kbd-row">{c.kbd.map((k,i) => <span className="kbd" key={i}>{k}</span>)}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <div className="empty">No matches for "{q}"</div>}
        </div>
        <div className="cmdk-foot">
          <span className="grp"><span className="kbd">↑↓</span> navigate</span>
          <span className="grp"><span className="kbd">↵</span> select</span>
          <span className="grp"><span className="kbd">esc</span> close</span>
          <span className="spacer"></span>
          <span className="grp"><Icon name="cmd" size={11} /> tip — try "g r" or "log email"</span>
        </div>
      </div>
    </div>
  );
}

// ────────────────────── Toast ──────────────────────
export function Toast({ msg, onDone }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  return (
    <div className="toast">
      <span className="ok"><Icon name="check" size={14} /></span>
      <span>{msg}</span>
    </div>
  );
}

// ────────────────────── Shortcut help page ──────────────────────
export function ShortcutsPage() {
  const groups = [
    { title: 'Global', items: [
      ['Open command palette', '⌘ K'],
      ['Search', '/'],
      ['Toggle theme', '⌘ ⇧ L'],
      ['Show this page', '?'],
    ]},
    { title: 'Navigate', items: [
      ['Home', 'G H'],
      ['Daily Report', 'G R'],
      ['Email Log', 'G E'],
      ['Analytics', 'G A'],
      ['Team', 'G T'],
    ]},
    { title: 'Daily Report', items: [
      ['Enter value', '↵'],
      ['Skip metric', 'TAB'],
      ['Go back one step', '⌫⌫ (double)'],
      ['Use ÷ +/− for nudge', '+ / −'],
    ]},
    { title: 'Email Log', items: [
      ['New entry', 'N'],
      ['Bulk paste', 'B'],
      ['Move to next field', 'TAB'],
      ['Save row', '↵'],
      ['Delete row', '⌘ ⌫'],
    ]},
  ];
  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <div><h1>Keyboard Shortcuts</h1><div className="sub">Everything Relay can do without your mouse.</div></div>
      </div>
      <div className="grid grid-2">
        {groups.map(g => (
          <div className="card" key={g.title}>
            <div className="card-head"><h3>{g.title}</h3></div>
            <div className="card-pad">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {g.items.map(([l, k], i) => (
                  <div className="shc-row" key={i}>
                    <span className="lbl">{l}</span>
                    <span>{k.split(' ').map((kk, j) => <span className="kbd" key={j} style={{ marginLeft: j ? 4 : 0 }}>{kk}</span>)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from 'react'
import { TEAM, Icon, fmtDateShort, fmtRel } from '../data.jsx'
import { loadAllReportsForDate } from '../lib/supabase.js'

// ────────────────────── Sidebar ──────────────────────
export function Sidebar({ route, setRoute, role, me, allUsers = [], impersonatedId, openCmdK, todayDone, onLogout, dept, setDept, onlineIds = new Set() }) {
  const navItems = [
    { id: 'home',      label: 'Home',         icon: 'home',   kbd: 'G H' },
    { id: 'report',    label: 'Daily Report', icon: 'report', kbd: 'G R', badge: todayDone ? 'done' : 'todo' },
    { id: 'emails',    label: 'Email Log',    icon: 'mail',   kbd: 'G E' },
    { id: 'analytics', label: 'Analytics',    icon: 'chart',  kbd: 'G A' },
    { id: 'team',      label: 'Team',         icon: 'users',  kbd: 'G T' },
    { id: 'ideas',     label: 'Ideas Board',  icon: 'flash',  kbd: 'G I' },
    { id: 'tasks',     label: 'Tasks',        icon: 'check',  kbd: 'G K' },
    { id: 'tools',     label: 'Tools',        icon: 'tool',   kbd: 'G W' },
  ];
  const leadItems = [
    { id: 'review',      label: 'Review Queue', icon: 'eye',    badge: 3 },
    { id: 'leaderboard', label: 'Leaderboard',  icon: 'trophy' },
    { id: 'brief',       label: 'Design Brief', icon: 'layers' },
  ];
  const lcNavItems = [
    { id: 'lc-home',    label: 'Home',         icon: 'home' },
    { id: 'lc-clients', label: 'Clients',       icon: 'users' },
    { id: 'lc-orders',  label: 'Order Sheet',   icon: 'download' },
    { id: 'lc-team',    label: 'Team',          icon: 'users' },
  ];

  // Only lead/super (the two specific admin roles) can see Active Users
  const showActiveUsers = (me.role === 'lead' || me.role === 'super') && !impersonatedId;

  // Who can switch departments
  const canSwitchDept = ['lead', 'super', 'hr'].includes(me.role) && !impersonatedId;

  // Show manage section for: lead, hr, super (when not impersonating), or impersonating a lead
  const showManageItems = (me.role === 'lead'
    || me.role === 'hr'
    || (me.role === 'super' && !impersonatedId)
    || role === 'lead') && dept === 'outreach';

  // livechat-role users always see LC nav regardless of dept state
  const showLcNav = dept === 'livechat' || me.role === 'livechat';

  // Identity shown in footer: impersonated user or real user
  const displayUser = impersonatedId
    ? allUsers.find(m => m.id === impersonatedId) || me
    : me;
  const displayRoleLabel = impersonatedId
    ? (displayUser.role === 'lead' ? 'Team Lead' : 'Member')
    : me.role === 'super' ? 'Super Admin'
    : me.role === 'hr' ? 'HR'
    : me.role === 'lead' ? 'Team Lead' : 'Member';

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <span>Relay</span>
        <span className="brand-meta">v0.4</span>
      </div>

      {/* Department switcher — only for lead/super */}
      {canSwitchDept && (
        <div className="nav-section">
          <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: 3, gap: 3 }}>
            {[{ id: 'outreach', label: 'Outreach' }, { id: 'livechat', label: 'Live Chat' }].map(d => (
              <button key={d.id} onClick={() => { setDept(d.id); setRoute(d.id === 'livechat' ? 'lc-home' : 'home') }}
                style={{ flex: 1, height: 26, borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: dept === d.id ? 700 : 400, background: dept === d.id ? 'var(--accent)' : 'transparent', color: dept === d.id ? 'var(--accent-ink)' : 'var(--text-faint)', transition: 'background .15s, color .15s' }}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="nav-section">
        <button className="btn" style={{ justifyContent: 'flex-start', padding: '6px 10px', height: 30, gap: 8 }}
                onClick={openCmdK}>
          <Icon name="search" size={14} />
          <span style={{ color: 'var(--text-faint)', fontSize: 12, fontWeight: 400 }}>Search or run…</span>
          <span style={{ marginLeft: 'auto' }} className="kbd">⌘K</span>
        </button>
      </div>

      {showLcNav ? (
        <div className="nav-section">
          <div className="nav-section-title">Live Chat</div>
          {lcNavItems.map(it => (
            <div key={it.id} className={`nav-item ${route === it.id ? 'active' : ''}`} onClick={() => setRoute(it.id)}>
              <Icon name={it.icon} size={15} />
              <span>{it.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="nav-section">
            <div className="nav-section-title">Workspace</div>
            {navItems.map(it => (
              <div key={it.id} className={`nav-item ${route === it.id ? 'active' : ''}`} onClick={() => setRoute(it.id)}>
                <Icon name={it.icon} size={15} />
                <span>{it.label}</span>
                {it.badge === 'done' && <span className="badge" style={{ background: 'transparent', color: 'var(--accent)' }}>✓</span>}
                {it.badge === 'todo' && <span className="badge accent">!</span>}
              </div>
            ))}
          </div>

          {showManageItems && (
            <div className="nav-section">
              <div className="nav-section-title">Manage</div>
              {leadItems.map(it => (
                <div key={it.id} className={`nav-item ${route === it.id ? 'active' : ''}`} onClick={() => setRoute(it.id)}>
                  <Icon name={it.icon} size={15} />
                  <span>{it.label}</span>
                  {typeof it.badge === 'number' && <span className="badge">{it.badge}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showActiveUsers && (
        <div className="nav-section">
          <div className="nav-section-title">Admin</div>
          <div className={`nav-item ${route === 'online' ? 'active' : ''}`} onClick={() => setRoute('online')}>
            <Icon name="activity" size={15} />
            <span>Active Users</span>
            {onlineIds.size > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.2)', borderRadius: 8, padding: '1px 6px' }}>
                {onlineIds.size}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="nav-section">
        <div className="nav-section-title">More</div>
        <div className={`nav-item ${route === 'shortcuts' ? 'active' : ''}`} onClick={() => setRoute('shortcuts')}>
          <Icon name="keyboard" size={15} /><span>Shortcuts</span><span className="kbd" style={{ marginLeft: 'auto' }}>?</span>
        </div>
        <div className={`nav-item ${route === 'settings' ? 'active' : ''}`} onClick={() => setRoute('settings')}>
          <Icon name="settings" size={15} /><span>Settings</span>
        </div>
      </div>

      <div className="sidebar-foot">
        {impersonatedId && (
          <div style={{ padding: '4px 8px 8px', fontSize: 11, color: 'var(--accent)', background: 'rgba(210,254,92,.06)', borderRadius: 6, border: '1px solid rgba(210,254,92,.15)', marginBottom: 4 }}>
            👁 Viewing as {displayUser.name}
          </div>
        )}
        <div className="sidebar-foot-identity">
          <div className={`avatar ${displayUser.color}`}>{displayUser.short}</div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayUser.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{displayRoleLabel}</div>
          </div>
        </div>
        <button className="signout-btn" onClick={onLogout}>
          <Icon name="arrow" size={13} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

// ────────────────────── Topbar ──────────────────────
export function Topbar({ route, role, theme, toggleTheme, openCmdK, notifOpen, setNotifOpen, onLogout, me, allUsers = [], impersonatedId, setImpersonatedId }) {
  const crumbs = {
    home: ['Home'], report: ['Daily Report'], emails: ['Email Log'],
    analytics: ['Analytics'], team: ['Team'], review: ['Manage', 'Review Queue'],
    leaderboard: ['Manage', 'Leaderboard'], settings: ['Settings'],
    shortcuts: ['Shortcuts'], brief: ['Design Brief'],
    'lc-home': ['Live Chat', 'Home'], 'lc-team': ['Live Chat', 'Team'],
    'lc-clients': ['Live Chat', 'Clients'], 'lc-orders': ['Live Chat', 'Order Sheet'],
    online: ['Admin', 'Active Users'],
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

      {/* Super-user impersonation switcher */}
      {me?.role === 'super' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
          {impersonatedId ? (
            <>
              <span style={{ fontSize: 11, color: 'var(--accent)' }}>
                👁 {allUsers.find(m => m.id === impersonatedId)?.name}
              </span>
              <button className="btn ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }}
                      onClick={() => setImpersonatedId(null)}>Exit</button>
            </>
          ) : (
            <select className="input" style={{ height: 28, fontSize: 12, width: 150, cursor: 'pointer' }}
                    value="" onChange={e => e.target.value && setImpersonatedId(e.target.value)}>
              <option value="">Switch to user…</option>
              {allUsers.filter(m => m.id !== me.id && m.role !== 'super').map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
              ))}
            </select>
          )}
        </div>
      )}

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

      {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} me={me} role={role} />}
    </div>
  );
}

function NotificationsPanel({ onClose, me, role }) {
  const [reports, setReports] = useState(null) // null = loading

  useEffect(() => {
    const today = new Date()
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
    loadAllReportsForDate(dateStr)
      .then(data => setReports(data || []))
      .catch(() => setReports([]))
  }, [])

  const isLead = ['lead', 'super'].includes(role)
  const members = TEAM.filter(m => !m.neelOnly || m.id === 'neel')

  const submittedMap = new Map((reports || []).map(r => [r.member_id, r]))

  // For members: only show their own status
  // For leads: show everyone — submitted + pending
  const items = isLead
    ? members.map(m => {
        const rep = submittedMap.get(m.id)
        return rep
          ? { member: m, submitted: true,  total: rep.total, createdAt: rep.created_at }
          : { member: m, submitted: false }
      })
    : me
      ? (() => {
          const rep = submittedMap.get(me.id)
          return [rep
            ? { member: me, submitted: true, total: rep.total, createdAt: rep.created_at }
            : { member: me, submitted: false }]
        })()
      : []

  // Sort: submitted first (most recent first), then pending
  const sorted = [...items].sort((a, b) => {
    if (a.submitted !== b.submitted) return a.submitted ? -1 : 1
    if (a.createdAt && b.createdAt) return new Date(b.createdAt) - new Date(a.createdAt)
    return 0
  })

  function relTime(ts) {
    if (!ts) return ''
    const diff = Date.now() - new Date(ts).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1)  return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  const submittedCount = sorted.filter(x => x.submitted).length
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="notif-panel" onClick={e => e.stopPropagation()}>
      <div className="notif-head">
        <div>
          <h4 style={{ margin: 0 }}>Today's Reports</h4>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{todayLabel}</div>
        </div>
        <button className="btn ghost" onClick={onClose}><Icon name="x" size={12} /></button>
      </div>
      <div className="notif-list">
        {reports === null ? (
          <div style={{ padding: '16px 14px', fontSize: 13, color: 'var(--text-faint)' }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '16px 14px', fontSize: 13, color: 'var(--text-faint)' }}>No data yet for today.</div>
        ) : sorted.map(({ member: m, submitted, total, createdAt }) => (
          <div className="notif-row" key={m.id} style={{ alignItems: 'center' }}>
            <div className={`avatar sm ${m.color}`} style={{ flexShrink: 0 }}>{m.short}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{m.name}</div>
              <div style={{ fontSize: 11, color: submitted ? 'var(--accent)' : '#f59e0b', marginTop: 1 }}>
                {submitted ? `Submitted · ${total} total` : 'Pending — not submitted yet'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {submitted
                ? <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{relTime(createdAt)}</span>
                : <span style={{ fontSize: 18 }}>⏳</span>
              }
            </div>
          </div>
        ))}
      </div>
      {isLead && reports !== null && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-faint)' }}>
          {submittedCount} of {sorted.length} submitted today
        </div>
      )}
    </div>
  )
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
        { id: 'go-ideas',     label: 'Go to Ideas Board', icon: 'flash',  kbd: ['G','I'], do: () => setRoute('ideas') },
        { id: 'go-tasks',     label: 'Go to Tasks',       icon: 'check',  kbd: ['G','K'], do: () => setRoute('tasks') },
        { id: 'go-tools',     label: 'Go to Tools',       icon: 'tool',   kbd: ['G','W'], do: () => setRoute('tools') },
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

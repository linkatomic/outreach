import { useState, useEffect, useMemo } from 'react'
import { TEAM, ACCENT_PRESETS, Icon, todayISO, isoNDaysAgo, fmtDateShort } from '../data.jsx'
import { supabase, loadEmailLogsByDateRange } from '../lib/supabase.js'
import { Sparkline, LineChart } from './Home.jsx'

// ──────────────── ANALYTICS ────────────────
export function AnalyticsPage({ setRoute }) {
  const [range, setRange]           = useState('14d');
  const [customDate, setCustomDate] = useState(todayISO());
  const [emailLogs, setEmailLogs]   = useState([]);
  const [loading, setLoading]       = useState(true);

  const members     = TEAM.filter(m => m.role === 'member');
  const isSingleDay = range === 'today' || range === 'date';
  const days        = isSingleDay ? 1 : range === '7d' ? 7 : range === '14d' ? 14 : range === '30d' ? 30 : 90;
  // chartStart: first day shown in chart (days-1 ago → days points ending today)
  const chartStart  = range === 'today' ? todayISO() : range === 'date' ? customDate : isoNDaysAgo(days - 1);
  const rangeEnd    = isSingleDay ? chartStart : null;
  // fetchStart: always fetch ≥14 days back so comparison arrows have prior-period data
  const fetchStart  = isSingleDay ? chartStart : isoNDaysAgo(Math.max(days, 14));
  const rangeLabel  = range === 'today' ? 'Today' : range === 'date' ? fmtDateShort(customDate) : range;

  useEffect(() => {
    setLoading(true);
    loadEmailLogsByDateRange(fetchStart, rangeEnd)
      .then(setEmailLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchStart, rangeEnd]);

  const trend = useMemo(() => {
    const byDate = {};
    emailLogs.forEach(e => { byDate[e.date] = (byDate[e.date] || 0) + 1 + (e.replies || 0); });
    if (isSingleDay) return [{ date: chartStart, count: byDate[chartStart] || 0 }];
    // days points: from chartStart (days-1 ago) through today
    return Array.from({ length: days }, (_, i) => {
      const d = isoNDaysAgo(days - 1 - i);
      return { date: d, count: byDate[d] || 0 };
    });
  }, [emailLogs, range, customDate]);

  const totalEmails = trend.reduce((s, d) => s + d.count, 0);

  const memberStats = useMemo(() => {
    const cmpStart  = isSingleDay ? chartStart : isoNDaysAgo(7);
    const prevStart = isoNDaysAgo(14);
    return members.map(m => {
      const my = emailLogs.filter(e => e.member_id === m.id);
      const week     = my.filter(e => isSingleDay ? e.date === chartStart : e.date >= cmpStart).reduce((s, e) => s + 1 + (e.replies || 0), 0);
      const prevWeek = isSingleDay ? 0 : my.filter(e => e.date >= prevStart && e.date < cmpStart).reduce((s, e) => s + 1 + (e.replies || 0), 0);
      const delta    = (isSingleDay || prevWeek === 0) ? null : Math.round(((week - prevWeek) / prevWeek) * 100);
      return { m, week, delta };
    });
  }, [emailLogs, range, customDate]);

  const compMax = Math.max(...memberStats.map(x => x.week), 1);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">Team email productivity and member comparison.</div>
        </div>
        <div className="actions">
          <span className="seg">
            <button className={range === 'today' ? 'on' : ''} onClick={() => setRange('today')}>Today</button>
            {['7d', '14d', '30d', '90d'].map(r => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
            ))}
            <button className={range === 'date' ? 'on' : ''} onClick={() => setRange('date')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="calendar" size={11} />{range === 'date' ? fmtDateShort(customDate) : 'Date'}
            </button>
          </span>
          {range === 'date' && (
            <input type="date" className="input" value={customDate} max={todayISO()}
              onChange={e => e.target.value && setCustomDate(e.target.value)}
              style={{ width: 148, fontFamily: 'var(--font-mono)', fontSize: 13, cursor: 'pointer' }} />
          )}
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}><span className="muted">Loading…</span></div>
      ) : (
        <>
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="kpi">
              <div className="kpi-label">Total emails · {rangeLabel}</div>
              <div className="kpi-value">{totalEmails.toLocaleString()}</div>
              <Sparkline data={trend.map(d => d.count)} />
            </div>
            <div className="kpi">
              <div className="kpi-label">Avg emails / member / day</div>
              <div className="kpi-value">{members.length > 0 && days > 0 ? Math.round(totalEmails / members.length / days) : 0}</div>
              <div className="kpi-target">based on {rangeLabel}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>Email volume — {rangeLabel}</h3>
              <span className="chip"><span className="dot-status accent"></span>Team total</span>
            </div>
            <div className="chart-wrap"><LineChart data={trend} height={260} /></div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>Member comparison · {isSingleDay ? rangeLabel : '7-day'}</h3>
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              {[...memberStats].sort((a, b) => b.week - a.week).map(({ m, week, delta }) => (
                <div key={m.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className={`avatar ${m.color}`}>{m.short}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                    <div className="bar thin" style={{ marginTop: 6, width: '100%' }}>
                      <div className="bar-fill" style={{ width: Math.min(100, (week / compMax) * 100) + '%' }}></div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="mono" style={{ fontSize: 15, letterSpacing: '-0.02em' }}>{week}</div>
                    {delta !== null && (
                      <div className={`kpi-delta ${delta >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10, justifyContent: 'flex-end' }}>
                        <Icon name={delta >= 0 ? 'arrowUp' : 'arrowDown'} size={9} />{Math.abs(delta)}%
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────── TREND BADGE ────────────────
function TrendBadge({ label, delta }) {
  if (delta === null) {
    return <span className="chip" style={{ fontSize: 10, padding: '2px 7px' }}>{label} —</span>;
  }
  const good = delta > 10, bad = delta < -10;
  const sign = delta > 0 ? '+' : '';
  return (
    <span className={`chip ${good ? 'ok' : bad ? 'danger' : ''}`} style={{ fontSize: 10, padding: '2px 7px' }}>
      {label} {good ? '↑' : bad ? '↓' : '≈'} {sign}{delta}%
    </span>
  );
}

// ──────────────── TEAM PAGE ────────────────
export function TeamPage({ role, me, setRoute, openDetailFor }) {
  const [emailLogs, setEmailLogs] = useState([]);
  const [loading, setLoading]     = useState(true);
  const today = todayISO();

  useEffect(() => {
    // 60 days: today + 29 days current month + 30 days prior month for monthly delta
    loadEmailLogsByDateRange(isoNDaysAgo(60))
      .then(setEmailLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [today]);

  function getMemberStats(memberId) {
    const my = emailLogs.filter(e => e.member_id === memberId);
    const cnt = (fn) => my.filter(fn).reduce((s, e) => s + 1 + (e.replies || 0), 0);
    const diff = (curr, prev) => prev === 0 ? null : Math.round(((curr - prev) / prev) * 100);

    const todayCount  = cnt(e => e.date === today);
    const yestCount   = cnt(e => e.date === isoNDaysAgo(1));
    const weekCount   = cnt(e => e.date >= isoNDaysAgo(6));   // 7 days incl. today
    const prevWk      = cnt(e => e.date >= isoNDaysAgo(13) && e.date < isoNDaysAgo(6));
    const monthCount  = cnt(e => e.date >= isoNDaysAgo(29));  // 30 days incl. today
    const prevMo      = cnt(e => e.date >= isoNDaysAgo(59) && e.date < isoNDaysAgo(29));

    const dayDelta   = diff(todayCount,  yestCount);
    const weekDelta  = diff(weekCount,   prevWk);
    const monthDelta = diff(monthCount,  prevMo);

    const spark = Array.from({ length: 14 }, (_, i) =>
      cnt(e => e.date === isoNDaysAgo(13 - i))
    );
    return { todayCount, weekCount, monthCount, dayDelta, weekDelta, monthDelta, spark };
  }

  const members = TEAM;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="sub">{members.length} members · time zone IST</div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => setRoute('leaderboard')}><Icon name="trophy" size={12} />Leaderboard</button>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}><span className="muted">Loading…</span></div>
      ) : (
        <div className="grid grid-3">
          {members.map(m => {
            const isMe = m.id === me.id;
            const { todayCount, weekCount, monthCount, dayDelta, weekDelta, monthDelta, spark } = getMemberStats(m.id);
            return (
              <div key={m.id} className="card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => openDetailFor(m.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div className={`avatar lg ${m.color}`}>{m.short}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {m.name}
                      {isMe && <span className="chip">you</span>}
                      {m.role === 'lead' && <span className="chip accent">lead</span>}
                    </div>
                    <div className="faint" style={{ fontSize: 11 }}>{m.email}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
                  <div>
                    <div className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Today</div>
                    <div className="mono" style={{ fontSize: 16, fontWeight: 500 }}>{todayCount}<span className="faint" style={{ fontSize: 11 }}>/40</span></div>
                  </div>
                  <div>
                    <div className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>7d</div>
                    <div className="mono" style={{ fontSize: 16, fontWeight: 500 }}>{weekCount}</div>
                  </div>
                  <div>
                    <div className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>30d</div>
                    <div className="mono" style={{ fontSize: 16, fontWeight: 500 }}>{monthCount}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
                  <TrendBadge label="Day"   delta={dayDelta} />
                  <TrendBadge label="Week"  delta={weekDelta} />
                  <TrendBadge label="Month" delta={monthDelta} />
                </div>

                <Sparkline data={spark} height={28} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────── LEADERBOARD ────────────────
function isoMonthStart(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function isoMonthEnd(year, month) {
  const d = new Date(year, month, 0) // day 0 of next month = last day of this month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtMonthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function LeaderboardPage({ setRoute, openDetailFor }) {
  const now = new Date();
  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [emailLogs, setEmailLogs] = useState([]);
  const [loading, setLoading]     = useState(true);

  const members = TEAM.filter(m => m.role === 'member');
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1;

  function prevMonth() {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (isCurrentMonth) return;
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1); }
    else setViewMonth(m => m + 1);
  }

  useEffect(() => {
    setLoading(true);
    const start = isoMonthStart(viewYear, viewMonth);
    const end   = isoMonthEnd(viewYear, viewMonth);
    loadEmailLogsByDateRange(start, end)
      .then(setEmailLogs)
      .catch(() => {}).finally(() => setLoading(false));
  }, [viewYear, viewMonth]);

  const scored = useMemo(() => {
    return members.map(m => {
      const emails = emailLogs.filter(e => e.member_id === m.id)
        .reduce((s, e) => s + 1 + (e.replies || 0), 0);
      return { m, score: emails, emails };
    }).sort((a, b) => b.score - a.score);
  }, [emailLogs, members]);

  const max = scored[0]?.score || 1;
  const monthLabel = fmtMonthLabel(viewYear, viewMonth);

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <div className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <div className="sub">Friendly competition · soft targets, not hard ranks.</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ padding: '14px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn ghost" style={{ width: 28, height: 28, padding: 0, fontSize: 16 }} onClick={prevMonth} title="Previous month">‹</button>
            <span style={{ fontWeight: 600, fontSize: 15, minWidth: 140, textAlign: 'center' }}>{monthLabel}</span>
            <button className="btn ghost" style={{ width: 28, height: 28, padding: 0, fontSize: 16, opacity: isCurrentMonth ? 0.3 : 1 }}
                    onClick={nextMonth} disabled={isCurrentMonth} title="Next month">›</button>
          </div>
          {isCurrentMonth && <span className="chip accent" style={{ fontSize: 11 }}>Current month</span>}
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}><span className="muted">Loading…</span></div>
        ) : (
          <div className="card-pad">
            {scored.map(({ m, score, emails }, i) => (
              <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr 90px', gap: 16, padding: '14px 4px', borderBottom: i < scored.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center', cursor: 'pointer' }}
                   onClick={() => openDetailFor(m.id)}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 6, background: i === 0 ? 'var(--accent)' : 'var(--surface-2)', color: i === 0 ? 'var(--accent-ink)' : 'var(--text-dim)', fontWeight: 600 }}>{i + 1}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className={`avatar lg ${m.color}`}>{m.short}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
                    <div className="faint mono" style={{ fontSize: 11 }}>{emails} emails</div>
                  </div>
                </div>
                <div className="bar thick">
                  <div className="bar-fill" style={{ width: ((score / max) * 100) + '%' }}></div>
                </div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em', textAlign: 'right' }}>{score}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ──────────────── MEMBER DETAIL PANEL ────────────────
export function MemberDetailPanel({ memberId, onClose, setRoute }) {
  const m = TEAM.find(mm => mm.id === memberId);
  const [emailLogs, setEmailLogs] = useState([]);
  const [loading, setLoading]     = useState(true);
  const today = todayISO();

  useEffect(() => {
    if (!m) return;
    loadEmailLogsByDateRange(isoNDaysAgo(30))
      .then(logs => setEmailLogs(logs.filter(e => e.member_id === memberId)))
      .catch(() => {}).finally(() => setLoading(false));
  }, [memberId]);

  const todayCount = emailLogs.filter(e => e.date === today).reduce((s, e) => s + 1 + (e.replies || 0), 0);
  const weekCount  = emailLogs.filter(e => e.date >= isoNDaysAgo(7)).reduce((s, e) => s + 1 + (e.replies || 0), 0);
  const monthCount = emailLogs.reduce((s, e) => s + 1 + (e.replies || 0), 0);

  const spark = Array.from({ length: 30 }, (_, i) => {
    const d = isoNDaysAgo(29 - i);
    return { date: d, count: emailLogs.filter(e => e.date === d).reduce((s, e) => s + 1 + (e.replies || 0), 0) };
  });

  if (!m) return null;
  return (
    <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
      <div className="dp-head">
        <div className={`avatar lg ${m.color}`}>{m.short}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{m.name}</h3>
          <div className="faint" style={{ fontSize: 11 }}>{m.email}</div>
        </div>
        <button className="btn ghost" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>
      <div className="dp-body">
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }}><span className="muted">Loading…</span></div>
        ) : (
          <>
            <div className="grid grid-3" style={{ marginBottom: 16 }}>
              <div className="kpi" style={{ padding: 12 }}>
                <div className="kpi-label">Today</div>
                <div className="kpi-value" style={{ fontSize: 22 }}>{todayCount}</div>
              </div>
              <div className="kpi" style={{ padding: 12 }}>
                <div className="kpi-label">7d</div>
                <div className="kpi-value" style={{ fontSize: 22 }}>{weekCount}</div>
              </div>
              <div className="kpi" style={{ padding: 12 }}>
                <div className="kpi-label">30d</div>
                <div className="kpi-value" style={{ fontSize: 22 }}>{monthCount}</div>
              </div>
            </div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><h3>Activity · 30 days</h3></div>
              <div className="chart-wrap"><LineChart data={spark} /></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────── SETTINGS ────────────────
export function SettingsPage({ theme, toggleTheme, role, accent, setAccent }) {
  const [newPwd, setNewPwd]       = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdMsg, setPwdMsg]       = useState(null) // { type: 'ok'|'err', text }
  const [pwdSaving, setPwdSaving] = useState(false)

  async function handlePasswordReset(e) {
    e.preventDefault()
    setPwdMsg(null)
    if (newPwd.length < 8)         { setPwdMsg({ type: 'err', text: 'Password must be at least 8 characters' }); return }
    if (newPwd !== confirmPwd)     { setPwdMsg({ type: 'err', text: "Passwords don't match" }); return }
    setPwdSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd })
      if (error) throw error
      setNewPwd(''); setConfirmPwd('')
      setPwdMsg({ type: 'ok', text: 'Password updated successfully' })
    } catch (err) {
      setPwdMsg({ type: 'err', text: err.message })
    } finally {
      setPwdSaving(false)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 800 }}>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Workspace preferences for {role === 'lead' ? 'team leads' : 'members'}.</div></div></div>

      {/* Appearance */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Appearance</h3></div>
        <div className="card-pad">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Theme</div>
              <div className="faint" style={{ fontSize: 11 }}>⌘ ⇧ L to toggle anywhere</div>
            </div>
            <span className="seg">
              <button className={theme === 'light' ? 'on' : ''} onClick={() => theme === 'dark' && toggleTheme()}>Light</button>
              <button className={theme === 'dark' ? 'on' : ''} onClick={() => theme === 'light' && toggleTheme()}>Dark</button>
            </span>
          </div>

          <div style={{ paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Accent colour</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 14 }}>Changes buttons, highlights, graphs, and progress bars</div>
            {[
              { label: 'Classics', ids: ['lime','blue','violet','emerald','orange','cyan','pink','rose'] },
              { label: 'Reds',     ids: ['red','crimson'] },
              { label: 'Gold',     ids: ['gold','amber'] },
              { label: 'Neons',    ids: ['neon-green','electric','neon-pink','neon-purple','neon-yellow'] },
            ].map(group => (
              <div key={group.label} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 8 }}>{group.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {ACCENT_PRESETS.filter(p => group.ids.includes(p.id)).map(p => (
                    <button
                      key={p.id}
                      onClick={() => setAccent(p.id)}
                      title={p.name}
                      style={{
                        width: 34, height: 34,
                        borderRadius: '50%',
                        background: p.hex,
                        border: accent === p.id ? `3px solid var(--text)` : '3px solid transparent',
                        outline: accent === p.id ? `2px solid ${p.hex}` : 'none',
                        outlineOffset: 2,
                        cursor: 'pointer',
                        transition: 'all .15s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {accent === p.id && (
                        <span style={{ color: p.ink, fontSize: 15, lineHeight: 1 }}>✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-faint)' }}>
              Selected: <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{ACCENT_PRESETS.find(p => p.id === accent)?.name || 'Lime'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Security */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Security</h3></div>
        <div className="card-pad">
          <form onSubmit={handlePasswordReset}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>New password</div>
                <input
                  className="input" type="password" placeholder="Min. 8 characters"
                  value={newPwd} onChange={e => { setNewPwd(e.target.value); setPwdMsg(null) }}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>Confirm password</div>
                <input
                  className="input" type="password" placeholder="Repeat password"
                  value={confirmPwd} onChange={e => { setConfirmPwd(e.target.value); setPwdMsg(null) }}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            {pwdMsg && (
              <div style={{
                marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12,
                background: pwdMsg.type === 'ok' ? 'rgba(74,222,128,.12)' : 'rgba(248,113,113,.12)',
                color: pwdMsg.type === 'ok' ? '#4ade80' : '#f87171',
                border: `1px solid ${pwdMsg.type === 'ok' ? 'rgba(74,222,128,.25)' : 'rgba(248,113,113,.25)'}`,
              }}>
                {pwdMsg.type === 'ok' ? '✓ ' : '✕ '}{pwdMsg.text}
              </div>
            )}
            <button type="submit" className="btn primary" disabled={pwdSaving || !newPwd || !confirmPwd}>
              {pwdSaving ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>
      </div>

      {/* Reminders */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Reminders</h3></div>
        <div className="card-pad">
          <div className="row-flex" style={{ padding: '8px 0' }}>
            <span style={{ flex: 1 }}>Inactivity nudge</span>
            <span className="mono faint" style={{ fontSize: 11 }}>after 90 min idle</span>
            <span className="chip">off</span>
          </div>
          <div className="row-flex" style={{ padding: '8px 0' }}>
            <span style={{ flex: 1 }}>Weekly summary email</span>
            <span className="mono faint" style={{ fontSize: 11 }}>Mon 09:00</span>
            <span className="chip ok">on</span>
          </div>
        </div>
      </div>
    </div>
  );
}

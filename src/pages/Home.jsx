import { useState, useEffect } from 'react'
import { TEAM, metricsFor, teamMembers as getTeamMembers,
         Icon, isoNDaysAgo, fmtDateShort, fmtRel, pct, todayISO } from '../data.jsx'
import { loadEmailLogsByDateRange, loadReport, loadReportsHistory,
         loadAllReportsForDate, loadReportsByDateRange, loadActivityFeed } from '../lib/supabase.js'

// Tiny sparkline
export function Sparkline({ data, height = 28 }) {
  const w = 100, h = height;
  if (!data || !data.length) return null;
  const max = Math.max(...data, 1);
  if (data.length === 1) {
    const y = (h - (data[0] / max) * (h - 4) - 2).toFixed(1);
    return (
      <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline className="ln" points={`0,${y} ${w},${y}`} />
      </svg>
    );
  }
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline className="ln" points={points} />
    </svg>
  );
}

// Larger line chart with axis
export function LineChart({ data, height = 200 }) {
  const W = 580, H = height;
  const padL = 36, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...data.map(d => d.count), 1);
  const yMax = Math.ceil(max / 10) * 10 || 10;
  const ticks = [0, Math.round(yMax / 2), yMax];

  const pt = (d, i) => {
    const x = data.length === 1
      ? padL + innerW / 2
      : padL + (i / (data.length - 1)) * innerW;
    const y = padT + innerH - (d.count / yMax) * innerH;
    return [x, y];
  };

  const path = data.map((d, i) => {
    const [x, y] = pt(d, i);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const [lastX] = pt(data[data.length - 1], data.length - 1);
  const area = path + ` L ${lastX.toFixed(1)} ${padT + innerH} L ${padL} ${padT + innerH} Z`;

  return (
    <svg className="line-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      {ticks.map((t, i) => {
        const y = padT + innerH - (t / yMax) * innerH;
        return (
          <g key={i}>
            <line className="grid-line" x1={padL} x2={W - padR} y1={y} y2={y} strokeDasharray="2 4" />
            <text className="axis-text" x={padL - 6} y={y + 3} textAnchor="end">{t}</text>
          </g>
        );
      })}
      <path className="area" d={area} />
      <path className="ln" d={path} />
      {data.map((d, i) => {
        const [x, y] = pt(d, i);
        const isFirst = i === 0;
        const isLast  = i === data.length - 1;
        const isMid   = i === Math.floor((data.length - 1) / 2);
        const showLabel = isFirst || isLast || (data.length > 2 && isMid);
        const anchor = isFirst ? 'start' : isLast ? 'end' : 'middle';
        return (
          <g key={i}>
            {isLast && <circle className="dot" cx={x} cy={y} r="3" />}
            {showLabel && (
              <text className="axis-text" x={x} y={H - 8} textAnchor={anchor}>
                {fmtDateShort(d.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function emailCount(logs) {
  return logs.reduce((s, e) => s + 1 + (e.replies || 0), 0);
}

function greeting(now) {
  const h = now.getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function fmtNow(now) {
  const day  = now.toLocaleDateString('en-US', { weekday: 'long' });
  const date = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${date} · ${time}`;
}

function ActivityFeed() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    loadActivityFeed().then(({ reports, emails }) => {
      const merged = [];

      // Group today's emails by member
      const emailsByMember = new Map();
      for (const e of emails) {
        const entry = emailsByMember.get(e.member_id) || { count: 0, ts: null };
        entry.count += 1 + (e.replies || 0);
        if (!entry.ts || e.created_at > entry.ts) entry.ts = e.created_at;
        emailsByMember.set(e.member_id, entry);
      }
      for (const [memberId, { count, ts }] of emailsByMember) {
        const m = TEAM.find(t => t.id === memberId);
        if (m && count > 0) merged.push({ type: 'email', m, count, ts });
      }

      // Recent report submissions
      for (const r of reports) {
        const m = TEAM.find(t => t.id === r.member_id);
        if (m) merged.push({ type: 'report', m, total: r.total || 0, ts: r.created_at });
      }

      merged.sort((a, b) => (b.ts || '') > (a.ts || '') ? 1 : -1);
      setItems(merged.slice(0, 8));
    }).catch(() => {});
  }, []);

  if (items.length === 0) {
    return (
      <div className="feed">
        <div style={{ padding: '24px 16px', color: 'var(--text-faint)', fontSize: 13, textAlign: 'center' }}>
          No activity yet today.
        </div>
      </div>
    );
  }

  return (
    <div className="feed">
      {items.map((it, i) => {
        const what = it.type === 'email'
          ? `logged ${it.count} email${it.count !== 1 ? 's' : ''}`
          : `submitted daily report · ${it.total} total`;
        const chipLabel = it.type === 'email' ? 'email log' : `report · ${it.total}`;
        const chipTone  = it.type === 'email' ? 'info' : 'accent';
        return (
          <div className="feed-row" key={i}>
            <div className={`avatar ${it.m.color}`} style={{ flexShrink: 0 }}>{it.m.short}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><span className="who">{it.m.name}</span> <span className="muted">{what}</span></div>
              <div className="meta"><span className={`chip ${chipTone}`}>{chipLabel}</span></div>
            </div>
            <span className="faint mono" style={{ fontSize: 11 }}>{it.ts ? fmtRel(it.ts) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

// ──────────────── MEMBER HOME ────────────────
export function MemberHome({ me, setRoute }) {
  const [emailLogs, setEmailLogs]     = useState([]);
  const [todayReport, setTodayReport] = useState(null);
  const [allReports, setAllReports]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [now, setNow]                 = useState(new Date());

  const today = todayISO();

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadEmailLogsByDateRange(isoNDaysAgo(13), null, me.id),
      loadReport(me.id, today),
      loadReportsHistory(me.id),
    ]).then(([logs, report, history]) => {
      setEmailLogs(logs);
      setTodayReport(report);
      setAllReports(history);
    }).catch(console.error).finally(() => setLoading(false));
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cnt = (fn) => emailCount(emailLogs.filter(fn));
  const todayEmails = cnt(e => e.date === today);
  const weekEmails  = cnt(e => e.date >= isoNDaysAgo(6));
  const prevWeek    = cnt(e => e.date >= isoNDaysAgo(13) && e.date < isoNDaysAgo(7));
  const weekDelta   = prevWeek > 0 ? Math.round(((weekEmails - prevWeek) / prevWeek) * 100) : null;
  const spark14     = Array.from({ length: 14 }, (_, i) => cnt(e => e.date === isoNDaysAgo(13 - i)));
  const chart14     = Array.from({ length: 14 }, (_, i) => ({ date: isoNDaysAgo(13 - i), count: cnt(e => e.date === isoNDaysAgo(13 - i)) }));

  // Streak: consecutive working days with filed report, back from today
  const filedDates = new Set(allReports.map(r => r.date));
  let streak = 0;
  let si = filedDates.has(today) ? 0 : 1;
  while (si < 60) {
    const date = isoNDaysAgo(si);
    if (new Date(date + 'T00:00:00').getDay() === 0) { si++; continue; }
    if (filedDates.has(date)) { streak++; si++; } else break;
  }

  const todayMetrics = todayReport?.metrics || {};
  const myMetrics    = metricsFor(me.id);

  if (loading) {
    return <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: 300 }}><div className="faint">Loading…</div></div>;
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Good {greeting(now)}, {me.name.split(' ')[0]} <span style={{ color: 'var(--accent)' }}>·</span></h1>
          <div className="sub">{fmtNow(now)}</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setRoute('emails')}><Icon name="plus" size={12} />Log email <span className="kbd">N</span></button>
          <button className="btn primary" onClick={() => setRoute('report')}><Icon name="flash" size={12} />File today's report <span className="kbd">R</span></button>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="kpi-label">Today's emails</div>
          <div className="kpi-value">{todayEmails}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / 30</span></div>
          <div className="bar thin"><div className="bar-fill" style={{ width: pct(todayEmails, 30) + '%' }}></div></div>
          <div className="kpi-target">{pct(todayEmails, 30)}% of soft target · {Math.max(0, 30 - todayEmails)} to go</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Week emails</div>
          <div className="kpi-value">{weekEmails}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / {6 * 30}</span></div>
          {weekDelta !== null && (
            <div className={`kpi-delta ${weekDelta >= 0 ? 'up' : 'down'}`}>
              <Icon name={weekDelta >= 0 ? 'arrowUp' : 'arrowDown'} size={10} />{weekDelta > 0 ? '+' : ''}{weekDelta}% vs last week
            </div>
          )}
          <Sparkline data={spark14} />
        </div>
        <div className="kpi">
          <div className="kpi-label">Today's report</div>
          <div className="kpi-value" style={{ color: todayReport ? 'var(--accent)' : 'var(--text)' }}>
            {todayReport ? 'Filed' : 'Pending'}
          </div>
          <div className="kpi-target">
            {todayReport
              ? `Submitted ${fmtRel(todayReport.created_at)}`
              : 'Takes ~45 seconds in the numpad'}
          </div>
          {!todayReport && (
            <button className="btn primary" style={{ marginTop: 4, alignSelf: 'flex-start' }} onClick={() => setRoute('report')}>
              File now <Icon name="arrow" size={11} />
            </button>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-label">Filing streak</div>
          <div className="kpi-value">{streak}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> days</span></div>
          <div className="kpi-target">{streak > 0 ? 'Keep it up!' : 'File today to start'}</div>
          <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: 6, background: i < streak ? 'var(--accent)' : 'var(--surface-2)', borderRadius: 2 }}></div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-2-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Your week</h3></div>
          <div className="chart-wrap">
            <LineChart data={chart14} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Today, so far</h3>
            <span className="faint mono" style={{ fontSize: 11 }}>{Object.keys(todayMetrics).filter(k => !k.startsWith('_')).length} metrics</span>
          </div>
          <div style={{ padding: '4px 0' }}>
            {myMetrics.slice(0, 8).map(m => {
              const v = todayMetrics[m.key] || 0;
              const pctVal = m.target ? Math.min(100, (v / m.target) * 100) : (v > 0 ? 100 : 0);
              return (
                <div key={m.key} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name={m.icon} size={12} />
                  <span style={{ flex: 1, fontSize: 12 }}>{m.label}</span>
                  <span className="mono tnum" style={{ fontSize: 12, color: v > 0 ? 'var(--text)' : 'var(--text-ghost)', minWidth: 28, textAlign: 'right' }}>{v || '—'}</span>
                  {m.target > 0 && (
                    <div className="bar thin" style={{ width: 50 }}>
                      <div className="bar-fill" style={{ width: pctVal + '%', background: pctVal >= 100 ? 'var(--accent)' : 'var(--text-faint)' }}></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Team activity</h3></div>
        <ActivityFeed />
      </div>
    </div>
  );
}

// ──────────────── LEAD HOME ────────────────
export function LeadHome({ me, setRoute }) {
  const [emailLogs, setEmailLogs]       = useState([]);
  const [todayReports, setTodayReports] = useState([]);
  const [recentReports, setRecentReports] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [now, setNow]                   = useState(new Date());

  const teamMembersList = getTeamMembers();
  const today = todayISO();

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadEmailLogsByDateRange(isoNDaysAgo(31)),
      loadAllReportsForDate(today),
      loadReportsByDateRange(isoNDaysAgo(25)),
    ]).then(([logs, todayRpts, allRpts]) => {
      setEmailLogs(logs);
      setTodayReports(todayRpts);
      setRecentReports(allRpts);
    }).catch(console.error).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isTeam = (id) => teamMembersList.some(m => m.id === id);
  const cnt    = (fn) => emailCount(emailLogs.filter(fn));

  const teamEmailsToday = cnt(e => e.date === today && isTeam(e.member_id));
  const teamTargetToday = teamMembersList.length * 30;
  const teamWeek  = cnt(e => e.date >= isoNDaysAgo(6) && isTeam(e.member_id));
  const prevWeek  = cnt(e => e.date >= isoNDaysAgo(13) && e.date < isoNDaysAgo(7) && isTeam(e.member_id));
  const weekDelta = prevWeek > 0 ? Math.round(((teamWeek - prevWeek) / prevWeek) * 100) : null;

  const reportsFiledToday  = teamMembersList.filter(m => todayReports.some(r => r.member_id === m.id)).length;
  const pendingReporters   = teamMembersList.filter(m => !todayReports.some(r => r.member_id === m.id)).map(m => m.name.split(' ')[0]);

  // Per-member today counts for median/stddev
  const memberCounts  = teamMembersList.map(m => cnt(e => e.date === today && e.member_id === m.id));
  const sortedCounts  = [...memberCounts].sort((a, b) => a - b);
  const median        = sortedCounts[Math.floor(sortedCounts.length / 2)] || 0;
  const meanFloat     = memberCounts.reduce((a, b) => a + b, 0) / Math.max(memberCounts.length, 1);
  const stddev        = Math.round(Math.sqrt(memberCounts.reduce((a, b) => a + (b - meanFloat) ** 2, 0) / Math.max(memberCounts.length, 1)));
  const week7Avg      = Math.round(teamWeek / 7);

  const trend14 = Array.from({ length: 14 }, (_, i) => ({
    date:  isoNDaysAgo(13 - i),
    count: cnt(e => e.date === isoNDaysAgo(13 - i) && isTeam(e.member_id)),
  }));
  const sparkData = trend14.map(d => d.count);

  const reviewQueue = recentReports.filter(r => r.status === 'pending' && isTeam(r.member_id)).length;

  const monthStart = `${today.slice(0, 7)}-01`
  const leaderboard = teamMembersList.map(m => ({
    m,
    score: cnt(e => e.date >= monthStart && e.member_id === m.id),
  })).sort((a, b) => b.score - a.score);
  const maxScore = Math.max(...leaderboard.map(l => l.score), 1);
  const monthLabel = new Date(today + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  if (loading) {
    return <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: 300 }}><div className="faint">Loading…</div></div>;
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team overview <span style={{ color: 'var(--accent)' }}>·</span></h1>
          <div className="sub">{teamMembersList.length} active · {fmtNow(now)}</div>
        </div>
        <div className="actions">
          <button className="btn"><Icon name="download" size={12} />Export</button>
          <button className="btn" onClick={() => setRoute('review')}>
            <Icon name="eye" size={12} />Review queue
            {reviewQueue > 0 && (
              <span className="badge" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', marginLeft: 4, padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700 }}>{reviewQueue}</span>
            )}
          </button>
          <button className="btn primary" onClick={() => setRoute('analytics')}><Icon name="chart" size={12} />Analytics</button>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="kpi-label">Team emails today</div>
          <div className="kpi-value">{teamEmailsToday}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / {teamTargetToday}</span></div>
          <div className="bar thin"><div className="bar-fill" style={{ width: pct(teamEmailsToday, teamTargetToday) + '%' }}></div></div>
          <div className="kpi-target">{pct(teamEmailsToday, teamTargetToday)}% of soft target</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Week emails</div>
          <div className="kpi-value">{teamWeek.toLocaleString()}</div>
          {weekDelta !== null && (
            <div className={`kpi-delta ${weekDelta >= 0 ? 'up' : 'down'}`}>
              <Icon name={weekDelta >= 0 ? 'arrowUp' : 'arrowDown'} size={10} />{weekDelta > 0 ? '+' : ''}{weekDelta}% week-on-week
            </div>
          )}
          <Sparkline data={sparkData} />
        </div>
        <div className="kpi">
          <div className="kpi-label">Reports filed</div>
          <div className="kpi-value">{reportsFiledToday}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / {teamMembersList.length}</span></div>
          <div className="bar thin"><div className="bar-fill" style={{ width: pct(reportsFiledToday, teamMembersList.length) + '%' }}></div></div>
          <div className="kpi-target">
            {pendingReporters.length > 0
              ? `${pendingReporters.length} pending · ${pendingReporters.slice(0, 3).join(', ')}`
              : 'All filed!'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg per member</div>
          <div className="kpi-value">{Math.round(teamEmailsToday / Math.max(teamMembersList.length, 1))}</div>
          <div className="kpi-target">Median {median} · Std-dev {stddev}</div>
          <div className="kpi-delta"><span className="mono">7-day avg {week7Avg}</span></div>
        </div>
      </div>

      <div className="grid grid-2-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Email volume — last 14 days</h3></div>
          <div className="chart-wrap">
            <LineChart data={trend14} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Team status</h3><span className="faint" style={{ fontSize: 11 }}>now</span></div>
          <div style={{ padding: '4px 0' }}>
            {teamMembersList.map(m => {
              const e     = cnt(log => log.date === today && log.member_id === m.id);
              const filed = todayReports.some(r => r.member_id === m.id);
              return (
                <div key={m.id} style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
                  <div className={`avatar ${m.color}`}>{m.short}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{m.name}</div>
                    <div className="faint" style={{ fontSize: 11 }}>{e} emails · {filed ? 'report filed' : 'report pending'}</div>
                  </div>
                  <span className={`dot-status ${filed && e >= 25 ? 'ok' : e >= 15 ? 'warn' : 'danger'}`}></span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3>Reporting pulse · last 26 days</h3>
            <span className="faint mono" style={{ fontSize: 11 }}>{teamMembersList.length} × 26 cells</span>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {teamMembersList.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, fontSize: 11, color: 'var(--text-dim)' }}>{m.name}</div>
                  <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(26, 1fr)', gap: 2 }}>
                    {Array.from({ length: 26 }).map((_, i) => {
                      const date  = isoNDaysAgo(25 - i);
                      const r     = recentReports.find(rr => rr.member_id === m.id && rr.date === date);
                      const total = r?.total || 0;
                      const lvl   = total === 0 ? 0 : total < 30 ? 1 : total < 60 ? 2 : total < 100 ? 3 : 4;
                      const bg    = lvl === 0 ? 'var(--surface-2)' : `color-mix(in srgb, var(--accent) ${15 + lvl * 20}%, transparent)`;
                      return <div key={i} style={{ aspectRatio: '1 / 1', background: bg, borderRadius: 2 }} title={`${fmtDateShort(date)}: ${total}`}></div>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', marginTop: 12, fontSize: 10, color: 'var(--text-faint)' }}>
              <span>less</span>
              {[0, 1, 2, 3, 4].map(l => (
                <div key={l} style={{ width: 10, height: 10, background: l === 0 ? 'var(--surface-2)' : `color-mix(in srgb, var(--accent) ${15 + l * 20}%, transparent)`, borderRadius: 2 }}></div>
              ))}
              <span>more</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Activity</h3></div>
          <ActivityFeed />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Leaderboard · {monthLabel}</h3>
          <button className="btn ghost" onClick={() => setRoute('leaderboard')}>View all <Icon name="arrow" size={11} /></button>
        </div>
        <div style={{ padding: '0 16px' }}>
          {leaderboard.map(({ m, score }, i) => (
            <div className="ldr-row" key={m.id}>
              <span className={`rank ${i === 0 ? 'top' : ''}`}>{i + 1}</span>
              <div className="nme">
                <div className={`avatar ${m.color}`}>{m.short}</div>
                <span>{m.name}</span>
              </div>
              <div className="bar thin" style={{ width: 80 }}>
                <div className="bar-fill" style={{ width: Math.min(100, (score / maxScore) * 100) + '%' }}></div>
              </div>
              <span className="score">{score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

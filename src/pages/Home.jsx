import { useState, useEffect } from 'react'
import { TEAM, teamMembers as getTeamMembers,
         Icon, isoNDaysAgo, fmtDateShort, fmtRel, pct, todayISO } from '../data.jsx'
import { loadEmailLogsByDateRange, loadActivityFeed } from '../lib/supabase.js'

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
    loadActivityFeed().then(({ emails }) => {
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
      {items.map((it, i) => (
        <div className="feed-row" key={i}>
          <div className={`avatar ${it.m.color}`} style={{ flexShrink: 0 }}>{it.m.short}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div><span className="who">{it.m.name}</span> <span className="muted">logged {it.count} email{it.count !== 1 ? 's' : ''}</span></div>
            <div className="meta"><span className="chip info">email log</span></div>
          </div>
          <span className="faint mono" style={{ fontSize: 11 }}>{it.ts ? fmtRel(it.ts) : ''}</span>
        </div>
      ))}
    </div>
  );
}

// ──────────────── MEMBER HOME ────────────────
export function MemberHome({ me, setRoute }) {
  const [emailLogs, setEmailLogs]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [now, setNow]                 = useState(new Date());

  const today = todayISO();

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadEmailLogsByDateRange(isoNDaysAgo(13), null, me.id)
      .then(setEmailLogs)
      .catch(console.error).finally(() => setLoading(false));
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cnt = (fn) => emailCount(emailLogs.filter(fn));
  const todayEmails = cnt(e => e.date === today);
  const weekEmails  = cnt(e => e.date >= isoNDaysAgo(6));
  const prevWeek    = cnt(e => e.date >= isoNDaysAgo(13) && e.date < isoNDaysAgo(7));
  const weekDelta   = prevWeek > 0 ? Math.round(((weekEmails - prevWeek) / prevWeek) * 100) : null;
  const spark14     = Array.from({ length: 14 }, (_, i) => cnt(e => e.date === isoNDaysAgo(13 - i)));
  const chart14     = Array.from({ length: 14 }, (_, i) => ({ date: isoNDaysAgo(13 - i), count: cnt(e => e.date === isoNDaysAgo(13 - i)) }));

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
          <button className="btn primary" onClick={() => setRoute('emails')}><Icon name="plus" size={12} />Log email <span className="kbd">N</span></button>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
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
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Your week</h3></div>
        <div className="chart-wrap">
          <LineChart data={chart14} />
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
    loadEmailLogsByDateRange(isoNDaysAgo(31))
      .then(setEmailLogs)
      .catch(console.error).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isTeam = (id) => teamMembersList.some(m => m.id === id);
  const cnt    = (fn) => emailCount(emailLogs.filter(fn));

  const teamEmailsToday = cnt(e => e.date === today && isTeam(e.member_id));
  const teamTargetToday = teamMembersList.length * 30;
  const teamWeek  = cnt(e => e.date >= isoNDaysAgo(6) && isTeam(e.member_id));
  const prevWeek  = cnt(e => e.date >= isoNDaysAgo(13) && e.date < isoNDaysAgo(7) && isTeam(e.member_id));
  const weekDelta = prevWeek > 0 ? Math.round(((teamWeek - prevWeek) / prevWeek) * 100) : null;

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
          <button className="btn primary" onClick={() => setRoute('analytics')}><Icon name="chart" size={12} />Analytics</button>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
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
              const e = cnt(log => log.date === today && log.member_id === m.id);
              return (
                <div key={m.id} style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
                  <div className={`avatar ${m.color}`}>{m.short}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{m.name}</div>
                    <div className="faint" style={{ fontSize: 11 }}>{e} emails today</div>
                  </div>
                  <span className={`dot-status ${e >= 25 ? 'ok' : e >= 15 ? 'warn' : 'danger'}`}></span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Activity</h3></div>
        <ActivityFeed />
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

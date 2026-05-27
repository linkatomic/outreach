import { TEAM, METRICS, NEEL_METRICS, metricsFor, teamMembers as getTeamMembers,
         Icon, emailsToday, emailsCountByDay, teamEmailsCountByDay,
         reportsForMember, reportToday, isoNDaysAgo, fmtDateShort, fmtRel, pct, REPORTS } from '../data.jsx'

// Tiny sparkline
export function Sparkline({ data, height = 28 }) {
  const w = 100, h = height;
  if (!data.length) return null;
  const max = Math.max(...data, 1);
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
  const padL = 28, padR = 12, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...data.map(d => d.count), 1);
  const yMax = Math.ceil(max / 50) * 50 || 50;
  const pt = (d, i) => {
    const x = padL + (i / (data.length - 1)) * innerW;
    const y = padT + innerH - (d.count / yMax) * innerH;
    return [x, y];
  };
  const path = data.map((d, i) => {
    const [x, y] = pt(d, i);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const area = path + ` L ${padL + innerW} ${padT + innerH} L ${padL} ${padT + innerH} Z`;
  const ticks = [0, yMax / 2, yMax];
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
        const showLabel = i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2);
        return (
          <g key={i}>
            {i === data.length - 1 && <circle className="dot" cx={x} cy={y} r="3" />}
            {showLabel && <text className="axis-text" x={x} y={H - 8} textAnchor="middle">{fmtDateShort(d.date)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function ActivityFeed() {
  const items = [
    { who: 'Neha M',     avatar: 'b', what: 'logged 14 emails',               t: '6m',  chip: { label: 'email log',           tone: 'info' } },
    { who: 'Arjun M',    avatar: 'e', what: 'submitted daily report',          t: '22m', chip: { label: 'report · 31 emails',  tone: 'accent' } },
    { who: 'Dev Pandya', avatar: 'a', what: 'approved 4 reports for May 25',   t: '1h',  chip: { label: 'review',              tone: 'ok' } },
    { who: 'Keyur D',    avatar: 'd', what: 'flagged Acme Imports as duplicate',t: '2h', chip: { label: 'vendor',              tone: 'warn' } },
    { who: 'Preeti S',   avatar: 'c', what: 'audited 28 websites',             t: '3h',  chip: { label: 'sites',               tone: 'info' } },
    { who: 'Neel P',     avatar: 'f', what: 'joined the team',                 t: '6d',  chip: { label: 'onboarding',          tone: 'accent' } },
  ];
  return (
    <div className="feed">
      {items.map((it, i) => (
        <div className="feed-row" key={i}>
          <div className={`avatar ${it.avatar}`} style={{ flexShrink: 0 }}>{it.who.split(' ').map(s => s[0]).join('').slice(0,2)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div><span className="who">{it.who}</span> <span className="muted">{it.what}</span></div>
            <div className="meta"><span className={`chip ${it.chip.tone}`}>{it.chip.label}</span></div>
          </div>
          <span className="faint mono" style={{ fontSize: 11 }}>{it.t}</span>
        </div>
      ))}
    </div>
  );
}

// ──────────────── MEMBER HOME ────────────────
export function MemberHome({ me, setRoute }) {
  const todayEmails = emailsToday(me.id);
  const todayReport = reportToday(me.id);
  const weekEmails = emailsCountByDay(me.id, 7).reduce((s, d) => s + d.count, 0);
  const weekTarget = 6 * 30;
  const spark14 = emailsCountByDay(me.id, 14).map(d => d.count);
  const myReports = reportsForMember(me.id, 7);

  const todayMetrics = {};
  if (todayReport) {
    for (const [k, v] of Object.entries(todayReport.metrics)) todayMetrics[k] = v;
  }
  const myMetrics = metricsFor(me.id);
  const isNeel = !!TEAM.find(m => m.id === me.id)?.neelOnly;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Good afternoon, {me.name.split(' ')[0]} <span style={{ color: 'var(--accent)' }}>·</span></h1>
          <div className="sub">Tuesday, May 26 · 19:14 IST</div>
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
          <div className="kpi-value">{weekEmails}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / {weekTarget}</span></div>
          <div className="kpi-delta up"><Icon name="arrowUp" size={10} />+18% vs last week</div>
          <Sparkline data={spark14} />
        </div>
        <div className="kpi">
          <div className="kpi-label">Today's report</div>
          <div className="kpi-value" style={{ color: todayReport ? 'var(--accent)' : 'var(--text)' }}>
            {todayReport ? 'Filed' : 'Pending'}
          </div>
          <div className="kpi-target">
            {todayReport
              ? `Submitted ${fmtRel(todayReport.submittedAt)}`
              : 'Takes ~45 seconds in the numpad'}
          </div>
          {!todayReport && <button className="btn primary" style={{ marginTop: 4, alignSelf: 'flex-start' }} onClick={() => setRoute('report')}>File now <Icon name="arrow" size={11} /></button>}
        </div>
        <div className="kpi">
          <div className="kpi-label">7-day streak</div>
          <div className="kpi-value">{Math.min(myReports.length, 6)}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> days</span></div>
          <div className="kpi-target">All reports filed on time</div>
          <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: 6, background: i < 6 ? 'var(--accent)' : 'var(--surface-2)', borderRadius: 2 }}></div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-2-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3>Your week</h3>
            <div className="actions">
              <span className="seg">
                <button className="on">Emails</button>
                <button>Sites</button>
                <button>All</button>
              </span>
            </div>
          </div>
          <div className="chart-wrap">
            <LineChart data={emailsCountByDay(me.id, 14)} />
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Today, so far</h3><span className="faint mono" style={{ fontSize: 11 }}>{Object.keys(todayMetrics).length} metrics</span></div>
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
        <div className="card-head">
          <h3>Team activity</h3>
          <div className="actions"><button className="btn ghost"><Icon name="filter" size={12} />Filter</button></div>
        </div>
        <ActivityFeed />
      </div>
    </div>
  );
}

// ──────────────── LEAD HOME ────────────────
export function LeadHome({ me, setRoute }) {
  // Neel is on a separate track — exclude from team analytics/stats
  const teamMembers = getTeamMembers();
  const teamEmailsToday = teamMembers.reduce((s, m) => s + emailsToday(m.id), 0);
  const teamTargetToday = teamMembers.length * 30;
  const teamWeek = teamEmailsCountByDay(7).reduce((s, d) => s + d.count, 0);
  const reportsToday = teamMembers.filter(m => reportToday(m.id)).length;
  const reportsTotal = teamMembers.length;
  const trend = teamEmailsCountByDay(14);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team overview <span style={{ color: 'var(--accent)' }}>·</span></h1>
          <div className="sub">5 active · Tuesday, May 26 · 19:14 IST</div>
        </div>
        <div className="actions">
          <button className="btn"><Icon name="download" size={12} />Export</button>
          <button className="btn" onClick={() => setRoute('review')}><Icon name="eye" size={12} />Review queue<span className="badge" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', marginLeft: 4, padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700 }}>3</span></button>
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
          <div className="kpi-delta up"><Icon name="arrowUp" size={10} />+11% week-on-week</div>
          <Sparkline data={trend.map(d => d.count)} />
        </div>
        <div className="kpi">
          <div className="kpi-label">Reports filed</div>
          <div className="kpi-value">{reportsToday}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / {reportsTotal}</span></div>
          <div className="bar thin"><div className="bar-fill" style={{ width: pct(reportsToday, reportsTotal) + '%' }}></div></div>
          <div className="kpi-target">{reportsTotal - reportsToday} pending · Preeti, Neel</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg per member</div>
          <div className="kpi-value">{Math.round(teamEmailsToday / teamMembers.length)}</div>
          <div className="kpi-target">Median 24 · Std-dev 7.2</div>
          <div className="kpi-delta"><span className="mono">7-day avg 27.4</span></div>
        </div>
      </div>

      <div className="grid grid-2-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3>Email volume — last 14 days</h3>
            <span className="seg">
              <button className="on">14d</button>
              <button>30d</button>
              <button>90d</button>
            </span>
          </div>
          <div className="chart-wrap">
            <LineChart data={trend} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Team status</h3><span className="faint" style={{ fontSize: 11 }}>now</span></div>
          <div style={{ padding: '4px 0' }}>
            {teamMembers.map(m => {
              const e = emailsToday(m.id);
              const filed = !!reportToday(m.id);
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
          <div className="card-head"><h3>Reporting pulse · last 26 days</h3><span className="faint mono" style={{ fontSize: 11 }}>{teamMembers.length} × 26 cells</span></div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {teamMembers.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, fontSize: 11, color: 'var(--text-dim)' }}>{m.name}</div>
                  <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(26, 1fr)', gap: 2 }}>
                    {Array.from({ length: 26 }).map((_, i) => {
                      const date = isoNDaysAgo(25 - i);
                      const r = REPORTS.find(rr => rr.memberId === m.id && rr.date === date);
                      const total = r ? Object.values(r.metrics).reduce((a,b) => a+b, 0) : 0;
                      const lvl = total === 0 ? 0 : total < 30 ? 1 : total < 60 ? 2 : total < 100 ? 3 : 4;
                      return <div key={i} style={{ aspectRatio: '1 / 1', background: lvl === 0 ? 'var(--surface-2)' : `rgba(210, 254, 92, ${0.15 + lvl * 0.2})`, borderRadius: 2 }} title={`${fmtDateShort(date)}: ${total}`}></div>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', marginTop: 12, fontSize: 10, color: 'var(--text-faint)' }}>
              <span>less</span>
              {[0,1,2,3,4].map(l => <div key={l} style={{ width: 10, height: 10, background: l === 0 ? 'var(--surface-2)' : `rgba(210, 254, 92, ${0.15 + l * 0.2})`, borderRadius: 2 }}></div>)}
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
          <h3>This week's leaderboard</h3>
          <button className="btn ghost" onClick={() => setRoute('leaderboard')}>View all <Icon name="arrow" size={11} /></button>
        </div>
        <div style={{ padding: '0 16px' }}>
          {teamMembers.map(m => ({
            m,
            score: emailsCountByDay(m.id, 7).reduce((s, d) => s + d.count, 0)
          })).sort((a, b) => b.score - a.score).map(({ m, score }, i) => (
            <div className="ldr-row" key={m.id}>
              <span className={`rank ${i === 0 ? 'top' : ''}`}>{i + 1}</span>
              <div className="nme">
                <div className={`avatar ${m.color}`}>{m.short}</div>
                <span>{m.name}</span>
              </div>
              <div className="bar thin" style={{ width: 80 }}>
                <div className="bar-fill" style={{ width: Math.min(100, (score / 220) * 100) + '%' }}></div>
              </div>
              <span className="score">{score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

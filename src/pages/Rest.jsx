import { useState, useEffect, useMemo } from 'react'
import { TEAM, METRICS, ACCENT_PRESETS, Icon, todayISO, isoNDaysAgo, fmtDateShort, fmtFull,
         metricsFor, missedCoreTasks, reportHasCoreData, computeReportTotal, CORE_ROLE_META, pct } from '../data.jsx'
import { supabase, loadAllReportsForDate, updateReportStatus,
         loadEmailLogsByDateRange, loadReportsByDateRange } from '../lib/supabase.js'
import { Sparkline, LineChart } from './Home.jsx'

// ──────────────── ANALYTICS ────────────────
export function AnalyticsPage({ setRoute }) {
  const [range, setRange]           = useState('14d');
  const [customDate, setCustomDate] = useState(todayISO());
  const [compMetric, setCompMetric] = useState('emails');
  const [emailLogs, setEmailLogs]   = useState([]);
  const [reports, setReports]       = useState([]);
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
    Promise.all([loadEmailLogsByDateRange(fetchStart, rangeEnd), loadReportsByDateRange(fetchStart, rangeEnd)])
      .then(([logs, rpts]) => { setEmailLogs(logs); setReports(rpts); })
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
      const myRpts   = reports.filter(r => r.member_id === m.id && (isSingleDay ? r.date === chartStart : r.date >= cmpStart));
      const sitesWeek = myRpts.reduce((s, r) => s + (typeof r.metrics?.web_added === 'number' ? r.metrics.web_added : 0) + (typeof r.metrics?.web_audited === 'number' ? r.metrics.web_audited : 0), 0);
      const prevRpts  = isSingleDay ? [] : reports.filter(r => r.member_id === m.id && r.date >= prevStart && r.date < cmpStart);
      const sitesPrev = prevRpts.reduce((s, r) => s + (typeof r.metrics?.web_added === 'number' ? r.metrics.web_added : 0) + (typeof r.metrics?.web_audited === 'number' ? r.metrics.web_audited : 0), 0);
      const sitesDelta = (isSingleDay || sitesPrev === 0) ? null : Math.round(((sitesWeek - sitesPrev) / sitesPrev) * 100);
      return { m, week, delta, sitesWeek, sitesDelta, reports: myRpts.length };
    });
  }, [emailLogs, reports, range, customDate]);

  const metricBreakdown = useMemo(() => {
    const cmpStart = isSingleDay ? chartStart : isoNDaysAgo(7);
    const weekRpts = reports.filter(r => (isSingleDay ? r.date === chartStart : r.date >= cmpStart) && members.some(m => m.id === r.member_id));
    return METRICS.slice(0, 8).map(mt => ({
      mt,
      total: weekRpts.reduce((s, r) => s + (typeof r.metrics?.[mt.key] === 'number' ? r.metrics[mt.key] : 0), 0),
    })).sort((a, b) => b.total - a.total);
  }, [reports, range, customDate]);

  const metricMax  = Math.max(...metricBreakdown.map(b => b.total), 1);
  const compMax    = Math.max(...memberStats.map(x => compMetric === 'emails' ? x.week : x.sitesWeek), 1);
  // totalRpts scoped to the displayed chart window (not the extra-fetched comparison data)
  const totalRpts  = reports.filter(r => members.some(m => m.id === r.member_id) && r.date >= chartStart).length;
  const compliance = totalRpts === 0 ? 0 : Math.min(100, Math.round((totalRpts / (days * members.length)) * 100));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">Team productivity, metric mix, member comparison.</div>
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
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <div className="kpi">
              <div className="kpi-label">Total emails · {rangeLabel}</div>
              <div className="kpi-value">{totalEmails.toLocaleString()}</div>
              <Sparkline data={trend.map(d => d.count)} />
            </div>
            <div className="kpi">
              <div className="kpi-label">Reports filed · {rangeLabel}</div>
              <div className="kpi-value">{totalRpts}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / {days * members.length}</span></div>
              <div className="kpi-target">{days}d × {members.length} members</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Avg emails / member / day</div>
              <div className="kpi-value">{members.length > 0 && days > 0 ? Math.round(totalEmails / members.length / days) : 0}</div>
              <div className="kpi-target">based on {rangeLabel}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Report compliance</div>
              <div className="kpi-value">{compliance}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}>%</span></div>
              <div className="kpi-target">reports on time, {rangeLabel}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>Email volume — {rangeLabel}</h3>
              <span className="chip"><span className="dot-status accent"></span>Team total</span>
            </div>
            <div className="chart-wrap"><LineChart data={trend} height={260} /></div>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head">
                <h3>Member comparison · {isSingleDay ? rangeLabel : '7-day'}</h3>
                <span className="seg" style={{ fontSize: 11 }}>
                  <button className={compMetric === 'emails' ? 'on' : ''} onClick={() => setCompMetric('emails')}>Emails</button>
                  <button className={compMetric === 'sites' ? 'on' : ''} onClick={() => setCompMetric('sites')}>Sites</button>
                </span>
              </div>
              <div style={{ padding: '0 16px 16px' }}>
                {[...memberStats].sort((a, b) => (compMetric === 'emails' ? b.week - a.week : b.sitesWeek - a.sitesWeek)).map(({ m, week, delta, sitesWeek, sitesDelta }) => {
                  const val = compMetric === 'emails' ? week : sitesWeek;
                  const dlt = compMetric === 'emails' ? delta : sitesDelta;
                  return (
                    <div key={m.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className={`avatar ${m.color}`}>{m.short}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                        <div className="bar thin" style={{ marginTop: 6, width: '100%' }}>
                          <div className="bar-fill" style={{ width: Math.min(100, (val / compMax) * 100) + '%' }}></div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="mono" style={{ fontSize: 15, letterSpacing: '-0.02em' }}>{val}</div>
                        {dlt !== null && (
                          <div className={`kpi-delta ${dlt >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10, justifyContent: 'flex-end' }}>
                            <Icon name={dlt >= 0 ? 'arrowUp' : 'arrowDown'} size={9} />{Math.abs(dlt)}%
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h3>Metric mix · {isSingleDay ? rangeLabel : 'last 7 days'}</h3><span className="faint" style={{ fontSize: 11 }}>by category</span></div>
              <div style={{ padding: '0 16px 16px' }}>
                {metricBreakdown.filter(b => b.total > 0).map(({ mt, total }) => (
                  <div key={mt.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon name={mt.icon} size={13} />
                    <span style={{ flex: 1, fontSize: 12.5 }}>{mt.label}</span>
                    <div className="bar thin" style={{ width: 100 }}>
                      <div className="bar-fill" style={{ width: Math.min(100, (total / metricMax) * 100) + '%' }}></div>
                    </div>
                    <span className="mono tnum" style={{ fontSize: 13, minWidth: 50, textAlign: 'right' }}>{total}</span>
                  </div>
                ))}
                {metricBreakdown.every(b => b.total === 0) && <div className="empty">No report data for {rangeLabel}</div>}
              </div>
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
  const [todayRpts, setTodayRpts] = useState([]);
  const [loading, setLoading]     = useState(true);
  const today = todayISO();

  useEffect(() => {
    // 60 days: today + 29 days current month + 30 days prior month for monthly delta
    Promise.all([loadEmailLogsByDateRange(isoNDaysAgo(60)), loadAllReportsForDate(today)])
      .then(([logs, rpts]) => { setEmailLogs(logs); setTodayRpts(rpts); })
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
    const filed = todayRpts.some(r => r.member_id === memberId);
    return { todayCount, weekCount, monthCount, dayDelta, weekDelta, monthDelta, spark, filed };
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
            const { todayCount, weekCount, monthCount, dayDelta, weekDelta, monthDelta, spark, filed } = getMemberStats(m.id);
            return (
              <div key={m.id} className="card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => openDetailFor(m.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div className={`avatar lg ${m.color}`}>{m.short}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {m.name}
                      {isMe && <span className="chip">you</span>}
                      {m.role === 'lead' && <span className="chip accent">lead</span>}
                      {m.role === 'member' && (
                        <span className={`chip ${filed ? 'ok' : 'warn'}`} style={{ marginLeft: 'auto' }}>
                          {filed ? 'filed' : 'pending'}
                        </span>
                      )}
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
  const [metric, setMetric]       = useState('emails');
  const [emailLogs, setEmailLogs] = useState([]);
  const [reports, setReports]     = useState([]);
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
    Promise.all([
      loadEmailLogsByDateRange(start, end),
      loadReportsByDateRange(start, end),
    ]).then(([logs, rpts]) => { setEmailLogs(logs); setReports(rpts); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [viewYear, viewMonth]);

  const scored = useMemo(() => {
    return members.map(m => {
      const emails = emailLogs.filter(e => e.member_id === m.id)
        .reduce((s, e) => s + 1 + (e.replies || 0), 0);
      const sites = reports.filter(r => r.member_id === m.id)
        .reduce((s, r) => s + (typeof r.metrics?.web_added === 'number' ? r.metrics.web_added : 0)
                              + (typeof r.metrics?.web_audited === 'number' ? r.metrics.web_audited : 0), 0);
      const score = metric === 'emails' ? emails : sites;
      return { m, score, emails, sites };
    }).sort((a, b) => b.score - a.score);
  }, [emailLogs, reports, metric, members]);

  const max = scored[0]?.score || 1;
  const monthLabel = fmtMonthLabel(viewYear, viewMonth);

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <div className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <div className="sub">Friendly competition · soft targets, not hard ranks.</div>
        </div>
        <div className="actions">
          <span className="seg">
            <button className={metric === 'emails' ? 'on' : ''} onClick={() => setMetric('emails')}>Emails</button>
            <button className={metric === 'sites' ? 'on' : ''} onClick={() => setMetric('sites')}>Sites</button>
          </span>
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
            {scored.map(({ m, score, emails, sites }, i) => (
              <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr 90px', gap: 16, padding: '14px 4px', borderBottom: i < scored.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center', cursor: 'pointer' }}
                   onClick={() => openDetailFor(m.id)}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 6, background: i === 0 ? 'var(--accent)' : 'var(--surface-2)', color: i === 0 ? 'var(--accent-ink)' : 'var(--text-dim)', fontWeight: 600 }}>{i + 1}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className={`avatar lg ${m.color}`}>{m.short}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
                    <div className="faint mono" style={{ fontSize: 11 }}>{emails} emails · {sites} sites</div>
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

// ──────────────── REVIEW QUEUE ────────────────
export function ReviewPage({ setRoute, showToast }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [selectedId, setSelectedId] = useState(null);
  const [acting, setActing] = useState(null);
  const [reviewDate, setReviewDate] = useState(todayISO());

  const members = TEAM.filter(m => m.role === 'member');
  const isToday = reviewDate === todayISO();

  function shiftDate(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d + n);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  useEffect(() => {
    setLoading(true);
    setSelectedId(null);
    loadAllReportsForDate(reviewDate)
      .then(data => {
        setReports(data);
        const firstPending = data.find(r => (r.status || 'pending') === 'pending');
        if (firstPending) setSelectedId(firstPending.member_id);
      })
      .catch(() => showToast('Failed to load reports'))
      .finally(() => setLoading(false));
  }, [reviewDate]);

  function getReport(memberId) {
    return reports.find(r => r.member_id === memberId) || null;
  }

  const filed = members.map(m => ({ m, r: getReport(m.id) })).filter(x => x.r);
  const missing = members.map(m => ({ m, r: getReport(m.id) })).filter(x => !x.r);

  const pending  = filed.filter(x => (x.r.status || 'pending') === 'pending');
  const flagged  = filed.filter(x => x.r.status === 'flagged');
  const approved = filed.filter(x => x.r.status === 'approved');

  const tabItems = tab === 'pending'  ? pending
                 : tab === 'flagged'  ? flagged
                 : tab === 'approved' ? approved
                 : missing;

  async function setStatus(memberId, status) {
    setActing(memberId);
    try {
      await updateReportStatus(memberId, reviewDate, status);
      setReports(prev => prev.map(r =>
        r.member_id === memberId ? { ...r, status } : r
      ));
      const m = members.find(m => m.id === memberId);
      showToast(`${status === 'approved' ? 'Approved' : 'Flagged'} · ${m?.name || memberId}`);
    } catch {
      showToast('Action failed — try again');
    } finally {
      setActing(null);
    }
  }

  async function approveAll() {
    const toApprove = pending.map(x => x.m.id);
    for (const memberId of toApprove) {
      try {
        await updateReportStatus(memberId, reviewDate, 'approved');
      } catch { /* continue */ }
    }
    setReports(prev => prev.map(r =>
      toApprove.includes(r.member_id) ? { ...r, status: 'approved' } : r
    ));
    showToast(`Approved ${toApprove.length} report${toApprove.length !== 1 ? 's' : ''}`);
  }

  const sel = selectedId ? { m: members.find(m => m.id === selectedId), r: getReport(selectedId) } : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Review Queue</h1>
          <div className="sub">
            {loading ? 'Loading…' : `${filed.length} filed · ${missing.length} missing · ${fmtFull(reviewDate)}`}
          </div>
        </div>
        <div className="actions">
          {/* Date picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="btn ghost" style={{ width: 28, height: 28, padding: 0 }}
                    onClick={() => setReviewDate(shiftDate(reviewDate, -1))}>‹</button>
            <input type="date" className="input" value={reviewDate} max={todayISO()}
                   onChange={e => e.target.value && setReviewDate(e.target.value)}
                   style={{ width: 148, fontFamily: 'var(--font-mono)', fontSize: 13, cursor: 'pointer' }} />
            <button className="btn ghost" style={{ width: 28, height: 28, padding: 0 }}
                    disabled={isToday}
                    onClick={() => { const n = shiftDate(reviewDate, 1); if (n <= todayISO()) setReviewDate(n); }}>›</button>
            {!isToday && <button className="btn" onClick={() => setReviewDate(todayISO())}>Today</button>}
          </div>
          {pending.length > 0 && (
            <button className="btn primary" onClick={approveAll}>
              <Icon name="check" size={12} />Approve all pending ({pending.length})
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          Pending<span className="count">{pending.length}</span>
        </div>
        <div className={`tab ${tab === 'approved' ? 'active' : ''}`} onClick={() => setTab('approved')}>
          Approved<span className="count">{approved.length}</span>
        </div>
        <div className={`tab ${tab === 'flagged' ? 'active' : ''}`} onClick={() => setTab('flagged')}>
          Flagged<span className="count">{flagged.length}</span>
        </div>
        <div className={`tab ${tab === 'missing' ? 'active' : ''}`} onClick={() => setTab('missing')}>
          Missing<span className="count">{missing.length}</span>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <span className="muted">Loading reports…</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Left: list */}
          <div className="card">
            <div className="card-head">
              <h3>{tab === 'missing' ? "Hasn't filed yet" : `${tab.charAt(0).toUpperCase() + tab.slice(1)} reports`}</h3>
              <span className="faint mono" style={{ fontSize: 11 }}>{fmtFull(reviewDate)}</span>
            </div>
            <div style={{ padding: '4px 0' }}>
              {tabItems.length === 0 && (
                <div className="empty">{tab === 'missing' ? 'Everyone has filed!' : 'Nothing here.'}</div>
              )}
              {tabItems.map(({ m, r }, i) => {
                const isSelected = selectedId === m.id;
                const status = r?.status || 'pending';
                const numericTotal = r ? computeReportTotal(r.metrics) : 0;
                return (
                  <div key={m.id}
                       style={{ padding: '14px 16px', borderBottom: i < tabItems.length - 1 ? '1px solid var(--border)' : 'none', cursor: r ? 'pointer' : 'default', background: isSelected ? 'var(--surface-2)' : 'transparent', transition: 'background .1s' }}
                       onClick={() => r && setSelectedId(m.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: r ? 8 : 0 }}>
                      <div className={`avatar ${m.color}`}>{m.short}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                        <div className="faint mono" style={{ fontSize: 11 }}>
                          {r ? `Filed · ${fmtFull(r.date)}` : 'No report yet today'}
                        </div>
                      </div>
                      {r ? (
                        <span className={`chip ${status === 'approved' ? 'ok' : status === 'flagged' ? 'warn' : 'info'}`}>{status}</span>
                      ) : (
                        <span className="chip danger">missing</span>
                      )}
                    </div>
                    {r && (
                      <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-dim)' }}>
                        <span><span className="mono" style={{ color: 'var(--text)' }}>{numericTotal}</span> total</span>
                        <span><span className="mono" style={{ color: 'var(--text)' }}>{r.metrics?.email_response || 0}</span> emails</span>
                        <span><span className="mono" style={{ color: 'var(--text)' }}>{(r.metrics?.web_added || 0) + (r.metrics?.web_audited || 0)}</span> sites</span>
                        {(() => {
                          // Only flag reports filed with the core-task feature — never retroactively
                          if (!reportHasCoreData(m.id, r.metrics)) return null;
                          const missed = missedCoreTasks(m.id, r.metrics || {});
                          return missed.length > 0
                            ? <span style={{ color: 'var(--danger, #ef4444)', fontWeight: 600 }}>⚠ {missed.length} target{missed.length !== 1 ? 's' : ''} missed</span>
                            : null;
                        })()}
                        {r.note && <span style={{ color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>"{r.note}"</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: detail */}
          <div className="card" style={{ alignSelf: 'start' }}>
            {!sel || !sel.r ? (
              <div className="empty" style={{ padding: 40 }}>
                {tab === 'missing' ? 'Select a member to see details' : 'Select a report to review'}
              </div>
            ) : (() => {
              const { m, r } = sel;
              const status = r.status || 'pending';
              const memberMetrics = metricsFor(m.id);
              return (
                <>
                  <div className="card-head">
                    <div className="row-flex">
                      <div className={`avatar ${m.color}`}>{m.short}</div>
                      <div>
                        <h3 style={{ margin: 0 }}>{m.name}</h3>
                        <span className="faint mono" style={{ fontSize: 11 }}>{fmtFull(r.date)}</span>
                      </div>
                    </div>
                    <div className="actions">
                      <button className="btn ghost" disabled={acting === m.id || status === 'flagged'}
                              onClick={() => setStatus(m.id, 'flagged')}>
                        <Icon name="flag" size={12} />{status === 'flagged' ? 'Flagged' : 'Flag'}
                      </button>
                      <button className="btn primary" disabled={acting === m.id || status === 'approved'}
                              onClick={() => setStatus(m.id, 'approved')}>
                        <Icon name="check" size={12} />{acting === m.id ? 'Saving…' : status === 'approved' ? 'Approved' : 'Approve'}
                      </button>
                    </div>
                  </div>
                  <div style={{ padding: '4px 0' }}>
                    {memberMetrics.map(mt => {
                      const v = r.metrics?.[mt.key];
                      if (v === undefined || v === 'skip') return null;
                      const isNum = typeof v === 'number';
                      const isCore = !!mt.role;
                      const roleMeta = isCore ? CORE_ROLE_META[mt.role] : null;
                      const isHardTarget = isCore && mt.role !== 'secondary';
                      return (
                        <div key={mt.key} style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
                          <Icon name={mt.icon} size={13} />
                          <span style={{ flex: 1, fontSize: 13 }}>
                            {mt.label}
                            {roleMeta && <span style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.05em', color: roleMeta.color, background: roleMeta.bg, padding: '1px 4px', borderRadius: 3 }}>{roleMeta.label}</span>}
                          </span>
                          <span className="mono" style={{ fontSize: 14 }}>
                            {mt.type === 'checkbox' ? (v ? '✓' : '✗') : v}
                            {isCore && isNum && mt.target > 0 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>/{mt.target}</span>}
                          </span>
                          {isNum && mt.target > 0 && (
                            <span className={`chip ${!isHardTarget ? 'info' : v >= mt.target ? 'ok' : v >= mt.target * 0.6 ? 'warn' : 'danger'}`} style={{ minWidth: 50, justifyContent: 'center' }}>
                              {Math.round((v / mt.target) * 100)}%
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {r.metrics?._reasons && Object.keys(r.metrics._reasons).length > 0 && (
                      <div style={{ padding: '14px 16px', background: 'color-mix(in srgb, var(--danger, #ef4444) 6%, transparent)', margin: 12, borderRadius: 8, border: '1px solid color-mix(in srgb, var(--danger, #ef4444) 20%, transparent)' }}>
                        <div className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Missed target — reasons from {m.name.split(' ')[0]}</div>
                        {Object.entries(r.metrics._reasons).map(([key, reason]) => {
                          const task = memberMetrics.find(mt => mt.key === key);
                          return (
                            <div key={key} style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{task?.label || key}
                                {task && <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}> · target {task.targetLabel || task.target}</span>}
                              </div>
                              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-dim)', marginTop: 2 }}>{reason}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {r.total > 0 && (
                      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)', background: 'color-mix(in srgb, var(--accent) 5%, transparent)' }}>
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>Total</span>
                        <span className="mono" style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)' }}>{r.total}</span>
                      </div>
                    )}
                    {r.note && (
                      <div style={{ padding: '14px 16px', background: 'var(--surface-2)', margin: 12, borderRadius: 8 }}>
                        <div className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Note from {m.name.split(' ')[0]}</div>
                        <div style={{ fontSize: 13, lineHeight: 1.5 }}>{r.note}</div>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────── MEMBER DETAIL PANEL ────────────────
export function MemberDetailPanel({ memberId, onClose, setRoute }) {
  const m = TEAM.find(mm => mm.id === memberId);
  const [emailLogs, setEmailLogs] = useState([]);
  const [reports, setReports]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const today = todayISO();

  useEffect(() => {
    if (!m) return;
    Promise.all([
      loadEmailLogsByDateRange(isoNDaysAgo(30)),
      loadReportsByDateRange(isoNDaysAgo(30)),
    ]).then(([logs, rpts]) => {
      setEmailLogs(logs.filter(e => e.member_id === memberId));
      setReports(rpts.filter(r => r.member_id === memberId));
    }).catch(() => {}).finally(() => setLoading(false));
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
            <div className="card">
              <div className="card-head"><h3>Recent reports</h3></div>
              <div style={{ padding: '4px 0' }}>
                {reports.length === 0 && <div className="empty">No reports yet</div>}
                {reports.slice(0, 6).map(r => (
                  <div key={r.date} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
                    <div className="mono faint" style={{ fontSize: 11, minWidth: 50 }}>{fmtDateShort(r.date)}</div>
                    <div style={{ flex: 1, fontSize: 12 }}>
                      {Object.keys(r.metrics || {}).filter(k => !k.startsWith('_')).length} metrics · {r.total || 0} total
                    </div>
                    <span className={`chip ${r.status === 'approved' ? 'ok' : r.status === 'flagged' ? 'warn' : 'info'}`}>
                      {r.status || 'pending'}
                    </span>
                  </div>
                ))}
              </div>
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

      {/* Daily targets */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Daily targets · soft</h3></div>
        <div className="card-pad">
          <div className="grid grid-2">
            {METRICS.filter(m => m.target > 0).map(m => (
              <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <Icon name={m.icon} size={12} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{m.label}</span>
                <input className="input" style={{ width: 60, textAlign: 'center', fontFamily: 'var(--font-mono)' }} defaultValue={m.target} />
                <span className="faint" style={{ fontSize: 11, minWidth: 50 }}>{m.unit}/day</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reminders */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Reminders</h3></div>
        <div className="card-pad">
          <div className="row-flex" style={{ padding: '8px 0' }}>
            <span style={{ flex: 1 }}>Daily report reminder</span>
            <span className="mono faint" style={{ fontSize: 11 }}>17:30 IST</span>
            <span className="chip ok">on</span>
          </div>
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

      {/* Email Notifications — lead only */}
      {['lead','super'].includes(role) && <EmailNotificationsCard />}
    </div>
  );
}

function EmailNotificationsCard() {
  const TABS = [
    { id: 'reminder', label: 'Midnight reminder',     desc: 'Sent to members who haven\'t submitted by end of day' },
    { id: 'summary',  label: 'End-of-day summary',    desc: 'Sent to you at midnight with the full team status' },
    { id: 'report',   label: 'Report submission',     desc: 'Sent to you instantly when any member submits' },
  ]
  const [active, setActive]   = useState('reminder')
  const [sending, setSending] = useState(false)
  const [result, setResult]   = useState(null)  // { ok, error }
  const [html, setHtml]       = useState({})

  useEffect(() => {
    // Fetch preview HTML for each template
    TABS.forEach(({ id }) => {
      fetch(`/api/test-email?type=${id}&preview=1`)
        .then(r => r.text())
        .then(text => setHtml(prev => ({ ...prev, [id]: text })))
        .catch(() => setHtml(prev => ({ ...prev, [id]: '<p style="padding:20px;color:#888">Preview unavailable — deploy to Vercel to see it.</p>' })))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function sendTest() {
    setSending(true)
    setResult(null)
    try {
      const r = await fetch(`/api/test-email?type=${active}`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setResult({ ok: true, msg: `Test email sent to ${data.sentTo}` })
    } catch (err) {
      setResult({ ok: false, msg: err.message })
    } finally {
      setSending(false)
    }
  }

  const current = TABS.find(t => t.id === active)

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Email Notifications</h3>
          <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>Gmail · via Vercel cron + API routes</div>
        </div>
      </div>
      <div className="card-pad">
        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button key={t.id}
              onClick={() => { setActive(t.id); setResult(null) }}
              className={`btn${active === t.id ? ' primary' : ' ghost'}`}
              style={{ fontSize: 12 }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 12 }}>{current?.desc}</div>

        {/* Preview iframe */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ padding: '8px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f87171', display: 'inline-block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
            <span style={{ marginLeft: 8 }}>Email preview · {active}</span>
          </div>
          {html[active] ? (
            <iframe
              srcDoc={html[active]}
              style={{ width: '100%', height: 520, border: 'none', background: '#fff', display: 'block' }}
              title={`${active} email preview`}
              sandbox="allow-same-origin"
            />
          ) : (
            <div style={{ height: 200, display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
              Loading preview…
            </div>
          )}
        </div>

        {/* Send test button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn primary" onClick={sendTest} disabled={sending}>
            {sending ? 'Sending…' : `Send test to dev.p@amrytt.com`}
          </button>
          {result && (
            <span style={{ fontSize: 12, color: result.ok ? '#4ade80' : '#f87171' }}>
              {result.ok ? '✓ ' : '✕ '}{result.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

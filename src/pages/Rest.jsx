import { useState, useEffect } from 'react'
import { TEAM, METRICS, REPORTS, ACCENT_PRESETS, Icon, rnd, todayISO, isoNDaysAgo, fmtDateShort, fmtFull, fmtRel,
         emailsToday, emailsCountByDay, teamEmailsCountByDay, reportsForMember, reportToday, metricsFor, pct } from '../data.jsx'
import { supabase, loadAllReportsForDate, updateReportStatus } from '../lib/supabase.js'
import { Sparkline, LineChart } from './Home.jsx'

// ──────────────── ANALYTICS ────────────────
export function AnalyticsPage({ setRoute }) {
  const [range, setRange] = useState('14d');
  const days = range === '7d' ? 7 : range === '14d' ? 14 : range === '30d' ? 30 : 90;
  const trend = teamEmailsCountByDay(days);

  const memberStats = TEAM.filter(m => m.role === 'member').map(m => {
    const week = emailsCountByDay(m.id, 7).reduce((s, d) => s + d.count, 0);
    const prevWeek = emailsCountByDay(m.id, 14).slice(0, 7).reduce((s, d) => s + d.count, 0);
    const delta = prevWeek === 0 ? 0 : Math.round(((week - prevWeek) / prevWeek) * 100);
    const reports = reportsForMember(m.id, 7).length;
    return { m, week, prevWeek, delta, reports };
  });

  const metricBreakdown = METRICS.slice(0, 8).map(mt => {
    const total = TEAM.filter(m => m.role === 'member').reduce((s, m) =>
      s + reportsForMember(m.id, 7).reduce((ss, r) => ss + (r.metrics[mt.key] || 0), 0), 0);
    return { mt, total };
  }).sort((a, b) => b.total - a.total);
  const metricMax = Math.max(...metricBreakdown.map(b => b.total), 1);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">Team productivity, metric mix, member comparison.</div>
        </div>
        <div className="actions">
          <span className="seg">
            {['7d', '14d', '30d', '90d'].map(r => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
            ))}
          </span>
          <button className="btn"><Icon name="download" size={12} />Export CSV</button>
          <button className="btn ghost"><Icon name="copy" size={12} />Copy link</button>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="kpi-label">Total emails · {range}</div>
          <div className="kpi-value">{trend.reduce((s, d) => s + d.count, 0).toLocaleString()}</div>
          <div className="kpi-delta up"><Icon name="arrowUp" size={10} />+12% prior period</div>
          <Sparkline data={trend.map(d => d.count)} />
        </div>
        <div className="kpi">
          <div className="kpi-label">Reports filed</div>
          <div className="kpi-value">{memberStats.reduce((s, x) => s + x.reports, 0)}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / 35</span></div>
          <div className="kpi-target">5 days × 5 members · 1 missing</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Median emails / member / day</div>
          <div className="kpi-value">27</div>
          <div className="kpi-delta up"><Icon name="arrowUp" size={10} />+2 vs prior</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Compliance</div>
          <div className="kpi-value">92<span style={{ color: 'var(--text-faint)', fontSize: 14 }}>%</span></div>
          <div className="kpi-target">Reports on time, last {days}d</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3>Email volume — {range}</h3>
          <div className="actions">
            <span className="chip"><span className="dot-status accent"></span>Team total</span>
          </div>
        </div>
        <div className="chart-wrap"><LineChart data={trend} height={220} /></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Member comparison · 7-day</h3><span className="faint mono" style={{ fontSize: 11 }}>vs last week</span></div>
          <div style={{ padding: '0 16px 16px' }}>
            {memberStats.sort((a, b) => b.week - a.week).map(({ m, week, delta }) => (
              <div key={m.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className={`avatar ${m.color}`}>{m.short}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                  <div className="bar thin" style={{ marginTop: 6, width: '100%' }}>
                    <div className="bar-fill" style={{ width: Math.min(100, (week / 220) * 100) + '%' }}></div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono" style={{ fontSize: 15, letterSpacing: '-0.02em' }}>{week}</div>
                  <div className={`kpi-delta ${delta >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10, justifyContent: 'flex-end' }}>
                    <Icon name={delta >= 0 ? 'arrowUp' : 'arrowDown'} size={9} />{Math.abs(delta)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Metric mix · last 7 days</h3><span className="faint" style={{ fontSize: 11 }}>by category</span></div>
          <div style={{ padding: '0 16px 16px' }}>
            {metricBreakdown.map(({ mt, total }) => (
              <div key={mt.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name={mt.icon} size={13} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{mt.label}</span>
                <div className="bar thin" style={{ width: 100 }}>
                  <div className="bar-fill" style={{ width: Math.min(100, (total / metricMax) * 100) + '%' }}></div>
                </div>
                <span className="mono tnum" style={{ fontSize: 13, minWidth: 50, textAlign: 'right' }}>{total}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>When the team works · hour-of-day</h3><span className="faint" style={{ fontSize: 11 }}>past 30 days</span></div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(12, 1fr)', gap: 3, alignItems: 'center' }}>
            <div></div>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{9 + i}:00</div>
            ))}
            {TEAM.filter(m => m.role === 'member').map(m => (
              <span key={m.id} style={{ display: 'contents' }}>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{m.name.split(' ')[0]}</div>
                {Array.from({ length: 12 }).map((_, i) => {
                  const intensity = rnd(m.id + 'h' + i);
                  const lvl = intensity < 0.2 ? 0 : intensity < 0.4 ? 1 : intensity < 0.65 ? 2 : intensity < 0.85 ? 3 : 4;
                  return <div key={i} style={{ height: 20, background: lvl === 0 ? 'var(--surface-2)' : `rgba(210, 254, 92, ${0.15 + lvl * 0.2})`, borderRadius: 3 }}></div>;
                })}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────── TEAM PAGE ────────────────
export function TeamPage({ role, me, setRoute, openDetailFor }) {
  const members = TEAM;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="sub">6 members · 1 team lead · time zone IST</div>
        </div>
        <div className="actions">
          {role === 'lead' && <button className="btn"><Icon name="plus" size={12} />Invite</button>}
          <button className="btn ghost" onClick={() => setRoute('leaderboard')}><Icon name="trophy" size={12} />Leaderboard</button>
        </div>
      </div>

      <div className="grid grid-3">
        {members.map(m => {
          const isMe = m.id === me.id;
          const weekEmails = emailsCountByDay(m.id, 7).reduce((s, d) => s + d.count, 0);
          const todayE = emailsToday(m.id);
          const filed = !!reportToday(m.id);
          const spark = emailsCountByDay(m.id, 14).map(d => d.count);
          return (
            <div key={m.id} className="card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => openDetailFor(m.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div className={`avatar lg ${m.color}`}>{m.short}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {m.name}
                    {isMe && <span className="chip">you</span>}
                    {m.role === 'lead' && <span className="chip accent">lead</span>}
                  </div>
                  <div className="faint" style={{ fontSize: 11 }}>{m.email}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                <div>
                  <div className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Today</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 500 }}>{todayE}<span className="faint" style={{ fontSize: 11 }}>/30</span></div>
                </div>
                <div>
                  <div className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>7 days</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 500 }}>{weekEmails}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className={`dot-status ${filed ? 'ok' : 'warn'}`}></span>
                  <span className="faint" style={{ fontSize: 11 }}>{filed ? 'filed' : 'pending'}</span>
                </div>
              </div>
              <Sparkline data={spark} height={32} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────── LEADERBOARD ────────────────
export function LeaderboardPage({ setRoute, openDetailFor }) {
  const [scope, setScope] = useState('week');
  const [metric, setMetric] = useState('emails');
  const days = scope === 'today' ? 1 : scope === 'week' ? 7 : 30;
  const members = TEAM.filter(m => m.role === 'member');
  const scored = members.map(m => {
    const emails = emailsCountByDay(m.id, days).reduce((s, d) => s + d.count, 0);
    const sites = reportsForMember(m.id, days).reduce((s, r) => s + (r.metrics.web_added || 0) + (r.metrics.web_audited || 0), 0);
    const score = metric === 'emails' ? emails : sites;
    return { m, score, emails, sites };
  }).sort((a, b) => b.score - a.score);
  const max = scored[0]?.score || 1;

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
          <span className="seg">
            <button className={scope === 'today' ? 'on' : ''} onClick={() => setScope('today')}>Today</button>
            <button className={scope === 'week' ? 'on' : ''} onClick={() => setScope('week')}>Week</button>
            <button className={scope === 'month' ? 'on' : ''} onClick={() => setScope('month')}>Month</button>
          </span>
        </div>
      </div>

      <div className="card">
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
  const [acting, setActing] = useState(null); // memberId being actioned

  const members = TEAM.filter(m => m.role === 'member');
  const today = todayISO();

  useEffect(() => {
    setLoading(true);
    loadAllReportsForDate(today)
      .then(data => {
        setReports(data);
        // Auto-select first pending
        const firstPending = data.find(r => (r.status || 'pending') === 'pending');
        if (firstPending) setSelectedId(firstPending.member_id);
      })
      .catch(() => showToast('Failed to load reports'))
      .finally(() => setLoading(false));
  }, [today]);

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
      await updateReportStatus(memberId, today, status);
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
        await updateReportStatus(memberId, today, 'approved');
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
            {loading ? 'Loading…' : `${filed.length} filed · ${missing.length} missing · ${fmtFull(today)}`}
          </div>
        </div>
        <div className="actions">
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
              <span className="faint mono" style={{ fontSize: 11 }}>{fmtFull(today)}</span>
            </div>
            <div style={{ padding: '4px 0' }}>
              {tabItems.length === 0 && (
                <div className="empty">{tab === 'missing' ? 'Everyone has filed!' : 'Nothing here.'}</div>
              )}
              {tabItems.map(({ m, r }, i) => {
                const isSelected = selectedId === m.id;
                const status = r?.status || 'pending';
                const numericTotal = r ? Object.values(r.metrics || {}).filter(v => typeof v === 'number').reduce((s, v) => s + v, 0) : 0;
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
                      return (
                        <div key={mt.key} style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
                          <Icon name={mt.icon} size={13} />
                          <span style={{ flex: 1, fontSize: 13 }}>{mt.label}</span>
                          <span className="mono" style={{ fontSize: 14 }}>
                            {mt.type === 'checkbox' ? (v ? '✓' : '✗') : v}
                          </span>
                          {isNum && mt.target > 0 && (
                            <span className={`chip ${v >= mt.target ? 'ok' : v >= mt.target * 0.6 ? 'warn' : 'danger'}`} style={{ minWidth: 50, justifyContent: 'center' }}>
                              {Math.round((v / mt.target) * 100)}%
                            </span>
                          )}
                        </div>
                      );
                    })}
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
  if (!m) return null;
  const todayE = emailsToday(m.id);
  const weekEmails = emailsCountByDay(m.id, 7).reduce((s, d) => s + d.count, 0);
  const monthEmails = emailsCountByDay(m.id, 30).reduce((s, d) => s + d.count, 0);
  const reports = reportsForMember(m.id, 30);
  const spark = emailsCountByDay(m.id, 30);
  return (
    <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
      <div className="dp-head">
        <div className={`avatar lg ${m.color}`}>{m.short}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{m.name}</h3>
          <div className="faint" style={{ fontSize: 11 }}>{m.email} · joined {fmtDateShort(m.joined)}</div>
        </div>
        <button className="btn ghost" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>
      <div className="dp-body">
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <div className="kpi" style={{ padding: 12 }}>
            <div className="kpi-label">Today</div>
            <div className="kpi-value" style={{ fontSize: 22 }}>{todayE}</div>
          </div>
          <div className="kpi" style={{ padding: 12 }}>
            <div className="kpi-label">7d</div>
            <div className="kpi-value" style={{ fontSize: 22 }}>{weekEmails}</div>
          </div>
          <div className="kpi" style={{ padding: 12 }}>
            <div className="kpi-label">30d</div>
            <div className="kpi-value" style={{ fontSize: 22 }}>{monthEmails}</div>
          </div>
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><h3>Activity · 30 days</h3></div>
          <div className="chart-wrap"><LineChart data={spark} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Recent reports</h3></div>
          <div style={{ padding: '4px 0' }}>
            {reports.slice(0, 6).map(r => (
              <div key={r.id} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
                <div className="mono faint" style={{ fontSize: 11, minWidth: 50 }}>{fmtDateShort(r.date)}</div>
                <div style={{ flex: 1, fontSize: 12 }}>{Object.keys(r.metrics).length} metrics · {Object.values(r.metrics).reduce((s,v) => s+v, 0)} total</div>
                <span className={`chip ${r.status === 'approved' ? 'ok' : r.status === 'flagged' ? 'warn' : 'info'}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
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
      <div className="card">
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
    </div>
  );
}

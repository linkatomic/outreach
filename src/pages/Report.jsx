import { useState, useEffect, useRef } from 'react'
import { METRICS, METRIC_GROUPS, NEEL_METRICS, NEEL_METRIC_GROUPS, metricsFor, metricGroupsFor,
         coreTasksFor, missedCoreTasks, reportHasCoreData, computeReportTotal,
         TEAM, Icon, todayISO, fmtFull, fmtDateShort } from '../data.jsx'
import { saveReport, loadReport, loadMostRecentReport, getEmailCountToday, getEmailCountForDate } from '../lib/supabase.js'

// Minimum characters for a valid missed-target reason
const REASON_MIN = 10;

function ReadOnlyView({ record, date, memberName, metricsDef = METRICS, canEdit = false }) {
  if (!record) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>—</div>
        <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>
          No report filed{memberName ? ` by ${memberName}` : ''} for this day
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>{fmtFull(date)}</div>
      </div>
    );
  }

  const metrics = record.metrics || {};
  const reasons = metrics._reasons || {};
  // Records filed before the core-task feature have no core keys — don't
  // retroactively stamp them with hit/missed chips
  const hasCoreData = metricsDef.some(m => m.group === 'core' && m.key in metrics);
  const reasonEntries = metricsDef
    .filter(m => reasons[m.key])
    .map(m => ({ task: m, reason: reasons[m.key] }));

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="check" size={13} />
        <span style={{ fontSize: 13 }}>Report filed for {fmtFull(date)}</span>
        <div className="spacer" />
        <span className="chip accent">Total: {record.total}</span>
        {!canEdit && <span className="chip warn">Read only</span>}
      </div>
      <div className="card">
        <div className="card-pad">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {metricsDef.map(m => {
              const v = metrics[m.key];
              const isSkipped = v === 'skip';
              const isCheckbox = m.type === 'checkbox';
              const hasValue = typeof v === 'number' || typeof v === 'boolean';
              const isCore = m.group === 'core';
              const hardTarget = isCore && hasCoreData && (m.target > 0 || m.mustComplete);
              const targetMet = !hardTarget ? null
                : isCheckbox ? v === true
                : typeof v === 'number' && v >= m.target;
              return (
                <div key={m.key} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8,
                  opacity: (!hasValue && !isSkipped) ? 0.35 : 1,
                  border: isCore ? '1px solid ' + (targetMet === false ? 'color-mix(in srgb, var(--danger, #ef4444) 35%, transparent)' : targetMet === true ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--border)') : 'none',
                }}>
                  <Icon name={m.icon} size={14} />
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {m.label}
                    {isCore && (
                      <span style={{ display: 'block', fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>
                        Target: {m.targetLabel || `${m.target} ${m.unit}`}
                      </span>
                    )}
                  </span>
                  {targetMet === true && <span className="chip accent" style={{ fontSize: 9 }}>hit</span>}
                  {targetMet === false && <span className="chip warn" style={{ fontSize: 9 }}>missed</span>}
                  <span className="mono" style={{
                    fontSize: 14,
                    fontWeight: hasValue ? 600 : 400,
                    color: isSkipped ? 'var(--text-faint)' : (isCheckbox && v === false) ? 'var(--text-faint)' : 'var(--text)',
                  }}>
                    {isSkipped ? '—' : isCheckbox ? (v ? '✓' : '✗') : (hasValue ? v : '0')}
                    {isCore && m.target > 0 && !isCheckbox && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>/{m.target}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {reasonEntries.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 16, border: '1px solid color-mix(in srgb, var(--danger, #ef4444) 25%, transparent)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 10 }}>
            Missed target — reasons given
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reasonEntries.map(({ task, reason }) => (
              <div key={task.key}>
                <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={task.icon} size={12} /> {task.label}
                  <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>· target {task.targetLabel || task.target}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)', marginTop: 3, paddingLeft: 18 }}>{reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {record.note && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 8 }}>Notes</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>{record.note}</div>
        </div>
      )}
    </div>
  );
}

// ── Lead edit form ─────────────────────────────────────────────
// Grid-style editable form for team leads to create/edit any member's report.
// email_response is always locked to the value from email_logs (same as member view).
function LeadEditForm({ member, date, record, emailCount, onSave, onCancel, showToast }) {
  const metricsDef = metricsFor(member.id);
  const memberIsNeel = !!member.neelOnly;
  const [vals, setVals]   = useState(() => record?.metrics || {});
  const [note, setNote]   = useState(record?.note || '');
  const [saving, setSaving] = useState(false);

  // Keep email_response locked to email log count
  useEffect(() => {
    if (!memberIsNeel && emailCount != null) {
      setVals(prev => ({ ...prev, email_response: emailCount }));
    }
  }, [emailCount, memberIsNeel]);

  const total = computeReportTotal(vals);

  async function handleSave() {
    setSaving(true);
    // Drop reasons for tasks that are no longer missed after the lead's edits
    const { _reasons, ...cleanVals } = vals;
    const stillMissed = new Set(missedCoreTasks(member.id, cleanVals).map(t => t.key));
    const keptReasons = Object.fromEntries(
      Object.entries(_reasons || {}).filter(([k]) => stillMissed.has(k))
    );
    const payload = Object.keys(keptReasons).length ? { ...cleanVals, _reasons: keptReasons } : cleanVals;
    try {
      await saveReport({ memberId: member.id, date, metrics: payload, note, total });
      onSave({ ...record, metrics: payload, note, total });
    } catch (err) {
      showToast('Save failed: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="edit" size={13} />
        <span style={{ fontSize: 13 }}>Editing <b>{member.name}</b>'s report · {fmtFull(date)}</span>
        <div className="spacer" />
        <span className="chip accent">Total: {total}</span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-pad">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {metricsDef.map(m => {
              const isAutoFilled = !memberIsNeel && m.key === 'email_response';
              return (
                <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8 }}>
                  <Icon name={m.icon} size={14} />
                  <span style={{ flex: 1, fontSize: 13 }}>{m.label}</span>
                  {isAutoFilled ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="chip" style={{ fontSize: 10, opacity: 0.8 }}>auto</span>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)', minWidth: 32, textAlign: 'right' }}>
                        {emailCount ?? vals[m.key] ?? 0}
                      </span>
                    </div>
                  ) : m.type === 'checkbox' ? (
                    <button
                      onClick={() => setVals(p => ({ ...p, [m.key]: !p[m.key] }))}
                      style={{
                        height: 30, padding: '0 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                        fontSize: 13, border: '1.5px solid ' + (vals[m.key] ? 'var(--accent)' : 'var(--border)'),
                        background: vals[m.key] ? 'var(--accent)' : 'transparent',
                        color: vals[m.key] ? 'var(--accent-ink)' : 'var(--text-faint)',
                        transition: 'all 0.15s',
                      }}>
                      {vals[m.key] ? '✓ Done' : 'Not done'}
                    </button>
                  ) : (
                    <>
                      <button className="btn ghost" style={{ width: 24, height: 24, padding: 0 }}
                              onClick={() => setVals(p => ({ ...p, [m.key]: Math.max(0, (p[m.key] || 0) - 1) }))}>−</button>
                      <input className="input" style={{ width: 60, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
                             value={typeof vals[m.key] === 'number' ? vals[m.key] : ''}
                             placeholder="0"
                             onChange={e => setVals(p => ({ ...p, [m.key]: parseInt(e.target.value || '0', 10) || 0 }))} />
                      <button className="btn ghost" style={{ width: 24, height: 24, padding: 0 }}
                              onClick={() => setVals(p => ({ ...p, [m.key]: (typeof p[m.key] === 'number' ? p[m.key] : 0) + 1 }))}>+</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Notes</h3><span className="faint" style={{ fontSize: 11 }}>{note.length}/280</span></div>
          <div className="card-pad">
            <textarea className="input" style={{ height: 80, padding: 10, resize: 'none', width: '100%' }}
                      placeholder="Notes for this report…" maxLength={280}
                      value={note} onChange={e => setNote(e.target.value)} />
          </div>
        </div>
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
            <div style={{ fontSize: 26, fontFamily: 'var(--font-mono)', fontWeight: 500, marginTop: 2 }}>{total}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : record ? 'Update report' : 'Create report'}
          </button>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function DailyReportPage({ me, setRoute, showToast }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState({});
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('numpad');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyingLast, setCopyingLast] = useState(false);
  const [alreadySaved, setAlreadySaved] = useState(false);
  const [loadingToday, setLoadingToday] = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [liveEmailCount, setLiveEmailCount] = useState(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState(''); // '' | 'saving' | 'saved'
  const [reasons, setReasons] = useState({});          // { coreTaskKey: reason text }
  const [showReasons, setShowReasons] = useState(false);
  const [pendingFinal, setPendingFinal] = useState(null);
  const inputRef = useRef(null);
  const userEditedRef = useRef(false);
  const valuesRef = useRef({});
  const noteRef = useRef('');
  const reasonsRef = useRef({});

  // Keep refs in sync for unmount-flush
  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { noteRef.current = note; }, [note]);
  useEffect(() => { reasonsRef.current = reasons; }, [reasons]);

  const isLead = ['lead', 'hr', 'super'].includes(me.role);
  const allMembers = TEAM.filter(m => m.role === 'member');
  const [selectedMemberId, setSelectedMemberId] = useState(allMembers[0]?.id || '');
  const [leadRecord, setLeadRecord] = useState(null);
  const [loadingLeadRecord, setLoadingLeadRecord] = useState(false);
  const [leadEditing, setLeadEditing] = useState(false);
  const [leadEmailCount, setLeadEmailCount] = useState(null);

  const myMetrics   = metricsFor(me.id);
  const myGroups    = metricGroupsFor(me.id);
  const isNeel      = !!TEAM.find(m => m.id === me.id)?.neelOnly;
  const myCoreTasks = coreTasksFor(me.id);

  // Merge validated reasons for currently-missed core tasks into the metrics payload.
  // Only reasons meeting the minimum length are persisted — a half-typed reason
  // must never surface as an official explanation in the review views.
  function buildMetricsPayload(vals, reasonMap) {
    const missed = missedCoreTasks(me.id, vals);
    const kept = {};
    for (const t of missed) {
      const r = (reasonMap[t.key] || '').trim();
      if (r.length >= REASON_MIN) kept[t.key] = r;
    }
    const { _reasons: _drop, ...clean } = vals;
    return Object.keys(kept).length ? { ...clean, _reasons: kept } : clean;
  }

  // email_response is auto-filled from email log — excluded from the manual step queue
  const queue   = myMetrics.filter(m => isNeel || m.key !== 'email_response');
  const current = queue[stepIdx];
  const completed = Object.keys(values).filter(k => values[k] !== 'skip' && values[k] !== undefined).length;
  const skipped   = Object.keys(values).filter(k => values[k] === 'skip').length;
  const total     = computeReportTotal(values);

  // Pre-fill today's form (auto-populate email_response from live email log for non-Neel)
  useEffect(() => {
    loadReport(me.id, todayISO())
      .then(async (existing) => {
        if (existing) {
          const { _reasons, ...vals } = existing.metrics || {};
          setValues(vals);
          setReasons(_reasons || {});
          setNote(existing.note || '');
          setAlreadySaved(true);
        }
        if (!isNeel) {
          try {
            const count = await getEmailCountToday(me.id);
            setLiveEmailCount(count);
          } catch { /* silent */ }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingToday(false));
  }, [me.id, isNeel]);

  // Always keep email_response locked to liveEmailCount for non-Neel members
  useEffect(() => {
    if (!isNeel && liveEmailCount != null) {
      setValues(prev => ({ ...prev, email_response: liveEmailCount }));
    }
  }, [liveEmailCount, isNeel]);

  // Refresh live email count every 30s (standard members only)
  useEffect(() => {
    if (isLead || isNeel) return;
    const interval = setInterval(async () => {
      try {
        const count = await getEmailCountToday(me.id);
        setLiveEmailCount(count);
      } catch { /* silent */ }
    }, 30000);
    return () => clearInterval(interval);
  }, [me.id, isLead, isNeel]);

  // ── Auto-save: fires 1s after any user-initiated edit ─────────
  const isToday = selectedDate === todayISO();
  useEffect(() => {
    if (!isToday || isLead || !userEditedRef.current || loadingToday) return;
    setAutoSaveStatus('saving');
    const v = buildMetricsPayload(values, reasons); const n = note;
    const numericTotal = computeReportTotal(v);
    const timer = setTimeout(async () => {
      try {
        await saveReport({ memberId: me.id, date: todayISO(), metrics: v, note: n, total: numericTotal });
        setAlreadySaved(true);
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus(''), 1800);
      } catch { setAutoSaveStatus(''); }
    }, 1000);
    return () => clearTimeout(timer);
  }, [values, note, reasons]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush save on unmount
  useEffect(() => {
    return () => {
      if (!userEditedRef.current) return;
      if (Object.keys(valuesRef.current).length === 0) return;
      const v = buildMetricsPayload(valuesRef.current, reasonsRef.current); const n = noteRef.current;
      const numericTotal = computeReportTotal(v);
      saveReport({ memberId: me.id, date: todayISO(), metrics: v, note: n, total: numericTotal }).catch(() => {});
    };
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copyLast() {
    setCopyingLast(true);
    try {
      const report = await loadMostRecentReport(me.id);
      if (!report) { showToast('No previous report found'); return; }
      // Keep email_response locked — don't copy it (or old reasons) from previous report
      const { email_response: _, _reasons: __, ...otherMetrics } = report.metrics || {};
      setValues(prev => ({ ...prev, ...otherMetrics }));
      setNote(report.note || '');
      setStepIdx(0);
      showToast(`Copied from ${fmtDateShort(report.date)} — adjust values then submit`);
    } catch {
      showToast('Could not load previous report');
    } finally {
      setCopyingLast(false);
    }
  }

  // Load record when a past date is selected (member view)
  useEffect(() => {
    if (isToday || isLead) return;
    setLoadingRecord(true);
    setSelectedRecord(null);
    loadReport(me.id, selectedDate)
      .then(record => setSelectedRecord(record))
      .catch(() => setSelectedRecord(null))
      .finally(() => setLoadingRecord(false));
  }, [selectedDate, me.id, isToday, isLead]);

  // Load record for lead view whenever member or date changes
  useEffect(() => {
    if (!isLead) return;
    setLeadEditing(false);
    setLeadEmailCount(null);
    setLoadingLeadRecord(true);
    setLeadRecord(null);
    loadReport(selectedMemberId, selectedDate)
      .then(record => setLeadRecord(record))
      .catch(() => setLeadRecord(null))
      .finally(() => setLoadingLeadRecord(false));
  }, [isLead, selectedMemberId, selectedDate]);

  async function startLeadEdit() {
    setLeadEditing(true);
    try {
      const count = await getEmailCountForDate(selectedMemberId, selectedDate);
      setLeadEmailCount(count);
    } catch {
      setLeadEmailCount(null);
    }
  }

  // Keyboard shortcuts (today only, member only)
  useEffect(() => {
    if (mode !== 'numpad' || !isToday || done || showReasons) return;
    const onKey = (e) => {
      if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.target !== inputRef.current) return;
      if (current?.type === 'checkbox') {
        if (e.key === ' ') { e.preventDefault(); userEditedRef.current = true; setValues(p => ({...p, [current.key]: !p[current.key]})); }
        else if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Tab') { e.preventDefault(); skip(); }
      } else {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setDraft(d => (d === '0' ? e.key : d + e.key).slice(0, 4)); }
        else if (e.key === 'Backspace') { e.preventDefault(); setDraft(d => d.slice(0, -1)); }
        else if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Tab') { e.preventDefault(); skip(); }
        else if (e.key === '+') { e.preventDefault(); setDraft(d => String((parseInt(d || '0', 10) || 0) + 1)); }
        else if (e.key === '-') { e.preventDefault(); setDraft(d => String(Math.max(0, (parseInt(d || '0', 10) || 0) - 1))); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function commit() {
    if (!current) return;
    userEditedRef.current = true;
    const v = current.type === 'checkbox'
      ? (values[current.key] === true ? true : false)
      : (draft === '' ? 0 : parseInt(draft, 10));
    setValues(prev => ({ ...prev, [current.key]: v }));
    setDraft('');
    if (stepIdx < queue.length - 1) setStepIdx(stepIdx + 1);
    else finalize({ ...values, [current.key]: v });
  }
  function skip() {
    if (!current) return;
    userEditedRef.current = true;
    setValues(prev => ({ ...prev, [current.key]: 'skip' }));
    setDraft('');
    if (stepIdx < queue.length - 1) setStepIdx(stepIdx + 1);
    else finalize({ ...values, [current.key]: 'skip' });
  }
  function back() {
    if (stepIdx === 0) return;
    setStepIdx(stepIdx - 1);
    const prev = queue[stepIdx - 1];
    const v = values[prev.key];
    setDraft(typeof v === 'number' ? String(v) : '');
  }

  function reasonOk(taskKey) {
    return (reasons[taskKey] || '').trim().length >= REASON_MIN;
  }

  async function finalize(final) {
    // Hard daily targets: every missed core task needs a written reason before submit
    const missed = missedCoreTasks(me.id, final);
    if (missed.some(t => !reasonOk(t.key))) {
      setPendingFinal(final);
      setShowReasons(true);
      return;
    }
    await submitFinal(final);
  }

  async function submitFinal(final) {
    setSaving(true);
    // email_response is auto-filled and may have updated while the reasons modal was open
    const merged = (!isNeel && typeof liveEmailCount === 'number')
      ? { ...final, email_response: liveEmailCount }
      : final;
    const payload = buildMetricsPayload(merged, reasons);
    const numericTotal = computeReportTotal(payload);
    try {
      await saveReport({ memberId: me.id, date: todayISO(), metrics: payload, note, total: numericTotal });
      setShowReasons(false);
      setDone(true);
      showToast(`Report saved · ${numericTotal} total`);
      // Send summary email to lead (fire-and-forget — never block the UI)
      sendReportEmail({
        me, metrics: payload, note, total: numericTotal,
        metricsDef: metricsFor(me.id),
        missedTasks: missedCoreTasks(me.id, payload),
        reasons: payload._reasons || {},
      }).catch(() => {})
    } catch {
      showToast('Save failed — check your connection');
      setSaving(false);
    }
  }

  function handleDateChange(e) {
    const val = e.target.value;
    if (!val) return;
    setSelectedDate(val);
  }

  function shiftDate(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d + n);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  const datePicker = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button className="btn ghost" style={{ width: 28, height: 28, padding: 0 }}
              onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
              title="Previous day">‹</button>
      <input type="date" className="input" value={selectedDate} max={todayISO()} onChange={handleDateChange}
             style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 148, cursor: 'pointer' }} />
      <button className="btn ghost" style={{ width: 28, height: 28, padding: 0 }}
              disabled={isToday}
              onClick={() => { const next = shiftDate(selectedDate, 1); if (next <= todayISO()) setSelectedDate(next); }}
              title="Next day">›</button>
      {!isToday && <button className="btn" onClick={() => setSelectedDate(todayISO())}>Today</button>}
    </div>
  );

  // ── Lead view ────────────────────────────────────────────────
  if (isLead) {
    const selectedMember = allMembers.find(m => m.id === selectedMemberId);
    const viewMetrics = metricsFor(selectedMemberId);
    return (
      <div className="page" style={{ maxWidth: 1080 }}>
        <div className="page-head">
          <div>
            <h1>Daily Report</h1>
            <div className="sub">{fmtFull(selectedDate)}</div>
          </div>
          <div className="actions">
            <select
              className="input"
              value={selectedMemberId}
              onChange={e => setSelectedMemberId(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 180, cursor: 'pointer' }}
            >
              {allMembers.map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.neelOnly ? ' ★' : ''}</option>
              ))}
            </select>
            {datePicker}
            {!leadEditing && !loadingLeadRecord && (
              <button className="btn" onClick={startLeadEdit}>
                <Icon name="edit" size={12} />{leadRecord ? 'Edit' : 'Create'}
              </button>
            )}
          </div>
        </div>

        {selectedMember?.neelOnly && !leadEditing && (
          <div style={{ marginBottom: 12, padding: '8px 14px', background: 'rgba(168,139,250,0.08)', border: '1px solid rgba(168,139,250,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--text-faint)' }}>
            ★ Neel uses a separate task track — scraping & indexing metrics, not included in team analytics
          </div>
        )}

        {loadingLeadRecord && (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}><span className="muted">Loading…</span></div>
        )}

        {!loadingLeadRecord && (
          leadEditing ? (
            <LeadEditForm
              member={selectedMember}
              date={selectedDate}
              record={leadRecord}
              emailCount={leadEmailCount}
              onSave={(updated) => {
                setLeadRecord(updated);
                setLeadEditing(false);
                showToast('Report saved');
              }}
              onCancel={() => setLeadEditing(false)}
              showToast={showToast}
            />
          ) : (
            <ReadOnlyView
              date={selectedDate}
              record={leadRecord}
              memberName={selectedMember?.name}
              metricsDef={viewMetrics}
              canEdit={true}
            />
          )
        )}
      </div>
    );
  }

  // ── Post-submit confirmation ──────────────────────────────────
  if (done) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-ink)', margin: '0 auto 16px', display: 'grid', placeItems: 'center' }}>
            <Icon name="check" size={28} stroke={2} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px' }}>Report saved</h2>
          <p className="muted" style={{ margin: '0 0 20px' }}>{fmtFull(todayISO())}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, textAlign: 'left', maxWidth: 480, margin: '0 auto 24px' }}>
            {Object.entries(values).filter(([_, v]) => typeof v === 'number' && v > 0).map(([k, v]) => {
              const m = myMetrics.find(mm => mm.key === k);
              if (!m) return null;
              return (
                <div key={k} style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name={m.icon} size={13} />
                  <span style={{ flex: 1, fontSize: 12.5 }}>{m.label}</span>
                  <span className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{v}</span>
                </div>
              );
            })}
          </div>
          <div className="hint-line" style={{ justifyContent: 'center', marginBottom: 20 }}>
            <span>Total: <b style={{ color: 'var(--text)' }} className="mono">{total}</b></span>
            <span>·</span><span>{completed} logged</span>
            <span>·</span><span>{skipped} skipped</span>
          </div>
          <div className="row-flex" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => setRoute('home')}>Back to home</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Member form ───────────────────────────────────────────────
  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <div className="page-head">
        <div>
          <h1>Daily Report</h1>
          <div className="sub">
            {isToday ? `${fmtFull(todayISO())} · ${me.name}` : fmtFull(selectedDate)}
            {isNeel && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-faint)', background: 'var(--surface-2)', padding: '2px 7px', borderRadius: 4 }}>★ Scraping track</span>}
          </div>
        </div>
        <div className="actions">
          {datePicker}
          {isToday && (
            <>
              <span className="seg">
                <button className={mode === 'numpad' ? 'on' : ''} onClick={() => setMode('numpad')}>Numpad</button>
                <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Grid</button>
                <button onClick={copyLast} disabled={copyingLast}>
                  {copyingLast ? 'Copying…' : 'Copy last'}
                </button>
              </span>
              <button className="btn ghost" onClick={() => setRoute('home')}><Icon name="x" size={12} />Discard</button>
            </>
          )}
        </div>
      </div>

      {/* Past date — read only */}
      {!isToday && (
        loadingRecord
          ? <div className="card" style={{ padding: 48, textAlign: 'center' }}><span className="muted">Loading…</span></div>
          : <ReadOnlyView date={selectedDate} record={selectedRecord} metricsDef={myMetrics} />
      )}

      {/* Today — editable form */}
      {isToday && (
        loadingToday
          ? <div className="card" style={{ padding: 48, textAlign: 'center' }}><span className="muted">Loading today's report…</span></div>
          : <>
              {alreadySaved && (
                <div style={{ marginBottom: 12, padding: '8px 14px', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <Icon name="check" size={13} />
                  <span>You already submitted today's report — values are pre-filled. Edit and resubmit to update.</span>
                </div>
              )}

              {mode === 'numpad' ? (
                <div className="numpad">
                  <div className="numpad-stage" onClick={() => inputRef.current && inputRef.current.focus()}>
                    <input ref={inputRef} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} autoFocus />
                    <div className="numpad-step"><span style={{ color: 'var(--text-dim)' }}>{myGroups.find(g => g.id === current.group)?.label}</span></div>
                    <div className="numpad-prompt">How many today?</div>
                    <div className="numpad-metric">
                      <Icon name={current.icon} size={20} />
                      <span style={{ marginLeft: 8 }}>{current.label}</span>
                    </div>
                    {current.group === 'core' && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                        <span className="chip" style={{ fontSize: 10, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>
                          CORE · Daily target: {current.targetLabel || `${current.target} ${current.unit}`}
                        </span>
                      </div>
                    )}

                    {current.type === 'checkbox' ? (
                      <>
                        <div style={{ margin: '20px 0' }}>
                          <button
                            onClick={() => { userEditedRef.current = true; setValues(p => ({...p, [current.key]: !p[current.key]})); }}
                            style={{
                              width: '100%', height: 80, borderRadius: 12, cursor: 'pointer',
                              background: values[current.key] ? 'var(--accent)' : 'var(--surface-2)',
                              color: values[current.key] ? 'var(--accent-ink)' : 'var(--text-dim)',
                              border: '2px solid ' + (values[current.key] ? 'var(--accent)' : 'var(--border)'),
                              fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center',
                              justifyContent: 'center', gap: 10, transition: 'all 0.15s',
                            }}
                          >
                            <span style={{ fontSize: 22 }}>{values[current.key] ? '✓' : '○'}</span>
                            {values[current.key] ? 'Done today' : 'Not done yet'}
                          </button>
                        </div>
                        <div className="hint-line" style={{ marginBottom: 12 }}>
                          <span className="kbd">Space</span> toggle
                          <span style={{ marginLeft: 8 }} className="kbd">↵</span> confirm & next
                          <span style={{ marginLeft: 8 }} className="kbd">tab</span> skip
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="numpad-input">
                          <span className={`numpad-number ${draft === '' ? 'ghost' : ''}`}>{draft || '0'}</span>
                          <span className="numpad-unit">{current.unit}</span>
                          {current.target > 0 && draft && parseInt(draft, 10) >= current.target && (
                            <span className="chip accent" style={{ marginLeft: 8 }}>target hit</span>
                          )}
                        </div>
                        <div className="numpad-keys">
                          {['1','2','3','4','5','6','7','8','9'].map(n => (
                            <button key={n} className="numpad-key" onClick={() => setDraft(d => (d === '0' ? n : d + n).slice(0, 4))}>{n}</button>
                          ))}
                          <button className="numpad-key" onClick={() => setDraft(d => d.slice(0, -1))}>⌫</button>
                          <button className="numpad-key" onClick={() => setDraft(d => (d === '0' ? '0' : d + '0').slice(0, 4))}>0</button>
                          <button className="numpad-key acc" onClick={commit}>↵</button>
                        </div>
                        <div className="hint-line" style={{ marginBottom: 12 }}>
                          <span className="kbd">↵</span> save & next
                          <span style={{ marginLeft: 8 }} className="kbd">tab</span> skip
                          <span style={{ marginLeft: 8 }} className="kbd">+</span> / <span className="kbd">−</span> nudge
                          <span style={{ marginLeft: 8 }} className="kbd">⌫</span> erase
                        </div>
                      </>
                    )}
                    <div className="skip-row">
                      <button className="btn ghost" onClick={back} disabled={stepIdx === 0}>
                        <Icon name="arrow" size={11} style={{ transform: 'rotate(180deg)' }} /> Back
                      </button>
                      <button className="btn ghost" onClick={skip}>Skip <span className="kbd">tab</span></button>
                      <div className="spacer"></div>
                      <button className="btn primary" onClick={commit} disabled={saving}>Save & next <span className="kbd">↵</span></button>
                    </div>
                  </div>

                  <div className="numpad-queue">
                    <div className="numpad-queue-head">
                      <span>Today's metrics</span>
                      <span className="mono faint" style={{ fontSize: 11 }}>{completed} logged</span>
                    </div>
                    <div className="numpad-queue-list">
                      {myMetrics.map((m) => {
                        const isAutoFilled = !isNeel && m.key === 'email_response';
                        const v = values[m.key];
                        const queueIdx = queue.findIndex(q => q.key === m.key);
                        const isCurrent = !isAutoFilled && queue[stepIdx]?.key === m.key;
                        const isDone = typeof v === 'number' || typeof v === 'boolean';
                        const isSkip = v === 'skip';
                        const displayVal = typeof v === 'boolean' ? (v ? '✓' : '✗') : v;
                        return (
                          <div key={m.key}
                               className={`numpad-queue-row ${isCurrent ? 'active' : ''} ${(isDone || isAutoFilled) ? 'done' : ''} ${isSkip ? 'skip' : ''}`}
                               style={isAutoFilled ? { cursor: 'default', opacity: 0.85 } : {}}
                               onClick={() => {
                                 if (isAutoFilled || queueIdx === -1) return;
                                 setStepIdx(queueIdx);
                                 setDraft(typeof v === 'number' ? String(v) : '');
                               }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Icon name={m.icon} size={12} />
                              {m.label}
                              {m.group === 'core' && (
                                <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', padding: '1px 4px', borderRadius: 3 }}>CORE</span>
                              )}
                            </span>
                            <span className="val">
                              {isAutoFilled ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 9, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.05em' }}>auto</span>
                                  <span style={{ color: 'var(--accent)' }}>{liveEmailCount ?? (typeof v === 'number' ? v : '—')}</span>
                                </span>
                              ) : isDone ? (
                                m.group === 'core' && m.target > 0 && typeof v === 'number'
                                  ? <span style={{ color: v >= m.target ? 'var(--accent)' : 'var(--warn, #fbbf24)' }}>{v}<span style={{ opacity: 0.5 }}>/{m.target}</span></span>
                                  : displayVal
                              )
                                : isSkip ? '—'
                                : isCurrent ? '…' : '·'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span className="muted">Total counted</span>
                      <span className="mono" style={{ color: 'var(--accent)', fontSize: 14 }}>{total}</span>
                    </div>
                  </div>
                </div>
              ) : (
                // ── Grid mode ──────────────────────────────────
                <div className="card">
                  <div className="card-pad">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      {myMetrics.map(m => {
                        const isAutoFilled = !isNeel && m.key === 'email_response';
                        const isCore = m.group === 'core';
                        const coreHit = isCore && (m.type === 'checkbox'
                          ? values[m.key] === true
                          : m.target > 0 && typeof values[m.key] === 'number' && values[m.key] >= m.target);
                        return (
                          <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, border: isCore ? '1px solid ' + (coreHit ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'color-mix(in srgb, var(--accent) 15%, transparent)') : 'none' }}>
                            <Icon name={m.icon} size={14} />
                            <span style={{ flex: 1, fontSize: 13 }}>
                              {m.label}
                              {isCore && (
                                <span style={{ display: 'block', fontSize: 10, color: coreHit ? 'var(--accent)' : 'var(--text-faint)', marginTop: 1 }}>
                                  {coreHit ? '✓ target hit · ' : ''}Target: {m.targetLabel || `${m.target} ${m.unit}`}
                                </span>
                              )}
                            </span>
                            {isAutoFilled ? (
                              // Locked — auto-filled from email log
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="chip" style={{ fontSize: 10, opacity: 0.8 }}>auto</span>
                                <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)', minWidth: 32, textAlign: 'right' }}>
                                  {liveEmailCount ?? values[m.key] ?? 0}
                                </span>
                              </div>
                            ) : m.type === 'checkbox' ? (
                              <button
                                onClick={() => { userEditedRef.current = true; setValues(p => ({...p, [m.key]: !p[m.key]})); }}
                                style={{
                                  height: 30, padding: '0 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                                  fontSize: 13, border: '1.5px solid ' + (values[m.key] ? 'var(--accent)' : 'var(--border)'),
                                  background: values[m.key] ? 'var(--accent)' : 'transparent',
                                  color: values[m.key] ? 'var(--accent-ink)' : 'var(--text-faint)',
                                  transition: 'all 0.15s',
                                }}
                              >
                                {values[m.key] ? '✓ Done' : 'Not done'}
                              </button>
                            ) : (
                              <>
                                <button className="btn ghost" style={{ width: 24, height: 24, padding: 0 }}
                                        onClick={() => { userEditedRef.current = true; setValues(p => ({...p, [m.key]: Math.max(0, (p[m.key] || 0) - 1)})); }}>−</button>
                                <input className="input" style={{ width: 60, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
                                       value={typeof values[m.key] === 'number' ? values[m.key] : ''}
                                       placeholder="0"
                                       onChange={(e) => { userEditedRef.current = true; setValues(p => ({...p, [m.key]: parseInt(e.target.value || '0', 10) || 0})); }} />
                                <button className="btn ghost" style={{ width: 24, height: 24, padding: 0 }}
                                        onClick={() => { userEditedRef.current = true; setValues(p => ({...p, [m.key]: (typeof p[m.key] === 'number' ? p[m.key] : 0) + 1})); }}>+</button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
                <div className="card">
                  <div className="card-head"><h3>Notes (optional)</h3><span className="faint" style={{ fontSize: 11 }}>{note.length}/280</span></div>
                  <div className="card-pad">
                    <textarea className="input" style={{ height: 80, padding: 10, resize: 'none', width: '100%' }}
                              placeholder="Anything worth flagging — blockers, outliers, context for today's numbers…"
                              maxLength={280} value={note} onChange={(e) => { userEditedRef.current = true; setNote(e.target.value); }} />
                  </div>
                </div>
                <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Submission</div>
                      {autoSaveStatus && (
                        <span style={{ fontSize: 10, color: autoSaveStatus === 'saved' ? 'var(--ok)' : 'var(--text-faint)', marginLeft: 'auto' }}>
                          {autoSaveStatus === 'saving' ? '↻ saving…' : '✓ saved'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 500, marginTop: 4 }}>{total}</div>
                    <div className="muted" style={{ fontSize: 11 }}>tasks recorded</div>
                  </div>
                  <button className="btn primary lg" onClick={() => finalize(values)} disabled={saving}>
                    {saving ? 'Saving…' : alreadySaved ? <span>Update report <span className="kbd">⌘ ↵</span></span> : <span>Submit report <span className="kbd">⌘ ↵</span></span>}
                  </button>
                </div>
              </div>
            </>
      )}

      {/* ── Missed-target reasons (blocks submission until each has a proper reason) ── */}
      {showReasons && (() => {
        const finalVals  = pendingFinal || values;
        const missedNow  = missedCoreTasks(me.id, finalVals);
        const allOk      = missedNow.every(t => reasonOk(t.key));
        if (missedNow.length === 0) { /* targets now met — nothing to explain */ }
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', padding: 20 }}
               onClick={e => { if (e.target === e.currentTarget) setShowReasons(false); }}>
            <div className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ width: 34, height: 34, borderRadius: 8, background: 'color-mix(in srgb, var(--danger, #ef4444) 15%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--danger, #ef4444)' }}>
                  <Icon name="alert" size={16} />
                </span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Daily target{missedNow.length !== 1 ? 's' : ''} missed</div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    {missedNow.length === 0
                      ? 'All targets now met — you can submit.'
                      : 'A written reason is required for each missed target before you can submit.'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
                {missedNow.map(t => {
                  const v = finalVals[t.key];
                  const actual = t.type === 'checkbox'
                    ? (v === true ? 'Done' : 'Not done')
                    : (typeof v === 'number' ? v : 0);
                  const len = (reasons[t.key] || '').trim().length;
                  const ok  = len >= REASON_MIN;
                  return (
                    <div key={t.key} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 14, border: '1px solid ' + (ok ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'var(--border)') }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Icon name={t.icon} size={13} />
                        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{t.label}</span>
                        <span className="chip warn" style={{ fontSize: 10 }}>
                          {actual} / {t.targetLabel || `${t.target} ${t.unit}`}
                        </span>
                      </div>
                      <textarea
                        className="input"
                        style={{ width: '100%', height: 64, padding: 9, resize: 'none', fontSize: 13 }}
                        placeholder="Why wasn't this target achieved today? Be specific — blockers, dependencies, time spent elsewhere…"
                        maxLength={500}
                        value={reasons[t.key] || ''}
                        onChange={e => { userEditedRef.current = true; setReasons(prev => ({ ...prev, [t.key]: e.target.value })); }}
                      />
                      <div style={{ fontSize: 10, color: ok ? 'var(--ok, var(--accent))' : 'var(--text-faint)', marginTop: 4, textAlign: 'right' }}>
                        {ok ? '✓ reason recorded' : `at least ${REASON_MIN} characters (${len}/${REASON_MIN})`}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={() => setShowReasons(false)}>Go back & update numbers</button>
                <button className="btn primary" disabled={(!allOk && missedNow.length > 0) || saving}
                        onClick={() => submitFinal(finalVals)}>
                  {saving ? 'Saving…' : 'Submit with reasons'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Send report summary email (fire-and-forget) ──────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function sendReportEmail({ me, metrics, note, total, metricsDef, missedTasks = [], reasons = {} }) {
  const LEAD_EMAIL = 'dev.p@amrytt.com'
  const dateLabel  = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const metricRows = (metricsDef || [])
    .filter(m => {
      const v = metrics[m.key]
      return v !== undefined && v !== null && v !== 0 && v !== false
    })
    .map(m => {
      const v = metrics[m.key]
      const display = typeof v === 'boolean' ? (v ? 'Done' : 'Not done') : `${v} ${m.unit || ''}`
      const isCore = m.group === 'core'
      const missed = missedTasks.some(t => t.key === m.key)
      return `<tr style="border-top:1px solid #f4f4f5;${missed ? 'background:#fef2f2;' : ''}">
        <td style="padding:8px 14px;font-size:13px;color:#52525b;">${m.label}${isCore ? ' <span style="font-size:9px;font-weight:700;color:#65a30d;">CORE</span>' : ''}</td>
        <td style="padding:8px 14px;font-size:13px;font-weight:600;text-align:right;${missed ? 'color:#dc2626;' : ''}">${display.trim()}${isCore && m.target > 0 ? ` <span style="color:#a1a1aa;font-weight:400;">/ ${m.target}</span>` : ''}</td>
      </tr>`
    }).join('')

  const missedBlock = missedTasks.length ? `
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin-bottom:20px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#dc2626;margin-bottom:10px;">⚠ ${missedTasks.length} daily target${missedTasks.length !== 1 ? 's' : ''} missed</div>
    ${missedTasks.map(t => {
      const v = metrics[t.key]
      const actual = t.type === 'checkbox' ? (v === true ? 'Done' : 'Not done') : (typeof v === 'number' ? v : 0)
      return `<div style="margin-bottom:10px;">
        <div style="font-size:13px;font-weight:600;">${t.label} <span style="font-weight:400;color:#71717a;">— ${actual} of ${t.targetLabel || t.target}</span></div>
        <div style="font-size:13px;color:#52525b;margin-top:2px;padding-left:10px;border-left:2px solid #fca5a5;">${reasons[t.key] ? esc(reasons[t.key]) : 'No reason given'}</div>
      </div>`
    }).join('')}
  </div>` : ''

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:40px auto;color:#111;padding:0 20px;">
  <div style="background:#18181b;border-radius:12px;padding:24px;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#a3e635;">Relay</div>
    <div style="font-size:12px;color:#a1a1aa;margin-top:4px;">${dateLabel}</div>
  </div>
  <h2 style="font-size:18px;font-weight:600;margin:0 0 4px;">${me.name} submitted their report</h2>
  <div style="font-size:28px;font-weight:800;color:#a3e635;margin:16px 0;">${total} <span style="font-size:14px;font-weight:400;color:#71717a;">total</span></div>
  <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden;margin-bottom:20px;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Metric</th>
        <th style="padding:9px 14px;text-align:right;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Value</th>
      </tr>
    </thead>
    <tbody>${metricRows || '<tr><td colspan="2" style="padding:12px 14px;color:#a1a1aa;font-size:13px;">No numeric metrics logged.</td></tr>'}</tbody>
  </table>
  ${missedBlock}
  ${note ? `<div style="background:#f9fafb;border-radius:8px;padding:14px;font-size:13px;color:#52525b;border-left:3px solid #a3e635;"><strong>Note:</strong> ${esc(note)}</div>` : ''}
  <p style="color:#a1a1aa;font-size:11px;margin-top:32px;border-top:1px solid #e4e4e7;padding-top:16px;">Sent by Relay · internal team tool</p>
</body>
</html>`

  await fetch('/api/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: LEAD_EMAIL, subject: `${me.name} filed report — ${total} total${missedTasks.length ? ` · ⚠ ${missedTasks.length} target${missedTasks.length !== 1 ? 's' : ''} missed` : ''} · ${dateLabel}`, html }),
  })
}

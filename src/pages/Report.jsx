import { useState, useEffect, useRef } from 'react'
import { METRICS, METRIC_GROUPS, NEEL_METRICS, NEEL_METRIC_GROUPS, metricsFor, metricGroupsFor,
         TEAM, Icon, todayISO, fmtFull, fmtDateShort } from '../data.jsx'
import { saveReport, loadReport, loadMostRecentReport, getEmailCountToday, getEmailCountForDate } from '../lib/supabase.js'

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
              return (
                <div key={m.key} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8,
                  opacity: (!hasValue && !isSkipped) ? 0.35 : 1,
                }}>
                  <Icon name={m.icon} size={14} />
                  <span style={{ flex: 1, fontSize: 13 }}>{m.label}</span>
                  <span className="mono" style={{
                    fontSize: 14,
                    fontWeight: hasValue ? 600 : 400,
                    color: isSkipped ? 'var(--text-faint)' : (isCheckbox && v === false) ? 'var(--text-faint)' : 'var(--text)',
                  }}>
                    {isSkipped ? '—' : isCheckbox ? (v ? '✓' : '✗') : (hasValue ? v : '0')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
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

  const total = Object.values(vals).filter(v => typeof v === 'number').reduce((s, v) => s + v, 0);

  async function handleSave() {
    setSaving(true);
    try {
      await saveReport({ memberId: member.id, date, metrics: vals, note, total });
      onSave({ ...record, metrics: vals, note, total });
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
  const inputRef = useRef(null);
  const userEditedRef = useRef(false);
  const valuesRef = useRef({});
  const noteRef = useRef('');

  // Keep refs in sync for unmount-flush
  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { noteRef.current = note; }, [note]);

  const isLead = ['lead', 'hr', 'super'].includes(me.role);
  const allMembers = TEAM.filter(m => m.role === 'member');
  const [selectedMemberId, setSelectedMemberId] = useState(allMembers[0]?.id || '');
  const [leadRecord, setLeadRecord] = useState(null);
  const [loadingLeadRecord, setLoadingLeadRecord] = useState(false);
  const [leadEditing, setLeadEditing] = useState(false);
  const [leadEmailCount, setLeadEmailCount] = useState(null);

  const myMetrics = metricsFor(me.id);
  const myGroups  = metricGroupsFor(me.id);
  const isNeel    = !!TEAM.find(m => m.id === me.id)?.neelOnly;

  // email_response is auto-filled from email log — excluded from the manual step queue
  const queue   = myMetrics.filter(m => isNeel || m.key !== 'email_response');
  const current = queue[stepIdx];
  const completed = Object.keys(values).filter(k => values[k] !== 'skip' && values[k] !== undefined).length;
  const skipped   = Object.keys(values).filter(k => values[k] === 'skip').length;
  const total     = Object.values(values).filter(v => typeof v === 'number').reduce((s, v) => s + v, 0);

  // Pre-fill today's form (auto-populate email_response from live email log for non-Neel)
  useEffect(() => {
    loadReport(me.id, todayISO())
      .then(async (existing) => {
        if (existing) {
          setValues(existing.metrics || {});
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
    const v = values; const n = note;
    const numericTotal = Object.values(v).filter(x => typeof x === 'number').reduce((s, x) => s + x, 0);
    const timer = setTimeout(async () => {
      try {
        await saveReport({ memberId: me.id, date: todayISO(), metrics: v, note: n, total: numericTotal });
        setAlreadySaved(true);
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus(''), 1800);
      } catch { setAutoSaveStatus(''); }
    }, 1000);
    return () => clearTimeout(timer);
  }, [values, note]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush save on unmount
  useEffect(() => {
    return () => {
      if (!userEditedRef.current) return;
      const v = valuesRef.current; const n = noteRef.current;
      if (Object.keys(v).length === 0) return;
      const numericTotal = Object.values(v).filter(x => typeof x === 'number').reduce((s, x) => s + x, 0);
      saveReport({ memberId: me.id, date: todayISO(), metrics: v, note: n, total: numericTotal }).catch(() => {});
    };
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copyLast() {
    setCopyingLast(true);
    try {
      const report = await loadMostRecentReport(me.id);
      if (!report) { showToast('No previous report found'); return; }
      // Keep email_response locked — don't copy it from previous report
      const { email_response: _, ...otherMetrics } = report.metrics || {};
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
    if (mode !== 'numpad' || !isToday || done) return;
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

  async function finalize(final) {
    setSaving(true);
    const numericTotal = Object.values(final).filter(v => typeof v === 'number').reduce((s, v) => s + v, 0);
    try {
      await saveReport({ memberId: me.id, date: todayISO(), metrics: final, note, total: numericTotal });
      setDone(true);
      showToast(`Report saved · ${numericTotal} total`);
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
                            </span>
                            <span className="val">
                              {isAutoFilled ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 9, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.05em' }}>auto</span>
                                  <span style={{ color: 'var(--accent)' }}>{liveEmailCount ?? (typeof v === 'number' ? v : '—')}</span>
                                </span>
                              ) : isDone ? displayVal
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
                        return (
                          <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8 }}>
                            <Icon name={m.icon} size={14} />
                            <span style={{ flex: 1, fontSize: 13 }}>{m.label}</span>
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
    </div>
  );
}

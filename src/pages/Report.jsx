import { useState, useEffect, useRef } from 'react'
import { METRICS, METRIC_GROUPS, Icon, todayISO, fmtFull, fmtDateShort } from '../data.jsx'
import { saveReport, loadReport, loadReportsHistory } from '../lib/supabase.js'

function last30Days() {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });
}

function ReadOnlyView({ date, record }) {
  if (!record) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>—</div>
        <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>No report filed for this day</div>
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
        <span className="chip warn">Read only</span>
      </div>

      <div className="card">
        <div className="card-pad">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {METRICS.map(m => {
              const v = metrics[m.key];
              const isSkipped = v === 'skip';
              const hasValue = typeof v === 'number';
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
                    fontWeight: hasValue && v > 0 ? 600 : 400,
                    color: isSkipped || (hasValue && v === 0) ? 'var(--text-faint)' : 'var(--text)',
                  }}>
                    {isSkipped ? '—' : hasValue ? v : '0'}
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

export function DailyReportPage({ me, setRoute, showToast }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState({});
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('numpad');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingToday, setLoadingToday] = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [historyRecords, setHistoryRecords] = useState([]);
  const inputRef = useRef(null);

  const queue = METRICS;
  const current = queue[stepIdx];
  const completed = Object.keys(values).filter(k => values[k] !== 'skip' && values[k] !== undefined).length;
  const skipped = Object.keys(values).filter(k => values[k] === 'skip').length;
  const total = Object.values(values).filter(v => typeof v === 'number').reduce((s, v) => s + v, 0);
  const isToday = selectedDate === todayISO();

  // Load last 30 days of history
  useEffect(() => {
    loadReportsHistory(me.id, 30)
      .then(records => setHistoryRecords(records))
      .catch(() => {});
  }, [me.id]);

  // Pre-fill today's form if a report already exists
  useEffect(() => {
    loadReport(me.id, todayISO())
      .then(existing => {
        if (existing) {
          setValues(existing.metrics || {});
          setNote(existing.note || '');
        }
      })
      .catch(() => {})
      .finally(() => setLoadingToday(false));
  }, [me.id]);

  // Keyboard shortcuts (only active when editing today)
  useEffect(() => {
    if (mode !== 'numpad' || !isToday) return;
    const onKey = (e) => {
      if (done) return;
      if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.target !== inputRef.current) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setDraft(d => (d === '0' ? e.key : d + e.key).slice(0, 4)); }
      else if (e.key === 'Backspace') { e.preventDefault(); setDraft(d => d.slice(0, -1)); }
      else if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Tab') { e.preventDefault(); skip(); }
      else if (e.key === '+') { e.preventDefault(); setDraft(d => String((parseInt(d || '0', 10) || 0) + 1)); }
      else if (e.key === '-') { e.preventDefault(); setDraft(d => String(Math.max(0, (parseInt(d || '0', 10) || 0) - 1))); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function commit() {
    if (!current) return;
    const v = draft === '' ? 0 : parseInt(draft, 10);
    setValues(prev => ({ ...prev, [current.key]: v }));
    setDraft('');
    if (stepIdx < queue.length - 1) setStepIdx(stepIdx + 1);
    else finalize({ ...values, [current.key]: v });
  }
  function skip() {
    if (!current) return;
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
      // Keep history in sync so the sidebar updates without a reload
      setHistoryRecords(prev => {
        const exists = prev.find(r => r.date === todayISO());
        const updated = { date: todayISO(), member_id: me.id, metrics: final, note, total: numericTotal };
        return exists
          ? prev.map(r => r.date === todayISO() ? updated : r)
          : [updated, ...prev];
      });
      setDone(true);
      showToast(`Report saved · ${numericTotal} total`);
    } catch {
      showToast('Save failed — check your connection');
      setSaving(false);
    }
  }

  const days = last30Days();

  // Post-submit confirmation screen
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
              const m = METRICS.find(mm => mm.key === k);
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
            <span>·</span>
            <span>{completed} logged</span>
            <span>·</span>
            <span>{skipped} skipped</span>
          </div>
          <div className="row-flex" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => setRoute('home')}>Back to home</button>
            <button className="btn primary" onClick={() => setRoute('emails')}>Log emails next <Icon name="arrow" size={12} /></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 1280 }}>
      <div className="page-head">
        <div>
          <h1>Daily Report</h1>
          <div className="sub">
            {isToday ? `${fmtFull(todayISO())} · ${me.name}` : fmtFull(selectedDate)}
          </div>
        </div>
        <div className="actions">
          {isToday ? (
            <>
              <span className="seg">
                <button className={mode === 'numpad' ? 'on' : ''} onClick={() => setMode('numpad')}>Numpad</button>
                <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Grid</button>
              </span>
              <button className="btn ghost" onClick={() => setRoute('home')}><Icon name="x" size={12} />Discard</button>
            </>
          ) : (
            <>
              <span className="chip warn">Past reports are read-only</span>
              <button className="btn" onClick={() => setSelectedDate(todayISO())}>Back to today</button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, alignItems: 'start' }}>

        {/* History sidebar */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'sticky', top: 16 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            30-Day History
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {days.map(date => {
              const record = historyRecords.find(r => r.date === date);
              const isTodayDate = date === todayISO();
              const isSelected = date === selectedDate;
              return (
                <div key={date}
                     onClick={() => setSelectedDate(date)}
                     style={{
                       padding: '9px 14px', cursor: 'pointer',
                       background: isSelected ? 'var(--surface-2)' : 'transparent',
                       borderLeft: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                       display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                     }}>
                  <div>
                    {isTodayDate && (
                      <div style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 1 }}>
                        Today
                      </div>
                    )}
                    <div style={{ fontSize: 12.5, color: isSelected ? 'var(--text)' : 'var(--text-dim)' }}>
                      {fmtDateShort(date)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                    {record
                      ? <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{record.total}</span>
                      : <span style={{ color: 'var(--text-faint)' }}>—</span>
                    }
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <div>
          {!isToday ? (
            <ReadOnlyView date={selectedDate} record={historyRecords.find(r => r.date === selectedDate)} />
          ) : loadingToday ? (
            <div className="card" style={{ padding: 48, textAlign: 'center' }}>
              <span className="muted">Loading today's report…</span>
            </div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 16, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Progress</span>
                <div className="bar" style={{ flex: 1 }}>
                  <div className="bar-fill" style={{ width: ((stepIdx) / queue.length) * 100 + '%' }}></div>
                </div>
                <span className="mono" style={{ fontSize: 12 }}>{stepIdx} / {queue.length}</span>
                <span className="faint">·</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>{completed} logged</span>
                <span className="faint" style={{ fontSize: 12 }}>{skipped} skipped</span>
              </div>

              {mode === 'numpad' ? (
                <div className="numpad">
                  <div className="numpad-stage" onClick={() => inputRef.current && inputRef.current.focus()}>
                    <input ref={inputRef} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} autoFocus />
                    <div className="numpad-step">Step {stepIdx + 1} of {queue.length} · <span style={{ color: 'var(--text-dim)' }}>{METRIC_GROUPS.find(g => g.id === current.group)?.label}</span></div>
                    <div className="numpad-prompt">How many today?</div>
                    <div className="numpad-metric">
                      <Icon name={current.icon} size={20} />
                      <span style={{ marginLeft: 8 }}>{current.label}</span>
                    </div>
                    <div className="numpad-input">
                      <span className={`numpad-number ${draft === '' ? 'ghost' : ''}`}>{draft || '0'}</span>
                      <span className="numpad-unit">{current.unit}</span>
                      {current.target > 0 && draft && parseInt(draft, 10) >= current.target && (
                        <span className="chip accent" style={{ marginLeft: 8 }}>target hit</span>
                      )}
                    </div>
                    <div className="numpad-keys">
                      {['1','2','3','4','5','6','7','8','9'].map(n => (
                        <button key={n} className="numpad-key"
                                onClick={() => setDraft(d => (d === '0' ? n : d + n).slice(0, 4))}>{n}</button>
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
                      <span>Today's queue</span>
                      <span className="mono faint" style={{ fontSize: 11 }}>{completed + skipped}/{queue.length}</span>
                    </div>
                    <div className="numpad-queue-list">
                      {queue.map((m, i) => {
                        const v = values[m.key];
                        const isCurrent = i === stepIdx;
                        const isDone = typeof v === 'number';
                        const isSkip = v === 'skip';
                        return (
                          <div key={m.key}
                               className={`numpad-queue-row ${isCurrent ? 'active' : ''} ${isDone ? 'done' : ''} ${isSkip ? 'skip' : ''}`}
                               onClick={() => { setStepIdx(i); setDraft(typeof v === 'number' ? String(v) : ''); }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Icon name={m.icon} size={12} />
                              {m.label}
                            </span>
                            <span className="val">{isDone ? v : isSkip ? '—' : (isCurrent ? '…' : '·')}</span>
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
                <div className="card">
                  <div className="card-pad">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      {METRICS.map(m => (
                        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8 }}>
                          <Icon name={m.icon} size={14} />
                          <span style={{ flex: 1, fontSize: 13 }}>{m.label}</span>
                          <button className="btn ghost" style={{ width: 24, height: 24, padding: 0 }}
                                  onClick={() => setValues(p => ({...p, [m.key]: Math.max(0, (p[m.key] || 0) - 1)}))}>−</button>
                          <input className="input" style={{ width: 60, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
                                 value={typeof values[m.key] === 'number' ? values[m.key] : ''}
                                 placeholder="0"
                                 onChange={(e) => setValues(p => ({...p, [m.key]: parseInt(e.target.value || '0', 10) || 0}))} />
                          <button className="btn ghost" style={{ width: 24, height: 24, padding: 0 }}
                                  onClick={() => setValues(p => ({...p, [m.key]: (typeof p[m.key] === 'number' ? p[m.key] : 0) + 1}))}>+</button>
                        </div>
                      ))}
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
                              maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>
                <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Submission</div>
                    <div style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 500, marginTop: 4 }}>{total}</div>
                    <div className="muted" style={{ fontSize: 11 }}>tasks recorded</div>
                  </div>
                  <button className="btn primary lg" onClick={() => finalize(values)} disabled={saving}>
                    {saving ? 'Saving…' : <span>Submit report <span className="kbd">⌘ ↵</span></span>}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

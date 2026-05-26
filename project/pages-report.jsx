// pages-report.jsx — Daily Report numpad-style quick log

const { useState: useState_R, useEffect: useEffect_R, useRef: useRef_R, useMemo: useMemo_R } = React;

function DailyReportPage({ me, setRoute, showToast }) {
  // Build the queue from METRICS
  const [stepIdx, setStepIdx] = useState_R(0);
  const [values, setValues] = useState_R({}); // metricKey -> number | 'skip'
  const [draft, setDraft] = useState_R('');
  const [note, setNote] = useState_R('');
  const [mode, setMode] = useState_R('numpad'); // 'numpad' | 'grid'
  const [done, setDone] = useState_R(false);
  const inputRef = useRef_R(null);

  const queue = METRICS;
  const current = queue[stepIdx];
  const completed = Object.keys(values).filter(k => values[k] !== 'skip' && values[k] !== undefined).length;
  const skipped = Object.keys(values).filter(k => values[k] === 'skip').length;
  const total = Object.values(values).filter(v => typeof v === 'number').reduce((s, v) => s + v, 0);

  useEffect_R(() => {
    if (mode === 'numpad') {
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
    }
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
  function finalize(final) {
    setDone(true);
    setTimeout(() => {
      showToast("Report filed · " + Object.values(final).filter(v => typeof v === 'number').reduce((s,v)=>s+v,0) + " total");
    }, 100);
  }

  if (done) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-ink)', margin: '0 auto 16px', display: 'grid', placeItems: 'center' }}>
            <Icon name="check" size={28} stroke={2} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px' }}>Report filed · 47 seconds</h2>
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
            <span>Total counted: <b style={{ color: 'var(--text)' }} className="mono">{total}</b></span>
            <span>·</span>
            <span>{completed} metrics logged</span>
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
    <div className="page" style={{ maxWidth: 1080 }}>
      <div className="page-head">
        <div>
          <h1>Daily Report</h1>
          <div className="sub">{fmtFull(todayISO())} · {me.name}</div>
        </div>
        <div className="actions">
          <span className="seg">
            <button className={mode === 'numpad' ? 'on' : ''} onClick={() => setMode('numpad')}>Numpad</button>
            <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Grid</button>
            <button onClick={() => showToast('Last week\'s report copied — edit values as needed')}>Copy last</button>
          </span>
          <button className="btn ghost" onClick={() => setRoute('home')}><Icon name="x" size={12} />Discard</button>
        </div>
      </div>

      {/* Progress strip */}
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
              <button className="numpad-key" onClick={() => setDraft(d => d.slice(0, -1))} title="Backspace">⌫</button>
              <button className="numpad-key" onClick={() => setDraft(d => (d === '0' ? '0' : d + '0').slice(0, 4))}>0</button>
              <button className="numpad-key acc" onClick={commit} title="Enter">↵</button>
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
              <button className="btn ghost" onClick={skip}>Skip this metric <span className="kbd">tab</span></button>
              <div className="spacer"></div>
              <button className="btn primary" onClick={commit}>Save & next <span className="kbd">↵</span></button>
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
        // Grid mode
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
          <button className="btn primary lg" onClick={() => finalize(values)}>Submit report <span className="kbd">⌘ ↵</span></button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DailyReportPage });

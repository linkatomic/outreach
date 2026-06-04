import { useState, useEffect } from 'react'
import { Icon } from '../data.jsx'

const API = '/api/sheet-parser'

async function safeJson(res) {
  const text = await res.text()
  try { return JSON.parse(text) }
  catch { throw new Error(text.startsWith('<') || text.startsWith('The page') ? 'API server is not running. Start it with: npm run server' : text) }
}

const CONFIDENCE_COLOR = {
  high:   'var(--accent)',
  medium: '#f59e0b',
  low:    '#fb7185',
}

export function SheetParser() {
  const [step, setStep]           = useState('idle')   // idle | analyzing | review | processing | done | error
  const [url, setUrl]             = useState('')
  const [result, setResult]       = useState(null)
  const [tabs, setTabs]           = useState([])
  const [output, setOutput]       = useState(null)
  const [errMsg, setErrMsg]       = useState('')
  const [serverOk, setServerOk]   = useState(null)    // null=checking, true, false

  useEffect(() => {
    fetch('/api/health').then(r => r.ok ? setServerOk(true) : setServerOk(false)).catch(() => setServerOk(false))
  }, [])

  // ── Step 1: Analyze ────────────────────────────────────
  async function analyze() {
    if (!url.trim()) return
    setStep('analyzing')
    setErrMsg('')
    try {
      const res = await fetch(`${API}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error || 'Analysis failed')

      setResult(data)
      // Build mutable tab configs for the review UI
      setTabs(data.tabs.map(t => ({
        ...t,
        enabled: !t.skip,
        priceColumns: (t.priceColumns || []).map(p => ({ ...p })),
      })))
      setStep('review')
    } catch (err) {
      setErrMsg(err.message)
      setStep('error')
    }
  }

  // ── Step 2: Process ────────────────────────────────────
  async function process() {
    setStep('processing')
    setErrMsg('')
    try {
      const res = await fetch(`${API}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId: result.spreadsheetId, tabs }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error || 'Processing failed')
      setOutput(data)
      setStep('done')
    } catch (err) {
      setErrMsg(err.message)
      setStep('error')
    }
  }

  function updateTab(i, patch) {
    setTabs(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }

  function updatePriceCol(tabIdx, colIdx, patch) {
    setTabs(prev => prev.map((t, i) => {
      if (i !== tabIdx) return t
      return {
        ...t,
        priceColumns: t.priceColumns.map((p, j) => j === colIdx ? { ...p, ...patch } : p),
      }
    }))
  }

  const activeTabCount = tabs.filter(t => t.enabled && !t.skip && t.domainColumn).length

  // ── Render ─────────────────────────────────────────────

  if (step === 'idle' || step === 'analyzing') {
    return (
      <div style={{ maxWidth: 640 }}>
        {/* Server status banner */}
        {serverOk === false && (
          <div style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 8,
            background: 'rgba(251,113,133,0.1)', border: '1px solid rgba(251,113,133,0.35)',
            fontSize: 12.5, color: '#fb7185', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 15 }}>⚠</span>
            <span>API server is not running. Open a terminal in the project folder and run: <code style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--font-mono)' }}>npm run server</code></span>
          </div>
        )}
        {serverOk === null && (
          <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text-faint)' }}>Checking server…</div>
        )}
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
          Paste a Google Sheet URL — AI will detect website and pricing columns across all tabs, then you confirm before the output sheet is generated.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            className="input"
            style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13 }}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && step === 'idle' && analyze()}
            disabled={step === 'analyzing'}
            autoFocus
          />
          <button
            className="btn primary"
            onClick={analyze}
            disabled={!url.trim() || step === 'analyzing'}
            style={{ flexShrink: 0 }}
          >
            {step === 'analyzing'
              ? <><span style={{ opacity: 0.7 }}>Analyzing…</span></>
              : <><Icon name="zap" size={12} /> Analyze</>
            }
          </button>
        </div>
        {step === 'analyzing' && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
            Reading all tabs and running AI column detection — this takes 5–15 seconds…
          </div>
        )}
      </div>
    )
  }

  if (step === 'review') {
    return (
      <div style={{ maxWidth: 780 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            AI found <strong style={{ color: 'var(--text)' }}>{tabs.length}</strong> tab{tabs.length !== 1 ? 's' : ''}. Review the detected columns, adjust if needed, then confirm.
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={() => setStep('idle')}>← Back</button>
            <button
              className="btn primary"
              onClick={process}
              disabled={activeTabCount === 0}
            >
              <Icon name="upload" size={12} />
              Confirm & Create Sheet
              {activeTabCount > 0 && <span style={{ opacity: 0.7, fontSize: 11, marginLeft: 4 }}>({activeTabCount} tab{activeTabCount !== 1 ? 's' : ''})</span>}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tabs.map((tab, ti) => (
            <TabReviewCard
              key={tab.name}
              tab={tab}
              tabIndex={ti}
              onTabToggle={enabled => updateTab(ti, { enabled })}
              onDomainChange={domainColumn => updateTab(ti, { domainColumn })}
              onPriceColToggle={(ci, enabled) => updatePriceCol(ti, ci, { enabled })}
              onPriceLabelChange={(ci, label) => updatePriceCol(ti, ci, { label })}
            />
          ))}
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={() => setStep('idle')}>← Back</button>
          <button
            className="btn primary"
            onClick={process}
            disabled={activeTabCount === 0}
          >
            <Icon name="upload" size={12} />
            Confirm & Create Sheet
          </button>
        </div>
      </div>
    )
  }

  if (step === 'processing') {
    return (
      <div style={{ maxWidth: 480, textAlign: 'center', padding: '32px 0' }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⚙️</div>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Creating your sheet…</div>
        <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
          Fetching all rows, cleaning domains, looking up buyer prices, writing to Google Sheets.
        </div>
      </div>
    )
  }

  if (step === 'done' && output) {
    return (
      <div style={{ maxWidth: 520 }}>
        <div style={{
          padding: 24, borderRadius: 12,
          background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 20, marginBottom: 6 }}>✓ Sheet created successfully</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-dim)' }}>
            <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{output.totalSites}</strong> websites processed</span>
            <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{output.tabsProcessed}</strong> tabs merged</span>
            <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{output.priceColumns}</strong> price column{output.priceColumns !== 1 ? 's' : ''} + buyer price added</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <a
            href={output.sheetUrl}
            target="_blank"
            rel="noreferrer"
            className="btn primary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="link" size={12} /> Open Sheet
          </a>
          <button className="btn ghost" onClick={() => {
            setStep('idle'); setUrl(''); setResult(null); setTabs([]); setOutput(null)
          }}>
            Parse Another
          </button>
        </div>

        <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
          {output.sheetUrl}
        </div>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div style={{ maxWidth: 520 }}>
        <div style={{
          padding: 20, borderRadius: 10,
          background: 'rgba(251,113,133,0.08)',
          border: '1px solid rgba(251,113,133,0.3)',
          marginBottom: 16,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: '#fb7185' }}>Error</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{errMsg}</div>
        </div>
        <button className="btn ghost" onClick={() => setStep('idle')}>← Try again</button>
      </div>
    )
  }

  return null
}

// ── Tab review card ─────────────────────────────────────
function TabReviewCard({ tab, onTabToggle, onDomainChange, onPriceColToggle, onPriceLabelChange }) {
  const isDisabled = !tab.enabled || tab.skip

  return (
    <div style={{
      border: `1px solid ${isDisabled ? 'var(--border)' : 'color-mix(in srgb, var(--accent) 35%, transparent)'}`,
      borderRadius: 10,
      overflow: 'hidden',
      opacity: isDisabled ? 0.5 : 1,
      transition: 'opacity 0.15s',
    }}>
      {/* Tab header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px',
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <input
          type="checkbox"
          checked={tab.enabled && !tab.skip}
          disabled={tab.skip}
          onChange={e => onTabToggle(e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }}
        />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{tab.name}</span>
        {tab.skip && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 4 }}>
            — skipped ({tab.reason || 'not enough data'})
          </span>
        )}
      </div>

      {!tab.skip && (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Domain column */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Domain Column
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                className="input"
                style={{ width: 260, fontSize: 13 }}
                value={tab.domainColumn || ''}
                onChange={e => onDomainChange(e.target.value || null)}
              >
                <option value="">— not selected —</option>
                {tab.allColumns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              {tab.domainColumn && (
                <ConfidenceBadge confidence={tab.domainConfidence} />
              )}
              {!tab.domainColumn && (
                <span style={{ fontSize: 12, color: '#fb7185' }}>Please select the domain column</span>
              )}
            </div>
          </div>

          {/* Price columns */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Price Columns — each gets a &ldquo;Buyer&rdquo; column added next to it
            </div>
            {tab.priceColumns.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No price columns detected. AI may have missed them — this is okay if the sheet has no pricing data.</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tab.priceColumns.map((pc, ci) => (
                  <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={pc.enabled}
                      onChange={e => onPriceColToggle(ci, e.target.checked)}
                      style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={pc.name}>
                      {pc.name}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>→</span>
                    <input
                      className="input"
                      style={{ width: 180, fontSize: 12, padding: '3px 8px', height: 28, opacity: pc.enabled ? 1 : 0.4 }}
                      value={pc.label}
                      onChange={e => onPriceLabelChange(ci, e.target.value)}
                      disabled={!pc.enabled}
                      placeholder="Label in output sheet"
                    />
                    <ConfidenceBadge confidence={pc.confidence} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ConfidenceBadge({ confidence }) {
  const color = CONFIDENCE_COLOR[confidence] || 'var(--text-faint)'
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
      color, border: `1px solid ${color}`, borderRadius: 4,
      padding: '1px 5px', flexShrink: 0,
    }}>
      {confidence}
    </span>
  )
}

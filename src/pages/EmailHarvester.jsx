import { useState, useRef, useMemo, useEffect } from 'react'
import { Icon } from '../data.jsx'
import { buildEmailHarvesterSheet } from '../lib/emailHarvesterSheet.js'
import { saveDraft, loadDraft, makeRunId, fmtRelDate } from '../lib/runHistory.js'
import { dbLoadRuns, dbSaveRun, dbDeleteRun, dbClearRuns, upsertLocal } from '../lib/toolRunsDB.js'

const TOOL_KEY    = 'harvester'
const CONCURRENCY = 5
const PAGE_TYPES  = ['Home', 'Contact', 'About', 'Privacy']

function normDomain(raw) {
  return (raw || '').trim()
    .replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase()
}
function parseDomains(text) {
  return text.split(/[\n,]+/).map(normDomain).filter(d => d && d.includes('.'))
}
async function harvestDomain(domain) {
  const res = await fetch('/api/email-harvester', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
async function runCapped(tasks, cap, onResult) {
  let i = 0
  async function next() {
    if (i >= tasks.length) return
    const idx = i++
    try { onResult(idx, await tasks[idx](), null) } catch (err) { onResult(idx, null, err.message) }
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(cap, tasks.length) }, next))
}

// ── Table row ─────────────────────────────────────────────

function ResultRow({ result, emailFreq, isRetrying }) {
  const { domain, pages, allEmails, error, retried } = result
  const isPending = result.status === 'pending'
  const hasEmails = (allEmails?.length || 0) > 0
  const pageMap   = Object.fromEntries((pages || []).map(p => [p.type, p]))

  const rowBg = error       ? 'rgba(220,50,50,.04)'
              : hasEmails   ? 'rgba(92,255,161,.03)'
              : 'transparent'

  return (
    <tr style={{ background: rowBg, borderBottom: '1px solid var(--border)' }}>

      {/* Website */}
      <td style={{ padding: '9px 14px', verticalAlign: 'top', minWidth: 170, maxWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {retried && (
            <span title="Retried" style={{ fontSize: 11, color: hasEmails ? 'var(--ok)' : 'var(--text-faint)', flexShrink: 0 }}>↺</span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: isPending ? 'var(--text-ghost)' : 'var(--text)', wordBreak: 'break-all' }}>
            {domain}
          </span>
        </div>
      </td>

      {/* Email(s) */}
      <td style={{ padding: '9px 14px', verticalAlign: 'top' }}>
        {isPending ? (
          <span style={{ fontSize: 12, color: 'var(--text-ghost)' }}>Harvesting…</span>
        ) : isRetrying ? (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>↺ Retrying…</span>
        ) : error ? (
          <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>
        ) : !hasEmails ? (
          <span style={{ fontSize: 12, color: 'var(--text-ghost)' }}>—</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {allEmails.map(email => {
              const count = emailFreq?.[email] || 1
              return (
                <div key={email} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{email}</span>
                  {count > 1 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ok)', background: 'rgba(92,255,161,.15)', borderRadius: 4, padding: '0 4px', lineHeight: '16px', flexShrink: 0 }}>
                      ×{count}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </td>

      {/* Page columns */}
      {PAGE_TYPES.map(type => {
        const p    = pageMap[type]
        const icon = isPending || isRetrying ? '·'
                   : !p || !p.fetched        ? '—'
                   : p.emails.length > 0     ? '✓'
                   : '·'
        const color = (!p || !p.fetched)     ? 'var(--text-ghost)'
                    : p.emails.length > 0    ? 'var(--ok)'
                    : 'var(--text-faint)'
        return (
          <td key={type} style={{ padding: '9px 10px', textAlign: 'center', verticalAlign: 'top', fontSize: 14, color, fontWeight: icon === '✓' ? 700 : 400 }}>
            {icon}
          </td>
        )
      })}
    </tr>
  )
}

function ResultsTable({ results, emailFreq, retryingSet }) {
  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--surface-3)', borderBottom: '2px solid var(--border)' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Website</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Email(s)</th>
            {PAGE_TYPES.map(t => (
              <th key={t} style={{ padding: '10px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', width: 72 }}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <ResultRow key={i} result={r} emailFreq={emailFreq} isRetrying={retryingSet.has(r.domain)} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── History item ──────────────────────────────────────────

function HistoryItem({ entry, onLoad, onDelete }) {
  const done        = (entry.results || []).filter(r => r.status !== 'pending')
  const withEmails  = done.filter(r => (r.allEmails?.length || 0) > 0)
  const totalEmails = [...new Set(done.flatMap(r => r.allEmails || []))].length

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{done.length} sites</span>
          {withEmails.length > 0 && <span style={{ fontSize: 12, color: 'var(--ok)' }}>✓ {withEmails.length} with emails</span>}
          {totalEmails > 0 && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{totalEmails} unique</span>}
          {entry.partial && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--warn)', background: 'rgba(251,191,36,.12)', borderRadius: 4, padding: '1px 6px' }}>partial</span>}
          {entry.sheetUrl && <span style={{ fontSize: 10, color: 'var(--ok)', background: 'rgba(92,255,161,.1)', borderRadius: 4, padding: '1px 6px' }}>sheet ✓</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-ghost)', marginTop: 3 }}>{fmtRelDate(entry.savedAt)}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {entry.sheetUrl && (
          <a href={entry.sheetUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 700, color: 'var(--ok)', textDecoration: 'none', background: 'rgba(92,255,161,.1)', border: '1px solid rgba(92,255,161,.2)', borderRadius: 5, padding: '3px 8px' }}>↗ Sheet</a>
        )}
        <button className="btn ghost" onClick={() => onLoad(entry)} style={{ fontSize: 11, padding: '3px 8px' }}>Load</button>
        <button className="btn ghost" onClick={() => onDelete(entry.id)} style={{ fontSize: 11, padding: '3px 6px', color: 'var(--text-faint)' }}><Icon name="x" size={11} /></button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────

export function EmailHarvester() {
  const [tab,          setTab]          = useState('run')
  const [history,      setHistory]      = useState([])
  const [websiteText,  setWebsiteText]  = useState('')
  const [results,      setResults]      = useState([])
  const [progress,     setProgress]     = useState(null)
  const [running,      setRunning]      = useState(false)
  const [sheetStatus,  setSheetStatus]  = useState(null)
  const [restored,     setRestored]     = useState(false)
  const [retryingSet,  setRetryingSet]  = useState(new Set())
  const [hasNewEmails, setHasNewEmails] = useState(false)
  const abortRef = useRef(false)
  const runIdRef = useRef(null)

  useEffect(() => { dbLoadRuns(TOOL_KEY).then(setHistory) }, [])

  useEffect(() => {
    const draft = loadDraft(TOOL_KEY)
    if (!draft || !(draft.results || []).length) return
    const clean = draft.results.map(r =>
      r.status === 'pending' ? { domain: r.domain, error: 'Interrupted', pages: [], allEmails: [] } : r
    )
    setWebsiteText(draft.websiteText || '')
    setResults(clean)
    if (draft.sheetUrl) setSheetStatus({ url: draft.sheetUrl })
    runIdRef.current = draft.id
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!results.length) return
    saveDraft(TOOL_KEY, {
      id: runIdRef.current,
      savedAt: new Date().toISOString(),
      websiteText,
      results,
      sheetUrl: sheetStatus?.url || null,
    })
  }, [results, sheetStatus])

  const domains = parseDomains(websiteText)
  const canRun  = domains.length > 0 && !running

  async function run() {
    if (!canRun) return
    const runId = makeRunId()
    runIdRef.current = runId
    abortRef.current = false
    setRunning(true)
    setSheetStatus(null)
    setRestored(false)
    setHasNewEmails(false)
    setRetryingSet(new Set())
    setProgress({ done: 0, total: domains.length })

    const initial = domains.map(d => ({ domain: d, status: 'pending' }))
    setResults(initial)
    const final = [...initial]
    const capturedText = websiteText

    const tasks = domains.map((domain) => async () => {
      if (abortRef.current) return null
      return harvestDomain(domain)
    })

    await runCapped(tasks, CONCURRENCY, (idx, data, err) => {
      const r = data ? { ...data } : { domain: domains[idx], error: err || 'Failed', pages: [], allEmails: [] }
      final[idx] = r
      setResults(prev => { const n = [...prev]; n[idx] = r; return n })
      setProgress(prev => ({ ...prev, done: (prev?.done || 0) + 1 }))
    })

    setRunning(false)
    setProgress(null)

    const entry = { id: runId, savedAt: new Date().toISOString(), websiteText: capturedText, results: final, sheetUrl: null, partial: false }
    dbSaveRun(TOOL_KEY, entry)
    setHistory(prev => upsertLocal(prev, entry))
  }

  function stop() {
    abortRef.current = true
    setRunning(false)
    setProgress(null)
    if (!results.length) return
    const stopped = results.map(r =>
      r.status === 'pending' ? { domain: r.domain, error: 'Stopped', pages: [], allEmails: [] } : r
    )
    setResults(stopped)
    const entry = { id: runIdRef.current || makeRunId(), savedAt: new Date().toISOString(), websiteText, results: stopped, sheetUrl: null, partial: true }
    dbSaveRun(TOOL_KEY, entry)
    setHistory(prev => upsertLocal(prev, entry))
  }

  async function retryEmpty() {
    const targets = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status !== 'pending' && !r.error && (r.allEmails?.length || 0) === 0)
    if (!targets.length) return

    setRetryingSet(new Set(targets.map(({ r }) => r.domain)))

    await Promise.all(targets.map(async ({ r: result, i }) => {
      try {
        const data = await harvestDomain(result.domain)
        setResults(prev => { const next = [...prev]; next[i] = { ...data, retried: true }; return next })
        if ((data.allEmails?.length || 0) > 0) setHasNewEmails(true)
      } catch { /* leave unchanged */ }
      setRetryingSet(prev => { const s = new Set(prev); s.delete(result.domain); return s })
    }))
  }

  async function generateSheet() {
    setSheetStatus('building')
    try {
      const url = await buildEmailHarvesterSheet(
        results,
        msg => setSheetStatus(s => typeof s === 'object' && s?.url ? s : `building:${msg}`)
      )
      setSheetStatus({ url })
      const entry = { id: runIdRef.current, savedAt: new Date().toISOString(), websiteText, results, sheetUrl: url, partial: false }
      dbSaveRun(TOOL_KEY, entry)
      setHistory(prev => upsertLocal(prev, entry))
    } catch (err) {
      setSheetStatus({ error: err.message })
    }
  }

  function loadFromHistory(entry) {
    runIdRef.current = entry.id
    setWebsiteText(entry.websiteText || '')
    setResults(entry.results || [])
    setSheetStatus(entry.sheetUrl ? { url: entry.sheetUrl } : null)
    setRestored(false)
    setHasNewEmails(false)
    setRetryingSet(new Set())
    setTab('run')
  }

  const doneResults  = results.filter(r => r.status !== 'pending')
  const withEmails   = doneResults.filter(r => (r.allEmails?.length || 0) > 0)
  const withNone     = doneResults.filter(r => !r.error && !(r.allEmails?.length))
  const totalEmails  = [...new Set(doneResults.flatMap(r => r.allEmails || []))].length
  const emptyCount   = withNone.length
  const isRetryingAny = retryingSet.size > 0

  const emailFreq = useMemo(() => {
    const freq = {}
    for (const r of doneResults)
      for (const e of (r.allEmails || [])) freq[e] = (freq[e] || 0) + 1
    return freq
  }, [doneResults])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 3, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        {[
          { id: 'run',     label: 'Harvest' },
          { id: 'history', label: `History${history.length ? ` (${history.length})` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ fontSize: 12, padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: tab === t.id ? 700 : 400, background: tab === t.id ? 'var(--accent)' : 'transparent', color: tab === t.id ? 'var(--accent-ink)' : 'var(--text-faint)', transition: 'background .15s, color .15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-ghost)' }}>
            <Icon name="clock" size={28} />
            <div style={{ fontSize: 13, marginTop: 10 }}>No history yet</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Completed runs will appear here automatically</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => { dbClearRuns(TOOL_KEY); setHistory([]) }} style={{ fontSize: 11, padding: '2px 8px', color: 'var(--text-faint)' }}>Clear all</button>
            </div>
            {history.map(e => <HistoryItem key={e.id} entry={e} onLoad={loadFromHistory} onDelete={id => { dbDeleteRun(id); setHistory(prev => prev.filter(h => h.id !== id)) }} />)}
          </div>
        )
      ) : (
        <>
          {/* Restore banner */}
          {restored && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'rgba(92,255,161,.05)', border: '1px solid rgba(92,255,161,.18)', borderRadius: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--ok)', fontSize: 14 }}>↺</span>
              <span style={{ color: 'var(--text-dim)', flex: 1 }}>Restored from your last session</span>
              <button className="btn ghost" onClick={() => { setResults([]); setWebsiteText(''); setSheetStatus(null); setRestored(false) }} style={{ fontSize: 11, padding: '2px 8px' }}>Start fresh</button>
            </div>
          )}

          {/* Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Websites · {domains.length > 0 ? `${domains.length} detected` : 'paste from sheet, one per line'}
            </label>
            <textarea
              className="input"
              placeholder={'example.com\nanotherdomain.com\nhttps://third.com/'}
              value={websiteText}
              onChange={e => setWebsiteText(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical', minHeight: 120, lineHeight: 1.6 }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-ghost)' }}>Scrapes contact, about, home &amp; privacy pages — no target email needed</div>
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn accent" onClick={run} disabled={!canRun} style={{ minWidth: 140 }}>
              {running ? `Harvesting… ${progress?.done || 0}/${progress?.total || 0}` : `Harvest ${domains.length > 0 ? domains.length + ' sites' : 'Emails'}`}
            </button>

            {running && <button className="btn ghost" onClick={stop} style={{ fontSize: 12 }}>Stop</button>}

            {!running && emptyCount > 0 && (
              <button className="btn ghost" onClick={retryEmpty} disabled={isRetryingAny} style={{ fontSize: 12 }}>
                {isRetryingAny ? `↺ Retrying ${retryingSet.size}…` : `↺ Retry ${emptyCount} empty`}
              </button>
            )}

            {progress && (
              <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 2, overflow: 'hidden', width: 160 }}>
                <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${((progress.done / progress.total) * 100).toFixed(0)}%`, transition: 'width .3s' }} />
              </div>
            )}

            {results.length > 0 && !running && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {withEmails.length > 0 && <span style={{ color: 'var(--ok)' }}>✓ {withEmails.length} with emails</span>}
                {totalEmails > 0 && <span style={{ color: 'var(--text-dim)' }}>{totalEmails} unique</span>}
                {withNone.length > 0 && <span style={{ color: 'var(--text-faint)' }}>— {withNone.length} empty</span>}

                {doneResults.length > 0 && (
                  sheetStatus === 'building' || (typeof sheetStatus === 'string' && sheetStatus.startsWith('building:'))
                    ? <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{typeof sheetStatus === 'string' && sheetStatus.includes(':') ? sheetStatus.split(':')[1] : 'Building sheet…'}</span>
                    : sheetStatus?.url
                    ? <>
                        <a href={sheetStatus.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 700, color: 'var(--ok)', textDecoration: 'none', background: 'rgba(92,255,161,.1)', border: '1px solid rgba(92,255,161,.25)', borderRadius: 5, padding: '3px 10px' }}>↗ Open Sheet</a>
                        {hasNewEmails && (
                          <button className="btn ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => { setSheetStatus(null); generateSheet() }}>↺ Regenerate</button>
                        )}
                      </>
                    : sheetStatus?.error
                    ? <span style={{ color: 'var(--danger)', fontSize: 11 }} title={sheetStatus.error}>Sheet error</span>
                    : <button className="btn ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={generateSheet}>↗ Generate Sheet</button>
                )}

                <button className="btn ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setResults([]); setWebsiteText(''); setSheetStatus(null); setRestored(false); setHasNewEmails(false); setRetryingSet(new Set()) }}>Clear</button>
              </div>
            )}
          </div>

          {/* Results table */}
          {results.length > 0 && (
            <ResultsTable results={results} emailFreq={emailFreq} retryingSet={retryingSet} />
          )}
        </>
      )}
    </div>
  )
}

import { useState, useRef, useEffect, useMemo } from 'react'
import { Icon } from '../data.jsx'
import { buildEmailCheckerSheet } from '../lib/emailCheckerSheet.js'
import { saveDraft, loadDraft, makeRunId, fmtRelDate } from '../lib/runHistory.js'
import { dbLoadRuns, dbSaveRun, dbDeleteRun, dbClearRuns, upsertLocal } from '../lib/toolRunsDB.js'

const CONCURRENCY = 5
const TOOL_KEY    = 'email-checker'

function normDomain(raw) {
  return (raw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

function parseDomains(text) {
  return text
    .split(/[\n,]+/)
    .map(normDomain)
    .filter(d => d && d.includes('.'))
}

async function checkDomain(domain, targetEmail) {
  const res = await fetch('/api/email-checker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, targetEmail }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function runCapped(tasks, cap, onResult) {
  let i = 0
  async function next() {
    if (i >= tasks.length) return
    const idx = i++
    try {
      const result = await tasks[idx]()
      onResult(idx, result, null)
    } catch (err) {
      onResult(idx, null, err.message)
    }
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(cap, tasks.length) }, next))
}

function EmailPill({ email, isTarget }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      background: isTarget ? 'rgba(92,255,161,.15)' : 'var(--surface-3)',
      color: isTarget ? 'var(--ok)' : 'var(--text-dim)',
      border: isTarget ? '1px solid rgba(92,255,161,.3)' : '1px solid var(--border)',
      fontWeight: isTarget ? 700 : 400,
      marginRight: 4,
      marginBottom: 2,
    }}>
      {isTarget && '✓ '}{email}
    </span>
  )
}

function SiteCard({ result, targetEmail }) {
  const { domain, pages, allEmails, hasTarget, error } = result
  const target = (targetEmail || '').toLowerCase()

  const statusColor = error ? 'var(--text-faint)'
    : hasTarget       ? 'var(--ok)'
    : allEmails?.length ? 'var(--warn)'
    : 'var(--text-faint)'

  const statusLabel = error ? 'Error'
    : hasTarget          ? 'Email found'
    : allEmails?.length  ? 'Different emails'
    : 'No emails found'

  const statusIcon = error ? 'alert'
    : hasTarget          ? 'check'
    : allEmails?.length  ? 'mail'
    : 'search'

  return (
    <div style={{
      border: `1px solid ${hasTarget ? 'rgba(92,255,161,.2)' : 'var(--border)'}`,
      borderRadius: 10,
      background: hasTarget ? 'rgba(92,255,161,.03)' : 'var(--surface)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {domain}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: statusColor, flexShrink: 0 }}>
          <Icon name={statusIcon} size={13} /> {statusLabel}
        </span>
      </div>

      {error ? (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-faint)' }}>Could not reach site: {error}</div>
      ) : (
        <div style={{ padding: '10px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: 8, paddingRight: 16, width: 80 }}>Page</th>
                <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: 8 }}>Emails found</th>
              </tr>
            </thead>
            <tbody>
              {(pages || []).map(page => (
                <tr key={page.type} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 16px 8px 0', verticalAlign: 'top' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: page.hasTarget ? 'var(--ok)' : page.emails.length ? 'var(--text-dim)' : 'var(--text-faint)' }}>
                      {page.type}
                    </span>
                    {!page.fetched && (
                      <div style={{ fontSize: 10, color: 'var(--text-ghost)', marginTop: 1 }}>not found</div>
                    )}
                  </td>
                  <td style={{ padding: '8px 0', verticalAlign: 'top' }}>
                    {page.emails.length === 0 ? (
                      <span style={{ fontSize: 12, color: 'var(--text-ghost)' }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        {page.emails.map(email => (
                          <EmailPill key={email} email={email} isTarget={email === target} />
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(allEmails?.length || 0) > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 3, flexShrink: 0 }}>All unique</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {allEmails.map(email => (
                  <EmailPill key={email} email={email} isTarget={email === target} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HistoryItem({ entry, onLoad, onDelete }) {
  const { targetEmail, results = [], sheetUrl, savedAt, partial } = entry
  const done     = results.filter(r => !r.status || r.status !== 'pending')
  const found    = done.filter(r => r.hasTarget).length
  const other    = done.filter(r => !r.hasTarget && (r.allEmails?.length || 0) > 0).length
  const total    = results.length

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
              {targetEmail}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{total} site{total !== 1 ? 's' : ''}</span>
            {found > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ok)', background: 'rgba(92,255,161,.1)', border: '1px solid rgba(92,255,161,.25)', borderRadius: 4, padding: '1px 6px' }}>
                ✓ {found} found
              </span>
            )}
            {other > 0 && (
              <span style={{ fontSize: 11, color: 'var(--warn)' }}>{other} other</span>
            )}
            {partial && (
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                partial
              </span>
            )}
            {sheetUrl && (
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ok)', letterSpacing: '0.04em' }}>✓ sheet</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-ghost)', marginTop: 3 }}>{fmtRelDate(savedAt)}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button className="btn ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => onLoad(entry)}>Load</button>
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--ok)', textDecoration: 'none', background: 'rgba(92,255,161,.1)', border: '1px solid rgba(92,255,161,.25)', borderRadius: 5, padding: '3px 10px' }}>
              ↗ Sheet
            </a>
          )}
          <button className="btn ghost" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--text-faint)' }} onClick={() => onDelete(entry.id)}>×</button>
        </div>
      </div>
    </div>
  )
}

export function EmailChecker() {
  const [tab,          setTab]          = useState('check')
  const [targetEmail,  setTargetEmail]  = useState('')
  const [websiteText,  setWebsiteText]  = useState('')
  const [results,      setResults]      = useState([])
  const [progress,     setProgress]     = useState(null)
  const [running,      setRunning]      = useState(false)
  const [sheetStatus,  setSheetStatus]  = useState(null)
  const [history,      setHistory]      = useState([])
  const [restored,     setRestored]     = useState(false)
  const abortRef  = useRef(false)
  const runIdRef  = useRef(null)

  // Load history from Supabase on mount
  useEffect(() => { dbLoadRuns(TOOL_KEY).then(setHistory) }, [])

  // Restore last session on mount
  useEffect(() => {
    const draft = loadDraft(TOOL_KEY)
    if (!draft || !(draft.results || []).length) return
    const clean = draft.results.map(r =>
      r.status === 'pending' ? { domain: r.domain, error: 'Interrupted', pages: [], allEmails: [], hasTarget: false } : r
    )
    setTargetEmail(draft.targetEmail || '')
    setWebsiteText(draft.websiteText || '')
    setResults(clean)
    if (draft.sheetUrl) setSheetStatus({ url: draft.sheetUrl })
    runIdRef.current = draft.id
    setRestored(true)
  }, [])

  // Auto-save draft whenever results or sheet change
  useEffect(() => {
    if (!results.length) return
    saveDraft(TOOL_KEY, {
      id: runIdRef.current,
      savedAt: new Date().toISOString(),
      targetEmail,
      websiteText,
      results,
      sheetUrl: sheetStatus?.url || null,
    })
  }, [results, sheetStatus])

  const domains = parseDomains(websiteText)
  const canRun  = targetEmail.includes('@') && domains.length > 0 && !running

  async function run() {
    if (!canRun) return
    abortRef.current = false
    const id = makeRunId()
    runIdRef.current = id
    setRestored(false)
    setRunning(true)
    setSheetStatus(null)
    setProgress({ done: 0, total: domains.length })
    setResults(domains.map(d => ({ domain: d, status: 'pending' })))

    const target          = targetEmail.trim().toLowerCase()
    const capturedText    = websiteText
    const capturedTarget  = targetEmail.trim()
    const capturedDomains = [...domains]
    const finalResults    = capturedDomains.map(d => ({ domain: d, status: 'pending' }))

    const tasks = capturedDomains.map((domain, idx) => async () => {
      if (abortRef.current) return null
      return checkDomain(domain, target)
    })

    await runCapped(tasks, CONCURRENCY, (idx, data, err) => {
      const r = data
        ? { ...data }
        : { domain: capturedDomains[idx], error: err || 'Failed', pages: [], allEmails: [], hasTarget: false }
      finalResults[idx] = r
      setResults(prev => { const next = [...prev]; next[idx] = r; return next })
      setProgress(prev => ({ ...prev, done: (prev?.done || 0) + 1 }))
    })

    setRunning(false)
    setProgress(null)

    const entry = {
      id,
      savedAt:     new Date().toISOString(),
      targetEmail: capturedTarget,
      websiteText: capturedText,
      results:     finalResults,
      sheetUrl:    null,
      partial:     false,
    }
    dbSaveRun(TOOL_KEY, entry)
    setHistory(prev => upsertLocal(prev, entry))
  }

  function stop() {
    abortRef.current = true
    setRunning(false)
    setProgress(null)
    setResults(prev => {
      const next = prev.map(r =>
        r.status === 'pending' ? { domain: r.domain, error: 'Stopped', pages: [], allEmails: [], hasTarget: false } : r
      )
      const entry = {
        id:          runIdRef.current || makeRunId(),
        savedAt:     new Date().toISOString(),
        targetEmail: targetEmail.trim(),
        websiteText,
        results:     next,
        sheetUrl:    sheetStatus?.url || null,
        partial:     true,
      }
      dbSaveRun(TOOL_KEY, entry)
      setHistory(prev => upsertLocal(prev, entry))
      return next
    })
  }

  async function generateSheet() {
    setSheetStatus('building')
    try {
      const url = await buildEmailCheckerSheet(
        targetEmail,
        results,
        msg => setSheetStatus(s => typeof s === 'object' && s?.url ? s : `building:${msg}`)
      )
      setSheetStatus({ url })
      const entry = {
        id:          runIdRef.current || makeRunId(),
        savedAt:     new Date().toISOString(),
        targetEmail: targetEmail.trim(),
        websiteText,
        results,
        sheetUrl:    url,
        partial:     results.some(r => r.error === 'Stopped'),
      }
      dbSaveRun(TOOL_KEY, entry)
      setHistory(prev => upsertLocal(prev, entry))
    } catch (err) {
      setSheetStatus({ error: err.message })
    }
  }

  function loadFromHistory(entry) {
    setTargetEmail(entry.targetEmail || '')
    setWebsiteText(entry.websiteText || '')
    setResults(entry.results || [])
    setSheetStatus(entry.sheetUrl ? { url: entry.sheetUrl } : null)
    runIdRef.current = entry.id
    setRestored(false)
    setTab('check')
  }

  function handleDeleteHistory(id) {
    dbDeleteRun(id)
    setHistory(prev => prev.filter(e => e.id !== id))
  }

  const doneResults = results.filter(r => r.status !== 'pending')
  const foundCount  = doneResults.filter(r => r.hasTarget).length
  const otherCount  = doneResults.filter(r => !r.hasTarget && (r.allEmails?.length || 0) > 0).length
  const noneCount   = doneResults.filter(r => !r.hasTarget && !(r.allEmails?.length)).length

  const tabLabel = history.length > 0 ? `History (${history.length})` : 'History'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {[['check', 'Check'], ['history', tabLabel]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px 10px',
              fontSize: 13, fontWeight: 600,
              color: tab === key ? 'var(--accent)' : 'var(--text-faint)',
              borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, transition: 'color .15s',
            }}
          >{label}</button>
        ))}
      </div>

      {/* ── History tab ── */}
      {tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {history.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-faint)', padding: '20px 0', textAlign: 'center' }}>
              No runs yet — your completed checks will appear here.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn ghost" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--text-faint)' }}
                  onClick={() => { dbClearRuns(TOOL_KEY); setHistory([]) }}>
                  Clear all
                </button>
              </div>
              {history.map(entry => (
                <HistoryItem
                  key={entry.id}
                  entry={entry}
                  onLoad={loadFromHistory}
                  onDelete={handleDeleteHistory}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Check tab ── */}
      {tab === 'check' && (
        <>
          {/* Restored banner */}
          {restored && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.25)', borderRadius: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--warn)' }}>↺</span>
              <span style={{ color: 'var(--text-dim)', flex: 1 }}>Restored from your last session.</span>
              <button className="btn ghost" style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => {
                setRestored(false)
                setResults([])
                setWebsiteText('')
                setTargetEmail('')
                setSheetStatus(null)
              }}>
                Start fresh
              </button>
            </div>
          )}

          {/* Inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Target email to find
              </label>
              <input
                className="input"
                placeholder="contact@yourclient.com"
                value={targetEmail}
                onChange={e => setTargetEmail(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-ghost)' }}>The email you want to verify is listed</div>
            </div>

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
            </div>
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn accent"
              onClick={run}
              disabled={!canRun}
              style={{ minWidth: 140 }}
            >
              {running ? `Checking… ${progress?.done || 0}/${progress?.total || 0}` : `Check ${domains.length > 0 ? domains.length + ' sites' : 'Sites'}`}
            </button>

            {running && (
              <button className="btn ghost" onClick={stop} style={{ fontSize: 12 }}>Stop</button>
            )}

            {progress && (
              <div style={{ flex: 1, height: 4, background: 'var(--surface-3)', borderRadius: 2, overflow: 'hidden', maxWidth: 200 }}>
                <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${((progress.done / progress.total) * 100).toFixed(0)}%`, transition: 'width .3s' }} />
              </div>
            )}

            {results.length > 0 && !running && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {foundCount > 0 && <span style={{ color: 'var(--ok)' }}>✓ {foundCount} found</span>}
                {otherCount > 0 && <span style={{ color: 'var(--warn)' }}>⚠ {otherCount} other emails</span>}
                {noneCount > 0  && <span style={{ color: 'var(--text-faint)' }}>— {noneCount} no emails</span>}

                {doneResults.length > 0 && (
                  sheetStatus === 'building' || (typeof sheetStatus === 'string' && sheetStatus.startsWith('building:'))
                    ? <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                        {typeof sheetStatus === 'string' && sheetStatus.includes(':') ? sheetStatus.split(':')[1] : 'Building sheet…'}
                      </span>
                    : sheetStatus?.url
                    ? <a href={sheetStatus.url} target="_blank" rel="noreferrer"
                        style={{ fontSize: 11, fontWeight: 700, color: 'var(--ok)', textDecoration: 'none', background: 'rgba(92,255,161,.1)', border: '1px solid rgba(92,255,161,.25)', borderRadius: 5, padding: '3px 10px' }}>
                        ↗ Open Sheet
                      </a>
                    : sheetStatus?.error
                    ? <span style={{ color: 'var(--danger)', fontSize: 11 }} title={sheetStatus.error}>Sheet error</span>
                    : <button className="btn ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={generateSheet}>
                        ↗ Generate Sheet
                      </button>
                )}

                <button className="btn ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => {
                  setResults([])
                  setWebsiteText('')
                  setTargetEmail('')
                  setSheetStatus(null)
                  setRestored(false)
                }}>Clear</button>
              </div>
            )}
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.map((r, i) => (
                r.status === 'pending'
                  ? (
                    <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-faint)' }}>{r.domain}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-ghost)' }}>Checking…</span>
                    </div>
                  )
                  : <SiteCard key={i} result={r} targetEmail={targetEmail} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

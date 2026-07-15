import { useState, useRef, useMemo } from 'react'
import { Icon } from '../data.jsx'
import { buildEmailHarvesterSheet } from '../lib/emailHarvesterSheet.js'

const CONCURRENCY = 5

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

function EmailPill({ email, count }) {
  const multi = count > 1
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      background: multi ? 'rgba(92,255,161,.08)' : 'var(--surface-3)',
      color: multi ? 'var(--ok)' : 'var(--text-dim)',
      border: multi ? '1px solid rgba(92,255,161,.25)' : '1px solid var(--border)',
      marginRight: 4,
      marginBottom: 2,
    }}>
      {email}
      {multi && (
        <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(92,255,161,.2)', color: 'var(--ok)', borderRadius: 4, padding: '0 4px', lineHeight: '16px' }}>
          ×{count}
        </span>
      )}
    </span>
  )
}

function SiteCard({ result, emailFreq }) {
  const { domain, pages, allEmails, error } = result
  const hasEmails = (allEmails?.length || 0) > 0

  const statusColor = error ? 'var(--text-faint)' : hasEmails ? 'var(--ok)' : 'var(--text-faint)'
  const statusLabel = error
    ? 'Error'
    : hasEmails
    ? `${allEmails.length} email${allEmails.length !== 1 ? 's' : ''} found`
    : 'No emails found'
  const statusIcon = error ? 'alert' : hasEmails ? 'mail' : 'search'

  return (
    <div style={{
      border: `1px solid ${hasEmails ? 'rgba(92,255,161,.2)' : 'var(--border)'}`,
      borderRadius: 10,
      background: hasEmails ? 'rgba(92,255,161,.03)' : 'var(--surface)',
      overflow: 'hidden',
    }}>
      {/* Header */}
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
                    <span style={{ fontSize: 12, fontWeight: 600, color: page.emails.length ? 'var(--ok)' : 'var(--text-faint)' }}>
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
                        {page.emails.map(email => <EmailPill key={email} email={email} count={emailFreq?.[email] || 1} />)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {allEmails.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 3, flexShrink: 0 }}>All unique</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {allEmails.map(email => <EmailPill key={email} email={email} count={emailFreq?.[email] || 1} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function EmailHarvester() {
  const [websiteText, setWebsiteText]  = useState('')
  const [results,     setResults]      = useState([])
  const [progress,    setProgress]     = useState(null)
  const [running,     setRunning]      = useState(false)
  const [sheetStatus, setSheetStatus]  = useState(null)
  const abortRef = useRef(false)

  const domains = parseDomains(websiteText)
  const canRun  = domains.length > 0 && !running

  async function run() {
    if (!canRun) return
    abortRef.current = false
    setRunning(true)
    setSheetStatus(null)
    setProgress({ done: 0, total: domains.length })
    setResults(domains.map(d => ({ domain: d, status: 'pending' })))

    const tasks = domains.map((domain, idx) => async () => {
      if (abortRef.current) return null
      return harvestDomain(domain)
    })

    await runCapped(tasks, CONCURRENCY, (idx, data, err) => {
      setResults(prev => {
        const next = [...prev]
        next[idx] = data
          ? { ...data }
          : { domain: domains[idx], error: err || 'Failed', pages: [], allEmails: [] }
        return next
      })
      setProgress(prev => ({ ...prev, done: (prev?.done || 0) + 1 }))
    })

    setRunning(false)
    setProgress(null)
  }

  function stop() {
    abortRef.current = true
    setRunning(false)
    setProgress(null)
  }

  async function generateSheet() {
    setSheetStatus('building')
    try {
      const url = await buildEmailHarvesterSheet(
        results,
        msg => setSheetStatus(s => typeof s === 'object' && s?.url ? s : `building:${msg}`)
      )
      setSheetStatus({ url })
    } catch (err) {
      setSheetStatus({ error: err.message })
    }
  }

  const doneResults = results.filter(r => r.status !== 'pending')
  const withEmails  = doneResults.filter(r => (r.allEmails?.length || 0) > 0)
  const withNone    = doneResults.filter(r => !r.error && (r.allEmails?.length || 0) === 0)
  const totalEmails = [...new Set(doneResults.flatMap(r => r.allEmails || []))].length

  const emailFreq = useMemo(() => {
    const freq = {}
    for (const r of doneResults) {
      for (const email of (r.allEmails || [])) {
        freq[email] = (freq[email] || 0) + 1
      }
    }
    return freq
  }, [doneResults])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
        <div style={{ fontSize: 11, color: 'var(--text-ghost)' }}>
          Scrapes contact, about, home &amp; privacy pages — no login required
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
          {running
            ? `Harvesting… ${progress?.done || 0}/${progress?.total || 0}`
            : `Harvest ${domains.length > 0 ? domains.length + ' sites' : 'Emails'}`}
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
            {withEmails.length > 0  && <span style={{ color: 'var(--ok)' }}>✓ {withEmails.length} with emails</span>}
            {totalEmails > 0        && <span style={{ color: 'var(--text-dim)' }}>{totalEmails} unique total</span>}
            {withNone.length > 0    && <span style={{ color: 'var(--text-faint)' }}>— {withNone.length} empty</span>}

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

            <button className="btn ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setResults([]); setWebsiteText(''); setSheetStatus(null) }}>Clear</button>
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
                  <span style={{ fontSize: 12, color: 'var(--text-ghost)' }}>Harvesting…</span>
                </div>
              )
              : <SiteCard key={i} result={r} emailFreq={emailFreq} />
          ))}
        </div>
      )}
    </div>
  )
}

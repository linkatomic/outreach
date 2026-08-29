import { useState, useRef } from 'react'

const BATCH_SIZE        = 25  // matches server CONCURRENCY in api/resolve-url.js — single wave
const BATCH_CONCURRENCY = 3   // concurrent batch requests in flight
const ROW_RENDER_CAP    = 200 // perf guard for huge lists — full data still included in Copy

// Preserves EVERY line exactly, including duplicates and original order — this tool's whole
// point is a 1:1 row correspondence with the input, so no dedup, no sort, no filtering by
// content (only truly blank lines are dropped, since they aren't domains at all).
function parseDomainLines(text) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

async function resolveBatch(domains) {
  const res = await fetch('/api/resolve-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domains }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function runItemsCapped(items, cap, onItem) {
  let i = 0
  async function next() {
    if (i >= items.length) return
    const idx = i++
    await onItem(idx, items[idx])
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, next))
}

const STATUS_COLOR = {
  OK: 'var(--accent)',
  DNS_ERROR: '#ff8fa3', CONNECTION_ERROR: '#ff8fa3', TIMEOUT: '#fbbf24',
  SSL_ERROR: '#fb923c', REDIRECT_LOOP: '#a78bfa', NO_RESPONSE: 'var(--text-faint)',
}

function buildTsv(rows) {
  const header = ['Original Domain', 'Final Actual URL', 'Status'].join('\t')
  const lines = rows.map(r => [r.input, r.status === 'OK' ? r.finalUrl : '—', r.status].join('\t'))
  return [header, ...lines].join('\n')
}

export function RedirectResolver() {
  const [inputText, setInputText] = useState('')
  const [results,   setResults]   = useState(null) // array, index-aligned with input lines
  const [running,   setRunning]   = useState(false)
  const [progress,  setProgress]  = useState(null)
  const [copied,    setCopied]    = useState(false)
  const abortRef = useRef(false)

  const domains = parseDomainLines(inputText)
  const canRun  = domains.length > 0 && !running

  async function run() {
    if (!canRun) return
    abortRef.current = false
    setRunning(true)
    setCopied(false)
    const total = new Array(domains.length)
    setResults(null)
    setProgress({ done: 0, total: domains.length })

    const batches = []
    for (let start = 0; start < domains.length; start += BATCH_SIZE) {
      batches.push({ start, items: domains.slice(start, start + BATCH_SIZE) })
    }

    let doneCount = 0

    await runItemsCapped(batches, BATCH_CONCURRENCY, async (batchIdx, batch) => {
      if (abortRef.current) return
      let items
      try {
        const data = await resolveBatch(batch.items)
        items = data.results || batch.items.map(input => ({ input, status: 'NO_RESPONSE' }))
      } catch {
        items = batch.items.map(input => ({ input, status: 'NO_RESPONSE' }))
      }
      for (let i = 0; i < items.length; i++) total[batch.start + i] = items[i]
      doneCount += batch.items.length
      setProgress({ done: Math.min(domains.length, doneCount), total: domains.length })
      setResults(total.map((r, i) => r || { input: domains[i], pending: true }))
    })

    // Guarantee exactly domains.length rows, no gaps — anything a Stop left untouched
    // gets an explicit status rather than silently vanishing or shifting other rows.
    for (let i = 0; i < total.length; i++) {
      if (!total[i]) total[i] = { input: domains[i], status: 'NO_RESPONSE', stopped: true }
    }
    setResults(total)
    setRunning(false)
    setProgress(null)
  }

  function stop() {
    abortRef.current = true
    setRunning(false)
    setProgress(null)
  }

  function copyTsv() {
    if (!results) return
    navigator.clipboard.writeText(buildTsv(results)).then(() => {
      setCopied('tsv')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function copyUrlsOnly() {
    if (!results) return
    // One line per result, in order — including a placeholder for failed rows, so pasting
    // this next to the original domain list in a sheet still lines up row-for-row.
    const text = results.map(r => r.status === 'OK' ? r.finalUrl : '—').join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied('urls')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function clear() {
    setInputText('')
    setResults(null)
  }

  const doneCount   = results ? results.filter(r => !r.pending).length : 0
  const okCount     = results ? results.filter(r => r.status === 'OK').length : 0
  const failCount   = results ? doneCount - okCount : 0
  const shownRows   = results ? results.slice(0, ROW_RENDER_CAP) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
        Paste bare domains (no protocol/www needed) — tries HTTPS first like modern Chrome,
        falls back to HTTP only if HTTPS can't connect, and follows every redirect (301/302/
        303/307/308, protocol changes, www ↔ non-www, cross-domain) to the real final URL.
        Every input line gets exactly one output row, in the same order, duplicates included —
        nothing is ever skipped, reordered, or guessed.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Domains · {domains.length > 0 ? `${domains.length} detected` : 'one per line'}
        </label>
        <textarea
          className="input"
          placeholder={'gram-til-dl.dk\ndanishfoodinnovation.dk\nsportoghobby.dk'}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          disabled={running}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical', minHeight: 130, lineHeight: 1.6 }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn accent" onClick={run} disabled={!canRun} style={{ minWidth: 140 }}>
          {running ? `Resolving… ${progress?.done || 0}/${progress?.total || 0}` : `Resolve ${domains.length > 0 ? domains.length + ' Domains' : 'Domains'}`}
        </button>

        {running && <button className="btn ghost" onClick={stop}>Stop</button>}

        {progress && (
          <div style={{ height: 4, background: 'var(--surface-3, var(--surface))', borderRadius: 2, overflow: 'hidden', width: 160, border: '1px solid var(--border)' }}>
            <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${Math.round((progress.done / progress.total) * 100)}%`, transition: 'width .3s' }} />
          </div>
        )}

        {results && !running && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--accent)' }}>✓ {okCount} resolved</span>
            {failCount > 0 && <span style={{ color: '#ff8fa3' }}>⚠ {failCount} failed</span>}
            <button className="btn accent" onClick={copyUrlsOnly} style={{ fontSize: 12, padding: '6px 14px' }}>
              {copied === 'urls' ? 'Copied!' : 'Copy URLs Only'}
            </button>
            <button className="btn ghost" onClick={copyTsv} style={{ fontSize: 12, padding: '6px 14px' }}>
              {copied === 'tsv' ? 'Copied!' : 'Copy TSV (Domain, URL, Status)'}
            </button>
            <button className="btn ghost" onClick={clear} style={{ fontSize: 12 }}>Clear</button>
          </div>
        )}
      </div>

      {results && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface-3, var(--surface))' }}>
                <th style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Original Domain</th>
                <th style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Final Actual URL</th>
                <th style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((r, i) => (
                <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '7px 14px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{r.input}</td>
                  <td style={{ padding: '7px 14px', fontFamily: 'var(--font-mono)', color: r.status === 'OK' ? 'var(--accent)' : 'var(--text-ghost)', wordBreak: 'break-all' }}>
                    {r.pending ? '…' : r.status === 'OK' ? r.finalUrl : '—'}
                  </td>
                  <td style={{ padding: '7px 14px', whiteSpace: 'nowrap' }}>
                    {r.pending
                      ? <span style={{ fontSize: 11, color: 'var(--text-ghost)' }}>pending…</span>
                      : <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[r.status] || 'var(--text-faint)' }}>{r.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length > ROW_RENDER_CAP && (
            <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-ghost)', borderTop: '1px solid var(--border)' }}>
              Showing the first {ROW_RENDER_CAP} of {results.length} rows — all included in Copy TSV.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

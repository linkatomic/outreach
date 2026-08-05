import { useState, useRef } from 'react'

const BATCH_SIZE        = 20  // docs per API request — sized to finish inside one serverless invocation
const BATCH_CONCURRENCY = 3   // concurrent batch requests in flight
const CARD_RENDER_CAP   = 60  // max detailed cards rendered per section (perf guard for huge runs)

function parseDocUrls(text) {
  return text
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// Builds one row per doc, in the exact order docs were entered: AnchorText1 \t AnchorURL1 \t ...
// Only genuinely failed docs are skipped — a successful doc with zero links still gets a row
// (blank), so row position keeps lining up with the original input list.
function buildSheetText(docs) {
  return docs
    .filter(d => d && !d.error)
    .map(d => (d.links || []).flatMap(l => [l.text, l.url]).join('\t'))
    .join('\n')
}

async function runBatchesCapped(batches, cap, onBatchDone) {
  let i = 0
  async function next() {
    if (i >= batches.length) return
    const idx = i++
    await onBatchDone(idx, batches[idx])
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(cap, batches.length) }, next))
}

function DocCard({ doc }) {
  const hasError = !!doc.error
  const count = doc.links?.length || 0

  return (
    <div style={{
      border: `1px solid ${hasError ? 'rgba(255,92,124,.3)' : 'var(--border)'}`,
      borderRadius: 10,
      background: 'var(--surface)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: hasError ? 'none' : '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
          {doc.title || doc.docId || doc.input}
        </span>
        {hasError ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#ff8fa3', flexShrink: 0 }}>Error</span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: count ? 'var(--accent)' : 'var(--text-faint)', flexShrink: 0 }}>
            {count} link{count !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {hasError ? (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-faint)' }}>{doc.error}</div>
      ) : count === 0 ? (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-ghost)' }}>No hyperlinks found in this doc.</div>
      ) : (
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <tbody>
              {doc.links.map((l, i) => (
                <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '7px 12px', color: 'var(--text-dim)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.text}</td>
                  <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', wordBreak: 'break-all' }}>{l.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function AnchorExtractorPage() {
  const [inputText, setInputText] = useState('')
  const [docs, setDocs]           = useState([])
  const [running, setRunning]     = useState(false)
  const [progress, setProgress]   = useState(null) // { done, total }
  const [error, setError]         = useState('')
  const [copied, setCopied]       = useState(false)
  const abortRef = useRef(false)

  const urls   = parseDocUrls(inputText)
  const canRun = urls.length > 0 && !running

  async function run() {
    if (!canRun) return
    abortRef.current = false
    setRunning(true)
    setError('')
    const results = new Array(urls.length)
    setDocs([])
    setProgress({ done: 0, total: urls.length })

    const batches = []
    for (let start = 0; start < urls.length; start += BATCH_SIZE) {
      batches.push(urls.slice(start, start + BATCH_SIZE))
    }

    let doneCount = 0

    await runBatchesCapped(batches, BATCH_CONCURRENCY, async (batchIdx, batch) => {
      if (abortRef.current) return
      const start = batchIdx * BATCH_SIZE
      try {
        const res = await fetch('/api/doc-links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: batch }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const batchResults = data.results || batch.map(u => ({ input: u, error: 'No response for this batch' }))
        for (let i = 0; i < batchResults.length; i++) results[start + i] = batchResults[i]
      } catch (err) {
        for (let i = 0; i < batch.length; i++) {
          results[start + i] = { input: batch[i], error: `Batch failed (${err.message}) — try again` }
        }
      }
      doneCount += batch.length
      setProgress({ done: Math.min(urls.length, doneCount), total: urls.length })
      setDocs(results.filter(Boolean))
    })

    setRunning(false)
  }

  function stop() {
    abortRef.current = true
    setRunning(false)
  }

  function copyForSheets() {
    const text = buildSheetText(docs)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function clear() {
    setInputText('')
    setDocs([])
    setError('')
    setProgress(null)
  }

  const successDocs  = docs.filter(d => !d.error)
  const errorDocs    = docs.filter(d => d.error)
  const totalLinks   = successDocs.reduce((s, d) => s + (d.links?.length || 0), 0)
  const shownSuccess = successDocs.slice(0, CARD_RENDER_CAP)
  const shownErrors  = errorDocs.slice(0, CARD_RENDER_CAP)

  const S = {
    page: {
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 20px 80px',
    },
    card: { width: '100%', maxWidth: 760 },
    logo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 },
    logoBox: {
      width: 36, height: 36, borderRadius: 8,
      background: 'var(--accent)', color: 'var(--accent-ink)',
      display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18,
    },
    logoLabel: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' },
    heading: { fontSize: 26, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.03em' },
    sub: { fontSize: 14, color: 'var(--text-dim)', marginBottom: 6, lineHeight: 1.6 },
    note: {
      fontSize: 12, color: 'var(--text-faint)', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 8, padding: '9px 13px',
      marginTop: 12, marginBottom: 24, lineHeight: 1.6,
    },
    label: { fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'block' },
    textarea: {
      width: '100%', minHeight: 130, resize: 'vertical',
      border: '1.5px solid var(--border-strong)', borderRadius: 10,
      padding: '14px 16px', background: 'var(--surface)',
      fontSize: 13, color: 'var(--text)', fontFamily: 'var(--font-mono)',
      outline: 'none', lineHeight: 1.6, boxSizing: 'border-box',
    },
    hint: { fontSize: 12, color: 'var(--text-ghost)', marginTop: 6 },
    actionRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' },
    btnAccent: {
      background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none',
      borderRadius: 6, padding: '9px 20px', fontWeight: 700, fontSize: 13,
      cursor: 'pointer', fontFamily: 'var(--font-sans)', minWidth: 140,
    },
    btnGhost: {
      background: 'transparent', color: 'var(--text-dim)',
      border: '1px solid var(--border-strong)', borderRadius: 6,
      padding: '8px 14px', fontWeight: 600, fontSize: 13,
      cursor: 'pointer', fontFamily: 'var(--font-sans)',
    },
    progressBarTrack: { flex: 1, height: 4, background: 'var(--surface-3, var(--surface))', borderRadius: 2, overflow: 'hidden', minWidth: 120, maxWidth: 200, border: '1px solid var(--border)' },
    progressBarFill: { height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width .3s' },
    progressText: { fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' },
    error: {
      background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)',
      color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginTop: 16,
    },
    resultsHeader: { display: 'flex', alignItems: 'center', gap: 14, marginTop: 28, marginBottom: 14, flexWrap: 'wrap' },
    statOk: { fontSize: 12, fontWeight: 600, color: 'var(--accent)' },
    statErr: { fontSize: 12, fontWeight: 600, color: '#ff8fa3' },
    statDim: { fontSize: 12, color: 'var(--text-faint)' },
    list: { display: 'flex', flexDirection: 'column', gap: 8 },
    sectionLabel: { fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '18px 0 8px' },
    truncNote: { fontSize: 12, color: 'var(--text-ghost)', marginTop: 8 },
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoBox}>R</div>
          <span style={S.logoLabel}>Relay</span>
        </div>

        <h1 style={S.heading}>Anchor Link Extractor</h1>
        <p style={S.sub}>
          Paste one or more Google Doc links below. We'll pull out every hyperlink's
          anchor text and destination URL — ready to paste straight into a Google Sheet.
        </p>
        <div style={S.note}>
          Each doc must be shared as <b>"Anyone with the link can view"</b> — we read the doc's
          public export, no sign-in required on your end. Large batches (hundreds+) are processed
          in the background in small chunks — keep this tab open and watch the progress bar.
        </div>

        <span style={S.label}>Google Doc links · one per line</span>
        <textarea
          style={S.textarea}
          placeholder={'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit\nhttps://docs.google.com/document/d/...'}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          disabled={running}
        />
        <div style={S.hint}>{urls.length > 0 ? `${urls.length} link${urls.length !== 1 ? 's' : ''} detected` : 'Paste doc share links, one per line'}</div>

        <div style={S.actionRow}>
          <button style={{ ...S.btnAccent, opacity: canRun ? 1 : 0.5, cursor: canRun ? 'pointer' : 'default' }} onClick={run} disabled={!canRun}>
            {running ? `Extracting… ${progress?.done ?? 0}/${progress?.total ?? 0}` : `Extract ${urls.length > 0 ? urls.length + ' doc' + (urls.length !== 1 ? 's' : '') : 'Links'}`}
          </button>

          {running && <button style={S.btnGhost} onClick={stop}>Stop</button>}

          {progress && (
            <div style={S.progressBarTrack}>
              <div style={{ ...S.progressBarFill, width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
          )}
          {progress && <span style={S.progressText}>{progress.done}/{progress.total}</span>}

          {docs.length > 0 && !running && (
            <>
              <button style={S.btnAccent} onClick={copyForSheets} disabled={successDocs.length === 0}>
                {copied ? 'Copied!' : 'Copy for Sheets'}
              </button>
              <button style={S.btnGhost} onClick={clear}>Clear</button>
            </>
          )}
        </div>

        {error && <div style={S.error}>{error}</div>}

        {docs.length > 0 && (
          <>
            <div style={S.resultsHeader}>
              <span style={S.statOk}>✓ {successDocs.length} doc{successDocs.length !== 1 ? 's' : ''} processed</span>
              <span style={S.statDim}>{totalLinks} link{totalLinks !== 1 ? 's' : ''} total</span>
              {errorDocs.length > 0 && <span style={S.statErr}>⚠ {errorDocs.length} failed</span>}
            </div>

            {shownSuccess.length > 0 && (
              <div style={S.list}>
                {shownSuccess.map((d, i) => <DocCard key={i} doc={d} />)}
              </div>
            )}
            {successDocs.length > CARD_RENDER_CAP && (
              <div style={S.truncNote}>
                +{successDocs.length - CARD_RENDER_CAP} more processed successfully — not shown here for performance, but included in "Copy for Sheets".
              </div>
            )}

            {shownErrors.length > 0 && (
              <>
                <div style={S.sectionLabel}>Failed</div>
                <div style={S.list}>
                  {shownErrors.map((d, i) => <DocCard key={i} doc={d} />)}
                </div>
                {errorDocs.length > CARD_RENDER_CAP && (
                  <div style={S.truncNote}>+{errorDocs.length - CARD_RENDER_CAP} more failed — same reasons, not all shown.</div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

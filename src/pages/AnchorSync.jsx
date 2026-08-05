import { useState, useRef } from 'react'
import { Icon } from '../data.jsx'
import { extractSheetId, getSheetRows, batchWriteRangeValues } from '../lib/sheetParserAPI.js'

const BATCH_SIZE        = 20  // docs per /api/doc-links request
const BATCH_CONCURRENCY = 3   // concurrent batch requests in flight
const LOG_RENDER_CAP    = 80  // perf guard for huge syncs

const DOC_LINK_RE = /docs\.google\.com\/document\/d\//

function colLetterToIndex(letter) {
  let n = 0
  for (const ch of (letter || '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
function colIndexToLetter(idx) {
  let n = idx + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function AnchorSync() {
  const [sheetUrl,  setSheetUrl]  = useState('https://docs.google.com/spreadsheets/d/1D4RZPgCAmhlThjnwquqnMIKOnJuL6FRjikthNlRX7t0/edit')
  const [tabName,   setTabName]   = useState('Sheet 4')
  const [sourceCol, setSourceCol] = useState('F')
  const [outputCol, setOutputCol] = useState('N')

  const [scanning,  setScanning]  = useState(false)
  const [pending,   setPending]   = useState(null) // [{ sheetRow, docLink }]
  const [scanError, setScanError] = useState('')

  const [running,  setRunning]  = useState(false)
  const [progress, setProgress] = useState(null)
  const [log,       setLog]     = useState([])
  const [runError,  setRunError] = useState('')
  const abortRef = useRef(false)

  async function scan() {
    setScanning(true)
    setScanError('')
    setPending(null)
    setLog([])
    try {
      const id = extractSheetId(sheetUrl)
      if (!id) throw new Error('Could not find a spreadsheet ID in that URL')
      const rows = await getSheetRows(id, tabName)
      const fIdx = colLetterToIndex(sourceCol)
      const nIdx = colLetterToIndex(outputCol)
      if (fIdx < 0 || nIdx < 0) throw new Error('Enter valid column letters (e.g. F, N)')

      const found = []
      rows.forEach((row, i) => {
        const link     = String(row[fIdx] || '').trim()
        const existing = String(row[nIdx] || '').trim()
        if (DOC_LINK_RE.test(link) && !existing) found.push({ sheetRow: i + 1, docLink: link })
      })
      setPending(found)
    } catch (err) {
      setScanError(err.message)
    } finally {
      setScanning(false)
    }
  }

  async function runSync() {
    if (!pending || pending.length === 0 || running) return
    abortRef.current = false
    setRunning(true)
    setRunError('')
    setProgress({ done: 0, total: pending.length })

    const id = extractSheetId(sheetUrl)
    const nIdx = colLetterToIndex(outputCol)
    const newLog = []

    const batches = []
    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      batches.push(pending.slice(start, start + BATCH_SIZE))
    }

    async function processBatch(batch) {
      if (abortRef.current) return
      let results
      try {
        const res = await fetch('/api/doc-links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: batch.map(b => b.docLink) }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        results = data.results || batch.map(() => ({ error: 'No response for this batch' }))
      } catch (err) {
        results = batch.map(() => ({ error: `Batch failed (${err.message})` }))
      }

      // Each result is paired with its row by INDEX WITHIN THIS BATCH — the same guarantee
      // already verified end-to-end — then written straight to that row's sheet range, keyed
      // by the sheet's own row number. There is no shared array to drift out of alignment.
      const writeData = []
      for (let i = 0; i < batch.length; i++) {
        const { sheetRow, docLink } = batch[i]
        const r = results[i]
        if (!r || r.error) {
          writeData.push({ range: `'${tabName}'!${outputCol}${sheetRow}`, values: [['FAILED']] })
          newLog.push({ sheetRow, docLink, status: 'failed', reason: r?.error || 'Unknown error' })
          continue
        }
        const vals = (r.links || []).flatMap(l => [l.text, l.url])
        if (vals.length === 0) {
          writeData.push({ range: `'${tabName}'!${outputCol}${sheetRow}`, values: [['(no links found)']] })
        } else {
          const endCol = colIndexToLetter(nIdx + vals.length - 1)
          writeData.push({ range: `'${tabName}'!${outputCol}${sheetRow}:${endCol}${sheetRow}`, values: [vals] })
        }
        newLog.push({ sheetRow, docLink, status: 'ok', linkCount: r.links?.length || 0 })
      }

      try {
        await batchWriteRangeValues(id, writeData)
      } catch (err) {
        setRunError(`Write failed for rows ${batch[0].sheetRow}-${batch[batch.length - 1].sheetRow}: ${err.message} — they'll be retried on the next sync.`)
      }

      setProgress(prev => ({ ...prev, done: Math.min(pending.length, (prev?.done || 0) + batch.length) }))
      setLog([...newLog])
    }

    let i = 0
    async function worker() {
      if (i >= batches.length) return
      const idx = i++
      await processBatch(batches[idx])
      return worker()
    }
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, worker))

    setRunning(false)
  }

  function stop() {
    abortRef.current = true
    setRunning(false)
  }

  const okCount     = log.filter(l => l.status === 'ok').length
  const failedCount = log.filter(l => l.status === 'failed').length
  const shownLog     = log.slice(-LOG_RENDER_CAP).reverse()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
        Reads Google Doc links from Column {sourceCol}, extracts anchor text + URL pairs, and writes them
        straight into that <b>same row</b> starting at Column {outputCol} — no copy-paste, so rows can never
        drift out of alignment. Rows that already have something in Column {outputCol} are skipped (safe to
        re-run — it only processes what's new). Rows that fail to fetch get <b>FAILED</b> written in Column {outputCol}.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>Sheet URL</label>
          <input className="input" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, width: '100%' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>Tab name</label>
          <input className="input" value={tabName} onChange={e => setTabName(e.target.value)} style={{ fontSize: 13, width: '100%' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>Source col</label>
          <input className="input" value={sourceCol} onChange={e => setSourceCol(e.target.value.toUpperCase())} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: '100%', textAlign: 'center' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>Output starts</label>
          <input className="input" value={outputCol} onChange={e => setOutputCol(e.target.value.toUpperCase())} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: '100%', textAlign: 'center' }} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn accent" onClick={scan} disabled={scanning || running}>
          {scanning ? 'Scanning…' : 'Scan Sheet'}
        </button>

        {pending !== null && !running && (
          <button className="btn accent" onClick={runSync} disabled={pending.length === 0}>
            {`Sync ${pending.length} Row${pending.length !== 1 ? 's' : ''}`}
          </button>
        )}

        {running && <button className="btn ghost" onClick={stop}>Stop</button>}

        {progress && (
          <>
            <div style={{ height: 4, background: 'var(--surface-3, var(--surface))', borderRadius: 2, overflow: 'hidden', width: 160, border: '1px solid var(--border)' }}>
              <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`, transition: 'width .3s' }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{progress.done}/{progress.total}</span>
          </>
        )}

        <a href={sheetUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', marginLeft: 'auto' }}>↗ Open Sheet</a>
      </div>

      {scanError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{scanError}</div>
      )}
      {runError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{runError}</div>
      )}

      {pending !== null && !scanError && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          {pending.length === 0
            ? `No pending rows — every row with a link in Column ${sourceCol} already has data in Column ${outputCol}.`
            : `Found ${pending.length} row${pending.length !== 1 ? 's' : ''} with a doc link in Column ${sourceCol} and nothing yet in Column ${outputCol}.`}
        </div>
      )}

      {log.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>✓ {okCount} written</span>
            {failedCount > 0 && <span style={{ color: '#ff8fa3', fontWeight: 600 }}>⚠ {failedCount} FAILED</span>}
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: 'var(--surface-3, var(--surface))' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Row</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Doc</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {shownLog.map((l, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{l.sheetRow}</td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.docLink}</td>
                    <td style={{ padding: '7px 12px' }}>
                      {l.status === 'ok'
                        ? <span style={{ color: 'var(--accent)' }}>{l.linkCount} link{l.linkCount !== 1 ? 's' : ''}</span>
                        : <span style={{ color: '#ff8fa3' }} title={l.reason}>FAILED</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {log.length > LOG_RENDER_CAP && (
            <div style={{ fontSize: 12, color: 'var(--text-ghost)' }}>Showing the most recent {LOG_RENDER_CAP} of {log.length} — all writes are saved to the sheet regardless.</div>
          )}
        </>
      )}
    </div>
  )
}

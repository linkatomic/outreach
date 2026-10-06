import { useState } from 'react'
import { extractSheetId, getSheetTabs, getSheetRows, batchWriteRangeValues } from '../lib/sheetParserAPI.js'

const CHUNK_SIZE = 12 // domains per /api/ahrefs call — keeps each serverless invocation fast and bounded

function colLetter(idx) {
  let s = '', n = idx
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 }
  return s
}

function parseDomainList(text) {
  return [...new Set(text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean))]
}

function toCSV(rows) {
  const esc = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  const lines = rows.map(r => [r.domain, r.domainRating ?? '', r.error || ''].map(esc).join(','))
  return ['domain,domain_rating,error', ...lines].join('\n')
}

function downloadCSV(rows) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: 'domain-ratings.csv' })
  a.click(); URL.revokeObjectURL(url)
}

export function AhrefsDomainRating() {
  const [mode, setMode] = useState('paste') // 'paste' | 'sheet'

  const [pasteText, setPasteText] = useState('')

  const [sheetUrl, setSheetUrl]   = useState('')
  const [tabs, setTabs]           = useState([])
  const [selTab, setSelTab]       = useState('')
  const [sheetRows, setSheetRows] = useState([]) // { domain, rowNum }
  const [sheetBusy, setSheetBusy] = useState(false)
  const [sheetErr, setSheetErr]   = useState('')
  // Column layout of the loaded sheet — -1 means "no Domain Rating column yet, append one".
  const [sheetMeta, setSheetMeta] = useState({ colCount: 0, drCol: -1 })

  const [running, setRunning]   = useState(false)
  const [results, setResults]   = useState([]) // { domain, domainRating, error }
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [writeStatus, setWriteStatus] = useState(null) // null | 'writing' | 'done' | { error }

  async function loadSheetRows(sheetId, tab) {
    setSheetBusy(true); setSheetErr(''); setSheetRows([])
    try {
      const raw = await getSheetRows(sheetId, tab)
      if (!raw.length) return
      const hdr = raw[0].map(h => String(h ?? '').trim().toLowerCase())
      const di  = hdr.findIndex(h => h === 'domain') >= 0 ? hdr.findIndex(h => h === 'domain') : 0
      const dri = hdr.findIndex(h => h.includes('domain rating') || h === 'dr')
      setSheetRows(
        raw.slice(1)
          .map((r, i) => ({ rowNum: i + 2, domain: String(r[di] ?? '').trim() })) // row 1 is the header
          .filter(r => r.domain)
      )
      setSheetMeta({ colCount: hdr.length, drCol: dri })
    } catch (e) { setSheetErr(e.message) }
    finally { setSheetBusy(false) }
  }

  async function handleLoadSheet() {
    setSheetErr(''); setTabs([]); setSheetRows([]); setSelTab('')
    setSheetBusy(true)
    try {
      const id = extractSheetId(sheetUrl.trim())
      if (!id) throw new Error('Invalid Google Sheet URL')
      const list = await getSheetTabs(id)
      setTabs(list)
      if (list.length === 1) { setSelTab(list[0].name); await loadSheetRows(id, list[0].name) }
    } catch (e) { setSheetErr(e.message) }
    finally { setSheetBusy(false) }
  }

  async function handleTabChange(tab) {
    setSelTab(tab); setSheetRows([])
    const id = extractSheetId(sheetUrl.trim())
    if (id && tab) await loadSheetRows(id, tab)
  }

  // De-duplicated — a domain repeated in the pasted list or across sheet rows is only ever
  // looked up once; results get mapped back onto every matching row/line afterwards.
  const domains = mode === 'paste' ? parseDomainList(pasteText) : [...new Set(sheetRows.map(r => r.domain))]

  async function writeBackToSheet(allResults) {
    const sheetId    = extractSheetId(sheetUrl.trim())
    const tabSheetId = tabs.find(t => t.name === selTab)?.sheetId
    if (!sheetId || tabSheetId == null) {
      setWriteStatus({ error: 'Could not resolve the sheet/tab ID — try reloading the sheet before checking.' })
      return
    }
    setWriteStatus('writing')
    try {
      const byDomain = new Map(allResults.map(r => [r.domain, r.domainRating]))
      let { colCount, drCol } = sheetMeta
      const valueUpdates = []
      if (drCol < 0) {
        drCol = colCount
        valueUpdates.push({ range: `'${selTab}'!${colLetter(drCol)}1`, values: [['Domain Rating']] })
      }
      for (const row of sheetRows) {
        const dr = byDomain.get(row.domain)
        if (dr != null) valueUpdates.push({ range: `'${selTab}'!${colLetter(drCol)}${row.rowNum}`, values: [[dr]] })
      }
      await batchWriteRangeValues(sheetId, valueUpdates)
      setSheetMeta({ colCount: Math.max(colCount, drCol + 1), drCol })
      setWriteStatus('done')
    } catch (err) {
      setWriteStatus({ error: err.message })
    }
  }

  async function handleCheck() {
    if (!domains.length) return
    setRunning(true); setResults([]); setWriteStatus(null)
    setProgress({ done: 0, total: domains.length })

    const allResults = []
    for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
      const chunk = domains.slice(i, i + CHUNK_SIZE)
      try {
        const res = await fetch('/api/ahrefs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domains: chunk }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        allResults.push(...data.results)
      } catch (err) {
        chunk.forEach(d => allResults.push({ domain: d, domainRating: null, error: err.message }))
      }
      setProgress({ done: Math.min(i + CHUNK_SIZE, domains.length), total: domains.length })
      setResults([...allResults])
    }

    if (mode === 'sheet' && sheetRows.length) await writeBackToSheet(allResults)

    setRunning(false)
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const okCount  = results.filter(r => r.domainRating != null).length
  const errCount = results.filter(r => r.error).length

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Domain Rating Checker</h1>
          <div className="sub">Fetch each site's Ahrefs Domain Rating (free API)</div>
        </div>
      </div>

      {writeStatus === 'writing' && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 16px', fontSize: 12, color: 'var(--text-faint)' }}>
          Writing Domain Rating back into the sheet…
        </div>
      )}
      {writeStatus === 'done' && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 16px', fontSize: 12, color: '#4ade80' }}>
          ✓ Domain Rating written to the sheet.
        </div>
      )}
      {writeStatus?.error && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 16px', fontSize: 12, color: '#f87171' }}>
          Ratings were fetched, but writing back to the sheet failed: {writeStatus.error}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, padding: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[{ id: 'paste', label: 'Paste domains' }, { id: 'sheet', label: 'Load from Google Sheet' }].map(t => (
            <button key={t.id} onClick={() => { setMode(t.id); setResults([]); setWriteStatus(null) }}
              style={{ fontSize: 12, padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontWeight: mode === t.id ? 700 : 400,
                background: mode === t.id ? 'var(--accent)' : 'transparent',
                color: mode === t.id ? 'var(--accent-ink)' : 'var(--text-faint)' }}>
              {t.label}
            </button>
          ))}
        </div>

        {mode === 'paste' ? (
          <>
            <textarea
              className="input"
              placeholder={'One domain per line (or comma-separated)\ne.g.\nexample.com\nanother-site.com'}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={6}
              style={{ fontSize: 13, width: '100%', resize: 'vertical', fontFamily: 'var(--font-mono, monospace)' }}
            />
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
              {domains.length ? `${domains.length} unique domain${domains.length === 1 ? '' : 's'} detected` : 'Paste a list of domains above'}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                placeholder="Paste Google Sheet URL…"
                value={sheetUrl}
                onChange={e => setSheetUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLoadSheet()}
                style={{ flex: 1, fontSize: 13 }}
              />
              <button className="btn" onClick={handleLoadSheet} disabled={!sheetUrl.trim() || sheetBusy}
                style={{ whiteSpace: 'nowrap' }}>
                {sheetBusy ? 'Loading…' : 'Load Sheet'}
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-faint)' }}>
              Reads a "Domain" column (first column if none is named that). On Check, a
              "Domain Rating" column is written back — appended at the end the first time,
              reused on later runs.
            </div>

            {sheetErr && <div style={{ marginTop: 10, fontSize: 12, color: '#f87171' }}>{sheetErr}</div>}

            {tabs.length > 1 && (
              <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>Tab:</span>
                <select className="input" value={selTab} onChange={e => handleTabChange(e.target.value)} style={{ fontSize: 13 }}>
                  <option value="">— select a tab —</option>
                  {tabs.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            )}

            {sheetRows.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 13, color: '#4ade80' }}>
                ✓ {sheetRows.length} rows loaded ({domains.length} unique domains)
              </div>
            )}
          </>
        )}

        <button className="btn" onClick={handleCheck} disabled={!domains.length || running}
          style={{ marginTop: 16, width: '100%' }}>
          {running ? `Checking… ${progress.done}/${progress.total}` : `Check Domain Rating${domains.length ? ` (${domains.length})` : ''}`}
        </button>

        {running && (
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${pct}%`, transition: 'width .3s' }} />
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="card">
          <div className="card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h3>Results</h3>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                {okCount} fetched{errCount > 0 ? ` · ${errCount} failed` : ''}
              </div>
            </div>
            <button className="btn ghost" onClick={() => downloadCSV(results)} style={{ fontSize: 12 }}>
              Download CSV
            </button>
          </div>
          <div className="card-pad" style={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '8px 16px' }}>Domain</th>
                  <th style={{ padding: '8px 16px' }}>Domain Rating</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono, monospace)' }}>{r.domain}</td>
                    <td style={{ padding: '8px 16px' }}>
                      {r.error
                        ? <span style={{ color: '#f87171' }}>{r.error}</span>
                        : <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{r.domainRating ?? '—'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>
        Domain Rating by <a href="https://ahrefs.com/" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>Ahrefs</a>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Icon } from '../data.jsx'
import {
  NICHE_CATEGORIES, extractSheetId, getSheetTabs, addSheetTab,
  cleanDomain, lookupPublisherDataFull, batchFormatSheet,
} from '../lib/sheetParserAPI.js'

function parseDomains(text) {
  return [...new Set(text.split(/\r?\n/).map(cleanDomain).filter(d => d && d.includes('.')))]
}

function parseCellRef(ref) {
  const m = String(ref || '').trim().toUpperCase().match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { colIndex: col - 1, rowIndex: parseInt(m[2], 10) - 1 }
}

const HEADER_DARK = { red: 0.11, green: 0.11, blue: 0.15 }
const WHITE = { red: 1, green: 1, blue: 1 }
const DISCOUNT_GREEN = { red: 0.129, green: 0.435, blue: 0.259 }
const OLD_PRICE_GRAY = { red: 0.55, green: 0.55, blue: 0.58 }
const BAND_FIRST = { red: 1, green: 1, blue: 1 }
const BAND_SECOND = { red: 0.965, green: 0.969, blue: 0.976 }
const GRID_BORDER = { red: 0.85, green: 0.85, blue: 0.87 }
const HEADER_DARK_CSS = 'rgb(28, 28, 38)'

function fmtMoney(n) { return Number(n.toFixed(2)) }
function fmtMoneyStr(n) { return n.toFixed(2) }

// A single cell holding both prices as one rich-text string — the struck-through original
// followed by the discounted price in bold green — instead of two separate columns, so the
// sheet stays one column per niche no matter what.
function discountRichText(oldPrice, newPrice) {
  const oldStr = fmtMoneyStr(oldPrice)
  const newStr = fmtMoneyStr(newPrice)
  const sep = '  →  '
  return {
    userEnteredValue: { stringValue: `${oldStr}${sep}${newStr}` },
    textFormatRuns: [
      { startIndex: 0, format: { strikethrough: true, foregroundColor: OLD_PRICE_GRAY } },
      { startIndex: oldStr.length + sep.length, format: { bold: true, foregroundColor: DISCOUNT_GREEN, strikethrough: false } },
    ],
  }
}

export function LiveChatPriceFinder() {
  const [domainsText, setDomainsText] = useState('')
  const [selectedNiches, setSelectedNiches] = useState(() => new Set())
  const [discountPct, setDiscountPct] = useState('')

  const [sheetUrl, setSheetUrl] = useState('')
  const [sheetId, setSheetId] = useState(null)
  const [tabs, setTabs] = useState([])
  const [tabsLoading, setTabsLoading] = useState(false)
  const [tabsError, setTabsError] = useState('')
  const [tabName, setTabName] = useState('')
  const [newTabName, setNewTabName] = useState('')
  const [startCell, setStartCell] = useState('A1')

  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [results, setResults] = useState(null) // [{ domain, prices: { [nicheKey]: number|null } }]

  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [writeDone, setWriteDone] = useState(0)

  // Auto-suggest tabs as soon as the pasted URL resolves — same pattern as Sheet Sync.
  useEffect(() => {
    const id = extractSheetId(sheetUrl.trim())
    setSheetId(id)
    setTabs([])
    setTabName('')
    setTabsError('')
    if (!id) return
    let cancelled = false
    setTabsLoading(true)
    getSheetTabs(id)
      .then(result => { if (!cancelled) { setTabs(result); if (result.length) setTabName(result[0].name) } })
      .catch(err => { if (!cancelled) setTabsError(err.message) })
      .finally(() => { if (!cancelled) setTabsLoading(false) })
    return () => { cancelled = true }
  }, [sheetUrl])

  function toggleNiche(key) {
    setSelectedNiches(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const domains = parseDomains(domainsText)
  const activeNiches = NICHE_CATEGORIES.filter(n => selectedNiches.has(n.key))
  const discount = parseFloat(discountPct)
  const hasDiscount = !isNaN(discount) && discount > 0
  const canFetch = domains.length > 0 && activeNiches.length > 0 && !fetching
  const targetTab = newTabName.trim() || tabName
  const canWrite = !!results?.length && !!sheetId && !!targetTab && !writing

  async function fetchPrices() {
    if (!canFetch) return
    setFetching(true)
    setFetchError('')
    setResults(null)
    setWriteDone(0)
    setWriteError('')
    try {
      const gplMap = await lookupPublisherDataFull(domains, () => {})
      const rows = domains.map(domain => {
        const vendor = gplMap.get(domain)?.vendor || null
        const prices = {}
        for (const n of activeNiches) {
          const addon = vendor?.addonsByLabel.get(n.gplLabel)
          prices[n.key] = addon?.buyerPrice ?? null
        }
        return { domain, prices }
      })
      setResults(rows)
    } catch (err) {
      setFetchError(err.message)
    } finally {
      setFetching(false)
    }
  }

  async function writeToSheet() {
    if (!canWrite) return
    const cell = parseCellRef(startCell)
    if (!cell) { setWriteError('Enter a valid start cell, e.g. A1'); return }

    setWriting(true)
    setWriteError('')
    try {
      const existing = tabs.find(t => t.name === targetTab)
      const realSheetId = existing ? existing.sheetId : await addSheetTab(sheetId, targetTab)

      const cellData = (value, extra) => ({
        userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value) },
        ...extra,
      })
      const headerFmt = { userEnteredFormat: { textFormat: { bold: true, fontSize: 10, foregroundColor: WHITE }, backgroundColor: HEADER_DARK, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }
      const bodyAlign = { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }
      const domainAlign = { userEnteredFormat: { horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE' } }

      const numCols = 1 + activeNiches.length
      const numRows = 1 + results.length

      const headerRow = {
        values: [
          cellData('Domain', headerFmt),
          ...activeNiches.map(n => cellData(`${n.label} Price`, headerFmt)),
        ],
      }
      const dataRows = results.map(r => ({
        values: [
          cellData(r.domain, domainAlign),
          ...activeNiches.map(n => {
            const price = r.prices[n.key]
            if (price == null) return cellData('—', bodyAlign)
            if (!hasDiscount) return cellData(fmtMoney(price), bodyAlign)
            const rich = discountRichText(price, price * (1 - discount / 100))
            return { ...rich, userEnteredFormat: bodyAlign.userEnteredFormat }
          }),
        ],
      }))

      const start = { sheetId: realSheetId, rowIndex: cell.rowIndex, columnIndex: cell.colIndex }
      const range = (r0, r1, c0, c1) => ({ sheetId: realSheetId, startRowIndex: cell.rowIndex + r0, endRowIndex: cell.rowIndex + r1, startColumnIndex: cell.colIndex + c0, endColumnIndex: cell.colIndex + c1 })
      const border = { style: 'SOLID', color: GRID_BORDER }

      await batchFormatSheet(sheetId, [
        { updateCells: { rows: [headerRow, ...dataRows], start, fields: 'userEnteredValue,userEnteredFormat,textFormatRuns' } },
        { updateDimensionProperties: { range: { sheetId: realSheetId, dimension: 'COLUMNS', startIndex: cell.colIndex, endIndex: cell.colIndex + 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: realSheetId, dimension: 'COLUMNS', startIndex: cell.colIndex + 1, endIndex: cell.colIndex + numCols }, properties: { pixelSize: hasDiscount ? 180 : 130 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: realSheetId, dimension: 'ROWS', startIndex: cell.rowIndex, endIndex: cell.rowIndex + 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
        { updateBorders: {
          range: range(0, numRows, 0, numCols),
          top: border, bottom: border, left: border, right: border, innerHorizontal: border, innerVertical: border,
        } },
        { addBanding: { bandedRange: {
          range: range(1, numRows, 0, numCols),
          rowProperties: { firstBandColor: BAND_FIRST, secondBandColor: BAND_SECOND },
        } } },
        { updateSheetProperties: {
          properties: { sheetId: realSheetId, gridProperties: { frozenRowCount: cell.rowIndex + 1, frozenColumnCount: cell.colIndex + 1 } },
          fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
        } },
      ])

      setWriteDone(results.length)
    } catch (err) {
      setWriteError(err.message)
    } finally {
      setWriting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
        Paste a list of sites, pick which niches you need pricing for, and optionally apply a flat
        discount % across the board. Prices come from each site's current active vendor on GPL.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>
            Sites · {domains.length > 0 ? `${domains.length} detected` : 'one per line'}
          </label>
          <textarea
            className="input"
            placeholder={'example.com\nanotherdomain.com'}
            value={domainsText}
            onChange={e => setDomainsText(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical', minHeight: 120, width: '100%', lineHeight: 1.6 }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>Niches to include</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {NICHE_CATEGORIES.map(n => {
                const on = selectedNiches.has(n.key)
                return (
                  <button key={n.key} onClick={() => toggleNiche(n.key)} style={{
                    fontSize: 12, padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
                    background: on ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                    color: on ? 'var(--accent)' : 'var(--text-dim)', fontWeight: on ? 700 : 400,
                  }}>
                    {n.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>Discount % (optional)</label>
            <input className="input" type="number" min="0" max="100" placeholder="e.g. 10"
                   value={discountPct} onChange={e => setDiscountPct(e.target.value)}
                   style={{ width: 140, fontSize: 13 }} />
          </div>
        </div>
      </div>

      <div>
        <button className="btn accent" onClick={fetchPrices} disabled={!canFetch}>
          {fetching ? 'Fetching…' : <><Icon name="zap" size={12} /> Fetch Prices</>}
        </button>
      </div>

      {fetchError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{fetchError}</div>
      )}

      {results && (
        <>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: HEADER_DARK_CSS }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Site</th>
                  {activeNiches.map(n => (
                    <th key={n.key} style={{ padding: '10px 16px', textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{n.label} Price</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.domain} style={{ background: i % 2 === 1 ? 'var(--surface-2, rgba(0,0,0,.02))' : 'transparent' }}>
                    <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontWeight: 600, borderTop: '1px solid var(--border)' }}>{r.domain}</td>
                    {activeNiches.map(n => {
                      const price = r.prices[n.key]
                      if (price == null) return (
                        <td key={n.key} style={{ padding: '8px 16px', textAlign: 'center', color: 'var(--text-ghost)', borderTop: '1px solid var(--border)' }}>—</td>
                      )
                      if (!hasDiscount) return (
                        <td key={n.key} style={{ padding: '8px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', borderTop: '1px solid var(--border)' }}>${fmtMoney(price)}</td>
                      )
                      const discounted = price * (1 - discount / 100)
                      return (
                        <td key={n.key} style={{ padding: '8px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', borderTop: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          <span style={{ textDecoration: 'line-through', color: 'var(--text-ghost)' }}>${fmtMoney(price)}</span>
                          <span style={{ color: 'var(--text-ghost)' }}>  →  </span>
                          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>${fmtMoney(discounted)}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.9fr 0.9fr', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>Sheet URL (editor access)</label>
              <input className="input" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." style={{ fontFamily: 'var(--font-mono)', fontSize: 12, width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>Tab</label>
              <select className="input" value={tabName} onChange={e => { setTabName(e.target.value); setNewTabName('') }} disabled={!tabs.length} style={{ fontSize: 13, width: '100%' }}>
                {tabsLoading && <option>Loading…</option>}
                {!tabsLoading && !tabs.length && <option>Paste a sheet URL first</option>}
                {tabs.map(t => <option key={t.sheetId} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>or new tab</label>
              <input className="input" value={newTabName} onChange={e => setNewTabName(e.target.value)} placeholder="New tab name" style={{ fontSize: 13, width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }}>Start cell</label>
              <input className="input" value={startCell} onChange={e => setStartCell(e.target.value.toUpperCase())} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: '100%', textAlign: 'center' }} />
            </div>
          </div>

          {tabsError && (
            <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{tabsError}</div>
          )}
          {writeError && (
            <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{writeError}</div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn accent" onClick={writeToSheet} disabled={!canWrite}>
              {writing ? 'Writing…' : <><Icon name="upload" size={12} /> Write {results.length} Row{results.length !== 1 ? 's' : ''} to Sheet</>}
            </button>
            {writeDone > 0 && !writing && <span style={{ fontSize: 12, color: 'var(--accent)' }}>✓ {writeDone} rows written</span>}
            {sheetUrl && <a href={sheetUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', marginLeft: 'auto' }}>↗ Open Sheet</a>}
          </div>
        </>
      )}
    </div>
  )
}

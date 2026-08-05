import { useState, useEffect, useRef, useMemo } from 'react'
import { Icon } from '../data.jsx'
import { loadPriceTable } from '../lib/supabase.js'
import { SheetParser } from './SheetParser.jsx'
import { AnchorSync } from './AnchorSync.jsx'
import { LiveChatClients } from './LiveChat.jsx'
import { EmailChecker } from './EmailChecker.jsx'
import { EmailHarvester } from './EmailHarvester.jsx'

// ─── shared helpers ────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }
function mkFwdRow() { return { id: uid(), admin: '', buyer: null, reseller: null, notFound: false } }
function mkRevRow() { return { id: uid(), input: '', admins: null, notFound: false } }

// sel stores anchor (ar,ac) + cursor (cr,cc) separately so Shift+Arrow always
// extends from the anchor, never collapses it
function normSel(s) {
  if (!s) return null
  return { r1: Math.min(s.ar, s.cr), r2: Math.max(s.ar, s.cr), c1: Math.min(s.ac, s.cc), c2: Math.max(s.ac, s.cc) }
}
function inSel(sel, r, c) {
  if (!sel) return false
  const n = normSel(sel)
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2
}
// The cursor cell gets a stronger highlight so user can see where keyboard focus is
function isCursor(sel, r, c) { return sel && sel.cr === r && sel.cc === c }

const TH = { padding: '8px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }
const MONO = { fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }
const INPUT_STYLE = { width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: '7px 12px', ...MONO, color: 'var(--text)', height: 36, boxSizing: 'border-box', userSelect: 'auto' }
const SEL_BG    = 'color-mix(in srgb, var(--accent) 14%, transparent)'
const CURSOR_BG = 'color-mix(in srgb, var(--accent) 28%, transparent)'

// ─── useGridSelection ──────────────────────────────────────────────────────────

function useGridSelection(rows, getCellText) {
  const [sel, setSel] = useState(null)
  const dragging = useRef(false)
  const containerRef = useRef(null)
  const getCellTextRef = useRef(getCellText)
  useEffect(() => { getCellTextRef.current = getCellText })
  const rowsRef = useRef(rows)
  useEffect(() => { rowsRef.current = rows })

  function getCellPos(e) {
    const el = e.target.closest('[data-cr]')
    if (!el) return null
    const [r, c] = el.getAttribute('data-cr').split(',').map(Number)
    return { r, c }
  }

  function onMouseDown(e) {
    const pos = getCellPos(e)
    if (!pos) { setSel(null); return }
    if (e.shiftKey && sel) {
      setSel({ ar: sel.ar, ac: sel.ac, cr: pos.r, cc: pos.c })
    } else {
      dragging.current = true
      setSel({ ar: pos.r, ac: pos.c, cr: pos.r, cc: pos.c })
    }
    if (e.target.tagName !== 'INPUT') {
      e.preventDefault()
      containerRef.current?.focus()
    }
  }

  function onMouseMove(e) {
    if (!dragging.current) return
    const pos = getCellPos(e)
    if (pos) setSel(prev => prev ? { ar: prev.ar, ac: prev.ac, cr: pos.r, cc: pos.c } : null)
  }

  useEffect(() => {
    function onUp() { dragging.current = false }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // Move cursor; returns new {r,c} or null if key is not a navigation key
  // ctrlDownTarget: override for Ctrl+Down destination (smart "last data row" behaviour)
  function navigate(fromR, fromC, key, shiftKey, ctrlKey, numCols, numRows, ctrlDownTarget) {
    const isEnterOrTab = key === 'Enter' || key === 'Tab'
    const dr = (key === 'ArrowDown' || isEnterOrTab) ? 1 : key === 'ArrowUp' ? -1 : 0
    const dc = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
    if (dr === 0 && dc === 0) return null

    let newR = fromR, newC = fromC
    if (ctrlKey) {
      if (dr > 0) newR = ctrlDownTarget ?? numRows - 1
      else if (dr < 0) newR = 0
      if (dc !== 0) newC = dc > 0 ? numCols - 1 : 0
    } else {
      newR = Math.max(0, Math.min(numRows - 1, fromR + dr))
      newC = Math.max(0, Math.min(numCols - 1, fromC + dc))
    }

    if (shiftKey) {
      setSel(prev => {
        const a = prev ? { r: prev.ar, c: prev.ac } : { r: fromR, c: fromC }
        return { ar: a.r, ac: a.c, cr: newR, cc: newC }
      })
    } else {
      setSel({ ar: newR, ac: newC, cr: newR, cc: newC })
    }
    return { r: newR, c: newC }
  }

  function buildTSV(currentSel) {
    const n = normSel(currentSel)
    if (!n) return ''
    const lines = []
    for (let r = n.r1; r <= n.r2; r++) {
      const cells = []
      for (let c = n.c1; c <= n.c2; c++) cells.push(getCellTextRef.current(rowsRef.current, r, c))
      lines.push(cells.join('\t'))
    }
    return lines.join('\n')
  }

  return { sel, setSel, containerRef, onMouseDown, onMouseMove, navigate, buildTSV }
}

// ─── scroll cursor row into view ───────────────────────────────────────────────

function scrollRowIntoView(gridRef, rowIdx) {
  const rows = gridRef.current?.querySelectorAll('[data-row-idx]')
  rows?.[rowIdx]?.scrollIntoView?.({ block: 'nearest' })
}

// ─── Forward grid (Admin → Buyer, Reseller) ────────────────────────────────────

const FWD_COLS = 3

// ─── Currency Converter ────────────────────────────────────────────────────────

const CURRENCIES = ['AFN','ALL','DZD','AOA','ARS','AMD','AWG','AUD','AZN','BSD','BHD','BDT','BBD','BYR','BZD','BMD','BTN','BOB','BAM','BWP','BRL','GBP','BND','BGN','BIF','KHR','CAD','CVE','KYD','GQE','XAF','XPF','CLP','CNY','COP','KMF','CDF','CRC','HRK','CUC','CZK','DKK','DJF','DOP','XCD','EGP','ERN','EEK','ETB','EUR','FKP','FJD','GMD','GEL','GHS','GIP','GTQ','GNF','GYD','HTG','HNL','HKD','HUF','ISK','INR','IDR','IRR','IQD','ILS','JMD','JPY','JOD','KZT','KES','KWD','KGS','LAK','LVL','LBP','LSL','LRD','LYD','LTL','MOP','MKD','MGA','MWK','MYR','MVR','MRO','MUR','MXN','MDL','MNT','MAD','MZM','MMK','NAD','NPR','ANG','TWD','NZD','NIO','NGN','KPW','NOK','OMR','PKR','PAB','PGK','PYG','PEN','PHP','PLN','QAR','RON','RUB','SHP','WST','SAR','RSD','SCR','SLL','SGD','SBD','SOS','ZAR','KRW','XDR','LKR','SDG','SRD','SZL','SEK','CHF','SYP','TJS','TZS','THB','TTD','TND','TRY','TMT','AED','UGX','UAH','USD','UYU','UZS','VUV','VEB','VND','XOF','YER','ZMK','ZWR','USDT']

const CURRENCY_NAMES = {
  AFN:'Afghan Afghani',ALL:'Albanian Lek',DZD:'Algerian Dinar',AOA:'Angolan Kwanza',ARS:'Argentine Peso',AMD:'Armenian Dram',AWG:'Aruban Florin',AUD:'Australian Dollar',AZN:'Azerbaijani Manat',BSD:'Bahamian Dollar',BHD:'Bahraini Dinar',BDT:'Bangladeshi Taka',BBD:'Barbadian Dollar',BYR:'Belarusian Ruble',BZD:'Belize Dollar',BMD:'Bermudian Dollar',BTN:'Bhutanese Ngultrum',BOB:'Bolivian Boliviano',BAM:'Bosnia-Herzegovina Mark',BWP:'Botswana Pula',BRL:'Brazilian Real',GBP:'British Pound Sterling',BND:'Brunei Dollar',BGN:'Bulgarian Lev',BIF:'Burundian Franc',KHR:'Cambodian Riel',CAD:'Canadian Dollar',CVE:'Cape Verdean Escudo',KYD:'Cayman Islands Dollar',GQE:'Equatorial Guinean Ekwele',XAF:'Central African CFA Franc',XPF:'CFP Franc',CLP:'Chilean Peso',CNY:'Chinese Yuan',COP:'Colombian Peso',KMF:'Comorian Franc',CDF:'Congolese Franc',CRC:'Costa Rican Colón',HRK:'Croatian Kuna',CUC:'Cuban Convertible Peso',CZK:'Czech Koruna',DKK:'Danish Krone',DJF:'Djiboutian Franc',DOP:'Dominican Peso',XCD:'East Caribbean Dollar',EGP:'Egyptian Pound',ERN:'Eritrean Nakfa',EEK:'Estonian Kroon',ETB:'Ethiopian Birr',EUR:'Euro',FKP:'Falkland Islands Pound',FJD:'Fijian Dollar',GMD:'Gambian Dalasi',GEL:'Georgian Lari',GHS:'Ghanaian Cedi',GIP:'Gibraltar Pound',GTQ:'Guatemalan Quetzal',GNF:'Guinean Franc',GYD:'Guyanese Dollar',HTG:'Haitian Gourde',HNL:'Honduran Lempira',HKD:'Hong Kong Dollar',HUF:'Hungarian Forint',ISK:'Icelandic Króna',INR:'Indian Rupee',IDR:'Indonesian Rupiah',IRR:'Iranian Rial',IQD:'Iraqi Dinar',ILS:'Israeli New Shekel',JMD:'Jamaican Dollar',JPY:'Japanese Yen',JOD:'Jordanian Dinar',KZT:'Kazakhstani Tenge',KES:'Kenyan Shilling',KWD:'Kuwaiti Dinar',KGS:'Kyrgyzstani Som',LAK:'Laotian Kip',LVL:'Latvian Lats',LBP:'Lebanese Pound',LSL:'Lesotho Loti',LRD:'Liberian Dollar',LYD:'Libyan Dinar',LTL:'Lithuanian Litas',MOP:'Macanese Pataca',MKD:'Macedonian Denar',MGA:'Malagasy Ariary',MWK:'Malawian Kwacha',MYR:'Malaysian Ringgit',MVR:'Maldivian Rufiyaa',MRO:'Mauritanian Ouguiya',MUR:'Mauritian Rupee',MXN:'Mexican Peso',MDL:'Moldovan Leu',MNT:'Mongolian Tögrög',MAD:'Moroccan Dirham',MZM:'Mozambican Metical',MMK:'Myanmar Kyat',NAD:'Namibian Dollar',NPR:'Nepalese Rupee',ANG:'Netherlands Antillean Guilder',TWD:'New Taiwan Dollar',NZD:'New Zealand Dollar',NIO:'Nicaraguan Córdoba',NGN:'Nigerian Naira',KPW:'North Korean Won',NOK:'Norwegian Krone',OMR:'Omani Rial',PKR:'Pakistani Rupee',PAB:'Panamanian Balboa',PGK:'Papua New Guinean Kina',PYG:'Paraguayan Guaraní',PEN:'Peruvian Sol',PHP:'Philippine Peso',PLN:'Polish Zloty',QAR:'Qatari Riyal',RON:'Romanian Leu',RUB:'Russian Ruble',SHP:'Saint Helena Pound',WST:'Samoan Tala',SAR:'Saudi Riyal',RSD:'Serbian Dinar',SCR:'Seychellois Rupee',SLL:'Sierra Leonean Leone',SGD:'Singapore Dollar',SBD:'Solomon Islands Dollar',SOS:'Somali Shilling',ZAR:'South African Rand',KRW:'South Korean Won',XDR:'Special Drawing Rights',LKR:'Sri Lankan Rupee',SDG:'Sudanese Pound',SRD:'Surinamese Dollar',SZL:'Swazi Lilangeni',SEK:'Swedish Krona',CHF:'Swiss Franc',SYP:'Syrian Pound',TJS:'Tajikistani Somoni',TZS:'Tanzanian Shilling',THB:'Thai Baht',TTD:'Trinidad & Tobago Dollar',TND:'Tunisian Dinar',TRY:'Turkish Lira',TMT:'Turkmenistani Manat',AED:'UAE Dirham',UGX:'Ugandan Shilling',UAH:'Ukrainian Hryvnia',USD:'United States Dollar',UYU:'Uruguayan Peso',UZS:'Uzbekistani Som',VUV:'Vanuatu Vatu',VEB:'Venezuelan Bolívar',VND:'Vietnamese Dong',XOF:'West African CFA Franc',YER:'Yemeni Rial',ZMK:'Zambian Kwacha',ZWR:'Zimbabwean Dollar',USDT:'Tether (USD Stablecoin)',
}
const COMB_COLS = 6

function mkCombRow() { return { id: uid(), rate: '' } }

function computeCombRow(row, currency, pct, op, fxRates, priceMap) {
  const rate = parseFloat(row.rate)
  if (!row.rate.trim() || isNaN(rate)) return { adjRate: null, converted: null, postPrice: null, buyer: null, reseller: null, notFound: false }

  const p = parseFloat(pct)
  const pctMult = (!pct.trim() || isNaN(p)) ? 1 : (op === '+' ? 1 + p / 100 : 1 - p / 100)
  const adjRate = rate * pctMult

  let usdValue
  if (currency === 'USD') {
    usdValue = adjRate
  } else {
    const fxRate = fxRates?.[currency]
    if (!fxRate) return { adjRate, converted: null, postPrice: null, buyer: null, reseller: null, notFound: !!fxRates }
    usdValue = adjRate / fxRate
  }

  const converted = Math.round(usdValue * 100) / 100
  const markup = currency === 'EUR' ? 1.05 : currency === 'INR' ? 1.0 : 1.15
  const postPrice = Math.ceil(usdValue * (currency === 'USD' ? 1.0 : markup))

  const entry = priceMap.get(postPrice)
  if (!entry) return { adjRate, converted, postPrice, buyer: null, reseller: null, notFound: true }
  return { adjRate, converted, postPrice, buyer: Math.ceil(entry.buyer), reseller: Math.ceil(entry.reseller), notFound: false }
}

function ForwardGrid({ priceMap }) {
  const [rows, setRows] = useState(() => Array.from({ length: 12 }, mkFwdRow))
  const [copied, setCopied] = useState(false)
  const gridRef = useRef(null)

  function resolve(adminStr) {
    const n = Number(adminStr)
    if (!adminStr.trim() || isNaN(n)) return { buyer: null, reseller: null, notFound: false }
    const m = priceMap.get(n)
    return m ? { buyer: m.buyer, reseller: m.reseller, notFound: false } : { buyer: null, reseller: null, notFound: true }
  }

  function getCellText(rows, r, c) {
    const row = rows[r]; if (!row) return ''
    if (c === 0) return row.admin
    if (c === 1) return row.buyer != null ? row.buyer.toFixed(2) : ''
    if (c === 2) return row.reseller != null ? row.reseller.toFixed(2) : ''
    return ''
  }

  const { sel, setSel, containerRef, onMouseDown, onMouseMove, navigate, buildTSV } = useGridSelection(rows, getCellText)

  function ensureRow(idx) {
    if (idx >= rows.length) setRows(prev => [...prev, mkFwdRow()])
  }

  function focusInput(idx, delay = 10) {
    setTimeout(() => {
      gridRef.current?.querySelectorAll('input[data-row]')?.[idx]?.focus()
      scrollRowIntoView(gridRef, idx)
    }, delay)
  }

  function onContainerKeyDown(e) {
    // Copy
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && sel) {
      e.preventDefault()
      navigator.clipboard.writeText(buildTSV(sel)).catch(() => {})
      return
    }

    // Delete/Backspace: clear selected rows (skip when an input is focused)
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && e.target.tagName !== 'INPUT') {
      e.preventDefault()
      const n = normSel(sel)
      setRows(prev => prev.map((row, idx) =>
        idx >= n.r1 && idx <= n.r2 ? { ...row, admin: '', buyer: null, reseller: null, notFound: false } : row
      ))
      return
    }

    const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (!ARROWS.includes(e.key) || !sel) return
    e.preventDefault()

    const { cr, cc } = sel
    const ctrl = e.ctrlKey || e.metaKey

    // Smart Ctrl+Down: go to last data row; if already there, go to absolute end
    const lastFilledRow = rows.reduce((last, row, i) => row.admin.trim() ? i : last, -1)
    const ctrlDownTarget = lastFilledRow < 0 || cr >= lastFilledRow ? rows.length - 1 : lastFilledRow

    // Add row when arrowing down past the last row (non-shift, non-ctrl only)
    const addingRow = e.key === 'ArrowDown' && cr === rows.length - 1 && !e.shiftKey && !ctrl
    if (addingRow) setRows(prev => [...prev, mkFwdRow()])
    const effectiveRows = addingRow ? rows.length + 1 : rows.length

    const newPos = navigate(cr, cc, e.key, e.shiftKey, ctrl, FWD_COLS, effectiveRows, ctrlDownTarget)
    if (!newPos) return

    if (newPos.c === 0 && !e.shiftKey) {
      focusInput(newPos.r, addingRow ? 40 : 10)
    } else {
      scrollRowIntoView(gridRef, newPos.r)
    }
  }

  function onInputKeyDown(e, idx) {
    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === 'ArrowRight') {
      // Move to Buyer cell (col 1) — blur input, focus container
      e.preventDefault()
      setSel({ ar: idx, ac: 1, cr: idx, cc: 1 })
      containerRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      const isLast = idx === rows.length - 1
      if (isLast && !ctrl && !e.shiftKey) setRows(prev => [...prev, mkFwdRow()])
      const newR = e.shiftKey
        ? Math.max(0, idx - 1)
        : ctrl ? (e.key === 'ArrowDown' ? rows.length - 1 : 0)
        : idx + (isLast && !ctrl ? 0 : 1) // stay if last + ctrl jumps
      const target = e.shiftKey ? Math.max(0, idx - 1)
        : ctrl ? rows.length - 1
        : Math.min(idx + 1, (isLast ? rows.length : rows.length - 1))
      navigate(idx, 0, e.shiftKey ? 'ArrowUp' : 'ArrowDown', e.shiftKey, ctrl, FWD_COLS, isLast && !ctrl && !e.shiftKey ? rows.length + 1 : rows.length)
      focusInput(target, isLast && !ctrl && !e.shiftKey ? 40 : 10)
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      navigate(idx, 0, 'ArrowUp', e.shiftKey && e.key === 'ArrowUp', ctrl, FWD_COLS, rows.length)
      focusInput(Math.max(0, idx - 1))
      return
    }
    // ArrowLeft: let browser move text cursor within input
  }

  function setAdmin(id, val) {
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, admin: val, ...resolve(val) }))
  }
  function deleteRow(id) {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : [mkFwdRow()])
  }
  function addRow() { setRows(prev => [...prev, mkFwdRow()]) }

  function onPaste(e) {
    const target = e.target
    if (!target.hasAttribute('data-row')) return
    const text = e.clipboardData.getData('text')
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    const start = Number(target.getAttribute('data-row'))
    const newRows = lines.map(line => { const v = line.split(/\t/)[0].trim(); return { id: uid(), admin: v, ...resolve(v) } })
    setRows(prev => {
      const r = [...prev]
      newRows.forEach((row, i) => { if (start + i < r.length) r[start + i] = row; else r.push(row) })
      return r
    })
  }

  function copyAll() {
    const filled = rows.filter(r => r.admin.trim())
    if (!filled.length) return
    const text = ['Admin\tBuyer\tReseller', ...filled.map(r => `${r.admin}\t${r.buyer ?? ''}\t${r.reseller ?? ''}`)].join('\n')
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  function clearAll() { setRows(Array.from({ length: 12 }, mkFwdRow)); setSel(null) }

  const filledCount = rows.filter(r => r.buyer != null).length
  const notFoundCount = rows.filter(r => r.notFound).length

  function cellBg(r, c) {
    if (isCursor(sel, r, c)) return CURSOR_BG
    if (inSel(sel, r, c)) return SEL_BG
    return 'transparent'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-faint)', minHeight: 18 }}>
        {filledCount > 0 && <span style={{ color: 'var(--accent)' }}>{filledCount} matched</span>}
        {notFoundCount > 0 && <span style={{ color: '#f87171' }}>{notFoundCount} not found</span>}
        {sel && <span style={{ marginLeft: 'auto' }}>
          {(() => { const n = normSel(sel); return n && (n.r2 > n.r1 || n.c2 > n.c1) ? `${(n.r2-n.r1+1)}×${(n.c2-n.c1+1)} · ` : '' })()}
          Ctrl+C to copy
        </span>}
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', userSelect: 'none', outline: 'none' }}
        onPaste={onPaste}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onKeyDown={onContainerKeyDown}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 32px', background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
          {['#', 'Admin', 'Buyer', 'Reseller', ''].map((h, i) => (
            <div key={i} style={{ ...TH, textAlign: i === 0 ? 'center' : 'left' }}>{h}</div>
          ))}
        </div>

        <div ref={gridRef} style={{ maxHeight: 480, overflowY: 'auto' }}>
          {rows.map((row, idx) => (
            <div key={row.id} data-row-idx={idx} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 32px', borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none', background: idx % 2 ? 'rgba(255,255,255,.013)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-faint)', borderRight: '1px solid var(--border)' }}>
                {idx + 1}
              </div>

              <div data-cr={`${idx},0`} style={{ borderRight: '1px solid var(--border)', background: cellBg(idx, 0) }}>
                <input
                  data-row={idx}
                  type="number"
                  value={row.admin}
                  onChange={e => setAdmin(row.id, e.target.value)}
                  onKeyDown={e => onInputKeyDown(e, idx)}
                  onFocus={() => setSel({ ar: idx, ac: 0, cr: idx, cc: 0 })}
                  placeholder={idx === 0 ? 'Enter or paste column…' : ''}
                  style={INPUT_STYLE}
                />
              </div>

              <div data-cr={`${idx},1`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, borderRight: '1px solid var(--border)', color: row.buyer != null ? 'var(--accent)' : row.notFound ? '#f87171' : 'var(--text-faint)', background: cellBg(idx, 1) }}>
                {row.buyer != null ? row.buyer.toFixed(2) : row.notFound ? '—' : ''}
              </div>

              <div data-cr={`${idx},2`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, color: row.reseller != null ? 'var(--text)' : row.notFound ? '#f87171' : 'var(--text-faint)', background: cellBg(idx, 2) }}>
                {row.reseller != null ? row.reseller.toFixed(2) : row.notFound ? '—' : ''}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {row.admin.trim() && (
                  <button onClick={() => deleteRow(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: '4px 6px', borderRadius: 4, display: 'flex', lineHeight: 1 }}>
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost" onClick={addRow} style={{ fontSize: 12, height: 30 }}><Icon name="plus" size={13} /> Add Row</button>
        <button className="btn ghost" onClick={copyAll} style={{ fontSize: 12, height: 30, ...(copied ? { color: 'var(--accent)' } : {}) }}>
          <Icon name="copy" size={13} /> {copied ? 'Copied!' : 'Copy All'}
        </button>
        <button className="btn ghost" onClick={clearAll} style={{ fontSize: 12, height: 30, marginLeft: 'auto', color: 'var(--text-faint)' }}>Clear</button>
      </div>
    </div>
  )
}

// ─── Reverse grid (Buyer/Reseller → Admin) ─────────────────────────────────────

const REV_COLS = 2

function ReverseGrid({ reverseMap, inputLabel }) {
  const [rows, setRows] = useState(() => Array.from({ length: 12 }, mkRevRow))
  const [copied, setCopied] = useState(false)
  const gridRef = useRef(null)

  function resolve(val) {
    const n = parseFloat(val)
    if (!val.trim() || isNaN(n)) return { admins: null, notFound: false }
    const m = reverseMap.get(n)
    return m ? { admins: [...m].sort((a, b) => a - b), notFound: false } : { admins: null, notFound: true }
  }

  function getCellText(rows, r, c) {
    const row = rows[r]; if (!row) return ''
    if (c === 0) return row.input
    if (c === 1) return row.admins ? row.admins.join(', ') : ''
    return ''
  }

  const { sel, setSel, containerRef, onMouseDown, onMouseMove, navigate, buildTSV } = useGridSelection(rows, getCellText)

  function focusInput(idx, delay = 10) {
    setTimeout(() => {
      gridRef.current?.querySelectorAll('input[data-row]')?.[idx]?.focus()
      scrollRowIntoView(gridRef, idx)
    }, delay)
  }

  function onContainerKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && sel) {
      e.preventDefault()
      navigator.clipboard.writeText(buildTSV(sel)).catch(() => {})
      return
    }

    // Delete/Backspace: clear selected rows (skip when an input is focused)
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && e.target.tagName !== 'INPUT') {
      e.preventDefault()
      const n = normSel(sel)
      setRows(prev => prev.map((row, idx) =>
        idx >= n.r1 && idx <= n.r2 ? { ...row, input: '', admins: null, notFound: false } : row
      ))
      return
    }

    const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (!ARROWS.includes(e.key) || !sel) return
    e.preventDefault()

    const { cr, cc } = sel
    const ctrl = e.ctrlKey || e.metaKey

    // Smart Ctrl+Down: go to last data row; if already there, go to absolute end
    const lastFilledRow = rows.reduce((last, row, i) => row.input.trim() ? i : last, -1)
    const ctrlDownTarget = lastFilledRow < 0 || cr >= lastFilledRow ? rows.length - 1 : lastFilledRow

    const addingRow = e.key === 'ArrowDown' && cr === rows.length - 1 && !e.shiftKey && !ctrl
    if (addingRow) setRows(prev => [...prev, mkRevRow()])
    const effectiveRows = addingRow ? rows.length + 1 : rows.length

    const newPos = navigate(cr, cc, e.key, e.shiftKey, ctrl, REV_COLS, effectiveRows, ctrlDownTarget)
    if (!newPos) return

    if (newPos.c === 0 && !e.shiftKey) {
      focusInput(newPos.r, addingRow ? 40 : 10)
    } else {
      scrollRowIntoView(gridRef, newPos.r)
    }
  }

  function onInputKeyDown(e, idx) {
    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setSel({ ar: idx, ac: 1, cr: idx, cc: 1 })
      containerRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      const isLast = idx === rows.length - 1
      if (isLast && !ctrl && !e.shiftKey) setRows(prev => [...prev, mkRevRow()])
      const target = e.shiftKey ? Math.max(0, idx - 1)
        : ctrl ? rows.length - 1
        : Math.min(idx + 1, (isLast ? rows.length : rows.length - 1))
      navigate(idx, 0, e.shiftKey ? 'ArrowUp' : 'ArrowDown', false, ctrl, REV_COLS, isLast && !ctrl && !e.shiftKey ? rows.length + 1 : rows.length)
      focusInput(target, isLast && !ctrl && !e.shiftKey ? 40 : 10)
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      navigate(idx, 0, 'ArrowUp', false, ctrl, REV_COLS, rows.length)
      focusInput(Math.max(0, idx - 1))
    }
  }

  function setInput(id, val) {
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, input: val, ...resolve(val) }))
  }
  function deleteRow(id) {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : [mkRevRow()])
  }
  function addRow() { setRows(prev => [...prev, mkRevRow()]) }

  function onPaste(e) {
    const target = e.target
    if (!target.hasAttribute('data-row')) return
    const text = e.clipboardData.getData('text')
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    const start = Number(target.getAttribute('data-row'))
    const newRows = lines.map(line => { const v = line.split(/\t/)[0].trim(); return { id: uid(), input: v, ...resolve(v) } })
    setRows(prev => {
      const r = [...prev]
      newRows.forEach((row, i) => { if (start + i < r.length) r[start + i] = row; else r.push(row) })
      return r
    })
  }

  function copyAll() {
    const filled = rows.filter(r => r.input.trim())
    if (!filled.length) return
    const text = [`${inputLabel}\tAdmin Price(s)`, ...filled.map(r => `${r.input}\t${r.admins ? r.admins.join(', ') : ''}`)].join('\n')
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  function clearAll() { setRows(Array.from({ length: 12 }, mkRevRow)); setSel(null) }

  const matchedCount = rows.filter(r => r.admins != null).length
  const notFoundCount = rows.filter(r => r.notFound).length

  function cellBg(r, c) {
    if (isCursor(sel, r, c)) return CURSOR_BG
    if (inSel(sel, r, c)) return SEL_BG
    return 'transparent'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-faint)', minHeight: 18 }}>
        {matchedCount > 0 && <span style={{ color: 'var(--accent)' }}>{matchedCount} matched</span>}
        {notFoundCount > 0 && <span style={{ color: '#f87171' }}>{notFoundCount} not found</span>}
        {sel && <span style={{ marginLeft: 'auto' }}>
          {(() => { const n = normSel(sel); return n && (n.r2 > n.r1 || n.c2 > n.c1) ? `${(n.r2-n.r1+1)}×${(n.c2-n.c1+1)} · ` : '' })()}
          Ctrl+C to copy
        </span>}
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', userSelect: 'none', outline: 'none' }}
        onPaste={onPaste}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onKeyDown={onContainerKeyDown}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 32px', background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
          {['#', inputLabel, 'Admin Price(s)', ''].map((h, i) => (
            <div key={i} style={{ ...TH, textAlign: i === 0 ? 'center' : 'left' }}>{h}</div>
          ))}
        </div>

        <div ref={gridRef} style={{ maxHeight: 480, overflowY: 'auto' }}>
          {rows.map((row, idx) => (
            <div key={row.id} data-row-idx={idx} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 32px', borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none', background: idx % 2 ? 'rgba(255,255,255,.013)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-faint)', borderRight: '1px solid var(--border)' }}>
                {idx + 1}
              </div>

              <div data-cr={`${idx},0`} style={{ borderRight: '1px solid var(--border)', background: cellBg(idx, 0) }}>
                <input
                  data-row={idx}
                  type="number"
                  step="0.1"
                  value={row.input}
                  onChange={e => setInput(row.id, e.target.value)}
                  onKeyDown={e => onInputKeyDown(e, idx)}
                  onFocus={() => setSel({ ar: idx, ac: 0, cr: idx, cc: 0 })}
                  placeholder={idx === 0 ? 'Enter price or paste…' : ''}
                  style={INPUT_STYLE}
                />
              </div>

              <div data-cr={`${idx},1`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, color: row.admins ? 'var(--accent)' : row.notFound ? '#f87171' : 'var(--text-faint)', background: cellBg(idx, 1) }}>
                {row.admins ? row.admins.join(', ') : row.notFound ? '—' : ''}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {row.input.trim() && (
                  <button onClick={() => deleteRow(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: '4px 6px', borderRadius: 4, display: 'flex', lineHeight: 1 }}>
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost" onClick={addRow} style={{ fontSize: 12, height: 30 }}><Icon name="plus" size={13} /> Add Row</button>
        <button className="btn ghost" onClick={copyAll} style={{ fontSize: 12, height: 30, ...(copied ? { color: 'var(--accent)' } : {}) }}>
          <Icon name="copy" size={13} /> {copied ? 'Copied!' : 'Copy All'}
        </button>
        <button className="btn ghost" onClick={clearAll} style={{ fontSize: 12, height: 30, marginLeft: 'auto', color: 'var(--text-faint)' }}>Clear</button>
      </div>
    </div>
  )
}

// ─── Searchable currency picker ────────────────────────────────────────────────

function CurrencyDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef(null)
  const listRef = useRef(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return CURRENCIES.filter(c =>
      c.toLowerCase().includes(q) || (CURRENCY_NAMES[c] || '').toLowerCase().includes(q)
    )
  }, [search])

  useEffect(() => {
    if (!open) { setSearch(''); return }
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Scroll selected item into view when dropdown opens
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontFamily: 'var(--font-mono, monospace)', fontSize: 14, fontWeight: 700, minWidth: 90 }}
      >
        {value}
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,.4)', width: 280, overflow: 'hidden' }}>
          <div style={{ padding: '8px 8px 6px', borderBottom: '1px solid var(--border)' }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
              placeholder="Search by code or name…"
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', fontSize: 12, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div ref={listRef} style={{ maxHeight: 260, overflowY: 'auto' }}>
            {filtered.length === 0
              ? <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-faint)' }}>No match</div>
              : filtered.map(c => (
                <div
                  key={c}
                  data-selected={c === value}
                  onClick={() => { onChange(c); setOpen(false) }}
                  style={{ padding: '6px 14px', cursor: 'pointer', background: c === value ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent' }}
                >
                  <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, fontWeight: 600, color: c === value ? 'var(--accent)' : 'var(--text)' }}>{c}</div>
                  <div style={{ fontSize: 11, color: c === value ? 'var(--accent)' : 'var(--text-faint)', marginTop: 1 }}>{CURRENCY_NAMES[c] || ''}</div>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Combined Currency + Percentage Calculator ─────────────────────────────────

function CombinedCalc({ priceMap, fxRates, fxLoading, fxError, fxUpdatedAt, onRefreshRates }) {
  const [currency, setCurrency] = useState('EUR')
  const [pct, setPct] = useState('')
  const [op, setOp]   = useState('-')
  const [rows, setRows] = useState(() => Array.from({ length: 10 }, mkCombRow))
  const [copied, setCopied] = useState(false)
  const gridRef   = useRef(null)
  const inputRefs = useRef([])

  const computedRows = useMemo(
    () => rows.map(row => ({ ...row, ...computeCombRow(row, currency, pct, op, fxRates, priceMap) })),
    [rows, currency, pct, op, fxRates, priceMap]
  )

  function fmtNum(n) {
    if (n == null) return ''
    const r = Math.round(n * 100) / 100
    return r % 1 === 0 ? String(r) : r.toFixed(2)
  }

  function getCellText(rows, r, c) {
    const row = rows[r]; if (!row) return ''
    if (c === 0) return row.rate
    if (c === 1) return fmtNum(row.adjRate)
    if (c === 2) return row.converted != null ? String(row.converted) : ''
    if (c === 3) return row.postPrice != null ? String(row.postPrice) : ''
    if (c === 4) return row.buyer != null ? String(row.buyer) : ''
    if (c === 5) return row.reseller != null ? String(row.reseller) : ''
    return ''
  }

  const { sel, setSel, containerRef, onMouseDown, onMouseMove, navigate, buildTSV } = useGridSelection(computedRows, getCellText)

  function focusInput(idx, delay = 10) {
    setTimeout(() => { inputRefs.current[idx]?.focus(); scrollRowIntoView(gridRef, idx) }, delay)
  }

  function onContainerKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && sel) {
      e.preventDefault(); navigator.clipboard.writeText(buildTSV(sel)).catch(() => {}); return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && e.target.tagName !== 'INPUT') {
      e.preventDefault()
      const n = normSel(sel)
      setRows(prev => prev.map((row, idx) => idx >= n.r1 && idx <= n.r2 ? { ...row, rate: '' } : row))
      return
    }
    const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (!ARROWS.includes(e.key) || !sel) return
    e.preventDefault()

    const { cr, cc } = sel
    const ctrl = e.ctrlKey || e.metaKey
    const lastFilledRow = rows.reduce((last, row, i) => row.rate.trim() ? i : last, -1)
    const ctrlDownTarget = lastFilledRow < 0 || cr >= lastFilledRow ? rows.length - 1 : lastFilledRow
    const addingRow = e.key === 'ArrowDown' && cr === rows.length - 1 && !e.shiftKey && !ctrl
    if (addingRow) setRows(prev => [...prev, mkCombRow()])
    const effectiveRows = addingRow ? rows.length + 1 : rows.length

    const newPos = navigate(cr, cc, e.key, e.shiftKey, ctrl, COMB_COLS, effectiveRows, ctrlDownTarget)
    if (!newPos) return
    if (newPos.c === 0 && !e.shiftKey) focusInput(newPos.r, addingRow ? 40 : 10)
    else scrollRowIntoView(gridRef, newPos.r)
  }

  function onInputKeyDown(e, idx) {
    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === 'ArrowRight') {
      e.preventDefault(); setSel({ ar: idx, ac: 1, cr: idx, cc: 1 }); containerRef.current?.focus(); return
    }
    if (e.key === 'ArrowDown' || e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      const isLast = idx === rows.length - 1
      if (isLast && !ctrl) setRows(prev => [...prev, mkCombRow()])
      const target = ctrl ? rows.length - 1 : Math.min(idx + 1, isLast ? rows.length : rows.length - 1)
      navigate(idx, 0, 'ArrowDown', false, ctrl, COMB_COLS, isLast && !ctrl ? rows.length + 1 : rows.length)
      focusInput(target, isLast && !ctrl ? 40 : 10)
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      navigate(idx, 0, 'ArrowUp', false, ctrl, COMB_COLS, rows.length)
      focusInput(Math.max(0, idx - 1))
    }
  }

  function onPaste(e) {
    const target = e.target
    if (!target.hasAttribute('data-comb-row')) return
    const text = e.clipboardData.getData('text')
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    const start = Number(target.getAttribute('data-comb-row'))
    setRows(prev => {
      const r = [...prev]
      lines.forEach((line, i) => {
        const v = line.split(/\t/)[0].trim()
        const row = { id: uid(), rate: v }
        if (start + i < r.length) r[start + i] = row; else r.push(row)
      })
      return r
    })
  }

  function copyAll() {
    const filled = computedRows.filter(r => r.rate.trim())
    if (!filled.length) return
    const text = [`Rate (${currency})\tAfter ${op}${pct}%\tConverted (USD)\tPost Price\tBuyer\tReseller`,
      ...filled.map(r => `${r.rate}\t${fmtNum(r.adjRate)}\t${r.converted != null ? r.converted.toFixed(2) : ''}\t${r.postPrice ?? ''}\t${r.buyer ?? ''}\t${r.reseller ?? ''}`)
    ].join('\n')
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  function clearAll() { setRows(Array.from({ length: 10 }, mkCombRow)); setSel(null) }

  const convertedCount = computedRows.filter(r => r.postPrice != null).length
  const notFoundCount  = computedRows.filter(r => r.notFound).length

  function cellBg(r, c) {
    if (isCursor(sel, r, c)) return CURSOR_BG
    if (inSel(sel, r, c))   return SEL_BG
    return 'transparent'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Markup info */}
      <div style={{ fontSize: 12, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, lineHeight: 1.7, color: 'var(--text-faint)' }}>
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>+5%</span> markup for EUR &nbsp;·&nbsp;
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>+15%</span> for all other currencies &nbsp;·&nbsp;
        <span>no markup</span> for INR &amp; USD
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <CurrencyDropdown value={currency} onChange={setCurrency} />
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {/* % input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 7, padding: '0 12px', height: 34, background: 'var(--surface)' }}>
          <input
            type="number" value={pct} onChange={e => setPct(e.target.value)} min={0}
            style={{ width: 48, background: 'transparent', border: 'none', outline: 'none', fontFamily: 'var(--font-mono, monospace)', fontSize: 14, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}
          />
          <span style={{ color: 'var(--text-faint)', fontSize: 14, fontWeight: 600 }}>%</span>
        </div>

        {/* +/− toggle */}
        <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: 3, gap: 3 }}>
          {['+', '-'].map(o => (
            <button key={o} onClick={() => setOp(o)} style={{ height: 28, padding: '0 16px', borderRadius: 5, border: 'none', cursor: 'pointer', background: op === o ? 'var(--accent)' : 'transparent', color: op === o ? 'var(--accent-ink)' : 'var(--text-faint)', fontWeight: 700, fontSize: 18, lineHeight: 1 }}>
              {o}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        {fxLoading && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Fetching rates…</span>}
        {fxError   && <span style={{ fontSize: 12, color: '#f87171' }}>Rate fetch failed</span>}
        {!fxLoading && !fxError && fxUpdatedAt && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Rates {fxUpdatedAt}</span>}
        <button className="btn ghost" onClick={onRefreshRates} disabled={fxLoading} style={{ fontSize: 11, height: 28, padding: '0 8px' }}>
          <Icon name="refresh" size={12} /> Refresh
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 12 }}>
          {convertedCount > 0 && <span style={{ color: 'var(--accent)' }}>{convertedCount} converted</span>}
          {notFoundCount  > 0 && <span style={{ color: '#f87171' }}>{notFoundCount} not found</span>}
          {sel && <span style={{ color: 'var(--text-faint)' }}>
            {(() => { const n = normSel(sel); return n && (n.r2 > n.r1 || n.c2 > n.c1) ? `${n.r2-n.r1+1}×${n.c2-n.c1+1} · ` : '' })()}
            Ctrl+C to copy
          </span>}
        </div>
      </div>

      <div
        ref={containerRef} tabIndex={0}
        style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', userSelect: 'none', outline: 'none' }}
        onPaste={onPaste} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onKeyDown={onContainerKeyDown}
      >
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr 1fr 1fr 32px', background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
          {['#', `Rate (${currency})`, `After ${op}${pct || 0}%`, 'Converted (USD)', 'Post Price', 'Buyer', 'Reseller', ''].map((h, i) => (
            <div key={i} style={{ ...TH, textAlign: i === 0 ? 'center' : 'left' }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div ref={gridRef} style={{ maxHeight: 480, overflowY: 'auto' }}>
          {computedRows.map((row, idx) => (
            <div key={row.id} data-row-idx={idx} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr 1fr 1fr 32px', borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none', background: idx % 2 ? 'rgba(255,255,255,.013)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-faint)', borderRight: '1px solid var(--border)' }}>
                {idx + 1}
              </div>

              {/* Rate input */}
              <div data-cr={`${idx},0`} style={{ borderRight: '1px solid var(--border)', background: cellBg(idx, 0) }}>
                <input
                  ref={el => { inputRefs.current[idx] = el }}
                  data-comb-row={idx} type="number" value={row.rate}
                  onChange={e => setRows(prev => prev.map(r => r.id !== row.id ? r : { ...r, rate: e.target.value }))}
                  onKeyDown={e => onInputKeyDown(e, idx)}
                  onFocus={() => setSel({ ar: idx, ac: 0, cr: idx, cc: 0 })}
                  placeholder={idx === 0 ? 'Enter or paste…' : ''}
                  style={INPUT_STYLE}
                />
              </div>

              {/* Adjusted rate (after % op) */}
              <div data-cr={`${idx},1`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, borderRight: '1px solid var(--border)', color: row.adjRate != null ? 'var(--text)' : 'var(--text-faint)', background: cellBg(idx, 1) }}>
                {fmtNum(row.adjRate)}
              </div>

              {/* Raw USD */}
              <div data-cr={`${idx},2`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, borderRight: '1px solid var(--border)', color: 'var(--text-faint)', background: cellBg(idx, 2) }}>
                {row.converted != null ? `$${row.converted.toFixed(2)}` : ''}
              </div>

              {/* Post price */}
              <div data-cr={`${idx},3`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, borderRight: '1px solid var(--border)', color: row.postPrice != null ? 'var(--accent)' : row.notFound ? '#f87171' : 'var(--text-faint)', background: cellBg(idx, 3) }}>
                {row.postPrice != null ? `$${row.postPrice}` : row.notFound ? '—' : ''}
              </div>

              {/* Buyer */}
              <div data-cr={`${idx},4`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, borderRight: '1px solid var(--border)', color: row.buyer != null ? 'var(--text)' : 'var(--text-faint)', background: cellBg(idx, 4) }}>
                {row.buyer != null ? row.buyer : ''}
              </div>

              {/* Reseller */}
              <div data-cr={`${idx},5`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, color: row.reseller != null ? 'var(--text)' : 'var(--text-faint)', background: cellBg(idx, 5) }}>
                {row.reseller != null ? row.reseller : ''}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {row.rate.trim() && (
                  <button onClick={() => setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== row.id) : [mkCombRow()])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: '4px 6px', borderRadius: 4, display: 'flex', lineHeight: 1 }}>
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost" onClick={() => setRows(prev => [...prev, mkCombRow()])} style={{ fontSize: 12, height: 30 }}><Icon name="plus" size={13} /> Add Row</button>
        <button className="btn ghost" onClick={copyAll} style={{ fontSize: 12, height: 30, ...(copied ? { color: 'var(--accent)' } : {}) }}>
          <Icon name="copy" size={13} /> {copied ? 'Copied!' : 'Copy All'}
        </button>
        <button className="btn ghost" onClick={clearAll} style={{ fontSize: 12, height: 30, marginLeft: 'auto', color: 'var(--text-faint)' }}>Clear</button>
      </div>
    </div>
  )
}

// ─── Price Calculator wrapper ──────────────────────────────────────────────────

function PriceCalc({ priceMap, loading, error }) {
  const [mode, setMode] = useState('forward')

  const { buyerMap, resellerMap } = useMemo(() => {
    const buyerMap = new Map()
    const resellerMap = new Map()
    priceMap.forEach(({ buyer, reseller }, admin) => {
      if (!buyerMap.has(buyer)) buyerMap.set(buyer, [])
      buyerMap.get(buyer).push(admin)
      if (!resellerMap.has(reseller)) resellerMap.set(reseller, [])
      resellerMap.get(reseller).push(admin)
    })
    return { buyerMap, resellerMap }
  }, [priceMap])

  const MODES = [
    { id: 'forward',      label: 'Admin → Price' },
    { id: 'rev-buyer',    label: 'Buyer → Admin' },
    { id: 'rev-reseller', label: 'Reseller → Admin' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-faint)', flex: 1 }}>
          {loading && 'Loading prices…'}
          {!loading && !error && `${priceMap.size.toLocaleString()} prices loaded`}
          {error && <span style={{ color: '#f87171' }}>Error: {error}</span>}
        </span>
        <div style={{ display: 'flex', gap: 3, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: 3 }}>
          {MODES.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} style={{ fontSize: 11, height: 26, padding: '0 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontWeight: mode === m.id ? 600 : 400, background: mode === m.id ? 'var(--accent)' : 'transparent', color: mode === m.id ? 'var(--accent-ink)' : 'var(--text-faint)', transition: 'background .15s, color .15s' }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'forward'
        ? <ForwardGrid key="fwd" priceMap={priceMap} />
        : <ReverseGrid key={mode} reverseMap={mode === 'rev-buyer' ? buyerMap : resellerMap} inputLabel={mode === 'rev-buyer' ? 'Buyer Price' : 'Reseller Price'} />
      }
    </div>
  )
}

// ─── Tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  { id: 'sheet-parser',   title: 'Sheet Parser',            desc: 'Paste a reseller Google Sheet URL — AI detects columns and creates a clean output sheet with buyer prices', icon: 'download', tag: 'Sheets'   },
  { id: 'combined-calc',  title: 'Currency & % Calculator', desc: 'Apply % discount/markup, convert currency, get post price with buyer/reseller lookup',                       icon: 'globe',    tag: 'Pricing'  },
  { id: 'price-calc',     title: 'Price Calculator',        desc: 'Convert admin price to buyer & reseller price instantly',                                                     icon: 'tool',     tag: 'Pricing'  },
  { id: 'livechat-clients', title: 'Live Chat Clients',     desc: 'Manage live chat team clients — order sheets, article costs, discounts, buyer/reseller types',               icon: 'users',    tag: 'LiveChat', roles: ['livechat', 'lead', 'super'] },
  { id: 'email-checker',   title: 'Email Checker',          desc: 'Enter an email + paste a site list — checks contact, about, footer & privacy pages for that email across all sites', icon: 'mail',     tag: 'Outreach' },
  { id: 'email-harvester', title: 'Email Harvester',        desc: 'Paste a list of sites — scrapes contact, about, home & privacy pages and collects every email found. No target needed.', icon: 'inbox',    tag: 'Outreach' },
  { id: 'anchor-sync',     title: 'Anchor Sync',            desc: 'Reads Google Doc links from a sheet column and writes each doc\'s anchor text + URL pairs directly back into that same row', icon: 'link',     tag: 'Sheets'   },
]

// ─── Tools Page ────────────────────────────────────────────────────────────────

export function ToolsPage({ me, role }) {
  const [activeTool, setActiveTool] = useState(null)
  const [priceMap, setPriceMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [fxRates, setFxRates]       = useState(null)
  const [fxLoading, setFxLoading]   = useState(false)
  const [fxError, setFxError]       = useState(null)
  const [fxUpdatedAt, setFxUpdatedAt] = useState(null)

  async function fetchRates() {
    setFxLoading(true); setFxError(null)
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD')
      const json = await res.json()
      if (json.result !== 'success') throw new Error('API returned error')
      setFxRates(json.rates)
      setFxUpdatedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setFxError(err.message)
    } finally {
      setFxLoading(false)
    }
  }

  useEffect(() => {
    loadPriceTable()
      .then(rows => setPriceMap(new Map(rows.map(r => [r.admin, { buyer: r.buyer, reseller: r.reseller }]))))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
    fetchRates()
  }, [])

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Tools</h1>
          <div className="sub">Internal tools for the outreach team</div>
        </div>
        {activeTool && (
          <button className="btn ghost" onClick={() => setActiveTool(null)} style={{ fontSize: 12 }}>← All Tools</button>
        )}
      </div>

      {!activeTool ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {TOOLS.filter(t => !t.roles || t.roles.includes(role)).map(tool => (
            <div key={tool.id} className="card" onClick={() => setActiveTool(tool.id)} style={{ cursor: 'pointer' }}>
              <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
                    <Icon name={tool.icon} size={20} />
                  </div>
                  {tool.tag && (
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>{tool.tag}</span>
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{tool.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>{tool.desc}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  Open <Icon name="arrow" size={11} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : activeTool === 'sheet-parser' ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Sheet Parser</h3>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                AI detects website and pricing columns from any reseller sheet format
              </div>
            </div>
          </div>
          <div className="card-pad">
            <SheetParser priceMap={priceMap} me={me} />
          </div>
        </div>
      ) : activeTool === 'price-calc' ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Price Calculator</h3>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                Enter or paste prices — use the toggle to switch lookup direction
              </div>
            </div>
          </div>
          <div className="card-pad">
            <PriceCalc priceMap={priceMap} loading={loading} error={error} />
          </div>
        </div>
      ) : activeTool === 'combined-calc' ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Currency & % Calculator</h3>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                Apply discount/markup, convert to USD, get buyer/reseller lookup
              </div>
            </div>
          </div>
          <div className="card-pad">
            <CombinedCalc priceMap={priceMap} fxRates={fxRates} fxLoading={fxLoading} fxError={fxError} fxUpdatedAt={fxUpdatedAt} onRefreshRates={fetchRates} />
          </div>
        </div>
      ) : activeTool === 'livechat-clients' ? (
        <LiveChatClients me={me} />
      ) : activeTool === 'email-checker' ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Email Checker</h3>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                Checks contact, about, privacy &amp; home pages for a specific email — shows all other emails found too
              </div>
            </div>
          </div>
          <div className="card-pad">
            <EmailChecker />
          </div>
        </div>
      ) : activeTool === 'email-harvester' ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Email Harvester</h3>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                Scrapes contact, about, home &amp; privacy pages — collects every email found per site
              </div>
            </div>
          </div>
          <div className="card-pad">
            <EmailHarvester />
          </div>
        </div>
      ) : activeTool === 'anchor-sync' ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Anchor Sync</h3>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                Extracts anchor text + URL pairs from Google Docs and writes them straight into the source sheet, row by row
              </div>
            </div>
          </div>
          <div className="card-pad">
            <AnchorSync />
          </div>
        </div>
      ) : null}
    </div>
  )
}

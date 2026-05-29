import { useState, useEffect, useRef, useMemo } from 'react'
import { Icon } from '../data.jsx'
import { loadPriceTable } from '../lib/supabase.js'

// ─── shared helpers ────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }
function mkFwdRow() { return { id: uid(), admin: '', buyer: null, reseller: null, notFound: false } }
function mkRevRow() { return { id: uid(), input: '', admins: null, notFound: false } }

function normSel(s) {
  if (!s) return null
  return { r1: Math.min(s.r1, s.r2), r2: Math.max(s.r1, s.r2), c1: Math.min(s.c1, s.c2), c2: Math.max(s.c1, s.c2) }
}
function inSel(sel, r, c) {
  if (!sel) return false
  const n = normSel(sel)
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2
}

const TH = { padding: '8px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }
const MONO = { fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }
const INPUT_STYLE = { width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: '7px 12px', ...MONO, color: 'var(--text)', height: 36, boxSizing: 'border-box', userSelect: 'auto' }
const SEL_BG = 'color-mix(in srgb, var(--accent) 14%, transparent)'

// Shared hook: drag-select + Ctrl+C copy
function useGridSelection(gridRef, rows, getCellText) {
  const [sel, setSel] = useState(null)
  const dragging = useRef(false)

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
      setSel(prev => ({ ...prev, r2: pos.r, c2: pos.c }))
    } else {
      dragging.current = true
      setSel({ r1: pos.r, c1: pos.c, r2: pos.r, c2: pos.c })
    }
  }

  function onMouseMove(e) {
    if (!dragging.current) return
    const pos = getCellPos(e)
    if (pos) setSel(prev => prev ? { ...prev, r2: pos.r, c2: pos.c } : null)
  }

  useEffect(() => {
    function onUp() { dragging.current = false }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // Intercept native copy when grid contains focus and there's a multi-cell selection
  useEffect(() => {
    function onCopy(e) {
      if (!sel || !gridRef.current?.contains(document.activeElement)) return
      const n = normSel(sel)
      // Let browser handle normal text selection in a single input cell
      if (n.r1 === n.r2 && n.c1 === n.c2 && document.activeElement?.tagName === 'INPUT') return
      e.preventDefault()
      const lines = []
      for (let r = n.r1; r <= n.r2; r++) {
        const cells = []
        for (let c = n.c1; c <= n.c2; c++) cells.push(getCellText(rows, r, c))
        lines.push(cells.join('\t'))
      }
      e.clipboardData.setData('text/plain', lines.join('\n'))
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [sel, rows, getCellText, gridRef])

  return { sel, setSel, onMouseDown, onMouseMove }
}

// ─── Forward grid (Admin → Buyer, Reseller) ────────────────────────────────────

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

  const { sel, setSel, onMouseDown, onMouseMove } = useGridSelection(gridRef, rows, getCellText)

  function setAdmin(id, val) {
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, admin: val, ...resolve(val) }))
  }
  function deleteRow(id) {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : [mkFwdRow()])
  }
  function addRow() { setRows(prev => [...prev, mkFwdRow()]) }

  function onInputKeyDown(e, idx) {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowDown') {
      e.preventDefault()
      const isLast = idx === rows.length - 1
      if (isLast) setRows(prev => [...prev, mkFwdRow()])
      setTimeout(() => {
        const ins = gridRef.current?.querySelectorAll('input[data-row]')
        ins?.[idx + 1]?.focus()
      }, isLast ? 30 : 10)
    } else if ((e.key === 'Tab' && e.shiftKey) || e.key === 'ArrowUp') {
      e.preventDefault()
      gridRef.current?.querySelectorAll('input[data-row]')?.[idx - 1]?.focus()
    }
  }

  function onPaste(e) {
    const target = e.target
    if (!target.hasAttribute('data-row')) return
    const text = e.clipboardData.getData('text')
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    const start = Number(target.getAttribute('data-row'))
    const newRows = lines.map(line => ({ id: uid(), admin: line.split(/\t/)[0].trim(), ...resolve(line.split(/\t/)[0].trim()) }))
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-faint)', minHeight: 18 }}>
        {filledCount > 0 && <span style={{ color: 'var(--accent)' }}>{filledCount} matched</span>}
        {notFoundCount > 0 && <span style={{ color: '#f87171' }}>{notFoundCount} not found</span>}
        {sel && <span style={{ marginLeft: 'auto' }}>Ctrl+C copies selection</span>}
      </div>

      <div
        style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', userSelect: 'none' }}
        onPaste={onPaste}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 32px', background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
          {['#', 'Admin', 'Buyer', 'Reseller', ''].map((h, i) => (
            <div key={i} style={{ ...TH, textAlign: i === 0 ? 'center' : 'left' }}>{h}</div>
          ))}
        </div>

        <div ref={gridRef} style={{ maxHeight: 480, overflowY: 'auto' }}>
          {rows.map((row, idx) => (
            <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 32px', borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none', background: idx % 2 ? 'rgba(255,255,255,.013)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-faint)', borderRight: '1px solid var(--border)' }}>
                {idx + 1}
              </div>

              <div data-cr={`${idx},0`} style={{ borderRight: '1px solid var(--border)', background: inSel(sel, idx, 0) ? SEL_BG : 'transparent' }}>
                <input
                  data-row={idx}
                  type="number"
                  value={row.admin}
                  onChange={e => setAdmin(row.id, e.target.value)}
                  onKeyDown={e => onInputKeyDown(e, idx)}
                  placeholder={idx === 0 ? 'Enter or paste column…' : ''}
                  style={INPUT_STYLE}
                />
              </div>

              <div data-cr={`${idx},1`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, borderRight: '1px solid var(--border)', color: row.buyer != null ? 'var(--accent)' : row.notFound ? '#f87171' : 'var(--text-faint)', background: inSel(sel, idx, 1) ? SEL_BG : 'transparent' }}>
                {row.buyer != null ? row.buyer.toFixed(2) : row.notFound ? '—' : ''}
              </div>

              <div data-cr={`${idx},2`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, color: row.reseller != null ? 'var(--text)' : row.notFound ? '#f87171' : 'var(--text-faint)', background: inSel(sel, idx, 2) ? SEL_BG : 'transparent' }}>
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

  const { sel, setSel, onMouseDown, onMouseMove } = useGridSelection(gridRef, rows, getCellText)

  function setInput(id, val) {
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, input: val, ...resolve(val) }))
  }
  function deleteRow(id) {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : [mkRevRow()])
  }
  function addRow() { setRows(prev => [...prev, mkRevRow()]) }

  function onInputKeyDown(e, idx) {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowDown') {
      e.preventDefault()
      const isLast = idx === rows.length - 1
      if (isLast) setRows(prev => [...prev, mkRevRow()])
      setTimeout(() => {
        gridRef.current?.querySelectorAll('input[data-row]')?.[idx + 1]?.focus()
      }, isLast ? 30 : 10)
    } else if ((e.key === 'Tab' && e.shiftKey) || e.key === 'ArrowUp') {
      e.preventDefault()
      gridRef.current?.querySelectorAll('input[data-row]')?.[idx - 1]?.focus()
    }
  }

  function onPaste(e) {
    const target = e.target
    if (!target.hasAttribute('data-row')) return
    const text = e.clipboardData.getData('text')
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    const start = Number(target.getAttribute('data-row'))
    const newRows = lines.map(line => { const val = line.split(/\t/)[0].trim(); return { id: uid(), input: val, ...resolve(val) } })
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-faint)', minHeight: 18 }}>
        {matchedCount > 0 && <span style={{ color: 'var(--accent)' }}>{matchedCount} matched</span>}
        {notFoundCount > 0 && <span style={{ color: '#f87171' }}>{notFoundCount} not found</span>}
        {sel && <span style={{ marginLeft: 'auto' }}>Ctrl+C copies selection</span>}
      </div>

      <div
        style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', userSelect: 'none' }}
        onPaste={onPaste}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 32px', background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
          {['#', inputLabel, 'Admin Price(s)', ''].map((h, i) => (
            <div key={i} style={{ ...TH, textAlign: i === 0 ? 'center' : 'left' }}>{h}</div>
          ))}
        </div>

        <div ref={gridRef} style={{ maxHeight: 480, overflowY: 'auto' }}>
          {rows.map((row, idx) => (
            <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 32px', borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none', background: idx % 2 ? 'rgba(255,255,255,.013)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-faint)', borderRight: '1px solid var(--border)' }}>
                {idx + 1}
              </div>

              <div data-cr={`${idx},0`} style={{ borderRight: '1px solid var(--border)', background: inSel(sel, idx, 0) ? SEL_BG : 'transparent' }}>
                <input
                  data-row={idx}
                  type="number"
                  step="0.1"
                  value={row.input}
                  onChange={e => setInput(row.id, e.target.value)}
                  onKeyDown={e => onInputKeyDown(e, idx)}
                  placeholder={idx === 0 ? 'Enter price or paste…' : ''}
                  style={INPUT_STYLE}
                />
              </div>

              <div data-cr={`${idx},1`} style={{ ...MONO, padding: '0 12px', display: 'flex', alignItems: 'center', height: 36, color: row.admins ? 'var(--accent)' : row.notFound ? '#f87171' : 'var(--text-faint)', background: inSel(sel, idx, 1) ? SEL_BG : 'transparent' }}>
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
      {/* Top bar: status + mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-faint)', flex: 1 }}>
          {loading && 'Loading prices…'}
          {!loading && !error && `${priceMap.size.toLocaleString()} prices loaded`}
          {error && <span style={{ color: '#f87171' }}>Error: {error}</span>}
        </span>
        <div style={{ display: 'flex', gap: 3, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: 3 }}>
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{ fontSize: 11, height: 26, padding: '0 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontWeight: mode === m.id ? 600 : 400, background: mode === m.id ? 'var(--accent)' : 'transparent', color: mode === m.id ? 'var(--accent-ink)' : 'var(--text-faint)', transition: 'background .15s, color .15s' }}
            >
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
  { id: 'price-calc', title: 'Price Calculator', desc: 'Convert admin price to buyer & reseller price instantly', icon: 'tool', tag: 'Pricing' },
]

// ─── Tools Page ────────────────────────────────────────────────────────────────

export function ToolsPage() {
  const [activeTool, setActiveTool] = useState(null)
  const [priceMap, setPriceMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadPriceTable()
      .then(rows => setPriceMap(new Map(rows.map(r => [r.admin, { buyer: r.buyer, reseller: r.reseller }]))))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
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
          {TOOLS.map(tool => (
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
      ) : null}
    </div>
  )
}

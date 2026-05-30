import { useState, useEffect, useRef, useMemo } from 'react'
import { Icon } from '../data.jsx'
import { loadPriceTable } from '../lib/supabase.js'

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
  function navigate(fromR, fromC, key, shiftKey, ctrlKey, numCols, numRows) {
    const isEnterOrTab = key === 'Enter' || key === 'Tab'
    const dr = (key === 'ArrowDown' || isEnterOrTab) ? 1 : key === 'ArrowUp' ? -1 : 0
    const dc = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
    if (dr === 0 && dc === 0) return null

    let newR = fromR, newC = fromC
    if (ctrlKey) {
      if (dr !== 0) newR = dr > 0 ? numRows - 1 : 0
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

    const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (!ARROWS.includes(e.key) || !sel) return
    e.preventDefault()

    const { cr, cc } = sel
    const ctrl = e.ctrlKey || e.metaKey
    // Add row when arrowing down past the last row (non-shift only)
    const goingDown = e.key === 'ArrowDown' && cr === rows.length - 1 && !e.shiftKey && !ctrl
    if (goingDown) setRows(prev => [...prev, mkFwdRow()])
    const effectiveRows = goingDown ? rows.length + 1 : rows.length

    const newPos = navigate(cr, cc, e.key, e.shiftKey, ctrl, FWD_COLS, effectiveRows)
    if (!newPos) return

    if (newPos.c === 0 && !e.shiftKey) {
      focusInput(newPos.r, goingDown ? 40 : 10)
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

    const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (!ARROWS.includes(e.key) || !sel) return
    e.preventDefault()

    const { cr, cc } = sel
    const ctrl = e.ctrlKey || e.metaKey
    const goingDown = e.key === 'ArrowDown' && cr === rows.length - 1 && !e.shiftKey && !ctrl
    if (goingDown) setRows(prev => [...prev, mkRevRow()])
    const effectiveRows = goingDown ? rows.length + 1 : rows.length

    const newPos = navigate(cr, cc, e.key, e.shiftKey, ctrl, REV_COLS, effectiveRows)
    if (!newPos) return

    if (newPos.c === 0 && !e.shiftKey) {
      focusInput(newPos.r, goingDown ? 40 : 10)
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

import { useState, useEffect, useRef } from 'react'
import { Icon } from '../data.jsx'
import { loadPriceTable } from '../lib/supabase.js'

// ─── Price Calculator ──────────────────────────────────────────────────────────

function mkRow() {
  return { id: Math.random().toString(36).slice(2), admin: '', buyer: null, reseller: null, notFound: false }
}

function PriceCalc({ priceMap, loading, error }) {
  const [rows, setRows] = useState(() => Array.from({ length: 12 }, mkRow))
  const gridRef = useRef(null)
  const [copied, setCopied] = useState(false)

  function resolve(adminStr) {
    const n = Number(adminStr)
    if (!adminStr.trim() || isNaN(n)) return { buyer: null, reseller: null, notFound: false }
    const match = priceMap.get(n)
    return match
      ? { buyer: match.buyer, reseller: match.reseller, notFound: false }
      : { buyer: null, reseller: null, notFound: true }
  }

  function setAdmin(id, val) {
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, admin: val, ...resolve(val) }))
  }

  function deleteRow(id) {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : [mkRow()])
  }

  function addRow() {
    setRows(prev => [...prev, mkRow()])
  }

  function onKeyDown(e, idx) {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowDown') {
      e.preventDefault()
      const isLast = idx === rows.length - 1
      if (isLast) setRows(prev => [...prev, mkRow()])
      setTimeout(() => {
        const inputs = gridRef.current?.querySelectorAll('input[data-row]')
        if (inputs?.[idx + 1]) inputs[idx + 1].focus()
      }, isLast ? 30 : 10)
    } else if ((e.key === 'Tab' && e.shiftKey) || e.key === 'ArrowUp') {
      e.preventDefault()
      const inputs = gridRef.current?.querySelectorAll('input[data-row]')
      if (inputs?.[idx - 1]) inputs[idx - 1].focus()
    }
  }

  function onPaste(e) {
    const target = e.target
    if (!target.hasAttribute('data-row')) return
    const text = e.clipboardData.getData('text')
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    const startIdx = Number(target.getAttribute('data-row'))
    const newRows = lines.map(line => {
      const val = line.split(/\t/)[0].trim()
      return { id: Math.random().toString(36).slice(2), admin: val, ...resolve(val) }
    })
    setRows(prev => {
      const result = [...prev]
      newRows.forEach((row, i) => {
        if (startIdx + i < result.length) result[startIdx + i] = row
        else result.push(row)
      })
      return result
    })
  }

  function copyAll() {
    const filled = rows.filter(r => r.admin.trim())
    if (!filled.length) return
    const text = [
      'Admin\tBuyer\tReseller',
      ...filled.map(r => `${r.admin}\t${r.buyer ?? ''}\t${r.reseller ?? ''}`)
    ].join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  function clearAll() {
    setRows(Array.from({ length: 12 }, mkRow))
  }

  const filledCount = rows.filter(r => r.buyer != null).length
  const notFoundCount = rows.filter(r => r.notFound).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Status bar */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-faint)' }}>
        {loading && <span>Loading price table…</span>}
        {!loading && !error && <span>{priceMap.size.toLocaleString()} prices loaded</span>}
        {error && <span style={{ color: '#f87171' }}>Error loading prices: {error}</span>}
        {filledCount > 0 && <span style={{ color: 'var(--accent)' }}>{filledCount} matched</span>}
        {notFoundCount > 0 && <span style={{ color: '#f87171' }}>{notFoundCount} not found</span>}
      </div>

      {/* Grid */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }} onPaste={onPaste}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 32px', background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
          {['#', 'Admin', 'Buyer', 'Reseller', ''].map((h, i) => (
            <div key={i} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', textAlign: i === 0 ? 'center' : 'left' }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div ref={gridRef} style={{ maxHeight: 500, overflowY: 'auto' }}>
          {rows.map((row, idx) => {
            const hasVal = row.admin.trim() !== ''
            return (
              <div
                key={row.id}
                style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 32px', borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none', background: idx % 2 === 1 ? 'rgba(255,255,255,.013)' : 'transparent' }}
              >
                {/* Row number */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-faint)', borderRight: '1px solid var(--border)', userSelect: 'none' }}>
                  {idx + 1}
                </div>

                {/* Admin input */}
                <div style={{ borderRight: '1px solid var(--border)' }}>
                  <input
                    data-row={idx}
                    type="number"
                    value={row.admin}
                    onChange={e => setAdmin(row.id, e.target.value)}
                    onKeyDown={e => onKeyDown(e, idx)}
                    placeholder={idx === 0 ? 'Enter price or paste column…' : ''}
                    style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: '7px 12px', fontSize: 13, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text)', height: 36, boxSizing: 'border-box' }}
                  />
                </div>

                {/* Buyer */}
                <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 13, fontFamily: 'var(--font-mono, monospace)', borderRight: '1px solid var(--border)', height: 36, color: row.buyer != null ? 'var(--accent)' : row.notFound ? '#f87171' : 'var(--text-faint)' }}>
                  {row.buyer != null ? row.buyer.toFixed(2) : row.notFound ? '—' : ''}
                </div>

                {/* Reseller */}
                <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 13, fontFamily: 'var(--font-mono, monospace)', height: 36, color: row.reseller != null ? 'var(--text)' : row.notFound ? '#f87171' : 'var(--text-faint)' }}>
                  {row.reseller != null ? row.reseller.toFixed(2) : row.notFound ? '—' : ''}
                </div>

                {/* Delete */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {hasVal && (
                    <button
                      onClick={() => deleteRow(row.id)}
                      title="Remove row"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: '4px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', lineHeight: 1 }}
                    >
                      <Icon name="x" size={11} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn ghost" onClick={addRow} style={{ fontSize: 12, height: 30 }}>
          <Icon name="plus" size={13} /> Add Row
        </button>
        <button
          className="btn ghost"
          onClick={copyAll}
          style={{ fontSize: 12, height: 30, ...(copied ? { color: 'var(--accent)' } : {}) }}
        >
          <Icon name="copy" size={13} /> {copied ? 'Copied!' : 'Copy All'}
        </button>
        <button
          className="btn ghost"
          onClick={clearAll}
          style={{ fontSize: 12, height: 30, marginLeft: 'auto', color: 'var(--text-faint)' }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}

// ─── Tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    id: 'price-calc',
    title: 'Price Calculator',
    desc: 'Convert admin price to buyer & reseller price instantly',
    icon: 'tool',
    tag: 'Pricing',
  },
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
          <button className="btn ghost" onClick={() => setActiveTool(null)} style={{ fontSize: 12 }}>
            ← All Tools
          </button>
        )}
      </div>

      {!activeTool ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {TOOLS.map(tool => (
            <div
              key={tool.id}
              className="card"
              onClick={() => setActiveTool(tool.id)}
              style={{ cursor: 'pointer' }}
            >
              <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
                    <Icon name={tool.icon} size={20} />
                  </div>
                  {tool.tag && (
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
                      {tool.tag}
                    </span>
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
                Type or paste a column of admin prices — buyer & reseller fill automatically
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

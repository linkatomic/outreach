import { useState, useEffect } from 'react'
import { Icon } from '../data.jsx'
import { loadOrderHistory } from '../lib/supabase.js'

const TYPE_META = {
  blank: { label: 'Blank Template', color: '#a78bfa', bg: 'rgba(167,139,250,.1)', border: 'rgba(167,139,250,.25)' },
  new:   { label: 'New Tab',        color: '#4ade80', bg: 'rgba(74,222,128,.1)',  border: 'rgba(74,222,128,.25)'  },
  fill:  { label: 'Fill Existing',  color: '#60a5fa', bg: 'rgba(96,165,250,.1)',  border: 'rgba(96,165,250,.25)'  },
}

function fmtRel(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtFull(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function LcHistory() {
  const [rows, setRows]       = useState(null)
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')

  useEffect(() => {
    loadOrderHistory().then(setRows).catch(() => setRows([]))
  }, [])

  const filtered = (rows || []).filter(r => {
    if (filter !== 'all' && r.type !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return r.client_name.toLowerCase().includes(q)
          || r.sheet_title.toLowerCase().includes(q)
          || r.member_name.toLowerCase().includes(q)
    }
    return true
  })

  const counts = { blank: 0, new: 0, fill: 0 }
  for (const r of rows || []) counts[r.type] = (counts[r.type] || 0) + 1

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page-head">
        <div>
          <h1>Sheet History</h1>
          <div className="sub">{rows?.length ?? '…'} sheets created across all clients</div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" placeholder="Search client, sheet, or member…"
               value={search} onChange={e => setSearch(e.target.value)}
               style={{ flex: 1, minWidth: 200, maxWidth: 300, fontSize: 13 }} />
        <span className="seg" style={{ fontSize: 12 }}>
          <button className={filter === 'all'   ? 'on' : ''} onClick={() => setFilter('all')}>All {rows?.length ?? ''}</button>
          <button className={filter === 'new'   ? 'on' : ''} onClick={() => setFilter('new')}>New Tab {counts.new || ''}</button>
          <button className={filter === 'fill'  ? 'on' : ''} onClick={() => setFilter('fill')}>Fill {counts.fill || ''}</button>
          <button className={filter === 'blank' ? 'on' : ''} onClick={() => setFilter('blank')}>Blank {counts.blank || ''}</button>
        </span>
      </div>

      {/* Table */}
      {rows === null ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          {rows.length === 0 ? 'No sheets created yet.' : 'No results match your filter.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 110px 90px 80px 48px', gap: '0 12px', padding: '8px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', borderBottom: '1px solid var(--border)' }}>
            <div>Sheet / Client</div>
            <div>Created by</div>
            <div>Type</div>
            <div>Niche</div>
            <div>Domains</div>
            <div />
          </div>

          {filtered.map((r, i) => {
            const meta = TYPE_META[r.type] || TYPE_META.new
            return (
              <div key={r.id}>
                {i > 0 && <div style={{ borderTop: '1px solid var(--border)' }} />}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 110px 90px 80px 48px', gap: '0 12px', padding: '11px 16px', alignItems: 'center' }}>

                  {/* Sheet + client */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sheet_title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                      {r.client_name}
                      <span style={{ marginLeft: 8, opacity: 0.6 }} title={fmtFull(r.created_at)}>{fmtRel(r.created_at)}</span>
                    </div>
                  </div>

                  {/* Member */}
                  <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-faint)' }}>
                    {r.member_name}
                  </div>

                  {/* Type badge */}
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '3px 8px', borderRadius: 5, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, whiteSpace: 'nowrap' }}>
                      {meta.label}
                    </span>
                  </div>

                  {/* Niche */}
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', textTransform: 'capitalize' }}>
                    {r.niche || '—'}
                  </div>

                  {/* Domain count */}
                  <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: r.domain_count ? 'var(--text)' : 'var(--text-faint)', textAlign: 'center' }}>
                    {r.domain_count ?? '—'}
                  </div>

                  {/* Open link */}
                  <div style={{ textAlign: 'right' }}>
                    {r.sheet_url
                      ? <a href={r.sheet_url} target="_blank" rel="noreferrer"
                           style={{ fontSize: 12, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                          <Icon name="arrow" size={11} />
                        </a>
                      : <span style={{ color: 'var(--text-faint)' }}>—</span>
                    }
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

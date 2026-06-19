import { useState, useEffect } from 'react'
import { loadNotionHistory } from '../lib/supabase.js'

function fmtRel(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60)     return 'just now'
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtFull(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function LcNotionHistory() {
  const [batches,    setBatches]    = useState(null)
  const [search,     setSearch]     = useState('')
  const [expanded,   setExpanded]   = useState(new Set())

  useEffect(() => {
    loadNotionHistory().then(setBatches).catch(() => setBatches([]))
  }, [])

  const filtered = (batches || []).filter(b => {
    if (!search) return true
    const q = search.toLowerCase()
    return b.client_name?.toLowerCase().includes(q)
        || b.member_name?.toLowerCase().includes(q)
        || b.post_type?.toLowerCase().includes(q)
  })

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const totalCards = (batches || []).reduce((s, b) => s + (b.batch_size || 0), 0)

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Notion History</h1>
          <div className="sub">
            {batches === null ? '…' : `${batches.length} batches · ${totalCards} cards total`}
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          className="input"
          placeholder="Search client, member, or post type…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ fontSize: 13, maxWidth: 320 }}
        />
      </div>

      {/* List */}
      {batches === null ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          {batches.length === 0 ? 'No batches created yet.' : 'No results match your search.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(b => {
            const open = expanded.has(b.id)
            const cards = b.cards || []
            return (
              <div key={b.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Batch header row */}
                <div
                  onClick={() => toggleExpand(b.id)}
                  style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '0 16px', padding: '13px 16px', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {b.client_name}
                      {b.post_type && (
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '2px 7px', borderRadius: 4, background: 'rgba(167,139,250,.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,.3)' }}>
                          {b.post_type}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
                      {b.member_name}
                      {b.order_from && <span style={{ marginLeft: 8, opacity: 0.7 }}>{b.order_from}</span>}
                    </div>
                  </div>

                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {b.batch_size} cards
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap' }} title={fmtFull(b.created_at)}>
                    {fmtRel(b.created_at)}
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-faint)', width: 16, textAlign: 'center' }}>
                    {open ? '▲' : '▼'}
                  </div>
                </div>

                {/* Expanded card list */}
                {open && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {cards.length === 0 ? (
                      <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-faint)' }}>No card data saved.</div>
                    ) : (
                      cards.map((card, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderTop: i > 0 ? '1px solid var(--border)' : undefined, background: 'var(--surface-1, rgba(255,255,255,.02))' }}>
                          <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                            {card.title}
                          </span>
                          {card.url ? (
                            <a
                              href={card.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{ marginLeft: 12, fontSize: 11, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600, flexShrink: 0, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--accent)', opacity: 0.8 }}
                            >
                              Open →
                            </a>
                          ) : (
                            <span style={{ marginLeft: 12, fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>no link</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

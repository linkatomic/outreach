import { useState, useEffect } from 'react'
import { loadNotionHistory } from '../lib/supabase.js'
import { updateNotionPage } from '../lib/notionApi.js'
import { extractSheetId, getSheetRows } from '../lib/sheetParserAPI.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CONCURRENCY = 3

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
  const [batches,  setBatches]  = useState(null)
  const [search,   setSearch]   = useState('')
  const [expanded, setExpanded] = useState(new Set())
  const [fillState, setFillState] = useState({}) // batchId → fill progress state

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

  function setFs(id, val) {
    setFillState(p => ({ ...p, [id]: val }))
  }

  async function handleFillDocs(batch) {
    const batchId = batch.id
    setFs(batchId, { phase: 'loading' })

    try {
      // Read the sheet
      const sheetId = extractSheetId(batch.sheet_url)
      if (!sheetId) throw new Error('Invalid sheet URL saved in batch')

      const rows = await getSheetRows(sheetId, batch.sheet_tab)
      if (rows.length < 2) throw new Error('Sheet has no data rows')

      // Detect columns from header
      const header = rows[0].map(h => String(h ?? '').trim().toLowerCase())
      const domainIdx  = Math.max(header.findIndex(h => h === 'domain'), 1)
      const docIdx     = header.findIndex(h => h.includes('article doc'))
      if (docIdx < 0) throw new Error('"Article Doc" column not found in sheet')

      // Build domain → article doc URL map
      const docMap = new Map()
      for (const row of rows.slice(1)) {
        const domain = String(row[domainIdx] ?? '').trim().toLowerCase()
        const doc    = String(row[docIdx] ?? '').trim()
        if (domain && doc) docMap.set(domain, doc)
      }

      // Filter cards that have both a Notion page ID and a matching doc URL
      const cards = (batch.cards || []).filter(c => c.id && c.domain && docMap.has(c.domain.toLowerCase()))
      const skipped = (batch.cards?.length || 0) - cards.length

      if (cards.length === 0) {
        setFs(batchId, { phase: 'done', done: 0, total: 0, skipped, errors: [], msg: 'No Article Docs found in sheet for this batch.' })
        return
      }

      setFs(batchId, { phase: 'updating', done: 0, total: cards.length, skipped, errors: [] })

      const errors = []
      for (let i = 0; i < cards.length; i += CONCURRENCY) {
        const batchStart = Date.now()
        const slice = cards.slice(i, i + CONCURRENCY)

        const results = await Promise.allSettled(
          slice.map(card => updateNotionPage(card.id, { 'Article DOC': { url: docMap.get(card.domain.toLowerCase()) } }))
        )

        results.forEach((r, bi) => {
          if (r.status === 'rejected') errors.push(`${slice[bi].domain}: ${r.reason?.message || 'Failed'}`)
        })

        const newDone = Math.min(i + CONCURRENCY, cards.length)
        setFs(batchId, { phase: 'updating', done: newDone, total: cards.length, skipped, errors: [...errors] })

        const elapsed = Date.now() - batchStart
        if (elapsed < 1050 && i + CONCURRENCY < cards.length) await sleep(1050 - elapsed)
      }

      setFs(batchId, {
        phase: 'done',
        done: cards.length - errors.length,
        total: cards.length,
        skipped,
        errors,
      })

    } catch (err) {
      setFs(batchId, { phase: 'done', error: err.message })
    }
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

      {batches === null ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          {batches.length === 0 ? 'No batches created yet.' : 'No results match your search.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(b => {
            const open  = expanded.has(b.id)
            const cards = b.cards || []
            const fs    = fillState[b.id]

            // Can Fill Docs if: sheet URL saved AND at least one card has an ID stored
            const canFill    = !!b.sheet_url && cards.some(c => c.id)
            const fillBusy   = fs?.phase === 'loading' || fs?.phase === 'updating'
            const fillLabel  = fs?.phase === 'loading'  ? 'Reading sheet…'
                             : fs?.phase === 'updating' ? `${fs.done}/${fs.total} updated…`
                             : 'Fill Article Docs'

            return (
              <div key={b.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>

                {/* ── Batch header ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '0 12px', padding: '13px 16px', alignItems: 'center' }}>

                  {/* Info — clickable to expand */}
                  <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => toggleExpand(b.id)}>
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

                  {/* Fill Article Docs button */}
                  <button
                    onClick={e => { e.stopPropagation(); if (canFill && !fillBusy && fs?.phase !== 'done') handleFillDocs(b) }}
                    disabled={fillBusy}
                    title={!b.sheet_url ? 'No sheet URL saved — create a new batch to use this feature' : !cards.some(c => c.id) ? 'No page IDs saved — create a new batch to use this feature' : ''}
                    style={{
                      fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid',
                      whiteSpace: 'nowrap',
                      cursor: (canFill && !fillBusy && fs?.phase !== 'done') ? 'pointer' : 'default',
                      background: fs?.phase === 'done' && !fs.error ? 'rgba(74,222,128,.1)' : 'transparent',
                      borderColor: fs?.phase === 'done' && !fs.error ? 'rgba(74,222,128,.3)'
                                 : canFill ? 'rgba(96,165,250,.4)' : 'var(--border)',
                      color: fs?.phase === 'done' && !fs.error ? '#4ade80'
                           : canFill ? '#60a5fa' : 'var(--text-faint)',
                      opacity: (!canFill || fs?.phase === 'done') && !(fs?.phase === 'done' && !fs.error) ? 0.45 : 1,
                    }}
                  >
                    {fs?.phase === 'done' && !fs.error
                      ? `✓ ${fs.done ?? 0} filled`
                      : fillLabel}
                  </button>

                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {b.batch_size} cards
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap', cursor: 'pointer' }}
                       onClick={() => toggleExpand(b.id)} title={fmtFull(b.created_at)}>
                    {fmtRel(b.created_at)}
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-faint)', width: 16, textAlign: 'center', cursor: 'pointer' }}
                       onClick={() => toggleExpand(b.id)}>
                    {open ? '▲' : '▼'}
                  </div>
                </div>

                {/* ── Fill progress / result ── */}
                {fs && (
                  <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,.02)', fontSize: 12 }}>
                    {fs.phase === 'loading' && (
                      <span style={{ color: 'var(--text-faint)' }}>Reading sheet…</span>
                    )}
                    {fs.phase === 'updating' && (
                      <div>
                        <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                          <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${Math.round((fs.done / fs.total) * 100)}%`, transition: 'width .3s' }} />
                        </div>
                        <span style={{ color: 'var(--text-faint)' }}>Updating Article Docs… {fs.done}/{fs.total}</span>
                      </div>
                    )}
                    {fs.phase === 'done' && fs.error && (
                      <span style={{ color: '#f87171' }}>✗ {fs.error}</span>
                    )}
                    {fs.phase === 'done' && !fs.error && (
                      <span style={{ color: 'var(--text-faint)' }}>
                        <span style={{ color: '#4ade80' }}>✓ {fs.done} Article Docs filled</span>
                        {fs.skipped > 0 && <span style={{ marginLeft: 10, opacity: 0.7 }}>· {fs.skipped} skipped (no doc in sheet)</span>}
                        {fs.errors?.length > 0 && <span style={{ marginLeft: 10, color: '#f87171' }}>· {fs.errors.length} failed</span>}
                        {fs.msg && <span style={{ marginLeft: 6, opacity: 0.7 }}>{fs.msg}</span>}
                      </span>
                    )}
                  </div>
                )}

                {/* ── Expanded card list ── */}
                {open && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {cards.length === 0 ? (
                      <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-faint)' }}>No card data saved.</div>
                    ) : (
                      cards.map((card, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', borderTop: i > 0 ? '1px solid var(--border)' : undefined, background: 'rgba(255,255,255,.015)' }}>
                          <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                            {card.title}
                          </span>
                          {card.url ? (
                            <a href={card.url} target="_blank" rel="noreferrer"
                               style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600, flexShrink: 0, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--accent)', opacity: 0.8 }}>
                              Open →
                            </a>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>no link</span>
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

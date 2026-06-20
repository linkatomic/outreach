import { useState, useEffect } from 'react'
import { loadNotionHistory } from '../lib/supabase.js'
import { updateNotionPage, getNotionPage } from '../lib/notionApi.js'
import { extractSheetId, getSheetRows, batchWriteRangeValues } from '../lib/sheetParserAPI.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CONCURRENCY = 3

const STATUS_OPTS = [
  'New Orders', 'Sent for Content Update', 'Pending Publication', 'Credit With Vendors',
  'Client Input Required', 'Sent For Writing', 'Sent For Article Approval',
  'Sent For Publication', 'Post Improvement', 'Order Cancelled',
  'Credit Used', 'Published', 'Testing Card',
]

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

function colLetter(idx) {
  let s = '', n = idx
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 }
  return s
}

function normDomain(raw) {
  return String(raw ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0]
}

async function batchUpdate(cards, buildProps, setProgress, onDone) {
  const errors = []
  for (let i = 0; i < cards.length; i += CONCURRENCY) {
    const batchStart = Date.now()
    const slice = cards.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(slice.map(card => updateNotionPage(card.id, buildProps(card))))
    results.forEach((r, bi) => {
      if (r.status === 'rejected') errors.push(`${slice[bi].domain || slice[bi].title}: ${r.reason?.message || 'Failed'}`)
    })
    setProgress(Math.min(i + CONCURRENCY, cards.length), errors)
    const elapsed = Date.now() - batchStart
    if (elapsed < 1050 && i + CONCURRENCY < cards.length) await sleep(1050 - elapsed)
  }
  onDone(errors)
}

export function LcNotionHistory() {
  const [batches,     setBatches]     = useState(null)
  const [search,      setSearch]      = useState('')
  const [expanded,    setExpanded]    = useState(new Set())
  const [fillState,   setFillState]   = useState({}) // batchId → article doc state
  const [liveState,   setLiveState]   = useState({}) // batchId → live link batch state
  const [statusState, setStatusState] = useState({}) // batchId → { sel, phase, done, total, errors, lastStatus }
  const [cardState,   setCardState]   = useState({}) // `${batchId}:${idx}` → { url, editing, phase, error }
  const [sheetState,  setSheetState]  = useState({}) // batchId → { phase, done, total, error, written }

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
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const setSh  = (id, val) => setSheetState(p  => ({ ...p, [id]: val }))
  const setFs  = (id, val) => setFillState(p   => ({ ...p, [id]: val }))
  const setLs  = (id, val) => setLiveState(p   => ({ ...p, [id]: val }))
  const setSs  = (id, fn)  => setStatusState(p => ({ ...p, [id]: fn(p[id] || {}) }))
  const setCs  = (key, fn) => setCardState(p   => ({ ...p, [key]: fn(p[key] || {}) }))

  // ── shared sheet reader ───────────────────────────────────────
  async function readSheetMap(batch, colMatcher, colLabel) {
    const sheetId = extractSheetId(batch.sheet_url)
    if (!sheetId) throw new Error('Invalid sheet URL saved in batch')
    const rows = await getSheetRows(sheetId, batch.sheet_tab)
    if (rows.length < 2) throw new Error('Sheet has no data rows')
    const header    = rows[0].map(h => String(h ?? '').trim().toLowerCase())
    const domainIdx = Math.max(header.findIndex(h => h === 'domain'), 1)
    const colIdx    = header.findIndex(colMatcher)
    if (colIdx < 0) throw new Error(`"${colLabel}" column not found in sheet`)
    const map = new Map()
    for (const row of rows.slice(1)) {
      const domain = String(row[domainIdx] ?? '').trim().toLowerCase()
      const val    = String(row[colIdx]    ?? '').trim()
      if (domain && val) map.set(domain, val)
    }
    return map
  }

  // ── Fill Article Docs ─────────────────────────────────────────
  async function handleFillDocs(batch) {
    const batchId = batch.id
    setFs(batchId, { phase: 'loading' })
    try {
      const docMap = await readSheetMap(batch, h => h.includes('article doc'), 'Article Doc')
      const cards  = (batch.cards || []).filter(c => c.id && c.domain && docMap.has(c.domain.toLowerCase()))
      const skipped = (batch.cards?.length || 0) - cards.length
      if (!cards.length) { setFs(batchId, { phase: 'done', done: 0, total: 0, skipped, errors: [], msg: 'No Article Docs found in sheet.' }); return }
      setFs(batchId, { phase: 'updating', done: 0, total: cards.length, skipped, errors: [] })
      await batchUpdate(
        cards,
        card => ({ 'Article DOC': { url: docMap.get(card.domain.toLowerCase()) } }),
        (done, errors) => setFs(batchId, { phase: 'updating', done, total: cards.length, skipped, errors: [...errors] }),
        errors => setFs(batchId, { phase: 'done', done: cards.length - errors.length, total: cards.length, skipped, errors })
      )
    } catch (err) { setFs(batchId, { phase: 'done', error: err.message }) }
  }

  // ── Fill Live Links (batch) ───────────────────────────────────
  async function handleFillLiveLinks(batch) {
    const batchId = batch.id
    setLs(batchId, { phase: 'loading' })
    try {
      const liveMap = await readSheetMap(batch, h => h.includes('live link') || h.includes('live url') || h === 'live', 'Live Link')
      const cards   = (batch.cards || []).filter(c => c.id && c.domain && liveMap.has(c.domain.toLowerCase()))
      const skipped = (batch.cards?.length || 0) - cards.length
      if (!cards.length) { setLs(batchId, { phase: 'done', done: 0, total: 0, skipped, errors: [], msg: 'No Live Links found in sheet.' }); return }
      setLs(batchId, { phase: 'updating', done: 0, total: cards.length, skipped, errors: [] })
      await batchUpdate(
        cards,
        card => ({ 'Live link': { url: liveMap.get(card.domain.toLowerCase()) } }),
        (done, errors) => setLs(batchId, { phase: 'updating', done, total: cards.length, skipped, errors: [...errors] }),
        errors => setLs(batchId, { phase: 'done', done: cards.length - errors.length, total: cards.length, skipped, errors })
      )
    } catch (err) { setLs(batchId, { phase: 'done', error: err.message }) }
  }

  // ── Update Order Status (batch) ───────────────────────────────
  async function handleUpdateStatus(batch) {
    const batchId   = batch.id
    const newStatus = statusState[batchId]?.sel
    if (!newStatus) return
    const cards = (batch.cards || []).filter(c => c.id)
    if (!cards.length) return
    setSs(batchId, p => ({ ...p, phase: 'updating', done: 0, total: cards.length, errors: [], lastStatus: newStatus }))
    await batchUpdate(
      cards,
      () => ({ 'Order Status': { status: { name: newStatus } } }),
      (done, errors) => setSs(batchId, p => ({ ...p, done, errors: [...errors] })),
      errors => setSs(batchId, p => ({ ...p, phase: 'done', done: cards.length - errors.length, total: cards.length, errors }))
    )
  }

  // ── Fill Live Link (individual card) ─────────────────────────
  async function handleFillCardLive(batchId, card, cardKey) {
    const url = cardState[cardKey]?.url?.trim()
    if (!url || !card.id) return
    setCs(cardKey, p => ({ ...p, phase: 'saving' }))
    try {
      await updateNotionPage(card.id, { 'Live link': { url } })
      setCs(cardKey, p => ({ ...p, phase: 'done', editing: false }))
    } catch (e) {
      setCs(cardKey, p => ({ ...p, phase: 'error', error: e.message }))
    }
  }

  // ── Sync Live Links → Sheet ───────────────────────────────
  async function handleFillSheet(batch) {
    const batchId = batch.id
    const cards   = (batch.cards || []).filter(c => c.id && c.domain)
    if (!cards.length || !batch.sheet_url) return

    setSh(batchId, { phase: 'reading', done: 0, total: cards.length })

    // Step 1: read live link from each Notion page
    const liveLinks = new Map() // normDomain → url
    const readErrors = []
    for (let i = 0; i < cards.length; i += CONCURRENCY) {
      const batchStart = Date.now()
      const slice = cards.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(slice.map(c => getNotionPage(c.id)))
      results.forEach((r, bi) => {
        if (r.status === 'fulfilled') {
          const url = r.value?.properties?.['Live link']?.url
          if (url) liveLinks.set(normDomain(slice[bi].domain), url)
        } else {
          readErrors.push(`${slice[bi].domain}: ${r.reason?.message || 'read failed'}`)
        }
      })
      setSh(batchId, { phase: 'reading', done: Math.min(i + CONCURRENCY, cards.length), total: cards.length })
      const elapsed = Date.now() - batchStart
      if (elapsed < 1050 && i + CONCURRENCY < cards.length) await sleep(1050 - elapsed)
    }

    if (!liveLinks.size) {
      setSh(batchId, { phase: 'done', error: readErrors[0] || 'No Live links found in any Notion page' })
      return
    }

    // Step 2: read sheet to find domain + live link column positions
    setSh(batchId, { phase: 'writing', done: 0, total: liveLinks.size })
    try {
      const sheetId = extractSheetId(batch.sheet_url)
      const rows    = await getSheetRows(sheetId, batch.sheet_tab)
      if (!rows.length) throw new Error('Sheet is empty')

      const header   = rows[0].map(h => String(h ?? '').trim().toLowerCase())
      const domainIdx = Math.max(header.findIndex(h => h === 'domain'), 1)
      const liveIdx   = header.findIndex(h => h.includes('live link') || h.includes('live url') || h === 'live')
      if (liveIdx < 0) throw new Error('"Live Link" column not found in sheet header')

      const liveCol = colLetter(liveIdx)
      const updates = []
      for (let r = 1; r < rows.length; r++) {
        const domain = normDomain(rows[r][domainIdx])
        const url    = liveLinks.get(domain)
        if (url) updates.push({ range: `'${batch.sheet_tab}'!${liveCol}${r + 1}`, values: [[url]] })
      }

      if (!updates.length) {
        setSh(batchId, { phase: 'done', error: 'No matching domains found in sheet' })
        return
      }

      await batchWriteRangeValues(sheetId, updates)
      setSh(batchId, { phase: 'done', written: updates.length, total: liveLinks.size, readErrors })
    } catch (err) {
      setSh(batchId, { phase: 'done', error: err.message })
    }
  }

  const totalCards = (batches || []).reduce((s, b) => s + (b.batch_size || 0), 0)

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Notion History</h1>
          <div className="sub">{batches === null ? '…' : `${batches.length} batches · ${totalCards} cards total`}</div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input className="input" placeholder="Search client, member, or post type…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ fontSize: 13, maxWidth: 320 }} />
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
            const ls    = liveState[b.id]
            const ss    = statusState[b.id] || {}
            const sh    = sheetState[b.id]

            const canSheet      = !!b.sheet_url && cards.some(c => c.id)
            const canStatus     = cards.some(c => c.id)
            const fillBusy      = fs?.phase === 'loading' || fs?.phase === 'updating'
            const liveBusy      = ls?.phase === 'loading' || ls?.phase === 'updating'
            const sheetBusy     = sh?.phase === 'reading' || sh?.phase === 'writing'
            const statusBusy    = ss.phase === 'updating'
            const canUpdateNow  = canStatus && !!ss.sel && !statusBusy

            const hasProgress = fs || ls || sh || (ss.phase && ss.phase !== 'idle')

            function sheetBtnStyle(state, canAct) {
              const done = state?.phase === 'done' && !state?.error
              return {
                fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid',
                whiteSpace: 'nowrap',
                cursor: (canAct && state?.phase !== 'done') ? 'pointer' : 'default',
                background:   done ? 'rgba(74,222,128,.1)' : 'transparent',
                borderColor:  done ? 'rgba(74,222,128,.3)' : canAct ? 'rgba(96,165,250,.4)' : 'var(--border)',
                color:        done ? '#4ade80' : canAct ? '#60a5fa' : 'var(--text-faint)',
                opacity: !canAct ? 0.4 : 1,
              }
            }

            const fillLabel = fs?.phase === 'loading'  ? 'Reading sheet…'
                            : fs?.phase === 'updating' ? `${fs.done}/${fs.total}…`
                            : fs?.phase === 'done' && !fs.error ? `✓ ${fs.done} Article Docs`
                            : 'Fill Article Docs'

            const liveLabel = ls?.phase === 'loading'  ? 'Reading sheet…'
                            : ls?.phase === 'updating' ? `${ls.done}/${ls.total}…`
                            : ls?.phase === 'done' && !ls.error ? `✓ ${ls.done} Live Links`
                            : 'Fill Live Links'

            const sheetLabel = sh?.phase === 'reading' ? `Reading Notion… ${sh.done}/${sh.total}`
                             : sh?.phase === 'writing' ? 'Writing sheet…'
                             : sh?.phase === 'done' && !sh.error ? `✓ ${sh.written} synced → Sheet`
                             : 'Sync Live Links → Sheet'

            const statusLabel = ss.phase === 'updating' ? `${ss.done ?? 0}/${ss.total ?? 0}…`
                              : ss.phase === 'done'     ? `✓ ${ss.done} updated`
                              : 'Update All'

            return (
              <div key={b.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>

                {/* ── Header ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '0 12px', padding: '13px 16px', alignItems: 'center' }}>
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

                {/* ── Actions bar ── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,.015)' }}>
                  {/* Sheet fill buttons */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => { if (canSheet && !fillBusy && fs?.phase !== 'done') handleFillDocs(b) }}
                      disabled={fillBusy}
                      title={!b.sheet_url ? 'No sheet URL saved' : !cards.some(c => c.id) ? 'No page IDs saved' : ''}
                      style={sheetBtnStyle(fs, canSheet && fs?.phase !== 'done')}
                    >{fillLabel}</button>

                    <button
                      onClick={() => { if (canSheet && !liveBusy && ls?.phase !== 'done') handleFillLiveLinks(b) }}
                      disabled={liveBusy}
                      title={!b.sheet_url ? 'No sheet URL saved' : !cards.some(c => c.id) ? 'No page IDs saved' : ''}
                      style={sheetBtnStyle(ls, canSheet && ls?.phase !== 'done')}
                    >{liveLabel}</button>

                    <button
                      onClick={() => { if (canSheet && !sheetBusy && sh?.phase !== 'done') handleFillSheet(b) }}
                      disabled={sheetBusy}
                      title={!b.sheet_url ? 'No sheet URL saved' : !cards.some(c => c.id) ? 'No page IDs saved' : ''}
                      style={sheetBtnStyle(sh, canSheet && sh?.phase !== 'done')}
                    >{sheetLabel}</button>
                  </div>

                  {/* Status updater */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select
                      value={ss.sel || ''}
                      onChange={e => setSs(b.id, p => ({ ...p, sel: e.target.value, phase: p.phase === 'done' ? 'idle' : p.phase }))}
                      disabled={statusBusy}
                      style={{ fontSize: 11, padding: '3px 8px', height: 27, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: ss.sel ? 'var(--text)' : 'var(--text-faint)', cursor: 'pointer' }}
                    >
                      <option value="">Update status…</option>
                      {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button
                      onClick={() => handleUpdateStatus(b)}
                      disabled={!canUpdateNow}
                      style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid',
                        whiteSpace: 'nowrap', cursor: canUpdateNow ? 'pointer' : 'default',
                        background:  ss.phase === 'done' ? 'rgba(74,222,128,.1)' : 'transparent',
                        borderColor: ss.phase === 'done' ? 'rgba(74,222,128,.3)' : canUpdateNow ? 'rgba(96,165,250,.4)' : 'var(--border)',
                        color:       ss.phase === 'done' ? '#4ade80' : canUpdateNow ? '#60a5fa' : 'var(--text-faint)',
                        opacity: !canUpdateNow ? 0.4 : 1,
                      }}
                    >{statusLabel}</button>
                  </div>
                </div>

                {/* ── Progress / results ── */}
                {hasProgress && (
                  <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,.02)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>

                    {fs?.phase === 'loading' && <span style={{ color: 'var(--text-faint)' }}>Article Docs: Reading sheet…</span>}
                    {fs?.phase === 'updating' && (
                      <div>
                        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                          <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${Math.round((fs.done / fs.total) * 100)}%`, transition: 'width .3s' }} />
                        </div>
                        <span style={{ color: 'var(--text-faint)' }}>Article Docs: {fs.done}/{fs.total} updating…</span>
                      </div>
                    )}
                    {fs?.phase === 'done' && fs.error  && <span style={{ color: '#f87171' }}>✗ Article Docs: {fs.error}</span>}
                    {fs?.phase === 'done' && !fs.error && (
                      <span>
                        <span style={{ color: '#4ade80' }}>✓ {fs.done} Article Docs filled</span>
                        {fs.skipped > 0 && <span style={{ marginLeft: 10, color: 'var(--text-faint)', opacity: 0.7 }}>· {fs.skipped} skipped</span>}
                        {fs.errors?.length > 0 && <span style={{ marginLeft: 10, color: '#f87171' }}>· {fs.errors.length} failed</span>}
                        {fs.msg && <span style={{ marginLeft: 6, color: 'var(--text-faint)', opacity: 0.7 }}>{fs.msg}</span>}
                      </span>
                    )}

                    {ls?.phase === 'loading' && <span style={{ color: 'var(--text-faint)' }}>Live Links: Reading sheet…</span>}
                    {ls?.phase === 'updating' && (
                      <div>
                        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                          <div style={{ height: '100%', background: '#a78bfa', borderRadius: 2, width: `${Math.round((ls.done / ls.total) * 100)}%`, transition: 'width .3s' }} />
                        </div>
                        <span style={{ color: 'var(--text-faint)' }}>Live Links: {ls.done}/{ls.total} updating…</span>
                      </div>
                    )}
                    {ls?.phase === 'done' && ls.error  && <span style={{ color: '#f87171' }}>✗ Live Links: {ls.error}</span>}
                    {ls?.phase === 'done' && !ls.error && (
                      <span>
                        <span style={{ color: '#4ade80' }}>✓ {ls.done} Live Links filled</span>
                        {ls.skipped > 0 && <span style={{ marginLeft: 10, color: 'var(--text-faint)', opacity: 0.7 }}>· {ls.skipped} skipped</span>}
                        {ls.errors?.length > 0 && <span style={{ marginLeft: 10, color: '#f87171' }}>· {ls.errors.length} failed</span>}
                        {ls.msg && <span style={{ marginLeft: 6, color: 'var(--text-faint)', opacity: 0.7 }}>{ls.msg}</span>}
                        {ls.errors?.length > 0 && (
                          <div style={{ marginTop: 4, color: '#f87171', opacity: 0.8 }}>{ls.errors[0]}</div>
                        )}
                      </span>
                    )}

                    {sh?.phase === 'reading' && (
                      <span style={{ color: 'var(--text-faint)' }}>Reading Notion pages… {sh.done}/{sh.total}</span>
                    )}
                    {sh?.phase === 'writing' && (
                      <span style={{ color: 'var(--text-faint)' }}>Writing to sheet…</span>
                    )}
                    {sh?.phase === 'done' && sh.error && (
                      <span style={{ color: '#f87171' }}>✗ Sheet sync: {sh.error}</span>
                    )}
                    {sh?.phase === 'done' && !sh.error && (
                      <span>
                        <span style={{ color: '#4ade80' }}>✓ {sh.written} Live links written to sheet</span>
                        {sh.readErrors?.length > 0 && <span style={{ marginLeft: 10, color: '#f87171' }}>· {sh.readErrors.length} Notion read failed</span>}
                      </span>
                    )}

                    {ss.phase === 'updating' && (
                      <div>
                        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                          <div style={{ height: '100%', background: '#60a5fa', borderRadius: 2, width: `${Math.round(((ss.done || 0) / (ss.total || 1)) * 100)}%`, transition: 'width .3s' }} />
                        </div>
                        <span style={{ color: 'var(--text-faint)' }}>Status update: {ss.done}/{ss.total}…</span>
                      </div>
                    )}
                    {ss.phase === 'done' && (
                      <span>
                        <span style={{ color: '#4ade80' }}>✓ {ss.done} cards → "{ss.lastStatus}"</span>
                        {ss.errors?.length > 0 && <span style={{ marginLeft: 10, color: '#f87171' }}>· {ss.errors.length} failed</span>}
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
                      cards.map((card, i) => {
                        const cardKey = `${b.id}:${i}`
                        const cs      = cardState[cardKey] || {}
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderTop: i > 0 ? '1px solid var(--border)' : undefined, background: 'rgba(255,255,255,.015)' }}>
                            <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                              {card.title}
                            </span>

                            {/* Per-card live link fill */}
                            {cs.phase === 'done' ? (
                              <span style={{ fontSize: 11, color: '#4ade80', flexShrink: 0 }}>✓ Live Link</span>
                            ) : cs.editing ? (
                              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                                <input
                                  autoFocus
                                  value={cs.url || ''}
                                  onChange={e => setCs(cardKey, p => ({ ...p, url: e.target.value }))}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter')  handleFillCardLive(b.id, card, cardKey)
                                    if (e.key === 'Escape') setCs(cardKey, p => ({ ...p, editing: false }))
                                  }}
                                  placeholder="https://…"
                                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: 200 }}
                                />
                                <button
                                  onClick={() => handleFillCardLive(b.id, card, cardKey)}
                                  disabled={!cs.url?.trim() || cs.phase === 'saving' || !card.id}
                                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(96,165,250,.4)', background: 'transparent', color: '#60a5fa', cursor: 'pointer' }}
                                >{cs.phase === 'saving' ? '…' : 'Save'}</button>
                                <button
                                  onClick={() => setCs(cardKey, p => ({ ...p, editing: false }))}
                                  style={{ fontSize: 11, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }}
                                >✕</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { if (card.id) setCs(cardKey, p => ({ ...p, editing: true, url: p.url || '', phase: 'idle' })) }}
                                title={!card.id ? 'No page ID for this card' : cs.phase === 'error' ? cs.error : ''}
                                style={{
                                  fontSize: 10, padding: '2px 8px', borderRadius: 5, flexShrink: 0,
                                  border: `1px solid ${cs.phase === 'error' ? 'rgba(248,113,113,.4)' : 'var(--border)'}`,
                                  background: 'transparent',
                                  color: cs.phase === 'error' ? '#f87171' : 'var(--text-faint)',
                                  cursor: card.id ? 'pointer' : 'default',
                                  opacity: card.id ? 0.7 : 0.35,
                                }}
                              >{cs.phase === 'error' ? '✗ Retry' : 'Fill Live Link'}</button>
                            )}

                            {card.url ? (
                              <a href={card.url} target="_blank" rel="noreferrer"
                                 style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600, flexShrink: 0, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--accent)', opacity: 0.8 }}>
                                Open →
                              </a>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>no link</span>
                            )}
                          </div>
                        )
                      })
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

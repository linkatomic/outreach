import { useState, useEffect, useRef, useCallback } from 'react'
import { TEAM, Icon, todayISO, fmtDateShort } from '../data.jsx'
import {
  loadEmailLogs, addEmail, findEmailByLink,
  incrementEmailReplies, decrementEmailReplies, updateEmailLabel, updateEmailBulk, deleteEmail,
  getEmailCountToday, getTeamEmailCountToday
} from '../lib/supabase.js'

const LABELS = [
  { id: 'critical', label: 'Critical', dot: '🔴' },
  { id: 'good',     label: 'Good',     dot: '🟢' },
  { id: 'easy',     label: 'Easy',     dot: '🔵' },
]

function LabelChip({ label, onClick }) {
  const def = LABELS.find(l => l.id === label)
  if (!def) return null
  return (
    <span className={`label-chip lc-${label}`} onClick={onClick}>
      {def.dot} {def.label}
    </span>
  )
}

export function EmailLogPage({ me, setRoute, showToast, focusEmailOnMount, bulkPasteOnMount }) {
  const [mode, setMode]               = useState('quick')
  const [vendor, setVendor]           = useState('')
  const [link, setLink]               = useState('')
  const [bulkEntry, setBulkEntry]     = useState(false)  // bulk? checkbox for quick add
  const [filter, setFilter]           = useState('today')
  const [filterMember, setFilterMember] = useState(me.id) // default to self
  const [filterLabel, setFilterLabel] = useState(null)
  const [search, setSearch]           = useState('')
  const [bulkText, setBulkText]       = useState('')
  const [rows, setRows]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [submitting, setSubmitting]   = useState(false)
  const [myTodayCount, setMyTodayCount]     = useState(0)
  const [teamTodayCount, setTeamTodayCount] = useState(0)
  const [bulkOpen, setBulkOpen]       = useState(false)
  const [selectedRows, setSelectedRows] = useState(new Set()) // IDs of selected rows

  // Fixed-position label menu portal: { row, x, y } or null
  const [labelMenu, setLabelMenu]     = useState(null)

  // Link-status: vendor becomes optional for known same-day threads
  const [linkStatus, setLinkStatus]   = useState(null) // null | 'checking' | 'new' | 'thread'
  const [linkThread, setLinkThread]   = useState(null)

  const quickRef = useRef(null)
  const linkRef  = useRef(null)

  useEffect(() => { if (bulkPasteOnMount) setBulkOpen(true) }, [bulkPasteOnMount])
  useEffect(() => { if (focusEmailOnMount) quickRef.current?.focus() }, [focusEmailOnMount])

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickRef.current?.focus() }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setBulkOpen(true) }
      if (e.key === 'Escape') setLabelMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Debounced link → thread check ───────────────────
  useEffect(() => {
    if (!link.trim()) { setLinkStatus(null); setLinkThread(null); return }
    setLinkStatus('checking')
    const timer = setTimeout(async () => {
      try {
        const norm = link.trim().replace(/^https?:\/\//, '')
        const found = await findEmailByLink(me.id, norm, todayISO())
        if (found) { setLinkStatus('thread'); setLinkThread(found) }
        else        { setLinkStatus('new');    setLinkThread(null)  }
      } catch { setLinkStatus('new'); setLinkThread(null) }
    }, 400)
    return () => clearTimeout(timer)
  }, [link, me.id])

  // ── Data fetching ────────────────────────────────────
  const fetchRows = useCallback(async () => {
    setLoading(true)
    setSelectedRows(new Set()) // clear selection on data reload
    try {
      const memberId = filterMember === 'all' ? null : filterMember
      const data = await loadEmailLogs({ filter, memberId, search, label: filterLabel })
      setRows(data)
    } catch (err) {
      showToast('Failed to load: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [filter, filterMember, me.id, search, filterLabel])

  useEffect(() => { fetchRows() }, [fetchRows])

  const fetchKpis = useCallback(async () => {
    try {
      const [mine, team] = await Promise.all([getEmailCountToday(me.id), getTeamEmailCountToday()])
      setMyTodayCount(mine); setTeamTodayCount(team)
    } catch { /* silent */ }
  }, [me.id])

  useEffect(() => { fetchKpis() }, [fetchKpis])

  function normalizeLink(raw) { return raw.trim().replace(/^https?:\/\//, '') }

  // ── Label menu (fixed portal) ────────────────────────
  function openLabelMenu(e, row) {
    e.stopPropagation()
    if (labelMenu?.row?.id === row.id) { setLabelMenu(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setLabelMenu({ row, x: rect.left, y: rect.bottom + 4 })
  }

  async function applyLabel(label) {
    if (!labelMenu) return
    const row = labelMenu.row
    setLabelMenu(null)
    try {
      await updateEmailLabel(row.id, label)
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, label } : r))
    } catch (err) { showToast('Label update failed: ' + err.message) }
  }

  async function toggleBulk(row, e) {
    e.stopPropagation()
    const newVal = !row.bulk
    try {
      await updateEmailBulk(row.id, newVal)
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, bulk: newVal } : r))
    } catch (err) { showToast('Error: ' + err.message) }
  }

  // ── Submit quick entry ───────────────────────────────
  async function submitQuick() {
    const normLink = normalizeLink(link)
    if (!normLink) return
    if (!vendor.trim() && linkStatus !== 'thread') {
      showToast('Enter a vendor name for new links')
      quickRef.current?.focus()
      return
    }
    if (submitting) return
    const today = todayISO()

    setSubmitting(true)
    try {
      const existing = linkThread || await findEmailByLink(me.id, normLink, today)
      if (existing) {
        await incrementEmailReplies(existing.id, existing.replies)
        setRows(prev => prev.map(r => r.id === existing.id ? { ...r, replies: r.replies + 1 } : r))
        showToast(`Reply added · ${existing.vendor || normLink}`)
        setVendor(''); setLink(''); setLinkStatus(null); setLinkThread(null)
        fetchKpis()
        setTimeout(() => quickRef.current?.focus(), 50)
        return
      }

      const now = new Date().toTimeString().slice(0, 5)
      const vendorName = vendor.trim() || normLink
      const tempId = 'temp_' + Date.now()
      const optimistic = {
        id: tempId, member_id: me.id, date: today,
        vendor: vendorName, link: normLink, time: now, replies: 0, label: null, bulk: bulkEntry,
        created_at: new Date().toISOString()
      }
      if (filter === 'today' || filter === 'all') setRows(prev => [optimistic, ...prev])

      const saved = await addEmail({ memberId: me.id, date: today, vendor: vendorName, link: normLink, time: now, bulk: bulkEntry })
      setRows(prev => prev.map(r => r.id === tempId ? saved : r))
      showToast(`Logged · ${vendorName}`)
      setVendor(''); setLink(''); setBulkEntry(false); setLinkStatus(null); setLinkThread(null)
      fetchKpis()
    } catch (err) {
      setRows(prev => prev.filter(r => !r.id?.startsWith('temp_')))
      showToast('Failed: ' + err.message)
    } finally {
      setSubmitting(false)
      setTimeout(() => quickRef.current?.focus(), 50)
    }
  }

  async function handleAddReply(row, e) {
    e.stopPropagation()
    try {
      await incrementEmailReplies(row.id, row.replies)
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, replies: r.replies + 1 } : r))
      fetchKpis()
    } catch (err) { showToast('Error: ' + err.message) }
  }

  async function handleRemoveReply(row, e) {
    e.stopPropagation()
    if (row.replies <= 0) return
    try {
      await decrementEmailReplies(row.id, row.replies)
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, replies: r.replies - 1 } : r))
      fetchKpis()
    } catch (err) { showToast('Error: ' + err.message) }
  }

  // Parse a single paste line: handles Google Sheets tab-separated and plain Missive links
  function parseBulkLine(line) {
    // Google Sheets paste: tab-separated columns
    if (line.includes('\t')) {
      const parts = line.split('\t').map(p => p.trim()).filter(Boolean)
      const linkPart   = parts.find(p => /missive\.app\//i.test(p) || /^https?:\/\//i.test(p))
      const vendorPart = parts.find(p => p !== linkPart && p.length > 0) || ''
      if (linkPart) return { link: normalizeLink(linkPart), vendor: vendorPart || 'Untagged' }
    }
    // Missive link pattern anywhere in line
    const m = line.match(/(missive\.app\/[\w\d]+)/i)
    if (m) {
      const vendor = line.replace(m[0], '').replace(/[—\-|·,\t]/g, '').trim() || 'Untagged'
      return { link: m[1], vendor }
    }
    // Plain URL
    return { link: normalizeLink(line), vendor: 'Untagged' }
  }

  async function submitBulk() {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    const today = todayISO()
    const now = new Date().toTimeString().slice(0, 5)
    let imported = 0
    for (const line of lines) {
      const { link: linkVal, vendor: vendorName } = parseBulkLine(line)
      if (!linkVal) continue
      try {
        const existing = await findEmailByLink(me.id, linkVal, today)
        if (existing) { await incrementEmailReplies(existing.id, existing.replies) }
        else { await addEmail({ memberId: me.id, date: today, vendor: vendorName, link: linkVal, time: now }); imported++ }
      } catch { /* skip bad lines */ }
    }
    setBulkText(''); setBulkOpen(false)
    showToast(`Imported ${imported} new entries`)
    fetchRows(); fetchKpis()
  }

  async function delRow(id, e) {
    e.stopPropagation()
    try {
      await deleteEmail(id)
      setRows(prev => prev.filter(r => r.id !== id))
      setSelectedRows(prev => { const s = new Set(prev); s.delete(id); return s })
      showToast('Deleted')
      fetchKpis()
    } catch (err) { showToast('Delete failed: ' + err.message) }
  }

  async function deleteSelected() {
    const ids = [...selectedRows]
    try {
      await Promise.all(ids.map(id => deleteEmail(id)))
      setRows(prev => prev.filter(r => !selectedRows.has(r.id)))
      setSelectedRows(new Set())
      showToast(`Deleted ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}`)
      fetchKpis()
    } catch (err) { showToast('Bulk delete failed: ' + err.message) }
  }

  function toggleRow(id) {
    setSelectedRows(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  function toggleAll(editableIds) {
    if (editableIds.every(id => selectedRows.has(id))) {
      setSelectedRows(new Set()) // all already selected → deselect all
    } else {
      setSelectedRows(new Set(editableIds)) // select all editable
    }
  }

  const myTarget = 40
  // Neel is on a separate track — exclude from email log member filter
  const members  = TEAM.filter(m => m.role === 'member' && !m.neelOnly)
  // Time column only visible to lead/HR/super
  const showTime = ['lead', 'hr', 'super'].includes(me.role)
  const colTemplate = showTime
    ? '28px 40px 80px 54px 0.85fr 1fr 100px 44px 96px 78px 28px'
    : '28px 40px 80px 0.85fr 1fr 100px 44px 96px 78px 28px'

  const linkHint = linkStatus === 'thread'
    ? `↩ Known thread · "${linkThread?.vendor}" · Log Entry will add a reply (vendor optional)`
    : linkStatus === 'new'
    ? '✦ New link — vendor name required'
    : 'Tab between fields · same link logged today → auto-increments replies instead of new row'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Email Log</h1>
          <div className="sub">Track every outbound. ~40/day soft target.</div>
        </div>
        <div className="actions">
          <span className="seg">
            <button className={mode === 'quick' ? 'on' : ''} onClick={() => setMode('quick')}>Quick add</button>
            <button className={mode === 'grid'  ? 'on' : ''} onClick={() => setMode('grid')}>Keyboard grid</button>
            <button className={mode === 'bulk'  ? 'on' : ''} onClick={() => { setMode('bulk'); setBulkOpen(true) }}>Bulk paste</button>
          </span>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="kpi-label">Email responses</div>
          <div className="kpi-value">
            {myTodayCount}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / {myTarget}</span>
          </div>
          <div className="bar thin">
            <div className="bar-fill" style={{ width: Math.min(100, Math.round(myTodayCount / myTarget * 100)) + '%' }} />
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Team today</div>
          <div className="kpi-value">{teamTodayCount}</div>
          <div className="kpi-target">{members.length} members</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Showing</div>
          <div className="kpi-value">{rows.length}</div>
          <div className="kpi-target">entries in view</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg per member</div>
          <div className="kpi-value">{members.length > 0 ? Math.round(teamTodayCount / members.length) : 0}</div>
          <div className="kpi-target">emails today</div>
        </div>
      </div>

      {/* ── Quick / Bulk add bar ── */}
      {(mode === 'quick' || mode === 'bulk') && (
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="plus" size={14} />
            <input ref={quickRef} className="input"
                   placeholder={linkStatus === 'thread' ? `Vendor (optional — replying to ${linkThread?.vendor})` : 'Vendor name…'}
                   style={{ flex: '1 1 220px', maxWidth: 300, opacity: linkStatus === 'thread' ? 0.55 : 1 }}
                   value={vendor}
                   autoComplete="off"
                   onChange={e => setVendor(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') linkRef.current?.focus() }} />
            <input ref={linkRef} className="input"
                   placeholder="Missive link or URL…"
                   style={{
                     flex: 1,
                     fontFamily: 'var(--font-mono)',
                     borderColor: linkStatus === 'thread' ? 'var(--accent)' : undefined
                   }}
                   value={link}
                   onChange={e => setLink(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') submitQuick() }} />
            {/* Bulk checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: bulkEntry ? 'var(--text)' : 'var(--text-faint)', cursor: 'pointer', flexShrink: 0, userSelect: 'none' }}>
              <input type="checkbox" checked={bulkEntry} onChange={e => setBulkEntry(e.target.checked)}
                     style={{ accentColor: 'var(--accent)', width: 13, height: 13 }} />
              Bulk?
            </label>
            {linkStatus === 'thread' && (
              <span className="chip" style={{ background: 'rgba(210,254,92,.12)', color: 'var(--accent)', fontSize: 11, flexShrink: 0 }}>
                ↩ Thread
              </span>
            )}
            <button className="btn" onClick={() => setBulkOpen(true)}>
              <Icon name="upload" size={12} />Bulk <span className="kbd">B</span>
            </button>
            <button className="btn primary" onClick={submitQuick} disabled={submitting}>
              {submitting ? 'Saving…' : <>{linkStatus === 'thread' ? '↩ Add reply' : 'Log entry'} <span className="kbd">↵</span></>}
            </button>
          </div>
          <div className="hint-line" style={{ marginTop: 8 }}>
            <Icon name="zap" size={11} />
            <span style={{ color: linkStatus === 'thread' ? 'var(--accent)' : undefined }}>{linkHint}</span>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {/* Date range */}
        <span className="seg">
          <button className={filter === 'today' ? 'on' : ''} onClick={() => setFilter('today')}>Today</button>
          <button className={filter === 'week'  ? 'on' : ''} onClick={() => setFilter('week')}>Week</button>
          <button className={filter === 'all'   ? 'on' : ''} onClick={() => setFilter('all')}>All time</button>
        </span>

        {/* Label filter */}
        <span className="seg">
          <button className={!filterLabel ? 'on' : ''} onClick={() => setFilterLabel(null)}>All labels</button>
          {LABELS.map(l => (
            <button key={l.id} className={filterLabel === l.id ? 'on' : ''}
                    onClick={() => setFilterLabel(filterLabel === l.id ? null : l.id)}>
              {l.dot} {l.label}
            </button>
          ))}
        </span>

        {/* Member filter — names only, no duplicate "Just me" */}
        <span className="seg">
          <button className={filterMember === 'all' ? 'on' : ''} onClick={() => setFilterMember('all')}>Everyone</button>
          {members.map(m => (
            <button key={m.id} className={filterMember === m.id ? 'on' : ''} onClick={() => setFilterMember(m.id)}>
              {m.name.split(' ')[0]}
            </button>
          ))}
        </span>

        {/* Search */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <input className="input" placeholder="Search vendor or link…" style={{ width: 240, paddingLeft: 28 }}
                 value={search} onChange={e => setSearch(e.target.value)} />
          <span style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-faint)' }}>
            <Icon name="search" size={13} />
          </span>
        </div>
      </div>

      {/* ── Selection action bar ── */}
      {selectedRows.size > 0 && (
        <div style={{
          marginBottom: 8, padding: '9px 14px',
          background: 'var(--accent)', color: 'var(--accent-ink)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, fontWeight: 500,
        }}>
          <span>{selectedRows.size} row{selectedRows.size !== 1 ? 's' : ''} selected</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => setSelectedRows(new Set())}
                  style={{ background: 'rgba(0,0,0,0.15)', border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: 'inherit' }}>
            Deselect all
          </button>
          <button onClick={deleteSelected}
                  style={{ background: 'rgba(0,0,0,0.25)', border: 'none', borderRadius: 5, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'inherit' }}>
            🗑 Delete {selectedRows.size}
          </button>
        </div>
      )}

      {/* ── Email grid ── */}
      <div className="email-grid" style={{'--eg-cols': colTemplate}}>
        {(() => {
          const editableIds = rows
            .filter(r => r.member_id === me.id || ['lead','hr','super'].includes(me.role))
            .map(r => r.id)
          const allSelected = editableIds.length > 0 && editableIds.every(id => selectedRows.has(id))
          const someSelected = editableIds.some(id => selectedRows.has(id))
          return (
            <div className="eg-head">
              <div style={{ textAlign: 'center', padding: '8px 6px' }}>
                {editableIds.length > 0 && (
                  <input type="checkbox"
                         checked={allSelected}
                         ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                         onChange={() => toggleAll(editableIds)}
                         style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }} />
                )}
              </div>
              <div>#</div>
              <div>Date</div>
              {showTime && <div>Time</div>}
              <div>Vendor</div>
              <div>Link</div>
              <div>Label</div>
              <div style={{ textAlign: 'center' }}>Bulk?</div>
              <div>Replies</div>
              <div>By</div>
              <div></div>
            </div>
          )
        })()}

        {mode === 'grid' && (
          <div className="eg-row add">
            <div></div>
            <div className="num">+</div>
            <div className="muted mono">{fmtDateShort(todayISO())}</div>
            {showTime && <div className="mono muted">now</div>}
            <div><input className="input-bare" placeholder="Vendor…" autoComplete="off" value={vendor} onChange={e => setVendor(e.target.value)} /></div>
            <div><input className="input-bare mono" placeholder="missive.app/…" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitQuick()} /></div>
            <div>—</div>
            <div style={{ textAlign: 'center' }}>—</div>
            <div>—</div>
            <div className="row-flex"><div className={`avatar sm ${me.color}`}>{me.short}</div></div>
            <div><button className="btn primary" style={{ height: 22, padding: '0 8px', fontSize: 11 }} onClick={submitQuick}>↵</button></div>
          </div>
        )}

        {loading && <div className="empty">Loading…</div>}

        {!loading && rows.map((r, idx) => {
          const member  = TEAM.find(m => m.id === r.member_id)
          const canEdit = r.member_id === me.id || ['lead','hr','super'].includes(me.role)
          const href    = r.link.startsWith('http') ? r.link : `https://${r.link}`
          const isSelected = selectedRows.has(r.id)
          return (
            <div key={r.id} className="eg-row" style={isSelected ? { background: 'rgba(210,254,92,0.06)' } : {}}>
              <div style={{ textAlign: 'center', padding: '8px 6px' }}>
                {canEdit && (
                  <input type="checkbox" checked={isSelected} onChange={() => toggleRow(r.id)}
                         onClick={e => e.stopPropagation()}
                         style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }} />
                )}
              </div>
              <div className="num" style={{ color: 'var(--text-faint)', fontSize: 11 }}>{idx + 1}</div>
              <div className="muted mono">{fmtDateShort(r.date)}</div>
              {showTime && <div className="mono muted">{r.time}</div>}
              <div className="vendor">{r.vendor || <span className="muted">—</span>}</div>
              <div className="link">
                <a href={href} target="_blank" rel="noreferrer"
                   onClick={e => e.stopPropagation()}
                   style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="link" size={10} />{r.link}
                </a>
              </div>

              {/* Label cell */}
              <div className="label-cell">
                {r.label
                  ? <LabelChip label={r.label} onClick={canEdit ? e => openLabelMenu(e, r) : undefined} />
                  : canEdit
                    ? <button className="label-add-btn" onClick={e => openLabelMenu(e, r)}>+ label</button>
                    : <span className="muted" style={{ fontSize: 11 }}>—</span>
                }
              </div>

              {/* Bulk? checkbox */}
              <div style={{ textAlign: 'center' }}>
                {canEdit
                  ? <input type="checkbox" checked={!!r.bulk} onChange={e => toggleBulk(r, e)}
                           style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }}
                           title={r.bulk ? 'Bulk email (target relaxed)' : 'Mark as bulk'} />
                  : r.bulk ? <span style={{ fontSize: 11 }}>✓</span> : null
                }
              </div>

              {/* Replies cell */}
              <div className="replies-cell">
                {canEdit && r.replies > 0 && (
                  <button className="reply-add-btn" onClick={e => handleRemoveReply(r, e)} title="Remove reply" style={{ color: 'var(--text-faint)' }}>−</button>
                )}
                {r.replies > 0 && <span className="reply-count">↩ {r.replies}</span>}
                {canEdit && (
                  <button className="reply-add-btn" onClick={e => handleAddReply(r, e)} title="Add reply">+</button>
                )}
              </div>

              {/* By */}
              <div className="row-flex">
                <div className={`avatar sm ${member?.color}`}>{member?.short}</div>
                <span className="muted" style={{ fontSize: 12 }}>{member?.name.split(' ')[0]}</span>
              </div>

              {/* Delete */}
              <div>
                {canEdit
                  ? <button className="btn ghost" style={{ width: 22, height: 22, padding: 0 }}
                      onClick={e => delRow(r.id, e)} title="Delete">
                      <Icon name="trash" size={11} />
                    </button>
                  : <Icon name="more" size={12} />
                }
              </div>
            </div>
          )
        })}

        {!loading && rows.length === 0 && (
          <div className="empty">No emails match — try a different filter</div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="row-flex" style={{ marginTop: 12 }}>
        <span className="faint" style={{ fontSize: 12 }}>
          {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
        </span>
        <div className="spacer" />
        <div className="hint-line">
          <span className="kbd">N</span> new ·&nbsp;
          <span className="kbd">B</span> bulk ·&nbsp;
          <span className="kbd">Esc</span> close menu
        </div>
      </div>

      {/* ── Label menu portal (fixed, outside overflow:hidden grid) ── */}
      {labelMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setLabelMenu(null)} />
          <div className="label-menu" style={{ position: 'fixed', top: labelMenu.y, left: labelMenu.x, zIndex: 100 }}>
            {LABELS.map(l => (
              <button key={l.id} onClick={() => applyLabel(l.id)}>
                <span className={`label-chip lc-${l.id}`} style={{ pointerEvents: 'none' }}>{l.dot} {l.label}</span>
              </button>
            ))}
            {labelMenu.row.label && (
              <button className="remove-label" onClick={() => applyLabel(null)}>✕ Remove label</button>
            )}
          </div>
        </>
      )}

      {/* ── Bulk modal ── */}
      {bulkOpen && (
        <div className="modal-back" onClick={() => setBulkOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Bulk paste from Missive</h2>
              <button className="btn ghost" onClick={() => setBulkOpen(false)}><Icon name="x" size={13} /></button>
            </div>
            <div className="modal-body">
              <div className="label">Paste lines · one per email</div>
              <textarea className="input"
                        style={{ width: '100%', height: 220, padding: 12, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}
                        placeholder={"Acme Imports — missive.app/8472634\nGlobex Wholesale | missive.app/8472711\nmissive.app/8472899 Northwind Apparel"}
                        value={bulkText} onChange={e => setBulkText(e.target.value)} />
              <div className="hint-line" style={{ marginTop: 10 }}>
                <Icon name="zap" size={11} />
                <span>Same link already logged today → increments replies, not a new row.</span>
              </div>
              <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
                <span className="muted">Preview · </span>
                <span className="mono">{bulkText.split('\n').filter(l => l.trim()).length} lines</span>
                <span className="muted"> · </span>
                <span className="mono">{bulkText.match(/missive\.app\/\d+/gi)?.length || 0} links detected</span>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setBulkOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={submitBulk} disabled={!bulkText.trim()}>
                Import {bulkText.split('\n').filter(l => l.trim()).length || ''} entries
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

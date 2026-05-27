import { useState, useEffect, useRef, useCallback } from 'react'
import { TEAM, VENDORS, Icon, todayISO, fmtDateShort } from '../data.jsx'
import {
  loadEmailLogs, addEmail, findEmailByLink,
  incrementEmailReplies, updateEmailLabel, deleteEmail,
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
    <span className={`label-chip lc-${label}`} onClick={onClick} title={`Label: ${def.label}`}>
      {def.dot} {def.label}
    </span>
  )
}

function LabelMenu({ row, onApply, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div className="label-menu" ref={ref}>
      {LABELS.map(l => (
        <button key={l.id} onClick={() => onApply(l.id)}>
          <span className={`label-chip lc-${l.id}`} style={{ pointerEvents: 'none' }}>{l.dot} {l.label}</span>
        </button>
      ))}
      {row.label && (
        <button className="remove-label" onClick={() => onApply(null)}>✕ Remove label</button>
      )}
    </div>
  )
}

export function EmailLogPage({ me, setRoute, showToast, focusEmailOnMount, bulkPasteOnMount }) {
  const [mode, setMode]               = useState('quick')
  const [vendor, setVendor]           = useState('')
  const [link, setLink]               = useState('')
  const [filter, setFilter]           = useState('today')
  const [filterMember, setFilterMember] = useState('all')
  const [filterLabel, setFilterLabel] = useState(null)
  const [search, setSearch]           = useState('')
  const [bulkText, setBulkText]       = useState('')
  const [rows, setRows]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [submitting, setSubmitting]   = useState(false)
  const [myTodayCount, setMyTodayCount]   = useState(0)
  const [teamTodayCount, setTeamTodayCount] = useState(0)
  const [bulkOpen, setBulkOpen]       = useState(false)
  const [labelMenuRow, setLabelMenuRow] = useState(null)

  // Link-status detection (vendor becomes optional for known threads)
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
      if (e.key === 'Escape') setLabelMenuRow(null)
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
    try {
      const memberId = filterMember === 'me' ? me.id
                     : filterMember === 'all' ? null
                     : filterMember
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

  // ── Submit ───────────────────────────────────────────
  async function submitQuick() {
    const normLink = normalizeLink(link)
    if (!normLink) return
    // Vendor required only for new links
    if (!vendor.trim() && linkStatus !== 'thread') {
      showToast('Enter a vendor name for new links')
      quickRef.current?.focus()
      return
    }
    if (submitting) return
    const today = todayISO()

    setSubmitting(true)
    try {
      // Re-check for dup (in case status check is still in flight)
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
        vendor: vendorName, link: normLink, time: now, replies: 0, label: null,
        created_at: new Date().toISOString()
      }
      if (filter === 'today' || filter === 'all') setRows(prev => [optimistic, ...prev])

      const saved = await addEmail({ memberId: me.id, date: today, vendor: vendorName, link: normLink, time: now })
      setRows(prev => prev.map(r => r.id === tempId ? saved : r))
      showToast(`Logged · ${vendorName}`)
      setVendor(''); setLink(''); setLinkStatus(null); setLinkThread(null)
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
    } catch (err) { showToast('Error: ' + err.message) }
  }

  async function applyLabel(row, label) {
    setLabelMenuRow(null)
    try {
      await updateEmailLabel(row.id, label)
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, label } : r))
    } catch (err) { showToast('Label update failed: ' + err.message) }
  }

  async function submitBulk() {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    const today = todayISO()
    const now = new Date().toTimeString().slice(0, 5)
    let imported = 0
    for (const line of lines) {
      const m = line.match(/(missive\.app\/\d+)/i)
      const linkVal  = m ? m[1] : normalizeLink(line)
      const vendorName = m ? line.replace(m[0], '').replace(/[—\-|·,]/g, '').trim() || 'Untagged' : 'Untagged'
      try {
        const existing = await findEmailByLink(me.id, linkVal, today)
        if (existing) { await incrementEmailReplies(existing.id, existing.replies) }
        else { await addEmail({ memberId: me.id, date: today, vendor: vendorName, link: linkVal, time: now }); imported++ }
      } catch { /* skip */ }
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
      showToast('Deleted')
      fetchKpis()
    } catch (err) { showToast('Delete failed: ' + err.message) }
  }

  const myTarget = 30
  const members = TEAM.filter(m => m.role === 'member')

  // ── Link status hint ─────────────────────────────────
  const linkHint = linkStatus === 'thread'
    ? `↩ Known thread · "${linkThread?.vendor || normLink}" · Log Entry will add a reply (vendor optional)`
    : linkStatus === 'new'
    ? '✦ New link — vendor name required'
    : 'Tab between fields · paste link · duplicate today → auto-adds reply instead of new row'

  function normLink() { return link.trim().replace(/^https?:\/\//, '') }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Email Log</h1>
          <div className="sub">Track every outbound. ~30/day soft target.</div>
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
          <div className="kpi-label">My emails today</div>
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
          <div className="kpi-target">in current view</div>
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
                   style={{ flex: '1 1 220px', maxWidth: 300, opacity: linkStatus === 'thread' ? 0.6 : 1 }}
                   value={vendor}
                   list="vendors-list"
                   onChange={e => setVendor(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') linkRef.current?.focus() }} />
            <datalist id="vendors-list">{VENDORS.map(v => <option key={v} value={v} />)}</datalist>
            <input ref={linkRef} className="input"
                   placeholder="Missive link or URL…"
                   style={{
                     flex: 1,
                     fontFamily: 'var(--font-mono)',
                     borderColor: linkStatus === 'thread' ? 'var(--accent)' : linkStatus === 'new' ? 'var(--border)' : undefined
                   }}
                   value={link}
                   onChange={e => setLink(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') submitQuick() }} />
            {linkStatus === 'checking' && <span className="muted" style={{ fontSize: 12 }}>…</span>}
            {linkStatus === 'thread' && (
              <span className="chip" style={{ background: 'rgba(210,254,92,.12)', color: 'var(--accent)', fontSize: 11 }}>
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
            <button key={l.id} className={filterLabel === l.id ? 'on' : ''} onClick={() => setFilterLabel(filterLabel === l.id ? null : l.id)}>
              {l.dot} {l.label}
            </button>
          ))}
        </span>

        {/* Member filter */}
        <span className="seg">
          <button className={filterMember === 'all' ? 'on' : ''} onClick={() => setFilterMember('all')}>Everyone</button>
          <button className={filterMember === 'me'  ? 'on' : ''} onClick={() => setFilterMember('me')}>Just me</button>
          {filter === 'all' && members.map(m => (
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
          <span className="kbd" style={{ position: 'absolute', right: 8, top: 7 }}>/</span>
        </div>
      </div>

      {/* ── Email grid ── */}
      <div className="email-grid">
        <div className="eg-head">
          <div>SR</div>
          <div>Date</div>
          <div>Time</div>
          <div>Vendor</div>
          <div>Missive Link</div>
          <div>Label</div>
          <div>Replies</div>
          <div>By</div>
          <div></div>
        </div>

        {mode === 'grid' && (
          <div className="eg-row add">
            <div className="num">+</div>
            <div className="muted mono">{fmtDateShort(todayISO())}</div>
            <div className="mono muted">now</div>
            <div>
              <input className="input-bare" placeholder="Vendor…" value={vendor}
                     onChange={e => setVendor(e.target.value)} list="vendors-list" />
            </div>
            <div>
              <input className="input-bare mono" placeholder="missive.app/…" value={link}
                     onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitQuick()} />
            </div>
            <div>—</div>
            <div>—</div>
            <div className="row-flex"><div className={`avatar sm ${me.color}`}>{me.short}</div></div>
            <div>
              <button className="btn primary" style={{ height: 22, padding: '0 8px', fontSize: 11 }} onClick={submitQuick}>↵</button>
            </div>
          </div>
        )}

        {loading && <div className="empty">Loading…</div>}

        {!loading && rows.map((r, idx) => {
          const member = TEAM.find(m => m.id === r.member_id)
          const canEdit = r.member_id === me.id || me.role === 'lead'
          const showLabelMenu = labelMenuRow === r.id

          return (
            <div key={r.id} className="eg-row">
              <div className="num">{String(idx + 1).padStart(4, '0')}</div>
              <div className="muted mono">{fmtDateShort(r.date)}</div>
              <div className="mono muted">{r.time}</div>
              <div className="vendor">{r.vendor || <span className="muted">—</span>}</div>
              <div className="link"><Icon name="link" size={10} /> {r.link}</div>

              {/* Label cell */}
              <div className="label-cell">
                {r.label
                  ? <LabelChip label={r.label} onClick={canEdit ? () => setLabelMenuRow(showLabelMenu ? null : r.id) : undefined} />
                  : canEdit
                    ? <button className="label-add-btn" onClick={() => setLabelMenuRow(showLabelMenu ? null : r.id)}>+ label</button>
                    : <span className="muted" style={{ fontSize: 11 }}>—</span>
                }
                {showLabelMenu && (
                  <LabelMenu
                    row={r}
                    onApply={label => applyLabel(r, label)}
                    onClose={() => setLabelMenuRow(null)}
                  />
                )}
              </div>

              {/* Replies cell */}
              <div className="replies-cell">
                {r.replies > 0 && (
                  <span className="reply-count">↩ {r.replies}</span>
                )}
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
          {filterLabel && <> · filtered by <LabelChip label={filterLabel} /></>}
        </span>
        <div className="spacer" />
        <div className="hint-line">
          <span className="kbd">N</span> new ·&nbsp;
          <span className="kbd">B</span> bulk ·&nbsp;
          <span className="kbd">/</span> search ·&nbsp;
          <span className="kbd">Esc</span> close menu
        </div>
      </div>

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
                <span>Same link already logged today → increments replies count, not a new row.</span>
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

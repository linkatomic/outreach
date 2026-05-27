import { useState, useEffect, useRef, useCallback } from 'react'
import { TEAM, VENDORS, Icon, todayISO, fmtDateShort } from '../data.jsx'
import {
  loadEmailLogs, addEmail, findEmailByLink,
  incrementEmailReplies, deleteEmail,
  getEmailCountToday, getTeamEmailCountToday
} from '../lib/supabase.js'

export function EmailLogPage({ me, setRoute, showToast, focusEmailOnMount, bulkPasteOnMount }) {
  const [mode, setMode] = useState('quick')
  const [vendor, setVendor] = useState('')
  const [link, setLink] = useState('')
  const [filter, setFilter] = useState('today')
  const [filterMember, setFilterMember] = useState('all')
  const [search, setSearch] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [myTodayCount, setMyTodayCount] = useState(0)
  const [teamTodayCount, setTeamTodayCount] = useState(0)
  const [bulkOpen, setBulkOpen] = useState(false)
  const quickRef = useRef(null)
  const linkRef = useRef(null)

  useEffect(() => { if (bulkPasteOnMount) setBulkOpen(true) }, [bulkPasteOnMount])
  useEffect(() => {
    if (focusEmailOnMount && quickRef.current) quickRef.current.focus()
  }, [focusEmailOnMount])

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickRef.current?.focus() }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setBulkOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const memberId = filterMember === 'me' ? me.id : filterMember === 'all' ? null : filterMember
      const data = await loadEmailLogs({ filter, memberId, search })
      setRows(data)
    } catch (err) {
      showToast('Failed to load emails: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [filter, filterMember, me.id, search])

  useEffect(() => { fetchRows() }, [fetchRows])

  const fetchKpis = useCallback(async () => {
    try {
      const [mine, team] = await Promise.all([
        getEmailCountToday(me.id),
        getTeamEmailCountToday()
      ])
      setMyTodayCount(mine)
      setTeamTodayCount(team)
    } catch { /* silent */ }
  }, [me.id])

  useEffect(() => { fetchKpis() }, [fetchKpis])

  function normalizeLink(raw) {
    return raw.trim().replace(/^https?:\/\//, '')
  }

  async function submitQuick() {
    if (!vendor.trim() || !link.trim()) return
    if (submitting) return
    const today = todayISO()
    const normLink = normalizeLink(link)
    const vendorName = vendor.trim()

    setSubmitting(true)
    try {
      // Check for duplicate link today
      const existing = await findEmailByLink(me.id, normLink, today)
      if (existing) {
        // Increment replies on existing row
        await incrementEmailReplies(existing.id, existing.replies)
        setRows(prev => prev.map(r =>
          r.id === existing.id ? { ...r, replies: r.replies + 1 } : r
        ))
        showToast(`Reply added to ${existing.vendor} thread`)
        setVendor(''); setLink('')
        fetchKpis()
        setTimeout(() => quickRef.current?.focus(), 50)
        return
      }

      const now = new Date().toTimeString().slice(0, 5)
      // Optimistic insert
      const tempId = 'temp_' + Date.now()
      const optimistic = {
        id: tempId, member_id: me.id, date: today,
        vendor: vendorName, link: normLink, time: now, replies: 0,
        created_at: new Date().toISOString()
      }
      if (filter === 'today' || filter === 'all') {
        setRows(prev => [optimistic, ...prev])
      }

      const saved = await addEmail({ memberId: me.id, date: today, vendor: vendorName, link: normLink, time: now })
      setRows(prev => prev.map(r => r.id === tempId ? saved : r))
      showToast(`Logged · ${vendorName}`)
      setVendor(''); setLink('')
      fetchKpis()
    } catch (err) {
      // Revert optimistic
      setRows(prev => prev.filter(r => !r.id.startsWith('temp_')))
      showToast('Failed to log: ' + err.message)
    } finally {
      setSubmitting(false)
      setTimeout(() => quickRef.current?.focus(), 50)
    }
  }

  async function handleIncrementReplies(row, e) {
    e.stopPropagation()
    try {
      await incrementEmailReplies(row.id, row.replies)
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, replies: r.replies + 1 } : r))
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  async function submitBulk() {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    const today = todayISO()
    const now = new Date().toTimeString().slice(0, 5)
    let imported = 0

    for (const line of lines) {
      const linkMatch = line.match(/(missive\.app\/\d+)/i)
      const linkVal = linkMatch ? linkMatch[1] : normalizeLink(line)
      const vendorName = linkMatch
        ? line.replace(linkMatch[0], '').replace(/[—\-|·,]/g, '').trim() || 'Untagged'
        : 'Untagged'
      try {
        const existing = await findEmailByLink(me.id, linkVal, today)
        if (existing) {
          await incrementEmailReplies(existing.id, existing.replies)
        } else {
          await addEmail({ memberId: me.id, date: today, vendor: vendorName, link: linkVal, time: now })
          imported++
        }
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
      showToast('Row deleted')
      fetchKpis()
    } catch (err) {
      showToast('Delete failed: ' + err.message)
    }
  }

  const myTarget = 30

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
            <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Keyboard grid</button>
            <button className={mode === 'bulk' ? 'on' : ''} onClick={() => { setMode('bulk'); setBulkOpen(true) }}>Bulk paste</button>
          </span>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="kpi-label">My emails today</div>
          <div className="kpi-value">
            {myTodayCount}
            <span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / {myTarget}</span>
          </div>
          <div className="bar thin">
            <div className="bar-fill" style={{ width: Math.min(100, Math.round(myTodayCount / myTarget * 100)) + '%' }}></div>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Team today</div>
          <div className="kpi-value">{teamTodayCount}</div>
          <div className="kpi-target">{TEAM.filter(m => m.role === 'member').length} members reporting</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Showing</div>
          <div className="kpi-value">{rows.length}</div>
          <div className="kpi-target">entries in current view</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg per member</div>
          <div className="kpi-value">{TEAM.filter(m => m.role === 'member').length > 0 ? Math.round(teamTodayCount / TEAM.filter(m => m.role === 'member').length) : 0}</div>
          <div className="kpi-target">emails today</div>
        </div>
      </div>

      {(mode === 'quick' || mode === 'bulk') && (
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="plus" size={14} />
            <input ref={quickRef} className="input"
                   placeholder="Vendor name…"
                   style={{ flex: '1 1 240px', maxWidth: 320 }}
                   value={vendor}
                   list="vendors-list"
                   onChange={(e) => setVendor(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') linkRef.current?.focus() }} />
            <datalist id="vendors-list">{VENDORS.map(v => <option key={v} value={v} />)}</datalist>
            <input ref={linkRef} className="input"
                   placeholder="Missive link or paste URL…"
                   style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                   value={link}
                   onChange={(e) => setLink(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') submitQuick() }} />
            <button className="btn" onClick={() => setBulkOpen(true)}><Icon name="upload" size={12} />Bulk <span className="kbd">B</span></button>
            <button className="btn primary" onClick={submitQuick} disabled={submitting}>
              {submitting ? 'Saving…' : <><span>Log entry</span> <span className="kbd">↵</span></>}
            </button>
          </div>
          <div className="hint-line" style={{ marginTop: 8 }}>
            <Icon name="zap" size={11} />
            <span>Tab between fields · same link logged today → auto-increments replies count instead of new row</span>
          </div>
        </div>
      )}

      <div className="row-flex" style={{ marginBottom: 12 }}>
        <span className="seg">
          <button className={filter === 'today' ? 'on' : ''} onClick={() => setFilter('today')}>Today</button>
          <button className={filter === 'week' ? 'on' : ''} onClick={() => setFilter('week')}>Week</button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        </span>
        <span className="seg">
          <button className={filterMember === 'all' ? 'on' : ''} onClick={() => setFilterMember('all')}>Everyone</button>
          <button className={filterMember === 'me' ? 'on' : ''} onClick={() => setFilterMember('me')}>Just me</button>
          {TEAM.filter(m => m.role === 'member').slice(0, 3).map(m => (
            <button key={m.id} className={filterMember === m.id ? 'on' : ''} onClick={() => setFilterMember(m.id)}>{m.name.split(' ')[0]}</button>
          ))}
        </span>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <input className="input" placeholder="Search vendor or link…" style={{ width: 260, paddingLeft: 28 }}
                 value={search} onChange={(e) => setSearch(e.target.value)} />
          <span style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-faint)' }}><Icon name="search" size={13} /></span>
          <span className="kbd" style={{ position: 'absolute', right: 8, top: 7 }}>/</span>
        </div>
      </div>

      <div className="email-grid">
        <div className="eg-head">
          <div>SR</div>
          <div>Date</div>
          <div>Time</div>
          <div>Vendor</div>
          <div>Missive Link</div>
          <div>Replies</div>
          <div>By</div>
          <div></div>
        </div>
        {mode === 'grid' && (
          <div className="eg-row add">
            <div className="num">+</div>
            <div className="muted mono">{fmtDateShort(todayISO())}</div>
            <div className="mono muted">now</div>
            <div><input className="input-bare" placeholder="Vendor name…" value={vendor} onChange={(e) => setVendor(e.target.value)} list="vendors-list" /></div>
            <div><input className="input-bare mono" placeholder="missive.app/…" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitQuick()} /></div>
            <div className="muted" style={{ fontSize: 12 }}>—</div>
            <div className="row-flex"><div className={`avatar sm ${me.color}`}>{me.short}</div></div>
            <div><button className="btn primary" style={{ height: 22, padding: '0 8px', fontSize: 11 }} onClick={submitQuick}>↵</button></div>
          </div>
        )}
        {loading && <div className="empty">Loading…</div>}
        {!loading && rows.map((r, idx) => {
          const member = TEAM.find(m => m.id === r.member_id)
          const canEdit = r.member_id === me.id || me.role === 'lead'
          return (
            <div key={r.id} className="eg-row">
              <div className="num">{String(idx + 1).padStart(4, '0')}</div>
              <div className="muted mono">{fmtDateShort(r.date)}</div>
              <div className="mono muted">{r.time}</div>
              <div className="vendor">{r.vendor}</div>
              <div className="link"><Icon name="link" size={10} /> {r.link}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {r.replies > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>↩{r.replies}</span>
                )}
                {canEdit && (
                  <button
                    className="btn ghost"
                    style={{ width: 20, height: 20, padding: 0, fontSize: 11, minWidth: 'unset' }}
                    onClick={(e) => handleIncrementReplies(r, e)}
                    title="Add reply"
                  >+</button>
                )}
              </div>
              <div className="row-flex">
                <div className={`avatar sm ${member?.color}`}>{member?.short}</div>
                <span className="muted" style={{ fontSize: 12 }}>{member?.name.split(' ')[0]}</span>
              </div>
              <div>
                {canEdit ? (
                  <button className="btn ghost" style={{ width: 22, height: 22, padding: 0 }}
                    onClick={(e) => delRow(r.id, e)} title="Delete">
                    <Icon name="trash" size={11} />
                  </button>
                ) : <Icon name="more" size={12} />}
              </div>
            </div>
          )
        })}
        {!loading && rows.length === 0 && (
          <div className="empty">No emails match — try a different filter</div>
        )}
      </div>

      <div className="row-flex" style={{ marginTop: 12 }}>
        <span className="faint" style={{ fontSize: 12 }}>{rows.length} entries</span>
        <div className="spacer"></div>
        <div className="hint-line">
          <span className="kbd">N</span> new <span style={{ margin: '0 4px' }}>·</span>
          <span className="kbd">B</span> bulk paste <span style={{ margin: '0 4px' }}>·</span>
          <span className="kbd">/</span> search
        </div>
      </div>

      {bulkOpen && (
        <div className="modal-back" onClick={() => setBulkOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Bulk paste from Missive</h2>
              <button className="btn ghost" onClick={() => setBulkOpen(false)}><Icon name="x" size={13} /></button>
            </div>
            <div className="modal-body">
              <div className="label">Paste lines · one per email</div>
              <textarea className="input"
                        style={{ width: '100%', height: 220, padding: 12, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}
                        placeholder={"Examples:\n\nAcme Imports — missive.app/8472634\nGlobex Wholesale | missive.app/8472711\nmissive.app/8472899 Northwind Apparel"}
                        value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
              <div className="hint-line" style={{ marginTop: 10 }}>
                <Icon name="zap" size={11} />
                <span>Same link logged today → auto-increments replies instead of adding duplicate row.</span>
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

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Icon } from '../data.jsx'
import { loadDailyLog, saveDailyLogEntry, deleteDailyLogEntry } from '../lib/supabase.js'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgoISO(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function MissiveDailyLog({ me }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [logDate, setLogDate] = useState(today())
  const [count, setCount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const fetchEntries = useCallback(() => {
    setLoading(true); setLoadError('')
    loadDailyLog(me?.id).then(setEntries).catch(e => setLoadError(e.message)).finally(() => setLoading(false))
  }, [me?.id])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  // Editing an existing day's row loads it back into the form instead of opening a
  // separate edit mode — saving just upserts on (member_id, log_date) either way.
  function editEntry(e) {
    setLogDate(e.log_date)
    setCount(String(e.count))
    setNote(e.note || '')
  }

  async function handleSave(ev) {
    ev.preventDefault()
    if (!logDate || count === '') return
    setSaving(true); setSaveError('')
    try {
      const saved = await saveDailyLogEntry({ memberId: me?.id, logDate, count: Number(count), note: note.trim() || null })
      setEntries(prev => {
        const without = prev.filter(e => e.log_date !== saved.log_date)
        return [saved, ...without].sort((a, b) => (a.log_date < b.log_date ? 1 : -1))
      })
      setLogDate(today()); setCount(''); setNote('')
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this log entry?')) return
    try {
      await deleteDailyLogEntry(id)
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch (err) {
      setLoadError(err.message)
    }
  }

  const stats = useMemo(() => {
    const weekFloor = daysAgoISO(6)
    const monthFloor = daysAgoISO(29)
    const todayEntry = entries.find(e => e.log_date === today())
    const weekTotal = entries.filter(e => e.log_date >= weekFloor).reduce((s, e) => s + e.count, 0)
    const monthEntries = entries.filter(e => e.log_date >= monthFloor)
    const monthTotal = monthEntries.reduce((s, e) => s + e.count, 0)
    const avgPerLoggedDay = monthEntries.length ? Math.round(monthTotal / monthEntries.length) : 0
    return { today: todayEntry?.count ?? 0, weekTotal, avgPerLoggedDay }
  }, [entries])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Daily Log</h1>
          <div className="sub">A self-logged count of how many emails you sent each day</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24, maxWidth: 700 }}>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Today</span>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{stats.today}</div>
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Last 7 days</span>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{stats.weekTotal}</div>
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Avg / logged day (30d)</span>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{stats.avgPerLoggedDay}</div>
        </div>
      </div>

      <form onSubmit={handleSave} style={{ display: 'flex', gap: 10, alignItems: 'end', marginBottom: 20, maxWidth: 700, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>Date</span>
          <input className="input" type="date" value={logDate} onChange={e => setLogDate(e.target.value)} style={{ fontSize: 13 }} max={today()} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>Emails sent</span>
          <input className="input" type="number" min={0} value={count} onChange={e => setCount(e.target.value)} style={{ fontSize: 13, width: 110 }} placeholder="0" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, flex: 1, minWidth: 180 }}>
          <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>Note (optional)</span>
          <input className="input" value={note} onChange={e => setNote(e.target.value)} style={{ fontSize: 13 }} />
        </label>
        <button className="btn primary" type="submit" disabled={count === '' || saving}>
          {saving ? 'Saving…' : <><Icon name="check" size={12} /> Save</>}
        </button>
      </form>

      {saveError && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16, maxWidth: 700 }}>{saveError}</div>}
      {loadError && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16, maxWidth: 700 }}>{loadError}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>No entries yet.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxWidth: 700, maxHeight: 500 }}>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Emails Sent</th><th>Note</th><th></th><th></th></tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{e.log_date}{e.log_date === today() ? <span className="chip accent" style={{ marginLeft: 6, fontSize: 10 }}>Today</span> : ''}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{e.count}</td>
                  <td style={{ whiteSpace: 'normal', color: 'var(--text-dim)' }}>{e.note || <span className="faint">—</span>}</td>
                  <td><button className="btn ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => editEntry(e)}><Icon name="edit" size={11} /></button></td>
                  <td><button className="btn ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => handleDelete(e.id)}><Icon name="trash" size={11} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Icon } from '../data.jsx'
import { getMissiveConversation, loadDailyLogEntries, addDailyLogEntry, deleteDailyLogEntry } from '../lib/supabase.js'

// Same UUID-from-pasted-link extraction Missive Export / Link Tracker already use — works
// regardless of the exact URL shape (path segment, hash fragment, whatever Missive's web
// app happens to use).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
function extractConversationId(line) {
  const match = line.match(UUID_RE)
  return match ? match[0] : null
}

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
  const [pasteText, setPasteText] = useState('')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const fetchEntries = useCallback(() => {
    setLoading(true); setLoadError('')
    loadDailyLogEntries(me?.id).then(setEntries).catch(e => setLoadError(e.message)).finally(() => setLoading(false))
  }, [me?.id])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  async function handleAdd(ev) {
    ev.preventDefault()
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean)
    const ids = [...new Set(lines.map(extractConversationId).filter(Boolean))]
    if (!ids.length) { setAddError('Paste at least one Missive conversation link'); return }

    setAdding(true); setAddError('')
    try {
      const added = []
      for (const id of ids) {
        let subject = null, webUrl = null
        try {
          const conv = await getMissiveConversation(id)
          subject = conv?.subject || conv?.latest_message_subject || null
          webUrl = conv?.web_url || null
        } catch { /* still log it even if the Missive lookup fails — the link itself is the record */ }
        const row = await addDailyLogEntry({
          memberId: me?.id, logDate, conversationId: id,
          missiveLink: webUrl || lines.find(l => extractConversationId(l) === id),
          subject, note: note.trim() || null,
        })
        added.push(row)
      }
      setEntries(prev => [...added, ...prev].sort((a, b) => (a.log_date < b.log_date ? 1 : a.log_date > b.log_date ? -1 : (a.created_at < b.created_at ? 1 : -1))))
      setPasteText(''); setNote('')
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
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
    const todayCount = entries.filter(e => e.log_date === today()).length
    const weekCount = entries.filter(e => e.log_date >= weekFloor).length
    const monthEntries = entries.filter(e => e.log_date >= monthFloor)
    const loggedDays = new Set(monthEntries.map(e => e.log_date)).size
    const avgPerLoggedDay = loggedDays ? Math.round(monthEntries.length / loggedDays) : 0
    return { today: todayCount, weekCount, avgPerLoggedDay }
  }, [entries])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Daily Log</h1>
          <div className="sub">Paste the Missive link for each email you send — your daily count comes from what's actually logged</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24, maxWidth: 700 }}>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Today</span>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{stats.today}</div>
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Last 7 days</span>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{stats.weekCount}</div>
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Avg / logged day (30d)</span>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{stats.avgPerLoggedDay}</div>
        </div>
      </div>

      <form onSubmit={handleAdd} style={{ maxWidth: 700, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
            <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>Date</span>
            <input className="input" type="date" value={logDate} onChange={e => setLogDate(e.target.value)} style={{ fontSize: 13 }} max={today()} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, flex: 1, minWidth: 200 }}>
            <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>Note (optional, applies to all pasted below)</span>
            <input className="input" value={note} onChange={e => setNote(e.target.value)} style={{ fontSize: 13 }} />
          </label>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, marginBottom: 10 }}>
          <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>Missive link(s) — one per line</span>
          <textarea
            className="input"
            rows={3}
            style={{ fontSize: 13, fontFamily: 'var(--font-mono)', width: '100%', resize: 'vertical' }}
            placeholder={'https://mail.missiveapp.com/#inbox/conversations/68d8...\nhttps://mail.missiveapp.com/#inbox/conversations/7a2f...'}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            disabled={adding}
          />
        </label>
        <button className="btn primary" type="submit" disabled={!pasteText.trim() || adding}>
          {adding ? 'Logging…' : <><Icon name="plus" size={12} /> Log Email{pasteText.includes('\n') ? 's' : ''}</>}
        </button>
      </form>

      {addError && <div style={{ background: 'rgba(255,197,61,.08)', border: '1px solid rgba(255,197,61,.2)', color: '#ffc53d', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16, maxWidth: 700 }}>{addError}</div>}
      {loadError && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16, maxWidth: 700 }}>{loadError}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>No entries yet.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxWidth: 900, maxHeight: 560 }}>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Subject</th><th>Note</th><th></th><th></th></tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {e.log_date}{e.log_date === today() && <span className="chip accent" style={{ marginLeft: 6, fontSize: 10 }}>Today</span>}
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{e.subject || <span className="faint">(no subject)</span>}</td>
                  <td style={{ whiteSpace: 'normal', color: 'var(--text-dim)' }}>{e.note || <span className="faint">—</span>}</td>
                  <td>{e.missive_link && <a href={e.missive_link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open →</a>}</td>
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

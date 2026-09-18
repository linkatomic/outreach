import { useState } from 'react'
import { Icon } from '../data.jsx'
import { listCrispConversationsPage, getCrispTranscript } from '../lib/supabase.js'

const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

export function CrispChatExport() {
  const [fromDate, setFromDate] = useState(todayISO())
  const [toDate, setToDate] = useState(todayISO())

  const [listing, setListing] = useState(false)
  const [listError, setListError] = useState('')
  const [conversations, setConversations] = useState(null) // [{sessionId, nickname, email, state, createdAt}]

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [finalText, setFinalText] = useState(null)
  const [totalMessages, setTotalMessages] = useState(0)

  const canFind = fromDate && toDate && !listing
  const canExport = !!conversations?.length && !exporting

  async function findConversations() {
    setListing(true); setListError('')
    setConversations(null); setFinalText(null)
    try {
      const fromMs = new Date(fromDate + 'T00:00:00Z').getTime()
      const toMs = new Date(toDate + 'T23:59:59Z').getTime()
      if (toMs < fromMs) throw new Error('End date is before start date')

      const all = []
      for (let page = 1; page <= 100; page++) { // 100 pages * 20/page = 2000 conversations, a generous ceiling
        const batch = await listCrispConversationsPage(fromMs, toMs, page)
        all.push(...batch)
        if (batch.length < 20) break
      }
      setConversations(all)
    } catch (err) {
      setListError(err.message)
    } finally {
      setListing(false)
    }
  }

  async function exportAll() {
    if (!canExport) return
    setExporting(true); setExportError('')
    setProgress({ done: 0, total: conversations.length })
    const texts = []
    let msgCount = 0
    try {
      for (let i = 0; i < conversations.length; i++) {
        const { text, messageCount } = await getCrispTranscript(conversations[i].sessionId)
        texts.push(text)
        msgCount += messageCount
        setProgress({ done: i + 1, total: conversations.length })
      }
      const combined = texts.join('\n' + '═'.repeat(60) + '\n\n')
      setFinalText(combined)
      setTotalMessages(msgCount)
      downloadText(`crisp-chats-${fromDate}-to-${toDate}.txt`, combined)
    } catch (err) {
      setExportError(err.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 700 }}>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
        Pick a date range and export every Crisp live chat conversation started in it as one
        downloadable transcript file — visitor identity, sender, and real timestamps per message.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
        <div>
          <label style={labelStyle}>From</label>
          <input className="input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={labelStyle}>To</label>
          <input className="input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: '100%' }} />
        </div>
        <button className="btn accent" onClick={findConversations} disabled={!canFind}>
          {listing ? 'Searching…' : <><Icon name="search" size={12} /> Find Conversations</>}
        </button>
      </div>

      {listError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{listError}</div>
      )}

      {conversations && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: conversations.length ? '1px solid var(--border)' : 'none', fontSize: 13, fontWeight: 600 }}>
            {conversations.length} conversation{conversations.length === 1 ? '' : 's'} found
          </div>
          {conversations.length > 0 && (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {conversations.map(c => (
                <div key={c.sessionId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', fontSize: 12, borderTop: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.nickname || c.email || 'Unknown visitor'}
                  </span>
                  <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{c.state}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {conversations?.length > 0 && (
        <div>
          <button className="btn accent" onClick={exportAll} disabled={!canExport}>
            {exporting
              ? `Exporting ${progress.done}/${progress.total}…`
              : <><Icon name="download" size={12} /> Export {conversations.length} Conversation{conversations.length === 1 ? '' : 's'}</>}
          </button>
        </div>
      )}

      {exportError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{exportError}</div>
      )}

      {finalText && !exporting && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--accent)' }}>
            ✓ Exported {conversations.length} conversation{conversations.length === 1 ? '' : 's'} · {totalMessages} messages
          </span>
          <button className="btn ghost" onClick={() => downloadText(`crisp-chats-${fromDate}-to-${toDate}.txt`, finalText)}>
            Download again
          </button>
        </div>
      )}
    </div>
  )
}

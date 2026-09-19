import { useState, useEffect } from 'react'
import JSZip from 'jszip'
import { Icon } from '../data.jsx'
import {
  listMissiveOrganizations, listMissiveSharedLabels,
  listMissiveConversationsPage, getMissiveConversation, getMissiveConversationExport,
} from '../lib/supabase.js'

const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }

const MAILBOXES = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'all', label: 'All' },
  { id: 'assigned', label: 'Assigned to me' },
  { id: 'closed', label: 'Closed' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'trashed', label: 'Trashed' },
  { id: 'junked', label: 'Junked' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'shared_label', label: 'Shared label…' },
]

const PAGE_CAP = 200 // 200 pages * 50/page = 10,000 conversations — a safety ceiling only.
// Missive paginates conversations by cursor (until = oldest last_activity_at from the
// previous page), not by page number, so unlike Crisp's export this can't be fetched in
// concurrent waves — each page's cursor is only known after seeing the previous response.

function toMillis(value) {
  if (value == null) return null
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Missive conversation IDs are UUIDs — pulling one out of a pasted web_url this way means
// it works regardless of the exact URL shape (path segment, hash fragment, query param,
// whatever Missive's web app happens to use), since we never need to parse the rest of it.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
function extractConversationId(line) {
  const match = line.match(UUID_RE)
  return match ? match[0] : null
}

export function MissiveExport() {
  const [mode, setMode] = useState('search') // 'search' | 'links'

  const [organizations, setOrganizations] = useState([])
  const [organizationId, setOrganizationId] = useState('')
  const [orgError, setOrgError] = useState('')

  const [labels, setLabels] = useState([])
  const [mailbox, setMailbox] = useState('inbox')
  const [sharedLabelId, setSharedLabelId] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [maxMessages, setMaxMessages] = useState(30)

  const [linkText, setLinkText] = useState('')

  const [listing, setListing] = useState(false)
  const [listError, setListError] = useState('')
  const [conversations, setConversations] = useState(null)
  const [truncated, setTruncated] = useState(false)

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [zipDone, setZipDone] = useState(false)

  useEffect(() => {
    listMissiveOrganizations()
      .then(orgs => { setOrganizations(orgs); if (orgs.length) setOrganizationId(orgs[0].id) })
      .catch(err => setOrgError(err.message))
  }, [])

  useEffect(() => {
    if (mailbox !== 'shared_label' || !organizationId) return
    listMissiveSharedLabels(organizationId).then(setLabels).catch(() => setLabels([]))
  }, [mailbox, organizationId])

  const canFind = mode === 'links'
    ? linkText.trim().length > 0 && !listing
    : mailbox && (mailbox !== 'shared_label' || sharedLabelId) && !listing
  const canExport = !!conversations?.length && !exporting

  async function findConversations() {
    setListing(true); setListError('')
    setConversations(null); setTruncated(false); setZipDone(false)
    try {
      const fromMs = fromDate ? Date.parse(fromDate + 'T00:00:00.000Z') : null
      const toMs = toDate ? Date.parse(toDate + 'T23:59:59.999Z') : null
      const all = []
      let until = null
      let hitCap = true

      for (let i = 0; i < PAGE_CAP; i++) {
        const page = await listMissiveConversationsPage(mailbox, mailbox === 'shared_label' ? sharedLabelId : null, until, contactEmail.trim() || null)
        if (!page.length) { hitCap = false; break }

        let reachedFloor = false
        for (const c of page) {
          const activityMs = toMillis(c.last_activity_at)
          if (toMs != null && activityMs != null && activityMs > toMs) continue // newer than range
          if (fromMs != null && activityMs != null && activityMs < fromMs) { reachedFloor = true; break }
          all.push(c)
        }

        if (reachedFloor || page.length < 50) { hitCap = false; break }
        until = page[page.length - 1].last_activity_at // raw cursor, untouched
      }

      setTruncated(hitCap)
      setConversations(all)
    } catch (err) {
      setListError(err.message)
    } finally {
      setListing(false)
    }
  }

  async function fetchFromLinks() {
    const lines = linkText.split('\n').map(l => l.trim()).filter(Boolean)
    const ids = [...new Set(lines.map(extractConversationId))]
    const badLines = lines.filter(l => !extractConversationId(l))

    setListing(true); setListError('')
    setConversations(null); setTruncated(false); setZipDone(false)
    try {
      if (!ids.length) throw new Error('No valid Missive conversation links found — paste one link per line')

      const results = new Array(ids.length)
      const errors = []
      const FETCH_CONCURRENCY = 5
      const queue = ids.map((_, i) => i)
      async function worker() {
        while (queue.length) {
          const i = queue.shift()
          try {
            results[i] = await getMissiveConversation(ids[i])
          } catch (err) {
            errors.push(`${ids[i]}: ${err.message}`)
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, worker))

      const found = results.filter(Boolean)
      setConversations(found)
      const problems = [...badLines.map(l => `Not a conversation link: ${l}`), ...errors]
      if (problems.length) setListError(`${found.length} of ${lines.length} fetched. ${problems.join('; ')}`)
    } catch (err) {
      setListError(err.message)
    } finally {
      setListing(false)
    }
  }

  async function exportAll() {
    if (!canExport) return
    setExporting(true); setExportError(''); setZipDone(false)
    setProgress({ done: 0, total: conversations.length })
    try {
      const zip = new JSZip()
      const usedNames = new Set()
      function uniqueName(name) {
        if (!usedNames.has(name)) { usedNames.add(name); return name }
        const base = name.replace(/\.md$/, '')
        let n = 2
        while (usedNames.has(`${base}-${n}.md`)) n++
        const finalName = `${base}-${n}.md`
        usedNames.add(finalName)
        return finalName
      }

      const EXPORT_CONCURRENCY = 3 // Missive allows 5 concurrent, but each export call
      // itself issues several sequential Missive requests internally (message pages +
      // batch body fetch), so this stays conservative rather than compounding bursts.
      const queue = conversations.map((_, i) => i)
      let done = 0
      async function worker() {
        while (queue.length) {
          const i = queue.shift()
          const c = conversations[i]
          const result = await getMissiveConversationExport({
            conversationId: c.id,
            subject: c.subject || c.latest_message_subject,
            webUrl: c.web_url,
            lastActivityAt: c.last_activity_at,
            externalAuthorEmail: c.external_authors?.[0]?.address,
            maxMessages,
          })
          zip.file(uniqueName(result.filename), result.markdown)
          done += 1
          setProgress({ done, total: conversations.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(EXPORT_CONCURRENCY, queue.length) }, worker))

      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(`missive-export-${todayISO()}.zip`, blob)
      setZipDone(true)
    } catch (err) {
      setExportError(err.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 700 }}>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
        Pick a Missive mailbox (and optional date range), export every matching conversation's
        thread as its own Markdown file — quoted prior messages stripped, oldest to newest —
        and download the whole batch as one ZIP.
      </div>

      {orgError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{orgError}</div>
      )}

      <div style={{ display: 'flex', gap: 3, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        {[
          { id: 'search', label: 'Search a mailbox' },
          { id: 'links', label: 'Paste conversation links' },
        ].map(t => (
          <button key={t.id} onClick={() => { setMode(t.id); setConversations(null); setListError('') }} style={{ fontSize: 12, padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: mode === t.id ? 700 : 400, background: mode === t.id ? 'var(--accent)' : 'transparent', color: mode === t.id ? 'var(--accent-ink)' : 'var(--text-faint)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {mode === 'search' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: mailbox === 'shared_label' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Mailbox</label>
              <select className="input" value={mailbox} onChange={e => setMailbox(e.target.value)} style={{ width: '100%' }}>
                {MAILBOXES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            {mailbox === 'shared_label' && (
              <div>
                <label style={labelStyle}>Shared label</label>
                <select className="input" value={sharedLabelId} onChange={e => setSharedLabelId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Select a label…</option>
                  {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Chats with this person (optional)</label>
              <input className="input" type="email" placeholder="vendor@example.com" value={contactEmail} onChange={e => setContactEmail(e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={labelStyle}>From (optional)</label>
              <input className="input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={labelStyle}>To (optional)</label>
              <input className="input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={labelStyle}>Max messages/thread</label>
              <input className="input" type="number" min={1} max={100} value={maxMessages} onChange={e => setMaxMessages(Number(e.target.value) || 30)} style={{ width: '100%' }} />
            </div>
            <button className="btn accent" onClick={findConversations} disabled={!canFind}>
              {listing ? 'Searching…' : <><Icon name="search" size={12} /> Find Conversations</>}
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={labelStyle}>Missive conversation links (one per line)</label>
          <textarea
            className="input"
            placeholder={'https://mail.missiveapp.com/#inbox/conversations/68d8...\nhttps://mail.missiveapp.com/#inbox/conversations/7a2f...'}
            value={linkText}
            onChange={e => setLinkText(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical', minHeight: 100, lineHeight: 1.6 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn accent" onClick={fetchFromLinks} disabled={!canFind}>
              {listing ? 'Fetching…' : <><Icon name="search" size={12} /> Fetch Conversations</>}
            </button>
            <div>
              <label style={{ ...labelStyle, marginBottom: 0, display: 'inline-block' }}>Max messages/thread</label>{' '}
              <input className="input" type="number" min={1} max={100} value={maxMessages} onChange={e => setMaxMessages(Number(e.target.value) || 30)} style={{ width: 70, display: 'inline-block' }} />
            </div>
          </div>
        </div>
      )}

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
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', fontSize: 12, borderTop: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.subject || c.latest_message_subject || '(no subject)'}
                  </span>
                  <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{c.messages_count} msg{c.messages_count === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {truncated && (
        <div style={{ background: 'rgba(255,197,61,.08)', border: '1px solid rgba(255,197,61,.2)', color: '#ffc53d', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
          Hit the 10,000-conversation safety cap for this range — there may be more. Narrow the date range for a complete export.
        </div>
      )}

      {conversations?.length > 0 && (
        <div>
          <button className="btn accent" onClick={exportAll} disabled={!canExport}>
            {exporting
              ? `Exporting ${progress.done}/${progress.total}…`
              : <><Icon name="download" size={12} /> Export {conversations.length} Conversation{conversations.length === 1 ? '' : 's'} as ZIP</>}
          </button>
        </div>
      )}

      {exportError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{exportError}</div>
      )}

      {zipDone && !exporting && (
        <div style={{ fontSize: 12, color: 'var(--accent)' }}>✓ Exported {conversations.length} conversation{conversations.length === 1 ? '' : 's'}</div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import JSZip from 'jszip'
import { Icon } from '../data.jsx'
import {
  listMissiveOrganizations, listMissiveSharedLabels,
  listMissiveConversationsPage, getMissiveConversationExport,
} from '../lib/supabase.js'
import { extractDomains } from '../lib/domainExtract.js'
import { extractSheetId } from '../lib/sheetParserAPI.js'

// The label this tool is built around — matched by name (not a hardcoded ID) so a label
// rename/recreate degrades to "pick it from the dropdown" instead of silently breaking.
const DEFAULT_LABEL_NAME = 'B2B Email V3 [Bargain]'

const PAGE_CAP = 200 // 200 pages * 50/page = 10,000 conversations — a safety ceiling only.

// How many distinct, non-excluded domains have to show up in one thread before it's flagged
// as a bulk-sites deal rather than the usual one-site negotiation (which still naturally
// repeats its own domain several times — that's just one distinct domain, not several).
// Tunable; 3 was picked to stay clear of a normal thread casually mentioning one or two other
// reference sites.
const BULK_DOMAIN_THRESHOLD = 3

// Common mail/webmail and Google-doc-service domains — these show up in almost every thread
// (signatures, the contact's own address, "sent via Gmail" footers) and would otherwise
// drown out genuine site-list signals. Not exhaustive, just the common ones seen in practice;
// easy to extend if a false positive turns up.
const EXCLUDED_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'google.com', 'docs.google.com', 'drive.google.com',
  'sheets.google.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me',
  'zoho.com', 'mail.com', 'missiveapp.com', 'mail.missiveapp.com',
])

// Scans a cleaned thread transcript for the two signals this tool flags: a pasted Google
// Sheets link, or enough distinct (non-excluded) domains mentioned to look like a bulk site
// list rather than a single-site negotiation.
function scanTranscript(markdown, ownDomain) {
  const hasSheet = extractSheetId(markdown) != null
  const domains = extractDomains(null, markdown).filter(d => d !== ownDomain && !EXCLUDED_DOMAINS.has(d))
  return { hasSheet, bulkDomains: domains, isBulk: domains.length >= BULK_DOMAIN_THRESHOLD }
}

function toMillis(value) {
  if (value == null) return null
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function fmtDate(value) {
  const ms = toMillis(value)
  return ms != null ? new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null
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

export function MissiveBargainEmails() {
  const [organizationId, setOrganizationId] = useState('')
  const [orgError, setOrgError] = useState('')

  const [labels, setLabels] = useState([])
  const [labelId, setLabelId] = useState('')
  const [labelsLoaded, setLabelsLoaded] = useState(false)

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const MAX_MESSAGES = 30 // per-thread cap for the export — this tool has no UI control for it, unlike Missive Export, since these threads are closed deals rather than open-ended support chats

  const [listing, setListing] = useState(false)
  const [listError, setListError] = useState('')
  const [conversations, setConversations] = useState(null)
  const [truncated, setTruncated] = useState(false)

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [zipDone, setZipDone] = useState(false)

  const [flagsById, setFlagsById] = useState({}) // conversationId -> { hasSheet, bulkDomains, isBulk }
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 })
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false)

  useEffect(() => {
    listMissiveOrganizations()
      .then(orgs => { if (orgs.length) setOrganizationId(orgs[0].id) })
      .catch(err => setOrgError(err.message))
  }, [])

  useEffect(() => {
    if (!organizationId) return
    listMissiveSharedLabels(organizationId)
      .then(ls => {
        setLabels(ls)
        const match = ls.find(l => l.name?.trim().toLowerCase() === DEFAULT_LABEL_NAME.toLowerCase())
        if (match) setLabelId(match.id)
        setLabelsLoaded(true)
      })
      .catch(err => { setOrgError(err.message); setLabelsLoaded(true) })
  }, [organizationId])

  const defaultLabelMissing = labelsLoaded && !labels.some(l => l.name?.trim().toLowerCase() === DEFAULT_LABEL_NAME.toLowerCase())
  const canFind = !!labelId && !listing
  const canExport = !!conversations?.length && !exporting
  const canScan = !!conversations?.length && !scanning
  const flaggedCount = conversations ? conversations.filter(c => flagsById[c.id]?.hasSheet || flagsById[c.id]?.isBulk).length : 0

  async function findConversations() {
    setListing(true); setListError('')
    setConversations(null); setTruncated(false); setZipDone(false)
    setFlagsById({}); setScanError(''); setShowFlaggedOnly(false)
    try {
      const fromMs = fromDate ? Date.parse(fromDate + 'T00:00:00.000Z') : null
      const toMs = toDate ? Date.parse(toDate + 'T23:59:59.999Z') : null
      const all = []
      let until = null
      let hitCap = true

      for (let i = 0; i < PAGE_CAP; i++) {
        const page = await listMissiveConversationsPage('shared_label', labelId, until, null, true)
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

  // Scans every found conversation's full transcript for the two signals this tool flags.
  // Fetches the same cleaned Markdown exportAll would zip up — one real content fetch per
  // conversation, same cost as an export — so this is a deliberate button press, not run
  // automatically on every search.
  async function scanForFlags() {
    if (!canScan) return
    setScanning(true); setScanError('')
    setScanProgress({ done: 0, total: conversations.length })
    try {
      const SCAN_CONCURRENCY = 3
      const queue = conversations.map((_, i) => i)
      let done = 0
      const results = {}
      async function worker() {
        while (queue.length) {
          const i = queue.shift()
          const c = conversations[i]
          try {
            const result = await getMissiveConversationExport({
              conversationId: c.id,
              subject: c.subject || c.latest_message_subject,
              webUrl: c.web_url,
              lastActivityAt: c.last_activity_at,
              externalAuthorEmail: c.external_authors?.[0]?.address,
              maxMessages: MAX_MESSAGES,
            })
            const ownDomain = (c.external_authors?.[0]?.address || '').split('@')[1]?.toLowerCase() || null
            results[c.id] = scanTranscript(result.markdown, ownDomain)
          } catch (err) {
            results[c.id] = { error: err.message }
          }
          done += 1
          setScanProgress({ done, total: conversations.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, queue.length) }, worker))
      setFlagsById(results)
    } catch (err) {
      setScanError(err.message)
    } finally {
      setScanning(false)
    }
  }

  // Exports the full thread of every matching conversation as Markdown, same mechanism as
  // Missive Export. This is also the natural hand-off point for the planned GLM summarizer —
  // each result already carries {filename, markdown, messageCount} per conversation; a future
  // "Summarize" action would feed that markdown to GLM instead of (or alongside) zipping it,
  // with no change needed to how these conversations are found.
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

      const EXPORT_CONCURRENCY = 3
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
            maxMessages: MAX_MESSAGES,
          })
          zip.file(uniqueName(result.filename), result.markdown)
          done += 1
          setProgress({ done, total: conversations.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(EXPORT_CONCURRENCY, queue.length) }, worker))

      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(`bargain-emails-${todayISO()}.zip`, blob)
      setZipDone(true)
    } catch (err) {
      setExportError(err.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Bargain Emails</h1>
          <div className="sub">Closed conversations in the "{DEFAULT_LABEL_NAME}" label, for a date range you pick</div>
        </div>
      </div>

      {orgError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{orgError}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end', marginBottom: 16, maxWidth: 900 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>Label</span>
          <select className="input" value={labelId} onChange={e => setLabelId(e.target.value)} style={{ fontSize: 13 }}>
            <option value="">{labelsLoaded ? 'Select a label…' : 'Loading…'}</option>
            {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>From</span>
          <input className="input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ fontSize: 13 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>To</span>
          <input className="input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ fontSize: 13 }} />
        </label>
        <button className="btn primary" onClick={findConversations} disabled={!canFind}>
          {listing ? 'Searching…' : <><Icon name="search" size={12} /> Find Closed Emails</>}
        </button>
      </div>

      {defaultLabelMissing && (
        <div style={{ background: 'rgba(255,197,61,.08)', border: '1px solid rgba(255,197,61,.2)', color: '#ffc53d', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 16, maxWidth: 900 }}>
          Couldn't find a label named "{DEFAULT_LABEL_NAME}" — pick the right one from the dropdown above.
        </div>
      )}

      {listError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16, maxWidth: 900 }}>{listError}</div>
      )}

      {truncated && (
        <div style={{ background: 'rgba(255,197,61,.08)', border: '1px solid rgba(255,197,61,.2)', color: '#ffc53d', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 16, maxWidth: 900 }}>
          Hit the 10,000-conversation safety cap for this range — there may be more. Narrow the date range for a complete result.
        </div>
      )}

      {conversations && (
        <div style={{ maxWidth: 1000 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              <strong style={{ color: 'var(--text)' }}>{conversations.length}</strong> closed conversation{conversations.length === 1 ? '' : 's'} found
              {Object.keys(flagsById).length > 0 && (
                <> — <strong style={{ color: 'var(--warn)' }}>{flaggedCount}</strong> flagged</>
              )}
            </span>
            {conversations.length > 0 && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn ghost" onClick={scanForFlags} disabled={!canScan}>
                  {scanning ? `Scanning ${scanProgress.done}/${scanProgress.total}…` : <><Icon name="flag" size={12} /> Scan for Bulk / Sheets</>}
                </button>
                <button className="btn primary" onClick={exportAll} disabled={!canExport}>
                  {exporting
                    ? `Exporting ${progress.done}/${progress.total}…`
                    : <><Icon name="download" size={12} /> Export as ZIP</>}
                </button>
              </div>
            )}
          </div>

          {scanError && (
            <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{scanError}</div>
          )}

          {Object.keys(flagsById).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <span className="seg">
                <button className={!showFlaggedOnly ? 'on' : ''} onClick={() => setShowFlaggedOnly(false)}>All ({conversations.length})</button>
                <button className={showFlaggedOnly ? 'on' : ''} onClick={() => setShowFlaggedOnly(true)}>Flagged only ({flaggedCount})</button>
              </span>
            </div>
          )}

          {conversations.length > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 560 }}>
              <table className="table">
                <thead>
                  <tr><th>Subject</th><th>Contact</th><th>Closed / Last Activity</th><th>Messages</th><th>Flags</th><th></th></tr>
                </thead>
                <tbody>
                  {conversations
                    .filter(c => !showFlaggedOnly || flagsById[c.id]?.hasSheet || flagsById[c.id]?.isBulk)
                    .map(c => {
                      const flags = flagsById[c.id]
                      const flagged = flags?.hasSheet || flags?.isBulk
                      return (
                        <tr key={c.id} style={flagged ? { background: 'rgba(255,197,61,.06)' } : undefined}>
                          <td style={{ whiteSpace: 'normal' }}>{c.subject || c.latest_message_subject || '(no subject)'}</td>
                          <td style={{ whiteSpace: 'normal' }}>
                            {c.external_authors?.[0]?.name || c.external_authors?.[0]?.address || <span className="faint">—</span>}
                          </td>
                          <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(c.last_activity_at)}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{c.messages_count}</td>
                          <td>
                            {flags?.error && <span className="chip danger" title={flags.error}>Scan failed</span>}
                            {flags?.hasSheet && <span className="chip info" style={{ marginRight: 4 }}>Sheet</span>}
                            {flags?.isBulk && <span className="chip warn" title={flags.bulkDomains.join(', ')}>Bulk ({flags.bulkDomains.length})</span>}
                            {flags && !flags.error && !flags.hasSheet && !flags.isBulk && <span className="faint">—</span>}
                          </td>
                          <td>
                            {c.web_url && <a href={c.web_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open →</a>}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {exportError && (
        <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginTop: 14, maxWidth: 900 }}>{exportError}</div>
      )}

      {zipDone && !exporting && (
        <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 10 }}>✓ Exported {conversations.length} conversation{conversations.length === 1 ? '' : 's'}</div>
      )}
    </div>
  )
}

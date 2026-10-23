import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../data.jsx'
import {
  getMissiveConversation, checkMissiveReplies,
  loadTrackedLinks, addTrackedLink, updateTrackedLinkStatus, updateTrackedLinkNote, deleteTrackedLink,
} from '../lib/supabase.js'

// Same UUID-from-pasted-link extraction Missive Export already uses — works regardless of
// the exact URL shape (path segment, hash fragment, whatever Missive's web app happens to use).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
function extractConversationId(line) {
  const match = line.match(UUID_RE)
  return match ? match[0] : null
}

function fmtDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export function MissiveLinkTracker({ me }) {
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [pasteText, setPasteText] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')

  const fetchLinks = useCallback(() => {
    setLoading(true); setLoadError('')
    loadTrackedLinks().then(setLinks).catch(e => setLoadError(e.message)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchLinks() }, [fetchLinks])

  // Checks every un-replied tracked link on first load, same "check on open + manual
  // refresh" pattern Personal Email Sender's reply tracking already uses.
  useEffect(() => {
    if (!loading && links.length) checkReplies(links.filter(l => !l.has_reply))
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addLinks() {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean)
    const ids = [...new Set(lines.map(extractConversationId).filter(Boolean))]
    if (!ids.length) { setAddError('No valid Missive conversation links found — paste one link per line'); return }

    const existingIds = new Set(links.map(l => l.conversation_id))
    const newIds = ids.filter(id => !existingIds.has(id))
    const skipped = ids.length - newIds.length

    setAdding(true); setAddError('')
    try {
      const added = []
      for (const id of newIds) {
        const conv = await getMissiveConversation(id)
        const row = await addTrackedLink({
          createdBy: me?.id || null,
          conversationId: id,
          webUrl: conv?.web_url || null,
          subject: conv?.subject || conv?.latest_message_subject || '(no subject)',
          baselineCount: conv?.messages_count ?? null,
        })
        added.push(row)
      }
      setLinks(prev => [...added, ...prev])
      setPasteText('')
      if (skipped > 0) setAddError(`${skipped} link${skipped === 1 ? ' was' : 's were'} already tracked and skipped.`)
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function checkReplies(toCheck) {
    if (!toCheck.length) return
    setChecking(true); setCheckError('')
    try {
      const results = await checkMissiveReplies(toCheck.map(l => ({ conversationId: l.conversation_id, baselineCount: l.baseline_count })))
      const byId = new Map(results.map(r => [r.conversationId, r]))
      await Promise.all(toCheck.map(async l => {
        const r = byId.get(l.conversation_id)
        if (!r || r.error) return
        await updateTrackedLinkStatus(l.id, { currentCount: r.currentCount, hasReply: r.hasReply })
      }))
      setLinks(prev => prev.map(l => {
        const r = byId.get(l.conversation_id)
        if (!r || r.error) return l
        return { ...l, current_count: r.currentCount, has_reply: r.hasReply, last_checked_at: new Date().toISOString() }
      }))
    } catch (err) {
      setCheckError(err.message)
    } finally {
      setChecking(false)
    }
  }

  async function handleNoteBlur(id, value) {
    try { await updateTrackedLinkNote(id, value) } catch { /* silent — not critical */ }
  }

  async function handleDelete(id) {
    if (!window.confirm('Stop tracking this link?')) return
    try {
      await deleteTrackedLink(id)
      setLinks(prev => prev.filter(l => l.id !== id))
    } catch (err) {
      setLoadError(err.message)
    }
  }

  const repliedCount = links.filter(l => l.has_reply).length
  const waitingCount = links.length - repliedCount

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Link Tracker</h1>
          <div className="sub">Paste a Missive conversation link — tracks it and tells you when a reply comes in</div>
        </div>
      </div>

      <div style={{ maxWidth: 900 }}>
        <textarea
          className="input"
          rows={3}
          style={{ fontSize: 13, fontFamily: 'var(--font-mono)', width: '100%', resize: 'vertical' }}
          placeholder={'https://mail.missiveapp.com/#inbox/conversations/68d8...\nhttps://mail.missiveapp.com/#inbox/conversations/7a2f...'}
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          disabled={adding}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 20 }}>
          <button className="btn primary" onClick={addLinks} disabled={!pasteText.trim() || adding}>
            {adding ? 'Adding…' : <><Icon name="plus" size={12} /> Track Link{pasteText.includes('\n') ? 's' : ''}</>}
          </button>
          {links.length > 0 && (
            <button className="btn ghost" onClick={() => checkReplies(links)} disabled={checking}>
              <Icon name="refresh" size={11} /> {checking ? 'Checking…' : 'Check Replies'}
            </button>
          )}
        </div>

        {addError && <div style={{ background: 'rgba(255,197,61,.08)', border: '1px solid rgba(255,197,61,.2)', color: '#ffc53d', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{addError}</div>}
        {loadError && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{loadError}</div>}
        {checkError && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{checkError}</div>}

        {!loading && links.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Tracked</span>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{links.length}</div>
            </div>
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Replied</span>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--ok)' }}>{repliedCount}</div>
            </div>
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Waiting</span>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--warn)' }}>{waitingCount}</div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>Loading…</div>
        ) : links.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>No links tracked yet.</div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 600 }}>
            <table className="table">
              <thead>
                <tr><th>Subject</th><th>Added</th><th>Status</th><th>Note</th><th></th><th></th></tr>
              </thead>
              <tbody>
                {links.map(l => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'normal' }}>{l.subject || '(no subject)'}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(l.created_at)}</td>
                    <td>
                      {l.has_reply
                        ? <span className="chip ok"><span className="dot-status ok" /> Replied</span>
                        : <span className="chip warn">Waiting</span>}
                    </td>
                    <td>
                      <input
                        className="input"
                        defaultValue={l.note || ''}
                        placeholder="—"
                        onBlur={e => handleNoteBlur(l.id, e.target.value)}
                        style={{ fontSize: 12, padding: '4px 8px', width: 160 }}
                      />
                    </td>
                    <td>{l.web_url && <a href={l.web_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open →</a>}</td>
                    <td>
                      <button className="btn ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => handleDelete(l.id)}>
                        <Icon name="trash" size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

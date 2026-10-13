import { useState, useEffect, useRef } from 'react'
import { Icon } from '../data.jsx'
import {
  checkPersonalEmailReplies, summarizeMissiveReplies, savePersonalEmailBatch, loadPersonalEmailBatches,
  loadPersonalEmailSentLog, clearPersonalEmailBatchesAndLog,
} from '../lib/supabase.js'

// Dev Pandya's member_id slug — see the same comment in PersonalEmailSender.jsx/Shell.jsx for
// why this is the short slug, not the Supabase UUID.
const DEV_MEMBER_ID = 'dev'

function batchLabel(b) {
  return b.batch_name?.trim() || `Batch · ${new Date(b.created_at).toLocaleDateString()}`
}
function batchReplyCount(b) {
  return (b.rows || []).filter(r => r.hasReply).length
}
function batchStats(b) {
  const rows = b.rows || []
  return {
    total: rows.length,
    sent: rows.filter(r => r.status === 'sent').length,
    pending: rows.filter(r => r.status === 'pending').length,
    failed: rows.filter(r => r.status === 'error').length,
  }
}

const STATUS_CHIP = {
  pending: { cls: '', label: 'Pending' },
  sending: { cls: 'info', label: 'Sending…' },
  sent:    { cls: 'ok', label: 'Sent' },
  error:   { cls: 'danger', label: 'Failed' },
}

// Read-only: shows what's already been sent and whether it got a reply. Composing and
// actually sending emails happens on the Email Sender page — this page never creates a
// batch, adds a recipient, or fires a send.
export function MissiveTracking({ me, setRoute }) {
  if (me?.id !== DEV_MEMBER_ID) {
    return (
      <div className="page" style={{ maxWidth: 600 }}>
        <div className="page-head"><div><h1>Tracking</h1></div></div>
        <div className="card card-pad" style={{ fontSize: 13, color: 'var(--text-faint)' }}>
          This tool is restricted to a specific user.
        </div>
      </div>
    )
  }

  const [batches, setBatches] = useState([])
  const [activeBatchId, setActiveBatchId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [checkingReplies, setCheckingReplies] = useState(false)
  const [sentLog, setSentLog] = useState([])
  const [clearing, setClearing] = useState(false)
  const [checkError, setCheckError] = useState('')

  // checkAllReplies can be invoked (from the mount effect) before activeBatchId has caught up
  // to a just-set value in the same tick — a ref always reads the live value regardless of
  // when the function closing over it was created.
  const activeBatchIdRef = useRef(null)
  useEffect(() => { activeBatchIdRef.current = activeBatchId }, [activeBatchId])

  // Re-checks every batch's sent rows for new replies (message count grew since send) and
  // persists any changed hasReply flags back to their batches.
  async function checkAllReplies(batchList) {
    setCheckError('')
    const entries = []
    for (const b of batchList) {
      for (const r of (b.rows || [])) {
        if (r.conversationId && r.messagesCountAtSend != null) {
          entries.push({ conversationId: r.conversationId, baselineCount: r.messagesCountAtSend })
        }
      }
    }
    if (!entries.length) {
      setCheckError("No sent email here has a linked Missive conversation yet, so there's nothing to check.")
      return
    }
    setCheckingReplies(true)
    try {
      const results = await checkPersonalEmailReplies(entries)
      const byConv = new Map(results.map(r => [r.conversationId, r]))
      const failedLookups = results.filter(r => r.error)

      // First pass: apply hasReply flags, and collect rows that have a reply but no summary
      // posted yet — covers both a reply that JUST arrived and a prior summarize attempt
      // that failed (retried here rather than left stuck), while never re-running for a row
      // that already got a summary posted successfully.
      const newlyReplied = []
      let stage1 = batchList.map(b => ({
        ...b,
        rows: (b.rows || []).map(r => {
          const res = r.conversationId && byConv.get(r.conversationId)
          if (!res) return r
          const hasReply = !!res.hasReply
          if (hasReply && !r.summaryPosted) newlyReplied.push(r)
          return { ...r, hasReply }
        }),
      }))
      setBatches(stage1)

      // Second pass, best-effort: summarize each newly-arrived reply via GLM and post it as
      // a Missive note. Never blocks hasReply from being shown even if this fails entirely.
      let stage2 = stage1
      let summarizeRequestError = ''
      if (newlyReplied.length) {
        const newlyRepliedIds = new Set(newlyReplied.map(r => r.id))
        let summaries = []
        try {
          summaries = await summarizeMissiveReplies(newlyReplied.map(r => r.conversationId))
        } catch (err) {
          // The WHOLE request failed (e.g. a 504 from a slow GLM completion exceeding the
          // function's own time budget) rather than one conversation's attempt inside it —
          // previously this was silently swallowed, leaving every affected row looking
          // untouched with no error and no explanation. Now every row that was waiting on
          // this call gets a visible, retryable error instead of silence.
          summarizeRequestError = err.message
        }
        const byRowConv = new Map(summaries.map(s => [s.conversationId, s]))
        stage2 = stage1.map(b => ({
          ...b,
          rows: b.rows.map(r => {
            if (!newlyRepliedIds.has(r.id)) return r
            const s = byRowConv.get(r.conversationId)
            if (s) return { ...r, summaryPosted: !!s.posted, summaryError: s.error || null }
            return { ...r, summaryError: summarizeRequestError || 'No result returned' }
          }),
        }))
        setBatches(stage2)
      }

      // Persist every batch whose rows actually changed (reply flags and/or summary status).
      const origRows = new Map(batchList.map(b => [b.id, JSON.stringify(b.rows || [])]))
      await Promise.all(stage2.filter(b => JSON.stringify(b.rows || []) !== origRows.get(b.id)).map(b =>
        savePersonalEmailBatch({ id: b.id, batchName: b.batch_name, teamId: b.team_id, sharedLabelIds: b.shared_label_ids, rows: b.rows }).catch(() => {})
      ))

      const errorParts = []
      if (failedLookups.length) {
        errorParts.push(`${failedLookups.length} of ${entries.length} conversation lookups failed: ${failedLookups[0].error}`)
      }
      if (summarizeRequestError) {
        errorParts.push(`Reply detected, but summarizing it failed: ${summarizeRequestError}`)
      }
      if (errorParts.length) setCheckError(errorParts.join(' — '))
    } catch (err) {
      setCheckError(err.message)
    } finally {
      setCheckingReplies(false)
    }
  }

  useEffect(() => {
    loadPersonalEmailBatches().then(bs => {
      setBatches(bs)
      if (bs.length) setActiveBatchId(bs[0].id)
      checkAllReplies(bs)
    }).catch(() => {}).finally(() => setLoading(false))
    loadPersonalEmailSentLog().then(setSentLog).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeBatch = batches.find(b => b.id === activeBatchId) || null
  const stats = activeBatch ? batchStats(activeBatch) : null

  async function clearTestData() {
    if (!batches.length && !sentLog.length) return
    const ok = window.confirm(
      `Permanently delete all ${batches.length} batch(es) and ${sentLog.length} sent-log entr${sentLog.length === 1 ? 'y' : 'ies'}?\n\nSaved templates are not affected. This cannot be undone.`
    )
    if (!ok) return
    setClearing(true)
    try {
      await clearPersonalEmailBatchesAndLog()
      setBatches([])
      setActiveBatchId(null)
      setSentLog([])
    } catch (err) {
      window.alert(`Failed to clear: ${err.message}`)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>Tracking</h1>
          <div className="sub">Which batches went out, and whether they got a reply</div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => checkAllReplies(batches)} disabled={checkingReplies || !batches.length}>
            <Icon name="activity" size={12} /> {checkingReplies ? 'Checking…' : 'Check replies'}
          </button>
          <button className="btn ghost" onClick={clearTestData} disabled={clearing || (!batches.length && !sentLog.length)} style={{ color: 'var(--danger)' }}>
            <Icon name="trash" size={12} /> {clearing ? 'Clearing…' : 'Clear all batches & log'}
          </button>
        </div>
      </div>

      {checkError && (
        <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 16 }}>{checkError}</div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}><span className="faint" style={{ fontSize: 13 }}>Loading…</span></div>
      ) : batches.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div className="faint" style={{ fontSize: 13, marginBottom: 12 }}>No batches yet.</div>
          <button className="btn primary" onClick={() => setRoute?.('missive-sender')}>Go to Email Sender</button>
        </div>
      ) : (
        <>
          <div className="tabs" style={{ flexWrap: 'wrap' }}>
            {batches.map(b => {
              const replyCount = batchReplyCount(b)
              const active = b.id === activeBatchId
              return (
                <div key={b.id} className={`tab${active ? ' active' : ''}`} onClick={() => setActiveBatchId(b.id)}>
                  {replyCount > 0 && <span className="dot-status danger" />}
                  {batchLabel(b)}
                  <span className="count">{(b.rows || []).length}</span>
                </div>
              )
            })}
          </div>

          {activeBatch && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <h3>{batchLabel(activeBatch)}</h3>
              </div>
              <div className="grid grid-4" style={{ padding: 16, paddingBottom: 0 }}>
                <div className="kpi"><span className="kpi-label">Total</span><span className="kpi-value">{stats.total}</span></div>
                <div className="kpi"><span className="kpi-label">Sent</span><span className="kpi-value" style={{ color: 'var(--ok)' }}>{stats.sent}</span></div>
                <div className="kpi"><span className="kpi-label">Pending</span><span className="kpi-value" style={{ color: 'var(--warn)' }}>{stats.pending}</span></div>
                <div className="kpi"><span className="kpi-label">Replies</span><span className="kpi-value" style={{ color: 'var(--danger)' }}>{batchReplyCount(activeBatch)}</span></div>
              </div>
              <table className="table">
                <thead>
                  <tr><th>Recipient</th><th>Status</th><th>Sent</th><th>Note</th><th>Reply</th><th>Missive</th></tr>
                </thead>
                <tbody>
                  {(activeBatch.rows || []).length === 0 ? (
                    <tr><td colSpan={6} className="faint" style={{ textAlign: 'center', padding: 24 }}>No recipients in this batch yet.</td></tr>
                  ) : (activeBatch.rows || []).map(row => {
                    const st = STATUS_CHIP[row.status] || STATUS_CHIP.pending
                    return (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: 'normal' }}>
                          {row.name ? `${row.name} ` : ''}<span className="faint">&lt;{row.email}&gt;</span>
                        </td>
                        <td><span className={`chip${st.cls ? ' ' + st.cls : ''}`}>{st.label}</span></td>
                        <td className="muted" style={{ whiteSpace: 'nowrap' }}>{row.sentAt ? new Date(row.sentAt).toLocaleString() : '—'}</td>
                        <td style={{ maxWidth: 220, whiteSpace: 'normal' }}>
                          {row.note
                            ? <span title={row.note}>{row.note.length > 60 ? row.note.slice(0, 60) + '…' : row.note}</span>
                            : <span className="faint">—</span>}
                          {row.noteError && <div style={{ marginTop: 2 }}><span className="chip danger" style={{ fontSize: 10 }}>not posted</span></div>}
                        </td>
                        <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>
                          {row.hasReply
                            ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                                <span className="chip danger"><span className="dot-status danger" /> Replied</span>
                                {row.summaryPosted && <span className="chip ok" style={{ fontSize: 10 }}>AI summary posted</span>}
                                {row.summaryError && (
                                  <span className="chip danger" style={{ fontSize: 10, whiteSpace: 'normal' }}>
                                    summary failed: {row.summaryError}
                                  </span>
                                )}
                              </div>
                            )
                            : <span className="faint">—</span>}
                        </td>
                        <td>
                          {row.webUrl
                            ? <a href={row.webUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open →</a>
                            : <span className="faint">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Sent log (across every batch) ───────────────── */}
      {sentLog.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Sent Log</h3>
              <span className="sub">{sentLog.length} emails sent, all batches</span>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr><th>Sent</th><th>Recipient</th><th>Subject</th><th>Missive</th></tr>
            </thead>
            <tbody>
              {sentLog.map(entry => (
                <tr key={entry.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(entry.sent_at).toLocaleString()}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {entry.recipient_name ? `${entry.recipient_name} ` : ''}
                    <span className="faint">&lt;{entry.recipient_email}&gt;</span>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{entry.subject || <span className="faint">—</span>}</td>
                  <td>
                    {entry.web_url
                      ? <a href={entry.web_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open →</a>
                      : <span className="faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

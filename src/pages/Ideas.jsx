import { useState, useEffect, useRef, useCallback } from 'react'
import { TEAM, Icon, fmtRel } from '../data.jsx'
import { loadIdeas, createIdea, updateIdeaStatus, loadIdeaComments, addIdeaComment, deleteIdea } from '../lib/supabase.js'

// ── Status config ────────────────────────────────────
const STATUS = {
  pending:  { label: 'Pending Review', dot: '◎', color: '#fb923c', bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.3)'  },
  approved: { label: 'Approved',       dot: '✓', color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.3)'  },
  rejected: { label: 'Rejected',       dot: '✗', color: '#fb7185', bg: 'rgba(251,113,133,0.12)', border: 'rgba(251,113,133,0.3)' },
}

const CTYPE = {
  comment:   { label: null,                  bg: 'var(--surface-2)',           border: 'var(--border)',              color: null        },
  approval:  { label: '✅ Approved',          bg: 'rgba(52,211,153,0.07)',      border: 'rgba(52,211,153,0.25)',      color: '#34d399'   },
  rejection: { label: '❌ Rejection reason',  bg: 'rgba(251,113,133,0.07)',     border: 'rgba(251,113,133,0.25)',     color: '#fb7185'   },
  counter:   { label: '↩ Counter argument',   bg: 'rgba(167,139,250,0.07)',     border: 'rgba(167,139,250,0.25)',     color: '#a78bfa'   },
}

function StatusChip({ status, style = {} }) {
  const s = STATUS[status] || STATUS.pending
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      ...style
    }}>
      {s.dot} {s.label}
    </span>
  )
}

// ── Thread modal ────────────────────────────────────
function IdeaThread({ idea: initialIdea, me, onClose, onUpdate, onDelete }) {
  const [idea, setIdea]             = useState(initialIdea)
  const [comments, setComments]     = useState([])
  const [loadingCmts, setLoadingCmts] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting]       = useState(false)
  const [rejectMode, setRejectMode] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [actioning, setActioning]   = useState(false)
  const bottomRef = useRef(null)

  const isLead    = ['lead', 'super'].includes(me.role)
  const isAuthor  = idea.member_id === me.id
  const canCounter = isAuthor && idea.status === 'rejected'
  const author    = TEAM.find(m => m.id === idea.member_id)

  useEffect(() => {
    loadIdeaComments(idea.id).then(c => { setComments(c); setLoadingCmts(false) }).catch(() => setLoadingCmts(false))
  }, [idea.id])

  useEffect(() => {
    if (!loadingCmts) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments, loadingCmts])

  async function postComment(type = 'comment') {
    const text = type === 'rejection' ? rejectReason : newComment
    if (!text.trim()) return
    setPosting(true)
    try {
      const c = await addIdeaComment({ ideaId: idea.id, memberId: me.id, content: text.trim(), type })
      setComments(prev => [...prev, c])
      if (type === 'rejection') { setRejectReason(''); setRejectMode(false) }
      else setNewComment('')
    } catch { /* silent */ }
    finally { setPosting(false) }
  }

  async function handleApprove() {
    setActioning(true)
    try {
      await updateIdeaStatus(idea.id, 'approved')
      const c = await addIdeaComment({ ideaId: idea.id, memberId: me.id, content: 'Idea approved — we will move forward with this.', type: 'approval' })
      setComments(prev => [...prev, c])
      const updated = { ...idea, status: 'approved' }
      setIdea(updated); onUpdate(updated)
    } catch { /* silent */ }
    finally { setActioning(false) }
  }

  async function handleRejectConfirm() {
    if (!rejectReason.trim()) return
    setActioning(true)
    try {
      await updateIdeaStatus(idea.id, 'rejected')
      const c = await addIdeaComment({ ideaId: idea.id, memberId: me.id, content: rejectReason.trim(), type: 'rejection' })
      setComments(prev => [...prev, c])
      const updated = { ...idea, status: 'rejected' }
      setIdea(updated); onUpdate(updated)
      setRejectReason(''); setRejectMode(false)
    } catch { /* silent */ }
    finally { setActioning(false) }
  }

  async function handleCounter() {
    if (!newComment.trim()) return
    setPosting(true)
    try {
      await updateIdeaStatus(idea.id, 'pending')
      const c = await addIdeaComment({ ideaId: idea.id, memberId: me.id, content: newComment.trim(), type: 'counter' })
      setComments(prev => [...prev, c])
      const updated = { ...idea, status: 'pending' }
      setIdea(updated); onUpdate(updated)
      setNewComment('')
    } catch { /* silent */ }
    finally { setPosting(false) }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
           style={{ maxWidth: 600, maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0 }}>

        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, marginBottom: 8 }}>{idea.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <StatusChip status={idea.status} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className={`avatar sm ${author?.color}`}>{author?.short}</div>
                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{author?.name}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {new Date(idea.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {onDelete && (
              <button className="btn ghost" onClick={onDelete} title="Delete idea"
                      style={{ color: '#fb7185' }}>
                <Icon name="trash" size={14} />
              </button>
            )}
            <button className="btn ghost" onClick={onClose}><Icon name="x" size={14} /></button>
          </div>
        </div>

        {/* Original idea body */}
        <div style={{ padding: '16px 20px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>{idea.description}</p>
        </div>

        {/* Thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loadingCmts && <div className="muted" style={{ fontSize: 13, textAlign: 'center', padding: 24 }}>Loading thread…</div>}
          {!loadingCmts && comments.length === 0 && (
            <div className="muted" style={{ fontSize: 12, textAlign: 'center', padding: 20, opacity: 0.5 }}>No comments yet — be the first.</div>
          )}
          {comments.map(c => {
            const cmtAuthor = TEAM.find(m => m.id === c.member_id)
            const cfg = CTYPE[c.type] || CTYPE.comment
            return (
              <div key={c.id} style={{
                padding: '10px 13px', borderRadius: 10,
                background: cfg.bg, border: `1px solid ${cfg.border}`,
              }}>
                {cfg.label && (
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: cfg.color, marginBottom: 6 }}>
                    {cfg.label}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <div className={`avatar sm ${cmtAuthor?.color}`}>{cmtAuthor?.short}</div>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{cmtAuthor?.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{c.content}</p>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Lead actions */}
        {isLead && idea.status === 'pending' && !rejectMode && (
          <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'var(--surface-2)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', alignSelf: 'center', flex: 1 }}>Lead decision:</span>
            <button onClick={handleApprove} disabled={actioning}
                    style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              ✅ Approve
            </button>
            <button onClick={() => setRejectMode(true)}
                    style={{ background: 'rgba(251,113,133,0.12)', border: '1px solid rgba(251,113,133,0.25)', color: '#fb7185', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              ❌ Reject
            </button>
          </div>
        )}

        {/* Reject reason form */}
        {isLead && rejectMode && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'rgba(251,113,133,0.05)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fb7185', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Reason for rejection (required)
            </div>
            <textarea className="input" value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                      placeholder="Explain why this idea can't be implemented right now…"
                      style={{ width: '100%', height: 80, fontSize: 13, resize: 'none', padding: 10, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => { setRejectMode(false); setRejectReason('') }}>Cancel</button>
              <button onClick={handleRejectConfirm} disabled={!rejectReason.trim() || actioning}
                      style={{ background: '#fb7185', color: '#fff', border: 'none', borderRadius: 6, padding: '0 14px', height: 30, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: !rejectReason.trim() ? 0.5 : 1 }}>
                Confirm rejection
              </button>
            </div>
          </div>
        )}

        {/* Comment / Counter input */}
        {!rejectMode && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea className="input" value={newComment} onChange={e => setNewComment(e.target.value)}
                      placeholder={canCounter ? 'Counter this decision — explain your argument…' : 'Add a comment…'}
                      style={{ flex: 1, height: 64, fontSize: 13, resize: 'none', padding: '8px 10px' }}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); canCounter ? handleCounter() : postComment() } }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {canCounter && (
                <button onClick={handleCounter} disabled={!newComment.trim() || posting}
                        style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  ↩ Counter
                </button>
              )}
              <button className="btn primary" onClick={() => postComment()} disabled={!newComment.trim() || posting}
                      style={{ whiteSpace: 'nowrap' }}>
                {posting ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Ideas Page ───────────────────────────────────────
export function IdeasPage({ me, showToast }) {
  const [ideas, setIdeas]       = useState([])
  const [filter, setFilter]     = useState('all')
  const [loading, setLoading]   = useState(true)
  const [openIdea, setOpenIdea] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [confirmDeleteIdea, setConfirmDeleteIdea] = useState(null) // idea to delete

  // Submit form state
  const [title, setTitle]       = useState('')
  const [desc, setDesc]         = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isLead = ['lead', 'super'].includes(me.role)

  const fetchIdeas = useCallback(async () => {
    setLoading(true)
    try {
      const data = await loadIdeas({ statusFilter: filter, memberId: me.id })
      setIdeas(data)
    } catch (err) {
      showToast('Failed to load ideas: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [filter, me.id])

  useEffect(() => { fetchIdeas() }, [fetchIdeas])

  async function submitIdea() {
    if (!title.trim() || !desc.trim()) return
    setSubmitting(true)
    try {
      const idea = await createIdea({ memberId: me.id, title: title.trim(), description: desc.trim() })
      setIdeas(prev => [{ ...idea, commentCount: 0 }, ...prev])
      setTitle(''); setDesc(''); setShowForm(false)
      showToast('Idea submitted!')
    } catch (err) {
      showToast('Failed: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleIdeaUpdate(updated) {
    setIdeas(prev => prev.map(i => i.id === updated.id ? { ...i, status: updated.status } : i))
    if (openIdea?.id === updated.id) setOpenIdea(prev => ({ ...prev, status: updated.status }))
  }

  async function handleDelete() {
    if (!confirmDeleteIdea) return
    try {
      await deleteIdea(confirmDeleteIdea.id)
      setIdeas(prev => prev.filter(i => i.id !== confirmDeleteIdea.id))
      if (openIdea?.id === confirmDeleteIdea.id) setOpenIdea(null)
      showToast('Idea deleted.')
    } catch (err) {
      showToast('Delete failed: ' + err.message)
    } finally {
      setConfirmDeleteIdea(null)
    }
  }

  const FILTERS = [
    { id: 'all',      label: 'All' },
    { id: 'pending',  label: '◎ Pending' },
    { id: 'approved', label: '✓ Approved' },
    { id: 'rejected', label: '✗ Rejected' },
    { id: 'mine',     label: 'My ideas' },
  ]

  const counts = {
    pending:  ideas.filter(i => i.status === 'pending').length,
    approved: ideas.filter(i => i.status === 'approved').length,
    rejected: ideas.filter(i => i.status === 'rejected').length,
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Ideas Board</h1>
          <div className="sub">Submit ideas · leads approve or reject with reasons · discuss in thread</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setShowForm(true)}>
            <Icon name="flash" size={13} /> Submit idea
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {[
          { label: 'Total ideas', val: ideas.length, sub: 'submitted' },
          { label: 'Pending review', val: counts.pending, sub: 'awaiting decision', color: '#fb923c' },
          { label: 'Approved', val: counts.approved, sub: 'being implemented', color: '#34d399' },
          { label: 'Rejected', val: counts.rejected, sub: 'with explanation', color: '#fb7185' },
        ].map(k => (
          <div className="kpi" key={k.label}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={k.color ? { color: k.color } : {}}>{k.val}</div>
            <div className="kpi-target">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ marginBottom: 16 }}>
        <span className="seg">
          {FILTERS.map(f => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </span>
      </div>

      {/* Ideas list */}
      {loading && <div className="card" style={{ padding: 40, textAlign: 'center' }}><span className="muted">Loading…</span></div>}

      {!loading && ideas.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.25 }}>💡</div>
          <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>No ideas here yet</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
            {filter === 'all' ? 'Be the first — submit an idea above!' : 'Try a different filter'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ideas.map(idea => {
          const author = TEAM.find(m => m.id === idea.member_id)
          const s = STATUS[idea.status] || STATUS.pending
          return (
            <div key={idea.id} className="card"
                 onClick={() => setOpenIdea(idea)}
                 style={{ padding: '14px 18px', cursor: 'pointer', transition: 'border-color 0.15s', borderLeft: `3px solid ${s.color}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <StatusChip status={idea.status} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{idea.title}</span>
                  </div>
                  <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--text-faint)', lineHeight: 1.5,
                               overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {idea.description}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div className={`avatar sm ${author?.color}`}>{author?.short}</div>
                      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{author?.name}</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                      {new Date(idea.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    {idea.commentCount > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Icon name="chat" size={10} /> {idea.commentCount} comment{idea.commentCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {isLead && (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDeleteIdea(idea) }}
                      title="Delete idea"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 5,
                               color: 'var(--text-faint)', display: 'flex', alignItems: 'center',
                               opacity: 0.5, transition: 'opacity 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                      onMouseLeave={e => e.currentTarget.style.opacity = 0.5}>
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                  <Icon name="arrow" size={13} style={{ color: 'var(--text-faint)', marginTop: 4 }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Submit idea modal */}
      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2><Icon name="flash" size={15} /> New idea</h2>
              <button className="btn ghost" onClick={() => setShowForm(false)}><Icon name="x" size={13} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Idea title
                </label>
                <input className="input" value={title} onChange={e => setTitle(e.target.value)}
                       placeholder="Short, clear title for your idea…"
                       style={{ width: '100%' }} autoFocus
                       onKeyDown={e => e.key === 'Enter' && e.preventDefault()} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Description
                </label>
                <textarea className="input" value={desc} onChange={e => setDesc(e.target.value)}
                          placeholder="Explain the idea — what problem does it solve? How would it work? Why is it valuable?"
                          style={{ width: '100%', height: 130, resize: 'none', padding: 10, fontSize: 13, lineHeight: 1.6 }} />
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 7, fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                💡 Your idea will be visible to the whole team. The lead will approve or reject it with a reason — you can then counter back.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn primary" onClick={submitIdea} disabled={!title.trim() || !desc.trim() || submitting}>
                {submitting ? 'Submitting…' : 'Submit idea'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thread modal */}
      {openIdea && (
        <IdeaThread
          idea={openIdea}
          me={me}
          onClose={() => setOpenIdea(null)}
          onUpdate={handleIdeaUpdate}
          onDelete={isLead ? () => setConfirmDeleteIdea(openIdea) : null}
        />
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteIdea && (
        <div className="modal-back" onClick={() => setConfirmDeleteIdea(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ color: '#fb7185' }}>🗑 Delete idea?</h2>
              <button className="btn ghost" onClick={() => setConfirmDeleteIdea(null)}><Icon name="x" size={13} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
                Are you sure you want to delete <strong>"{confirmDeleteIdea.title}"</strong>? This will also remove all comments in the thread. This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDeleteIdea(null)}>Cancel</button>
              <button onClick={handleDelete}
                      style={{ background: '#fb7185', color: '#fff', border: 'none', borderRadius: 6, padding: '0 16px', height: 32, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { Icon } from '../data.jsx'
import {
  listPersonalSenderOrganizations, listPersonalSenderTeams, listPersonalSenderLabels, sendPersonalEmail,
  checkPersonalEmailReplies, savePersonalEmailBatch, loadPersonalEmailBatches, loadPersonalEmailSentLog,
  loadPersonalEmailTemplates, savePersonalEmailTemplate, deletePersonalEmailTemplate,
} from '../lib/supabase.js'

// Dev Pandya's member_id slug — client-side `me.id` is always this short TEAM/
// user_profiles.member_id slug, not the Supabase UUID (App.jsx remaps the profile to
// `{ id: profile.member_id, ... }` before any page sees it). Only the server-side check in
// api/personal-email-sender.js uses the real UUID, since it reads user_profiles directly.
// This page is personal to one specific person, not role- or allowlist-gated. Keep in sync
// with the nav-visibility check in src/components/Shell.jsx.
const DEV_MEMBER_ID = 'dev'

const FROM_ADDRESSES_KEY = 'personalSender.fromAddresses'
const DEFAULT_FROM_ADDRESSES = [{ address: 'info@guestpostlinks.net', name: 'GUESTPOSTLINKS' }]

function loadFromAddresses() {
  try {
    const raw = localStorage.getItem(FROM_ADDRESSES_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_FROM_ADDRESSES
    // Heals a stale saved entry from before the default display name changed from "Dev
    // Pandya" to "GUESTPOSTLINKS" — a browser that already saved the old default would
    // otherwise keep showing it forever, since a saved value always wins over the default.
    return parsed.map(f => (f.address === 'info@guestpostlinks.net' && f.name === 'Dev Pandya') ? { ...f, name: 'GUESTPOSTLINKS' } : f)
  } catch { return DEFAULT_FROM_ADDRESSES }
}
function saveFromAddresses(list) {
  try { localStorage.setItem(FROM_ADDRESSES_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

const BLANK_DEFAULTS = { subject: '', template: 'Hi {{name}},\n\n', signature: '', from: '' }

const uid = () => Math.random().toString(36).slice(2)

function parseBulkLines(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split(',').map(s => s.trim())
    return parts.length >= 2 ? { name: parts[0], email: parts[1] } : { name: '', email: parts[0] }
  }).filter(r => r.email)
}

function mkRow({ name, email }, defaults) {
  return {
    id: uid(),
    name: name || '',
    email,
    subject: defaults.subject,
    template: defaults.template,
    signature: defaults.signature,
    from: defaults.from,
    status: 'pending', // 'pending' | 'sending' | 'sent' | 'error'
    error: '',
    sentAt: null,
    webUrl: null,
    conversationId: null,
    messagesCountAtSend: null,
    hasReply: false,
  }
}

function batchLabel(b) {
  return b.batch_name?.trim() || `Batch · ${new Date(b.created_at).toLocaleDateString()}`
}
function batchReplyCount(b) {
  return (b.rows || []).filter(r => r.hasReply).length
}

const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }
const inputStyle = { width: '100%', fontSize: 13 }
const textareaStyle = { ...inputStyle, minHeight: 90, lineHeight: 1.5, resize: 'vertical' }
const sectionHeadStyle = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 16 }

const STATUS_STYLE = {
  pending: { color: 'var(--text-faint)', label: 'Pending' },
  sending: { color: '#60a5fa', label: 'Sending…' },
  sent:    { color: '#4ade80', label: '✓ Sent' },
  error:   { color: '#f87171', label: '✗ Failed' },
}

// Reused by both the "New Batch" form and the active batch's own settings.
function LabelPicker({ labels, filter, onFilterChange, selected, onToggle }) {
  const filtered = filter.trim() ? labels.filter(l => l.name.toLowerCase().includes(filter.trim().toLowerCase())) : labels
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ ...labelStyle, marginBottom: 0 }}>
          Missive labels {labels.length > 0 && <span>· {labels.length} loaded</span>} {selected.length > 0 && <span style={{ color: 'var(--accent)' }}>· {selected.length} selected</span>}
        </span>
        <input className="input" style={{ width: 200, fontSize: 12 }} placeholder="Filter labels…" value={filter} onChange={e => onFilterChange(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto', padding: '2px 2px 0' }}>
        {labels.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No shared labels found for this organization.</span>}
        {labels.length > 0 && filtered.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No labels match "{filter}".</span>}
        {filtered.map(l => {
          const on = selected.includes(l.id)
          return (
            <button key={l.id} onClick={() => onToggle(l.id)} type="button"
              style={{
                fontSize: 12, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                background: on ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--surface)',
                color: on ? 'var(--accent)' : 'var(--text-dim)',
                fontWeight: on ? 600 : 400,
                transition: 'background .12s, border-color .12s, color .12s',
              }}>
              {l.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PersonalEmailSender({ me }) {
  if (me?.id !== DEV_MEMBER_ID) {
    return (
      <div className="page" style={{ maxWidth: 600 }}>
        <div className="page-head"><div><h1>Personal Email Sender</h1></div></div>
        <div className="card" style={{ padding: 20, fontSize: 13, color: 'var(--text-faint)' }}>
          This tool is restricted to a specific user.
        </div>
      </div>
    )
  }

  const [organizations, setOrganizations] = useState([])
  const [organizationId, setOrganizationId] = useState('')
  const [orgError, setOrgError] = useState('')

  const [teams, setTeams] = useState([])
  const [labels, setLabels] = useState([])
  const [labelFilter, setLabelFilter] = useState('')

  const [fromAddresses, setFromAddresses] = useState(loadFromAddresses)
  const [fromEditorText, setFromEditorText] = useState(() => loadFromAddresses().map(f => `${f.name} <${f.address}>`).join('\n'))

  const [defaults, setDefaults] = useState(() => ({ ...BLANK_DEFAULTS, from: fromAddresses[0]?.address || '' }))

  // Named, reusable templates (subject/body/signature) — explicit save/load, not an
  // auto-saved "last used" draft. templateId is the currently loaded template (null = unsaved).
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState(null)
  const [templateName, setTemplateName] = useState('')
  const [templateStatus, setTemplateStatus] = useState('') // '' | 'saving' | 'saved' | error message

  // Batches — each one is its own named, explicitly-created recipient list + Team/Labels,
  // shown as its own tab. No more silent "a batch gets created the moment you add a row".
  const [batches, setBatches] = useState([])
  const [activeBatchId, setActiveBatchId] = useState(null)
  const [checkingReplies, setCheckingReplies] = useState(false)
  // checkAllReplies can be invoked (from the mount effect) before activeBatchId has caught up
  // to a just-set value in the same tick — a ref always reads the live value regardless of
  // when the function closing over it was created.
  const activeBatchIdRef = useRef(null)
  useEffect(() => { activeBatchIdRef.current = activeBatchId }, [activeBatchId])

  const [newBatchOpen, setNewBatchOpen] = useState(false)
  const [newBatchName, setNewBatchName] = useState('')
  const [newBatchTeamId, setNewBatchTeamId] = useState('')
  const [newBatchLabelIds, setNewBatchLabelIds] = useState([])
  const [newBatchLabelFilter, setNewBatchLabelFilter] = useState('')
  const [creatingBatch, setCreatingBatch] = useState(false)
  const [newBatchError, setNewBatchError] = useState('')

  // The active batch's own working copy — loaded in when its tab is selected, auto-saved back.
  const [batchName, setBatchName] = useState('')
  const [batchTeamId, setBatchTeamId] = useState('')
  const [batchLabelIds, setBatchLabelIds] = useState([])
  const [rows, setRows] = useState([])
  const [saveStatus, setSaveStatus] = useState('') // '' | 'saving' | 'saved' | error message
  const saveTimer = useRef(null)

  const [bulkText, setBulkText] = useState('')

  const [sentLog, setSentLog] = useState([])

  // Re-checks every batch's sent rows for new replies (message count grew since send) and
  // persists any changed hasReply flags back to their batches. Takes the batch list explicitly
  // (rather than reading state) so it works the same whether called with freshly-loaded data
  // on mount or with the current `batches` state from a manual refresh click.
  async function checkAllReplies(batchList) {
    const entries = []
    for (const b of batchList) {
      for (const r of (b.rows || [])) {
        if (r.conversationId && r.messagesCountAtSend != null) {
          entries.push({ conversationId: r.conversationId, baselineCount: r.messagesCountAtSend })
        }
      }
    }
    if (!entries.length) return
    setCheckingReplies(true)
    try {
      const results = await checkPersonalEmailReplies(entries)
      const byConv = new Map(results.map(r => [r.conversationId, r]))
      const touched = new Set()
      const updated = batchList.map(b => {
        let changed = false
        const newRows = (b.rows || []).map(r => {
          const res = r.conversationId && byConv.get(r.conversationId)
          if (!res) return r
          const hasReply = !!res.hasReply
          if (hasReply !== !!r.hasReply) changed = true
          return { ...r, hasReply }
        })
        if (changed) touched.add(b.id)
        return { ...b, rows: newRows }
      })
      setBatches(updated)
      setRows(prevRows => {
        const active = updated.find(b => b.id === activeBatchIdRef.current)
        return active ? active.rows : prevRows
      })
      await Promise.all(updated.filter(b => touched.has(b.id)).map(b =>
        savePersonalEmailBatch({ id: b.id, batchName: b.batch_name, teamId: b.team_id, sharedLabelIds: b.shared_label_ids, rows: b.rows }).catch(() => {})
      ))
    } catch { /* best-effort — a failed check just leaves badges as they were */ }
    finally { setCheckingReplies(false) }
  }

  useEffect(() => {
    listPersonalSenderOrganizations()
      .then(orgs => { setOrganizations(orgs); if (orgs.length) setOrganizationId(orgs[0].id) })
      .catch(err => setOrgError(err.message))
    loadPersonalEmailBatches().then(bs => {
      setBatches(bs)
      if (bs.length) setActiveBatchId(bs[0].id) // newest first — land on the most recent batch
      checkAllReplies(bs)
    }).catch(() => {})
    loadPersonalEmailSentLog().then(setSentLog).catch(() => {})
    loadPersonalEmailTemplates().then(setTemplates).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!organizationId) return
    listPersonalSenderTeams(organizationId).then(setTeams).catch(() => setTeams([]))
    listPersonalSenderLabels(organizationId).then(setLabels).catch(() => setLabels([]))
  }, [organizationId])

  // Switching tabs loads that batch's own rows/name/team/labels into the working state below.
  useEffect(() => {
    const b = batches.find(x => x.id === activeBatchId)
    if (!b) { setRows([]); setBatchName(''); setBatchTeamId(''); setBatchLabelIds([]); return }
    setRows(b.rows || [])
    setBatchName(b.batch_name || '')
    setBatchTeamId(b.team_id || '')
    setBatchLabelIds(b.shared_label_ids || [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBatchId])

  // Auto-saves the active batch (debounced) whenever its rows/name/team/labels change.
  useEffect(() => {
    if (!activeBatchId) return
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const saved = await savePersonalEmailBatch({ id: activeBatchId, batchName, teamId: batchTeamId, sharedLabelIds: batchLabelIds, rows })
        setBatches(prev => prev.map(b => b.id === saved.id ? saved : b))
        setSaveStatus('saved')
      } catch (err) {
        setSaveStatus(err.message)
      }
    }, 800)
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, batchName, batchTeamId, batchLabelIds])

  function applyFromAddresses() {
    const list = fromEditorText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const m = line.match(/^(.*?)\s*<(.+?)>$/)
      return m ? { name: m[1].trim(), address: m[2].trim() } : { name: '', address: line }
    }).filter(f => f.address)
    const final = list.length ? list : DEFAULT_FROM_ADDRESSES
    setFromAddresses(final)
    saveFromAddresses(final)
    if (!final.some(f => f.address === defaults.from)) setDefaults(d => ({ ...d, from: final[0].address }))
  }

  function loadTemplate(id) {
    const t = templates.find(x => x.id === id)
    if (!t) return
    setTemplateId(t.id)
    setTemplateName(t.name)
    setDefaults(d => ({ ...d, subject: t.subject, template: t.template, signature: t.signature }))
  }

  function newTemplate() {
    setTemplateId(null)
    setTemplateName('')
    setTemplateStatus('')
  }

  async function saveTemplate(asNew) {
    const name = templateName.trim()
    if (!name) { setTemplateStatus('Name the template before saving'); return }
    setTemplateStatus('saving')
    try {
      const saved = await savePersonalEmailTemplate({
        id: asNew ? null : templateId,
        name,
        subject: defaults.subject,
        template: defaults.template,
        signature: defaults.signature,
      })
      setTemplates(prev => {
        const others = prev.filter(t => t.id !== saved.id)
        return [...others, saved].sort((a, b) => a.name.localeCompare(b.name))
      })
      setTemplateId(saved.id)
      setTemplateStatus('saved')
    } catch (err) {
      setTemplateStatus(err.message)
    }
  }

  async function removeTemplate() {
    if (!templateId) return
    try {
      await deletePersonalEmailTemplate(templateId)
      setTemplates(prev => prev.filter(t => t.id !== templateId))
      newTemplate()
    } catch (err) {
      setTemplateStatus(err.message)
    }
  }

  function openNewBatchForm() {
    const active = batches.find(b => b.id === activeBatchId)
    setNewBatchName('')
    setNewBatchTeamId(active?.team_id || '')
    setNewBatchLabelIds(active?.shared_label_ids || [])
    setNewBatchLabelFilter('')
    setNewBatchError('')
    setNewBatchOpen(true)
  }

  async function createBatch() {
    const name = newBatchName.trim()
    if (!name) { setNewBatchError('Name the batch before creating it'); return }
    setCreatingBatch(true); setNewBatchError('')
    try {
      const saved = await savePersonalEmailBatch({ batchName: name, teamId: newBatchTeamId, sharedLabelIds: newBatchLabelIds, rows: [] })
      setBatches(prev => [saved, ...prev])
      setActiveBatchId(saved.id)
      setNewBatchOpen(false)
    } catch (err) {
      setNewBatchError(err.message)
    } finally {
      setCreatingBatch(false)
    }
  }

  function addBulkRows() {
    const parsed = parseBulkLines(bulkText)
    if (!parsed.length) return
    setRows(prev => [...prev, ...parsed.map(r => mkRow(r, defaults))])
    setBulkText('')
  }

  function updateRow(id, patch) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }
  function removeRow(id) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  async function sendRow(row) {
    updateRow(row.id, { status: 'sending', error: '' })
    const fromEntry = fromAddresses.find(f => f.address === row.from) || fromAddresses[0]
    try {
      const result = await sendPersonalEmail({
        to: { address: row.email, name: row.name },
        from: fromEntry,
        subject: row.subject,
        template: row.template,
        signature: row.signature,
        team: batchTeamId || undefined,
        sharedLabelIds: batchLabelIds,
        organizationId,
        batchId: activeBatchId,
      })
      const sentAt = new Date().toISOString()
      updateRow(row.id, {
        status: 'sent', sentAt, webUrl: result.webUrl || null,
        conversationId: result.conversationId || null,
        messagesCountAtSend: result.messagesCount ?? null,
        hasReply: false,
      })
      setSentLog(prev => [{
        id: uid(), sent_at: sentAt, recipient_name: row.name, recipient_email: row.email,
        subject: row.subject, web_url: result.webUrl || null,
      }, ...prev])
    } catch (err) {
      updateRow(row.id, { status: 'error', error: err.message })
    }
  }

  const activeBatch = batches.find(b => b.id === activeBatchId) || null
  const pendingCount = rows.filter(r => r.status === 'pending' || r.status === 'error').length

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>Personal Email Sender</h1>
          <div className="sub">Bulk-prepare individual emails, sent one at a time via Missive — Dev only</div>
        </div>
      </div>

      {/* ── From Addresses & Defaults (global, not per-batch) ─── */}
      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ ...sectionHeadStyle, marginBottom: 0 }}>Defaults for newly added recipients</div>
          {templates.length > 0 && (
            <select className="input" style={{ fontSize: 12, width: 'auto' }} value={templateId || ''} onChange={e => e.target.value ? loadTemplate(e.target.value) : newTemplate()}>
              <option value="">— new template —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>

        {orgError && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 14 }}>{orgError}</div>}

        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
          Use <code>{'{{name}}'}</code> for each recipient's name, and <code>**bold**</code> or a line starting with
          "<code>- </code>" for a bullet list — both render properly in the sent email. Leave Signature blank to
          automatically use whatever signature is already configured in Missive for the sending address; type one here
          to override it. Each recipient's subject/template/signature/from can still be edited individually after adding.
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, padding: 12, background: 'rgba(255,255,255,.02)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <input className="input" style={{ flex: 1, fontSize: 13 }} placeholder={'Template name, e.g. "Guest post pitch v1"'}
            value={templateName} onChange={e => { setTemplateName(e.target.value); setTemplateStatus('') }} />
          <button className="btn" onClick={() => saveTemplate(!templateId)} disabled={!templateName.trim()} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {templateId ? 'Update' : 'Save as new'}
          </button>
          {templateId && (
            <button className="btn ghost" onClick={() => saveTemplate(true)} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Save as copy</button>
          )}
          {templateId && (
            <button className="btn ghost" onClick={removeTemplate} style={{ fontSize: 12, padding: '4px 8px' }}><Icon name="trash" size={13} /></button>
          )}
          {templateStatus === 'saving' && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Saving…</span>}
          {templateStatus === 'saved' && <span style={{ fontSize: 11, color: '#4ade80' }}>✓ Saved</span>}
          {templateStatus && templateStatus !== 'saving' && templateStatus !== 'saved' && <span style={{ fontSize: 11, color: '#f87171' }}>{templateStatus}</span>}
        </div>

        <div style={{ marginBottom: 16 }}>
          <span style={labelStyle}>Subject</span>
          <input className="input" style={inputStyle} value={defaults.subject} onChange={e => setDefaults(d => ({ ...d, subject: e.target.value }))} placeholder="e.g. Quick question about {{name}}'s site" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          <div>
            <span style={labelStyle}>Template</span>
            <textarea className="input" style={{ ...textareaStyle, minHeight: 150 }} value={defaults.template} onChange={e => setDefaults(d => ({ ...d, template: e.target.value }))} />
          </div>
          <div>
            <span style={labelStyle}>Signature</span>
            <textarea className="input" style={{ ...textareaStyle, minHeight: 150 }} value={defaults.signature} onChange={e => setDefaults(d => ({ ...d, signature: e.target.value }))} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <span style={labelStyle}>Default From</span>
            <select className="input" style={inputStyle} value={defaults.from} onChange={e => setDefaults(d => ({ ...d, from: e.target.value }))}>
              {fromAddresses.map(f => <option key={f.address} value={f.address}>{f.name ? `${f.name} <${f.address}>` : f.address}</option>)}
            </select>
          </div>
        </div>
        <span style={labelStyle}>From addresses (one per line, "Name &lt;email&gt;")</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea className="input" style={{ ...inputStyle, minHeight: 56, resize: 'vertical', fontFamily: 'var(--font-mono, monospace)' }} rows={2}
            value={fromEditorText} onChange={e => setFromEditorText(e.target.value)} />
          <button className="btn ghost" onClick={applyFromAddresses} style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>Apply</button>
        </div>
      </div>

      {/* ── Batch tabs ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {batches.map(b => {
          const replyCount = batchReplyCount(b)
          const active = b.id === activeBatchId
          return (
            <button key={b.id} onClick={() => setActiveBatchId(b.id)} type="button"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--surface)',
                color: active ? 'var(--accent)' : 'var(--text-dim)',
                fontWeight: active ? 700 : 400,
              }}>
              {replyCount > 0 && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f87171', flexShrink: 0 }} />}
              {batchLabel(b)}
              <span style={{ opacity: 0.6 }}>· {(b.rows || []).length}</span>
              {replyCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171' }}>{replyCount} repl{replyCount === 1 ? 'y' : 'ies'}</span>}
            </button>
          )
        })}
        <button className="btn ghost" onClick={openNewBatchForm} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>+ New Batch</button>
        <button className="btn ghost" onClick={() => checkAllReplies(batches)} disabled={checkingReplies} style={{ fontSize: 12, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
          {checkingReplies ? 'Checking…' : '↻ Check replies'}
        </button>
      </div>

      {/* ── New batch form ─────────────────────────────── */}
      {newBatchOpen && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <div style={sectionHeadStyle}>New Batch</div>
          <div style={{ marginBottom: 16 }}>
            <span style={labelStyle}>Name</span>
            <input className="input" style={inputStyle} autoFocus value={newBatchName} onChange={e => setNewBatchName(e.target.value)}
              placeholder={'e.g. "CBD niche outreach — Oct batch"'} onKeyDown={e => e.key === 'Enter' && createBatch()} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <span style={labelStyle}>Team</span>
            <select className="input" style={inputStyle} value={newBatchTeamId} onChange={e => setNewBatchTeamId(e.target.value)}>
              <option value="">— none —</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <LabelPicker labels={labels} filter={newBatchLabelFilter} onFilterChange={setNewBatchLabelFilter}
              selected={newBatchLabelIds} onToggle={id => setNewBatchLabelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />
          </div>
          {newBatchError && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 12 }}>{newBatchError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={createBatch} disabled={creatingBatch || !newBatchName.trim()}>
              {creatingBatch ? 'Creating…' : 'Create Batch'}
            </button>
            <button className="btn ghost" onClick={() => setNewBatchOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Active batch ───────────────────────────────── */}
      {!activeBatch ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          {batches.length === 0 ? 'No batches yet — create one to start adding recipients.' : 'Select a batch above, or create a new one.'}
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <input className="input" style={{ fontSize: 15, fontWeight: 700, flex: 1, minWidth: 200 }} value={batchName}
                onChange={e => setBatchName(e.target.value)} placeholder="Batch name" />
              {saveStatus === 'saving' && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Saving…</span>}
              {saveStatus === 'saved' && <span style={{ fontSize: 11, color: '#4ade80' }}>✓ Saved</span>}
              {saveStatus && saveStatus !== 'saving' && saveStatus !== 'saved' && <span style={{ fontSize: 11, color: '#f87171' }}>{saveStatus}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <span style={labelStyle}>Team</span>
                <select className="input" style={inputStyle} value={batchTeamId} onChange={e => setBatchTeamId(e.target.value)}>
                  <option value="">— none —</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <LabelPicker labels={labels} filter={labelFilter} onFilterChange={setLabelFilter}
              selected={batchLabelIds} onToggle={id => setBatchLabelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />
          </div>

          {/* ── Bulk add ───────────────────────────────── */}
          <div className="card" style={{ marginBottom: 20, padding: 20 }}>
            <div style={sectionHeadStyle}>Add recipients in bulk</div>
            <textarea className="input" style={{ ...textareaStyle, minHeight: 120, fontFamily: 'var(--font-mono, monospace)' }}
              placeholder={'One per line:\nJane Doe, jane@example.com\njohn@example.com'}
              value={bulkText} onChange={e => setBulkText(e.target.value)} />
            <button className="btn" onClick={addBulkRows} disabled={!bulkText.trim()} style={{ marginTop: 12 }}>
              Add {parseBulkLines(bulkText).length || ''} recipient{parseBulkLines(bulkText).length === 1 ? '' : 's'}
            </button>
          </div>

          {/* ── Recipients ─────────────────────────────── */}
          {rows.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <div>
                  <h3>Recipients</h3>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                    {rows.length} total · {pendingCount} not yet sent
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
                {rows.map(row => {
                  const st = STATUS_STYLE[row.status]
                  return (
                    <div key={row.id} className="card" style={{ padding: 16, background: 'rgba(255,255,255,.02)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, marginBottom: 14, alignItems: 'end' }}>
                        <div>
                          <span style={labelStyle}>Name</span>
                          <input className="input" style={inputStyle} value={row.name} onChange={e => updateRow(row.id, { name: e.target.value })} />
                        </div>
                        <div>
                          <span style={labelStyle}>Email</span>
                          <input className="input" style={inputStyle} value={row.email} onChange={e => updateRow(row.id, { email: e.target.value })} />
                        </div>
                        <div>
                          <span style={labelStyle}>From</span>
                          <select className="input" style={inputStyle} value={row.from} onChange={e => updateRow(row.id, { from: e.target.value })}>
                            {fromAddresses.map(f => <option key={f.address} value={f.address}>{f.name ? `${f.name} <${f.address}>` : f.address}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>
                          <button className="btn" disabled={row.status === 'sending' || !row.email}
                            onClick={() => sendRow(row)}
                            style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                            {row.status === 'sent' ? 'Re-send' : 'Send'}
                          </button>
                          <button className="btn ghost" onClick={() => removeRow(row.id)} style={{ fontSize: 12, padding: '4px 8px' }}>
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </div>
                      <div style={{ marginBottom: 14 }}>
                        <span style={labelStyle}>Subject</span>
                        <input className="input" style={inputStyle} value={row.subject} onChange={e => updateRow(row.id, { subject: e.target.value })} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <span style={labelStyle}>Template</span>
                          <textarea className="input" style={textareaStyle} value={row.template} onChange={e => updateRow(row.id, { template: e.target.value })} />
                        </div>
                        <div>
                          <span style={labelStyle}>Signature</span>
                          <textarea className="input" style={textareaStyle} value={row.signature} onChange={e => updateRow(row.id, { signature: e.target.value })} />
                        </div>
                      </div>
                      {row.status === 'error' && row.error && (
                        <div style={{ marginTop: 10, fontSize: 12, color: '#f87171' }}>{row.error}</div>
                      )}
                      {row.status === 'sent' && row.sentAt && (
                        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-faint)', display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span>Sent {new Date(row.sentAt).toLocaleString()}</span>
                          {row.webUrl && <a href={row.webUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>View in Missive →</a>}
                          {row.hasReply && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: '#f87171' }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f87171' }} /> Reply received
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Sent log ───────────────────────────────────── */}
      {sentLog.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Sent Log</h3>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>{sentLog.length} emails sent, all batches</div>
            </div>
          </div>
          <div className="card-pad" style={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '8px 16px' }}>Sent</th>
                  <th style={{ padding: '8px 16px' }}>Recipient</th>
                  <th style={{ padding: '8px 16px' }}>Subject</th>
                  <th style={{ padding: '8px 16px' }}>Missive</th>
                </tr>
              </thead>
              <tbody>
                {sentLog.map(entry => (
                  <tr key={entry.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 16px', whiteSpace: 'nowrap', color: 'var(--text-faint)', fontSize: 12 }}>{new Date(entry.sent_at).toLocaleString()}</td>
                    <td style={{ padding: '8px 16px' }}>
                      {entry.recipient_name ? `${entry.recipient_name} ` : ''}
                      <span style={{ color: 'var(--text-faint)' }}>&lt;{entry.recipient_email}&gt;</span>
                    </td>
                    <td style={{ padding: '8px 16px' }}>{entry.subject || <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                    <td style={{ padding: '8px 16px' }}>
                      {entry.web_url
                        ? <a href={entry.web_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open →</a>
                        : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

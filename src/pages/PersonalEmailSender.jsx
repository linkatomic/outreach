import { useState, useEffect, useRef } from 'react'
import { Icon } from '../data.jsx'
import {
  listPersonalSenderOrganizations, listPersonalSenderTeams, listPersonalSenderLabels, sendPersonalEmail,
  savePersonalEmailBatch, loadPersonalEmailBatches,
  loadPersonalEmailTemplates, savePersonalEmailTemplate, deletePersonalEmailTemplate,
} from '../lib/supabase.js'

// Dev Pandya's member_id slug — client-side `me.id` is always this short TEAM/
// user_profiles.member_id slug, not the Supabase UUID (App.jsx remaps the profile to
// `{ id: profile.member_id, ... }` before any page sees it). Only the server-side check in
// api/personal-email-sender.js uses the real UUID, since it reads user_profiles directly.
// This page is personal to one specific person, not role- or allowlist-gated. Keep in sync
// with the nav-visibility check in src/components/Shell.jsx.
const DEV_MEMBER_ID = 'dev'

export const FROM_ADDRESSES_KEY = 'personalSender.fromAddresses'
export const DEFAULT_FROM_ADDRESSES = [{ address: 'info@guestpostlinks.net', name: 'GUESTPOSTLINKS' }]

export function loadFromAddresses() {
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

// Remembers whatever Team/Labels were last used to create a batch, so "New Batch" pre-fills
// them instead of starting blank every time — most batches use the same team/labels, and
// re-picking both on every single one was the actual complaint.
const DEFAULT_BATCH_SETTINGS_KEY = 'personalSender.defaultBatchSettings'
function loadDefaultBatchSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEFAULT_BATCH_SETTINGS_KEY) || 'null')
    return { teamId: parsed?.teamId || '', labelIds: Array.isArray(parsed?.labelIds) ? parsed.labelIds : [] }
  } catch { return { teamId: '', labelIds: [] } }
}
function saveDefaultBatchSettings(teamId, labelIds) {
  try { localStorage.setItem(DEFAULT_BATCH_SETTINGS_KEY, JSON.stringify({ teamId, labelIds })) } catch { /* ignore */ }
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
    note: '', // internal note, posted to the Missive conversation after the email sends
    status: 'pending', // 'pending' | 'sending' | 'sent' | 'error'
    error: '',
    sentAt: null,
    webUrl: null,
    conversationId: null,
    messagesCountAtSend: null,
    hasReply: false,
    noteError: null,
  }
}

function batchLabel(b) {
  return b.batch_name?.trim() || `Batch · ${new Date(b.created_at).toLocaleDateString()}`
}

const textareaStyle = { minHeight: 140, lineHeight: 1.5, resize: 'vertical' }

const STATUS_CHIP = {
  pending: { cls: '', label: 'Pending' },
  sending: { cls: 'info', label: 'Sending…' },
  sent:    { cls: 'ok', label: 'Sent' },
  error:   { cls: 'danger', label: 'Failed' },
}

function SaveChip({ status }) {
  if (!status) return null
  if (status === 'saving') return <span className="chip">Saving…</span>
  if (status === 'saved') return <span className="chip ok">✓ Saved</span>
  return <span className="chip danger">{status}</span>
}

// Reused by both the "New Batch" form and the active batch's own settings.
function LabelPicker({ labels, filter, onFilterChange, selected, onToggle }) {
  const filtered = filter.trim() ? labels.filter(l => l.name.toLowerCase().includes(filter.trim().toLowerCase())) : labels
  return (
    <div>
      <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="label" style={{ marginBottom: 0 }}>
          Missive labels {labels.length > 0 && <span>· {labels.length} loaded</span>} {selected.length > 0 && <span style={{ color: 'var(--accent)' }}>· {selected.length} selected</span>}
        </span>
        <input className="input" style={{ width: 200, height: 26, fontSize: 12 }} placeholder="Filter labels…" value={filter} onChange={e => onFilterChange(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto', padding: '2px 2px 0' }}>
        {labels.length === 0 && <span className="faint" style={{ fontSize: 12 }}>No shared labels found for this organization.</span>}
        {labels.length > 0 && filtered.length === 0 && <span className="faint" style={{ fontSize: 12 }}>No labels match "{filter}".</span>}
        {filtered.map(l => {
          const on = selected.includes(l.id)
          return (
            <button key={l.id} onClick={() => onToggle(l.id)} type="button" className={`chip${on ? ' accent' : ''}`}
              style={{ cursor: 'pointer', padding: '4px 10px', fontFamily: 'inherit' }}>
              {l.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Email Sender is the full compose-and-send workflow — named templates, From addresses,
// batches of recipients, and the Send button itself. Reply/delivery tracking across what's
// already been sent lives on the separate Tracking page instead, so this page stays focused
// on getting an email out the door.
export function PersonalEmailSender({ me }) {
  if (me?.id !== DEV_MEMBER_ID) {
    return (
      <div className="page" style={{ maxWidth: 600 }}>
        <div className="page-head"><div><h1>Email Sender</h1></div></div>
        <div className="card card-pad" style={{ fontSize: 13, color: 'var(--text-faint)' }}>
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

  const [defaults, setDefaults] = useState(() => ({ ...BLANK_DEFAULTS, from: loadFromAddresses()[0]?.address || '' }))

  // Named, reusable templates (subject/body/signature) — explicit save/load, not an
  // auto-saved "last used" draft. templateId is the currently loaded template (null = unsaved).
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState(null)
  const [templateName, setTemplateName] = useState('')
  const [templateStatus, setTemplateStatus] = useState('') // '' | 'saving' | 'saved' | error message

  // Batches — each one is its own named, explicitly-created recipient list + Team/Labels,
  // shown as its own tab. No batch is ever created silently just by adding a row.
  const [batches, setBatches] = useState([])
  const [activeBatchId, setActiveBatchId] = useState(null)

  const [newBatchOpen, setNewBatchOpen] = useState(false)
  const [newBatchName, setNewBatchName] = useState('')
  const [newBatchTeamId, setNewBatchTeamId] = useState('')
  const [newBatchLabelIds, setNewBatchLabelIds] = useState([])
  const [newBatchLabelFilter, setNewBatchLabelFilter] = useState('')
  const [newBatchCommonMode, setNewBatchCommonMode] = useState(true)
  const [creatingBatch, setCreatingBatch] = useState(false)
  const [newBatchError, setNewBatchError] = useState('')

  // The active batch's own working copy — loaded in when its tab is selected, auto-saved back.
  const [batchName, setBatchName] = useState('')
  const [batchTeamId, setBatchTeamId] = useState('')
  const [batchLabelIds, setBatchLabelIds] = useState([])
  // "Same email for everyone": hides each row's own Subject/Template/Signature and keeps
  // them synced to the Defaults card above instead — for a batch that's genuinely the same
  // pitch to everyone, editing N copies of the same two paragraphs was pure scroll-and-repeat.
  // Off, each row keeps (and shows) its own independently-edited copy, for a batch that's
  // actually personalized per recipient.
  const [commonMode, setCommonMode] = useState(true)
  const [rows, setRows] = useState([])
  const [saveStatus, setSaveStatus] = useState('') // '' | 'saving' | 'saved' | error message
  const saveTimer = useRef(null)

  const [bulkText, setBulkText] = useState('')

  useEffect(() => {
    listPersonalSenderOrganizations()
      .then(orgs => { setOrganizations(orgs); if (orgs.length) setOrganizationId(orgs[0].id) })
      .catch(err => setOrgError(err.message))
    loadPersonalEmailBatches().then(bs => {
      setBatches(bs)
      if (bs.length) setActiveBatchId(bs[0].id) // newest first — land on the most recent batch
    }).catch(() => {})
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
    if (!b) { setRows([]); setBatchName(''); setBatchTeamId(''); setBatchLabelIds([]); setCommonMode(true); return }
    setRows(b.rows || [])
    setBatchName(b.batch_name || '')
    setBatchTeamId(b.team_id || '')
    setBatchLabelIds(b.shared_label_ids || [])
    setCommonMode(!!b.common_mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBatchId])

  // While commonMode is on, every row's subject/template/signature mirrors the Defaults card
  // above — this keeps that in sync whenever Defaults changes, and also does the one-time
  // sync the moment commonMode is switched on (so flipping it doesn't leave stale per-row
  // copies sitting there unseen behind the hidden fields).
  useEffect(() => {
    if (!commonMode) return
    setRows(prev => prev.map(r => (
      r.subject === defaults.subject && r.template === defaults.template && r.signature === defaults.signature
        ? r
        : { ...r, subject: defaults.subject, template: defaults.template, signature: defaults.signature }
    )))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commonMode, defaults.subject, defaults.template, defaults.signature])

  // Auto-saves the active batch (debounced) whenever its rows/name/team/labels/mode change.
  useEffect(() => {
    if (!activeBatchId) return
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const saved = await savePersonalEmailBatch({ id: activeBatchId, batchName, teamId: batchTeamId, sharedLabelIds: batchLabelIds, rows, commonMode })
        setBatches(prev => prev.map(b => b.id === saved.id ? saved : b))
        setSaveStatus('saved')
      } catch (err) {
        setSaveStatus(err.message)
      }
    }, 800)
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, batchName, batchTeamId, batchLabelIds, commonMode])

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
    setTemplateStatus('')
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
    const saved = loadDefaultBatchSettings()
    const active = batches.find(b => b.id === activeBatchId)
    setNewBatchName('')
    setNewBatchTeamId(saved.teamId || active?.team_id || '')
    setNewBatchLabelIds(saved.labelIds.length ? saved.labelIds : (active?.shared_label_ids || []))
    setNewBatchLabelFilter('')
    setNewBatchCommonMode(true)
    setNewBatchError('')
    setNewBatchOpen(true)
  }

  async function createBatch() {
    const name = newBatchName.trim()
    if (!name) { setNewBatchError('Name the batch before creating it'); return }
    setCreatingBatch(true); setNewBatchError('')
    try {
      const saved = await savePersonalEmailBatch({ batchName: name, teamId: newBatchTeamId, sharedLabelIds: newBatchLabelIds, rows: [], commonMode: newBatchCommonMode })
      saveDefaultBatchSettings(newBatchTeamId, newBatchLabelIds)
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
        note: row.note,
        team: batchTeamId || undefined,
        sharedLabelIds: batchLabelIds,
        organizationId,
        batchId: activeBatchId,
      })
      updateRow(row.id, {
        status: 'sent', sentAt: new Date().toISOString(), webUrl: result.webUrl || null,
        conversationId: result.conversationId || null,
        messagesCountAtSend: result.messagesCount ?? null,
        hasReply: false,
        noteError: result.noteError || null,
      })
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
          <h1>Email Sender</h1>
          <div className="sub">Compose, bulk-prepare, and send individual emails via Missive</div>
        </div>
      </div>

      {/* ── Defaults: templates & From addresses ────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <h3>Defaults for newly added recipients</h3>
          {templates.length > 0 && (
            <div className="actions">
              <select className="input" style={{ width: 220 }} value={templateId || ''} onChange={e => e.target.value ? loadTemplate(e.target.value) : newTemplate()}>
                <option value="">— new template —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="card-pad">
          {orgError && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 14 }}>{orgError}</div>}

          <div className="faint" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
            Use <code>{'{{name}}'}</code> for each recipient's name, and <code>**bold**</code> or a line starting with
            "<code>- </code>" for a bullet list — both render properly in the sent email. Leave Signature blank to
            automatically use whatever signature is already configured in Missive for the sending address. Each
            batch has its own "Email mode" below — "Customize each individually" lets every recipient keep their own
            edited subject/template/signature; "Same email for everyone" keeps all of them mirroring what's set here.
          </div>

          <div className="row-flex" style={{ marginBottom: 20 }}>
            <input className="input" style={{ flex: 1 }} placeholder={'Template name, e.g. "Guest post pitch v1"'}
              value={templateName} onChange={e => { setTemplateName(e.target.value); setTemplateStatus('') }} />
            <button className="btn primary" onClick={() => saveTemplate(!templateId)} disabled={!templateName.trim()}>
              {templateId ? 'Update' : 'Save as new'}
            </button>
            {templateId && <button className="btn ghost" onClick={() => saveTemplate(true)}>Save as copy</button>}
            {templateId && <button className="btn ghost" onClick={removeTemplate} style={{ padding: '0 8px' }}><Icon name="trash" size={13} /></button>}
            <SaveChip status={templateStatus} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <span className="label">Subject</span>
            <input className="input" value={defaults.subject} onChange={e => setDefaults(d => ({ ...d, subject: e.target.value }))} placeholder="e.g. Quick question about {{name}}'s site" />
          </div>
          <div className="grid grid-2" style={{ marginBottom: 20 }}>
            <div>
              <span className="label">Template</span>
              <textarea className="input" style={textareaStyle} value={defaults.template} onChange={e => setDefaults(d => ({ ...d, template: e.target.value }))} />
            </div>
            <div>
              <span className="label">Signature</span>
              <textarea className="input" style={textareaStyle} value={defaults.signature} onChange={e => setDefaults(d => ({ ...d, signature: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <span className="label">Default From</span>
            <select className="input" value={defaults.from} onChange={e => setDefaults(d => ({ ...d, from: e.target.value }))}>
              {fromAddresses.map(f => <option key={f.address} value={f.address}>{f.name ? `${f.name} <${f.address}>` : f.address}</option>)}
            </select>
          </div>

          <span className="label">From addresses (one per line, "Name &lt;email&gt;")</span>
          <div className="row-flex" style={{ alignItems: 'flex-start' }}>
            <textarea className="input" style={{ minHeight: 56, resize: 'vertical', fontFamily: 'var(--font-mono)' }} rows={2}
              value={fromEditorText} onChange={e => setFromEditorText(e.target.value)} />
            <button className="btn" onClick={applyFromAddresses} style={{ flexShrink: 0 }}>Apply</button>
          </div>
        </div>
      </div>

      {/* ── Batch tabs ─────────────────────────────────── */}
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {batches.map(b => {
          const active = b.id === activeBatchId
          return (
            <div key={b.id} className={`tab${active ? ' active' : ''}`} onClick={() => setActiveBatchId(b.id)}>
              {batchLabel(b)}
              <span className="count">{(b.rows || []).length}</span>
            </div>
          )
        })}
        <div className="tab" onClick={openNewBatchForm} style={{ color: 'var(--accent)' }}>
          <Icon name="plus" size={12} /> New batch
        </div>
      </div>

      {/* ── New batch form ─────────────────────────────── */}
      {newBatchOpen && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head"><h3>New Batch</h3></div>
          <div className="card-pad">
            <div style={{ marginBottom: 16 }}>
              <span className="label">Name</span>
              <input className="input" autoFocus value={newBatchName} onChange={e => setNewBatchName(e.target.value)}
                placeholder={'e.g. "CBD niche outreach — Oct batch"'} onKeyDown={e => e.key === 'Enter' && createBatch()} />
            </div>
            <div className="faint" style={{ fontSize: 11, marginBottom: 16, lineHeight: 1.5 }}>
              Team and labels below are pre-filled from the last batch you created — change them here
              and they'll become the new default for next time, so you only need to set them when they
              actually change.
            </div>
            <div style={{ marginBottom: 16 }}>
              <span className="label">Team</span>
              <select className="input" value={newBatchTeamId} onChange={e => setNewBatchTeamId(e.target.value)}>
                <option value="">— none —</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <LabelPicker labels={labels} filter={newBatchLabelFilter} onFilterChange={setNewBatchLabelFilter}
                selected={newBatchLabelIds} onToggle={id => setNewBatchLabelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <span className="label">Email mode</span>
              <span className="seg">
                <button type="button" className={newBatchCommonMode ? 'on' : ''} onClick={() => setNewBatchCommonMode(true)}>Same email for everyone</button>
                <button type="button" className={!newBatchCommonMode ? 'on' : ''} onClick={() => setNewBatchCommonMode(false)}>Customize each individually</button>
              </span>
            </div>
            {newBatchError && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{newBatchError}</div>}
            <div className="row-flex">
              <button className="btn primary" onClick={createBatch} disabled={creatingBatch || !newBatchName.trim()}>
                {creatingBatch ? 'Creating…' : 'Create Batch'}
              </button>
              <button className="btn ghost" onClick={() => setNewBatchOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Active batch ───────────────────────────────── */}
      {!activeBatch ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div className="faint" style={{ fontSize: 13 }}>
            {batches.length === 0 ? 'No batches yet — create one to start adding recipients.' : 'Select a batch above, or create a new one.'}
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-head">
              <input className="input" style={{ fontSize: 14, fontWeight: 600, border: 'none', background: 'transparent', padding: 0, height: 'auto' }} value={batchName}
                onChange={e => setBatchName(e.target.value)} placeholder="Batch name" />
              <div className="actions"><SaveChip status={saveStatus} /></div>
            </div>
            <div className="card-pad">
              <div style={{ marginBottom: 16 }}>
                <span className="label">Team</span>
                <select className="input" value={batchTeamId} onChange={e => setBatchTeamId(e.target.value)}>
                  <option value="">— none —</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <LabelPicker labels={labels} filter={labelFilter} onFilterChange={setLabelFilter}
                  selected={batchLabelIds} onToggle={id => setBatchLabelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />
              </div>
              <div>
                <span className="label">Email mode</span>
                <span className="seg">
                  <button type="button" className={commonMode ? 'on' : ''} onClick={() => setCommonMode(true)}>Same email for everyone</button>
                  <button type="button" className={!commonMode ? 'on' : ''} onClick={() => setCommonMode(false)}>Customize each individually</button>
                </span>
                <div className="faint" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
                  {commonMode
                    ? 'Every recipient shares the Subject/Template/Signature set in Defaults above — each row below only shows Name/Email/From.'
                    : 'Each recipient keeps its own independently-edited Subject/Template/Signature.'}
                </div>
              </div>
            </div>
          </div>

          {/* ── Bulk add ───────────────────────────────── */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-head"><h3>Add recipients in bulk</h3></div>
            <div className="card-pad">
              <textarea className="input" style={{ ...textareaStyle, minHeight: 100, fontFamily: 'var(--font-mono)' }}
                placeholder={'One per line:\nJane Doe, jane@example.com\njohn@example.com'}
                value={bulkText} onChange={e => setBulkText(e.target.value)} />
              <button className="btn primary" onClick={addBulkRows} disabled={!bulkText.trim()} style={{ marginTop: 12 }}>
                Add {parseBulkLines(bulkText).length || ''} recipient{parseBulkLines(bulkText).length === 1 ? '' : 's'}
              </button>
            </div>
          </div>

          {/* ── Recipients ─────────────────────────────── */}
          {rows.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>Recipients</h3>
                  <span className="sub">{rows.length} total · {pendingCount} not yet sent</span>
                </div>
              </div>
              <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {rows.map((row, i) => {
                  const st = STATUS_CHIP[row.status]
                  return (
                    <div key={row.id} style={{ padding: '18px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, marginBottom: 14, alignItems: 'end' }}>
                        <div>
                          <span className="label">Name</span>
                          <input className="input" value={row.name} onChange={e => updateRow(row.id, { name: e.target.value })} />
                        </div>
                        <div>
                          <span className="label">Email</span>
                          <input className="input" value={row.email} onChange={e => updateRow(row.id, { email: e.target.value })} />
                        </div>
                        <div>
                          <span className="label">From</span>
                          <select className="input" value={row.from} onChange={e => updateRow(row.id, { from: e.target.value })}>
                            {fromAddresses.map(f => <option key={f.address} value={f.address}>{f.name ? `${f.name} <${f.address}>` : f.address}</option>)}
                          </select>
                        </div>
                        <div className="row-flex">
                          <span className={`chip${st.cls ? ' ' + st.cls : ''}`}>{st.label}</span>
                          <button className="btn" disabled={row.status === 'sending' || !row.email} onClick={() => sendRow(row)}>
                            {row.status === 'sent' ? 'Re-send' : 'Send'}
                          </button>
                          <button className="btn ghost" onClick={() => removeRow(row.id)} style={{ padding: '0 8px' }}>
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </div>
                      {commonMode ? (
                        <div className="faint" style={{ fontSize: 11, marginBottom: 14 }}>
                          Using the shared Subject/Template/Signature from Defaults above.
                        </div>
                      ) : (
                        <>
                          <div style={{ marginBottom: 14 }}>
                            <span className="label">Subject</span>
                            <input className="input" value={row.subject} onChange={e => updateRow(row.id, { subject: e.target.value })} />
                          </div>
                          <div className="grid grid-2" style={{ marginBottom: 14 }}>
                            <div>
                              <span className="label">Template</span>
                              <textarea className="input" style={textareaStyle} value={row.template} onChange={e => updateRow(row.id, { template: e.target.value })} />
                            </div>
                            <div>
                              <span className="label">Signature</span>
                              <textarea className="input" style={textareaStyle} value={row.signature} onChange={e => updateRow(row.id, { signature: e.target.value })} />
                            </div>
                          </div>
                        </>
                      )}
                      <div>
                        <span className="label">Internal note (optional)</span>
                        <textarea className="input" style={{ minHeight: 60, resize: 'vertical' }}
                          placeholder="Posted to the Missive conversation after this email sends — visible to your team, not the recipient."
                          value={row.note} onChange={e => updateRow(row.id, { note: e.target.value })} />
                      </div>
                      {row.status === 'error' && row.error && (
                        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>{row.error}</div>
                      )}
                      {row.status === 'sent' && row.sentAt && (
                        <div className="row-flex" style={{ marginTop: 10, fontSize: 11, flexWrap: 'wrap' }}>
                          <span className="faint">Sent {new Date(row.sentAt).toLocaleString()}</span>
                          {row.webUrl && <a href={row.webUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>View in Missive →</a>}
                          {row.noteError && <span className="chip danger">Note not posted: {row.noteError}</span>}
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
    </div>
  )
}

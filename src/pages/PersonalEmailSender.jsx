import { useState, useEffect } from 'react'
import { Icon } from '../data.jsx'
import {
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

const BLANK_DRAFT = { subject: '', template: 'Hi {{name}},\n\n', signature: '' }

const textareaStyle = { minHeight: 140, lineHeight: 1.5, resize: 'vertical' }

function SaveChip({ status }) {
  if (!status) return null
  if (status === 'saving') return <span className="chip">Saving…</span>
  if (status === 'saved') return <span className="chip ok">✓ Saved</span>
  return <span className="chip danger">{status}</span>
}

// Email Sender is the template/sender-identity library — managing *what* gets sent
// (named templates) and *who* it's sent from (From addresses). Picking a template and
// actually sending to recipients happens on the separate Batches page.
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

  const [fromAddresses, setFromAddresses] = useState(loadFromAddresses)
  const [fromEditorText, setFromEditorText] = useState(() => loadFromAddresses().map(f => `${f.name} <${f.address}>`).join('\n'))

  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState(null)
  const [templateName, setTemplateName] = useState('')
  const [draft, setDraft] = useState(BLANK_DRAFT)
  const [templateStatus, setTemplateStatus] = useState('') // '' | 'saving' | 'saved' | error message

  useEffect(() => {
    loadPersonalEmailTemplates().then(setTemplates).catch(() => {})
  }, [])

  function applyFromAddresses() {
    const list = fromEditorText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const m = line.match(/^(.*?)\s*<(.+?)>$/)
      return m ? { name: m[1].trim(), address: m[2].trim() } : { name: '', address: line }
    }).filter(f => f.address)
    const final = list.length ? list : DEFAULT_FROM_ADDRESSES
    setFromAddresses(final)
    saveFromAddresses(final)
  }

  function loadTemplate(id) {
    const t = templates.find(x => x.id === id)
    if (!t) return
    setTemplateId(t.id)
    setTemplateName(t.name)
    setDraft({ subject: t.subject, template: t.template, signature: t.signature })
    setTemplateStatus('')
  }

  function newTemplate() {
    setTemplateId(null)
    setTemplateName('')
    setDraft(BLANK_DRAFT)
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
        subject: draft.subject,
        template: draft.template,
        signature: draft.signature,
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

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <div>
          <h1>Email Sender</h1>
          <div className="sub">Saved templates and sending addresses — used when creating a batch</div>
        </div>
      </div>

      {/* ── From Addresses ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><h3>From addresses</h3></div>
        <div className="card-pad">
          <div className="faint" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
            One per line, "Name &lt;email&gt;". These show up as "From" choices when sending from the Batches page.
          </div>
          <div className="row-flex" style={{ alignItems: 'flex-start' }}>
            <textarea className="input" style={{ minHeight: 72, resize: 'vertical', fontFamily: 'var(--font-mono)' }} rows={3}
              value={fromEditorText} onChange={e => setFromEditorText(e.target.value)} />
            <button className="btn" onClick={applyFromAddresses} style={{ flexShrink: 0 }}>Apply</button>
          </div>
        </div>
      </div>

      {/* ── Templates ───────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <h3>Templates</h3>
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
          <div className="faint" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
            Use <code>{'{{name}}'}</code> for each recipient's name, and <code>**bold**</code> or a line starting with
            "<code>- </code>" for a bullet list — both render properly in the sent email. Leave Signature blank to
            automatically use whatever signature is already configured in Missive for the sending address.
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
            <input className="input" value={draft.subject} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))} placeholder="e.g. Quick question about {{name}}'s site" />
          </div>
          <div className="grid grid-2">
            <div>
              <span className="label">Template</span>
              <textarea className="input" style={textareaStyle} value={draft.template} onChange={e => setDraft(d => ({ ...d, template: e.target.value }))} />
            </div>
            <div>
              <span className="label">Signature</span>
              <textarea className="input" style={textareaStyle} value={draft.signature} onChange={e => setDraft(d => ({ ...d, signature: e.target.value }))} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

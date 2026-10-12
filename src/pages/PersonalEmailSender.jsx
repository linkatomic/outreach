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

const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }
const inputStyle = { width: '100%', fontSize: 13 }
const textareaStyle = { ...inputStyle, minHeight: 90, lineHeight: 1.5, resize: 'vertical' }
const sectionHeadStyle = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 16 }

// Email Sender is the template/sender-identity library — managing *what* gets sent
// (named templates) and *who* it's sent from (From addresses). Picking a template and
// actually sending to recipients happens on the separate Batches page.
export function PersonalEmailSender({ me }) {
  if (me?.id !== DEV_MEMBER_ID) {
    return (
      <div className="page" style={{ maxWidth: 600 }}>
        <div className="page-head"><div><h1>Email Sender</h1></div></div>
        <div className="card" style={{ padding: 20, fontSize: 13, color: 'var(--text-faint)' }}>
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
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>Email Sender</h1>
          <div className="sub">Manage saved templates and sending addresses — used when creating a batch</div>
        </div>
      </div>

      {/* ── From Addresses ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <div style={sectionHeadStyle}>From addresses</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
          One per line, "Name &lt;email&gt;". These show up as "From" choices when sending from the Batches page.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea className="input" style={{ ...inputStyle, minHeight: 72, resize: 'vertical', fontFamily: 'var(--font-mono, monospace)' }} rows={3}
            value={fromEditorText} onChange={e => setFromEditorText(e.target.value)} />
          <button className="btn ghost" onClick={applyFromAddresses} style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>Apply</button>
        </div>
      </div>

      {/* ── Templates ───────────────────────────────────── */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ ...sectionHeadStyle, marginBottom: 0 }}>Templates</div>
          {templates.length > 0 && (
            <select className="input" style={{ fontSize: 12, width: 'auto' }} value={templateId || ''} onChange={e => e.target.value ? loadTemplate(e.target.value) : newTemplate()}>
              <option value="">— new template —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
          Use <code>{'{{name}}'}</code> for each recipient's name, and <code>**bold**</code> or a line starting with
          "<code>- </code>" for a bullet list — both render properly in the sent email. Leave Signature blank to
          automatically use whatever signature is already configured in Missive for the sending address.
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
          <input className="input" style={inputStyle} value={draft.subject} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))} placeholder="e.g. Quick question about {{name}}'s site" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <span style={labelStyle}>Template</span>
            <textarea className="input" style={{ ...textareaStyle, minHeight: 150 }} value={draft.template} onChange={e => setDraft(d => ({ ...d, template: e.target.value }))} />
          </div>
          <div>
            <span style={labelStyle}>Signature</span>
            <textarea className="input" style={{ ...textareaStyle, minHeight: 150 }} value={draft.signature} onChange={e => setDraft(d => ({ ...d, signature: e.target.value }))} />
          </div>
        </div>
      </div>
    </div>
  )
}

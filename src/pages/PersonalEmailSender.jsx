import { useState, useEffect, useRef } from 'react'
import { Icon } from '../data.jsx'
import {
  listPersonalSenderOrganizations, listPersonalSenderTeams, listPersonalSenderLabels, sendPersonalEmail,
  savePersonalEmailBatch, loadPersonalEmailBatches, loadPersonalEmailSentLog,
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
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_FROM_ADDRESSES
  } catch { return DEFAULT_FROM_ADDRESSES }
}
function saveFromAddresses(list) {
  try { localStorage.setItem(FROM_ADDRESSES_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

// Persists the "Defaults for newly added recipients" card so the template/signature/subject
// don't need retyping every time the page is reopened — the actual recipient rows already
// survive via personal_email_batches, but there was nothing saving the template itself.
const DEFAULTS_KEY = 'personalSender.defaults'
const BLANK_DEFAULTS = { subject: '', template: 'Hi {{name}},\n\n', signature: '', from: '' }

function loadSavedDefaults() {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? { ...BLANK_DEFAULTS, ...parsed } : null
  } catch { return null }
}
function saveDefaults(d) {
  try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d)) } catch { /* ignore */ }
}

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
  }
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
  const [teamId, setTeamId] = useState('')

  const [labels, setLabels] = useState([])
  const [labelFilter, setLabelFilter] = useState('')
  const [selectedLabelIds, setSelectedLabelIds] = useState([])

  const [fromAddresses, setFromAddresses] = useState(loadFromAddresses)
  const [fromEditorText, setFromEditorText] = useState(() => loadFromAddresses().map(f => `${f.name} <${f.address}>`).join('\n'))

  const [defaults, setDefaults] = useState(() => {
    const saved = loadSavedDefaults()
    return saved || { ...BLANK_DEFAULTS, from: fromAddresses[0]?.address || '' }
  })

  // Auto-save the template/signature/subject/from defaults as they're edited.
  useEffect(() => { saveDefaults(defaults) }, [defaults])

  const [bulkText, setBulkText] = useState('')
  const [rows, setRows] = useState([])

  const [batchId, setBatchId] = useState(null)
  const [batches, setBatches] = useState([])
  const [saveStatus, setSaveStatus] = useState('') // '' | 'saving' | 'saved' | error message
  const saveTimer = useRef(null)

  const [sentLog, setSentLog] = useState([])

  useEffect(() => {
    listPersonalSenderOrganizations()
      .then(orgs => { setOrganizations(orgs); if (orgs.length) setOrganizationId(orgs[0].id) })
      .catch(err => setOrgError(err.message))
    loadPersonalEmailBatches().then(setBatches).catch(() => {})
    loadPersonalEmailSentLog().then(setSentLog).catch(() => {})
  }, [])

  useEffect(() => {
    if (!organizationId) return
    listPersonalSenderTeams(organizationId).then(setTeams).catch(() => setTeams([]))
    listPersonalSenderLabels(organizationId).then(setLabels).catch(() => setLabels([]))
  }, [organizationId])

  // Auto-save the batch (debounced) whenever rows/settings change, so a refresh never
  // loses progress. Only once there's at least one row — nothing to save before that.
  useEffect(() => {
    if (!rows.length) return
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const saved = await savePersonalEmailBatch({ id: batchId, teamId, sharedLabelIds: selectedLabelIds, rows })
        if (!batchId) setBatchId(saved.id)
        setSaveStatus('saved')
      } catch (err) {
        setSaveStatus(err.message)
      }
    }, 800)
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, teamId, selectedLabelIds])

  function toggleLabel(id) {
    setSelectedLabelIds(prev => prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id])
  }

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
        team: teamId || undefined,
        sharedLabelIds: selectedLabelIds,
        organizationId,
        batchId,
      })
      const sentAt = new Date().toISOString()
      updateRow(row.id, { status: 'sent', sentAt, webUrl: result.webUrl || null })
      setSentLog(prev => [{
        id: uid(), sent_at: sentAt, recipient_name: row.name, recipient_email: row.email,
        subject: row.subject, web_url: result.webUrl || null,
      }, ...prev])
    } catch (err) {
      updateRow(row.id, { status: 'error', error: err.message })
    }
  }

  async function loadBatch(b) {
    setBatchId(b.id)
    setTeamId(b.team_id || '')
    setSelectedLabelIds(b.shared_label_ids || [])
    setRows(b.rows || [])
  }

  function newBatch() {
    setBatchId(null); setRows([]); setSaveStatus('')
  }

  const pendingCount = rows.filter(r => r.status === 'pending' || r.status === 'error').length
  const filteredLabels = labelFilter.trim()
    ? labels.filter(l => l.name.toLowerCase().includes(labelFilter.trim().toLowerCase()))
    : labels

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>Personal Email Sender</h1>
          <div className="sub">Bulk-prepare individual emails, sent one at a time via Missive — Dev only</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveStatus === 'saving' && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Saving…</span>}
          {saveStatus === 'saved' && <span style={{ fontSize: 11, color: '#4ade80' }}>✓ Saved</span>}
          {saveStatus && saveStatus !== 'saving' && saveStatus !== 'saved' && <span style={{ fontSize: 11, color: '#f87171' }}>{saveStatus}</span>}
          {batches.length > 0 && (
            <select className="input" style={{ fontSize: 12, width: 'auto' }} value={batchId || ''} onChange={e => {
              const b = batches.find(x => x.id === e.target.value)
              if (b) loadBatch(b)
            }}>
              <option value="">Load batch…</option>
              {batches.map(b => <option key={b.id} value={b.id}>{new Date(b.created_at).toLocaleString()} · {(b.rows || []).length} recipients</option>)}
            </select>
          )}
          <button className="btn ghost" onClick={newBatch} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>+ New batch</button>
        </div>
      </div>

      {/* ── Pre-defined settings ─────────────────────── */}
      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <div style={sectionHeadStyle}>Settings</div>
        {orgError && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 14 }}>{orgError}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 20px', marginBottom: 20 }}>
          <div>
            <span style={labelStyle}>Team</span>
            <select className="input" style={inputStyle} value={teamId} onChange={e => setTeamId(e.target.value)}>
              <option value="">— none —</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <span style={labelStyle}>Default From</span>
            <select className="input" style={inputStyle} value={defaults.from} onChange={e => setDefaults(d => ({ ...d, from: e.target.value }))}>
              {fromAddresses.map(f => <option key={f.address} value={f.address}>{f.name ? `${f.name} <${f.address}>` : f.address}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ ...labelStyle, marginBottom: 0 }}>
            Missive labels (applied to every send) {labels.length > 0 && <span>· {labels.length} loaded</span>} {selectedLabelIds.length > 0 && <span style={{ color: 'var(--accent)' }}>· {selectedLabelIds.length} selected</span>}
          </span>
          <input className="input" style={{ width: 200, fontSize: 12 }} placeholder="Filter labels…" value={labelFilter} onChange={e => setLabelFilter(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20, maxHeight: 180, overflowY: 'auto', padding: '2px 2px 0' }}>
          {labels.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No shared labels found for this organization.</span>}
          {labels.length > 0 && filteredLabels.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No labels match "{labelFilter}".</span>}
          {filteredLabels.map(l => {
            const on = selectedLabelIds.includes(l.id)
            return (
              <button key={l.id} onClick={() => toggleLabel(l.id)} type="button"
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

        <span style={labelStyle}>From addresses (one per line, "Name &lt;email&gt;")</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea className="input" style={{ ...inputStyle, minHeight: 56, resize: 'vertical', fontFamily: 'var(--font-mono, monospace)' }} rows={2}
            value={fromEditorText} onChange={e => setFromEditorText(e.target.value)} />
          <button className="btn ghost" onClick={applyFromAddresses} style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>Apply</button>
        </div>
      </div>

      {/* ── Defaults for new rows ─────────────────────── */}
      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <div style={sectionHeadStyle}>Defaults for newly added recipients</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
          Use <code>{'{{name}}'}</code> for each recipient's name, and <code>**bold**</code> or a line starting with
          "<code>- </code>" for a bullet list — both render properly in the sent email. Leave Signature blank to
          automatically use whatever signature is already configured in Missive for the sending address; type one here
          to override it. Each recipient's subject/template/signature/from can still be edited individually after adding.
          These defaults are remembered automatically — no need to retype them next time.
        </div>
        <div style={{ marginBottom: 16 }}>
          <span style={labelStyle}>Subject</span>
          <input className="input" style={inputStyle} value={defaults.subject} onChange={e => setDefaults(d => ({ ...d, subject: e.target.value }))} placeholder="e.g. Quick question about {{name}}'s site" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <span style={labelStyle}>Template</span>
            <textarea className="input" style={{ ...textareaStyle, minHeight: 150 }} value={defaults.template} onChange={e => setDefaults(d => ({ ...d, template: e.target.value }))} />
          </div>
          <div>
            <span style={labelStyle}>Signature</span>
            <textarea className="input" style={{ ...textareaStyle, minHeight: 150 }} value={defaults.signature} onChange={e => setDefaults(d => ({ ...d, signature: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* ── Bulk add ───────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <div style={sectionHeadStyle}>Add recipients in bulk</div>
        <textarea className="input" style={{ ...textareaStyle, minHeight: 120, fontFamily: 'var(--font-mono, monospace)' }}
          placeholder={'One per line:\nJane Doe, jane@example.com\njohn@example.com'}
          value={bulkText} onChange={e => setBulkText(e.target.value)} />
        <button className="btn" onClick={addBulkRows} disabled={!bulkText.trim()} style={{ marginTop: 12 }}>
          Add {parseBulkLines(bulkText).length || ''} recipient{parseBulkLines(bulkText).length === 1 ? '' : 's'}
        </button>
      </div>

      {/* ── Recipients ─────────────────────────────────── */}
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
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
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

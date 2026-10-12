import { useState, useEffect, useRef } from 'react'
import { Icon } from '../data.jsx'
import {
  listPersonalSenderOrganizations, listPersonalSenderTeams, listPersonalSenderLabels, sendPersonalEmail,
  savePersonalEmailBatch, loadPersonalEmailBatches,
} from '../lib/supabase.js'

// Dev Pandya's member_id slug — client-side `me.id` is always this short TEAM/
// user_profiles.member_id slug, not the Supabase UUID (App.jsx remaps the profile to
// `{ id: profile.member_id, ... }` before any page sees it). Only the server-side check in
// api/personal-email-sender.js uses the real UUID, since it reads user_profiles directly.
// This page is personal to one specific person, not role- or allowlist-gated. Keep in sync
// with the nav-visibility check in src/components/Shell.jsx.
const DEV_MEMBER_ID = 'dev'

const FROM_ADDRESSES_KEY = 'personalSender.fromAddresses'
const DEFAULT_FROM_ADDRESSES = [{ address: 'info@guestpostlinks.net', name: 'Dev Pandya' }]

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
  }
}

const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }
const inputStyle = { width: '100%', fontSize: 13 }

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
  const [selectedLabelIds, setSelectedLabelIds] = useState([])

  const [fromAddresses, setFromAddresses] = useState(loadFromAddresses)
  const [fromEditorText, setFromEditorText] = useState(() => loadFromAddresses().map(f => `${f.name} <${f.address}>`).join('\n'))

  const [defaults, setDefaults] = useState({
    subject: '',
    template: 'Hi {{name}},\n\n',
    signature: '',
    from: fromAddresses[0]?.address || '',
  })

  const [bulkText, setBulkText] = useState('')
  const [rows, setRows] = useState([])

  const [batchId, setBatchId] = useState(null)
  const [batches, setBatches] = useState([])
  const [saveStatus, setSaveStatus] = useState('') // '' | 'saving' | 'saved' | error message
  const saveTimer = useRef(null)

  useEffect(() => {
    listPersonalSenderOrganizations()
      .then(orgs => { setOrganizations(orgs); if (orgs.length) setOrganizationId(orgs[0].id) })
      .catch(err => setOrgError(err.message))
    loadPersonalEmailBatches().then(setBatches).catch(() => {})
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
      await sendPersonalEmail({
        to: { address: row.email, name: row.name },
        from: fromEntry,
        subject: row.subject,
        template: row.template,
        signature: row.signature,
        team: teamId || undefined,
        sharedLabelIds: selectedLabelIds,
      })
      updateRow(row.id, { status: 'sent', sentAt: new Date().toISOString() })
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
            <select className="input" style={{ fontSize: 12 }} value={batchId || ''} onChange={e => {
              const b = batches.find(x => x.id === e.target.value)
              if (b) loadBatch(b)
            }}>
              <option value="">Load batch…</option>
              {batches.map(b => <option key={b.id} value={b.id}>{new Date(b.created_at).toLocaleString()} · {(b.rows || []).length} recipients</option>)}
            </select>
          )}
          <button className="btn ghost" onClick={newBatch} style={{ fontSize: 12 }}>+ New batch</button>
        </div>
      </div>

      {/* ── Pre-defined settings ─────────────────────── */}
      <div className="card" style={{ marginBottom: 16, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 14 }}>
          Settings
        </div>
        {orgError && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10 }}>{orgError}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px', marginBottom: 16 }}>
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

        <span style={labelStyle}>Missive Labels (applied to every send)</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {labels.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No shared labels found for this organization.</span>}
          {labels.map(l => (
            <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: selectedLabelIds.includes(l.id) ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent' }}>
              <input type="checkbox" checked={selectedLabelIds.includes(l.id)} onChange={() => toggleLabel(l.id)} />
              {l.name}
            </label>
          ))}
        </div>

        <span style={labelStyle}>From addresses (one per line, "Name &lt;email&gt;")</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea className="input" style={{ ...inputStyle, fontFamily: 'var(--font-mono, monospace)' }} rows={2}
            value={fromEditorText} onChange={e => setFromEditorText(e.target.value)} />
          <button className="btn ghost" onClick={applyFromAddresses} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Apply</button>
        </div>
      </div>

      {/* ── Defaults for new rows ─────────────────────── */}
      <div className="card" style={{ marginBottom: 16, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 14 }}>
          Defaults for newly added recipients
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 12 }}>
          Use <code>{'{{name}}'}</code> in the template or signature — it's replaced with each recipient's name. Each recipient's
          subject/template/signature/from can still be edited individually after adding.
        </div>
        <div style={{ marginBottom: 12 }}>
          <span style={labelStyle}>Subject</span>
          <input className="input" style={inputStyle} value={defaults.subject} onChange={e => setDefaults(d => ({ ...d, subject: e.target.value }))} placeholder="e.g. Quick question about {{name}}'s site" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <span style={labelStyle}>Template</span>
            <textarea className="input" style={inputStyle} rows={6} value={defaults.template} onChange={e => setDefaults(d => ({ ...d, template: e.target.value }))} />
          </div>
          <div>
            <span style={labelStyle}>Signature</span>
            <textarea className="input" style={inputStyle} rows={6} value={defaults.signature} onChange={e => setDefaults(d => ({ ...d, signature: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* ── Bulk add ───────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 14 }}>
          Add recipients in bulk
        </div>
        <textarea className="input" style={{ ...inputStyle, fontFamily: 'var(--font-mono, monospace)' }} rows={5}
          placeholder={'One per line:\nJane Doe, jane@example.com\njohn@example.com'}
          value={bulkText} onChange={e => setBulkText(e.target.value)} />
        <button className="btn" onClick={addBulkRows} disabled={!bulkText.trim()} style={{ marginTop: 10 }}>
          Add {parseBulkLines(bulkText).length || ''} recipient{parseBulkLines(bulkText).length === 1 ? '' : 's'}
        </button>
      </div>

      {/* ── Recipients ─────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Recipients</h3>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                {rows.length} total · {pendingCount} not yet sent
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
            {rows.map(row => {
              const st = STATUS_STYLE[row.status]
              return (
                <div key={row.id} className="card" style={{ padding: 14, background: 'rgba(255,255,255,.015)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, marginBottom: 10, alignItems: 'end' }}>
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
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                  <div style={{ marginBottom: 10 }}>
                    <span style={labelStyle}>Subject</span>
                    <input className="input" style={inputStyle} value={row.subject} onChange={e => updateRow(row.id, { subject: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <span style={labelStyle}>Template</span>
                      <textarea className="input" style={inputStyle} rows={3} value={row.template} onChange={e => updateRow(row.id, { template: e.target.value })} />
                    </div>
                    <div>
                      <span style={labelStyle}>Signature</span>
                      <textarea className="input" style={inputStyle} rows={3} value={row.signature} onChange={e => updateRow(row.id, { signature: e.target.value })} />
                    </div>
                  </div>
                  {row.status === 'error' && row.error && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>{row.error}</div>
                  )}
                  {row.status === 'sent' && row.sentAt && (
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>Sent {new Date(row.sentAt).toLocaleString()}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

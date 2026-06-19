import { useState, useEffect } from 'react'
import { Icon } from '../data.jsx'
const LC_TOOLS = [
  { id: 'clients', title: 'Client Manager', desc: 'Add and manage live chat clients — order sheets, article costs, discounts, buyer/reseller types', icon: 'users', tag: 'CRM' },
]

export function LiveChatToolsPage({ me }) {
  const [activeTool, setActiveTool] = useState(null)

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Tools</h1>
          <div className="sub">Live Chat team tools</div>
        </div>
        {activeTool && (
          <button className="btn ghost" onClick={() => setActiveTool(null)} style={{ fontSize: 12 }}>← All Tools</button>
        )}
      </div>

      {!activeTool ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {LC_TOOLS.map(tool => (
            <div key={tool.id} className="card" onClick={() => setActiveTool(tool.id)} style={{ cursor: 'pointer' }}>
              <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
                    <Icon name={tool.icon} size={20} />
                  </div>
                  {tool.tag && (
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>{tool.tag}</span>
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{tool.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>{tool.desc}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  Open <Icon name="arrow" size={11} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : activeTool === 'clients' ? (
        <LiveChatClients me={me} />
      ) : null}
    </div>
  )
}
import { useRef } from 'react'
import { createBlankOrderSheet } from '../lib/lcSheetBuilder.js'
import {
  loadLivechatClients, createLivechatClient,
  updateLivechatClient, deleteLivechatClient, bulkCreateLivechatClients,
} from '../lib/supabase.js'

// ── CSV helpers ────────────────────────────────────────────

const CSV_HEADERS = ['client_name','client_type','status','article_cost','permanent_discount','order_sheet_url','contact_name','contact_email','notes']
const CSV_TEMPLATE = [
  CSV_HEADERS.join(','),
  'Acme Corp,buyer,active,25,10,https://docs.google.com/spreadsheets/d/YOUR_ID,Jane Smith,jane@acme.com,VIP client',
  'Beta LLC,reseller,active,15,,,,, ',
].join('\n')

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'clients_template.csv' })
  a.click(); URL.revokeObjectURL(url)
}

function parseCSVRow(line) {
  const result = []; let cur = ''; let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++ } else inQ = !inQ }
    else if (c === ',' && !inQ) { result.push(cur); cur = '' }
    else cur += c
  }
  result.push(cur); return result
}

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return { rows: [], errors: ['File appears empty or has no data rows'] }
  const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const rows = []; const errors = []
  lines.slice(1).forEach((line, i) => {
    const vals = parseCSVRow(line)
    const obj  = {}
    headers.forEach((h, j) => { obj[h] = (vals[j] || '').trim() })
    if (!obj.client_name) { errors.push(`Row ${i + 2}: missing client_name — skipped`); return }
    rows.push({
      client_name:       obj.client_name,
      client_type:       ['buyer','reseller'].includes(obj.client_type) ? obj.client_type : 'buyer',
      status:            ['active','paused','inactive'].includes(obj.status) ? obj.status : 'active',
      article_cost:      obj.article_cost      ? parseFloat(obj.article_cost)      : null,
      permanent_discount:obj.permanent_discount ? parseFloat(obj.permanent_discount): null,
      order_sheet_url:   obj.order_sheet_url   || null,
      contact_name:      obj.contact_name       || null,
      contact_email:     obj.contact_email      || null,
      notes:             obj.notes              || null,
    })
  })
  return { rows, errors }
}

// ── Import preview modal ───────────────────────────────────
function ImportModal({ parsed, createdBy, onDone, onClose }) {
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState(null)
  const [err, setErr]             = useState('')

  async function doImport() {
    setImporting(true); setErr('')
    try {
      const payload = parsed.rows.map(r => ({ ...r, created_by: createdBy }))
      await bulkCreateLivechatClients(payload)
      setResult(parsed.rows.length)
    } catch (e) { setErr(e?.message || 'Import failed') }
    finally { setImporting(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 300, display: 'grid', placeItems: 'center', padding: 20 }}
         onClick={result ? onDone : onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 620, boxShadow: '0 24px 64px rgba(0,0,0,.5)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
           onClick={e => e.stopPropagation()}>

        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{result != null ? 'Import complete' : 'Import preview'}</h3>
          <button className="btn ghost" onClick={result ? onDone : onClose}><Icon name="x" size={14} /></button>
        </div>

        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          {result != null ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(74,222,128,.12)', display: 'grid', placeItems: 'center', color: '#4ade80' }}>
                <Icon name="check" size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{result} client{result !== 1 ? 's' : ''} imported</div>
              <button className="btn primary" onClick={onDone}>Done</button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <div style={{ padding: '10px 16px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', fontSize: 13 }}>
                  <strong>{parsed.rows.length}</strong> client{parsed.rows.length !== 1 ? 's' : ''} ready to import
                </div>
                {parsed.errors.length > 0 && (
                  <div style={{ padding: '10px 16px', borderRadius: 8, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)', fontSize: 13, color: '#f87171' }}>
                    <strong>{parsed.errors.length}</strong> row{parsed.errors.length !== 1 ? 's' : ''} skipped
                  </div>
                )}
              </div>

              {parsed.errors.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {parsed.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#f87171', padding: '2px 0' }}>{e}</div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {parsed.rows.map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 60px', gap: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 13, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{r.client_name}</div>
                      {r.contact_email && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{r.contact_email}</div>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'capitalize' }}>{r.client_type}</div>
                    <div style={{ fontSize: 11 }}>
                      {r.article_cost != null ? <span style={{ color: 'var(--text-faint)' }}>${r.article_cost}</span> : null}
                      {r.permanent_discount != null ? <span style={{ color: '#f59e0b', marginLeft: 4 }}>{r.permanent_discount}%</span> : null}
                    </div>
                  </div>
                ))}
              </div>

              {err && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.25)', fontSize: 13, color: '#f87171' }}>{err}</div>}
            </>
          )}
        </div>

        {result == null && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={doImport} disabled={importing || parsed.rows.length === 0}>
              {importing ? 'Importing…' : `Import ${parsed.rows.length} client${parsed.rows.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const EMPTY_FORM = {
  client_name: '', client_type: 'buyer', order_sheet_url: '',
  article_cost: '', permanent_discount: '', status: 'active',
  contact_name: '', contact_email: '', notes: '',
}

// ── Client form modal ──────────────────────────────────────
function ClientModal({ initial, onSave, onClose, saving, saveError }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function submit(e) {
    e.preventDefault()
    if (!form.client_name.trim()) return
    onSave(form)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 300, display: 'grid', placeItems: 'center', padding: 20 }}
         onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: '0 24px 64px rgba(0,0,0,.5)' }}
           onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{initial ? 'Edit client' : 'Add client'}</h3>
          <button className="btn ghost" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <form onSubmit={submit} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name + Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client Name *</div>
              <input className="input" required placeholder="Acme Corp" value={form.client_name}
                     onChange={e => set('client_name', e.target.value)} autoFocus style={{ width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</div>
              <span className="seg">
                <button type="button" className={form.client_type === 'buyer' ? 'on' : ''} onClick={() => set('client_type', 'buyer')}>Buyer</button>
                <button type="button" className={form.client_type === 'reseller' ? 'on' : ''} onClick={() => set('client_type', 'reseller')}>Reseller</button>
              </span>
            </div>
          </div>

          {/* Pricing row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Article Cost ($ per article)</div>
              <input className="input" type="number" min="0" step="0.01" placeholder="e.g. 25"
                     value={form.article_cost} onChange={e => set('article_cost', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Permanent Discount (%)</div>
              <input className="input" type="number" min="0" max="100" step="0.1" placeholder="e.g. 10"
                     value={form.permanent_discount} onChange={e => set('permanent_discount', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

          {/* Order sheet */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order Sheet URL</div>
            <input className="input" type="url" placeholder="https://docs.google.com/spreadsheets/d/…"
                   value={form.order_sheet_url} onChange={e => set('order_sheet_url', e.target.value)} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          </div>

          {/* Contact */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Name</div>
              <input className="input" placeholder="Jane Smith" value={form.contact_name}
                     onChange={e => set('contact_name', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Email</div>
              <input className="input" type="email" placeholder="jane@example.com" value={form.contact_email}
                     onChange={e => set('contact_email', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

          {/* Status */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</div>
            <span className="seg">
              {['active','paused','inactive'].map(s => (
                <button key={s} type="button" className={form.status === s ? 'on' : ''} onClick={() => set('status', s)} style={{ textTransform: 'capitalize' }}>{s}</button>
              ))}
            </span>
          </div>

          {/* Notes */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes</div>
            <textarea className="input" rows={3} placeholder="Any special terms, preferences, or context…"
                      value={form.notes} onChange={e => set('notes', e.target.value)}
                      style={{ width: '100%', resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          {saveError && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.3)', fontSize: 13, color: '#f87171' }}>
              {saveError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving || !form.client_name.trim()}>
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Add client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Status chip ────────────────────────────────────────────
function StatusChip({ status }) {
  const colors = { active: '#4ade80', paused: '#f59e0b', inactive: 'var(--text-faint)' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
      color: colors[status] || 'var(--text-faint)',
      border: `1px solid ${colors[status] || 'var(--text-faint)'}`,
      borderRadius: 4, padding: '2px 6px', opacity: status === 'inactive' ? 0.6 : 1,
    }}>{status}</span>
  )
}

// ── Main component ─────────────────────────────────────────
export function LiveChatClients({ me }) {
  const [clients, setClients]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [modal, setModal]         = useState(null)  // null | 'add' | client object (edit)
  const [saving, setSaving]       = useState(false)
  const [deleteId, setDeleteId]   = useState(null)
  const [filter, setFilter]       = useState('all') // 'all' | 'buyer' | 'reseller' | 'active' | 'inactive'
  const [search, setSearch]       = useState('')
  const [expanded, setExpanded]   = useState(null)  // client id
  const [saveError, setSaveError] = useState('')
  const [importParsed, setImportParsed] = useState(null)
  const fileInputRef = useRef(null)
  const [sheetCreating, setSheetCreating] = useState(null)  // client id being processed
  const [sheetResults, setSheetResults]   = useState({})    // id → { url, title } after done

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => setImportParsed(parseCSV(ev.target.result))
    reader.readAsText(file)
  }

  async function load() {
    setLoading(true)
    try { setClients(await loadLivechatClients()) }
    catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleSave(form) {
    setSaving(true)
    setSaveError('')
    try {
      const t = v => (v || '').trim()
      const payload = {
        client_name: t(form.client_name),
        client_type: form.client_type,
        order_sheet_url: t(form.order_sheet_url) || null,
        article_cost: form.article_cost !== '' && form.article_cost != null ? parseFloat(form.article_cost) : null,
        permanent_discount: form.permanent_discount !== '' && form.permanent_discount != null ? parseFloat(form.permanent_discount) : null,
        status: form.status,
        contact_name: t(form.contact_name) || null,
        contact_email: t(form.contact_email) || null,
        notes: t(form.notes) || null,
      }
      if (modal?.id) {
        await updateLivechatClient(modal.id, payload)
      } else {
        await createLivechatClient({ ...payload, created_by: me.id })
      }
      setModal(null)
      setSaveError('')
      await load()
    } catch (err) {
      setSaveError(err?.message || 'Save failed — please try again')
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    try { await deleteLivechatClient(id); setDeleteId(null); await load() }
    catch { /* silent */ }
  }

  async function handleNewSheet(client) {
    if (!client.order_sheet_url) return
    setSheetCreating(client.id)
    try {
      const res = await createBlankOrderSheet(client)
      setSheetResults(prev => ({ ...prev, [client.id]: res }))
    } catch (err) {
      setSheetResults(prev => ({ ...prev, [client.id]: { error: err.message || 'Failed' } }))
    } finally {
      setSheetCreating(null)
    }
  }

  const filtered = clients.filter(c => {
    if (filter === 'buyer')    return c.client_type === 'buyer'
    if (filter === 'reseller') return c.client_type === 'reseller'
    if (filter === 'active')   return c.status === 'active'
    if (filter === 'inactive') return c.status === 'inactive'
    return true
  }).filter(c => !search || c.client_name.toLowerCase().includes(search.toLowerCase()))

  const buyers    = clients.filter(c => c.client_type === 'buyer').length
  const resellers = clients.filter(c => c.client_type === 'reseller').length
  const active    = clients.filter(c => c.status === 'active').length

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <div className="sub">{clients.length} client{clients.length !== 1 ? 's' : ''} · {active} active</div>
        </div>
      </div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input className="input" placeholder="Search clients…" value={search}
               onChange={e => setSearch(e.target.value)}
               style={{ flex: 1, minWidth: 160, maxWidth: 260, fontSize: 13 }} />
        <span className="seg" style={{ fontSize: 12 }}>
          <button className={filter === 'all'      ? 'on' : ''} onClick={() => setFilter('all')}>All {clients.length}</button>
          <button className={filter === 'buyer'    ? 'on' : ''} onClick={() => setFilter('buyer')}>Buyers {buyers}</button>
          <button className={filter === 'reseller' ? 'on' : ''} onClick={() => setFilter('reseller')}>Resellers {resellers}</button>
          <button className={filter === 'active'   ? 'on' : ''} onClick={() => setFilter('active')}>Active {active}</button>
          <button className={filter === 'inactive' ? 'on' : ''} onClick={() => setFilter('inactive')}>Inactive</button>
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="btn ghost" style={{ fontSize: 12 }} onClick={downloadTemplate}>
            <Icon name="download" size={13} /> Template
          </button>
          <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => fileInputRef.current?.click()}>
            <Icon name="arrow" size={13} style={{ transform: 'rotate(-90deg)' }} /> Import CSV
          </button>
          <button className="btn primary" onClick={() => setModal('add')}>
            <Icon name="plus" size={13} /> Add Client
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading clients…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          {clients.length === 0 ? 'No clients yet — add your first one.' : 'No clients match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 100px 80px 36px', gap: '0 12px', padding: '6px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>
            <div>Client</div>
            <div style={{ textAlign: 'right' }}>Article $</div>
            <div style={{ textAlign: 'right' }}>Discount</div>
            <div>Sheet</div>
            <div>Status</div>
            <div />
          </div>

          {filtered.map(c => (
            <div key={c.id}>
              <div
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 90px 90px 100px 80px 36px',
                  gap: '0 12px', padding: '11px 14px',
                  background: expanded === c.id ? 'color-mix(in srgb, var(--accent) 6%, var(--surface-2))' : 'var(--surface-2)',
                  borderRadius: expanded === c.id ? '8px 8px 0 0' : 8,
                  cursor: 'pointer', alignItems: 'center', transition: 'background 0.1s',
                  border: expanded === c.id ? '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' : '1px solid transparent',
                  borderBottom: expanded === c.id ? 'none' : undefined,
                }}
              >
                {/* Name + type */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: c.client_type === 'buyer'
                      ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                      : 'color-mix(in srgb, #a78bfa 15%, transparent)',
                    display: 'grid', placeItems: 'center',
                    fontSize: 13, fontWeight: 700,
                    color: c.client_type === 'buyer' ? 'var(--accent)' : '#a78bfa',
                  }}>
                    {c.client_name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.client_name}</div>
                    <div style={{ fontSize: 11, color: c.client_type === 'buyer' ? 'var(--accent)' : '#a78bfa', textTransform: 'capitalize', marginTop: 1 }}>{c.client_type}</div>
                  </div>
                </div>

                {/* Article cost */}
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  {c.article_cost != null ? <span style={{ color: 'var(--text)' }}>${c.article_cost}</span> : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </div>

                {/* Discount */}
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  {c.permanent_discount != null ? <span style={{ color: '#f59e0b' }}>{c.permanent_discount}%</span> : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </div>

                {/* Sheet link */}
                <div>
                  {c.order_sheet_url
                    ? <a href={c.order_sheet_url} target="_blank" rel="noreferrer"
                         onClick={e => e.stopPropagation()}
                         style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                        <Icon name="link" size={11} /> Open
                      </a>
                    : <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>—</span>
                  }
                </div>

                {/* Status */}
                <div><StatusChip status={c.status} /></div>

                {/* Chevron */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', transition: 'transform 0.2s', transform: expanded === c.id ? 'rotate(180deg)' : 'none' }}>
                  <Icon name="chevron-down" size={14} />
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === c.id && (
                <div style={{
                  background: 'color-mix(in srgb, var(--accent) 4%, var(--surface-2))',
                  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                  borderTop: 'none', borderRadius: '0 0 8px 8px',
                  padding: '14px 14px 16px',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px 24px', marginBottom: 14 }}>
                    {c.contact_name && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Contact</div>
                        <div style={{ fontSize: 13 }}>{c.contact_name}</div>
                        {c.contact_email && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{c.contact_email}</div>}
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Added</div>
                      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                        {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                    {c.order_sheet_url && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Order Sheet</div>
                        <a href={c.order_sheet_url} target="_blank" rel="noreferrer"
                           style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                          {c.order_sheet_url.replace('https://docs.google.com/spreadsheets/d/', '').slice(0, 28)}…
                        </a>
                      </div>
                    )}
                  </div>
                  {c.notes && (
                    <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 6, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 14, borderLeft: '3px solid var(--accent)' }}>
                      {c.notes}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* New Order Sheet button */}
                    {sheetResults[c.id]?.url ? (
                      <a href={sheetResults[c.id].url} target="_blank" rel="noreferrer"
                         style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, background: 'rgba(74,222,128,.12)', border: '1px solid rgba(74,222,128,.25)', color: '#4ade80', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
                        <Icon name="check" size={12} /> Open "{sheetResults[c.id].title}"
                      </a>
                    ) : sheetResults[c.id]?.error ? (
                      <span style={{ fontSize: 12, color: '#f87171', padding: '6px 12px', borderRadius: 7, background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.2)' }}>
                        ⚠ {sheetResults[c.id].error}
                      </span>
                    ) : (
                      <button
                        className="btn ghost"
                        style={{ fontSize: 12, opacity: (!c.order_sheet_url || sheetCreating === c.id) ? 0.5 : 1 }}
                        disabled={!c.order_sheet_url || sheetCreating === c.id}
                        title={!c.order_sheet_url ? 'Add an Order Sheet URL to this client first' : ''}
                        onClick={() => handleNewSheet(c)}
                      >
                        {sheetCreating === c.id
                          ? <><Icon name="refresh" size={12} /> Creating…</>
                          : <><Icon name="plus" size={12} /> New Order Sheet</>
                        }
                      </button>
                    )}
                    <div style={{ flex: 1 }} />
                    <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => setModal(c)}>
                      <Icon name="edit" size={12} /> Edit
                    </button>
                    <button className="btn ghost" style={{ fontSize: 12, color: '#f87171' }} onClick={() => setDeleteId(c.id)}>
                      <Icon name="trash" size={12} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {modal && (
        <ClientModal
          initial={modal === 'add' ? null : modal}
          onSave={handleSave}
          onClose={() => { setModal(null); setSaveError('') }}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 300, display: 'grid', placeItems: 'center' }}
             onClick={() => setDeleteId(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 24, maxWidth: 360, width: '90%', boxShadow: '0 16px 48px rgba(0,0,0,.5)' }}
               onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Delete client?</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20 }}>This can't be undone.</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn" style={{ background: '#f87171', color: '#fff', border: 'none' }} onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk import modal */}
      {importParsed && (
        <ImportModal
          parsed={importParsed}
          createdBy={me.id}
          onDone={() => { setImportParsed(null); load() }}
          onClose={() => setImportParsed(null)}
        />
      )}
    </div>
  )
}

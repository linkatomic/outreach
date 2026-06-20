import { useState, useEffect } from 'react'
import { extractSheetId, getSheetTabs, getSheetRows } from '../lib/sheetParserAPI.js'
import { fetchGplBatch, extractGplInfo, buildNotionProperties, createNotionPage, testNotionConnection, listNotionUsers } from '../lib/notionApi.js'
import { saveNotionBatch } from '../lib/supabase.js'

const STATUS_OPTS     = [
  // To-do
  'New Orders',
  // In progress
  'Sent for Content Update', 'Pending Publication', 'Credit With Vendors',
  'Client Input Required', 'Sent For Writing', 'Sent For Article Approval',
  'Sent For Publication', 'Post Improvement', 'Order Cancelled',
  // Complete
  'Credit Used', 'Published', 'Testing Card',
]
const ORDER_FROM_OPTS   = ['GUESTPOSTLINKS', 'DIRECT', 'FIVERR', 'OTHER']
const ORDER_TYPE_OPTS   = [
  'Article Publication',
  'Press Release Publication',
  'Press Release W+P',
  'Footer/Sidebar - Link Insertion',
  'Link Replacement',
  'Link Insertion',
  'Article Writing + Publication',
  'Foreign Language Article Publication',
]
const ORDER_IN_OPTS     = [
  'Pro PR', 'Growth PR', 'Starter PR', 'Ent PR',
  'Single', 'Bulk',
  'DA-50 Package', 'DA-60 Package', 'DA-70 Package',
  'Crypto Elite Pack', 'Crypto Pro Pack', 'Crypto Growth Pack', 'Crypto Starter Pack',
]
const POST_TYPE_OPTS    = ['CBD', 'Crypto', 'Adult', 'Casino', 'General']
const PAY_OPTS          = ['Need to Check', 'Paid', 'Pending', 'Overdue']
const SENT_FOR_PUB_OPTS = ['Bhavansinh Chauhan', 'Nilesh P', 'Kanaiya Kadiya', 'Dev P', 'Nagji Rajput']
const ORDER_PROCESS_BY_OPTS = ['Dev P', 'Bhavansinh Chauhan', 'Nagji Rajput', 'Kanaiya Kadiya', 'Nilesh P']

// Map Relay display name → Notion select option name
const RELAY_TO_NOTION_NAME = {
  'Dev Pandya': 'Dev P',
  'Bhavan C':   'Bhavansinh Chauhan',
  'Nagji R':    'Nagji Rajput',
  'Kanaiya K':  'Kanaiya Kadiya',
  'Nilesh P':   'Nilesh P',
}

const DEFAULTS = {
  orderStatus: 'Sent For Publication', clientName: '', clientSheet: '',
  orderFrom: 'GUESTPOSTLINKS', orderType: 'Article Publication', orderIn: 'Bulk',
  postType: '', paymentStatus: 'Need to Check', note: 'Master Sheet',
  publicationCost: '', orderUrl: '',
  orderProcessBy: '', sentForPublication: '', dateOfPublication: '',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CONCURRENCY = 3 // Notion rate limit is 3 req/sec

async function createWithRetry(props) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await createNotionPage(props)
    } catch (e) {
      if (e.httpStatus === 429 && attempt < 2) {
        await sleep(2000 * (attempt + 1)) // back off on rate limit
        continue
      }
      throw e
    }
  }
}

function Label({ children, required }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 6 }}>
      {children}{required && <span style={{ color: '#f87171', marginLeft: 3 }}>*</span>}
    </div>
  )
}

function Field({ label, required, children, span }) {
  return (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  )
}

function Inp({ value, onChange, placeholder, type = 'text', mono }) {
  return (
    <input
      className="input" type={type} value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      style={{ fontSize: 13, width: '100%', fontFamily: mono ? 'var(--font-mono)' : undefined }}
    />
  )
}

function Sel({ value, onChange, options, placeholder }) {
  return (
    <select className="input" value={value} onChange={e => onChange(e.target.value)}
      style={{ fontSize: 13, width: '100%' }}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Divider() {
  return <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', margin: '4px 0' }} />
}

// Deduplicate errors — if all are the same message, show it once
function summariseErrors(errors) {
  if (!errors.length) return []
  const msgs = errors.map(e => e.split(': ').slice(1).join(': ') || e)
  const unique = [...new Set(msgs)]
  if (unique.length === 1) {
    return [{ msg: unique[0], count: errors.length }]
  }
  return unique.map(m => ({ msg: m, count: msgs.filter(x => x === m).length }))
}

const MULTI_SOURCE_MSG = 'Databases with multiple data sources are not supported in this API version.'

export function LcNotion({ me }) {
  const [sheetUrl,  setSheetUrl]  = useState('')
  const [tabs,      setTabs]      = useState([])
  const [selTab,    setSelTab]    = useState('')
  const [rows,      setRows]      = useState([])
  const [sheetBusy, setSheetBusy] = useState(false)
  const [sheetErr,  setSheetErr]  = useState('')

  const [common, setCommon] = useState(() => ({
    ...DEFAULTS,
    orderProcessBy: RELAY_TO_NOTION_NAME[me?.name] || me?.name || '',
  }))
  const set = (k, v) => setCommon(p => ({ ...p, [k]: v }))

  const [notionUsers, setNotionUsers] = useState([]) // { id, name }[] from Notion workspace

  useEffect(() => {
    listNotionUsers().then(setNotionUsers).catch(() => {})
  }, [])

  const [connStatus, setConnStatus] = useState(null) // null | 'testing' | {ok, title, error, code}

  const [creating, setCreating] = useState(false)
  const [prog,     setProg]     = useState({ done: 0, total: 0, errors: [] })
  const [finished, setFinished] = useState(false)

  async function handleTestConn() {
    setConnStatus('testing')
    const result = await testNotionConnection()
    setConnStatus(result)
  }

  async function handleLoad() {
    setSheetErr(''); setTabs([]); setRows([]); setSelTab(''); setFinished(false)
    setSheetBusy(true)
    try {
      const id = extractSheetId(sheetUrl.trim())
      if (!id) throw new Error('Invalid Google Sheet URL')
      const list = await getSheetTabs(id)
      setTabs(list)
      if (list.length === 1) { setSelTab(list[0].name); await loadRows(id, list[0].name) }
    } catch (e) { setSheetErr(e.message) }
    finally { setSheetBusy(false) }
  }

  async function loadRows(sheetId, tab) {
    setSheetBusy(true); setSheetErr(''); setRows([])
    try {
      const raw = await getSheetRows(sheetId, tab)
      if (!raw.length) return
      const hdr = raw[0].map(h => String(h ?? '').trim().toLowerCase())
      const oi = Math.max(hdr.findIndex(h => h.includes('order id') || h === 'orderid'), 0)
      const di = hdr.findIndex(h => h === 'domain') >= 0 ? hdr.findIndex(h => h === 'domain') : 1
      setRows(
        raw.slice(1)
          .map(r => ({ orderId: String(r[oi] ?? '').trim(), domain: String(r[di] ?? '').trim() }))
          .filter(r => r.orderId && r.domain)
      )
    } catch (e) { setSheetErr(e.message) }
    finally { setSheetBusy(false) }
  }

  async function handleTabChange(tab) {
    setSelTab(tab); setRows([])
    const id = extractSheetId(sheetUrl.trim())
    if (id && tab) await loadRows(id, tab)
  }

  async function handleCreate() {
    if (!rows.length) return
    setCreating(true); setFinished(false)
    setProg({ done: 0, total: rows.length, errors: [] })
    const gplMap = await fetchGplBatch(rows.map(r => r.domain))
    const errors = []
    const successCards = []

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batchStart = Date.now()
      const batch = rows.slice(i, i + CONCURRENCY)

      const results = await Promise.allSettled(
        batch.map(row => {
          const gpl = extractGplInfo(gplMap.get(row.domain.toLowerCase()), common.postType)
          return createWithRetry(buildNotionProperties({ ...row, ...gpl, common }))
            .then(res => ({ id: res.id, url: res.url, title: `${row.orderId} - ${row.domain}`, domain: row.domain }))
        })
      )

      results.forEach((r, bi) => {
        if (r.status === 'fulfilled') successCards.push(r.value)
        else errors.push(`${batch[bi].orderId}: ${r.reason?.message || 'Failed'}`)
      })

      setProg({ done: Math.min(i + CONCURRENCY, rows.length), total: rows.length, errors: [...errors] })

      // Keep average at 3 req/sec — wait out the remainder of 1 second if batch was faster
      const elapsed = Date.now() - batchStart
      const minBatch = 1050
      if (elapsed < minBatch && i + CONCURRENCY < rows.length) await sleep(minBatch - elapsed)
    }

    if (successCards.length > 0) {
      saveNotionBatch({
        memberId: me?.id || 'unknown',
        memberName: me?.name || 'Unknown',
        clientName: common.clientName,
        orderFrom: common.orderFrom,
        postType: common.postType,
        sheetUrl: sheetUrl.trim(),
        sheetTab: selTab,
        cards: successCards,
      }).catch(() => {})
    }

    setCreating(false); setFinished(true)
  }

  function reset() {
    setFinished(false); setCreating(false); setRows([]); setTabs([])
    setSelTab(''); setSheetUrl(''); setSheetErr('')
    setCommon({ ...DEFAULTS, orderProcessBy: RELAY_TO_NOTION_NAME[me?.name] || me?.name || '' })
    setProg({ done: 0, total: 0, errors: [] })
  }

  const pct       = prog.total ? Math.round((prog.done / prog.total) * 100) : 0
  const canCreate = rows.length > 0 && common.clientName.trim() && !creating
  const errSummary = summariseErrors(prog.errors)
  const hasMultiSourceErr = prog.errors.some(e => e.includes('multiple data sources'))

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Notion Card Creator</h1>
          <div className="sub">Bulk-create Notion pages from an Order Sheet tab</div>
        </div>
      </div>

      {/* ── Connection test ──────────────────────────── */}
      <div className="card" style={{ marginBottom: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
        <button className="btn" onClick={handleTestConn} disabled={connStatus === 'testing'}
          style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {connStatus === 'testing' ? 'Testing…' : 'Test Notion Connection'}
        </button>

        {connStatus && connStatus !== 'testing' && (
          connStatus.ok
            ? <span style={{ fontSize: 13, color: '#4ade80' }}>
                ✓ Connected — <strong>{connStatus.title || connStatus.id}</strong>
              </span>
            : <span style={{ fontSize: 12, color: '#f87171', lineHeight: 1.5 }}>
                ✗ {connStatus.error}
                {connStatus.code && <span style={{ opacity: 0.6, marginLeft: 6 }}>({connStatus.code})</span>}
              </span>
        )}

        {!connStatus && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            Click to verify your Notion token and database are correctly configured
          </span>
        )}
      </div>

      {/* ── Sheet loader ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 14 }}>
          Step 1 · Load Sheet
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="Paste Google Sheet URL…"
            value={sheetUrl}
            onChange={e => setSheetUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLoad()}
            style={{ flex: 1, fontSize: 13 }}
          />
          <button className="btn" onClick={handleLoad} disabled={!sheetUrl.trim() || sheetBusy}
            style={{ whiteSpace: 'nowrap' }}>
            {sheetBusy ? 'Loading…' : 'Load Sheet'}
          </button>
        </div>

        {sheetErr && <div style={{ marginTop: 10, fontSize: 12, color: '#f87171' }}>{sheetErr}</div>}

        {tabs.length > 1 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>Tab:</span>
            <select className="input" value={selTab} onChange={e => handleTabChange(e.target.value)}
              style={{ fontSize: 13 }}>
              <option value="">— select a tab —</option>
              {tabs.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'center', padding: '10px 14px', background: 'rgba(74,222,128,.07)', borderRadius: 8, border: '1px solid rgba(74,222,128,.2)' }}>
            <span style={{ fontSize: 20 }}>✓</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>{rows.length} rows loaded</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                {rows[0].orderId} — {rows[0].domain}{rows.length > 1 ? ` · +${rows.length - 1} more` : ''}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Common fields ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 6 }}>
          Step 2 · Batch Settings
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 20 }}>
          Same for every card in this batch · Vendor, Vendor Price, Actual Paid & Currency are auto-fetched from GPL API per domain
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>

          <Field label="Customer Name" required span={2}>
            <Inp value={common.clientName} onChange={v => set('clientName', v)} placeholder="e.g. Sokchea Thea" />
          </Field>

          <Field label="Order URL" span={2}>
            <Inp value={common.orderUrl} onChange={v => set('orderUrl', v)} placeholder="https://guestpostlinks.net/service/…" />
          </Field>

          <Divider />

          <Field label="Order Status">
            <Sel value={common.orderStatus} onChange={v => set('orderStatus', v)} options={STATUS_OPTS} />
          </Field>
          <Field label="Payment Status">
            <Sel value={common.paymentStatus} onChange={v => set('paymentStatus', v)} options={PAY_OPTS} />
          </Field>

          <Field label="Order From">
            <Sel value={common.orderFrom} onChange={v => set('orderFrom', v)} options={ORDER_FROM_OPTS} />
          </Field>
          <Field label="Order Type">
            <Sel value={common.orderType} onChange={v => set('orderType', v)} options={ORDER_TYPE_OPTS} />
          </Field>

          <Field label="Order In">
            <Sel value={common.orderIn} onChange={v => set('orderIn', v)} options={ORDER_IN_OPTS} />
          </Field>
          <Field label="Post Type (niche for GPL price lookup)">
            <Sel value={common.postType} onChange={v => set('postType', v)} options={POST_TYPE_OPTS} placeholder="— select niche —" />
          </Field>

          <Divider />

          <Field label="Client Sheet">
            <Inp value={common.clientSheet} onChange={v => set('clientSheet', v)} placeholder="Sheet name or URL" />
          </Field>
          <Field label="Note">
            <Inp value={common.note} onChange={v => set('note', v)} placeholder="e.g. Master Sheet" />
          </Field>

          <Field label="Publication Cost">
            <Inp type="number" value={common.publicationCost} onChange={v => set('publicationCost', v)} placeholder="0.00" />
          </Field>

          <Divider />

          <Field label="Order Process By">
            <Sel value={common.orderProcessBy} onChange={v => set('orderProcessBy', v)} options={ORDER_PROCESS_BY_OPTS} placeholder="— select person —" />
          </Field>
          <Field label="Sent for Publication">
            <select className="input" value={common.sentForPublication} onChange={e => set('sentForPublication', e.target.value)}
              style={{ fontSize: 13, width: '100%' }}>
              <option value="">{notionUsers.length ? '— select person —' : 'Loading…'}</option>
              {notionUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>

          <Field label="Date of Publication">
            <input
              type="date"
              value={common.dateOfPublication}
              onChange={e => set('dateOfPublication', e.target.value)}
              className="input"
              style={{ fontSize: 13, width: '100%' }}
            />
          </Field>

        </div>
      </div>

      {/* ── Create button ─────────────────────────────── */}
      {!creating && !finished && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {!common.clientName.trim() && rows.length > 0 && (
            <span style={{ fontSize: 12, color: '#fb923c' }}>Client Name is required</span>
          )}
          {rows.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Load a sheet first</span>
          )}
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            style={{
              padding: '11px 32px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none',
              cursor: canCreate ? 'pointer' : 'not-allowed',
              background: canCreate ? 'var(--accent)' : 'var(--border)',
              color: canCreate ? 'var(--accent-ink)' : 'var(--text-faint)',
              transition: 'all 0.15s',
            }}
          >
            Create {rows.length > 0 ? `${rows.length} ` : ''}Notion Cards →
          </button>
        </div>
      )}

      {/* ── Progress ─────────────────────────────────── */}
      {(creating || finished) && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {finished
                ? `${prog.done - prog.errors.length} of ${prog.total} cards created`
                : `Creating… ${prog.done} / ${prog.total}`
              }
            </div>
            {finished && (
              <button className="btn" onClick={reset} style={{ fontSize: 12 }}>New Batch</button>
            )}
          </div>

          <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, transition: 'width 0.35s ease',
              width: `${pct}%`,
              background: finished && prog.errors.length === 0 ? '#4ade80' : 'var(--accent)',
            }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>{pct}% complete</div>

          {/* Multi-source database error — special callout */}
          {hasMultiSourceErr && (
            <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(251,146,60,.08)', border: '1px solid rgba(251,146,60,.3)', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#fb923c', marginBottom: 6 }}>
                Notion database not compatible
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                Your Notion database uses the "connected databases / multiple data sources" feature which the Notion API doesn't support.
                <br /><strong style={{ color: 'var(--text)' }}>Fix:</strong> In Notion, create a new plain database (not connected/linked to others) and update the Database ID in your environment variables.
              </div>
            </div>
          )}

          {/* General errors (deduplicated) */}
          {errSummary.length > 0 && !hasMultiSourceErr && (
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(248,113,113,.07)', border: '1px solid rgba(248,113,113,.2)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f87171', marginBottom: 8 }}>
                {prog.errors.length} error{prog.errors.length > 1 ? 's' : ''}
              </div>
              {errSummary.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: '#f87171', lineHeight: 1.5 }}>
                  {e.count > 1 && <span style={{ opacity: 0.6 }}>×{e.count} </span>}{e.msg}
                </div>
              ))}
            </div>
          )}

          {finished && prog.errors.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 13, color: '#4ade80', fontWeight: 600 }}>
              All cards created successfully
            </div>
          )}
        </div>
      )}
    </div>
  )
}

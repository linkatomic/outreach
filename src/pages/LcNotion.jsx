import { useState } from 'react'
import { extractSheetId, getSheetTabs, getSheetRows } from '../lib/sheetParserAPI.js'
import { fetchGplBatch, extractGplInfo, buildNotionProperties, createNotionPage } from '../lib/notionApi.js'

const STATUS_OPTS      = ['Sent For Publication', 'In Progress', 'Completed', 'On Hold', 'Cancelled']
const ORDER_FROM_OPTS  = ['GUESTPOSTLINKS', 'DIRECT', 'FIVERR', 'OTHER']
const ORDER_TYPE_OPTS  = ['Article Publication', 'Link Insertion', 'Press Release']
const ORDER_IN_OPTS    = ['Single', 'Bulk']
const POST_TYPE_OPTS   = ['Casino', 'Finance', 'CBD', 'Crypto', 'Health', 'Tech', 'Dating', 'Adult', 'General', 'Gambling']
const PAY_STATUS_OPTS  = ['Need to Check', 'Paid', 'Pending', 'Overdue']

const DEFAULTS = {
  orderStatus:     'Sent For Publication',
  clientName:      '',
  clientSheet:     '',
  orderFrom:       'GUESTPOSTLINKS',
  orderType:       'Article Publication',
  orderIn:         'Bulk',
  postType:        '',
  paymentStatus:   'Need to Check',
  note:            'Master Sheet',
  publicationCost: '',
  orderUrl:        '',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function Lbl({ children }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>
      {children}
    </label>
  )
}

function SelInput({ value, onChange, options, placeholder }) {
  return (
    <select className="input" value={value} onChange={e => onChange(e.target.value)} style={{ fontSize: 13, width: '100%' }}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function TxtInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      className="input"
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ fontSize: 13, width: '100%' }}
    />
  )
}

export function LcNotion() {
  // Sheet state
  const [sheetUrl,    setSheetUrl]    = useState('')
  const [tabs,        setTabs]        = useState([])
  const [selTab,      setSelTab]      = useState('')
  const [rows,        setRows]        = useState([])
  const [sheetBusy,   setSheetBusy]   = useState(false)
  const [sheetErr,    setSheetErr]    = useState('')

  // Common fields
  const [common, setCommon] = useState(DEFAULTS)
  const set = (k, v) => setCommon(p => ({ ...p, [k]: v }))

  // Creation state
  const [creating, setCreating] = useState(false)
  const [prog,     setProg]     = useState({ done: 0, total: 0, errors: [] })
  const [finished, setFinished] = useState(false)

  // ── Sheet loading ─────────────────────────────────────

  async function handleLoadSheet() {
    setSheetErr('')
    setTabs([])
    setRows([])
    setSelTab('')
    setFinished(false)
    setSheetBusy(true)
    try {
      const id = extractSheetId(sheetUrl.trim())
      if (!id) throw new Error('Invalid Google Sheet URL')
      const tabList = await getSheetTabs(id)
      setTabs(tabList)
      // Auto-load if only one tab
      if (tabList.length === 1) {
        setSelTab(tabList[0].name)
        await loadTabRows(id, tabList[0].name)
      }
    } catch (err) {
      setSheetErr(err.message || 'Failed to load sheet')
    } finally {
      setSheetBusy(false)
    }
  }

  async function loadTabRows(sheetId, tabName) {
    setSheetBusy(true)
    setSheetErr('')
    setRows([])
    try {
      const rawRows = await getSheetRows(sheetId, tabName)
      if (!rawRows.length) { setRows([]); return }

      // Find Order ID and Domain columns by header
      const header = rawRows[0].map(h => String(h ?? '').trim().toLowerCase())
      const oidIdx = header.findIndex(h => h.includes('order id') || h === 'orderid')
      const domIdx = header.findIndex(h => h === 'domain')
      const oi = oidIdx >= 0 ? oidIdx : 0
      const di = domIdx >= 0 ? domIdx : 1

      const data = rawRows.slice(1)
        .map(r => ({
          orderId: String(r[oi] ?? '').trim(),
          domain:  String(r[di] ?? '').trim(),
        }))
        .filter(r => r.orderId && r.domain)

      setRows(data)
    } catch (err) {
      setSheetErr(err.message || 'Failed to load rows')
    } finally {
      setSheetBusy(false)
    }
  }

  async function handleTabChange(tabName) {
    setSelTab(tabName)
    setRows([])
    const id = extractSheetId(sheetUrl.trim())
    if (id && tabName) await loadTabRows(id, tabName)
  }

  // ── Notion card creation ──────────────────────────────

  async function handleCreate() {
    if (!rows.length) return
    setCreating(true)
    setFinished(false)
    setProg({ done: 0, total: rows.length, errors: [] })

    // Fetch GPL data for all domains
    const domains = rows.map(r => r.domain)
    const gplMap  = await fetchGplBatch(domains)

    const errors = []
    for (let i = 0; i < rows.length; i++) {
      const row  = rows[i]
      const site = gplMap.get(row.domain.toLowerCase())
      const gpl  = extractGplInfo(site, common.postType)

      try {
        const props = buildNotionProperties({
          orderId:    row.orderId,
          domain:     row.domain,
          vendor:     gpl.vendor,
          vendorPrice: gpl.vendorPrice,
          actualPaid: gpl.actualPaid,
          currency:   gpl.currency,
          common,
        })
        await createNotionPage(props)
      } catch (err) {
        errors.push(`${row.orderId}: ${err.message}`)
      }

      const snap = [...errors]
      setProg({ done: i + 1, total: rows.length, errors: snap })
      if (i < rows.length - 1) await sleep(400) // stay under Notion's 3 req/s limit
    }

    setCreating(false)
    setFinished(true)
  }

  function resetAll() {
    setFinished(false)
    setCreating(false)
    setRows([])
    setTabs([])
    setSelTab('')
    setSheetUrl('')
    setSheetErr('')
    setCommon(DEFAULTS)
    setProg({ done: 0, total: 0, errors: [] })
  }

  const pct       = prog.total ? Math.round((prog.done / prog.total) * 100) : 0
  const canCreate = rows.length > 0 && common.clientName.trim() && !creating

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Notion Card Creator</h1>
          <div className="sub">Bulk-create Notion pages from an Order Sheet tab</div>
        </div>
      </div>

      {/* ── Step 1: Load Sheet ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
          1 — Load Order Sheet
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="Paste Google Sheet URL…"
            value={sheetUrl}
            onChange={e => setSheetUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLoadSheet()}
            style={{ flex: 1, fontSize: 13 }}
          />
          <button className="btn" onClick={handleLoadSheet} disabled={!sheetUrl.trim() || sheetBusy}>
            {sheetBusy ? 'Loading…' : 'Load'}
          </button>
        </div>

        {sheetErr && (
          <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{sheetErr}</div>
        )}

        {/* Tab picker — only shown when multiple tabs */}
        {tabs.length > 1 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>Select tab:</span>
            <select
              className="input"
              value={selTab}
              onChange={e => handleTabChange(e.target.value)}
              style={{ fontSize: 13, minWidth: 220 }}
            >
              <option value="">— pick a tab —</option>
              {tabs.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
        )}

        {/* Row summary */}
        {rows.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-faint)', display: 'flex', gap: 16 }}>
            <span>
              <span style={{ color: '#4ade80', fontWeight: 600 }}>✓</span>{' '}
              <strong style={{ color: 'var(--text)' }}>{rows.length}</strong> rows loaded
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
              {rows[0].orderId} — {rows[0].domain}
              {rows.length > 1 && ` … +${rows.length - 1} more`}
            </span>
          </div>
        )}
      </div>

      {/* ── Step 2: Common Fields ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
          2 — Common Fields
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 16 }}>
          These values are the same for every card in this batch.
          Vendor, Vendor Price, Actual Paid, and Currency are auto-fetched from GPL API per domain.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>

          {/* Row 1 */}
          <div>
            <Lbl>Order Status</Lbl>
            <SelInput value={common.orderStatus} onChange={v => set('orderStatus', v)} options={STATUS_OPTS} />
          </div>
          <div>
            <Lbl>Payment Status</Lbl>
            <SelInput value={common.paymentStatus} onChange={v => set('paymentStatus', v)} options={PAY_STATUS_OPTS} />
          </div>
          <div>
            <Lbl>Order From</Lbl>
            <SelInput value={common.orderFrom} onChange={v => set('orderFrom', v)} options={ORDER_FROM_OPTS} />
          </div>

          {/* Row 2 */}
          <div>
            <Lbl>Order Type</Lbl>
            <SelInput value={common.orderType} onChange={v => set('orderType', v)} options={ORDER_TYPE_OPTS} />
          </div>
          <div>
            <Lbl>Order In</Lbl>
            <SelInput value={common.orderIn} onChange={v => set('orderIn', v)} options={ORDER_IN_OPTS} />
          </div>
          <div>
            <Lbl>Post Type <span style={{ color: '#a78bfa', fontStyle: 'italic', textTransform: 'none' }}>(niche for GPL)</span></Lbl>
            <SelInput value={common.postType} onChange={v => set('postType', v)} options={POST_TYPE_OPTS} placeholder="— select niche —" />
          </div>

          {/* Row 3 */}
          <div style={{ gridColumn: '1 / 3' }}>
            <Lbl>Client Name <span style={{ color: '#f87171' }}>*</span></Lbl>
            <TxtInput value={common.clientName} onChange={v => set('clientName', v)} placeholder="e.g. Sokchea Thea" />
          </div>
          <div>
            <Lbl>Publication Cost</Lbl>
            <TxtInput type="number" value={common.publicationCost} onChange={v => set('publicationCost', v)} placeholder="0.00" />
          </div>

          {/* Row 4 */}
          <div style={{ gridColumn: '1 / -1' }}>
            <Lbl>Order URL</Lbl>
            <TxtInput value={common.orderUrl} onChange={v => set('orderUrl', v)} placeholder="https://guestpostlinks.net/service/…" />
          </div>

          {/* Row 5 */}
          <div>
            <Lbl>Client Sheet</Lbl>
            <TxtInput value={common.clientSheet} onChange={v => set('clientSheet', v)} placeholder="Sheet name or link" />
          </div>
          <div style={{ gridColumn: '2 / -1' }}>
            <Lbl>Note</Lbl>
            <TxtInput value={common.note} onChange={v => set('note', v)} placeholder="e.g. Master Sheet" />
          </div>

        </div>
      </div>

      {/* ── Create button ── */}
      {!creating && !finished && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          {!common.clientName.trim() && rows.length > 0 && (
            <span style={{ fontSize: 12, color: '#fb923c' }}>Client Name is required</span>
          )}
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            style={{
              padding: '10px 28px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: canCreate ? 'pointer' : 'not-allowed',
              background: canCreate ? 'var(--accent)' : 'var(--border)', color: canCreate ? 'var(--accent-ink)' : 'var(--text-faint)',
              transition: 'background 0.15s',
            }}
          >
            Create {rows.length > 0 ? `${rows.length} ` : ''}Notion Cards
          </button>
        </div>
      )}

      {/* ── Progress ── */}
      {(creating || finished) && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
            {finished
              ? `${prog.done - prog.errors.length} of ${prog.total} cards created`
              : `Creating cards… ${prog.done} / ${prog.total}`
            }
          </div>

          {/* Progress bar */}
          <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: finished && prog.errors.length === 0 ? '#4ade80' : 'var(--accent)',
              width: `${pct}%`, transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: prog.errors.length ? 12 : 0 }}>
            {pct}% complete
          </div>

          {/* Errors */}
          {prog.errors.length > 0 && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(248,113,113,.08)', borderRadius: 8, border: '1px solid rgba(248,113,113,.25)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f87171', marginBottom: 6 }}>
                {prog.errors.length} error{prog.errors.length > 1 ? 's' : ''}:
              </div>
              {prog.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: '#f87171', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{e}</div>
              ))}
            </div>
          )}

          {/* Done actions */}
          {finished && (
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 13 }}>
                {prog.errors.length === 0
                  ? <span style={{ color: '#4ade80', fontWeight: 600 }}>All cards created successfully</span>
                  : <span style={{ color: 'var(--text-faint)' }}>
                      <span style={{ color: '#4ade80', fontWeight: 600 }}>{prog.done - prog.errors.length} created</span>
                      {' · '}
                      <span style={{ color: '#f87171' }}>{prog.errors.length} failed</span>
                    </span>
                }
              </div>
              <button className="btn" onClick={resetAll} style={{ marginLeft: 'auto', fontSize: 12 }}>
                New Batch
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../data.jsx'
import { extractSheetId, getSheetTabs, getSheetRows } from '../lib/sheetParserAPI.js'
import {
  detectNewListingColumns, parseNewListingRows, summarizeDetection, isLikelyDateTab,
  LISTING_STATUS_OPTIONS,
} from '../lib/newListingParser.js'
import {
  bulkUpsertNewListings, loadExistingNewListingWebsites,
  loadNewListings, loadNewListingSourceTabs, deleteNewListing,
} from '../lib/supabase.js'

// ── Tab selection card ───────────────────────────────────────────────────────

function TabRow({ tab, onToggle }) {
  const disabled = tab.skip
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      border: '1px solid var(--border)', borderRadius: 8, opacity: disabled ? 0.5 : 1,
    }}>
      <input type="checkbox" checked={!!tab.selected} disabled={disabled}
             onChange={e => onToggle(e.target.checked)}
             style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }} />
      <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{tab.name}</span>
      {tab.likely && <span style={{ fontSize: 10, color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)', borderRadius: 4, padding: '1px 6px' }}>daily tab</span>}
      {disabled && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>— {tab.reason}</span>}
      {!disabled && (
        <span style={{ marginLeft: 'auto', fontSize: 11, color: tab.summary.hasWebsite ? 'var(--text-faint)' : '#fb7185' }}>
          {tab.summary.hasWebsite
            ? `${tab.summary.coreFound}/${tab.summary.coreTotal} fields · ${tab.summary.pricingGroupsFound} price groups`
            : 'No Website column detected'}
        </span>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function NewListingImporter({ me }) {
  const [activeTab, setActiveTab] = useState('import') // 'import' | 'browse'

  // Import flow
  const [url, setUrl] = useState('')
  const [sheetId, setSheetId] = useState('')
  const [step, setStep] = useState('idle') // idle | loading-tabs | select | analyzing | review | importing | done | error
  const [tabs, setTabs] = useState([])
  const [results, setResults] = useState([])
  const [processingMsg, setProcessingMsg] = useState('')
  const [errMsg, setErrMsg] = useState('')

  async function loadTabs() {
    if (!url.trim()) return
    setStep('loading-tabs'); setErrMsg('')
    try {
      const id = extractSheetId(url.trim())
      if (!id) throw new Error('Could not find a spreadsheet ID in that URL')
      const tabList = await getSheetTabs(id)
      if (!tabList.length) throw new Error('No sheets found in this spreadsheet')

      const metas = await Promise.all(tabList.map(async ({ name }) => {
        try {
          const sample = await getSheetRows(id, name, 2)
          if (sample.length < 2) return { name, skip: true, reason: 'not enough header rows' }
          const colInfo = detectNewListingColumns(sample)
          const summary = summarizeDetection(colInfo)
          return { name, skip: false, colInfo, summary, likely: isLikelyDateTab(name) }
        } catch (err) {
          return { name, skip: true, reason: err.message }
        }
      }))

      setSheetId(id)
      setTabs(metas.map(m => ({ ...m, selected: !m.skip && m.summary.hasWebsite && m.likely })))
      setStep('select')
    } catch (err) {
      setErrMsg(err.message); setStep('error')
    }
  }

  function toggleTab(i, v) {
    setTabs(prev => prev.map((t, idx) => idx === i ? { ...t, selected: v } : t))
  }

  async function analyzeSelected() {
    const selected = tabs.filter(t => t.selected && !t.skip)
    if (!selected.length) return
    setStep('analyzing'); setErrMsg('')
    try {
      const out = []
      for (const t of selected) {
        setProcessingMsg(`Reading "${t.name}"…`)
        const allRows = await getSheetRows(sheetId, t.name)
        const parsed = parseNewListingRows(allRows, t.colInfo, {
          sourceTab: t.name, sourceSheetUrl: url.trim(), importedBy: me?.id || null,
        })
        const existing = await loadExistingNewListingWebsites(t.name)
        const newCount = parsed.filter(r => !existing.has(r.website)).length
        out.push({ name: t.name, rows: parsed, newCount, updateCount: parsed.length - newCount, missingCore: t.summary.missingCore })
      }
      if (!out.some(r => r.rows.length)) throw new Error('No valid website rows found in the selected tabs')
      setResults(out)
      setStep('review')
    } catch (err) {
      setErrMsg(err.message); setStep('error')
    }
  }

  async function confirmImport() {
    setStep('importing'); setErrMsg('')
    try {
      const allRows = results.flatMap(r => r.rows)
      setProcessingMsg(`Writing ${allRows.length} row${allRows.length !== 1 ? 's' : ''}…`)
      await bulkUpsertNewListings(allRows)
      setStep('done')
    } catch (err) {
      setErrMsg(err.message); setStep('error')
    }
  }

  function resetImport() {
    setStep('idle'); setUrl(''); setSheetId(''); setTabs([]); setResults([]); setErrMsg('')
  }

  const totalRows = results.reduce((s, r) => s + r.rows.length, 0)
  const totalNew = results.reduce((s, r) => s + r.newCount, 0)
  const totalUpdate = results.reduce((s, r) => s + r.updateCount, 0)
  const selectedCount = tabs.filter(t => t.selected && !t.skip).length
  const previewRows = results.flatMap(r => r.rows).slice(0, 15)

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 16 }}>
        <span className="seg">
          <button className={activeTab === 'import' ? 'on' : ''} onClick={() => setActiveTab('import')}>Import</button>
          <button className={activeTab === 'browse' ? 'on' : ''} onClick={() => setActiveTab('browse')}>Browse</button>
        </span>
      </div>

      {activeTab === 'browse' ? <NewListingBrowse /> : (
        <>
          {(step === 'idle' || step === 'loading-tabs') && (
            <div style={{ maxWidth: 640 }}>
              <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.6 }}>
                Paste the "New Listing" Google Sheet URL — each daily tab (named like "16-10-26") is
                parsed using its own 2-row header template (group + sub-label), so columns are detected
                by name rather than position. Rows already imported from a tab are updated, not duplicated.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && step === 'idle' && loadTabs()}
                  disabled={step === 'loading-tabs'}
                  autoFocus
                />
                <button className="btn primary" onClick={loadTabs} disabled={!url.trim() || step === 'loading-tabs'} style={{ flexShrink: 0 }}>
                  {step === 'loading-tabs' ? 'Loading…' : <><Icon name="zap" size={12} /> Load Tabs</>}
                </button>
              </div>
            </div>
          )}

          {step === 'select' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  Found <strong style={{ color: 'var(--text)' }}>{tabs.length}</strong> tab{tabs.length !== 1 ? 's' : ''}.
                  Tabs named like a date are pre-selected; pick any others you want to import too.
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn ghost" onClick={resetImport}>← Back</button>
                  <button className="btn primary" onClick={analyzeSelected} disabled={selectedCount === 0}>
                    Analyze {selectedCount > 0 ? `(${selectedCount})` : ''}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tabs.map((t, i) => <TabRow key={t.name} tab={t} onToggle={v => toggleTab(i, v)} />)}
              </div>
            </div>
          )}

          {step === 'analyzing' && (
            <div style={{ maxWidth: 480, textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Reading sheet…</div>
              <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>{processingMsg}</div>
            </div>
          )}

          {step === 'review' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  <strong style={{ color: 'var(--text)' }}>{totalRows}</strong> row{totalRows !== 1 ? 's' : ''} parsed —{' '}
                  <span style={{ color: 'var(--ok, #4ade80)' }}>{totalNew} new</span>,{' '}
                  <span style={{ color: 'var(--warn, #f59e0b)' }}>{totalUpdate} update{totalUpdate !== 1 ? 's' : ''}</span>.
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn ghost" onClick={() => setStep('select')}>← Back</button>
                  <button className="btn primary" onClick={confirmImport} disabled={totalRows === 0}>
                    <Icon name="upload" size={12} /> Confirm Import
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {results.map(r => (
                  <div key={r.name} className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                    <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{r.name}</span>
                    <span style={{ color: 'var(--text-faint)' }}>{r.rows.length} rows</span>
                    <span style={{ color: 'var(--ok, #4ade80)' }}>{r.newCount} new</span>
                    <span style={{ color: 'var(--warn, #f59e0b)' }}>{r.updateCount} update{r.updateCount !== 1 ? 's' : ''}</span>
                    {r.missingCore.length > 0 && (
                      <span style={{ marginLeft: 'auto', color: '#fb7185' }}>Missing: {r.missingCore.join(', ')}</span>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 8 }}>
                Preview (first {previewRows.length})
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 420 }}>
                <table className="table">
                  <thead>
                    <tr><th>Tab</th><th>Website</th><th>Status</th><th>Vendor</th><th>Link Type</th><th>Validity</th><th>Post (Gen)</th><th>Currency</th></tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i}>
                        <td className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.source_tab}</td>
                        <td>{r.website}</td>
                        <td>{r.status || <span className="faint">—</span>}</td>
                        <td style={{ whiteSpace: 'normal' }}>{r.vendor || <span className="faint">—</span>}</td>
                        <td>{r.link_type || <span className="faint">—</span>}</td>
                        <td>{r.link_validity || <span className="faint">—</span>}</td>
                        <td>{r.pricing?.post?.general ?? <span className="faint">—</span>}</td>
                        <td>{r.currency || <span className="faint">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div style={{ maxWidth: 480, textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Writing to the database…</div>
              <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>{processingMsg}</div>
            </div>
          )}

          {step === 'done' && (
            <div style={{ maxWidth: 520 }}>
              <div style={{ padding: 24, borderRadius: 12, marginBottom: 20, background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>✓ Import complete</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-dim)' }}>
                  <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{totalRows}</strong> rows written</span>
                  <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{totalNew}</strong> new, <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{totalUpdate}</strong> updated</span>
                  <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{results.length}</strong> tab{results.length !== 1 ? 's' : ''} processed</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn primary" onClick={() => setActiveTab('browse')}>View in Browse</button>
                <button className="btn ghost" onClick={resetImport}>Import Another</button>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div style={{ maxWidth: 520 }}>
              <div style={{ padding: 20, borderRadius: 10, marginBottom: 16, background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.3)' }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: '#fb7185' }}>Error</div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{errMsg}</div>
              </div>
              <button className="btn ghost" onClick={() => setStep(tabs.length ? 'select' : 'idle')}>← Try again</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Browse ───────────────────────────────────────────────────────────────────

function NewListingBrowse() {
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sourceTab, setSourceTab] = useState('')
  const [sourceTabs, setSourceTabs] = useState([])

  const fetchData = useCallback(() => {
    setLoading(true); setErr('')
    loadNewListings({ search, status: status || null, sourceTab: sourceTab || null })
      .then(setListings)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [search, status, sourceTab])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { loadNewListingSourceTabs().then(setSourceTabs).catch(() => {}) }, [])

  async function handleDelete(id) {
    if (!window.confirm('Delete this listing? This cannot be undone.')) return
    try {
      await deleteNewListing(id)
      setListings(prev => prev.filter(l => l.id !== id))
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: '1 1 220px', fontSize: 13 }}
          placeholder="Search website, vendor, added by…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input" style={{ fontSize: 13, width: 170 }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {LISTING_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" style={{ fontSize: 13, width: 150 }} value={sourceTab} onChange={e => setSourceTab(e.target.value)}>
          <option value="">All tabs</option>
          {sourceTabs.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {err && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>Loading…</div>
      ) : listings.length === 0 ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>No listings found.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 600 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Website</th><th>Status</th><th>Vendor</th><th>Link Type</th>
                <th>Validity</th><th>Manage By</th><th>Tab</th><th>Missive</th><th></th>
              </tr>
            </thead>
            <tbody>
              {listings.map(l => (
                <tr key={l.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{l.entry_date || '—'}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {l.website_url
                      ? <a href={l.website_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)', textDecoration: 'none' }}>{l.website}</a>
                      : l.website}
                  </td>
                  <td>{l.status || <span className="faint">—</span>}</td>
                  <td style={{ whiteSpace: 'normal' }}>{l.vendor || <span className="faint">—</span>}</td>
                  <td>{l.link_type || <span className="faint">—</span>}</td>
                  <td>{l.link_validity || <span className="faint">—</span>}</td>
                  <td>{l.manage_by || <span className="faint">—</span>}</td>
                  <td className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{l.source_tab}</td>
                  <td>
                    {l.missive_link
                      ? <a href={l.missive_link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}><Icon name="link" size={11} /></a>
                      : <span className="faint">—</span>}
                  </td>
                  <td>
                    <button className="btn ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => handleDelete(l.id)}>
                      <Icon name="trash" size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

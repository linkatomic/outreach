import { useState, useEffect, useCallback } from 'react'
import { Icon, TEAM } from '../data.jsx'
import { saveSheetParserHistory, loadSheetParserHistory } from '../lib/supabase.js'
import {
  extractSheetId, getSheetTabs, getSheetRows,
  detectColumns, createOutputSheet,
  cleanDomain, parsePrice, normalizeColumnLabels,
  lookupPublisherData,
} from '../lib/sheetParserAPI.js'

const CONFIDENCE_COLOR = { high: 'var(--accent)', medium: '#f59e0b', low: '#fb7185' }

export function SheetParser({ priceMap, me }) {
  const [activeTab, setActiveTab]  = useState('parse')  // 'parse' | 'history'
  const [step, setStep]            = useState('idle')  // idle | analyzing | review | processing | done | error
  const [processingMsg, setProcessingMsg] = useState('')
  const [url, setUrl]         = useState('')
  const [sheetId, setSheetId] = useState('')
  const [tabs, setTabs]       = useState([])
  const [output, setOutput]   = useState(null)
  const [errMsg, setErrMsg]   = useState('')

  // ── History ───────────────────────────────────────────
  const [history, setHistory]         = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFilter, setHistoryFilter]   = useState('all')  // 'all' | 'mine' | member id

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const memberId = historyFilter === 'all' ? null : (historyFilter === 'mine' ? me?.id : historyFilter)
      setHistory(await loadSheetParserHistory(memberId))
    } catch { /* silent */ }
    finally { setHistoryLoading(false) }
  }, [historyFilter, me?.id])

  useEffect(() => { if (activeTab === 'history') fetchHistory() }, [activeTab, fetchHistory])

  // ── Step 1: Analyze ────────────────────────────────────
  async function analyze() {
    if (!url.trim()) return
    setStep('analyzing')
    setErrMsg('')
    try {
      const id = extractSheetId(url.trim())
      if (!id) throw new Error('Could not find a spreadsheet ID in that URL')

      const tabList = await getSheetTabs(id)
      if (!tabList.length) throw new Error('No sheets found in this spreadsheet')

      const results = await Promise.all(
        tabList.map(async ({ name }) => {
          try {
            const rows = await getSheetRows(id, name, 25)
            if (rows.length < 2) return { name, skip: true, reason: 'Not enough rows', rows: [], allColumns: [], headerRow: 0, domainColumn: null, domainConfidence: 'low', priceColumns: [] }

            const det = await detectColumns(name, rows)
            const headerRow = Math.max(0, Math.min(det.headerRow ?? 0, rows.length - 1))
            const allColumns = (rows[headerRow] || []).map(c => String(c ?? '').trim()).filter(Boolean)

            const priceColNames = (det.priceColumns || []).map(p => p.name)
            const additionalColumns = allColumns
              .filter(c => c !== det.domainColumn && !priceColNames.includes(c))
              .map(c => ({ name: c, selected: false }))

            return {
              name, skip: false, rows, allColumns, headerRow,
              domainColumn: det.domainColumn ?? null,
              domainConfidence: det.domainConfidence ?? 'low',
              priceColumns: (det.priceColumns || []).map(p => ({ ...p, enabled: true })),
              additionalColumns,
              enabled: true,
            }
          } catch (err) {
            return { name, skip: true, reason: err.message, rows: [], allColumns: [], headerRow: 0, domainColumn: null, domainConfidence: 'low', priceColumns: [], enabled: false }
          }
        })
      )

      // Normalize price column labels across all tabs so identical concepts share one output column
      const allLabels = [...new Set(results.flatMap(r => (r.priceColumns || []).map(p => p.label)))]
      if (allLabels.length > 1) {
        try {
          const mapping = await normalizeColumnLabels(allLabels)
          results.forEach(r => {
            if (r.priceColumns) {
              r.priceColumns = r.priceColumns.map(p => ({ ...p, label: mapping[p.label] || p.label }))
            }
          })
        } catch (_) { /* keep original labels if normalization fails */ }
      }

      setSheetId(id)
      setTabs(results)
      setStep('review')
    } catch (err) {
      setErrMsg(err.message)
      setStep('error')
    }
  }

  // ── Step 2: Process ────────────────────────────────────
  async function process() {
    setStep('processing')
    setErrMsg('')
    try {
      const enabledTabs = tabs.filter(t => t.enabled && !t.skip && t.domainColumn)
      if (!enabledTabs.length) throw new Error('No tabs with a domain column selected')

      // Union of all price labels across all enabled tabs
      const allPriceLabels = []
      for (const tab of enabledTabs) {
        for (const pc of tab.priceColumns.filter(p => p.enabled)) {
          if (!allPriceLabels.includes(pc.label)) allPriceLabels.push(pc.label)
        }
      }

      // Union of selected additional column names across all enabled tabs
      const allAdditionalNames = []
      for (const tab of enabledTabs) {
        for (const ac of (tab.additionalColumns || []).filter(c => c.selected)) {
          if (!allAdditionalNames.includes(ac.name)) allAdditionalNames.push(ac.name)
        }
      }

      const headers = [
        'Tab Name', 'Website',
        ...allPriceLabels.flatMap(l => [l, 'Buyer']),
        'Status',
        ...allAdditionalNames,
      ]
      const outputRows = []
      let totalSites = 0

      for (const tab of enabledTabs) {
        const rows = await getSheetRows(sheetId, tab.name)
        const headerRow = Math.max(0, Math.min(tab.headerRow ?? 0, rows.length - 1))
        const headerCells = (rows[headerRow] || []).map(c => String(c ?? '').trim())

        const domainIdx = headerCells.indexOf(tab.domainColumn)
        if (domainIdx === -1) continue

        const enabledPrices = tab.priceColumns.filter(p => p.enabled)
        const priceIndices = enabledPrices.map(p => ({ label: p.label, idx: headerCells.indexOf(p.name) }))

        for (let i = headerRow + 1; i < rows.length; i++) {
          const row = rows[i] || []
          const domain = cleanDomain(row[domainIdx] ?? '')
          if (!domain || !domain.includes('.')) continue

          const priceValues = {}
          for (const { label, idx } of priceIndices) {
            if (idx === -1) continue
            const price = parsePrice(row[idx] ?? '')
            priceValues[label] = price
          }

          const additionalValues = allAdditionalNames.map(colName => {
            const idx = headerCells.indexOf(colName)
            return idx === -1 ? '' : (row[idx] ?? '')
          })

          const outRow = [
            tab.name,
            domain,
            ...allPriceLabels.flatMap(label => {
              const price = priceValues[label] ?? null
              if (price == null) return ['', '']
              const buyer = priceMap?.get(Math.round(price))?.buyer ?? ''
              return [price, buyer]
            }),
            '',  // Status placeholder — filled in after GPL lookup
            ...additionalValues,
          ]
          outputRows.push(outRow)
          totalSites++
        }
      }

      if (!outputRows.length) throw new Error('No valid website rows found in the selected tabs')

      // GPL publisher data lookup (5 parallel batches of 100)
      const statusColIdx = 2 + 2 * allPriceLabels.length
      const uniqueDomains = [...new Set(outputRows.map(r => r[1]))]
      setProcessingMsg(`Looking up publisher data for ${uniqueDomains.length} sites…`)
      const gplMap = await lookupPublisherData(uniqueDomains, (cur, total) => {
        setProcessingMsg(`Publisher lookup — batch ${cur} of ${total}…`)
      })

      // Collect all unique addon labels (label → display name) in order of first appearance
      const addonLabelToName = new Map()
      for (const [, info] of gplMap) {
        for (const addon of info.addons) {
          if (!addonLabelToName.has(addon.label)) addonLabelToName.set(addon.label, addon.name)
        }
      }
      const addonLabels     = [...addonLabelToName.keys()]
      const gplFixedHeaders = ['Disable Reason', 'Vendor Name', 'Vendor Type', 'Email', 'Currency']
      const gplAddonHeaders = [...addonLabelToName.values()].map(n => `Actual ${n}`)
      const gplHeaders      = [...gplFixedHeaders, ...gplAddonHeaders]

      // Build final headers: insert GPL columns after Status
      const finalHeaders = [
        ...headers.slice(0, statusColIdx + 1),
        ...gplHeaders,
        ...headers.slice(statusColIdx + 1),
      ]

      // Build final rows: fill Status + splice in GPL data after it
      const STATUS_LABELS = { publish: 'Active', disable: 'Disabled', draft: 'Draft', trash: 'Removed' }
      const finalRows = outputRows.map(r => {
        const info = gplMap.get(r[1])
        const statusStr = info ? (STATUS_LABELS[info.status] || info.status) : 'Not in DB'
        const gplData = info ? [
          info.disableReason,
          info.vendorName,
          info.vendorType,
          info.email,
          info.currency,
          ...addonLabels.map(lbl => info.addons.find(a => a.label === lbl)?.actualPrice ?? ''),
        ] : Array(gplHeaders.length).fill('')
        const base = [...r]
        base[statusColIdx] = statusStr
        return [...base.slice(0, statusColIdx + 1), ...gplData, ...base.slice(statusColIdx + 1)]
      })

      setProcessingMsg('Writing to Google Sheets…')
      const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const sheetUrl = await createOutputSheet(`Processed Sites — ${date}`, finalHeaders, finalRows, allPriceLabels.length)

      const outputData = { sheetUrl, totalSites, tabsProcessed: enabledTabs.length, priceColumns: allPriceLabels.length }
      setOutput(outputData)
      setStep('done')

      // Save to history (fire-and-forget)
      if (me?.id) {
        const title = `Processed Sites — ${date}`
        saveSheetParserHistory({
          memberId: me.id,
          sourceUrl: url,
          outputUrl: sheetUrl,
          outputTitle: title,
          tabsProcessed: outputData.tabsProcessed,
          totalSites: outputData.totalSites,
          priceColumns: outputData.priceColumns,
        }).catch(() => {}) // silently fail — don't break the UX
      }
    } catch (err) {
      setErrMsg(err.message)
      setStep('error')
    }
  }

  function updateTab(i, patch) {
    setTabs(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }
  function updatePriceCol(ti, ci, patch) {
    setTabs(prev => prev.map((t, i) => i !== ti ? t : {
      ...t, priceColumns: t.priceColumns.map((p, j) => j === ci ? { ...p, ...patch } : p),
    }))
  }
  function updateAdditionalCol(ti, ci, selected) {
    setTabs(prev => prev.map((t, i) => i !== ti ? t : {
      ...t, additionalColumns: t.additionalColumns.map((c, j) => j === ci ? { ...c, selected } : c),
    }))
  }
  function toggleAllAdditional(ti, selected) {
    setTabs(prev => prev.map((t, i) => i !== ti ? t : {
      ...t, additionalColumns: t.additionalColumns.map(c => ({ ...c, selected })),
    }))
  }

  const activeTabCount = tabs.filter(t => t.enabled && !t.skip && t.domainColumn).length

  // ── Render ─────────────────────────────────────────────

  const members = TEAM.filter(m => !m.neelOnly)

  if (activeTab === 'history') return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        <span className="seg">
          <button className={activeTab === 'parse' ? 'on' : ''} onClick={() => setActiveTab('parse')}>Parse</button>
          <button className={activeTab === 'history' ? 'on' : ''} onClick={() => setActiveTab('history')}>History</button>
        </span>
        <span className="seg" style={{ marginLeft: 'auto' }}>
          <button className={historyFilter === 'all' ? 'on' : ''} onClick={() => setHistoryFilter('all')}>Everyone</button>
          <button className={historyFilter === 'mine' ? 'on' : ''} onClick={() => setHistoryFilter('mine')}>Mine</button>
          {members.map(m => (
            <button key={m.id} className={historyFilter === m.id ? 'on' : ''} onClick={() => setHistoryFilter(m.id)}>
              {m.name.split(' ')[0]}
            </button>
          ))}
        </span>
      </div>

      {historyLoading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>Loading…</div>
      ) : history.length === 0 ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>No history yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 80px 1fr 1fr 70px 55px',
            gap: '0 12px', padding: '6px 12px',
            fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--text-faint)',
          }}>
            <div>Date</div><div>By</div><div>Source Sheet</div><div>Output Sheet</div><div style={{ textAlign: 'center' }}>Sites</div><div style={{ textAlign: 'center' }}>Tabs</div>
          </div>
          {history.map(h => {
            const member = TEAM.find(m => m.id === h.member_id)
            const ts = new Date(h.created_at)
            const dateStr = ts.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            const timeStr = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            const shortUrl = u => {
              try { const m = u.match(/\/spreadsheets\/d\/([^/]+)/); return m ? `…${m[1].slice(0, 12)}…` : u.slice(0, 30) } catch { return u }
            }
            return (
              <div key={h.id} style={{
                display: 'grid', gridTemplateColumns: '120px 80px 1fr 1fr 70px 55px',
                gap: '0 12px', padding: '10px 12px', borderRadius: 8,
                background: 'var(--surface-2)', alignItems: 'center', fontSize: 13,
              }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{dateStr}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{timeStr}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className={`avatar sm ${member?.color}`}>{member?.short}</div>
                  <span style={{ fontSize: 12 }}>{member?.name.split(' ')[0] || h.member_id}</span>
                </div>
                <div>
                  <a href={h.source_url} target="_blank" rel="noreferrer"
                     style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                     title={h.source_url}>
                    <Icon name="link" size={10} />{shortUrl(h.source_url)}
                  </a>
                </div>
                <div>
                  <a href={h.output_url} target="_blank" rel="noreferrer"
                     style={{ color: 'var(--accent)', fontSize: 12, fontFamily: 'var(--font-mono)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                     title={h.output_title}>
                    <Icon name="link" size={10} />{h.output_title || shortUrl(h.output_url)}
                  </a>
                </div>
                <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{h.total_sites?.toLocaleString()}</div>
                <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{h.tabs_processed}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  if (step === 'idle' || step === 'analyzing') return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 16 }}>
        <span className="seg">
          <button className={activeTab === 'parse' ? 'on' : ''} onClick={() => setActiveTab('parse')}>Parse</button>
          <button className={activeTab === 'history' ? 'on' : ''} onClick={() => setActiveTab('history')}>History</button>
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.6 }}>
        Paste a Google Sheet URL — AI detects website and pricing columns across all tabs, then you confirm before the output is created.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          className="input"
          style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13 }}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && step === 'idle' && analyze()}
          disabled={step === 'analyzing'}
          autoFocus
        />
        <button className="btn primary" onClick={analyze}
                disabled={!url.trim() || step === 'analyzing'} style={{ flexShrink: 0 }}>
          {step === 'analyzing' ? 'Analyzing…' : <><Icon name="zap" size={12} /> Analyze</>}
        </button>
      </div>
      {step === 'analyzing' && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
          Reading all tabs and running AI column detection — this takes 10–20 seconds…
        </div>
      )}
    </div>
  )

  if (step === 'review') return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          AI found <strong style={{ color: 'var(--text)' }}>{tabs.length}</strong> tab{tabs.length !== 1 ? 's' : ''}. Review the detected columns and confirm.
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => setStep('idle')}>← Back</button>
          <button className="btn primary" onClick={process} disabled={activeTabCount === 0}>
            <Icon name="upload" size={12} /> Confirm & Create Sheet
            {activeTabCount > 0 && <span style={{ opacity: 0.7, fontSize: 11, marginLeft: 4 }}>({activeTabCount} tab{activeTabCount !== 1 ? 's' : ''})</span>}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tabs.map((tab, ti) => (
          <TabCard key={tab.name} tab={tab}
            onTabToggle={v => updateTab(ti, { enabled: v })}
            onDomainChange={v => updateTab(ti, { domainColumn: v })}
            onPriceColToggle={(ci, v) => updatePriceCol(ti, ci, { enabled: v })}
            onPriceLabelChange={(ci, v) => updatePriceCol(ti, ci, { label: v })}
            onAdditionalColToggle={(ci, v) => updateAdditionalCol(ti, ci, v)}
            onToggleAllAdditional={v => toggleAllAdditional(ti, v)}
          />
        ))}
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost" onClick={() => setStep('idle')}>← Back</button>
        <button className="btn primary" onClick={process} disabled={activeTabCount === 0}>
          <Icon name="upload" size={12} /> Confirm & Create Sheet
        </button>
      </div>
    </div>
  )

  if (step === 'processing') return (
    <div style={{ maxWidth: 480, textAlign: 'center', padding: '32px 0' }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>⚙️</div>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Creating your sheet…</div>
      <div style={{ fontSize: 13, color: 'var(--text-faint)', minHeight: 20 }}>
        {processingMsg || 'Fetching rows, cleaning domains, looking up prices…'}
      </div>
    </div>
  )

  if (step === 'done' && output) return (
    <div style={{ maxWidth: 520 }}>
      <div style={{
        padding: 24, borderRadius: 12, marginBottom: 20,
        background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>✓ Sheet created</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-dim)' }}>
          <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{output.totalSites}</strong> websites processed</span>
          <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{output.tabsProcessed}</strong> tab{output.tabsProcessed !== 1 ? 's' : ''} merged</span>
          <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{output.priceColumns}</strong> price column{output.priceColumns !== 1 ? 's' : ''} + buyer prices</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <a href={output.sheetUrl} target="_blank" rel="noreferrer" className="btn primary"
           style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="link" size={12} /> Open Sheet
        </a>
        <button className="btn ghost" onClick={() => { setStep('idle'); setUrl(''); setTabs([]); setOutput(null) }}>
          Parse Another
        </button>
      </div>
      <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
        {output.sheetUrl}
      </div>
    </div>
  )

  if (step === 'error') return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ padding: 20, borderRadius: 10, marginBottom: 16, background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.3)' }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: '#fb7185' }}>Error</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{errMsg}</div>
      </div>
      <button className="btn ghost" onClick={() => setStep('idle')}>← Try again</button>
    </div>
  )

  return null
}

// ── Tab review card ─────────────────────────────────────────
function TabCard({ tab, onTabToggle, onDomainChange, onPriceColToggle, onPriceLabelChange, onAdditionalColToggle, onToggleAllAdditional }) {
  const disabled = !tab.enabled || tab.skip
  return (
    <div style={{
      border: `1px solid ${disabled ? 'var(--border)' : 'color-mix(in srgb, var(--accent) 35%, transparent)'}`,
      borderRadius: 10, overflow: 'hidden', opacity: disabled ? 0.5 : 1, transition: 'opacity 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
        <input type="checkbox" checked={tab.enabled && !tab.skip} disabled={tab.skip}
               onChange={e => onTabToggle(e.target.checked)}
               style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{tab.name}</span>
        {tab.skip && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>— skipped ({tab.reason || 'not enough data'})</span>}
      </div>

      {!tab.skip && (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Domain column */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Domain Column</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select className="input" style={{ width: 280, fontSize: 13 }}
                      value={tab.domainColumn || ''} onChange={e => onDomainChange(e.target.value || null)}>
                <option value="">— not selected —</option>
                {tab.allColumns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {tab.domainColumn && <Badge confidence={tab.domainConfidence} />}
              {!tab.domainColumn && <span style={{ fontSize: 12, color: '#fb7185' }}>Please select the domain column</span>}
            </div>
          </div>

          {/* Price columns */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Price Columns — a Buyer column will be added next to each
            </div>
            {tab.priceColumns.length === 0
              ? <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No price columns detected by AI.</span>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tab.priceColumns.map((pc, ci) => (
                    <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={pc.enabled} onChange={e => onPriceColToggle(ci, e.target.checked)}
                             style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pc.name}>
                        {pc.name}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>→</span>
                      <input className="input" style={{ width: 180, fontSize: 12, padding: '3px 8px', height: 28, opacity: pc.enabled ? 1 : 0.4 }}
                             value={pc.label} onChange={e => onPriceLabelChange(ci, e.target.value)}
                             disabled={!pc.enabled} placeholder="Label in output sheet" />
                      <Badge confidence={pc.confidence} />
                    </div>
                  ))}
                </div>
              )
            }
          </div>

          {/* Additional columns */}
          {tab.additionalColumns?.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Additional Columns — appended after a blank separator
                </div>
                <button className="btn ghost" style={{ fontSize: 10, padding: '1px 7px', height: 20, marginLeft: 'auto' }}
                        onClick={() => onToggleAllAdditional(true)}>All</button>
                <button className="btn ghost" style={{ fontSize: 10, padding: '1px 7px', height: 20 }}
                        onClick={() => onToggleAllAdditional(false)}>None</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tab.additionalColumns.map((ac, ci) => (
                  <label key={ci} style={{
                    display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                    padding: '3px 8px', borderRadius: 6, fontSize: 12,
                    background: ac.selected ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface-2)',
                    border: `1px solid ${ac.selected ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
                    color: ac.selected ? 'var(--text)' : 'var(--text-dim)',
                    transition: 'all 0.1s',
                  }}>
                    <input type="checkbox" checked={ac.selected} onChange={e => onAdditionalColToggle(ci, e.target.checked)}
                           style={{ accentColor: 'var(--accent)', width: 11, height: 11, cursor: 'pointer' }} />
                    {ac.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Badge({ confidence }) {
  const color = CONFIDENCE_COLOR[confidence] || 'var(--text-faint)'
  return (
    <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color, border: `1px solid ${color}`, borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
      {confidence}
    </span>
  )
}

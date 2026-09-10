import { useState, useEffect, useCallback } from 'react'
import { Icon, TEAM } from '../data.jsx'
import { saveUltimateSheetParserHistory, loadUltimateSheetParserHistory } from '../lib/supabase.js'
import {
  extractSheetId, getSheetTabs, getSheetRows,
  detectColumns, createUltimateOutputSheet,
  cleanDomain, parsePrice, normalizeColumnLabels,
  lookupPublisherDataFull,
} from '../lib/sheetParserAPI.js'

// ── Fixed niche categories ──────────────────────────────────────────────────
// Matches GPL's own addon `label` field exactly, so comparison lookups are a direct match —
// no fuzzy mapping needed. Confirmed against the GPL API sample response.
const NICHE_CATEGORIES = [
  { key: 'general',    label: 'General',     gplLabel: 'general' },
  { key: 'general_li', label: 'General/LI',  gplLabel: 'link insertion' },
  { key: 'casino',     label: 'Casino',      gplLabel: 'casino' },
  { key: 'casino_li',  label: 'Casino/LI',   gplLabel: 'casino link insertion' },
  { key: 'cbd',        label: 'CBD',         gplLabel: 'cbd' },
  { key: 'cbd_li',     label: 'CBD/LI',      gplLabel: 'cbd link insertion' },
  { key: 'crypto',     label: 'Crypto',      gplLabel: 'crypto' },
  { key: 'crypto_li',  label: 'Crypto/LI',   gplLabel: 'crypto link insertion' },
]
const NICHE_BY_KEY = Object.fromEntries(NICHE_CATEGORIES.map(n => [n.key, n]))

// Each niche shares a color family with its /LI variant, so the two read as clearly related
// at a glance rather than as unrelated columns.
const NICHE_FAMILY = {
  general: 'blue', general_li: 'blue',
  casino: 'purple', casino_li: 'purple',
  cbd: 'green', cbd_li: 'green',
  crypto: 'amber', crypto_li: 'amber',
}
function rgb(red, green, blue) { return { red, green, blue } }
const FAMILY = {
  blue:    { header: rgb(0.176, 0.322, 0.573), tint: rgb(0.933, 0.949, 0.980) },
  purple:  { header: rgb(0.396, 0.263, 0.573), tint: rgb(0.953, 0.933, 0.980) },
  green:   { header: rgb(0.176, 0.435, 0.263), tint: rgb(0.925, 0.957, 0.929) },
  amber:   { header: rgb(0.588, 0.404, 0.086), tint: rgb(0.996, 0.949, 0.878) },
  neutral: { header: rgb(0.11, 0.11, 0.15),    tint: rgb(0.965, 0.965, 0.968) },
}
const HEADER_DARK = rgb(0.11, 0.11, 0.15)
const WHITE = rgb(1, 1, 1)
const WINS_BG = rgb(0.816, 0.925, 0.827)
const TIE_BG  = rgb(0.925, 0.925, 0.929)
const NA_BG   = rgb(0.965, 0.965, 0.965)
const CHEAPER_BG = { existing: FAMILY.blue.tint, added: WINS_BG, same: TIE_BG, na: NA_BG }
const DISABLED_BG = rgb(0.98, 0.867, 0.867)

// ── Column plan ──────────────────────────────────────────────────────────────
// Single source of truth for header text, column widths, merges, and where every value/
// format request lands — everything downstream reads column positions from `colStart`
// instead of hardcoded arithmetic, so reordering or resizing columns only ever happens here.
function buildColumnPlan(activeNicheKeys, additionalNames) {
  const descriptors = [
    { type: 'simple', key: 'tabName', label: 'Tab Name', width: 130 },
    { type: 'simple', key: 'website', label: 'Website', width: 230, align: 'LEFT' },
    { type: 'simple', key: 'status', label: 'Status', width: 110 },
    { type: 'simple', key: 'disableReason', label: 'Disable Reason', width: 280, wrap: true, align: 'LEFT' },
    ...activeNicheKeys.map(key => ({
      type: 'group', key, family: NICHE_FAMILY[key],
      groupLabel: NICHE_BY_KEY[key].label.toUpperCase().replace('/', ' / '),
      subLabels: ['Sheet', 'Buyer', 'Existing', 'Cheaper'],
      widths: [120, 110, 120, 170],
    })),
    { type: 'group', key: 'metrics', family: 'neutral', groupLabel: 'SITE METRICS', subLabels: ['DA', 'PA', 'Ascore'], widths: [75, 75, 85] },
    { type: 'group', key: 'vendor', family: 'neutral', groupLabel: 'VENDOR INFO', subLabels: ['Name', 'Type', 'Currency'], widths: [180, 130, 120] },
    ...additionalNames.map(name => ({ type: 'simple', key: `additional:${name}`, label: name, width: 170 })),
  ]

  let col = 0
  const colStart = {}
  const groupHeaderRow = []
  const subHeaderRow = []
  const widths = []
  for (const d of descriptors) {
    colStart[d.key] = col
    if (d.type === 'simple') {
      groupHeaderRow.push(d.label)
      subHeaderRow.push('')
      widths.push(d.width)
      col += 1
    } else {
      groupHeaderRow.push(d.groupLabel, ...Array(d.subLabels.length - 1).fill(''))
      subHeaderRow.push(...d.subLabels)
      widths.push(...d.widths)
      col += d.subLabels.length
    }
  }
  return { descriptors, colStart, groupHeaderRow, subHeaderRow, widths, totalCols: col }
}

const ROLE_OPTIONS = [
  { key: 'ignore',     label: '— Ignore —' },
  { key: 'domain',     label: 'Domain' },
  ...NICHE_CATEGORIES.map(n => ({ key: n.key, label: n.label })),
  { key: 'additional', label: 'Additional (passthrough)' },
]

const STATUS_LABELS = { publish: 'Active', disable: 'Disabled', draft: 'Draft', trash: 'Removed' }
const CHEAPER_LABELS = { existing: 'Existing Vendor', added: 'Added Sheet Vendor', same: 'Same Price', na: 'N/A' }

function colIndexToLetter(idx) {
  let n = idx + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// Best-effort default role for a column the AI didn't already flag as the domain column —
// purely a starting point for the manual-assignment table, never authoritative.
function guessNicheKey(label) {
  const s = (label || '').toLowerCase()
  const hasLI = /link insertion|\bli\b/.test(s)
  if (/casino/.test(s)) return hasLI ? 'casino_li' : 'casino'
  if (/cbd/.test(s)) return hasLI ? 'cbd_li' : 'cbd'
  if (/crypto/.test(s)) return hasLI ? 'crypto_li' : 'crypto'
  return hasLI ? 'general_li' : 'general'
}

// ── Comparison logic ─────────────────────────────────────────────────────────
// existing vendor's admin price (GPL) vs. the raw admin price typed in the parsed sheet —
// not run through the internal price_table first, per explicit direction.
function compareNiche(sheetPrice, existingPrice, vendorCurrency) {
  if (vendorCurrency && vendorCurrency.toUpperCase() !== 'USD') return 'na' // cross-currency -> N/A for now
  if (sheetPrice == null || existingPrice == null) return 'na'             // can't compare with only one side
  const diff = sheetPrice - existingPrice
  if (Math.abs(diff) < 0.01) return 'same'
  return diff < 0 ? 'added' : 'existing' // lower price wins
}

// ── Column role table (manual assignment) ───────────────────────────────────

function ColumnRoleTable({ tab, onRoleChange }) {
  const headerCells = tab.rows[tab.headerRow] || []
  const maxCols = Math.max(headerCells.length, ...tab.rows.slice(0, 20).map(r => r.length), 1)

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)' }}>
            <th style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Col</th>
            <th style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Header Text</th>
            <th style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Role</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxCols }, (_, ci) => (
            <tr key={ci} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)' }}>{colIndexToLetter(ci)}</td>
              <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(headerCells[ci] ?? '')}>
                {String(headerCells[ci] ?? '') || <span style={{ color: 'var(--text-ghost)' }}>(empty)</span>}
              </td>
              <td style={{ padding: '5px 10px' }}>
                <select className="input" style={{ fontSize: 12, padding: '3px 8px', height: 28 }}
                        value={tab.roles[ci] || 'ignore'} onChange={e => onRoleChange(ci, e.target.value)}>
                  {ROLE_OPTIONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TabCard({ tab, onTabToggle, onRoleChange }) {
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
        {!tab.skip && !tab.roles.some(r => r === 'domain') && (
          <span style={{ fontSize: 11, color: '#fb7185' }}>⚠ no Domain column assigned</span>
        )}
      </div>
      {!tab.skip && (
        <div style={{ padding: '14px 16px' }}>
          <ColumnRoleTable tab={tab} onRoleChange={onRoleChange} />
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function UltimateSheetParser({ priceMap, me }) {
  const [activeTab, setActiveTab] = useState('parse') // 'parse' | 'history'
  const [step, setStep] = useState('idle')
  const [processingMsg, setProcessingMsg] = useState('')
  const [url, setUrl] = useState('')
  const [sheetId, setSheetId] = useState('')
  const [tabs, setTabs] = useState([])
  const [output, setOutput] = useState(null)
  const [errMsg, setErrMsg] = useState('')
  const [sheetName, setSheetName] = useState('')

  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('all')

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const memberId = historyFilter === 'all' ? null : (historyFilter === 'mine' ? me?.id : historyFilter)
      setHistory(await loadUltimateSheetParserHistory(memberId))
    } catch { /* silent */ }
    finally { setHistoryLoading(false) }
  }, [historyFilter, me?.id])

  useEffect(() => { if (activeTab === 'history') fetchHistory() }, [activeTab, fetchHistory])

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
            if (rows.length < 2) return { name, skip: true, reason: 'Not enough rows', rows: [], headerRow: 0, roles: [] }

            const det = await detectColumns(name, rows)
            const headerRow = Math.max(0, Math.min(det.headerRow ?? 0, rows.length - 1))
            const headerCells = (rows[headerRow] || []).map(c => String(c ?? '').trim())

            // Pre-fill roles from AI detection as a starting point — fully overridable below.
            const domainIdx = det.domainColumn ? headerCells.indexOf(det.domainColumn) : -1
            const priceIdxByLabel = new Map((det.priceColumns || []).map(p => [headerCells.indexOf(p.name), p.label]))
            const roles = headerCells.map((_, ci) => {
              if (ci === domainIdx) return 'domain'
              if (priceIdxByLabel.has(ci)) return guessNicheKey(priceIdxByLabel.get(ci))
              return 'ignore'
            })

            return { name, skip: false, rows, headerRow, roles, enabled: true }
          } catch (err) {
            return { name, skip: true, reason: err.message, rows: [], headerRow: 0, roles: [] }
          }
        })
      )

      setSheetId(id)
      setTabs(results)
      setStep('review')
    } catch (err) {
      setErrMsg(err.message)
      setStep('error')
    }
  }

  function updateTab(i, patch) {
    setTabs(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }
  function updateRole(ti, ci, role) {
    setTabs(prev => prev.map((t, i) => {
      if (i !== ti) return t
      const roles = [...t.roles]
      roles[ci] = role
      return { ...t, roles }
    }))
  }

  async function process() {
    setStep('processing')
    setErrMsg('')
    try {
      const enabledTabs = tabs.filter(t => t.enabled && !t.skip && t.roles.includes('domain'))
      if (!enabledTabs.length) throw new Error('No tabs with a Domain column assigned')

      // Union of niche categories actually used, in a stable fixed order (matches the union-of-
      // price-labels approach the existing Sheet Parser already uses for multi-tab merges).
      const activeNicheKeys = NICHE_CATEGORIES.map(n => n.key).filter(key =>
        enabledTabs.some(t => t.roles.includes(key))
      )

      // Additional (passthrough) columns are keyed by their header name (not position) so a
      // union across tabs with different layouts still lines each value up under the right
      // output column, and so row-building below never has to reverse-engineer index math.
      function additionalColName(tab, ci) {
        return String((tab.rows[tab.headerRow] || [])[ci] ?? `Col ${colIndexToLetter(ci)}`)
      }

      const additionalNames = []
      for (const tab of enabledTabs) {
        tab.roles.forEach((r, ci) => {
          if (r !== 'additional') return
          const name = additionalColName(tab, ci)
          if (!additionalNames.includes(name)) additionalNames.push(name)
        })
      }

      const parsedRows = []
      for (const tab of enabledTabs) {
        const rows = await getSheetRows(sheetId, tab.name)
        const domainIdx = tab.roles.indexOf('domain')
        const nicheIdx = {}
        activeNicheKeys.forEach(key => { const idx = tab.roles.indexOf(key); if (idx !== -1) nicheIdx[key] = idx })
        const additionalIdxByName = new Map(
          tab.roles.map((r, ci) => [r, ci]).filter(([r]) => r === 'additional').map(([, ci]) => [additionalColName(tab, ci), ci])
        )

        for (let i = tab.headerRow + 1; i < rows.length; i++) {
          const row = rows[i] || []
          const domain = cleanDomain(row[domainIdx] ?? '')
          if (!domain || !domain.includes('.')) continue

          const sheetPrices = {}
          for (const key of activeNicheKeys) {
            const idx = nicheIdx[key]
            sheetPrices[key] = idx == null ? null : parsePrice(row[idx] ?? '')
          }
          const additionalByName = {}
          for (const name of additionalNames) {
            const idx = additionalIdxByName.get(name)
            additionalByName[name] = idx == null ? '' : (row[idx] ?? '')
          }
          parsedRows.push({ tabName: tab.name, domain, sheetPrices, additionalByName })
        }
      }
      if (!parsedRows.length) throw new Error('No valid website rows found in the selected tabs')

      const uniqueDomains = [...new Set(parsedRows.map(r => r.domain))]
      setProcessingMsg(`Looking up ${uniqueDomains.length} sites in GPL…`)
      const gplMap = await lookupPublisherDataFull(uniqueDomains, (cur, total) => {
        setProcessingMsg(`GPL lookup — batch ${cur} of ${total}…`)
      })

      setProcessingMsg('Comparing prices and building the sheet…')

      const plan = buildColumnPlan(activeNicheKeys, additionalNames)
      const { colStart } = plan

      const outputRows = []
      const disabledRowIndexes = [] // 0-indexed into outputRows, for status highlight
      const nicheCellFormats = [] // { rowIdx, colIdx, kind: 'wins'|'tie' }
      const cheaperCellFormats = [] // { rowIdx, colIdx, outcome }

      parsedRows.forEach((pr, rowIdx) => {
        const info = gplMap.get(pr.domain)
        const vendor = info?.vendor || null

        const row = new Array(plan.totalCols).fill('')
        row[colStart.tabName] = pr.tabName
        row[colStart.website] = pr.domain
        row[colStart.status] = info ? (STATUS_LABELS[info.status] || info.status) : 'Not in GPL'
        row[colStart.disableReason] = info?.disableReason || ''
        row[colStart.metrics + 0] = info?.da ?? ''
        row[colStart.metrics + 1] = info?.pa ?? ''
        row[colStart.metrics + 2] = info?.ascore ?? ''
        row[colStart.vendor + 0] = vendor?.name || ''
        row[colStart.vendor + 1] = vendor?.vendorType || ''
        row[colStart.vendor + 2] = vendor?.currency || ''
        for (const name of additionalNames) row[colStart[`additional:${name}`]] = pr.additionalByName[name] ?? ''

        activeNicheKeys.forEach(key => {
          const base = colStart[key]
          const sheetPrice = pr.sheetPrices[key]
          const gplLabel = NICHE_BY_KEY[key].gplLabel
          const existingAddon = vendor?.addonsByLabel.get(gplLabel) || null
          const existingPrice = existingAddon?.adminPrice ?? null
          const outcome = compareNiche(sheetPrice, existingPrice, vendor?.currency)
          const buyerPrice = sheetPrice != null ? (priceMap.get(Math.round(sheetPrice))?.buyer ?? null) : null

          if (outcome === 'added') nicheCellFormats.push({ rowIdx, colIdx: base, kind: 'wins' })
          if (outcome === 'existing') nicheCellFormats.push({ rowIdx, colIdx: base + 2, kind: 'wins' })
          if (outcome === 'same') { nicheCellFormats.push({ rowIdx, colIdx: base, kind: 'tie' }); nicheCellFormats.push({ rowIdx, colIdx: base + 2, kind: 'tie' }) }
          cheaperCellFormats.push({ rowIdx, colIdx: base + 3, outcome })

          row[base + 0] = sheetPrice ?? ''
          row[base + 1] = buyerPrice ?? ''
          row[base + 2] = existingPrice ?? ''
          row[base + 3] = CHEAPER_LABELS[outcome]
        })

        if (info?.status === 'disable') disabledRowIndexes.push(rowIdx)
        outputRows.push(row)
      })

      // Header rows occupy grid rows 0-1, so every data-row format request offsets by 2.
      const HEADER_ROWS = 2
      const buildFormatRequests = (sid) => {
        const cellBg = (rowIdx, colIdx, bg) => ({
          repeatCell: {
            range: { sheetId: sid, startRowIndex: rowIdx + HEADER_ROWS, endRowIndex: rowIdx + HEADER_ROWS + 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
            cell: { userEnteredFormat: { backgroundColor: bg } },
            fields: 'userEnteredFormat.backgroundColor',
          },
        })
        const rangeBg = (r0, r1, c0, c1, bg) => ({
          repeatCell: {
            range: { sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
            cell: { userEnteredFormat: { backgroundColor: bg } },
            fields: 'userEnteredFormat.backgroundColor',
          },
        })
        const merge = (r0, r1, c0, c1) => ({ mergeCells: { range: { sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, mergeType: 'MERGE_ALL' } })
        const colWidth = (ci, px) => ({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: ci, endIndex: ci + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })
        const align = (c0, c1, horizontalAlignment) => ({
          repeatCell: {
            range: { sheetId: sid, startColumnIndex: c0, endColumnIndex: c1 },
            cell: { userEnteredFormat: { horizontalAlignment } },
            fields: 'userEnteredFormat.horizontalAlignment',
          },
        })

        const totalRows = HEADER_ROWS + outputRows.length
        const reqs = []

        // Base sheet-wide look: dark header, frozen header + Website, centered numeric-leaning
        // body, comfortable row height, wrapped/vertically-centered header text so long compound
        // headers (e.g. "Casino / LI") never get visually clipped.
        reqs.push(rangeBg(0, totalRows, 0, plan.totalCols, WHITE))
        reqs.push({
          repeatCell: {
            range: { sheetId: sid },
            cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', textFormat: { fontSize: 10 } } },
            fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment,userEnteredFormat.textFormat.fontSize',
          },
        })
        reqs.push({
          repeatCell: {
            range: { sheetId: sid, startRowIndex: 0, endRowIndex: HEADER_ROWS },
            cell: { userEnteredFormat: {
              backgroundColor: HEADER_DARK,
              textFormat: { bold: true, foregroundColor: WHITE, fontSize: 10 },
              wrapStrategy: 'WRAP',
              verticalAlignment: 'MIDDLE',
            } },
            fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)',
          },
        })
        reqs.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 0, endIndex: HEADER_ROWS }, properties: { pixelSize: 34 }, fields: 'pixelSize' } })
        reqs.push({
          updateSheetProperties: {
            properties: { sheetId: sid, gridProperties: { frozenRowCount: HEADER_ROWS, frozenColumnCount: 2 } },
            fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
          },
        })

        // Per-column widths, merges, and (for niche groups) a colored group header + a very
        // light tint carried down through the data rows so each niche's 4 columns stay visually
        // grouped without competing with the stronger comparison-outcome colors layered on top.
        for (const d of plan.descriptors) {
          const start = colStart[d.key]
          if (d.type === 'simple') {
            reqs.push(merge(0, HEADER_ROWS, start, start + 1))
            reqs.push(colWidth(start, d.width))
            if (d.align) reqs.push(align(start, start + 1, d.align))
            if (d.wrap) reqs.push({ repeatCell: { range: { sheetId: sid, startColumnIndex: start, endColumnIndex: start + 1 }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy' } })
          } else {
            const span = d.subLabels.length
            reqs.push(merge(0, 1, start, start + span))
            const fam = FAMILY[d.family] || FAMILY.neutral
            reqs.push({
              repeatCell: {
                range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: start, endColumnIndex: start + span },
                cell: { userEnteredFormat: { backgroundColor: fam.header, textFormat: { bold: true, foregroundColor: WHITE, fontSize: 10 } } },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            })
            if (fam !== FAMILY.neutral) reqs.push(rangeBg(HEADER_ROWS, totalRows, start, start + span, fam.tint))
            d.widths.forEach((w, i) => reqs.push(colWidth(start + i, w)))
          }
        }

        // Comparison-outcome highlights — applied after the base/group tints above so they win.
        for (const f of nicheCellFormats) reqs.push(cellBg(f.rowIdx, f.colIdx, f.kind === 'tie' ? TIE_BG : WINS_BG))
        for (const f of cheaperCellFormats) reqs.push(cellBg(f.rowIdx, f.colIdx, CHEAPER_BG[f.outcome]))
        for (const rowIdx of disabledRowIndexes) reqs.push(cellBg(rowIdx, colStart.status, DISABLED_BG))

        return reqs
      }

      const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const title = sheetName.trim() || `Ultimate Parsed Sites — ${date}`
      setProcessingMsg('Writing to Google Sheets…')
      const sheetUrl = await createUltimateOutputSheet(title, [plan.groupHeaderRow, plan.subHeaderRow, ...outputRows], buildFormatRequests)

      const outputData = {
        sheetUrl, totalSites: outputRows.length, tabsProcessed: enabledTabs.length,
        nicheCount: activeNicheKeys.length, title,
      }
      setOutput(outputData)
      setStep('done')

      if (me?.id) {
        saveUltimateSheetParserHistory({
          memberId: me.id, sourceUrl: url, outputUrl: sheetUrl, outputTitle: outputData.title,
          tabsProcessed: outputData.tabsProcessed, totalSites: outputData.totalSites, nicheCount: outputData.nicheCount,
        }).catch(() => {})
      }
    } catch (err) {
      setErrMsg(err.message)
      setStep('error')
    }
  }

  const activeTabCount = tabs.filter(t => t.enabled && !t.skip && t.roles.includes('domain')).length
  const members = TEAM

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
          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 1fr 1fr 70px 55px', gap: '0 12px', padding: '6px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>
            <div>Date</div><div>By</div><div>Source Sheet</div><div>Output Sheet</div><div style={{ textAlign: 'center' }}>Sites</div><div style={{ textAlign: 'center' }}>Tabs</div>
          </div>
          {history.map(h => {
            const member = TEAM.find(m => m.id === h.member_id)
            const ts = new Date(h.created_at)
            const dateStr = ts.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            const timeStr = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            const shortUrl = u => { try { const m = u.match(/\/spreadsheets\/d\/([^/]+)/); return m ? `…${m[1].slice(0, 12)}…` : u.slice(0, 30) } catch { return u } }
            return (
              <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '120px 80px 1fr 1fr 70px 55px', gap: '0 12px', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', alignItems: 'center', fontSize: 13 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{dateStr}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{timeStr}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className={`avatar sm ${member?.color}`}>{member?.short}</div>
                  <span style={{ fontSize: 12 }}>{member?.name.split(' ')[0] || h.member_id}</span>
                </div>
                <div>
                  <a href={h.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }} title={h.source_url}>
                    <Icon name="link" size={10} />{shortUrl(h.source_url)}
                  </a>
                </div>
                <div>
                  <a href={h.output_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 12, fontFamily: 'var(--font-mono)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }} title={h.output_title}>
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
        Paste a Google Sheet URL — AI pre-detects columns, then you confirm or manually reassign any column
        by letter. Each domain is compared against its existing GPL vendor's admin price niche by niche.
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
        <button className="btn primary" onClick={analyze} disabled={!url.trim() || step === 'analyzing'} style={{ flexShrink: 0 }}>
          {step === 'analyzing' ? 'Analyzing…' : <><Icon name="zap" size={12} /> Analyze</>}
        </button>
      </div>
      {step === 'analyzing' && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>Reading all tabs and running AI column detection…</div>
      )}
    </div>
  )

  if (step === 'review') return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-dim)', flexShrink: 0 }}>
          AI found <strong style={{ color: 'var(--text)' }}>{tabs.length}</strong> tab{tabs.length !== 1 ? 's' : ''}. Review/reassign columns by letter, then confirm.
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="btn ghost" onClick={() => setStep('idle')}>← Back</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          className="input"
          placeholder={`Ultimate Parsed Sites — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
          value={sheetName}
          onChange={e => setSheetName(e.target.value)}
          style={{ flex: 1, fontSize: 13 }}
        />
        <button className="btn primary" onClick={process} disabled={activeTabCount === 0} style={{ flexShrink: 0 }}>
          <Icon name="upload" size={12} /> Confirm & Create Sheet
          {activeTabCount > 0 && <span style={{ opacity: 0.7, fontSize: 11, marginLeft: 4 }}>({activeTabCount} tab{activeTabCount !== 1 ? 's' : ''})</span>}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tabs.map((tab, ti) => (
          <TabCard key={tab.name} tab={tab}
            onTabToggle={v => updateTab(ti, { enabled: v })}
            onRoleChange={(ci, role) => updateRole(ti, ci, role)}
          />
        ))}
      </div>
    </div>
  )

  if (step === 'processing') return (
    <div style={{ maxWidth: 480, textAlign: 'center', padding: '32px 0' }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>⚙️</div>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Building your Ultimate sheet…</div>
      <div style={{ fontSize: 13, color: 'var(--text-faint)', minHeight: 20 }}>{processingMsg}</div>
    </div>
  )

  if (step === 'done' && output) return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ padding: 24, borderRadius: 12, marginBottom: 20, background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>✓ Sheet created</div>
        <div style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 10, fontStyle: 'italic' }}>{output.title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-dim)' }}>
          <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{output.totalSites}</strong> websites processed</span>
          <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{output.tabsProcessed}</strong> tab{output.tabsProcessed !== 1 ? 's' : ''} merged</span>
          <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{output.nicheCount}</strong> niche{output.nicheCount !== 1 ? 's' : ''} compared against GPL</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <a href={output.sheetUrl} target="_blank" rel="noreferrer" className="btn primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="link" size={12} /> Open Sheet
        </a>
        <button className="btn ghost" onClick={() => { setStep('idle'); setUrl(''); setTabs([]); setOutput(null); setSheetName('') }}>Parse Another</button>
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
      <button className="btn ghost" onClick={() => setStep(tabs.length ? 'review' : 'idle')}>← Try again</button>
    </div>
  )

  return null
}

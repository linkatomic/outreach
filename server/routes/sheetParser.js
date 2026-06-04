import { Router } from 'express'
import { extractSheetId, getSheetTabs, getSheetRows, createOutputSheet } from '../lib/google.js'
import { detectColumns } from '../lib/openai.js'
import { getPriceMap, parsePrice, cleanDomain } from '../lib/priceMap.js'

export const sheetParserRouter = Router()

// ── Step 1: Analyze ───────────────────────────────────────
// Fetch sheet metadata + run AI column detection on each tab
sheetParserRouter.post('/analyze', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) return res.status(400).json({ error: 'url is required' })

    const spreadsheetId = extractSheetId(url)
    if (!spreadsheetId) return res.status(400).json({ error: 'Could not extract spreadsheet ID from URL' })

    const tabs = await getSheetTabs(spreadsheetId)
    if (!tabs.length) return res.status(400).json({ error: 'No sheets found in the spreadsheet' })

    const results = await Promise.all(
      tabs.map(async ({ name }) => {
        try {
          const rows = await getSheetRows(spreadsheetId, name, 20)
          if (rows.length < 2) {
            return { name, skip: true, reason: 'Not enough rows', rows: [], allColumns: [], headerRow: 0, domainColumn: null, domainConfidence: 'low', priceColumns: [] }
          }

          const detection = await detectColumns(name, rows)
          const headerRow = Math.max(0, Math.min(detection.headerRow ?? 0, rows.length - 1))
          const allColumns = (rows[headerRow] || []).map(c => String(c ?? '').trim()).filter(Boolean)

          return {
            name,
            skip: false,
            rows: rows.slice(0, 20),
            allColumns,
            headerRow,
            domainColumn: detection.domainColumn ?? null,
            domainConfidence: detection.domainConfidence ?? 'low',
            priceColumns: (detection.priceColumns || []).map(p => ({
              name: p.name,
              label: p.label,
              confidence: p.confidence ?? 'medium',
              enabled: true,
            })),
          }
        } catch (err) {
          return { name, skip: true, reason: err.message, rows: [], allColumns: [], headerRow: 0, domainColumn: null, domainConfidence: 'low', priceColumns: [] }
        }
      })
    )

    res.json({ spreadsheetId, tabs: results })
  } catch (err) {
    console.error('analyze error:', err)
    res.status(500).json({ error: err.message || 'Analysis failed' })
  }
})

// ── Step 2: Process ───────────────────────────────────────
// Read all rows, clean data, write to new Google Sheet
sheetParserRouter.post('/process', async (req, res) => {
  try {
    const { spreadsheetId, tabs } = req.body
    if (!spreadsheetId || !tabs?.length) {
      return res.status(400).json({ error: 'spreadsheetId and tabs are required' })
    }

    const priceMap = await getPriceMap()

    // Collect all unique price column labels across all enabled tabs
    const enabledTabs = tabs.filter(t => t.enabled && !t.skip && t.domainColumn)
    if (!enabledTabs.length) {
      return res.status(400).json({ error: 'No enabled tabs with a domain column selected' })
    }

    const allPriceLabels = []
    for (const tab of enabledTabs) {
      for (const pc of (tab.priceColumns || []).filter(p => p.enabled)) {
        if (!allPriceLabels.includes(pc.label)) allPriceLabels.push(pc.label)
      }
    }

    // Build header: Tab Name | Website | [PriceLabel | Buyer] ...
    const headers = ['Tab Name', 'Website', ...allPriceLabels.flatMap(l => [l, 'Buyer'])]

    const outputRows = []
    let totalSites = 0

    for (const tab of enabledTabs) {
      const rows = await getSheetRows(spreadsheetId, tab.name)
      const headerRow = Math.max(0, Math.min(tab.headerRow ?? 0, rows.length - 1))
      const headerCells = (rows[headerRow] || []).map(c => String(c ?? '').trim())

      // Map column names → indices
      const domainIdx = headerCells.indexOf(tab.domainColumn)
      if (domainIdx === -1) continue

      const enabledPrices = (tab.priceColumns || []).filter(p => p.enabled)
      const priceIndices = enabledPrices.map(p => ({
        label: p.label,
        idx: headerCells.indexOf(p.name),
      }))

      // Process data rows (skip header and above)
      for (let i = headerRow + 1; i < rows.length; i++) {
        const row = rows[i] || []
        const rawDomain = row[domainIdx] ?? ''
        const domain = cleanDomain(rawDomain)
        if (!domain || !domain.includes('.')) continue // skip empty / non-domain rows

        const priceValues = {}
        for (const { label, idx } of priceIndices) {
          if (idx === -1) continue
          const raw = row[idx] ?? ''
          const price = parsePrice(raw)
          priceValues[label] = price
        }

        // Build output row
        const outRow = [
          tab.name,
          domain,
          ...allPriceLabels.flatMap(label => {
            const price = priceValues[label] ?? null
            if (price == null) return ['', '']
            const buyer = priceMap.get(Math.round(price)) ?? ''
            return [price, buyer]
          }),
        ]
        outputRows.push(outRow)
        totalSites++
      }
    }

    if (!outputRows.length) {
      return res.status(400).json({ error: 'No valid website rows found in the selected tabs' })
    }

    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const sheetUrl = await createOutputSheet(`Processed Sites — ${date}`, headers, outputRows)

    res.json({
      sheetUrl,
      totalSites,
      tabsProcessed: enabledTabs.length,
      priceColumns: allPriceLabels.length,
    })
  } catch (err) {
    console.error('process error:', err)
    res.status(500).json({ error: err.message || 'Processing failed' })
  }
})

// Internal tool credentials — keep this repo private.
// All Google operations use a single account (the owner's refresh token).
// No sign-in required from other users.

const GOOGLE_CLIENT_ID     = import.meta.env.VITE_GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET
const GOOGLE_REFRESH_TOKEN = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN
const OPENAI_API_KEY       = import.meta.env.VITE_OPENAI_API_KEY
const GPL_API_TOKEN        = import.meta.env.VITE_GPL_API_TOKEN

// ── Google OAuth — refresh token flow ────────────────────
// Exchange the refresh token for a short-lived access token.
// Cached per session; auto-refreshes when near expiry.

let _accessToken = null
let _tokenExpiry = 0
let _scopesVerified = false

async function getToken() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      `Missing credentials — check Vercel env vars:\n` +
      `VITE_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID ? 'OK' : 'MISSING'}\n` +
      `VITE_GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET ? 'OK' : 'MISSING'}\n` +
      `VITE_GOOGLE_REFRESH_TOKEN: ${GOOGLE_REFRESH_TOKEN ? 'OK' : 'MISSING'}`
    )
  }

  if (_accessToken && Date.now() < _tokenExpiry - 60_000) return _accessToken

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(
      data.error_description
        ? `Google auth failed: ${data.error_description}`
        : `Google auth failed (${data.error || res.status}). The credentials may need to be refreshed — contact the tool owner.`
    )
  }
  _accessToken = data.access_token
  _tokenExpiry = Date.now() + data.expires_in * 1000
  return _accessToken
}

// ── Google Sheets API ─────────────────────────────────────

async function gsheets(path, opts = {}) {
  const token = await getToken()

  // Check token scopes before first Sheets call
  if (!_scopesVerified) {
    const info = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`)
    const infoData = await info.json()
    const scopes = infoData.scope || ''
    if (!scopes.includes('spreadsheets') && !scopes.includes('drive')) {
      throw new Error(
        `Refresh token is missing Sheets/Drive scope.\n` +
        `Current scopes: ${scopes || '(none)'}\n\n` +
        `Regenerate the refresh token and include these scopes:\n` +
        `https://www.googleapis.com/auth/spreadsheets\n` +
        `https://www.googleapis.com/auth/drive`
      )
    }
    _scopesVerified = true
  }

  const res = await fetch(`https://sheets.googleapis.com/v4${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    const msg = data.error?.message || JSON.stringify(data.error)
    throw new Error(`[HTTP ${res.status}] ${msg}\nPath: ${path}`)
  }
  return data
}

export function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return m ? m[1] : null
}

export async function getSheetTabs(spreadsheetId) {
  const data = await gsheets(`/spreadsheets/${spreadsheetId}?fields=sheets.properties`)
  return data.sheets.map(s => ({ name: s.properties.title, sheetId: s.properties.sheetId }))
}

export async function getSheetRows(spreadsheetId, tabName, maxRows = null) {
  const range = maxRows ? `'${tabName}'!A1:ZZ${maxRows}` : `'${tabName}'!A:ZZ`
  const data = await gsheets(
    `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`
  )
  return data.values || []
}

// ── OpenAI column detection ───────────────────────────────

export async function detectColumns(tabName, rows) {
  const preview = rows.slice(0, 20).map(r => r.map(c => String(c ?? '').trim()))

  const prompt = `You are analyzing a spreadsheet tab containing a website/guest post inventory list.

Tab name: "${tabName}"
First ${preview.length} rows (each row is an array of cell values):
${JSON.stringify(preview, null, 2)}

TASK: Identify the header row, domain column, and ALL price columns.

──────────────────────────────────────
HEADER ROW DETECTION:
- The header row contains SHORT label strings (column names), not actual data values
- It is often row 0, but not always
- If row 0 looks like a sheet title (e.g. "Vendor List — Q1 2025", "SITES FOR OUTREACH", a long sentence), skip it — the real header is the next non-empty row
- If the first few rows are blank, scan forward to find the first row with multiple short label-like strings
- Confidence check: the row immediately below the header should contain domain-like strings in the domain column and numeric/price strings in price columns
──────────────────────────────────────

DOMAIN COLUMN:
- Contains website domain names
- Common labels: "Site Name", "Website", "Domain", "URL", "Guest Post Sites List"
- Cell values look like: "example.com", "https://example.com", "example.com New"

──────────────────────────────────────
PRICE COLUMNS — INCLUSION PRINCIPLE:
A price column contains what a buyer would pay. Ask: "Would a buyer write this number on an invoice?"
- "$45" on an invoice → YES, include it
- "DA=45" on an invoice → NO, exclude it

DEFINITELY price columns (be generous — when in doubt, include it):
- Labels: "General", "Price", "Normal", "Others", "Link Insertion", "Guest Post", "Gen Post", "Casino", "CBD", "Crypto", "Forex", "Adult", "Finance", "Gray Niche", "GP", "LI"
- Labels combining niches: "Casino, CBD, Crypto / Link", "Gen Post / Link Insertion"
- Values look like: "$10", "10$", "$20.00", "15", "100", "N/A", "-", "Confirm First"
- Any column where values are mostly numbers or dollar amounts is almost certainly a price column

EXCLUSION PRINCIPLE:
Exclude any column that measures a website's quality/authority rather than what a buyer pays.
Also exclude if values are consistently 2-3 digit integers with no $ sign AND the header contains:
Score, Authority, Rank, Rating, Index, Traffic, Visits, Sessions, Spam.

Specific exclusions:
- DA, DR, PA, MOZ rank, Ahrefs rank — authority metrics (0–100 range, never on an invoice)
- Traffic, Organic Traffic, Monthly Visitors — visitor counts
- TAT, "Turn Around Time" — delivery time
- TLD, "Link Type", "Google News", "Indexed", "Spam Score"
- SL, Serial, No., # — row numbers
- "Existing/New", "Status", "Notes", "Remarks"
──────────────────────────────────────

CANONICAL LABEL RULES — follow these EXACTLY:
- "General" / "Price" / "Normal" / "GP" alone → "General Price"
- "Link Insertion" / "LI" alone → "LI Price"
- "General Post" + "Link Insertion" combined → "General/LI Price"
- "Other" + "Link Insertion" combined → "Other/LI Price"
- Any [Type] + "Link Insertion" combined → "[Type Abbr]/LI Price"
- "Casino" alone → "Casino Price"
- "CBD" alone → "CBD Price"
- "Crypto" alone → "Crypto Price"
- "Forex" / "Finance" → "Forex Price"
- "Gray Niche" → "Gray Niche Price"
- Combined niches without LI → space-separated: "Casino CBD Crypto Price"
- NEVER collapse a combined-type column into a simpler single type

WORKED EXAMPLES — follow these exactly:
"Casino, CBD, Crypto / Link Insertion" → "Casino CBD Crypto/LI Price"
"Gen Post / LI"                        → "General/LI Price"
"Other Post / Link Insertion"          → "Other/LI Price"
"Finance/Forex"                        → "Forex Price"
"Casino, CBD"                          → "Casino CBD Price"
"General"                              → "General Price"
"Price"                                → "General Price"
"LI"                                   → "LI Price"

Return ONLY valid JSON, no explanation:
{
  "headerRow": <0-indexed row number of column headers>,
  "domainColumn": "<exact header string, or null>",
  "domainConfidence": "high" | "medium" | "low",
  "priceColumns": [
    { "name": "<exact header string from the sheet>", "label": "<canonical label>", "confidence": "high" | "medium" | "low" }
  ]
}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-nano',
      messages: [
        { role: 'system', content: 'You are a data analyst. Respond only with valid JSON, no markdown, no explanation.' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0,
      max_completion_tokens: 800,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(`OpenAI: ${data.error?.message || res.status}`)
  const text = data.choices[0].message.content.trim()
  return JSON.parse(text)
}

// ── Post-AI validation ────────────────────────────────────
// Catches cases where GPT returns structurally valid JSON but the
// detected columns don't actually match the data in the rows.

export function validateColumnDetectionResult(result, rawRows) {
  const issues = []
  const headerIdx = result.headerRow ?? 0
  const headerCells = (rawRows[headerIdx] || []).map(c => String(c ?? '').trim())

  if (result.domainColumn) {
    const colIdx = headerCells.indexOf(result.domainColumn)
    if (colIdx === -1) {
      issues.push(`Domain column "${result.domainColumn}" not found in header row`)
    } else {
      const sampleValues = rawRows.slice(headerIdx + 1, headerIdx + 6)
        .map(r => String((r || [])[colIdx] ?? '').trim()).filter(Boolean)
      const domainLike = sampleValues.filter(v => /\.[a-z]{2,}/i.test(v))
      if (sampleValues.length > 0 && domainLike.length < sampleValues.length * 0.5) {
        issues.push(`Domain column "${result.domainColumn}" doesn't look like domains (sample: ${sampleValues.slice(0,3).join(', ')})`)
      }
    }
  }

  for (const pc of (result.priceColumns || [])) {
    const colIdx = headerCells.indexOf(pc.name)
    if (colIdx === -1) {
      issues.push(`Price column "${pc.name}" not found in header row`)
      continue
    }
    const sampleValues = rawRows.slice(headerIdx + 1, headerIdx + 6)
      .map(r => String((r || [])[colIdx] ?? '').trim()).filter(Boolean)
    const numericLike = sampleValues.filter(v => /[\d$]/.test(v))
    if (sampleValues.length > 0 && numericLike.length === 0) {
      issues.push(`Price column "${pc.name}" has no numeric values — may be misclassified (sample: ${sampleValues.slice(0,3).join(', ')})`)
    }
  }

  return issues
}

// ── Cross-tab label normalization ─────────────────────────
// labelInfos: Array<{ label, tab, valueSamples, domainSamples }>

export async function normalizeColumnLabels(labelInfos) {
  const uniqueLabels = [...new Set(labelInfos.map(li => li.label))]
  if (uniqueLabels.length <= 1) return Object.fromEntries(uniqueLabels.map(l => [l, l]))

  const labelLines = labelInfos.map((li, i) => {
    const vals    = li.valueSamples?.length  ? ` — values: ${li.valueSamples.slice(0, 4).join(', ')}` : ''
    const domains = li.domainSamples?.length ? ` — domains: ${li.domainSamples.slice(0, 2).join(', ')}` : ''
    return `${i + 1}. "${li.label}" [Tab: ${li.tab}]${vals}${domains}`
  }).join('\n')

  const prompt = `You are normalizing price column names from multiple spreadsheet tabs into consistent canonical names so identical concepts share one output column.

Labels with their source tab and sample values:
${labelLines}

TASK: Map every label to its canonical name. Labels representing the same price type MUST share the same canonical name even if from different tabs.

DEDUPLICATION RULE: If the same canonical name appears in multiple tabs, it maps to ONE output column.
Do NOT produce "General Price (Tab 1)" and "General Price (Tab 2)" — just "General Price".

CONTEXT RULE: Use value samples and domain samples to distinguish ambiguous same-named columns.
For example, a "Price" column in a Casino-specific tab (domains like casino-site.com) likely means Casino Price, not General Price.

CANONICAL NAME RULES:
- "General", "Price", "Normal", "Others", "GP", "General Post", "Gen Post", "Guest Post" alone → "General Price"
- "Link Insertion", "LI" alone → "LI Price"
- "General Post / Link Insertion", "General / Link Insertion", "Gen Post / LI" → "General/LI Price"
- "Other Post / Link Insertion", "Other / LI" → "Other/LI Price"
- Any [Type] + Link Insertion combined → "[TypeAbbr]/LI Price" — PRESERVE both type names
- "Casino" only → "Casino Price"
- "CBD" only → "CBD Price"
- "Crypto" only → "Crypto Price"
- "Forex", "Finance" only → "Forex Price"
- "Gray Niche" → "Gray Niche Price"
- Combined niches without LI → space-separated: "Casino CBD Crypto Price"
- CRITICAL: DO NOT merge combined-type labels into a simpler single-type label

WORKED EXAMPLES — follow these exactly:
"Casino, CBD, Crypto / Link Insertion" → "Casino CBD Crypto/LI Price"
"Gen Post / LI"                        → "General/LI Price"
"Other Post / Link Insertion"          → "Other/LI Price"
"Finance/Forex"                        → "Forex Price"
"Casino, CBD"                          → "Casino CBD Price"
"General"                              → "General Price"

Return ONLY valid JSON:
{ "mapping": { "<original label>": "<canonical name>", ... } }`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-nano',
      messages: [
        { role: 'system', content: 'You are a data analyst. Respond only with valid JSON, no markdown, no explanation.' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0,
      max_completion_tokens: 600,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(`OpenAI: ${data.error?.message || res.status}`)
  const text = data.choices[0].message.content.trim()
  const result = JSON.parse(text)
  return result.mapping || {}
}

// ── GPL publisher data lookup ─────────────────────────────

export async function lookupPublisherData(domains, onProgress) {
  const result = new Map()
  if (!GPL_API_TOKEN || !domains.length) return result

  const BATCH = 100
  const CONCURRENCY = 5
  const batches = []
  for (let i = 0; i < domains.length; i += BATCH) batches.push(domains.slice(i, i + BATCH))

  let done = 0
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY)
    await Promise.allSettled(chunk.map(async batch => {
      try {
        const res = await fetch('https://api.records.guestpostlinks.net/v2/publisher/website/gpl/search-publishers', {
          method: 'POST',
          headers: { 'Authorization': GPL_API_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ websites: batch }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (data.success && data.data?.websites) {
          for (const site of data.data.websites) {
            const vendor = site.vendors?.find(v => v.is_primary) || site.vendors?.[0] || null
            const primaryEmail = vendor?.email?.find(e => e.isPrimary)?.address
                              || vendor?.email?.[0]?.address || ''
            result.set(site.website, {
              status: site.status,
              disableReason: site.disable_reason || '',
              vendorName: vendor?.name || '',
              vendorType: vendor?.vendorType || '',
              email: primaryEmail,
              currency: vendor?.actualCurrency?.cc || '',
              addons: (vendor?.addons || []).map(a => ({
                label: a.label,
                name: a.name,
                actualPrice: a.actualPrice ?? '',
              })),
            })
          }
        }
      } catch { /* skip failed batches */ }
      done++
      onProgress?.(done, batches.length)
    }))
  }

  return result
}

// ── Google Drive API ─────────────────────────────────────

async function gdrive(path, opts = {}) {
  const token = await getToken()
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (res.status === 204) return {}
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error?.message || JSON.stringify(data.error))
  return data
}

// ── Output sheet creation ─────────────────────────────────

export async function createOutputSheet(title, headers, rows, numPriceCols) {
  const created = await gsheets('/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Websites' } }],
    }),
  })
  const newId   = created.spreadsheetId
  const sheetId = created.sheets[0].properties.sheetId

  await gsheets(`/spreadsheets/${newId}/values/Websites!A1?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [headers, ...rows] }),
  })

  // Buyer columns at indices 3, 5, 7, … (3 + 2*i) — green highlight
  const buyerColRequests = Array.from({ length: numPriceCols }, (_, i) => ({
    repeatCell: {
      range: { sheetId, startColumnIndex: 3 + i * 2, endColumnIndex: 4 + i * 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.851, green: 0.918, blue: 0.827 } } },
      fields: 'userEnteredFormat.backgroundColor',
    },
  }))

  // Status col = 2 + 2*n; Disable Reason = 3 + 2*n (always left-align Website=1 and Disable Reason)
  const disableReasonColIdx = 3 + 2 * numPriceCols

  await gsheets(`/spreadsheets/${newId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        // Bold header row
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        // Freeze header row
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        // Center-align entire sheet
        {
          repeatCell: {
            range: { sheetId },
            cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
            fields: 'userEnteredFormat.horizontalAlignment',
          },
        },
        // Left-align Website column (index 1)
        {
          repeatCell: {
            range: { sheetId, startColumnIndex: 1, endColumnIndex: 2 },
            cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
            fields: 'userEnteredFormat.horizontalAlignment',
          },
        },
        // Left-align Disable Reason column
        {
          repeatCell: {
            range: { sheetId, startColumnIndex: disableReasonColIdx, endColumnIndex: disableReasonColIdx + 1 },
            cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
            fields: 'userEnteredFormat.horizontalAlignment',
          },
        },
        ...buyerColRequests,
      ],
    }),
  })

  // Share with anyone as editor
  await gdrive(`/files/${newId}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ role: 'writer', type: 'anyone' }),
  })

  return `https://docs.google.com/spreadsheets/d/${newId}/edit`
}

// ── Data helpers ──────────────────────────────────────────

export function cleanDomain(raw) {
  if (!raw) return ''
  let s = String(raw).trim()
  s = s.replace(/^https?:\/\//i, '')
  s = s.replace(/^www\./i, '')
  s = s.split('/')[0]
  s = s.split(/\s/)[0]
  s = s.replace(/[*()\[\]]+/g, '')
  s = s.replace(/[.,;:]+$/, '').trim()
  return s.toLowerCase()
}

export function parsePrice(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!s || s === '-' || s.toLowerCase() === 'n/a') return null
  const num = parseFloat(s.replace(/[^0-9.]/g, ''))
  return isNaN(num) ? null : num
}

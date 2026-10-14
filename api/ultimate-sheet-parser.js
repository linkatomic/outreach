// POST /api/ultimate-sheet-parser
// Body: { action, payload }
// AI-assisted column detection for the Ultimate Sheet Parser tool. Previously OpenAI (removed
// per request), now backed by GLM instead — same prompt, same output shape, just a different
// model behind it. Runs server-side (unlike this tool's Google Sheets reads, which already use
// a shared, Vite-exposed owner credential client-side) so GLM_API_KEY never has to become a
// second secret baked into the browser bundle.

import { requireToolAccess } from './_lib/supabaseAdmin.js'
import { glmComplete } from './_lib/glm.js'

const TOOL_ID = 'ultimate-sheet-parser'

function buildPrompt(tabName, rows) {
  const preview = rows.slice(0, 20).map(r => r.map(c => String(c ?? '').trim()))

  return `You are analyzing a spreadsheet tab containing a website/guest post inventory list.

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
}

// GLM isn't guaranteed to skip markdown fences around JSON the way the prior OpenAI prompt's
// system message assumed — strip them defensively before parsing rather than trusting the
// model to always comply.
function parseJsonResponse(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned)
}

async function detectColumns(tabName, rows) {
  const text = await glmComplete([
    { role: 'system', content: 'You are a data analyst. Respond only with valid JSON, no markdown, no explanation.' },
    { role: 'user', content: buildPrompt(tabName, rows) },
  ], { maxTokens: 800, temperature: 0 })
  return parseJsonResponse(text)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const caller = await requireToolAccess(req, res, TOOL_ID)
  if (!caller) return

  const { action, payload = {} } = req.body || {}

  try {
    if (action === 'detectColumns') {
      const { tabName, rows } = payload
      if (!tabName || !Array.isArray(rows)) return res.status(400).json({ error: 'tabName and rows are required' })
      return res.json({ detection: await detectColumns(tabName, rows) })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

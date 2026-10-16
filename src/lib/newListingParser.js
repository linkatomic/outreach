// Parser for the team's daily "New Listing" intake sheet — one Google Sheet with a tab per
// day (named like "16-10-26"), plus a handful of fixed reference tabs (Supplier name,
// Validation, etc). Every daily tab shares the same 2-row merged-header template (group label
// in row 1, sub-label in row 2 for grouped price/audit columns), so columns are detected by
// header text rather than position — the alternative (hardcoded indices, like the standard
// 3-column layout Ultimate Sheet Parser assumes) breaks the moment a column gets inserted.
import { cleanDomain, parsePrice } from './sheetParserAPI.js'

export function isLikelyDateTab(name) {
  return /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(String(name || '').trim())
}

function normHeader(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function priceSubKey(subNorm) {
  if (subNorm === 'general') return 'general'
  if (subNorm === 'cbd') return 'cbd'
  if (subNorm === 'casino') return 'casino'
  if (subNorm === 'crypto') return 'crypto'
  if (subNorm.includes('validity')) return 'validity'
  if (subNorm.includes('casino') || subNorm.includes('crypto') || subNorm.includes('cbd')) return 'other'
  if (subNorm.includes('general')) return 'general'
  return subNorm ? subNorm.replace(/[^a-z0-9]+/g, '_') : 'value'
}

function auditSubKey(subNorm) {
  if (subNorm.includes('auditor')) return 'auditor'
  if (subNorm.includes('status')) return 'status'
  if (subNorm.includes('error')) return 'error_by'
  if (subNorm.includes('feedback')) return 'feedback'
  return subNorm ? subNorm.replace(/[^a-z0-9]+/g, '_') : 'value'
}

// A blank-row1 column only belongs to the group to its left if its row-2 sub-label looks like
// one of the price/audit sub-columns that group actually uses — otherwise it's a stray/helper
// column (the real sheet has a few: leftover VLOOKUP scratch columns with no group header of
// their own) that would otherwise silently get swept into whatever group preceded it.
function isRecognizedSub(subNorm) {
  if (!subNorm) return false
  if (['general', 'cbd', 'casino', 'crypto', 'validity'].includes(subNorm)) return true
  if (subNorm.includes('casino') || subNorm.includes('cbd') || subNorm.includes('crypto')) return true
  if (subNorm.includes('auditor') || subNorm.includes('status') || subNorm.includes('error') || subNorm.includes('feedback')) return true
  if (subNorm.includes('language') && subNorm.includes('general')) return true
  return false
}

// Row 1 holds merged group labels (blank cells inherit the last non-blank one to their left),
// row 2 holds sub-labels under grouped columns and is blank for simple (ungrouped) columns.
function buildHeaderGroups(row1, row2) {
  const len = Math.max(row1.length, row2.length)
  const cols = []
  let currentGroup = ''
  for (let ci = 0; ci < len; ci++) {
    const g = String(row1[ci] ?? '').trim()
    const sub = String(row2[ci] ?? '').trim()
    const subNorm = normHeader(sub)
    if (g) currentGroup = g
    else if (!isRecognizedSub(subNorm)) currentGroup = ''
    cols.push({ ci, groupNorm: normHeader(currentGroup), subNorm })
  }
  return cols
}

const PRICE_GROUPS = ['post', 'link_insertion', 'foreign_language', 'sidebar_footer']

// Scans the sheet's first two rows and maps every known field to a column index (or, for the
// price/audit grids, a {subKey: columnIndex} object). Anything not recognized is simply left
// out of the map — the raw row is always kept alongside (see parseNewListingRows) so nothing
// detected imperfectly here is actually lost.
export function detectNewListingColumns(headerRows) {
  const row1 = headerRows[0] || []
  const row2 = headerRows[1] || []
  const cols = buildHeaderGroups(row1, row2)

  const map = {
    entryDate: null, addedBy: null, status: null, missiveLink: null,
    website: null, websiteUrl: null, verification: null, manageBy: null,
    linkType: null, linkValidity: null, estimatedDays: null, backlinks: null,
    primaryLanguage: null, primaryCategories: null, categories: null,
    sampleLinks: [], languages: null, googleNews: null, premium: null,
    sponsored: null, linkInsertionOnly: null, foreignLangAnchor: null,
    minLength: null, maxLength: null, rules: null, websiteNotes: null,
    vendor: null, currency: null,
  }
  const pricing = { post: {}, link_insertion: {}, foreign_language: {}, sidebar_footer: {} }
  const usdPricing = { post: {}, link_insertion: {}, foreign_language: {}, sidebar_footer: {} }
  const audit = {}

  for (const c of cols) {
    const g = c.groupNorm
    if (!g) continue
    const isUsd = g.includes('usd')
    const gBase = g.replace(/\(\s*usd\s*\)/, '').trim()

    if (map.entryDate == null && g === 'date') map.entryDate = c.ci
    else if (map.addedBy == null && g.includes('added by')) map.addedBy = c.ci
    else if (map.status == null && g === 'status') map.status = c.ci
    else if (map.missiveLink == null && (g.includes('communication channel') || g.includes('missive'))) map.missiveLink = c.ci
    else if (map.websiteUrl == null && g.includes('website url')) map.websiteUrl = c.ci
    else if (map.websiteNotes == null && g.includes('website notes')) map.websiteNotes = c.ci
    else if (map.website == null && g === 'website') map.website = c.ci
    else if (map.verification == null && g.includes('verification')) map.verification = c.ci
    else if (map.manageBy == null && g.includes('manage by')) map.manageBy = c.ci
    else if (map.linkType == null && g.includes('link type')) map.linkType = c.ci
    else if (map.linkValidity == null && g.includes('link validity')) map.linkValidity = c.ci
    else if (map.estimatedDays == null && g.includes('estimated days')) map.estimatedDays = c.ci
    else if (map.backlinks == null && g === 'backlinks') map.backlinks = c.ci
    else if (map.primaryLanguage == null && g.includes('primary language')) map.primaryLanguage = c.ci
    else if (map.primaryCategories == null && g.includes('primary categories')) map.primaryCategories = c.ci
    else if (map.categories == null && g === 'categories') map.categories = c.ci
    else if (g.includes('sample link')) map.sampleLinks.push(c.ci)
    else if (map.languages == null && g === 'languages') map.languages = c.ci
    else if (map.googleNews == null && g.includes('google news')) map.googleNews = c.ci
    else if (map.premium == null && g === 'premium') map.premium = c.ci
    else if (map.sponsored == null && g.includes('sponsored')) map.sponsored = c.ci
    else if (map.linkInsertionOnly == null && g.includes('only link insertion')) map.linkInsertionOnly = c.ci
    else if (map.foreignLangAnchor == null && g.includes('foreign language anchor')) map.foreignLangAnchor = c.ci
    else if (map.minLength == null && g.includes('min') && g.includes('length')) map.minLength = c.ci
    else if (map.maxLength == null && g.includes('max') && g.includes('length')) map.maxLength = c.ci
    else if (map.rules == null && g === 'rules') map.rules = c.ci
    else if (map.vendor == null && g === 'vendor') map.vendor = c.ci
    else if (map.currency == null && g === 'currency') map.currency = c.ci
    else if (g.includes('post price')) {
      (isUsd ? usdPricing.post : pricing.post)[priceSubKey(c.subNorm)] = c.ci
    } else if (g.includes('link insertion price') || g.includes('link insetion price')) {
      (isUsd ? usdPricing.link_insertion : pricing.link_insertion)[priceSubKey(c.subNorm)] = c.ci
    } else if (g.includes('sidebar footer')) {
      (isUsd ? usdPricing.sidebar_footer : pricing.sidebar_footer)[priceSubKey(c.subNorm)] = c.ci
    } else if (gBase === 'foreign language') {
      (isUsd ? usdPricing.foreign_language : pricing.foreign_language)[priceSubKey(c.subNorm)] = c.ci
    } else if (g === 'audit') {
      audit[auditSubKey(c.subNorm)] = c.ci
    }
  }

  return { map, pricing, usdPricing, audit }
}

const CORE_FIELDS = ['entryDate', 'addedBy', 'status', 'website', 'websiteUrl', 'vendor', 'linkType', 'linkValidity', 'manageBy', 'currency']

export function summarizeDetection(colInfo) {
  const { map, pricing, usdPricing, audit } = colInfo
  const missingCore = CORE_FIELDS.filter(k => map[k] == null)
  const pricingGroupsFound = PRICE_GROUPS.filter(g => Object.keys(pricing[g] || {}).length || Object.keys(usdPricing[g] || {}).length)
  return {
    coreFound: CORE_FIELDS.length - missingCore.length,
    coreTotal: CORE_FIELDS.length,
    missingCore,
    pricingGroupsFound: pricingGroupsFound.length,
    hasAudit: Object.keys(audit).length > 0,
    hasWebsite: map.website != null,
  }
}

function toBool(raw) {
  if (raw === true || raw === false) return raw
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  return ['true', 'yes', 'y', '1', 'checked'].includes(s)
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Google Sheets' FORMATTED_VALUE render option returns dates as locale-formatted strings
// (this account's sheets format them M/D/YYYY), not ISO — best-effort parse, null on anything
// ambiguous rather than guessing wrong, since the raw value is preserved separately either way.
function parseSheetDate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    let [, mo, da, y] = m
    if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y
    mo = Number(mo); da = Number(da)
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`
  }
  const d = new Date(s)
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) return isoDate(d)
  return null
}

function colIndexToLetter(idx) {
  let n = idx + 1, s = ''
  while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// `allRows` includes the 2 header rows — data starts at index 2. Any row without a parseable
// domain in the Website column is skipped, same rule Ultimate Sheet Parser uses.
export function parseNewListingRows(allRows, colInfo, { sourceTab, sourceSheetUrl, importedBy }) {
  const { map, pricing, usdPricing, audit } = colInfo
  const HEADER_ROWS = 2
  const out = []

  for (let i = HEADER_ROWS; i < allRows.length; i++) {
    const row = allRows[i] || []
    if (!row.length || row.every(v => v === '' || v == null)) continue
    const domain = cleanDomain(map.website != null ? row[map.website] : '')
    if (!domain || !domain.includes('.')) continue

    const get = ci => (ci == null ? null : (row[ci] ?? ''))
    const getNum = ci => (ci == null ? null : parsePrice(row[ci]))
    const getBool = ci => (ci == null ? null : toBool(row[ci]))

    const sampleLinks = map.sampleLinks.map(ci => String(row[ci] ?? '').trim()).filter(Boolean)

    const pricingOut = {}
    for (const group of PRICE_GROUPS) {
      const entries = Object.entries(pricing[group] || {})
      if (entries.length) pricingOut[group] = Object.fromEntries(entries.map(([k, ci]) => [k, getNum(ci)]))
    }
    const usdOut = {}
    for (const group of PRICE_GROUPS) {
      const entries = Object.entries(usdPricing[group] || {})
      if (entries.length) usdOut[group] = Object.fromEntries(entries.map(([k, ci]) => [k, getNum(ci)]))
    }
    if (Object.keys(usdOut).length) pricingOut.usd = usdOut

    const auditOut = Object.keys(audit).length
      ? Object.fromEntries(Object.entries(audit).map(([k, ci]) => [k, get(ci) || null]))
      : {}

    const raw = {}
    row.forEach((v, ci) => { if (v !== '' && v != null) raw[colIndexToLetter(ci)] = v })

    out.push({
      imported_by: importedBy,
      source_sheet_url: sourceSheetUrl,
      source_tab: sourceTab,
      entry_date: parseSheetDate(get(map.entryDate)),
      added_by: get(map.addedBy) || null,
      status: get(map.status) || null,
      missive_link: get(map.missiveLink) || null,
      website: domain,
      website_url: get(map.websiteUrl) || null,
      verification: getBool(map.verification),
      manage_by: get(map.manageBy) || null,
      link_type: get(map.linkType) || null,
      link_validity: get(map.linkValidity) || null,
      estimated_days: getNum(map.estimatedDays),
      backlinks: getNum(map.backlinks),
      primary_language: get(map.primaryLanguage) || null,
      primary_categories: get(map.primaryCategories) || null,
      categories: get(map.categories) || null,
      sample_links: sampleLinks,
      languages: get(map.languages) || null,
      google_news: getBool(map.googleNews),
      premium: getBool(map.premium),
      sponsored: getBool(map.sponsored),
      link_insertion_only: getBool(map.linkInsertionOnly),
      foreign_lang_anchor: getBool(map.foreignLangAnchor),
      min_length: getNum(map.minLength),
      max_length: getNum(map.maxLength),
      rules: get(map.rules) || null,
      website_notes: get(map.websiteNotes) || null,
      vendor: get(map.vendor) || null,
      currency: get(map.currency) || null,
      pricing: pricingOut,
      audit: auditOut,
      raw,
    })
  }
  return out
}

// Curated from the sheet's own "Validation" reference tab — used as the Browse filter's
// status options. Not enforced on write (a sheet can always introduce a new status value).
export const LISTING_STATUS_OPTIONS = [
  'Ready for live', 'On Hold', 'Do Not List', 'Live', 'Disabled', 'Details Pending',
  'GPL Rejected', 'Website Not Working', 'Added In Draft', 'Delete', 'Alternate',
  'Adult content', 'Metrics issue', 'Redirect domain', 'Reseller', 'Indexing Done', 'No Index',
]

import 'dotenv/config'

let cache = null

export async function getPriceMap() {
  if (cache) return cache
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/price_table?select=Admin,Buyer`,
    {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      },
    }
  )
  const data = await res.json()
  cache = new Map(
    data.map(r => [Math.round(r.Admin ?? r.admin), r.Buyer ?? r.buyer])
  )
  return cache
}

export function parsePrice(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!s || s === '-' || s.toLowerCase() === 'n/a') return null
  const num = parseFloat(s.replace(/[^0-9.]/g, ''))
  return isNaN(num) ? null : num
}

export function cleanDomain(raw) {
  if (!raw) return ''
  let s = String(raw).trim()
  // Remove protocol
  s = s.replace(/^https?:\/\//i, '')
  // Remove www.
  s = s.replace(/^www\./i, '')
  // Remove path (everything after first /)
  s = s.split('/')[0]
  // Remove everything after first whitespace (e.g. " New", " (New)***")
  s = s.split(/\s/)[0]
  // Remove stray asterisks, parens
  s = s.replace(/[*()\[\]]+/g, '')
  // Remove trailing punctuation
  s = s.replace(/[.,;:]+$/, '').trim()
  return s.toLowerCase()
}

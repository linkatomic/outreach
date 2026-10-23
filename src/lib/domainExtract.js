// Shared domain-extraction helper — originally private to DomainExtractor.jsx, pulled out
// here so Bargain Emails' bulk-site detection can reuse the exact same proven logic instead
// of a second copy.
export function extractDomains(html, text) {
  const seen = new Set()
  const list = []

  function add(raw) {
    if (!raw) return
    // strip trailing punctuation common in emails
    raw = raw.trim().replace(/[.,;|–—>)\]'"«»]+$/, '').trim()
    if (!raw) return
    try {
      const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw
      const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
      if (!host || !host.includes('.') || host.startsWith('.')) return
      if (!seen.has(host)) { seen.add(host); list.push(host) }
    } catch {}
  }

  // 1. HTML clipboard — anchor hrefs (best source: email table links, hyperlinks)
  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      doc.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || ''
        if (/^https?:\/\//i.test(href)) add(href)
      })
    } catch {}
  }

  const t = text || ''

  // 2. Explicit https?:// URLs in plain text
  for (const m of t.matchAll(/https?:\/\/[^\s,;|–—<>"')\]\[]+/gi)) {
    add(m[0])
  }

  // 3. Bare domains (no protocol) — e.g. "mumbaijournals.com — DA 37"
  //    Require: starts with a letter, each segment ≥2 chars, TLD = 2-6 letters only
  for (const m of t.matchAll(/\b([a-zA-Z][a-zA-Z0-9-]{1,}(?:\.[a-zA-Z0-9][a-zA-Z0-9-]{1,})*\.[a-zA-Z]{2,6})(?![a-zA-Z])/g)) {
    add(m[1])
  }

  // Final dedup pass — catches any edge cases where the same domain
  // slips through via different extraction paths (http vs bare, www variants, etc.)
  const finalSeen = new Set()
  return list.filter(d => {
    const key = d.toLowerCase()
    if (finalSeen.has(key)) return false
    finalSeen.add(key)
    return true
  })
}

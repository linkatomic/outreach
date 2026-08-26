// Shared helper for Email Harvester + Email Checker — NOT a Vercel endpoint (no default
// export, lives under an underscore-prefixed folder so it's never routed).
//
// The static English-language path guesses (/contact, /about, /privacy-policy, ...) miss
// any non-English site — e.g. a German site uses /kontakt/, not /contact/. This module is
// the fallback: extract the site's own nav links (header/footer/nav, wherever the site
// actually put "Contact"/"Kontakt"/"Contacto"/etc.) and ask an LLM to identify which one
// is which, since there's no way to hard-code every language's word for these pages.

import { parse } from 'node-html-parser'

const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY

export function extractNavLinks(html, baseUrl) {
  let root
  try { root = parse(html, { lowerCaseTagName: true }) } catch { return [] }

  // Contact/about/privacy links live in header/footer/nav on the overwhelming majority of
  // sites — scoping to those regions keeps the list small and relevant. Fall back to the
  // whole document only if none of those regions exist.
  const regions = root.querySelectorAll('header, footer, nav')
  const scope = regions.length ? regions : [root]

  const links = []
  const seen = new Set()
  for (const region of scope) {
    region.querySelectorAll('a[href]').forEach(a => {
      if (links.length >= 60) return
      const href = a.getAttribute('href')
      if (!href) return
      let abs
      try { abs = new URL(href, baseUrl).href } catch { return }
      if (!/^https?:\/\//i.test(abs)) return
      if (seen.has(abs)) return
      seen.add(abs)
      links.push({ text: a.text.replace(/\s+/g, ' ').trim().slice(0, 60), href: abs })
    })
  }
  return links
}

const TYPE_DESCRIPTIONS = {
  contact: 'Contact page — contact info / get in touch. Non-English examples: "Kontakt" (German), "Contacto" (Spanish), "Contactez-nous" (French), "Contatti" (Italian), "Contato" (Portuguese), "お問い合わせ" (Japanese).',
  about:   'About page — about the company/site/team. Non-English examples: "Über uns" (German), "Quiénes somos" (Spanish), "À propos" (French), "Chi siamo" (Italian), "会社概要" (Japanese).',
  privacy: 'Privacy policy page — privacy policy / data protection / GDPR. Non-English examples: "Datenschutz" (German), "Política de privacidad" (Spanish), "Politique de confidentialité" (French), "Informativa sulla privacy" (Italian).',
}

// missingTypes: subset of ['contact', 'about', 'privacy'] — only ask about ones the static
// guesses failed to find, to keep this a fallback rather than a call on every domain.
export async function findPagesWithAI(domain, navLinks, missingTypes) {
  if (!OPENAI_API_KEY || !navLinks.length || !missingTypes.length) return {}

  const linksBlock = navLinks.map(l => `"${l.text || '(no link text)'}" -> ${l.href}`).join('\n')
  const wanted = missingTypes.map(t => `- ${t}: ${TYPE_DESCRIPTIONS[t]}`).join('\n')

  const prompt = `You are finding specific page types from a website's navigation links. The site may be in
ANY language — page names are frequently NOT in English.

Website: ${domain}

Navigation links found (link text -> URL):
${linksBlock}

Find the URL for each of these page types, if present in the list above:
${wanted}

Only use a URL that appears in the list above. Respond with ONLY valid JSON, using null for any
type not present in the list:
{ ${missingTypes.map(t => `"${t}": "<url from the list, or null>"`).join(', ')} }`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5.4-nano',
        messages: [
          { role: 'system', content: 'You are an expert at identifying website page types from navigation links in any language. Respond only with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_completion_tokens: 200,
      }),
    })
    clearTimeout(timer)
    if (!res.ok) return {}
    const data = await res.json()
    if (data.error) return {}
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return {}
    const parsed = JSON.parse(text)

    // Never trust a URL the model didn't actually get handed — guards against hallucination
    const validHrefs = new Set(navLinks.map(l => l.href))
    const result = {}
    for (const t of missingTypes) {
      const url = parsed[t]
      if (url && validHrefs.has(url)) result[t] = url
    }
    return result
  } catch {
    return {}
  }
}

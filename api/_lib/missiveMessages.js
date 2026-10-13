// Shared message-fetching/body-cleaning helpers for reading a Missive conversation's actual
// messages (not just its summary fields like messages_count). Originally built for Missive
// Export, now reused by the reply-summary feature too — parameterized by `requestFn` so each
// caller passes whichever token-bound request function applies (missiveRequest /
// missivePersonalRequest), rather than hardcoding one.

import { parse as htmlParse } from 'node-html-parser'
import { convert as htmlToText } from 'html-to-text'

const MESSAGES_PAGE_LIMIT = 10
const BATCH_SIZE = 25 // conservative chunk size for GET /v1/messages/:id,:id2,...

// Removing a selector that never matches this account's real HTML is a harmless no-op —
// applying the full documented set unconditionally is safe even though there's no way to
// run a "pull a real sample and check" spike against a live account from here. If quotes
// still show up duplicated in a real export, these selectors are the first thing to revisit
// against an actual sample body.
export function stripQuotedContent(html) {
  if (!html) return ''
  let root
  try {
    root = htmlParse(html)
  } catch {
    return html
  }

  const removeAll = selector => root.querySelectorAll(selector).forEach(el => el.remove())

  removeAll('missive-message-quote') // Missive's own quote wrapper
  removeAll('.gmail_quote_container')
  removeAll('.gmail_quote')
  removeAll('.gmail_attr') // "On <date>, <name> <email> wrote:" attribution line
  removeAll('#divRplyFwdMsg') // Outlook
  removeAll('.OutlookMessageHeader')

  // Apple Mail: the "On <date>, <name> wrote:" line and the blockquote right after it
  // aren't wrapped in one container, so both have to be removed explicitly.
  root.querySelectorAll('.moz-cite-prefix').forEach(el => {
    const next = el.nextElementSibling
    if (next && next.tagName === 'BLOCKQUOTE') next.remove()
    el.remove()
  })

  // Real exported data showed quoted history isn't reliably wrapped in any classed
  // container above — just a bare <blockquote>, the one convention every mail client falls
  // back to for "quoted prior message." Blanket-removing every blockquote (not just classed
  // ones) is what stops a reply's quoted history from re-embedding every prior reply's own
  // quoted history, nesting one level deeper each round.
  removeAll('blockquote')

  return root.toString()
}

export function stripQuoteLines(text) {
  let out = text.replace(/^On .+ wrote:\s*$[\s\S]*/m, '').trim()
  // A line beginning with one or more ">" (any nesting depth) -- from a blockquote the
  // HTML pass missed, or a message that was already plain text using literal "> " quoting.
  out = out.split('\n').filter(line => !/^\s*>+/.test(line)).join('\n')
  return out.replace(/\n{3,}/g, '\n\n').trim() // collapse blank-line runs the filter leaves behind
}

export function bodyToPlainText(rawBody) {
  if (!rawBody) return ''
  // A body with no HTML tags at all (some custom-channel/SMS message types, or an email
  // Missive stored as plain text) must skip html-to-text entirely -- it treats untagged
  // text as one HTML text node and collapses real newlines into spaces per whitespace
  // rules, which would flatten literal "> quoted" lines onto one line before the filter
  // below ever gets a chance to see them as separate lines.
  if (!/<[a-z][\s\S]*>/i.test(rawBody)) return stripQuoteLines(rawBody)

  const stripped = stripQuotedContent(rawBody)
  const text = htmlToText(stripped, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] })
  return stripQuoteLines(text)
}

// The reference doesn't show a literal JSON envelope for either the messages-list or the
// batch-get response, only that the batch one is "→ array" -- which turned out not to mean
// a bare top-level array, nor necessarily {messages:[...]}. Real calls crashed with "Spread
// syntax requires ...iterable[Symbol.iterator] to be a function", which only happens when
// spreading a truthy non-array (an object) -- meaning `messages` was actually present but
// shaped as an object (most likely keyed by message ID) rather than an array. Normalizing
// defensively across every plausible shape avoids needing to keep guessing per-endpoint.
export function normalizeMessages(body) {
  if (Array.isArray(body)) return body
  const m = body?.messages
  if (Array.isArray(m)) return m
  if (m && typeof m === 'object') return Object.values(m) // keyed-by-id object map
  if (body?.id) return [body] // bare single message, no wrapper at all
  return []
}

// Cursor-based pagination (until = oldest delivered_at from the previous page) — the raw
// field value is passed straight back as the next cursor, never renormalized, since we
// don't actually know its unit/format beyond "whatever delivered_at itself already is."
export async function fetchMessageStubs(requestFn, conversationId, maxMessages) {
  const stubs = []
  const seenIds = new Set() // real exported data showed the `until` boundary can be
  // inclusive -- the last item of one page reappearing as the first item of the next --
  // so page boundaries aren't a reliable "no overlap" guarantee. Dedupe by message ID
  // rather than trusting that.
  let until = null
  while (stubs.length < maxMessages) {
    const params = new URLSearchParams({ limit: String(MESSAGES_PAGE_LIMIT) })
    if (until != null) params.set('until', String(until))
    const body = await requestFn(`/conversations/${conversationId}/messages?${params}`)
    const page = normalizeMessages(body)
    if (!page.length) break

    const before = stubs.length
    for (const m of page) {
      if (!seenIds.has(m.id)) { seenIds.add(m.id); stubs.push(m) }
    }
    // No new messages from a full page means the cursor is stuck (not just overlapping by
    // one item) -- stop rather than loop forever re-fetching the same page.
    if (stubs.length === before) break

    if (page.length < MESSAGES_PAGE_LIMIT) break
    until = page[page.length - 1].delivered_at
  }
  return stubs.slice(0, maxMessages)
}

// The messages-list endpoint only returns previews — full `body` requires this batch
// fetch, per the reference's rate-limit guidance to batch where possible.
export async function fetchFullMessages(requestFn, ids) {
  const results = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE)
    const body = await requestFn(`/messages/${chunk.join(',')}`)
    results.push(...normalizeMessages(body))
  }
  return results
}

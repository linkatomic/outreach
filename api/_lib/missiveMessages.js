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
// shaped as an object (most likely keyed by message ID) rather than an array. That was only
// ever confirmed against a MULTI-id batch call, though -- a single-id GET /messages/:id (no
// comma) may collapse to a singular `message` key holding the one object directly rather than
// a one-entry `messages` map, the same singular/plural split already seen on the
// single-conversation GET. A silent miss here doesn't error, it falls through to `[]`, which
// upstream callers then treat as "no full message found" and fall back to the preview-only
// stub -- exactly the kind of quietly-wrong-not-loudly-broken failure a real reply-summary run
// hit (a short, mid-word-truncated preview standing in for the real body). Checking both keys
// up front, and treating a key whose value itself looks like one message object (has its own
// `.id`) as that one message rather than a keyed map, closes that gap.
export function normalizeMessages(body) {
  const raw = (() => {
    if (Array.isArray(body)) return body
    const m = body?.messages ?? body?.message
    if (Array.isArray(m)) return m
    if (m && typeof m === 'object') return m.id ? [m] : Object.values(m) // one message vs. keyed-by-id map
    if (body?.id) return [body] // bare single message, no wrapper at all
    return []
  })()
  // A keyed-by-id object map can hold a null value for an id that didn't resolve to a real
  // message (seen in practice against a freshly-replied conversation), and a batch GET for
  // several ids at once can do the same per-id — filter those out rather than letting every
  // caller crash on `.id`/`.body` of a null entry.
  return raw.filter(Boolean)
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

// Re-fetches each conversation and compares its current messages_count against a baseline
// captured when it started being tracked — a higher count means new activity (a reply, since
// nothing else bumps a conversation's message count after the fact). No webhook/push
// mechanism is wired up anywhere this is used, so it's pull-based: called on page load and on
// a manual refresh by each caller. Parameterized by `requestFn` so Personal Email Sender (its
// own personal token) and the shared Missive tools (the export token) can both use this same
// logic instead of keeping two copies in sync.
export async function checkConversationReplies(requestFn, entries) {
  const CONCURRENCY = 3
  const results = []
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const slice = entries.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(slice.map(e => requestFn(`/conversations/${e.conversationId}`)))
    settled.forEach((r, bi) => {
      const entry = slice[bi]
      if (r.status === 'fulfilled') {
        // Single-conversation envelope key isn't confirmed either way — hedge both, same as
        // missive-export.js's getConversation handler already does. That handler also guards
        // against the plural `conversations` key holding an ARRAY (its own single-conversation
        // GET sometimes wraps the one object in a list), so `raw` doesn't silently end up an
        // array with no `.messages_count`, which would make currentCount always null and
        // hasReply always false regardless of real activity.
        const raw = r.value?.conversation || r.value?.conversations
        const conversation = Array.isArray(raw) ? raw[0] : raw
        const currentCount = conversation?.messages_count ?? null
        results.push({
          conversationId: entry.conversationId,
          currentCount,
          hasReply: currentCount != null && entry.baselineCount != null && currentCount > entry.baselineCount,
        })
      } else {
        results.push({ conversationId: entry.conversationId, error: r.reason?.message || 'Failed' })
      }
    })
  }
  return results
}

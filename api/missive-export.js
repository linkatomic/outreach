import { parse as htmlParse } from 'node-html-parser'
import { convert as htmlToText } from 'html-to-text'
import { requireToolAccess } from './_lib/supabaseAdmin.js'
import { missiveRequest } from './_lib/missive.js'

const TOOL_ID = 'missive-export'

// A single conversation's export walks its own thread sequentially (message pages, then
// a batch body fetch) inside ONE call — unlike this app's other bulk tools there's no way
// to split a single thread's fetch across multiple frontend-driven steps without a lot of
// added complexity, so the real safety valve is capping how long one thread can be. 100
// messages already stretches vercel.json's maxDuration on Vercel Hobby; the brief's own
// default of 30 stays comfortably fast.
const HARD_MAX_MESSAGES = 100
const MESSAGES_PAGE_LIMIT = 10
const BATCH_SIZE = 25 // conservative chunk size for GET /v1/messages/:id,:id2,...

const MAILBOX_FLAGS = new Set(['inbox', 'all', 'assigned', 'closed', 'snoozed', 'flagged', 'trashed', 'junked', 'drafts'])

// Reference timestamps (delivered_at, last_activity_at) aren't documented as explicitly
// as the Analytics API's unix-seconds params — hedge between epoch seconds/ms and ISO,
// same defensive pattern used for Crisp's timestamps elsewhere in this app.
function toMillis(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function slugify(text, maxLen = 60) {
  const slug = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '')
  return slug || 'untitled'
}

function buildFilename({ subject, lastActivityAt, externalAuthorEmail }) {
  const ms = toMillis(lastActivityAt)
  const dateStr = ms != null ? new Date(ms).toISOString().slice(0, 10) : 'unknown-date'
  const base = subject?.trim()
    ? slugify(subject)
    : slugify((externalAuthorEmail || '').split('@')[1] || externalAuthorEmail)
  return `${dateStr}-${base}.md`
}

function buildMailboxParams(mailbox, sharedLabelId) {
  if (mailbox === 'shared_label') {
    if (!sharedLabelId) throw new Error('sharedLabelId is required when mailbox is shared_label')
    return { shared_label: sharedLabelId }
  }
  if (!MAILBOX_FLAGS.has(mailbox)) throw new Error(`Unknown mailbox filter: ${mailbox}`)
  return { [mailbox]: 'true' }
}

// Removing a selector that never matches this account's real HTML is a harmless no-op —
// applying the full documented set unconditionally is safe even though I couldn't run the
// brief's suggested "pull a real sample and check" spike myself (no Missive token access
// from here). If quotes still show up duplicated in a real export, these selectors are the
// first thing to revisit against an actual sample body.
function stripQuotedContent(html) {
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

  // Real exported data showed this account's quoted history isn't wrapped in any of the
  // classed containers above -- just a bare <blockquote>, the one convention every mail
  // client falls back to for "quoted prior message." Leaving that unstripped is exactly
  // what caused the exponential re-embedding (each reply's blockquote already contained
  // the previous reply's own blockquote, nesting one level deeper every round -- one
  // thread hit 85KB from what should've been a ~15KB conversation). Blanket-removing
  // every blockquote, not just classed ones, is what actually stops that.
  removeAll('blockquote')

  return root.toString()
}

function stripQuoteLines(text) {
  let out = text.replace(/^On .+ wrote:\s*$[\s\S]*/m, '').trim()
  // A line beginning with one or more ">" (any nesting depth) -- from a blockquote the
  // HTML pass missed, or a message that was already plain text using literal "> " quoting.
  out = out.split('\n').filter(line => !/^\s*>+/.test(line)).join('\n')
  return out.replace(/\n{3,}/g, '\n\n').trim() // collapse blank-line runs the filter leaves behind
}

function bodyToPlainText(rawBody) {
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

function formatMessage(m) {
  const isOurs = !!m.author
  const label = isOurs ? '[Our Response]' : '[Vendor Response]'
  const name = isOurs
    ? (m.author?.name || m.from_field?.name || m.from_field?.address || 'Unknown')
    : (m.from_field?.name || m.from_field?.address || 'Unknown')
  const ms = toMillis(m.delivered_at)
  const dateStr = ms != null
    ? new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown date'
  const body = bodyToPlainText(m.body || m.preview || '')
  return `${label} ${name} - ${dateStr}\n${body}`
}

function buildMarkdown({ subject, webUrl, messages }) {
  const body = messages.map(m => `${formatMessage(m)}\n\n---`).join('\n\n')
  return `---\nReference precedent only - never copy phrasing from this thread verbatim.\n\nConversation: ${subject}\nLink: ${webUrl}\n\n${body}\n\nOutcome: [FILL IN MANUALLY]\n---\n`
}

// Cursor-based pagination (until = oldest delivered_at from the previous page) — the raw
// field value is passed straight back as the next cursor, never renormalized, since we
// don't actually know its unit/format beyond "whatever delivered_at itself already is."
async function fetchMessageStubs(conversationId, maxMessages) {
  const stubs = []
  const seenIds = new Set() // real exported data showed the `until` boundary can be
  // inclusive -- the last item of one page reappearing as the first item of the next --
  // so page boundaries aren't a reliable "no overlap" guarantee. Dedupe by message ID
  // rather than trusting that.
  let until = null
  while (stubs.length < maxMessages) {
    const params = new URLSearchParams({ limit: String(MESSAGES_PAGE_LIMIT) })
    if (until != null) params.set('until', String(until))
    const body = await missiveRequest(`/conversations/${conversationId}/messages?${params}`)
    const page = body.messages || []
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
async function fetchFullMessages(ids) {
  const results = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE)
    const body = await missiveRequest(`/messages/${chunk.join(',')}`)
    results.push(...(body.messages || []))
  }
  return results
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const caller = await requireToolAccess(req, res, TOOL_ID)
  if (!caller) return

  const { action, payload = {} } = req.body || {}

  try {
    if (action === 'listOrganizations') {
      const body = await missiveRequest('/organizations')
      return res.json({ organizations: body.organizations || [] })
    }

    if (action === 'listSharedLabels') {
      const { organizationId } = payload
      if (!organizationId) return res.status(400).json({ error: 'organizationId is required' })
      const body = await missiveRequest(`/shared_labels?organization=${encodeURIComponent(organizationId)}`)
      return res.json({ labels: body.shared_labels || body.sharedLabels || [] })
    }

    if (action === 'listConversationsPage') {
      const { mailbox, sharedLabelId, until, contactEmail } = payload
      if (!mailbox) return res.status(400).json({ error: 'mailbox is required' })
      const params = new URLSearchParams({ limit: '50', ...buildMailboxParams(mailbox, sharedLabelId) })
      if (until != null) params.set('until', String(until))
      // "Chats with a specific person" -- Missive's own contact filter, layered on top of
      // the required mailbox filter rather than replacing it.
      if (contactEmail) params.set('email', contactEmail)
      const body = await missiveRequest(`/conversations?${params}`)
      return res.json({ conversations: body.conversations || [] })
    }

    if (action === 'getConversation') {
      const { conversationId } = payload
      if (!conversationId) return res.status(400).json({ error: 'conversationId is required' })
      const body = await missiveRequest(`/conversations/${conversationId}`)
      // The reference doesn't show the literal envelope for a single-conversation get --
      // hedge between a singular `conversation` key and the list endpoint's plural
      // `conversations` key possibly being reused for one object.
      const raw = body.conversation || body.conversations
      const conversation = Array.isArray(raw) ? raw[0] : raw
      if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
      return res.json({ conversation })
    }

    if (action === 'getConversationExport') {
      const { conversationId, subject, webUrl, lastActivityAt, externalAuthorEmail, maxMessages } = payload
      if (!conversationId) return res.status(400).json({ error: 'conversationId is required' })
      const cap = Math.max(1, Math.min(Number(maxMessages) || 30, HARD_MAX_MESSAGES))

      const stubs = await fetchMessageStubs(conversationId, cap)
      const full = await fetchFullMessages(stubs.map(m => m.id))
      const byId = new Map(full.map(m => [m.id, m]))
      const ordered = stubs.slice().reverse().map(s => byId.get(s.id) || s) // oldest -> newest

      const markdown = buildMarkdown({ subject: subject || '(no subject)', webUrl, messages: ordered })
      const filename = buildFilename({ subject, lastActivityAt, externalAuthorEmail })
      return res.json({ filename, markdown, messageCount: ordered.length })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    console.error('[missive-export]', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}

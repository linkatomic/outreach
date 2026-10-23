import { requireToolAccess } from './_lib/supabaseAdmin.js'
import { missiveRequest, fetchAllSharedLabels } from './_lib/missive.js'
import { bodyToPlainText, fetchMessageStubs, fetchFullMessages } from './_lib/missiveMessages.js'

const TOOL_ID = 'missive-export'

// A single conversation's export walks its own thread sequentially (message pages, then
// a batch body fetch) inside ONE call — unlike this app's other bulk tools there's no way
// to split a single thread's fetch across multiple frontend-driven steps without a lot of
// added complexity, so the real safety valve is capping how long one thread can be. 100
// messages already stretches vercel.json's maxDuration on Vercel Hobby; the brief's own
// default of 30 stays comfortably fast.
const HARD_MAX_MESSAGES = 100

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
      return res.json({ labels: await fetchAllSharedLabels(missiveRequest, organizationId) })
    }

    if (action === 'listConversationsPage') {
      const { mailbox, sharedLabelId, until, contactEmail, closedOnly } = payload
      if (!mailbox) return res.status(400).json({ error: 'mailbox is required' })
      const params = new URLSearchParams({ limit: '50', ...buildMailboxParams(mailbox, sharedLabelId) })
      if (until != null) params.set('until', String(until))
      // "Chats with a specific person" -- Missive's own contact filter, layered on top of
      // the required mailbox filter rather than replacing it.
      if (contactEmail) params.set('email', contactEmail)
      // Status (closed) and scope (a shared label) are orthogonal in Missive's own UI — a
      // label groups conversations, closed is a per-conversation state — so this layers
      // closed=true on top of whatever mailbox/shared_label params buildMailboxParams already
      // set, the same additive pattern as the email filter above. Unverified against a live
      // call (no network access to Missive from where this was written); if closed threads
      // outside the label start showing up, or closed ones get silently dropped, that's the
      // first thing to re-check.
      if (closedOnly) params.set('closed', 'true')
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

      const stubs = await fetchMessageStubs(missiveRequest, conversationId, cap)
      const full = await fetchFullMessages(missiveRequest, stubs.map(m => m.id))
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

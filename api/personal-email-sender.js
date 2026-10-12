// POST /api/personal-email-sender
// Body: { action, payload }
// Backs the Personal Email Sender — restricted to Dev Pandya only, sends email using
// Dev's own personal Missive API token (MISSIVE_PERSONAL_API_TOKEN), not the shared
// export token other Missive tools use.

import { requireExactUser, supabaseAdmin } from './_lib/supabaseAdmin.js'
import { missivePersonalRequest, fetchAllSharedLabels } from './_lib/missive.js'

// Dev Pandya's real Supabase user_profiles.id (UUID) — requireExactUser checks this against
// the authenticated caller's actual profile row, read straight from user_profiles here, so
// it must be the UUID. This is NOT the same value as the client-side gate: the frontend
// (Shell.jsx, PersonalEmailSender.jsx) only ever sees `me.id` as the short member_id slug
// ('dev'), since App.jsx remaps the profile before any page gets it. Hardcoded since this
// tool is personal to one specific person, not role- or allowlist-gated.
const DEV_USER_ID = 'a680f0f2-2ae2-4dc0-a094-5bbd1eb8cf7f'

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Missive recommends <div>/<br> over <p> for spacing. Blank-line-separated paragraphs
// become their own <div>; single newlines within a paragraph become <br>.
function textToHtml(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map(para => para.trim())
    .filter(Boolean)
    .map(para => `<div>${escapeHtml(para).replace(/\n/g, '<br>')}</div>`)
    .join('')
}

function applyMergeFields(text, name) {
  return String(text ?? '').replace(/\{\{\s*name\s*\}\}/gi, name || '')
}

// The reference doc doesn't publish the exact shape of a sent draft's response (only that
// some POSTs return 201 with no body at all) — hedge across every plausible key a conversation
// id might come back under, on either the top-level body or a nested `drafts` object.
function extractConversationId(result) {
  const candidates = [result?.drafts, result]
  for (const obj of candidates) {
    const id = obj?.conversation?.id || obj?.conversation_id || obj?.conversation
    if (typeof id === 'string' && id) return id
  }
  return null
}

async function handleSend(caller, payload) {
  const { to, from, subject, template, signature, team, sharedLabelIds, batchId } = payload
  if (!to?.address) throw new Error('Recipient email is required')
  if (!from?.address) throw new Error('From address is required')
  if (!subject) throw new Error('Subject is required')
  if (!template) throw new Error('Email body is required')

  const bodyHtml = textToHtml(applyMergeFields(template, to.name)) + textToHtml(applyMergeFields(signature, to.name))

  const draft = {
    subject,
    body: bodyHtml,
    from_field: { address: from.address, name: from.name || undefined },
    to_fields: [{ address: to.address, name: to.name || undefined }],
    send: true,
  }
  if (team) draft.team = team
  if (Array.isArray(sharedLabelIds) && sharedLabelIds.length) draft.add_shared_labels = sharedLabelIds

  const result = await missivePersonalRequest('/drafts', {
    method: 'POST',
    body: JSON.stringify({ drafts: draft }),
  })

  // The send already happened by this point — a failure resolving the link or writing the
  // log must never surface as a send failure, just a send with no link recorded.
  let conversationId = null
  let webUrl = null
  try {
    conversationId = extractConversationId(result)
    if (conversationId) {
      const convBody = await missivePersonalRequest(`/conversations/${conversationId}`)
      webUrl = convBody?.conversations?.web_url || convBody?.conversation?.web_url || null
    }
  } catch { /* link lookup is best-effort */ }

  try {
    await supabaseAdmin.from('personal_email_sent_log').insert({
      user_id: caller.id,
      batch_id: batchId || null,
      recipient_name: to.name || null,
      recipient_email: to.address,
      subject,
      conversation_id: conversationId,
      web_url: webUrl,
    })
  } catch { /* logging is best-effort — never fail a successful send over it */ }

  return { conversationId, webUrl }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const caller = await requireExactUser(req, res, DEV_USER_ID)
  if (!caller) return

  const { action, payload = {} } = req.body || {}

  try {
    if (action === 'listOrganizations') {
      const body = await missivePersonalRequest('/organizations')
      return res.json({ organizations: body.organizations || [] })
    }

    if (action === 'listTeams') {
      const { organizationId } = payload
      if (!organizationId) return res.status(400).json({ error: 'organizationId is required' })
      const body = await missivePersonalRequest(`/teams?organization=${encodeURIComponent(organizationId)}`)
      return res.json({ teams: body.teams || [] })
    }

    if (action === 'listSharedLabels') {
      const { organizationId } = payload
      if (!organizationId) return res.status(400).json({ error: 'organizationId is required' })
      return res.json({ labels: await fetchAllSharedLabels(missivePersonalRequest, organizationId) })
    }

    if (action === 'send') {
      const { conversationId, webUrl } = await handleSend(caller, payload)
      return res.json({ ok: true, conversationId, webUrl })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

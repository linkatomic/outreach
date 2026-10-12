// POST /api/personal-email-sender
// Body: { action, payload }
// Backs the Personal Email Sender — restricted to Dev Pandya only, sends email using
// Dev's own personal Missive API token (MISSIVE_PERSONAL_API_TOKEN), not the shared
// export token other Missive tools use.

import { requireExactUser } from './_lib/supabaseAdmin.js'
import { missivePersonalRequest } from './_lib/missive.js'

// Dev Pandya's Supabase user_profiles.id — hardcoded since this tool is personal to one
// specific person, not role- or allowlist-gated. Keep in sync with the matching constant
// in src/pages/PersonalEmailSender.jsx and src/components/Shell.jsx (nav visibility).
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

async function handleSend(payload) {
  const { to, from, subject, template, signature, team, sharedLabelIds } = payload
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

  return missivePersonalRequest('/drafts', {
    method: 'POST',
    body: JSON.stringify({ drafts: draft }),
  })
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
      const body = await missivePersonalRequest(`/shared_labels?organization=${encodeURIComponent(organizationId)}`)
      return res.json({ labels: body.shared_labels || body.sharedLabels || [] })
    }

    if (action === 'send') {
      const result = await handleSend(payload)
      return res.json({ ok: true, result })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

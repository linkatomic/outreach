import { supabaseAdmin, requireAdmin } from './_lib/supabaseAdmin.js'

const VALID_SECTIONS = ['outreach', 'livechat']
const VALID_MODES = ['everyone', 'selected']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const admin = await requireAdmin(req, res)
  if (!admin) return

  const { toolId, updates } = req.body || {}
  if (!toolId) return res.status(400).json({ error: 'toolId is required' })

  const clean = {}
  if ('section' in (updates || {})) {
    if (!VALID_SECTIONS.includes(updates.section)) return res.status(400).json({ error: 'Invalid section' })
    clean.section = updates.section
  }
  if ('mode' in (updates || {})) {
    if (!VALID_MODES.includes(updates.mode)) return res.status(400).json({ error: 'Invalid mode' })
    clean.mode = updates.mode
  }
  if ('allowed_member_ids' in (updates || {})) {
    if (!Array.isArray(updates.allowed_member_ids)) return res.status(400).json({ error: 'allowed_member_ids must be an array' })
    clean.allowed_member_ids = updates.allowed_member_ids
  }
  if (Object.keys(clean).length === 0) return res.status(400).json({ error: 'No valid fields to update' })
  clean.updated_at = new Date().toISOString()

  try {
    const { data, error } = await supabaseAdmin
      .from('tool_access')
      .upsert({ tool_id: toolId, ...clean }, { onConflict: 'tool_id' })
      .select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ toolAccess: data })
  } catch (err) {
    console.error('[admin-tools]', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}

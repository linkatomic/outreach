import { supabaseAdmin, requireAdmin } from './_lib/supabaseAdmin.js'

const COLOR_SLOTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
const VALID_ROLES = ['lead', 'member', 'hr', 'super', 'livechat', 'tools-only']
const VALID_TEAMS = ['outreach', 'livechat']

function deriveFields(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const short = parts.map(w => w[0]?.toUpperCase() || '').join('').slice(0, 3) || '??'
  const base = parts[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'member'
  return { short, base }
}

async function uniqueMemberId(base) {
  const { data } = await supabaseAdmin.from('user_profiles').select('member_id')
  const taken = new Set((data || []).map(r => r.member_id))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`
    if (!taken.has(candidate)) return candidate
  }
}

async function pickColor() {
  const { data } = await supabaseAdmin.from('user_profiles').select('color')
  const used = new Set((data || []).map(r => r.color))
  return COLOR_SLOTS.find(c => !used.has(c)) || COLOR_SLOTS[0]
}

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
  let out = ''
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function validateTeams(teams) {
  return Array.isArray(teams) && teams.length > 0 && teams.every(t => VALID_TEAMS.includes(t))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const admin = await requireAdmin(req, res)
  if (!admin) return // requireAdmin already wrote the error response

  const { action, payload = {} } = req.body || {}

  try {
    if (action === 'create') {
      const { name, email, password, role, teams, dualAccess = false } = payload
      if (!name?.trim() || !email?.trim() || !password?.trim()) {
        return res.status(400).json({ error: 'name, email and password are required' })
      }
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' })
      if (!validateTeams(teams)) return res.status(400).json({ error: 'Select at least one valid team' })

      const { short, base } = deriveFields(name)
      const [memberId, color] = await Promise.all([uniqueMemberId(base), pickColor()])

      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name },
      })
      if (createErr) return res.status(400).json({ error: createErr.message })

      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: created.user.id, member_id: memberId, role, name, short, color, email,
          teams, joined_date: new Date().toISOString().slice(0, 10),
          active: true, dual_access: !!dualAccess, core_tasks: [],
        })
        .select().single()

      if (profileErr) {
        // Don't leave an auth user with no profile — it would fail login with a confusing error.
        await supabaseAdmin.auth.admin.deleteUser(created.user.id)
        return res.status(500).json({ error: profileErr.message })
      }
      return res.json({ profile })
    }

    if (action === 'updateProfile') {
      const { id, updates } = payload
      if (!id || !updates) return res.status(400).json({ error: 'id and updates are required' })

      const allowed = ['role', 'teams', 'name', 'short', 'color', 'email', 'joined_date', 'dual_access', 'core_tasks']
      const clean = {}
      for (const k of allowed) if (k in updates) clean[k] = updates[k]
      if ('role' in clean && !VALID_ROLES.includes(clean.role)) return res.status(400).json({ error: 'Invalid role' })
      if ('teams' in clean && !validateTeams(clean.teams)) return res.status(400).json({ error: 'Select at least one valid team' })
      if (Object.keys(clean).length === 0) return res.status(400).json({ error: 'No valid fields to update' })

      const { data: profile, error } = await supabaseAdmin
        .from('user_profiles').update(clean).eq('id', id).select().single()
      if (error) return res.status(500).json({ error: error.message })

      if (clean.email) {
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, { email: clean.email })
        if (authErr) return res.status(500).json({ error: `Profile updated but auth email sync failed: ${authErr.message}` })
      }
      return res.json({ profile })
    }

    if (action === 'setActive') {
      const { id, active } = payload
      if (!id || typeof active !== 'boolean') return res.status(400).json({ error: 'id and active are required' })

      // Ban at the auth layer too — flipping `active` alone wouldn't stop an
      // already-issued session token from working until it next expires.
      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, {
        ban_duration: active ? 'none' : '876000h',
      })
      if (authErr) return res.status(500).json({ error: authErr.message })

      const { data: profile, error } = await supabaseAdmin
        .from('user_profiles').update({ active }).eq('id', id).select().single()
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ profile })
    }

    if (action === 'deleteUser') {
      const { id } = payload
      if (!id) return res.status(400).json({ error: 'id is required' })
      if (id === admin.id) return res.status(400).json({ error: "You can't delete your own account" })

      // Historical data (reports, emails, tasks, etc.) is keyed by member_id, not
      // this auth id, so it's untouched — this only removes login + roster listing.
      await supabaseAdmin.from('user_profiles').delete().eq('id', id)
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(id)
      if (authErr) return res.status(500).json({ error: authErr.message })
      return res.json({ ok: true })
    }

    if (action === 'resetPassword') {
      const { id, password } = payload
      const newPassword = password?.trim() || genPassword()
      if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })

      const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password: newPassword })
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ password: newPassword })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    console.error('[admin-users]', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}

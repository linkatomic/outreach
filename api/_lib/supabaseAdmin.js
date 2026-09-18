import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://mhoncmvynerqsswmdqin.supabase.co'

// Service-role client — bypasses RLS. Server-only: never import this from src/.
// SUPABASE_SERVICE_ROLE_KEY must be a plain (non-VITE_-prefixed) env var so Vite
// never inlines it into the client bundle.
export const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Verifies the caller's Supabase session token and returns their profile,
// or writes a 401/403 and returns null on failure.
async function getCallerProfile(req, res) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization bearer token' })
    return null
  }

  const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return null
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr || !profile) {
    res.status(403).json({ error: 'No profile found for this account' })
    return null
  }
  return profile
}

// Requires an admin role (lead/super). Returns the caller's profile on
// success, or writes a 401/403 and returns null on failure — callers
// should `if (!admin) return`.
export async function requireAdmin(req, res) {
  const profile = await getCallerProfile(req, res)
  if (!profile) return null
  if (!['lead', 'super'].includes(profile.role)) {
    res.status(403).json({ error: 'Admin access required' })
    return null
  }
  return profile
}

// Requires the caller to pass the same per-tool access check the Tools page
// UI uses (Admin → Tool Permissions): lead/super always pass; otherwise the
// tool_access row for `toolId` must have mode 'everyone', or 'selected' with
// this caller's member_id in allowed_member_ids. A tool with no row yet
// defaults to 'everyone'. Use this instead of requireAdmin for a tool's own
// backend route so the UI restriction is actually enforced, not just cosmetic.
export async function requireToolAccess(req, res, toolId) {
  const profile = await getCallerProfile(req, res)
  if (!profile) return null
  if (['lead', 'super'].includes(profile.role)) return profile

  const { data: access } = await supabaseAdmin
    .from('tool_access')
    .select('mode, allowed_member_ids')
    .eq('tool_id', toolId)
    .maybeSingle()

  if (access?.mode === 'selected' && !(access.allowed_member_ids || []).includes(profile.member_id)) {
    res.status(403).json({ error: 'You do not have access to this tool' })
    return null
  }
  return profile
}

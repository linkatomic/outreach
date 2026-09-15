import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://mhoncmvynerqsswmdqin.supabase.co'

// Service-role client — bypasses RLS. Server-only: never import this from src/.
// SUPABASE_SERVICE_ROLE_KEY must be a plain (non-VITE_-prefixed) env var so Vite
// never inlines it into the client bundle.
export const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Verifies the caller's Supabase session token and requires an admin role
// (lead/super). Returns their profile on success, or writes a 401/403 and
// returns null on failure — callers should `if (!admin) return`.
export async function requireAdmin(req, res) {
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
  if (!['lead', 'super'].includes(profile.role)) {
    res.status(403).json({ error: 'Admin access required' })
    return null
  }
  return profile
}

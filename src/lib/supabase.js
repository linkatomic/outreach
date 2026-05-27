import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://mhoncmvynerqsswmdqin.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ob25jbXZ5bmVycXNzd21kcWluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Njg4OTYsImV4cCI6MjA5NTM0NDg5Nn0.vhMvZ6Ve4kCJE8T95wxjtVoW6RphVHJTFZH-h5YLWlk'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Auth ──────────────────────────────────────────────
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

// ── Reports ───────────────────────────────────────────

export async function saveReport({ memberId, date, metrics, note, total }) {
  const { error } = await supabase
    .from('daily_reports')
    .upsert({ member_id: memberId, date, metrics, note, total }, { onConflict: 'member_id,date' })
  if (error) throw error
}

export async function loadReport(memberId, date) {
  const { data, error } = await supabase
    .from('daily_reports')
    .select('*')
    .eq('member_id', memberId)
    .eq('date', date)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function loadReportsHistory(memberId) {
  const { data, error } = await supabase
    .from('daily_reports')
    .select('*')
    .eq('member_id', memberId)
    .order('date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function loadAllReportsForDate(date) {
  const { data, error } = await supabase
    .from('daily_reports')
    .select('*')
    .eq('date', date)
  if (error) throw error
  return data || []
}

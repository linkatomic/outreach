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

export async function getProfileByMemberId(memberId) {
  const { data } = await supabase
    .from('user_profiles')
    .select('accent')
    .eq('member_id', memberId)
    .maybeSingle()
  return data || null
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`No profile found for user ${userId}. Ask your admin to create one.`)
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

export async function loadMostRecentReport(memberId) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const { data, error } = await supabase
    .from('daily_reports')
    .select('*')
    .eq('member_id', memberId)
    .lt('date', todayStr)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// ── Email Logs ────────────────────────────────────────

function localDateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export async function loadEmailLogs({ filter = 'today', memberId = null, search = '', label = null } = {}) {
  let query = supabase
    .from('email_logs')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);

  if (filter === 'today') query = query.eq('date', localDateStr());
  else if (filter === 'week') query = query.gte('date', localDateStr(7));

  if (memberId) query = query.eq('member_id', memberId);
  if (label)    query = query.eq('label', label);

  const { data, error } = await query;
  if (error) throw error;

  let results = data || [];
  if (search) {
    const q = search.toLowerCase();
    results = results.filter(e =>
      (e.vendor || '').toLowerCase().includes(q) || e.link.toLowerCase().includes(q)
    );
  }
  return results;
}

export async function addEmail({ memberId, date, vendor, link, time, label = null, bulk = false }) {
  const { data, error } = await supabase
    .from('email_logs')
    .insert({ member_id: memberId, date, vendor, link, time, replies: 0, label, bulk })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateEmailBulk(id, bulk) {
  const { error } = await supabase
    .from('email_logs')
    .update({ bulk })
    .eq('id', id);
  if (error) throw error;
}

export async function findEmailByLink(memberId, link, date) {
  const { data } = await supabase
    .from('email_logs')
    .select('*')
    .eq('member_id', memberId)
    .eq('date', date)
    .eq('link', link)
    .maybeSingle();
  return data || null;
}

export async function incrementEmailReplies(id, currentReplies) {
  const { error } = await supabase
    .from('email_logs')
    .update({ replies: currentReplies + 1 })
    .eq('id', id);
  if (error) throw error;
}

export async function saveUserAccent(userId, accent) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ accent })
    .eq('id', userId);
  if (error) throw error;
}

export async function decrementEmailReplies(id, currentReplies) {
  if (currentReplies <= 0) return;
  const { error } = await supabase
    .from('email_logs')
    .update({ replies: currentReplies - 1 })
    .eq('id', id);
  if (error) throw error;
}

export async function updateEmailLabel(id, label) {
  const { error } = await supabase
    .from('email_logs')
    .update({ label })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteEmail(id) {
  const { error } = await supabase.from('email_logs').delete().eq('id', id);
  if (error) throw error;
}

export async function getEmailCountToday(memberId) {
  const { data } = await supabase
    .from('email_logs')
    .select('replies')
    .eq('member_id', memberId)
    .eq('date', localDateStr());
  if (!data) return 0;
  // Each row = 1 email + however many replies
  return data.reduce((sum, row) => sum + 1 + (row.replies || 0), 0);
}

export async function getTeamEmailCountToday() {
  const { data } = await supabase
    .from('email_logs')
    .select('replies')
    .eq('date', localDateStr());
  if (!data) return 0;
  return data.reduce((sum, row) => sum + 1 + (row.replies || 0), 0);
}

// ── Ideas ─────────────────────────────────────────────

export async function loadIdeas({ statusFilter = 'all', memberId = null } = {}) {
  let query = supabase
    .from('ideas')
    .select('*, idea_comments(count)')
    .order('created_at', { ascending: false })
  if (statusFilter !== 'all') {
    if (statusFilter === 'mine' && memberId) query = query.eq('member_id', memberId)
    else if (statusFilter !== 'mine') query = query.eq('status', statusFilter)
  }
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(r => ({
    ...r,
    commentCount: r.idea_comments?.[0]?.count ?? 0,
  }))
}

export async function createIdea({ memberId, title, description }) {
  const { data, error } = await supabase
    .from('ideas')
    .insert({ member_id: memberId, title, description, status: 'pending' })
    .select().single()
  if (error) throw error
  return data
}

export async function updateIdeaStatus(ideaId, status) {
  const { error } = await supabase
    .from('ideas').update({ status }).eq('id', ideaId)
  if (error) throw error
}

export async function loadIdeaComments(ideaId) {
  const { data, error } = await supabase
    .from('idea_comments')
    .select('*')
    .eq('idea_id', ideaId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addIdeaComment({ ideaId, memberId, content, type = 'comment' }) {
  const { data, error } = await supabase
    .from('idea_comments')
    .insert({ idea_id: ideaId, member_id: memberId, content, type })
    .select().single()
  if (error) throw error
  return data
}

export async function loadAllReportsForDate(date) {
  const { data, error } = await supabase
    .from('daily_reports')
    .select('*')
    .eq('date', date)
  if (error) throw error
  return data || []
}

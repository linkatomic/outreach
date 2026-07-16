import { supabase } from './supabase.js'

const MAX_RUNS = 25

async function uid() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id || null
}

function toEntry(row) {
  return {
    id:          row.id,
    savedAt:     row.saved_at,
    targetEmail: row.target_email,
    websiteText: row.website_text,
    results:     row.results || [],
    sheetUrl:    row.sheet_url,
    partial:     row.partial,
  }
}

function upsertLocal(prev, entry) {
  const idx = prev.findIndex(e => e.id === entry.id)
  if (idx >= 0) return prev.map(e => e.id === entry.id ? entry : e)
  return [entry, ...prev].slice(0, MAX_RUNS)
}

export async function dbLoadRuns(tool) {
  const userId = await uid()
  if (!userId) return []
  const { data, error } = await supabase
    .from('tool_runs')
    .select('*')
    .eq('user_id', userId)
    .eq('tool', tool)
    .order('saved_at', { ascending: false })
    .limit(MAX_RUNS)
  if (error) { console.error('tool_runs fetch:', error.message); return [] }
  return (data || []).map(toEntry)
}

export async function dbSaveRun(tool, entry) {
  const userId = await uid()
  if (!userId) return
  const { error } = await supabase.from('tool_runs').upsert({
    id:           entry.id,
    user_id:      userId,
    tool,
    saved_at:     entry.savedAt,
    target_email: entry.targetEmail || null,
    website_text: entry.websiteText || null,
    results:      entry.results || [],
    sheet_url:    entry.sheetUrl || null,
    partial:      entry.partial || false,
  })
  if (error) console.error('tool_runs upsert:', error.message)
}

export async function dbDeleteRun(id) {
  const userId = await uid()
  if (!userId) return
  const { error } = await supabase.from('tool_runs').delete().eq('id', id).eq('user_id', userId)
  if (error) console.error('tool_runs delete:', error.message)
}

export async function dbClearRuns(tool) {
  const userId = await uid()
  if (!userId) return
  const { error } = await supabase.from('tool_runs').delete().eq('user_id', userId).eq('tool', tool)
  if (error) console.error('tool_runs clear:', error.message)
}

export { upsertLocal }

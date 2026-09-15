// Populates the mutable TEAM / LC_TEAM / LC_STAFF / DUAL_ACCESS_IDS containers
// from Supabase. Call once at app boot (before the authenticated app renders)
// and again any time the roster changes (e.g. after the Admin page saves).
import { TEAM, DUAL_ACCESS_IDS } from '../data.jsx'
import { LC_TEAM, LC_STAFF } from '../pages/LiveChatTeam.jsx'
import { loadRoster as fetchRosterRows } from './supabase.js'

function shape(row) {
  return {
    id: row.member_id,
    name: row.name,
    short: row.short,
    role: row.role,
    color: row.color,
    email: row.email || '',
    joined: row.joined_date,
    core_tasks: row.core_tasks || [],
  }
}

export async function loadAndApplyRoster() {
  const rows = await fetchRosterRows()

  const outreach = rows.filter(r => (r.teams || []).includes('outreach')).map(shape)
  const lcAgents = rows.filter(r => (r.teams || []).includes('livechat') && r.role === 'livechat').map(shape)
  const lcAll = rows.filter(r => (r.teams || []).includes('livechat')).map(shape)

  TEAM.length = 0; TEAM.push(...outreach)
  LC_TEAM.length = 0; LC_TEAM.push(...lcAgents)
  LC_STAFF.length = 0; LC_STAFF.push(...lcAll)

  DUAL_ACCESS_IDS.clear()
  rows.filter(r => r.dual_access).forEach(r => DUAL_ACCESS_IDS.add(r.member_id))
}

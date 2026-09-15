import { Icon } from '../data.jsx'

// LC_TEAM and LC_STAFF are mutable containers populated at runtime from
// Supabase (src/lib/roster.js) — there is no hardcoded roster anymore.
// LC_TEAM: livechat-role agents only, displayed on the Team page.
// LC_STAFF: all livechat-department users including non-agent roles (HR etc.)
// — used for super admin impersonation.
export const LC_TEAM = []
export const LC_STAFF = []

const ROLE_LABEL = { lead: 'Team Lead', member: 'Member', livechat: 'Agent', hr: 'HR' }
const COLOR_MAP  = { a: '#a3e635', b: '#60a5fa', c: '#f472b6', d: '#fb923c', e: '#a78bfa', f: '#34d399', g: '#fbbf24', h: '#38bdf8', i: '#2dd4bf' }

export function LiveChatTeam() {
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="sub">Live Chat department · {LC_TEAM.length} {LC_TEAM.length === 1 ? 'member' : 'members'}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {LC_TEAM.map(m => (
          <div key={m.id} className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: `color-mix(in srgb, ${COLOR_MAP[m.color] || '#a3e635'} 18%, transparent)`, display: 'grid', placeItems: 'center', color: COLOR_MAP[m.color] || '#a3e635', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>
              {m.short}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>{m.email}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--accent)' }}>
                {ROLE_LABEL[m.role] || m.role}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                Since {new Date(m.joined).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

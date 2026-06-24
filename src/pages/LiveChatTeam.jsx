import { Icon } from '../data.jsx'

// LC_TEAM is managed here — add members as the team grows
// LC_TEAM: displayed on the Team page
export const LC_TEAM = [
  { id: 'dev',     name: 'Dev Pandya', short: 'DP', role: 'livechat', color: 'a', email: 'dev.p@amrytt.com',     joined: '2026-06-01' },
  { id: 'bhavan',  name: 'Bhavan C',   short: 'BC', role: 'livechat', color: 'b', email: 'bhavan.c@amrytt.com',  joined: '2026-06-01' },
  { id: 'nagji',   name: 'Nagji R',    short: 'NR', role: 'livechat', color: 'e', email: 'nagji.r@amrytt.com',   joined: '2026-06-01' },
  { id: 'kanaiya', name: 'Kanaiya K',  short: 'KK', role: 'livechat', color: 'd', email: 'kanaiya.k@amrytt.com', joined: '2026-06-16' },
  { id: 'nilesh',  name: 'Nilesh P',   short: 'NP', role: 'livechat', color: 'f', email: 'nilesh.p@amrytt.com',  joined: '2026-06-16' },
  { id: 'shailesh', name: 'Shailesh C', short: 'SC', role: 'livechat', color: 'g', email: 'shailesh.c@amrytt.com', joined: '2026-06-20' },
  { id: 'amit',     name: 'Amit G',     short: 'AG', role: 'livechat', color: 'h', email: 'amit.g@amrytt.com',     joined: '2026-06-24' },
]

// LC_STAFF: all LC-side users including non-team roles (HR etc.) — used for super admin impersonation
export const LC_STAFF = [
  ...LC_TEAM,
  { id: 'kirti', name: 'Kirti P', short: 'KP', role: 'hr', color: 'c', email: 'kirti.p@amrytt.com', joined: '2026-06-01' },
]

const ROLE_LABEL = { lead: 'Team Lead', member: 'Member', livechat: 'Agent', hr: 'HR' }
const COLOR_MAP  = { a: '#a3e635', b: '#60a5fa', c: '#f472b6', d: '#fb923c', e: '#a78bfa', f: '#34d399', g: '#fbbf24', h: '#38bdf8' }

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

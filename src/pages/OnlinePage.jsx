import { Icon } from '../data.jsx'

const ROUTE_LABELS = {
  home: 'Home', report: 'Daily Report', emails: 'Email Log',
  analytics: 'Analytics', team: 'Team', ideas: 'Ideas', tasks: 'Tasks',
  tools: 'Tools', review: 'Review Queue', leaderboard: 'Leaderboard',
  brief: 'Brief', settings: 'Settings', shortcuts: 'Shortcuts',
  'lc-home': 'LC Home', 'lc-clients': 'Clients',
  'lc-orders': 'Order Sheet', 'lc-team': 'LC Team',
  online: 'Active Users',
}

const ROLE_LABEL = { lead: 'Team Lead', super: 'Super Admin', hr: 'HR', livechat: 'Agent', member: 'Member' }
const COLOR_MAP  = { a: '#a3e635', b: '#60a5fa', c: '#f472b6', d: '#fb923c', e: '#a78bfa', f: '#34d399' }

function UserRow({ user, isOnline, presenceInfo }) {
  const color = COLOR_MAP[user.color] || '#a3e635'
  const currentPage = isOnline && presenceInfo?.route ? ROUTE_LABELS[presenceInfo.route] : null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 16px', opacity: isOnline ? 1 : 0.4, transition: 'opacity .2s' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9,
          background: `color-mix(in srgb, ${color} 15%, transparent)`,
          display: 'grid', placeItems: 'center',
          color, fontWeight: 800, fontSize: 14,
        }}>{user.short}</div>
        <div style={{
          position: 'absolute', bottom: -1, right: -1,
          width: 11, height: 11, borderRadius: '50%',
          background: isOnline ? '#22c55e' : 'var(--surface)',
          border: `2px solid var(--bg)`,
          boxShadow: isOnline ? '0 0 0 2px rgba(34,197,94,.2)' : 'none',
          transition: 'background .3s',
        }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{user.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>
          {ROLE_LABEL[user.role] || user.role}
          {currentPage && currentPage !== 'Active Users' && (
            <> &middot; <span style={{ color: 'var(--accent)' }}>{currentPage}</span></>
          )}
        </div>
      </div>

      <div style={{
        fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 6,
        background: isOnline ? 'rgba(34,197,94,.1)' : 'var(--surface)',
        color: isOnline ? '#22c55e' : 'var(--text-faint)',
        border: `1px solid ${isOnline ? 'rgba(34,197,94,.2)' : 'var(--border)'}`,
        flexShrink: 0,
      }}>
        {isOnline ? 'Online' : 'Offline'}
      </div>
    </div>
  )
}

function Group({ title, users, onlineIds, presenceData }) {
  const onlineCount = users.filter(u => onlineIds.has(u.id)).length
  const sorted = [...users].sort((a, b) => {
    const ao = onlineIds.has(a.id) ? 0 : 1
    const bo = onlineIds.has(b.id) ? 0 : 1
    return ao - bo || a.name.localeCompare(b.name)
  })

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        {title}
        <span style={{
          fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600,
          background: onlineCount > 0 ? 'rgba(34,197,94,.1)' : 'var(--surface)',
          color: onlineCount > 0 ? '#22c55e' : 'var(--text-faint)',
          border: `1px solid ${onlineCount > 0 ? 'rgba(34,197,94,.2)' : 'var(--border)'}`,
        }}>{onlineCount} / {users.length}</span>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {sorted.map((u, i) => (
          <div key={u.id}>
            {i > 0 && <div style={{ borderTop: '1px solid var(--border)', marginLeft: 68 }} />}
            <UserRow user={u} isOnline={onlineIds.has(u.id)} presenceInfo={presenceData[u.id]} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function OnlinePage({ allUsers, onlineIds, presenceData = {} }) {
  const outreach = allUsers.filter(u => ['member', 'lead', 'super', 'hr'].includes(u.role))
  const livechat = allUsers.filter(u => u.role === 'livechat')
  const totalOnline = allUsers.filter(u => onlineIds.has(u.id)).length

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <div className="page-head">
        <div>
          <h1>Active Users</h1>
          <div className="sub">{totalOnline} of {allUsers.length} members currently online</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 3px rgba(34,197,94,.2)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>Live</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {outreach.length > 0 && (
          <Group title="Outreach" users={outreach} onlineIds={onlineIds} presenceData={presenceData} />
        )}
        {livechat.length > 0 && (
          <Group title="Live Chat" users={livechat} onlineIds={onlineIds} presenceData={presenceData} />
        )}
      </div>
    </div>
  )
}

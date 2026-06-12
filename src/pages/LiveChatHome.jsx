import { useState, useEffect } from 'react'
import { Icon } from '../data.jsx'
import { loadLivechatClients } from '../lib/supabase.js'

export function LiveChatHome({ me }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadLivechatClients()
      .then(setClients)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const active    = clients.filter(c => c.status === 'active')
  const buyers    = clients.filter(c => c.client_type === 'buyer')
  const resellers = clients.filter(c => c.client_type === 'reseller')

  const stats = [
    { label: 'Total Clients',  value: loading ? '—' : clients.length,    icon: 'users',    color: 'var(--accent)' },
    { label: 'Active',         value: loading ? '—' : active.length,     icon: 'check',    color: '#4ade80' },
    { label: 'Buyers',         value: loading ? '—' : buyers.length,     icon: 'inbox',    color: '#60a5fa' },
    { label: 'Resellers',      value: loading ? '—' : resellers.length,  icon: 'building', color: '#f59e0b' },
  ]

  const recentClients = [...clients]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1>Live Chat</h1>
          <div className="sub">Welcome back, {me?.name?.split(' ')[0]}</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.label} className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>{s.label}</span>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: `color-mix(in srgb, ${s.color} 15%, transparent)`, display: 'grid', placeItems: 'center', color: s.color }}>
                <Icon name={s.icon} size={13} />
              </div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Recent clients */}
      <div className="card">
        <div className="card-head">
          <h3>Recent Clients</h3>
        </div>
        {loading ? (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading…</div>
        ) : recentClients.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            No clients yet — add one in Tools → Client Manager
          </div>
        ) : (
          <div>
            {recentClients.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  {c.client_name.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.client_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>
                    {c.client_type === 'buyer' ? 'Buyer' : 'Reseller'}
                    {c.article_cost ? ` · $${c.article_cost}/article` : ''}
                    {c.permanent_discount ? ` · ${c.permanent_discount}% disc` : ''}
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                  padding: '3px 8px', borderRadius: 4,
                  background: c.status === 'active' ? 'rgba(74,222,128,.12)' : c.status === 'paused' ? 'rgba(251,191,36,.12)' : 'rgba(248,113,113,.12)',
                  color: c.status === 'active' ? '#4ade80' : c.status === 'paused' ? '#fbbf24' : '#f87171',
                }}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useRef } from 'react'
import { TEAM } from '../data.jsx'
import { LC_STAFF } from './LiveChatTeam.jsx'

// All avatar color slots with their visual hex
const COLOR_SLOTS = [
  { id: 'a', from: '#2A4858', to: '#1A2C36', label: 'Teal' },
  { id: 'b', from: '#4C3A66', to: '#2A1F3A', label: 'Purple' },
  { id: 'c', from: '#654A2C', to: '#3A2A18', label: 'Brown' },
  { id: 'd', from: '#2C5C42', to: '#18361F', label: 'Green' },
  { id: 'e', from: '#5C2C3F', to: '#381822', label: 'Rose' },
  { id: 'f', from: '#3F4D5C', to: '#1F2832', label: 'Slate' },
  { id: 'g', from: '#5C3D1E', to: '#3A2410', label: 'Amber' },
  { id: 'h', from: '#1E4D5C', to: '#102832', label: 'Sky' },
  { id: 'i', from: '#4A5C1E', to: '#2A3810', label: 'Olive' },
  { id: 'j', from: '#5C1E4A', to: '#38102A', label: 'Magenta' },
]

function usedColors() {
  const all = [...TEAM, ...LC_STAFF]
  return new Set(all.map(m => m.color))
}

function derivedFields(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const short = parts.map(w => w[0]?.toUpperCase() || '').join('').slice(0, 3)
  const memberId = parts[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
  return { short, memberId }
}

function CopyBox({ label, value }) {
  const [ok, setOk] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 2000) })
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <button onClick={copy} style={{ fontSize: 11, fontWeight: 700, background: ok ? 'rgba(92,255,161,.15)' : 'var(--surface-3)', color: ok ? 'var(--ok)' : 'var(--text-dim)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
          {ok ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.7 }}>
        {value}
      </pre>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle = {
  padding: '9px 12px', border: '1px solid var(--border-strong)', borderRadius: 8,
  background: 'var(--surface)', color: 'var(--text)', fontSize: 13,
  fontFamily: 'var(--font-sans)', outline: 'none', width: '100%', boxSizing: 'border-box',
}

const selStyle = { ...inputStyle, cursor: 'pointer' }

export function AdminPage() {
  const [name,   setName]   = useState('')
  const [email,  setEmail]  = useState('')
  const [uid,    setUid]    = useState('')
  const [team,   setTeam]   = useState('outreach')
  const [role,   setRole]   = useState('member')
  const [color,  setColor]  = useState('')
  const [joined, setJoined] = useState(new Date().toISOString().slice(0, 10))
  const [showResult, setShowResult] = useState(false)

  const { short, memberId } = derivedFields(name)
  const used = usedColors()

  // Pick first unused color as default suggestion
  const suggestedColor = COLOR_SLOTS.find(c => !used.has(c.id))?.id || 'a'
  const activeColor = color || suggestedColor

  // Effective role: livechat members get role 'livechat' in DB
  const dbRole = team === 'livechat' && role === 'member' ? 'livechat' : role

  const sql = `INSERT INTO user_profiles (id, member_id, role, name, short, color)
VALUES ('${uid || '<UID>'}', '${memberId || '<member_id>'}', '${dbRole}', '${name || '<Name>'}', '${short || '<Short>'}', '${activeColor}');`

  const codeFile = team === 'outreach' ? 'src/data.jsx' : 'src/pages/LiveChatTeam.jsx'
  const codeArray = team === 'outreach' ? 'TEAM' : 'LC_STAFF'
  const codeSnippet = `// Add to ${codeArray} array in ${codeFile}:\n{ id: '${memberId || '<id>'}', name: '${name || '<Name>'}', short: '${short || '<Short>'}', role: '${dbRole}', color: '${activeColor}', email: '${email || '<email>'}', joined: '${joined}' },`

  const canGenerate = name.trim() && uid.trim() && email.trim()

  const allOutreach = TEAM
  const allLc = LC_STAFF

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <div className="sub">Manage team members across Outreach and Live Chat.</div>
        </div>
      </div>

      {/* Current members */}
      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Outreach Team · {allOutreach.length} members
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginBottom: 28 }}>
          {allOutreach.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div className={`avatar ${m.color}`}>{m.short}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: m.role === 'lead' ? 'rgba(210,254,92,.15)' : 'var(--surface-3)', color: m.role === 'lead' ? 'var(--accent)' : 'var(--text-faint)' }}>
                {m.role}
              </span>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Live Chat Team · {allLc.length} members
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {allLc.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div className={`avatar ${m.color}`}>{m.short}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'var(--surface-3)', color: 'var(--text-faint)' }}>
                {m.role}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Add member form */}
      <section style={{ maxWidth: 680 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Add New Member
        </h2>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <Field label="Full name">
              <input style={inputStyle} value={name} onChange={e => { setName(e.target.value); setShowResult(false) }} placeholder="Yaksh B" />
            </Field>
            <Field label="Email">
              <input style={inputStyle} value={email} onChange={e => { setEmail(e.target.value); setShowResult(false) }} placeholder="yaksh.b@amrytt.com" />
            </Field>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Field label="Supabase UID (from Supabase → Auth → Users)">
              <input style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 12 }} value={uid} onChange={e => { setUid(e.target.value.trim()); setShowResult(false) }} placeholder="b0df62b0-47fd-41ca-9d13-655b088cbf30" />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
            <Field label="Team">
              <select style={selStyle} value={team} onChange={e => { setTeam(e.target.value); setRole(e.target.value === 'livechat' ? 'member' : 'member'); setShowResult(false) }}>
                <option value="outreach">Outreach</option>
                <option value="livechat">Live Chat</option>
              </select>
            </Field>
            <Field label="Role">
              <select style={selStyle} value={role} onChange={e => { setRole(e.target.value); setShowResult(false) }}>
                <option value="member">Member</option>
                <option value="lead">Lead</option>
                {team === 'outreach' && <option value="hr">HR</option>}
                {team === 'outreach' && <option value="super">Super</option>}
              </select>
            </Field>
            <Field label="Joined date">
              <input style={inputStyle} type="date" value={joined} onChange={e => { setJoined(e.target.value); setShowResult(false) }} />
            </Field>
          </div>

          {/* Color picker */}
          <Field label={`Avatar color · "${activeColor}" selected`}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 2 }}>
              {COLOR_SLOTS.map(c => {
                const isUsed = used.has(c.id) && c.id !== activeColor
                const isActive = c.id === activeColor
                return (
                  <button
                    key={c.id}
                    title={`${c.label} (${c.id})${isUsed ? ' — in use' : ''}`}
                    onClick={() => { setColor(c.id); setShowResult(false) }}
                    style={{
                      width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: `linear-gradient(135deg, ${c.from}, ${c.to})`,
                      outline: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                      outlineOffset: 2, opacity: isUsed ? 0.35 : 1,
                      position: 'relative', fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.8)',
                    }}
                  >
                    {c.id.toUpperCase()}
                    {isUsed && <span style={{ position: 'absolute', bottom: 2, right: 3, fontSize: 8, color: 'rgba(255,255,255,.5)' }}>✓</span>}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>Faded = already assigned. Suggestion: <strong>{suggestedColor.toUpperCase()}</strong></div>
          </Field>

          {/* Derived preview */}
          {name.trim() && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className={`avatar ${activeColor}`}>{short || '?'}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>id: <code style={{ fontFamily: 'var(--font-mono)' }}>{memberId || '—'}</code> · short: <code style={{ fontFamily: 'var(--font-mono)' }}>{short || '—'}</code> · team: {team} · role: {dbRole}</div>
              </div>
            </div>
          )}

          <button
            disabled={!canGenerate}
            onClick={() => setShowResult(true)}
            style={{
              marginTop: 20, width: '100%', padding: '11px', border: 'none', borderRadius: 8,
              background: canGenerate ? 'var(--accent)' : 'var(--surface-3)',
              color: canGenerate ? 'var(--accent-ink)' : 'var(--text-ghost)',
              fontWeight: 700, fontSize: 14, cursor: canGenerate ? 'pointer' : 'default',
              fontFamily: 'var(--font-sans)', transition: 'background .15s',
            }}
          >
            Generate SQL + Code Snippet
          </button>
        </div>

        {showResult && (
          <div style={{ marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Two steps to complete:</div>
              <ol style={{ margin: '8px 0 0', padding: '0 0 0 18px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 2 }}>
                <li>Run the SQL in <strong>Supabase → SQL Editor</strong></li>
                <li>Add the code line to <strong>{codeFile}</strong> inside the {codeArray} array, then push to GitHub (Vercel auto-deploys)</li>
              </ol>
            </div>

            <CopyBox label="Step 1 · Supabase SQL" value={sql} />
            <CopyBox label={`Step 2 · Code line for ${codeFile}`} value={codeSnippet} />
          </div>
        )}
      </section>
    </div>
  )
}

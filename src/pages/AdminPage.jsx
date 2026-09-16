import { useState, useEffect } from 'react'
import { Icon, CORE_TASK_ICONS } from '../data.jsx'
import { TOOLS } from './Tools.jsx'
import {
  loadFullRoster, adminCreateUser, adminUpdateProfile, adminSetActive,
  adminDeleteUser, adminResetPassword, loadToolAccess, adminUpdateToolAccess,
} from '../lib/supabase.js'
import { loadAndApplyRoster } from '../lib/roster.js'

// ─────────── Shared bits ───────────

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

const ROLE_OPTIONS = [
  { id: 'member',     label: 'Member' },
  { id: 'lead',       label: 'Lead' },
  { id: 'hr',         label: 'HR' },
  { id: 'super',      label: 'Super' },
  { id: 'livechat',   label: 'Live Chat Agent' },
  { id: 'tools-only', label: 'Tools Only (no other page access)' },
]
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map(r => [r.id, r.label]))

function derivedFields(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const short = parts.map(w => w[0]?.toUpperCase() || '').join('').slice(0, 3)
  return { short }
}

function usedColors(rows, excludeId) {
  return new Set(rows.filter(r => r.id !== excludeId).map(r => r.color))
}

function missingFieldsHint({ name, email, password, teams }) {
  const missing = []
  if (!name?.trim()) missing.push('full name')
  if (!email?.trim()) missing.push('email')
  if (password !== undefined && password.trim().length < 8) missing.push('a password of 8+ characters')
  if (!teams?.length) missing.push('at least one team')
  return missing.length ? `Missing: ${missing.join(', ')}` : ''
}

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
  let out = ''
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

const inputStyle = {
  padding: '9px 12px', border: '1px solid var(--border-strong)', borderRadius: 8,
  background: 'var(--surface)', color: 'var(--text)', fontSize: 13,
  fontFamily: 'var(--font-sans)', outline: 'none', width: '100%', boxSizing: 'border-box',
}
const selStyle = { ...inputStyle, cursor: 'pointer' }
const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function CopyBox({ label, value }) {
  const [ok, setOk] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 2000) })
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={labelStyle}>{label}</span>
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

function ColorPicker({ value, onChange, rows, excludeId }) {
  const used = usedColors(rows, excludeId)
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 2 }}>
      {COLOR_SLOTS.map(c => {
        const isUsed = used.has(c.id) && c.id !== value
        const isActive = c.id === value
        return (
          <button
            key={c.id} type="button"
            title={`${c.label} (${c.id})${isUsed ? ' — in use' : ''}`}
            onClick={() => onChange(c.id)}
            style={{
              width: 34, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer',
              background: `linear-gradient(135deg, ${c.from}, ${c.to})`,
              outline: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              outlineOffset: 2, opacity: isUsed ? 0.4 : 1,
              fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.8)',
            }}
          >{c.id.toUpperCase()}</button>
        )
      })}
    </div>
  )
}

function TeamCheckboxes({ value, onChange }) {
  const opts = [{ id: 'outreach', label: 'Outreach' }, { id: 'livechat', label: 'Live Chat' }]
  function toggle(id) {
    onChange(value.includes(id) ? value.filter(t => t !== id) : [...value, id])
  }
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      {opts.map(o => (
        <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}

// ─────────── Responsibilities (core_tasks) editor ───────────

function slugify(label) {
  return 'core_' + label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

function ResponsibilityRow({ task, onChange, onRemove }) {
  function set(field, val) { onChange({ ...task, [field]: val }) }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <Field label="Label">
          <input style={inputStyle} value={task.label}
                 onChange={e => { const label = e.target.value; onChange({ ...task, label, key: task._autoKey === true ? slugify(label || 'task') : task.key }) }}
                 placeholder="e.g. Client Requirements Outreach" />
        </Field>
        <Field label="Icon">
          <select style={selStyle} value={task.icon || 'mail'} onChange={e => set('icon', e.target.value)}>
            {CORE_TASK_ICONS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <Field label="Priority">
          <select style={selStyle} value={task.role} onChange={e => set('role', e.target.value)}>
            <option value="primary">Primary (hard target)</option>
            <option value="secondary">Secondary (backup)</option>
          </select>
        </Field>
        <Field label="Type">
          <select style={selStyle} value={task.type || 'number'} onChange={e => set('type', e.target.value === 'checkbox' ? 'checkbox' : undefined)}>
            <option value="number">Numeric target</option>
            <option value="checkbox">Checkbox (done/not done)</option>
          </select>
        </Field>
        {task.type === 'checkbox' ? (
          <Field label="Must complete">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, height: 36 }}>
              <input type="checkbox" checked={!!task.mustComplete} onChange={e => set('mustComplete', e.target.checked)} />
              Counts as missed if unchecked
            </label>
          </Field>
        ) : (
          <Field label="Target">
            <input style={inputStyle} type="number" min="0" value={task.target ?? 0} onChange={e => set('target', Number(e.target.value) || 0)} />
          </Field>
        )}
        <Field label="Target label">
          <input style={inputStyle} value={task.targetLabel || ''} onChange={e => set('targetLabel', e.target.value)} placeholder="e.g. 25 responses" />
        </Field>
      </div>

      <Field label="Description">
        <input style={inputStyle} value={task.desc || ''} onChange={e => set('desc', e.target.value)} placeholder="What this responsibility covers" />
      </Field>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{task.key}</span>
        <button type="button" onClick={onRemove} style={{ fontSize: 12, fontWeight: 700, color: '#fb7185', background: 'none', border: 'none', cursor: 'pointer' }}>
          Remove
        </button>
      </div>
    </div>
  )
}

function ResponsibilitiesEditor({ tasks, onChange }) {
  function update(i, task) { const next = [...tasks]; next[i] = task; onChange(next) }
  function remove(i) { onChange(tasks.filter((_, idx) => idx !== i)) }
  function add() {
    onChange([...tasks, { key: `core_task_${Date.now()}`, label: '', unit: '', target: 0, targetLabel: '', role: 'primary', icon: 'mail', desc: '', _autoKey: true }])
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {tasks.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 0' }}>
          No responsibilities assigned. Members with none only see the standard daily metrics.
        </div>
      )}
      {tasks.map((t, i) => (
        <ResponsibilityRow key={i} task={t} onChange={task => update(i, task)} onRemove={() => remove(i)} />
      ))}
      <button type="button" onClick={add} className="btn ghost" style={{ alignSelf: 'flex-start' }}>
        <Icon name="plus" size={12} />Add responsibility
      </button>
    </div>
  )
}

// ─────────── Create user modal ───────────

function CreateUserModal({ rows, onClose, onCreated }) {
  const [name, setName]     = useState('')
  const [email, setEmail]   = useState('')
  const [password, setPassword] = useState(genPassword())
  const [role, setRole]     = useState('member')
  const [teams, setTeams]   = useState(['outreach'])
  const [dualAccess, setDualAccess] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [created, setCreated] = useState(null)

  const canSubmit = name.trim() && email.trim() && password.trim().length >= 8 && teams.length > 0

  async function handleCreate() {
    setSaving(true); setError('')
    try {
      const { profile } = await adminCreateUser({ name: name.trim(), email: email.trim(), password, role, teams, dualAccess })
      await loadAndApplyRoster()
      setCreated(profile)
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (created) {
    return (
      <div className="modal-back" onClick={onClose}>
        <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
          <div className="modal-head"><h2>User created</h2><button className="btn ghost" onClick={onClose}><Icon name="x" size={13} /></button></div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className={`avatar ${created.color}`}>{created.short}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{created.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{created.email} · {ROLE_LABEL[created.role]}</div>
              </div>
            </div>
            <CopyBox label="Password — share with them securely, then have them sign in and change it" value={password} />
          </div>
          <div className="modal-foot"><button className="btn primary" onClick={onClose}>Done</button></div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h2>New user</h2><button className="btn ghost" onClick={onClose}><Icon name="x" size={13} /></button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Full name">
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Yaksh B" />
            </Field>
            <Field label="Email (login)">
              <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="yaksh.b@amrytt.com" />
            </Field>
          </div>

          <Field label="Password">
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={inputStyle} value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" className="btn ghost" onClick={() => setPassword(genPassword())}>Generate</button>
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Role">
              <select style={selStyle} value={role} onChange={e => setRole(e.target.value)}>
                {ROLE_OPTIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Teams">
              <TeamCheckboxes value={teams} onChange={setTeams} />
            </Field>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={dualAccess} onChange={e => setDualAccess(e.target.checked)} />
            Dual access — unlock the other department's navigation for this person (without changing their role)
          </label>

          {name.trim() && (
            <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="avatar a">{derivedFields(name).short || '?'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Short name and avatar color are assigned automatically.</div>
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: '#fb7185' }}>{error}</div>}
        </div>
        <div className="modal-foot">
          {!canSubmit && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginRight: 'auto' }}>{missingFieldsHint({ name, email, password, teams })}</span>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canSubmit || saving} onClick={handleCreate}>
            {saving ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────── Edit user modal ───────────

function EditUserModal({ user, rows, onClose, onSaved }) {
  const [name, setName]   = useState(user.name)
  const [email, setEmail] = useState(user.email || '')
  const [role, setRole]   = useState(user.role)
  const [teams, setTeams] = useState(user.teams || [])
  const [color, setColor] = useState(user.color)
  const [joinedDate, setJoinedDate] = useState(user.joined_date || '')
  const [dualAccess, setDualAccess] = useState(!!user.dual_access)
  const [coreTasks, setCoreTasks] = useState(user.core_tasks || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('profile')

  const canSubmit = name.trim() && email.trim() && teams.length > 0

  async function handleSave() {
    setSaving(true); setError('')
    try {
      const cleanTasks = coreTasks.map(({ _autoKey, ...t }) => t)
      const trimmedName = name.trim()
      await adminUpdateProfile(user.id, {
        name: trimmedName, short: derivedFields(trimmedName).short, email: email.trim(), role, teams, color,
        joined_date: joinedDate, dual_access: dualAccess, core_tasks: cleanTasks,
      })
      await loadAndApplyRoster()
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Edit {user.name}</h2>
          <button className="btn ghost" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '10px 20px 0' }}>
          {[['profile', 'Profile'], ['responsibilities', 'Responsibilities']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
                    style={{
                      padding: '7px 12px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)',
                      background: tab === id ? 'var(--surface-2)' : 'transparent',
                      color: tab === id ? 'var(--text)' : 'var(--text-faint)',
                    }}>
              {label}
            </button>
          ))}
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflowY: 'auto' }}>
          {tab === 'profile' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Full name">
                  <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
                </Field>
                <Field label="Email (login)">
                  <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} />
                </Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Role">
                  <select style={selStyle} value={role} onChange={e => setRole(e.target.value)}>
                    {ROLE_OPTIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </Field>
                <Field label="Teams">
                  <TeamCheckboxes value={teams} onChange={setTeams} />
                </Field>
              </div>

              <Field label="Joined date">
                <input style={inputStyle} type="date" value={joinedDate} onChange={e => setJoinedDate(e.target.value)} />
              </Field>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={dualAccess} onChange={e => setDualAccess(e.target.checked)} />
                Dual access — unlock the other department's navigation for this person
              </label>

              <Field label="Avatar color">
                <ColorPicker value={color} onChange={setColor} rows={rows} excludeId={user.id} />
              </Field>
            </>
          ) : (
            <ResponsibilitiesEditor tasks={coreTasks} onChange={setCoreTasks} />
          )}

          {error && <div style={{ fontSize: 12, color: '#fb7185' }}>{error}</div>}
        </div>

        <div className="modal-foot">
          {!canSubmit && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginRight: 'auto' }}>{missingFieldsHint({ name, email, teams })}</span>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canSubmit || saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────── Reset password modal ───────────

function ResetPasswordModal({ user, onClose }) {
  const [password, setPassword] = useState(genPassword())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleReset() {
    setSaving(true); setError('')
    try {
      const { password: finalPassword } = await adminResetPassword(user.id, password)
      setPassword(finalPassword)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h2>Reset password — {user.name}</h2><button className="btn ghost" onClick={onClose}><Icon name="x" size={13} /></button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {done ? (
            <CopyBox label="New password — share with them securely" value={password} />
          ) : (
            <Field label="New password">
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={inputStyle} value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" className="btn ghost" onClick={() => setPassword(genPassword())}>Generate</button>
              </div>
            </Field>
          )}
          {error && <div style={{ fontSize: 12, color: '#fb7185' }}>{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
          {!done && <button className="btn primary" disabled={saving || password.length < 8} onClick={handleReset}>{saving ? 'Resetting…' : 'Reset password'}</button>}
        </div>
      </div>
    </div>
  )
}

// ─────────── Delete confirm modal ───────────

function DeleteConfirmModal({ user, onClose, onDeleted }) {
  const [confirmText, setConfirmText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    setSaving(true); setError('')
    try {
      await adminDeleteUser(user.id)
      await loadAndApplyRoster()
      onDeleted()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h2>Delete {user.name}?</h2><button className="btn ghost" onClick={onClose}><Icon name="x" size={13} /></button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            This permanently removes their login and roster entry. Their historical daily reports,
            emails and tasks are <strong>not</strong> deleted — those stay under their member ID.
            This can't be undone. Consider <strong>Deactivate</strong> instead if you just want to
            block access.
          </div>
          <Field label={`Type "${user.name}" to confirm`}>
            <input style={inputStyle} value={confirmText} onChange={e => setConfirmText(e.target.value)} />
          </Field>
          {error && <div style={{ fontSize: 12, color: '#fb7185' }}>{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" style={{ background: '#fb7185', color: '#fff' }}
                  disabled={confirmText !== user.name || saving} onClick={handleDelete}>
            {saving ? 'Deleting…' : 'Permanently delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────── User row ───────────

function UserRow({ user, onEdit, onResetPassword, onToggleActive, onDelete }) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', opacity: user.active ? 1 : 0.55 }}>
      <div className={`avatar ${user.color}`}>{user.short}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</span>
          <span className={`chip ${user.role === 'lead' || user.role === 'super' ? 'accent' : ''}`}>{ROLE_LABEL[user.role] || user.role}</span>
          {(user.teams || []).map(t => <span key={t} className="chip">{t}</span>)}
          {user.dual_access && <span className="chip info">dual access</span>}
          {!user.active && <span className="chip danger">deactivated</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.email} · joined {user.joined_date}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button className="btn ghost" onClick={onEdit}>Edit</button>
        <button className="btn ghost" onClick={onResetPassword}>Reset password</button>
        <button className="btn ghost" onClick={onToggleActive}>{user.active ? 'Deactivate' : 'Reactivate'}</button>
        <button className="btn ghost" onClick={onDelete} style={{ color: '#fb7185' }}>Delete</button>
      </div>
    </div>
  )
}

// ─────────── Tool permissions ───────────

function ToolAccessRow({ tool, cfg, rows, onChange }) {
  const [saving, setSaving] = useState(false)
  const section = cfg?.section || tool.section
  const mode = cfg?.mode || 'everyone'
  const allowed = cfg?.allowed_member_ids || []

  async function update(updates) {
    setSaving(true)
    try {
      const updated = await adminUpdateToolAccess(tool.id, updates)
      onChange(tool.id, updated)
    } finally {
      setSaving(false)
    }
  }

  function toggleMember(memberId) {
    const set = new Set(allowed)
    set.has(memberId) ? set.delete(memberId) : set.add(memberId)
    update({ mode: 'selected', allowed_member_ids: [...set] })
  }

  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)', flexShrink: 0 }}>
          <Icon name={tool.icon} size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{tool.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{tool.desc}</div>
        </div>
        <button className="btn ghost" disabled={saving} onClick={() => update({ section: section === 'outreach' ? 'livechat' : 'outreach' })}>
          Move to {section === 'outreach' ? 'Live Chat' : 'Outreach'}
        </button>
      </div>

      <select style={selStyle} value={mode} disabled={saving} onChange={e => update({ mode: e.target.value })}>
        <option value="everyone">Everyone in this section</option>
        <option value="selected">Selected people only</option>
      </select>

      {mode === 'selected' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {rows.filter(r => r.active).map(r => {
            const checked = allowed.includes(r.member_id)
            return (
              <label key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 9px',
                border: '1px solid var(--border)', borderRadius: 6, cursor: saving ? 'default' : 'pointer',
                background: checked ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
              }}>
                <input type="checkbox" checked={checked} disabled={saving} onChange={() => toggleMember(r.member_id)} />
                {r.name}
              </label>
            )
          })}
          {allowed.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No one selected yet — tool is effectively hidden from everyone.</span>
          )}
        </div>
      )}
    </div>
  )
}

function ToolPermissionsTab({ rows }) {
  const [access, setAccess] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadToolAccess().then(setAccess).catch(() => {}).finally(() => setLoading(false))
  }, [])

  function handleChange(toolId, updated) {
    setAccess(prev => ({ ...prev, [toolId]: updated }))
  }

  if (loading) return <div className="card" style={{ padding: 48, textAlign: 'center' }}><span className="muted">Loading…</span></div>

  const outreachTools = TOOLS.filter(t => (access[t.id]?.section || t.section) === 'outreach')
  const livechatTools = TOOLS.filter(t => (access[t.id]?.section || t.section) === 'livechat')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Outreach Tools · {outreachTools.length}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {outreachTools.map(t => <ToolAccessRow key={t.id} tool={t} cfg={access[t.id]} rows={rows} onChange={handleChange} />)}
        </div>
      </section>
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Live Chat Tools · {livechatTools.length}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {livechatTools.map(t => <ToolAccessRow key={t.id} tool={t} cfg={access[t.id]} rows={rows} onChange={handleChange} />)}
        </div>
      </section>
    </div>
  )
}

// ─────────── Page ───────────

export function AdminPage() {
  const [tab, setTab] = useState('team')
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [resetUser, setResetUser] = useState(null)
  const [deleteUser, setDeleteUser] = useState(null)

  async function refresh() {
    setLoading(true); setLoadErr('')
    try {
      setRows(await loadFullRoster())
    } catch (err) {
      setLoadErr(err.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { refresh() }, [])

  async function toggleActive(user) {
    await adminSetActive(user.id, !user.active)
    await loadAndApplyRoster()
    refresh()
  }

  const filtered = rows.filter(r => {
    if (!showInactive && !r.active) return false
    if (teamFilter !== 'all' && !(r.teams || []).includes(teamFilter)) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!r.name.toLowerCase().includes(q) && !(r.email || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <div className="sub">{rows.filter(r => r.active).length} active · {rows.length} total across Outreach and Live Chat</div>
        </div>
        {tab === 'team' && (
          <div className="actions">
            <button className="btn primary" onClick={() => setShowCreate(true)}><Icon name="plus" size={12} />New user</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {[['team', 'Team'], ['tools', 'Tool Permissions']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    background: tab === id ? 'var(--surface-2)' : 'transparent',
                    color: tab === id ? 'var(--text)' : 'var(--text-faint)',
                  }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'tools' ? (
        <ToolPermissionsTab rows={rows} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...inputStyle, maxWidth: 260 }} placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} />
            <select style={{ ...selStyle, maxWidth: 160 }} value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
              <option value="all">All teams</option>
              <option value="outreach">Outreach</option>
              <option value="livechat">Live Chat</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)', cursor: 'pointer' }}>
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show deactivated
            </label>
          </div>

          {loading ? (
            <div className="card" style={{ padding: 48, textAlign: 'center' }}><span className="muted">Loading…</span></div>
          ) : loadErr ? (
            <div className="card" style={{ padding: 24, color: '#fb7185' }}>{loadErr}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(user => (
                <UserRow
                  key={user.id} user={user}
                  onEdit={() => setEditUser(user)}
                  onResetPassword={() => setResetUser(user)}
                  onToggleActive={() => toggleActive(user)}
                  onDelete={() => setDeleteUser(user)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>No users match.</div>
              )}
            </div>
          )}
        </>
      )}

      {showCreate && <CreateUserModal rows={rows} onClose={() => setShowCreate(false)} onCreated={refresh} />}
      {editUser && <EditUserModal user={editUser} rows={rows} onClose={() => setEditUser(null)} onSaved={refresh} />}
      {resetUser && <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} />}
      {deleteUser && <DeleteConfirmModal user={deleteUser} onClose={() => setDeleteUser(null)} onDeleted={refresh} />}
    </div>
  )
}

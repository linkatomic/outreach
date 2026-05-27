import { useState, useEffect, useCallback, useMemo } from 'react'
import { TEAM, Icon } from '../data.jsx'
import { loadTasks, createTask, updateTask, deleteTask } from '../lib/supabase.js'

// ── Config ────────────────────────────────────────────

const STATUS_CFG = {
  todo:        { label: 'To Do',       color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)', dot: '○' },
  in_progress: { label: 'In Progress', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.30)',  dot: '◑' },
  review:      { label: 'Review',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.30)',  dot: '◎' },
  done:        { label: 'Done',        color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.30)',  dot: '✓' },
}

const PRIORITY_CFG = {
  low:    { label: 'Low',    color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.20)', sym: '▽' },
  medium: { label: 'Medium', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.25)',  sym: '▷' },
  high:   { label: 'High',   color: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.30)',  sym: '△' },
  urgent: { label: 'Urgent', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.30)',   sym: '▲' },
}

const STATUS_ORDER   = ['todo', 'in_progress', 'review', 'done']
const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low']
const ASSIGNABLE     = TEAM.filter(m => ['member', 'lead'].includes(m.role))

const LBL = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }

function dueFmt(dateStr) {
  if (!dateStr) return null
  const due   = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff  = Math.round((due - today) / 86400000)
  const lbl   = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (diff < 0) return { text: '⚠ ' + lbl,    color: '#fb7185', overdue: true  }
  if (diff === 0) return { text: 'Today',       color: '#f59e0b', overdue: false }
  if (diff === 1) return { text: 'Tomorrow',    color: '#fb923c', overdue: false }
  if (diff <= 7)  return { text: `In ${diff}d`, color: 'var(--text-dim)', overdue: false }
  return { text: lbl, color: 'var(--text-faint)', overdue: false }
}

// ── Chips ─────────────────────────────────────────────

function StatusChip({ status }) {
  const c = STATUS_CFG[status] || STATUS_CFG.todo
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                   borderRadius: 20, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
                   background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      {c.dot} {c.label}
    </span>
  )
}

function PriorityChip({ priority }) {
  const c = PRIORITY_CFG[priority] || PRIORITY_CFG.medium
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                   borderRadius: 20, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
                   background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      {c.sym} {c.label}
    </span>
  )
}

// ── Task modal ────────────────────────────────────────

function TaskModal({ task, me, onClose, onSave, onDelete }) {
  const isNew = !task
  const [title,       setTitle]      = useState(task?.title       || '')
  const [desc,        setDesc]       = useState(task?.description || '')
  const [assigneeId,  setAssigneeId] = useState(task?.assignee_id || me.id)
  const [status,      setStatus]     = useState(task?.status      || 'todo')
  const [priority,    setPriority]   = useState(task?.priority    || 'medium')
  const [dueDate,     setDueDate]    = useState(task?.due_date    || '')
  const [saving,      setSaving]     = useState(false)

  const canDelete = ['lead', 'super'].includes(me.role) || task?.created_by === me.id
  const creator   = task ? TEAM.find(m => m.id === task.created_by) : null
  const due       = dueDate ? dueFmt(dueDate) : null

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    try {
      await onSave({
        title: title.trim(), description: desc.trim(),
        assignee_id: assigneeId, status, priority,
        due_date: dueDate || null,
      })
      onClose()
    } catch { /* parent shows toast */ }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? '＋ New task' : 'Edit task'}</h2>
          <div style={{ display: 'flex', gap: 4 }}>
            {!isNew && canDelete && (
              <button className="btn ghost" onClick={onDelete} title="Delete task" style={{ color: '#fb7185' }}>
                <Icon name="trash" size={14} />
              </button>
            )}
            <button className="btn ghost" onClick={onClose}><Icon name="x" size={13} /></button>
          </div>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={LBL}>Title *</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)}
                   placeholder="What needs to be done?" style={{ width: '100%' }} autoFocus />
          </div>

          <div>
            <label style={LBL}>Description</label>
            <textarea className="input" value={desc} onChange={e => setDesc(e.target.value)}
                      placeholder="Add context, steps, or links…"
                      style={{ width: '100%', height: 80, resize: 'none', padding: 10, fontSize: 13, lineHeight: 1.6 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Assign to</label>
              <select className="input" value={assigneeId} onChange={e => setAssigneeId(e.target.value)} style={{ width: '100%' }}>
                {ASSIGNABLE.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Status</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value)} style={{ width: '100%' }}>
                {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Priority</label>
              <select className="input" value={priority} onChange={e => setPriority(e.target.value)} style={{ width: '100%' }}>
                {PRIORITY_ORDER.map(p => <option key={p} value={p}>{PRIORITY_CFG[p].label}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Due date</label>
              <input type="date" className="input" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

          {due && (
            <div style={{ fontSize: 12, color: due.color, display: 'flex', alignItems: 'center', gap: 5, marginTop: -6 }}>
              <Icon name="clock" size={11} /> {due.text}
            </div>
          )}

          {!isNew && creator && (
            <div style={{ padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8,
                          fontSize: 11, color: 'var(--text-faint)', display: 'flex', gap: 16 }}>
              <span>Created by <strong style={{ color: 'var(--text-dim)' }}>{creator.name}</strong></span>
              <span>{new Date(task.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleSave} disabled={!title.trim() || saving}>
            {saving ? 'Saving…' : isNew ? 'Create task' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Kanban card ───────────────────────────────────────

function TaskCard({ task, onClick, onMove }) {
  const assignee = TEAM.find(m => m.id === task.assignee_id)
  const due      = task.due_date ? dueFmt(task.due_date) : null
  const pcfg     = PRIORITY_CFG[task.priority] || PRIORITY_CFG.medium
  const sidx     = STATUS_ORDER.indexOf(task.status)

  return (
    <div className="card" onClick={onClick}
         style={{ padding: '12px 14px', cursor: 'pointer', marginBottom: 8,
                  borderLeft: `3px solid ${pcfg.color}`, transition: 'transform 0.1s' }}
         onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
         onMouseLeave={e => e.currentTarget.style.transform = 'none'}>

      <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4, marginBottom: 10,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {task.title}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: due ? 7 : 0 }}>
        <div className={`avatar sm ${assignee?.color}`}>{assignee?.short}</div>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', flex: 1 }}>
          {assignee?.name?.split(' ')[0]}
        </span>
        <PriorityChip priority={task.priority} />
      </div>

      {due && (
        <div style={{ fontSize: 10, color: due.color, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="clock" size={9} /> {due.text}
        </div>
      )}

      {/* Quick-move buttons — stop click from opening modal */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 8 }}
           onClick={e => e.stopPropagation()}>
        {sidx > 0 && (
          <button onClick={() => onMove(STATUS_ORDER[sidx - 1])}
                  style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4,
                           border: '1px solid var(--border)', background: 'var(--surface-2)',
                           color: 'var(--text-faint)', cursor: 'pointer' }}>
            ← Back
          </button>
        )}
        {sidx < STATUS_ORDER.length - 1 && (
          <button onClick={() => onMove(STATUS_ORDER[sidx + 1])}
                  style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4,
                           border: '1px solid var(--border)', background: 'var(--surface-2)',
                           color: 'var(--text-faint)', cursor: 'pointer' }}>
            {STATUS_CFG[STATUS_ORDER[sidx + 1]].label} →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Kanban board ──────────────────────────────────────

const COLS = [
  { id: 'todo',        label: 'To Do',       accent: '#94a3b8' },
  { id: 'in_progress', label: 'In Progress', accent: '#60a5fa' },
  { id: 'review',      label: 'Review',      accent: '#f59e0b' },
  { id: 'done',        label: 'Done',        accent: '#34d399' },
]

function KanbanView({ tasks, onTaskClick, onMove }) {
  return (
    <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
      {COLS.map(col => {
        const colTasks = tasks.filter(t => t.status === col.id)
        return (
          <div key={col.id} style={{ minWidth: 258, width: 258, flexShrink: 0 }}>
            {/* Column header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '4px 0' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: col.accent,
                             display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)' }}>{col.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)',
                             background: 'var(--surface-2)', borderRadius: 20, padding: '1px 8px', fontWeight: 600 }}>
                {colTasks.length}
              </span>
            </div>
            {/* Cards */}
            <div style={{ minHeight: 60 }}>
              {colTasks.length === 0 && (
                <div style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: '20px 10px',
                              textAlign: 'center', fontSize: 11, color: 'var(--text-faint)' }}>
                  No tasks
                </div>
              )}
              {colTasks.map(t => (
                <TaskCard key={t.id} task={t}
                          onClick={() => onTaskClick(t)}
                          onMove={newStatus => onMove(t, newStatus)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── List view ─────────────────────────────────────────

const COL_TPL = '1fr 140px 118px 88px 100px'

function ListView({ tasks, me, onTaskClick,
                    filterStatus, setFilterStatus,
                    filterPriority, setFilterPriority,
                    filterAssignee, setFilterAssignee,
                    sortBy, setSortBy }) {
  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                style={{ width: 'auto', fontSize: 12, height: 30, padding: '0 10px' }}>
          <option value="all">All statuses</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
        </select>

        <select className="input" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
                style={{ width: 'auto', fontSize: 12, height: 30, padding: '0 10px' }}>
          <option value="all">All priorities</option>
          {PRIORITY_ORDER.map(p => <option key={p} value={p}>{PRIORITY_CFG[p].label}</option>)}
        </select>

        <select className="input" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
                style={{ width: 'auto', fontSize: 12, height: 30, padding: '0 10px' }}>
          <option value="all">All members</option>
          <option value={me.id}>My tasks</option>
          {ASSIGNABLE.filter(m => m.id !== me.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)}
                style={{ width: 'auto', fontSize: 12, height: 30, padding: '0 10px' }}>
          <option value="created">Newest first</option>
          <option value="due">Due date</option>
          <option value="priority">Priority (urgent first)</option>
        </select>

        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>No tasks match your filters</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: COL_TPL,
                        padding: '8px 16px', borderBottom: '1px solid var(--border)',
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.07em', color: 'var(--text-faint)' }}>
            <div>Task</div>
            <div>Assignee</div>
            <div>Status</div>
            <div>Priority</div>
            <div>Due</div>
          </div>

          {/* Rows */}
          {tasks.map((t, idx) => {
            const assignee = TEAM.find(m => m.id === t.assignee_id)
            const due      = t.due_date ? dueFmt(t.due_date) : null
            return (
              <div key={t.id} onClick={() => onTaskClick(t)}
                   style={{ display: 'grid', gridTemplateColumns: COL_TPL,
                            padding: '10px 16px', cursor: 'pointer', alignItems: 'center',
                            borderBottom: idx < tasks.length - 1 ? '1px solid var(--border)' : 'none',
                            background: due?.overdue ? 'rgba(251,113,133,0.04)' : 'transparent',
                            transition: 'background .12s' }}
                   onMouseEnter={e => e.currentTarget.style.background = due?.overdue ? 'rgba(251,113,133,0.08)' : 'var(--surface-2)'}
                   onMouseLeave={e => e.currentTarget.style.background = due?.overdue ? 'rgba(251,113,133,0.04)' : 'transparent'}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden',
                               textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 16 }}>
                  {t.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className={`avatar sm ${assignee?.color}`}>{assignee?.short}</div>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden',
                                 textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {assignee?.name?.split(' ')[0]}
                  </span>
                </div>
                <div><StatusChip status={t.status} /></div>
                <div><PriorityChip priority={t.priority} /></div>
                <div style={{ fontSize: 11, color: due?.color || 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                  {due ? due.text : <span style={{ opacity: 0.4 }}>—</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tasks page ────────────────────────────────────────

export function TasksPage({ me, showToast }) {
  const [view,          setView]         = useState('kanban')
  const [tasks,         setTasks]        = useState([])
  const [loading,       setLoading]      = useState(true)
  const [editTask,      setEditTask]     = useState(null)   // null=closed, false=new, obj=edit
  const [confirmDelete, setConfirmDelete]= useState(null)

  // List-view filters
  const [filterStatus,   setFilterStatus]  = useState('all')
  const [filterPriority, setFilterPriority]= useState('all')
  const [filterAssignee, setFilterAssignee]= useState('all')
  const [sortBy,         setSortBy]        = useState('created')

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try { setTasks(await loadTasks()) }
    catch (err) { showToast('Failed to load tasks: ' + err.message) }
    finally { setLoading(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchTasks() }, [fetchTasks])

  async function handleSave(updates) {
    if (editTask) {
      await updateTask(editTask.id, updates)
      setTasks(prev => prev.map(t => t.id === editTask.id ? { ...t, ...updates } : t))
      showToast('Task updated')
    } else {
      const created = await createTask({ ...updates, created_by: me.id })
      setTasks(prev => [created, ...prev])
      showToast('Task created!')
    }
  }

  async function handleMove(task, newStatus) {
    try {
      await updateTask(task.id, { status: newStatus })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
    } catch (err) { showToast('Move failed: ' + err.message) }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await deleteTask(confirmDelete.id)
      setTasks(prev => prev.filter(t => t.id !== confirmDelete.id))
      showToast('Task deleted')
    } catch (err) { showToast('Delete failed: ' + err.message) }
    finally { setConfirmDelete(null) }
  }

  const filteredTasks = useMemo(() => {
    let t = [...tasks]
    if (filterStatus   !== 'all') t = t.filter(x => x.status     === filterStatus)
    if (filterPriority !== 'all') t = t.filter(x => x.priority   === filterPriority)
    if (filterAssignee !== 'all') t = t.filter(x => x.assignee_id === filterAssignee)
    if (sortBy === 'due') t.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    })
    else if (sortBy === 'priority') {
      const p = { urgent: 0, high: 1, medium: 2, low: 3 }
      t.sort((a, b) => (p[a.priority] ?? 2) - (p[b.priority] ?? 2))
    }
    else t.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    return t
  }, [tasks, filterStatus, filterPriority, filterAssignee, sortBy])

  const kpi = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0)
    return {
      total:       tasks.length,
      in_progress: tasks.filter(t => t.status === 'in_progress').length,
      overdue:     tasks.filter(t => t.due_date && new Date(t.due_date + 'T00:00:00') < now && t.status !== 'done').length,
      done:        tasks.filter(t => t.status === 'done').length,
    }
  }, [tasks])

  return (
    <div className="page">

      {/* Header */}
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <div className="sub">Assign, track, and complete work across the team</div>
        </div>
        <div className="actions" style={{ display: 'flex', gap: 8 }}>
          {/* Board / List toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
            {[{ id: 'kanban', icon: 'layers', label: 'Board' },
              { id: 'list',   icon: 'list',   label: 'List'  }].map((v, i) => (
              <button key={v.id} onClick={() => setView(v.id)}
                      style={{ padding: '0 14px', height: 32, border: 'none',
                               borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
                               cursor: 'pointer', fontSize: 12, fontWeight: 600,
                               gap: 5, display: 'flex', alignItems: 'center',
                               background: view === v.id ? 'var(--accent)' : 'transparent',
                               color:      view === v.id ? 'var(--accent-ink)' : 'var(--text-dim)' }}>
                <Icon name={v.icon} size={13} /> {v.label}
              </button>
            ))}
          </div>
          <button className="btn primary" onClick={() => setEditTask(false)}>
            <Icon name="plus" size={13} /> New task
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {[
          { label: 'Total tasks',  val: kpi.total,       sub: 'across the team' },
          { label: 'In progress',  val: kpi.in_progress, sub: 'being worked on',  color: '#60a5fa' },
          { label: 'Overdue',      val: kpi.overdue,     sub: 'past due date',    color: kpi.overdue > 0 ? '#fb7185' : undefined },
          { label: 'Completed',    val: kpi.done,        sub: 'done ✓',           color: '#34d399' },
        ].map(k => (
          <div className="kpi" key={k.label}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={k.color ? { color: k.color } : {}}>{k.val}</div>
            <div className="kpi-target">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Main content */}
      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <span className="muted">Loading…</span>
        </div>
      ) : view === 'kanban' ? (
        <KanbanView tasks={tasks} onTaskClick={setEditTask} onMove={handleMove} />
      ) : (
        <ListView
          tasks={filteredTasks} me={me} onTaskClick={setEditTask}
          filterStatus={filterStatus}     setFilterStatus={setFilterStatus}
          filterPriority={filterPriority} setFilterPriority={setFilterPriority}
          filterAssignee={filterAssignee} setFilterAssignee={setFilterAssignee}
          sortBy={sortBy} setSortBy={setSortBy} />
      )}

      {/* Create / Edit modal */}
      {editTask !== null && (
        <TaskModal
          task={editTask || null}
          me={me}
          onClose={() => setEditTask(null)}
          onSave={handleSave}
          onDelete={editTask ? () => { setConfirmDelete(editTask); setEditTask(null) } : null}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="modal-back" onClick={() => setConfirmDelete(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ color: '#fb7185' }}>🗑 Delete task?</h2>
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}><Icon name="x" size={13} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>
                Delete <strong>"{confirmDelete.title}"</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button onClick={handleDelete}
                      style={{ background: '#fb7185', color: '#fff', border: 'none', borderRadius: 6,
                               padding: '0 16px', height: 32, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

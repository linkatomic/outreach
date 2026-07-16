// Shared localStorage helpers for Email Harvester + Email Checker run history

const MAX_RUNS = 25

function hKey(tool) { return `amrytt-${tool}-history` }
function dKey(tool) { return `amrytt-${tool}-draft`   }

export function makeRunId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

// ── History (list of completed/stopped runs) ──────────────

export function loadHistory(tool) {
  try { return JSON.parse(localStorage.getItem(hKey(tool)) || '[]') } catch { return [] }
}

export function saveRunToHistory(tool, entry) {
  try {
    const prev = loadHistory(tool)
    const idx  = prev.findIndex(e => e.id === entry.id)
    const next = idx >= 0
      ? prev.map(e => e.id === entry.id ? entry : e)
      : [entry, ...prev].slice(0, MAX_RUNS)
    localStorage.setItem(hKey(tool), JSON.stringify(next))
    return next
  } catch { return loadHistory(tool) }
}

export function deleteHistoryRun(tool, id) {
  try {
    const next = loadHistory(tool).filter(e => e.id !== id)
    localStorage.setItem(hKey(tool), JSON.stringify(next))
    return next
  } catch { return loadHistory(tool) }
}

export function clearHistory(tool) {
  try { localStorage.removeItem(hKey(tool)) } catch {}
  return []
}

// ── Draft (live state for reload recovery) ────────────────

export function saveDraft(tool, data) {
  try { localStorage.setItem(dKey(tool), JSON.stringify(data)) } catch {}
}

export function loadDraft(tool) {
  try { return JSON.parse(localStorage.getItem(dKey(tool)) || 'null') } catch { return null }
}

// ── Relative date helper ──────────────────────────────────

export function fmtRelDate(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60)     return 'just now'
  if (diff < 3600)   return `${Math.round(diff / 60)}m ago`
  if (diff < 86400)  return `${Math.round(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

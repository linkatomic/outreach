// data.jsx — seed data + shared utilities

export const TEAM = [
  { id: 'dev',    name: 'Dev Pandya',  short: 'DP', role: 'lead',   color: 'a', email: 'dev@relay.io',    joined: '2024-04-01' },
  { id: 'neha',   name: 'Neha M',      short: 'NM', role: 'member', color: 'b', email: 'neha@relay.io',   joined: '2024-08-12' },
  { id: 'preeti', name: 'Preeti S',    short: 'PS', role: 'member', color: 'c', email: 'preeti@relay.io', joined: '2025-01-06' },
  { id: 'keyur',  name: 'Keyur D',     short: 'KD', role: 'member', color: 'd', email: 'keyur@relay.io',  joined: '2024-11-18' },
  { id: 'arjun',  name: 'Arjun M',     short: 'AM', role: 'member', color: 'e', email: 'arjun@relay.io',  joined: '2025-03-02' },
  { id: 'neel',   name: 'Neel P',      short: 'NP', role: 'member', color: 'f', email: 'neel@relay.io',   joined: '2025-05-19' },
];

export const METRICS = [
  { key: 'email_response',  label: 'Email responses',         unit: 'emails',   target: 30, group: 'inbox',   icon: 'mail' },
  { key: 'email_review',    label: 'Email review',            unit: 'emails',   target: 0,  group: 'inbox',   icon: 'eye' },
  { key: 'email_draft',     label: 'Email drafts',            unit: 'drafts',   target: 0,  group: 'inbox',   icon: 'edit' },
  { key: 'inbox_assigned',  label: 'Inbox assignments',       unit: 'items',    target: 0,  group: 'inbox',   icon: 'inbox' },
  { key: 'web_added',       label: 'Websites added',          unit: 'sites',    target: 15, group: 'sites',   icon: 'plus' },
  { key: 'web_audited',     label: 'Websites audited',        unit: 'sites',    target: 25, group: 'sites',   icon: 'search' },
  { key: 'web_live',        label: 'Websites live',           unit: 'sites',    target: 0,  group: 'sites',   icon: 'globe' },
  { key: 'replacements',    label: 'Replacement sites',       unit: 'sites',    target: 0,  group: 'sites',   icon: 'swap' },
  { key: 'domain_index',    label: 'Domain index checks',     unit: 'domains',  target: 0,  group: 'sites',   icon: 'shield' },
  { key: 'ai_categories',   label: 'AI categories updated',   unit: 'cats',     target: 0,  group: 'sites',   icon: 'tag' },
  { key: 'vendor_updates',  label: 'Vendor updates',          unit: 'vendors',  target: 0,  group: 'vendors', icon: 'building' },
  { key: 'teams_tasks',     label: 'MS Teams tasks',          unit: 'tasks',    target: 0,  group: 'comms',   icon: 'check' },
  { key: 'whatsapp_checks', label: 'WhatsApp checks',         unit: 'chats',    target: 0,  group: 'comms',   icon: 'chat' },
  { key: 'order_issues',    label: 'Order issues handled',    unit: 'issues',   target: 0,  group: 'comms',   icon: 'alert' },
];

export const METRIC_GROUPS = [
  { id: 'inbox',   label: 'Inbox' },
  { id: 'sites',   label: 'Sites' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'comms',   label: 'Comms' },
];

export const VENDORS = [
  'Northwind Apparel', 'Acme Imports', 'Globex Wholesale', 'Initech Goods',
  'Umbrella Trade Co', 'Stark Industries', 'Wayne Supply', 'Hooli Mart',
  'Pied Piper Goods', 'Cyberdyne Wholesale', 'Tyrell Distribution', 'Nakatomi Trade',
  'Soylent Foods', 'Massive Dynamic', 'Vehement Capital', 'Vandelay Industries',
  'Sterling Cooper', 'Dunder Mifflin', 'Pendant Publishing', 'Bluth Co',
];

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h;
}
export function rnd(seed) {
  const h = hash(seed);
  return (h % 10000) / 10000;
}
export function rndInt(seed, min, max) { return Math.floor(rnd(seed) * (max - min + 1)) + min; }

// ─────────── Date helpers ───────────
export function todayISO() { return new Date('2026-05-26').toISOString().slice(0, 10); }
export function isoNDaysAgo(n) {
  const d = new Date('2026-05-26'); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
export function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function fmtDayName(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}
export function fmtFull(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ─────────── Seeded report data ───────────
function seedReports() {
  const out = [];
  for (let d = 30; d >= 0; d--) {
    const date = isoNDaysAgo(d);
    const day = new Date(date + 'T00:00:00').getDay();
    if (day === 0) continue;
    for (const m of TEAM) {
      if (m.role === 'lead') continue;
      if (rnd(date + m.id + 'skip') < 0.1 && d > 0) continue;
      const metrics = {};
      const factor = 0.7 + rnd(m.id + 'baseline') * 0.7;
      const dayBoost = day === 1 ? 0.85 : day === 6 ? 0.7 : 1.0;
      for (const mt of METRICS) {
        const seed = date + m.id + mt.key;
        const present = rnd(seed) > (mt.target ? 0.05 : 0.5);
        if (!present) continue;
        let base = mt.target || rndInt(seed + 'b', 1, 12);
        const variance = (rnd(seed + 'v') - 0.4) * base * 0.6;
        const val = Math.max(0, Math.round((base + variance) * factor * dayBoost));
        if (val > 0) metrics[mt.key] = val;
      }
      const submittedAt = `${date}T${17 + Math.floor(rnd(date + m.id + 't') * 3)}:${String(Math.floor(rnd(date + m.id + 'm') * 60)).padStart(2,'0')}:00`;
      out.push({
        id: `r_${date}_${m.id}`,
        memberId: m.id,
        date,
        submittedAt,
        metrics,
        note: rnd(date + m.id + 'note') < 0.18
          ? ['Inbox cleared early', 'Vendor escalation took 90 min', 'Power cut delayed start', 'Wrapped Microsoft Teams backlog', 'Lots of replacement requests today'][rndInt(date+m.id+'ni',0,4)]
          : '',
        status: rnd(date+m.id+'st') < 0.85 ? 'approved' : (rnd(date+m.id+'st2') < 0.5 ? 'pending' : 'flagged'),
      });
    }
  }
  return out;
}

function seedEmails() {
  const out = [];
  let counter = 0;
  for (let d = 30; d >= 0; d--) {
    const date = isoNDaysAgo(d);
    const day = new Date(date + 'T00:00:00').getDay();
    if (day === 0) continue;
    for (const m of TEAM) {
      if (m.role === 'lead') continue;
      const count = rndInt(date + m.id + 'ec', 18, 36);
      for (let i = 0; i < count; i++) {
        counter++;
        const vendor = VENDORS[rndInt(date + m.id + i + 'v', 0, VENDORS.length - 1)];
        const linkId = rndInt(date + m.id + i + 'l', 1000000, 9999999);
        const hr = 9 + Math.floor(i / 4);
        const min = (i * 7) % 60;
        out.push({
          id: `e_${counter}`,
          sr: counter,
          memberId: m.id,
          date,
          vendor,
          link: `missive.app/${linkId}`,
          time: `${String(hr).padStart(2,'0')}:${String(min).padStart(2,'0')}`,
          status: rnd(date+m.id+i+'st') < 0.92 ? 'sent' : 'reply',
        });
      }
    }
  }
  return out;
}

export const REPORTS = seedReports();
export const EMAILS = seedEmails();

// ─────────── Aggregations ───────────
export function reportsForMember(memberId, days = 7) {
  const cutoff = isoNDaysAgo(days);
  return REPORTS.filter(r => r.memberId === memberId && r.date >= cutoff);
}
export function emailsForMember(memberId, date) {
  return EMAILS.filter(e => e.memberId === memberId && e.date === date);
}
export function emailsCountByDay(memberId, days = 14) {
  const out = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = isoNDaysAgo(d);
    out.push({ date, count: EMAILS.filter(e => e.memberId === memberId && e.date === date).length });
  }
  return out;
}
export function teamEmailsCountByDay(days = 14) {
  const out = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = isoNDaysAgo(d);
    out.push({ date, count: EMAILS.filter(e => e.date === date).length });
  }
  return out;
}
export function metricTotal(memberId, metricKey, days = 7) {
  return reportsForMember(memberId, days).reduce((s, r) => s + (r.metrics[metricKey] || 0), 0);
}

export function reportToday(memberId) {
  return REPORTS.find(r => r.memberId === memberId && r.date === todayISO());
}
export function emailsToday(memberId) {
  return EMAILS.filter(e => e.memberId === memberId && e.date === todayISO()).length;
}

// Icons (inline SVG paths)
const ICONS = {
  home:   <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z"/>,
  report: <path d="M9 3h6l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3zM9 13h6M9 17h6M9 9h3"/>,
  mail:   <path d="M4 6h16v12H4zM4 6l8 7 8-7"/>,
  chart:  <path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>,
  trophy: <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4zM7 4H4v3a3 3 0 0 0 3 3M17 4h3v3a3 3 0 0 1-3 3"/>,
  check:  <path d="M5 12l5 5L20 7"/>,
  search: <g><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></g>,
  bell:   <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9zM10 21a2 2 0 0 0 4 0"/>,
  settings: <g><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.39 1.25 1 1.51H21a2 2 0 0 1 0 4h-.09c-.61.26-1 .85-1 1.51z"/></g>,
  plus:   <path d="M12 5v14M5 12h14"/>,
  arrow:  <path d="M5 12h14M13 5l7 7-7 7"/>,
  arrowDown: <path d="M12 5v14M5 13l7 7 7-7"/>,
  arrowUp: <path d="M12 19V5M5 11l7-7 7 7"/>,
  x: <path d="M18 6L6 18M6 6l12 12"/>,
  filter: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>,
  users: <g><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0 1 12 0M16 3.13a4 4 0 0 1 0 7.75M21 21a6 6 0 0 0-6-6"/></g>,
  inbox: <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>,
  globe: <g><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></g>,
  eye: <g><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></g>,
  edit: <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>,
  swap: <path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4"/>,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
  tag: <g><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></g>,
  building: <g><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-4h4v4"/></g>,
  chat: <path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/>,
  alert: <g><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></g>,
  flash: <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>,
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>,
  clock: <g><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></g>,
  link: <path d="M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l1-1"/>,
  more: <g><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></g>,
  star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>,
  sun: <g><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></g>,
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>,
  keyboard: <g><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/></g>,
  cmd: <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>,
  zap: <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>,
  layers: <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>,
  upload: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>,
  copy: <g><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></g>,
  trash: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>,
  refresh: <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>,
  flag: <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22V15"/>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>,
};

export function Icon({ name, size = 16, stroke = 1.5 }) {
  const path = ICONS[name];
  if (!path) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

export function pct(part, whole) { return whole === 0 ? 0 : Math.round((part / whole) * 100); }
export function fmtRel(iso) {
  const d = new Date(iso);
  const now = new Date('2026-05-26T19:00:00');
  const diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff/60)}m ago`;
  if (diff < 86400) return `${Math.round(diff/3600)}h ago`;
  return `${Math.round(diff/86400)}d ago`;
}

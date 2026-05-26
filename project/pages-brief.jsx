// pages-brief.jsx — Design Brief / Strategy doc

function BriefPage() {
  const sections = [
    { id: 'strategy', label: '1 · Strategy' },
    { id: 'ia', label: '2 · Information Architecture' },
    { id: 'flows', label: '3 · User Flows' },
    { id: 'screens', label: '4 · Screen Concepts' },
    { id: 'system', label: '5 · Design System' },
    { id: 'interaction', label: '6 · Interaction Design' },
    { id: 'productivity', label: '7 · Productivity Optimizations' },
    { id: 'mvp', label: '8 · MVP Recommendation' },
    { id: 'figma', label: '9 · Figma Handoff Brief' },
  ];

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <div className="page-head">
        <div>
          <h1>Relay — Design Brief</h1>
          <div className="sub">Implementation-ready spec for the outreach ops platform · v0.4 · May 26, 2026</div>
        </div>
        <div className="actions">
          <button className="btn ghost"><Icon name="copy" size={12} />Copy link</button>
          <button className="btn"><Icon name="download" size={12} />Export PDF</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 32 }}>
        {/* TOC */}
        <nav style={{ position: 'sticky', top: 0, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sections.map(s => (
            <a key={s.id} href={`#${s.id}`} className="nav-item" style={{ fontSize: 12 }}>{s.label}</a>
          ))}
        </nav>

        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-dim)' }}>
          <style>{`
            .brief h2 { font-size: 18px; font-weight: 600; color: var(--text); letter-spacing: -0.02em; margin: 40px 0 8px; scroll-margin-top: 60px; }
            .brief h2:first-child { margin-top: 0; }
            .brief h3 { font-size: 14px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; margin: 24px 0 6px; }
            .brief p { margin: 0 0 12px; }
            .brief ul { margin: 0 0 14px; padding-left: 18px; }
            .brief li { margin-bottom: 4px; }
            .brief b, .brief strong { color: var(--text); font-weight: 500; }
            .brief code { font-family: var(--font-mono); font-size: 12px; background: var(--surface-2); padding: 1px 6px; border-radius: 4px; color: var(--text); }
            .brief hr { margin: 32px 0; }
            .brief .callout { padding: 14px 16px; background: var(--surface); border-left: 2px solid var(--accent); border-radius: 0 8px 8px 0; margin: 16px 0; }
            .brief .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
            .brief .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 16px 0; }
            .brief .stat-card { padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
            .brief .stat-card .l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); margin-bottom: 4px; }
            .brief .stat-card .v { font-size: 18px; font-weight: 500; color: var(--text); font-family: var(--font-mono); letter-spacing: -0.02em; }
            .brief table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 12px 0; }
            .brief th, .brief td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
            .brief th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); font-weight: 500; }
            .brief .flow-step { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
            .brief .flow-step .n { width: 22px; height: 22px; border-radius: 50%; background: var(--surface-3); color: var(--text); display: grid; place-items: center; font-family: var(--font-mono); font-size: 11px; flex-shrink: 0; }
            .brief .flow-step .n.acc { background: var(--accent); color: var(--accent-ink); }
            .brief .flow-step .sec { color: var(--text-faint); font-family: var(--font-mono); font-size: 11px; margin-left: auto; }
            .brief .swatch { width: 100%; height: 56px; border-radius: 6px; border: 1px solid var(--border); display: flex; align-items: flex-end; justify-content: space-between; padding: 8px 10px; font-family: var(--font-mono); font-size: 10px; }
            .brief .swatch .lbl { color: var(--text); font-weight: 600; }
            .brief .swatch .hex { color: var(--text); opacity: 0.7; }
          `}</style>

          <div className="brief">
            <h2 id="strategy">1 · Strategy</h2>

            <h3>The current problem, concretely</h3>
            <p>The outreach team's workday is currently fragmented across Google Chat (messy daily reports), Google Sheets (manual email logs), Missive (inbox), Microsoft Teams (task handoff) and WhatsApp (overflow chat). Reports have no standard shape — date formats vary, metric names vary, totals collide. There is <b>no auditable history</b>, no productivity signal beyond gut feel, and the daily 30-email target is tracked by counting cells in a spreadsheet.</p>

            <div className="grid-3">
              <div className="stat-card"><div className="l">Daily friction</div><div className="v">~9 min</div><div className="faint" style={{ fontSize: 11, marginTop: 4 }}>typing the chat update + logging emails</div></div>
              <div className="stat-card"><div className="l">Auditability</div><div className="v">none</div><div className="faint" style={{ fontSize: 11, marginTop: 4 }}>messy chat text isn't queryable</div></div>
              <div className="stat-card"><div className="l">Tools in play</div><div className="v">5</div><div className="faint" style={{ fontSize: 11, marginTop: 4 }}>chat, sheets, Missive, teams, WhatsApp</div></div>
            </div>

            <h3>Product goals (v1)</h3>
            <ul>
              <li><b>Standardize the day's output</b> into structured, queryable data — without making it slower than chat.</li>
              <li><b>Cut email-logging time from ~30s/entry to ~4s/entry</b> via keyboard-first quick add + bulk paste.</li>
              <li><b>Give the team lead a single glance</b> for "who's on track, who needs a nudge, what's blocked."</li>
              <li><b>Replace nothing the team doesn't want replaced</b>. Missive keeps owning inbox; Relay just pulls links in.</li>
            </ul>

            <h3>User problems → opportunities</h3>
            <table>
              <thead><tr><th>Pain</th><th>Today</th><th>Relay</th></tr></thead>
              <tbody>
                <tr><td>Messy report text</td><td>Free-form Google Chat</td><td>Structured numpad · 14 named metrics</td></tr>
                <tr><td>Slow email logging</td><td>Tabbing through 4 sheet cells</td><td>Quick-add bar · bulk paste · grid mode</td></tr>
                <tr><td>No comparison view</td><td>Reading 5 Chat messages</td><td>Leaderboard + heatmap + line chart</td></tr>
                <tr><td>"Did Preeti file today?"</td><td>Scroll Chat</td><td>Status dots in sidebar + review queue</td></tr>
                <tr><td>"How many emails this week?"</td><td>Sum cells across tabs</td><td>One KPI tile, exportable in 1 click</td></tr>
                <tr><td>Duplicate vendor entries</td><td>Eyeball it</td><td>Inline dup-warning chip on quick-add</td></tr>
              </tbody>
            </table>

            <div className="callout">
              <b>Design principle:</b> If a task takes more than 5 seconds in Relay, it's a bug. The bar isn't "better than Sheets" — it's "as fast as muscle memory."
            </div>

            <h2 id="ia">2 · Information Architecture</h2>

            <h3>Module map</h3>
            <table>
              <thead><tr><th>Module</th><th>v1?</th><th>Owner</th><th>Replaces</th></tr></thead>
              <tbody>
                <tr><td><b>Home</b> · role-aware dashboard</td><td>✓</td><td>Both</td><td>—</td></tr>
                <tr><td><b>Daily Report</b> · numpad quick-log</td><td>✓</td><td>Member</td><td>Google Chat updates</td></tr>
                <tr><td><b>Email Log</b> · 3 entry modes</td><td>✓</td><td>Member</td><td>Google Sheets tabs</td></tr>
                <tr><td><b>Analytics</b> · trends, mix, hour-of-day</td><td>✓</td><td>Lead</td><td>Manual cell-summing</td></tr>
                <tr><td><b>Team</b> · directory + member detail</td><td>✓</td><td>Both</td><td>Team header in chat</td></tr>
                <tr><td><b>Review Queue</b> · approve/flag reports</td><td>✓</td><td>Lead</td><td>—</td></tr>
                <tr><td><b>Leaderboard</b></td><td>✓</td><td>Both</td><td>—</td></tr>
                <tr><td><b>Command Palette</b> · ⌘ K</td><td>✓</td><td>Both</td><td>—</td></tr>
                <tr><td><b>Settings</b> · targets, theme, reminders</td><td>✓</td><td>Both</td><td>—</td></tr>
              </tbody>
            </table>

            <h3>Navigation hierarchy</h3>
            <p>Two-level only. The sidebar is split into <b>Workspace</b> (everyone) and <b>Manage</b> (lead-only), with a third <b>More</b> group for utility pages. No three-deep menus, no nested submenus. Everything is also reachable from the command palette in 2 keystrokes.</p>

            <h3>URL / route structure</h3>
            <pre style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 6, fontSize: 12, overflowX: 'auto', color: 'var(--text)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
{`/                              → home (role-aware)
/report                        → today's report (numpad)
/report/:date                  → past report (read-only or editable if lead)
/emails                        → live email log · ?filter=today|week|all
/emails/:memberId              → filtered to one person
/analytics                     → team analytics
/analytics/:memberId           → per-person deep dive
/team                          → directory
/team/:memberId                → member detail panel
/review                        → review queue (lead only)
/leaderboard                   → ranked view
/settings                      → workspace prefs`}
            </pre>

            <h2 id="flows">3 · User Flows</h2>

            <h3>Flow A — Member files daily report</h3>
            <div>
              {[
                ['1', '17:30 IST · push notification + Slack DM: "File today\'s report — 45s in Relay"', '0s'],
                ['2', 'Click reminder → lands on /report with numpad mode, first metric ("Email responses") focused', '<1s'],
                ['3', 'Type "31" → ↵ · auto-advances to "Email review" · type 5 → ↵ · skip the next 3 with TAB', '~25s'],
                ['4', 'Reach "Custom task" — optional note: "Power cut delayed start"', '~38s'],
                ['5', 'Submit · success screen shows totals and "Log emails next" CTA', '~45s'],
                ['6', 'If they click through: lands on /emails with cursor in the quick-add bar', '+0s'],
              ].map(([n, label, t]) => (
                <div className="flow-step" key={n}>
                  <span className={`n ${n === '6' ? 'acc' : ''}`}>{n}</span>
                  <span>{label}</span>
                  <span className="sec">{t}</span>
                </div>
              ))}
            </div>

            <h3>Flow B — Member logs emails through the day</h3>
            <div>
              {[
                ['1', 'During work: presses N anywhere in Relay → cursor lands in quick-add bar'],
                ['2', 'Types vendor (autocomplete from past 90 days), Tab, pastes Missive link, ↵'],
                ['3', 'Row appears at top of grid with a 1s accent flash. Duplicate warning if vendor was emailed in last 7 days.'],
                ['4', 'For batched work: presses B → bulk paste modal → pastes 20 lines from a draft → Import.'],
                ['5', 'Day end: today\'s count shown in KPI tile, no need to "submit" anything.'],
              ].map(([n, label]) => (
                <div className="flow-step" key={n}><span className="n">{n}</span><span>{label}</span></div>
              ))}
            </div>

            <h3>Flow C — Team lead does the morning review (5 minutes)</h3>
            <div>
              {[
                ['1', '09:00 · opens Relay → Home (lead variant). KPIs at the top: emails today/yesterday, reports filed N/5, week trend.'],
                ['2', 'Scans heatmap — one cell looks low: clicks → drills into that member\'s 30-day chart.'],
                ['3', 'Cmd-K → "review" → Review Queue. Sees 3 pending reports, 1 flagged.'],
                ['4', 'Two clicks each: Approve, Approve, Approve. Flagged report: writes a comment, sends back.'],
                ['5', 'Cmd-K → "export" → CSV with this week\'s numbers for management.'],
              ].map(([n, label]) => (
                <div className="flow-step" key={n}><span className="n">{n}</span><span>{label}</span></div>
              ))}
            </div>

            <h3>Flow D — Analytics review (weekly, ~10 min)</h3>
            <ul>
              <li>Open <code>/analytics</code> → range = 14d.</li>
              <li>Spot variance in member-comparison panel — anyone &gt;25% below median gets a soft 1:1 scheduled.</li>
              <li>Metric-mix panel reveals whether time is going to inbox vs sites vs vendor work this week.</li>
              <li>Hour-of-day heatmap surfaces "is anyone burning out / starting late repeatedly?"</li>
              <li>Export → share with leadership.</li>
            </ul>

            <h2 id="screens">4 · Screen-by-screen Concepts</h2>
            <p className="muted">Every screen is implemented live in this prototype. The summaries below are the design-intent layer.</p>

            <h3>Home · Member</h3>
            <p><b>Purpose:</b> answer "what do I need to do right now" in under 2 seconds. <b>Layout:</b> 4-up KPI strip (today's emails, week total, today's report status, 7-day streak) → 2-col main (line chart of last 14d + today's-so-far metrics list) → activity feed. <b>Hero CTA:</b> "File today's report" pinned in the top-right.</p>

            <h3>Home · Lead</h3>
            <p>Same KPI grammar with team-level metrics, plus a 5-row team-status mini-panel, a 5×26 reporting heatmap, and a mini leaderboard. The lead variant earns its real estate by collapsing 5 chat threads into one screen.</p>

            <h3>Daily Report (numpad)</h3>
            <p>Centerpiece is one giant number readout, one metric at a time, with on-screen 3×4 numpad. Queue rail on the right shows all 14 metrics with running state — current, done, skipped. Keyboard-first: ↵ saves, Tab skips, +/− nudges. Toggle to "Grid" mode for the few people who prefer all-at-once entry. Success state is celebratory but quick — total tasks counted, one tap to go log emails.</p>

            <h3>Email Log</h3>
            <p>The flagship speed surface. Three modes share one keyboard-grade table:</p>
            <ul>
              <li><b>Quick add</b> — pinned input row at top, type vendor → Tab → paste link → ↵. Default mode.</li>
              <li><b>Keyboard grid</b> — sheet-style entry row inside the table itself; users who muscle-memoried Sheets feel home immediately.</li>
              <li><b>Bulk paste</b> — modal that auto-parses 1–100 lines copied from Missive into structured rows.</li>
            </ul>
            <p>Filters use a single segmented row (today/week/all + everyone/just-me/&lt;person&gt;). Vendor autocomplete is fed from the past 90 days of entries. Duplicate detection runs in real-time on the vendor field — silent chip, never a blocking modal.</p>

            <h3>Analytics</h3>
            <p>Top KPI tiles (team total, reports filed, median emails/member/day, compliance %). Main line chart shows team volume over selectable range (7/14/30/90d). Below: side-by-side <i>Member comparison</i> + <i>Metric mix</i>. Bottom: hour-of-day heatmap to spot work-pattern issues.</p>

            <h3>Review Queue</h3>
            <p>Tabs split reports by status: Pending / Flagged / Approved / Missing. Master-detail layout — list on left, full report on right. "Approve all clean" power-action approves anything not flagged. Missing tab pivots to nudge actions instead of approve actions.</p>

            <h3>Command Palette</h3>
            <p>The keyboard backbone — ⌘K everywhere. Three sections: <i>Navigate</i> (G+letter shortcuts visible inline), <i>Actions</i> (new email, file report, bulk paste, export), <i>Jump to person</i> (deep-link into anyone's detail panel). Search is fuzzy, top result is enter-actionable.</p>

            <h2 id="system">5 · Design System Direction</h2>

            <h3>Type</h3>
            <p>Single sans (Geist Sans) and a monospace (Geist Mono) for all numbers, IDs, timestamps. Numbers are <b>always tabular-nums</b> — non-negotiable for a productivity tool with stacked metrics.</p>
            <table>
              <thead><tr><th>Token</th><th>Size · Weight</th><th>Use</th></tr></thead>
              <tbody>
                <tr><td>Display</td><td>90 · 400 · −0.05em mono</td><td>Numpad readout</td></tr>
                <tr><td>H1</td><td>22 · 600 · −0.02em</td><td>Page titles</td></tr>
                <tr><td>H3 / Card</td><td>13 · 500</td><td>Card headers</td></tr>
                <tr><td>Body</td><td>13 · 400</td><td>Default</td></tr>
                <tr><td>Caption</td><td>11 · 500 · 0.06em uppercase</td><td>Labels, KPI legends</td></tr>
                <tr><td>Mono</td><td>12 · 400</td><td>Counts, codes, kbd</td></tr>
              </tbody>
            </table>

            <h3>Color</h3>
            <p>Pure greys for surface scale, one neon lime accent (<code>#D2FE5C</code>) reserved for primary CTAs, accent rank, charted "now," and accent chips. Status uses muted variants of red/amber/green/blue, never saturated. Light theme mirrors the same structure with a dimmer lime (<code>#9CE600</code>) for AA contrast on white.</p>
            <div className="grid-3">
              <div className="swatch" style={{ background: '#000', color: '#FAFAFA' }}><span className="lbl" style={{ color: '#FAFAFA' }}>bg</span><span className="hex" style={{ color: '#FAFAFA' }}>#000000</span></div>
              <div className="swatch" style={{ background: '#0A0A0A', color: '#FAFAFA' }}><span className="lbl" style={{ color: '#FAFAFA' }}>surface</span><span className="hex" style={{ color: '#FAFAFA' }}>#0A0A0A</span></div>
              <div className="swatch" style={{ background: '#161616', color: '#FAFAFA' }}><span className="lbl" style={{ color: '#FAFAFA' }}>surface-3</span><span className="hex" style={{ color: '#FAFAFA' }}>#161616</span></div>
              <div className="swatch" style={{ background: '#1F1F1F', color: '#FAFAFA' }}><span className="lbl" style={{ color: '#FAFAFA' }}>border</span><span className="hex" style={{ color: '#FAFAFA' }}>#1F1F1F</span></div>
              <div className="swatch" style={{ background: '#D2FE5C', color: '#0A1500' }}><span className="lbl">accent</span><span className="hex">#D2FE5C</span></div>
              <div className="swatch" style={{ background: '#FAFAFA', color: '#0A0A0A' }}><span className="lbl">text</span><span className="hex">#FAFAFA</span></div>
            </div>

            <h3>Spacing & radii</h3>
            <p>4-point base. Most padding lives in <code>{`{12, 16, 20, 24, 32}`}</code>. Radii: 4 / 6 / 8 / 12 / 16. Cards are 12, chips 4, buttons 6, modals 12. Tight density: 6px row spacing in lists, 8px in tables.</p>

            <h3>Components vocabulary</h3>
            <ul>
              <li><b>KPI tile</b> — label / value (mono, −0.03em) / delta + spark or progress bar. Never colored chrome.</li>
              <li><b>Card</b> — bordered surface, optional <code>card-head</code> with title + actions, scrolls inside if needed.</li>
              <li><b>Chip</b> — tiny mono pill, used for status/role/duplicates. 5 tones.</li>
              <li><b>Segmented control</b> — flat 1px shell, current segment is inset; for tab-like switches inside cards.</li>
              <li><b>Table</b> — uppercase 11px headers, mono numbers, 8px row padding, hover surface bump.</li>
              <li><b>Modal</b> — 540 default, 320 confirm, 720 wide. Backdrop blur, ↑↓↵esc.</li>
              <li><b>Detail panel</b> — slide-in from right, 440 wide, for any "drill into this thing."</li>
            </ul>

            <h3>Motion</h3>
            <p>Two durations only: 150ms (state transitions, hovers, palette open) and 250ms (panels sliding in, route changes). One easing: <code>cubic-bezier(.2,.8,.2,1)</code>. Number changes get a 0.8s accent flash. Never animate to communicate progress — use a determinate bar. No splash, no marketing-y intros.</p>

            <h2 id="interaction">6 · Interaction Design</h2>

            <h3>Micro-interactions worth building</h3>
            <ul>
              <li><b>Numpad commit:</b> ↵ saves the value, the value persists in the queue rail with a 200ms accent flash, the next metric slides in from the right (translateX 8px → 0).</li>
              <li><b>Email log entry:</b> ↵ in the link field pushes a new row at top, the row inherits a 1s accent-tinted background that fades to surface.</li>
              <li><b>Duplicate warning:</b> when the vendor field matches a vendor emailed in the past 7 days, a small warn chip slides in from the right of the field. Never blocks save.</li>
              <li><b>KPI counter:</b> after a successful entry, the relevant KPI tile increments its value with a 400ms count-up animation (CSS counter, no JS lib).</li>
              <li><b>Heatmap hover:</b> tooltip with date + member + metric breakdown. Click drills into that day's report.</li>
              <li><b>Approve action:</b> the row collapses to a 1-line success state for 800ms, then disappears with a height-collapse.</li>
              <li><b>Cmd-K open:</b> 200ms scale + opacity in. Cmd-K close: 100ms opacity out, skip scale.</li>
              <li><b>Theme toggle:</b> crossfade root colors in 200ms, no flicker. Persisted via Tweaks.</li>
            </ul>

            <h2 id="productivity">7 · Productivity Optimizations</h2>

            <h3>Keyboard shortcuts</h3>
            <table>
              <thead><tr><th>Scope</th><th>Key</th><th>Action</th></tr></thead>
              <tbody>
                <tr><td>Global</td><td><code>⌘K</code></td><td>Command palette</td></tr>
                <tr><td>Global</td><td><code>/</code></td><td>Focus search</td></tr>
                <tr><td>Global</td><td><code>?</code></td><td>Show shortcut overlay</td></tr>
                <tr><td>Global</td><td><code>G H/R/E/A/T</code></td><td>Go to Home / Report / Emails / Analytics / Team</td></tr>
                <tr><td>Report</td><td><code>↵</code></td><td>Save & next metric</td></tr>
                <tr><td>Report</td><td><code>TAB</code></td><td>Skip metric</td></tr>
                <tr><td>Report</td><td><code>+ / −</code></td><td>Nudge value</td></tr>
                <tr><td>Emails</td><td><code>N</code></td><td>Focus quick-add</td></tr>
                <tr><td>Emails</td><td><code>B</code></td><td>Bulk paste modal</td></tr>
                <tr><td>Emails</td><td><code>⌘ ⌫</code></td><td>Delete row</td></tr>
                <tr><td>Review</td><td><code>⌘ A</code></td><td>Approve all clean</td></tr>
              </tbody>
            </table>

            <h3>Smart autofill / suggestions</h3>
            <ul>
              <li><b>Vendor autocomplete</b> from member's last 90 days, ranked by recency.</li>
              <li><b>Missive link parser</b> — paste a full Missive URL anywhere, Relay extracts the thread ID into the canonical short form.</li>
              <li><b>Copy last report</b> — one-click button that pre-fills today's report with yesterday's numbers (editable). Useful for "same routine day."</li>
              <li><b>Suggested metric set</b> — Relay learns which 5–7 metrics a given member uses 90% of the time and reorders the numpad queue for them.</li>
              <li><b>Bulk-paste templates</b> — recognizes Missive's clipboard format, also <code>Vendor — link</code>, also <code>link Vendor</code>, also raw URL.</li>
            </ul>

            <h3>Bulk actions</h3>
            <ul>
              <li>Email log: shift-click range → delete / re-assign / export.</li>
              <li>Review queue: "Approve all clean" / "Nudge all missing".</li>
              <li>Analytics: "Compare these 3 members" multi-select.</li>
            </ul>

            <h2 id="mvp">8 · MVP Recommendation</h2>

            <h3>v1 — ship to the 6 of us in 6 weeks</h3>
            <table>
              <thead><tr><th>Include</th><th>Defer</th></tr></thead>
              <tbody>
                <tr><td>Auth (Google SSO) + 2 roles (member/lead)</td><td>Admin role · permissions matrix</td></tr>
                <tr><td>Home (both variants)</td><td>Customizable dashboard tiles</td></tr>
                <tr><td>Daily Report — numpad + grid modes</td><td>Custom metric editor (use admin-defined list)</td></tr>
                <tr><td>Email Log — quick add + bulk paste + grid</td><td>Missive OAuth integration (paste links manually for now)</td></tr>
                <tr><td>Analytics — line, comparison, mix</td><td>Cohort / funnel analytics</td></tr>
                <tr><td>Review Queue · Leaderboard</td><td>Comments / threads on reports</td></tr>
                <tr><td>Command palette · keyboard shortcuts · ? help</td><td>Slash-commands inline</td></tr>
                <tr><td>Dark/light mode · settings page</td><td>Per-user themes beyond dark/light</td></tr>
                <tr><td>CSV export</td><td>Live Google Sheet sync</td></tr>
                <tr><td>Reminders (in-app + email)</td><td>Slack / WhatsApp bot</td></tr>
              </tbody>
            </table>

            <div className="callout">
              <b>The cut:</b> anything that requires another vendor's API in v1 is deferred. Manual Missive-link paste in v1 → Missive OAuth in v1.5. The fastest path to consolidation is replacing Chat + Sheets first; integrations come second.
            </div>

            <h2 id="figma">9 · Figma Handoff Brief</h2>

            <h3>Files to set up</h3>
            <ul>
              <li><code>Relay / 00 — Foundations</code> — colors, type, spacing, motion tokens. Variables file, both themes.</li>
              <li><code>Relay / 01 — Components</code> — KPI tile, card, chip, segmented, table row, button, modal, detail panel, sidebar item, command-item, numpad-key, eg-row.</li>
              <li><code>Relay / 02 — Screens</code> — one page per route (Home-member, Home-lead, Report, Emails, Analytics, Team, Review, Leaderboard, Settings, Shortcuts).</li>
              <li><code>Relay / 03 — Flows</code> — frame chains for the 4 flows above, with overlay annotations.</li>
              <li><code>Relay / 04 — States</code> — empty / loading / error / success per surface.</li>
            </ul>

            <h3>Variables to define first</h3>
            <p className="mono" style={{ fontSize: 12 }}>color/bg · color/surface · color/surface-2 · color/surface-3 · color/border · color/border-strong · color/text · color/text-dim · color/text-faint · color/accent · color/accent-ink · color/ok · color/warn · color/danger · color/info · space/1..8 · radius/xs..xl · font/sans · font/mono · shadow/sm · shadow/lg</p>

            <h3>Hand-off acceptance</h3>
            <ul>
              <li>Every primitive (button, chip, KPI tile) is a Figma component with variants matching the prototype's CSS classes 1:1.</li>
              <li>Token names in Figma === CSS custom property names. <code>--accent</code> ↔ <code>color/accent</code>.</li>
              <li>Each screen exists in dark <i>and</i> light, with the empty/loading/error/success states for any container that has data.</li>
              <li>Motion specs (duration · easing · delta) noted as frame annotations next to every animated component.</li>
              <li>Engineers can read this prototype's source as a parallel spec. The Figma file is the canonical visual ground truth; this prototype is the canonical interaction ground truth.</li>
            </ul>

            <hr />
            <p className="faint">End of brief · v0.4 · Author: design @ Relay</p>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BriefPage });

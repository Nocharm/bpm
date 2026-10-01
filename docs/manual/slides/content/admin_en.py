"""Administrator manual slide copy (English) for build_deck.py. Point = (lead, one-line description); <b> = UI element pill, <code> = keys/values."""

ENV_TABLE_AUTH = """<table class="tbl"><thead><tr><th>Variable</th><th>Effect</th></tr></thead><tbody>
<tr><td><code>BPM_SYSADMINS</code></td><td>Comma-separated sysadmin login IDs</td></tr>
<tr><td><code>AUTH_MODE</code></td><td><code>keycloak</code> | <code>ldap</code> | <code>dev</code>. The frontend reads it at boot via <code>GET /api/auth/mode</code></td></tr>
<tr><td><code>AUTH_JWT_SECRET</code> / <code>AUTH_JWT_TTL_HOURS</code></td><td>ldap session signing key (rotate = kill switch) · lifetime (default 8 h)</td></tr>
<tr><td><code>DEV_ENFORCE_PERMISSIONS</code></td><td>Enforce RBAC locally even with auth off</td></tr>
<tr><td><code>AI_BASE_URL</code> / <code>AI_MODEL</code></td><td>AI server (OpenAI-compatible) and model id. The in-house GPU uses just <code>glm-5.2</code></td></tr>
<tr><td><code>AI_MAX_TOKENS</code> / <code>AI_TIMEOUT_SECONDS</code></td><td>Response token cap (too low = empty replies) · per-call timeout (120–180 s recommended)</td></tr>
</tbody></table>"""

ENV_TABLE_OPS = """<table class="tbl"><thead><tr><th>Variable</th><th>Effect</th></tr></thead><tbody>
<tr><td><code>N8N_HR_URL</code> / <code>N8N_HR_TOKEN</code></td><td>HR webhook URL &amp; secret. Sync activates only with both</td></tr>
<tr><td><code>N8N_POSITION_URL</code></td><td>EDW head-position webhook. Empty disables collection</td></tr>
<tr><td><code>HR_SYNC_INTERVAL_HOURS</code></td><td>Auto-sync interval (default 24, 0 = off). Keep 0 for the first migration</td></tr>
<tr><td><code>HR_SYNC_DELETE_CAP_PCT</code></td><td>Sync deletion cap % (default 20, 0 = off)</td></tr>
<tr><td><code>BACKUP_DIR</code> / <code>BACKUP_RETENTION_DAYS</code></td><td>Backup path (default ./backups, point at a NAS for off-server) · retention days (default 14)</td></tr>
<tr><td><code>MANUAL_URL</code></td><td>Editor-toolbar manual button. Hidden when empty</td></tr>
</tbody></table>"""

DECK = {
    "name": "bpm-manual-admin-en",
    "lang": "en",
    "html_title": "BPM Administrator Manual",
    "label": "Business Process Map · Administrator Manual",
    "date": "2026-09-30",
    "cover": {
        "eyebrow": "Administrator Manual · English edition",
        "h1": "Business Process Map<br>Administrator Manual",
        "sub": "Consoles, operations and governance for system administrators. Everything in the User Manual applies to you too.",
        "meta": ["Company process-map system", "As of 2026-09-30"],
        "hint": "Navigate with <kbd>←</kbd><kbd>→</kbd> or click the screen edges · <kbd>Home</kbd> to restart",
    },
    "toc": {"kicker": "Contents", "sec": "What's inside", "title": "What's inside"},
    "closing": {
        "h1": "Run it steady",
        "sub": "Check the <b>Batch jobs tab</b> each morning, <b>AI prompt overrides</b> after deploys, and <b>Orphaned refs</b> after reorgs.",
    },
    "chapter_word": "Chapter",
    "chapters": [
        {
            "title": "The Sysadmin Role", "short": "Role",
            "desc": "How sysadmin is granted and what it unlocks.",
            "slides": [
                {"title": "How it's granted", "pts": [
                    ("Environment variable", "Not in the DB. <code>BPM_SYSADMINS</code> (comma-separated login IDs), read at startup."),
                    ("Dev default", "With auth off, effectively everyone is sysadmin."),
                    ("Real auth", "With <code>DEV_ENFORCE_PERMISSIONS=true</code> or real auth, listed IDs only."),
                    ("ldap mode", "The Local Accounts Sysadmin toggle can grant it too (effective only there)."),
                    ("Employees tag", "Settings → Directory → Employees tags them Sysadmin. <b>Env-listed users</b> can't be turned off from any screen."),
                ]},
                {"title": "What sysadmin unlocks", "pts": [
                    ("Owner on every map", "Collaborators · approvers · visibility · versions · deletion."),
                    ("Force checkout", "The only role that can take another user's edit lock."),
                    ("Admin consoles", "Every admin-only console under Settings."),
                    ("Moderation", "Group approvals · feedback replies · the global trash · manual publishing."),
                    ("Withdraw is the exception", "Pending / Approved versions only by the submitter. Rejected also by owner / sysadmin."),
                ]},
            ],
        },
        {
            "title": "Admin Console Map", "short": "Consoles",
            "desc": "Every console on the Settings rail, at a glance.",
            "slides": [
                {"title": "The Settings rail", "shot": True, "pts": [
                    ("Content", "Notices · Manual · <b>Knowledge base</b> · AI chat · <b>AI prompts</b>."),
                    ("Directory", "Employees · Departments · <b>Catalogs</b> · <b>Orphaned refs</b> · Local Accounts (ldap only)."),
                    ("Framework", "Categories &amp; import (<b>Manage / Status</b> views). Delegated admins see their subtree."),
                    ("Database · Approvals", "Tables · Batch jobs (<b>Back up now</b>) · Approval Queue."),
                    ("More", "Groups · Analytics (Dashboard) · Trash (Scheduled deletion)."),
                ]},
            ],
        },
        {
            "title": "Content Management", "short": "Content",
            "desc": "Notices, the in-app manual, AI knowledge · settings · prompts, and feedback.",
            "slides": [
                {"title": "Notices", "shot": True, "pts": [
                    ("Fields", "Title · importance (Important / General) · posting period (<b>open-ended</b> allowed) · Markdown body."),
                    ("Notify all", "Check <b>Notify all users on publish</b> to push to every inbox."),
                    ("Visibility", "Users see active notices only, the admin list shows all. CSV export."),
                    ("Hard delete", "Permanent, no trash. Already-sent bell notifications remain."),
                ]},
                {"title": "Publishing the manual", "shot": True, "pts": [
                    ("Several documents", "<b>/manual</b>. Each with a format (markdown / sanitized HTML) and language (KO / EN)."),
                    ("Authoring", "Write inline · upload an .md · load the bundled copy. Preview, then publish."),
                    ("KO / EN pairing", "Titles come from the first heading. Same order keeps the language toggle on the same document."),
                    ("Fallback", "With no publish history the bundled copy is served with a badge."),
                    ("TOC rule", "<code>##</code> / <code>###</code> headings. Images and raw HTML don't render."),
                ]},
                {"title": "Knowledge base", "shot": True, "pts": [
                    ("Purpose", "Org documents the AI consultant cites in interviews. Upload SOPs and guides."),
                    ("Formats", "pdf · docx · pptx · xlsx · txt · md, up to 20 MB per file."),
                    ("Prerequisite", "Works only with both <code>AI_ENABLED</code> and the embedding server <code>EMBED_URL</code> set."),
                ]},
                {"title": "AI chat settings · AI prompts", "shot": True, "pts": [
                    ("AI access switch", "Pauses every AI feature without a redeploy. Availability = <code>AI_ENABLED</code> AND the switch."),
                    ("Chat storage", "Always server-side (user × map, owner-visible). Not a toggle."),
                    ("Retention caps", "20 chats per map · 200 messages per chat · 180 days. Applies immediately."),
                    ("AI prompts", "Override the built-ins. Saves apply instantly, clearing falls back."),
                    ("Re-check", "While overridden, prompt improvements shipped in code are not picked up."),
                ]},
                {"title": "Feedback administration", "shot": True, "pts": [
                    ("Status · replies", "Sysadmin only. <b>Done</b> locks further replies."),
                    ("Deliberate notifications", "<b>Send notification</b> (reply, resendable) · <b>Notify status change</b> (once)."),
                    ("Sent log", "The \"Notification sent 〈time〉\" meta row."),
                    ("Notes", "Anyone writes, edits keep history, delete = archive. Purge only via the <code>feedback_notes</code> table."),
                ]},
            ],
        },
        {
            "title": "Directory &amp; Org", "short": "Directory",
            "desc": "HR-webhook sync, the departments basis, heads, and consultant accounts.",
            "slides": [
                {"title": "Employees &amp; sync", "shot": True, "pts": [
                    ("Source", "The n8n HR webhook. A full sync refreshes employees plus departments (AD only enriches titles)."),
                    ("Sync all from AD button", "Employees tab. Ends with a scanned / upserted / deactivated / deleted summary. One per 5 min."),
                    ("Auto sync", "<code>HR_SYNC_INTERVAL_HOURS</code> (default 24 h) plus per-user daily sync on login."),
                    ("Safeguards", "The sync-preview dry run and the deletion cap <code>HR_SYNC_DELETE_CAP_PCT</code> (default 20%)."),
                    ("Departures", "Not deleted. Marked active=false and excluded from pickers."),
                ]},
                {"title": "Departments &amp; heads", "shot": True, "pts": [
                    ("Org basis", "The departments table is the single source for the org chart and path resolution."),
                    ("Heads", "Determined from EDW position (FRNM) data, tagged Manager on the chain."),
                    ("Exposed positions", "An Employees-tab card picks which EDW titles show (defaults: 그룹장 · 파트장 · 팀장 · 센터장)."),
                    ("Clean-up", "Stale department and departed-person references go to the <b>Orphaned refs</b> tab."),
                    ("CSV", "Both tables export (BOM, formula-injection guard)."),
                ]},
                {"title": "Catalogs (Roles &amp; Systems)", "shot": True, "pts": [
                    ("Autocomplete lists", "For node Role and System. <b>Role | System</b> tabs, item list left, <b>alias</b> editor right."),
                    ("Aliases", "Typing one saves the canonical spelling (<code>sap</code> → SAP ERP). One alias belongs to one item."),
                    ("CSV import", "Two-column <code>value,aliases</code> (split by <code>|</code>). The System tab promotes values in use."),
                    ("Other", "Reserved in the System list (undeletable, always on top). Editing is sysadmin-only."),
                    ("Scope", "Editor · CSV · AI assistant · interview · JSON import all normalize against these lists."),
                ]},
                {"title": "Orphaned reference audit", "shot": True, "pts": [
                    ("Rescan", "12 places on demand. Node departments / assignees, SP designations, owners, collaborators, approvers, groups, admins."),
                    ("Grouped by value", "Vanished department path or departed person. Expand for each reference with a checkbox."),
                    ("Bulk replace · remove", "Checked lines get a current department or person. Node fields are display-only."),
                    ("Owner notices", "<b>Stale refs fix request</b> (one per owner). Departed owners get a new one assigned."),
                    ("User side", "<b>Stale refs</b> badge on cards, the home Issues filter, warning-colored node icons."),
                ]},
                {"title": "Local accounts (ldap mode)", "pts": [
                    ("When shown", "Only in ldap auth mode. ID / password logins for external consultants."),
                    ("Sign-in order", "Local accounts first, then AD fallback. 5 attempts per 5 minutes."),
                    ("Per account", "Reset password · deactivate / reactivate · delete (permanent). Deactivate first when an engagement ends."),
                    ("Sysadmin toggle", "<b>Local accounts only</b>. Directory accounts only via <code>BPM_SYSADMINS</code>."),
                    ("Tokens", "Lifetime and secret rotation live in docs/deploy/deploy.md §2.1."),
                ]},
            ],
        },
        {
            "title": "Framework Management", "short": "Framework",
            "desc": "Category tree and level delegation, linkage admins, confirmation governance, slot changes, the status board, interview import, filling an L5 with AI.",
            "slides": [
                {"title": "Category management &amp; level delegation", "shot": True, "pts": [
                    ("Layout", "Manage / Status toggle. Tree left, detail panel right. Single-child chains open through to the fork."),
                    ("Six actions", "Add child · Rename · Managing dept · Linkage admins · Move · Delete. Blocked ones show a reason."),
                    ("Rules", "Max 5 levels, maps on L5 only, no duplicate siblings (409)."),
                    ("Managing department", "Empty inherits from the parent. Becomes the canvas's owning department."),
                    ("Delegation", "Admins add / rename / reorder under their own category. Can't move or delete it."),
                ]},
                {"title": "Linkage admins", "shot": True, "pts": [
                    ("Appoint", "Select a row → <b>Linkage admins</b> in the detail panel. Users / groups, buffered until one confirm."),
                    ("Inherit downward", "Appoint at L1–L4 and every L5 canvas below becomes editable."),
                    ("Shown as", "The detail panel's info line (three names, then +N), dual-named per language."),
                    ("Canvases", "Real maps (<code>mode=framework</code>) hidden from the map list and SP library."),
                    ("Major confirm", "Permanently prunes the previous major's intermediate minors (X.0 and the last minor stay)."),
                ]},
                {"title": "Confirmation governance", "shot": True, "pts": [
                    ("confirmed state", "Apart from publishing. Snapshots and the draft can't be deleted. Regular workflows are blocked server-side."),
                    ("Six gates", "All L6 placed · no placeholders · no stale links · all L6 published · no exit-less loops · one connection per exit."),
                    ("Single source", "The Approval tab's <b>Confirm readiness</b> checklist. One failing gate disables Confirm."),
                    ("Who confirms", "The checkout holder if <b>direct admin</b> or sysadmin. Higher admins send a confirm request."),
                    ("Draft visibility", "Admins and sysadmins only. Everyone else lands on the latest confirmed snapshot."),
                ]},
                {"title": "Slot changes", "shot": True, "pts": [
                    ("Slot", "Which L5 a map belongs to. Assign · unassign · move · hand off · delete, from the <b>Framework pill</b>."),
                    ("Decider", "That L5's direct admin (sysadmins too). Higher-category admins only request."),
                    ("Move", "Both L5s' direct admins approve. An L5 without admins falls to sysadmin."),
                    ("Request path", "A direct-admin requester uses <b>Apply now</b>. Otherwise an <code>fw_slot</code> request lands in the Inbox and queue."),
                    ("Fallback decider", "Sysadmins decide from the queue. Map approvers cannot decide slot requests."),
                ]},
                {"title": "Status board", "shot": True, "pts": [
                    ("One table", "Every L5 in scope. Path / Latest confirmed / Status (Ready · Blocked · No canvas) + <b>Open</b>."),
                    ("Negative pills", "Failing gates: Missing L6 · Placeholders · Stale links · Unpublished L6 · Exit-less loop · Direct fan-out."),
                    ("Home link", "The category summary card shows the same verdicts under Subtree confirmation."),
                    ("Delegated scope", "Delegated admins see their own subtree only."),
                ]},
                {"title": "Interview import · format, dry run, governance", "shot": True, "pts": [
                    ("Flow", "<b>Interview JSON</b> section → file-pill strip → <b>Dry run</b> → report → Apply. Sysadmin-only."),
                    ("Format", "0.4 (<code>relations</code>) · 0.5 (<code>externalTasks</code>). 0.3 rejected. Re-runs are idempotent."),
                    ("Two-column report", "Left: Summary · Needs review · External L6 · admins · governance. Right: files → L5 canvas → maps."),
                    ("Governance changes", "On re-import, differing owner / department / approvers / notes become rows: <b>Keep ↩ / Replace ⇄</b>."),
                    ("Owner assignment", "An empty or unknown owner makes the importing sysadmin interim owner (Owner unconfirmed)."),
                ]},
                {"title": "Interview import · landing rules, placeholders, notes", "pts": [
                    ("Department path", "Exact → leading levels dropped → unique suffix → mirror chain. No match registers the path as-is."),
                    ("Landing", "Activities (L7) become nodes, flow edges become connectors. Exclusive branch → decision, parallel branch → parallel exit, self-loop or non-parallel fan-out → auto branch node."),
                    ("Fields and notes", "Conditions, times and systems land as fields, originals kept as source notes. Systems matched to the catalog."),
                    ("Automatic", "Exact output = input matches link as IO, horizontal auto-layout, a draft right after publish."),
                    ("L5 canvas", "Built or extended from top-level L6 flows (exclusive → decision, parallel → parallel exit). Redelivery only adds nodes."),
                    ("Notes", "Exceptions, VOC and regulatory basis become map notes; L5 entry / flow become category notes."),
                ]},
                {"title": "③ Connections · ④ Register", "shot": True, "pts": [
                    ("AI proposal", "Entering Connections proposes the L6 flow at once. Plan predecessors are the backbone."),
                    ("Full-width canvas", "L5 linkage canvas with a floating feedback chat. Drag, right-click branches, auto-save."),
                    ("One outgoing connector", "A new one marks the old in red dashes and replaces it. <b>Propose again</b> restarts."),
                    ("Register", "<b>Confirm connections</b> → the import screen with an automatic Dry run. Maps publish, the canvas stays draft."),
                ]},
                {"title": "② Questionnaire · settling ambiguity", "shot": True, "pts": [
                    ("Per card", "Decisions · exceptions · branches → activities → basics → I/O. A one-line reason per question."),
                    ("Answer rules", "All choice questions are required. Free text starts blank; <b>[AI suggestion]</b> types it in."),
                    ("Placeholder", "No detail needed yet? <b>Create as placeholder</b>. Draw again with AI before registration."),
                    ("Background drawing", "Submitting draws that card's flow while the next questionnaire is prepared."),
                ]},
                {"title": "① Plan · cards, stages, external L6", "shot": True, "pts": [
                    ("Propose L6 cards", "Brief and attachments → cards. Three columns: purpose | stage rows (one row = parallel) | card details."),
                    ("Stages", "Drag tiles between rows, reorder, open a new stage. Predecessors via tile <b>right-click</b>."),
                    ("External L6", "Tab or right-click an empty spot. Another L5's L6 as an external tile (connections only)."),
                    ("Pending removal", "Removed cards stay as red tiles, restorable. <b>Lock</b> starts questionnaire prep."),
                ]},
                {"title": "Filling an L5 with AI · entry &amp; sessions", "shot": True, "pts": [
                    ("Entry", "Select a row in the category tree → level-specific <b>tile actions</b> in the detail panel. Sysadmin-only."),
                    ("Per level", "L1–L3 Go down · L4 <b>Create L5 and start with AI</b> · L5 <b>Work with AI</b> / Resume."),
                    ("Sessions", "Stored in the DB. Leaving keeps them, resume from that L5 row. <b>Copy external AI prompt</b> round-trips."),
                    ("Four steps", "① Plan → ② Questionnaire → ③ Connections → ④ Register. Registered L6 load first as <b>Existing</b>."),
                ]},
            ],
        },
        {
            "title": "Database &amp; Backups", "short": "Database",
            "desc": "The table viewer, notification purge, batch status, and daily backups.",
            "slides": [
                {"title": "The table viewer", "shot": True, "pts": [
                    ("Read-only", "Server-side paging, sorting, filtering. It never writes."),
                    ("CSV export", "All rows with the current sort / filter."),
                    ("Login records", "<code>login_records</code>. One row per user per day, the audit view."),
                    ("Notification purge", "Selecting <code>notifications</code> adds a range purge. Grouped preview, then hard delete."),
                    ("Retention", "Notifications keep the most recent 100 per person."),
                ]},
                {"title": "Batch job status", "shot": True, "pts": [
                    ("Per job", "DB backup and HR sync. Last success and last failure with time and summary."),
                    ("Signal", "A failure newer than the last success means act."),
                    ("Back up now", "Outside the daily schedule. Production runs <code>pg_dump</code> via the sidecar, local copies sqlite."),
                    ("Backup files", "List of <code>${BACKUP_DIR}</code> with downloads for an off-server copy (sysadmin)."),
                ]},
                {"title": "Daily automatic backups (prod)", "pts": [
                    ("db-backup sidecar", "Daily after <b>04:00 KST</b>, plus once on boot if today's dump is missing."),
                    ("Verification", "Kept only after <code>pg_restore --list</code> passes. Outcomes land on the Batch jobs tab."),
                    ("Retention", "<code>${BACKUP_DIR}</code> (default ./backups) · <code>${BACKUP_RETENTION_DAYS}</code> (default 14)."),
                    ("Off-server copies", "Server disk only for now. Recovery runbook: <code>docs/deploy/backup.md</code>."),
                ]},
            ],
        },
        {
            "title": "Approvals · Groups · Trash", "short": "Moderation",
            "desc": "The global queue, group approvals, restore, and instant purge.",
            "slides": [
                {"title": "The global approval queue", "shot": True, "pts": [
                    ("Everything pending", "Group creation · permission downgrades · visibility · checkout transfers · <b>slot changes</b> (map · action · n/m)."),
                    ("Deciding", "Approve / reject, no rejection reason. Map-scoped items are also decidable by the map's approvers."),
                    ("Slot changes", "Decided by the L5's direct admin. Sysadmins decide here as the fallback."),
                    ("From the Inbox", "Renames, SP registrations and confirm requests. A canvas failing its gates can't be approved."),
                ]},
                {"title": "User group administration", "shot": True, "pts": [
                    ("Request-based", "<b>Active</b> after sysadmin approval."),
                    ("Check", "Name · members (2+) · managers (1+)."),
                    ("See all", "Inactive and deleted groups included."),
                    ("Deletion", "7 days in the trash, then purged."),
                ]},
                {"title": "Trash &amp; instant purge", "shot": True, "pts": [
                    ("Soft delete", "Maps and groups purge after 7 days. <b>Restore</b> until then."),
                    ("Scope", "Owners see their own, sysadmin sees everyone's trash."),
                    ("Instant purge", "Remove without the 7-day wait. Trash-state maps only, <b>no undo</b>."),
                ]},
                {"title": "Version workflow · admin powers", "pts": [
                    ("Force checkout", "Take the lock when the holder is away (unsaved context is lost). Checkouts never expire on their own."),
                    ("Effective owner", "Submit, publish and decide checkouts on any map."),
                    ("Withdraw is the exception", "Pending / Approved only by the submitter."),
                    ("Approver reassignment", "Recover approver-less maps via the forced-reassign flow."),
                    ("Expiry", "Publishing expires the previous version (terminal). Continue via Republish."),
                ]},
            ],
        },
        {
            "title": "Dashboard", "short": "Analytics",
            "desc": "Live operational metrics and delegated access.",
            "slides": [
                {"title": "The operations dashboard", "shot": True, "pts": [
                    ("Operations", "Maps · published · in progress · trash, open comments, unread notifications, transfer requests."),
                    ("Distribution", "Version status and adoption by department (denominator in the Coverage sidebar)."),
                    ("Trends", "Login and activity, cumulative growth. 7d / 1m / 3m / custom period filter."),
                    ("Events · AI", "Recent version events, AI usage (7 / 30-day calls, top maps)."),
                    ("Access", "Delegate viewing to people, departments, groups. Sysadmins always can."),
                ]},
            ],
        },
        {
            "title": "Configuration Reference", "short": "Reference",
            "desc": "backend .env and compose variables. Changes need a backend restart.",
            "slides": [
                {"title": "Env · auth, permissions, AI", "table": ENV_TABLE_AUTH},
                {"title": "Env · HR, backups, misc", "table": ENV_TABLE_OPS,
                 "note": "Env changes need a backend restart (<code>--reload</code> does not re-read .env). All deployment values live in .env, never hardcoded."},
            ],
        },
    ],
}

# Business Process Map — Administrator Manual

> This manual is for **system administrators (sysadmin)**. It covers the admin consoles, moderation duties, and the extra powers a sysadmin holds across every map. Read the **User Manual** (Editing Maps · Getting Around) first — everything there applies to you too.

---

## 1. The Sysadmin Role

### How sysadmin is granted

Sysadmin is **not** stored per user in the database — it is controlled by the **`BPM_SYSADMINS`** environment variable, a comma-separated list of login IDs read by the backend at startup.

```
# backend .env
BPM_SYSADMINS=admin.sys,jane.doe
```

- With authentication **off** (development default), every user is effectively sysadmin.
- With `DEV_ENFORCE_PERMISSIONS=true` or real Keycloak auth, only IDs listed in `BPM_SYSADMINS` are sysadmin.
- The Permissions console shows a **Sysadmin** tag on such users, noted as *env-managed* — you cannot toggle it from the UI.
- When the server runs in **ldap auth mode**, sysadmin can also be granted per account with the **Sysadmin toggle** on the Local Accounts screen (section 7) — that grant only takes effect in ldap mode. Users listed in the env show as "Set by environment" and cannot be turned off from the UI.

### What sysadmin unlocks

- You are treated as **Owner on every map** — manage collaborators, approvers, visibility, versions, and deletion anywhere.
- **Force checkout** — only a sysadmin can take an active editing lock from another user.
- Admin-only consoles under **Settings**: Notices, Employees & Departments, Framework, Database, Approval Queue.
- Moderation authority: user-group approval, feedback replies and status, global trash, manual publishing.

---

## 2. Admin Console Map

All admin surfaces live under **Settings**. The left rail shows extra categories when you are sysadmin:

| Console | Location | What it does |
| --- | --- | --- |
| **Notices** | Settings → Content | Create, edit, and delete announcements |
| **Manual** | Settings → Content | Edit and publish the in-app manual (see section 11) |
| **Knowledge base** | Settings → Content | Upload org documents the AI consultant cites in interviews (see section 12) |
| **AI chat** | Settings → Content | Retention-cap settings, chat loading-tips management (see section 12) |
| **AI prompts** | Settings → Content | Manage overrides of the built-in AI prompts (see section 12) |
| **Employees** | Settings → Directory | Org directory table — HR-webhook full sync, sysadmin tags, CSV export |
| **Departments** | Settings → Directory | Org-basis department table, department remap, CSV export |
| **Local Accounts** | Settings → Directory | ldap auth mode only — local login accounts for external consultants (see section 7) |
| **Framework** | Settings → Framework | Work-framework category management (Manage / Status views), admin appointment, interview JSON import — pilot stage (see section 13). Delegated category admins get the same screen scoped to their subtree |
| **Tables** | Settings → Database | Read-only DB browser (incl. login records), server-side CSV export |
| **Batch jobs** | Settings → Database | Latest run status (success/failure) of DB backups and HR sync, **Backup now** and backup-file download |
| **Approval Queue** | Settings → Approvals | Cross-map pending requests |
| **Dashboard** | Settings → Analytics | Operational metrics from the live database — access can be delegated to others (see section 8) |
| **Groups** | Settings → Groups | Approve group requests, see all groups |
| **Scheduled deletion** | Settings → Trash | All soft-deleted maps and groups |

---

## 3. Notices Management

Create and manage announcements shown on every user's **Notices** tab.

1. Go to **Settings → Content → Notices**.
2. **New notice**: title, importance (**Important** / General), posted period (start–end, or **No end date**), and a **Markdown** body.
3. Check **Notify all users on publish** to push a notification to everyone's Inbox.

- Users only see notices whose posting period is currently active; the admin list shows all of them.
- The admin notice list can be downloaded in full with the **Export CSV** button — same columns as the screen, Excel-compatible (BOM), with a formula-injection guard.
- Editing a notice takes effect immediately. **Deleting is a hard delete** — it is permanently removed on the spot, with no trash and no recovery (unlike the 7-day trash for maps and groups). However, if "Notify all users on publish" was checked, the bell notifications already sent stay in place even after the notice is deleted.

> **Tip:** Notice bodies render with the same Markdown viewer as this manual — headings, tables, code blocks, and `#tag` pills all work.

---

## 4. Feedback Administration

User feedback (Bug / Suggestion / Question / Other) arrives on the **Feedback** page with the sender's screen and open map attached.

- Only a sysadmin can **change status** and **reply** to feedback.
- Move items through their lifecycle; setting a feedback item to **done** stamps its completion time and **locks further replies**.
- Users see status changes and replies on the Feedback page right away, but **no notification is sent automatically** — you send it deliberately with the buttons below.

### Notifying the author

The detail dialog (click a row) carries two notifications that **an admin sends by hand**. Each opens a confirm dialog first and reports back with a toast.

- **Send notification** (bottom right of the reply area) — after saving a reply, this tells the author a reply has landed. It can be **sent again** after editing the reply, and it stays available on feedback already marked done.
- **Notify status change** (next to the status segment in the footer) — after changing the status, this sends the new status. It is limited to **once per feedback**; afterwards the button locks and shows a check.
- What you sent is recorded in the meta rows as **"Notification sent 〈time〉"**, so you can tell at a glance whether it already went out.
- A **greyed-out** button explains itself in a tooltip: you wrote the feedback yourself (nobody to notify), no reply saved yet, or the status notification was already sent.

### Notes (working memo)

- The note button at the end of each row opens the panel; **anyone** can add notes (no role restriction), and they build up as a time-ordered log.
- **Editing** is limited to the note's author — the previous text is **kept as history**, reachable from the "edited" badge.
- **Deleting archives** the note (author or admin). It only disappears from the default list; "Show archived" brings it back.
- **Permanent deletion** lives in **Settings → Database → Tables → `feedback_notes`** behind the **Delete archived notes** button — it removes the notes and their edit history for good.

---

## 5. User Group Administration

Group creation is request-based: any user can file a group request, but it only becomes **Active** after a sysadmin approves it.

- Pending requests appear in the **Approval Queue** (and the groups pending list). Review the name, members (min 2), and managers (min 1), then approve or reject.
- A sysadmin sees **all groups** — including inactive and deleted ones — while regular users only see groups they belong to.
- Deleted groups sit in the trash for **7 days** before being purged; restore them from **Settings → Trash**.

---

## 6. Global Approval Queue

**Settings → Approvals → Approval Queue** aggregates pending requests across all maps:

- **Group creation** requests.
- **Permission downgrade** requests (removing or demoting an editor).
- **Visibility change** requests (Public ↔ Private).
- **Checkout transfer** requests (taking over another user's active editing lock).

Each entry shows the requester and context; decide with Approve / Reject (rejection takes a reason). Map-scoped requests can also be decided by that map's approvers — the queue is your catch-all view.

> Separately, **map renames** and **subprocess registration requests** are decided by the **map owner** — since sysadmins hold owner rights on every map, you can handle those cards for any map from the Inbox (Approvals). For subprocess registration, **saving the designation form is the approval**, and a map with no published version cannot be designated yet. Framework **confirm requests** (an admin of a higher category asking for an L5 linkage canvas to be confirmed) also reach sysadmins as fallback deciders — approving performs the confirmation on the spot, so a canvas that fails a gate cannot be approved (section 13).

---

## 7. Directory and Employees

**Settings → Directory → Employees** shows the org directory the app uses for assignees, collaborators, and approver pickers.

- The source for people and the org chart is the **n8n HR webhook** (replacing the old AD sync) — a full sync refreshes both employees and the **departments table**, while AD (LDAP) has been reduced to a **title-enrichment-only** pass.
- The table includes organization levels, employment status (active/inactive), and each user's sysadmin tag.
- **Full sync** — run it manually with the sync button on the Employees tab (still labeled **Sync all from AD**). While running, the button shows a spinner with **Syncing…** and stays disabled until the sync and the follow-up list reload finish. On completion a scanned · upserted · deactivated · deleted · skipped summary is shown. Consecutive runs are throttled to one per 5 minutes.
- **Automatic sync** — a built-in scheduler repeats the full sync every `HR_SYNC_INTERVAL_HOURS` (default 24 hours, 0 = off). Independently, each user is single-synced once per day on login.
- **Departures** — people reported inactive by HR are not deleted; they are marked **active=false** (status: inactive) and automatically excluded from pickers and the directory.
- **Sync safeguards** — ① **Dry-run preview**: `POST /api/employees/sync-preview` (sysadmin API) returns the would-be upsert/deactivate/delete counts and sample lists without touching the DB — check it before the first migration or a large reorg. ② **Deletion-ratio cap**: if a single sync would delete more than `HR_SYNC_DELETE_CAP_PCT` (default 20%) of the managed rows, the whole sync aborts.
- Korean names and Korean departments are now filled directly by the HR webhook, so the old import tools (Korean name import, department info import) have been removed. The email field was also removed from the model — the directory stores no email addresses.
- Assignee pickers in the editor resolve against this directory — a stale directory means missing people in pickers.
- **CSV export** — the **Export CSV** button on the Employees and Departments tables downloads all rows with the same columns as the screen. Files are Excel-compatible (BOM included) with a formula-injection guard.

### Departments and Department Heads

**Settings → Directory → Departments** shows the **departments table**, the org basis (the old dept_info is gone) — the org chart and department-path resolution are both based on this table.

- Review the department list (name, Korean department, headcount) and export it as CSV.
- **Department-head determination** — heads are determined from EDW position (FRNM) data collected via webhook and shown with a **Manager** tag on the department-head chain. The position pass only runs when both the EDW webhook (`N8N_POSITION_URL`) and AD (employee-number mapping) are configured.
- **Exposed positions** — a card on the Employees tab lets you check which collected EDW titles are shown as a person's position across the app (defaults: 그룹장·파트장·팀장·센터장). This is an app setting saved from the screen, not an env variable.
- **Missing departments remap** — department paths that disappeared in a reorg but are still referenced by map permissions, group members, or map owning departments appear on the Departments tab; reassign each to a current department.

### Local Accounts (ldap mode only)

The **Settings → Directory → Local Accounts** tab appears **only while the server's auth mode is `ldap`**. It issues ID/password logins to **external consultants** who have no directory (HR) account.

- **Create account** — login ID, name, department code (optional), and password.
- **Login order** — a sign-in checks local accounts first, then falls back to AD (company account) authentication. Attempts are throttled to **5 per 5 minutes**.
- **Management** — per account: **Reset password**, **Deactivate / Reactivate**, and **Delete** (permanent — no undo). When a consultant's engagement ends, deactivate the account first before deleting.
- **Sysadmin toggle** — grants sysadmin to local/AD accounts (see section 1 — effective in ldap mode only).
- Token lifetime, secret rotation (invalidates every session), and other operational contracts live in `docs/deploy/deploy.md` §2.1.

---

## 8. Database Viewer & Operations Dashboard

**Settings → Database → Tables** is a read-only browser over the backend database with server-side paging, sorting, and filtering.

- Use it for spot checks — it never writes.
- **CSV export** (sysadmin only) — the **Export CSV** button in the header downloads **all rows** with the current sort and filter applied, streamed from the server (no paging). Excel compatibility (BOM) and the formula-injection guard match the admin-table exports.
- **Login records** live in the `login_records` table: one row per user per day, written on first authentication of the day. This is the audit view for "who used the app when".
- **Notification retention**: `notifications` keeps only the **most recent 100 rows per person**, a fixed policy (not adjustable) — overflow is auto-deleted oldest-first, regardless of read state, whenever a new notification arrives.

### Purging Notifications by Date Range

Selecting `notifications` in **Tables** adds a from–to date range and a **Delete in range** button to the header.

1. Pick the range to delete and click **Delete in range**.
2. A **preview dialog** groups that range's notifications by content (type + message), showing recipient counts and the date span — everything is **selected by default**.
3. Uncheck any groups you want to keep, then confirm — every recipient row in the selected groups, within the range, is **hard-deleted**. **There is no undo** — use with care.

### Batch Job Status (Settings → Database → Batch jobs)

Shows the latest attempts of the **DB backup** and the **HR (people) sync**, per job — the last **success** and the last **failure** each keep their time and summary, so you can tell at a glance in the morning whether the overnight batches ran clean. A failure row newer than the last success is your signal to act.

- **Backup now (on demand)** — the **Backup now** button on the DB backup card makes a backup outside the daily schedule. In production (postgres) the backend drops a request file that the sidecar picks up within seconds to run `pg_dump`, so after the "Backup requested" notice, re-check the list a moment later; local sqlite copies immediately.
- **Backup files and download** — the same card lists the backup files in `${BACKUP_DIR}`, and each can be **downloaded** for an off-server copy (sysadmin only).

### Daily Automatic DB Backup (production server)

The server compose stack includes a **`db-backup` sidecar**:

- It runs `pg_dump` once a day after **04:00 KST**, plus once right after the container starts when today's dump doesn't exist yet (deploy baseline).
- A dump is **kept only after it passes `pg_restore --list` verification**, and the outcome is recorded on the Batch jobs tab.
- Dumps land on the host at `${BACKUP_DIR}` (default `./backups`); retention is `${BACKUP_RETENTION_DAYS}` (default **14 days**) — older dumps are pruned automatically.
- For now backups live **only on the server disk** — that leaves disk failure uncovered, so periodic off-server copies are recommended. **Recovery procedures (overwrite restore, fresh server) follow the `docs/deploy/backup.md` runbook.**

### Dashboard (Settings → Analytics)

Live operational metrics from the database, at a glance:

- **Operations** — counts of all maps, published, in-progress, and trash; open comments; unread notifications; and checkout transfer requests.
- **Version status** — the distribution of versions across draft, in-review, approved, published, and expired.
- **Adoption by department** — the share of departments that own a map. The denominator (which departments count) is picked by the admin in the **Coverage** sidebar.
- **Login & activity** and **Cumulative growth** (map/version creation over time) — a period filter (**7 days** / **1 month** / **3 months** / **Custom**) adjusts the time series. Snapshot metrics ignore the period filter.
- **Recent version events** and **AI usage** (7-day / 30-day call counts, top maps).

**Dashboard access** can be delegated by a sysadmin — grant it from the **Access** sidebar on the right of the dashboard to people, departments, or user groups, and a non-admin with a grant can open the dashboard (sysadmins always can). With no grants, only sysadmins see it.

---

## 9. Trash and Recovery

Deleting a map or group is a **soft delete** — it moves to the trash and is permanently purged after **7 days**.

- Owners see their own deleted maps in **Settings → Scheduled deletion**; a sysadmin sees **everyone's**.
- **Restore** brings a map back intact (versions, nodes, permissions).
- After the 7-day window the purge is permanent — there is no undo beyond that point.
- **Instant purge (sysadmin only)** — the instant-delete button on a trash row removes a map immediately without waiting out the 7 days. It only works on maps already in the trash (soft-deleted), and **cannot be undone** — use with care.

---

## 10. Version Workflow — Admin Powers

Everything in the user manual's workflow section applies, plus:

- **Force checkout** — take an active editing lock when the holder is unavailable. Use it sparingly; the previous holder loses unsaved work context. Idle locks already auto-release after 30 minutes.
- **Decide anywhere** — as effective owner you can submit and publish on any map, and decide checkout requests and transfers. **Withdraw** is the exception: Pending and Approved versions can be withdrawn only by the **submitter**; only a Rejected version can be withdrawn by the map owner or a sysadmin.
- **Approver reassignment** — when a map has no active approver (e.g. the only approver left the company), use the forced-reassign flow in Map Settings → Approvers to appoint new ones.
- Remember the publish rule: publishing a version marks the previously published one #Expired — a terminal state that cannot re-enter approval. Use **Republish** to start a new cycle from it.

---

## 11. Publishing This Manual

**/manual** can hold multiple documents (like notices). Manage them from **Settings → Content → Manual**:

1. In the **document list**, click an existing document to edit it or use **New document** to add one. Delete with the trash button on each row.
2. Pick the format (**Markdown**/**HTML** — HTML is sanitized before rendering) and the **language (Korean/English)**. The viewer lists only documents matching the current KO/EN toggle.
3. Write in the editor, **Upload .md** to load a file, or **Load bundled** to start from the copy shipped with the build.
4. **Preview** renders exactly what users will see; **Publish** makes it live at /manual immediately.

- The list title is **auto-extracted from the first heading** on save.
- Upload KO/EN documents as pairs in the same order — switching languages in the viewer opens the document at the same position.

- The header shows the source: **Published** (with author and time) or **Bundled with build**.
- **Bundled fallback** — if nothing was ever published, the app serves `backend/app/manual.md` shipped with the build, and the viewer shows a **Bundled with build** badge instead of an update time.
- The same publish is available as a sysadmin API call:

```
PUT /api/manual
{ "format": "markdown", "content": "<the full markdown>" }
```

The viewer builds its table of contents from `##` and `###` headings, so structure documents accordingly. The renderer supports headings, flat lists, tables, fenced code blocks (hover to copy), inline code (click to copy), blockquotes, links, bold/italic, and `#word` pills — images and raw HTML are not rendered.

---

## 12. AI Chat Settings

**Settings → Content → AI chat** (sysadmin only). Changes apply immediately — no redeploy.

- **Chat storage**: AI chat conversations are always stored on the server (scoped to user + map; only the owner can view them) — this is not a toggle. They live in the `ai_chat_sessions` (chats) and `ai_chat_messages` (messages) tables, browsable in the table viewer.
- **Retention caps**: admins tune the number of chats per map, messages per chat, and days kept since last activity. Overflow is pruned oldest-first.

| Key | Default | Range |
| --- | --- | --- |
| `ai_chat_max_sessions_per_map` | 20 | 1–200 |
| `ai_chat_max_messages_per_session` | 200 | 10–2000 |
| `ai_chat_retention_days` | 180 | 7–3650 |

- **Chat loading tips**: manage the feature tips shown while earlier messages load in chat. One tip per line (200 chars each, up to 50). **Save an empty list to restore the 20 defaults.**

### Knowledge Base (Settings → Content → Knowledge base)

A library of **organization documents the AI consultant can cite during interviews** — upload SOPs and guides to ground its answers. Supported formats are pdf, docx, xlsx, txt, and md (max 20 MB per file); add files with **Upload** and reload the list with **Refresh**.

### AI Prompts (Settings → Content → AI prompts)

**Override the built-in prompts** used by the AI features (chat, interviewer, drafter, …) from the screen — saving applies immediately without a redeploy, and clearing an override falls back to the prompt shipped with the build. **While an override is in place, prompt improvements shipped in code are not picked up**, so re-check after deployments whether each override is still needed.

---

## 13. Framework Management

> The work framework is still at a **pilot stage** — its screens and data may change.

**Settings → Framework** manages the work-framework category tree. The toggle at the top switches between the **Manage** view (tree, admins, import) and the **Status** view (linkage-canvas confirmation board). A sysadmin sees the whole tree; a **user delegated as a category admin** gets the same screen in Settings, scoped to **their own subtree**.

### Category management and level delegation

- **Category management** — add top-level/child categories, rename, move within the tree, delete (max 5 levels; a category cannot move under its own subtree). Deletion is refused when the subtree has linked maps; otherwise the whole subtree is deleted. **Maps can be assigned only to leaf categories (L5).** Renaming a category renames its linkage-canvas map along with it, and **a category (subtree) that has a canvas cannot be deleted until the canvas is cleaned up** (409).
- **Delegation scope** — a category admin can add children, rename, and reorder inside their own category (including categories created by the import). **Move and delete** are refused on import-created categories and the new parent must stay inside their scope. **Appointing admins** is allowed only on levels below their own. **Admins appointed on an L5 only** can edit and confirm the canvas but every structural change is refused. **Creating top-level categories and running the interview import stay sysadmin-only.**

### Linkage admins

- The admins button on a category row appoints the **linkage-canvas editors** (users/groups). In the dialog, additions and removals are **buffered and saved with one Confirm click**; Cancel, `Esc`, or clicking outside discards them.
- The grant **inherits downward** — appointing at a higher level (L1–L4) covers every L5 canvas underneath ("Admins granted here also manage every category below it").
- Tree rows show the admins **directly appointed** on that category inline next to the code (up to two, the rest behind a **+N** hover tooltip). Names use the language-based "primary (secondary)" dual display.

### Confirmation governance

- A linkage canvas exists as a real map (`mode=framework`) but never appears in the regular map list or the subprocess library. Confirmed snapshots carry the **confirmed** status, separate from publishing, and cannot be deleted; neither can the live draft. Regular map workflows — submit, publish, approvers, collaborators, rename requests, subprocess registration — are **blocked on the server** for canvases.
- **Six confirm gates** — all linked L6 placed · no placeholders · no stale links · all linked L6 published · no exit-less loops · branches use decision nodes (exempt when every outgoing edge is a parallel fan-out). The **Confirm readiness** checklist on the editor's Approval tab is the single source, and the confirm button stays disabled while any gate fails.
- **Who confirms** — only the draft's checkout holder confirms directly, and only when they are a **direct admin of that L5** or a sysadmin. Admins of a higher category send a **confirm request** (their checkout is released automatically on send); recipients are the direct L5 admins plus sysadmins (fallback deciders). A direct admin or sysadmin who tries to request is told to confirm directly (409). The requester can withdraw until it is decided (the checkout does not come back), and the outcome goes out as a confirm approved/rejected notification.
- **Draft visibility** — the live draft before confirmation is visible only to admins of that category or a parent and to sysadmins. Everyone else lands on the latest confirmed snapshot, with an empty-state notice when none exists.
- A category admin's **major confirmation** permanently prunes the previous major's minor snapshots — the confirm dialog previews what goes.

### Status board

The **Status** view lists every L5 in scope in one table — **Path / Latest confirmed / Status** (Ready · Blocked · No canvas) with an **Open** button. Blocked canvases carry their failing gates as negative pills (Missing L6 · Placeholders · Stale links · Unpublished L6 · Exit-less loop · Direct fan-out). The **category summary card** in the home Framework view shows the same verdicts under "Subtree confirmation".

### Interview import

Upload the consultant-delivered L5 interview result JSON files (multiple files at once), validate with **Dry run**, then **Apply** (sysadmin only).

- **Format** — only interview JSON **0.4** (with the `relations` flow graph) is accepted. 0.3 files are rejected because their flow would collapse into a straight line. Files with errors are skipped as a whole while the rest proceed, and the import is idempotent — re-running the same files is safe.
- **Dry-run report** — folded as **file → L5 linkage canvas → map**, with the first column showing names people know (L6 labels, category paths). Repeated warnings collapse into a **Needs attention** digest at the top (one line per kind with affected maps and counts), and messages are bilingual (English + Korean). Raw keys such as taskId and unitId show only behind the # icon tooltip.
- **Governance changes (re-import)** — when an existing map's **owner · owning department · approvers · imported notes** differ from the delivery, they are listed as rows in the "Governance changes" section. **Only checked rows are replaced on apply**; the rest keep their current value. Owner, department, and approvers are checked by default; imported notes are checked by default only on maps where no imported note has been hand-edited (notes people wrote themselves are never touched). Apply from the sticky bar at the bottom of the report ("N maps · M governance changes checked").
- **Owner assignment** — when the delivery's owner is empty or not in the directory, the importing sysadmin holds the owner seat temporarily and the card shows an **Owner unconfirmed** pill. Hand it over with Map Settings → Danger Zone → **Transfer Ownership**; the pill clears, and later deliveries only propose the owner as a governance row instead of overwriting it.
- **Department path resolution** — the delivery's `department` (a slash path from the root) is matched to the org department tree in four steps: exact match → match with leading levels dropped → unique suffix match → department mirror chain alignment. When none matches, the **delivered path is registered as is** as the owning department and appears under that name in the home department tree — remap it on Settings → Directory → Departments.
- **Landing rules** — activities (L7) become nodes (input/output/data form/system/link) and flow edges (seq/branch/loop/bypass) become connectors. A branch promotes its source node to a decision, and a loop back to the same node synthesizes a branch node titled **"반복 여부(자동 생성됨)"** (fixed Korean title: "repeat? - auto-generated"). Start/end conditions, total time, touch time, and system land as map fields, with their originals kept as **Interview notes** (editor Map tab, home detail card). **Annual volume and FTE** land both as the map's subprocess designation reference values and as the L5 canvas node values. Outputs and inputs that match exactly are auto-linked as IO links, nodes are auto-laid-out horizontally, and an editable draft is created right after publishing (an untouched draft is reused by the next delivery).
- **L5 linkage canvas** — created or augmented from the flow between top-level L6s (decision nodes inserted for branches, loops laid out as return edges). Re-deliveries **only add** nodes and never move them, and skip the canvas while someone else holds its checkout.
- **Notes and GMP** — per-task exception rules, VOC, rule basis, and open issues land as map notes; the L5's entry, flow, open-issue, and task notes land as category notes (linkage-canvas Map tab). Classify GMP (GMP Direct / Indirect / Non-GMP) and settle conditions/times in **Map Settings → Details → Conditions & GMP**; the GMP you select survives redeliveries.

---

## 14. Configuration Reference

| Variable | Where | Effect |
| --- | --- | --- |
| `BPM_SYSADMINS` | backend `.env` | Comma-separated login IDs granted sysadmin |
| `AUTH_MODE` | backend `.env` | Auth mode — `keycloak` \| `ldap` \| `dev`. Empty falls back to legacy `AUTH_ENABLED` (`true`→keycloak, `false`→dev). The frontend has no build-time equivalent — it reads the resolved mode at boot from `GET /api/auth/mode` |
| `AUTH_ENABLED` | backend `.env` | Legacy on/off switch, superseded by `AUTH_MODE` — kept for backward compatibility |
| `AUTH_JWT_SECRET` | backend `.env` | Signing key for ldap-mode session tokens — **required in ldap mode**. Rotating it invalidates every issued session immediately (kill switch) |
| `AUTH_JWT_TTL_HOURS` | backend `.env` | ldap-mode session token lifetime in hours. Default 8 |
| `DEV_ENFORCE_PERMISSIONS` | backend `.env` | Enforce RBAC locally even with auth off |
| `MANUAL_URL` | `.env` (compose) | Manual-site button on the editor toolbar — hidden when empty |
| `N8N_HR_URL` | backend `.env` | n8n HR webhook URL (single source for people and org chart) — sync activates only with the token set too |
| `N8N_HR_TOKEN` | backend `.env` | HR webhook X-API-Key secret — shared with the EDW position webhook |
| `N8N_POSITION_URL` | backend `.env` | EDW department-head position webhook — empty disables position collection |
| `HR_SYNC_INTERVAL_HOURS` | backend `.env` | Built-in HR sync scheduler interval (hours). Default 24, 0 = off — keep it at 0 for the first migration and raise it after the preview and a manual sync check out |
| `HR_SYNC_DELETE_CAP_PCT` | backend `.env` | Full-sync deletion cap (% of managed rows). Default 20, 0 = guard off |
| `AI_BASE_URL` | backend `.env` | AI server URL (OpenAI-compatible). The in-house GPU is `https://gpu02.sbiologics.com/v1` |
| `AI_MODEL` | backend `.env` | Default model id — after the SGLang move this is **just `glm-5.2`** (the old `-think` / `-high` / `-nothink` aliases are gone) |
| `AI_MAX_TOKENS` | backend `.env` | Response token cap, thinking tokens included. Default 8000 — **too low and replies come back empty** |
| `AI_TIMEOUT_SECONDS` | backend `.env` | Per-call timeout in seconds. Max-thinking calls are slow; 120–180 is recommended |
| `BACKUP_DIR` | `.env` (compose) | Host path for db-backup sidecar dumps. Default `./backups` — point it at a NAS mount to get off-server copies |
| `BACKUP_RETENTION_DAYS` | `.env` (compose) | Backup retention in days. Default 14 |

- Environment changes require a backend restart (`--reload` does not re-read `.env`).
- Keycloak endpoints and all deployment-specific values come from `.env` — never hardcoded.
- The **Exposed positions** list is not an env variable — it is saved from the card on **Settings → Directory → Employees** (see section 7).

---

*Business Process Map — Administrator Manual · updated 2026-09-03*

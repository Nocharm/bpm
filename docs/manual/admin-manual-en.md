# Business Process Map · Administrator Manual

> This manual is for **system administrators (sysadmin)**. It covers the admin consoles, moderation duties, and the extra powers a sysadmin holds across every map. Read the **User Manual** (Editing Maps · Getting Around) first. Everything there applies to you too.

---

## 1. The Sysadmin Role

### How sysadmin is granted

Sysadmin is **not** stored per user in the database. It is controlled by the **`BPM_SYSADMINS`** environment variable, a comma-separated list of login IDs read by the backend at startup.

```
# backend .env
BPM_SYSADMINS=admin.sys,jane.doe
```

- With authentication **off** (development default), every user is effectively sysadmin.
- With `DEV_ENFORCE_PERMISSIONS=true` or real Keycloak auth, only IDs listed in `BPM_SYSADMINS` are sysadmin.
- The **Settings → Directory → Employees** table shows a **Sysadmin** tag on such users, with an *env-managed* tooltip. You cannot toggle it from the UI.
- When the server runs in **ldap auth mode**, sysadmin can also be granted per account with the **Sysadmin toggle** on the Local Accounts screen (section 7). That grant only takes effect in ldap mode. Users listed in the env show as "Set by environment" and cannot be turned off from the UI.

### What sysadmin unlocks

- You are treated as **Owner on every map**. Manage collaborators, approvers, visibility, versions, and deletion anywhere.
- **Force checkout**: only a sysadmin can take an active editing lock from another user.
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
| **Employees** | Settings → Directory | Org directory table: HR-webhook full sync, sysadmin tags, CSV export |
| **Departments** | Settings → Directory | Org-basis department table, department heads and exposed positions, CSV export |
| **Orphaned refs** | Settings → Directory | Scans 12 places for department, assignee, and user references missing from the org chart; check-based bulk replace/remove; bundled owner notifications (see section 7) |
| **Catalogs** | Settings → Directory | Manages the autocomplete lists for node **Role** and **System** (canonical spelling + aliases), CSV import. Editing is sysadmin-only (see section 7) |
| **Local Accounts** | Settings → Directory | ldap auth mode only. Local login accounts for external consultants (see section 7) |
| **Framework** | Settings → Framework | Work-framework category management (Manage / Status views), admin appointment, interview JSON import. Pilot stage (see section 13). Delegated category admins get the same screen scoped to their subtree |
| **Tables** | Settings → Database | Read-only DB browser (incl. login records), server-side CSV export |
| **Batch jobs** | Settings → Database | Latest run status (success/failure) of DB backups and HR sync, **Backup now** and backup-file download |
| **Approval Queue** | Settings → Approvals | Cross-map pending requests |
| **Dashboard** | Settings → Analytics | Operational metrics from the live database. Access can be delegated to others (see section 8) |
| **Groups** | Settings → Groups | Approve group requests, see all groups |
| **Scheduled deletion** | Settings → Trash | All soft-deleted maps and groups |

---

## 3. Notices Management

Create and manage announcements shown on every user's **Notices** tab.

1. Go to **Settings → Content → Notices**.
2. **New notice**: title, importance (**Important** / General), posted period (start–end, or **No end date**), and a **Markdown** body.
3. Check **Notify all users on publish** to push a notification to everyone's Inbox.

- Users only see notices whose posting period is currently active; the admin list shows all of them.
- The admin notice list can be downloaded in full with the **Export CSV** button, with the same columns as the screen, Excel-compatible (BOM), and a formula-injection guard.
- Editing a notice takes effect immediately. **Deleting is a hard delete**. It is permanently removed on the spot, with no trash and no recovery (unlike the 7-day trash for maps and groups). However, if "Notify all users on publish" was checked, the bell notifications already sent stay in place even after the notice is deleted.

> **Tip:** Notice bodies render with the same Markdown viewer as this manual. Headings, tables, code blocks, and `#tag` pills all work.

---

## 4. Feedback Administration

User feedback (Bug / Suggestion / Question / Other) arrives on the **Feedback** page with the sender's screen and open map attached.

- Only a sysadmin can **change status** and **reply** to feedback.
- Move items through their lifecycle; setting a feedback item to **done** stamps its completion time and **locks further replies**.
- Users see status changes and replies on the Feedback page right away, but **no notification is sent automatically**. You send it deliberately with the buttons below.

### Notifying the author

The detail dialog (click a row) carries two notifications that **an admin sends by hand**. Each opens a confirm dialog first and reports back with a toast.

- **Send notification** (bottom right of the reply area): after saving a reply, this tells the author a reply has landed. It can be **sent again** after editing the reply, and it stays available on feedback already marked done.
- **Notify status change** (next to the status segment in the footer): after changing the status, this sends the new status. It is limited to **once per feedback**; afterwards the button locks and shows a check.
- What you sent is recorded in the meta rows as **"Notification sent 〈time〉"**, so you can tell at a glance whether it already went out.
- A **greyed-out** button explains itself in a tooltip: you wrote the feedback yourself (nobody to notify), no reply saved yet, or the status notification was already sent.

### Notes (working memo)

- The note button at the end of each row opens the panel; **anyone** can add notes (no role restriction), and they build up as a time-ordered log.
- **Editing** is limited to the note's author. The previous text is **kept as history**, reachable from the "edited" badge.
- **Deleting archives** the note (author or admin). It only disappears from the default list; "Show archived" brings it back.
- **Permanent deletion** lives in **Settings → Database → Tables → `feedback_notes`** behind the **Delete archived notes** button. It removes the notes and their edit history for good.

---

## 5. User Group Administration

Group creation is request-based: any user can file a group request, but it only becomes **Active** after a sysadmin approves it.

- Pending requests appear in the **Approval Queue** (and the groups pending list). Review the name, members (min 2), and managers (min 1), then approve or reject.
- A sysadmin sees **all groups**, including inactive and deleted ones, while regular users only see groups they belong to.
- Deleted groups sit in the trash for **7 days** before being purged; restore them from **Settings → Trash**.

---

## 6. Global Approval Queue

**Settings → Approvals → Approval Queue** aggregates pending requests across all maps:

- **Group creation** requests.
- **Permission downgrade** requests (removing or demoting an editor).
- **Visibility change** requests (Public ↔ Private).
- **Checkout transfer** requests (taking over another user's active editing lock).
- **Slot change** (`fw_slot`) requests - shows the map name, the action, the target, and how many sides have approved (n/m).

Each entry shows the requester and context; decide with Approve / Reject (this queue does not take a rejection reason). Map-scoped requests can also be decided by that map's approvers. The queue is your catch-all view. **Slot changes are the exception** - the decider is a direct admin of the relevant L5 (or a sysadmin), not the map's approvers; a sysadmin decides here as the fallback (section 13, "Slot changes").

> Separately, **map renames** and **subprocess registration requests** are decided by the **map owner**. Since sysadmins hold owner rights on every map, you can handle those cards for any map from the Inbox (Approvals). For subprocess registration, **saving the designation form is the approval**, and a map with no published version cannot be designated yet. Framework **confirm requests** (an admin of a higher category asking for an L5 linkage canvas to be confirmed) also reach sysadmins as fallback deciders. Approving performs the confirmation on the spot, so a canvas that fails a gate cannot be approved (section 13).

---

## 7. Directory and Employees

**Settings → Directory → Employees** shows the org directory the app uses for assignees, collaborators, and approver pickers.

- The source for people and the org chart is the **n8n HR webhook** (replacing the old AD sync). A full sync refreshes both employees and the **departments table**, while AD (LDAP) has been reduced to a **title-enrichment-only** pass.
- The table includes organization levels, employment status (active/inactive), and each user's sysadmin tag.
- **Full sync**: run it manually with the sync button on the Employees tab (still labeled **Sync all from AD**). While running, the button shows a spinner with **Syncing…** and stays disabled until the sync and the follow-up list reload finish. On completion a scanned · upserted · deactivated · deleted · skipped summary is shown. Consecutive runs are throttled to one per 5 minutes.
- **Automatic sync**: a built-in scheduler repeats the full sync every `HR_SYNC_INTERVAL_HOURS` (default 24 hours, 0 = off). Independently, each user is single-synced once per day on login.
- **Departures**: people reported inactive by HR are not deleted; they are marked **active=false** (status: inactive) and automatically excluded from pickers and the directory.
- **Sync safeguards**: ① **Dry-run preview**: `POST /api/employees/sync-preview` (sysadmin API) returns the would-be upsert/deactivate/delete counts and sample lists without touching the DB. Check it before the first migration or a large reorg. ② **Deletion-ratio cap**: if a single sync would delete more than `HR_SYNC_DELETE_CAP_PCT` (default 20%) of the managed rows, the whole sync aborts.
- Korean names and Korean departments are now filled directly by the HR webhook, so the old import tools (Korean name import, department info import) have been removed. The email field was also removed from the model. The directory stores no email addresses.
- Assignee pickers in the editor resolve against this directory. A stale directory means missing people in pickers.
- **CSV export**: the **Export CSV** button on the Employees and Departments tables downloads all rows with the same columns as the screen. Files are Excel-compatible (BOM included) with a formula-injection guard.

### Departments and Department Heads

**Settings → Directory → Departments** shows the **departments table**, the org basis (the old dept_info is gone). The org chart and department-path resolution are both based on this table.

- Review the department list (name, Korean department, headcount) and export it as CSV.
- **Department-head determination**: heads are determined from EDW position (FRNM) data collected via webhook and shown with a **Manager** tag on the department-head chain. The position pass only runs when both the EDW webhook (`N8N_POSITION_URL`) and AD (employee-number mapping) are configured.
- **Exposed positions**: a card on the Employees tab lets you check which collected EDW titles are shown as a person's position across the app (defaults: 그룹장·파트장·팀장·센터장). This is an app setting saved from the screen, not an env variable.

### Orphaned reference audit (Settings → Directory → Orphaned refs)

Finds and cleans up, in one place, every reference to a **department, assignee, or user that is no longer in the org chart** after a reorg or departure (replaces the old "Missing departments" tab).

- **Rescan**: scans 12 places on demand (node departments and assignees, subprocess designation departments and assignees, map owners, collaborators, and approvers, owning departments, user-group members, category admins, group requests, and so on). Results are grouped **by value** (a vanished department path, a departed person, ...); expanding a group lists its reference lines (map, version, node, role) with checkboxes.
- **Bulk replace / remove**: **replace** the checked lines with a current department or person, or **remove** them. Node fields (department, assignee) need a draft edit, so they are only shown here and are fixed in the editor.
- **Owner notification, owner replacement**: send the owners of affected maps a **Stale refs fix request** notification, one per owner with the map list attached, and assign a new owner when the owner has left (an **Owner assigned** notification).
- On the user side the affected map cards get a **Stale refs badge**, the home **Issues** filter collects them, and the department/assignee icons on editor nodes turn the warning color.

### Catalogs: Role and System lists (Settings → Directory → Catalogs)

Manages the autocomplete lists shown in the node **Role** and **System** fields. Every signed-in user can read the lists; **editing and saving is sysadmin-only**.

- **Layout**: **Role | System** tabs at the top (with item counts), the item list on the left (filter, **Add** input, save), and the **alias** editor for the selected item on the right. **Other** in the System list is reserved: it cannot be deleted and always stays at the top (aliases may still be attached).
- **Aliases**: attach several aliases to one item (e.g. `SAP ERP` ← `sap`, `ERP`) and a user who types an alias gets the canonical spelling saved. An alias belongs to exactly one item, so an alias that collides with another item's value or alias is dropped on save with a notice.
- **Values in use**: the System tab lists the system values currently written in maps as candidates you can check to add to the list.
- **CSV import**: upload a two-column `value,aliases` CSV (aliases separated by `|`, header optional) to merge into the list (preview of added and duplicate counts).
- **Where it applies**: the editor (inspector, node edit dialog, designation dialog, group bulk edit), CSV import, the AI assistant and consultant interview, and interview JSON import all normalize values against the same lists. A system not in the list is stored as **Other + source note**; a role not in the list is stored as a free value. After saving, user screens pick the change up on the next fetch without a reload.

### Local Accounts (ldap mode only)

The **Settings → Directory → Local Accounts** tab appears **only while the server's auth mode is `ldap`**. It issues ID/password logins to **external consultants** who have no directory (HR) account.

- **Create account**: login ID, name, department code (optional), and password.
- **Login order**: a sign-in checks local accounts first, then falls back to AD (company account) authentication. Attempts are throttled to **5 per 5 minutes**.
- **Management**: per account, **Reset password**, **Deactivate / Reactivate**, and **Delete** (permanent, no undo). When a consultant's engagement ends, deactivate the account first before deleting.
- **Sysadmin toggle**: grants sysadmin to local accounts only (AD/HR directory accounts are designated via `BPM_SYSADMINS` alone, see section 1; effective in ldap mode only).
- Token lifetime, secret rotation (invalidates every session), and other operational contracts live in `docs/deploy/deploy.md` §2.1.

---

## 8. Database Viewer & Operations Dashboard

**Settings → Database → Tables** is a read-only browser over the backend database with server-side paging, sorting, and filtering.

- Use it for spot checks. It never writes.
- **CSV export** (sysadmin only): the **Export CSV** button in the header downloads **all rows** with the current sort and filter applied, streamed from the server (no paging). Excel compatibility (BOM) and the formula-injection guard match the admin-table exports.
- **Login records** live in the `login_records` table: one row per user per day, written on first authentication of the day. This is the audit view for "who used the app when".
- **Notification retention**: `notifications` keeps only the **most recent 100 rows per person**, a fixed policy (not adjustable). Overflow is auto-deleted oldest-first, regardless of read state, whenever a new notification arrives.

### Purging Notifications by Date Range

Selecting `notifications` in **Tables** adds a from–to date range and a **Delete in range** button to the header.

1. Pick the range to delete and click **Delete in range**.
2. A **preview dialog** groups that range's notifications by content (type + message), showing recipient counts and the date span (everything is **selected by default**).
3. Uncheck any groups you want to keep, then confirm. Every recipient row in the selected groups, within the range, is **hard-deleted**. **There is no undo**, so use with care.

### Batch Job Status (Settings → Database → Batch jobs)

Shows the latest attempts of the **DB backup** and the **HR (people) sync**, per job. The last **success** and the last **failure** each keep their time and summary, so you can tell at a glance in the morning whether the overnight batches ran clean. A failure row newer than the last success is your signal to act.

- **Backup now (on demand)**: the **Backup now** button on the DB backup card makes a backup outside the daily schedule. In production (postgres) the backend drops a request file that the sidecar picks up within seconds to run `pg_dump`, so after the "Backup requested" notice, re-check the list a moment later; local sqlite copies immediately.
- **Backup files and download**: the same card lists the backup files in `${BACKUP_DIR}`, and each can be **downloaded** for an off-server copy (sysadmin only).

### Daily Automatic DB Backup (production server)

The server compose stack includes a **`db-backup` sidecar**:

- It runs `pg_dump` once a day after **04:00 KST**, plus once right after the container starts when today's dump doesn't exist yet (deploy baseline).
- A dump is **kept only after it passes `pg_restore --list` verification**, and the outcome is recorded on the Batch jobs tab.
- Dumps land on the host at `${BACKUP_DIR}` (default `./backups`); retention is `${BACKUP_RETENTION_DAYS}` (default **14 days**). Older dumps are pruned automatically.
- For now backups live **only on the server disk**. That leaves disk failure uncovered, so periodic off-server copies are recommended. **Recovery procedures (overwrite restore, fresh server) follow the `docs/deploy/backup.md` runbook.**

### Dashboard (Settings → Analytics)

Live operational metrics from the database, at a glance:

- **Operations**: counts of all maps, published, in-progress, and trash; open comments; unread notifications (yours); and checkout transfer requests.
- **Version status**: the distribution of versions across draft, in-review, approved, published, and expired.
- **Adoption by department**: the share of departments that own a map. The denominator (which departments count) is picked by the admin in the **Coverage** sidebar.
- **Login & activity** and **Cumulative growth** (map/version creation over time): a period filter (**7 days** / **1 month** / **3 months** / **Custom**) adjusts the time series. Snapshot metrics ignore the period filter.
- **Recent version events** and **AI usage** (7-day / 30-day call counts, top maps).

**Dashboard access** can be delegated by a sysadmin. Grant it from the **Access** sidebar on the right of the dashboard to people, departments, or user groups, and a non-admin with a grant can open the dashboard (sysadmins always can). With no grants, only sysadmins see it.

---

## 9. Trash and Recovery

Deleting a map or group is a **soft delete**. It moves to the trash and is permanently purged after **7 days**.

- Owners see their own deleted maps in **Settings → Scheduled deletion**; a sysadmin sees **everyone's**.
- **Restore** brings a map back intact (versions, nodes, permissions).
- After the 7-day window the purge is permanent. There is no undo beyond that point.
- **Instant purge (sysadmin only)**: the instant-delete button on a trash row removes a map immediately without waiting out the 7 days. It only works on maps already in the trash (soft-deleted), and **cannot be undone**, so use with care.

---

## 10. Version Workflow · Admin Powers

Everything in the user manual's workflow section applies, plus:

- **Force checkout**: take an active editing lock when the holder is unavailable. Use it sparingly; the previous holder loses unsaved work context. Checkouts never expire on their own (they change only by transfer, an approved request, or force checkout), so this is how you reclaim an absent holder's lock.
- **Decide anywhere**: as effective owner you can submit and publish on any map, and decide checkout requests and transfers. **Withdraw** is the exception: Pending and Approved versions can be withdrawn only by the **submitter**; only a Rejected version can be withdrawn by the map owner or a sysadmin.
- **Approver reassignment**: when a map has no active approver (e.g. the only approver left the company), use the forced-reassign flow in Map Settings → Approvers to appoint new ones.
- Remember the publish rule: publishing a version marks the previously published one #Expired, a terminal state that cannot re-enter approval. Use **Republish** to start a new cycle from it.

---

## 11. Publishing This Manual

**/manual** can hold multiple documents (like notices). Manage them from **Settings → Content → Manual**:

1. In the **document list**, click an existing document to edit it or use **New document** to add one. Delete with the trash button on each row.
2. Pick the format (**Markdown**/**HTML**, HTML is sanitized before rendering) and the **language (Korean/English)**. The viewer lists only documents matching the current KO/EN toggle.
3. Write in the editor, **Upload .md** to load a file, or **Load bundled** to start from the copy shipped with the build.
4. **Preview** renders exactly what users will see; **Publish** makes it live at /manual immediately.

- The list title is **auto-extracted from the first heading** on save.
- Upload KO/EN documents as pairs in the same order. Switching languages in the viewer opens the document at the same position.
- With no documents registered, the viewer shows the default manual shipped with the build.
- **Bundled fallback**: if nothing was ever published, the app serves `backend/app/manual.md` shipped with the build, and the viewer shows a **Bundled with build** badge instead of an update time.
- The same publish is available as a sysadmin API call:

```
PUT /api/manual
{ "format": "markdown", "content": "<the full markdown>" }
```

The viewer builds its table of contents from `##` and `###` headings, so structure documents accordingly. The renderer supports headings, flat lists, tables, fenced code blocks (hover to copy), inline code (click to copy), blockquotes, links, bold/italic, and `#word` pills. Images and raw HTML are not rendered.

---

## 12. AI Chat Settings

**Settings → Content → AI chat** (sysadmin only). Changes apply immediately (no redeploy).

- **Chat storage**: AI chat conversations are always stored on the server (scoped to user + map; only the owner can view them). This is not a toggle. They live in the `ai_chat_sessions` (chats) and `ai_chat_messages` (messages) tables, browsable in the table viewer.
- **Retention caps**: admins tune the number of chats per map, messages per chat, and days kept since last activity. Overflow is pruned oldest-first.

| Key | Default | Range |
| --- | --- | --- |
| `ai_chat_max_sessions_per_map` | 20 | 1–200 |
| `ai_chat_max_messages_per_session` | 200 | 10–2000 |
| `ai_chat_retention_days` | 180 | 7–3650 |

- **Chat loading tips**: manage the feature tips shown while earlier messages load in chat. One tip per line (200 chars each, up to 50). **Save an empty list to restore the 20 defaults.**
- **AI access switch**: the toggle at the top of the panel suspends every AI feature (chat, interviews, …) without a redeploy. AI is effectively available only when `AI_ENABLED` is on and this switch is on.

### Knowledge Base (Settings → Content → Knowledge base)

A library of **organization documents the AI consultant can cite during interviews**. Upload SOPs and guides to ground its answers. Supported formats are pdf, docx, xlsx, txt, and md (max 20 MB per file); add files with **Upload** and reload the list with **Refresh**. The knowledge base works only when both `AI_ENABLED` and the embedding server `EMBED_URL` (section 14) are set.

### AI Prompts (Settings → Content → AI prompts)

**Override the built-in prompts** used by the AI features (chat, interviewer, drafter, …) from the screen. Saving applies immediately without a redeploy, and clearing an override falls back to the prompt shipped with the build. **While an override is in place, prompt improvements shipped in code are not picked up**, so re-check after deployments whether each override is still needed.

---

## 13. Framework Management

> The work framework is still at a **pilot stage**. Its screens and data may change.

**Settings → Framework** manages the work-framework category tree. The toggle at the top switches between the **Manage** view (tree, admins, import) and the **Status** view (linkage-canvas confirmation board). A sysadmin sees the whole tree; a **user delegated as a category admin** gets the same screen in Settings, scoped to **their own subtree**.

### Category management and level delegation

- **Layout** · the Manage view is two columns: the **category tree** on the left and the **detail panel** on the right. Clicking a row's name selects it (and expands it when it has children); the panel header then shows the level pill, name, and code, and the info line below shows **Maps · L5 · Managing dept · Admins · Canvas** (plus an **Open** link when an L5 has a linkage map). The selected row is tinted in the tree. Typing in the search box above the tree and clicking a hit expands the ancestor branch and selects that row right away.
- **Category management** · add child, rename, managing department, linkage admins, move, and delete all sit as **buttons in the right detail panel** (tree rows no longer carry action icons). Actions you cannot run are disabled rather than hidden, so hovering a button tells you why (nothing selected, max depth, outside your delegated scope). Max 5 levels, and a category cannot move under its own subtree. Deletion is refused when the subtree has linked maps; otherwise the whole subtree is deleted. **Maps can be assigned only to leaf categories (L5).** Renaming a category renames its linkage-canvas map along with it, and **a category (subtree) that has a canvas cannot be deleted until the canvas is cleaned up** (409). Two categories with the **same name** cannot exist under one parent (409). A **managing department** left empty is inherited from the parent category, and the category's linkage canvas takes that value as its owning department, which is where it appears in the **L5 canvases** group of the home org tree.
- **Delegation scope**: a category admin can add children, rename, and reorder inside their own category (including the delegated category itself). **Move and delete** are refused on the delegated category itself and allowed only on categories below it, and a move's new parent must stay inside their scope. **Appointing admins** is allowed only on levels below their own. **Admins appointed on an L5 only** can edit and confirm the canvas but every structural change is refused. **Creating top-level categories and running the interview import stay sysadmin-only.**

### Linkage admins

- Select a row in the tree, then use the **Linkage admins** button in the detail panel to appoint the **linkage-canvas editors** (users/groups). In the dialog, additions and removals are **buffered and saved with one Confirm click**; Cancel, `Esc`, or clicking outside discards them.
- The grant **inherits downward**. Appointing at a higher level (L1–L4) covers every L5 canvas underneath ("Admins granted here also manage every category below it").
- Admins are listed in the **Admins item of the detail info line**, not on tree rows: only the ones **directly appointed** on the selected category, up to three, with the rest behind a **+N** hover tooltip. Names use the language-based "primary (secondary)" dual display.

### Confirmation governance

- A linkage canvas exists as a real map (`mode=framework`) but never appears in the regular map list or the subprocess library. Confirmed snapshots carry the **confirmed** status, separate from publishing, and cannot be deleted; neither can the live draft. Regular map workflows (submit, publish, approvers, collaborators, rename requests, subprocess registration) are **blocked on the server** for canvases.
- **Six confirm gates**: all linked L6 placed · no placeholders · no stale links · all linked L6 published · no exit-less loops · branches use decision nodes (exempt when every outgoing edge is a parallel fan-out). The **Confirm readiness** checklist on the editor's Approval tab is the single source, and the confirm button stays disabled while any gate fails.
- **Who confirms**: only the draft's checkout holder confirms directly, and only when they are a **direct admin of that L5** or a sysadmin. Admins of a higher category send a **confirm request** (their checkout is released automatically on send); recipients are the direct L5 admins plus sysadmins (fallback deciders). A direct admin or sysadmin who tries to request is told to confirm directly (409). The requester can withdraw until it is decided (the checkout does not come back), and the outcome goes out as a confirm approved/rejected notification.
- **Draft visibility**: the live draft before confirmation is visible only to admins of that category or a parent and to sysadmins. Everyone else lands on the latest confirmed snapshot, with an empty-state notice when none exists.
- A category admin's **major confirmation** permanently prunes the previous major's intermediate minor snapshots (X.0 and the last minor are kept). The confirm dialog previews what goes.

### Slot changes

- Which L5 category a map belongs to is managed as a **slot** (assign, unassign, move, hand off, delete - from the Framework pill on the home card), and the decider is the **direct admin of that L5** (sysadmins too) - admins of a higher category (L1–L4) can edit the canvas but cannot decide a slot change directly, only request one. A move between two L5s needs approval from **both L5s' direct admins** (one admin covering both counts as a single approval).
- When the requester is themselves a direct admin of the affected L5 (or a sysadmin), the change **applies immediately** with a notice dialog; otherwise a request (`fw_slot`) is created and appears in the L5 admins' Inbox, the map's Approval tab, and **Settings → Approvals → Approval Queue** (section 6).

### Status board

The **Status** view lists every L5 in scope in one table: **Path / Latest confirmed / Status** (Ready · Blocked · No canvas) with an **Open** button. Blocked canvases carry their failing gates as negative pills (Missing L6 · Placeholders · Stale links · Unpublished L6 · Exit-less loop · Direct fan-out). The **category summary card** in the home Framework view shows the same verdicts under "Subtree confirmation".

### Interview import

Upload the consultant-delivered L5 interview result JSON files (multiple files at once), validate with **Dry run**, then **Apply** (sysadmin only).

- **Picking files** · the **Choose interview JSON files** button in the **Interview JSON** section at the bottom of the detail panel (next to **Copy external AI prompt**, see "Fill an L5 with AI" below) opens the file browser directly (it stays available whatever row is selected). Picked files line up as name pills in a **full-width strip** under the two columns; remove one with the × on its pill or empty the strip with **Clear all**. A file that fails to parse is outlined in red and left out of the payload. **Dry run** sits at the end of the same row next to the selected count, and the report opens full width below the strip.

- **Format**: interview JSON **0.4** (with the `relations` flow graph) and **0.5** (adds external L6 references, `externalTasks`) are accepted. 0.3 files are rejected because their flow would collapse into a straight line. Files with errors are skipped as a whole while the rest proceed, and the import is idempotent, so re-running the same files is safe. Contract: `docs/samples/interview-json-0.5.md`.
- **External L6 references (0.5 `externalTasks`)**: when a flow edge points at an **L6 in another L5**, it is referenced by "owning L5 code + L6 name" only, without a taskId. If that L5 has not been delivered yet, only the L5 lineage is created and the canvas gets a placeholder titled **`(L6 unspecified) <L5 name>`**; when exactly one normalized name matches inside that L5 it is connected automatically (two or more matches keep the placeholder with a warning). When a later delivery resolves it, the L5 admins get an **External L6 connected** notification and a version event is recorded. `framework.categories[].admins` can add category admins (add-only).
- **Dry-run report**: a **two-column layout**. The left column holds the **Summary** (six cells: files, maps, canvases, warnings, ...), the **Needs attention** digest (repeated warnings collapsed to one line per kind with affected maps and counts), **External L6** (connected, placeholder, ambiguous, no source), **Category admins**, and **Governance changes**; the right column holds **file cards → L5 linkage canvas → map list** (capped at four rows; expanding a row shows a **map preview**, an L5 canvas a **canvas preview**). Clicking an item moves focus to the related card, the status pills filter the list, and file-level issues collect in a separate digest. Messages are bilingual (English + Korean), and raw keys such as taskId and unitId show only behind the # icon tooltip. With many files the list scrolls inside an eight-row box under a count header, and **Clear all** empties it. Pressing Dry run opens the report area first with a spinner ring, and the result fills the same spot; the report body stays within the viewport height with the **left and right columns scrolling independently** (scrolling the right side keeps the summary in view). A sticky toolbar at the top of the right column carries the count, a search box, and sort options (**Order / Name / Issues / Maps**), and cards load ten at a time as you scroll (an item picked on the left that is not yet visible is revealed and scrolled to). The applying, re-validating, and applied notices appear as a translucent layer centered on the report body.
- **Governance changes (re-import)**: when an existing map's **owner · owning department · approvers · imported notes** differ from the delivery, they are listed as rows in the "Governance changes" section. Each row is decided with a **Keep ↩ / Replace ⇄** dropdown; **only checked (Replace) rows are replaced on apply** and the rest keep their current value. An imported note whose content is unchanged produces no row at all; when it differs, the "Show changes" accordion shows a −/+ diff. Owner, department, and approvers are checked by default; imported notes are checked by default only on maps where no imported note has been hand-edited (notes people wrote themselves are never touched). Apply from the sticky bar at the bottom of the report ("N maps · M governance changes checked").
- **Owner assignment**: when the delivery's owner is empty or not in the directory, the importing sysadmin holds the owner seat temporarily and the card shows an **Owner unconfirmed** pill. Hand it over with Map Settings → Danger Zone → **Transfer Ownership**; the pill clears, and later deliveries only propose the owner as a governance row instead of overwriting it.
- **Department path resolution**: the delivery's `department` (a slash path from the root) is matched to the org department tree in four steps: exact match → match with leading levels dropped → unique suffix match → department mirror chain alignment. When none matches, the **delivered path is registered as is** as the owning department and appears under that name in the home department tree. Remap it on Settings → Directory → Departments.
- **Landing rules**: activities (L7) become nodes (input/output/data form/system/link) and flow edges (seq/branch/loop/bypass) become connectors. A branch promotes its source node to a decision, and a loop back to the same node synthesizes a branch node titled **"반복 여부(자동 생성됨)"** (fixed Korean title: "repeat? - auto-generated"). Start/end conditions, total time, touch time, and system land as map fields, with their originals kept as **Source notes** (editor Map tab, subprocess info tiles on the home detail card). **Annual volume and FTE** land both as the map's subprocess designation reference values and as the L5 canvas node values. Outputs and inputs that match exactly are auto-linked as IO links, nodes are auto-laid-out horizontally, and an editable draft is created right after publishing (an untouched draft is reused by the next delivery).
- **Role and system normalization**: the delivery's `ownerRole` lands as the map's subprocess designation **Role** (the `Owner role:` line in the map description is kept as is, and it is not propagated to activity nodes). System values on the map and on activity nodes are checked against the **catalog (Settings → Directory → Catalogs)**: aliases become the canonical spelling and values not in the list are stored as **Other + source note**, with one "system 'x' normalized to 'y'" / "system 'x' not in catalog - stored as Other" row per map in the report. The normalized result is also what re-delivery comparison uses, so uploading the same file again is not flagged as a "change".
- **L5 linkage canvas**: created or augmented from the flow between top-level L6s (decision nodes inserted for branches, loops laid out as return edges). Re-deliveries **only add** nodes and never move them, and skip the canvas while someone else holds its checkout.
- **External taskId placeholders** - when a flow edge points at a taskId absent from this delivery, it lands as a **placeholder node titled with that code** (uncategorized). A later delivery that includes the taskId resolves it automatically (edges are kept) - the confirm checklist's **No placeholders** gate catches it until then. If a map for that taskId already exists (delivered earlier by another L5), it is placed as a real external-L6 node instead of a placeholder. A slot assignment or move that brings a map into an L5 also fills any matching placeholder elsewhere on a linkage canvas, the same way a later delivery does.
- **Notes and GMP**: per-task exception rules, VOC, rule basis, and open issues land as map notes; the L5's entry, flow, open-issue, and task notes land as category notes (linkage-canvas Map tab). Classify GMP (GMP Direct / Indirect / Non-GMP) and settle conditions/times in **Map Settings → Details → Conditions & GMP**; the GMP you select survives redeliveries.

### Fill an L5 with AI

Fill an L5 through a conversation with AI instead of a document (sysadmin only). You start by **picking the target row in the category management tree**: click a row on the left, or find it through the search box, and the right detail panel shows the **tile actions** that fit that level.

- **Tiles in the admin panel also drill down.** At levels 1 through 3, the **Go deeper** block of the detail panel lists child categories as two-column tiles; clicking one moves the selection there (a tile shows an **n in progress** badge when sessions exist under it, and a long list folds into "+n more in the tree"). Level 4 shows a name field with a **Create L5 and start with AI** tile, and level 5 shows a **Work with AI** tile (**Resume AI session** when a session is already in progress) in the same spot.
- **Fill an existing L5** · select a level-5 row and press the **Work with AI** tile to open a campaign session for it. When that L5 already has a session in progress the tile reads **Resume AI session** and takes you into the same session.
- **Create an L5 and start** · select a level-4 row, type the new L5 name in the name field of the detail panel, and press **Create L5 and start with AI**; the category is created under that L4 and the session opens right away.
- On an L4 row the create tile stays disabled while the name is empty, and **an L5 with the same name under that L4** is refused with "An L5 with this name already exists here". There is no separate session list: to return to a session, pick the L5 row and press **Resume AI session**.

- **Four steps.** (1) **Plan**: given an optional brief and attachments, AI proposes a list of L6 task cards to register under that L5. The screen has three columns: the brief and attachments on the left, stage rows in the middle (top to bottom is the order, one row is in parallel; stages are computed from each card's preceding cards), and the selected card's details on the right (name, summary, role, department, preceding cards, remove). Drag a tile onto another row to change what precedes it, within a row to reorder, or onto the dashed bottom row to open a new stage (Alt+arrows on a selected tile do the same). Branches and conditions are not set here; they come in the connections step. Edit, add, or remove cards, then press **Lock**; the list is fixed and questionnaire prep starts in the background for each card. (2) **Questionnaire**: answer an AI-generated, mostly multiple-choice questionnaire for each L6 card. The questions focus on settling what is ambiguous in the procedure (who decides, branch conditions, where a rejection goes back to, parallel or sequential, exception paths, where the L6 starts and ends) rather than filling fields; anything already readable from the brief, attachments, or existing maps is not asked but pre-filled as the suggestion, and each question carries a one-line reason underneath. Sections run decisions and exceptions, activities, basics, inputs and outputs. Every question must be answered before you can submit (a blank free-text answer is filled with the suggested value automatically), and submitting immediately draws that card's flow in the background while the next questionnaire is prepared. A submitted card cannot be reopened. (3) **Connections**: entering the step, AI proposes the flow between L6s right away (an overlay ring holds for at least 1.5 seconds while it works). The editable **L5 linkage canvas** fills the screen and the feedback chat floats above it as a window (drag it, resize it, or minimize it into a speech-bubble chip at the bottom right; the board on the left already lists the L6 cards). The L6 nodes on the canvas are the same node component as the L5 map, so they show each card's role, department, and summary; the rolled-up parameters stay empty until registration creates the linked maps. On the canvas you can drag nodes to reposition them, right-click a node for a menu to insert or remove a branch (decision) after it, and click a connector to type its label (a condition); every edit auto-saves with a 300ms debounce. Instead of editing by hand, send a plain-language request in the chat (for example, "swap the order of the first two steps") and AI redraws the canvas to match. Plain-language changes all go through the chat: the current nodes and layout stay and only the requested part changes (say "start over" to get a fresh flow). The **Propose again** button at the top is different. It discards the canvas, including your manual edits, and proposes from the cards again; it asks for confirmation first and leaves a "Proposed again from scratch" line in the chat history. The board rows' **Preview** and **Revise** (asks the questions again and redraws only that card) still work the same way, and pressing **Confirm connections** finishes the step. (4) **Register**: the assembled document goes through the same screen as interview import. Entering this step **runs the Dry run automatically** so the report appears right away, and **Back to connections** returns you to the previous step at any time before Apply.
- **Any board row is clickable, whatever its status.** Clicking a row on the left board opens that card's panel on the right: a pending row shows a preparing indicator, a row being answered opens the questionnaire, a just-submitted row shows the answers with a drawing indicator, and a finished (drawn) card shows the flow **preview** together with the **feedback chat** so you can ask for changes to that card alone in plain language (this keeps working after you reach the register step, too). Closing the panel returns to the automatic flow (the card currently in progress).
- **Existing L6 maps are loaded first.** Starting a session reads the L6 maps already registered under that L5 and feeds them into the plan, the questionnaires, and the drawing. The plan screen shows a "n existing L6 maps were loaded" note, and each loaded map arrives as a card with an **Existing** chip at the top of the list. An existing card defaults to **Keep**, meaning this round leaves it alone; select the card and switch the **Keep / Revise** toggle in the details column to Revise and only that card goes through a questionnaire again. A revise questionnaire and its drawing start **from what is registered today**, asking what to change and leaving anything you do not answer at its current value. Existing cards cannot be deleted (removing one brings it back on save). On Lock, kept cards land on the board as **Drawn** without a questionnaire and only revise cards queue up. The board and the connections screen carry the same **Existing / Revise** chips, and a kept card's **Revise** button switches it after the lock. In the register Dry run a kept L6 reads **Unchanged** and a revised one reads **Updated**.
- **Brief and attachments are kept apart.** "Purpose and scope" on the left of the plan screen is text you write; attached documents are listed below it, one entry per file. Attaching alone generates nothing. Once the brief and attachments are in place, press **Propose L6 cards** and the AI reads both. A wrong file is removed with the delete button on its row, then propose again (nothing accumulates).
- **Free-text answers start blank.** A free-text question on the questionnaire screen opens with an empty box; press **[AI suggestion]** and the suggested value types itself in (leaving the box commits that value). Hover a committed answer to reopen it with the pencil icon. Submitting the box blank still works, since the server applies the suggested value.
- **Cards that fail on the AI side.** When the AI reply does not match the expected format, the request is repeated up to three times with the validation errors fed back; if it still fails, the card stops as "Failed". Use **Retry** on the board, or **Skip with placeholder** to register that L6 as a one-activity placeholder and keep the session moving (draw it in the editor after registration; the card keeps a "Placeholder" tag).
- **Pause, resume, and returning to a session.** The pause button at the top of the board stops background generation (questionnaire prep, flow drawing); resume continues it. A session is stored in the database, so leaving the page does not lose it. Pick that L5 row again in the management tree and the **Resume AI session** tile takes you back into the same session; the child tiles of higher categories carry an **n in progress** badge so you can see where sessions are.
- **Registration behaves like interview import.** Pressing Apply publishes the maps right away, and the L5 linkage canvas stays a draft until it is confirmed (same rule as Chapter 13, Confirmation governance). From the completion screen you can open the linkage canvas or download the assembled JSON.
- **External-AI prompt round trip.** If you cannot upload documents directly, use **Copy external AI prompt** in the **Interview JSON** section at the bottom of the detail panel or on the session screen to copy a prompt that asks for the interview JSON 0.5 contract, and paste it into an external AI (a chat assistant that accepts document attachments, for example). The JSON it returns can be uploaded through the interview import section above (Dry run, then Apply) exactly as delivered.

---

## 14. Configuration Reference

| Variable | Where | Effect |
| --- | --- | --- |
| `BPM_SYSADMINS` | backend `.env` | Comma-separated login IDs granted sysadmin |
| `AUTH_MODE` | backend `.env` | Auth mode: `keycloak` \| `ldap` \| `dev`. Empty falls back to legacy `AUTH_ENABLED` (`true`→keycloak, `false`→dev). The frontend has no build-time equivalent. It reads the resolved mode at boot from `GET /api/auth/mode` |
| `AUTH_ENABLED` | backend `.env` | Legacy on/off switch, superseded by `AUTH_MODE`. Kept for backward compatibility |
| `AUTH_JWT_SECRET` | backend `.env` | Signing key for ldap-mode session tokens (**required in ldap mode**). Rotating it invalidates every issued session immediately (kill switch) |
| `AUTH_JWT_TTL_HOURS` | backend `.env` | ldap-mode session token lifetime in hours. Default 8 |
| `DEV_ENFORCE_PERMISSIONS` | backend `.env` | Enforce RBAC locally even with auth off |
| `MANUAL_URL` | `.env` (compose) | Manual-site button on the editor toolbar (hidden when empty) |
| `N8N_HR_URL` | backend `.env` | n8n HR webhook URL (single source for people and org chart). Sync activates only with the token set too |
| `N8N_HR_TOKEN` | backend `.env` | HR webhook X-API-Key secret (shared with the EDW position webhook) |
| `N8N_POSITION_URL` | backend `.env` | EDW department-head position webhook (empty disables position collection) |
| `HR_SYNC_INTERVAL_HOURS` | backend `.env` | Built-in HR sync scheduler interval (hours). Default 24, 0 = off. Keep it at 0 for the first migration and raise it after the preview and a manual sync check out |
| `HR_SYNC_DELETE_CAP_PCT` | backend `.env` | Full-sync deletion cap (% of managed rows). Default 20, 0 = guard off |
| `AI_BASE_URL` | backend `.env` | AI server URL (OpenAI-compatible). The in-house GPU is `https://gpu02.sbiologics.com/v1` |
| `AI_MODEL` | backend `.env` | Default model id. After the SGLang move this is **just `glm-5.2`** (the old `-think` / `-high` / `-nothink` aliases are gone) |
| `AI_MAX_TOKENS` | backend `.env` | Response token cap, thinking tokens included. Default 8000. **Too low and replies come back empty** |
| `AI_TIMEOUT_SECONDS` | backend `.env` | Per-call timeout in seconds. Default 60. Max-thinking calls are slow; 120–180 is recommended |
| `EMBED_URL` | backend `.env` | bge-m3 embedding server for the knowledge base (OpenAI-compatible `/embeddings`). Empty disables the knowledge base entirely |
| `BACKUP_DIR` | `.env` (compose) | Host path for db-backup sidecar dumps. Default `./backups`. Point it at a NAS mount to get off-server copies |
| `BACKUP_RETENTION_DAYS` | `.env` (compose) | Backup retention in days. Default 14 |

- Environment changes require a backend restart (`--reload` does not re-read `.env`).
- Keycloak endpoints and all deployment-specific values come from `.env` (never hardcoded).
- The **Exposed positions** list is not an env variable. It is saved from the card on **Settings → Directory → Employees** (see section 7).

---

*Business Process Map · Administrator Manual · updated 2026-09-24*

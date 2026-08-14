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
| **AI chat** | Settings → Content | Retention-cap settings, chat loading-tips management (see section 12) |
| **Employees** | Settings → Directory | Org directory table — HR-webhook full sync, sysadmin tags, CSV export |
| **Departments** | Settings → Directory | Org-basis department table, department remap, CSV export |
| **Framework** | Settings → Framework | Work-framework category management and JSON import — pilot stage (see section 13) |
| **Tables** | Settings → Database | Read-only DB browser (incl. login records), server-side CSV export |
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
- Users watch their own submissions, so status changes and replies are visible to them immediately.

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

> Separately, **map renames** and **subprocess registration requests** are decided by the **map owner** — since sysadmins hold owner rights on every map, you can handle those cards for any map from the Inbox (Approvals). For subprocess registration, **saving the designation form is the approval**, and a map with no published version cannot be designated yet.

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

---

## 13. Framework Management

> The work framework is still at a **pilot stage** — its screens and data may change.

**Settings → Framework → Categories & import** (sysadmin only) manages the work-framework category tree.

- **Category management** — add top-level/child categories, rename, move within the tree, delete (max 5 levels; a category cannot move under its own subtree). Deletion is refused when the subtree has linked maps; otherwise the whole subtree is deleted.
- **Bulk JSON import** — upload `categories.json` and `maps.jsonl`, check the impact with **Dry run** (created / updated / unchanged / errors / warnings), then **Apply**. The import is idempotent — re-running the same files is safe.

---

## 14. Configuration Reference

| Variable | Where | Effect |
| --- | --- | --- |
| `BPM_SYSADMINS` | backend `.env` | Comma-separated login IDs granted sysadmin |
| `AUTH_ENABLED` | backend `.env` | Enable Keycloak JWT verification |
| `NEXT_PUBLIC_AUTH_ENABLED` | frontend env | Enable the Keycloak login flow in the UI |
| `DEV_ENFORCE_PERMISSIONS` | backend `.env` | Enforce RBAC locally even with auth off |
| `MANUAL_URL` | `.env` (compose) | Manual-site button on the editor toolbar — hidden when empty |
| `N8N_HR_URL` | backend `.env` | n8n HR webhook URL (single source for people and org chart) — sync activates only with the token set too |
| `N8N_HR_TOKEN` | backend `.env` | HR webhook X-API-Key secret — shared with the EDW position webhook |
| `N8N_POSITION_URL` | backend `.env` | EDW department-head position webhook — empty disables position collection |
| `HR_SYNC_INTERVAL_HOURS` | backend `.env` | Built-in HR sync scheduler interval (hours). Default 24, 0 = off — keep it at 0 for the first migration and raise it after the preview and a manual sync check out |
| `HR_SYNC_DELETE_CAP_PCT` | backend `.env` | Full-sync deletion cap (% of managed rows). Default 20, 0 = guard off |

- Environment changes require a backend restart (`--reload` does not re-read `.env`).
- Keycloak endpoints and all deployment-specific values come from `.env` — never hardcoded.
- The **Exposed positions** list is not an env variable — it is saved from the card on **Settings → Directory → Employees** (see section 7).

---

*Business Process Map — Administrator Manual · updated 2026-08-14*

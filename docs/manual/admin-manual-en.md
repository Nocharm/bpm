# Business Process Map — Administrator Manual

> This manual is for **system administrators (sysadmin)**. It covers the admin consoles, moderation duties, and the extra powers a sysadmin holds across every map. Read the **User Manual** first — everything there applies to you too.

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
- Admin-only consoles under **Settings**: Notices, Employees, Permissions, Database, Approval Queue.
- Moderation authority: user-group approval, feedback replies and status, global trash, manual publishing.

---

## 2. Admin Console Map

All admin surfaces live under **Settings**. The left rail shows extra categories when you are sysadmin:

| Console | Location | What it does |
| --- | --- | --- |
| **Notices** | Settings → Content | Create, edit, and delete announcements |
| **Manual** | Settings → Content | Edit and publish the in-app manual (see section 11) |
| **AI chat** | Settings → Content | Retention-cap settings, chat loading-tips management (see section 12) |
| **Employees** | Settings → Directory | Org directory table, **Sync all from AD** |
| **Permissions** | Settings → Permissions | Departments and Users tabs, sysadmin tags |
| **Tables** | Settings → Database | Read-only DB browser (incl. login records) |
| **Approval Queue** | Settings → Approvals | Cross-map pending requests |
| **Dashboard** | Settings → Analytics | Operational metrics from the live database |
| **Groups** | Settings → Groups | Approve group requests, see all groups |
| **Scheduled deletion** | Settings → Trash | All soft-deleted maps and groups |

---

## 3. Notices Management

Create and manage announcements shown on every user's **Notices** tab.

1. Go to **Settings → Content → Notices**.
2. **New notice**: title, importance (**Important** / General), posted period (start–end, or **No end date**), and a **Markdown** body.
3. Check **Notify all users on publish** to push a notification to everyone's Inbox.

- Users only see notices whose posting period is currently active; the admin list shows all of them.
- Editing or deleting a notice takes effect immediately.

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

Each entry shows the requester and context; decide with Approve / Reject (rejection takes a reason). Map-scoped requests can also be decided by that map's approvers — the queue is your catch-all view.

---

## 7. Directory and Employees

**Settings → Directory → Employees** shows the org directory the app uses for assignees, collaborators, and approver pickers.

- The table includes organization levels and each user's sysadmin flag.
- **Sync all from AD** refreshes the directory from Active Directory. Run it when people join, move, or leave.
- Assignee pickers in the editor resolve against this directory — a stale directory means missing people in pickers.

---

## 8. Database Viewer and Login Records

**Settings → Database → Tables** is a read-only browser over the backend database with server-side paging, sorting, and filtering.

- Use it for spot checks — it never writes.
- **Login records** live in the `login_records` table: one row per user per day, written on first authentication of the day. This is the audit view for "who used the app when".
- The **Dashboard** (Settings → Analytics) summarizes these records at a glance: **Visitors** (unique login IDs), **Total logins**, and **Logins · last 7 days**. More metrics arrive in a later release.

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
- **Decide anywhere** — as effective owner you can submit, publish, and withdraw on any map, and decide checkout requests and transfers.
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

## 13. Configuration Reference

| Variable | Where | Effect |
| --- | --- | --- |
| `BPM_SYSADMINS` | backend `.env` | Comma-separated login IDs granted sysadmin |
| `AUTH_ENABLED` | backend `.env` | Enable Keycloak JWT verification |
| `NEXT_PUBLIC_AUTH_ENABLED` | frontend env | Enable the Keycloak login flow in the UI |
| `DEV_ENFORCE_PERMISSIONS` | backend `.env` | Enforce RBAC locally even with auth off |
| `MANUAL_URL` | `.env` (compose) | Manual-site button on the editor toolbar — hidden when empty |

- Environment changes require a backend restart (`--reload` does not re-read `.env`).
- Keycloak endpoints and all deployment-specific values come from `.env` — never hardcoded.

---

*Business Process Map — Administrator Manual · updated 2026-07-09*

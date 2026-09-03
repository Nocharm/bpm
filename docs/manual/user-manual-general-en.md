# Business Process Map — Getting Around

> Business Process Map (BPM) is a web app for drawing business processes as flowcharts, managing them as As-Is / To-Be **versions**, and finalizing them through an **approval workflow**.

This manual covers everything outside of editing — from signing in through map management, version approval, settings, and collaboration. For how to draw and edit nodes on the canvas, see the **Editing Maps** manual. System administrators should also read the **Administrator Manual**.

---

## 1. Getting Started

### Signing in

1. Open the app and click **Sign in with Keycloak** — your company SSO account signs you in. Once you've signed in, later visits sign you in automatically and take you straight to the screen you were opening (deep link).
2. On servers that run company-account (LDAP) authentication, an **ID/password form** appears instead of the Keycloak button — sign in with your company account or a local account issued by an administrator.
3. In development environments, **Sign in with a test account** lets you pick a test user instead.

### Screens at a glance

| Screen | Where | What it does |
| --- | --- | --- |
| **Maps** | top tab | All process maps — search, create, open |
| **Notices** | top tab | Announcements posted by administrators |
| **Inbox** | top tab | Your approval queue and notifications |
| **Manual** | top bar | Manual documents (KO/EN) — pick one from the title dropdown; searchable table of contents and body |
| **Feedback** | top bar | Send a bug report or suggestion to administrators |
| **Settings** | top bar | Your groups, scheduled deletion (trash), and admin consoles |

> **Tip:** On the map list and in this manual, press `/` to jump straight to the search box.

### Roles on a map

| Role | What you can do |
| --- | --- |
| **Owner** | Everything — edit, manage collaborators/approvers/visibility, delete |
| **Editor** | Edit the map and its draft versions |
| **Viewer** | Read-only — browse, compare, comment |
| **Approver** | Review and approve/reject versions submitted for approval |

Every map has an **owning department**; people who belong to it automatically hold **Editor** access (see 2. Map List for creation and 5. Map Settings).

The business **Framework** has its own role apart from map roles: **category admins**, appointed by a system administrator on a category (L1–L5). They edit and confirm the **linkage canvas** of that category and everything below it (Editing Maps manual, section 11), and manage their own subtree of categories in Settings (Administrator manual, section 13).

A map with **Public** visibility is viewable by everyone; **Private** maps are visible only to collaborators and approvers. If you navigate to a private map you're not allowed to see, a no-access notice is shown.

---

## 2. Map List (Home)

### Home dashboard

The right side of the home screen shows a **status dashboard** — a map-status **donut chart**, **recently opened maps**, and an **approvals waiting for me** card, so you can see today's work at a glance.

### Finding maps

- **Org tree (left)** — browse maps by department through an accordion tree. **My department** is pinned to the top as a favorite. Maps without an owning department gather in a **Dept unassigned** group at the bottom of the tree — the owner clicks the **Dept unassigned** pill on the card to open the org-tree picker, and the department is set only after **Confirm**.
- The toggle above the list switches between the **Departments** view and the **Framework** view — a company-wide process-classification tree (L1–L5) for browsing maps, currently in a pilot stage. **Maps are assigned only to leaf categories (L5)**; higher levels group what's below, and assigning or transferring a map to a non-L5 category is blocked with a notice banner. The **linkage-canvas button** on an L5 row opens that category's work-linkage canvas (see "Framework Linkage Canvas" in the **Editing Maps** manual).
- In the Framework view, **clicking a category row** opens a **category summary card** on the right — direct children, subtree L5 and map counts, the admin list, the linkage-canvas state (an **Open canvas** button and the latest confirmed version), and the **Subtree confirmation** status (canvases that fail a gate show as "Not ready"). Picking a map card switches to the map detail; clicking empty space brings the summary back.
- **Recently opened** shows the maps you last worked on — use **Show more** / **Collapse** to expand and collapse the band.
- **All maps** lists everything you can see. Press `/` or use the search box (**Search maps**) to filter by name.
- Filter chips narrow the list by **Status** (Draft / Pending / Approved / Rejected / Published) and by your **Role**. **Clear filters** resets them. On narrow screens the filter pills shrink automatically (full label → short label → icon).
- Click a card to open the **detail panel**: owner, **owning department**, node count, allowed members (Individuals / Teams / User groups), and the full version history (Created, Submitted, Approved, Rejected, Published, Withdrawn). Maps designated as subprocesses carry an **SP badge**. Each version entry supports a right-click menu (**Go to this version** · **View comments**) and a comment-bubble button (section 3), and with edit access you can add or remove collaborators right on the card — the same staged Save / Undo flow as Settings, with the owner and owning-department rows protected (section 5).
- Maps that arrived through a consultant interview import **without an owner** carry an **Owner unconfirmed** pill on the card — until the handover, the importer holds the owner seat. **Transfer Ownership** (section 5, Danger Zone) clears the pill, and later re-imports no longer overwrite the owner.
- At the bottom of the detail panel sit the **Interview notes** left by the import (the original interview wording for GMP, annual volume, duration, touch time, and system — collapsed, read-only) and the **Notes** section. Notes are added, edited, and deleted by the **map owner**: pick a tag from the preset chips (**Note / Exception / VOC / Rule basis / Open issue**) or type `[` in the tag box for the list, add an optional title and the text, then save (`Ctrl`/`⌘+Enter` saves, `Esc` cancels). Notes that came from an import carry an **Imported** mark; editing one shows an **Edited** mark while keeping its source. Non-owners see only the hint "Only the map owner can add or change notes."

### Creating a map

1. Click **New map**.
2. Enter a name and description, and choose **Visibility** (Public / Private).
3. Set the **owning department** (required) — it must be a real org department, and people in it always hold Editor access to this map. The picker browses the **org tree** with indentation, with your own departments pinned to the top.
4. Optionally add **initial collaborators** — individuals, teams, or user groups, each as Viewer or Editor. An invite hint appears while the list is empty.
5. Add **at least one approver** — a map cannot be created without one.

New maps come with **Start and End nodes pre-seeded**, so you can draw the flow right away. You can also create a map on the spot while linking from the editor (see "placeholders" in section 5 of the Editing Maps manual).

> **Create from CSV:** From the dropdown next to **New map**, choose **Create from CSV** to drop a CSV file and immediately create a map pre-filled with nodes. For the CSV format and rules, see "Importing" in the **Editing Maps** manual.

### Copying and deleting

- **Copy** duplicates a whole map under a new (unique) name. It is **available only after the map has been published at least once**, and the copy dialog lets you **pick which published version to copy** (a notice appears when you pick one that isn't the currently published version). The copy opens right away as the new map's **draft**, and the original map's owner is notified of the copy.
- **Replacing the original (retire)** — check **"Move the original map to the trash after copying"** in the copy dialog and the copy takes the original's place: the copy **keeps the current map name**, the original is renamed with a "(Pending deletion)" tag and moves to the trash (7 days, then purged), and the original's **collaborators and approvers are pre-loaded into the dialog** so you can adjust and carry them over. Approvers and editor+ collaborators are notified. If the original is a designated subprocess, you'll see the **list of referencing processes** and must confirm that those links will be removed.
- **Delete** moves the map to the trash. You can restore it within **7 days** from **Settings → Scheduled deletion**; after that it is permanently purged.

### People cards and org info

- Hover briefly (0.7 s) over — or click — a name in version histories, approver lists, or allowed members to open the **person card**: Korean/English names, title and position, home department with its org path, and an **Open messenger** button. Right-clicking a name offers **Send message** and **Info**.
- Click a department card (including the owning department) in the allowed-members list — left or right click both work — to open the **org info modal**: its members (**Members**), a **Sub-organizations** accordion, and the path at the top for moving up the hierarchy. The right-click menu on a department row offers **Org info**.
- Name display follows your **language setting** — Korean names come first when the UI is in Korean, falling back to the English name when no Korean name exists.

---

## 3. Versions and the Approval Workflow

### The version model

A map holds multiple **versions** (As-Is, To-Be, or free labels). A new version starts as a full copy of an existing one. Only **one draft** can be in progress at a time, and a new version can only be created after the current one is published. When creating a version you **type the name yourself** (no "To-Be" is auto-filled), and the **version number is assigned automatically at publish time** — the input hint says so too.

### Statuses

| Status | Meaning |
| --- | --- |
| #Draft | Being edited — only the checkout holder can modify it |
| #Pending | Submitted for approval — canvas is read-only |
| #Approved | All approvers approved — ready to publish |
| #Published | The live version everyone sees |
| #Rejected | An approver rejected it — returned to the author with a reason |
| #Expired | Superseded when a newer version was published (terminal state) |

> **Framework linkage canvases (L5) use "Confirmed" instead of publishing.** When a category admin confirms, a read-only snapshot is created (shown as **Confirmed** in the history), and the regular map workflow — submit, publish, approvers, collaborators — does not apply to canvases. See section 11 of the Editing Maps manual.

### Checkout (single writer)

- A draft is **checked out** to one person at a time; everyone else sees a "{name} is editing — read only" banner.
- **Request checkout** asks the current holder to hand over editing; the holder approves or rejects from their Inbox.
- **Transfer checkout** lets the holder pass editing rights to another editor directly.
- A checkout is auto-released after **30 minutes** of inactivity.
- When a version is **rejected**, the checkout **returns to the submitter** — no other editor can grab the empty checkout right after a rejection.

### From draft to published

1. Make sure **approvers are assigned** (Map Settings → Approvers) — you cannot submit for approval without them.
2. **Submit for approval** — the confirmation dialog lists the approvers who will review, and you can leave an optional comment ("Add a comment (optional)"). If the version was previously rejected, a **Previous rejection** banner with the reason appears in the dialog. On submit the version becomes #Pending and locks, and all approvers are notified.
3. Approvers **Approve** or **Reject** — the approve/reject dialogs show the submitter's **Requester comment** banner, and a rejection requires a **Reason**. The reason is shown on the version and appended to the rejection notification sent to the submitter. Approval is **unanimous** — every approver must approve.
4. **Publish** the approved version (optional comment). The previously published version automatically becomes #Expired.
5. **Withdraw** returns a Pending or Approved version to draft (approvals reset) — only the **submitter** can do this. A Rejected version can also be withdrawn by the map owner or a sysadmin, and whoever withdraws it gets the checkout (edit lock). The withdraw dialog also takes an optional comment — but withdrawing a pending version **before any decision** (no approvals, no rejection) removes that submission record from the history along with its comment. **Republish** creates a fresh draft from a published or expired version to run the cycle again.

> **Stage comments and comment history:** comments left in the submit / approve / publish / withdraw dialogs are stored with the version history. Versions that have comments show a **speech-bubble count button** on the version cards (Map Settings → Versions) and on the version timeline (home detail panel and the inspector's map tab) — hidden at zero — which opens that version's **Comments** modal. Right-clicking a version entry also offers **Go to this version** and **View comments**.

> **Bundling a visibility change (owner only):** the map owner can attach a visibility change to the submission via the **Visibility** dropdown in the submit dialog — a "Visibility will change: … → …" line announces it, and the change applies the moment the version is published. If the version is rejected, withdrawn, or deleted, the bundled change closes with it. The bundled request appears in pending-approvals lists only as a read-only **"Decided with version approval"** row and cannot be decided separately.

> **Self-publish (when you are the only approver):** if the approver list is **just you**, clicking Submit shows a **"Publish now?" Yes/No popover**. **Yes** runs submit → approve → publish in one click; **No** submits normally (pending review). Works the same in the editor and in Map Settings → Versions.

The **approval dashboard** at the bottom of the right inspector shows the stepper (Submit → Review → Publish), each approver's check state, and the available actions. If this map is designated as a subprocess, the approval tab also shows its **designation card** (status and representative attributes). The approval tab and Map Settings → Pending Approvals also consolidate this map's **decision queue** — visibility changes, permission downgrades, map renames, and subprocess registrations, each row with **Approve / Reject**. The **Inbox** tab in the top bar carries a badge with the number of items waiting on you.

---

## 4. Comparing Versions

Open **Compare** from the editor top bar (requires at least one published version). The compare button in the inspector Map tab's version row opens it too.

- Pick **Base** and **Target** versions — captions spell out which side is "before" and "after", and each row in the version dropdown carries a **status pill and last-updated date**. The version already selected on the other side shows its role tag, and **clicking that row swaps the two versions** (same as the Swap button). A "base → target" direction caption stays visible under the Changes panel title.
- Differences are highlighted: **Added** (green), **Removed** (red), **Changed** (yellow) — **edge label changes** show in yellow alongside node changes — with a "Changed: fields" detail and a summary line.
- Field changes are refined into **per-field status colors** — new values are green, removed values red with strikethrough, and changed values sit on yellow with **only the changed part** struck through / bolded. Hover a clipped long value (like a description) to open a popover with the full text. The same rules apply on the change-list rows and on the pills under canvas nodes.
- Connectors render with the **line style saved on the map** (curved/stepped/straight).
- Toggle **Horizontal layout** / **Vertical layout** to re-arrange both canvases.
- Overlapping nodes can be **dragged aside temporarily** — the move is view-only, never saved, and everything snaps back when you switch versions or layout.
- The **Changes** list filters by All / Nodes / Edges; the **Properties** pane shows the selected node's fields (per-run metrics, GMP, I/O & conditions included) side by side. Selecting an edge shows its label and line-style changes.
- The **Summary tab** compares the two versions as numbers — version totals of the seven per-run metrics (base → target with deltas), the contributing node list (click to focus on canvas), plus **Structure** (node/edge counts), **Systems**, **Departments & assignees** (coverage), and **GMP** distribution sections. The **Summary items** dropdown at the top right picks which sections show.
- **Apply To-Be** carries the target's changes forward; **Export** saves the comparison as a PNG — with an info card at the bottom carrying the map name, versions (base → target), and published date.

---

## 5. Map Settings

Open **Map Settings** from the editor. Tabs:

- **Details** — name and description. **Renaming applies immediately only for the owner (or an admin)** — when an editor changes the name, a **rename request** is created and sent to the owner's Inbox; a "pending" badge shows until it is decided, and you can withdraw your own request. If the owner renames directly, any pending request is resolved automatically. Maps imported from consultant interviews also show a **Conditions & GMP** card here, where you review the interview wording and settle the GMP class (GMP Direct / Indirect / Non-GMP), start/end conditions, and total/touch time (your choices survive re-imports).
- **Owning department** — assign or change the map's owning department (Owner / sysadmin only). Its members automatically get Editor access, and changing the department moves that derived Editor access with it. The picker browses the **org tree** with indentation, with your own departments pinned to the top.
- **Collaborators** — add individuals, teams, or user groups as Viewer / Editor. The picker's default (pre-search) list is sorted by **org proximity to you** (the editor's assignee picker sorts the same way — search-result ranking is unchanged). Changes are **staged** (To add / Change / Remove pills) and applied together with **Save changes**, or dropped entirely with **Discard**. Each pill carries a forecast icon: **instant on save** (⚡ Zap, "Applies immediately on save") or **needs approval** (Hourglass, "Needs approval after save") — adds and changes to Viewer grants apply instantly, while **removing an Editor or downgrading one to Viewer goes through approval** (the owner applies everything instantly). Changes awaiting approval stay on the row as an **Approval pending** tag (with the requester's name), visible to everyone; hover your own request to withdraw it in place with the **Withdraw** pill. Duplicate requests overlapping a pending one are blocked, and the owner applying a change directly closes the pending request automatically. Right after saving, the **Undo** button reverts that one save (a confirmation modal lists each item with its forecast icon; leaving the page discards the chance).
- **Approvers** — manage the approver list (locked while a version is under approval).
- **Visibility** — Public / Private. Picking the other value shows an impact preview (e.g., going public removes existing viewer grants on approval) and an **Apply change** confirmation step. The change **requires approval** — the editor inspector's dialog lists the **approvers who can decide** ("Approvers who can decide") and blocks the change while the map has no approvers. It shows **Approval pending** until decided, with **Withdraw request** to pull it back.
- **Subprocess designation** — designate this map so it can be used as a subprocess of other maps, and set its representative attributes. The designated values show live on every node that links this map. **Designation requires a published version.** The designation dialog has three sections (each collapsible, with a header icon to fold or unfold them all):
  - **Attributes** — department (required) and assignee are **row tiles** spanning both columns (label left, value right); clicking one opens the picker in a popover. The department shows only its **leaf department as a pill**; click the pill for the org info modal (path, members, sub-organization tree), and click the tile outside the pill to change the department. The department list puts **your own department chain first** (same rule as the owning-department picker on New map), and changing the department while assignees are set shows a notice that they will be cleared. System and link (URL + label) tiles follow.
  - **Metric tiles** — duration, touch time, **cost**, headcount, **annual volume**, and **FTE**. Cost is one tile: the **₩ / $ tabs** at the front of its popover pick the unit, the tile shows the chosen unit as a pill, and the other currency is cleared on save (one currency only). Clicking a tile opens an **input popover right where you clicked**, with the published version's node sum (Σ) offered as a suggestion and an optional **interview note**. Annual volume and FTE are **reference values** — nodes linking this map keep their own values and show the reference behind the ⓘ in the node inspector.
  - **Detail tiles** — input/output items (the tile shows only the count; the popover edits one item per line with a data form per item — `+ Add` adds a row).
  - Popovers share one set of controls: `Enter` saves and closes (`Ctrl`/`⌘+Enter` in multi-line editors), `Esc` closes without saving, and clicking outside saves when there are changes. The bottom button is a lone **Cancel** while nothing changed; once something did it turns into **Save** with a ▾ menu (**Save / Save and close / Close without saving**). The same tile and popover design is used by the editor's **node edit dialog** (Editing Maps manual, section 2) and by the designation-values section of the inspector's **Subprocess tab**.
  - There is no separate designation description — the **map description** is what the library and link nodes show.
- **Versions** — per-version workflow actions (submit for approval, publish, withdraw…).
- **Pending Approvals** / **Checkout Requests** — decide requests targeted at this map. The Pending Approvals tab gathers all four kinds — visibility change, permission downgrade, map rename, subprocess registration — for per-row **Approve / Reject**; requests bundled with a version submission appear only as a read-only **"Decided with version approval"** row.
- **Danger Zone** — **Transfer Ownership** (you become an editor) and **Delete map** (Owner only).

---

## 6. Notices, Inbox, and Feedback

### Notices

The **Notices** tab lists currently active announcements. Filter by All / Important / General, search, and **Mark Read**; bodies are rendered as Markdown. The read mark is stored **only in this browser (device)** — opening on another device or browser shows it as unread again.

### Inbox

- **Approvals** tab — your personal review queue: version approvals, checkout transfers, permission / visibility requests, **map renames**, **subprocess registration requests**, and framework **confirm requests**. Approve or reject (with a reason) inline; **Open map** jumps to the source. The **Inbox** tab in the top bar carries a badge with your pending count (refreshed periodically). When a version is rejected, the rejection notification carries the reason at the end. Checkout transfers and permission/visibility changes also show their requests and outcomes on the Notifications tab. With nothing selected, the right pane shows an **activity digest**.
- **Handling a subprocess registration request (owner)** — when someone links your map as an unregistered placeholder and requests registration, a **"Subprocess registration" card** arrives (showing who asked and from which map). **Designate & approve** opens the designation form (department required) — **saving it approves the request** and notifies the requester. Use **Go to published version** to review the map first; a map with **no published version cannot be designated yet** and shows a publish-first notice. **Reject** declines without a reason and notifies the requester.
- **Handling a confirm request (L5 admin · sysadmin)** — when an admin of a higher category (L1–L4) asks for a linkage canvas to be confirmed, the L5's **direct admins** and sysadmins receive a **Confirm request** card (with the requester's comment). **Approve** confirms the canvas on the spot; a canvas that fails a gate cannot be approved. The requester can **withdraw** until it is decided, and the outcome comes back as a **Confirm approved / Confirm rejected** notification (Editing Maps manual, section 11).
- **Notification content** — notification sentences carry the map name, version, and actor, rendered **in your language setting**. In the detail pane, hover (0.7 s) or click the **actor name pill** to open their person card (the Korean UI shows Korean (English) names side by side), and the **version chip** (with a leading v-number) opens a version card on hover/click — check its status and creation time, and **jump straight to that version**. Notifications created before rich display shipped keep their original text.
- **Bell** — the bell icon top right refreshes every **5 seconds**. Clicking an item jumps to the **Notifications tab** and opens it (marking it read); you can also mark read or delete (X) an item directly from the bell. Version-approval progress, checkout transfer requests/approvals/rejections, and permission/visibility change requests/approvals/rejections all arrive here.
- **Notifications** tab — unlike the bell, this **loads once when you open the page** (no auto-refresh — refresh the page for the latest). Besides **Mark all read**, a category filter (All/Version/Checkout/Permission/Notice), and per-item delete (X), it supports **selection mode** to check and delete several at once, **delete read notifications**, and **delete before a date** (before that date's midnight). All three bulk actions go through a confirmation dialog, and **every deletion is permanent**.
- **Retention**: notifications keep only the **most recent 100 per person** — anything beyond that is auto-deleted oldest-first, regardless of read state.

### Feedback

Click **Feedback** on any screen: pick a type (**Bug / Suggestion / Question / Other**) and describe the issue, then send — your current screen and open map are attached automatically. Track status and admin replies on the **Feedback** page.

- **Notes** — the note button at the end of each row opens a panel where **anyone** can leave notes (reproduction steps, progress, context). Notes build up as a time-ordered log; you can edit your own, and the **previous text stays in the history**. Deleting a note **archives** it rather than removing it — "Show archived" brings it back into view.
- **Notifications** — when a reply lands or the status changes, an admin sends you a notification (it is deliberate, not automatic). Check them under the bell icon and in your **Inbox**.

---

## 7. User Groups

Groups let you grant map access to several people in one step.

- **Request Group** (Settings → Groups) with a name, description, **at least 2 members**, and **at least 1 manager** (★). An administrator must approve the request before the group becomes active.
- Managers can add/remove members, assign managers, rename (once per week), deactivate/reactivate, and delete the group. Deleted groups sit in the trash for 7 days.
- You see only the groups you belong to or manage.

---

## 8. Quick FAQ

- **Why can't I edit?** The version may be checked out by someone else, pending approval, or you may be a Viewer. Check the banner at the top of the canvas.
- **Why can't I submit for approval?** Assign at least one approver first (Map Settings → Approvers).
- **Why can't I create a new version?** Finish the current draft cycle through publish first — only one draft may exist at a time.
- **I deleted a map by mistake.** Restore it within 7 days from Settings → Scheduled deletion.
- **The Copy button is disabled.** Copy works only on maps that have been **published at least once** — run the cycle through publish first.
- **The canvas won't save.** Check the save checklist: one start node, one primary end, unique end names, and no multi-output plain nodes. (For details, see "Saving and Validation" in the **Editing Maps** manual.)
- **I can't enter cost in both KRW and USD.** A per-run cost uses a single currency — clear one, then enter the other.
- **A linked subprocess is locked.** That map is not **designated** as a subprocess yet. Use **Request registration** in the node inspector to ask its owner, or — if it's your map — publish it and designate it in Map Settings.
- **Why can't I change a collaborator's permission?** If that person holds the checkout or submitted the version for approval, permission changes against them are blocked until the active version workflow is resolved. Conversely, while a downgrade of your own permission is pending approval, checkout and submission are blocked for you.
- **There is no Add note button.** Notes are written by the **map owner** only (category admins on a linkage canvas). Interview notes can be changed only by the editor who **holds the checkout**.
- **I can't see the draft on a linkage canvas.** The live draft is visible only to admins of that category (or a parent) and sysadmins. Everyone else lands on the **latest confirmed** snapshot, and a "No confirmed snapshot yet" notice shows when there is none.
- **The card says "Owner unconfirmed".** The map came from an interview import without an owner. Hand it to the real owner via Map Settings → Danger Zone → **Transfer Ownership** and the pill disappears.

---

*Business Process Map — Getting Around · Updated 2026-09-03*

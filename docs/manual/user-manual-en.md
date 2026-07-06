# Business Process Map — User Manual

> Business Process Map (BPM) is a web app for drawing process maps as flowcharts, managing them as As-Is / To-Be **versions**, and finalizing them through an **approval workflow**.

This manual covers everything a regular user needs — from your first map to publishing an approved version. Administrators should also read the companion **Administrator Manual**.

---

## 1. Getting Started

### Signing in

1. Open the app and click **Sign in with Keycloak** — your company SSO account signs you in.
2. In development environments, **Sign in with a test account** lets you pick a test user instead.

### Screens at a glance

| Screen | Where | What it does |
| --- | --- | --- |
| **Maps** | top tab | All process maps — search, create, open |
| **Notices** | top tab | Announcements posted by administrators |
| **Inbox** | top tab | Your approval queue and notifications |
| **Manual** | top bar | This document — searchable, with a table of contents |
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

A map with **Public** visibility is viewable by everyone; **Private** maps are visible only to collaborators and approvers.

---

## 2. Map List (Home)

### Finding maps

- **Recently opened** shows the maps you last worked on — use **Show more** / **Collapse** to expand the band.
- **All maps** lists everything you can see. Press `/` or click the search box (**Search maps**) to filter by name.
- Filter chips narrow the list by **Status** (Draft / Pending / Approved / Rejected / Published) and by your **Role**. **Clear filters** resets them.
- Click a card to open the **detail panel**: owner, node count, allowed members (Individuals / Teams / User groups), and the full version history with events (Created, Submitted, Approved, Rejected, Published, Withdrawn).

### Creating a map

1. Click **New map**.
2. Enter a name and description, choose **Visibility** (Public / Private).
3. Optionally add **initial collaborators** — individuals, teams, or user groups, each as Viewer or Editor.
4. Add at least one **required approver** — a map cannot be created without one.

### Copying and deleting

- **Copy** duplicates a whole map under a new (unique) name.
- **Delete** moves the map to the trash. You can restore it within **7 days** from **Settings → Scheduled deletion**; after that it is permanently purged.

---

## 3. Editor Basics

Open a map to enter the editor. The top bar holds the version selector, **New version**, **Compare**, **Undo** / **Redo**, **Save**, the process library, and the **AI assistant**.

### Moving around the canvas

| Input | Action |
| --- | --- |
| Mouse wheel | Pan vertically (`Shift` + wheel pans horizontally) |
| `Ctrl` + wheel | Zoom in / out |
| Hold `Space` + drag | Pan |
| Drag on empty canvas | Box-select nodes |
| Right-click | Context menu (node, edge, or canvas) |

### Creating nodes

Right-click the canvas and choose a shape, or use **Add node** in the inspector.

| Type | Shape | Use for |
| --- | --- | --- |
| **Start** | pill | The single entry point — only one start node is allowed |
| **Process** | rectangle | A regular step or task |
| **Decision (branch)** | diamond | A branching question — the only node allowed multiple outputs |
| **End** | pill | An exit point — exactly one **primary end** per process |
| **Subprocess** | framed box | A step that references another map (see section 5) |

### Node properties

Select a node and edit in the right inspector:

- **Title** and **Description** — double-click a node (or press `F2`) to rename in place.
- **Color** — preset swatches or a custom hex color (`#RRGGBB`).
- **BPM attributes** — **Assignee** (picked from the org directory), **Department** (auto-set from the assignee), **System**, and **Duration** (e.g. "2 days").

### Connecting nodes

- Drag from a node's handle onto another node to connect them.
- A plain node has a **single output** — to branch, use a **Decision** node. Its outgoing edges get branch labels (**Yes** / **No** / **Other**).
- Edge labels (branch conditions etc.) are edited via the edge context menu or `F2`.
- **Line style** per edge: Curved, Stepped, or Straight.
- Dragging a node close to another reveals **drop zones** — **Before** / **Group** / **After** — to insert it into the flow in one motion.
- Dropping an edge onto a node that already has connections asks whether to **Insert between** or **Keep** the existing link; dropping onto a **Decision** node offers **Branch** or **Insert** into an existing output.

---

## 4. Organizing Your Map

### Groups

- Select **two or more nodes** and press `Ctrl+G` (or right-click → **Create group**) to bundle them.
- Double-click the group title to rename it; drag the title bar to move the whole group; **Ungroup** disbands it.
- **Group bulk edit** sets or clears an attribute (assignee, department, …) across all members at once, with Append / Replace / Skip conflict handling and a before/after summary.

### Alignment and layout

- **Auto layout** (`Shift+L`) arranges the whole flow left-to-right automatically.
- With 2+ nodes selected: **Align left** `Alt+W`, **Center** `Alt+C`, **Align top** `Alt+T`, **Middle** `Alt+X`.
- With 3+ nodes selected: **Distribute horizontally** `Alt+R`, **Distribute vertically** `Alt+V`.

---

## 5. Subprocesses (linking maps)

A **Subprocess** node embeds another process as a single step — a reference, not a copy.

- **Create subprocess** (right-click a Process node) spins up a child map with Start / Task / End ready to edit.
- **Add as link node** links an existing map from the process library. Choose **Follow latest published** to always show the newest published version, or pin a specific version. When a newer published version appears, the node offers **Update to latest**.
- **Deep view:** double-click a subprocess node to drill into the child map in a stacked overlay with breadcrumbs — the embedded content is **read-only**. `Esc` goes up one level.
- If you lack permission on the linked map, the node shows **No access**.

---

## 6. Finding Nodes and Following Flows

- **Node search** — press `/` and type; Korean chosung (initial consonants) matching is supported. Matches jump to and highlight the node.
- **Outline** — the left rail shows the whole process as a tree; click an entry to focus that node.
- **Flow highlight** — select a node, then press `]` to grow the highlighted path forward and `[` to shrink it (or extend backward).
- **Walk the flow** — `Tab` / `Shift+Tab` move focus to the next / previous node along the flow and re-center the view.
- **Comments** — each node has a comment thread; `Ctrl+Enter` sends.

---

## 7. Saving and Validation

- The editor **autosaves** about 2 seconds after you stop editing; the **Save** button shows Saving… / Saved / Save failed.
- Leaving with unsaved edits shows a warning — save first.
- Saving is blocked until the **save checklist** passes: exactly one start node, one primary end, unique end names, and no invalid branching (single output on plain nodes).

---

## 8. Versions and the Approval Workflow

### The version model

A map holds multiple **versions** (As-Is, To-Be, or free labels). A new version starts as a deep copy of an existing one. Only **one draft** can be in progress at a time, and a new version can only be created after the current one is published. The **version number** is assigned at publish time.

### Statuses

| Status | Meaning |
| --- | --- |
| #Draft | Being edited — only the checkout holder can modify it |
| #Pending | Submitted for approval — canvas is read-only |
| #Approved | All approvers approved — ready to publish |
| #Published | The live version everyone sees |
| #Rejected | An approver rejected it — back to the author with a reason |
| #Expired | Superseded when a newer version was published (terminal) |

### Checkout (single writer)

- A draft is **checked out** to one person at a time; everyone else sees "{name} is editing — read only".
- **Request checkout** asks the current holder to hand over editing; the holder approves or rejects from their Inbox.
- **Transfer checkout** lets the holder pass editing rights to another editor directly.
- An idle checkout is auto-released after **30 minutes** of inactivity.

### From draft to published

1. Make sure **approvers are assigned** (Map Settings → Approvers) — you cannot submit without them.
2. **Submit for approval** — the version becomes #Pending and locks; all approvers are notified.
3. Approvers **Approve** or **Reject** (rejection requires a reason). Approval is **unanimous** — every approver must approve.
4. **Publish** the approved version. The previously published version automatically becomes #Expired.
5. **Withdraw** returns a pending version to draft (approvals reset). **Republish** creates a fresh draft from a published or expired version to run the cycle again.

The **approval dashboard** at the bottom of the right inspector shows the stepper (Submit → Review → Publish), each approver's check state, and the available actions.

---

## 9. Comparing Versions

Open **Compare** from the editor top bar (requires at least one published version).

- Pick **Base** and **Target** versions — **Swap** flips them.
- Differences are highlighted: **Added** (green), **Removed** (red), **Changed** (yellow), with a "Changed: fields" detail and a summary line.
- Toggle **Horizontal layout** / **Vertical layout** to re-arrange both canvases.
- The **Changes** list filters by All / Nodes / Edges; the **Properties** pane shows the selected node's fields side by side.
- **Apply To-Be** carries the target's changes forward; **Export** saves the comparison.

---

## 10. Map Settings

Open **Map Settings** from the editor. Tabs:

- **Details** — name and description.
- **Collaborators** — add individuals, teams, or user groups as Viewer / Editor. Removing or downgrading an editor may require approval.
- **Approvers** — manage the approver list (locked while a version is under approval).
- **Visibility** — Public / Private. Changing visibility **requires approval** and shows "Awaiting approval" until decided.
- **Versions** — per-version workflow actions (submit, publish, withdraw…).
- **Pending Approvals** / **Checkout Requests** — decide requests targeted at this map.
- **Danger Zone** — **Transfer Ownership** (you become an editor) and **Delete map** (owner only).

---

## 11. Notices, Inbox, and Feedback

### Notices

The **Notices** tab lists active announcements. Filter by All / Important / General, search, and **Mark Read**. Bodies support Markdown.

### Inbox

- **Approvals** tab — your personal review queue: version approvals, checkout transfers, and permission / visibility requests. Approve or reject (with a reason) inline; **Open map** jumps to the source.
- **Notifications** tab — event notifications, refreshed every few seconds. **Mark all read** or click items individually.

### Feedback

Click **Feedback** anywhere: pick a type (**Bug / Suggestion / Question / Other**), describe the issue, and send — your current screen and open map are attached automatically. Track status and admin replies on the **Feedback** page.

---

## 12. User Groups

Groups let you grant map access to a named set of people in one step.

- **Request Group** (Settings → Groups) with a name, description, **at least 2 members**, and **at least 1 manager** (★). An administrator approves the request before the group becomes active.
- Managers can add/remove members, assign managers, rename (once per week), deactivate/reactivate, and delete the group. Deleted groups sit in the trash for 7 days.
- You see only the groups you belong to or manage.

---

## 13. AI Assistant

Open the **AI assistant** from the editor top bar (when enabled).

- **Generate** a flowchart from a plain-language prompt — nodes, edges, groups, and BPM attributes matched to the org directory.
- **Edit incrementally** — ask for changes; existing layout and colors are preserved. Review the preview, then **Add to map** or discard.
- **Analyze** ("Find issues"), **summarize**, and **walk through** the flow step by step (prev / next / autoplay).
- Ask **how-to questions** — answers are grounded in this manual.
- `Ctrl+Enter` sends your message. Read-only users can still use analysis, walkthrough, and how-to.

---

## 14. Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `/` | Focus search (map list, manual) |
| `/` | Node search (chosung supported) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `F2` | Rename node / edit edge label |
| `Delete` | Delete selection |
| `Esc` | Cancel action, close modal, exit deep view |
| `Space` (hold) | Pan the canvas |
| `Ctrl` + wheel | Zoom |
| `Shift+L` | Auto layout |
| `Ctrl+G` | Create group from selection |
| `Alt+W` / `Alt+C` / `Alt+T` / `Alt+X` | Align left / center / top / middle |
| `Alt+R` / `Alt+V` | Distribute horizontally / vertically |
| `]` / `[` | Grow / shrink flow highlight |
| `Tab` / `Shift+Tab` | Next / previous node along the flow |
| `Ctrl+Shift+E` | Export PNG |
| `Ctrl+Enter` | Send (comments, AI chat) |

> **Tip:** The in-editor **Keyboard shortcuts** legend (bottom toolbar) shows this list in context.

---

## 15. Quick FAQ

- **Why can't I edit?** The version may be checked out by someone else, pending approval, or you may be a Viewer. Check the banner at the top of the canvas.
- **Why can't I submit for approval?** Assign at least one approver first (Map Settings → Approvers).
- **Why can't I create a new version?** Publish the current draft cycle first — only one draft may exist at a time.
- **I deleted a map by mistake.** Restore it within 7 days from Settings → Scheduled deletion.
- **The canvas won't save.** Check the save checklist: one start node, one primary end, unique end names, no multi-output plain nodes.

---

*Business Process Map — User Manual · updated 2026-07-06*

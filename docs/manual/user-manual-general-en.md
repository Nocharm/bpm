# Business Process Map — Getting Around

> Business Process Map (BPM) is a web app for drawing business processes as flowcharts, managing them as As-Is / To-Be **versions**, and finalizing them through an **approval workflow**.

This manual covers everything outside of editing — from signing in through map management, version approval, settings, and collaboration. For how to draw and edit nodes on the canvas, see the **Editing Maps** manual. System administrators should also read the **Administrator Manual**.

---

## 1. Getting Started

### Signing in

1. Open the app and click **Sign in with Keycloak** — your company SSO account signs you in. Once you've signed in, later visits sign you in automatically and take you straight to the screen you were opening (deep link).
2. In development environments, **Sign in with a test account** lets you pick a test user instead.

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

A map with **Public** visibility is viewable by everyone; **Private** maps are visible only to collaborators and approvers. If you navigate to a private map you're not allowed to see, a no-access notice is shown.

---

## 2. Map List (Home)

### Finding maps

- **Recently opened** shows the maps you last worked on — use **Show more** / **Collapse** to expand and collapse the band.
- **All maps** lists everything you can see. Press `/` or use the search box (**Search maps**) to filter by name.
- Filter chips narrow the list by **Status** (Draft / Pending / Approved / Rejected / Published) and by your **Role**. **Clear filters** resets them.
- Click a card to open the **detail panel**: owner, node count, allowed members (Individuals / Teams / User groups), and the full version history (Created, Submitted, Approved, Rejected, Published, Withdrawn).

### Creating a map

1. Click **New map**.
2. Enter a name and description, and choose **Visibility** (Public / Private).
3. Set the **owning department** (required) — it must be a real org department, and people in it always hold Editor access to this map.
4. Optionally add **initial collaborators** — individuals, teams, or user groups, each as Viewer or Editor.
5. Add **at least one approver** — a map cannot be created without one.

> **Create from CSV:** From the dropdown next to **New map**, choose **Create from CSV** to drop a CSV file and immediately create a map pre-filled with nodes. For the CSV format and rules, see "Importing" in the **Editing Maps** manual.

### Copying and deleting

- **Copy** duplicates a whole map under a new (unique) name.
- **Delete** moves the map to the trash. You can restore it within **7 days** from **Settings → Scheduled deletion**; after that it is permanently purged.

---

## 3. Versions and the Approval Workflow

### The version model

A map holds multiple **versions** (As-Is, To-Be, or free labels). A new version starts as a full copy of an existing one. Only **one draft** can be in progress at a time, and a new version can only be created after the current one is published. The **version number** is assigned at publish time.

### Statuses

| Status | Meaning |
| --- | --- |
| #Draft | Being edited — only the checkout holder can modify it |
| #Pending | Submitted for approval — canvas is read-only |
| #Approved | All approvers approved — ready to publish |
| #Published | The live version everyone sees |
| #Rejected | An approver rejected it — returned to the author with a reason |
| #Expired | Superseded when a newer version was published (terminal state) |

### Checkout (single writer)

- A draft is **checked out** to one person at a time; everyone else sees a "{name} is editing — read only" banner.
- **Request checkout** asks the current holder to hand over editing; the holder approves or rejects from their Inbox.
- **Transfer checkout** lets the holder pass editing rights to another editor directly.
- A checkout is auto-released after **30 minutes** of inactivity.

### From draft to published

1. Make sure **approvers are assigned** (Map Settings → Approvers) — you cannot submit for approval without them.
2. **Submit for approval** — the version becomes #Pending and locks, and all approvers are notified.
3. Approvers **Approve** or **Reject** (rejection requires a reason). Approval is **unanimous** — every approver must approve.
4. **Publish** the approved version. The previously published version automatically becomes #Expired.
5. **Withdraw** returns a Pending or Approved version to draft (approvals reset) — only the **submitter** can do this. A Rejected version can also be withdrawn by the map owner or a sysadmin, and whoever withdraws it gets the checkout (edit lock). **Republish** creates a fresh draft from a published or expired version to run the cycle again.

The **approval dashboard** at the bottom of the right inspector shows the stepper (Submit → Review → Publish), each approver's check state, and the available actions.

---

## 4. Comparing Versions

Open **Compare** from the editor top bar (requires at least one published version).

- Pick **Base** and **Target** versions — **Swap** flips them.
- Differences are highlighted: **Added** (green), **Removed** (red), **Changed** (yellow), with a "Changed: fields" detail and a summary line.
- Toggle **Horizontal layout** / **Vertical layout** to re-arrange both canvases.
- The **Changes** list filters by All / Nodes / Edges; the **Properties** pane shows the selected node's fields (including per-run parameters) side by side.
- **Apply To-Be** carries the target's changes forward; **Export** saves the comparison.

---

## 5. Map Settings

Open **Map Settings** from the editor. Tabs:

- **Details** — name and description.
- **Owning department** — assign or change the map's owning department (Owner / sysadmin only). Its members automatically get Editor access, and changing the department moves that derived Editor access with it.
- **Collaborators** — add individuals, teams, or user groups as Viewer / Editor. Removing or downgrading an editor may require approval.
- **Approvers** — manage the approver list (locked while a version is under approval).
- **Visibility** — Public / Private. Changing visibility **requires approval** and shows "Awaiting approval" until decided.
- **Subprocess designation** — designate this map so it can be used as a subprocess of other maps, and set its representative attributes (department required; assignee/system/duration/cost/headcount optional). The designated values show live on every node that links this map.
- **Versions** — per-version workflow actions (submit for approval, publish, withdraw…).
- **Pending Approvals** / **Checkout Requests** — decide requests targeted at this map.
- **Danger Zone** — **Transfer Ownership** (you become an editor) and **Delete map** (Owner only).

---

## 6. Notices, Inbox, and Feedback

### Notices

The **Notices** tab lists currently active announcements. Filter by All / Important / General, search, and **Mark Read**; bodies are rendered as Markdown.

### Inbox

- **Approvals** tab — your personal review queue: version approvals, checkout transfers, and permission / visibility requests. Approve or reject (with a reason) inline; **Open map** jumps to the source.
- **Notifications** tab — event notifications, refreshed every few seconds. **Mark all read** or mark items individually.

### Feedback

Click **Feedback** on any screen: pick a type (**Bug / Suggestion / Question / Other**) and describe the issue, then send — your current screen and open map are attached automatically. Track status and admin replies on the **Feedback** page.

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
- **The canvas won't save.** Check the save checklist: one start node, one primary end, unique end names, and no multi-output plain nodes. (For details, see "Saving and Validation" in the **Editing Maps** manual.)
- **I can't enter cost in both KRW and USD.** A per-run cost uses a single currency — clear one, then enter the other.

---

*Business Process Map — Getting Around · Updated 2026-07-13*

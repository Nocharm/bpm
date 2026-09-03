# Business Process Map — Editing Maps

> This manual covers how to **draw and edit process maps** in Business Process Map (BPM) — nodes, connections, groups, per-run metrics, subprocesses, saving, import/export, and the AI assistant. For everything outside editing — signing in, the map list, version approval, settings — see the companion **Getting Around** manual.

---

## 1. Editor at a Glance

Open a map to enter the editor. The top bar holds the version selector, **New version**, **Compare**, **Undo** / **Redo**, **Save**, the process library, **Import CSV**, and the **AI assistant**. Edit the selected node's properties in the right inspector; the left sidebar holds the outline tree and a keyboard-shortcut card. The icon at the far right of the inspector's tab bar **collapses or expands every section** of the current tab at once (if any section is open it collapses all; if all are closed it expands all). On maps registered in the business **Framework**, a **Framework chip** at the **top left** of the canvas shows the classification path (the map title and save checklist sit at the top right) — expand the chip and click a category row to see the other maps in that category, and click one to jump to it (a confirmation guards unsaved changes). The L5 row also opens the **linkage canvas** (section 11), and the **Search other frameworks** footer opens the full framework browse modal. Opening a **new, empty map** (only Start and End nodes) shows a **"Start with the AI consultant"** bubble — **Start** takes you to the interview screen (section 10), **Not now** dismisses it.

### Moving around the canvas

| Input | Action |
| --- | --- |
| Mouse wheel | Pan vertically (`Shift` + wheel pans horizontally) |
| `Ctrl` + wheel | Zoom in / out |
| Hold `Space` + drag | Pan |
| Drag on empty canvas | Box-select nodes |
| Right-click | Context menu (node, edge, or canvas) |

### The right inspector — Map / Approval tabs

Selecting a node shows that node's properties in the inspector; with nothing selected, two tabs appear: **Map** and **Approval**. While nothing is selected, the properties area shows an **Ownership & approvers section** (owning department, owner, and approvers — display-only, with names and departments following your language setting) and a **map summary accordion** (collapsed by default — while collapsed, icon+number pairs in its header stand in for the summary).

- **Map tab** — the version row at the top holds the **version pill** (current version and status — click to switch versions) and manage icons (the leftmost opens **version compare** — disabled until a version is published). Below it sit collapsed sections: **Node display** (what each node shows — grouped into **Attributes / Metrics / I/O & Conditions** steps, and any part of a row toggles it; the same section also appears in the Properties tab's empty state under the map summary), **Edge style**, the **Subprocess** designation card (section 5), **Interview notes**, and **Notes**. Edge style applies a line style to **all connections at once** (a confirm dialog summarizes what will change), and that choice also becomes the default for newly drawn connections. Individual edges can still be styled one by one from the edge's inspector panel or right-click menu. **Interview notes** lists the five originals a consultant interview import leaves behind (GMP, annual volume, duration, touch time, system) as rows — hover a row and its leading icon turns into a note icon; click it to open the wording popover. The editor who **holds the checkout** can edit or add the wording there (`Ctrl`/`⌘+Enter` saves, `Esc` cancels); everyone else reads it. **Notes** (exception rules, VOC, rule basis, open issues, …) are added, edited, and deleted by the **map owner** — pick a tag from the preset chips or with `[` in the tag box; editing an imported note shows an **Edited** mark and keeps its source (the same section appears on the home map detail card). The collaborator list clamps to about 3.3 rows when individual collaborators exceed 4, with a **Show all (n)** / **Collapse** toggle (adding collaborators and changing roles is covered in the Getting Around manual).
- **Approval tab** — from top to bottom: **Pending Approvals** (this map's pending requests — count badge, collapsed by default) → a draft CTA (**Switch to draft for approval** when a draft exists, **Create draft for approval** otherwise) → the **Approval workflow** section (collapsible, with a status badge in its header even while collapsed) → the **Subprocess** designation card → the version card list. See section 7 and the Getting Around manual for running an approval.

---

## 2. Nodes and Connections

### Creating nodes

Right-click the canvas and choose a shape, or use **Add node** in the inspector.

| Type | Shape | Use for |
| --- | --- | --- |
| **Start** | pill | The single entry point — only one start node is allowed |
| **Process** | rectangle | A regular step or task |
| **Decision** | diamond | A branching question — the only node allowed multiple outputs |
| **End** | pill | An exit point — exactly one **primary end** per process |
| **Subprocess** | framed box | A step that references another map (see section 5) |

Renaming a Start or End node shows a **Start / End type pill** next to the title on the node, so the type stays visible. Start/End descriptions (notes) never render on the canvas — they show only in the inspector and the node edit dialog.

### Node properties

Select a node and edit in the right inspector:

- **Title** and **Description** — double-click the node **title** (or press `F2`) to rename in place. Double-clicking the node body outside the title, or choosing **Edit info** in the right-click menu, opens the **node edit dialog** (see below). In the inspector the description is **read-only** — hover it for an edit icon, or double-click the text, to open the node edit dialog with the description focused.
- **Node edit dialog** — below the title and description the fields sit as **tiles** (the same design as the subprocess designation dialog, 512 px wide): type and color tiles, **attributes** (department and assignee as row tiles spanning both columns — the department shows its leaf as a pill that opens the org info modal — plus system, link, GMP), the seven **per-run metrics** (cost is a single tile — pick the unit with the ₩/$ tabs at the front of the popover, the chosen unit shows as a pill on the tile, and the other currency is cleared on save), and **I/O & conditions** (input and output show only their item count and are edited item by item in the popover, plus the data-form fallback and start/end conditions). Clicking a tile opens an **input popover right where you clicked**: `Enter` applies (`Ctrl`/`⌘+Enter` in multi-line editors), `Esc` cancels, and clicking outside applies only when something changed. The popover's bottom button is a lone **Cancel** while nothing changed; once something did it turns into **Save** with a ▾ menu (Save / Save and close / Close without saving). The department list puts **your own department chain first**, and changing the department shows a notice that the assignees will be cleared. Values applied in popovers land in the dialog's buffer, and the bottom **Save** (`⌘S`) writes them to the node. The **previous / next connected nodes** float outside the dialog as small cards on the left and right of the canvas (color dot, label, type); hovering one grows it slightly and pulls it inward, and clicking it switches the dialog to that node (with a confirmation if there are unsaved changes). Read-only (viewer, locked, published) shows only filled tiles statically; only the input/output tiles stay clickable to view their lists. A subprocess node's dialog shows the attributes, four per-run metrics, and I/O & conditions inherited from the linked map as read-only tiles and edits only **annual volume and FTE** (the popover notes the designated reference). While typing a name, `Enter` commits and **`Shift+Enter` (or `Alt+Enter`) inserts a line break** — the same rule in the canvas, the inspector, and the node edit dialog, and the break shows on the canvas too.
- **Color** — preset swatches or a custom hex color (`#RRGGBB`).
- **BPM attributes** — **Assignee** (picked from the org directory), **Department** (auto-set from the assignee), **System**, and the **per-run metrics** (see section 3).
- **GMP classification** — classify a node as **GMP Direct / GMP Indirect / Non-GMP**. The classification shows as a **pill tag** at the node's top left (toggle its visibility with the GMP row in the Map tab's Node display), and clicking the pill in edit mode opens the classification picker in place. Picking a classification **locks the node color to the classification color** (Direct = red, Indirect = amber, Non-GMP = green); the notice dialog offers **Undo classification / Restore color only**. On unclassified nodes the pill takes no space and appears only on hover. Subprocess nodes inherit the linked map's GMP designation read-only.
- **I/O & Conditions** — **Input** and **Output** hold multiple items (one per row). Hover a row and click the small file icon to set that item's **data form**: an autocomplete list matches by extension, English program name, or Korean (`.xlsx` / `Excel` / `엑셀` all find the same entry), navigated with ↑/↓ and picked with Enter or Space. A value outside the list is added via the **Add "…"** row at the bottom. A set form shows as a small pill (catalog entries carry their icon); click the pill to change it, ✕ to remove. **Start / End conditions** are free text. The node-level *Data form* row is an import fallback — it shows only while no per-item form is set. On the canvas, the I/O & Conditions boxes appear below a node **while it is selected** (what shows is picked in the Map tab's Node display).
- **Import from another node** — the **Import from node…** row in the Input/Output list **pulls in an item another node in the connected flow already has** — Input offers upstream nodes' outputs, Output offers downstream nodes' inputs. An imported item stays **Linked** to its origin: edit the origin and every linked copy follows, while on the mirror side you **Disconnect** to turn it into an editable copy instead of editing in place. If the flow path back to the origin breaks, the item shows a warning.
- **Link markers and highlight** — items linked to another node (origin or mirror) carry a **link icon**, with a direction tooltip showing which side is the origin. Hover a linked row and **the peer node and the flow path between them light up on the canvas** — the same from the inspector list and from the I/O rows inside a canvas node. Input items can carry a **Required / Optional** flag, told apart by hover color (required = red tint) and a tooltip. An I/O box with a **single item** renders as one header-less row, with the input/output icon standing in the checkbox slot.
- **Link (URL)** — attach an external document or system link to a node; a badge appears on the canvas, and you can click it to preview or open in a new tab. You can also give it a display label.

### Connecting nodes

- Drag from a node's handle onto another node to connect them.
- No need to aim for the handle — **drop the line anywhere on a node's body** and it connects to the default handle. While hovering the body, a preview snaps to where the connection will land.
- A plain node has a **single output** — to branch, use a **Decision** node. Its outgoing edges get branch labels (**Yes** / **No** / **Other**).
- Edge labels (branch conditions etc.) are edited via the edge context menu or `F2`. Labels take line breaks the same way: `Enter` commits, **`Shift+Enter` / `Alt+Enter`** breaks the line.
- **Line style is per edge** — Curved, Stepped, or Straight. Select an edge and pick it in the inspector's **Line style** row, or from the edge's right-click menu. The choice is saved with the map, so everyone sees the same shape.
- To change them all at once, use the inspector's **Map tab → Edge style**: a confirm dialog summarizes how many connections will change, and the style you confirm also becomes the default for newly drawn connections.
- Dragging a node close to another reveals **drop zones** — **Before** / **After** / **Swap** / **Group** — to insert it into the flow in one motion, or swap the two nodes' places.
- Dropping an edge onto a node that already has connections asks whether to **Insert between** or **Keep** the existing link; dropping onto a **Decision** node offers **Branch** or **Insert** into an existing output.

### Copying and duplicating nodes

- **Copy/paste** — select nodes and press `Ctrl+C` / `Ctrl+V`. Edges inside the selection come along, and duplicate names get a `(2)`-style suffix.
- You can paste into **another tab or another map** — the copied content is kept in the browser across tabs.
- **`Ctrl`+drag to duplicate** — drag a node while holding `Ctrl`; a ghost with a `+` badge follows, and a duplicate lands where you drop.
- Both paste and duplicate **preserve edge handle directions** (connection points), and the added nodes are selected right away so you can keep editing.

---

## 3. Per-run Metrics

Each node records the cost and effort of running the process **once**, across seven metrics. Edit them in the inspector's Metrics section (collapsed by default). Edits in the **Metrics** and **I/O & Conditions** sections are buffered — press the **Save** button in the section header (it lights up when there are changes) to apply them. **Start** and **End** nodes have no metrics.

| Metric | Label | Input format | Canvas display |
| --- | --- | --- | --- |
| **Duration** | Duration / run (h) | `h.mm` — fractional part is **minutes** | `1h30m` |
| **Touch time** | Touch time / run (h) | `h.mm` — same rule as duration | `1h30m` |
| **Cost (KRW)** | Cost / run (KRW) | number | `₩1,250,000` |
| **Cost (USD)** | Cost / run (USD) | number | `$1,200` |
| **Headcount** | Headcount / run | number | as entered |
| **Annual volume** | Annual volume | number | as entered |
| **FTE** | FTE | number | as entered |

### Duration notation (h.mm)

Write duration as **hours and minutes** — the fractional part is **minutes, not a decimal**.

- `2` → 2 hours, `0.30` → 30 minutes, `1.30` → 1 hour 30 minutes.
- Minutes past 60 carry into hours (`0.90` → 1 hour 30 minutes).
- While editing, it appears as you typed it (`1.30`); everywhere else it shows as `1h30m`.

### One currency only

**KRW (₩) and USD ($) cannot both be entered.** Cost appears as a single row with a **₩ / $ toggle** — switch it to change currency. If the current currency already has a value, a notice tells you it will be cleared on save, with an **Undo** to cancel the switch. Thousands separators are added to costs automatically, and you can paste values that already contain commas (like `1,250,000`).

### Metrics on subprocess nodes

A subprocess node takes only **Annual volume** and **FTE** directly. The other five (duration, touch time, cost, headcount) are **inherited read-only from the linked map's designated values** and cannot be changed in the parent map (see section 5). If the linked map's designation left **reference values** for annual volume and FTE, hover the ⓘ next to those inputs to see "Designated reference: …" — a hint only; this node keeps its own value.

### Sum preview (Σ)

When you designate a map as a subprocess (see Map Settings in the Getting Around manual), the designation form proposes a **preview by summing** that map's published metrics — duration, touch time, and cost are **summed**, while headcount is the **average** across plain nodes that have a value.

---

## 4. Organizing Your Map

### Groups

- Select **two or more nodes** and press `Ctrl+G` (or right-click → **Create group**) to bundle them.
- Double-click the group title to rename it; drag the title bar to move the whole group; **Ungroup** disbands it.
- **Group bulk edit** puts its fields behind a one-row category bar — **Attributes** (people, system) · **Metrics** (all seven per-run metrics) · **I/O & Conditions** (input, output, start/end conditions). Click a category to unfold its field buttons right below (clicking another category swaps the panel), pick a field, and set or clear it across all members at once, with Append / Replace / Skip conflict handling and a before/after summary. For input/output, **Append adds new item lines** under what's there, while **Replace overwrites the items and clears their per-item data forms** (the line-by-line pairing no longer holds). The one-currency rule and subprocess-node restrictions (annual volume · FTE only; IO/conditions are inherited, so subprocess nodes are excluded) apply here too.

### Alignment and layout

- **Auto layout** arranges the whole flow automatically — horizontal (`Shift+L`, left→right) or vertical (`Shift+K`, top→bottom). The Start→primary-end path snaps to one straight line, branches sit beside it, and edge connection points follow the direction.
- **`Shift`+drag — axis-locked move**: drag a node (single, multi, or group) while holding `Shift` to move it along one axis only (horizontal or vertical) for easy line-ups.
- With 2+ nodes selected: **Align left** `Alt+W`, **Center** `Alt+C`, **Align top** `Alt+T`, **Middle** `Alt+X`.
- With 3+ nodes selected: **Distribute horizontally** `Alt+R`, **Distribute vertically** `Alt+V`.
- **Automatic spacing** — when a node grows vertically (I/O boxes and the like), only the nodes below it **in overlapping columns** shift down on screen so nothing overlaps. The growth is absorbed by the saved gap first; only when that runs out do the nodes move, keeping a minimum gap (the saved gap or 16 px, whichever is smaller) — nodes in other columns stay put. This is a **display-only** adjustment — saved coordinates never change, and everything returns once the node shrinks back. Stepped connectors that would now cut through a grown node route around it with a right-angled detour automatically.

---

## 5. Subprocesses (linking maps)

A **Subprocess** node embeds another process as a single step — a reference, not a copy.

- **Create subprocess** (right-click a Process node) spins up a child map with Start / Task / End ready to edit.
- **Add as link node** links an existing map from the process library. New links **follow the latest published version by default**; you can pin a specific version instead. When a newer published version appears, the node offers **Update to latest**.
- The subprocess list also opens from the right-click menu or the **`S` shortcut**, and search supports Korean chosung matching. **A map already linked in this map cannot be added twice.**
- By default only maps **designated as subprocesses** appear in the library picker. The map's owner designates it in **Map Settings → Subprocess designation** with representative attributes (department required; assignee, system, link, the seven per-run metrics, and input/output optional — click a tile to edit it in a popover right there; see section 5 of the Getting Around manual) — these show live on every node linking the map. There is no separate description; the **map description** is used as is.
- With the published version open, the owner or an admin can also manage designation from the editor inspector's **Subprocess** card (same card on the Map and Approval tabs — body collapsed by default, with an ⓘ hover note in the header). The **Designate as subprocess** button shares its row with contextual buttons on the right — **Go to published version** while you're viewing a non-published version, and **Request registration** (ask the owner) when you're not the owner.
- A link node pointing to an **undesignated** map shows a warning badge and is locked until the map is designated.
- **Preview peek** — **click a map row in the library (or hover it for 2.5 s)** to open a **preview peek of its published version**. The header shows the map name, owner, and published version on the left and the **framework path** on the right (click it for the framework tree flyout and "Search other frameworks"). The flow preview on the left (same type colors as the canvas) **zooms with the wheel** (100–300%, anchored at the cursor) and pans by dragging, with **Add to map** (accent) and **Go to this map** buttons floating over it. The right side has two tabs, **Node / Details** — the **Node tab** is a live mock-up of the node you'd add (key attributes, metric chips, GMP, conditions, and the I/O checklist; hovering switches it to the current map's display settings), and you can **drag the mock-up straight onto the canvas**. The **Details tab** lists the designated attributes, subprocess metrics, conditions / I/O / GMP, the published version (v-number), publish time, and the framework path (empty values are toned-down dashes). Maps you can't view show a lock notice but can still be added. Hovering a **department chip** in the list opens an org-info card next to the cursor.
- **Open linked map** — right-click a subprocess node and the last item of the menu (below the divider) is **Open linked map**. It is disabled when there is no link or you lack access, and leaving the editor goes through a confirmation (unsaved changes are protected).
- **Expand in place (inline)** — right-click a subprocess node and choose **Expand** (while the node is designated and unlocked) to embed the child map's published version **read-only in a tinted region** on the current canvas. The region's header shows the map name with an open icon, and — when the linked map belongs to the framework — the **full five-level classification path label** (click it to open the classification peek). Hovering the region highlights it gently, and right-clicking inside offers **Open linked map** (with a confirmation gate) and **Collapse**. `Tab` traversal includes the expanded child nodes in flow order, and child GMP pills render read-only.
- **Deep view:** double-click a subprocess node to drill into the child map in a stacked overlay with breadcrumbs — the embedded content is **read-only**. `Esc` goes up one level.
- **Node width** — hover a subprocess node and a **grip** appears on its right edge. Drag it to resize the node (from the default 180 px up to 120%); the width is saved with the map, so it persists across reloads and for everyone.
- **Framework pill** — when the linked map is registered in the business **Framework**, a folder-shaped pill sits next to the node's name. Click it (or hover 3 s) to open the classification-path peek, and its **"Search other frameworks"** footer leads to the full framework browse modal. The peek forgives brief mouse departures — it closes only after a 0.4 s grace period.
- If you lack permission on the linked map, the node shows **No access**.
- **Inspector Subprocess tab** — opening a map that is designated as a subprocess adds a **Subprocess tab** to the inspector: **Designation** (version, designated at, by) → **Linked from** (reverse references) → **Designation values** (the designation dialog's tiles stacked in **one column** for the narrow inspector — department (leaf pill, click for the org info modal) and assignee, system, link, per-run metrics, input/output item counts; only filled tiles show, statically, and the input/output tiles open a view-only list). Parameters that carry an interview note (duration, touch time, system, annual volume) swap their icon for a note icon on hover; click it to read the original wording. With the published version open, the owner or an admin gets an **Edit** button in the section header that opens the designation dialog. The map's own **Subprocess designation card** also carries a **Linked from** accordion (reverse references — the maps linking this one), so a designated map shows where it is used right on the card.

### Linking maps that are not registered yet (placeholders)

You can link a map that is **not yet designated** as a placeholder first, and sort out registration later.

- In the **process library panel** (library button in the top bar), turn on **"Show unregistered maps"** below the search box — unregistered maps then appear with a **"Not registered"** badge.
- Unregistered maps are **dragged onto the canvas just like any other map** — a lock warning confirms on drop, then it asks whether to **send a registration request**: **Send request** links and asks the owner; **Link only** just links.
- The request lands in the target map **owner's Inbox (Approvals)**. Once the owner completes the designation, the link's warning clears and the requester is notified (see the Getting Around manual for the owner-side flow).
- To request later or check status — select the unregistered link node: the inspector shows a **Request registration** button (after requesting, a **Registration requested** badge with a **Withdraw** button for your own request).
- **Create a new map and link it immediately** — typing in the library panel search reveals a **Create map "query"** button at the bottom; it opens the creation dialog with the name prefilled (owning department, approvers, and other requirements are unchanged). After creation you **stay in the current map and the new map is linked automatically**. The new map clears its warning once it is published and designated.
- In the top-bar **map-name dropdown**, subprocess-designated maps show a **purple subprocess icon**, and maps **in use (linked) in this map are highlighted with a purple row background** — clicking an in-use map expands its menu and **auto-focuses the canvas** on that node. The current map is excluded from the list, and the dropdown closes when you click outside it.

---

## 6. Finding Nodes and Following Flows

- **Node search** — press `/` and type; Korean chosung (initial consonants) matching is supported. Matches jump to and highlight the node.
- **Outline** — the left rail shows the whole process as a tree; click an entry to focus that node.
- **Flow highlight** — select a node, then press `]` to grow the highlighted path forward and `[` to shrink it (or extend backward).
- **Walk the flow** — `Tab` / `Shift+Tab` move focus to the next / previous node along the flow and re-center the view.
- **Comments** — each node has a comment thread; `Ctrl+Enter` sends. Read-only users can still leave comments.

---

## 7. Saving and Validation

- The editor **autosaves** about 2 seconds after you stop editing; the **Save** button shows Saving… / Saved / Save failed.
- Leaving with unsaved edits shows a warning — save first.
- Saving is blocked until the **save checklist** passes:
  - exactly **one** start node
  - **one** primary end
  - **no duplicate** end names
  - no invalid branching — plain nodes have a **single output** (multiple outputs only on Decision nodes)
- Editing is possible only while the version is a draft (#Draft / #Rejected) and you hold the **checkout**. If someone else is editing or an approval is in progress, the canvas locks read-only (see the Getting Around manual for versions and approval).
- The checkout request/transfer UI lives in the **Checkout** card of the Approval tab's **Approval workflow** panel and is interactive **only on a draft**. A rejected version shows no checkout UI — **Withdraw** returns it to draft and hands the checkout back to you automatically.
- While a change that lowers your own permission is pending approval, checkout and submitting for approval are refused ("Your permission change is still pending approval."). Once the request is decided, refresh or switch versions to continue.

### Running an approval from the Approval tab

The approval process itself (who approves, publish and expiry rules) is covered in the Getting Around manual. What you see in the editor inspector, in short:

- **Approval workflow panel** — each approver gets an **Approved / Pending / Rejected** tag pill; hovering a pill opens a tooltip with the decision time and comment. Hover or click an approver's name to open their person card. The panel also shows a progress pill (**n/m approved**), a **Waiting on** pill, the rejection reason line, and a bundled visibility pill ("Visibility change bundled → …"). Submission context (submitter, time, comment) appears only behind a hover icon ("Submitted by …"). The stepper at the top (**Submit → Review → Publish**) uses the same tag-pill style for its step labels.
- **Comments on transitions** — the submit, approve, publish, and withdraw dialogs take an optional comment ("Add a comment (optional)"), and the reject dialog takes a reason (**Reason**). Approve and reject dialogs show the requester's submit comment (**Requester comment**) banner, and the submit dialog shows the latest rejection (**Previous rejection**) banner when there is one.
- **Comment history** — the speech-bubble count button on a version card (hidden at zero) opens that version's comment history modal. **Right-click** a version card for **Go to this version** (goes through the switch-confirmation dialog while you're editing) and **View comments**.
- **Rejection banner** — opening a rejected version shows an error-tinted banner at the top of the editor: a **Rejected** chip, the rejecter's pill, and the reason.
- **Change summary** — below the approvers, the Approval tab shows a **summary of changes against the published version**. It rests as a single line with count pills; expanded, it lists per-node changes and the edge delta (+N / −N / ~N) — for checking what differs from the published version before and after submitting.

---

## 8. Import (CSV · AI)

You can fill a map by pasting in a process that's already organized as a table or document.

### CSV import

- Open it with **Import CSV** in the top bar. Use **Download template** to get a blank form, fill it, and upload.
- The CSV uses **21 columns**: `name` (required), `description`, `assignee`, `department`, `system`, `duration`, `touch_time`, `cost_krw`, `cost_usd`, `headcount`, `annual_count`, `fte`, `input`, `input_flags` (per-item required/optional flags), `output`, `data_form`, `start_condition`, `end_condition`, `url`, `url_label`, `next` (the successor to connect to). Older files with fewer columns still import (columns match by name). Put multiple `input`/`output` items on separate lines inside the cell.
- Import **merges by name** — an existing node with the same title keeps its color, comments, and group, updating only its values, and **blank cells keep the existing value**. New titles not already in the map are added as nodes.
- **Assignee** written as a name is matched against the org directory. **Cost is one currency only** (KRW or USD), and **duration follows the h.mm rule** (section 3). Fields a subprocess node inherits (the five per-run metrics plus input/output/conditions/data form) are ignored even if supplied in the CSV. Per-item data forms are app-only — the CSV has no column for them, and an import keeps the existing ones as long as the item lines are unchanged.
- Review the **Added / Matched / Removed** summary and warnings in the preview tab before applying.

> **Make a CSV with an external AI:** In the import window, **Ask another AI** copies a prompt you can paste — along with your document — into an external AI (ChatGPT, etc.); paste the CSV it returns back here.

### Create a new map from CSV

On the map list (home), pick **Create from CSV** from the dropdown next to **New map** to drop in a CSV and create a new map straight away (see the map list in the Getting Around manual).

### AI proposal merge

Flowchart proposals from the AI assistant merge the same way — **by name**, preserving ids (see section 10).

---

## 9. Export (PNG · Excel · CSV · Word)

Save the current map to a file from the export button in the right inspector (or the right-click menu).

| Format | Contents |
| --- | --- |
| **PNG** | The current canvas as a 2× resolution image — every connector renders as a solid black line. Drawn on the canvas background (dot grid) with a **map info card** at the bottom (map name, owning department, owner, version, published date, framework path). `Ctrl+Shift+E`. |
| **Excel** | **Choose one of two formats** — ① Structured: a node table (assignee, department, system, per-run metrics) with branch conditions folded into `[branchNo:label]` annotations ② **WBS**: a work-breakdown sheet that expands subprocesses into level columns. A format picker opens on export; costs are saved in per-currency columns with number formatting. |
| **CSV** | The same 21-column table as import — you can round-trip by editing an exported CSV and importing it again. |
| **Word** | A `.docx` document with a shape-based flowchart — node links (URL) are included as hyperlinks. Use **Download Word**. |

> CSV and Excel export with a warning when a map has structure that a table can't represent (canvas coordinates, groups). Very large maps may be truncated at a row limit.

---

## 10. AI Assistant

Open the **AI assistant** from the editor top bar (it appears only when AI is enabled on the server).

- **Generate** a flowchart from a plain-language description — nodes, edges, groups, and BPM attributes (assignee, department, system, per-run metrics) are filled to match the org directory.
- **Edit incrementally** — ask for changes and the existing layout, colors, assignees, and groups are preserved. Supports adding/removing nodes, connecting/disconnecting, inserting between two nodes, branch-label changes, and setting node descriptions, inputs/outputs, start/end conditions, and links (URL). Review the preview, then **Add to map (Apply)** or Discard.
- **Analyze** ("Find issues"), **summarize**, and **walk through** the flow step by step (prev / next / autoplay).
- Ask **how-to questions** — answers are grounded in this manual; anything outside the manual it reports it doesn't know.
- **Multiple chats** — Chats are stored on the server and follow you across devices. Open past chats from the list in the chat bar, or start a new one with the **+** icon in the window header. Titles are derived from the first question, and you can delete chats from the list.
- **Chats from other maps** — The "Chats from other maps" section in the list opens conversations from other maps read-only; use "Open this map" to go there and continue.
- **Storage & time** — Chats are stored per map with a timestamp on every message. Retention follows admin-configured caps (default: 20 chats per map, 200 messages per chat, 180 days since last activity); overflow is pruned oldest-first. Long chats load recent-first — scroll to the top to load earlier history (feature tips show while loading).
- **Input limit** — one question holds up to 2,000 characters. The **ring** above-right of the input shows what's left (caution at 75%, warning at 90%).
- **Text size** — adjust chat text with **− T +** in the chat bar.
- `Ctrl+Enter` sends. Generate and edit need edit permission; analysis, walkthrough, and how-to are available to read-only users too.

### AI consultant interview

A dedicated screen that fills an empty map through an **interview**. Enter it from the **headset icon** (AI consultant) in the top bar or from the "Start with the AI consultant" bubble on a new empty map; it needs AI enabled on the server and an **editable draft**.

- **Layout** — the left side is the **working-map preview** that draws itself as the interview progresses; the right side is the chat panel (drag the divider to resize). Click a node in the preview to mention it in chat ("Ask about this node").
- **Interview** — the AI asks stage by stage, and items with candidates (activities, branches) come as **option buttons**. Items you can't answer can be skipped with **Mark unanswered items as TBD and move on**. The conversation is stored on the server, so you can come back and continue.
- **Attach documents (fast track)** — attach SOPs or process documents with the clip button (several files or a whole folder at once); the AI reads them and can **draw it as proposed** right away instead of interviewing. Attached documents can be removed from the list in the chat panel.
- **Checkpoints** — every interview stage leaves a checkpoint of the working map, and you can go back to an earlier one. Going back folds the later stages into history.
- **Apply** — when the interview finishes, run **Review and apply collected parameters** and **merge into the draft**. The working map merges into the draft version by title, so **check out the draft in the editor first**. **Restart** discards the conversation, collected facts, attachments, and the working map (the draft version itself is untouched).

---

## 11. Framework Linkage Canvas (L5)

Every leaf category (L5) of the business **Framework** can open a **linkage canvas** — a special canvas where all the processes (L6) in that category sit as **subprocess nodes**, and the work linkage between them is drawn with connectors. It has no Start/End nodes (decision and end nodes are allowed as helpers) and does not appear in the regular map list. To set it apart from regular maps, the canvas defaults to a **charcoal (dark) stage**; the button next to the **L5 map** tag at the top right switches to a light background (remembered in your browser). A brand watermark and a status stamp (**Draft / Confirmed / Superseded**) sit over the canvas.

### Viewing and editing

- **Open it** — from the **linkage-canvas button** on an L5 row of the home Framework tree, or from the L5 row of the editor's Framework chip.
- **Edit rights** — only **category admins**, appointed by a system administrator, can edit. Admins on a higher category (L1–L4) can edit every L5 canvas underneath (downward inheritance). Everyone else opens it read-only.
- **Draft visibility** — the **live draft** before confirmation is visible only to admins of that category (or a parent) and sysadmins. Everyone else lands on the **latest confirmed** snapshot, and a "No confirmed snapshot yet" notice shows when there is none. A status banner sits at the top — **Draft** (amber: live working copy, visible to admins only, published to viewers on confirm), **Confirmed** (latest confirmed snapshot, read-only), **Superseded** (an older confirmed snapshot, with the latest label named). The banner can be dismissed and returns when you re-enter the map or switch versions.
- **Checkout** — editing the draft follows the same single-writer checkout rule as regular maps. When new L6 maps join the category, entering edit **auto-reconciles** them in with an "N new L6 added (unplaced)" toast.
- **Contained L6 locked** — L6 nodes belonging to this category **cannot be deleted** from the canvas (the classification is the source). Nodes brought in from other categories can be removed.
- **No regular-map workflow** — submit, publish, approvers, collaborators, rename requests, and subprocess designation do not exist on a canvas (hidden in the UI and blocked on the server). Confirmed snapshots and the live draft cannot be deleted.
- **Category notes** — the **Notes** section at the bottom of the Map tab holds this category's notes. Notes left by the interview import with the **Entry / Flow / Open issue / Task note** tags gather here, and category admins and sysadmins add, edit, and delete them.

### Confirm and versions

- **Confirm readiness (gates)** — all six checks on the Approval tab must pass before confirming: **all linked L6 placed · no placeholders · no stale links · all linked L6 published · no exit-less loops · branches use decision nodes** (exempt when every outgoing edge is a parallel fan-out). **Locate** on a failing item jumps to the offending node, and the confirm button stays disabled while any item fails.
- **Who confirms** — the person who **holds the draft checkout** confirms directly when they are a **direct admin of that L5** (or a sysadmin). Admins of a higher category (L1–L4) can edit but send a **Confirm request** instead (optional comment) — it goes to the direct L5 admins and sysadmins, and **your checkout is released automatically** the moment you send it, so the decider can edit and confirm. You can **withdraw** the request until it is decided, and the outcome arrives as a **Confirm approved / Confirm rejected** notification. Direct admins and sysadmins are told to confirm directly instead of requesting.
- **Confirm changes** — freezes the current state as a **Confirmed** snapshot (a status separate from publishing). Numbers run v1.0 → v1.1 …; checking **Major version** bumps the major (v2.0) and **prunes (permanently deletes) the previous major's minor snapshots** — a dialog lists what is kept and what is deleted before you confirm.
- With only layout moves and no substantive change, confirming is blocked ("no changes since this version"). The confirm section shows a **change summary** (node and edge deltas) since the last confirmation.
- Confirmed snapshots open read-only from the version dropdown and can be compared against each other on the **Compare** screen. On the version timeline, snapshots of the same major fold into a group, and the newest carries a **Latest confirmed** label.

### Bringing in processes from other categories

- Expand another category in the left **L5 explorer** (tree) and **drag an L6 card onto the canvas** to add an external L6 node — it renders with a neutral body, a **colored left tab, and an origin badge** (its home L5 color). Clicking the origin badge opens that L5's **drill-in peek**.
- The drill-in peek's **"Search other frameworks"** button opens the full **browse modal** — explore sibling categories in a tree opened to the current path, search categories and maps by name, and click a map to travel there (leaving the editor goes through a confirmation gate).

### Placeholders and link replacement

- **Placeholders** — the slot for an L6 that is not registered in the system yet shows as a **dashed error-toned node**. The **Connect a map** banner opens a connect dialog: candidates from the guided L5 come first, sorted by similarity (with an exact-match badge), and you can drill the tree to pick from another L5 — picking outside the guided L5 goes through a path-comparison confirmation.
- **Replacing stale links** — when a linked map moves to the trash or is replaced by a copy (retired), the node switches to the same dashed error look with a **Replace map** banner. The **successor map is pinned as a recommendation card**, so you can swap it in with one click.

---

## 12. Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `/` | Node search (chosung supported) |
| `S` | Open subprocess list (chosung search) |
| `Ctrl+C` / `Ctrl+V` | Copy / paste nodes (works across tabs and maps) |
| `Ctrl`+drag | Duplicate node |
| `Shift`+drag | Axis-locked move (horizontal/vertical) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `F2` | Rename node / edit edge label |
| `Shift+Enter` (or `Alt+Enter`) | Line break while editing a name or label (`Enter` commits) |
| `Delete` | Delete selection |
| `Esc` | Cancel action, close modal, exit deep view |
| `Space` (hold) | Pan the canvas |
| `Ctrl` + wheel | Zoom |
| `Shift+L` / `Shift+K` | Auto layout — horizontal / vertical |
| `Ctrl+G` | Create group from selection |
| `Alt+W` / `Alt+C` / `Alt+T` / `Alt+X` | Align left / center / top / middle |
| `Alt+R` / `Alt+V` | Distribute horizontally / vertically |
| `Alt+←` / `Alt+→` | Collapse/expand the left sidebar (outline) / the inspector |
| `]` / `[` | Grow / shrink flow highlight |
| `Tab` / `Shift+Tab` | Next / previous node along the flow |
| `Ctrl+Shift+E` | Export PNG |
| `Ctrl+Enter` | Send (comments, AI chat) |

> **Tip:** In the editor, open **More shortcuts** at the bottom of the Outline keys card (left sidebar) to see this list in context.

---

*Business Process Map — Editing Maps · Updated 2026-09-03*

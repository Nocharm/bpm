# Business Process Map — Editing Maps

> This manual covers how to **draw and edit process maps** in Business Process Map (BPM) — nodes, connections, groups, per-run parameters, subprocesses, saving, import/export, and the AI assistant. For everything outside editing — signing in, the map list, version approval, settings — see the companion **Getting Around** manual.

---

## 1. Editor at a Glance

Open a map to enter the editor. The top bar holds the version selector, **New version**, **Compare**, **Undo** / **Redo**, **Save**, the process library, **Import CSV**, and the **AI assistant**. Edit the selected node's properties in the right inspector; the left sidebar holds the outline tree and a keyboard-shortcut card.

### Moving around the canvas

| Input | Action |
| --- | --- |
| Mouse wheel | Pan vertically (`Shift` + wheel pans horizontally) |
| `Ctrl` + wheel | Zoom in / out |
| Hold `Space` + drag | Pan |
| Drag on empty canvas | Box-select nodes |
| Right-click | Context menu (node, edge, or canvas) |

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

### Node properties

Select a node and edit in the right inspector:

- **Title** and **Description** — double-click a node (or press `F2`) to rename in place.
- **Color** — preset swatches or a custom hex color (`#RRGGBB`).
- **BPM attributes** — **Assignee** (picked from the org directory), **Department** (auto-set from the assignee), **System**, and the **per-run parameters** (see section 3).
- **Link (URL)** — attach an external document or system link to a node; a badge appears on the canvas, and you can click it to preview or open in a new tab. You can also give it a display label.

### Connecting nodes

- Drag from a node's handle onto another node to connect them.
- A plain node has a **single output** — to branch, use a **Decision** node. Its outgoing edges get branch labels (**Yes** / **No** / **Other**).
- Edge labels (branch conditions etc.) are edited via the edge context menu or `F2`.
- **Line style** per edge: Curved, Stepped, or Straight.
- Dragging a node close to another reveals **drop zones** — **Before** / **After** / **Swap** / **Group** — to insert it into the flow in one motion, or swap the two nodes' places.
- Dropping an edge onto a node that already has connections asks whether to **Insert between** or **Keep** the existing link; dropping onto a **Decision** node offers **Branch** or **Insert** into an existing output.

---

## 3. Per-run Parameters

Each node records the cost and effort of running the process **once**, across six parameters. Edit them in the inspector's parameter section (collapsed by default). **Start** and **End** nodes have no parameters.

| Parameter | Label | Input format | Canvas display |
| --- | --- | --- | --- |
| **Duration** | Duration / run (h) | `h.mm` — fractional part is **minutes** | `1h30m` |
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

**KRW (₩) and USD ($) cannot both be entered.** Filling one side locks the other's input. To switch currency, clear the filled side first. Thousands separators are added to costs automatically, and you can paste values that already contain commas (like `1,250,000`).

### Parameters on subprocess nodes

A subprocess node takes only **Annual volume** and **FTE** directly. The other four (duration, cost, headcount) are **inherited read-only from the linked map's designated values** and cannot be changed in the parent map (see section 5).

### Sum preview (Σ)

When you designate a map as a subprocess (see Map Settings in the Getting Around manual), the designation form proposes a **preview by summing** that map's published parameters — duration and cost are **summed**, while headcount is the **average** across plain nodes that have a value.

---

## 4. Organizing Your Map

### Groups

- Select **two or more nodes** and press `Ctrl+G` (or right-click → **Create group**) to bundle them.
- Double-click the group title to rename it; drag the title bar to move the whole group; **Ungroup** disbands it.
- **Group bulk edit** sets or clears an attribute (assignee, department, …) across all members at once, with Append / Replace / Skip conflict handling and a before/after summary.

### Alignment and layout

- **Auto layout** arranges the whole flow automatically — horizontal (`Shift+L`, left→right) or vertical (`Shift+K`, top→bottom). The Start→primary-end path snaps to one straight line, branches sit beside it, and edge connection points follow the direction.
- With 2+ nodes selected: **Align left** `Alt+W`, **Center** `Alt+C`, **Align top** `Alt+T`, **Middle** `Alt+X`.
- With 3+ nodes selected: **Distribute horizontally** `Alt+R`, **Distribute vertically** `Alt+V`.

---

## 5. Subprocesses (linking maps)

A **Subprocess** node embeds another process as a single step — a reference, not a copy.

- **Create subprocess** (right-click a Process node) spins up a child map with Start / Task / End ready to edit.
- **Add as link node** links an existing map from the process library. Choose **Follow latest published** to always show the newest published version, or pin a specific version. When a newer published version appears, the node offers **Update to latest**.
- Only maps **designated as subprocesses** appear in the library picker. The map's owner designates it in **Map Settings → Subprocess designation** with representative attributes (department required; assignee, system, duration, cost, and headcount optional) — these show live on every node linking the map.
- A link node pointing to an **undesignated** map shows a warning badge and is locked until the map is designated.
- **Deep view:** double-click a subprocess node to drill into the child map in a stacked overlay with breadcrumbs — the embedded content is **read-only**. `Esc` goes up one level.
- If you lack permission on the linked map, the node shows **No access**.

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

---

## 8. Import (CSV · AI)

You can fill a map by pasting in a process that's already organized as a table or document.

### CSV import

- Open it with **Import CSV** in the top bar. Use **Download template** to get a blank form, fill it, and upload.
- The CSV uses **14 columns**: `name` (required), `description`, `assignee`, `department`, `system`, `duration`, `cost_krw`, `cost_usd`, `headcount`, `annual_count`, `fte`, `url`, `url_label`, `next` (the successor to connect to).
- Import **merges by name** — an existing node with the same title keeps its color, comments, and group, updating only its values, and **blank cells keep the existing value**. New titles not already in the map are added as nodes.
- **Assignee** written as a name is matched against the org directory. **Cost is one currency only** (KRW or USD), and **duration follows the h.mm rule** (section 3). The four fields a subprocess node inherits are ignored even if supplied in the CSV.
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
| **PNG** | The current canvas as a 2× resolution image — every connector renders as a solid black line. `Ctrl+Shift+E`. |
| **Excel** | A node table (with assignee, department, system, and the per-run parameters). Costs are saved in per-currency columns with number formatting, so you can compute in the spreadsheet. |
| **CSV** | The same 14-column table as import — you can round-trip by editing an exported CSV and importing it again. |
| **Word** | A `.docx` document with a shape-based flowchart — node links (URL) are included as hyperlinks. Use **Download Word**. |

> CSV and Excel export with a warning when a map has structure that a table can't represent (canvas coordinates, groups). Very large maps may be truncated at a row limit.

---

## 10. AI Assistant

Open the **AI assistant** from the editor top bar (it appears only when AI is enabled on the server).

- **Generate** a flowchart from a plain-language description — nodes, edges, groups, and BPM attributes (assignee, department, system, per-run parameters) are filled to match the org directory.
- **Edit incrementally** — ask for changes and the existing layout, colors, assignees, and groups are preserved. Supports adding/removing nodes, connecting/disconnecting, inserting between two nodes, branch-label changes, and setting node descriptions and links (URL). Review the preview, then **Add to map (Apply)** or Discard.
- **Analyze** ("Find issues"), **summarize**, and **walk through** the flow step by step (prev / next / autoplay).
- Ask **how-to questions** — answers are grounded in this manual; anything outside the manual it reports it doesn't know.
- **Multiple chats** — Chats are stored on the server and follow you across devices. Open past chats from the list in the chat bar, or start a new one with the **+** icon in the window header. Titles are derived from the first question, and you can delete chats from the list.
- **Chats from other maps** — The "Chats from other maps" section in the list opens conversations from other maps read-only; use "Open this map" to go there and continue.
- **Storage & time** — Chats are stored per map with a timestamp on every message. Retention follows admin-configured caps (default: 20 chats per map, 200 messages per chat, 180 days since last activity); overflow is pruned oldest-first. Long chats load recent-first — scroll to the top to load earlier history (feature tips show while loading).
- **Input limit** — one question holds up to 2,000 characters. The **ring** above-right of the input shows what's left (caution at 75%, warning at 90%).
- **Text size** — adjust chat text with **− T +** in the chat bar.
- `Ctrl+Enter` sends. Generate and edit need edit permission; analysis, walkthrough, and how-to are available to read-only users too.

---

## 11. Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `/` | Node search (chosung supported) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `F2` | Rename node / edit edge label |
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

*Business Process Map — Editing Maps · Updated 2026-07-13*

// height-shift(#1) 엔드투엔드 스모크 — IO 리스트 펼침/접힘이 아래 노드를 밀어내고 복원하는지,
// 저장 좌표(pos_y)는 표시 오프셋과 무관히 그대로인지, 펼친 상태에서의 드래그도 오프셋 없이
// 저장되는지를 실기동으로 검증. 설계: docs/superpowers/specs/2026-08-23-node-spacing-design.md §4·§6·§7
// 실행(frontend/ 에서): node scripts/pw-smoke-height-shift.mjs  (playwright-core, 서버 8000/3000 기동 전제,
// reset_db 시드 — admin.sys sysadmin 필요). 테스트 맵은 API로 생성 후 teardown에서 소프트삭제+ORM 하드퍼지.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API = "http://localhost:8000/api";
const DEV_USER = "admin.sys";
const HEADERS = { "Content-Type": "application/json", "X-Dev-User": DEV_USER };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// cwd는 항상 이 워크트리의 backend/(격리된 dev.db) — 인터프리터만 이 워크트리에 .venv가 없으면
// 메인 체크아웃 것을 재사용(워크트리는 .venv를 커밋/복제하지 않는다, CLAUDE.md 로컬 네이티브 실행 전제).
const BACKEND_DIR = path.resolve(__dirname, "../../backend");
const MAIN_CHECKOUT_VENV_PYTHON = "/Users/hyeonjin/Documents/bpm/backend/.venv/bin/python";
const VENV_PYTHON = existsSync(path.join(BACKEND_DIR, ".venv/bin/python"))
  ? path.join(BACKEND_DIR, ".venv/bin/python")
  : MAIN_CHECKOUT_VENV_PYTHON;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const api = async (pathname, { method = "GET", body } = {}) => {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

// 전 테이블 행수 스냅샷 — teardown 후 대조해 잔류 0을 API만으로 증명 (pw-smoke-io-links.mjs와 동일 근거:
// login_records는 /api/me의 login_id당 KST 하루 1행 dedup이라 이 런이 만든 행인지 구분 불가해 대조 제외).
const RESIDUE_EXEMPT_TABLES = new Set(["login_records"]);
const snapshotTables = async () => {
  const rows = await api("/admin/tables");
  return new Map(rows.map((r) => [r.name, r.count]));
};

let browser;
let mapId = null;
let versionId = null;
let baseline = null;

try {
  baseline = await snapshotTables();

  // ── 테스트 맵 생성 — A(8줄 input)→B, C는 B와 같은 y(행 보존 검증용, 엣지 없음) ──
  const dir = await api("/directory");
  const owningDept = dir.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments — run reset_db first");

  const stamp = Date.now();
  const created = await api("/maps", {
    method: "POST",
    body: { name: `Height Shift Smoke ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapId = created.id;
  versionId = created.versions[0].id;
  check("test map created", mapId !== null, `map=${mapId} version=${versionId}`);

  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: false } });

  const inputLines = Array.from({ length: 8 }, (_, i) => `Input item ${i + 1}`).join("\n");
  const graph = {
    nodes: [
      // validate_process(app/subprocess.py)는 시작 노드 정확히 1개를 요구 — 높이-쉬프트 무관, 위쪽에 격리 배치
      { id: "start", title: "Start", node_type: "start", pos_x: 0, pos_y: -140, sort_order: 0 },
      { id: "node-a", title: "Node A", node_type: "process", input: inputLines, pos_x: 0, pos_y: 0, sort_order: 1 },
      { id: "node-b", title: "Node B", node_type: "process", pos_x: 0, pos_y: 280, sort_order: 2 },
      { id: "node-c", title: "Node C", node_type: "process", pos_x: 400, pos_y: 280, sort_order: 3 },
    ],
    edges: [{ id: "edge-a-b", source_node_id: "node-a", target_node_id: "node-b" }],
    groups: [],
  };
  await api(`/versions/${versionId}/graph`, { method: "PUT", body: graph });
  check("seed graph (Start, A 8-line input, B, C, A→B) persisted", true);

  // ── 브라우저 셋업 ──
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  // 세로로 넉넉한 뷰포트 — fitView는 로드 시 1회뿐이라 이후 height-shift 성장·드래그로 밀려난
  // 노드가 뷰포트 밖으로 나가면 마우스 드래그가 안 먹는다(clip). 여유 확보로 항상 화면 안에 유지.
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 2000 } });
  await ctx.addInitScript(
    ([devUser]) => {
      window.localStorage.setItem("bpm.devUser", devUser);
      window.localStorage.setItem("bpm.lang", "en");
      // 노드 표시 토글 — input/output 박스가 렌더되려면 v2 키에 명시 필요(기본값은 assignee/params뿐)
      window.localStorage.setItem(
        "bpm.nodeDisplayFields.v2",
        JSON.stringify(["assignee", "params", "input", "output"]),
      );
    },
    [DEV_USER],
  );
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const openMap = async () => {
    await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.react-flow__node[data-id="node-b"]', { timeout: 30000 });
    await page.waitForTimeout(1000); // 체크아웃 확보 + 측정/오프셋 정착
  };

  // RF가 .react-flow__node에 쓰는 translate(x,y) — 노드 자체 transform은 뷰포트 scale 이전 flow 좌표라 줌 무관.
  const readNodeY = (id) =>
    page.evaluate((nid) => {
      const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
      if (!el) return null;
      const m = el.style.transform.match(/translate\([-\d.]+px,\s*([-\d.]+)px/);
      return m ? +m[1] : null;
    }, id);

  // offsetHeight — ResizeObserver 측정과 동일하게 조상 transform(뷰포트 scale)의 영향을 받지 않는 레이아웃 높이.
  const readNodeHeight = (id) =>
    page.evaluate((nid) => {
      const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
      return el ? el.offsetHeight : null;
    }, id);

  const readZoom = () =>
    page.evaluate(() => {
      const vp = document.querySelector(".react-flow__viewport");
      const m = vp?.style.transform?.match(/scale\(([-\d.]+)\)/);
      return m ? +m[1] : 1;
    });

  // 화면 픽셀 드래그는 뷰포트 줌으로 나뉘어 flow 이동량이 되므로, 원하는 flow 이동량에 줌을 곱해 전달.
  const dragNodeByFlowDelta = async (id, dxFlow, dyFlow) => {
    const zoom = await readZoom();
    const box = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const dxPx = dxFlow * zoom;
    const dyPx = dyFlow * zoom;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 3, startY + 3, { steps: 1 }); // 드래그 임계값 확보용 소량 선이동
    const steps = 10;
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(startX + (dxPx * i) / steps, startY + (dyPx * i) / steps, { steps: 5 });
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(50);
    await page.mouse.up();
  };

  await openMap();
  check(
    "editor loads with node-b and node-c rendered",
    (await readNodeY("node-b")) !== null && (await readNodeY("node-c")) !== null,
  );

  // ── 캡 상태 베이스라인 ──
  const yCappedB = await readNodeY("node-b");
  const yCappedC = await readNodeY("node-c");
  const hCappedA = await readNodeHeight("node-a");

  // ── Show more — 호버로 노출 후 클릭(#2 opacity-0 group-hover 규약), 측정 왕복+트윈(≤350ms) 정착 대기 ──
  const ioBox = page.locator('[data-id="node-io-list-input"]');
  await ioBox.waitFor({ state: "visible", timeout: 5000 });
  await ioBox.hover();
  const moreBtn = page.locator('[data-id="node-io-list-input-more"]');
  const moreVisible = await moreBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
  check("Show more button appears on IO box hover", moreVisible);
  await moreBtn.click();
  await page.waitForTimeout(1000); // 측정 왕복(~250-340ms) + rAF 트윈(350ms) 정착

  const yExpandedB = await readNodeY("node-b");
  const yExpandedC = await readNodeY("node-c");
  const hExpandedA = await readNodeHeight("node-a");
  const growthA = hExpandedA - hCappedA;
  const deltaB = yExpandedB - yCappedB;
  const deltaC = yExpandedC - yCappedC;
  check(
    "Show more: B pushed down by A's height growth (±2px)",
    Math.abs(deltaB - growthA) <= 2,
    `deltaB=${deltaB} growthA=${growthA}`,
  );
  check(
    "Show more: C pushed down by the same delta as B (row preserved, ±2px)",
    Math.abs(deltaC - deltaB) <= 2,
    `deltaB=${deltaB} deltaC=${deltaC}`,
  );

  // ── Show less — 복원 ──
  await moreBtn.click();
  await page.waitForTimeout(1000);
  const yRestoredB = await readNodeY("node-b");
  const yRestoredC = await readNodeY("node-c");
  check(
    "Show less: B restores to capped baseline (±1px)",
    Math.abs(yRestoredB - yCappedB) <= 1,
    `restored=${yRestoredB} baseline=${yCappedB}`,
  );
  check(
    "Show less: C restores to capped baseline (±1px)",
    Math.abs(yRestoredC - yCappedC) <= 1,
    `restored=${yRestoredC} baseline=${yCappedC}`,
  );

  // ── 저장 좌표 불변 — 표시 오프셋 왕복 후에도 서버 pos_y는 시드값 그대로 ──
  let g = await api(`/versions/${versionId}/graph`);
  const nodeBBeforeDrag = g.nodes.find((n) => n.id === "node-b");
  check("saved coords unaffected: B.pos_y still 280 after cap/expand/restore", nodeBBeforeDrag?.pos_y === 280, `pos_y=${nodeBBeforeDrag?.pos_y}`);

  // ── 펼친 상태에서 B를 (0,+120) 드래그 → autosave 대기 → 표시 오프셋이 저장에 새지 않아야 한다 ──
  await ioBox.hover();
  await moreBtn.waitFor({ state: "visible", timeout: 3000 });
  await moreBtn.click();
  await page.waitForTimeout(1000);
  await dragNodeByFlowDelta("node-b", 0, 120);
  await page.waitForTimeout(2800); // AUTO_SAVE_DELAY_MS(2000) + 여유

  g = await api(`/versions/${versionId}/graph`);
  const nodeBAfterDrag = g.nodes.find((n) => n.id === "node-b");
  check(
    "drag round-trip: B.pos_y ≈ 400 after +120 drag in expanded state (display offset does not leak)",
    Math.abs(nodeBAfterDrag.pos_y - 400) <= 2,
    `pos_y=${nodeBAfterDrag.pos_y}`,
  );

  check("console errors 0", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  await page.close().catch(() => undefined);
  await browser.close();
  browser = null;
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  if (browser) await browser.close().catch(() => undefined);

  // ── teardown — 소프트삭제(실 API 경로) + ORM 하드퍼지 → 전 테이블 행수가 베이스라인과 일치하는지 대조 ──
  if (mapId !== null) {
    await api(`/maps/${mapId}`, { method: "DELETE" }).catch((e) => console.error("soft-delete failed:", e.message));
    try {
      execFileSync(
        VENV_PYTHON,
        [path.join(__dirname, "_purge-test-map.py")],
        { cwd: BACKEND_DIR, env: { ...process.env, SMOKE_MAP_ID: String(mapId) }, stdio: "inherit" },
      );
    } catch (e) {
      console.error("hard purge failed:", e.message);
    }
  }
  if (baseline) {
    const after = await snapshotTables().catch(() => null);
    if (after) {
      const diffs = [];
      for (const [name, count] of after) {
        if (RESIDUE_EXEMPT_TABLES.has(name)) continue;
        const before = baseline.get(name) ?? 0;
        if (count !== before) diffs.push(`${name}: ${before}→${count}`);
      }
      check("zero residue — table row counts match baseline", diffs.length === 0, diffs.join(", "));
    } else {
      check("zero residue — table row counts match baseline", false, "post-teardown snapshot failed");
    }
  }
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails === 0 ? 0 : 1);

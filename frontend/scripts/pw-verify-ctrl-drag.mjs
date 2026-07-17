// Ctrl/⌘+드래그 노드 복제 — 브라우저 실기동 검증 (Task 1.4 + 리뷰 픽스).
// 시나리오(각자 seed+reload로 격리 — 에디터의 기존 plain-drag freeze 버그가 다음 시나리오로 새지 않게):
//   (a) 복사 가능 노드 Ctrl+드래그 → 드래그 중 잔상(.bpm-node-ghost)·"+"배지(lucide-plus), 드롭 시 원본 원위치 복귀
//       + "(2)" 사본 생성, 사본이 유일 선택, 잔상 소멸, 백엔드에 +1 영속
//   (b) start 노드(비복사) Ctrl+드래그 → 잔상·배지 없이 일반 이동, copy.blocked 토스트, 사본 없음
//   (c) 혼합선택(process+start) Ctrl+드래그 → 복사 가능(process)만 복제 +1, start는 미복제 + 제외 토스트
//   (d) [리뷰] 러버밴드로 2개 미리 선택 후 선택 안 된 3번째 노드 Ctrl+드래그 → 잔여 선택 미복제, 딱 +1
//   (e) [리뷰 CRITICAL] 복사 가능 2개 의도적 다중선택 후 하나를 Ctrl+드래그 → 정확히 +2(2×N=+4 회귀 가드),
//       DOM 카운트 + 리로드(백엔드 영속) 둘 다 확인
//   (f) 콘솔 에러 0
//
// 실행 (frontend/ 에서): node scripts/pw-verify-ctrl-drag.mjs
// 전제: backend :8000(reset_db 시드 무관 — API로 맵을 새로 만듦), frontend :3000, playwright-core(--no-save)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
// 앱은 event.ctrlKey || event.metaKey 둘 다 받으므로 플랫폼에 맞는 키를 누른 채 드래그(csv-create-flow·
// node-copy 검증 스크립트와 동일 관례). 이 키는 RF 기본 multiSelectionKeyCode와도 겹친다(의도적).
const CTRL_KEY = process.platform === "darwin" ? "Meta" : "Control";
const LOCK_EPS = 2; // flow px — 원위치 복귀는 정확히 시작값이어야 하므로 여유는 최소.
const MOVE_MIN = 40; // flow px — 드롭 위치는 원위치에서 이만큼은 떨어져 있어야 "이동/복제됐다"로 인정.

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (msg) => console.log(`NOTE ${msg}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const api = (path, { method = "GET", body } = {}) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body },
  );

const rid = () =>
  Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// 노드 표시좌표(flow 단위) — RF가 .react-flow__node에 쓰는 translate(x,y) transform을 그대로 읽는다.
const readNodePos = (id) =>
  page.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
    if (!el) return null;
    const m = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px/);
    return m ? { x: +m[1], y: +m[2] } : null;
  }, id);

const idByText = async (text) => {
  const loc = page.locator(".react-flow__node", { hasText: text }).first();
  return loc.getAttribute("data-id");
};

// 이전 시나리오의 선택 잔존이 새 Ctrl+드래그에 섞이지 않도록 빈 캔버스를 클릭해 선택 해제.
// 좌표는 .react-flow__pane의 실제 bounding box에서 파생 — 하드코딩 좌표는 이 레이아웃에서 UI 텍스트를
// 때려 선택 해제에 실패한다(칩·툴바 회피). 노드가 없는 우상단 안쪽 지점(칩은 좌상단)을 클릭.
async function clearSelection() {
  const pane = await page.locator(".react-flow__pane").boundingBox();
  const x = pane.x + pane.width - 60; // 우측 안쪽 — 시드 노드(x≤980+180)와 겹치지 않게 pane 우측 끝 부근
  const y = pane.y + 60; // 상단 안쪽 — 시드 노드(y≥380)보다 위
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
}

// nodeId를 화면 중심에서 Ctrl/⌘를 누른 채 (dx,dy) 만큼 드래그. 마우스업 직전(=드래그 중) 잔상·+배지 유무를
// 함께 관찰해 반환 — 드롭 후에는 사라지므로 이 시점에만 확인 가능.
async function ctrlDragBy(nodeId, dx, dy) {
  const box = await page.locator(`.react-flow__node[data-id="${nodeId}"]`).boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.keyboard.down(CTRL_KEY);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(startX + (dx * i) / steps, startY + (dy * i) / steps, { steps: 1 });
  }
  await page.waitForTimeout(120);
  const midDrag = {
    ghostVisible: (await page.locator(".react-flow__node.bpm-node-ghost").count()) > 0,
    badgeVisible: (await page.locator(`.react-flow__node[data-id="${nodeId}"] .lucide-plus`).count()) > 0,
  };
  await page.mouse.up();
  await page.keyboard.up(CTRL_KEY);
  await page.waitForTimeout(300);
  return midDrag;
}

// ── 서버 프로브 ──
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
  await browser.close();
  process.exit(1);
}
const backendStatus = await page.evaluate(async () => {
  try {
    const res = await fetch("/api/maps", { headers: { "X-Dev-User": "admin.sys" } });
    return res.status;
  } catch {
    return 0;
  }
});
if (backendStatus !== 200) {
  console.error(`FATAL backend not reachable (GET /api/maps → ${backendStatus})`);
  await browser.close();
  process.exit(1);
}

let mapId = null;
let versionId = null;

// 시나리오별 결정적 시작 상태 — 그래프를 PUT으로 교체하고 페이지를 리로드(에디터 인스턴스를 새로 띄워
// 이전 드래그의 프리즈/선택 잔재를 완전히 제거). 각 시나리오는 이 helper로 자기 시드에서 시작.
async function seedAndReload(nodes, edges = []) {
  await api(`/versions/${versionId}/graph`, { method: "PUT", body: { nodes, edges, groups: [] } });
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);
}

// 백엔드에 실제로 저장된 노드 title 목록 — autosave(디바운스 2s) 반영 후 조회해 영속 결과 검증.
const savedTitles = async () => (await api(`/versions/${versionId}/graph`)).nodes.map((n) => n.title);

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");

  const created = await api("/maps", {
    method: "POST",
    body: {
      name: `Ctrl-Drag Verify ${stamp}`,
      description: "",
      visibility: "public",
      owning_department: owningDept,
    },
  });
  mapId = created.id;
  versionId = created.versions[0].id;
  // 그래프 교체는 체크아웃 보유가 필수(backend/app/routers/graph.py replace_graph). 세션 내내 유지.
  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: true } });

  // pos는 캔버스 원점에서 충분히 아래·오른쪽으로 — 좌상단 MapTitleChecklist 칩에 클릭이 가로채이지 않게
  // (frontend/scripts/pw-verify-node-copy.mjs와 동일 교훈). 서로 충분히 벌려 드래그 여유 확보.

  // ===== (a) 단일 복사 가능 노드 Ctrl+드래그 — 잔상·배지, 원위치 복귀 + "(2)" 사본, 백엔드 +1 영속 =====
  try {
    const s = rid();
    const a = rid();
    const b = rid();
    await seedAndReload(
      [
        { id: s, title: "Start", node_type: "start", pos_x: 250, pos_y: 380, sort_order: 0 },
        { id: a, title: "Step A", node_type: "process", pos_x: 560, pos_y: 380, sort_order: 1 },
        { id: b, title: "Step B", node_type: "process", pos_x: 560, pos_y: 620, sort_order: 2 },
      ],
      [{ id: rid(), source_node_id: s, target_node_id: a }, { id: rid(), source_node_id: a, target_node_id: b }],
    );

    const beforeCountA = await page.locator(".react-flow__node").count();
    const beforePosA = await readNodePos(a);
    const midDragA = await ctrlDragBy(a, 220, -140);

    check("(a) ghost overlay visible mid-drag (.bpm-node-ghost)", midDragA.ghostVisible);
    check("(a) + badge visible on the dragged node mid-drag (lucide-plus)", midDragA.badgeVisible);

    const afterCountA = await page.locator(".react-flow__node").count();
    check("(a) drop adds exactly 1 node (original + copy = 2)", afterCountA === beforeCountA + 1, `before=${beforeCountA} after=${afterCountA}`);

    const dupLabelCountA = await page.locator(".react-flow__node", { hasText: "Step A (2)" }).count();
    check('(a) dropped copy shows "Step A (2)" dedup label', dupLabelCountA === 1, `count=${dupLabelCountA}`);

    const afterPosA = await readNodePos(a);
    check(
      "(a) original returns to its start position",
      !!(afterPosA && Math.abs(afterPosA.x - beforePosA.x) <= LOCK_EPS && Math.abs(afterPosA.y - beforePosA.y) <= LOCK_EPS),
      `before=${JSON.stringify(beforePosA)} after=${JSON.stringify(afterPosA)}`,
    );

    const dupIdA = await idByText("Step A (2)");
    const dupPosA = dupIdA ? await readNodePos(dupIdA) : null;
    check(
      "(a) copy sits at the drop position (away from the origin)",
      !!(dupPosA && beforePosA && (Math.abs(dupPosA.x - beforePosA.x) >= MOVE_MIN || Math.abs(dupPosA.y - beforePosA.y) >= MOVE_MIN)),
      `origin=${JSON.stringify(beforePosA)} copy=${JSON.stringify(dupPosA)}`,
    );

    const selectedAfterA = await page.locator(".react-flow__node.selected").count();
    check("(a) the copy becomes the sole selection", selectedAfterA === 1, `selected=${selectedAfterA}`);

    const ghostAfterA = await page.locator(".react-flow__node.bpm-node-ghost").count();
    check("(a) ghost overlay clears after drop", ghostAfterA === 0, `count=${ghostAfterA}`);

    // 백엔드 영속 — autosave(2s) 반영 후 저장 노드 수가 딱 4개(Start+StepA+StepB+사본1)여야.
    await page.waitForTimeout(2500);
    const titlesA = await savedTitles();
    check("(a) backend persists exactly 1 extra node", titlesA.length === 4, `titles=${JSON.stringify(titlesA)}`);
  } catch (err) {
    check("(a) single-node ctrl-drag ran without throwing", false, err instanceof Error ? err.message : String(err));
  }

  // ===== (b) start 노드(비복사) Ctrl+드래그 — 잔상·배지 없음, 일반 이동, copy.blocked 토스트, 사본 없음 =====
  try {
    const s = rid();
    const a = rid();
    await seedAndReload([
      { id: s, title: "Start", node_type: "start", pos_x: 300, pos_y: 420, sort_order: 0 },
      { id: a, title: "Step A", node_type: "process", pos_x: 620, pos_y: 420, sort_order: 1 },
    ]);

    const beforeCountB = await page.locator(".react-flow__node").count();
    const beforePosS = await readNodePos(s);
    const midDragB = await ctrlDragBy(s, 150, 120);

    check("(b) no ghost overlay for a non-copyable drag", !midDragB.ghostVisible);
    check("(b) no + badge for a non-copyable drag", !midDragB.badgeVisible);

    const afterCountB = await page.locator(".react-flow__node").count();
    check("(b) no node added (blocked from copying)", afterCountB === beforeCountB, `before=${beforeCountB} after=${afterCountB}`);

    const afterPosS = await readNodePos(s);
    const startMoved =
      !!(afterPosS && (Math.abs(afterPosS.x - beforePosS.x) >= MOVE_MIN || Math.abs(afterPosS.y - beforePosS.y) >= MOVE_MIN));
    // 참고: 에디터에 별개로 로그된 "연속 plain-drag 시 Start 프리즈" 버그가 있어, 신선한 리로드 후에도
    // 특정 상황에서 이 이동 확인이 흔들릴 수 있음(이 기능과 무관). freeze로 실패하면 아래 NOTE로 구분.
    if (!startMoved) note("(b) start didn't move — likely the pre-existing plain-drag freeze bug (unrelated to ctrl-drag feature)");
    check("(b) start node still moves normally (not frozen)", startMoved, `before=${JSON.stringify(beforePosS)} after=${JSON.stringify(afterPosS)}`);

    const blockedToastB = await page.getByText("can't be copied", { exact: false }).first().isVisible().catch(() => false);
    check("(b) copy.blocked toast shown for a start-node ctrl-drag", blockedToastB);
  } catch (err) {
    check("(b) non-copyable ctrl-drag ran without throwing", false, err instanceof Error ? err.message : String(err));
  }

  // ===== (c) 혼합선택(Step A + Start) Ctrl+드래그 — 복사 가능(Step A)만 복제 +1, Start 미복제 + 제외 토스트 =====
  try {
    const s = rid();
    const a = rid();
    await seedAndReload([
      { id: s, title: "Start", node_type: "start", pos_x: 300, pos_y: 420, sort_order: 0 },
      { id: a, title: "Step A", node_type: "process", pos_x: 620, pos_y: 420, sort_order: 1 },
    ]);

    // Step A 클릭 → Ctrl+클릭 Start 로 둘 다 선택(둘 다 사전 선택 → 의도된 선택 드래그).
    await page.locator(`.react-flow__node[data-id="${a}"]`).click({ force: true });
    await page.keyboard.down(CTRL_KEY);
    await page.locator(`.react-flow__node[data-id="${s}"]`).click({ force: true });
    const selCountC = await page.locator(".react-flow__node.selected").count();
    check("(c) mixed selection picks up 2 nodes (Step A + Start)", selCountC === 2, `selected=${selCountC}`);

    const beforeCountC = await page.locator(".react-flow__node").count();
    const beforePosA = await readNodePos(a);
    const box = await page.locator(`.react-flow__node[data-id="${a}"]`).boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    // Ctrl 계속 누른 채 Step A를 잡아 끈다(다중선택+사본모드 동시 발동).
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const steps = 10;
    const [ddx, ddy] = [220, -150];
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(startX + (ddx * i) / steps, startY + (ddy * i) / steps, { steps: 1 });
    }
    await page.mouse.up();
    await page.keyboard.up(CTRL_KEY);
    await page.waitForTimeout(300);

    const afterCountC = await page.locator(".react-flow__node").count();
    check("(c) mixed ctrl-drag adds exactly 1 node (only Step A duplicated)", afterCountC === beforeCountC + 1, `before=${beforeCountC} after=${afterCountC}`);

    const dupLabelC = await page.locator(".react-flow__node", { hasText: "Step A (2)" }).count();
    check('(c) duplicate labeled "Step A (2)" exists', dupLabelC === 1, `count=${dupLabelC}`);

    const afterPosA = await readNodePos(a);
    check(
      "(c) original Step A returns to its start position",
      !!(afterPosA && Math.abs(afterPosA.x - beforePosA.x) <= LOCK_EPS && Math.abs(afterPosA.y - beforePosA.y) <= LOCK_EPS),
      `before=${JSON.stringify(beforePosA)} after=${JSON.stringify(afterPosA)}`,
    );

    const blockedToastC = await page.getByText("can't be copied", { exact: false }).first().isVisible().catch(() => false);
    check("(c) exclusion toast shown for the mixed selection", blockedToastC);
  } catch (err) {
    check("(c) mixed ctrl-drag ran without throwing", false, err instanceof Error ? err.message : String(err));
  }

  // ===== (d) [리뷰] 잔여 선택이 새 Ctrl+드래그에 딸려 복제되면 안 됨 =====
  try {
    const s = rid();
    const p1 = rid();
    const p2 = rid();
    const p3 = rid();
    await seedAndReload([
      { id: s, title: "Start", node_type: "start", pos_x: 250, pos_y: 380, sort_order: 0 },
      { id: p1, title: "P One", node_type: "process", pos_x: 560, pos_y: 380, sort_order: 1 },
      { id: p2, title: "P Two", node_type: "process", pos_x: 560, pos_y: 600, sort_order: 2 },
      { id: p3, title: "P Three", node_type: "process", pos_x: 980, pos_y: 380, sort_order: 3 },
    ]);
    await clearSelection(); // 러버밴드 전 선택 베이스라인 초기화(pane bbox 파생 클릭)

    // 플레인(NO Ctrl) 러버밴드로 P One·P Two만 선택 — 둘을 완전히 감싸고 P Three(우측)·Start(좌측)는 제외.
    const b1 = await page.locator(`.react-flow__node[data-id="${p1}"]`).boundingBox();
    const b2 = await page.locator(`.react-flow__node[data-id="${p2}"]`).boundingBox();
    const boxLeft = Math.min(b1.x, b2.x) - 24;
    const boxTop = Math.min(b1.y, b2.y) - 24;
    const boxRight = Math.max(b1.x + b1.width, b2.x + b2.width) + 24;
    const boxBottom = Math.max(b1.y + b1.height, b2.y + b2.height) + 24;
    await page.mouse.move(boxLeft, boxTop);
    await page.mouse.down();
    await page.mouse.move((boxLeft + boxRight) / 2, (boxTop + boxBottom) / 2, { steps: 6 });
    await page.mouse.move(boxRight, boxBottom, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const selCountD = await page.locator(".react-flow__node.selected").count();
    check("(d) plain rubber-band pre-selects exactly 2 nodes (P One + P Two)", selCountD === 2, `selected=${selCountD}`);

    const beforeCountD = await page.locator(".react-flow__node").count();
    const midD = await ctrlDragBy(p3, 180, 150);
    check("(d) ghost shown for the fresh grab (only P Three)", midD.ghostVisible);

    const afterCountD = await page.locator(".react-flow__node").count();
    check(
      "(d) fresh Ctrl-drag on an unselected node adds exactly 1 node (not 3)",
      afterCountD === beforeCountD + 1,
      `before=${beforeCountD} after=${afterCountD}`,
    );
    const p3dup = await page.locator(".react-flow__node", { hasText: "P Three (2)" }).count();
    check('(d) only the grabbed node duplicated ("P Three (2)")', p3dup === 1, `count=${p3dup}`);
    const p1dup = await page.locator(".react-flow__node", { hasText: "P One (2)" }).count();
    const p2dup = await page.locator(".react-flow__node", { hasText: "P Two (2)" }).count();
    check("(d) stale-selected nodes are NOT duplicated", p1dup === 0 && p2dup === 0, `pOne(2)=${p1dup} pTwo(2)=${p2dup}`);
  } catch (err) {
    check("(d) stale-selection ctrl-drag ran without throwing", false, err instanceof Error ? err.message : String(err));
  }

  // ===== (e) [리뷰 CRITICAL] 의도적 다중선택 Ctrl+드래그 — 정확히 +N(2×N 이중 append 회귀 가드) =====
  try {
    const s = rid();
    const m1 = rid();
    const m2 = rid();
    await seedAndReload([
      { id: s, title: "Start", node_type: "start", pos_x: 250, pos_y: 380, sort_order: 0 },
      { id: m1, title: "M One", node_type: "process", pos_x: 560, pos_y: 380, sort_order: 1 },
      { id: m2, title: "M Two", node_type: "process", pos_x: 560, pos_y: 600, sort_order: 2 },
    ]);
    await clearSelection(); // 러버밴드 전 선택 베이스라인 초기화(pane bbox 파생 클릭)

    // 플레인 러버밴드로 M One·M Two 둘 다 선택(의도된 다중선택 → 잡은 노드가 사전 선택됨 → 둘 다 복제).
    const b1 = await page.locator(`.react-flow__node[data-id="${m1}"]`).boundingBox();
    const b2 = await page.locator(`.react-flow__node[data-id="${m2}"]`).boundingBox();
    const boxLeft = Math.min(b1.x, b2.x) - 24;
    const boxTop = Math.min(b1.y, b2.y) - 24;
    const boxRight = Math.max(b1.x + b1.width, b2.x + b2.width) + 24;
    const boxBottom = Math.max(b1.y + b1.height, b2.y + b2.height) + 24;
    await page.mouse.move(boxLeft, boxTop);
    await page.mouse.down();
    await page.mouse.move((boxLeft + boxRight) / 2, (boxTop + boxBottom) / 2, { steps: 6 });
    await page.mouse.move(boxRight, boxBottom, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const selCountE = await page.locator(".react-flow__node.selected").count();
    check("(e) rubber-band selects exactly 2 copyable nodes (M One + M Two)", selCountE === 2, `selected=${selCountE}`);

    const beforeCountE = await page.locator(".react-flow__node").count();
    // 선택된 노드 중 하나(M One)를 Ctrl+드래그 — 잡은 노드가 사전 선택돼 있으므로 선택 집합 전체(2개) 복제.
    await ctrlDragBy(m1, 260, -160);

    const afterCountE = await page.locator(".react-flow__node").count();
    // 핵심 회귀 가드: +2 여야 함. 버그면 +4(2×N).
    check(
      "(e) CRITICAL — 2 copyable multi-selected → exactly +2 nodes (not +4)",
      afterCountE === beforeCountE + 2,
      `before=${beforeCountE} after=${afterCountE} (bug would be +4)`,
    );
    const m1dup = await page.locator(".react-flow__node", { hasText: "M One (2)" }).count();
    const m2dup = await page.locator(".react-flow__node", { hasText: "M Two (2)" }).count();
    check("(e) each base duplicated exactly once — M One (2) ×1", m1dup === 1, `count=${m1dup}`);
    check("(e) each base duplicated exactly once — M Two (2) ×1", m2dup === 1, `count=${m2dup}`);
    // 중복 라벨((2) 두 개 등)이 없는지 — 이중 append면 "M One (2)"가 2개 생긴다.
    const m1dup3 = await page.locator(".react-flow__node", { hasText: "M One (3)" }).count();
    check("(e) no double-append artifact (no 'M One (3)')", m1dup3 === 0, `count=${m1dup3}`);

    // 백엔드 영속 — autosave(2s) 반영 후 저장 노드 수가 딱 5개(Start+MOne+MTwo+사본2)여야. 버그면 7개.
    await page.waitForTimeout(2500);
    const titlesE = await savedTitles();
    check(
      "(e) CRITICAL — backend persists exactly 5 nodes after reload (not 7)",
      titlesE.length === 5,
      `titles=${JSON.stringify(titlesE)}`,
    );
  } catch (err) {
    check("(e) multi-node ctrl-drag ran without throwing", false, err instanceof Error ? err.message : String(err));
  }
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
console.log(failed.length === 0 ? "PASS" : "FAIL");
process.exit(failed.length === 0 ? 0 : 1);

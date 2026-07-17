// Ctrl/⌘+드래그 노드 복제 — 브라우저 실기동 검증 (Task 1.4).
// 시나리오: ①복사 가능 노드(process) Ctrl+드래그 → 드래그 중 잔상(.bpm-node-ghost)·"+"배지(lucide-plus) 노출,
//           드롭 시 원본은 시작 위치로 복귀 + "(2)" 중복라벨 사본이 드롭 위치에 생성
//           ②start 노드(비복사 타입) Ctrl+드래그 → 잔상·배지 없이 일반 이동, copy.blocked 토스트, 사본 없음
//           ③다중선택(process+start 혼합) Ctrl+드래그 → 복사 가능(process)만 복제 + 제외 토스트, start는 그냥 이동
//           ④콘솔 에러 0
//
// 실행 (frontend/ 에서): node scripts/pw-verify-ctrl-drag.mjs
// 전제: backend :8000(reset_db 시드 무관 — API로 맵을 새로 만듦), frontend :3000, playwright-core(--no-save)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
// 앱은 event.ctrlKey || event.metaKey 둘 다 받으므로 플랫폼에 맞는 키를 누른 채 드래그(csv-create-flow·
// node-copy 검증 스크립트와 동일 관례). 주의: 이 키는 RF 기본 multiSelectionKeyCode와도 겹친다(아래 시나리오
// ③에서 의도적으로 활용 — 이전 시나리오의 잔여 선택이 새지 않도록 매 시나리오 시작 전 clearSelection 필수).
const CTRL_KEY = process.platform === "darwin" ? "Meta" : "Control";
const LOCK_EPS = 2; // flow px — 원위치 복귀는 정확히 시작값이어야 하므로 여유는 최소.
const MOVE_MIN = 40; // flow px — 드롭 위치는 원위치에서 이만큼은 떨어져 있어야 "이동/복제됐다"로 인정.

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

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
  const x = pane.x + pane.width - 60; // 우측 안쪽 — 시드 노드(x≤560+180)와 겹치지 않음
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
try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");

  // Start(비복사) + Step A/Step B(복사 가능, 내부 엣지 A→B) — 단일·비복사·혼합선택 세 시나리오를 한 맵에서 커버.
  const s = rid();
  const a = rid();
  const b = rid();
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
  const versionId = created.versions[0].id;
  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: {
      // pos는 캔버스 원점에서 충분히 아래·오른쪽으로 — 좌상단 MapTitleChecklist 칩에 클릭이 가로채이지 않게
      // (frontend/scripts/pw-verify-node-copy.mjs와 동일 교훈). 서로 240px+ 떨어뜨려 드래그 여유 확보.
      nodes: [
        { id: s, title: "Start", node_type: "start", pos_x: 250, pos_y: 380, sort_order: 0 },
        { id: a, title: "Step A", node_type: "process", pos_x: 560, pos_y: 380, sort_order: 1 },
        { id: b, title: "Step B", node_type: "process", pos_x: 560, pos_y: 620, sort_order: 2 },
      ],
      edges: [{ id: rid(), source_node_id: s, target_node_id: a }, { id: rid(), source_node_id: a, target_node_id: b }],
      groups: [],
    },
  });

  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);

  // ===== ① Ctrl+드래그 복사 가능 노드(Step A) — 잔상·+배지 노출, 원본 원위치 복귀 + "(2)" 사본 드롭 위치 생성 =====
  await clearSelection();
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

  // ===== ② Ctrl+드래그 start 노드(비복사 타입) — 잔상·배지 없이 일반 이동, copy.blocked 토스트, 사본 없음 =====
  await clearSelection();
  const beforeCountB = await page.locator(".react-flow__node").count();
  const beforePosS = await readNodePos(s);
  const midDragB = await ctrlDragBy(s, 150, 90);

  check("(b) no ghost overlay for a non-copyable drag", !midDragB.ghostVisible);
  check("(b) no + badge for a non-copyable drag", !midDragB.badgeVisible);

  const afterCountB = await page.locator(".react-flow__node").count();
  check("(b) no node added (blocked from copying)", afterCountB === beforeCountB, `before=${beforeCountB} after=${afterCountB}`);

  const afterPosS = await readNodePos(s);
  const startMoved =
    !!(afterPosS && (Math.abs(afterPosS.x - beforePosS.x) >= MOVE_MIN || Math.abs(afterPosS.y - beforePosS.y) >= MOVE_MIN));
  check("(b) start node still moves normally (not frozen)", startMoved, `before=${JSON.stringify(beforePosS)} after=${JSON.stringify(afterPosS)}`);

  const blockedToastB = await page.getByText("can't be copied", { exact: false }).first().isVisible().catch(() => false);
  check("(b) copy.blocked toast shown for a start-node ctrl-drag", blockedToastB);

  // ===== ③ 다중선택(Step B + Start) 혼합 Ctrl+드래그 — 복사 가능(Step B)만 복제, Start는 그냥 이동 + 제외 토스트 =====
  // 독립 try/catch — 실패해도 아래 최종 집계·정리(finally)는 항상 실행.
  try {
    await clearSelection();
    await page.locator(`.react-flow__node[data-id="${b}"]`).click({ force: true });
    await page.keyboard.down(CTRL_KEY); // 다중선택(RF 기본 multiSelectionKeyCode)과 사본모드 트리거가 동일 키 — 의도적 재사용.
    await page.locator(`.react-flow__node[data-id="${s}"]`).click({ force: true });
    const selCountC = await page.locator(".react-flow__node.selected").count();
    check("(c) mixed selection picks up 2 nodes (Step B + Start)", selCountC === 2, `selected=${selCountC}`);

    const beforeCountC = await page.locator(".react-flow__node").count();
    const beforePosB = await readNodePos(b);
    const beforePosS2 = await readNodePos(s);
    const box = await page.locator(`.react-flow__node[data-id="${b}"]`).boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    // Ctrl은 위에서부터 계속 눌린 상태 — 그대로 Step B를 잡아 끈다(다중선택+사본모드 동시 발동).
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const steps = 10;
    const [ddx, ddy] = [-260, -160];
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(startX + (ddx * i) / steps, startY + (ddy * i) / steps, { steps: 1 });
    }
    await page.mouse.up();
    await page.keyboard.up(CTRL_KEY);
    await page.waitForTimeout(300);

    const afterCountC = await page.locator(".react-flow__node").count();
    check("(c) mixed ctrl-drag adds exactly 1 node (only Step B duplicated)", afterCountC === beforeCountC + 1, `before=${beforeCountC} after=${afterCountC}`);

    const dupLabelC = await page.locator(".react-flow__node", { hasText: "Step B (2)" }).count();
    check('(c) duplicate labeled "Step B (2)" exists', dupLabelC === 1, `count=${dupLabelC}`);

    const afterPosB = await readNodePos(b);
    check(
      "(c) original Step B returns to its start position",
      !!(afterPosB && Math.abs(afterPosB.x - beforePosB.x) <= LOCK_EPS && Math.abs(afterPosB.y - beforePosB.y) <= LOCK_EPS),
      `before=${JSON.stringify(beforePosB)} after=${JSON.stringify(afterPosB)}`,
    );

    const afterPosS2 = await readNodePos(s);
    const startMovedC =
      !!(afterPosS2 && (Math.abs(afterPosS2.x - beforePosS2.x) >= MOVE_MIN || Math.abs(afterPosS2.y - beforePosS2.y) >= MOVE_MIN));
    check("(c) non-copyable Start moves along but isn't duplicated", startMovedC, `before=${JSON.stringify(beforePosS2)} after=${JSON.stringify(afterPosS2)}`);

    const blockedToastC = await page.getByText("can't be copied", { exact: false }).first().isVisible().catch(() => false);
    check("(c) exclusion toast shown for the mixed selection", blockedToastC);
  } catch (err) {
    check("(c) mixed ctrl-drag ran without throwing", false, err instanceof Error ? err.message : String(err));
  }

  // ===== ④ [리뷰 지적] 잔여 선택이 새 Ctrl+드래그에 딸려 복제되면 안 됨 =====
  // NO-Ctrl 러버밴드로 두 노드를 미리 선택 → 선택되지 않은 세 번째 노드를 Ctrl+드래그.
  // RF의 multiSelectionKeyCode(=Ctrl/⌘)가 트리거 키와 겹쳐 잔여 선택이 딸려 오는 버그의 회귀 가드.
  // 기대: 딱 1개(세 번째 노드만) 복제, 잔여 2개는 복제 안 됨. 독립 try/catch로 최종 집계와 격리.
  try {
    // 결정적 레이아웃으로 그래프 재구성 — 잘 벌린 복사 가능 노드 3개(+Start). 이전 시나리오의 사본/이동 잔재 제거.
    const p1 = rid();
    const p2 = rid();
    const p3 = rid();
    await api(`/versions/${versionId}/graph`, {
      method: "PUT",
      body: {
        nodes: [
          { id: rid(), title: "Start", node_type: "start", pos_x: 250, pos_y: 380, sort_order: 0 },
          { id: p1, title: "P One", node_type: "process", pos_x: 560, pos_y: 380, sort_order: 1 },
          { id: p2, title: "P Two", node_type: "process", pos_x: 560, pos_y: 600, sort_order: 2 },
          { id: p3, title: "P Three", node_type: "process", pos_x: 980, pos_y: 380, sort_order: 3 },
        ],
        edges: [],
        groups: [],
      },
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".react-flow__node", { timeout: 20000 });
    await page.waitForTimeout(500);

    // 플레인(NO Ctrl) 러버밴드로 P One·P Two만 선택 — 둘을 완전히 감싸고 P Three(우측)·Start(좌측)는 제외하는
    // 빈 pane 박스 드래그(selectionOnDrag + selectionMode Full). 시작점은 박스 좌상단(노드 위가 아닌 빈 영역).
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
    // 선택되지 않은 P Three를 Ctrl+드래그 — 잔여 선택(P One/P Two)이 딸려 복제되면 회귀.
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

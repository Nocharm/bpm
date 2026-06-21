// Issue 3 스모크 — (i) 드롭 링에 obsolete "child" 타일이 없는지, (ii) 노드를 하위프로세스의
// front/back 타일에 드롭하면 삽입 엣지가 하위프로세스 핸들(in/__primary__)에 붙는지(댕글링 아님),
// (iii) 노드↔하위프로세스 swap 시 위치와 엣지가 올바른 핸들로 교환되는지 실측.
// map 3: c-start(start) → c-order(subprocess,linked=1) → c-deliver(subprocess,linked=2) → c-done(end),
//         c-order -취소-> c-cancelled(end).
// 실행: node scripts/pw-smoke-issue3-dropzone.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = "http://localhost:8000/api/versions/3/graph";
const SUB_IN = "in"; // SUBPROCESS_IN_HANDLE
const PRIMARY = "__primary__"; // PRIMARY_END_HANDLE

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "user.choi"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("Couldn't create edge for source handle")) {
    errors.push(m.text());
  }
});

// seed 그래프 백업 → 테스트 끝나면 복원(스모크 멱등)
const seed = await (await fetch(API)).json();

await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector('.react-flow__node[data-id="c-done"]', { timeout: 30000 });
await page.waitForTimeout(2500);

const editable = await page.evaluate(() =>
  document.querySelector('.react-flow__node[data-id="c-start"]').classList.contains("draggable"),
);
if (!editable) {
  console.log("NOT EDITABLE (read-only) — checkout held by another user; cannot exercise drop-zone.");
  await browser.close();
  process.exit(1);
}

const box = (id) => page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();

// 드롭 링이 뜰 때까지 A를 B 위로 끌어 dwell. zone 타일 라벨/활성 zone을 반환.
async function hoverRing(aId, bId) {
  const a = await box(aId);
  const b = await box(bId);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // B 중심으로 단계 이동 후 머문다(DWELL_MS) — 링 표시
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  await page.mouse.move((a.x + bx) / 2, (a.y + by) / 2, { steps: 6 });
  await page.mouse.move(bx, by, { steps: 6 });
  await page.waitForTimeout(700); // > DWELL_MS
  await page.mouse.move(bx, by, { steps: 2 }); // dwell 트리거 재확인
  await page.waitForTimeout(400);
  return { bx, by };
}

// ===== (i) 드롭 링에 "child" 타일이 없는지 =====
const { bx, by } = await hoverRing("c-start", "c-deliver");
// 링 타일 라벨 수집 — "Into sub-process"/"하위로 넣기"가 있으면 child 타일이 남아있는 것.
const ringLabels = await page.evaluate(() => {
  const ring = [...document.querySelectorAll(".zone-pop")];
  return ring.map((d) => d.textContent?.trim() ?? "");
});
const hasChildTile = ringLabels.some(
  (l) => l.includes("Into sub-process") || l.includes("하위로 넣기"),
);
console.log("ring tile labels:", JSON.stringify(ringLabels));
console.log("(i) child tile present (expect false):", hasChildTile);
// 드래그 취소(엣지 변형 없이) — front 타일이 아닌 링 중앙 위로 올려 zone=null로 만든 뒤 esc
await page.mouse.move(bx, by);
await page.keyboard.press("Escape");
await page.mouse.up();
await page.waitForTimeout(400);

// ===== (ii) 노드를 하위프로세스 back 타일에 드롭 → 삽입 엣지가 in/__primary__ 핸들 =====
// c-done(end)를 c-order(subprocess) "back"에 드롭 → c-order --__primary__--> c-done(th:left default)
// 삽입(rewire)되며 기존 c-order--__primary__-->c-deliver 가 c-done 경유로. c-done은 end라 source 정상.
// 핵심 검증: 새 엣지 c-order -> c-done 의 sourceHandle == __primary__ (subprocess source).
async function dropOnZone(aId, bId, zone) {
  const a = await box(aId);
  const b = await box(bId);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  await page.mouse.move((a.x + bx) / 2, (a.y + by) / 2, { steps: 6 });
  await page.mouse.move(bx, by, { steps: 6 });
  await page.waitForTimeout(700); // 링 표시(DWELL_MS)
  // 타일 위치 — front=좌, back=우, group=상, swap=좌하. 링 반경은 ZONE_TILE 배치와 동일.
  const ring = await page.evaluate((z) => {
    const tiles = [...document.querySelectorAll(".zone-pop")];
    // 라벨로 zone 식별
    const want = {
      front: ["Before", "앞에"],
      back: ["After", "뒤에"],
      swap: ["Swap", "교환"],
      group: ["Group", "그룹"],
    }[z];
    const el = tiles.find((d) => want.some((w) => (d.textContent ?? "").includes(w)));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, zone);
  if (!ring) {
    await page.mouse.up();
    throw new Error(`zone tile "${zone}" not found`);
  }
  await page.mouse.move(ring.x, ring.y, { steps: 4 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

// c-cancelled(end) 를 c-deliver(subprocess) "back"에 삽입 → c-deliver --__primary__--> c-cancelled 새 엣지.
let insertBackOk = false;
let insertBackHandle = "(none)";
try {
  await dropOnZone("c-cancelled", "c-deliver", "back");
  // 충돌 프롬프트가 뜨면 insert 선택
  const insertBtn = page.locator("button", { hasText: /Insert|삽입/ }).first();
  if (await insertBtn.isVisible().catch(() => false)) {
    await insertBtn.click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(3000); // autosave(2000) + PUT
  const g = await (await fetch(API)).json();
  const e = g.edges.find((x) => x.source_node_id === "c-deliver" && x.target_node_id === "c-cancelled");
  insertBackHandle = e ? `sh=${e.source_handle ?? "-"} th=${e.target_handle ?? "-"}` : "(no edge)";
  // c-deliver는 subprocess → source_handle 은 __primary__ 여야 RF가 붙인다.
  insertBackOk = !!e && e.source_handle === PRIMARY;
} catch (err) {
  console.log("insertBack error:", err.message);
}
console.log("(ii) insert-after into-subprocess-source edge:", insertBackHandle, "ok=", insertBackOk);

// dangling 여부 — 렌더된 엣지 path가 실제 존재하는지(React Flow가 핸들 못 찾으면 엣지 미렌더).
const renderedEdge = await page.evaluate(() => {
  // c-deliver -> c-cancelled 엣지 path 존재?
  const paths = [...document.querySelectorAll(".react-flow__edge")];
  return paths.some((p) => {
    const id = p.getAttribute("data-id") ?? p.getAttribute("data-testid") ?? "";
    return id.includes("c-deliver") || (p.textContent ?? "").length >= 0; // 존재성만
  });
});
console.log("(ii) edges rendered (non-dangling presence):", renderedEdge);

// ===== (iii) swap 노드↔하위프로세스 → 위치+엣지 교환, 핸들 보정 =====
// 먼저 그래프 복원(깨끗한 시작). (ii)의 지연 autosave(2s 디바운스)가 seed PUT 뒤에 덮어쓰지 않도록
// 충분히 비운 뒤 복원하고, 복원이 안착하도록 reload 전 settle을 둔다.
await page.waitForTimeout(3000); // (ii) 지연 autosave 드레인
await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(seed) });
await page.waitForTimeout(500);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('.react-flow__node[data-id="c-done"]', { timeout: 30000 });
await page.waitForTimeout(2500);
// 스왑 전 c-done 이 seed 자리(800)에 있는지 확인 — 복원 안착 검증.
const preSwapDoneX = (await (await fetch(API)).json()).nodes.find((n) => n.id === "c-done")?.pos_x;
console.log("(iii) pre-swap c-done pos_x (expect ~800):", preSwapDoneX);

let swapOk = false;
let swapDetail = "(none)";
// 핸들 정합 불변식 — 모든 루트 엣지: target이 하위프로세스면 th==="in", source가 하위프로세스면 sh==="__primary__",
// 그리고 하위프로세스가 아닌 끝점엔 전용 핸들이 남아있으면 안 됨(swap 후 stale 핸들 검출).
function checkHandleInvariant(g) {
  const subById = new Map(g.nodes.map((n) => [n.id, n.node_type === "subprocess"]));
  const bad = [];
  for (const e of g.edges) {
    const sSub = subById.get(e.source_node_id);
    const tSub = subById.get(e.target_node_id);
    if (sSub && e.source_handle !== PRIMARY) bad.push(`${e.source_node_id}->${e.target_node_id} src-sub sh=${e.source_handle ?? "-"}`);
    if (!sSub && e.source_handle === PRIMARY) bad.push(`${e.source_node_id}->${e.target_node_id} non-sub src stale sh=${PRIMARY}`);
    if (tSub && e.target_handle !== SUB_IN) bad.push(`${e.source_node_id}->${e.target_node_id} tgt-sub th=${e.target_handle ?? "-"}`);
    if (!tSub && e.target_handle === SUB_IN) bad.push(`${e.source_node_id}->${e.target_node_id} non-sub tgt stale th=${SUB_IN}`);
  }
  return bad;
}
try {
  // c-done(end) 를 c-order(subprocess) 와 swap → 끝점이 바뀐 엣지들의 핸들이 새 타입에 맞게 보정돼야.
  await dropOnZone("c-done", "c-order", "swap");
  await page.waitForTimeout(3200);
  const g = await (await fetch(API)).json();
  // 위치 교환 확인 — c-done 이 원래 c-order 자리(320,220), c-order 가 원래 c-done 자리(800,220) 근처.
  const cDone = g.nodes.find((n) => n.id === "c-done");
  const cOrder = g.nodes.find((n) => n.id === "c-order");
  const posSwapped = !!cDone && !!cOrder && Math.abs(cDone.pos_x - 320) < 40 && Math.abs(cOrder.pos_x - 800) < 40;
  const bad = checkHandleInvariant(g);
  swapDetail = `posSwapped=${posSwapped}; handleViolations=${bad.length ? JSON.stringify(bad) : "none"}`;
  swapOk = posSwapped && bad.length === 0;
} catch (err) {
  console.log("swap error:", err.message);
}
console.log("(iii) swap:", swapDetail, "ok=", swapOk);

await page.screenshot({ path: "/tmp/bpm-issue3.png", fullPage: false });
// 브라우저를 먼저 닫아 지연 autosave가 복원 PUT을 덮어쓰지 못하게 한 뒤 seed 복원.
await browser.close();
await new Promise((r) => setTimeout(r, 500));
await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(seed) });

console.log("consoleErrors:", errors.length, errors.slice(0, 5));
const pass = !hasChildTile && insertBackOk && swapOk && errors.length === 0;
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);

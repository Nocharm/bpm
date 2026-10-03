// 흐름 펄스 정지 장면·줌 문턱·범례·비교 화면 검증 — 병렬 출구(A→B,C)와 분기(D→E 예/F 아니오) 맵을 API로 시드하고
// (1) 기본은 움직이는 점, 정지 장면 점은 숨김 (2) 줌 50% 미만이면 움직이는 점이 사라지고 정지 장면 점은 남음
// (3) 모션 축소면 정지 장면 점이 보임 (4) 노드 표시 정보 카드에 흐름 점 범례 (5) PNG 출력에 정지 장면 (6) 비교 화면 정지 장면을 본다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-pulse-still.mjs
//   산출물 .shots/pulse-still-*.png (gitignore). 전제: admin.sys 시드(reset_db), backend DEV_ENFORCE_PERMISSIONS=false.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const NAME = "Pulse still";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ── 시드
const maps = await api("GET", "/api/maps");
for (const stale of maps.filter((m) => m.name.startsWith(NAME))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
const tag = Date.now().toString(36);
const nid = (key) => `pst-${tag}-${key}`;
const map = await api("POST", "/api/maps", { name: `${NAME} ${tag}`, owning_department: owning, visibility: "private" });
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
await api("PUT", `/api/versions/${draft.id}/graph`, {
  nodes: [
    { id: nid("start"), title: "Start", node_type: "start", pos_x: 0, pos_y: 160 },
    { id: nid("a"), title: "접수", node_type: "process", pos_x: 200, pos_y: 160, parallel_outputs: ["__primary__"] },
    { id: nid("b"), title: "서류 검토", node_type: "process", pos_x: 480, pos_y: 40 },
    { id: nid("c"), title: "신용 조회", node_type: "process", pos_x: 480, pos_y: 280 },
    { id: nid("d"), title: "승인?", node_type: "decision", pos_x: 760, pos_y: 150 },
    { id: nid("e"), title: "계약", node_type: "end", pos_x: 1040, pos_y: 40 },
    { id: nid("f"), title: "반려", node_type: "end", pos_x: 1040, pos_y: 280 },
  ],
  edges: [
    { id: nid("e0"), source_node_id: nid("start"), target_node_id: nid("a") },
    { id: nid("e1"), source_node_id: nid("a"), target_node_id: nid("b") },
    { id: nid("e2"), source_node_id: nid("a"), target_node_id: nid("c") },
    { id: nid("e3"), source_node_id: nid("b"), target_node_id: nid("d") },
    { id: nid("e4"), source_node_id: nid("c"), target_node_id: nid("d") },
    { id: nid("e5"), source_node_id: nid("d"), target_node_id: nid("e"), label: "예" },
    { id: nid("e6"), source_node_id: nid("d"), target_node_id: nid("f"), label: "아니오" },
  ],
  groups: [],
});
check("seeded parallel + decision map", true, `map ${map.id} v${draft.id}`);

// ── 브라우저
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
async function openPage(reducedMotion) {
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion,
    acceptDownloads: true,
  });
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "en");
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => errors.push(`page: ${String(e).slice(0, 200)}`));
  return page;
}
async function openEditor(page) {
  await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
  await sleep(2500);
  await page.locator('[aria-label="Fit to view (top-left)"]').first().click();
  await sleep(900);
}
// 표시 상태별 점 개수 — getComputedStyle display로 실제 보임을 센다
const countDots = (page, selector) =>
  page.evaluate((sel) => {
    const all = [...document.querySelectorAll(sel)];
    return { total: all.length, shown: all.filter((el) => getComputedStyle(el).display !== "none").length };
  }, selector);
const getZoom = (page) =>
  page.evaluate(() => {
    const t = getComputedStyle(document.querySelector(".react-flow__viewport")).transform;
    return new DOMMatrix(t).a;
  });
const canvasClip = async (page) => {
  const box = await page.locator(".react-flow").first().boundingBox();
  return { x: box.x, y: box.y, width: Math.min(box.width, 1000), height: Math.min(box.height, 560) };
};

// ── (1) 기본: 움직이는 점 4개(병렬 2 + 분기 2), 정지 장면 점 4개는 숨김
const page = await openPage("no-preference");
await openEditor(page);
const zoom1 = await getZoom(page);
const motion1 = await countDots(page, "circle.bpm-edge-pulse");
const still1 = await countDots(page, "circle.bpm-edge-pulse-still");
check("default shows moving dots", motion1.total === 4, `zoom ${zoom1.toFixed(2)} ${JSON.stringify(motion1)}`);
check("default hides still-frame dots", still1.total === 4 && still1.shown === 0, JSON.stringify(still1));
await sleep(1200);
await page.screenshot({ path: `${OUT}/pulse-still-1-default.png`, clip: await canvasClip(page) });

// ── (4) 범례: 노드 표시 정보 카드 아래 흐름 점 두 줄
await page.locator('[data-id="canvas-node-display-float-toggle"]').click();
await sleep(500);
const legend = page.locator('[data-id="canvas-node-display-float"] [data-id="pulse-legend"]');
check("node display card shows the flow-dot legend", (await legend.count()) === 1);
const card = await page.locator('[data-id="canvas-node-display-float"]').boundingBox();
await page.screenshot({ path: `${OUT}/pulse-still-4-legend.png`, clip: { x: card.x - 20, y: card.y - 20, width: card.width + 40, height: card.height + 70 } });
await page.keyboard.press("Escape");
await sleep(300);

// ── (2) 줌 50% 미만: 움직이는 점은 사라지고 정지 장면 점(출력용)은 남는다
const flow = await page.locator(".react-flow__pane").first().boundingBox();
await page.mouse.move(flow.x + flow.width / 2, flow.y + flow.height / 2);
for (let i = 0; i < 12 && (await getZoom(page)) >= 0.45; i += 1) {
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Control");
  await sleep(250);
}
const zoom2 = await getZoom(page);
const motion2 = await countDots(page, "circle.bpm-edge-pulse");
const still2 = await countDots(page, "circle.bpm-edge-pulse-still");
check("below 50% zoom the moving dots are gone", zoom2 < 0.5 && motion2.total === 0, `zoom ${zoom2.toFixed(2)} ${JSON.stringify(motion2)}`);
check("below 50% zoom the still-frame dots stay mounted", still2.total === 4, JSON.stringify(still2));
await page.locator('[aria-label="Fit to view (top-left)"]').first().click();
await sleep(900);
const motion2b = await countDots(page, "circle.bpm-edge-pulse");
check("zooming back in restores the moving dots", motion2b.total === 4, `zoom ${(await getZoom(page)).toFixed(2)}`);

// ── (5) PNG 출력: 다운로드 성공(정지 장면 교대는 캡처 뒤 원복)
await page.locator(".react-flow__pane").first().click({ position: { x: 20, y: 20 } });
await sleep(400);
// 인스펙터 맵 탭(탭 버튼은 aria-label만 가진다 — pw-smoke-no-word와 동일)
await page.locator('button[aria-label="Map"]').first().click();
await page.locator('[data-id="export-png"]').waitFor({ state: "visible", timeout: 10_000 });
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 60_000 }),
  page.locator('[data-id="export-png"]').click(),
]);
await download.saveAs(`${OUT}/pulse-still-5-export.png`);
check("PNG export downloads", true, download.suggestedFilename());
const motion5 = await countDots(page, "circle.bpm-edge-pulse");
const still5 = await countDots(page, "circle.bpm-edge-pulse-still");
check("export restores moving dots and hides still dots afterwards", motion5.shown === 4 && still5.shown === 0, JSON.stringify({ motion5, still5 }));

// ── (3) 모션 축소: 정지 장면 점이 보이고 움직이는 점은 숨김
const reduced = await openPage("reduce");
await openEditor(reduced);
const motion3 = await countDots(reduced, "circle.bpm-edge-pulse");
const still3 = await countDots(reduced, "circle.bpm-edge-pulse-still");
check("reduced motion hides moving dots", motion3.shown === 0, JSON.stringify(motion3));
check("reduced motion shows still-frame dots", still3.shown === 4, JSON.stringify(still3));
const placed = await reduced.evaluate(() =>
  [...document.querySelectorAll("circle.bpm-edge-pulse-still")].every((c) => Number(c.getAttribute("cx")) !== 0),
);
check("still-frame dots sit on their edges", placed);
await reduced.screenshot({ path: `${OUT}/pulse-still-3-reduced.png`, clip: await canvasClip(reduced) });

// ── (6) 비교 화면: 같은 버전끼리 비교해도 캔버스는 대상 그래프 — 정지 장면 점 4개, 움직이는 점 없음, 범례는 정지 견본
await page.goto(`${BASE}/maps/${map.id}/compare?base=${draft.id}&target=${draft.id}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-id="compare-canvas"] path.react-flow__edge-path', { state: "attached", timeout: 120_000 });
await sleep(2500);
const compareDots = await page.evaluate(() => {
  const root = document.querySelector('[data-id="compare-canvas"]');
  const circles = [...root.querySelectorAll(".react-flow__edge circle")];
  return {
    moving: root.querySelectorAll("circle.bpm-edge-pulse").length,
    still: circles.filter((c) => getComputedStyle(c).display !== "none" && Number(c.getAttribute("cx")) !== 0).length,
  };
});
check("compare canvas shows still-frame dots only", compareDots.moving === 0 && compareDots.still === 4, JSON.stringify(compareDots));
const compareCanvas = await page.locator('[data-id="compare-canvas"]').boundingBox();
await page.screenshot({ path: `${OUT}/pulse-still-6-compare.png`, clip: { x: compareCanvas.x, y: compareCanvas.y, width: Math.min(compareCanvas.width, 1100), height: Math.min(compareCanvas.height, 600) } });
await page.locator('[data-id="compare-node-display-float-toggle"]').click();
await sleep(500);
check("compare legend uses still swatches", (await page.locator('[data-id="compare-node-display-float"] [data-id="pulse-legend"] circle.bpm-edge-pulse').count()) === 0
  && (await page.locator('[data-id="compare-node-display-float"] [data-id="pulse-legend"]').count()) === 1);

check("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);

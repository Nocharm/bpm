// 엣지 팬아웃 × 하위프로세스 펼침 검증 — 지정(designated) 맵을 링크한 SP 노드에 엣지 3개가 `in` 핸들로 모이고
// `__primary__`에서 2개가 나가는 맵을 API로 시드한 뒤, 펼침 전/후/드래그/접기 각 단계에서 콘솔·페이지 오류 0,
// 경로 d에 NaN 없음, 게이트웨이·자식 엣지 렌더, 팬 원호 유지, 접으면 엣지 수 복원을 실측한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-edge-fanout-expand.mjs
//   KEEP=1 이면 시드 맵 유지. 산출물 .shots/edge-fanout-expand-*.png (gitignore). 전제: sp_designated 맵 1개 이상(reset_db 시드).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const NAME = "Edge fan-out expand";
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

// ── 시드: A·B·C → SP(in) 3개 수렴, SP(__primary__) → D·E 아웃 팬, D → END
const maps = await api("GET", "/api/maps");
for (const stale of maps.filter((m) => m.name.startsWith(NAME))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const linkTarget = maps.find((m) => m.sp_designated_at && m.mode !== "framework");
if (!linkTarget) throw new Error("no designated subprocess map to link — run reset_db seed first");
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
const tag = Date.now().toString(36);
const nid = (key) => `fanx-${tag}-${key}`;
const SP = "하위 프로세스 실행";
const nodes = [
  { id: nid("start"), title: "시작", node_type: "start", pos_x: -300, pos_y: 200 },
  { id: nid("a"), title: "요청 접수", node_type: "process", pos_x: 0, pos_y: 20 },
  { id: nid("b"), title: "요건 검토", node_type: "process", pos_x: 0, pos_y: 200 },
  { id: nid("c"), title: "긴급 접수", node_type: "process", pos_x: 0, pos_y: 380 },
  { id: nid("sp"), title: SP, node_type: "subprocess", pos_x: 400, pos_y: 200, linked_map_id: linkTarget.id, follow_latest: true },
  { id: nid("d"), title: "결과 통보", node_type: "process", pos_x: 800, pos_y: 80 },
  { id: nid("e"), title: "이력 기록", node_type: "process", pos_x: 800, pos_y: 340 },
  { id: nid("end"), title: "완료", node_type: "end", pos_x: 1150, pos_y: 100 },
];
const edges = [
  { id: nid("e-s"), source_node_id: nid("start"), target_node_id: nid("b") },
  { id: nid("e-a"), source_node_id: nid("a"), target_node_id: nid("sp"), target_handle: "in", label: "정상" },
  { id: nid("e-b"), source_node_id: nid("b"), target_node_id: nid("sp"), target_handle: "in" },
  { id: nid("e-c"), source_node_id: nid("c"), target_node_id: nid("sp"), target_handle: "in", label: "긴급" },
  { id: nid("e-d"), source_node_id: nid("sp"), target_node_id: nid("d"), source_handle: "__primary__", label: "통보" },
  { id: nid("e-e"), source_node_id: nid("sp"), target_node_id: nid("e"), source_handle: "__primary__" },
  { id: nid("e-end"), source_node_id: nid("d"), target_node_id: nid("end") },
];
const map = await api("POST", "/api/maps", { name: `${NAME} ${tag}`, owning_department: owning, visibility: "private" });
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
await api("PUT", `/api/versions/${draft.id}/graph`, { nodes, edges, groups: [] });
check("seeded map with a linked subprocess", true, `map ${map.id} v${draft.id} → links "${linkTarget.name}"`);

// ── 브라우저
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => errors.push(`page: ${String(e).slice(0, 200)}`));
let opened = false;
for (let i = 0; i < 30 && !opened; i += 1) {
  try {
    const r = await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
    opened = !!r && r.status() < 500;
  } catch {
    await sleep(3000);
  }
}
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
await sleep(2500);

const snapshot = () =>
  page.evaluate(() => {
    const paths = [...document.querySelectorAll("path.react-flow__edge-path")].map((p) => p.getAttribute("d") ?? "");
    const ids = [...document.querySelectorAll(".react-flow__edge")].map((g) => g.getAttribute("data-id") ?? "");
    return {
      edges: paths.length,
      arcs: paths.filter((d) => / A /.test(d)).length,
      nan: paths.filter((d) => /NaN/.test(d)).length,
      empty: paths.filter((d) => d.trim() === "").length,
      gateways: ids.filter((id) => id.startsWith("gw:")).length,
      children: ids.filter((id) => id.includes("/")).length,
      regions: document.querySelectorAll('[data-id^="region-band-"]').length,
    };
  });
/** 노드를 화면 중앙에(줌 유지) — RF 캔버스는 scrollIntoView가 안 먹고, 펼침·드래그 뒤엔 노드가 뷰포트 밖으로 밀릴 수 있다.
 *  SP 노드는 제목 대신 링크 맵 이름을 라이브 렌더하므로 텍스트가 아니라 노드 id(data-id)로 찾는다 */
const centerOn = (nodeId) =>
  page.evaluate((id) => {
    const node = document.querySelector(`.react-flow__node[data-id="${id}"]`);
    const viewport = document.querySelector(".react-flow__viewport");
    const pane = document.querySelector(".react-flow");
    if (!node || !viewport || !pane) return false;
    const r = node.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    const dx = pr.left + pr.width / 2 - (r.left + r.width / 2);
    const dy = pr.top + pr.height / 2 - (r.top + r.height / 2);
    viewport.style.transform = `translate(${m.e + dx}px, ${m.f + dy}px) scale(${m.a})`;
    return true;
  }, nodeId);
const errorsSince = (from) => errors.slice(from);
const spNode = page.locator(`.react-flow__node[data-id="${nid("sp")}"]`);

// ── 펼침 전: in 핸들 3개 수렴(위·같은 줄·아래) → 원호 2, __primary__ 아웃 팬 2 → 원호 2
const before = await snapshot();
check("before expand: fan arcs on the subprocess in/out handles", before.edges === 7 && before.arcs >= 4 && before.nan === 0, JSON.stringify(before));
const e0 = errors.length;
await centerOn(nid("sp"));
await sleep(300);
await page.locator(".react-flow").first().screenshot({ path: `${OUT}/edge-fanout-expand-before.png` });

// ── 펼침
await spNode.click();
await sleep(300);
await page.locator('[data-id="node-action-expand"]').click();
await page.waitForSelector('[data-id^="region-band-"]', { timeout: 20_000 });
await sleep(2000);
const expanded = await snapshot();
check("expanded: region band + child edges + gateway edges rendered", expanded.regions > 0 && expanded.children > 0 && expanded.gateways > 0, JSON.stringify(expanded));
check("expanded: no NaN/empty paths", expanded.nan === 0 && expanded.empty === 0);
check("expanded: incoming fan arcs still rendered", expanded.arcs >= 2, `arcs ${expanded.arcs}`);
check("expanded: no console/page errors", errorsSince(e0).length === 0, errorsSince(e0).join(" | ").slice(0, 300));
await centerOn(nid("sp"));
await sleep(300);
await page.locator(".react-flow").first().screenshot({ path: `${OUT}/edge-fanout-expand-open.png` });

// ── 펼친 채로 소스 노드 드래그(레인 동결 + 라이브 좌표) → 오류·NaN 없음, 원위치
{
  await centerOn(nid("b"));
  await sleep(300);
  const box = await page.locator(`.react-flow__node[data-id="${nid("b")}"]`).boundingBox();
  const e1 = errors.length;
  const from = { x: box.x + 30, y: box.y + 12 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(from.x + i * 8, from.y + i * 10);
    await sleep(30);
  }
  const mid = await snapshot();
  for (let i = 8; i >= 0; i -= 1) {
    await page.mouse.move(from.x + i * 8, from.y + i * 10);
    await sleep(30);
  }
  await page.mouse.up();
  await sleep(800);
  const after = await snapshot();
  check("drag while expanded: no NaN/empty paths mid-drag and after drop", mid.nan === 0 && mid.empty === 0 && after.nan === 0 && after.empty === 0, `mid ${JSON.stringify(mid)} after ${JSON.stringify(after)}`);
  check("drag while expanded: no console/page errors", errorsSince(e1).length === 0, errorsSince(e1).join(" | ").slice(0, 300));
}

// ── 접기 — 펼친 호스트는 선택 링·밴드 모션 때문에 Playwright 안정성 검사가 안 끝나므로 force 클릭
await centerOn(nid("sp"));
await sleep(300);
await spNode.click({ force: true });
await sleep(400);
await page.locator('[data-id="node-action-expand"]').click({ force: true });
await page.waitForSelector('[data-id^="region-band-"]', { state: "detached", timeout: 20_000 }).catch(() => undefined);
await sleep(1500);
const collapsed = await snapshot();
check("collapsed: back to the original edges and arcs, no NaN", collapsed.edges === before.edges && collapsed.arcs === before.arcs && collapsed.regions === 0 && collapsed.nan === 0, JSON.stringify(collapsed));
check("collapsed: no console/page errors", errorsSince(e0).length === 0, errorsSince(e0).join(" | ").slice(0, 300));
await page.locator(".react-flow").first().screenshot({ path: `${OUT}/edge-fanout-expand-closed.png` });

await browser.close();
if (!KEEP) {
  await api("DELETE", `/api/maps/${map.id}`).catch((e) => console.log("cleanup skipped:", String(e).slice(0, 120)));
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed${KEEP ? ` (kept map ${map.id})` : ""}`);
process.exit(failed ? 1 : 0);

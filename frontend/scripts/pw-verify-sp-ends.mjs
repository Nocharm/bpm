// 하위프로세스 출구 다중 연결 + 들어오는 문 네 방향 검증 — 끝 3개(대표 "승인"·"반려"·"보류") 링크 맵을 발행·지정한 뒤
// 호스트 맵에서 (1) in 핸들 4변·미러 라벨·인스펙터 placeholder, (2) 펼침 게이트웨이 끝별 매핑·애니메이션,
// (3) 드롭존 뒤 → 출구 선택 목록 → 보류 끝 연결, (4) 분기↔SP 스왑 → 출력 자리 바꾸기 모달(확인·취소),
// (5) 저장 payload에 미러 라벨 없음을 실측한다. 설계: docs/design/2026-10-01-subprocess-ends-design.md §4-10.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-sp-ends.mjs
//   KEEP=1 이면 시드 맵 유지. 산출물 .shots/sp-ends-*.png (gitignore). 전제: admin.sys 시드(reset_db), employees에 admin.sys active.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const NAME = "SP ends";
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

// ── 시드 정리
const maps = await api("GET", "/api/maps");
for (const stale of maps.filter((m) => m.name.startsWith(NAME))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
const tag = Date.now().toString(36);
const nid = (key) => `spe-${tag}-${key}`;

async function createMap(name) {
  const map = await api("POST", "/api/maps", { name, owning_department: owning, visibility: "private" });
  const detail = await api("GET", `/api/maps/${map.id}`);
  const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
  await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
  return { map, draft };
}

// ── 링크 타깃: 시작 → 작업 → 끝 3개(승인*, 반려, 보류). 발행 + SP 지정이 있어야 임베드가 풀린다.
const target = await createMap(`${NAME} target ${tag}`);
await api("PUT", `/api/versions/${target.draft.id}/graph`, {
  nodes: [
    { id: nid("t-start"), title: "시작", node_type: "start", pos_x: 0, pos_y: 160 },
    { id: nid("t-task"), title: "검토 수행", node_type: "process", pos_x: 250, pos_y: 160 },
    { id: nid("t-ok"), title: "승인", node_type: "end", pos_x: 600, pos_y: 20, is_primary_end: true },
    { id: nid("t-reject"), title: "반려", node_type: "end", pos_x: 600, pos_y: 160 },
    { id: nid("t-hold"), title: "보류", node_type: "end", pos_x: 600, pos_y: 300 },
  ],
  edges: [
    { id: nid("t-e0"), source_node_id: nid("t-start"), target_node_id: nid("t-task") },
    { id: nid("t-e1"), source_node_id: nid("t-task"), target_node_id: nid("t-ok") },
    { id: nid("t-e2"), source_node_id: nid("t-task"), target_node_id: nid("t-reject") },
    { id: nid("t-e3"), source_node_id: nid("t-task"), target_node_id: nid("t-hold") },
  ],
  groups: [],
});
await api("PUT", `/api/maps/${target.map.id}/approvers`, { user_ids: [ADMIN] });
await api("POST", `/api/versions/${target.draft.id}/submit`, {});
await api("POST", `/api/versions/${target.draft.id}/approve`, {});
await api("POST", `/api/versions/${target.draft.id}/publish`, {});
await api("PUT", `/api/maps/${target.map.id}/subprocess-designation`, { department: String(owning).split(/\s*>\s*/).pop() || "QA" });
check("seeded, published and designated a 3-end link target", true, `map ${target.map.id}`);

// ── 호스트: 시작 → A → SP ; SP(승인)→D(라벨 없음=미러), SP(반려)→R ; D → 끝. N(느슨), I → Q(분기 Yes/No → Y1/Y2)
const host = await createMap(`${NAME} host ${tag}`);
const SP = nid("sp");
const hostNodes = [
  { id: nid("start"), title: "시작", node_type: "start", pos_x: -260, pos_y: 200 },
  { id: nid("a"), title: "요청 접수", node_type: "process", pos_x: 0, pos_y: 200 },
  { id: SP, title: "검토 서브", node_type: "subprocess", pos_x: 360, pos_y: 200, linked_map_id: target.map.id, follow_latest: true },
  { id: nid("d"), title: "결과 통보", node_type: "process", pos_x: 900, pos_y: 60 },
  { id: nid("r"), title: "재작업", node_type: "process", pos_x: 900, pos_y: 340 },
  { id: nid("end"), title: "완료", node_type: "end", pos_x: 1220, pos_y: 60 },
  { id: nid("n"), title: "보완 요청", node_type: "process", pos_x: 360, pos_y: 520 },
  { id: nid("i"), title: "접수 확인", node_type: "process", pos_x: -260, pos_y: 760 },
  { id: nid("q"), title: "승인 요청?", node_type: "decision", pos_x: 60, pos_y: 740 },
  { id: nid("y1"), title: "결제 처리", node_type: "process", pos_x: 900, pos_y: 620 },
  { id: nid("y2"), title: "보류 처리", node_type: "process", pos_x: 900, pos_y: 860 },
];
const hostEdges = [
  { id: nid("e-s"), source_node_id: nid("start"), target_node_id: nid("a") },
  { id: nid("e-a"), source_node_id: nid("a"), target_node_id: SP, target_handle: "in" },
  { id: nid("e-d"), source_node_id: SP, target_node_id: nid("d"), source_handle: "__primary__" },
  { id: nid("e-r"), source_node_id: SP, target_node_id: nid("r"), source_handle: "반려" },
  { id: nid("e-end"), source_node_id: nid("d"), target_node_id: nid("end") },
  { id: nid("e-i"), source_node_id: nid("i"), target_node_id: nid("q") },
  { id: nid("e-yes"), source_node_id: nid("q"), target_node_id: nid("y1"), label: "Yes" },
  { id: nid("e-no"), source_node_id: nid("q"), target_node_id: nid("y2"), label: "No" },
];
await api("PUT", `/api/versions/${host.draft.id}/graph`, { nodes: hostNodes, edges: hostEdges, groups: [] });
check("seeded host map with per-end exits", true, `map ${host.map.id} v${host.draft.id}`);

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
/** 에디터 열기(재진입 포함) — 드래그 단계 앞에서는 다시 열어 RF 뷰포트 상태를 초기화한다
 *  (centerOn은 DOM transform만 바꿔 RF 스토어와 어긋나므로 드롭존 조준 전에는 쓰지 않는다). */
async function openEditor() {
  let opened = false;
  for (let i = 0; i < 30 && !opened; i += 1) {
    try {
      const r = await page.goto(`${BASE}/maps/${host.map.id}?version=${host.draft.id}`, { waitUntil: "domcontentloaded" });
      opened = !!r && r.status() < 500;
    } catch {
      await sleep(3000);
    }
  }
  await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
  await sleep(2500);
  // 화면 맞춤 — 로드 뷰포트는 확대돼 있을 수 있어 노드 일부가 화면 밖(드래그 좌표 무효). 전체를 보이게 맞춘다.
  await page.locator('[aria-label="Fit to view (top-left)"]').first().click();
  await sleep(700);
}
await openEditor();

const edgeInfo = () =>
  page.evaluate(() => {
    const groups = [...document.querySelectorAll(".react-flow__edge")];
    return groups.map((g) => ({
      id: g.getAttribute("data-id") ?? "",
      aria: g.getAttribute("aria-label") ?? "",
      animated: g.classList.contains("animated"),
    }));
  });
const mirroredLabels = () =>
  page.evaluate(() => [...document.querySelectorAll('[data-mirrored="true"]')].map((el) => el.textContent?.trim() ?? ""));
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
const nodeBox = (id) => page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
/** 드롭존 드래그 — 대상 중심에서 dwell(300ms) 뒤 링이 뜨면 섹터(back=우 0°, front=좌 180°, swap=하 90°, 반경 113)로 이동해 릴리스 */
async function dragToZone(srcId, dstId, zone) {
  const a = await nodeBox(srcId);
  const b = await nodeBox(dstId);
  const src = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const dst = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  if (process.env.DEBUG) console.log("drag", zone, JSON.stringify({ a, b }));
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  await page.mouse.move(dst.x, dst.y, { steps: 10 });
  await sleep(700);
  const off = zone === "back" ? { x: 113, y: 1 } : zone === "front" ? { x: -113, y: 1 } : { x: 1, y: 113 };
  await page.mouse.move(dst.x + off.x, dst.y + off.y, { steps: 3 });
  await sleep(350);
  if (process.env.DEBUG) {
    await page.screenshot({ path: `${OUT}/sp-ends-debug-drag-${zone}.png` });
  }
  await page.mouse.up();
  await sleep(900);
}
const pointOnEdge = (edgeId) =>
  page.evaluate((id) => {
    const path = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`);
    if (!path) return null;
    // 경로 중점을 화면 좌표로 — SVG 변환(뷰포트 translate·scale 포함)은 getScreenCTM이 정확하다
    const p = path.getPointAtLength(path.getTotalLength() * 0.5);
    const s = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
    return { x: s.x, y: s.y };
  }, edgeId);

// ── (1) 로드: in 핸들 4변 · 끝별 출구 엣지 전부 렌더 · 미러 라벨 · 인스펙터 placeholder
const handleIds = await page.evaluate((id) => [...document.querySelectorAll(`.react-flow__node[data-id="${id}"] .react-flow__handle`)].map((h) => h.getAttribute("data-handleid")), SP);
check("subprocess renders four in handles (in, in:top, in:right, in:bottom)", ["in", "in:top", "in:right", "in:bottom"].every((h) => handleIds.includes(h)), handleIds.join(","));
check("subprocess renders one source handle per end (3)", handleIds.filter((h) => ["__primary__", "반려", "보류"].includes(h)).length === 3, handleIds.join(","));
const loaded = await edgeInfo();
check("all seeded edges render (8), including the non-primary end exit", loaded.length === hostEdges.length && loaded.some((e) => e.id === nid("e-r")), `${loaded.length} edges`);
const mirrored0 = await mirroredLabels();
check("exit edges without a typed label mirror the end title (승인, 반려)", mirrored0.includes("승인") && mirrored0.includes("반려") && mirrored0.length === 2, mirrored0.join("|"));
await centerOn(SP);
await sleep(300);
await page.locator(".react-flow").first().screenshot({ path: `${OUT}/sp-ends-01-loaded.png` });
{
  const pt = await pointOnEdge(nid("e-d"));
  await page.mouse.click(pt.x, pt.y);
  await sleep(600);
  const placeholder = await page.evaluate(() => {
    const ta = document.querySelector('textarea[data-id="inspector-edge-label"]');
    return ta ? { placeholder: ta.placeholder, value: ta.value } : null;
  });
  check("inspector label input shows the mirrored title as placeholder with an empty value", placeholder?.placeholder === "승인" && placeholder?.value === "", JSON.stringify(placeholder));
  await page.screenshot({ path: `${OUT}/sp-ends-02-inspector-placeholder.png` });
}

// ── (2) 펼침: 끝별 게이트웨이(승인→D, 반려→R, 보류 없음) + 애니메이션
await openEditor();
const e0 = errors.length;
await page.locator(`.react-flow__node[data-id="${SP}"]`).click();
await sleep(300);
await page.locator('[data-id="node-action-expand"]').click();
await page.waitForSelector('[data-id^="region-band-"]', { timeout: 20_000 });
await sleep(2000);
{
  const gws = (await edgeInfo()).filter((e) => e.id.startsWith("gw:"));
  const ids = gws.map((e) => e.id);
  const okExit = ids.includes(`gw:${SP}/${nid("t-ok")}->${nid("d")}`);
  const rejectExit = ids.includes(`gw:${SP}/${nid("t-reject")}->${nid("r")}`);
  const holdExit = ids.some((id) => id.includes(nid("t-hold")));
  check("expanded: exit gateways map each end to its own successor, unconnected end has none", okExit && rejectExit && !holdExit, ids.join(" "));
  check("expanded: gateway dashes animate like other edges", gws.length > 0 && gws.every((e) => e.animated), `${gws.filter((e) => e.animated).length}/${gws.length} animated`);
  check("expanded: no console/page errors", errors.slice(e0).length === 0, errors.slice(e0).join(" | ").slice(0, 300));
  await centerOn(SP);
  await sleep(300);
  await page.locator(".react-flow").first().screenshot({ path: `${OUT}/sp-ends-03-expanded.png` });
}
await page.locator(`.react-flow__node[data-id="${SP}"]`).click({ force: true });
await sleep(400);
await page.locator('[data-id="node-action-expand"]').click({ force: true });
await page.waitForSelector('[data-id^="region-band-"]', { state: "detached", timeout: 20_000 }).catch(() => undefined);
await sleep(1500);

// ── (3) 드롭존 뒤: N을 SP 뒤에 → 출구 선택 목록(대표 끝 첫 행) → 보류 선택 → SP(보류)→N
await openEditor();
{
  const e1 = errors.length;
  await dragToZone(nid("n"), SP, "back");
  const modal = page.locator('[data-id="edge-end-modal"]');
  const shown = await modal.isVisible().catch(() => false);
  check("back drop on a 3-end subprocess opens the end picker", shown);
  if (shown) {
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-id^="edge-end-row-"]')].map((el) => ({ id: el.getAttribute("data-id"), text: el.textContent ?? "" })));
    check("end picker lists the primary end first with its badge", rows[0]?.id === "edge-end-row-__primary__" && /Primary end/.test(rows[0]?.text ?? "") && rows.length === 3, JSON.stringify(rows.map((r) => r.id)));
    check("end picker shows the current target next to connected ends", /결과 통보/.test(rows[0]?.text ?? "") && /재작업/.test(rows[1]?.text ?? ""), rows.map((r) => r.text.replace(/\s+/g, " ")).join(" | "));
    await page.screenshot({ path: `${OUT}/sp-ends-04-end-picker.png` });
    await page.locator('[data-id="edge-end-row-보류"]').click();
    await sleep(1200);
  }
  const after = await edgeInfo();
  const fresh = after.filter((e) => !hostEdges.some((h) => h.id === e.id));
  const mirroredNow = await mirroredLabels();
  check("picking 보류 creates one new edge from that end, mirrored as 보류", fresh.length === 1 && mirroredNow.includes("보류"), `${fresh.length} new, labels ${mirroredNow.join("|")}`);
  check("end picker flow: no console/page errors", errors.slice(e1).length === 0, errors.slice(e1).join(" | ").slice(0, 300));
}

// ── (4) 스왑: 분기 Q(Yes/No)를 SP 가운데에 → 출력 자리 바꾸기 모달(2열·순서대로 짝 2개) → 확인 → 타깃만 교환
await sleep(3500); // 보류 연결 자동 저장 뒤 재진입
await openEditor();
{
  const e2 = errors.length;
  await dragToZone(nid("q"), SP, "swap");
  const modal = page.locator('[data-id="swap-outputs-modal"]');
  const shown = await modal.isVisible().catch(() => false);
  check("swap between a 2-output decision and a 3-exit subprocess opens the swap-outputs modal", shown);
  if (shown) {
    await sleep(900); // 연결선 그리기 모션
    const state = await page.evaluate(() => ({
      left: document.querySelectorAll('[data-id^="swap-outputs-row-left-"]').length,
      right: document.querySelectorAll('[data-id^="swap-outputs-row-right-"]').length,
      paired: document.querySelectorAll('[data-paired="true"]').length,
      lines: document.querySelectorAll(".swap-pair-line").length,
      primaryBadge: /Primary end/.test(document.querySelector('[data-id="swap-outputs-modal"]')?.textContent ?? ""),
      keep: document.querySelectorAll('[data-id^="swap-outputs-row-right-"]')[2]?.textContent?.includes("Keep") ?? false,
    }));
    check("modal: 2 decision outputs left, 3 subprocess exits right, 2 pairs in order, third exit marked Keep", state.left === 2 && state.right === 3 && state.paired === 4 && state.lines === 2 && state.primaryBadge && state.keep, JSON.stringify(state));
    const geom = await page.evaluate(() => {
      const host = document.querySelector('[data-id="swap-outputs-modal"]');
      const lines = [...host.querySelectorAll(".swap-pair-line")].map((p) => p.getAttribute("d"));
      const rowCenter = (sel) => {
        const r = host.querySelector(sel)?.getBoundingClientRect();
        return r ? r.top + r.height / 2 : null;
      };
      const svgTop = host.querySelector('[data-id="swap-outputs-connectors"]').getBoundingClientRect().top;
      const left0 = rowCenter('[data-id^="swap-outputs-row-left-"]');
      const right0 = rowCenter('[data-id^="swap-outputs-row-right-"]');
      const m = lines[0]?.match(/^M0,([\d.]+) C[\d.]+,[\d.]+ [\d.]+,[\d.]+ 56,([\d.]+)$/);
      return { left0: left0 - svgTop, right0: right0 - svgTop, y1: m ? +m[1] : null, y2: m ? +m[2] : null };
    });
    check("modal: connector endpoints sit on the row vertical centres", geom.y1 !== null && Math.abs(geom.y1 - geom.left0) <= 1.5 && Math.abs(geom.y2 - geom.right0) <= 1.5, JSON.stringify(geom));
    await page.screenshot({ path: `${OUT}/sp-ends-05-swap-outputs.png` });
    await page.locator('[data-id="swap-outputs-confirm"]').click();
    await sleep(1500);
  }
  const after = await edgeInfo();
  const aria = Object.fromEntries(after.map((e) => [e.id, e.aria]));
  const yesToD = aria[nid("e-yes")]?.endsWith(` to ${nid("d")}`);
  const noToR = aria[nid("e-no")]?.endsWith(` to ${nid("r")}`);
  const okToY1 = aria[nid("e-d")]?.endsWith(` to ${nid("y1")}`);
  const rejectToY2 = aria[nid("e-r")]?.endsWith(` to ${nid("y2")}`);
  check("confirm: paired outputs exchanged destinations only (Yes→D, No→R, 승인→Y1, 반려→Y2)", !!(yesToD && noToR && okToY1 && rejectToY2), JSON.stringify({ yes: aria[nid("e-yes")], no: aria[nid("e-no")], ok: aria[nid("e-d")], reject: aria[nid("e-r")] }));
  const mirroredNow = await mirroredLabels();
  check("confirm: end keys stayed with the subprocess (mirrored labels still 승인·반려·보류)", ["승인", "반려", "보류"].every((l) => mirroredNow.includes(l)), mirroredNow.join("|"));
  check("swap flow: no console/page errors", errors.slice(e2).length === 0, errors.slice(e2).join(" | ").slice(0, 300));
  await centerOn(SP);
  await sleep(300);
  await page.locator(".react-flow").first().screenshot({ path: `${OUT}/sp-ends-06-after-swap.png` });
}

// ── (4b) 취소: 다시 스왑 모달을 열고 Esc → 엣지·위치 무변경
await sleep(3500);
await openEditor();
{
  const before = await edgeInfo();
  const posBefore = await page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.style.transform, SP);
  await dragToZone(nid("q"), SP, "swap");
  const shown = await page.locator('[data-id="swap-outputs-modal"]').isVisible().catch(() => false);
  if (shown) {
    await page.keyboard.press("Escape");
    await sleep(800);
  }
  const after = await edgeInfo();
  const posAfter = await page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.style.transform, SP);
  check("cancel: Esc on the swap modal leaves edges and the subprocess position unchanged", shown && JSON.stringify(before) === JSON.stringify(after) && posBefore === posAfter, shown ? "" : "modal did not open");
}

// ── (5) 저장 payload: 미러 라벨은 저장되지 않고, 보류 끝 엣지는 끝 키로 저장
await sleep(4000);
const saved = await api("GET", `/api/versions/${host.draft.id}/graph`);
const spExits = saved.edges.filter((e) => e.source_node_id === SP);
check("saved graph: subprocess exits keep empty labels (mirror is render-only) and carry end keys", spExits.length === 3 && spExits.every((e) => !e.label) && new Set(spExits.map((e) => e.source_handle)).size === 3, JSON.stringify(spExits.map((e) => [e.source_handle, e.label])));

await browser.close();
if (!KEEP) {
  await api("DELETE", `/api/maps/${host.map.id}`).catch(() => undefined);
  await api("DELETE", `/api/maps/${target.map.id}`).catch(() => undefined);
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed${KEEP ? ` (kept maps ${host.map.id}, ${target.map.id})` : ""}`);
process.exit(failed ? 1 : 0);

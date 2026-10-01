// 매뉴얼 8차 캡처 — 병렬 출구·흐름 표시 / 하위프로세스 끝별 출구 슬라이드용. 산출 ../.shots/manual8/<lang>-*.jpg(gitignore)
// 실행(frontend/ 에서): PW_LANG=ko|en BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-manual-shots-8.mjs
//   API로 시드 맵을 만들고(병렬 출구 맵, 끝 3개 링크 맵+호스트) 노드 범위만 잘라 찍는다. 이후 docs/manual/slides/build_deck.py.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const LANG = process.env.PW_LANG ?? "ko";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.BACKEND_URL ?? "http://localhost:8048";
const OUT = "../.shots/manual8";
const H = { "X-Dev-User": "admin.sys", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = (ko, en) => (LANG === "en" ? en : ko);
async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
for (let i = 0; i < 60; i++) {
  try { await api("GET", "/api/maps"); break; } catch { await sleep(1000); }
}
mkdirSync(OUT, { recursive: true });
const tag = Date.now().toString(36);
const dir = await api("GET", "/api/directory");
const owning = (dir.users.find((u) => u.id === "admin.sys") ?? dir.users[0]).org_path;
const nid = (k) => `m8-${tag}-${k}`;
async function createMap(name) {
  const map = await api("POST", "/api/maps", { name, owning_department: owning, visibility: "private" });
  const detail = await api("GET", `/api/maps/${map.id}`);
  const draft = detail.versions[0];
  await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
  return { map, draft };
}

// ── 장면 1: 병렬 출구 + 분기
const p = await createMap(L(`주문 처리 ${tag}`, `Order handling ${tag}`));
await api("PUT", `/api/versions/${p.draft.id}/graph`, {
  nodes: [
    { id: nid("s"), title: "", node_type: "start", pos_x: 0, pos_y: 160 },
    { id: nid("a"), title: L("주문 접수", "Receive order"), node_type: "process", pos_x: 170, pos_y: 160, assignee_role: L("영업 담당", "Sales rep") },
    { id: nid("b"), title: L("계약 체결", "Sign contract"), node_type: "process", pos_x: 400, pos_y: 160, assignee_role: L("영업 팀장", "Sales lead"), parallel_outputs: ["__primary__"] },
    { id: nid("c"), title: L("구매 발주", "Place purchase order"), node_type: "process", pos_x: 660, pos_y: 60, assignee_role: L("구매 담당", "Buyer") },
    { id: nid("d"), title: L("회계 등록", "Book in accounting"), node_type: "process", pos_x: 660, pos_y: 260, assignee_role: L("회계 담당", "Accountant") },
    { id: nid("q"), title: L("검수 통과?", "Inspection passed?"), node_type: "decision", pos_x: 920, pos_y: 140 },
    { id: nid("r"), title: L("반품 처리", "Return goods"), node_type: "process", pos_x: 1130, pos_y: 260 },
    { id: nid("e"), title: "", node_type: "end", pos_x: 1380, pos_y: 160, is_primary_end: true },
  ],
  edges: [
    { id: nid("e1"), source_node_id: nid("s"), target_node_id: nid("a") },
    { id: nid("e2"), source_node_id: nid("a"), target_node_id: nid("b") },
    { id: nid("e3"), source_node_id: nid("b"), target_node_id: nid("c") },
    { id: nid("e4"), source_node_id: nid("b"), target_node_id: nid("d") },
    { id: nid("e5"), source_node_id: nid("c"), target_node_id: nid("q") },
    { id: nid("e6"), source_node_id: nid("d"), target_node_id: nid("q") },
    { id: nid("e7"), source_node_id: nid("q"), target_node_id: nid("e"), label: "Yes" },
    { id: nid("e8"), source_node_id: nid("q"), target_node_id: nid("r"), label: "No" },
    { id: nid("e9"), source_node_id: nid("r"), target_node_id: nid("e") },
  ],
  groups: [],
});

// ── 장면 2: 끝 3개 링크 맵 + 호스트
const target = await createMap(L(`견적 검토 ${tag}`, `Quote review ${tag}`));
await api("PUT", `/api/versions/${target.draft.id}/graph`, {
  nodes: [
    { id: nid("t-s"), title: "", node_type: "start", pos_x: 0, pos_y: 160 },
    { id: nid("t-a"), title: L("검토 수행", "Review"), node_type: "process", pos_x: 250, pos_y: 160 },
    { id: nid("t-ok"), title: L("승인", "Approved"), node_type: "end", pos_x: 600, pos_y: 20, is_primary_end: true },
    { id: nid("t-no"), title: L("반려", "Rejected"), node_type: "end", pos_x: 600, pos_y: 160 },
    { id: nid("t-hold"), title: L("보류", "On hold"), node_type: "end", pos_x: 600, pos_y: 300 },
  ],
  edges: [
    { id: nid("t-e0"), source_node_id: nid("t-s"), target_node_id: nid("t-a") },
    { id: nid("t-e1"), source_node_id: nid("t-a"), target_node_id: nid("t-ok") },
    { id: nid("t-e2"), source_node_id: nid("t-a"), target_node_id: nid("t-no") },
    { id: nid("t-e3"), source_node_id: nid("t-a"), target_node_id: nid("t-hold") },
  ],
  groups: [],
});
await api("PUT", `/api/maps/${target.map.id}/approvers`, { user_ids: ["admin.sys"] });
await api("POST", `/api/versions/${target.draft.id}/submit`, {});
await api("POST", `/api/versions/${target.draft.id}/approve`, {});
await api("POST", `/api/versions/${target.draft.id}/publish`, {});
await api("PUT", `/api/maps/${target.map.id}/subprocess-designation`, { department: String(owning).split(/\s*>\s*/).pop() || "QA" });
const host = await createMap(L(`견적 처리 ${tag}`, `Quote handling ${tag}`));
const SP = nid("sp");
await api("PUT", `/api/versions/${host.draft.id}/graph`, {
  nodes: [
    { id: nid("h-s"), title: "", node_type: "start", pos_x: 0, pos_y: 160 },
    { id: nid("h-a"), title: L("견적 요청 접수", "Receive quote request"), node_type: "process", pos_x: 170, pos_y: 160 },
    { id: SP, title: L("견적 검토", "Quote review"), node_type: "subprocess", pos_x: 420, pos_y: 160, linked_map_id: target.map.id, follow_latest: true },
    { id: nid("h-d"), title: L("견적 발송", "Send quote"), node_type: "process", pos_x: 720, pos_y: 40 },
    { id: nid("h-r"), title: L("견적 재작성", "Rework quote"), node_type: "process", pos_x: 720, pos_y: 200 },
    { id: nid("h-n"), title: L("고객 확인 요청", "Ask customer"), node_type: "process", pos_x: 420, pos_y: 360 },
    { id: nid("h-e"), title: "", node_type: "end", pos_x: 980, pos_y: 40, is_primary_end: true },
  ],
  edges: [
    { id: nid("h-e1"), source_node_id: nid("h-s"), target_node_id: nid("h-a") },
    { id: nid("h-e2"), source_node_id: nid("h-a"), target_node_id: SP, target_handle: "in" },
    { id: nid("h-e3"), source_node_id: SP, target_node_id: nid("h-d"), source_handle: "__primary__" },
    { id: nid("h-e4"), source_node_id: SP, target_node_id: nid("h-r"), source_handle: L("반려", "Rejected") },
    { id: nid("h-e5"), source_node_id: nid("h-d"), target_node_id: nid("h-e") },
  ],
  groups: [],
});

// ── 브라우저
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1456, height: 837 }, deviceScaleFactor: 2 });
await ctx.addInitScript((lang) => { localStorage.setItem("bpm.devUser", "admin.sys"); localStorage.setItem("bpm.lang", lang); }, LANG);
const page = await ctx.newPage();
async function openEditor(mapId, versionId) {
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120000 });
  await sleep(2500);
  await page.locator('button[title^="화면 맞춤"], button[title^="Fit to view"], [aria-label^="Fit to view"], [aria-label^="화면 맞춤"]').first().click().catch(() => undefined);
  await sleep(800);
}
const nodeBox = (id) => page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
// 화면 맞춤 뒤 배율이 작으면 캔버스 중앙에서 Control+휠로 target 배율까지 확대(에디터 줌은 Control 활성)
async function zoomTo(target, at) {
  for (let i = 0; i < 30; i++) {
    const scale = await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".react-flow__viewport")).transform).a);
    if (scale >= target) return;
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -60);
    await page.keyboard.up("Control");
    await sleep(150);
  }
}
// 노드들(+출구 목록) 범위에 여백을 둔 영역 — 슬라이드 이미지가 작아도 노드가 읽히게
async function focusClip(pad = 48) {
  return page.evaluate((padding) => {
    const canvas = document.querySelector(".react-flow").getBoundingClientRect();
    const els = [...document.querySelectorAll(".react-flow__node, [data-id='edge-end-modal'], [data-id='node-parallel-badge']")];
    const rects = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    let x1 = Math.max(canvas.left, Math.min(...rects.map((r) => r.left)) - padding);
    let x2 = Math.min(canvas.right, Math.max(...rects.map((r) => r.right)) + padding);
    let y1 = Math.max(canvas.top, Math.min(...rects.map((r) => r.top)) - padding);
    let y2 = Math.min(canvas.bottom, Math.max(...rects.map((r) => r.bottom)) + padding);
    // 슬라이드 프레임에 맞게 최소 16:10 — 납작하면 세로를 캔버스 안에서 넓힌다
    const wantH = (x2 - x1) * 0.62;
    if (y2 - y1 < wantH) {
      const grow = (wantH - (y2 - y1)) / 2;
      y1 = Math.max(canvas.top, y1 - grow);
      y2 = Math.min(canvas.bottom, y2 + grow);
    }
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }, pad);
}
async function canvasCenter() {
  // 노드 전체 bbox 중심 — 휠 확대 기준점이 그래프 중심이어야 확대 뒤에도 그래프가 화면 안에 남는다
  return page.evaluate(() => {
    const rects = [...document.querySelectorAll(".react-flow__node")].map((n) => n.getBoundingClientRect());
    const x1 = Math.min(...rects.map((r) => r.left)), x2 = Math.max(...rects.map((r) => r.right));
    const y1 = Math.min(...rects.map((r) => r.top)), y2 = Math.max(...rects.map((r) => r.bottom));
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  });
}

// 장면 1 캡처: 계약 체결 호버(배지) + 펄스가 보이는 순간
await openEditor(p.map.id, p.draft.id);
await zoomTo(0.72, await canvasCenter());
await sleep(500);
const bBox = await nodeBox(nid("b"));
await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
for (let i = 0; i < 80; i++) {
  const ok = await page.evaluate(() => {
    const ops = [...document.querySelectorAll(".bpm-edge-pulse")].map((c) => Number(getComputedStyle(c).opacity));
    return ops.filter((o) => o > 0.35).length >= 3;
  });
  if (ok) break;
  await sleep(100);
}
await page.screenshot({ path: `${OUT}/${LANG}-parallel.jpg`, type: "jpeg", quality: 82, clip: await focusClip() });

// 장면 2 캡처: SP 우측 출구에서 끌어 고객 확인 요청에 놓아 출구 목록이 열린 상태
await openEditor(host.map.id, host.draft.id);
await zoomTo(0.85, await canvasCenter());
await sleep(500);
await page.mouse.move(5, 5);
const exit = await page.locator(`.react-flow__node[data-id="${SP}"] .react-flow__handle[data-handleid="__primary__"]`).boundingBox();
const nBox = await nodeBox(nid("h-n"));
await page.mouse.move(exit.x + exit.width / 2, exit.y + exit.height / 2);
await page.mouse.down();
await page.mouse.move(nBox.x + nBox.width / 2, nBox.y + nBox.height / 2, { steps: 14 });
await page.mouse.up();
await sleep(800);
await page.screenshot({ path: `${OUT}/${LANG}-sp-exits.jpg`, type: "jpeg", quality: 82, clip: await focusClip() });
await browser.close();
console.log(`captured ${LANG}: parallel map ${p.map.id}, host ${host.map.id}`);

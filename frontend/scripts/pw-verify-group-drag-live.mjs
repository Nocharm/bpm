// 영역(그룹) 멤버 드래그 동결 회귀 — 영역 멤버도 프레임마다 nodes를 커밋하지 않는 동결(#R2) 경로를 탄다.
// 확인: ① 멤버를 끄는 중에 영역 박스가 라이브로 늘어난다 ② 드롭 뒤에도 유지·저장된다
//       ③ 비멤버를 영역 빈 곳으로 끌면 합류 강조(group-target)가 뜨고 놓으면 합류한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-group-drag-live.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const H = { "X-Dev-User": "admin.sys", "Content-Type": "application/json" };

async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

// 시드: 영역 G = {A(0,0), B(0,300)}, 비멤버 C(500,150) — A·B 사이 세로 틈이 영역 빈 곳
const tag = Date.now().toString(36);
const id = (k) => `gdl-${tag}-${k}`;
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === "admin.sys") ?? directory.users[0])?.org_path;
const map = await api("POST", "/api/maps", { name: `Group drag live ${tag}`, owning_department: owning, visibility: "private" });
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
await api("PUT", `/api/versions/${draft.id}/graph`, {
  nodes: [
    { id: id("start"), title: "", node_type: "start", pos_x: -300, pos_y: 0 },
    { id: id("a"), title: "Member A", node_type: "process", pos_x: 0, pos_y: 0, group_ids: [id("g")] },
    { id: id("b"), title: "Member B", node_type: "process", pos_x: 0, pos_y: 300, group_ids: [id("g")] },
    { id: id("c"), title: "Outsider C", node_type: "process", pos_x: 500, pos_y: 150 },
    { id: id("end"), title: "", node_type: "end", pos_x: 800, pos_y: 150 },
  ],
  edges: [
    { id: id("e1"), source_node_id: id("start"), target_node_id: id("a"), label: "" },
    { id: id("e2"), source_node_id: id("a"), target_node_id: id("b"), label: "" },
    { id: id("e3"), source_node_id: id("b"), target_node_id: id("c"), label: "" },
    { id: id("e4"), source_node_id: id("c"), target_node_id: id("end"), label: "" },
  ],
  groups: [{ id: id("g"), label: "Region G", color: "" }],
});

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "en");
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`.react-flow__node[data-id="${id("a")}"]`, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  const fit = page.locator('button[title^="Fit"]').first();
  if (await fit.count()) {
    await fit.click();
    await page.waitForTimeout(800);
  }

  const boxRect = () =>
    page.evaluate(() => {
      const svg = document.querySelector("path.bpm-group-fill")?.closest("svg");
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, targeted: svg.classList.contains("group-target") };
    });
  const nodeRect = (nid) =>
    page.evaluate((nid) => {
      const r = document.querySelector(`.react-flow__node[data-id="${nid}"]`).getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, nid);
  // 자동 저장은 디바운스 뒤라 조건이 맞을 때까지 최대 10초 폴링
  const waitGraphNode = async (nid, ok) => {
    let node = null;
    for (let i = 0; i < 20; i += 1) {
      const g = await api("GET", `/api/versions/${draft.id}/graph`);
      node = g.nodes.find((n) => n.id === nid);
      if (ok(node)) break;
      await page.waitForTimeout(500);
    }
    return node;
  };

  // ① 멤버 B를 오른쪽으로 끌면 영역 박스가 드래그 중에 늘어난다
  const before = await boxRect();
  check("region box renders", before !== null, JSON.stringify(before));
  const b = await nodeRect(id("b"));
  const grabB = { x: b.x + b.w / 2, y: b.y + 10 };
  await page.mouse.move(grabB.x, grabB.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i += 1) {
    await page.mouse.move(grabB.x + i * 8, grabB.y);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  const mid = await boxRect();
  check("region box grows live while a member is dragged", mid.w > before.w + 150, `before w=${before.w.toFixed(0)} mid w=${mid.w.toFixed(0)}`);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const after = await boxRect();
  check("region box keeps the new extent after drop", Math.abs(after.w - mid.w) < 12, `mid w=${mid.w.toFixed(0)} after w=${after.w.toFixed(0)}`);
  const savedB = await waitGraphNode(id("b"), (n) => n.pos_x > 100);
  check("dragged member position saved", savedB.pos_x > 100, `pos_x=${savedB.pos_x}`);

  // ③ 비멤버 C를 A·B 사이 영역 빈 곳으로 끌면 합류 강조 → 놓으면 합류
  const a = await nodeRect(id("a"));
  const c = await nodeRect(id("c"));
  const grabC = { x: c.x + c.w / 2, y: c.y + 10 };
  const bNow = await nodeRect(id("b"));
  const target = { x: a.x + a.w / 2, y: (a.y + bNow.y) / 2 + 10 }; // A·B 세로 사이(노드와 겹치지 않는 영역 빈 곳)
  await page.mouse.move(grabC.x, grabC.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i += 1) {
    await page.mouse.move(grabC.x + ((target.x - grabC.x) * i) / 30, grabC.y + ((target.y - grabC.y) * i) / 30);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  const hover = await boxRect();
  check("join highlight (group-target) while hovering the region", hover.targeted === true);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const savedC = await waitGraphNode(id("c"), (n) => (n.group_ids ?? []).includes(id("g")));
  check("outsider joins the region on drop", (savedC.group_ids ?? []).includes(id("g")), JSON.stringify(savedC.group_ids));
  const end = await boxRect();
  check("join highlight clears after drop", end.targeted === false);
} finally {
  await browser.close();
  if (process.env.KEEP !== "1") await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);

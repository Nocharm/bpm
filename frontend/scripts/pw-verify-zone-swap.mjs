// 드롭존 swap 실행 검증 — 자체 클린 맵(4노드)에서 노드를 겹쳐 dwell로 링을 띄우고 swap 섹터
// (하단 90°, 반경 113px 줌무관)에서 릴리스 → 드래그 노드=대상 자리, 대상=드래그 "시작" 자리(aStart 계약).
// 누적 상태가 있는 맵에선 링 조준이 뷰포트/패널 겹침으로 flaky — 반드시 이 클린 맵 구성 유지.
// 실행 (frontend/): BASE_URL=http://localhost:3000 node scripts/pw-verify-zone-swap.mjs
// 전제: backend + frontend 기동, playwright-core(--no-save), 시스템 Chrome.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();

const api = (path, { method = "GET", body } = {}) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body },
  );

let mapId = null;
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const dept = (await api("/directory")).departments[0].id;
  const created = await api("/maps", {
    method: "POST",
    body: { name: `R2-Zone ${Date.now()}`, description: "", visibility: "public", owning_department: dept },
  });
  mapId = created.id;
  const versionId = created.versions[0].id;
  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: true } });
  const P = `r2z${Date.now().toString(36)}`;
  await api(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        { id: `${P}-s`, node_type: "start", title: "Start", pos_x: 0, pos_y: 0 },
        { id: `${P}-e`, node_type: "end", title: "End", pos_x: 900, pos_y: 0 },
        { id: `${P}-t1`, node_type: "process", title: "Zone Src", pos_x: 100, pos_y: 300 },
        { id: `${P}-t2`, node_type: "process", title: "Zone Dst", pos_x: 500, pos_y: 300 },
      ],
      edges: [],
    },
  });
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(`.react-flow__node[data-id="${P}-t1"]`, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const box1 = await page.locator(`.react-flow__node[data-id="${P}-t1"]`).boundingBox();
  const box2 = await page.locator(`.react-flow__node[data-id="${P}-t2"]`).boundingBox();
  const src = { x: box1.x + box1.width / 2, y: box1.y + box1.height / 2 };
  const dst = { x: box2.x + box2.width / 2, y: box2.y + box2.height / 2 };
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  await page.mouse.move(dst.x, dst.y, { steps: 8 });
  await page.waitForTimeout(700);
  await page.mouse.move(dst.x + 1, dst.y + 113, { steps: 2 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: process.env.SHOT ?? "/tmp/zone-probe.png" });
  const pos = (id) =>
    page.evaluate((nid) => {
      const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
      const m = el?.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px/);
      return m ? { x: +m[1], y: +m[2] } : null;
    }, id);
  const p1 = await pos(`${P}-t1`);
  const p2 = await pos(`${P}-t2`);
  await page.mouse.up();
  await page.waitForTimeout(2500);
  const q1 = await pos(`${P}-t1`);
  const q2 = await pos(`${P}-t2`);
  console.log(JSON.stringify({ before: { p1, p2 }, after: { q1, q2 } }));
  // 교환 판정 — 대상(t2)은 드래그 시작 좌표(시드 100,300)로 가야 한다(aStart 계약).
  const swapped =
    Math.abs(q1.x - p2.x) <= 2 && Math.abs(q1.y - p2.y) <= 2 &&
    Math.abs(q2.x - 100) <= 2 && Math.abs(q2.y - 300) <= 2;
  console.log(swapped ? "PASS zone-swap" : "FAIL zone-swap");
  process.exitCode = swapped ? 0 : 1;
} catch (e) {
  console.error("FATAL", e.message);
  process.exitCode = 1;
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}
await browser.close();

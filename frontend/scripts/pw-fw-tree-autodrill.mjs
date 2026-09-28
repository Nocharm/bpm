// 관리 트리 자동 드릴인 — 자식이 하나뿐인 노드를 펼치면 그 사슬(L2→L3→L4)이 한 번에 열리고, 갈래가 둘인 곳에서 멈춘다(2026-09-28).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-tree-autodrill.mjs
// 전제: backend + frontend 기동(AI 불필요).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };
async function post(path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}

// L1 > L2 > L3 > L4(둘: a, b) > a 아래 L5 — L1을 펼치면 L2·L3까지 자동으로 열리고 L4는 갈래라 멈춘다
const tag = Date.now().toString(36);
const l1 = await post("/api/categories", { name: `drill-L1-${tag}`, parent_id: null });
const l2 = await post("/api/categories", { name: `drill-L2-${tag}`, parent_id: l1.id });
const l3 = await post("/api/categories", { name: `drill-L3-${tag}`, parent_id: l2.id });
const l4a = await post("/api/categories", { name: `drill-L4a-${tag}`, parent_id: l3.id });
const l4b = await post("/api/categories", { name: `drill-L4b-${tag}`, parent_id: l3.id });
const l5 = await post("/api/categories", { name: `drill-L5-${tag}`, parent_id: l4a.id });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "ko"); }, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-tree"]').waitFor();
const row = (id) => page.locator(`[data-id="framework-admin-node-${id}"]`);
await row(l1.id).scrollIntoViewIfNeeded();
// 행 자체를 눌러 펼친다(토글은 행 클릭)
await row(l1.id).click();
const l3Row = row(l3.id);
const chainOpened = await l3Row.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
check("opening L1 auto-drills through the single-child L2 to L3", chainOpened);
await page.waitForTimeout(500);
check("L4 siblings are shown (L3 auto-opened too)", (await row(l4a.id).count()) === 1 && (await row(l4b.id).count()) === 1);
check("the fork at L4 stops the drill (L5 not opened)", (await row(l5.id).count()) === 0);
await page.screenshot({ path: "../docs/qa/screens/fw-tree-autodrill.png" });
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);

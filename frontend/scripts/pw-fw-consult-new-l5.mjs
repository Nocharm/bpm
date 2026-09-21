// AI L5 캠페인 "새 L5" 모드 검증 — 관리자 탭 진입 카드에서 계단식 피커로 L4를 고르고 새 L5 이름을 넣어 세션을 연다.
// 아울러 관리 트리 검색(히트 클릭=체인 펼침+강조)도 한 번 밟고 캡처한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-new-l5.mjs
// 전제: backend(AI_ENABLED=true) + frontend 기동(가짜 AI는 세션 생성에는 불필요).
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

const tag = Date.now().toString(36);
let parent = null;
let l4 = null;
for (let level = 1; level <= 4; level++) {
  l4 = await post("/api/categories", { name: `newl5-L${level}-${tag}`, parent_id: parent });
  parent = l4.id;
}
const l4Name = l4.name;
const newName = `newl5-L5-${tag}`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="fw-consult-entry"]').waitFor();

// 관리 트리 검색 → 히트 클릭 → 체인 펼침 + 해당 행 존재
await page.locator('[data-id="framework-admin-search"]').fill(l4Name);
await page.locator(`[data-id="framework-admin-search-result-${l4.id}"]`).click();
await page.locator(`[data-id="framework-admin-node-${l4.id}"]`).waitFor({ timeout: 10000 });
check("admin tree search reveals the L4 row", true);
await page.screenshot({ path: "../docs/qa/screens/framework-admin-tree.png" }).catch(() => undefined);

// 새 L5 모드
await page.locator('[data-id="fw-consult-mode-new"]').click();
await page.locator('[data-id="fw-consult-picker-search"]').fill(l4Name);
await page.locator(`[data-id="fw-consult-picker-result-${l4.id}"]`).click();
await page.locator('[data-id="fw-consult-pick-name"]', { hasText: l4Name }).waitFor({ timeout: 10000 });
check("L4 parent picked", true);
const startBtn = page.locator('[data-id="fw-consult-start"]');
check("start disabled until a name is typed", await startBtn.isDisabled());
await page.locator('[data-id="fw-consult-new-name"]').fill(newName);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-entry-new.png" }).catch(() => undefined);
await startBtn.click();
await page.waitForURL(/\/framework\/consult\/\d+/, { timeout: 20000 });
const sessionId = Number(page.url().split("/").pop());
const session = await (await fetch(`${BACKEND}/api/framework-interviews/${sessionId}`, { headers: H })).json();
check("session opened on the newly created L5", session.category_name === newName, session.category_name);
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

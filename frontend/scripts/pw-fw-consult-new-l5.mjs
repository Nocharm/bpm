// AI L5 캠페인 "새 L5" 모드 검증 — 관리 트리 검색으로 L4 행을 고르고(=선택) 우측 상세 패널에서
// 새 L5 이름을 넣어 세션을 연다. 검색 히트 클릭(체인 펼침+선택)도 같이 밟고 캡처한다.
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
await page.locator('[data-id="framework-admin-detail"]').waitFor();
// 선택이 없으면 상세 패널의 액션은 비활성이고 레벨 타일 자리는 안내 문구만
check("level actions show the empty hint with no row selected", await page.locator('[data-id="fw-level-empty"]').isVisible());
check("rename action disabled with no row selected", await page.locator('[data-id="framework-admin-action-rename"]').isDisabled());

// 관리 트리 검색 → 히트 클릭 → 체인 펼침 + 그 행이 선택(aria-current)
await page.locator('[data-id="framework-admin-search"]').fill(l4Name);
await page.locator(`[data-id="framework-admin-search-result-${l4.id}"]`).click();
await page.locator(`[data-id="framework-admin-node-${l4.id}"][aria-current="true"]`).waitFor({ timeout: 10000 });
check("admin tree search reveals and selects the L4 row", true);
await page.screenshot({ path: "../docs/qa/screens/framework-admin-tree.png" }).catch(() => undefined);

// L4 선택 = "L5 만들고 AI로 시작" 타일만 보이고, L5용 AI로 작업 타일은 없다
const createTile = page.locator('[data-id="fw-level-create-l5"]');
await createTile.waitFor({ timeout: 10000 });
check("work-with-AI tile absent while an L4 is selected", (await page.locator('[data-id="fw-level-start"]').count()) === 0);
await createTile.click();
const confirmBtn = page.locator('[data-id="prompt-dialog-confirm"]');
check("confirm disabled until a name is typed", await confirmBtn.isDisabled());
await page.locator('[data-id="prompt-dialog-input"]').fill(newName);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-entry-new.png" }).catch(() => undefined);
await confirmBtn.click();
await page.waitForURL(/\/framework\/consult\/\d+/, { timeout: 20000 });
const sessionId = Number(page.url().split("/").pop());
const session = await (await fetch(`${BACKEND}/api/framework-interviews/${sessionId}`, { headers: H })).json();
check("session opened on the newly created L5", session.category_name === newName, session.category_name);
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

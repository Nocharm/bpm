// 관리 패널 레벨별 타일 — L1~3 하위 타일 드릴(트리 싱크), L4 새 L5 모달+중복 차단, L5 AI로 작업/이어서, 세션 배지 롤업,
// 인터뷰 JSON 섹션 분리 + 프롬프트 복사 토스트.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-level-actions.mjs
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

// L1 > L2 > L3 > L4 > L5(기존, 세션 1개) + L4 아래 형제 L5 "Taken"
const tag = Date.now().toString(36);
const chain = [];
let parent = null;
for (let level = 1; level <= 4; level++) {
  const n = await post("/api/categories", { name: `lvl-L${level}-${tag}`, parent_id: parent });
  chain.push(n);
  parent = n.id;
}
const l4 = chain[3];
const existingL5 = await post("/api/categories", { name: `lvl-L5-${tag}`, parent_id: l4.id });
await post("/api/categories", { name: `Taken-${tag}`, parent_id: l4.id });
await post("/api/framework-interviews", { category_id: existingL5.id, lang: "en" });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// 헤드리스 Chrome은 클립보드 쓰기를 기본 거부한다 — 복사 성공 경로(토스트)를 밟으려면 권한을 준다
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-detail"]').waitFor();
check("no selection shows the empty hint", await page.locator('[data-id="fw-level-empty"]').isVisible());

// L1 선택(검색 히트) → 하위 타일에 L2가 보이고 배지 1(서브트리 세션 롤업)
await page.locator('[data-id="framework-admin-search"]').fill(chain[0].name);
await page.locator(`[data-id="framework-admin-search-result-${chain[0].id}"]`).click();
const l2Tile = page.locator(`[data-id="fw-level-tile-${chain[1].id}"]`);
await l2Tile.waitFor({ timeout: 10000 });
check("L1 selection lists L2 child tiles", true);
check("subtree session badge rolls up to the L2 tile", (await page.locator(`[data-id="fw-level-tile-badge-${chain[1].id}"]`).innerText()) === "1");
await page.screenshot({ path: "../docs/qa/screens/fw-level-tiles.png" });

// 타일 클릭 → 선택 이동 + 좌측 트리 aria-current 싱크
await l2Tile.click();
await page.locator(`[data-id="framework-admin-node-${chain[1].id}"][aria-current="true"]`).waitFor({ timeout: 10000 });
check("tile click moves selection and syncs the tree", true);
await page.locator(`[data-id="fw-level-tile-${chain[2].id}"]`).click();
await page.locator(`[data-id="fw-level-tile-${l4.id}"]`).click();

// L4 → 새 L5 타일 → 모달 → 중복 이름 차단 → 정상 이름으로 세션 생성
const createTile = page.locator('[data-id="fw-level-create-l5"]');
await createTile.waitFor({ timeout: 10000 });
await createTile.click();
const input = page.locator('[data-id="prompt-dialog-input"]');
await input.fill(`Taken-${tag}`);
check("duplicate sibling name shows the inline error", await page.getByText("already exists here").isVisible());
check("confirm is disabled while the name is a duplicate", await page.locator('[data-id="prompt-dialog-confirm"]').isDisabled());
await page.screenshot({ path: "../docs/qa/screens/fw-level-create-l5.png" });
await input.fill(`fresh-${tag}`);
await page.locator('[data-id="prompt-dialog-confirm"]').click();
await page.waitForURL(/\/framework\/consult\/\d+/, { timeout: 20000 });
check("fresh name creates the L5 and opens the campaign", true);

// 뒤로 → 기존 L5 선택 → "이어서" 타일
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-search"]').fill(existingL5.name);
await page.locator(`[data-id="framework-admin-search-result-${existingL5.id}"]`).click();
await page.locator('[data-id="fw-level-resume"]').waitFor({ timeout: 10000 });
check("L5 with a live session shows the resume tile", true);
await page.screenshot({ path: "../docs/qa/screens/framework-admin-selected.png" });

// 임포트 섹션 + 프롬프트 복사 토스트
check("interview import section is its own card", await page.locator('[data-id="interview-import-section"] [data-id="interview-import-pick"]').isVisible());
await page.locator('[data-id="interview-import-section"] [data-id="fw-consult-copy-prompt"]').click();
// isVisible()은 기다리지 않는다 — 토스트는 다음 틱에 마운트되므로 waitFor로 본다
check("prompt copy raises a toast", await page.getByText("copied to clipboard").waitFor({ timeout: 3000 }).then(() => true).catch(() => false));

await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);

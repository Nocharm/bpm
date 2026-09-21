// Categories & import 레이아웃 검증 + 캡처 3장 — (1) 휴지 상태(선택 없음, 액션 전부 비활성)
// (2) L5 선택(정보 줄·활성 버튼) (3) 임포트 버튼 → 파일 스트립 → dry run 리포트.
// 2026-09-22 설계의 좌 트리 : 우 상세 패널 구조를 밟는다(아코디언 섹션 3종은 폐기).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-admin-layout-shot.mjs
// 전제: backend + frontend 기동(가짜 AI 불필요). 샘플: docs/samples/consultant-interview-sample/utility-l5.json(멱등).
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.resolve(here, "../../docs/samples/consultant-interview-sample/utility-l5.json");

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

async function post(pathname, body) {
  const r = await fetch(`${BACKEND}${pathname}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${pathname} ${r.status} ${await r.text()}`);
  return r.json();
}

// 선택 상태 캡처 대상 L5 — 시드된 체계가 있으면 그 중 하나(맵·관리자가 붙어 정보 줄이 살아 있다),
// 빈 DB면 자급 체인을 만들어 L5 한 줄을 보장한다.
const all = await (await fetch(`${BACKEND}/api/categories/all`, { headers: H })).json();
let l5 = all.find((c) => c.level === 5) ?? null;
if (!l5) {
  const tag = Date.now().toString(36);
  let parent = null;
  for (let level = 1; level <= 5; level++) {
    l5 = await post("/api/categories", { name: `shot-L${level}-${tag}`, parent_id: parent });
    parent = l5.id;
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript((user) => {
  window.localStorage.setItem("bpm.devUser", user);
  window.localStorage.setItem("bpm.lang", "en");
}, ADMIN);
const page = await ctx.newPage();

// ── 1) 휴지 상태 — 선택 없음, 안내문 + 액션 6종 비활성 ──────────────────────
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-detail"]').waitFor({ timeout: 15000 });
await page.locator('[data-id="framework-admin-tree"] li').first().waitFor({ timeout: 15000 });
await page.locator('[data-id="framework-admin-detail-empty"]').waitFor();
const ACTIONS = ["add", "rename", "dept", "perms", "move", "delete"];
const restDisabled = await Promise.all(
  ACTIONS.map((key) => page.locator(`[data-id="framework-admin-action-${key}"]`).isDisabled()),
);
check("rest: every detail action is disabled", restDisabled.every(Boolean), restDisabled.join(","));
check("rest: fill-existing disabled", await page.locator('[data-id="fw-consult-start"]').isDisabled());
await page.screenshot({ path: "../docs/qa/screens/framework-admin-rest.png" });

// ── 2) L5 선택 — 검색 히트 클릭으로 체인 펼침 + 선택 ────────────────────────
await page.locator('[data-id="framework-admin-search"]').fill(l5.name);
await page.locator(`[data-id="framework-admin-search-result-${l5.id}"]`).click();
await page.locator(`[data-id="framework-admin-node-${l5.id}"][aria-current="true"]`).waitFor({ timeout: 15000 });
await page.locator('[data-id="framework-admin-detail-info"]').waitFor();
check("selected: detail head + info row rendered", true);
check("selected: rename action enabled", !(await page.locator('[data-id="framework-admin-action-rename"]').isDisabled()));
check("selected: add child disabled at L5 (max depth)", await page.locator('[data-id="framework-admin-action-add"]').isDisabled());
check("selected: fill-existing enabled", !(await page.locator('[data-id="fw-consult-start"]').isDisabled()));
await page.waitForTimeout(400);
await page.screenshot({ path: "../docs/qa/screens/framework-admin-selected.png" });

// ── 3) 임포트 — 버튼이 파일 탐색기를 열고, 고른 파일은 전폭 스트립에 필로 ────
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser", { timeout: 10000 }),
  page.locator('[data-id="interview-import-pick"]').click(),
]);
await chooser.setFiles(sample);
await page.locator('[data-id="interview-import-strip"]').waitFor({ timeout: 10000 });
await page.locator('[data-id="interview-import-file-0"]').waitFor();
const countText = (await page.locator('[data-id="interview-import-file-count"]').textContent()) ?? "";
check("import strip shows the picked file and its count", countText.includes("1"), countText.trim());
await page.locator('[data-id="interview-import-dryrun"]').click();
await page.locator('[data-id="interview-import-report"]').first().waitFor({ timeout: 30000 });
check("dry run report rendered under the strip", true);
await page.locator('[data-id="interview-import-strip"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: "../docs/qa/screens/framework-import-section.png" });

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

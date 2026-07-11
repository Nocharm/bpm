// 운영 대시보드 검증 — 풀블리드 교체·스냅샷/시계열 분리·커버리지·권한 열람 게이팅.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-verify-dashboard.mjs
// 전제: backend(:8000, DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys) + 프론트(:3000).
// 재실행 전제: dashboard_permissions·coverage_depts 행을 누적 시드/추가하므로(check 5/6 자체는
// 누적에 강인하지만 DB가 지저분해진다) 재실행 전 reset_db 권장.
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 뷰어 권한 시드 — 앱 모델 경유(sqlite raw INSERT는 tz-aware DateTime 비교 함정).
execSync(
  `cd ../backend && .venv/bin/python -c "
import asyncio
from app.db import SessionLocal
from app.models import DashboardPermission, Employee

async def seed():
    async with SessionLocal() as s:
        if await s.get(Employee, 'dash.viewer') is None:
            s.add(Employee(login_id='dash.viewer', name='Dash Viewer', source='local', active=True))
        if await s.get(Employee, 'dash.nobody') is None:
            s.add(Employee(login_id='dash.nobody', name='Dash Nobody', source='local', active=True))
        s.add(DashboardPermission(principal_type='user', principal_id='dash.viewer', granted_by='admin.sys'))
        await s.commit()

asyncio.run(seed())
"`,
  { stdio: "inherit" },
);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function openDashboard(devUser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
  }, devUser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

// ── sysadmin 시나리오 (check 1~5) ───────────────────────────────
const { ctx, page } = await openDashboard("admin.sys");

const dashboardTab = page.getByRole("button", { name: /^(Dashboard|대시보드)$/ });
await dashboardTab.waitFor({ state: "visible", timeout: 8000 });

// 스냅샷·초기 시계열(둘 다 마운트 즉시 발화하는 독립 fetch) 응답을 모두 기다려야
// "—" 자리표시나 0개 막대(로딩 중)를 실값으로 오탐하지 않는다.
const summaryDone = page.waitForResponse((r) => r.url().includes("/dashboard/summary"), {
  timeout: 8000,
});
const initialSeriesDone = page.waitForResponse((r) => r.url().includes("/dashboard/timeseries"), {
  timeout: 8000,
});
await dashboardTab.click();
await Promise.all([summaryDone.catch(() => undefined), initialSeriesDone.catch(() => undefined)]);
// 네트워크 응답 도착과 React 커밋(state→DOM) 사이엔 한 틱 간격이 있다 — 응답만 기다리고
// 곧장 읽으면 "—" 자리표시를 실값으로 오탐(정확히는 실값을 자리표시로 오탐)할 수 있다.
await page.waitForTimeout(300);

const root = page.locator('[data-id="dashboard"]');
await root.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
// 풀블리드 교체 = 설정 탭 레일(제목 "Settings")이 더는 없다
const railGone = (await page.getByRole("heading", { name: /^(Settings|설정)$/ }).count()) === 0;
check("1 full-bleed replaces settings rail", (await root.isVisible().catch(() => false)) && railGone);

const cards = page.locator('[data-id="dashboard-stat-card"]');
const cardCount = await cards.count();
const railText = await page.locator('[data-id="dashboard"] aside').first().innerText();
check(
  "2 summary stats rendered (not placeholder)",
  cardCount >= 4 && !railText.includes("—"),
  `${cardCount} cards`,
);
const statsBefore = railText;

const bars = page.locator('[data-id="dashboard-bar-chart"] > div');
check("3 bar count matches 7d preset", (await bars.count()) === 7, `${await bars.count()} bars`);

// 기간 1개월 → 막대 30개, 좌 레일 스탯은 불변(스냅샷은 필터 영향권 밖 — 핵심 불변식)
const seriesDone = page.waitForResponse((r) => r.url().includes("/dashboard/timeseries"), {
  timeout: 8000,
});
await page.getByRole("button", { name: /^(1 month|1개월)$/ }).click();
await seriesDone.catch(() => undefined);
await page.waitForTimeout(300); // 리렌더 안정화
const barsAfter = await bars.count();
const statsAfter = await page.locator('[data-id="dashboard"] aside').first().innerText();
check("4 period change refetches series only", barsAfter === 30 && statsAfter === statsBefore, `${barsAfter} bars`);

// Coverage 탭에서 부서 추가 → 커버리지 섹션에 행 등장.
// SearchSelect(addMode=false)는 트리거 버튼만 사이드바 안에 있고, 열린 메뉴는
// document.body에 포털(fixed)되어 sidebar의 DOM 서브트리 밖에 산다 — page 스코프로 찾는다.
const sidebar = page.locator('[data-id="dashboard-sidebar"]');
await sidebar.locator('[data-id="dashboard-sidebar-tab-coverage"]').click();
const coverageTrigger = sidebar.locator('[data-id="search-select-trigger"]');
await coverageTrigger.waitFor({ state: "visible", timeout: 8000 });
await coverageTrigger.click();
const coverageMenu = page.locator('[data-id="search-select-menu"]');
await coverageMenu.waitFor({ state: "visible", timeout: 8000 });
// 메뉴 버튼 순서: 0=미지정("Add department"), 1..n=실제 부서. 첫 실제 부서를 고른다.
const firstDept = coverageMenu.locator("button").nth(1);
const coverageSaved = page.waitForResponse(
  (r) => r.url().includes("/dashboard/coverage-depts") && r.request().method() === "PUT",
  { timeout: 8000 },
);
await firstDept.click();
await coverageSaved.catch(() => undefined);
await page.reload({ waitUntil: "domcontentloaded" });
await dashboardTab.click();
await page.waitForResponse((r) => r.url().includes("/dashboard/summary")).catch(() => undefined);
const coverageText = await page.locator('[data-id="dashboard-coverage"]').innerText();
check("5 coverage dept appears after add", !/No departments selected|지정된 부서가 없습니다/.test(coverageText), coverageText.slice(0, 80));

await ctx.close();

// ── 권한 시나리오 (check 6) ─────────────────────────────────────
// Analytics 카테고리는 "everyone" 카테고리들보다 뒤에 온다 — 그래서 dashboard 권한만 받은
// 비-sysadmin은 설정을 열 때 풀블리드 대시보드에 강제 착지하지 않고, 레일에서 "Dashboard"
// 탭을 눌러 들어간다. 권한이 없는 유저에겐 그 탭 자체가 렌더되지 않는다(/api/me의
// can_view_dashboard가 탭 노출의 단일 소스). 그 두 갈래를 판정한다.
async function openSettingsWaitMe(devUser) {
  const c = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await c.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
  }, devUser);
  const p = await c.newPage();
  const meDone = p.waitForResponse((r) => r.url().includes("/api/me"), { timeout: 8000 });
  await p.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await meDone.catch(() => undefined);
  await p.waitForTimeout(300); // /api/me 응답 후 canViewDashboard 반영 리렌더 안정화
  return { ctx: c, page: p };
}

const granted = await openSettingsWaitMe("dash.viewer");
const grantedTab = granted.page.getByRole("button", { name: /^(Dashboard|대시보드)$/ });
const grantedTabVisible = await grantedTab.isVisible().catch(() => false);
// 탭이 보이는 것만으론 부족하다 — 눌러서 실제로 대시보드가 열려야 권한이 끝까지 통한 것이다.
let grantedCanOpen = false;
if (grantedTabVisible) {
  const summaryOk = granted.page.waitForResponse(
    (r) => r.url().includes("/dashboard/summary") && r.status() === 200,
    { timeout: 8000 },
  );
  await grantedTab.click();
  await summaryOk.catch(() => undefined);
  grantedCanOpen = await granted.page
    .locator('[data-id="dashboard"]')
    .isVisible()
    .catch(() => false);
}
await granted.ctx.close();

const denied = await openSettingsWaitMe("dash.nobody");
const deniedTabVisible = await denied.page
  .getByRole("button", { name: /^(Dashboard|대시보드)$/ })
  .isVisible()
  .catch(() => false);
await denied.ctx.close();

check(
  "6 dashboard access enforced (granted opens it via tab, denied has no tab)",
  grantedTabVisible && grantedCanOpen && !deniedTabVisible,
  `grantedTab=${grantedTabVisible} grantedOpened=${grantedCanOpen} deniedTab=${deniedTabVisible}`,
);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);

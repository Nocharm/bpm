// AI 사용량 대시보드 검증 — 시드 이벤트 → 설정>Analytics>Dashboard에서 카드·상위 목록 렌더.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3010 node scripts/pw-verify-ai-usage.mjs
// 전제: backend(8010, reset_db 후 아래 시드) + 프론트(3010). 이벤트 시드는 이 스크립트가 앱 모델로 직접 수행.
// 재실행 전제: 이 스크립트는 실행마다 이벤트 2건을 누적 시드하므로(check 2 값이 어긋남) 재실행 전 reset_db 필요.
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3010";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 이벤트 2건 시드 — 성공(토큰)·실패. sqlite raw INSERT는 tz-aware DateTime 문자열 비교 함정이 있어
// 앱 모델(clock.now KST 디폴트)로 시드한다 — 백엔드 venv 파이썬 인라인.
execSync(
  `cd ../backend && .venv/bin/python -c "
import asyncio
from app.db import SessionLocal
from app.models import AiUsageEvent

async def seed():
    async with SessionLocal() as s:
        s.add(AiUsageEvent(login_id='verify.user', map_id=1, version_id=1, model='', kind='answer', prompt_tokens=1234, completion_tokens=56, ok=True))
        s.add(AiUsageEvent(login_id='verify.user', map_id=1, version_id=1, model='', kind=None, prompt_tokens=None, completion_tokens=None, ok=False))
        await s.commit()

asyncio.run(seed())
"`,
  { stdio: "inherit" },
);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();

await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
// Analytics 카테고리는 /api/me 로 sysadmin 판정 후 렌더 — 좌측 탭 레일에 뜰 때까지 대기.
const dashboardTab = page.getByRole("button", { name: /^(Dashboard|대시보드)$/ });
await dashboardTab.waitFor({ state: "visible", timeout: 8000 });
await dashboardTab.click();
// 진입 카드(dashboard.openCard) 클릭 → 상세 화면 전환
const openCard = page.getByRole("button", { name: /Open operations dashboard|운영 대시보드 열기/ });
await openCard.waitFor({ state: "visible", timeout: 8000 });
// 상세 화면 전환과 동시에 GET /dashboard/ai-usage 가 발화 — 응답까지 대기해야 카드가 "—" 자리표시에서 실값으로 바뀐다.
const aiUsageResponse = page.waitForResponse((res) => res.url().includes("/dashboard/ai-usage"), {
  timeout: 8000,
});
await openCard.click();
await aiUsageResponse.catch(() => undefined);
const section = page.locator('[data-id="dashboard-ai-usage"]');
await section.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
check("1 AI usage section visible", await section.isVisible().catch(() => false));
const text = (await section.innerText().catch(() => "")) ?? "";
check("2 token totals rendered", /1,?290|1,?234/.test(text), text.slice(0, 120));
check("3 top user listed", text.includes("verify.user") || /verify/.test(text));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);

// 비교 화면 로드 실패 처리 검증 — ①403 → 비공개 맵 안내 모달 + 홈 이동 ②일반 실패 → 인라인 오류(무한 로딩 방지)
// ③정상 로드 무회귀. 403/500은 page.route로 주입(권한 강제 불필요).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3010 node scripts/pw-verify-compare-403.mjs
// 전제: backend(8010, 데모 시드) + 프론트(3010) 기동. playwright-core + 시스템 Chrome.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3010";
const MAP = Number(process.env.VERIFY_MAP ?? 1);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});

// ── ① 403 주입 → 안내 모달 + 홈 이동 ────────────────────────
{
  const page = await ctx.newPage();
  await page.route("**/api/maps/" + MAP, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ detail: "insufficient permission" }),
    }),
  );
  await page.goto(`${BASE}/maps/${MAP}/compare`, { waitUntil: "domcontentloaded" });
  const modalText = page.getByText(/Private map|비공개 맵/);
  await modalText.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  check("1a 403 → access-denied modal shown", await modalText.first().isVisible().catch(() => false));
  const confirmBtn = page.getByRole("button", { name: /Back to home|홈으로/ });
  await confirmBtn.click().catch(() => undefined);
  await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 8000 }).catch(() => undefined);
  check("1b confirm → redirected home", new URL(page.url()).pathname === "/", page.url());
  await page.close();
}

// ── ② 서버 오류(500) 주입 → 인라인 오류 표시(스피너 아님) ──────────
{
  const page = await ctx.newPage();
  await page.route("**/api/maps/" + MAP, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "boom" }),
    }),
  );
  await page.goto(`${BASE}/maps/${MAP}/compare`, { waitUntil: "domcontentloaded" });
  const errorBox = page.locator('[data-id="compare-load-error"]');
  await errorBox.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  const errorText = (await errorBox.textContent().catch(() => "")) ?? "";
  check("2a non-403 → inline load error shown", errorText.trim().length > 0, errorText.trim().slice(0, 80));
  await page.close();
}

// ── ③ 정상 로드 무회귀 — 비교 캔버스 렌더 ───────────────────────
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/maps/${MAP}/compare`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".react-flow__node", { timeout: 60000 }).catch(() => undefined);
  check(
    "3a normal load renders compare canvas",
    (await page.locator(".react-flow__node").count().catch(() => 0)) > 0,
  );
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);

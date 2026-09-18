// 승인자 착지·안내·비교 딥링크·AI 요약 탭 스모크 (2026-09-18).
// (1) 승인자로 맵 진입 → pending 버전 착지, (2) 승인 탭에 "게시본과 비교" 버튼, (3) ?version=게시본으로 열면
// 배너 링크+승인 탭 오버레이, 오버레이 버튼으로 pending 이동, (4) 비교 딥링크 ?base=&target= 적용 + AI 요약 탭
// 선행 생성(스피너)→결과 렌더.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=32 APPROVER=bora.hong node scripts/pw-smoke-approver-landing.mjs
// 전제: backend(AI 활성)+frontend 기동, MAP_ID 맵에 published 1건 + pending 1건(APPROVER가 승인자, 미결재).
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp";
const MAP_ID = Number(process.env.MAP_ID ?? "32");
const APPROVER = process.env.APPROVER ?? "bora.hong";
const PUBLISHED_ID = Number(process.env.PUBLISHED_ID ?? "111");
const PENDING_ID = Number(process.env.PENDING_ID ?? "112");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

const noticeTitle = (page) => page.locator('[data-id="editor-readonly-notice"] span').first().textContent();

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, APPROVER);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // (1) 승인자 착지 — pending 버전
  await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="editor-readonly-notice"]', { timeout: 20000 });
  // 뷰어 역할 승인자는 배너 제목이 "Viewer access"라 버전 판정은 승인 탭의 비교 CTA(pending 전용)로 한다
  check("no pending link when already on pending", (await page.locator('[data-id="editor-notice-pending-link"]').count()) === 0);

  // (2) 승인 탭 — 비교 CTA(pending에서만) = 착지 판정, 오버레이 없음
  await page.getByRole("button", { name: "Approval", exact: true }).first().click();
  await page.waitForSelector('[data-id="approval-workflow-section"]', { timeout: 10000 });
  check("approver lands on pending version (compare CTA present)", (await page.locator('[data-id="approval-compare-cta"]').count()) === 1, `notice=${await noticeTitle(page)}`);
  check("no overlay on pending version", (await page.locator('[data-id="approval-pending-for-me-overlay"]').count()) === 0);
  await shot(page, "s1-pending-approval-tab");

  // (3) 게시본을 열면 — 배너 링크 + 승인 탭 오버레이
  await page.goto(`${BASE}/maps/${MAP_ID}?version=${PUBLISHED_ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="editor-notice-pending-link"]', { timeout: 20000 });
  check("notice shows pending link on published version", true, `notice=${await noticeTitle(page)}`);
  await page.getByRole("button", { name: "Approval", exact: true }).first().click();
  await page.waitForSelector('[data-id="approval-pending-for-me-overlay"]', { timeout: 10000 });
  check("overlay on approval tab", true);
  check("no compare CTA on published version", (await page.locator('[data-id="approval-compare-cta"]').count()) === 0);
  await shot(page, "s2-published-overlay");
  await page.locator('[data-id="approval-pending-for-me-go"]').click();
  await page.waitForSelector('[data-id="approval-compare-cta"]', { timeout: 15000 });
  check("overlay button switches to pending version", true);
  check("overlay gone after switch", (await page.locator('[data-id="approval-pending-for-me-overlay"]').count()) === 0);
  check("pending link gone after switch", (await page.locator('[data-id="editor-notice-pending-link"]').count()) === 0);

  // 배너 링크 경로도 확인
  await page.goto(`${BASE}/maps/${MAP_ID}?version=${PUBLISHED_ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="editor-notice-pending-link"]', { timeout: 20000 });
  await page.locator('[data-id="editor-notice-pending-link"]').click();
  await page.waitForSelector('[data-id="editor-notice-pending-link"]', { state: "detached", timeout: 15000 });
  await page.getByRole("button", { name: "Approval", exact: true }).first().click();
  await page.waitForSelector('[data-id="approval-compare-cta"]', { timeout: 15000 });
  check("banner link switches to pending version", true);

  // (4) 비교 딥링크 + AI 요약 탭
  // networkidle은 AI 요청이 끝날 때까지 기다려 스피너를 놓친다 — DOM 로드 직후 관찰
  await page.goto(`${BASE}/maps/${MAP_ID}/compare?base=${PUBLISHED_ID}&target=${PENDING_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-id="compare-inspector-tab-ai"]', { timeout: 20000 });
  const baseLabel = await page.locator('[data-id="compare-version-base"]').textContent();
  const targetLabel = await page.locator('[data-id="compare-version-target"]').textContent();
  check("deep link picks base/target", /v1/.test(baseLabel ?? "") && /To-Be|Draft/.test(targetLabel ?? ""), `base=${baseLabel} target=${targetLabel}`);
  const spinnerSeen = await page
    .waitForSelector('[data-id="compare-ai-tab-spinner"]', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check("AI tab spinner shown while prefetching", spinnerSeen);
  if (spinnerSeen) await shot(page, "s3-compare-ai-spinner");
  await page.locator('[data-id="compare-inspector-tab-ai"]').click();
  await page.waitForSelector('[data-id="compare-ai-headline"], [data-id="compare-ai-error"]', { timeout: 90000 });
  const gotResult = (await page.locator('[data-id="compare-ai-headline"]').count()) === 1;
  check("AI summary rendered", gotResult, gotResult ? "" : await page.locator('[data-id="compare-ai-error"]').textContent());
  if (gotResult) {
    const hl = await page.locator('[data-id="compare-ai-highlights"] li').count();
    check("highlights present", hl > 0, `n=${hl}`);
    if (hl > 0) {
      await page.locator('[data-id="compare-ai-highlight-0"]').click();
      await page.waitForTimeout(600);
      check("highlight click focuses canvas (no error)", pageErrors.length === 0);
    }
  }
  await shot(page, "s4-compare-ai-summary");
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

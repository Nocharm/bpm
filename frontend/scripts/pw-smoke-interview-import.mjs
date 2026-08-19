// 인터뷰 임포트 스모크 — 다중 파일 dry-run(파일 리포트)→apply→멱등 + 홈 Framework 노출 + 맵 Notes 표시.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-interview-import.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, reset_db 시드만(임포트는 이 스크립트가 UI로 수행).
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
const SAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/samples/consultant-interview-sample",
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 요약 칩은 renderImportSummary의 "<라벨> <숫자>" 텍스트 스팬 — 인터뷰 섹션 스코프로 매칭
const chip = (page, label, count) =>
  page.locator('[data-id="interview-import"]').getByText(new RegExp(`${label}\\s*${count}`)).first();

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // ── 1) 설정 → Framework 탭 → Interview import 섹션 ─────────────────────
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Categories & import" }).first().click();
  const sectionVisible = await page.locator('[data-id="interview-import"]')
    .waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  check("interview import section visible", sectionVisible);

  // ── 2) 다중 파일 선택 → 리스트 2건 ──────────────────────────────────────
  await page.locator('[data-id="interview-import-files"]').setInputFiles([
    path.join(SAMPLE_DIR, "calibration-l5.json"),
    path.join(SAMPLE_DIR, "utility-l5.json"),
  ]);
  // handleInterviewFiles가 file.text()를 await하므로 리스트 반영은 비동기 — 두 번째 행을 대기
  const listOk = await page.locator('[data-id="interview-import-file-list"] > li').nth(1)
    .waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  const listCount = await page.locator('[data-id="interview-import-file-list"] > li').count();
  check("two files listed", listOk && listCount === 2, `rows=${listCount}`);

  // ── 3) Dry-run → 파일별 리포트(OK 2)·Created 4·Notes 6·미영속 ───────────
  await page.locator('[data-id="interview-import-dryrun"]').click();
  await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 15000 });
  const fileReports = await page.locator('[data-id="interview-import-file-reports"] > li').count();
  check("per-file reports rendered", fileReports === 2, `rows=${fileReports}`);
  const okBadges = await page
    .locator('[data-id="interview-import-file-reports"]').getByText("OK", { exact: true }).count();
  check("both files OK", okBadges === 2, `ok=${okBadges}`);
  const dryCreated = await chip(page, "Created", 4).waitFor({ state: "visible", timeout: 8000 })
    .then(() => true).catch(() => false);
  check("dry-run summary shows Created 4", dryCreated);
  // 승격(2026-08-19) 후 openItems·tasks[].note도 노트로 보존 — 8건(예외2+사이드3+open1+task1+유틸1)
  const dryNotes = await chip(page, "Notes", 8).isVisible().catch(() => false);
  check("dry-run summary shows Notes 8", dryNotes);
  await page.locator('[data-id="interview-file-toggle-0"]').click();
  const noIssues = await page.locator('[data-id="interview-import-file-reports"]')
    .getByText("No issues").first().waitFor({ state: "visible", timeout: 5000 })
    .then(() => true).catch(() => false);
  check("clean file accordion shows No issues", noIssues);

  // ── 4) Apply → 재-dry-run 멱등(Unchanged 4) ────────────────────────────
  await page.locator('[data-id="interview-import-apply"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 20000 });
  await page.locator('[data-id="interview-import-dryrun"]').click();
  const idempotent = await chip(page, "Unchanged", 4).waitFor({ state: "visible", timeout: 15000 })
    .then(() => true).catch(() => false);
  check("re-dry-run reports Unchanged 4 (idempotent)", idempotent);

  // ── 5) 홈 Framework 뷰 — 카테고리 체인·맵 노출(첫 펼침 캐스케이드) ───────
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Framework" }).click();
  await page.waitForSelector('[data-id="framework-tree"]', { timeout: 10000 });
  await page.locator('[data-id="framework-node"] > button').filter({ hasText: "EPCV" }).first().click();
  const mapVisible = await page
    .locator('[data-id="framework-tree"] [data-id="map-card-name"]', { hasText: "교정 준비" })
    .first().waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  check("imported map visible under framework tree", mapVisible);

  // ── 6) 맵 상세 — [Interview] 설명 + Notes 섹션(예외·VOC) ────────────────
  await page.locator('[data-id="framework-tree"] [data-id="map-card"]', { hasText: "교정 준비" })
    .first().click();
  await page.waitForSelector('[data-id="map-detail-description"]:visible', { timeout: 10000 });
  // 승격(2026-08-19) 후 [Interview]는 Owner role만 — Start condition 등은 고유 필드로 이동
  const descText = (await page.locator('[data-id="map-detail-description"]:visible').first().textContent()) ?? "";
  check("map description carries [Interview] Owner role only", descText.includes("[Interview]")
    && descText.includes("Owner role") && !descText.includes("Start condition"), descText.slice(0, 60));
  const notesVisible = await page.locator('[data-id="map-notes-section"]:visible').first()
    .waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  check("map notes section visible", notesVisible);
  const noteRows = await page.locator('[data-id="map-notes-section"]:visible [data-id^="map-note-"]').count();
  // 승격(2026-08-19) 후 tasks[].note도 맵 노트로 — 예외2+매칭 사이드1+task_note1
  check("notes rows include exceptions + side notes + task note", noteRows === 4, `rows=${noteRows}`);
  const notesText = (await page.locator('[data-id="map-notes-section"]:visible').first().textContent()) ?? "";
  check("exception title rendered", notesText.includes("현장 수기 기록"));
  check("exception kind badge rendered", notesText.includes("exception"));

  const errFree = consoleErrors.length === 0;
  check("no page errors", errFree, errFree ? "" : consoleErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);

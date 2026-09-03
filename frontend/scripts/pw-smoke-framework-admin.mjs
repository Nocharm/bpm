// 설정 Framework 탭 스모크 — 인터뷰 임포트로 시드 후 카테고리 CRUD(추가/개명/삭제·삭제 거부).
// 임포트 자체(파일 리포트·멱등)의 정밀 검증은 pw-smoke-interview-import.mjs가 담당한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-framework-admin.mjs
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
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const adminNode = (page, name) =>
  page.locator('[data-id^="framework-admin-node-"]').filter({ hasText: name }).first();

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

  // ── 1) 설정 → Framework 탭 노출·진입 ───────────────────────────────────
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  const tabBtn = page.getByRole("button", { name: "Categories & import" }).first();
  const tabVisible = await tabBtn.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  check("settings Framework tab visible (sysadmin)", tabVisible);
  await tabBtn.click();
  await page.waitForSelector('[data-id="framework-admin-tree"]', { timeout: 8000 });

  // ── 2) 인터뷰 임포트로 시드 — dry-run 후 apply(멱등이라 기적재 상태여도 안전) ──
  await page.locator('[data-id="interview-import-files"]').setInputFiles([
    path.join(SAMPLE_DIR, "calibration-l5.json"),
    path.join(SAMPLE_DIR, "utility-l5.json"),
  ]);
  await page.locator('[data-id="interview-import-file-list"] > li').nth(1)
    .waitFor({ state: "visible", timeout: 5000 });
  await page.locator('[data-id="interview-import-dryrun"]').click();
  await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 15000 });
  await page.locator('[data-id="interview-import-apply"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  const rootAfterApply = await adminNode(page, "EPCV").waitFor({ state: "visible", timeout: 15000 })
    .then(() => true).catch(() => false);
  check("interview apply populates admin category tree (EPCV visible)", rootAfterApply);

  // ── 3) 카테고리 CRUD — 추가/개명/삭제 ──────────────────────────────────
  await page.locator('[data-id="framework-admin-add-root"]').click();
  await page.locator('[data-id="prompt-dialog-input"]').fill("Smoke Cat");
  await page.locator('[data-id="prompt-dialog-confirm"]').click();
  const added = await adminNode(page, "Smoke Cat").waitFor({ state: "visible", timeout: 8000 })
    .then(() => true).catch(() => false);
  check("add top-level category", added);

  const row = adminNode(page, "Smoke Cat");
  await row.hover();
  const rowId = await row.getAttribute("data-id");
  const catId = rowId?.replace("framework-admin-node-", "");
  await page.locator(`[data-id="framework-admin-rename-${catId}"]`).click();
  await page.locator('[data-id="prompt-dialog-input"]').fill("Smoke Cat R");
  await page.locator('[data-id="prompt-dialog-confirm"]').click();
  const renamed = await adminNode(page, "Smoke Cat R").waitFor({ state: "visible", timeout: 8000 })
    .then(() => true).catch(() => false);
  check("rename category", renamed);

  await adminNode(page, "Smoke Cat R").hover();
  await page.locator(`[data-id="framework-admin-delete-${catId}"]`).click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.waitForTimeout(800);
  const goneCount = await page.locator('[data-id^="framework-admin-node-"]').filter({ hasText: "Smoke Cat R" }).count();
  check("delete empty category", goneCount === 0, `rows=${goneCount}`);

  // ── 4) 연결 맵 있는 카테고리 삭제 거부(409 사유 표시) ───────────────────
  const leafRow = adminNode(page, "EPCV");
  await leafRow.hover();
  const rootId = (await leafRow.getAttribute("data-id"))?.replace("framework-admin-node-", "");
  await page.locator(`[data-id="framework-admin-delete-${rootId}"]`).click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  const refused = await page.locator('[data-id="confirm-dialog"]').getByText(/child categories|maps are linked/).first()
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("delete refused for non-empty category (reason shown)", refused);
  await page.locator('[data-id="confirm-dialog-cancel"]').click();

  const errFree = consoleErrors.length === 0;
  check("no page errors", errFree, errFree ? "" : consoleErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

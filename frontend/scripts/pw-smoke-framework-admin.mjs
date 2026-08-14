// 설정 Framework 탭 스모크 — 웹 임포트(dry-run 미영속→apply→멱등)·카테고리 CRUD(추가/개명/삭제).
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
  "../../docs/samples/consultant-delivery-sample",
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 요약 칩: renderImportSummary가 "<라벨> <숫자>" 텍스트 스팬을 나열 — 라벨+수치 텍스트 매칭
const chip = (page, label, count) =>
  page.locator('[data-id="framework-import"]').getByText(new RegExp(`${label}\\s*${count}`)).first();
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
  const preCount = await page.locator('[data-id^="framework-admin-node-"]').count();
  check("category tree empty before import", preCount === 0, `rows=${preCount}`);

  // ── 2) 파일 선택 → Dry-run → 미영속 확인 ───────────────────────────────
  await page.locator('[data-id="framework-import-categories-file"]').setInputFiles(path.join(SAMPLE_DIR, "categories.json"));
  await page.locator('[data-id="framework-import-maps-file"]').setInputFiles(path.join(SAMPLE_DIR, "maps.jsonl"));
  await page.locator('[data-id="framework-import-dryrun"]').click();
  const dryCreated = await chip(page, "Created", 3).waitFor({ state: "visible", timeout: 10000 })
    .then(() => true).catch(() => false);
  check("dry-run summary shows Created 3", dryCreated);
  const stillEmpty = await page.locator('[data-id^="framework-admin-node-"]').count();
  check("dry-run persisted nothing (tree still empty)", stillEmpty === 0, `rows=${stillEmpty}`);

  // ── 3) Apply → 트리에 카테고리 생성 ─────────────────────────────────────
  await page.locator('[data-id="framework-import-apply"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  const rootAfterApply = await adminNode(page, "구매").waitFor({ state: "visible", timeout: 15000 })
    .then(() => true).catch(() => false);
  check("apply populates category tree (구매 visible)", rootAfterApply);

  // ── 4) 같은 파일 Dry-run 재실행 → 전부 unchanged(멱등) ──────────────────
  await page.locator('[data-id="framework-import-dryrun"]').click();
  const idempotent = await chip(page, "Unchanged", 3).waitFor({ state: "visible", timeout: 10000 })
    .then(() => true).catch(() => false);
  check("re-dry-run reports Unchanged 3 (idempotent)", idempotent);

  // ── 5) 카테고리 CRUD — 추가/개명/삭제 ──────────────────────────────────
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

  // ── 6) 연결 맵 있는 카테고리 삭제 거부(409 사유 표시) ───────────────────
  const leafRow = adminNode(page, "구매");
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

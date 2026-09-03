// 인터뷰 임포트 스모크 — 다중 파일 dry-run(파일 리포트)→apply→멱등 + 홈 Framework 노출 + 맵 Notes 표시.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-interview-import.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, reset_db 시드만(임포트는 이 스크립트가 UI로 수행).
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
// 재전달 파일·스크린샷 저장 위치 (SCRATCH_DIR 미지정 시 /tmp)
const SCRATCH = process.env.SCRATCH_DIR ?? "/tmp";
const SAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/samples/consultant-interview-sample",
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
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
  // 0.4 샘플 기준 17건 — 승격 노트(예외·사이드·open·task) + relations entry/flow 인용 (2026-09-01 이후)
  const dryNotes = await chip(page, "Notes", 17).isVisible().catch(() => false);
  check("dry-run summary shows Notes 17", dryNotes);
  // dry-run 직후 전 파일이 자동 펼침 — 아코디언은 이슈 표 대신 맵 행(교정 준비 …)을 보여준다
  const mapRows = await page.locator('[data-id="interview-import-file-reports"] > li').first()
    .getByText("교정 준비").first().waitFor({ state: "visible", timeout: 5000 })
    .then(() => true).catch(() => false);
  check("clean file accordion lists its maps", mapRows);

  // ── 4) Apply(하단 고정 바, 확인 다이얼로그 없음) → 재-dry-run 멱등(Unchanged 4) ──
  const noGov = await page.locator('[data-id="import-governance-none"]').isVisible().catch(() => false);
  check("first delivery has no governance diffs (all maps new)", noGov);
  await page.locator('[data-id="interview-import-apply"]').click();
  await page.waitForSelector('[data-id="interview-import-apply"]:disabled', { timeout: 20000 });
  await page.locator('[data-id="interview-import-dryrun"]').click();
  const idempotent = await chip(page, "Unchanged", 4).waitFor({ state: "visible", timeout: 15000 })
    .then(() => true).catch(() => false);
  check("re-dry-run reports Unchanged 4 (idempotent)", idempotent);

  // ── 4b) 거버넌스 확인 — 오너가 실린 재전달은 체크한 것만 교체 (spec 2026-09-03) ──
  // 재전달 오너 = 디렉터리에서 임포터(admin.sys)가 아닌 첫 로그인(시드 로그인은 랜덤 생성이라 런타임 조회)
  const govOwner = await page.evaluate(async (admin) => {
    const res = await fetch("/api/directory", { headers: { "X-Dev-User": admin } });
    const dir = await res.json();
    return (dir.users ?? []).map((u) => u.id).find((id) => id !== admin) ?? null;
  }, ADMIN);
  check("directory yields a non-importer login for re-delivery", govOwner !== null, String(govOwner));
  const raw = JSON.parse(await fs.readFile(path.join(SAMPLE_DIR, "calibration-l5.json"), "utf8"));
  raw.rows[0].owner = govOwner;
  const govCode = raw.rows[0].taskId;
  const govFile = path.join(SCRATCH, "calibration-gov.json");
  await fs.writeFile(govFile, JSON.stringify(raw));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Categories & import" }).first().click();
  await page.locator('[data-id="interview-import-files"]').setInputFiles([govFile]);
  await page.locator('[data-id="interview-import-dryrun"]').click();
  await page.waitForSelector('[data-id="import-governance-review"]', { timeout: 15000 });
  const ownerRow = page.locator(`[data-id="import-governance-row-${govCode}-owner"]`);
  check("governance owner diff listed", await ownerRow.isVisible());
  check("owner diff shows delivered login", ((await ownerRow.textContent()) ?? "").includes(String(govOwner)));
  await page.locator('[data-id="interview-import-actions"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SCRATCH, "import-governance-unchecked.png") });
  // 노트 교체는 기본 체크(사람이 고친 노트가 없을 때, 9f8bcfea) — 절대값 대신 체크 전후 +1로 판정
  const countChecked = async () =>
    Number((((await page.locator('[data-id="interview-import-actions"]').textContent()) ?? "").match(/(\d+) governance/) ?? [])[1] ?? -1);
  const checkedBefore = await countChecked();
  await page.locator(`[data-id="import-governance-check-${govCode}-owner"]`).check();
  const checkedAfter = await countChecked();
  const barText = (await page.locator('[data-id="interview-import-actions"]').textContent()) ?? "";
  check("apply bar counts the checked change", checkedBefore >= 0 && checkedAfter === checkedBefore + 1, barText.trim());
  // 드라이런 결과와 적용 바가 한 테두리 카드 안 (사용자 요청 2026-09-03)
  const barInsideCard = await page.locator('[data-id="interview-import-report"] [data-id="interview-import-actions"]').count();
  check("apply bar sits inside the bordered report card", barInsideCard === 1);
  await page.screenshot({ path: path.join(SCRATCH, "import-governance-checked.png") });
  await page.locator('[data-id="interview-import-apply"]').click();
  await page.waitForSelector(`[data-id="import-governance-result-${govCode}-owner"]`, { timeout: 20000 });
  const appliedText = (await page.locator(`[data-id="import-governance-result-${govCode}-owner"]`).textContent()) ?? "";
  check("checked owner decision applied", appliedText.includes("Applied"), appliedText.trim());
  await page.screenshot({ path: path.join(SCRATCH, "import-governance-applied.png") });
  // 적용 완료 음영 — 본문을 덮고 Apply는 비활성, 푸터(Cancel)는 음영 위라 눌린다 (사용자 요청 2026-09-03)
  const appliedState = await page.evaluate(() => {
    const overlay = document.querySelector('[data-id="interview-import-applied-overlay"]');
    const apply = document.querySelector('[data-id="interview-import-apply"]');
    const cancel = document.querySelector('[data-id="interview-import-cancel"]');
    if (!overlay || !apply || !cancel) return { overlay: !!overlay, applyDisabled: false, cancelHit: false };
    const r = cancel.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { overlay: true, applyDisabled: apply.disabled, cancelHit: hit === cancel || cancel.contains(hit) };
  });
  check("applied report is shaded, Apply disabled, Cancel still reachable", appliedState.overlay && appliedState.applyDisabled && appliedState.cancelHit, JSON.stringify(appliedState));
  await page.locator('[data-id="interview-import-dryrun"]').click();
  // 새 dry-run 결과(applied=false)가 오면 Apply가 다시 활성 — 직전 apply 결과 화면과 구분하는 신호
  await page.waitForSelector('[data-id="interview-import-apply"]:not([disabled])', { timeout: 15000 });
  const ownerRowGone = await page.locator(`[data-id="import-governance-row-${govCode}-owner"]`).count();
  check("owner diff gone after apply (now equal)", ownerRowGone === 0, `rows=${ownerRowGone}`);

  // ── 5) 홈 Framework 뷰 — 카테고리 체인·맵 노출(첫 펼침 캐스케이드) ───────
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Framework" }).click();
  await page.waitForSelector('[data-id="framework-tree"]', { timeout: 10000 });
  await page.locator('[data-id="framework-node"] button').filter({ hasText: "EPCV" }).first().click();
  const mapVisible = await page
    .locator('[data-id="framework-tree"] [data-id="map-card-name"]', { hasText: "교정 준비" })
    .first().waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  check("imported map visible under framework tree", mapVisible);
  // 오너 없이 임포트된 맵(유틸리티 샘플)은 "Owner unconfirmed" 필 — 교정 준비는 위에서 오너가 배정됐다
  const pendingPills = await page.locator('[data-id="framework-tree"] [data-id="map-owner-pending"]').count();
  check("owner-unconfirmed pill shown on pending maps", pendingPills > 0, `pills=${pendingPills}`);

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
  // 노트 아코디언은 기본 접힘(사용자 결정 2026-08-20) — 펼친 뒤 행을 센다
  await page.locator('[data-id="map-notes-section"]:visible [data-id="map-notes-toggle"]').first().click();
  await page.locator('[data-id="map-notes-section"]:visible [data-id^="map-note-"]').first()
    .waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  const noteRows = await page.locator('[data-id="map-notes-section"]:visible [data-id^="map-note-"]').count();
  // 승격(2026-08-19) 예외2+매칭 사이드1+task_note1 + 0.4 relations 흐름 인용(kind=flow) 2 = 6
  check("notes rows include exceptions + side notes + task note + flow quotes", noteRows === 6, `rows=${noteRows}`);
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

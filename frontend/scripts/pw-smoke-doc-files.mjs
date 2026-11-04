// 배포 문서 파일 스모크(2026-11-05) — 설정 › 콘텐츠 › 매뉴얼: docs/manual에서 동기화된 문서 6개에 "파일 동기화" 칩, 열면 안내 줄·
// 읽기 전용 편집기·게시/업로드 꺼짐. 설정 › 콘텐츠 › 공지사항: 새 공지 창의 "파일에서 불러오기" → docs/notices 목록(최신 먼저) →
// 고르면 제목·본문이 채워지고 게시 메모 주석은 빠진다. 저장하지 않고 닫는다. 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 node scripts/pw-smoke-doc-files.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; node scripts\pw-smoke-doc-files.mjs
// 전제: backend를 이 저장소에서 새로 띄운다(기동할 때 docs/manual을 동기화한다). 산출물 저장소 루트 .shots/doc-files-*.png.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const OUT = "../.shots";
const MANUAL_FILES = 6; // docs/manual의 md(사용 안내·맵 편집·관리자 × 한/영)

mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const consoleErrors = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1456, height: 900 } });
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "ko");
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // 1) 매뉴얼 — 파일 동기화 문서는 칩이 붙고 열면 잠긴다
  await page.goto(`${BASE}/settings`);
  await page.getByRole("button", { name: "매뉴얼", exact: true }).click();
  await page.locator('[data-id="manual-docs-list"]').waitFor();
  const chips = page.locator('[data-id^="manual-doc-synced-"]');
  await chips.first().waitFor();
  check("manual: synced chips for every docs/manual file", (await chips.count()) === MANUAL_FILES, String(await chips.count()));
  await page.locator('[data-id="manual-docs-list"] button', { hasText: "사용 안내" }).first().click();
  await page.locator('[data-id="manual-synced-hint"]').waitFor();
  check(
    "manual: hint names the source file",
    ((await page.locator('[data-id="manual-synced-hint"]').textContent()) ?? "").includes("user-manual-general-ko.md"),
  );
  check("manual: editor is read-only", (await page.getByPlaceholder("마크다운으로 매뉴얼을 작성하세요…").getAttribute("readonly")) !== null);
  check("manual: publish is off", await page.getByRole("button", { name: "게시", exact: true }).isDisabled());
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/doc-files-manual.png` });

  // 2) 공지 — 새 공지 창에서 초안 파일 불러오기
  await page.getByRole("button", { name: "공지사항", exact: true }).click();
  await page.getByRole("button", { name: "새 공지 등록" }).click();
  await page.locator('[data-id="notice-load-draft"]').click();
  const list = page.locator('[data-id="notice-draft-list"]');
  await list.locator("li").first().waitFor();
  const files = await list.locator('[data-id^="notice-draft-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
  check("notice: drafts listed newest first", files[0] === "notice-draft-2026-10-21-release.md", files.join(","));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/doc-files-notice-list.png` });
  await list.locator('[data-id="notice-draft-2026-10-21-release.md"]').click();
  await page.locator('[data-id="notice-draft-loaded"]').waitFor();
  const dialog = page.locator('[role="dialog"]', { has: page.locator('[data-id="notice-load-draft"]') });
  const title = await dialog.locator("input").first().inputValue();
  const body = await dialog.locator("textarea").inputValue();
  check("notice: title from the first heading", title.startsWith("업데이트 안내"), title);
  check("notice: body without the publisher comment", body.length > 0 && !body.includes("<!--") && !body.startsWith("# "), body.slice(0, 40));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/doc-files-notice-loaded.png` });
  await dialog.getByRole("button", { name: "취소" }).click(); // 저장하지 않는다
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
} catch (err) {
  failures += 1;
  console.log("FAIL exception", err);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

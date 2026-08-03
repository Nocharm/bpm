// AI 프롬프트 관리 스모크 — 설정 탭 진입 → 7종 목록 → 편집·저장(커스텀 배지) →
// 마크다운 프리뷰 → 새로고침 지속성 → 기본값 복원(배지 해제) → 정리.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 SHOT_DIR=<dir> node scripts/pw-smoke-ai-prompts.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, 로컬 기본(전원 sysadmin). 언어 en 고정.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API_BASE = process.env.API_BASE ?? "http://localhost:8000";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const CUSTOM = "SMOKE custom nudge — **bold-marker**";
const DEV_USER = "admin.sys";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 실패 경로(중간 throw)에서도 dev.db에 오버라이드가 남지 않게 항상 시도하는 best-effort 정리.
// DELETE는 멱등(app/routers/ai_prompts.py)이라 정상 경로 후에도 무해.
async function cleanupOverride() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/ai-prompts/anti_repeat_nudge`, {
      method: "DELETE",
      headers: { "X-Dev-User": DEV_USER },
    });
    if (!res.ok) console.warn(`cleanup warning: DELETE returned ${res.status}`);
  } catch (e) {
    console.warn(`cleanup warning: ${e}`);
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  // 1) 설정 → AI prompts 탭
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "AI prompts" }).click();
  await page.waitForSelector('[data-id="ai-prompts-list"]', { timeout: 8000 });
  const rows = await page.locator('[data-id^="ai-prompt-row-"]').count();
  check("list shows 7 prompts", rows === 7, `rows=${rows}`);

  // 2) 항목 선택 → 편집기에 기본값 로드
  await page.locator('[data-id="ai-prompt-row-anti_repeat_nudge"]').click();
  await page.waitForSelector('[data-id="ai-prompt-editor"]');
  const initial = await page.locator('[data-id="ai-prompt-editor"] textarea').inputValue();
  check("editor loads default content", initial.trim().length > 0);
  check("save disabled while pristine", await page.locator('[data-id="ai-prompt-save"]').isDisabled());

  // 3) 수정 → 저장 → 커스텀 배지
  await page.locator('[data-id="ai-prompt-editor"] textarea').fill(CUSTOM);
  await page.locator('[data-id="ai-prompt-save"]').click();
  await page.waitForTimeout(600);
  const rowText = await page.locator('[data-id="ai-prompt-row-anti_repeat_nudge"]').innerText();
  check("customized badge after save", rowText.includes("Customized"));
  await page.screenshot({ path: `${SHOT_DIR}/ai-prompts-saved.png` });

  // 4) 마크다운 프리뷰
  await page.locator('[data-id="ai-prompt-preview-toggle"]').click();
  const bold = await page.locator('[data-id="ai-prompt-editor"] strong', { hasText: "bold-marker" }).count();
  check("markdown preview renders", bold >= 1);
  await page.screenshot({ path: `${SHOT_DIR}/ai-prompts-preview.png` });

  // 5) 새로고침 지속성
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "AI prompts" }).click();
  await page.waitForSelector('[data-id="ai-prompts-list"]');
  await page.locator('[data-id="ai-prompt-row-anti_repeat_nudge"]').click();
  const persisted = await page.locator('[data-id="ai-prompt-editor"] textarea').inputValue();
  check("override persists after reload", persisted === CUSTOM);

  // 6) 기본값 복원(확인 모달 경유) → 배지 해제 + 내용 복귀
  // ConfirmDialog confirm 버튼은 data-id="confirm-dialog-confirm" 보유 — 라벨 매칭보다 견고해 이걸 사용
  // (brief 초안의 getByRole name="Confirm"도 common.confirm en 라벨과 일치해 유효하나, data-id가 더 안정적)
  await page.locator('[data-id="ai-prompt-reset"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.waitForTimeout(600);
  const restored = await page.locator('[data-id="ai-prompt-editor"] textarea').inputValue();
  check("reset restores default", restored === initial);
  const rowAfter = await page.locator('[data-id="ai-prompt-row-anti_repeat_nudge"]').innerText();
  check("badge cleared after reset", !rowAfter.includes("Customized"));
  check("reset disabled at default", await page.locator('[data-id="ai-prompt-reset"]').isDisabled());
  await page.screenshot({ path: `${SHOT_DIR}/ai-prompts-reset.png` });

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} catch (e) {
  // 중간 throw(타임아웃·내비 실패 등) 시에도 finally의 클린업이 실행되도록 여기서 흡수 — 실패로 기록.
  check("script completed", false, String(e));
} finally {
  await cleanupOverride();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

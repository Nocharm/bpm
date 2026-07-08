// AI 챗 서버 저장 히스토리 스모크 — 대화 바 목록/다른 맵 토글 → 서버 페이징(30→40) →
// 타맵 세션 열람(포린 배너·textarea disabled) → ?aiChat 딥링크 이동 → mocked 전송(낙관 말풍선) → 삭제+폴백.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3010 SHOT_DIR=<dir> node scripts/pw-smoke-ai-chat-history.mjs
// 전제: backend AI_ENABLED=true(8010) + 프론트(3010) 기동, dev.db에 SMOKE- 세션 3개 시드(브리프 Step 2). playwright-core + 시스템 Chrome.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3010";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
// 시드 id(브리프 Step 2 출력) — 기본값은 첫 실행 기준. 다르면 env로 주입.
// SMOKE-paging(map1, 40 messages)은 제목으로 선택하므로 id 상수 불필요.
const S2 = Number(process.env.SMOKE_S2 ?? 2); // SMOKE-second (map1)
const S3 = Number(process.env.SMOKE_S3 ?? 3); // SMOKE-other-map (map2)
const MAP1 = Number(process.env.SMOKE_MAP1 ?? 1);
const MAP2 = Number(process.env.SMOKE_MAP2 ?? 2);

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
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const AI_TOGGLE = 'button[title="AI 도우미"], button[title="AI assistant"]';
const openPanel = async () => {
  await page.locator(AI_TOGGLE).first().click();
  await page.waitForSelector('[data-id="ai-chat-list"]', { timeout: 8000 });
};
const openDropdown = async () => {
  await page.locator('[data-id="ai-chat-list"]').click();
  await page.waitForSelector('[data-id="ai-chat-list-menu"]', { timeout: 4000 });
};
const countMessages = () =>
  page.$$eval(
    '[data-id="ai-thread"] > li:not([data-id="ai-loading-older"])',
    (els) => els.length,
  );

// ── 진입: 맵1 에디터 + AI 패널 ────────────────────────────
await page.goto(`${BASE}/maps/${MAP1}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 60000 });
await page.waitForTimeout(800);
await openPanel();

// ① 대화 바 제목이 SMOKE 세션(최근 활동 자동 활성) — 세션 목록 비동기 로딩 후 활성 확정 대기
await page
  .waitForFunction(
    () => document.querySelector('[data-id="ai-chat-list"]')?.textContent?.includes("SMOKE"),
    { timeout: 6000 },
  )
  .catch(() => undefined);
const activeTitle = (await page.locator('[data-id="ai-chat-list"]').innerText()).replace(/\n/g, " ");
check("1 active session is a SMOKE chat", activeTitle.includes("SMOKE"), activeTitle);

// ② 드롭다운 — 현재 맵 2개(SMOKE-paging/SMOKE-second) + 다른 맵 토글 1건
await openDropdown();
const mapItems = await page.locator('[data-id="ai-chat-list-item"]').allInnerTexts();
check(
  "2a current-map items = 2 (paging + second)",
  mapItems.length === 2 &&
    mapItems.some((t) => t.includes("SMOKE-paging")) &&
    mapItems.some((t) => t.includes("SMOKE-second")),
  JSON.stringify(mapItems),
);
const otherToggle = page.locator('[data-id="ai-chat-other-toggle"]');
const otherToggleText = (await otherToggle.count()) ? await otherToggle.innerText() : "(none)";
check("2b other-maps toggle shows 1", otherToggleText.includes("1"), otherToggleText.replace(/\n/g, " "));
await otherToggle.click();
await page.waitForSelector('[data-id="ai-chat-other-item"]', { timeout: 3000 });
const otherItems = await page.locator('[data-id="ai-chat-other-item"]').allInnerTexts();
check(
  "2c other-map item = SMOKE-other-map",
  otherItems.length === 1 && otherItems[0].includes("SMOKE-other-map"),
  JSON.stringify(otherItems),
);
await page.screenshot({ path: `${SHOT_DIR}/smoke-h-1-dropdown.png` });

// ③ SMOKE-paging 선택 → 30개 → 상단 스크롤 → 로딩 팁 → 40개
await page.locator('[data-id="ai-chat-list-item"]', { hasText: "SMOKE-paging" }).click();
await page.waitForTimeout(600);
const initialCount = await countMessages();
check("3a paging initial 30 messages", initialCount === 30, `count=${initialCount}`);
await page.evaluate(() => {
  const el = document.querySelector('[data-id="ai-thread"]')?.parentElement;
  if (el) el.scrollTop = 0;
});
await page.waitForSelector('[data-id="ai-loading-older"]', { timeout: 3000 });
const tipText = await page.evaluate(
  () =>
    document.querySelector('[data-id="ai-loading-older"] .bg-accent-tint')?.textContent?.trim() ?? "",
);
check("3b loading-older row shows tip", tipText.length > 3, tipText);
await page.screenshot({ path: `${SHOT_DIR}/smoke-h-2-loading-older.png` });
await page.waitForFunction(
  () =>
    document.querySelectorAll('[data-id="ai-thread"] > li:not([data-id="ai-loading-older"])')
      .length === 40,
  { timeout: 4000 },
).catch(() => undefined);
const grownCount = await countMessages();
check("3c older page appended → 40 messages", grownCount === 40, `count=${grownCount}`);

// ④ 다른 맵 세션 열람 → 포린 배너 + textarea disabled + Open this map
await openDropdown();
if ((await page.locator('[data-id="ai-chat-other-item"]').count()) === 0) {
  await page.locator('[data-id="ai-chat-other-toggle"]').click();
  await page.waitForSelector('[data-id="ai-chat-other-item"]', { timeout: 3000 });
}
await page.locator('[data-id="ai-chat-other-item"]', { hasText: "SMOKE-other-map" }).click();
await page.waitForSelector('[data-id="ai-foreign-banner"]', { timeout: 4000 });
const foreignVisible = await page.locator('[data-id="ai-foreign-banner"]').isVisible();
// AI 챗 입력창은 maxlength=2000(피드백 위젯 textarea maxlength=4000과 구분)
const textareaDisabled = await page.locator('textarea[maxlength="2000"]').isDisabled();
const openMapBtn = (await page.locator('[data-id="ai-open-map"]').count()) === 1;
check("4 foreign banner + disabled input + open-map btn", foreignVisible && textareaDisabled && openMapBtn,
  `banner=${foreignVisible} disabled=${textareaDisabled} btn=${openMapBtn}`);
await page.screenshot({ path: `${SHOT_DIR}/smoke-h-3-foreign.png` });

// ⑤ Open this map → /maps/<map2>?aiChat=<s3> → 패널 자동 오픈 + SMOKE-other-map 활성
await page.locator('[data-id="ai-open-map"]').click();
await page.waitForFunction(
  (expected) => window.location.pathname === expected,
  `/maps/${MAP2}`,
  { timeout: 8000 },
);
const urlOk = page.url().includes(`/maps/${MAP2}`) && page.url().includes(`aiChat=${S3}`);
await page.waitForSelector(".react-flow__node", { timeout: 60000 });
await page.waitForSelector('[data-id="ai-chat-list"]', { timeout: 8000 }); // 딥링크 자동 오픈
await page.waitForTimeout(600);
const deepTitle = (await page.locator('[data-id="ai-chat-list"]').innerText()).replace(/\n/g, " ");
const deepThread = await page.locator('[data-id="ai-thread"]').innerText();
const bannerGone = (await page.locator('[data-id="ai-foreign-banner"]').count()) === 0;
check(
  "5 deep-link opens map2 with SMOKE-other-map active",
  urlOk && deepTitle.includes("SMOKE-other-map") && deepThread.includes("SMOKE other q") && bannerGone,
  `url=${page.url()} title=${deepTitle} bannerGone=${bannerGone}`,
);
await page.screenshot({ path: `${SHOT_DIR}/smoke-h-4-deeplink.png` });

// ⑥ 맵1 복귀(s2 활성, 딥링크) → mocked /ai/chat 전송 → 낙관 user+assistant 말풍선
await page.route("**/ai/chat", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      kind: "answer",
      message: "SMOKE mocked reply",
      session_id: S2,
      nodes: [],
      edges: [],
      groups: [],
      ops: [],
      steps: [],
      findings: [],
      model: "",
    }),
  }),
);
await page.goto(`${BASE}/maps/${MAP1}?aiChat=${S2}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 60000 });
await page.waitForSelector('[data-id="ai-chat-list"]', { timeout: 8000 });
await page.waitForTimeout(600);
await page
  .waitForFunction(
    () => document.querySelector('[data-id="ai-chat-list"]')?.textContent?.includes("SMOKE-second"),
    { timeout: 6000 },
  )
  .catch(() => undefined);
const s2Title = (await page.locator('[data-id="ai-chat-list"]').innerText()).replace(/\n/g, " ");
check("6a map1 s2 active via deep-link", s2Title.includes("SMOKE-second"), s2Title);
// AI 챗 입력창(maxlength=2000)과 그 형제 전송 버튼만 타겟 — 피드백 위젯 textarea/버튼 배제
const chatInput = page.locator('textarea[maxlength="2000"]');
await chatInput.fill("SMOKE ping");
await chatInput.locator("xpath=following-sibling::button").click();
await page.waitForFunction(
  () => document.querySelector('[data-id="ai-thread"]')?.textContent?.includes("SMOKE mocked reply"),
  { timeout: 6000 },
);
const threadAfterSend = await page.locator('[data-id="ai-thread"]').innerText();
check(
  "6b optimistic user + mocked assistant bubbles",
  threadAfterSend.includes("SMOKE ping") && threadAfterSend.includes("SMOKE mocked reply"),
  threadAfterSend.replace(/\n/g, " ").slice(-120),
);
await page.screenshot({ path: `${SHOT_DIR}/smoke-h-5-mocked-send.png` });
await page.unroute("**/ai/chat");

// ⑦ SMOKE-second 삭제 → ConfirmDialog → 확인 → 목록 제거 + 새 대화 폴백
await openDropdown();
await page
  .locator('[data-id="ai-chat-list-item"]:has-text("SMOKE-second") + [data-id="ai-chat-delete"]')
  .click();
await page.waitForSelector('[data-id="confirm-dialog"]', { timeout: 3000 });
await page.locator('[data-id="confirm-dialog-confirm"]').click();
await page.waitForTimeout(700);
const titleAfterDelete = (await page.locator('[data-id="ai-chat-list"]').innerText()).replace(/\n/g, " ");
const fellBackToNew = titleAfterDelete.includes("New chat") || titleAfterDelete.includes("새 대화");
await openDropdown();
const itemsAfterDelete = await page.locator('[data-id="ai-chat-list-item"]').allInnerTexts();
const secondGone = !itemsAfterDelete.some((t) => t.includes("SMOKE-second"));
check(
  "7 delete removes SMOKE-second + falls back to new chat",
  fellBackToNew && secondGone && itemsAfterDelete.some((t) => t.includes("SMOKE-paging")),
  `title=${titleAfterDelete} items=${JSON.stringify(itemsAfterDelete)}`,
);
await page.screenshot({ path: `${SHOT_DIR}/smoke-h-6-after-delete.png` });

// ⑧ 콘솔 에러 0
check("8 no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);

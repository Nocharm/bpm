// 노드 액션 바 + 링크 미리보기 스모크 — 단일 선택 시 바 노출, subprocess 펼침 토글(펼치기 버튼 단독),
// 일반 노드 URL 입력→링크 버튼(단독)→패널 오픈·주소 표기·Esc 닫기, locked/undesignated subprocess
// 펼치기 미노출, 콘솔 에러 0 검증.
// 펼치기·링크 버튼은 노드 타입상 배타적(인스펙터가 subprocess에는 url 필드를 노출하지 않음 —
// hasBpmAttributes()가 start/end/subprocess 제외)이라 두 버튼이 한 노드에 동시에 뜨는 경우를 UI로
// 재현할 수 없다 — 각각 단독 노출·순서(단일 원소)로 검증한다.
// 커버리지 갭(후속·follow-up): "펼치기→링크" 고정 순서가 한 노드에서 동시 노출되는 조합
// (node-action-expand,node-action-link) 자체는 이 스모크가 다루지 않는다 — subprocess+url 동시
// 보유 노드는 인스펙터 UI로는 만들 수 없고 CSV 임포트로 url을 직접 심어야만 재현 가능(범위 밖).
// 순서 자체는 node-action-bar.tsx JSX 배치(showExpand 블록 → showLink 블록)로 구조적으로 고정돼
// 있어 로직 변경 없이는 역전 회귀가 나지 않는다 — CSV 시나리오 스모크는 후속 과제로 남긴다.
// 그룹 나가기는 데모 시드에 그룹이 없어 수동 시현으로 검증(플랜 Task 5 Step 4).
// 실행: node scripts/pw-smoke-node-action-bar.mjs  (backend 8000 + frontend 3000 기동, 데모 시드 map 2
// "Employee Onboarding" 전제 — 지정 subprocess 노드 "Order Fulfillment", 미지정 subprocess 노드
// "Procurement Flow", 일반 task 노드 "Process Request")
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
// 기본 헤드리스 뷰포트(1280x720)는 좁아 bottom-left 근처 노드의 액션 바가 미니맵 패널과
// 겹쳐 클릭이 가로채인다 — 일반 데스크톱 창 크기로 넉넉히 잡아 회피.
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
// dev 로그인 우회 — DevGate가 읽는 localStorage 키를 선주입. map 2 draft 체크아웃 보유자와 맞춰 admin.sys 사용.
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let failed = false;
const fail = (msg) => {
  console.error("FAIL:", msg);
  failed = true;
};

// urlWasSet — 인스펙터로 url을 실제로 심은 시점부터 true. 중간에 예외가 던져져도 finally에서
// 이 값을 보고 원복을 시도해 데모 시드 오염(url="https://example.com/" 잔존)을 막는다.
let urlWasSet = false;
let urlInput = null;

try {
  await page.goto("http://localhost:3000/maps/2", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".react-flow__node", { timeout: 30000 });
  // 게시본 기본 열람(읽기 전용) → 초안 버전으로 전환 — 상태 배너 기능 이후 에디터가 게시본을 먼저 연다 (2026-07-07 머지)
  await page.getByRole("button", { name: /Select version|버전 선택/ }).first().click();
  await page.waitForTimeout(300);
  const draftRow = page.locator('button:has-text("(Draft)")').last();
  if (await draftRow.count()) {
    await draftRow.click();
    await page.keyboard.press("Escape"); // 동일 버전 클릭 시 드롭다운 잔류 방어
    await page.waitForSelector(".react-flow__node", { timeout: 30000 });
  } else {
    await page.keyboard.press("Escape");
  }

  await page.waitForTimeout(3000); // 측정/레이아웃 + subprocess 메타 로드 안정화

  const bar = page.locator('[data-id="node-action-bar"]');
  const expandBtn = page.locator('[data-id="node-action-expand"]');

  // (a) 지정 subprocess 노드("Order Fulfillment") 선택 → 액션 바 + 펼치기 버튼(단독)
  const subNode = page.locator(".react-flow__node", { hasText: "Order Fulfillment" }).first();
  await subNode.click();
  await bar.waitFor({ timeout: 5000 }).catch(() => fail("action bar did not appear on subprocess node"));
  if (!(await expandBtn.isVisible().catch(() => false))) fail("expand button not visible on subprocess node");
  const subIds = await bar.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  if (subIds.join(",") !== "node-action-expand") fail(`subprocess bar buttons wrong: ${subIds.join(",")}`);

  // (b) 펼침 토글 — aria-label이 collapse로 전환
  await expandBtn.click();
  await page.waitForTimeout(1500);
  const label = await expandBtn.getAttribute("aria-label");
  if (!/collapse|접기/i.test(label ?? "")) fail(`expand did not toggle: ${label}`);
  await expandBtn.click(); // 원복
  await page.waitForTimeout(800);

  // (c) 일반 task 노드("Process Request")로 전환 → URL 세팅(인스펙터, 자동저장 경로) → 링크 버튼(단독)
  const taskNode = page.locator(".react-flow__node", { hasText: "Process Request" }).first();
  await taskNode.click();
  await page.waitForTimeout(300);
  urlInput = page.locator('[data-id="url-field-input"]');
  if (await urlInput.isDisabled().catch(() => false)) {
    fail("url input disabled — map 2 draft may be checked out by someone other than admin.sys");
  } else {
    await urlInput.fill("https://example.com/");
    await page.keyboard.press("Enter");
    urlWasSet = true;
  }
  await page.waitForTimeout(500); // 상태 반영
  const taskIds = await bar.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  if (taskIds.join(",") !== "node-action-link") fail(`task node bar buttons wrong: ${taskIds.join(",")}`);

  // (d) 링크 열기 → 패널 오픈 + 주소 표기 + iframe → Esc 닫기
  await page.locator('[data-id="node-action-link"]').click();
  const panel = page.locator('[data-id="link-preview-panel"]');
  await page.waitForTimeout(600); // 슬라이드 인
  if (!((await panel.getAttribute("class")) ?? "").includes("translate-x-0")) fail("panel did not open");
  if ((await panel.locator("iframe").count()) === 0) fail("iframe not rendered");
  if (!(await panel.getByText("https://example.com").first().isVisible().catch(() => false)))
    fail("address bar url missing");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  if (((await panel.getAttribute("class")) ?? "").includes("translate-x-0")) fail("panel did not close on Esc");

  // (d2) 라벨 입력 → 버튼 텍스트 대체 → 라벨 삭제 → 원복
  await page.locator('[data-id="url-label-input"]').fill("WMS Doc");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const linkBtn2 = page.locator('[data-id="node-action-link"]');
  const btnText = ((await linkBtn2.textContent()) ?? "").trim();
  if (!btnText.includes("WMS Doc")) fail(`label did not replace button text: "${btnText}"`);
  if (/open link|링크 열기/i.test(btnText)) fail("default open-link text still present with label");
  await page.locator('[data-id="url-label-remove"]').click();
  await page.waitForTimeout(400);
  const btnText2 = ((await linkBtn2.textContent()) ?? "").trim();
  if (!/open link|링크 열기/i.test(btnText2)) fail(`label removal did not restore default text: "${btnText2}"`);

  // (e) 다중 선택 시 바 숨김 — RF 기본 multiSelectionKeyCode는 Mac에서 Meta(에디터 오버라이드 없음)
  const otherNode = page.locator(".react-flow__node", { hasText: "Procurement Flow" }).first();
  await taskNode.click();
  await otherNode.click({ modifiers: ["Meta"] });
  await page.waitForTimeout(300);
  if (await bar.isVisible().catch(() => false)) fail("bar visible on multi-select");

  // (f) 보너스 — 미지정 subprocess("Procurement Flow") 단독 선택 시 펼치기 버튼 미노출(locked/undesignated 게이팅)
  await otherNode.click();
  await page.waitForTimeout(300);
  if (await expandBtn.isVisible().catch(() => false)) fail("expand button visible on undesignated subprocess");

  // URL 원복 — 데모 시드 오염 방지. AUTO_SAVE_DELAY_MS(2000, page.tsx) 디바운스 후에야 PUT이
  // 나가므로 browser.close() 전에 그만큼 기다려야 실제로 반영된다(다른 pw-smoke-*.mjs와 동일 관례).
  await taskNode.click();
  const removeBtn = page.locator('[data-id="url-field-remove"]');
  if (await removeBtn.count()) await removeBtn.click();
  await page.waitForTimeout(2500); // AUTO_SAVE_DELAY_MS(2000) + PUT 여유
  urlWasSet = false; // 정상 경로에서 원복 완료 — finally의 best-effort 재시도 불필요
  if (!(await page.locator('[data-id="url-field-input"]').count())) fail("url input did not return after removal");

  if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
} finally {
  if (urlWasSet) {
    // best-effort — 여기 도달했다는 건 위에서 예외가 던져졌다는 뜻(page/context가 죽어있을 수 있음).
    // fill 후에도 AUTO_SAVE_DELAY_MS(2000)만큼 기다려야 PUT이 나간다 — 안 기다리면 close()가
    // 디바운스 타이머를 통째로 날려 원복이 로컬 상태에만 남고 서버엔 반영되지 않는다.
    try {
      const removeBtn = page.locator('[data-id="url-field-remove"]');
      if (await removeBtn.count()) await removeBtn.click();
      await page.waitForTimeout(2500); // AUTO_SAVE_DELAY_MS(2000) + PUT 여유
    } catch {
      // 원복 실패는 무시 — browser.close()는 반드시 실행해야 하므로 여기서 재throw하지 않는다
    }
  }
  await browser.close();
}

if (failed) process.exit(1);
console.log("PASS: node action bar + link preview smoke");

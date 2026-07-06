// 노드 액션 바 + 링크 미리보기 스모크 — 단일 선택 시 바 노출, subprocess 펼침 토글(펼치기 버튼 단독),
// 일반 노드 URL 입력→링크 버튼(단독)→패널 오픈·주소 표기·Esc 닫기, locked/undesignated subprocess
// 펼치기 미노출, 콘솔 에러 0 검증.
// 펼치기·링크 버튼은 노드 타입상 배타적(인스펙터가 subprocess에는 url 필드를 노출하지 않음 —
// hasBpmAttributes()가 start/end/subprocess 제외)이라 두 버튼이 한 노드에 동시에 뜨는 경우를 UI로
// 재현할 수 없다 — 각각 단독 노출·순서(단일 원소)로 검증한다.
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

await page.goto("http://localhost:3000/maps/2", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
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
const urlInput = page.locator('[data-id="inspector-field-url"]');
if (await urlInput.isDisabled().catch(() => false)) {
  fail("url input disabled — map 2 draft may be checked out by someone other than admin.sys");
} else {
  await urlInput.fill("https://example.com/");
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

// URL 원복 — 데모 시드 오염 방지
await taskNode.click();
await urlInput.fill("");
await page.waitForTimeout(600);

if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
await browser.close();
if (failed) process.exit(1);
console.log("PASS: node action bar + link preview smoke");

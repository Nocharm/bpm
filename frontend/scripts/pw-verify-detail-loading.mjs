// 맵 상세 로딩 프레임 검증 — ① 첫 로딩: 중앙 스피너+라벨 ② 멤버 로딩: 고스트 컬럼
// ③ 고스트→실데이터 전환에서 버전 프레임 폭 불변(리플로우 방지). API를 인위 지연시켜 결정적으로 검사.
// 실행: node scripts/pw-verify-detail-loading.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DETAIL_DELAY_MS = 700; // getMap 지연 — 스피너 관찰 창
const PERMS_DELAY_MS = 1800; // permissions 지연 — 고스트 관찰 창

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// API 지연 주입 — 상세는 짧게, 권한(멤버)은 길게
await page.route(/\/api\/maps\/\d+$/, async (route) => {
  await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
  await route.continue();
});
await page.route(/\/api\/maps\/\d+\/permissions/, async (route) => {
  await new Promise((r) => setTimeout(r, PERMS_DELAY_MS));
  await route.continue();
});

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-id="map-card"]', { timeout: 30000 });
// 카드 여백(패딩) 클릭 — 중앙을 누르면 이름 Link가 에디터로 내비게이션해 버림
await page.locator('[data-id="map-card"]').first().click({ position: { x: 8, y: 8 } });

// 우측 패널로 한정 — 카드 호버 프리뷰 모달에도 같은 카드가 떠서 중복 매치됨
const aside = page.locator('[data-id="map-detail-aside"]');

// ① 스피너 로딩 박스 — detail 지연 동안 노출
const loading = aside.locator('[data-id="map-detail-loading"]');
await loading.waitFor({ state: "visible", timeout: DETAIL_DELAY_MS + 500 });
const spinnerSeen = (await loading.locator("svg.animate-spin").count()) > 0;
const labelSeen = (await loading.textContent())?.includes("Loading") ?? false;

// ② 고스트 멤버 컬럼 — detail 도착 후 permissions 지연 동안 노출
const ghost = aside.locator('[data-id="map-detail-members-ghost"]');
await ghost.waitFor({ state: "visible", timeout: DETAIL_DELAY_MS + 1500 });
const versionsBox = aside.locator('[data-id="map-detail-versions"]');
const widthDuringGhost = (await versionsBox.boundingBox())?.width ?? -1;

// ③ 멤버 실데이터 도착 — 고스트 소멸, 버전 프레임 폭 불변
await ghost.waitFor({ state: "detached", timeout: PERMS_DELAY_MS + 2000 });
await page.waitForTimeout(300);
const widthAfterMembers = (await versionsBox.boundingBox())?.width ?? -2;
const widthStable = Math.abs(widthDuringGhost - widthAfterMembers) < 2;

const pass = spinnerSeen && labelSeen && widthDuringGhost > 0 && widthStable && errors.length === 0;
console.log(
  JSON.stringify(
    { spinnerSeen, labelSeen, widthDuringGhost, widthAfterMembers, widthStable, consoleErrors: errors.length, pass },
    null,
    2,
  ),
);
await browser.close();
process.exit(pass ? 0 : 1);

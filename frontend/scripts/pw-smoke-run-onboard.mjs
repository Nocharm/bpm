// 홈 첫 실행 권유 스모크 — 실행 기록이 없는 사람의 진행 중 실행 타일이 "첫 Run 시작해 보기"로 권하고, 누르면 세 단계 소개 →
// 설명·맵 줄로 넘어간다. 줄을 누르면 그 맵의 최신 게시본에서 새 실행 창이 열리고 주소에 newRun이 남지 않는다. 한 번 펼친 뒤
// 홈에 다시 오면 권유가 없다. 소개는 눌러서 건너뛰고, 모션 축소면 바로 본 칸이다. 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-run-onboard.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-run-onboard.mjs
// 전제: backend는 AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" 로, frontend는 BACKEND_URL=<backend>로 기동.
//       데모 시드처럼 게시본이 있는 맵이 하나 이상, 실행 기록이 없는 직원이 한 명 이상 있어야 한다(USER로 지정 가능).
//       실행은 만들지 않는다. 산출물은 저장소 루트 .shots/run-onboard-*.png(gitignore).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const OUT = "../.shots";

mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function api(user, path) {
  const res = await fetch(`${API}/api${path}`, { headers: { "X-Dev-User": user } });
  if (!res.ok) throw new Error(`GET ${path} as ${user} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// 실행 기록이 없는 직원 — 진행 중·최근 끝남이 모두 0
async function findUserWithoutRuns() {
  if (process.env.USER_ID) return process.env.USER_ID;
  const employees = await api("admin.sys", "/employees");
  for (const employee of employees.filter((e) => e.active)) {
    const dash = await api(employee.login_id, "/me/dashboard");
    if (dash.activity.runs_open === 0 && dash.runs_ended.length === 0) return employee.login_id;
  }
  throw new Error("no employee without runs");
}

const user = await findUserWithoutRuns();
console.log(`user: ${user}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

async function openHome({ reducedMotion = "no-preference", seen = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 }, reducedMotion });
  await ctx.addInitScript(
    ({ devUser, isSeen }) => {
      window.localStorage.setItem("bpm.devUser", devUser);
      window.localStorage.setItem("bpm.lang", "ko");
      // 첫 로드만 기록을 정한다 — 같은 창의 다음 이동은 화면이 남긴 기록을 그대로 쓴다
      if (!window.sessionStorage.getItem("pw.onboardInit")) {
        window.sessionStorage.setItem("pw.onboardInit", "1");
        if (isSeen) window.localStorage.setItem("bpm.runOnboardSeen", "1");
        else window.localStorage.removeItem("bpm.runOnboardSeen");
      }
    },
    { devUser: user, isSeen: seen },
  );
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-activity-runs"]').waitFor({ timeout: 20000 });
  return { ctx, page };
}

const tile = (page) => page.locator('[data-id="home-activity-runs"]');
const intro = (page) => page.locator('[data-id="home-run-onboard-intro"]');
const main = (page) => page.locator('[data-id="home-run-onboard-main"]');

try {
  // ── ① 권유 타일 → 소개 → 본 칸 → 새 실행 창 ──
  {
    const { ctx, page } = await openHome();
    const tileText = await tile(page).innerText();
    check("tile invites the first run", tileText.includes("첫 Run 시작해 보기"), tileText.replace(/\n/g, " | "));
    await page.locator('[data-id="home-activity"]').screenshot({ path: `${OUT}/run-onboard-tile.png` });

    await tile(page).click();
    await intro(page).waitFor({ timeout: 3000 });
    check("tile opens the intro", await intro(page).isVisible());
    await page.waitForTimeout(1100);
    await page.locator('[data-id="home-dashboard-top"]').screenshot({ path: `${OUT}/run-onboard-intro.png` });
    const seenAfterOpen = await page.evaluate(() => window.localStorage.getItem("bpm.runOnboardSeen"));
    check("opening records the seen flag", seenAfterOpen === "1");

    await main(page).waitFor({ timeout: 4000 });
    check("intro hands over to the main panel", (await intro(page).count()) === 0);
    await page.waitForTimeout(300);
    await page.locator('[data-id="home-dashboard-top"]').screenshot({ path: `${OUT}/run-onboard-main.png` });
    const rows = page.locator('[data-id^="home-run-onboard-row-"]');
    const rowCount = await rows.count();
    check("main panel lists 1 to 3 maps", rowCount >= 1 && rowCount <= 3, `${rowCount} rows`);

    // 줄 누름 → 0.6초 지연 이동 → 새 실행 창
    const rowId = await rows.first().getAttribute("data-id");
    const mapId = Number(rowId.replace("home-run-onboard-row-", ""));
    await rows.first().click();
    await page.waitForURL(new RegExp(`/maps/${mapId}`), { timeout: 15000 });
    await page.locator('[data-id="run-start-dialog"]').waitFor({ timeout: 20000 });
    check("row opens the new run dialog on the map", await page.locator('[data-id="run-start-dialog"]').isVisible());
    await page.screenshot({ path: `${OUT}/run-onboard-dialog.png` });
    check("newRun is removed from the address", !page.url().includes("newRun"), page.url());
    const map = await api(user, `/maps/${mapId}`);
    const latestPublished = map.versions.find((v) => v.status === "published");
    check("lands on the latest published version", page.url().includes(`version=${latestPublished.id}`) || !page.url().includes("version="), page.url());
    const versionPill = await page.locator('[data-id="run-start-dialog"]').innerText();
    check("dialog targets the published version", versionPill.includes(`v${latestPublished.version_number}`), versionPill.slice(0, 160).replace(/\n/g, " | "));

    // 창을 닫고(실행은 만들지 않는다) 홈에 다시 오면 권유가 없다
    await page.keyboard.press("Escape");
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await tile(page).waitFor({ timeout: 20000 });
    const tileAgain = await tile(page).innerText();
    check("no invitation on the next home visit", !tileAgain.includes("첫 Run 시작해 보기"), tileAgain.replace(/\n/g, " | "));
    await ctx.close();
  }

  // ── ② 소개를 눌러 건너뛰기 ──
  {
    const { ctx, page } = await openHome();
    await tile(page).click();
    await intro(page).waitFor({ timeout: 3000 });
    await intro(page).click();
    await main(page).waitFor({ timeout: 1000 });
    check("clicking the intro skips to the main panel", await main(page).isVisible());
    await ctx.close();
  }

  // ── ③ 모션 축소는 소개 없이 본 칸 ──
  {
    const { ctx, page } = await openHome({ reducedMotion: "reduce" });
    await tile(page).click();
    await main(page).waitFor({ timeout: 1000 });
    check("reduced motion skips the intro", (await intro(page).count()) === 0);
    await ctx.close();
  }

  // ── ④ 이미 본 사람은 평소 타일 ──
  {
    const { ctx, page } = await openHome({ seen: true });
    const tileText = await tile(page).innerText();
    check("seen flag shows the usual tile", !tileText.includes("첫 Run 시작해 보기"), tileText.replace(/\n/g, " | "));
    await ctx.close();
  }
} catch (err) {
  failures += 1;
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);

// 맵 화면 Run 소개 말풍선 스모크 — Run을 해 본 적 없는 사람이 게시본 맵에 들어오면 Run 버튼 아래 말풍선이 뜨고 스스로 사라진다.
// 마우스를 올린 동안은 멈추고, 그냥 사라지면 다음 진입에 다시 뜬다. Run 메뉴를 직접 열면 거둔다. [Run 시작하기]는 새 Run 창을
// 열고, Run을 만들면 브라우저 기록이 남아 더는 뜨지 않는다(만든 Run은 API로 지운다). Draft에선 뜨지 않고, 모션 축소에서도 뜬다. 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-run-intro.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-run-intro.mjs
// 전제: backend는 AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" 로, frontend는 BACKEND_URL=<backend>로 기동.
//       데모 시드처럼 게시본이 있는 맵과 Run 기록이 없는 직원이 있어야 한다(USER_ID로 지정 가능). 산출물은 저장소 루트 .shots/run-intro-*.png.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const OUT = "../.shots";
const DONE_KEY = "bpm.runIntroDone";
const SHOW_MS = 6000; // lib/run-intro RUN_INTRO_SHOW_MS

mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function api(user, path, method = "GET") {
  const res = await fetch(`${API}/api${path}`, { method, headers: { "X-Dev-User": user } });
  if (!res.ok) throw new Error(`${method} ${path} as ${user} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Run 기록이 없는 직원 — 진행 중·최근 끝남이 모두 0
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
const maps = await api(user, "/maps");
const target = maps.find((m) => m.published_version_number != null && m.my_role !== null && !m.deleted_at && m.mode !== "framework");
if (!target) throw new Error(`no published map visible to ${user}`);
const detail = await api(user, `/maps/${target.id}`);
const published = detail.versions.find((v) => v.status === "published");
const draft = detail.versions.find((v) => v.status === "draft");
console.log(`user: ${user}, map: ${target.id} (published v${published.id}${draft ? `, draft v${draft.id}` : ""})`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

async function openContext({ reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 }, reducedMotion });
  await ctx.addInitScript(
    ({ devUser, doneKey }) => {
      window.localStorage.setItem("bpm.devUser", devUser);
      window.localStorage.setItem("bpm.lang", "ko");
      // 첫 로드만 기록을 비운다 — 같은 창의 다음 이동은 화면이 남긴 기록을 그대로 쓴다
      if (!window.sessionStorage.getItem("pw.introInit")) {
        window.sessionStorage.setItem("pw.introInit", "1");
        window.localStorage.removeItem(doneKey);
      }
    },
    { devUser: user, doneKey: DONE_KEY },
  );
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  return { ctx, page };
}

async function gotoMap(page, versionId) {
  await page.goto(`${BASE}/maps/${target.id}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.locator('[data-id="run-menu"]').waitFor({ timeout: 30000 });
}

const bubble = (page) => page.locator('[data-id="run-intro"]');
const readDone = (page) => page.evaluate((key) => window.localStorage.getItem(key), DONE_KEY);

try {
  const { ctx, page } = await openContext();

  // ① 게시본 진입 → 말풍선이 Run 버튼 아래에 뜬다
  await gotoMap(page, published.id);
  await bubble(page).waitFor({ timeout: 8000 }).catch(() => {});
  check("bubble appears on the published version", await bubble(page).isVisible());
  const text = (await bubble(page).textContent()) ?? "";
  const bodyBox = await bubble(page).locator("p").last().boundingBox();
  const shellBox = await bubble(page).boundingBox();
  check("bubble body wraps inside the bubble", bodyBox && shellBox && bodyBox.x + bodyBox.width <= shellBox.x + shellBox.width, JSON.stringify({ bodyBox, shellBox }));
  check("bubble copy uses Run", text.includes("새 기능 · Run") && text.includes("Run 시작하기"), text);
  const menuBox = await page.locator('[data-id="run-menu"]').boundingBox();
  const bubbleBox = await bubble(page).boundingBox();
  check(
    "bubble sits right under the Run button",
    menuBox && bubbleBox && bubbleBox.y > menuBox.y + menuBox.height && Math.abs(bubbleBox.x + bubbleBox.width - (menuBox.x + menuBox.width)) < 2,
    JSON.stringify({ menuBox, bubbleBox }),
  );
  await page.screenshot({ path: `${OUT}/run-intro-shown.png`, clip: { x: bubbleBox.x - 360, y: 0, width: 1480 - (bubbleBox.x - 360), height: bubbleBox.y + bubbleBox.height + 40 } });

  // ② 마우스를 올린 동안은 멈추고, 떼면 남은 시간 뒤 스스로 사라진다
  await bubble(page).hover();
  await page.waitForTimeout(SHOW_MS + 1000);
  check("hover pauses the auto-dismiss", await bubble(page).isVisible());
  await page.mouse.move(700, 600);
  await bubble(page).waitFor({ state: "detached", timeout: SHOW_MS + 2000 }).catch(() => {});
  check("bubble dismisses itself without a click", (await bubble(page).count()) === 0);
  check("auto-dismiss leaves no done flag", (await readDone(page)) === null);

  // ③ 다시 들어오면 또 뜨고, Run 메뉴를 직접 열면 거둔다
  await gotoMap(page, published.id);
  await bubble(page).waitFor({ timeout: 8000 }).catch(() => {});
  check("bubble shows again on the next visit", await bubble(page).isVisible());
  await page.locator('[data-id="run-menu"]').click();
  check("opening the Run menu hides the bubble", (await bubble(page).count()) === 0 && (await page.locator('[data-id="run-menu-pop"]').isVisible()));
  await page.keyboard.press("Escape");

  // ④ [Run 시작하기] → 새 Run 창 → 만들면 기록이 남는다
  await gotoMap(page, published.id);
  await bubble(page).waitFor({ timeout: 8000 });
  await page.locator('[data-id="run-intro-start"]').click();
  await page.locator('[data-id="run-start-dialog"]').waitFor({ timeout: 5000 });
  check("start button opens the new run dialog", (await bubble(page).count()) === 0);
  await page.locator('[data-id="run-start-name"]').fill(`Run 소개 스모크 ${Date.now()}`);
  await page.locator('[data-id="run-start-submit"]').click();
  await page.waitForURL((url) => url.searchParams.get("run") !== null, { timeout: 10000 });
  const runId = Number(new URL(page.url()).searchParams.get("run"));
  check("creating a run records the done flag", (await readDone(page)) === "1", `run ${runId}`);

  // ⑤ 기록이 있으면 더는 뜨지 않는다(Run 화면을 떠난 뒤 만든 Run을 지운다 — 열린 화면에서 지우면 이력 읽기가 404)
  await gotoMap(page, published.id);
  await api(user, `/runs/${runId}`, "DELETE");
  await page.waitForTimeout(3000);
  check("no bubble after a run was started", (await bubble(page).count()) === 0);
  await ctx.close();

  // ⑥ Draft에서는 뜨지 않는다(Run 버튼이 꺼진 버전)
  if (draft) {
    const { ctx: draftCtx, page: draftPage } = await openContext();
    await gotoMap(draftPage, draft.id);
    await draftPage.waitForTimeout(3000);
    check("no bubble on a Draft", (await bubble(draftPage).count()) === 0);
    await draftCtx.close();
  } else {
    console.log("SKIP no Draft on this map");
  }

  // ⑦ 모션 축소에서도 뜬다(등장·막대 애니메이션만 없다)
  {
    const { ctx: calmCtx, page: calmPage } = await openContext({ reducedMotion: "reduce" });
    await gotoMap(calmPage, published.id);
    await bubble(calmPage).waitFor({ timeout: 8000 }).catch(() => {});
    check("bubble appears with reduced motion", await bubble(calmPage).isVisible());
    await calmCtx.close();
  }
} finally {
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  await browser.close();
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

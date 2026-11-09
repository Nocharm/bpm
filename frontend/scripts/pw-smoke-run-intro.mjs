// 맵 화면 Run 소개 말풍선 스모크 — Run을 해 본 적 없는 사람이 게시본 맵에 들어오면 Run 버튼 아래 말풍선이 뜨고 스스로 사라진다.
// 마우스를 올린 동안은 멈추고, 그냥 사라지면 다음 진입에 다시 뜬다. Run 메뉴를 직접 열면 거둔다. [Run 시작하기]는 새 Run 창을
// 열고, Run을 만들면 브라우저 기록이 남아 더는 뜨지 않는다(만든 Run은 API로 지운다). Draft에선 게시본 안내+[게시본으로 가기]로 뜨고
// Run 메뉴도 새 Run 대신 게시본으로 보낸다. 게시본 없는 맵은 안내만(버튼 꺼짐). 모션 축소에서도 뜬다. 콘솔 에러 0.
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
const SHOW_MS = 3000; // lib/run-intro RUN_INTRO_SHOW_MS

mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function api(user, path, method = "GET", body = undefined) {
  const headers = { "X-Dev-User": user, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
  const res = await fetch(`${API}/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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
// 게시본이 한 번도 없는 맵 — 말풍선은 안내만, Run 버튼은 꺼짐. 시드에 없으면 빈 맵을 만들고 끝에 휴지통으로 보낸다
// (휴지통 맵도 이름을 쥐고 있어 이름에 시각을 붙인다)
const UNPUBLISHED_NAME = "Run intro smoke unpublished";
for (const stale of maps.filter((m) => m.name.startsWith(UNPUBLISHED_NAME) && !m.deleted_at)) {
  await api(user, `/maps/${stale.id}`, "DELETE").catch(() => undefined);
}
let unpublished = maps.find((m) => m.published_version_number == null && m.my_role !== null && !m.deleted_at && m.mode !== "framework" && !m.name.startsWith(UNPUBLISHED_NAME));
let createdUnpublishedId = null;
if (!unpublished) {
  const directory = await api(user, "/directory");
  const owning = (directory.users.find((u) => u.id === user) ?? directory.users[0])?.org_path;
  unpublished = await api(user, "/maps", "POST", { name: `${UNPUBLISHED_NAME} ${Date.now()}`, owning_department: owning, visibility: "private" });
  createdUnpublishedId = unpublished.id;
}

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

async function gotoMap(page, versionId, mapId = target.id) {
  await page.goto(`${BASE}/maps/${mapId}${versionId !== null ? `?version=${versionId}` : ""}`, { waitUntil: "networkidle" });
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

  // ⑥ Draft — 말풍선은 게시본 안내+[게시본으로 가기], Run 메뉴도 새 Run 대신 게시본으로 보낸다
  if (draft) {
    const { ctx: draftCtx, page: draftPage } = await openContext();
    await gotoMap(draftPage, draft.id);
    await bubble(draftPage).waitFor({ timeout: 8000 }).catch(() => {});
    const draftText = (await bubble(draftPage).textContent()) ?? "";
    check("Draft bubble points to the published version", draftText.includes("Run은 게시본에서 시작할 수 있어요.") && (await draftPage.locator('[data-id="run-intro-go-published"]').isVisible()), draftText);
    const draftBox = await bubble(draftPage).boundingBox();
    if (draftBox) await draftPage.screenshot({ path: `${OUT}/run-intro-draft.png`, clip: { x: draftBox.x - 360, y: 0, width: 1480 - (draftBox.x - 360), height: draftBox.y + draftBox.height + 40 } });
    await draftPage.locator('[data-id="run-menu"]').click();
    check(
      "Draft Run menu offers Go to published instead of New run",
      (await draftPage.locator('[data-id="run-menu-go-published"]').isVisible()) && (await draftPage.locator('[data-id="run-menu-new"]').count()) === 0,
    );
    await draftPage.locator('[data-id="run-menu-pop"]').screenshot({ path: `${OUT}/run-intro-draft-menu.png` });
    await draftPage.locator('[data-id="run-menu-go-published"]').click();
    // 편집 중인 Draft면 버전 전환 확인 창을 거친다
    const confirm = draftPage.locator('[data-id="confirm-dialog-confirm"]');
    await confirm.waitFor({ timeout: 1500 }).then(() => confirm.click()).catch(() => console.log("  (no switch confirm: read-only Draft)"));
    await draftPage.locator('[data-id="run-menu"]').click();
    await draftPage.locator('[data-id="run-menu-new"]').waitFor({ timeout: 8000 }).catch(() => {});
    check("Go to published lands on a version that can start a run", await draftPage.locator('[data-id="run-menu-new"]').isVisible());
    await draftCtx.close();
  } else {
    console.log("SKIP no Draft on this map");
  }

  // ⑥-2 게시본이 없는 맵 — 말풍선은 안내만(버튼 없음), Run 버튼은 꺼져 있다
  if (unpublished) {
    const { ctx: noPubCtx, page: noPubPage } = await openContext();
    await gotoMap(noPubPage, null, unpublished.id);
    await bubble(noPubPage).waitFor({ timeout: 8000 }).catch(() => {});
    // 빈 새 맵이면 AI 컨설턴트 온보딩 카드도 뜬다 — Run 말풍선은 숨지 않고 그 카드 오른쪽에 좁게 한 줄로 놓인다
    const aiCard = noPubPage.locator('[data-id="consult-onboard"]');
    if (await aiCard.isVisible()) {
      await noPubPage.waitForTimeout(400); // 등장 애니메이션(220ms)이 끝난 자리로 잰다
      const aiBox = await aiCard.boundingBox();
      const runBox = await bubble(noPubPage).boundingBox();
      const menuBox = await noPubPage.locator('[data-id="run-menu"]').boundingBox();
      check(
        "Run bubble sits beside the AI consultant card on one row without overlap",
        aiBox && runBox && runBox.x >= aiBox.x + aiBox.width && Math.abs(runBox.y - aiBox.y) < 2 && runBox.x + runBox.width <= 1480,
        JSON.stringify({ aiBox, runBox }),
      );
      const compactText = (await bubble(noPubPage).textContent()) ?? "";
      check("narrow Run card folds body and notice into one sentence", compactText.includes("게시 후 단계를 체크하며 업무를 진행해 볼 수 있어요.") && (await bubble(noPubPage).locator("p").count()) === 2, compactText);
      check("Run bubble stays under the Run button", menuBox && runBox.x <= menuBox.x + menuBox.width / 2 && runBox.x + runBox.width >= menuBox.x + menuBox.width / 2);
      await noPubPage.screenshot({ path: `${OUT}/run-intro-stacked.png`, clip: { x: 760, y: 0, width: 720, height: Math.max(runBox.y + runBox.height, aiBox.y + aiBox.height) + 30 } });
      // AI 카드에 올려도 멈추고, 떼면 둘이 같이 닫힌다(기록은 남기지 않음)
      await aiCard.hover();
      await noPubPage.waitForTimeout(SHOW_MS + 800);
      check("hovering the AI card pauses the pair", (await bubble(noPubPage).isVisible()) && (await aiCard.isVisible()));
      await noPubPage.mouse.move(400, 700);
      await bubble(noPubPage).waitFor({ state: "detached", timeout: SHOW_MS + 2000 }).catch(() => {});
      check("the AI card closes together with the Run bubble", (await bubble(noPubPage).count()) === 0 && (await aiCard.count()) === 0);
      check(
        "closing together records neither card as seen",
        (await noPubPage.evaluate((key) => window.localStorage.getItem(key), `bpm.consultOnboardSeen.${unpublished.id}`)) === null && (await readDone(noPubPage)) === null,
      );
      await gotoMap(noPubPage, null, unpublished.id);
      await bubble(noPubPage).waitFor({ timeout: 8000 }).catch(() => {});
      check("both show again on the next visit", (await bubble(noPubPage).isVisible()) && (await aiCard.isVisible()));
      // AI 카드를 본 뒤의 진입 — Run 카드는 혼자 기본 폭으로 뜬다
      await noPubPage.evaluate((key) => window.localStorage.setItem(key, "1"), `bpm.consultOnboardSeen.${unpublished.id}`);
      await gotoMap(noPubPage, null, unpublished.id);
      await bubble(noPubPage).waitFor({ timeout: 8000 }).catch(() => {});
    }
    const noPubText = (await bubble(noPubPage).textContent()) ?? "";
    check(
      "unpublished map bubble says runs start once published",
      noPubText.includes("게시본이 생기면 Run을 시작할 수 있어요.") && (await bubble(noPubPage).locator("button").count()) === 0,
      noPubText,
    );
    check("Run button stays off on an unpublished map", (await noPubPage.locator('[data-id="run-menu"]').getAttribute("aria-disabled")) === "true");
    const noPubBox = await bubble(noPubPage).boundingBox();
    if (noPubBox) await noPubPage.screenshot({ path: `${OUT}/run-intro-unpublished.png`, clip: { x: noPubBox.x - 360, y: 0, width: 1480 - (noPubBox.x - 360), height: noPubBox.y + noPubBox.height + 40 } });
    // 말풍선이 사라진 뒤 꺼진 Run 버튼의 이유 툴팁
    await bubble(noPubPage).waitFor({ state: "detached", timeout: SHOW_MS + 2000 }).catch(() => {});
    await noPubPage.locator('[data-id="run-menu"]').hover();
    await noPubPage.waitForTimeout(800);
    await noPubPage.screenshot({ path: `${OUT}/run-intro-unpublished-tooltip.png`, clip: { x: 760, y: 0, width: 720, height: 220 } });
    await noPubCtx.close();
  } else {
    console.log("SKIP no unpublished map visible to this user");
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
  if (createdUnpublishedId !== null) await api(user, `/maps/${createdUnpublishedId}`, "DELETE").catch((e) => console.log("cleanup skipped:", String(e).slice(0, 120)));
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  await browser.close();
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

// 실행 진입·새 실행 창·실행 바 스모크 — 헤더 Run(Draft에선 꺼짐) → 새 실행(공유·참여자 2명) → 실행 화면 이동 →
// 실행 바 진행 0/n·참여자·버전 필 잠금 → 영구 보존 토글 → 중단(확인) → 중단 줄·다시 열기 → 닫기(주소에서 run 빠짐)·뒤로 가기로
// 다시 실행 모드(주소 동기화) → 없는 실행(오류 줄·닫기) → 실행 삭제 → 나만 → 공유 전환·참여자 더하기/빼기 →
// 지난 게시본 실행(안내 단계·안내 줄·현재 버전 열기) → 개인 상한(409) 창 안 정리 목록. 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-run-start.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-run-start.mjs
// 전제: backend는 AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" 로, frontend는 BACKEND_URL=<backend>로 기동.
//       MAP_ID(기본 30)는 게시본과 Draft를 하나씩 가진 일반 맵이어야 하고, 참여자 후보(eligible-approvers)가 2명 이상이어야 한다.
//       OLD_MAP_ID(기본 12)는 지난 게시본(expired)과 게시본을 함께 가진 일반 맵. 개인 상한은 설정 기본값(10)을 가정한다.
//       만든 실행은 끝에 화면에서 지운다(KEEP=1이면 남긴다). 산출물은 저장소 루트 .shots/run-start.png·run-bar.png(gitignore).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const MAP_ID = Number(process.env.MAP_ID ?? 30);
const OLD_MAP_ID = Number(process.env.OLD_MAP_ID ?? 12);
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const ADMIN = "admin.sys";

mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function api(method, path, body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Dev-User": ADMIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const map = await api("GET", `/maps/${MAP_ID}`);
const published = map.versions.find((v) => v.status === "published");
const draft = map.versions.find((v) => v.status === "draft");
if (!published || !draft) throw new Error(`map ${MAP_ID} needs a published and a draft version`);
const eligible = (await api("GET", `/maps/${MAP_ID}/eligible-approvers`)).filter((u) => u.id !== ADMIN);
if (eligible.length < 2) throw new Error(`map ${MAP_ID} needs two eligible participants`);
const [personA, personB] = eligible;
const runName = `스모크 공유 실행 · LOT ${Date.now().toString(36)}`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 } });
await ctx.addInitScript((devUser) => {
  window.localStorage.setItem("bpm.devUser", devUser);
  window.localStorage.setItem("bpm.lang", "ko");
}, ADMIN);
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

const runMenu = page.locator('[data-id="run-menu"]');
const runBar = page.locator('[data-id="run-bar"]');
let runId = null;
// API·화면으로 만든 실행 — 끝에 지운다
const createdRunIds = [];

async function pickPerson(scope, loginId) {
  const input = scope.locator('input[type="text"]:not([data-id])').last();
  await input.click();
  await input.fill(loginId);
  // 포털로 뜬 목록의 첫 줄을 누른다 — 팝오버가 바깥 누름으로 오인해 닫히지 않는지도 함께 본다
  const option = page.locator('[data-id="principal-picker-dropdown"] button').first();
  await option.waitFor();
  await option.click();
}

try {
  // 1) Draft에선 Run 버튼이 꺼지고 이유 툴팁
  await page.goto(`${BASE}/maps/${MAP_ID}?version=${draft.id}`);
  await runMenu.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-id="run-menu"]')?.getAttribute("aria-disabled") === "true");
  await runMenu.hover();
  const tip = page.locator('[role="tooltip"]', { hasText: "Draft" });
  await tip.waitFor({ timeout: 3000 }).catch(() => console.warn("draft tooltip did not appear within 3s"));
  check("draft: run button off with reason", (await runMenu.getAttribute("aria-disabled")) === "true" && (await tip.count()) > 0);

  // 2) 게시본에서 Run → 새 실행
  await page.goto(`${BASE}/maps/${MAP_ID}?version=${published.id}`);
  await page.waitForFunction(() => document.querySelector('[data-id="run-menu"]')?.getAttribute("aria-disabled") === "false");
  await runMenu.click();
  await page.locator('[data-id="run-menu-pop"]').waitFor();
  await page.locator('[data-id="run-menu-loading"]').waitFor({ state: "detached" });
  check("menu: open list loaded", (await page.locator('[data-id="run-menu-pop"]').textContent()).includes("진행 중"));
  await page.locator('[data-id="run-menu-new"]').click();
  const dialog = page.locator('[data-id="run-start-dialog"]');
  await dialog.waitFor();
  check(
    "dialog: default version is the screen's published version",
    (await page.locator('[data-id="run-start-version"]').textContent()).includes(published.label),
  );
  await page.locator('[data-id="run-start-name"]').fill(runName);
  await page.locator('[data-id="run-start-scope-shared"]').click();
  const pickerInput = dialog.locator("input:not([data-id])");
  for (const person of [personA, personB]) {
    await pickerInput.click();
    await pickerInput.fill(person.id);
    await page.locator('[data-id="principal-picker-dropdown"] button').first().waitFor();
    await pickerInput.press("Enter");
    await dialog.locator(`[data-id="run-start-participant-${person.id}"]`).waitFor();
  }
  await page.locator('[data-id="run-start-name"]').click(); // 피커 목록 닫기
  check("dialog: two participants picked", (await dialog.locator('[data-id^="run-start-participant-"]').count()) === 2);
  await page.screenshot({ path: `${OUT}/run-start.png` });

  // 3) 실행 시작 → 실행 화면
  await page.locator('[data-id="run-start-submit"]').click();
  await page.waitForURL(/[?&]run=\d+/);
  runId = Number(new URL(page.url()).searchParams.get("run"));
  await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  const progress = (await page.locator('[data-id="run-bar-progress"]').textContent()) ?? "";
  check("bar: progress 0 / n", /완료 0 \/ 전체 [1-9]\d*/.test(progress), progress);
  check("bar: name", (await page.locator('[data-id="run-bar-name"]').textContent()) === runName);
  check(
    "bar: shared with 3 people",
    ((await page.locator('[data-id="run-bar-scope-shared"]').textContent()) ?? "").includes("3명"),
  );
  check("bar: participant pills", (await page.locator('[data-id="run-bar-participants"] > span').count()) === 3);
  check("run mode: canvas read-only (no save)", await page.locator('[data-id="editor-save"]').isDisabled());
  const pillLocked = await page.locator('header [aria-label][aria-disabled="true"]').count();
  check("run mode: version pill locked", pillLocked > 0);

  // 4) 영구 보존 토글
  const keep = page.locator('[data-id="run-bar-keep"]');
  await keep.click();
  await page.waitForFunction(() => document.querySelector('[data-id="run-bar-keep"]')?.getAttribute("aria-pressed") === "true");
  check("bar: keep on", (await keep.getAttribute("aria-pressed")) === "true");
  // 토스트(2.5초 유지)가 실행 바 오른쪽을 덮지 않게 사라진 뒤 찍는다
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `${OUT}/run-bar.png` });
  await runMenu.click();
  await page.locator(`[data-id="run-menu-row-${runId}"]`).waitFor();
  check("menu: new run listed", true);
  await page.screenshot({ path: `${OUT}/run-menu.png` });
  await page.keyboard.press("Escape");
  await page.locator('[data-id="run-menu-pop"]').waitFor({ state: "detached" });

  // 5) 중단(확인 한 단계) → 중단 줄 + 다시 열기
  await page.locator('[data-id="run-bar-more"]').click();
  await page.locator('[data-id="run-bar-stop"]').click();
  await page.locator('[data-id="run-bar-stop-confirm"]').waitFor();
  await page.locator('[data-id="run-bar-stop-confirm"] [data-id="confirm-dialog-confirm"]').click();
  await page.locator('[data-id="run-bar-stopped"]').waitFor();
  check("stopped: notice line with reopen", (await page.locator('[data-id="run-bar-reopen"]').count()) === 1);
  await page.screenshot({ path: `${OUT}/run-bar-stopped.png` });
  await page.locator('[data-id="run-bar-reopen"]').click();
  await page.locator('[data-id="run-bar-stopped"]').waitFor({ state: "detached" });
  check("reopen: notice line gone", true);

  // 6) 닫기 → 주소에서 run이 빠지고 실행 바가 사라짐 → 뒤로 가기로 다시 실행 모드(주소 동기화)
  await page.locator('[data-id="run-bar-close"]').click();
  await page.waitForURL((url) => !url.searchParams.has("run"));
  await runBar.waitFor({ state: "detached" });
  check("close: plain map on the same version", new URL(page.url()).searchParams.get("version") === String(published.id));
  await page.goBack();
  await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  check("back: run mode again via URL sync", new URL(page.url()).searchParams.get("run") === String(runId));

  // 7) 없는 실행 — 오류 줄 + 닫기, 캔버스는 읽기 전용 유지
  await page.goto(`${BASE}/maps/${MAP_ID}?version=${published.id}&run=99999999`);
  await page.locator('[data-id="run-bar"][data-state="error"]').waitFor();
  check("missing run: error line", (await page.locator('[data-id="run-bar-error"]').count()) === 1);
  check("missing run: still read-only", await page.locator('[data-id="editor-save"]').isDisabled());
  await page.locator('[data-id="run-bar-close"]').click();
  await page.waitForURL((url) => !url.searchParams.has("run"));
  check("missing run: closed", (await runBar.count()) === 0);

  // 8) 실행 삭제(확인) — 맵 화면으로 돌아온다
  if (!KEEP) {
    await page.goto(`${BASE}/maps/${MAP_ID}?version=${published.id}&run=${runId}`);
    await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
    await page.locator('[data-id="run-bar-more"]').click();
    await page.locator('[data-id="run-bar-delete"]').click();
    await page.locator('[data-id="run-bar-delete-confirm"] [data-id="confirm-dialog-confirm"]').click();
    await page.waitForURL((url) => !url.searchParams.has("run"));
    check("delete: run gone", (await runBar.count()) === 0);
    runId = null;
  }

  // 9) 나만 → 공유 전환(작은 창) → 참여자 편집 팝오버로 더하기·빼기
  const solo = await api("POST", `/maps/${MAP_ID}/runs`, {
    name: `스모크 나만 실행 ${Date.now().toString(36)}`,
    version_id: published.id,
    scope: "solo",
    participants: [],
  });
  createdRunIds.push(solo.id);
  await page.goto(`${BASE}/maps/${MAP_ID}?version=${published.id}&run=${solo.id}`);
  await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  check("solo: no participant pills", (await page.locator('[data-id="run-bar-participants"]').count()) === 0);
  await page.locator('[data-id="run-bar-scope-shared"]').click();
  const shareDialog = page.locator('[data-id="run-share-dialog"]');
  await shareDialog.waitFor();
  check("share: submit off until someone is picked", await page.locator('[data-id="run-share-submit"]').isDisabled());
  await pickPerson(shareDialog, personA.id);
  await shareDialog.locator(`[data-id="run-share-participant-${personA.id}"]`).waitFor();
  await shareDialog.locator("h2").click();
  await page.locator('[data-id="run-share-submit"]').click();
  await shareDialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector('[data-id="run-bar-scope-shared"]')?.getAttribute("aria-pressed") === "true");
  check(
    "share: bar shows shared · 2",
    ((await page.locator('[data-id="run-bar-scope-shared"]').textContent()) ?? "").includes("2명"),
  );
  check("share: solo tab locked", (await page.locator('[data-id="run-bar-scope-solo"]').getAttribute("aria-disabled")) === "true");
  await page.locator('[data-id="run-bar-participants-edit"]').click();
  const peoplePop = page.locator('[data-id="run-bar-participants-pop"]');
  await peoplePop.waitFor();
  await pickPerson(peoplePop, personB.id);
  await peoplePop.locator(`[data-id="run-bar-participant-${personB.id}"]`).waitFor();
  check("participants: added in the popover", true);
  check("participants: popover stays open after a pick", await peoplePop.isVisible());
  await peoplePop.locator(`[data-id="run-bar-participant-remove-${personB.id}"]`).click();
  await peoplePop.locator(`[data-id="run-bar-participant-${personB.id}"]`).waitFor({ state: "detached" });
  check("participants: removed", true);
  check("participants: starter has no remove", (await peoplePop.locator(`[data-id="run-bar-participant-remove-${ADMIN}"]`).count()) === 0);
  await page.keyboard.press("Escape");
  await peoplePop.waitFor({ state: "detached" });

  // 10) 지난 게시본 — 안내 단계 → 지난 게시본으로 계속 → 안내 줄 → 현재 버전 열어 보기
  const oldMap = await api("GET", `/maps/${OLD_MAP_ID}`);
  const oldVersion = oldMap.versions.filter((v) => v.status === "expired").at(-1);
  const oldPublished = oldMap.versions.find((v) => v.status === "published");
  await page.goto(`${BASE}/maps/${OLD_MAP_ID}?version=${oldVersion.id}`);
  await page.waitForFunction(() => document.querySelector('[data-id="run-menu"]')?.getAttribute("aria-disabled") === "false");
  await runMenu.click();
  await page.locator('[data-id="run-menu-new"]').click();
  await page.locator('[data-id="run-start-name"]').fill(`스모크 지난 게시본 ${Date.now().toString(36)}`);
  await page.locator('[data-id="run-start-submit"]').click();
  await page.locator('[data-id="run-start-old"]').waitFor();
  check("old: guidance step before creating", (await page.locator('[data-id="run-start-old-current"]').count()) === 1);
  await page.locator('[data-id="run-start-old-continue"]').click();
  await page.waitForURL(/[?&]run=\d+/);
  createdRunIds.push(Number(new URL(page.url()).searchParams.get("run")));
  await page.locator('[data-id="run-bar-old-version"]').waitFor();
  check("old: notice line above the bar", true);
  await page.locator('[data-id="run-bar-open-current"]').click();
  await page.waitForURL((url) => !url.searchParams.has("run"));
  await runBar.waitFor({ state: "detached" });
  await page.waitForFunction(
    (title) => document.querySelector('[data-id="editor-readonly-notice"]')?.textContent?.includes(title),
    "Published",
  );
  check(
    "old: open current leaves the run on the published version",
    new URL(page.url()).searchParams.get("version") === String(oldPublished.id),
  );

  // 11) 개인 상한 — API로 상한까지 채운 뒤 화면에서 만들면 창 안에 정리할 실행 목록, 중단하면 다시 시작
  for (let i = 0; i < 15; i += 1) {
    try {
      const filler = await api("POST", `/maps/${MAP_ID}/runs`, {
        name: `스모크 상한 채우기 ${i}`,
        version_id: published.id,
        scope: "solo",
        participants: [],
      });
      createdRunIds.push(filler.id);
    } catch (err) {
      if (!String(err).includes("open solo run limit reached")) throw err;
      break;
    }
  }
  const fillerId = createdRunIds.at(-1);
  await page.goto(`${BASE}/maps/${MAP_ID}?version=${published.id}`);
  await page.waitForFunction(() => document.querySelector('[data-id="run-menu"]')?.getAttribute("aria-disabled") === "false");
  await runMenu.click();
  await page.locator('[data-id="run-menu-new"]').click();
  await page.locator('[data-id="run-start-name"]').fill(`스모크 상한 ${Date.now().toString(36)}`);
  await page.locator('[data-id="run-start-submit"]').click();
  await page.locator(`[data-id="run-start-cap-stop-${fillerId}"]`).waitFor();
  check("cap: solo runs listed in the dialog", (await page.locator('[data-id^="run-start-cap-row-"]').count()) >= 1);
  await page.screenshot({ path: `${OUT}/run-start-cap.png` });
  await page.locator(`[data-id="run-start-cap-stop-${fillerId}"]`).click();
  await page.locator(`[data-id="run-start-cap-row-${fillerId}"]`).waitFor({ state: "detached" });
  await page.locator('[data-id="run-start-submit"]').click();
  await page.waitForURL(/[?&]run=\d+/);
  createdRunIds.push(Number(new URL(page.url()).searchParams.get("run")));
  check("cap: stopping one frees a slot", true);
} finally {
  if (runId !== null) createdRunIds.push(runId);
  if (!KEEP) {
    for (const id of createdRunIds) {
      await api("DELETE", `/runs/${id}`).catch((err) => console.warn("cleanup: run delete failed", { id, err: String(err) }));
    }
  }
  // 기대한 실패만 거른다 — 없는 실행(404)과 개인 상한(409) 단계
  const relevant = consoleErrors.filter(
    (text) =>
      !text.includes("99999999") &&
      !text.includes("status of 404") &&
      !text.includes("open solo run limit reached") &&
      !text.includes("status of 409"),
  );
  check("console errors", relevant.length === 0, relevant.slice(0, 3).join(" | "));
  await browser.close();
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);

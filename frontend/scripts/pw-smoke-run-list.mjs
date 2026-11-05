// 모든 실행 창 스모크 — 실행 메뉴 "모든 실행 보기" → 진행 중 탭 8줄 쪽 나눔·이름 검색(디바운스)·"내가 참여한 것만" 거르기 →
// 영구 보존 책갈피(켜기·"영구 보존만"·끄면 줄이 빠짐) → 끝남 탭(요약까지 남은 날) → 요약 탭(보존 거르기 숨김·줄은 열리지 않음) →
// 줄을 누르면 창이 닫히고 그 실행으로 이동 → Esc로 닫기. 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-run-list.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-run-list.mjs
// 전제: backend는 AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" 로, frontend는 BACKEND_URL=<backend>로 기동.
//       MAP_ID(기본 30)는 게시본을 가진 일반 맵이고 참여자 후보(eligible-approvers)가 2명 이상이어야 한다.
//       스모크가 이름 표식(TAG)으로 만든 실행만 다루고 끝에 지운다(KEEP=1이면 남긴다). 요약 줄은 API로 만들 수 없어
//       요약 탭은 "이미 있으면" 줄 모양을 본다. 산출물은 저장소 루트 .shots/run-list*.png(gitignore).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const MAP_ID = Number(process.env.MAP_ID ?? 30);
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const ADMIN = "admin.sys";
const TAG = `LOT ${Date.now().toString(36)}`;

mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function api(method, path, body, user = ADMIN) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Dev-User": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const map = await api("GET", `/maps/${MAP_ID}`);
const published = map.versions.find((v) => v.status === "published");
if (!published) throw new Error(`map ${MAP_ID} needs a published version`);
const eligible = (await api("GET", `/maps/${MAP_ID}/eligible-approvers`)).filter((u) => u.id !== ADMIN);
if (eligible.length < 2) throw new Error(`map ${MAP_ID} needs two eligible participants`);
const [personA, personB] = eligible;

// 이름 표식이 같은 실행만 다룬다 — 맵에 다른 실행이 있어도 개수가 흔들리지 않게 검색으로 좁힌다
const created = [];
async function createRun(label, { user = ADMIN, scope = "shared", participants = [personA.id] } = {}) {
  const run = await api(
    "POST",
    `/maps/${MAP_ID}/runs`,
    { name: `${label} · ${TAG}`, version_id: published.id, scope, participants },
    user,
  );
  created.push({ id: run.id, user });
  return run;
}

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

const modal = page.locator('[data-id="run-list-modal"]');
const rows = page.locator('[data-id^="run-list-row-"]');
const range = page.locator('[data-id="run-list-range"]');
const search = page.locator('[data-id="run-list-search"]');

// 목록이 새로 읽힌 뒤(읽는 중 표시가 꺼진 뒤)의 상태를 본다
async function settle() {
  await page.waitForFunction(() => document.querySelector('[data-id="run-list-rows"]')?.getAttribute("aria-busy") === "false");
}

try {
  // 열린 실행 9개(내가 시작, 참여자 1명) + 남이 시작해 나는 참여자가 아닌 1개 + 끝낼 1개
  for (let i = 1; i <= 9; i += 1) await createRun(`입고 ${String(i).padStart(2, "0")}`);
  await createRun("긴급 입고", { user: personA.id, participants: [personB.id] });
  const toEnd = await createRun("끝낼 입고");
  await api("POST", `/runs/${toEnd.id}/stop`);

  await page.goto(`${BASE}/maps/${MAP_ID}?version=${published.id}`);
  await page.waitForFunction(() => document.querySelector('[data-id="run-menu"]')?.getAttribute("aria-disabled") === "false");
  await page.locator('[data-id="run-menu"]').click();
  await page.locator('[data-id="run-menu-all"]').click();
  await modal.waitFor();
  check("menu: all runs opens the modal", true);
  check("menu: popover closed", (await page.locator('[data-id="run-menu-pop"]').count()) === 0);
  await settle();

  // 1) 진행 중 탭 — 표식으로 좁히면 열린 10개(내 9 + 남 1), 8줄씩 두 쪽
  check("tab: open is the default", (await page.locator('[data-id="run-list-tab-open"]').getAttribute("aria-pressed")) === "true");
  await page.screenshot({ path: `${OUT}/run-list.png` });
  await search.fill(TAG);
  await page.waitForFunction(
    (n) => document.querySelector('[data-id="run-list-range"]')?.textContent?.includes(`/ ${n}건`),
    10,
  );
  await settle();
  check("open: 8 rows on page 1", (await rows.count()) === 8, String(await rows.count()));
  check("open: range text", ((await range.textContent()) ?? "").trim() === "1~8 / 10건", (await range.textContent()) ?? "");
  const pager = page.locator('[data-id="run-list-pager"]');
  check("open: pager shows 1 / 2", ((await pager.textContent()) ?? "").includes("1 / 2"));
  await page.locator('[data-id="run-list-pager-next"]').click();
  await settle();
  check("open: page 2 has the remaining 2 rows", (await rows.count()) === 2, String(await rows.count()));

  // 2) 거르기 바뀌면 1쪽으로 — 내가 참여한 것만: 남이 시작한 1개가 빠진다
  await page.locator('[data-id="run-list-mine"]').check();
  await page.waitForFunction(() => document.querySelector('[data-id="run-list-range"]')?.textContent?.includes("/ 9건"));
  await settle();
  check("mine: page reset to 1 with 9 rows total", ((await range.textContent()) ?? "").trim() === "1~8 / 9건", (await range.textContent()) ?? "");
  check("mine: the other person's run is gone", (await page.locator('[data-id^="run-list-open-"]', { hasText: "긴급 입고" }).count()) === 0);
  await page.locator('[data-id="run-list-mine"]').uncheck();
  await settle();

  // 3) 영구 보존 책갈피 — 켜면 줄에 영구 보존 표시, "영구 보존만"에 잡히고, 끄면 거른 목록에서 빠진다
  const firstKeep = page.locator('[data-id^="run-list-keep-"]').first();
  const keepRunId = (await firstKeep.getAttribute("data-id")).replace("run-list-keep-", "");
  await firstKeep.click();
  await page.waitForFunction(
    (id) => document.querySelector(`[data-id="run-list-keep-${id}"]`)?.getAttribute("aria-pressed") === "true",
    keepRunId,
  );
  check("keep: bookmark on", true);
  check("keep: row shows the kept tag", ((await page.locator(`[data-id="run-list-row-${keepRunId}"]`).textContent()) ?? "").includes("영구 보존"));
  await page.locator('[data-id="run-list-kept-only"]').check();
  await page.waitForFunction(() => document.querySelector('[data-id="run-list-range"]')?.textContent?.includes("/ 1건"));
  await settle();
  check("kept only: exactly the kept run", (await rows.count()) === 1);
  await page.locator(`[data-id="run-list-keep-${keepRunId}"]`).click();
  await page.locator('[data-id="run-list-empty"]').waitFor();
  check("kept only: unkeeping removes the row (empty state)", true);
  await page.locator('[data-id="run-list-kept-only"]').uncheck();
  await settle();

  // 4) 끝남 탭 — 끝낸 실행 1개, 요약까지 남은 날이 보인다(영구 보존이 아니라서)
  await page.locator('[data-id="run-list-tab-ended"]').click();
  await page.waitForFunction(() => document.querySelector('[data-id="run-list-range"]')?.textContent?.includes("/ 1건"));
  await settle();
  const endedRow = rows.first();
  const endedText = (await endedRow.textContent()) ?? "";
  check("ended: countdown to summary", /\d+일 뒤 요약만 남음/.test(endedText), endedText);
  check("ended: result chip", endedText.includes("Stopped")); // 결과 칩은 언어 무관 영어(2026-11-05)
  await page.screenshot({ path: `${OUT}/run-list-ended.png` });

  // 5) 요약 탭 — 보존 거르기는 숨는다. 줄이 있으면 열 수 있는 버튼이 없다
  await search.fill("");
  await page.waitForTimeout(500); // 검색 디바운스(250ms)가 빈 검색어를 적용할 때까지
  await page.locator('[data-id="run-list-tab-summary"]').click();
  await settle();
  check("summary: kept filter hidden", (await page.locator('[data-id="run-list-kept-only"]').count()) === 0);
  check("summary: no error", (await page.locator('[data-id="run-list-error"]').count()) === 0);
  const summaryRows = await rows.count();
  if (summaryRows > 0) {
    check("summary: rows are not openable", (await page.locator('[data-id^="run-list-open-"]').count()) === 0);
    check("summary: rows have no bookmark button", (await page.locator('[data-id^="run-list-keep-"]').count()) === 0);
    await page.screenshot({ path: `${OUT}/run-list-summary.png` });
  } else {
    console.log("INFO summary tab empty (no summarized runs on this map)");
  }

  // 6) 줄을 누르면 창이 닫히고 그 실행으로 — 주소에 run
  await page.locator('[data-id="run-list-tab-open"]').click();
  await search.fill(TAG);
  await page.waitForFunction(() => document.querySelector('[data-id="run-list-range"]')?.textContent?.includes("/ 10건"));
  await settle();
  const target = page.locator('[data-id^="run-list-open-"]', { hasText: "입고 03" });
  const targetId = (await target.getAttribute("data-id")).replace("run-list-open-", "");
  await target.click();
  await modal.waitFor({ state: "detached" });
  await page.waitForURL(new RegExp(`[?&]run=${targetId}(&|$)`));
  check("open row: modal closed and the run opens", true);
  await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();

  // 7) Esc로 닫기 — 실행 화면에서도 메뉴 → 모든 실행
  await page.locator('[data-id="run-menu"]').click();
  await page.locator('[data-id="run-menu-all"]').click();
  await modal.waitFor();
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "detached" });
  check("esc: closes the modal", true);

  check("console: no errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  if (!KEEP) {
    for (const { id, user } of created) {
      await api("DELETE", `/runs/${id}`, undefined, user).catch((err) => console.warn(`cleanup run ${id}: ${err.message}`));
    }
  }
  await browser.close();
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

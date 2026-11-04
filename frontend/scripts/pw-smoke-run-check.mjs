// 실행 체크 끝에서 끝까지 스모크(design 2026-11-04) — 사용자 둘(A=admin.sys, B=시드의 다른 사용자)로 공개 맵 시드(선형 + 판단 +
// 하위프로세스) → A가 화면에서 공유 실행 생성(B 참여) → 클릭만으로 두 단계 완료(자동 선택·반짝임) → 대기 노드의 꺼진 완료에 올려
// 먼저 끝낼 단계(바로 앞이 아니라 거슬러 올라가 처음 손댈 수 있는 판단 노드)로 이동 → 문제 + 한 줄 메모 → B의 홈 대시보드:
// 진행 중 실행 타일 "문제 1"·실행 줄, 알림 · 피드백 펼침에 run_steps_done(단계 2개)·run_problem(메모 인용) → 알림 줄 클릭 →
// 이동 레이어 → 기다려 실행 화면 도착(읽음) → A가 중단 → 두 화면에 중단 안내 줄(B는 10초 폴링으로) + B에게 중단 알림. 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-run-check.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-run-check.mjs
// 전제: backend는 AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" 로, frontend는 BACKEND_URL=<backend>로 기동.
//       USER_B(기본 bora.hong)는 알림이 상한(100)보다 넉넉히 적어야 한다 — 상한이면 새 실행 알림이 트리밍에 바로 잘린다.
//       모자라면 디렉터리에서 알림이 적은 다른 사용자를 고른다. 시드는 스크립트가 API로 만든다(이름 접두 "pw-run-").
//       시작과 끝에 접두가 붙은 맵(휴지통 영구 삭제까지, 실행은 맵과 함께 지워진다)과 두 사용자의 그 실행 알림을 지운다
//       (KEEP=1이면 끝 정리를 건너뛴다). 산출물은 저장소 루트 .shots/run-smoke-*.png(gitignore).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const USER_A = "admin.sys";
const PREFIX = "pw-run-";
const NOTIFICATION_ROOM = 95; // 이보다 알림이 많은 사용자는 B로 쓰지 않는다(상한 100 트리밍이 새 실행 알림을 지운다)
const RUN_POLL_WAIT_MS = 15_000; // 공유 실행 폴링 10초 + 여유

mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function api(user, method, path, body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Dev-User": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const listNotifications = (user) => api(user, "GET", "/notifications");

async function pickUserB(directory) {
  const wanted = process.env.USER_B ?? "bora.hong";
  const candidates = [wanted, ...directory.users.map((u) => u.id).filter((id) => id !== wanted && id !== USER_A)];
  for (const id of candidates.slice(0, 40)) {
    await purgeRunNotifications([id]); // 지난 회차가 남긴 실행 알림을 먼저 지우고 센다
    if ((await listNotifications(id)).length < NOTIFICATION_ROOM) return id;
  }
  throw new Error("no seeded user below the notification cap for USER_B");
}

// 접두가 붙은 맵 — 휴지통으로 보낸 뒤 영구 삭제(실행·참여자·상태 행은 FK cascade로 같이 사라진다)
async function purgeMaps() {
  for (const found of (await api(USER_A, "GET", "/maps")).filter((m) => m.name.startsWith(PREFIX))) {
    await api(USER_A, "DELETE", `/maps/${found.id}`);
  }
  for (const found of (await api(USER_A, "GET", "/maps/deleted/list")).filter((m) => m.name.startsWith(PREFIX))) {
    await api(USER_A, "DELETE", `/maps/${found.id}/permanent`);
  }
}

// 실행 알림은 실행을 지워도 남을 수 있어(알림 행은 실행 FK가 없다) 받는 사람 각자 이름 접두로 지운다
async function purgeRunNotifications(users) {
  for (const user of users) {
    for (const row of await listNotifications(user)) {
      if (row.type.startsWith("run_") && String(row.payload?.run_name ?? "").startsWith(PREFIX)) {
        await api(user, "DELETE", `/notifications/${row.id}`);
      }
    }
  }
}

// ---- 시드 ----
const tag = Date.now().toString(36);
const nid = (key) => `${PREFIX}${tag}-${key}`;
const directory = await api(USER_A, "GET", "/directory");
const me = directory.users.find((u) => u.id === USER_A) ?? directory.users[0];
if (!me?.org_path) throw new Error("no org_path in directory — seed the directory first");

async function createPublishedMap(name, nodes, edges) {
  const map = await api(USER_A, "POST", "/maps", { name, owning_department: me.org_path, visibility: "public" });
  const detail = await api(USER_A, "GET", `/maps/${map.id}`);
  const draft = detail.versions.find((v) => v.status === "draft") ?? detail.versions[0];
  await api(USER_A, "POST", `/versions/${draft.id}/checkout`, { force: true });
  await api(USER_A, "PUT", `/versions/${draft.id}/graph`, { nodes, edges, groups: [] });
  await api(USER_A, "PUT", `/maps/${map.id}/approvers`, { user_ids: [USER_A] });
  await api(USER_A, "POST", `/versions/${draft.id}/submit`, {});
  await api(USER_A, "POST", `/versions/${draft.id}/approve`, {});
  await api(USER_A, "POST", `/versions/${draft.id}/publish`, {});
  return { mapId: map.id, versionId: draft.id };
}

const node = (key, title, x, y, extra = {}) => ({ id: nid(key), title, node_type: "process", pos_x: x, pos_y: y, ...extra });
const edge = (key, source, target, extra = {}) => ({
  id: nid(`e-${key}`),
  source_node_id: nid(source),
  target_node_id: nid(target),
  label: "",
  ...extra,
});

// 하위 맵(시작 → 측정 → 끝, 게시 + 하위프로세스 지정)과 바깥 맵
// (시작 → 접수 → 서류 검토 → 판정?(합격 → 시료 채취 → 품질 시험(하위프로세스) → 끝 / 불합격 → 반품 처리 → 반품 끝))
async function seedMaps() {
  const childMap = await createPublishedMap(
    `${PREFIX}${tag} 품질 시험`,
    [node("cs", "시작", 0, 100, { node_type: "start" }), node("c1", "측정", 220, 100), node("ce", "", 440, 100, { node_type: "end" })],
    [edge("c1", "cs", "c1"), edge("c2", "c1", "ce")],
  );
  await api(USER_A, "PUT", `/maps/${childMap.mapId}/subprocess-designation`, { department: me.department || "QA" });
  const parentMap = await createPublishedMap(
    `${PREFIX}${tag} 입고 검사`,
    [
      node("s", "시작", 0, 220, { node_type: "start" }),
      node("a", "접수", 200, 220),
      node("b", "서류 검토", 420, 220),
      node("d", "판정?", 650, 200, { node_type: "decision" }),
      node("c", "시료 채취", 880, 220),
      node("sp", "품질 시험", 1100, 220, { node_type: "subprocess", linked_map_id: childMap.mapId, follow_latest: true }),
      node("e", "", 1340, 220, { node_type: "end", is_primary_end: true }),
      node("r", "반품 처리", 880, 420),
      node("re", "반품 끝", 1100, 420, { node_type: "end" }),
    ],
    [
      edge("sa", "s", "a"),
      edge("ab", "a", "b"),
      edge("bd", "b", "d"),
      edge("dc", "d", "c", { label: "합격" }),
      edge("dr", "d", "r", { label: "불합격" }),
      edge("csp", "c", "sp"),
      edge("spe", "sp", "e", { source_handle: "__primary__" }),
      edge("rre", "r", "re"),
    ],
  );
  return { child: childMap, parent: parentMap };
}

// 시드가 B로 볼 수 있는 공개 게시본인지 — B 입장에서 다시 읽어 확인한다
async function isPublicPublished(mapId, versionId) {
  const detail = await api(USER_B, "GET", `/maps/${mapId}`);
  return detail.visibility === "public" && detail.versions.some((v) => v.id === versionId && v.status === "published");
}

const runName = `${PREFIX}${tag} LOT 2611-07`;
const memo = "라벨 인쇄가 흐려요";
const consoleErrors = [];
let USER_B = null;
let browser = null;
let pageA = null;
let pageB = null;
let runId = null;
let bar = null;
let pop = null;

// 브라우저는 사용자마다 컨텍스트 하나
async function openPage(devUser) {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
  }, devUser);
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`${devUser}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`${devUser}: ${String(err)}`));
  return page;
}
const nodeEl = (page, key) => page.locator(`.react-flow__node[data-id="${key}"]`);

async function barButtons() {
  return bar.locator('[data-id^="run-act-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
}
async function waitBarOn(key, status) {
  await pageA.waitForFunction(
    ([k, s]) => {
      const el = document.querySelector('[data-id="run-action-bar"]');
      return el?.getAttribute("data-node") === k && (s === null || el.getAttribute("data-status") === s);
    },
    [key, status ?? null],
    { timeout: 8000 },
  );
}
// 앞 노드의 버튼 줄이 다음 노드를 덮지 않게 Esc로 먼저 닫고(팝오버 → 버튼 → 캔버스 → 선택 순서) 누른다
async function selectNode(key) {
  for (let i = 0; i < 4 && (await bar.count()) > 0; i += 1) {
    await pageA.keyboard.press("Escape");
    await pageA.waitForTimeout(60);
  }
  await bar.waitFor({ state: "detached" });
  await nodeEl(pageA, key).click();
  await waitBarOn(key, null);
}
// 반짝임은 1.1초만 켜진다 — 그동안 노드에 반짝임 링이 한 번이라도 뜨는지 본다
async function waitFlash(key) {
  return pageA
    .waitForFunction((id) => document.querySelector(`.react-flow__node[data-id="${id}"] [data-run-flash]`), key, {
      timeout: 3000,
      polling: 50,
    })
    .then(() => true)
    .catch(() => false);
}

try {
  // 0) 시작 정리(지난 회차 알림을 지운 뒤 B를 고른다) → 시드 — 시드가 실패해도 아래 finally가 접두로 정리한다
  await purgeRunNotifications([USER_A]);
  USER_B = await pickUserB(directory);
  await purgeMaps();
  const { child, parent } = await seedMaps();
  const eligible = await api(USER_A, "GET", `/maps/${parent.mapId}/eligible-approvers`);
  if (!eligible.some((u) => u.id === USER_B)) throw new Error(`${USER_B} cannot be a participant of map ${parent.mapId}`);
  check(
    "seed: both maps are public published versions B can open",
    (await isPublicPublished(child.mapId, child.versionId)) && (await isPublicPublished(parent.mapId, parent.versionId)),
    `child ${child.mapId} parent ${parent.mapId} · B=${USER_B}`,
  );
  const baseDash = (await api(USER_B, "GET", "/me/dashboard")).activity;

  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  pageA = await openPage(USER_A);
  bar = pageA.locator('[data-id="run-action-bar"]');
  pop = pageA.locator('[data-id="run-pop"]');

  // 1) A: 게시본 → 실행 메뉴 → 새 실행(공유, B 참여) → 실행 화면
  await pageA.goto(`${BASE}/maps/${parent.mapId}?version=${parent.versionId}`);
  await pageA.waitForFunction(() => document.querySelector('[data-id="run-menu"]')?.getAttribute("aria-disabled") === "false");
  await pageA.locator('[data-id="run-menu"]').click();
  await pageA.locator('[data-id="run-menu-new"]').click();
  const dialog = pageA.locator('[data-id="run-start-dialog"]');
  await dialog.waitFor();
  await pageA.locator('[data-id="run-start-name"]').fill(runName);
  await pageA.locator('[data-id="run-start-scope-shared"]').click();
  const pickerInput = dialog.locator("input:not([data-id])");
  await pickerInput.click();
  await pickerInput.fill(USER_B);
  await pageA.locator('[data-id="principal-picker-dropdown"] button').first().waitFor();
  await pickerInput.press("Enter");
  await dialog.locator(`[data-id="run-start-participant-${USER_B}"]`).waitFor();
  await pageA.locator('[data-id="run-start-name"]').click(); // 피커 목록 닫기
  check("start dialog: shared with B picked", true);
  await pageA.screenshot({ path: `${OUT}/run-smoke-start.png` });
  await pageA.locator('[data-id="run-start-submit"]').click();
  await pageA.waitForURL(/[?&]run=\d+/);
  runId = Number(new URL(pageA.url()).searchParams.get("run"));
  await pageA.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  check("run screen: bar shows the run name", (await pageA.locator('[data-id="run-bar-name"]').textContent()) === runName);
  check(
    "run screen: shared with 2 people",
    ((await pageA.locator('[data-id="run-bar-scope-shared"]').textContent()) ?? "").includes("2명"),
  );
  await nodeEl(pageA, nid("a")).waitFor();
  await pageA.waitForTimeout(800); // 측정·첫 화면 맞춤
  await pageA.keyboard.press("Alt+ArrowLeft"); // 좌·우 패널을 접어 캔버스를 넓힌다
  await pageA.keyboard.press("Alt+ArrowRight");
  await pageA.waitForTimeout(500);
  await pageA.getByRole("button", { name: "화면 맞춤(좌상단)" }).click();
  await pageA.waitForTimeout(600);

  // 2) 클릭만으로 두 단계 — 완료하면 다음 단계가 하나라 선택이 넘어가고 반짝인다
  await selectNode(nid("a"));
  await pageA.locator('[data-id="run-act-complete"]').click();
  const flashB = waitFlash(nid("b"));
  await waitBarOn(nid("b"), "ready");
  check("complete auto-selects the next step", true);
  check("auto-selected step flashes", await flashB);
  await pageA.locator('[data-id="run-act-complete"]').click();
  await waitBarOn(nid("d"), "ready");
  check("second complete auto-selects the decision", true);
  check(
    "decision bar shows branch names",
    (await pageA.locator(`[data-id="run-act-branch-${nid("e-dc")}"]`).textContent()).trim() === "합격" &&
      (await pageA.locator(`[data-id="run-act-branch-${nid("e-dr")}"]`).textContent()).trim() === "불합격",
  );
  const progress = (await pageA.locator('[data-id="run-bar-progress"]').textContent()) ?? "";
  check("bar progress counts two steps", /완료 2 \/ 전체 \d+/.test(progress), progress);
  await pageA.waitForTimeout(350);
  await pageA.screenshot({ path: `${OUT}/run-smoke-advance.png` });

  // 3) 대기 노드(품질 시험) — 꺼진 완료에 올리면 먼저 끝낼 단계: 바로 앞(시료 채취)도 대기라 판단 노드로 거슬러 올라간다
  await selectNode(nid("sp"));
  check(
    "waiting step bar: switched-off complete + comments",
    JSON.stringify(await barButtons()) === JSON.stringify(["run-act-why", "run-act-comments"]) &&
      (await pageA.locator('[data-id="run-act-why"]').getAttribute("aria-disabled")) === "true",
    (await barButtons()).join(","),
  );
  await pageA.locator('[data-id="run-act-why"]').hover();
  await pageA.locator('[data-id="run-pop"][data-kind="why"]').waitFor();
  const gotoIds = await pop.locator('[data-id^="run-pop-goto-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
  check(
    "why popover points past the waiting predecessor to the decision",
    JSON.stringify(gotoIds) === JSON.stringify([`run-pop-goto-${nid("d")}`]),
    gotoIds.join(","),
  );
  check("hint ring on the step to finish first", (await pageA.locator('[data-id="run-node-ring"][data-run-hint]').count()) === 1);
  await pageA.waitForTimeout(300); // 등장 애니메이션
  await pageA.screenshot({ path: `${OUT}/run-smoke-why.png` });
  const flashD = waitFlash(nid("d"));
  await pageA.locator(`[data-id="run-pop-goto-${nid("d")}"]`).click();
  await waitBarOn(nid("d"), "ready");
  check("jump selects the step to finish first", true);
  check("jumped step flashes", await flashD);

  // 4) 문제 + 한 줄 메모(공유 실행이라 문제 알림에 같이 간다)
  await pageA.locator('[data-id="run-act-problem"]').click();
  const noteInput = pageA.locator('[data-id="run-pop-note-input"]');
  await noteInput.waitFor();
  check("shared run: note promises the problem notice", (await noteInput.getAttribute("placeholder")) === "남기면 문제 알림에 같이 가요");
  await noteInput.fill(memo);
  await pageA.keyboard.press("Enter");
  await pageA.getByText("문제 알림에 메모를 같이 보냈어요").waitFor({ timeout: 5000 });
  await waitBarOn(nid("d"), "problem");
  check("problem marked with a note", true);
  await pageA.waitForTimeout(400);
  await pageA.screenshot({ path: `${OUT}/run-smoke-problem.png` });

  // B가 받은 알림 — 초대 · 단계 완료(묶음 2개) · 문제(메모 인용)
  const notesB = (await listNotifications(USER_B)).filter((n) => n.payload?.run_id === runId);
  const stepsDone = notesB.find((n) => n.type === "run_steps_done");
  const problem = notesB.find((n) => n.type === "run_problem");
  check("B: invite notification", notesB.some((n) => n.type === "run_invited"));
  check("B: steps grouped in one row", stepsDone?.payload?.count === 2, JSON.stringify(stepsDone?.payload ?? null));
  check("B: problem notification carries the note", problem?.payload?.snippet === memo, JSON.stringify(problem?.payload ?? null));
  check(
    "A: no notifications for own actions",
    !(await listNotifications(USER_A)).some((n) => n.payload?.run_id === runId),
  );

  // 5) B의 홈 대시보드 — 진행 중 실행 타일 "문제 1" + 실행 줄
  pageB = await openPage(USER_B);
  await pageB.goto(BASE);
  const runsTile = pageB.locator('[data-id="home-activity-runs"]');
  await runsTile.waitFor();
  const runsTileText = (await runsTile.textContent()) ?? "";
  const runsTileValue = Number.parseInt((await pageB.locator('[data-id="home-activity-runs"] > span').nth(1).textContent()) ?? "", 10);
  const runsTileSub = runsTileText.match(/문제 (\d+) · 곧 중단 (\d+)/);
  check("B home: runs tile counts the new run", runsTileValue === baseDash.runs_open + 1, `${runsTileValue} vs ${baseDash.runs_open} + 1`);
  check(
    "B home: runs tile shows exactly one more problem",
    runsTileSub !== null &&
      Number(runsTileSub[1]) === baseDash.runs_problem + 1 &&
      Number(runsTileSub[2]) === baseDash.runs_idle,
    runsTileText,
  );
  await runsTile.click();
  const runRow = pageB.locator(`[data-id="home-run-row-${runId}"]`);
  await runRow.waitFor();
  const runRowText = (await runRow.textContent()) ?? "";
  check("B home: run row leads with the problem step", runRowText.includes("문제") && runRowText.includes("판정?"), runRowText);
  await pageB.waitForTimeout(400); // 펼침 애니메이션
  await pageB.screenshot({ path: `${OUT}/run-smoke-home-runs.png` });

  // 6) 알림 · 피드백 펼침 — 단계 완료·문제 줄
  await pageB.locator('[data-id="home-activity-inbox"]').click();
  await pageB.locator('[data-id="home-inbox-noti-list"]').waitFor();
  const stepsRow = pageB.locator(`[data-id="home-inbox-noti-row-${stepsDone?.id}"]`);
  const problemRow = pageB.locator(`[data-id="home-inbox-noti-row-${problem?.id}"]`);
  await stepsRow.waitFor({ timeout: 5000 });
  await problemRow.waitFor({ timeout: 5000 });
  check("B inbox: steps-done row", ((await stepsRow.textContent()) ?? "").includes("단계 2개"), (await stepsRow.textContent()) ?? "");
  check("B inbox: problem row quotes the note", ((await problemRow.textContent()) ?? "").includes(memo), (await problemRow.textContent()) ?? "");
  await pageB.waitForTimeout(400);
  await pageB.screenshot({ path: `${OUT}/run-smoke-home-inbox.png` });

  // 7) 문제 알림 줄 → 이동 레이어 → 기다리면 실행 화면, 이동하면서 읽음
  await problemRow.click();
  const overlay = pageB.locator('[data-id="home-inbox-noti"] [data-id="nav-pending-overlay"]');
  await overlay.waitFor();
  check("B inbox: pending layer", ((await overlay.textContent()) ?? "").includes("실행 화면(으)로 이동 중"));
  await pageB.waitForTimeout(150);
  await pageB.screenshot({ path: `${OUT}/run-smoke-pending.png` });
  await pageB.waitForURL((url) => url.searchParams.get("run") === String(runId), { timeout: 5000 });
  await pageB.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  check("B: notification lands on the run screen", (await pageB.locator('[data-id="run-bar-name"]').textContent()) === runName);
  await pageB.waitForFunction(
    (key) =>
      document
        .querySelector(`.react-flow__node[data-id="${key}"] [data-id="run-node-badge"]`)
        ?.getAttribute("data-run-status") === "problem",
    nid("d"),
  );
  check("B: the problem step reads as problem", true);
  check("B: notification marked read on arrival", (await listNotifications(USER_B)).find((n) => n.id === problem?.id)?.read === true);
  // 첫 화면 맞춤은 측정 전 좌표로 크게 확대해 둘 수 있어(run-bar 스모크와 같은 현상) 배율만 기록하고 맞춘 뒤 찍는다
  const arrivalScale = await pageB
    .locator(".react-flow__viewport")
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
  console.log(`INFO B arrival zoom ${Math.round(arrivalScale * 100)}%`);
  await pageB.getByRole("button", { name: "화면 맞춤(좌상단)" }).click();
  await pageB.waitForTimeout(600);
  await pageB.screenshot({ path: `${OUT}/run-smoke-b-run.png` });

  // 8) A가 중단(확인 한 단계) → A 화면 안내 줄, B 화면은 폴링으로 안내 줄 + B에게 중단 알림
  await pageA.locator('[data-id="run-bar-more"]').click();
  await pageA.locator('[data-id="run-bar-stop"]').click();
  await pageA.locator('[data-id="run-bar-stop-confirm"] [data-id="confirm-dialog-confirm"]').click();
  await pageA.locator('[data-id="run-bar-stopped"]').waitFor();
  check("A: stopped line after stop", (await pageA.locator('[data-id="run-bar-reopen"]').count()) === 1);
  await pageB.locator('[data-id="run-bar-stopped"]').waitFor({ timeout: RUN_POLL_WAIT_MS });
  check("B: stopped line arrives by polling", true);
  check("B: no reopen for a participant", (await pageB.locator('[data-id="run-bar-reopen"]').count()) === 0);
  check(
    "B: stop notification",
    (await listNotifications(USER_B)).some((n) => n.type === "run_stopped" && n.payload?.run_id === runId),
  );
  await pageB.waitForTimeout(400);
  await pageB.screenshot({ path: `${OUT}/run-smoke-stopped.png` });
} catch (err) {
  failures += 1;
  console.log("FAIL exception", err);
  await pageA?.screenshot({ path: `${OUT}/run-smoke-failure-a.png` }).catch(() => undefined);
  await pageB?.screenshot({ path: `${OUT}/run-smoke-failure-b.png` }).catch(() => undefined);
} finally {
  if (browser !== null) {
    check("console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    await browser.close();
  }
  if (!KEEP) {
    const users = USER_B === null ? [USER_A] : [USER_A, USER_B];
    await purgeRunNotifications(users).catch((err) => console.warn("notification cleanup skipped", String(err).slice(0, 160)));
    if (runId !== null) {
      await api(USER_A, "DELETE", `/runs/${runId}`).catch((err) => console.warn("run cleanup skipped", String(err).slice(0, 160)));
    }
    await purgeMaps().catch((err) => console.warn("map cleanup skipped", String(err).slice(0, 160)));
  }
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

// 홈 대시보드 펼침 목록 스모크(design 2026-11-04 §4.8) — 타일 5칸(진행 중 실행 · 알림 · 피드백, 옛 미읽음·피드백 타일 없음) →
// 실행 타일 펼침(필 개수·"곧 중단" = is_idle·정렬 메뉴·기억) → 줄 클릭 "실행 화면(으)로 이동 중" 레이어 → 레이어 클릭 취소 →
// 다시 눌러 기다리면 실행 화면 → 알림·피드백 타일로 바꾸면 실행 칸이 접히고 좌우 목록 → 알림 줄 대기 중 타일 전환 = 이동 취소(안 읽음 유지) →
// 실행 알림 줄 이동 뒤 미읽음 수 감소 → "모두 읽음"(바로) → "+ 새 피드백"(바로 쓰기 패널) → 미읽음 0인 홈에서도 알림 · 피드백 타일 펼침(R34,
// 미읽음 필 빈 줄·전체 필 읽은 줄) → 다른 IconPillFilter 화면 3곳. 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-home-lists.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-home-lists.mjs
// 전제: backend는 AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" 로(로컬 sqlite), frontend는 BACKEND_URL=<backend>로 기동.
//       MAP_ID(기본 30)는 게시본이 있는 맵이고 참여자 후보가 2명 이상. ME(기본 bora.hong)는 알림이 상한(100)보다 적은 사용자여야 한다
//       — 상한이면 새 실행 알림이 실행 알림부터 지우는 트리밍에 바로 잘린다. 참여자도 알림이 상한 아래인 후보만 고른다.
//       "곧 중단"(30일 방치)과 피드백 상태(관리자 전용)는 API로 만들 수 없어 DEV_DB(기본 ../backend/dev.db)의 스모크가 만든 행만 직접 고친다.
//       끝에 만든 실행·피드백·알림(모든 수신자, 이름 표식으로)을 지우고 ME의 읽음을 되돌린다(KEEP=1이면 남긴다).
//       산출물은 저장소 루트 .shots/home-runs.png · home-run-pending.png · home-inbox.png(gitignore).
import { existsSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const MAP_ID = Number(process.env.MAP_ID ?? 30);
const DEV_DB = process.env.DEV_DB ?? "../backend/dev.db";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const ME = process.env.ME ?? "bora.hong";
const NOTIFICATION_ROOM = 95; // 이보다 알림이 많은 사용자는 참여자로 쓰지 않는다(상한 100 트리밍이 남의 실행 알림을 지운다)
const TAG = `LOT ${Date.now().toString(36)}`;

if (!existsSync(DEV_DB)) throw new Error(`DEV_DB ${DEV_DB} not found (local sqlite needed for idle runs and feedback status)`);
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function api(method, path, body, user = ME) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Dev-User": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const db = new DatabaseSync(DEV_DB);
const map = await api("GET", `/maps/${MAP_ID}`);
const published = map.versions.find((v) => v.status === "published");
if (!published) throw new Error(`map ${MAP_ID} needs a published version`);
if ((await api("GET", "/notifications")).length >= NOTIFICATION_ROOM) throw new Error(`${ME} is near the notification cap; pick another ME`);
const eligible = [];
for (const user of (await api("GET", `/maps/${MAP_ID}/eligible-approvers`)).filter((u) => u.id !== ME)) {
  if ((await api("GET", "/notifications", undefined, user.id)).length < NOTIFICATION_ROOM) eligible.push(user);
  if (eligible.length === 2) break;
}
if (eligible.length < 2) throw new Error(`map ${MAP_ID} needs two eligible participants below the notification cap`);
const [personA, personB] = eligible;

const createdRuns = [];
const createdFeedback = [];
const unreadBefore = (await api("GET", "/notifications")).filter((n) => !n.read).map((n) => n.id);

async function createRun(label, { user = ME, scope = "shared", participants = [personA.id] } = {}) {
  const run = await api("POST", `/maps/${MAP_ID}/runs`, { name: `${label} · ${TAG}`, version_id: published.id, scope, participants }, user);
  createdRuns.push({ id: run.id, user });
  return run;
}

// 시작 노드 다음 단계를 "문제"로 — 처음엔 그 단계가 진행 가능(ready)이다
async function markProblem(run, user = ME) {
  const graph = await api("GET", `/runs/${run.id}/graph`, undefined, user);
  const start = graph.nodes.find((node) => node.node_type === "start");
  const next = graph.edges.find((edge) => edge.source_node_id === start.id).target_node_id;
  await api("POST", `/runs/${run.id}/actions`, { node_id: next, action: "problem" }, user);
}

// 마지막 손댄 때를 days일 전으로(백엔드는 naive KST로 저장)
function ageRun(runId, days) {
  db.prepare(`UPDATE runs SET last_activity_at = datetime('now', '+9 hours', ?) WHERE id = ?`).run(`-${days} days`, runId);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 } });
await ctx.addInitScript((devUser) => {
  window.localStorage.setItem("bpm.devUser", devUser);
  window.localStorage.setItem("bpm.lang", "ko");
}, ME);
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

const readTileValue = async (dataId) => {
  const text = (await page.locator(`[data-id="${dataId}"] > span`).nth(1).textContent()) ?? "";
  return Number.parseInt(text, 10);
};
const overlayIn = (scopeId) => page.locator(`[data-id="${scopeId}"] [data-id="nav-pending-overlay"]`);
const atHome = () => new URL(page.url()).pathname === "/";

async function gotoHome() {
  await page.goto(BASE);
  await page.locator('[data-id="home-activity-runs"]').waitFor();
}

try {
  // 실행 4개 — 문제(공유) · 문제이면서 방치 35일(나만, R20) · 방치 32일(나만) · 남이 시작하고 내가 참여(공유 3명, 초대 알림이 온다)
  const problemShared = await createRun("입고 문제");
  await markProblem(problemShared);
  const problemIdle = await createRun("정산 문제", { scope: "solo", participants: [] });
  await markProblem(problemIdle);
  ageRun(problemIdle.id, 35);
  const idleSolo = await createRun("교육용 연습", { scope: "solo", participants: [] });
  ageRun(idleSolo.id, 32);
  const invited = await createRun("협력사 등록", { user: personA.id, participants: [ME, personB.id] });

  // 내 피드백 3개 — 작업중(답글) · 초안 · 완료. 상태·답글은 관리자 전용이라 DB로
  for (const [kind, body] of [["suggestion", "실행 화면에서 메모를 여러 줄로"], ["question", "게시본 만료 알림은 언제 오나요"], ["bug", "비교 화면 연결선 라벨 겹침"]]) {
    const item = await api("POST", "/feedback", { kind, body: `${body} · ${TAG}` });
    createdFeedback.push(item.id);
  }
  db.prepare(`UPDATE feedback SET status = 'in_progress', reply = '확인 중', reply_at = datetime('now', '+9 hours') WHERE id = ?`).run(createdFeedback[0]);
  db.prepare(`UPDATE feedback SET status = 'done', done_at = datetime('now', '+9 hours') WHERE id = ?`).run(createdFeedback[2]);

  const dash = await api("GET", "/me/dashboard");
  const a = dash.activity;
  check("seed: dashboard counts problem+idle overlap (R20)", a.runs_problem >= 2 && a.runs_idle >= 2, JSON.stringify(a));

  // 1) 타일 5칸 — 옛 미읽음·피드백 타일 없음
  await gotoHome();
  check("tiles: five tiles", (await page.locator('[data-id="home-activity"] > div.grid > *').count()) === 5);
  check("tiles: old unread/feedback tiles gone", (await page.locator('[data-id="home-activity-unread"], [data-id="home-activity-feedback"]').count()) === 0);
  check("runs tile: value = runs_open", (await readTileValue("home-activity-runs")) === a.runs_open, String(a.runs_open));
  const runsSub = (await page.locator('[data-id="home-activity-runs"]').textContent()) ?? "";
  check("runs tile: problem/idle sub line", runsSub.includes(`문제 ${a.runs_problem} · 곧 중단 ${a.runs_idle}`), runsSub);
  const inboxText = (await page.locator('[data-id="home-activity-inbox"]').textContent()) ?? "";
  check("inbox tile: unread unit + feedback in progress", inboxText.includes("미읽음") && inboxText.includes(`피드백 진행 중 ${a.feedback_mine_open}`), inboxText);

  // 2) 실행 타일 펼침 — 필 개수, 곧 중단 = is_idle, 정렬, 기억
  await page.locator('[data-id="home-activity-runs"]').click();
  const runPanel = page.locator('[data-id="home-run-panel"]');
  await runPanel.waitFor();
  check("runs: tile pressed", (await page.locator('[data-id="home-activity-runs"]').getAttribute("aria-pressed")) === "true");
  const runRows = page.locator('[data-id^="home-run-row-"]');
  check("runs: one row per dashboard run", (await runRows.count()) === dash.runs.length, `${await runRows.count()} / ${dash.runs.length}`);
  check("runs: first row is a problem (urgent default)", ((await runRows.first().textContent()) ?? "").includes("문제"));
  const idleCount = dash.runs.filter((run) => run.is_idle).length;
  check("runs: idle pill count follows is_idle", ((await page.locator('[data-id="home-run-filter-idle"]').textContent()) ?? "").includes(String(idleCount)));
  await page.locator('[data-id="home-run-filter-idle"]').click();
  check("runs: idle filter rows", (await runRows.count()) === idleCount);
  check("runs: problem+idle run shows both states", ((await page.locator(`[data-id="home-run-row-${problemIdle.id}"]`).textContent()) ?? "").includes("5일 뒤 자동 중단"));
  check("runs: idle state text", ((await page.locator(`[data-id="home-run-row-${idleSolo.id}"]`).textContent()) ?? "").includes("32일 그대로 · 8일 뒤 자동 중단"));
  await page.locator('[data-id="home-run-filter-all"]').click();
  await page.locator('[data-id="home-run-sort"]').click();
  await page.locator('[data-id="home-run-sort-option-progress"]').click();
  const ratios = dash.runs.map((run) => (run.total > 0 ? run.done / run.total : 0));
  const firstId = Number((await runRows.first().getAttribute("data-id")).replace("home-run-row-", ""));
  const firstRun = dash.runs.find((run) => run.run_id === firstId);
  check("runs: progress sort puts the lowest ratio first", firstRun.done / Math.max(firstRun.total, 1) === Math.min(...ratios));
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("bpm.home.lists") ?? "{}"));
  check("runs: sort remembered", stored.runSort === "progress", JSON.stringify(stored));
  await page.locator('[data-id="home-run-sort"]').click();
  await page.locator('[data-id="home-run-sort-option-urgent"]').click();
  await page.waitForTimeout(350); // 펼침 애니메이션이 끝난 뒤 캡처
  await page.screenshot({ path: `${OUT}/home-runs.png` });

  // 3) 줄 클릭 → 레이어 → 레이어 클릭 취소
  const rowA = page.locator(`[data-id="home-run-row-${problemShared.id}"]`);
  await rowA.click();
  const runOverlay = overlayIn("home-run-panel");
  await runOverlay.waitFor();
  check("runs: pending layer text", ((await runOverlay.textContent()) ?? "").includes("실행 화면(으)로 이동 중"));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/home-run-pending.png` });
  await runOverlay.click();
  await page.waitForTimeout(900);
  check("runs: layer click cancels", atHome() && (await runOverlay.count()) === 0, page.url());

  // 4) 다시 눌러 기다리면 그 실행 화면
  await rowA.click();
  await page.waitForURL((url) => url.searchParams.get("run") === String(problemShared.id), { timeout: 5000 });
  check("runs: row opens the run screen", page.url().includes(`/maps/${MAP_ID}?version=${published.id}&run=${problemShared.id}`), page.url());

  // 5) 알림 · 피드백 — 실행 칸이 접히고 좌우 목록
  await gotoHome();
  await page.locator('[data-id="home-activity-runs"]').click();
  await runPanel.waitFor();
  await page.locator('[data-id="home-activity-inbox"]').click();
  const inboxPanel = page.locator('[data-id="home-inbox-panel"]');
  await inboxPanel.waitFor();
  await page.locator('[data-id="home-inbox-noti-list"]').waitFor();
  await page.locator('[data-id="home-inbox-fb-list"]').waitFor();
  await page.waitForTimeout(400);
  check("inbox: run panel collapsed (one at a time)", (await runPanel.count()) === 0);
  check("inbox: runs tile released", (await page.locator('[data-id="home-activity-runs"]').getAttribute("aria-pressed")) === "false");
  const notiBox = await page.locator('[data-id="home-inbox-noti"]').boundingBox();
  const fbBox = await page.locator('[data-id="home-inbox-feedback"]').boundingBox();
  check("inbox: notifications left, feedback right", notiBox && fbBox && notiBox.x < fbBox.x && Math.abs(notiBox.y - fbBox.y) < 2);
  check("inbox: unread rows only by default", (await page.locator('[data-id^="home-inbox-noti-row-"]:not([data-unread])').count()) === 0);
  const fbRows = page.locator('[data-id^="home-inbox-fb-row-"]');
  check("feedback: in-progress filter shows draft + in progress (mine)", (await fbRows.count()) === 2, String(await fbRows.count()));
  await page.locator('[data-id="home-inbox-fb-status-all"]').click();
  check("feedback: all shows 3", (await fbRows.count()) === 3);
  check("feedback: replied line", ((await page.locator(`[data-id="home-inbox-fb-row-${createdFeedback[0]}"]`).textContent()) ?? "").includes("답글 있음"));
  await page.locator('[data-id="home-inbox-fb-status-open"]').click();
  await page.waitForTimeout(400); // 필 라벨 펼침(350ms)이 끝난 뒤 캡처
  await page.screenshot({ path: `${OUT}/home-inbox.png` });

  // 6) 알림 줄 대기 중에 타일을 바꾸면 이동 취소 + 안 읽음 유지, 레이어는 누른 쪽(왼쪽)만
  const notis = await api("GET", "/notifications");
  const invite = notis.find((n) => n.type === "run_invited" && n.payload?.run_id === invited.id && n.payload?.run_name?.includes(TAG));
  check("seed: run invite notification exists", Boolean(invite));
  const otherUnread = notis.find((n) => !n.read && n.id !== invite?.id);
  check("seed: another unread notification exists", Boolean(otherUnread));
  if (otherUnread) {
    await page.locator(`[data-id="home-inbox-noti-row-${otherUnread.id}"]`).click();
    await overlayIn("home-inbox-noti").waitFor();
    check("inbox: layer covers the notification column only", (await overlayIn("home-inbox-feedback").count()) === 0);
    const dest = otherUnread.type.startsWith("run_") && otherUnread.map_id !== null ? "실행 화면" : "알림·승인 탭";
    check("inbox: notification layer text", ((await overlayIn("home-inbox-noti").textContent()) ?? "").includes(`${dest}(으)로 이동 중`));
    await page.locator('[data-id="home-activity-runs"]').click();
    await page.waitForTimeout(900);
    const after = (await api("GET", "/notifications")).find((n) => n.id === otherUnread.id);
    check("inbox: switching tiles cancels the move and keeps it unread", atHome() && after && !after.read, page.url());
    await page.locator('[data-id="home-activity-inbox"]').click();
    await page.locator('[data-id="home-inbox-noti-list"]').waitFor();
  }

  // 7) 실행 알림 줄 → 실행 화면, 돌아오면 미읽음 수가 하나 줄어 있다
  const unreadTileBefore = await readTileValue("home-activity-inbox");
  await page.locator('[data-id="home-inbox-noti-kind"]').click();
  await page.locator('[data-id="home-inbox-noti-kind-option-run"]').click();
  const inviteRow = page.locator(`[data-id="home-inbox-noti-row-${invite.id}"]`);
  check("inbox: run category chip", ((await inviteRow.textContent()) ?? "").includes("실행"));
  await inviteRow.click();
  await page.waitForURL((url) => url.searchParams.get("run") === String(invited.id), { timeout: 5000 });
  check("inbox: run notification opens the run screen", page.url().includes(`run=${invited.id}`), page.url());
  await page.waitForTimeout(300);
  check("inbox: notification marked read on move", (await api("GET", "/notifications")).find((n) => n.id === invite.id)?.read === true);
  await gotoHome();
  check("inbox: unread count dropped by one", (await readTileValue("home-activity-inbox")) === unreadTileBefore - 1, `${unreadTileBefore} -> ${await readTileValue("home-activity-inbox")}`);

  // 8) 모두 읽음(바로) — 타일 0, 점 사라짐 / + 새 피드백(바로 쓰기 패널)
  await page.locator('[data-id="home-activity-inbox"]').click();
  await page.locator('[data-id="home-inbox-noti-list"]').waitFor();
  await page.locator('[data-id="home-inbox-noti-kind"]').click();
  await page.locator('[data-id="home-inbox-noti-kind-option-all"]').click();
  await page.locator('[data-id="home-inbox-read-all"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-id^="home-inbox-noti-row-"][data-unread]').length === 0);
  check("inbox: mark all read is immediate", atHome() && (await readTileValue("home-activity-inbox")) === 0);
  await page.locator('[data-id="home-inbox-fb-new"]').click();
  await page.waitForTimeout(500);
  const sidePanel = page.locator('aside[role="dialog"]');
  const dialogBox = await sidePanel.boundingBox();
  check("feedback: new feedback opens the side panel without leaving", atHome() && dialogBox !== null && dialogBox.x < 1400);
  await page.mouse.click(200, 400); // 패널 바깥(백드롭) = 닫기
  await page.waitForTimeout(500);
  await page.locator('[data-id="home-activity-inbox"]').click(); // 0이 된 뒤에도 펼친 타일은 다시 눌러 접힌다
  await page.waitForTimeout(400);
  check("inbox: tile at 0 still collapses its open list", (await inboxPanel.count()) === 0);

  // 9) 미읽음 0으로 새로 연 홈에서도 알림 · 피드백 타일은 펼친다(R34) — 미읽음 필은 빈 줄, 전체 필은 읽은 줄
  await gotoHome();
  check("inbox: dashboard says 0 unread", (await readTileValue("home-activity-inbox")) === 0);
  await page.locator('[data-id="home-activity-inbox"]').click();
  await inboxPanel.waitFor();
  await page.locator('[data-id="home-inbox-noti-list"]').waitFor();
  check("inbox: opens with 0 unread (R34)", (await page.locator('[data-id="home-activity-inbox"]').getAttribute("aria-pressed")) === "true");
  check(
    "inbox: unread pill shows its empty line",
    ((await page.locator('[data-id="home-inbox-noti-list-empty"]').textContent()) ?? "").includes("안 읽은 알림이 없어요"),
  );
  await page.locator('[data-id="home-inbox-noti-read-all"]').click();
  const readRows = page.locator('[data-id^="home-inbox-noti-row-"]');
  check("inbox: all pill shows read rows", (await readRows.count()) > 0 && (await page.locator('[data-id^="home-inbox-noti-row-"][data-unread]').count()) === 0);
  await page.waitForTimeout(400); // 펼침·필 라벨 애니메이션이 끝난 뒤 캡처
  await page.screenshot({ path: `${OUT}/home-inbox-zero.png` });

  // 10) 같은 IconPillFilter를 쓰는 화면 3곳이 그대로 뜬다(개수 없음)
  for (const path of ["/inbox", "/feedback", "/notices"]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(1200);
    const pills = await page.locator("button[aria-pressed]").count();
    check(`pills: ${path} renders`, pills > 0, String(pills));
  }
} finally {
  if (!KEEP) {
    for (const { id, user } of createdRuns) {
      await api("DELETE", `/runs/${id}`, undefined, user).catch((e) => console.log(`cleanup run ${id}: ${e.message}`));
    }
    for (const id of createdFeedback) {
      db.prepare(`UPDATE feedback SET status = 'draft', reply = '', reply_at = NULL, done_at = NULL WHERE id = ?`).run(id);
      await api("DELETE", `/feedback/${id}`).catch((e) => console.log(`cleanup feedback ${id}: ${e.message}`));
    }
    // 실행 id는 지운 뒤 다시 쓰일 수 있어 id가 아닌 이름 표식으로 모든 수신자의 실행 알림을 지운다
    db.prepare("DELETE FROM notifications WHERE json_extract(payload, '$.run_name') LIKE ?").run(`%${TAG}%`);
    for (const id of unreadBefore) db.prepare("UPDATE notifications SET read = 0 WHERE id = ?").run(id);
  }
  db.close();
  await browser.close();
}

check("console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

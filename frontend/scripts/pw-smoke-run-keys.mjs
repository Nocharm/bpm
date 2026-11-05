// 실행 체크 후속 스모크(2026-11-05) — 키보드 실행 · 빈 코멘트 · 하위 맵 끝 → 바깥 자동 완료 · 휴지통 맵의 실행 알림.
// 사용자 둘(A=admin.sys, B=시드의 다른 사용자)로 공개 맵 시드(선형 + 판단 + 하위프로세스) → A가 API로 공유 실행(B 참여) →
// 실행 화면에서 키보드만으로: N(첫 할 단계) → Enter(버튼 줄) → →(다음 버튼) → Esc → Enter·Enter(완료, 이어 밟기) → 판단 갈래 Enter
// → ↓/↑(옆 갈래 노드로) → 호버해도 연결 핸들 없음·범례는 오른쪽 위(아래로 펼침) → 말풍선의 빈 코멘트 Enter = 토스트 → 하위 맵 들어가 마지막 단계 완료 = 바깥 하위프로세스 자동 완료
// + 실행 끝 → A가 맵을 휴지통으로 → B의 홈 알림 줄·알림 벨·인박스에 "맵 삭제 대기"(줄 꺼짐, 인박스는 안내) → 영구 삭제하면
// B의 그 실행 알림이 사라진다. 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-run-keys.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-run-keys.mjs
// 전제: backend는 AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" 로, frontend는 BACKEND_URL=<backend>로 기동.
//       USER_B는 알림이 상한(100)보다 넉넉히 적은 사용자를 고른다. 시드는 스크립트가 API로 만든다(이름 접두 "pw-runkeys-").
//       끝에 접두가 붙은 맵(영구 삭제까지)을 지운다. 산출물은 저장소 루트 .shots/run-keys-*.png(gitignore).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const OUT = "../.shots";
const USER_A = "admin.sys";
const PREFIX = "pw-runkeys-";
const NOTIFICATION_ROOM = 95; // 이보다 알림이 많은 사용자는 B로 쓰지 않는다(상한 100 트리밍이 새 실행 알림을 지운다)

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
    if ((await listNotifications(id)).length < NOTIFICATION_ROOM) return id;
  }
  throw new Error("no seeded user below the notification cap for USER_B");
}

// 접두가 붙은 맵 — 휴지통으로 보낸 뒤 영구 삭제(실행 알림도 같이 지워진다)
async function purgeMaps() {
  for (const found of (await api(USER_A, "GET", "/maps")).filter((m) => m.name.startsWith(PREFIX))) {
    await api(USER_A, "DELETE", `/maps/${found.id}`);
  }
  for (const found of (await api(USER_A, "GET", "/maps/deleted/list")).filter((m) => m.name.startsWith(PREFIX))) {
    await api(USER_A, "DELETE", `/maps/${found.id}/permanent`);
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

// 하위 맵(시작 → 측정 → 끝)과 바깥 맵
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

const consoleErrors = [];
let browser = null;
let pageA = null;
let pageB = null;

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

const barOn = () =>
  pageA.evaluate(() => {
    const el = document.querySelector('[data-id="run-action-bar"]');
    return el ? { node: el.getAttribute("data-node"), status: el.getAttribute("data-status") } : null;
  });
async function waitBarOn(key, status = null) {
  await pageA.waitForFunction(
    ([k, s]) => {
      const el = document.querySelector('[data-id="run-action-bar"]');
      return el?.getAttribute("data-node") === k && (s === null || el.getAttribute("data-status") === s);
    },
    [key, status],
    { timeout: 8000 },
  );
}
const focusedId = () => pageA.evaluate(() => document.activeElement?.getAttribute("data-id") ?? null);
// 버튼 줄의 버튼이 아닌 곳(캔버스)으로 포커스가 돌아왔는지 — 방향키·N은 캔버스에서만 움직인다
async function pressOnCanvas(key) {
  await pageA.keyboard.press(key);
  await pageA.waitForTimeout(250);
}

try {
  await purgeMaps();
  const USER_B = await pickUserB(directory);
  const { child, parent } = await seedMaps();
  const run = await api(USER_A, "POST", `/maps/${parent.mapId}/runs`, {
    name: `${PREFIX}${tag} LOT 2611-08`,
    version_id: parent.versionId,
    scope: "shared",
    participants: [USER_B],
  });
  check("seed: shared run with B", run.scope === "shared", `run ${run.id} · B=${USER_B} · child ${child.mapId}`);

  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  pageA = await openPage(USER_A);
  await pageA.goto(`${BASE}/maps/${parent.mapId}?version=${parent.versionId}&run=${run.id}`);
  await pageA.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  await pageA.locator(`.react-flow__node[data-id="${nid("a")}"]`).waitFor();
  await pageA.waitForTimeout(800);
  await pageA.keyboard.press("Alt+ArrowLeft"); // 좌·우 패널을 접어 캔버스를 넓힌다
  await pageA.keyboard.press("Alt+ArrowRight");
  await pageA.waitForTimeout(500);
  await pageA.getByRole("button", { name: "화면 맞춤(좌상단)" }).click();
  await pageA.waitForTimeout(600);

  // 1) 아무것도 안 고른 채 N → 첫 할 단계(접수)
  await pressOnCanvas("n");
  await waitBarOn(nid("a"), "ready");
  check("N selects the first step to do", true);

  // 2) Enter → 버튼 줄 첫 버튼(완료) → → 다음 버튼(시작) → ← 되돌아옴 → Esc 캔버스로
  await pageA.keyboard.press("Enter");
  check("Enter focuses the first bar button", (await focusedId()) === "run-act-complete", String(await focusedId()));
  await pageA.keyboard.press("ArrowRight");
  check("→ moves to the next bar button", (await focusedId()) === "run-act-start", String(await focusedId()));
  await pageA.keyboard.press("ArrowLeft");
  await pageA.keyboard.press("ArrowLeft");
  check("← wraps to the last bar button", (await focusedId()) === "run-act-comments", String(await focusedId()));
  await pageA.keyboard.press("Home");
  check("Home goes back to the first bar button", (await focusedId()) === "run-act-complete", String(await focusedId()));
  await pageA.keyboard.press("Escape");
  check("Esc leaves the bar, selection stays", (await barOn())?.node === nid("a"));

  // 3) 방향키 → 오른쪽 노드(서류 검토), ← 다시 접수
  await pressOnCanvas("ArrowRight");
  await waitBarOn(nid("b"));
  check("→ on the canvas selects the step to the right", true);
  await pressOnCanvas("ArrowLeft");
  await waitBarOn(nid("a"));
  check("← on the canvas selects the step to the left", true);

  // 4) Enter·Enter로 완료 → 이어 밟기(서류 검토) → 다시 Enter·Enter → 판정?(갈래 버튼) → Enter = 첫 갈래(합격)
  await pageA.keyboard.press("Enter");
  await pageA.keyboard.press("Enter");
  await waitBarOn(nid("b"), "ready");
  check("Enter, Enter completes and moves on", true);
  await pageA.keyboard.press("Enter");
  await pageA.keyboard.press("Enter");
  await waitBarOn(nid("d"), "ready");
  await pageA.keyboard.press("Enter");
  check("decision bar focuses the first branch", (await focusedId()) === `run-act-branch-${nid("e-dc")}`, String(await focusedId()));
  await pageA.keyboard.press("Enter");
  await waitBarOn(nid("c"), "ready");
  check("choosing a branch by keyboard moves on", true);

  // 5) ↓ → 아래 갈래(반품 처리, 건너뜀), ↑ → 시료 채취
  await pressOnCanvas("ArrowDown");
  await waitBarOn(nid("r"), "skipped");
  check("↓ selects the branch below", true);
  await pressOnCanvas("ArrowUp");
  await waitBarOn(nid("c"), "ready");
  check("↑ comes back", true);
  // 실행 캔버스엔 연결 핸들 네모가 없다(호버해도 숨김), 범례는 캔버스 오른쪽 위에서 아래로 펼친다
  const nodeC = pageA.locator(`.react-flow__node[data-id="${nid("c")}"]`);
  await nodeC.hover();
  await pageA.waitForTimeout(200);
  const handleVis = await nodeC.locator(".react-flow__handle").evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).visibility))]);
  check("run canvas hides connection handles on hover", handleVis.length === 1 && handleVis[0] === "hidden", handleVis.join(","));
  await pageA.screenshot({ path: `${OUT}/run-keys-hover-no-handles.png` });
  const paneBox = await pageA.locator(".react-flow__pane").first().boundingBox();
  const toggleBox = await pageA.locator('[data-id="run-legend-toggle"]').boundingBox();
  check(
    "legend sits at the canvas upper right",
    paneBox !== null && toggleBox !== null && paneBox.x + paneBox.width - (toggleBox.x + toggleBox.width) < 40 && toggleBox.y - paneBox.y < 40,
    JSON.stringify({ paneBox, toggleBox }),
  );
  await pageA.locator('[data-id="run-legend-toggle"]').click();
  await pageA.locator('[data-id="run-legend-keys"]').waitFor();
  const cardBox = await pageA.locator('[data-id="run-legend-card"]').boundingBox();
  check("legend card opens below the chip", cardBox !== null && toggleBox !== null && cardBox.y > toggleBox.y + toggleBox.height, JSON.stringify(cardBox));
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: `${OUT}/run-keys-legend.png` });
  await pageA.locator('[data-id="run-legend-toggle"]').click();

  // 6) 말풍선 → 빈 칸에서 Enter = 토스트, 서버로 안 보낸다
  await pageA.locator('[data-id="run-act-comments"]').click();
  const commentInput = pageA.locator('[data-id="run-pop-comment-input"]');
  await commentInput.waitFor();
  await commentInput.fill("   ");
  await commentInput.press("Enter");
  await pageA.getByText("내용을 입력해 주세요").first().waitFor({ timeout: 4000 });
  check("blank comment shows a toast", true);
  const comments = await api(USER_A, "GET", `/runs/${run.id}/comments`);
  check("blank comment is not posted", comments.length === 0, String(comments.length));
  await pageA.waitForTimeout(250);
  await pageA.screenshot({ path: `${OUT}/run-keys-blank-comment.png` });
  await pageA.keyboard.press("Escape");
  await pageA.keyboard.press("Escape");

  // 7) 마우스로 누른 노드에 포커스가 남은 채 Tab → 다음 노드(품질 시험, 대기) → Enter가 새 노드의 버튼 줄로 간다
  await pageA.locator(`.react-flow__node[data-id="${nid("c")}"]`).click();
  await waitBarOn(nid("c"), "ready");
  await pressOnCanvas("Tab");
  await waitBarOn(nid("sp"), "waiting");
  await pageA.keyboard.press("Enter");
  await pageA.waitForTimeout(200);
  check(
    "Tab then Enter enters the new step's bar",
    (await barOn())?.node === nid("sp") && (await focusedId()) === "run-act-why",
    `${(await barOn())?.node} · ${await focusedId()}`,
  );
  await pageA.keyboard.press("Escape");
  await pageA.keyboard.press("Escape");
  await pageA.waitForTimeout(3500); // 앞 토스트가 사라진 뒤 찍는다

  // 8) 시료 채취 완료 → 품질 시험(하위프로세스) → 하위 맵 들어가기 → 측정 완료 = 바깥 자동 완료 + 실행 끝
  await pageA.locator(`.react-flow__node[data-id="${nid("c")}"]`).click();
  await waitBarOn(nid("c"), "ready");
  await pageA.locator('[data-id="run-act-complete"]').click();
  await waitBarOn(nid("sp"), "ready");
  await pageA.locator('[data-id="run-act-enter"]').click();
  const childKey = `${nid("sp")}/${nid("c1")}`;
  await pageA.locator(`.react-flow__node[data-id="${childKey}"]`).waitFor({ timeout: 8000 });
  await pageA.waitForTimeout(600);
  await pageA.getByRole("button", { name: "화면 맞춤(좌상단)" }).click(); // 펼친 하위 맵까지 한 화면에
  await pageA.waitForTimeout(700);
  await pageA.screenshot({ path: `${OUT}/run-keys-subprocess-before.png` });
  await pageA.locator(`.react-flow__node[data-id="${childKey}"]`).click();
  await waitBarOn(childKey, "ready");
  await pageA.locator('[data-id="run-act-complete"]').click();
  await pageA.getByText("하위 맵 끝에 닿아서").first().waitFor({ timeout: 6000 });
  check("host completes itself when the sub map ends", true);
  const detail = await api(USER_A, "GET", `/runs/${run.id}`);
  const hostRow = detail.states.find((row) => row.scope_path === "" && row.node_id === nid("sp"));
  check("host state is done on the server", hostRow?.status === "done", JSON.stringify(hostRow ?? null));
  check("run finished", detail.status === "done", detail.status);
  await pageA.waitForTimeout(400);
  await pageA.screenshot({ path: `${OUT}/run-keys-subprocess-done.png` });

  // 9) A가 맵을 휴지통으로 → B: 홈 알림 줄·벨·인박스에 "맵 삭제 대기"
  // A의 실행 화면을 먼저 떠난다 — 열어 둔 채 지우면 공유 실행 폴링이 지운 맵을 다시 읽어 404 콘솔 에러가 난다
  await pageA.goto(BASE);
  await api(USER_A, "DELETE", `/maps/${parent.mapId}`);
  const trashedB = (await listNotifications(USER_B)).filter((n) => n.payload?.run_id === run.id);
  check(
    "B: run notifications flag the trashed map",
    trashedB.length > 0 && trashedB.every((n) => n.map_in_trash === true),
    trashedB.map((n) => `${n.type}:${n.map_in_trash}`).join(","),
  );
  pageB = await openPage(USER_B);
  await pageB.goto(BASE);
  await pageB.locator('[data-id="home-activity-inbox"]').click();
  await pageB.locator('[data-id="home-inbox-noti-list"]').waitFor();
  const rowB = pageB.locator(`[data-id="home-inbox-noti-row-${trashedB[0].id}"]`);
  await rowB.waitFor({ timeout: 5000 });
  check("B home: trashed run row is disabled", await rowB.isDisabled());
  check(
    "B home: trashed run row has the chip",
    (await pageB.locator(`[data-id="home-inbox-noti-trash-${trashedB[0].id}"]`).count()) === 1,
  );
  await pageB.waitForTimeout(400);
  await pageB.screenshot({ path: `${OUT}/run-keys-trash-home.png` });
  await pageB.getByRole("button", { name: "알림", exact: true }).first().click();
  const bellRow = pageB.locator(`[data-id="notif-bell-row-${trashedB[0].id}"]`);
  await bellRow.waitFor();
  await bellRow.click();
  await pageB.waitForTimeout(500);
  check("B bell: clicking a trashed run row stays put", new URL(pageB.url()).pathname === "/");
  check("B bell: chip shown", (await pageB.locator(`[data-id="notif-bell-trash-${trashedB[0].id}"]`).count()) === 1);
  await pageB.screenshot({ path: `${OUT}/run-keys-trash-bell.png` });
  await pageB.goto(`${BASE}/inbox?notification=${trashedB[0].id}`);
  await pageB.locator('[data-id="notif-run-in-trash"]:visible').first().waitFor({ timeout: 8000 });
  check("B inbox: detail explains instead of opening the run", (await pageB.locator('[data-id="notif-run-open"]').count()) === 0);
  await pageB.waitForTimeout(400);
  await pageB.screenshot({ path: `${OUT}/run-keys-trash-inbox.png` });

  // 10) 영구 삭제 → B의 그 실행 알림이 사라진다
  await api(USER_A, "DELETE", `/maps/${parent.mapId}/permanent`);
  const leftB = (await listNotifications(USER_B)).filter((n) => n.payload?.run_id === run.id && n.map_id === parent.mapId);
  check("B: run notifications are gone after the permanent delete", leftB.length === 0, String(leftB.length));
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
} catch (err) {
  failures += 1;
  console.log("FAIL exception", err);
  await pageA?.screenshot({ path: `${OUT}/run-keys-failure-a.png` }).catch(() => undefined);
  await pageB?.screenshot({ path: `${OUT}/run-keys-failure-b.png` }).catch(() => undefined);
} finally {
  if (browser !== null) await browser.close();
  await purgeMaps().catch((err) => console.log("WARN cleanup", String(err)));
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

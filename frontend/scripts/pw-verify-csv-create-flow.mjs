// CSV 생성 플로우 e2e — 홈 분할 버튼 → CSV 모달 → 생성 다이얼로그, 7시나리오:
//   ① 클립보드 폴백 — 평문 HTTP 비-localhost 오리진에서만 유효. secure context(https/localhost)면
//     옛 버그(navigator.clipboard?.writeText가 조용히 성공 표시)도 통과하므로 SKIP으로 크게 보고한다.
//   ② 분할 버튼: 쉐브론 → 1항목 메뉴 → CSV 모달. 메뉴 열린 채 왼쪽 [New map] 클릭 시 메뉴가 닫힌다(이 브랜치의 수정).
//   ③ 파싱 에러(존재하지 않는 Next 대상)가 에러 목록을 띄우고 [Confirm]을 막는다.
//   ④ 요약 → [Continue] → 생성 다이얼로그 이름·설명이 확장자 뗀 파일명으로 프리필.
//   ⑤ 생성 다이얼로그 파일 아코디언 펼침/접힘.
//   ⑥ 담당자 login_id → 이름 해석(디렉터리 런타임 조회), 미해석 토큰은 원문 저장 + 비차단 경고 정확히 1건.
//   ⑦ csv_manual_url이 비면 매뉴얼 버튼이 없어야 한다(값이 있는 환경은 SKIP).
//
// 실행 (frontend/ 에서):
//   bash:       node scripts/pw-verify-csv-create-flow.mjs
//   PowerShell: node scripts\pw-verify-csv-create-flow.mjs
//   서버(평문 HTTP) 대상 — ①이 실검증되는 유일한 오리진:
//     bash:       BASE_URL=http://<서버IP>:3333 node scripts/pw-verify-csv-create-flow.mjs
//     PowerShell: $env:BASE_URL="http://<서버IP>:3333"; node scripts\pw-verify-csv-create-flow.mjs
// 전제:
//   backend :8000 기동
//     bash:       cd backend && AUTH_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000
//     PowerShell: cd backend; $env:AUTH_ENABLED="false"; .venv\Scripts\uvicorn app.main:app --port 8000
//   frontend :3000 기동 — cd frontend && npm run dev
//   playwright-core 설치 — npm i --no-save playwright-core
//   Chrome 경로가 기본값과 다르면 CHROME_PATH 환경변수로 지정
// ⚠️ 함정 (docs/lessons/browser-verification.md):
//   - 좀비 next dev가 :3000을 점유하면 새 서버가 :3001로 밀려 낡은 빌드에 붙는다 → 실행 전
//     pkill -f "next dev" 후 재기동. 이 스크립트는 이 브랜치의 분할 버튼 쉐브론이 안 보이면
//     stale build로 판단하고 크게 실패한다.
//   - dev.db 오염: 맵 1개를 만들고 끝에 소프트삭제한다. 완전 복원은 git checkout backend/dev.db + 백엔드 재시작.
import { Buffer } from "node:buffer";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = join(tmpdir(), "csv-create-flow");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const skip = (name, reason) => console.log(`SKIP ${name} — ${reason}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// ── 헬퍼 ────────────────────────────────────────────────────────────
// 인페이지 fetch — AUTH_ENABLED=false 백엔드는 X-Dev-User 헤더로 사용자를 식별한다
const api = (path, { method = "GET", body, user = "admin.sys" } = {}) =>
  page.evaluate(
    async ({ path, method, body, user }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": user },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body, user },
  );

// CSV 조립 — 콤마/따옴표 포함 셀은 RFC4180 인용. 헤더 9열은 순서 무관이지만 템플릿 순서를 쓴다.
const q = (cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
const HEADER = "Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next";
const csvOf = (rows) => [HEADER, ...rows.map((r) => r.map(q).join(","))].join("\n");

// 모달의 숨은 파일 입력에 CSV를 in-memory 파일로 주입 (드래그&드롭 경로의 대체)
const feedCsv = async (name, csv) => {
  await page.locator('input[accept=".csv,text/csv"]').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await page.waitForTimeout(400);
};

// ── 서버 프로브 — 미기동이면 크게, 명확하게 실패 ─────────────────────
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
  console.error('  start it: cd frontend && npm run dev   (kill zombies first: pkill -f "next dev")');
  await browser.close();
  process.exit(1);
}
const backendStatus = await page.evaluate(async () => {
  try {
    const res = await fetch("/api/maps", { headers: { "X-Dev-User": "admin.sys" } });
    return res.status;
  } catch {
    return 0;
  }
});
if (backendStatus !== 200) {
  console.error(`FATAL backend not reachable through ${BASE}/api (GET /api/maps → ${backendStatus})`);
  console.error("  start it: cd backend && AUTH_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000");
  await browser.close();
  process.exit(1);
}

// 생성 맵 정리용 — Create 후 URL에서 채운다. 실패 경로 대비 유일한 이름으로도 찾는다.
let mapId = null;
const stamp = Date.now();
const uniqueName = `sales-process pw-${stamp}`;
const bogusToken = `pw.bogus.${stamp}`;

try {
  // ── 시드 발견 — 실제 login_id·부서는 런타임 /api/directory에서 얻는다 ──
  const me = await api("/me");
  const dir = await api("/directory");
  const deptNames = new Set(dir.departments.map((d) => d.name));
  // 부서 드리프트 경고를 피하려면 Department 셀에 그 사람의 실제 부서를 그대로 실어야 한다
  // → 부서가 비었거나 디렉터리 부서 목록에 있는 사용자만 후보로 삼는다.
  const usable = dir.users.filter((u) => u.department === "" || deptNames.has(u.department));
  const realUser = usable.find((u) => u.name && u.name !== u.id) ?? usable[0] ?? null;
  if (realUser === null) {
    skip("assignee resolution seed", "directory has no usable employee rows — resolution checks will be skipped");
  }

  // ── ② 분할 버튼 — 쉐브론 메뉴 → CSV 모달, 왼쪽 절반이 메뉴를 닫는다 ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="home-create-menu-toggle"]', { timeout: 15000 }).catch(() => {
    throw new Error(
      "split-button chevron missing on home — a stale build is serving this port (zombie next dev on :3000?)",
    );
  });
  await page.locator('[data-id="home-create-menu-toggle"]').click();
  check("chevron opens the create menu", await page.locator('[data-id="home-create-from-csv"]').isVisible());
  // 메뉴 열린 채 왼쪽 [New map] 클릭 → 메뉴가 닫혀야 한다 (이 브랜치가 고친 버그)
  await page.getByRole("button", { name: "New map" }).first().click();
  await page.waitForTimeout(300);
  check(
    "left [New map] half closes the menu",
    (await page.locator('[data-id="home-create-from-csv"]').count()) === 0,
  );
  // 왼쪽 절반은 빈 생성 다이얼로그를 연다 — 닫고(다이얼로그 스코프의 X) CSV 경로로 진행
  await page.waitForSelector('[data-id="create-map-description"]');
  await page.locator('div.max-w-lg button[aria-label="Cancel"]').click();
  await page.waitForSelector('[data-id="create-map-description"]', { state: "detached" });

  await page.locator('[data-id="home-create-menu-toggle"]').click();
  await page.locator('[data-id="home-create-from-csv"]').click();
  await page.waitForSelector('[data-id="csv-dropzone"]');
  check("menu item opens the CSV modal", await page.locator('[data-id="csv-dropzone"]').isVisible());
  // 디렉터리 로드 완료까지 대기 — 로드 전엔 드롭존이 비활성이고 파일이 조용히 무시된다
  await page.waitForSelector('[data-id="csv-dropzone"]:not([disabled])', { timeout: 15000 });
  check(
    "template download and AI prompt buttons present",
    (await page.locator('[data-id="csv-template-download"]').isVisible()) &&
      (await page.locator('[data-id="csv-copy-ai-prompt"]').isVisible()),
  );
  await page.screenshot({ path: `${SHOTS}/01-csv-modal.png` });

  // ── ⑦ 매뉴얼 버튼 — csv_manual_url 비면 없어야 한다 ──
  if ((me.csv_manual_url ?? "") === "") {
    check(
      "manual button absent while csv_manual_url is empty",
      (await page.locator('[data-id="csv-manual-link"]').count()) === 0,
    );
  } else {
    skip(
      "manual button absent while csv_manual_url is empty",
      `csv_manual_url is set on this server (${me.csv_manual_url}) — asserting presence instead is meaningless for the default`,
    );
  }

  // ── ① 클립보드 — 평문 HTTP 비-localhost 오리진에서만 의미가 있다 ──
  const origin = await page.evaluate(() => ({ protocol: location.protocol, hostname: location.hostname }));
  const secureContext =
    origin.protocol === "https:" || origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  if (secureContext) {
    skip(
      "clipboard fallback (execCommand) works without navigator.clipboard",
      `SECURE CONTEXT ${origin.protocol}//${origin.hostname} — navigator.clipboard exists here, so the old bug` +
        " cannot reproduce and a pass proves nothing. Rerun with BASE_URL=http://<server-ip>:3333",
    );
  } else {
    check(
      "navigator.clipboard is undefined on this plain-HTTP origin",
      await page.evaluate(() => navigator.clipboard === undefined),
    );
    await page.locator('[data-id="csv-copy-ai-prompt"]').click();
    await page.waitForTimeout(150); // 라벨 갱신 대기 — copied는 1200ms 뒤 원복되므로 그 안에 읽는다
    const copyLabel = await page.locator('[data-id="csv-copy-ai-prompt"]').innerText();
    check('copy button does not report "Copy failed"', !copyLabel.includes("Copy failed"), copyLabel);
    // 실제 클립보드 왕복 — 스크래치 textarea에 붙여넣어 내용 확인
    await page.evaluate(() => {
      const area = document.createElement("textarea");
      area.setAttribute("data-pw-paste", "1");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.zIndex = "99999";
      document.body.appendChild(area);
    });
    await page.locator("[data-pw-paste]").click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
    await page.waitForTimeout(300);
    const pasted = await page.locator("[data-pw-paste]").inputValue();
    check(
      "pasted text starts with the AI prompt's first line",
      pasted.startsWith("당신은 업무 절차 분석가입니다"),
      pasted === "" ? "(textarea stayed empty)" : pasted.slice(0, 40),
    );
    await page.evaluate(() => document.querySelector("[data-pw-paste]")?.remove());
  }

  // ── ③ 파싱 에러가 [Confirm]을 막는다 — 드롭존 클릭이 파일 선택기를 연다 ──
  const badCsv = csvOf([["Step A", "", "", "", "", "", "", "", "Ghost step"]]);
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.locator('[data-id="csv-dropzone"]').click();
  const chooser = await chooserPromise.catch(() => null);
  check("dropzone click opens the file picker", chooser !== null);
  if (chooser !== null) {
    await chooser.setFiles({ name: "bad-flow.csv", mimeType: "text/csv", buffer: Buffer.from(badCsv, "utf-8") });
    await page.waitForTimeout(400);
  } else {
    await feedCsv("bad-flow.csv", badCsv); // 선택기가 안 열려도 에러 차단 검증은 계속한다
  }
  console.log("NOT COVERED: real drag-and-drop onto the dropzone — synthetic DataTransfer drops are unreliable; the file-input path above covers parsing");
  await page.waitForSelector('[data-id="csv-create-errors"]');
  const errText = await page.locator('[data-id="csv-create-errors"]').innerText();
  check(
    "parse error names the missing Next target",
    errText.includes('Next target "Ghost step" not found'),
    errText.split("\n")[0] ?? "",
  );
  check("Confirm disabled while errors present", await page.locator('[data-id="csv-create-confirm"]').isDisabled());
  await page.screenshot({ path: `${SHOTS}/02-parse-errors.png` });

  // ── ④⑥ 정상 CSV — 실제 login_id 1명 + 가짜 토큰 1개, 경고는 정확히 1건 ──
  const goodRows = [
    ["Draft proposal", "Write the draft", realUser ? realUser.id : "", realUser ? realUser.department : "", "", "", "", "", "Review proposal"],
    ["Review proposal", "", bogusToken, "", "", "", "", "", ""],
  ];
  await feedCsv("sales-process.csv", csvOf(goodRows));
  check("valid CSV clears the error list", (await page.locator('[data-id="csv-create-errors"]').count()) === 0);
  check("Confirm enabled for a valid CSV", await page.locator('[data-id="csv-create-confirm"]').isEnabled());
  await page.locator('[data-id="csv-create-confirm"]').click();
  await page.waitForSelector('[data-id="csv-create-summary"]');
  const summaryText = await page.locator('[data-id="csv-create-summary"]').innerText();
  // 2행 + 자동 Start/End = 4노드, Start→Draft→Review→End = 3엣지
  check("summary reports 4 nodes and 3 connections", summaryText.includes("Creates 4 nodes · 3 connections"), summaryText.replace(/\n/g, " | ").slice(0, 120));
  const warnRows = await page
    .locator('[data-id="csv-create-summary"] p')
    .filter({ hasText: /^Row \d+:/ })
    .count();
  check(
    "exactly one non-blocking row warning (unknown assignee)",
    warnRows === 1 && summaryText.includes(`Unknown assignee "${bogusToken}"`),
    `warning rows=${warnRows}`,
  );
  await page.screenshot({ path: `${SHOTS}/03-summary.png` });

  // ── ④ Continue → 생성 다이얼로그 프리필 (확장자 뗀 파일명) ──
  await page.locator('[data-id="csv-create-continue"]').click();
  await page.waitForSelector('[data-id="create-map-description"]');
  const nameVal = await page.locator('input[placeholder="Map name"]').inputValue();
  check("map name prefilled from the file name", nameVal === "sales-process", `name=${nameVal}`);
  const descVal = await page.locator('[data-id="create-map-description"]').inputValue();
  check("description prefilled the same", descVal === "sales-process", `description=${descVal}`);

  // ── ⑤ 파일 아코디언 — 요약·경고 펼침/접힘 ──
  check("file summary hidden before expanding", (await page.locator('[data-id="csv-file-summary"]').count()) === 0);
  await page.locator('[data-id="csv-file-accordion"]').click();
  await page.waitForSelector('[data-id="csv-file-summary"]');
  const accText = await page.locator('[data-id="csv-file-summary"]').innerText();
  check(
    "accordion shows counts and the row warning",
    accText.includes("Creates 4 nodes · 3 connections") && accText.includes(`Unknown assignee "${bogusToken}"`),
    accText.replace(/\n/g, " | ").slice(0, 120),
  );
  await page.screenshot({ path: `${SHOTS}/04-accordion.png` });
  await page.locator('[data-id="csv-file-accordion"]').click();
  await page.waitForTimeout(200);
  check("accordion collapses again", (await page.locator('[data-id="csv-file-summary"]').count()) === 0);

  // ── ⑥ 생성 — 결재자(기본 private에선 본인만 후보) 추가 후 Create → 에디터 이동 ──
  // 이름을 유일하게 바꿔 실데이터 충돌·정리 오삭제를 막는다 (프리필 단언은 위에서 끝났다)
  await page.locator('input[placeholder="Map name"]').fill(uniqueName);
  const approverInput = page.locator('input[placeholder^="Search by name"]').last();
  await approverInput.scrollIntoViewIfNeeded();
  await approverInput.click();
  await page.waitForSelector('[data-id="principal-picker-dropdown"]');
  await page.locator('[data-id="principal-picker-dropdown"] button').first().click();
  await page.waitForSelector('[data-id^="create-approver-pill-"]');
  await page.getByRole("button", { name: "Create", exact: true }).click();
  // 성공 = 에디터로 이동. 임포트 실패면 다이얼로그가 남아 여기서 타임아웃 → FAIL로 드러난다.
  await page.waitForURL(/\/maps\/\d+/, { timeout: 20000 });
  mapId = Number(page.url().match(/\/maps\/(\d+)/)[1]);
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 4, null, {
    timeout: 20000,
  });
  check("created map opens in the editor with 4 nodes", true, `mapId=${mapId}`);
  await page.screenshot({ path: `${SHOTS}/05-created-editor.png` });

  // 저장된 그래프 검증 — 담당자 해석은 노드 데이터로 관찰한다
  const detail = await api(`/maps/${mapId}`);
  const graph = await api(`/versions/${detail.versions[0].id}/graph`);
  const draft = graph.nodes.find((n) => n.title === "Draft proposal");
  const review = graph.nodes.find((n) => n.title === "Review proposal");
  check(
    "saved graph has the CSV rows plus auto start/end",
    graph.nodes.length === 4 && draft !== undefined && review !== undefined,
    `nodes=${graph.nodes.map((n) => n.title).join(",")}`,
  );
  check(
    "unresolvable token imported verbatim",
    review?.assignee === bogusToken,
    `assignee=${review?.assignee}`,
  );
  if (realUser && realUser.name !== realUser.id) {
    check(
      "assignee login_id resolved to the display name",
      draft?.assignee === realUser.name && draft?.assignee !== realUser.id,
      `assignee=${draft?.assignee} (id=${realUser.id})`,
    );
  } else {
    skip(
      "assignee login_id resolved to the display name",
      realUser ? `directory user ${realUser.id} has no distinct display name` : "no usable directory user",
    );
  }

  console.log(
    "NOT COVERED: createdRef retry (Create re-click after a failed graph save must not duplicate the map) — cannot force a deterministic save failure from the browser",
  );
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // 시드 정리 — 소프트삭제(휴지통). 완전 복원은 git checkout backend/dev.db + 백엔드 재시작
  if (mapId === null) {
    // 생성은 됐는데 이동 전에 죽은 경우 — 유일한 이름으로 찾아서 지운다
    const leftovers = await api("/maps").catch(() => []);
    const leftover = leftovers.find((m) => m.name === uniqueName);
    if (leftover) mapId = leftover.id;
  }
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 160)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 && consoleErrors.length === 0 ? 0 : 1);

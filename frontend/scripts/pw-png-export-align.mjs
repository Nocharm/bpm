// PNG 출력 정렬 유지 스모크(lib/print-anchor) — 두 장면을 모든 표시 정보를 켠 캔버스에서 맞춘 뒤 출력 보기를 잰다.
// 1) 폭이 다른 노드 세로 열을 가운데 정렬(Alt+C) → 표시 정보를 모두 끄고 Word로: 가운데 x가 캔버스와 같은지.
// 2) 입출력이 긴 노드와 짧은 노드 가로 줄을 세로 가운데 정렬(Alt+X), 바로 위에 노드 → 입출력 펼침으로: 줄 가운데가 맞고
//    커진 노드가 위 노드와 겹치지 않는지(간격 보정이 저장 좌표로 행을 묶는다, lib/height-shift shifts).
// 출력이 끝나면 캔버스 좌표가 원래대로인지도 본다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-png-export-align.mjs
//   KEEP=1 이면 시드 맵을 지우지 않는다. 산출물은 저장소 루트 .shots/png-export-align-*.png (gitignore).
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const H = { "X-Dev-User": "admin.sys", "Content-Type": "application/json" };
const ALL_FIELDS = ["assignee", "department", "system", "url", "input", "output", "conditions", "params", "gmp"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ---- 시드: 위→아래 세로 열(표시 정보 양이 달라 폭이 다르다) + 오른쪽에 위 노드·가로 줄 ----
const tag = Date.now().toString(36);
const nid = (key) => `align-${tag}-${key}`;
for (const stale of (await api("GET", "/api/maps")).filter((m) => m.name.startsWith("PNG align smoke"))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === "admin.sys") ?? directory.users[0])?.org_path;
if (!owning) throw new Error("no org_path in directory — seed the directory first");
const map = await api("POST", "/api/maps", { name: `PNG align smoke ${tag}`, owning_department: owning, visibility: "private" });
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
const vertical = { source_handle: "s-bottom", target_handle: "t-top", source_side: "bottom", target_side: "top" };
const horizontal = { source_handle: "s-right", target_handle: "t-left", source_side: "right", target_side: "left" };
const COLUMN = ["s", "a", "b", "c", "e"];
// 가로 줄: up(위 노드) 아래 long(입력물 12줄 — 캔버스는 3.5줄로 접힘)·short. 위 노드와 저장 간격 28
const ROW = ["up", "long", "short"];
const inputLines = Array.from({ length: 12 }, (_, index) => `분석 입력 자료 ${index + 1}`).join("\n");
await api("PUT", `/api/versions/${draft.id}/graph`, {
  nodes: [
    { id: nid("s"), title: "", node_type: "start", pos_x: 130, pos_y: 0 },
    {
      id: nid("a"),
      title: "시험 의뢰 접수",
      node_type: "process",
      pos_x: 100,
      pos_y: 90,
      assignee_role: "품질관리팀 시험 의뢰 접수 담당자",
      system: "LIMS",
      input: "시험 의뢰서 및 시료 인수인계 기록",
    },
    { id: nid("b"), title: "시험 수행", node_type: "process", pos_x: 140, pos_y: 270 },
    { id: nid("c"), title: "결과 검토 및 승인", node_type: "process", pos_x: 90, pos_y: 380, assignee_role: "QC 팀장", output: "시험 성적서(최종 승인본)" },
    { id: nid("e"), title: "", node_type: "end", pos_x: 130, pos_y: 540 },
    { id: nid("up"), title: "분석 요청", node_type: "process", pos_x: 600, pos_y: 0 },
    { id: nid("long"), title: "시료 분석", node_type: "process", pos_x: 600, pos_y: 80, input: inputLines },
    { id: nid("short"), title: "결과 기록", node_type: "process", pos_x: 920, pos_y: 80 },
  ],
  edges: [
    ...COLUMN.slice(1).map((key, index) => ({
      id: nid(`e${index}`),
      source_node_id: nid(COLUMN[index]),
      target_node_id: nid(key),
      ...vertical,
    })),
    { id: nid("eup"), source_node_id: nid("up"), target_node_id: nid("long"), ...vertical },
    { id: nid("erow"), source_node_id: nid("long"), target_node_id: nid("short"), ...horizontal },
  ],
});
check("seeded column + row map", true, `map ${map.id} v${draft.id}`);

// ---- 브라우저 ----
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.addInitScript((fields) => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "ko");
  window.localStorage.setItem("bpm.nodeDisplayFields.v2", JSON.stringify(fields));
  window.localStorage.setItem(
    "bpm.pngExport",
    JSON.stringify({ theme: "word", wordStyle: "navy", showParallel: true, showInfo: false, crossing: "jump", paper: "portrait", printWidthPct: 100, expandIo: false, edgeFan: true, layout: "single" }),
  );
}, ALL_FIELDS);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 180_000 });
await page.waitForTimeout(2500);
await page.keyboard.press("Escape");
await page.locator('button[aria-label="화면 맞춤(좌상단)"]').click();
await page.waitForTimeout(800);

// 노드 화면 사각형(가운데·폭·위·아래)
const measure = (keys) =>
  page.evaluate((ids) => {
    return ids.map((id) => {
      const rect = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect();
      return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width, h: rect.height, top: rect.top, bottom: rect.bottom };
    });
  }, keys.map(nid));
const spread = (rows) => Math.max(...rows.map((r) => r.cx)) - Math.min(...rows.map((r) => r.cx));
// 출력 보기는 다운로드가 끝나면 풀린다 — 고정 대기 대신 조건이 설 때까지 짧게 재며 기다린다(마지막 측정을 돌려준다)
async function pollUntil(read, isReady, timeout = 5000) {
  const end = Date.now() + timeout;
  let last = await read();
  while (!isReady(last) && Date.now() < end) {
    await page.waitForTimeout(40);
    last = await read();
  }
  return last;
}
// 빈 캔버스를 눌러 선택 해제 — 선택 노드는 IO 상세를 그려 크기가 달라진다
async function clickEmptyPane() {
  const point = await page.evaluate(() => {
    for (let y = 980; y > 100; y -= 40) {
      for (let x = 1500; x > 100; x -= 40) {
        if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty pane point");
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(600);
}
// 노드를 차례로 골라(⌘ 클릭) 정렬 단축키
async function selectAndAlign(keys, shortcut) {
  for (const [index, key] of keys.entries()) {
    const box = await page.locator(`.react-flow__node[data-id="${nid(key)}"]`).boundingBox();
    if (index > 0) await page.keyboard.down("Meta");
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(14, box.height / 2));
    if (index > 0) await page.keyboard.up("Meta");
  }
  await page.keyboard.press(shortcut);
  await page.waitForTimeout(900);
  await clickEmptyPane();
}
// PNG 창을 열고 표시 정보 칩을 모두 켜거나 끈 뒤(입출력 펼침 선택) 내려받기를 누른다. 다운로드 약속은 객체로 감싸 돌려준다 —
// async 함수가 약속을 그대로 돌려주면 호출부 await가 다운로드 끝(출력 보기 해제 뒤)까지 기다린다
async function startExport({ fieldsOn, expandIo }) {
  const button = page.locator('[data-id="export-png"]');
  if (!(await button.isVisible())) await page.locator('button[aria-label="맵"]').first().click();
  await button.click();
  await page.locator('[data-id="png-export-modal"]').waitFor();
  await page.waitForTimeout(600);
  for (const chip of await page.locator('[data-id^="png-export-field-"]').all()) {
    if (((await chip.getAttribute("aria-checked")) === "true") !== fieldsOn) await chip.click();
  }
  await page.waitForTimeout(500);
  const expand = page.locator('[data-id="png-export-expand-io"]');
  if ((await expand.count()) > 0 && ((await expand.getAttribute("aria-checked")) === "true") !== expandIo) await expand.click();
  await page.waitForTimeout(400);
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.locator('[data-id="png-export-download"]').dispatchEvent("click");
  return { download };
}

await selectAndAlign(COLUMN, "Alt+KeyC");
await selectAndAlign(["long", "short"], "Alt+KeyX");
const canvas = await measure(COLUMN);
check("column centered on canvas with all info", spread(canvas) < 1, `spread ${spread(canvas).toFixed(2)}px`);
check("process widths differ on canvas", new Set(canvas.slice(1, 4).map((r) => Math.round(r.w))).size > 1);
const [canvasUp, canvasLong, canvasShort] = await measure(ROW);
check("row middle-aligned on canvas", Math.abs(canvasLong.cy - canvasShort.cy) < 1, `cy ${canvasLong.cy.toFixed(1)} / ${canvasShort.cy.toFixed(1)}`);
await page.locator(".react-flow").screenshot({ path: `${OUT}/png-export-align-canvas.png` });

// 1) 표시 정보를 모두 끄고 Word로 — 출력 보기 동안 열 가운데가 캔버스와 같아야 한다
const { download: firstDownload } = await startExport({ fieldsOn: false, expandIo: false });
const print = await pollUntil(() => measure(COLUMN), (rows) => rows[1].w < canvas[1].w - 10 && spread(rows) < 1);
check("print view narrows the info-heavy nodes", print[1].w < canvas[1].w - 10, `${canvas[1].w.toFixed(0)} -> ${print[1].w.toFixed(0)}px`);
check("print view keeps the column centered", spread(print) < 1, `spread ${spread(print).toFixed(2)}px`);
check("print view keeps the canvas center line", Math.abs(print[0].cx - canvas[0].cx) < 1);
await (await firstDownload).saveAs(`${OUT}/png-export-align-word.png`);
await page.waitForTimeout(800);
const after = await measure(COLUMN);
check("canvas returns to its own layout after export", spread(after) < 1 && Math.abs(after[1].w - canvas[1].w) < 1);

// 2) 표시 정보를 모두 켜고 입출력 펼침으로 — 커진 노드가 가운데를 지키려 올라가도 위 노드와 겹치지 않아야 한다
const { download: secondDownload } = await startExport({ fieldsOn: true, expandIo: true });
let previousTop = null;
let steady = 0;
const expanded = await pollUntil(
  () => measure(ROW),
  ([, long, short]) => {
    // 간격 보정 트윈(350ms)이 멈출 때까지 — 같은 위치가 세 번 이어지면 자리 잡은 것
    steady = previousTop !== null && Math.abs(long.top - previousTop) < 0.5 ? steady + 1 : 0;
    previousTop = long.top;
    return long.h > canvasLong.h + 40 && Math.abs(long.cy - short.cy) < 1 && steady >= 3;
  },
);
const [upPrint, longPrint, shortPrint] = expanded;
check("expanded I/O grows the long node", longPrint.h > canvasLong.h + 40, `${canvasLong.h.toFixed(0)} -> ${longPrint.h.toFixed(0)}px`);
check("expanded row stays middle-aligned", Math.abs(longPrint.cy - shortPrint.cy) < 1, `cy ${longPrint.cy.toFixed(1)} / ${shortPrint.cy.toFixed(1)}`);
check("expanded node clears the node above", longPrint.top > upPrint.bottom + 1, `gap ${(longPrint.top - upPrint.bottom).toFixed(1)}px`);
check("node above stays put", Math.abs(upPrint.top - canvasUp.top) < 1);
await (await secondDownload).saveAs(`${OUT}/png-export-align-expand.png`);
await page.waitForTimeout(800);
const [, longAfter, shortAfter] = await measure(ROW);
check("row returns to its canvas layout after export", Math.abs(longAfter.h - canvasLong.h) < 1 && Math.abs(shortAfter.top - canvasShort.top) < 1);

await browser.close();
if (!KEEP) await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${results.length} PASS` : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);

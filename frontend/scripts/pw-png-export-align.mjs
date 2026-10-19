// PNG 출력 정렬 유지 스모크 — 폭이 다른 노드 세로 열을 모든 표시 정보를 켠 캔버스에서 가운데 정렬(Alt+C)한 뒤,
// PNG 창에서 표시 정보를 모두 끄고 Word로 내려받는다. 출력 보기 동안 노드 가운데 x가 캔버스와 같은지(lib/print-anchor),
// 출력이 끝나면 캔버스 좌표가 원래대로인지 본다.
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

// ---- 시드: 위→아래로 이어지는 세로 열, 표시 정보 양이 달라 폭이 다르다 ----
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
const COLUMN = ["s", "a", "b", "c", "e"];
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
  ],
  edges: COLUMN.slice(1).map((key, index) => ({
    id: nid(`e${index}`),
    source_node_id: nid(COLUMN[index]),
    target_node_id: nid(key),
    ...vertical,
  })),
});
check("seeded column map", true, `map ${map.id} v${draft.id}`);

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

// 노드 화면 가운데 x·폭
const measure = () =>
  page.evaluate((ids) => {
    return ids.map((id) => {
      const rect = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect();
      return { cx: rect.left + rect.width / 2, w: rect.width };
    });
  }, COLUMN.map(nid));
const spread = (rows) => Math.max(...rows.map((r) => r.cx)) - Math.min(...rows.map((r) => r.cx));

// 다섯 노드를 골라(⌘ 클릭) 가운데 정렬
for (const [index, key] of COLUMN.entries()) {
  const box = await page.locator(`.react-flow__node[data-id="${nid(key)}"]`).boundingBox();
  if (index > 0) await page.keyboard.down("Meta");
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(14, box.height / 2));
  if (index > 0) await page.keyboard.up("Meta");
}
await page.keyboard.press("Alt+KeyC");
await page.waitForTimeout(900);
await page.mouse.click(1200, 900);
await page.waitForTimeout(600);
const canvas = await measure();
check("column centered on canvas with all info", spread(canvas) < 1, `spread ${spread(canvas).toFixed(2)}px`);
check("process widths differ on canvas", new Set(canvas.slice(1, 4).map((r) => Math.round(r.w))).size > 1);
await page.locator(".react-flow").screenshot({ path: `${OUT}/png-export-align-canvas.png` });

// PNG 창에서 표시 정보를 모두 끄고 Word로 — 출력 보기 동안 가운데가 캔버스와 같아야 한다
const button = page.locator('[data-id="export-png"]');
if (!(await button.isVisible())) await page.locator('button[aria-label="맵"]').first().click();
await button.click();
await page.locator('[data-id="png-export-modal"]').waitFor();
await page.waitForTimeout(600);
for (const chip of await page.locator('[data-id^="png-export-field-"]').all()) {
  if ((await chip.getAttribute("aria-checked")) === "true") await chip.click();
}
await page.waitForTimeout(400);
const download = page.waitForEvent("download", { timeout: 120_000 });
await page.locator('[data-id="png-export-download"]').dispatchEvent("click");
// 출력 보기(600ms) + 정렬 유지 이동이 자리 잡은 뒤, 캡처가 끝나기 전
await page.waitForTimeout(950);
const print = await measure();
check("print view narrows the info-heavy nodes", print[1].w < canvas[1].w - 10, `${canvas[1].w.toFixed(0)} -> ${print[1].w.toFixed(0)}px`);
check("print view keeps the column centered", spread(print) < 1, `spread ${spread(print).toFixed(2)}px`);
check("print view keeps the canvas center line", Math.abs(print[0].cx - canvas[0].cx) < 1);
const file = await download;
await file.saveAs(`${OUT}/png-export-align-word.png`);
await page.waitForTimeout(800);
const after = await measure();
check("canvas returns to its own layout after export", spread(after) < 1 && Math.abs(after[1].w - canvas[1].w) < 1);

await browser.close();
if (!KEEP) await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${results.length} PASS` : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);

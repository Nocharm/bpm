// CSV 내보내기 창 스모크 — 미리보기(열 쉬머 등장·퇴장 중간 프레임)·경고 목록(제목 중복 맵)·파일 이름·650px 화면 사용성,
// 수식처럼 보이는 글(`- 확인`·`=HYPERLINK(…)`)의 내보내기 → 다시 가져오기 왕복(가드 ' 가 벗겨져 원문 복원)을 본다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3063 node scripts/pw-smoke-csv-export-dialog.mjs  (PW_LANG=ko|en, 기본 ko)
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys. 산출물은 저장소 루트 .shots/csv-export-*.png
import { mkdirSync, readFileSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const LANG = process.env.PW_LANG ?? "ko";
const SHOTS = "../.shots";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
// 650px 높이 — 노트북 화면에서 창이 Download를 자르지 않는지 같이 본다
const ctx = await browser.newContext({ viewport: { width: 1366, height: 650 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.addInitScript((lang) => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", lang);
  window.localStorage.removeItem("bpm.exportColumns.csv");
}, LANG);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));

const api = (path, { method = "GET", body } = {}) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body },
  );
const rid = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

const FORMULA = '=HYPERLINK("https://example.com","x")';
const MAP_TAB = LANG === "ko" ? "맵" : "Map";

async function seedMap(name, nodes, edges) {
  const dir = await api("/directory");
  const owningDept = dir.departments[0]?.id;
  const map = await api("/maps", { method: "POST", body: { name, description: "", visibility: "public", owning_department: owningDept } });
  const versionId = map.versions[0].id;
  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${versionId}/graph`, { method: "PUT", body: { nodes, edges, groups: [] } });
  return { mapId: map.id, versionId };
}

async function openEditor({ mapId, versionId }) {
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".react-flow__node", { timeout: 60000 });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-id="export-csv"]').isVisible().catch(() => false))) {
    await page.locator(`button[aria-label="${MAP_TAB}"]`).first().click();
    await page.waitForSelector('[data-id="export-csv"]', { timeout: 5000 });
  }
}

const modal = page.locator('[data-id="csv-export-modal"]');
const created = [];
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });

  // ── 맵 A: 수식처럼 보이는 글, 경고 없음 ──
  const [s, a, b, c, e] = [rid(), rid(), rid(), rid(), rid()];
  const mapA = await seedMap(
    `CSV dialog smoke ${Date.now()}`,
    [
      { id: s, title: "Start", node_type: "start", pos_x: 0, pos_y: 0, sort_order: 0 },
      { id: a, title: "- 확인", node_type: "process", pos_x: 200, pos_y: 0, sort_order: 1, description: FORMULA, assignee_role: "+담당", system: "SAP" },
      { id: b, title: "검토", node_type: "process", pos_x: 420, pos_y: 0, sort_order: 2, description: "-5", input: "@메모\n- 둘째", output: "검토서" },
      { id: c, title: "승인", node_type: "process", pos_x: 640, pos_y: 0, sort_order: 3, duration: "1.30" },
      { id: e, title: "", node_type: "end", pos_x: 860, pos_y: 0, sort_order: 4, is_primary_end: true },
    ],
    [
      { id: rid(), source_node_id: s, target_node_id: a, label: "" },
      { id: rid(), source_node_id: a, target_node_id: b, label: "" },
      { id: rid(), source_node_id: b, target_node_id: c, label: "" },
      { id: rid(), source_node_id: c, target_node_id: e, label: "" },
    ],
  );
  created.push(mapA.mapId);
  await openEditor(mapA);
  await page.locator('[data-id="export-csv"]').click();
  await modal.waitFor();
  await page.waitForTimeout(400);
  await modal.screenshot({ path: `${SHOTS}/csv-export-preview.png` });

  const previewText = await page.locator('[data-id="csv-export-preview"]').innerText();
  check("preview shows the raw title, not the guarded one", previewText.includes("- 확인") && !previewText.includes("'- 확인"));
  check("preview shows the formula text as is", previewText.includes(FORMULA));
  const fileName = await page.locator('[data-id="csv-export-file-name"]').innerText();
  check("footer shows a KST-stamped file name", /^CSV-dialog-smoke-\d+(_[^_]+)?_\d{8}-\d{4}\.csv$/.test(fileName.trim()), fileName.trim());
  check("no warnings for a clean map", (await page.locator('[data-id="csv-export-no-warnings"]').count()) === 1);
  const box = await page.locator('[data-id="csv-export-download"]').boundingBox();
  check("Download stays on screen at 650px tall", box !== null && box.y + box.height <= 650, JSON.stringify(box));

  // 열 해제 → 퇴장 쉬머 중간 프레임, 다시 켜기 → 등장 중간 프레임
  const descBox = page.locator('[data-id="export-columns-csv"] [data-id="export-column-description"]');
  await descBox.click();
  await page.waitForTimeout(180);
  await modal.screenshot({ path: `${SHOTS}/csv-export-column-out-mid.png` });
  const outClass = await page.locator('[data-id="csv-export-preview-col-description"]').getAttribute("class").catch(() => "");
  check("unchecked column plays the exit shimmer", (outClass ?? "").includes("shimmer-out"), outClass ?? "gone");
  await page.waitForTimeout(600);
  check("unchecked column leaves the preview", (await page.locator('[data-id="csv-export-preview-col-description"]').count()) === 0);
  await descBox.click();
  await page.waitForTimeout(180);
  await modal.screenshot({ path: `${SHOTS}/csv-export-column-in-mid.png` });
  const inClass = await page.locator('[data-id="csv-export-preview-col-description"]').getAttribute("class");
  check("re-checked column plays the enter shimmer", (inClass ?? "").includes("shimmer-in"), inClass ?? "");
  await page.waitForTimeout(600);

  // 내려받기 → 파일 내용(가드) 확인
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-id="csv-export-download"]').click()]);
  check("downloaded name matches the footer", download.suggestedFilename() === fileName.trim(), download.suggestedFilename());
  const path = `${SHOTS}/csv-export-roundtrip.csv`;
  await download.saveAs(path);
  const bytes = readFileSync(path);
  check("file starts with a UTF-8 BOM", bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
  const text = bytes.toString("utf8").slice(1);
  check("formula-like cells are guarded in the file", text.includes("\r\n'- 확인,") && text.includes(`"'=HYPERLINK(""https://example.com"",""x"")"`) && text.includes(",'+담당,"));

  // 같은 맵에 다시 가져오기 — 미리보기 캔버스에 원문 제목, 적용 뒤 저장 값도 원문
  await page.locator('[data-id="toolbar-import-csv"]').click();
  await page.waitForSelector('[data-id="csv-import-section"]');
  await page.locator('[data-id="csv-paste-toggle"]').click();
  await page.locator('[data-id="csv-paste-input"]').fill(text);
  await page.locator('[data-id="csv-import-continue"]').click();
  await page.waitForSelector('[data-id="csv-import-tab"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/csv-export-reimport-preview.png` });
  const canvasText = await page.locator(".react-flow__nodes").innerText();
  check("re-import preview shows the original titles", !/'- 확인/.test(canvasText) && canvasText.includes("- 확인"), canvasText.replace(/\n/g, " | ").slice(0, 120));
  await page.locator('[data-id="csv-import-apply"]').click();
  await page.waitForSelector('[data-id="csv-import-tab"]', { state: "detached", timeout: 10000 });
  await page.waitForTimeout(3500); // autosave
  const graph = await api(`/versions/${mapA.versionId}/graph`);
  const byId = Object.fromEntries(graph.nodes.map((node) => [node.id, node]));
  check(
    "saved values are the original text after the round trip",
    byId[a]?.title === "- 확인" && byId[a]?.description === FORMULA && byId[a]?.assignee_role === "+담당" && byId[b]?.description === "-5" && byId[b]?.input === "@메모\n- 둘째",
    JSON.stringify({ a: [byId[a]?.title, byId[a]?.description, byId[a]?.assignee_role], b: [byId[b]?.description, byId[b]?.input] }),
  );

  // ── 맵 B: 제목 중복·끝으로 가는 라벨 연결·갈래 1개 판단 → 경고 목록 ──
  const [s2, x1, x2, d, y, e2] = [rid(), rid(), rid(), rid(), rid(), rid()];
  const mapB = await seedMap(
    `CSV dialog warnings ${Date.now()}`,
    [
      { id: s2, title: "Start", node_type: "start", pos_x: 0, pos_y: 0, sort_order: 0 },
      { id: x1, title: "검토", node_type: "process", pos_x: 200, pos_y: 0, sort_order: 1 },
      { id: x2, title: "검토", node_type: "process", pos_x: 420, pos_y: 0, sort_order: 2 },
      { id: d, title: "승인 여부", node_type: "decision", pos_x: 640, pos_y: 0, sort_order: 3 },
      { id: y, title: "발주", node_type: "process", pos_x: 860, pos_y: 0, sort_order: 4 },
      { id: e2, title: "", node_type: "end", pos_x: 1080, pos_y: 0, sort_order: 5, is_primary_end: true },
    ],
    [
      { id: rid(), source_node_id: s2, target_node_id: x1, label: "" },
      { id: rid(), source_node_id: x1, target_node_id: x2, label: "" },
      { id: rid(), source_node_id: x2, target_node_id: d, label: "" },
      { id: rid(), source_node_id: d, target_node_id: y, label: "예" },
      { id: rid(), source_node_id: y, target_node_id: e2, label: "완료" },
    ],
  );
  created.push(mapB.mapId);
  await openEditor(mapB);
  await page.locator('[data-id="export-csv"]').click();
  await modal.waitFor();
  await page.waitForTimeout(400);
  await modal.screenshot({ path: `${SHOTS}/csv-export-warnings.png` });
  const kinds = await page.locator('[data-id^="csv-export-warning-"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-id")));
  check(
    "warnings are listed before download",
    ["duplicateTitle", "endEdgeLabeled", "decisionFewBranches"].every((kind) => kinds.includes(`csv-export-warning-${kind}`)),
    kinds.join(","),
  );
  const warnText = await page.locator('[data-id="csv-export-warnings"]').innerText();
  check("warning text is localized with parameters", warnText.includes('"검토"') && warnText.includes("완료"), warnText.replace(/\n/g, " | "));
  const box2 = await page.locator('[data-id="csv-export-download"]').boundingBox();
  check("Download stays on screen with warnings at 650px", box2 !== null && box2.y + box2.height <= 650, JSON.stringify(box2));
  await page.locator('[data-id="csv-export-cancel"]').click();
} catch (error) {
  check("smoke run", false, String(error).slice(0, 400));
} finally {
  for (const id of created) await api(`/maps/${id}`, { method: "DELETE" }).catch(() => undefined);
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);

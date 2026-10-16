// PNG 내보내기 Word 문서용 테마 스모크 — API로 복잡한 맵(긴 제목·병렬 출구·3갈래 판단·되돌림·끝 2개·영역·GMP·사용자 색)을
// 시드하고 옵션 창(화면 그대로 ↔ Word 문서용, 스타일 3종, 병렬 표시·정보 블록 토글)을 조작하며 캡처한 뒤
// 스타일별 PNG를 실제로 내려받아 저장한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-png-export-word.mjs
//   PW_LANG=ko|en(기본 ko). KEEP=1 이면 시드 맵을 지우지 않는다. 산출물은 저장소 루트 .shots/png-export-*.png (gitignore).
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys.
import { mkdirSync, readFileSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const LANG = process.env.PW_LANG ?? "ko";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };

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

// ---- 시드 ----
const tag = Date.now().toString(36);
const nid = (key) => `png-${tag}-${key}`;
const nodes = [];
const edges = [];
const node = (key, title, x, y, extra = {}) => {
  nodes.push({ id: nid(key), title, node_type: "process", pos_x: x, pos_y: y, ...extra });
  return nid(key);
};
const edge = (key, source, target, extra = {}) => {
  edges.push({ id: nid(`e-${key}`), source_node_id: source, target_node_id: target, label: "", ...extra });
};
const REGION = `g-${tag}`;
const START = node("start", "", 0, 160, { node_type: "start" });
const T1 = node("t1", "구매 요청서 작성 및\n예산 코드 확인", 160, 140, { assignee_role: "요청자", system: "SAP", group_ids: [REGION] });
const T2 = node("t2", "요청 접수", 420, 150, { assignee_role: "구매 담당", group_ids: [REGION], parallel_outputs: ["__primary__"] });
// 입출력 링크(P1 산출물 → Q 입력물) — 연결선 전달물 점·링크 표식이 Word 출력에서 빠지는지 본다
const IO_ITEM = `io-${tag}-budget`;
const P1 = node("p1", "예산 잔액 검토", 680, 40, {
  assignee_role: "재무 담당",
  system: "SAP",
  color: "#c2849a",
  output: "예산 승인서",
  output_ids: IO_ITEM,
});
const P2 = node("p2", "공급업체 이력 조회\n(최근 3년 거래 실적·품질 이슈 포함)", 680, 260, { assignee_role: "구매 담당", gmp: "direct" });
const Q = node("q", "품질 검토 및 GMP 적합성 평가", 960, 150, { gmp: "indirect", input: "예산 승인서", input_links: IO_ITEM });
const D = node("d", "금액 1억 원\n초과 여부", 1240, 140, { node_type: "decision", input: "결재 기준표", output: "승인 결과" });
const T3 = node("t3", "경영진 결재", 1480, 20, { assignee_role: "대표이사" });
const T4 = node("t4", "팀장 결재", 1480, 160, { assignee_role: "구매팀장" });
const T5 = node("t5", "추가 자료 요청 및\n요청 부서 회신", 1480, 320, { assignee_role: "구매 담당" });
const T6 = node("t6", "발주 및 결과 통보", 1740, 90, { system: "SAP" });
const END = node("end", "", 2000, 100, { node_type: "end" });
const END_R = node("endr", "반려 종료", 1240, 420, { node_type: "end" });
edge("1", START, T1);
edge("2", T1, T2);
edge("3", T2, P1);
edge("4", T2, P2);
edge("5", P1, Q);
edge("6", P2, Q);
edge("7", Q, D);
edge("8", D, T3, { label: "예" });
edge("9", D, T4, { label: "아니오" });
edge("10", D, T5, { label: "보류 (추가 검토 필요)" });
edge("11", T3, T6);
edge("12", T4, T6);
edge("13", T6, END);
edge("14", T5, T1, { label: "재요청 (보완 서류 첨부)" });
edge("15", Q, END_R, { label: "반려" });

const maps = await api("GET", "/api/maps");
for (const stale of maps.filter((m) => m.name.startsWith("PNG export smoke"))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
if (!owning) throw new Error("no org_path in directory — seed the directory first");
const map = await api("POST", "/api/maps", {
  name: `PNG export smoke 구매 요청 처리 및 품질 적합성 검토 ${tag}`,
  owning_department: owning,
  visibility: "private",
});
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
await api("PUT", `/api/versions/${draft.id}/graph`, {
  nodes,
  edges,
  groups: [{ id: REGION, label: "요청 부서", color: "#6e84a3" }],
});
check("seeded worst-case map", true, `map ${map.id} v${draft.id}`);

// ---- 브라우저 ----
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.addInitScript((lang) => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", lang);
}, LANG);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
await page.waitForTimeout(2500);

const modal = page.locator('[data-id="png-export-modal"]');
// 인스펙터 맵 탭(탭 버튼은 aria-label만 가진다 — pw-verify-pulse-still과 동일)
const MAP_TAB_LABEL = LANG === "ko" ? "맵" : "Map";
const openModal = async () => {
  const button = page.locator('[data-id="export-png"]');
  if (!(await button.isVisible())) {
    await page.locator(".react-flow__pane").first().click({ position: { x: 20, y: 20 } });
    await page.locator(`button[aria-label="${MAP_TAB_LABEL}"]`).first().click();
  }
  await button.click();
  await modal.waitFor();
};
const download = async (name) => {
  const [file] = await Promise.all([page.waitForEvent("download"), page.locator('[data-id="png-export-download"]').click()]);
  await file.saveAs(`${OUT}/png-export-${name}.png`);
  if (name.startsWith("word")) {
    const bytes = readFileSync(`${OUT}/png-export-${name}.png`);
    const at = bytes.indexOf(Buffer.from("pHYs"));
    const dpi = at > 0 ? Math.round(bytes.readUInt32BE(at + 4) * 0.0254) : 0;
    check(`${name} carries print dpi`, dpi > 0, `${dpi} dpi, ${bytes.readUInt32BE(16)}px wide`);
  }
  await modal.waitFor({ state: "detached" });
  // 캡처 뒤 화면에서 Word 클래스가 걷혔는지
  const leftover = await page.locator(".react-flow__viewport.bpm-export-word").count();
  check(`download ${name} restores canvas`, leftover === 0);
  await page.waitForTimeout(600);
};

await openModal();
check("modal opens on canvas theme by default", (await page.locator('[data-id="png-export-theme-screen"]').getAttribute("aria-pressed")) === "true");
await modal.screenshot({ path: `${OUT}/png-export-modal-screen.png` });
await download("screen");

await openModal();
await page.locator('[data-id="png-export-theme-word"]').click();
await page.waitForTimeout(180);
await modal.screenshot({ path: `${OUT}/png-export-modal-shimmer-in.png` });
await page.waitForTimeout(600);
check("word options appear", await page.locator('[data-id="png-export-word-options"]').isVisible());
check("screen card leaves after shimmer", (await page.locator('[data-id="png-export-preview-card"]').count()) === 0);
const panelWidth = await page.locator('[data-id="png-export-print-panel"]').evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().width);
check("print panel slides open", panelWidth >= 290, `${Math.round(panelWidth)}px`);
await modal.screenshot({ path: `${OUT}/png-export-modal-word.png` });
// 인쇄 크기 — 가로 용지 + 너비 60%로 바꾸면 cm·dpi·pt가 갱신된다
const dimsBefore = await page.locator('[data-id="png-export-print-dims"]').textContent();
await page.locator('[data-id="png-export-paper-landscape"]').click();
await page.locator('[data-id="png-export-print-width"]').fill("60");
await page.waitForTimeout(450);
const dimsAfter = await page.locator('[data-id="png-export-print-dims"]').textContent();
check("print size follows paper and width", dimsBefore !== dimsAfter, `${dimsBefore} -> ${dimsAfter}`);
console.log(`  dpi ${await page.locator('[data-id="png-export-print-dpi"]').textContent()} · text ${await page.locator('[data-id="png-export-print-pt"]').textContent()}`);
await modal.screenshot({ path: `${OUT}/png-export-modal-print-landscape.png` });
await page.locator('[data-id="png-export-paper-portrait"]').click();
await page.locator('[data-id="png-export-print-width"]').fill("100");
await page.waitForTimeout(450);

await page.locator('[data-id="png-export-toggle-parallel"]').click();
await page.waitForTimeout(180);
await modal.screenshot({ path: `${OUT}/png-export-modal-shimmer-out.png` });
await page.waitForTimeout(600);
check("parallel mark removed", (await page.locator('[data-id="png-export-preview-parallel"]').count()) === 0);
await page.locator('[data-id="png-export-toggle-parallel"]').click();
await page.waitForTimeout(600);

for (const style of ["mono", "gray", "navy"]) {
  await page.locator(`[data-id="png-export-style-${style}"]`).click();
  await page.waitForTimeout(450);
  await modal.screenshot({ path: `${OUT}/png-export-modal-${style}.png` });
  await download(`word-${style}`);
  await openModal();
  check(`remembers ${style}`, (await page.locator(`[data-id="png-export-style-${style}"]`).getAttribute("aria-pressed")) === "true");
}
// 교차 표시 — 점프(기본)는 위 navy 출력, 터널·없음을 추가로 내려받는다
await page.locator('[data-id="png-export-crossing-gap"]').click();
await page.waitForTimeout(200);
await modal.screenshot({ path: `${OUT}/png-export-modal-crossing-shimmer.png` });
await page.waitForTimeout(500);
check("gap glyphs replace jump glyphs", (await page.locator('[data-id^="png-export-preview-gap-"]').count()) === 2 && (await page.locator('[data-id^="png-export-preview-jump-"]').count()) === 0);
await modal.screenshot({ path: `${OUT}/png-export-modal-crossing-gap.png` });
await download("word-navy-gap");
await openModal();
await page.locator('[data-id="png-export-crossing-none"]').click();
await page.locator('[data-id="png-export-toggle-info"]').click();
await page.locator('[data-id="png-export-toggle-parallel"]').click();
await page.waitForTimeout(600);
await download("word-navy-bare");

// 표시 정보 — 입력물·산출물을 켜고 입출력 펼침, 미리보기에 줄이 생기는지 보고 그 보기로 출력한다
await openModal();
await page.locator('[data-id="png-export-toggle-info"]').click();
for (const field of ["input", "output"]) {
  const chip = page.locator(`[data-id="png-export-field-${field}"]`);
  if ((await chip.getAttribute("aria-checked")) !== "true") await chip.click();
}
await page.waitForTimeout(200);
await modal.screenshot({ path: `${OUT}/png-export-modal-fields-shimmer.png` });
await page.waitForTimeout(500);
check("preview shows io lines", (await page.locator('[data-id="png-export-preview-line-input"]').count()) === 1);
await page.locator('[data-id="png-export-expand-io"]').click();
await page.waitForTimeout(600);
check("preview expands decision io", (await page.locator('[data-id="png-export-preview-dec-list"]').count()) === 1);
await modal.screenshot({ path: `${OUT}/png-export-modal-fields.png` });
await download("word-navy-io");
// 출력 뒤 캔버스는 원래 표시 정보로 — 분기 IO 아일랜드는 다시 알약
check("canvas back to own display after export", (await page.locator('[data-id="decision-io-island"][data-expanded="true"]').count()) === 0);

// A4 가이드 — 보기 카드 스위치로 켜고 세로·가로 캡처
await page.locator('[data-id="canvas-node-display-float-toggle"]').click();
await page.locator('[data-id="canvas-a4-guide-toggle"]').click();
await page.waitForTimeout(500);
check("a4 guide draws on canvas", (await page.locator('[data-id="canvas-a4-guide"]').count()) === 1);
await page.screenshot({ path: `${OUT}/png-export-a4-guide-portrait.png` });
await page.locator('[data-id="canvas-a4-guide-paper-landscape"]').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/png-export-a4-guide-landscape.png` });
await page.locator('[data-id="canvas-a4-guide-toggle"]').click();

await browser.close();
if (!KEEP) await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${results.length} PASS` : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);

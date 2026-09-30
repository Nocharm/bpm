// 매뉴얼 슬라이드 캡처 2부(6차 2026-09-30) — pw-manual-shots.mjs가 다루지 않는 화면: 홈 개요·인물 카드·슬롯 모달·노드 속성(역할)·
// 라이브러리 필터/피크/미등록·펼쳐 보기·AI 챗·피드백·비교 요약·L5 캔버스(승인 탭·L6 피커·탐색기·플레이스홀더 연결·끊긴 링크)·
// 설정 레일·지식기반·배치·현황·연계 권한자·대시보드. 산출물은 ../.shots/manual6/<lang>/ (gitignore).
// 실행(frontend/ 에서): PW_LANG=ko BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-manual-shots-6.mjs
// 전제: 5차와 같은 서버 3종(가짜 AI·backend AI_ENABLED·frontend). 더미 인터뷰 5종을 Apply해 플레이스홀더를 만들고,
// 마지막에 L6 맵 하나를 휴지통으로 보내 끊긴 링크 배너를 만든다(로컬 dev.db 전용).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const LANG = process.env.PW_LANG ?? "ko";
const OUT = process.env.PW_OUT_DIR ?? `../.shots/manual6/${LANG}`;
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
const ko = LANG === "ko";
const T = ko
  ? { kb: "지식기반", batch: "배치 작업", dash: "대시보드", admins: "연계 권한자", status: "현황", approval: "승인", feedback: "피드백", connect: "연결", map: "맵", sp: "서브프로세스" }
  : { kb: "Knowledge base", batch: "Batch jobs", dash: "Dashboard", admins: "Linkage admins", status: "Status", approval: "Approval", feedback: "Feedback", connect: "Connect", map: "Map", sp: "Subprocess" };
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };
const api = async (method, p, body) => {
  const r = await fetch(`${BACKEND}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
};
const shot = async (page, name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 82 });
  console.log(`shot ${name}`);
};
const step = async (name, fn) => {
  try { await fn(); } catch (e) {
    const lines = String(e).split("\n");
    const why = lines.filter((l) => /waiting for|resolved to|intercepts|strict mode/.test(l)).slice(0, 3).map((l) => l.trim()).join(" | ");
    check(name, false, `${lines[0].slice(0, 120)} :: ${why.slice(0, 300)}`);
  }
};

// ── 시드 보강 ──
const dummyDir = "../docs/samples/framework-linkage-dummy";
const files = fs.readdirSync(dummyDir).filter((f) => f.endsWith(".json")).map((f) => ({ name: f, content: JSON.parse(fs.readFileSync(path.join(dummyDir, f), "utf-8")) }));
await api("POST", "/api/categories/import-interview", { files, apply: true });
const notices = await api("GET", "/api/notices").catch(() => []);
if (!Array.isArray(notices) || notices.length === 0) {
  const now = new Date().toISOString();
  await api("POST", "/api/notices", { title: "BPM 프로세스맵 정식 오픈 안내", body_md: "전사 프로세스맵 서비스가 정식 오픈했습니다. 사용 매뉴얼은 상단 매뉴얼 버튼을 참고하세요.", importance: "important", starts_at: now, notify_all: false }).catch(() => undefined);
  await api("POST", "/api/notices", { title: "Scheduled maintenance: Oct 4 (Sat) 22:00-24:00", body_md: "Maintenance window. The service may be briefly unavailable.", importance: "normal", starts_at: now, notify_all: false }).catch(() => undefined);
}
const maps = await api("GET", "/api/maps");
const fwMaps = maps.filter((m) => m.mode === "framework");
check("framework maps present", fwMaps.length > 0, String(fwMaps.length));

const graphOf = async (map) => {
  const detail = await api("GET", `/api/maps/${map.id}`);
  const v = (detail.versions ?? []).find((x) => x.status === "draft") ?? (detail.versions ?? [])[0];
  return v ? { version: v, graph: await api("GET", `/api/versions/${v.id}/graph`) } : null;
};
let placeholderMap = null;
let linkedFw = null;
for (const m of fwMaps) {
  const g = await graphOf(m);
  if (!g) continue;
  const ph = g.graph.nodes.find((n) => n.placeholder_category_id != null || /L6 unspecified/.test(n.title ?? ""));
  if (ph && !placeholderMap) placeholderMap = { map: m, node: ph, ...g };
  const linked = g.graph.nodes.find((n) => n.linked_map_id != null);
  if (linked && !linkedFw && m.name.includes("정제수")) linkedFw = { map: m, node: linked, ...g };
}
check("placeholder canvas found", !!placeholderMap, placeholderMap?.map.name);
const fwMain = fwMaps.find((m) => m.name.includes("정제수")) ?? fwMaps[0];

// 일반 맵 시드 보강: 시드에는 역할·링크된 하위프로세스 노드가 없다 — 임포트 맵의 draft에 역할·시스템과 SP 링크 노드를 넣는다.
const target = maps.find((m) => m.mode !== "framework" && m.name.includes("수질")) ?? maps.find((m) => m.mode !== "framework" && !m.name.includes("비교 데모"));
const tDetail = await api("GET", `/api/maps/${target.id}`);
const tDraft = (tDetail.versions ?? []).find((v) => v.status === "draft") ?? tDetail.versions[0];
const tGraph = await api("GET", `/api/versions/${tDraft.id}/graph`);
const spTarget = maps.find((m) => m.mode !== "framework" && m.sp_designated_at && m.id !== target.id);
const roleNode = tGraph.nodes.find((n) => n.node_type === "process" && (n.title ?? "").includes("공급 차단")) ?? tGraph.nodes.find((n) => n.node_type === "process");
roleNode.assignee_role = "품질 담당자";
roleNode.system = "LIMS";
roleNode.department = roleNode.department || "";
const maxX = Math.max(...tGraph.nodes.map((n) => n.pos_x ?? 0));
const spNode = { id: `sp-manual-${Date.now().toString(36)}`, title: spTarget.name, node_type: "subprocess", linked_map_id: spTarget.id, follow_latest: true, pos_x: maxX + 320, pos_y: (tGraph.nodes[0]?.pos_y ?? 0) + 160 };
const putGraph = () => api("PUT", `/api/versions/${tDraft.id}/graph`, { nodes: [...tGraph.nodes.filter((n) => !String(n.id).startsWith("sp-manual-")), spNode], edges: tGraph.edges, groups: tGraph.groups ?? [] });
await api("POST", `/api/versions/${tDraft.id}/checkout`, { force: true }); // 임포트 오너가 쥔 체크아웃을 sysadmin이 인수
await putGraph();
const rolePick = { map: target, node: roleNode, version: tDraft };
const expandPick = { map: target, node: spNode, version: tDraft };
check("seeded role node + subprocess link", true, `${target.name} → ${spTarget.name}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1456, height: 837 }, deviceScaleFactor: 1 });
await ctx.addInitScript(([user, lang]) => {
  window.localStorage.setItem("bpm.devUser", user);
  window.localStorage.setItem("bpm.lang", lang);
}, [ADMIN, LANG]);
const page = await ctx.newPage();
const tab = (label) => page.locator(`button[aria-label="${label}"]`).first();
const readScale = () => page.evaluate(() => parseFloat(/scale\(([\d.]+)\)/.exec(document.querySelector(".react-flow__viewport")?.style.transform ?? "")?.[1] ?? "1"));
const zoomTo = async (target, el) => {
  const box = await el.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < 20; i++) {
    const s = await readScale();
    if (Math.abs(s - target) < 0.08) break;
    await page.mouse.wheel(0, s < target ? -60 : 60);
    await page.waitForTimeout(120);
  }
  await page.keyboard.up("Control");
};
const openEditor = async (map, version) => {
  await page.goto(`${BASE}/maps/${map.id}?version=${version.id}`, { waitUntil: "domcontentloaded" });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
};

// ── 홈 ──
await step("home", async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator('[data-id="home-dashboard"]').waitFor({ timeout: 20000 });
  const deptBtn = page.locator('[data-id="home-view-toggle"] button').first();
  if ((await deptBtn.getAttribute("aria-pressed")) !== "true") await deptBtn.click();
  await page.waitForTimeout(800);
  await shot(page, "home-overview");
  // 상세 패널 + 인물 카드
  const card = page.locator('[data-id="map-card"]', { hasText: ko ? "주문 처리" : "주문 처리" }).first();
  await card.locator('[data-id="map-card-name"]').click();
  await page.locator('[data-id="map-detail-aside"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  const aside = page.locator('[data-id="map-detail-aside"]');
  const pill = aside.getByText("System Admin", { exact: true }).last();
  await pill.hover().catch(() => undefined);
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-id="person-hover-card"]').count())) await pill.click().catch(() => undefined);
  await page.locator('[data-id="person-hover-card"], [data-id="person-info-popup"]').first().waitFor({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  await shot(page, "home-detail-person");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // 업무 체계 필 → 배정 모달
  await aside.locator('[data-id="map-detail-category"]').first().click();
  await page.locator('[data-id="framework-assign-modal"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await shot(page, "home-slot-modal");
  await page.keyboard.press("Escape");
});

// ── 에디터: 속성(역할) ──
await step("node-props", async () => {
  await openEditor(rolePick.map, rolePick.version);
  const fit = page.locator('.react-flow__controls-fitview').first();
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(500);
  const node = page.locator(`.react-flow__node[data-id="${rolePick.node.id}"]`);
  await node.click({ position: { x: 8, y: 8 }, force: true });
  await page.waitForTimeout(300);
  await zoomTo(0.8, node);
  await page.getByText(ko ? "BPM 속성" : "BPM attributes").first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  await shot(page, "editor-node-props");
});

// ── 에디터: 라이브러리·피크·미등록 ──
await step("library", async () => {
  await page.keyboard.press("Escape");
  await page.mouse.click(600, 600);
  await page.keyboard.press("s");
  await page.locator('[data-id="process-library-panel"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  if (await page.locator('[data-id="library-filter-clear"]').count()) { await page.locator('[data-id="library-filter-clear"]').click(); await page.waitForTimeout(500); }
  await page.locator('[data-id="library-filter-open"]').click();
  await page.waitForTimeout(400);
  await shot(page, "editor-library-filter");
  await page.locator('[data-id="library-filter-open"]').click(); // 팝오버 토글로 닫기(Esc는 패널까지 닫을 수 있다)
  await page.waitForTimeout(300);
  const panel = page.locator('[data-id="process-library-panel"]');
  if (!(await panel.isVisible().catch(() => false))) { await page.mouse.click(600, 600); await page.keyboard.press("s"); await panel.waitFor({ timeout: 10000 }); }
  // 이미 이 맵에 링크된 맵(spTarget)은 클릭이 포커스 이동이라 피크가 안 열린다 — 다른 지정 맵을 고른다
  const panelText = await panel.innerText();
  const peekName = ["Incident Response", "Customer Support", "Order Fulfillment"].find((n) => panelText.includes(n))
    ?? maps.find((m) => m.mode !== "framework" && m.id !== target.id && m.id !== spTarget.id && m.name.length > 3 && panelText.includes(m.name))?.name;
  await panel.getByText(peekName, { exact: true }).first().click();
  await page.locator('[data-id="library-peek"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(700);
  await shot(page, "editor-peek-node");
  await page.locator('[data-id="library-peek-tab-details"]').click();
  await page.waitForTimeout(500);
  await shot(page, "editor-peek-details");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (!(await panel.isVisible().catch(() => false))) { await page.mouse.click(600, 600); await page.keyboard.press("s"); await panel.waitFor({ timeout: 10000 }); }
  await page.locator('[data-id="library-filter-open"]').click();
  await page.waitForTimeout(400);
  const unreg = page.locator('[data-id="library-unregistered-toggle"], [data-id="library-filter-pill-unregistered"]').first();
  await unreg.click();
  await page.waitForTimeout(600);
  await shot(page, "editor-library-unregistered");
  await unreg.click().catch(() => undefined);
  await page.locator('[data-id="library-filter-open"]').click().catch(() => undefined);
});

// ── 에디터: 펼쳐 보기 ──
await step("expand", async () => {
  await openEditor(expandPick.map, expandPick.version);
  const fit = page.locator('.react-flow__controls-fitview').first();
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(500);
  const node = page.locator(`.react-flow__node[data-id="${expandPick.node.id}"]`);
  await node.click({ position: { x: 8, y: 8 }, force: true });
  await page.waitForTimeout(400);
  await page.locator('[data-id="node-action-expand"]').click();
  await page.waitForTimeout(1500);
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(500);
  await zoomTo(0.45, node);
  await page.waitForTimeout(600);
  await shot(page, "editor-expand");
});

// ── 에디터: AI 챗 ──
await step("ai-chat", async () => {
  await page.locator('[data-id="ai-menu"]').click();
  await page.locator('[data-id="ai-menu-chat"]').click();
  await page.waitForTimeout(1200);
  await shot(page, "editor-ai-chat");
});

// ── 피드백 패널(홈) ──
await step("feedback", async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator('[data-id="home-dashboard"]').waitFor({ timeout: 20000 });
  await page.locator(`button[aria-label="${T.feedback}"], button:has-text("${T.feedback}")`).first().click();
  await page.waitForTimeout(800);
  const ta = page.locator("textarea").last();
  await ta.fill(ko ? "비교 화면의 AI 요약이 결재에 도움이 됩니다. 제출 코멘트 초안 버튼도 좋아요." : "The AI summary on the compare screen helps approval. The submit-note draft button is handy too.");
  await page.waitForTimeout(300);
  await shot(page, "home-feedback");
});

// ── 비교: 맞춤 + 표시 카드 / 요약 탭 ──
await step("compare", async () => {
  const cmp = maps.find((m) => m.name.includes("비교 데모"));
  await page.goto(`${BASE}/maps/${cmp.id}/compare`, { waitUntil: "domcontentloaded" });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await zoomTo(0.5, page.locator(".react-flow__pane").first());
  await page.waitForTimeout(600);
  await page.locator('[data-id="compare-node-display-float-toggle"]').first().click();
  await page.waitForTimeout(400);
  await shot(page, "compare-display-card");
  await page.locator('[data-id="compare-node-display-float-toggle"]').first().click();
  await page.locator('[data-id="compare-inspector-tab-summary"]').click();
  await page.waitForTimeout(600);
  await shot(page, "compare-summary");
});

// ── L5 캔버스: 기본·승인 탭·L6 피커·탐색기 ──
await step("l5", async () => {
  const g = await graphOf(fwMain);
  await openEditor(fwMain, g.version);
  const fit = page.locator('.react-flow__controls-fitview').first();
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(600);
  await shot(page, "l5-canvas");
  await tab(T.approval).click();
  await page.waitForTimeout(700);
  await shot(page, "l5-approval");
  await tab(ko ? "속성" : "Properties").click().catch(() => undefined);
  await page.mouse.click(700, 500);
  await page.keyboard.press("s");
  await page.waitForTimeout(900);
  await shot(page, "l5-picker");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator('[data-id="l5-explorer-toggle"]').click();
  await page.locator('[data-id="framework-l5-explorer"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(600);
  await shot(page, "l5-explorer");
});

// ── L5 캔버스: 플레이스홀더 연결 ──
await step("placeholder", async () => {
  await openEditor(placeholderMap.map, placeholderMap.version);
  const fit = page.locator('.react-flow__controls-fitview').first();
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(500);
  const node = page.locator(`.react-flow__node[data-id="${placeholderMap.node.id}"]`);
  await node.click({ position: { x: 8, y: 8 }, force: true });
  await page.locator('[data-id="sp-banner-placeholder"]').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  await page.locator('[data-id="sp-banner-placeholder"]').first().evaluate((el) => el.click());
  await page.locator('[data-id="framework-connect-dialog"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(700);
  await shot(page, "l5-placeholder-connect");
  await page.keyboard.press("Escape");
});

// ── 설정: 레일·지식기반·배치·현황·권한자·대시보드 ──
await step("settings", async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await shot(page, "admin-rail");
  await page.getByText(T.kb, { exact: true }).first().click();
  await page.waitForTimeout(1200);
  page.on("dialog", (d) => d.accept());
  const trash = page.locator("main button:has(svg.lucide-trash-2), button:has(svg.lucide-trash-2)");
  for (let i = 0; i < 6 && (await trash.count()) > 1; i++) {
    await trash.last().evaluate((el) => el.click());
    await page.waitForTimeout(500);
    await page.locator('[role="dialog"] button, [data-id="confirm-dialog"] button').filter({ hasText: ko ? /삭제|확인/ : /Delete|Confirm|OK/ }).first().click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(900);
  }
  if ((await trash.count()) === 0) {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 8000 }),
      page.getByRole("button", { name: /Upload/i }).first().click(),
    ]).catch(() => [null]);
    if (chooser) { await chooser.setFiles(path.resolve("../docs/samples/interview-json-0.5.md")); await page.waitForTimeout(3000); }
  }
  await shot(page, "admin-kb");
  await page.getByText(T.batch, { exact: true }).first().click();
  await page.waitForTimeout(1000);
  await page.locator('[data-id="backup-run-now"]').click().catch(() => undefined);
  await page.waitForTimeout(2500);
  await shot(page, "admin-batch");
  await page.goto(`${BASE}/settings?tab=framework`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-id="framework-admin-tree"]').waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: T.status, exact: true }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, "admin-status");
  await page.getByRole("button", { name: ko ? "관리" : "Manage", exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-id="framework-admin-search"]').fill("정제수 일상 점검");
  await page.locator('[data-id="framework-admin-search-results"] button, [data-id="framework-admin-search-results"] li').first().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: T.admins }).first().click();
  await page.waitForTimeout(700);
  const search = page.locator('input[placeholder*="초성"], input[placeholder*="initial"]').last();
  await search.fill("Bora");
  await page.waitForTimeout(800);
  await page.locator('[data-id="search-select-menu"] button, [role="listbox"] button, [role="option"]').first().click().catch(() => undefined);
  await page.waitForTimeout(400);
  await search.fill("Hana").catch(() => undefined);
  await page.waitForTimeout(800);
  await page.locator('[data-id="search-select-menu"] button, [role="listbox"] button, [role="option"]').first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  await shot(page, "admin-linkage-admins");
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await page.getByText(T.dash, { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await shot(page, "admin-dashboard");
});

// ── 마지막: 끊긴 링크(L6 맵 휴지통) ──
await step("stale-link", async () => {
  const liveIds = new Set(maps.map((m) => m.id));
  let target = null;
  for (const m of fwMaps) {
    const g = await graphOf(m);
    const stale = g?.graph.nodes.find((x) => x.linked_map_id && !liveIds.has(x.linked_map_id));
    if (stale) { target = { map: m, node: stale, ...g }; break; }
  }
  if (!target) {
    target = linkedFw ?? (await (async () => { for (const m of fwMaps) { const g = await graphOf(m); const n = g?.graph.nodes.find((x) => x.linked_map_id); if (n) return { map: m, node: n, ...g }; } return null; })());
    if (!target) throw new Error("no linked L6 node");
    await api("POST", `/api/maps/${target.node.linked_map_id}/slot-changes`, { action: "delete", note: "manual capture: stale link" });
  }
  await openEditor(target.map, target.version);
  const fit = page.locator('.react-flow__controls-fitview').first();
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(500);
  const node = page.locator(`.react-flow__node[data-id="${target.node.id}"]`);
  await node.click({ position: { x: 8, y: 8 }, force: true });
  await page.locator('[data-id="sp-banner-slot-missing"]').first().waitFor({ timeout: 8000 });
  await zoomTo(0.8, node);
  await page.waitForTimeout(500);
  await shot(page, "l5-stale-link");
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

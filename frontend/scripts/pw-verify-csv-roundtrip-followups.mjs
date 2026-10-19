// CSV 왕복 잔여(시스템 리뷰 2026-10-19 7c) 브라우저 검증 — 유닛 테스트가 못 닿는 모달 표시와 실제 저장:
//   ① EUC-KR 파일 → 가져오기 모달에 인코딩 경고, 앞뒤 공백 제목 노드가 같은 노드로 매칭(0 removed)
//   ② 반복이 있는 맵을 행 순서를 바꿔 다시 가져와도 Start 연결 유지 + 원래 제목 보존(D-1·D-2)
//   ③ 닫히지 않은 따옴표 → 줄 번호가 든 오류(D-4)
//
// 실행 (frontend/ 에서):
//   bash:       BASE_URL=http://localhost:3000 node scripts/pw-verify-csv-roundtrip-followups.mjs
//   PowerShell: $env:BASE_URL="http://localhost:3000"; node scripts\pw-verify-csv-roundtrip-followups.mjs
// 전제: backend·frontend 기동, playwright-core 설치. 맵 1개를 만들고 끝에 소프트삭제한다.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "../.shots/csv-roundtrip-followups";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

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

const api = (path, { method = "GET", body } = {}) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body },
  );
const rid = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// EUC-KR 바이트 — Node에 EUC-KR 인코더가 없어 파이썬으로 만든다
const CSV = "Name,Next\n검토,작성:보완;\n작성,검토\n";
const eucPath = `${SHOTS}/loop-euc-kr.csv`;
writeFileSync(eucPath, execFileSync("python3", ["-c", "import sys; sys.stdout.buffer.write(sys.argv[1].encode('euc-kr'))", CSV]));

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
let mapId = null;
try {
  const dir = await api("/directory");
  const map = await api("/maps", {
    method: "POST",
    body: { name: `CSV-7c ${Date.now()}`, description: "", visibility: "public", owning_department: dir.departments[0].id },
  });
  mapId = map.id;
  const vid = map.versions[0].id;
  const NODE = {
    description: "", color: "", assignee: "", department: "", system: "", duration: "", url: "", url_label: "",
    pos_y: 0, group_ids: [], linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
  };
  const ids = { s: rid(), a: rid(), b: rid(), e: rid() };
  const edge = (s, t, label = "") => ({
    id: rid(), source_node_id: s, target_node_id: t, label,
    source_side: "right", target_side: "left", source_handle: null, target_handle: null,
  });
  await api(`/versions/${vid}/checkout`, { method: "POST", body: { force: false } });
  await api(`/versions/${vid}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        { ...NODE, id: ids.s, title: "Start", node_type: "start", pos_x: 0, sort_order: 0 },
        { ...NODE, id: ids.a, title: "작성", node_type: "process", pos_x: 220, sort_order: 1, color: "#5b8a72" },
        { ...NODE, id: ids.b, title: "검토 ", node_type: "process", pos_x: 440, sort_order: 2, system: "ERP" },
        { ...NODE, id: ids.e, title: "", node_type: "end", pos_x: 660, sort_order: 3, is_primary_end: true },
      ],
      edges: [edge(ids.s, ids.a), edge(ids.a, ids.b), edge(ids.b, ids.a, "보완"), edge(ids.b, ids.e)],
      groups: [],
    },
  });

  await page.goto(`${BASE}/maps/${mapId}?version=${vid}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="toolbar-import-csv"]', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 4, null, { timeout: 15000 });

  // ① EUC-KR 파일 업로드
  await page.locator('[data-id="toolbar-import-csv"]').click();
  await page.waitForSelector('[data-id="csv-import-section"]');
  await page.locator('[data-id="csv-import-section"] input[type="file"]').setInputFiles(eucPath);
  await page.waitForTimeout(400);
  const section = page.locator('[data-id="csv-import-section"]');
  const text1 = await section.innerText();
  check("encoding warning shown for an EUC-KR file", text1.includes("read as EUC-KR"), text1.split("\n").find((l) => l.includes("EUC-KR")) ?? "");
  check("title with a trailing space is matched, nothing removed", text1.includes("0 added · 4 matched · 0 removed"), text1.split("\n").find((l) => l.includes("matched")) ?? "");
  await section.screenshot({ path: `${SHOTS}/01-encoding-warning.png` });

  // ② 적용 후 저장된 그래프
  await page.locator('[data-id="csv-import-continue"]').click();
  await page.waitForSelector('[data-id="csv-import-tab"]');
  await page.locator('[data-id="csv-import-apply"]').click();
  await page.waitForSelector('[data-id="csv-import-tab"]', { state: "detached", timeout: 10000 });
  await page.waitForTimeout(500);
  const g = await api(`/versions/${vid}/graph`);
  const title = new Map(g.nodes.map((n) => [n.id, n.title]));
  const fromStart = g.edges.filter((e) => e.source_node_id === ids.s).map((e) => title.get(e.target_node_id));
  check("Start still points at 작성 after the reordered re-import", JSON.stringify(fromStart) === JSON.stringify(["작성"]), JSON.stringify(fromStart));
  const kept = g.nodes.find((n) => n.id === ids.b);
  check("matched node keeps its exact title and attributes", kept?.title === "검토 " && kept?.system === "ERP", JSON.stringify(kept?.title));
  check("rework loop edge survives", g.edges.some((e) => e.source_node_id === ids.b && e.target_node_id === ids.a && e.label === "보완"));

  // ③ 닫히지 않은 따옴표
  await page.locator('[data-id="toolbar-import-csv"]').click();
  await page.waitForSelector('[data-id="csv-import-section"]');
  await page.locator('[data-id="csv-paste-toggle"]').click();
  await page.locator('[data-id="csv-paste-input"]').fill('Name,Description,Next\n검토,"끝나지 않은 설명,\n작성,,\n');
  await page.waitForTimeout(400);
  const text3 = await section.innerText();
  check("unclosed quote reports its starting line", text3.includes("Unclosed quote starting on line 2"), text3.split("\n").find((l) => l.includes("quote")) ?? "");
  check("continue is blocked on the parse error", await page.locator('[data-id="csv-import-continue"]').isDisabled());
  await section.screenshot({ path: `${SHOTS}/02-unclosed-quote.png` });
} catch (err) {
  check("scenario ran without throwing", false, err instanceof Error ? err.message : String(err));
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 5)) console.log(`  ${e}`);
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);

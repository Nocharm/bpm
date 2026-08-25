// 맵 복사 버전 선택 + 드래프트 열림 + 휴지통 즉시삭제(sysadmin) 스모크.
// 실행: node scripts/pw-smoke-copy-purge.mjs  (서버 8000/3000 기동, org demo 시드 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = "http://localhost:8000/api";
const HDR = { "X-Dev-User": "admin.sys", "Content-Type": "application/json" };

const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok, extra]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en"); // 라벨 단언은 영어 기준
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

// 원본 맵 — 게시본이 있는 org demo 맵 하나 선택
const maps = await (await fetch(`${API}/maps`, { headers: HDR })).json();
const source = maps.find((m) => m.name === "Vendor Management");
if (!source) throw new Error("seed map 'Vendor Management' not found");
const detail = await (await fetch(`${API}/maps/${source.id}`, { headers: HDR })).json();
const draft = detail.versions.find((v) => v.status === "draft");

// [1] 홈 → 맵 선택 → 복사 모달 오픈
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-id^='map-row'], .text-caption", { timeout: 30000 }).catch(() => {});
await page.getByText("Vendor Management", { exact: true }).first().click();
// 카드가 아코디언·우측 패널 두 곳에 렌더 — 가시 버튼만 클릭
const copyBtn = page.locator("[data-id='map-detail-copy']:visible").first();
await copyBtn.waitFor({ state: "visible", timeout: 15000 });
await copyBtn.click();
await page.waitForSelector("[data-id='copy-map-dialog']", { timeout: 10000 });
check("copy dialog opens", true);

// [2] 버전 셀렉트 — 전체 버전 노출 + 기본값은 최신 승인본(published)
const options = await page.$$eval("[data-id='copy-map-dialog-version'] option", (els) =>
  els.map((o) => ({ value: o.value, label: o.textContent })),
);
check("version select lists all versions", options.length === detail.versions.length,
  `${options.length}/${detail.versions.length}`);
const selectedValue = await page.$eval("[data-id='copy-map-dialog-version']", (el) => el.value);
const selectedOpt = options.find((o) => o.value === selectedValue);
check("default = latest published", Boolean(selectedOpt?.label.includes("published")),
  selectedOpt?.label ?? "none");

// [3] 드래프트 버전 선택 + 이름 입력 후 제출 → 새 맵 에디터로 이동
const copyName = `Smoke Copy ${Date.now()}`;
await page.fill("[data-id='copy-map-dialog-name']", copyName);
await page.selectOption("[data-id='copy-map-dialog-version']", String(draft.id));
await page.click("[data-id='copy-map-dialog-confirm']");
await page.waitForURL(/\/maps\/\d+/, { timeout: 20000 });
const newMapId = Number(page.url().match(/\/maps\/(\d+)/)[1]);
check("navigates to new map editor", newMapId !== source.id, `map ${newMapId}`);
await page.waitForSelector(".react-flow__node", { timeout: 30000 });

// [4] 새 맵은 드래프트 1개 + 선택한 버전(v6 draft) 그래프가 복제됨.
// 계보(source_node_id)는 graph API가 노출하지 않음 — SMOKE_DB(sqlite 경로) 지정 시 DB 실측.
const newDetail = await (await fetch(`${API}/maps/${newMapId}`, { headers: HDR })).json();
check("new map has single draft", newDetail.versions.length === 1 && newDetail.versions[0].status === "draft",
  newDetail.versions.map((v) => v.status).join(","));
if (process.env.SMOKE_DB) {
  // execFileSync + 인자 배열 — 셸 미경유 (SMOKE_DB는 로컬 개발자 입력)
  const { execFileSync } = await import("node:child_process");
  const lineage = execFileSync("sqlite3", [
    process.env.SMOKE_DB,
    `SELECT group_concat(n.source_node_id) FROM nodes n JOIN map_versions v ON n.version_id=v.id WHERE v.map_id=${Number(newMapId)}`,
  ]).toString().trim();
  check("graph cloned from selected draft (v6)", lineage.includes("v6"), lineage);
} else {
  console.log("SKIP graph lineage check (set SMOKE_DB=<sqlite path>)");
}

// [5] 복사본 소프트삭제 → 설정 휴지통에서 즉시 삭제(sysadmin)
const del = await fetch(`${API}/maps/${newMapId}`, { method: "DELETE", headers: HDR });
if (del.status !== 204) throw new Error(`soft delete failed: ${del.status}`);
await page.goto("http://localhost:3000/settings", { waitUntil: "domcontentloaded" });
await page.getByText("Scheduled deletion", { exact: true }).first().click();
const row = page.locator("[data-id='deleted-map-row']", { hasText: copyName });
await row.waitFor({ state: "visible", timeout: 15000 });
await row.getByText("Delete now", { exact: true }).click();
await page.getByText("Permanently delete this map?").waitFor({ timeout: 10000 });
check("purge confirm dialog opens", true);
// ConfirmDialog의 확인 버튼(모달 내 "Delete now")
await page.locator("[data-id='confirm-dialog'] button, [role='dialog'] button, button", { hasText: "Delete now" }).last().click();
await row.waitFor({ state: "detached", timeout: 15000 });
check("row removed after purge", true);
const deletedList = await (await fetch(`${API}/maps/deleted/list`, { headers: HDR })).json();
check("purged map gone from trash API", !deletedList.some((m) => m.id === newMapId));

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

// 맵 복사 워크플로 재편 + 휴지통 즉시삭제 스모크 — 게시 이력 게이트(비활성 버튼)·
// CreateMapDialog copy 모드(버전 선택·비게시 안내·오너 안내·오우닝 프리필)·원본 은퇴(retire)·
// 알림(map_copied/map_retired, SMOKE_DB sqlite 실측)·설정 휴지통 Delete now(sysadmin).
// 실행: SMOKE_DB=<sqlite> node scripts/pw-smoke-copy-purge.mjs  (서버 8000/3000, org demo 시드 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = "http://localhost:8000/api";
const HDR = { "X-Dev-User": "admin.sys", "Content-Type": "application/json" };

const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok, extra]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` - ${extra}` : ""}`);
};

// ── API 준비 — 원본(게시 이력 有)·미게시 맵 ──
const maps = await (await fetch(`${API}/maps`, { headers: HDR })).json();
const source = maps.find((m) => m.name === "Vendor Management");
if (!source) throw new Error("seed map 'Vendor Management' not found");
const detail = await (await fetch(`${API}/maps/${source.id}`, { headers: HDR })).json();
const draft = detail.versions.find((v) => v.status === "draft");
const spUsage = await (
  await fetch(`${API}/maps/${source.id}/subprocess-usage`, { headers: HDR })
).json();
const owningDept = maps.find((m) => m.owning_department)?.owning_department;
const neverPubName = `NeverPub ${Date.now()}`;
const neverPub = await (
  await fetch(`${API}/maps`, {
    method: "POST",
    headers: HDR,
    body: JSON.stringify({ name: neverPubName, owning_department: owningDept }),
  })
).json();
if (!neverPub.id) throw new Error(`never-pub map create failed: ${JSON.stringify(neverPub)}`);

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

const visibleCopyBtn = () => page.locator("[data-id='map-detail-copy']:visible").first();

// [1] 미게시 맵 — 복사 버튼 비활성 (숨김 아님)
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.getByText(neverPubName, { exact: true }).first().click();
await visibleCopyBtn().waitFor({ state: "visible", timeout: 20000 });
check("never-published: copy button disabled", await visibleCopyBtn().isDisabled());

// [2] 게시 이력 맵 — 버튼 활성 → CreateMapDialog copy 모드 오픈
// 원본 카드는 접힌 부서 아코디언 안에 있을 수 있어 검색으로 노출시킨다
await page.fill("[data-id='home-map-search']", "Vendor Management");
await page.getByText("Vendor Management", { exact: true }).first().click();
await page.waitForFunction(
  () =>
    [...document.querySelectorAll("[data-id='map-detail-copy']")].some(
      (b) => b.offsetParent !== null && !b.disabled,
    ),
  { timeout: 20000 },
);
await visibleCopyBtn().click();
await page.waitForSelector("[data-id='copy-version-select']", { timeout: 10000 });
check("copy dialog opens with version select", true);

// [3] 버전 드롭다운 — 전체 버전·기본 최신 게시본·비게시 안내는 숨김
const options = await page.$$eval("[data-id='copy-version-select'] option", (els) =>
  els.map((o) => ({ value: o.value, label: o.textContent })),
);
check("version select lists all versions", options.length === detail.versions.length,
  `${options.length}/${detail.versions.length}`);
const selectedValue = await page.$eval("[data-id='copy-version-select']", (el) => el.value);
check("default = latest published",
  Boolean(options.find((o) => o.value === selectedValue)?.label.includes("published")));
check("no unpublished note for published pick",
  (await page.locator("[data-id='copy-version-unpublished-note']").count()) === 0);

// [4] draft 선택 → 비게시 안내 노출 (B1)
await page.selectOption("[data-id='copy-version-select']", String(draft.id));
await page.waitForSelector("[data-id='copy-version-unpublished-note']", { timeout: 5000 });
check("unpublished note appears for draft pick", true);

// [5] 오너 행 + 오너 알림 안내 + 오우닝 부서 프리필 (B2·B3)
check("owner row shown", (await page.locator("[data-id='copy-owner-row']").count()) === 1);
check("notify-owner note shown",
  (await page.locator("[data-id='copy-notify-owner-note']").count()) === 1);
// 디렉터리 fetch 후 비동기 프리필 — 즉시 count 대신 대기
await page.waitForSelector("[data-id='owning-dept-selected']", { timeout: 10000 });
check("owning dept prefilled from source", true);

// [6] 원본 은퇴 체크(오너) — 이름 고정 + SP 분기 (B4·B5)
await page.check("[data-id='copy-retire-checkbox']");
await page.waitForTimeout(500); // SP usage fetch
const nameInput = page.locator("[data-id='create-map-name']");
check("name locked to source name",
  (await nameInput.inputValue()) === "Vendor Management" && (await nameInput.isDisabled()));
if (spUsage.designated) {
  await page.waitForSelector("[data-id='copy-retire-sp-confirm']", { timeout: 5000 });
  await page.check("[data-id='copy-retire-sp-confirm']");
  check("SP accordion + confirm checked", true, `${spUsage.used_by.length} referencing`);
} else {
  check("no SP accordion for non-designated map",
    (await page.locator("[data-id='copy-retire-sp-accordion']").count()) === 0);
}

// [7] 협업자·승인자 자동 이어받기 — 원본 승인자 전원 pill 등장(수동 추가 없이 제출 성립)
const srcApprovers = await (
  await fetch(`${API}/maps/${source.id}/approvers`, { headers: HDR })
).json();
for (const aid of srcApprovers) {
  await page.waitForSelector(`[data-id='create-approver-pill-${aid}']`, { timeout: 10000 });
}
check("approvers carried over from source", srcApprovers.length >= 1, `${srcApprovers.length} pills`);
const collabRows = await page.locator("[data-id^='create-collab-row-']").count();
check("collaborators carried over from source", collabRows >= 1, `${collabRows} rows`);

// [8] 제출 → 새 맵 에디터로 이동, 새 맵 이름 = 원본명
await page.click("[data-id='create-map-submit']");
await page.waitForURL(/\/maps\/\d+$/, { timeout: 20000 });
const newMapId = Number(page.url().match(/\/maps\/(\d+)/)[1]);
check("navigates to new map editor", newMapId !== source.id, `map ${newMapId}`);
const newDetail = await (await fetch(`${API}/maps/${newMapId}`, { headers: HDR })).json();
check("copy keeps original name", newDetail.name === "Vendor Management");
check("new map has single draft",
  newDetail.versions.length === 1 && newDetail.versions[0].status === "draft");

// [9] 원본 — "(Pending deletion)" rename + 휴지통행
const trash = await (await fetch(`${API}/maps/deleted/list`, { headers: HDR })).json();
const retired = trash.find((m) => m.id === source.id);
check("source renamed + trashed",
  Boolean(retired && retired.name.includes("(Pending deletion)")), retired?.name ?? "not in trash");

// [10] 알림 실측 (SMOKE_DB) — map_copied(원본 오너)·map_retired(승인자/editor+, 행위자 제외)
if (process.env.SMOKE_DB) {
  const { execFileSync } = await import("node:child_process");
  const rows = execFileSync("sqlite3", [
    process.env.SMOKE_DB,
    `SELECT type, recipient FROM notifications WHERE map_id = ${Number(source.id)} AND type IN ('map_copied','map_retired')`,
  ]).toString().trim().split("\n").filter(Boolean).map((r) => r.split("|"));
  const copied = rows.filter(([t]) => t === "map_copied");
  const retiredNotes = rows.filter(([t]) => t === "map_retired");
  check("map_copied sent to source owner", copied.length >= 1, `${copied.length} rows`);
  check("map_retired sent to approvers/editors", retiredNotes.length >= 1, `${retiredNotes.length} rows`);
  check("actor excluded from notifications", rows.every(([, r]) => r !== "admin.sys"));
} else {
  console.log("SKIP notification checks (set SMOKE_DB=<sqlite path>)");
}

// [11] SP 지정 맵 — retire 체크 시 경고+아코디언+확인 체크 게이트(제출 없이 UI만 검증)
// 오우닝 부서 있는 지정 맵만 — 없으면 프리필 대기가 성립하지 않는다(시드 1/3은 오우닝 누락)
const spMap = maps.find(
  (m) => m.sp_designated_at && m.owning_department && m.name !== "Vendor Management",
);
if (spMap) {
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.fill("[data-id='home-map-search']", spMap.name);
  await page.getByText(spMap.name, { exact: true }).first().click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("[data-id='map-detail-copy']")].some(
        (b) => b.offsetParent !== null && !b.disabled,
      ),
    { timeout: 20000 },
  );
  await visibleCopyBtn().click();
  await page.waitForSelector("[data-id='copy-retire-checkbox']", { timeout: 10000 });
  await page.waitForSelector("[data-id='owning-dept-selected']", { timeout: 10000 });
  await page.check("[data-id='copy-retire-checkbox']");
  await page.waitForSelector("[data-id='copy-retire-sp-confirm']", { timeout: 10000 });
  check("SP map: warning + confirm gate shown", true);
  // 승인자는 자동 이어받기로 충족 — 확인 체크 전엔 제출 비활성, 체크하면 활성
  await page.waitForSelector("[data-id^='create-approver-pill-']", { timeout: 10000 });
  check("submit blocked until SP confirm",
    await page.locator("[data-id='create-map-submit']").isDisabled());
  await page.check("[data-id='copy-retire-sp-confirm']");
  check("submit enabled after SP confirm",
    !(await page.locator("[data-id='create-map-submit']").isDisabled()));
  await page.keyboard.press("Escape"); // 제출하지 않고 닫기
} else {
  console.log("SKIP SP branch (no designated map in seed)");
}

// [12] 설정 휴지통 — 은퇴된 원본을 sysadmin이 즉시 영구삭제
await page.goto("http://localhost:3000/settings", { waitUntil: "domcontentloaded" });
await page.getByText("Scheduled deletion", { exact: true }).first().click();
const row = page.locator("[data-id='deleted-map-row']", { hasText: "(Pending deletion" });
await row.first().waitFor({ state: "visible", timeout: 15000 });
await row.first().getByText("Delete now", { exact: true }).click();
await page.getByText("Permanently delete this map?").waitFor({ timeout: 10000 });
await page.locator("button", { hasText: "Delete now" }).last().click();
await row.first().waitFor({ state: "detached", timeout: 15000 });
const trashAfter = await (await fetch(`${API}/maps/deleted/list`, { headers: HDR })).json();
check("retired source purged from trash", !trashAfter.some((m) => m.id === source.id));

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

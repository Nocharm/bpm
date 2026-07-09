// 부서 한글명 매핑 스모크 — 부서 탭: korean dept 열/필터/명단 툴팁/더블클릭 매핑 모달 e2e.
// 실행: frontend/ 에서 node scripts/pw-smoke-korean-dept.mjs
// 전제: 워크트리 backend(:8001)+frontend(:3000, BACKEND_URL=8001) 기동.
// 재실행 전제: sqlite3 backend/dev.db "UPDATE employees SET korean_name='', korean_dept='';" 로 리셋.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
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

// 준비: 2인 이상 부서 하나 골라 두 유저에 서로 다른 korean_dept 시드(임포트 API 경유)
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
const dir = await page.evaluate(async () => {
  const res = await fetch("/api/admin/users", { headers: { "X-Dev-User": "admin.sys" } });
  return res.json();
});
const byPath = new Map();
for (const u of dir.users) {
  const key = u.org_levels.join("/");
  if (!byPath.has(key)) byPath.set(key, []);
  byPath.get(key).push(u);
}
const target = [...byPath.entries()].find(([key, list]) => key && list.length >= 2);
if (!target) {
  console.log("FATAL: no department with 2+ members");
  process.exit(1);
}
const [targetPath, members] = target;
const deptLeaf = targetPath.split("/").at(-1);
await page.evaluate(
  async ({ a, b }) => {
    await fetch("/api/employees/korean-names", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
      body: JSON.stringify({
        mode: "overwrite",
        entries: {
          [a]: { name: "김하나", dept: "그룹시안" },
          [b]: { name: "박둘", dept: "그룹구안" },
        },
      }),
    });
  },
  { a: members[0].login_id, b: members[1].login_id },
);
check("seeded divergent korean_dept", true, `dept=${deptLeaf}`);

// ① 부서 탭 진입 — korean dept 열 + 필 2개
await page.getByRole("button", { name: "Departments", exact: true }).click();
await page.waitForSelector('[data-id="dept-needs-filter"]');
check("dept tab + filter", true);
const targetRow = page.locator('[data-id="dept-row"]', { hasText: deptLeaf }).first();
// 필터 켜서 대상 부서로 좁힘(전체 목록에선 25행 청킹 밖일 수 있음)
await page.click('[data-id="dept-needs-filter"]');
await targetRow.waitFor({ timeout: 10000 });
const cellText = await targetRow.locator('[data-id="dept-kr-cell"]').innerText();
check("two korean-dept pills", cellText.includes("그룹시안") && cellText.includes("그룹구안"));

// ② 인원수 호버 → 명단 툴팁(이름 필)
await targetRow.locator(".cursor-help").hover();
await page.waitForSelector('[data-id="dept-roster-tooltip"]');
const roster = await page.locator('[data-id="dept-roster-tooltip"]').innerText();
check("roster tooltip shows names", roster.includes("김하나") || roster.includes(members[0].name));

// ③ 더블클릭 → 모달: 후보 2개 → 선택 → 적용
await targetRow.dblclick();
await page.waitForSelector('[data-id="dept-korean-modal"]');
check("mapping modal candidates", (await page.locator('[data-id="dept-kr-candidate"]').count()) === 2);
await page.locator('[data-id="dept-kr-candidate"]', { hasText: "그룹시안" }).click();
check("candidate fills input", (await page.locator('[data-id="dept-kr-input"]').inputValue()) === "그룹시안");
await page.click('[data-id="dept-kr-apply"]');
await page.waitForSelector('[data-id="dept-kr-result"]');
const resultText = await page.locator('[data-id="dept-kr-result"]').innerText();
check("applied to all members", resultText.includes(String(members.length)), resultText);
await page.click('[data-id="dept-kr-close"]');

// ④ 반영: 해당 행이 단일 필이 되고, 필터 목록에서 사라짐(재조회 후)
await page.waitForTimeout(800);

// 필터 해제 후 대상 행의 korean dept 셀이 단일 필(선택값)만 남는지 직접 확인
await page.click('[data-id="dept-needs-filter"]'); // 필터 해제
const resolvedRow = page.locator('[data-id="dept-row"]', { hasText: deptLeaf }).first();
await resolvedRow.waitFor({ timeout: 10000 });
const resolvedCell = await resolvedRow.locator('[data-id="dept-kr-cell"]').innerText();
check(
  "single pill after mapping",
  resolvedCell.includes("그룹시안") && !resolvedCell.includes("그룹구안"),
  resolvedCell.replace(/\n/g, " "),
);
await page.click('[data-id="dept-needs-filter"]'); // 필터 재활성 — 기존 소실 체크 전제 복원

const stillListed = await page
  .locator('[data-id="dept-row"]', { hasText: deptLeaf })
  .count();
check("resolved dept leaves the needs-filter list", stillListed === 0);

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

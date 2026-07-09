// 부서 한글명 매핑 스모크 — 부서 탭: korean dept 열 + 명단 툴팁(이름 필, 1열) e2e.
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

// ① 부서 탭 진입 — korean dept 열 + 대상 부서 행 2필 확인.
// 매핑 필터가 없어졌으므로 대상 행은 25행 청킹 뒤에 있을 수 있음 — 안 보이면 스크롤로 센티널을 밀어 추가 로드.
await page.getByRole("button", { name: "Departments", exact: true }).click();
await page.waitForSelector('[data-id="dept-row"]');
check("dept tab entered", true);
const targetRow = page.locator('[data-id="dept-row"]', { hasText: deptLeaf }).first();
for (let i = 0; i < 20 && (await targetRow.count()) === 0; i++) {
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(150);
}
await targetRow.waitFor({ timeout: 10000 });
const cellText = await targetRow.locator('[data-id="dept-kr-cell"]').innerText();
check("two korean-dept pills", cellText.includes("그룹시안") && cellText.includes("그룹구안"));

// ② 인원수 호버 → 명단 툴팁(이름 필, 1열)
await targetRow.locator(".cursor-help").hover();
await page.waitForSelector('[data-id="dept-roster-tooltip"]');
const roster = await page.locator('[data-id="dept-roster-tooltip"]').innerText();
check("roster tooltip shows names", roster.includes("김하나") || roster.includes(members[0].name));

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

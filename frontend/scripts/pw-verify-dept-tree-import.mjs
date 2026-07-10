// 부서 tree JSON 임포트 e2e — 어드민 모달로 파일 업로드 → 상위 부서까지 저장 → 피커 한글 검색.
// 실행: frontend/ 에서 node scripts/pw-verify-dept-tree-import.mjs
// 전제: backend :8000 + frontend :3000 기동 (dev.db 종합 시드, sysadmin=admin.sys).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 시드 조직 일부를 tree로 — 본부(l1) → 실(l2) → 팀(l3) → 파트(l4). 상위 3레벨은 employees.department가 아니다.
const tree = {
  flat: [{ enDeptNm: "Growth Center", deptNm: "무시되어야함" }],
  tree: [
    {
      deptCd: 100,
      enDeptNm: "Growth Center",
      deptNm: "성장센터",
      dheadUserId: "admin.sys",
      dheadFnm: "System Admin",
      children: [
        {
          deptCd: 110,
          enDeptNm: "Marketing Office",
          deptNm: "마케팅실",
          dheadUserId: "admin.sys",
          children: [
            {
              deptCd: 111,
              enDeptNm: "Brand Team",
              deptNm: "브랜드팀",
              dheadUserId: "admin.sys",
              children: [
                { deptCd: 1111, enDeptNm: "Brand Part 1", deptNm: "브랜드1파트", dheadUserId: "admin.sys" },
              ],
            },
          ],
        },
      ],
    },
    { enDeptNm: "No Such Dept", deptNm: "없는부서", dheadUserId: "" },
  ],
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

// ── 어드민 부서 탭 → 임포트 모달 → 파일 업로드 ──────────────────────
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Departments/i }).click();
await page.locator('[data-id="dept-info-add-btn"]').click();
await page.waitForSelector('[data-id="dept-info-modal"]');
await page.setInputFiles('[data-id="dept-info-file-input"]', {
  name: "org.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(tree), "utf8"),
});
await page.waitForSelector('[data-id="dept-info-result"]');
const summary = await page.locator('[data-id="dept-info-result"]').innerText();
// 4개 반영(본부·실·팀·파트), "No Such Dept"만 unknown. flat의 항목은 읽지 않는다.
check("임포트 결과 updated=4", /Updated:\s*4/i.test(summary), summary.split("\n")[0]);
check("unknown은 미존재 부서 1건뿐", summary.includes("No Such Dept") && !summary.includes("Growth Center"), summary.replace(/\n/g, " | "));
await page.locator('[data-id="dept-info-close-btn"]').click();

// ── 백엔드 진실 확인 — 상위 레벨에도 dept_info 행 ────────────────────
const dirDepts = await page.evaluate(async () => {
  const res = await fetch("/api/directory");
  return (await res.json()).departments;
});
const byId = Object.fromEntries(dirDepts.map((d) => [d.id, d]));
check("본부(org_l1)에 한글명 저장", byId["Growth Center"]?.korean_name === "성장센터", byId["Growth Center"]?.korean_name);
check("실(org_l2)에 한글명 저장", byId["Growth Center/Marketing Office"]?.korean_name === "마케팅실", byId["Growth Center/Marketing Office"]?.korean_name);
check("팀(org_l3)에 한글명 저장", byId["Growth Center/Marketing Office/Brand Team"]?.korean_name === "브랜드팀");
check("파트(org_l4, 기존에도 되던 레벨)에 한글명 저장", byId["Growth Center/Marketing Office/Brand Team/Brand Part 1"]?.korean_name === "브랜드1파트");
check("부서장 login_id 저장", byId["Growth Center"]?.manager === "admin.sys", byId["Growth Center"]?.manager);

// ── 피커 한글 검색 — 상위 부서가 한글로 잡히는가 ─────────────────────
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "New map" }).click();
await page.waitForSelector("text=Required approvers");
const picker = page.locator('input[placeholder^="Search by name"]').first();

await picker.click();
await picker.fill("성장센터"); // 본부 — 변경 전에는 절대 잡히지 않던 레벨
await page.waitForTimeout(400);
const hitsDivision = await page.locator('[data-id="principal-picker-dropdown"] button').allInnerTexts();
check("한글 검색으로 본부가 잡힘", hitsDivision.some((h) => h.includes("Growth Center")), hitsDivision[0] ?? "(none)");

await picker.fill("마케팅실"); // 실
await page.waitForTimeout(400);
const hitsOffice = await page.locator('[data-id="principal-picker-dropdown"] button').allInnerTexts();
check("한글 검색으로 실이 잡힘", hitsOffice.some((h) => h.includes("Marketing Office")), hitsOffice[0] ?? "(none)");

// 부서장 이름 검색 — manager는 login_id만 저장되지만 다이얼로그가 디렉터리로 이름을 조인한다
await picker.fill("System Admin");
await page.waitForTimeout(400);
const hitsByHead = await page.locator('[data-id="principal-picker-dropdown"] button').allInnerTexts();
check(
  "부서장 이름으로 부서가 잡힘",
  hitsByHead.some((h) => h.includes("Growth Center") || h.includes("Marketing Office")),
  hitsByHead.slice(0, 2).join(" / ") || "(none)",
);

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 160)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);

// 한글이름 일괄 등록 스모크 — Employees 탭→모달→다운로드→임포트(신규/충돌 skip/overwrite)→테이블 반영.
// 실행: frontend/ 에서 node scripts/pw-smoke-korean-names.mjs
// 전제: 워크트리 backend(:8001)+frontend(:3000, BACKEND_URL=8001) 기동. playwright-core+시스템 Chrome.
// 재실행 전제: 대상 유저 korean_name이 비어 있어야 ③(무충돌 1차 임포트) 전제가 성립 —
//   sqlite3 backend/dev.db "UPDATE employees SET korean_name='';" 로 리셋 후 실행.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en"); // 기본 ko — 탭 라벨 "Employees" 고정용
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// ① Employees 탭 진입 + 버튼/열 노출
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Employees", exact: true }).click();
await page.waitForSelector('[data-id="kr-add-btn"]', { timeout: 15000 });
check("employees tab + kr-add button", true);
check("korean name column", await page.locator("th", { hasText: "korean name" }).count() === 1);

// 대상 유저 2명 확보 — korean_name이 빈 앞 2명(재실행 시 이미 채워진 유저를 다시 고르지 않도록)
const rows = await page.evaluate(async () => {
  const res = await fetch("/api/employees", { headers: { "X-Dev-User": "admin.sys" } });
  return res.json();
});
const [u1, u2] = rows.filter((r) => !r.korean_name).map((r) => r.login_id);
check("employees seeded", Boolean(u1 && u2), `u1=${u1} u2=${u2}`);

// ② 모달 + 미보유 목록 다운로드
await page.click('[data-id="kr-add-btn"]');
await page.waitForSelector('[data-id="korean-name-modal"]');
const dlPromise = page.waitForEvent("download");
await page.click('[data-id="kr-download-btn"]');
const download = await dlPromise;
const ids = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
check("download is id array incl. targets", Array.isArray(ids) && ids.includes(u1) && ids.includes(u2));

// ③ 1차 임포트 — 충돌 없음 → 즉시 결과(updated 2, unknown 1)
const tmp1 = path.join(os.tmpdir(), "kr-import-1.json");
fs.writeFileSync(tmp1, JSON.stringify({ [u1]: "홍길동", [u2]: "김철수", "no.such.user": "유령" }));
await page.setInputFiles('[data-id="kr-file-input"]', tmp1);
await page.waitForSelector('[data-id="kr-result"]');
const result1 = await page.locator('[data-id="kr-result"]').innerText();
check("first import applied", result1.includes("2") && result1.includes("no.such.user"), result1.replace(/\n/g, " "));
await page.click('[data-id="kr-close-btn"]');
check("table shows imported name", await page.locator("td", { hasText: "홍길동" }).count() >= 1);

// ④ 2차 임포트 — 충돌 → 툴팁 확인 → Skip all(값 유지)
const tmp2 = path.join(os.tmpdir(), "kr-import-2.json");
fs.writeFileSync(tmp2, JSON.stringify({ [u1]: "새이름" }));
await page.click('[data-id="kr-add-btn"]');
await page.setInputFiles('[data-id="kr-file-input"]', tmp2);
await page.waitForSelector('[data-id="kr-conflict-step"]');
check("conflict step shows 1 users", (await page.locator('[data-id="kr-conflict-step"]').innerText()).includes("1"));
await page.hover('[data-id="kr-conflict-step"] .cursor-help');
await page.waitForSelector('[data-id="kr-conflict-tooltip"]');
const tip = await page.locator('[data-id="kr-conflict-tooltip"]').innerText();
check("tooltip lists current → next", tip.includes(u1) && tip.includes("홍길동") && tip.includes("새이름"));
await page.hover('[data-id="kr-conflict-tooltip"]');
await page.waitForTimeout(150);
check("tooltip persists while hovered", await page.locator('[data-id="kr-conflict-tooltip"]').isVisible());
await page.click('[data-id="kr-skip-all"]');
await page.waitForSelector('[data-id="kr-result"]');
check("skip keeps value", (await page.locator('[data-id="kr-result"]').innerText()).includes("0"));
await page.click('[data-id="kr-close-btn"]');
check("table keeps old name", await page.locator("td", { hasText: "홍길동" }).count() >= 1);

// ⑤ 3차 임포트 — Overwrite all(값 교체)
await page.click('[data-id="kr-add-btn"]');
await page.setInputFiles('[data-id="kr-file-input"]', tmp2);
await page.waitForSelector('[data-id="kr-conflict-step"]');
await page.click('[data-id="kr-overwrite-all"]');
await page.waitForSelector('[data-id="kr-result"]');
await page.click('[data-id="kr-close-btn"]');
await page.waitForTimeout(500);
check("overwrite replaces value", await page.locator("td", { hasText: "새이름" }).count() >= 1);

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

// 피커 한글 검색 스모크 — 맵 설정 협업자 피커: 한글이름 검색·초성·한글그룹(부서 top-pin)·ko 토글 primary e2e.
// 실행: frontend/ 에서 BASE_URL=http://localhost:3002 node scripts/pw-smoke-picker-korean.mjs
// 전제: 워크트리 backend(:8001)+frontend(BASE_URL, BACKEND_URL=8001) 기동, dev.db는 메인 사본(맵·멤버 존재).
// 재실행 전제: sqlite3 backend/dev.db "UPDATE employees SET korean_name='', korean_dept='';" 로 리셋
//   (대상 유저는 매번 새로 뽑되, korean_name이 남아있으면 후보 선정 로직이 달라질 뿐 시나리오 자체는 안 깨짐).
// 정리: 테스트맵은 실행 말미 DELETE /api/maps/{id}로 삭제(소프트삭제→휴지통, 7일 후 자동 퍼지).
// 제외: 점유권 이전(transfer-checkout-dialog)의 filterByQuery 전환은 체크아웃 상태 전제가 무거워
//   이 스모크에서 제외 — vitest(korean-dept.test.ts 등) + 수동 확인 대상 (task-5 브리프 명시).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PLACEHOLDER = "Search by name or initial consonant…";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// bpm.lang은 addInitScript에 넣지 않음 — addInitScript는 매 navigation(reload 포함)마다 재실행되어
// ko 전환 후 reload 시 값을 en으로 되돌려버림(i18n은 마운트 시 1회만 localStorage를 읽음, i18n.tsx:24-30).
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// 준비: admin.sys 소유 테스트맵 생성 + 디렉터리에서 org_path 있는 유저 1명 골라
// 한글이름·한글그룹 임포트(장현진 / AI Operations그룹) 부여.
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => window.localStorage.setItem("bpm.lang", "en"));
const setup = await page.evaluate(async () => {
  const headers = { "Content-Type": "application/json", "X-Dev-User": "admin.sys" };
  const mapRes = await fetch("/api/maps", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `PW Smoke Picker Korean ${Date.now()}`,
      description: "",
      visibility: "private",
    }),
  });
  const map = await mapRes.json();

  const dir = await (await fetch("/api/directory", { headers })).json();
  const target = dir.users.find((u) => u.id !== "admin.sys" && u.org_path);
  if (!target) return { mapId: map.id, mapName: map.name, error: "no eligible directory user with org_path" };

  await fetch("/api/employees/korean-names", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      mode: "overwrite",
      entries: { [target.id]: { name: "장현진", dept: "AI Operations그룹" } },
    }),
  });

  return { mapId: map.id, mapName: map.name, targetId: target.id, targetName: target.name };
});
check(
  "setup: test map + korean employee (장현진/AI Operations그룹) seeded",
  Boolean(setup.mapId && setup.targetId),
  JSON.stringify(setup),
);

try {
  // ① 맵 설정 진입 — 단일 스크롤 페이지라 협업자 섹션은 항상 DOM에 있음(admin.sys=sysadmin→owner→canEdit).
  await page.goto(`${BASE}/maps/${setup.mapId}/settings`, { waitUntil: "domcontentloaded" });
  const collab = page.locator("#sec-collaborators");
  const searchInput = collab.locator(`input[placeholder="${PLACEHOLDER}"]`);
  await searchInput.waitFor({ timeout: 10000 });
  check("settings → collaborators picker rendered", true);

  // ② en 모드 — "장현진" 검색 → 유저 행 노출, 영문 이름이 먼저·한글이 괄호로 보조 표기.
  await searchInput.fill("장현진");
  await page.waitForTimeout(200);
  const rowKr = collab.locator("button", { hasText: "장현진" }).first();
  await rowKr.waitFor({ timeout: 5000 }).catch(() => {});
  const rowKrText = (await rowKr.innerText().catch(() => "")).replace(/\n/g, " ");
  const idxEn = rowKrText.indexOf(setup.targetName ?? "\0");
  const idxKr = rowKrText.indexOf("장현진");
  check(
    "en mode: korean name search hits user row, english name primary + 장현진 secondary",
    idxEn !== -1 && idxKr !== -1 && idxEn < idxKr,
    rowKrText,
  );
  const rowKrType = (await rowKr.locator("span").last().innerText().catch(() => "")).trim();
  check("en mode: matched row type label is User", rowKrType === "User", rowKrType);

  // ③ 초성 "ㅈㅎㅈ" 검색 → 동일 유저 매치 (장현진 chosung = ㅈㅎㅈ)
  await searchInput.fill("ㅈㅎㅈ");
  await page.waitForTimeout(200);
  const rowChosung = collab.locator("button", { hasText: setup.targetName ?? "\0" }).first();
  await rowChosung.waitFor({ timeout: 5000 }).catch(() => {});
  check("chosung search ㅈㅎㅈ matches same user", await rowChosung.isVisible().catch(() => false));

  // ④ "AI Operations그" (한글그룹 일부) 검색 → 부서 항목이 top-pin(첫 행 타입 라벨로 판정), 유저 무더기에 안 묻힘.
  await searchInput.fill("AI Operations그");
  await page.waitForTimeout(200);
  const firstRow = collab.locator("button").first();
  await firstRow.waitFor({ timeout: 5000 }).catch(() => {});
  const firstRowType = (await firstRow.locator("span").last().innerText().catch(() => "")).trim();
  check("korean dept keyword search: top row type is Department", firstRowType === "Department", firstRowType);

  // ⑤ bpm.lang=ko 재로드 — 동일 유저 검색 시 행 primary가 "장현진"
  await page.evaluate(() => window.localStorage.setItem("bpm.lang", "ko"));
  await page.reload({ waitUntil: "domcontentloaded" });
  const collabKo = page.locator("#sec-collaborators");
  const searchInputKo = collabKo.locator('input[placeholder="이름 또는 초성으로 검색…"]');
  await searchInputKo.waitFor({ timeout: 10000 });
  await searchInputKo.fill("장현진");
  await page.waitForTimeout(200);
  const rowKo = collabKo.locator("button", { hasText: "장현진" }).first();
  await rowKo.waitFor({ timeout: 5000 }).catch(() => {});
  const rowKoText = (await rowKo.innerText().catch(() => "")).replace(/\n/g, " ").trim();
  check("ko mode: row primary is 장현진", rowKoText.startsWith("장현진"), rowKoText);

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  // 정리 — setup에서 만든 테스트맵 삭제(소프트삭제→휴지통). try 블록 실패와 무관하게 항상 실행.
  if (setup.mapId) {
    const cleanup = await page.evaluate(async (mapId) => {
      const res = await fetch(`/api/maps/${mapId}`, {
        method: "DELETE",
        headers: { "X-Dev-User": "admin.sys" },
      });
      return { ok: res.ok, status: res.status };
    }, setup.mapId);
    check("cleanup: test map deleted", cleanup.ok, `status=${cleanup.status}`);
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

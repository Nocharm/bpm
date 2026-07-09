// 멤버 카드 스모크 — 홈 상세 패널: Me 뱃지·이름 한/영 토글(펼침 alt 필)·그룹 이름 해석 e2e.
// 실행: frontend/ 에서 BASE_URL=http://localhost:3002 node scripts/pw-smoke-member-card.mjs
// 전제: 워크트리 backend(:8001)+frontend(BASE_URL, BACKEND_URL=8001) 기동, dev.db는 메인 사본(맵·멤버 존재).
// 대상 유저/맵은 스크립트가 매번 새로 생성(admin.sys 소유 테스트맵 + 협업자·그룹 부여)하므로
// 기존 스모크(korean-names/korean-dept)처럼 재실행 전 리셋이 필수는 아니나, 한글이름 잔존을 피하려면
// sqlite3 backend/dev.db "UPDATE employees SET korean_name='', korean_dept='';" 후 실행 권장.
// 정리: 테스트맵은 실행 말미 DELETE /api/maps/{id}로 삭제(소프트삭제→휴지통, 7일 후 자동 퍼지) —
// 맵 목록엔 남지 않고 dev.db 행만 deleted_at 기록 상태로 퍼지까지 잔류.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const skip = (name, detail = "") => {
  results.push({ name, ok: true });
  console.log(`SKIP ${name}${detail ? ` — ${detail}` : ""}`);
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

// 준비: admin.sys 소유 테스트맵 생성(Me 뱃지 전제) + 협업자 1명·그룹 1개 부여 + 협업자에 한글이름 임포트
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => window.localStorage.setItem("bpm.lang", "en"));
const setup = await page.evaluate(async () => {
  const headers = { "Content-Type": "application/json", "X-Dev-User": "admin.sys" };
  const mapRes = await fetch("/api/maps", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `PW Smoke Member Card ${Date.now()}`,
      description: "",
      visibility: "private",
    }),
  });
  const map = await mapRes.json();

  const dir = await (await fetch("/api/directory", { headers })).json();
  const collaborator = dir.users.find((u) => u.id !== "admin.sys" && !u.korean_name);
  await fetch(`/api/maps/${map.id}/permissions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ principal_type: "user", principal_id: collaborator.id, role: "editor" }),
  });

  const groups = await (await fetch("/api/groups", { headers })).json();
  const group = groups.find((g) => g.status === "active") ?? null;
  if (group) {
    await fetch(`/api/maps/${map.id}/permissions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ principal_type: "group", principal_id: String(group.id), role: "editor" }),
    });
  }

  await fetch("/api/employees/korean-names", {
    method: "PUT",
    headers,
    body: JSON.stringify({ mode: "overwrite", entries: { [collaborator.id]: { name: "홍길동" } } }),
  });

  return { mapId: map.id, mapName: map.name, enName: collaborator.name, group };
});
check(
  "setup: test map + collaborator + korean name seeded",
  Boolean(setup.mapId && setup.enName),
  JSON.stringify(setup),
);

// ① 홈 진입 → 테스트맵 카드 클릭(패딩 위치 — 중앙은 이름 Link라 내비게이션됨) → 상세 패널
await page.reload({ waitUntil: "domcontentloaded" });
await page
  .locator('[data-id="map-card"]', { hasText: setup.mapName })
  .click({ position: { x: 8, y: 8 } });
const aside = page.locator('[data-id="map-detail-aside"]');
await aside.locator('[role="button"]').first().waitFor({ timeout: 10000 });
check("home → map card click → detail aside opened", true);

// Me 뱃지 — admin.sys가 테스트맵 생성자라 명시 owner 권한행 보유.
// waitFor(현재 로그인 유저는 AuthGate 비동기 로드라 최초 렌더엔 아직 null → isMe 판정이 뒤늦게 갱신됨).
const meBadge = aside.locator('[data-id="member-me-badge"]');
await meBadge.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
check("me badge visible", await meBadge.isVisible());

// ② en 모드 — 이름줄 영문(협업자 enName, 홍길동 미노출) → 클릭 펼침 → alt 필 "홍길동"
const rowEn = aside.locator('[role="button"]', { hasText: setup.enName });
await rowEn.waitFor({ timeout: 10000 });
const nameLineEn = (await rowEn.locator("span.truncate").first().innerText()).trim();
check("en: name line shows english name (no 홍길동)", nameLineEn === setup.enName, nameLineEn);
await rowEn.click();
await page.waitForTimeout(400);
const altEn = (await rowEn.locator('[data-id="member-alt-name"]').innerText()).trim();
check("en: expanded alt-name field shows 홍길동", altEn === "홍길동", altEn);

// ③ ko 모드로 재로드 — 이름줄 "홍길동" → 클릭 펼침 → alt 필에 영문 이름
await page.evaluate(() => window.localStorage.setItem("bpm.lang", "ko"));
await page.reload({ waitUntil: "domcontentloaded" });
await page
  .locator('[data-id="map-card"]', { hasText: setup.mapName })
  .click({ position: { x: 8, y: 8 } });
await aside.locator('[role="button"]').first().waitFor({ timeout: 10000 });
const rowKo = aside.locator('[role="button"]', { hasText: "홍길동" });
await rowKo.waitFor({ timeout: 10000 });
const nameLineKo = (await rowKo.locator("span.truncate").first().innerText()).trim();
check("ko: name line shows 홍길동", nameLineKo === "홍길동", nameLineKo);
await rowKo.click();
await page.waitForTimeout(400);
const altKo = (await rowKo.locator('[data-id="member-alt-name"]').innerText()).trim();
check("ko: expanded alt-name field shows english name", altKo === setup.enName, altKo);

// ④ Me 뱃지 재확인(ko 모드, 언어 무관 아이콘)
const meBadgeKo = aside.locator('[data-id="member-me-badge"]');
await meBadgeKo.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
check("me badge still visible (ko)", await meBadgeKo.isVisible());

// ⑤ 그룹 카드 — 시드된 그룹이 있으면 이름이 해석되어 보임을 확인(숫자 id 그대로 아님). 없으면 SKIP 명시.
if (setup.group) {
  const asideText = await aside.innerText();
  check(
    "group card shows resolved name (not raw numeric id)",
    asideText.includes(setup.group.name) && setup.group.name !== String(setup.group.id),
    setup.group.name,
  );
} else {
  skip("group card check", "no active group available in seeded data");
}

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

// 정리 — setup에서 만든 테스트맵 삭제(소프트삭제→휴지통). 실패도 정직하게 exit 코드에 반영.
const cleanup = await page.evaluate(async (mapId) => {
  const res = await fetch(`/api/maps/${mapId}`, {
    method: "DELETE",
    headers: { "X-Dev-User": "admin.sys" },
  });
  return { ok: res.ok, status: res.status };
}, setup.mapId);
check("cleanup: test map deleted", cleanup.ok, `status=${cleanup.status}`);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

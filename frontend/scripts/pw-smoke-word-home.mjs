// Word 홈 스모크 — Word documents 섹션 분리 표시·행 노출·생성 진입 버튼·상세 카드(설계 2026-07-24 §2, Task 11).
// 실행: node scripts/pw-smoke-word-home.mjs  (backend 8000 / frontend 3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = "http://localhost:8000/api";

// owning_department는 실제 조직 경로여야 backend _assert_known_department를 통과한다
// (dev.db엔 브리프의 "Owning Anchor Division"이 없음 — conftest 전용 픽스처 값이라 여기선 무효,
// 다른 pw-verify-*.mjs 스크립트들처럼 /api/directory에서 실경로를 조회한다).
const dir = await (await fetch(`${API}/directory`)).json();
const owningDept = dir.departments[0]?.id;
if (!owningDept) {
  console.log("SEED FAILED — directory has no departments");
  process.exit(1);
}

// 시드: word 맵 1개 생성(테스트마다 유니크 이름 → 이름 유일성 충돌 방지)
const name = `pw-word-${Date.now()}`;
const created = await (
  await fetch(`${API}/maps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      owning_department: owningDept,
      mode: "word",
      doc_name: "sop.docx",
      doc_sections: [{ anchor: "_Toc1", title: "Intro", number: "1", level: 1 }],
    }),
  })
).json();
if (!created.id) {
  console.log("SEED FAILED", created);
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
try {
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-id="word-docs-section"]', { timeout: 30000 });

  const row = page.locator(`[data-id="word-doc-row-${created.id}"]`);
  if ((await row.count()) === 0 || !(await row.first().isVisible())) {
    await page.click('[data-id="word-docs-toggle"]'); // 접혀 있으면 펼침
  }
  await row.first().waitFor({ timeout: 10000 });

  const createBtn = await page.locator('[data-id="word-docs-create"]').count();
  // 상단 create 메뉴에서 Word 항목이 제거됐는지
  const legacyWordEntry = await page.locator('[data-id="home-create-from-word"]').count();
  // 조직도/즐겨찾기 영역에 word 맵 이름이 새지 않는지 — 섹션 밖 텍스트 검색
  const nameHits = await page.getByText(name, { exact: true }).count();
  const inSectionHits = await page
    .locator(`[data-id="word-docs-section"]`)
    .getByText(name, { exact: true })
    .count();

  // 상세 카드 — 행 클릭 → 우측 aside에 word 메타·승격 버튼 노출(Task 8 리뷰 갭 보강)
  await row.first().click();
  await page.waitForSelector('[data-id="map-detail-aside"]', { timeout: 10000 });
  const metaLocator = page.locator('[data-id="map-detail-aside"] [data-id="word-doc-meta"]');
  await metaLocator.waitFor({ timeout: 10000 });
  const metaVisible = await metaLocator.isVisible();
  const promoteLocator = page.locator('[data-id="map-detail-aside"] [data-id="map-detail-promote"]');
  const promoteCount = await promoteLocator.count();
  const promoteText = promoteCount > 0 ? (await promoteLocator.first().innerText()).trim() : "";
  const promoteOk = promoteCount === 1 && promoteText === "Convert to process map";

  const pass =
    (await row.first().isVisible()) &&
    createBtn === 1 &&
    legacyWordEntry === 0 &&
    nameHits === inSectionHits && // 이름 노출은 전부 Word 섹션 안
    metaVisible &&
    promoteOk;
  console.log(
    JSON.stringify({
      rowVisible: await row.first().isVisible(),
      createBtn,
      legacyWordEntry,
      nameHits,
      inSectionHits,
      metaVisible,
      promoteCount,
      promoteText,
      pass,
    }),
  );
  if (!pass) {
    await page.screenshot({ path: "/private/tmp/claude-501/pw-smoke-word-home-failure.png", fullPage: true });
  }
  process.exitCode = pass ? 0 : 1;
} finally {
  await fetch(`${API}/maps/${created.id}`, { method: "DELETE" }); // 소프트삭제 정리
  await browser.close();
}

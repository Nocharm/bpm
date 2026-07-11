// Word 내보내기 e2e — 인스펙터 맵 탭 Word 버튼 → .docx 다운로드 → unzip 구조 검증. 시나리오:
//   ① 인스펙터 맵 탭에 Word 버튼이 있다 (PNG 버튼은 그대로).
//   ② 다운로드 파일명이 {맵}_{버전}_{stamp}.docx 패턴.
//   ③ docx 4파트 존재 + 도형 수 = 캔버스 노드 수, 연결선 수 = 엣지 수.
//   ④ URL 있는 노드 → rels 하이퍼링크(TargetMode=External) + 문서에 URL 라벨 텍스트.
//      (시드에 URL 노드가 없으면 그래프 PUT으로 1개 심고 끝나면 원복.)
//   ⑤ 흑백톤(FFFFFF/000000) + Arial/바탕체 + sz 22.
//   ⑥ console error 0.
//
// 실행 (frontend/ 에서):
//   bash:       node scripts/pw-verify-word-export.mjs
//   PowerShell: node scripts\pw-verify-word-export.mjs
// 전제: backend :8000 (AUTH_ENFORCE 없이), frontend :3000, playwright-core 설치(npm i --no-save playwright-core)
//   bash:       cd backend && AUTH_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000
//   PowerShell: cd backend; $env:AUTH_ENABLED="false"; .venv\Scripts\uvicorn app.main:app --port 8000
// ⚠️ 좀비 next dev가 :3000 점유 시 pkill -f "next dev" 후 재기동 (docs/lessons/browser-verification.md)
//
// ⚠️ 환경 적응(브리프 원안과의 차이): 데모 시드(scripts/reset_db)는 모든 맵의 draft를 "다른 데모 유저"가
// 이미 체크아웃(점유)한 상태로 채운다. 기본 진입 버전은 항상 published(편집 불가)라 브리프 원안처럼
// "현재 로드된 버전에 바로 URL 노드를 PUT"하면 100% 409(편집 불가 또는 체크아웃 불일치)로 막힌다.
// 그래서 ④ 시나리오 직전에: (a) 맵의 draft 버전을 찾아 (b) sysadmin(admin.sys)으로 강제 체크아웃 인수 후
// (c) 그 draft로 페이지를 전환해 검증하고 (d) 종료 시 그래프 원복 + 체크아웃을 원래 점유자에게 이전(transfer)
// 해 되돌린다. draft가 아예 없는 맵(예: 이 데모의 map 4/9)이면 ④는 SKIP(사유 로그)하고 나머지만 검증한다.
// 상태를 바꾸는 모든 단계(체크아웃 인수·시드 PUT 포함)는 try 안 — 어느 지점에서 실패해도 finally가
// 그래프·체크아웃 원복과 브라우저 종료를 각각 독립적으로 수행한다(dev.db 오염·Chromium 누수 방지).
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unzipSync, strFromU8 } from "fflate";
import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAP_ID = process.env.MAP_ID ?? "2";
const DEV_USER = "admin.sys"; // addInitScript의 bpm.devUser와 반드시 동일 — 에디터 자체 체크아웃 폴링과 신원 불일치 방지

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

// finally의 원복 단계들이 참조하는 상태 — try 밖 선언(try 어느 지점에서 던져도 원복 판단 가능)
let page = null;
let versionId = null;
let original = null; // 시드 PUT 전 그래프 스냅샷 — mutated면 finally에서 이걸로 원복
let mutated = false;
let checkoutRestore = null; // { versionId, previousHolder: string | null } — force 체크아웃했다면 복원 정보
const consoleErrors = [];

// 인증된 사용자로 fetch — X-Dev-User는 auth OFF에서만 신뢰되는 헤더(app/auth.py get_current_user)
const authedFetch = (path, init) =>
  page.evaluate(
    async ({ path, init, user }) => {
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", "X-Dev-User": user, ...init?.headers },
      });
      const status = res.status;
      let body = null;
      try {
        body = await res.json();
      } catch {
        // no-content(204) 등 — 본문 없음
      }
      return { status, body };
    },
    { path, init, user: DEV_USER },
  );

const getGraph = () => authedFetch(`/api/versions/${versionId}/graph`).then((r) => r.body);
const putGraph = (graph) =>
  authedFetch(`/api/versions/${versionId}/graph`, { method: "PUT", body: JSON.stringify(graph) }).then(
    (r) => r.status,
  );

try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, DEV_USER);
  page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  // 에디터 로드 — 그래프 응답에서 versionId 캡처
  page.on("response", (res) => {
    const m = /\/api\/versions\/(\d+)\/graph(?!\/)/.exec(res.url());
    if (m) versionId = Number(m[1]);
  });
  await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  if (!versionId) throw new Error("graph 응답에서 versionId를 못 얻음");

  // ── ④ 사전 준비: URL 노드 PUT이 가능한 draft 버전 확보 ──────────────────────
  // 데모 시드는 draft를 전부 타인이 점유 중 → sysadmin 강제 체크아웃 인수 후 검증, 종료 시 원 점유자에게 반환.
  const mapDetail = (await authedFetch(`/api/maps/${MAP_ID}`)).body;
  const draftVersion = mapDetail.versions.find((v) => v.status === "draft");
  let urlSeedSkipReason = null;

  if (!draftVersion) {
    urlSeedSkipReason = `맵 ${MAP_ID}에 draft 버전이 없음(전부 published/expired) — ④ 하이퍼링크 검증 SKIP`;
  } else if (draftVersion.id !== versionId) {
    const wf = (await authedFetch(`/api/versions/${draftVersion.id}/workflow`)).body;
    const lockedByOther = Boolean(wf.checkout_holder) && wf.checkout_holder !== DEV_USER;
    if (lockedByOther || !wf.checkout_holder) {
      const { status } = await authedFetch(`/api/versions/${draftVersion.id}/checkout`, {
        method: "POST",
        body: JSON.stringify({ force: lockedByOther }),
      });
      if (status !== 200) throw new Error(`draft 체크아웃 확보 실패 status=${status}`);
      // 인수 성공 즉시 복원 정보 기록 — 이후 어느 단계가 던져도 finally가 반환한다
      checkoutRestore = { versionId: draftVersion.id, previousHolder: lockedByOther ? wf.checkout_holder : null };
    }
    await page.goto(`${BASE}/maps/${MAP_ID}?version=${draftVersion.id}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".react-flow__node", { timeout: 15000 });
    versionId = draftVersion.id;
  }

  // 그래프 상태 파악 — URL 노드 없으면 첫 노드에 심고 종료 시 원복
  original = await getGraph();
  if (!urlSeedSkipReason && !original.nodes.some((n) => n.url)) {
    const patched = structuredClone(original);
    patched.nodes[0].url = "https://example.com/sop";
    patched.nodes[0].url_label = "SOP 문서";
    mutated = true; // PUT 발사 전에 마킹 — PUT이 절반 성공/타임아웃이어도 finally가 원복 시도
    const status = await putGraph(patched);
    if (status !== 200) throw new Error(`URL 시드 PUT 실패 status=${status}`);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  }
  const graph = await getGraph();
  const urlNodeCount = graph.nodes.filter((n) => n.url).length;

  // ① 인스펙터 맵 탭 → Word 버튼 존재 (PNG 버튼도 그대로)
  await page.locator('button[aria-label="Map"]').first().click();
  const wordBtn = page.locator('[data-id="inspector-export-word"]');
  check("① Word 버튼 존재", (await wordBtn.count()) === 1);
  check(
    "① PNG 버튼 유지",
    (await page.getByRole("button", { name: "Download PNG" }).count()) === 1,
  );

  // ② 다운로드 + 파일명 패턴
  const [download] = await Promise.all([page.waitForEvent("download"), wordBtn.click()]);
  const fileName = download.suggestedFilename();
  check("② 파일명 .docx 패턴", /_\d{14}\.docx$/.test(fileName), fileName);
  const filePath = join(tmpdir(), fileName);
  await download.saveAs(filePath);

  // ③~⑤ unzip 검증
  const parts = Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(readFileSync(filePath)))).map(([k, v]) => [
      k,
      strFromU8(v),
    ]),
  );
  const doc = parts["word/document.xml"] ?? "";
  const rels = parts["word/_rels/document.xml.rels"] ?? "";
  check("③ docx 4파트", Object.keys(parts).length === 4, Object.keys(parts).join(","));
  const shapeCount = (doc.match(/<wps:cNvSpPr\/>/g) ?? []).length; // 노드+라벨 박스
  const connectorCount = (doc.match(/<wps:cNvCnPr>/g) ?? []).length;
  const labelCount = (doc.match(/name="label-/g) ?? []).length;
  check(
    "③ 도형 수 = 노드 수",
    shapeCount - labelCount === graph.nodes.length,
    `shapes=${shapeCount - labelCount} nodes=${graph.nodes.length}`,
  );
  check(
    "③ 연결선 수 = 엣지 수",
    connectorCount === graph.edges.length,
    `connectors=${connectorCount} edges=${graph.edges.length}`,
  );
  if (urlSeedSkipReason) {
    console.log(`\n⚠️  SKIP ④ 하이퍼링크 검증 — ${urlSeedSkipReason}\n`);
  } else {
    const relHlCount = (rels.match(/TargetMode="External"/g) ?? []).length;
    check("④ 하이퍼링크 수 = URL 노드 수", relHlCount === urlNodeCount, `rels=${relHlCount} urls=${urlNodeCount}`);
    check("④ 하이퍼링크 본문 참조", (doc.match(/<w:hyperlink /g) ?? []).length === urlNodeCount);
  }
  check("⑤ 흑백톤", doc.includes('val="FFFFFF"') && doc.includes('val="000000"'));
  check("⑤ Arial/바탕체 11pt", doc.includes('w:ascii="Arial"') && doc.includes('w:eastAsia="바탕체"') && doc.includes('<w:sz w:val="22"/>'));

  // ⑥ 콘솔 에러
  check("⑥ console error 0", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 200));
} finally {
  // 원복 3단계 — 각각 독립 try/catch(하나 실패해도 나머지 수행), 실패는 크게 로그(조용히 삼키기 금지).
  // 순서 주의: 그래프 원복 PUT은 admin.sys가 체크아웃을 쥔 상태여야 통과(아니면 409 must hold checkout)
  // 하므로 체크아웃 반환보다 먼저 실행한다. 둘 다 page.evaluate 경유라 browser.close()는 마지막.
  if (mutated) {
    try {
      const status = await putGraph(original);
      console.log(
        `원복 PUT status=${status}${status === 200 ? "" : " ⚠️⚠️ 원복 실패 — dev.db에 시드 URL 노드 잔존, python -m scripts.reset_db로 재시드 필요"}`,
      );
    } catch (err) {
      console.log(`⚠️⚠️ 그래프 원복 실패 — dev.db에 시드 URL 노드 잔존 가능(scripts.reset_db로 재시드 필요): ${err}`);
    }
  }
  if (checkoutRestore) {
    try {
      if (checkoutRestore.previousHolder) {
        const { status } = await authedFetch(`/api/versions/${checkoutRestore.versionId}/checkout/transfer`, {
          method: "POST",
          body: JSON.stringify({ to: checkoutRestore.previousHolder }),
        });
        console.log(
          `체크아웃 원복(이전) status=${status} → ${checkoutRestore.previousHolder}${status === 200 ? "" : " ⚠️⚠️ 이전 실패 — draft가 admin.sys 점유로 남음"}`,
        );
      } else {
        // DELETE /checkout 성공 응답은 204 No Content
        const { status } = await authedFetch(`/api/versions/${checkoutRestore.versionId}/checkout`, {
          method: "DELETE",
        });
        console.log(`체크아웃 해제 status=${status} (기대 204)${status === 204 ? "" : " ⚠️⚠️ 해제 실패 — draft가 admin.sys 점유로 남음"}`);
      }
    } catch (err) {
      console.log(`⚠️⚠️ 체크아웃 원복 실패 — draft가 admin.sys 점유로 남음: ${err}`);
    }
  }
  try {
    await browser.close();
  } catch (err) {
    console.log(`⚠️ browser.close() 실패: ${err}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);

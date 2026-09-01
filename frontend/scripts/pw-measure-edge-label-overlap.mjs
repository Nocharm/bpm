// 엣지 라벨 ↔ 노드 겹침 실측 — 임포트 직후 자동배치가 간섭 없는지 검증한다.
// 실행: FE_PORT=3000 MAPS=29,30,31 node scripts/pw-measure-edge-label-overlap.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = process.env.FE_PORT ?? "3000";
const MAPS = (process.env.MAPS ?? "29").split(",");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();

let total = 0;
for (const mapId of MAPS) {
  await page.goto(`http://localhost:${PORT}/maps/${mapId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => {
    const rects = (sel) =>
      Array.from(document.querySelectorAll(sel)).map((el) => {
        const r = el.getBoundingClientRect();
        return { text: (el.textContent ?? "").trim().slice(0, 40), r };
      });
    const nodes = rects(".react-flow__node");
    // 엣지 라벨은 EdgeLabelRenderer 안의 절대배치 div
    const labels = rects(".react-flow__edgelabel-renderer > div").filter(
      (l) => l.text.length > 0 && l.r.width > 0,
    );
    const overlap = (a, b) => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return w > 0 && h > 0 ? Math.round(w) * Math.round(h) : 0;
    };
    const hits = [];
    for (const label of labels) {
      for (const node of nodes) {
        const area = overlap(label.r, node.r);
        if (area > 0) hits.push({ label: label.text, node: node.text, area });
      }
    }
    // 라벨끼리 겹침도 같이 본다
    const labelHits = [];
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const area = overlap(labels[i].r, labels[j].r);
        if (area > 0) labelHits.push({ a: labels[i].text, b: labels[j].text, area });
      }
    }
    const widest = Math.round(Math.max(0, ...labels.map((l) => l.r.width)));
    const tallest = Math.round(Math.max(0, ...labels.map((l) => l.r.height)));
    return { nodes: nodes.length, labels: labels.length, hits, labelHits, widest, tallest };
  });

  console.log(
    `map ${mapId}: nodes=${result.nodes} labels=${result.labels} ` +
      `노드겹침=${result.hits.length} 라벨겹침=${result.labelHits.length} ` +
      `최대라벨 ${result.widest}x${result.tallest}px`,
  );
  for (const h of result.hits) console.log(`   ✗ "${h.label}" ⨯ [${h.node}] ${h.area}px²`);
  for (const h of result.labelHits) console.log(`   ✗ "${h.a}" ⨯ "${h.b}" ${h.area}px²`);
  total += result.hits.length + result.labelHits.length;
}
console.log(total === 0 ? "OK — 간섭 없음" : `총 ${total}건 간섭`);
await browser.close();

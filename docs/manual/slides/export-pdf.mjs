// Print the standalone slide decks to PDF — one 1280×720 page per slide — with the system Chrome.
// Uses frontend/node_modules/playwright-core (the project's browser harness; no browser download).
//
//   bash:        cd frontend && node ../docs/manual/slides/export-pdf.mjs ../docs/manual/slides/bpm-manual-*.html
//   PowerShell:  cd frontend; node ..\docs\manual\slides\export-pdf.mjs (Get-Item ..\docs\manual\slides\bpm-manual-*.html).FullName
//
// Set CHROME_PATH when Chrome is not at the macOS default location.
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../../frontend/package.json"));
const { chromium } = require("playwright-core");

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node export-pdf.mjs <deck.html>...");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  for (const file of files) {
    const abs = path.resolve(file);
    const out = abs.replace(/\.html$/, ".pdf");
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto("file://" + abs, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" }); // the deck's @media print lays every slide out as its own page
    const slides = await page.locator(".slide").count();
    await page.pdf({
      path: out,
      width: "1280px",
      height: "720px",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    await page.close();
    console.log(`${path.basename(out)}: ${slides} slides`);
  }
} finally {
  await browser.close();
}

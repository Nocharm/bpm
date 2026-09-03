// 컴포넌트 카탈로그 생성 — src/components/**/*.tsx를 훑어 파일·역할(머리 주석 첫 줄)·사용처(임포트하는 파일)를
// frontend/COMPONENTS.md 표로 뽑는다. 일괄 UI 수정 전에 "이 컴포넌트가 어디서 공유되는지"를 한 번에 보기 위한
// 살아있는 목록 (사용자 지시 2026-09-03, 룰: rules/frontend/components.md). 컴포넌트 추가·이동·사용처 변경 후 재실행.
// 실행(frontend/ 에서): node scripts/build-component-catalog.mjs   (--check: 파일이 최신인지 검사만, CI/훅용)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const COMPONENTS = path.join(SRC, "components");
const OUT = path.join(ROOT, "COMPONENTS.md");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// 머리 주석 — "use client" 앞뒤의 첫 // 블록(또는 /* */)을 한 줄로 접는다. 없으면 빈 문자열
function readPurpose(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const collected = [];
  let started = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line === '"use client";' || line === "'use client';") {
      if (started) break;
      continue;
    }
    if (line.startsWith("//")) {
      started = true;
      collected.push(line.replace(/^\/\/\s?/, ""));
      continue;
    }
    if (line.startsWith("/*") || line.startsWith("*")) {
      started = true;
      const body = line.replace(/^\/\*+\s?|^\*+\/?\s?|\*\/$/g, "").trim();
      if (body) collected.push(body);
      if (line.endsWith("*/")) break;
      continue;
    }
    break;
  }
  // 첫 문장만(마침표·대시 앞) — 표 셀이 길어지지 않게
  const joined = collected.join(" ").replace(/\s+/g, " ").trim();
  const cut = joined.split(/(?<=[.。])\s|\s[—-]\s/)[0] ?? joined;
  return cut.length > 140 ? `${cut.slice(0, 137)}…` : cut;
}

// 내보내는 컴포넌트 이름(PascalCase function/const) — 파일에 여러 개면 전부
function readExports(file) {
  const text = fs.readFileSync(file, "utf8");
  const names = new Set();
  // PascalCase만(소문자 포함) — UPPER_SNAKE 상수(COST_UNITS 등)는 제외
  const isComponentName = (name) => /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);
  for (const m of text.matchAll(/export\s+(?:function|const)\s+([A-Za-z0-9_]+)/g)) {
    if (isComponentName(m[1])) names.add(m[1]);
  }
  for (const m of text.matchAll(/export\s+\{\s*([^}]+)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop() ?? "";
      if (isComponentName(name)) names.add(name);
    }
  }
  return [...names];
}

const componentFiles = walk(COMPONENTS).sort();
const allSources = walk(SRC);
// 임포트 지도 — "@/components/<rel>" 또는 상대경로로 그 파일을 참조하는 소스
const importers = new Map(componentFiles.map((f) => [f, new Set()]));
const relOf = (f) => path.relative(SRC, f).replace(/\\/g, "/").replace(/\.tsx?$/, "");
const specByFile = new Map(componentFiles.map((f) => [f, `@/${relOf(f)}`]));
for (const source of allSources) {
  const text = fs.readFileSync(source, "utf8");
  for (const target of componentFiles) {
    if (target === source) continue;
    const spec = specByFile.get(target);
    if (text.includes(`"${spec}"`) || text.includes(`'${spec}'`)) {
      importers.get(target).add(source);
      continue;
    }
    // 상대 경로 임포트(같은 폴더 내) — ./name 또는 ../dir/name
    const rel = path.relative(path.dirname(source), target).replace(/\\/g, "/").replace(/\.tsx?$/, "");
    const relSpec = rel.startsWith(".") ? rel : `./${rel}`;
    if (text.includes(`"${relSpec}"`) || text.includes(`'${relSpec}'`)) importers.get(target).add(source);
  }
}

const shortPath = (f) => path.relative(SRC, f).replace(/\\/g, "/");
const groups = new Map();
for (const file of componentFiles) {
  const dir = path.relative(COMPONENTS, path.dirname(file)).replace(/\\/g, "/") || ".";
  if (!groups.has(dir)) groups.set(dir, []);
  groups.get(dir).push(file);
}

const lines = [];
lines.push("# Frontend Components");
lines.push("");
lines.push(
  "`src/components/**` 목록 — **파일 · 내보내는 컴포넌트 · 역할(머리 주석 첫 문장) · 사용처(임포트하는 파일)**. " +
    "일괄 UI 수정 전에 대상 컴포넌트가 어디서 공유되는지 여기서 먼저 확인한다(룰 `rules/frontend/components.md`).",
);
lines.push("");
lines.push("> 생성 파일 — 손으로 고치지 말고 `node scripts/build-component-catalog.mjs`(frontend/)로 재생성한다. " +
  "컴포넌트를 추가·이동·삭제하거나 사용처가 바뀌면 같은 커밋에서 재생성. `--check`는 최신 여부만 검사. " +
  "역할 열이 비어 있으면 그 파일에 머리 주석(한 줄 역할 설명)이 없다는 뜻 — 주석을 채운다.");
lines.push("");
lines.push(`총 ${componentFiles.length}개 · ${new Date().toISOString().slice(0, 10)} 기준`);
lines.push("");
const esc = (s) => s.replace(/\|/g, "\\|");
for (const [dir, files] of [...groups.entries()].sort(([a], [b]) => (a === "." ? -1 : b === "." ? 1 : a.localeCompare(b)))) {
  lines.push(`## ${dir === "." ? "components/" : `components/${dir}/`}`);
  lines.push("");
  lines.push("| 파일 | 컴포넌트 | 역할 | 사용처 |");
  lines.push("|------|----------|------|--------|");
  for (const file of files) {
    const users = [...importers.get(file)].map(shortPath).sort();
    const usedBy = users.length === 0 ? "(미사용)" : users.map((u) => `\`${u}\``).join(", ");
    lines.push(
      `| \`${path.basename(file)}\` | ${readExports(file).map((n) => `\`${n}\``).join(", ") || "-"} | ${esc(readPurpose(file)) || " "} | ${usedBy} |`,
    );
  }
  lines.push("");
}
const output = `${lines.join("\n")}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  // 날짜 줄은 비교에서 제외 — 재생성 날짜만 달라진 건 stale이 아니다
  const strip = (s) => s.replace(/^총 \d+개 · \d{4}-\d{2}-\d{2} 기준$/m, "");
  if (strip(current) !== strip(output)) {
    console.error("COMPONENTS.md is stale - run: node scripts/build-component-catalog.mjs");
    process.exit(1);
  }
  console.log("COMPONENTS.md is up to date");
} else {
  fs.writeFileSync(OUT, output);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${componentFiles.length} components)`);
}

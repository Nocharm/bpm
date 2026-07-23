// read-only .docx 파서 — 문서 내부 링크 가능한 "섹션" 목록만 뽑는다(문서 0 수정).
// 실물 SOP 구조(사내 확인 2026-07-22):
//  · 제목은 커스텀 스타일이나 styles.xml에 outlineLvl 지정 → 레벨은 outlineLvl로 판정(이름 무관).
//  · 번호(1, 6.1)는 자동 다단계 리스트라 문단 런에 없음 → TOC 필드 캐시에서 획득.
//  · TOC 2개(Eng/Kor) \o "1-2" → 1~2단계만. 3단계+는 본문 제목에만 있고 _Toc 책갈피 보유.
//  · _Toc 책갈피는 과거 재생성 잔재로 한 제목에 중복 → 활성 세트 = TOC 하이퍼링크가 참조하는 것.
// 전략: (1) 내부 하이퍼링크에서 {활성앵커→번호}(1~2단계, 권위) 수집. (2) 본문 제목을 순서대로
//  걸으며 1~2단계는 TOC 번호, 3단계+는 부모(TOC 확정) 번호에 로컬 카운터를 이어 재구성.
// 제목 걷기(collectHeadings)는 완결문서 생성기(word-doc-generator)와 공유 — 합성 앵커 순번의 단일 소스.

// WordprocessingML 메인 네임스페이스 — 생성기의 책갈피 주입/문단 탐색도 이 상수를 쓴다.
export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export interface SectionEntry {
  anchor: string; // w:bookmarkStart w:name(활성 _Toc 우선) — 내부 하이퍼링크 앵커
  title: string; // 제목 텍스트(번호는 자동넘버라 런에 없음)
  number: string; // "6.1.1" 등 재구성 번호, 불가 시 ""
  level: number; // 1-based(outlineLvl+1), 미상 0
  language: string; // 스타일명 접미사에서 유추: "ko" | "en" | "" — 이중언어 문서 필터용
}

// 본문 제목 1개 — SectionEntry + 제목 <w:p> 요소(생성기가 합성 책갈피를 주입할 위치).
export interface HeadingHit {
  element: Element;
  anchor: string;
  number: string;
  title: string;
  level: number;
  language: string;
}

// w 네임스페이스 속성 — 파서가 NS 처리를 안 해도(prefix 유지) 동작하도록 폴백.
export function attr(el: Element, name: string): string {
  return el.getAttributeNS(W, name) ?? el.getAttribute(`w:${name}`) ?? "";
}

// 런 텍스트를 문서 순서로 수집 — w:tab은 "\t"로 보존(TOC의 번호\t제목\t페이지 구분).
function collectText(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.localName === "t") out += el.textContent ?? "";
    else if (el.localName === "tab") out += "\t";
    else out += collectText(el);
  }
  return out;
}

const NUMBER_RE = /^[0-9A-Za-z]+(?:\.[0-9]+)*\.?$/;

// TOC 항목 텍스트 "6.1\tProcedure\t12" → { number:"6.1", title:"Procedure" }.
function parseTocText(text: string): { number: string; title: string } {
  let parts = text.split("\t").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) parts = parts.slice(0, -1); // 페이지번호 제거
  if (parts.length === 0) return { number: "", title: "" };
  if (parts.length > 1 && NUMBER_RE.test(parts[0])) {
    return { number: parts[0].replace(/\.$/, ""), title: parts.slice(1).join(" ") };
  }
  return { number: "", title: parts.join(" ") };
}

// styles.xml: styleId → outlineLvl(0-based). basedOn 상속 따라감. 헤딩 스타일만 포함.
export function buildStyleLevels(stylesXml: string): Map<string, number> {
  const doc = new DOMParser().parseFromString(stylesXml, "application/xml");
  const own = new Map<string, number>();
  const basedOn = new Map<string, string>();
  for (const s of Array.from(doc.getElementsByTagNameNS(W, "style"))) {
    const id = attr(s, "styleId");
    if (!id) continue;
    const lvlEl = s.getElementsByTagNameNS(W, "outlineLvl")[0];
    if (lvlEl) own.set(id, Number(attr(lvlEl, "val")));
    const baseEl = s.getElementsByTagNameNS(W, "basedOn")[0];
    if (baseEl) basedOn.set(id, attr(baseEl, "val"));
  }
  const resolve = (id: string, depth: number): number | undefined => {
    if (own.has(id)) return own.get(id);
    const base = basedOn.get(id);
    return base && depth < 10 ? resolve(base, depth + 1) : undefined;
  };
  const resolved = new Map<string, number>();
  for (const id of new Set([...own.keys(), ...basedOn.keys()])) {
    const lvl = resolve(id, 0);
    if (lvl !== undefined) resolved.set(id, lvl);
  }
  return resolved;
}

// outlineLvl이 안 읽히는 커스텀 제목 스타일의 레벨을 스타일 이름 숫자에서 유추 — 사내 SOP는
// "SBL_Text N_Kor/Eng"(styleId "SBLTextNKor") 형태로 outlineLvl이 감지 안 되는 경우가 있어 폴백.
// "SBLText3Kor" → 3, "…Appendix…" → 1(최상위 취급), 그 외 → 0(제목 아님).
function levelFromStyleName(styleId: string): number {
  const m = styleId.match(/text[\s_]*(\d+)/i);
  if (m) return Number(m[1]);
  if (/appendix/i.test(styleId)) return 1;
  return 0;
}

// 본문 제목 ↔ TOC 항목 제목 매칭 키 — 앞뒤 공백·중복 공백 정규화.
function normalizeTitle(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// 본문 제목 걷기 — 파서(parseWordSections)와 생성기(word-doc-generator)가 같은 제목 집합·
// 같은 합성 앵커(_bpmsecN) 순번을 공유하는 단일 소스. 순서·카운터를 바꾸면 저장된 노드 앵커가 깨진다.
export function collectHeadings(doc: Document, styleLevels: Map<string, number>): HeadingHit[] {
  // (1) TOC 항목 — 내부 하이퍼링크(w:anchor)에서 활성 앵커→번호 수집.
  const tocMap = new Map<string, { number: string; title: string }>();
  // 제목 → {번호, 레벨} — 책갈피 없는 제목이 앵커 대신 제목으로 TOC 권위 번호를 찾게 한다.
  const tocByTitle = new Map<string, { number: string; level: number }>();
  for (const link of Array.from(doc.getElementsByTagNameNS(W, "hyperlink"))) {
    const anchor = attr(link, "anchor");
    if (!anchor || anchor === "_GoBack" || tocMap.has(anchor)) continue;
    const parsed = parseTocText(collectText(link));
    tocMap.set(anchor, parsed);
    if (parsed.number && parsed.title) {
      const key = normalizeTitle(parsed.title);
      if (!tocByTitle.has(key)) {
        tocByTitle.set(key, { number: parsed.number, level: parsed.number.split(".").length });
      }
    }
  }

  // (2) 본문 제목 순회 — 레벨은 outlineLvl, 번호는 TOC 씨앗 + 로컬 카운터.
  const out: HeadingHit[] = [];
  const seen = new Set<string>();
  const counters: number[] = []; // counters[i] = 레벨 i+1 카운트
  const stack: string[] = []; // stack[i] = 레벨 i+1 현재 번호 문자열
  let synthSeq = 0; // 책갈피 없는 제목에 부여하는 합성 앵커 번호 — 출력 시 사본에 이 이름으로 주입
  for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
    const pPr = p.getElementsByTagNameNS(W, "pPr")[0];
    const styleEl = pPr?.getElementsByTagNameNS(W, "pStyle")[0];
    const sid = styleEl ? attr(styleEl, "val") : "";
    let level = 0;
    const directLvl = pPr?.getElementsByTagNameNS(W, "outlineLvl")[0];
    if (directLvl) level = Number(attr(directLvl, "val")) + 1;
    else if (sid && styleLevels.has(sid)) level = styleLevels.get(sid)! + 1;
    else level = levelFromStyleName(sid); // outlineLvl 없는 커스텀 제목 → 스타일 이름 숫자
    if (level === 0) continue; // 제목 아님

    const text = Array.from(p.getElementsByTagNameNS(W, "t"))
      .map((t) => t.textContent ?? "")
      .join("")
      .trim();
    if (!text) continue; // 빈 제목 문단(블랭크 라인) 제외 — 유령 항목·번호 오염 방지

    const names = Array.from(p.getElementsByTagNameNS(W, "bookmarkStart"))
      .map((b) => attr(b, "name"))
      .filter((n) => n && n !== "_GoBack");
    // 책갈피 있으면 활성 우선, 없으면 합성 앵커(주입 대상) — 책갈피 없는 제목도 목록에 노출.
    const anchor =
      names.find((n) => tocMap.has(n)) ??
      names.find((n) => /^_Toc/i.test(n)) ??
      names[0] ??
      `_bpmsec${++synthSeq}`;
    if (seen.has(anchor)) continue;
    seen.add(anchor);

    // 번호: 어펜딕스=무번호 / TOC(앵커 or 제목 매칭)=권위 / 그 외=재구성.
    // 제목 매칭은 책갈피 없는 1~2단계 제목(다른 언어 트리 등)이 TOC 번호를 받아 카운터를 리셋하게 한다.
    let tocNumber = tocMap.get(anchor)?.number ?? "";
    if (!tocNumber) {
      const byTitle = tocByTitle.get(normalizeTitle(text));
      if (byTitle && byTitle.level === level) tocNumber = byTitle.number;
    }
    let number: string;
    if (/appendix/i.test(sid)) {
      number = ""; // 어펜딕스는 문서상 무번호 — 카운터도 안 건드림
    } else if (tocNumber) {
      // 1~2단계: TOC 번호 권위 + 자식 계산 위해 카운터/스택 동기화.
      number = tocNumber;
      const segs = number.split(".");
      for (let i = 0; i < level; i++) counters[i] = Number(segs[i]) || 0;
      counters.length = level;
      stack[level - 1] = number;
      stack.length = level;
    } else {
      // 3단계+: 부모 번호에 로컬 카운터 이어붙임(레벨 상승 시 하위 리셋).
      for (let i = counters.length; i < level; i++) counters[i] = 0;
      counters[level - 1] = (counters[level - 1] || 0) + 1;
      counters.length = level;
      // 부모 = 바로 위 레벨. 레벨을 건너뛰어 비었으면(스택 구멍) 아래로 내려가며 가장 가까운 채워진 조상.
      let parent = "";
      for (let i = level - 2; i >= 0; i--) {
        if (stack[i]) {
          parent = stack[i];
          break;
        }
      }
      number = parent ? `${parent}.${counters[level - 1]}` : String(counters[level - 1]);
      stack[level - 1] = number;
      stack.length = level;
    }
    const language = /kor/i.test(sid) ? "ko" : /eng/i.test(sid) ? "en" : "";
    out.push({ element: p, anchor, title: text, number, level, language });
  }

  // TODO(임시 진단, 2026-07-23): 실물 문서 구조 파악용 — 스타일별 감지 레벨·책갈피 보유율 집계.
  // 깊은 레벨(3+) 링크 누락 원인(책갈피 부재 vs 파서) 확정 후 이 블록 제거.
  {
    const byStyle = new Map<string, { count: number; level: number; withBm: number; sample: string }>();
    let totalBm = 0;
    for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
      const pPr = p.getElementsByTagNameNS(W, "pPr")[0];
      const styleEl = pPr?.getElementsByTagNameNS(W, "pStyle")[0];
      const sid = styleEl ? attr(styleEl, "val") : "";
      const names = Array.from(p.getElementsByTagNameNS(W, "bookmarkStart"))
        .map((b) => attr(b, "name"))
        .filter((n) => n && n !== "_GoBack");
      totalBm += names.length;
      if (!sid) continue;
      const directLvl = pPr?.getElementsByTagNameNS(W, "outlineLvl")[0];
      const level = directLvl
        ? Number(attr(directLvl, "val")) + 1
        : styleLevels.has(sid)
          ? styleLevels.get(sid)! + 1
          : 0;
      const text = Array.from(p.getElementsByTagNameNS(W, "t"))
        .map((t) => t.textContent ?? "")
        .join("")
        .trim();
      const e = byStyle.get(sid) ?? { count: 0, level, withBm: 0, sample: text.slice(0, 30) };
      e.count += 1;
      if (names.length) e.withBm += 1;
      byStyle.set(sid, e);
    }
    console.log(`[word-import] emitted=${out.length} totalBookmarks=${totalBm} tocMapSize=${tocMap.size}`);
    for (const [sid, e] of byStyle) {
      console.log(
        `[word-import] style="${sid}" level=${e.level} count=${e.count} withBookmark=${e.withBm} eg="${e.sample}"`,
      );
    }
  }
  return out;
}

export async function parseWordSections(docxBytes: Uint8Array): Promise<SectionEntry[]> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(docxBytes);
  const docPart = files["word/document.xml"];
  if (!docPart) return [];
  const doc = new DOMParser().parseFromString(strFromU8(docPart), "application/xml");
  const stylesPart = files["word/styles.xml"];
  const styleLevels = stylesPart
    ? buildStyleLevels(strFromU8(stylesPart))
    : new Map<string, number>();
  return collectHeadings(doc, styleLevels).map(({ anchor, title, number, level, language }) => ({
    anchor,
    title,
    number,
    level,
    language,
  }));
}

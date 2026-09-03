// 인터뷰 임포트 dry-run 리포트 뷰모델 — 서버가 주는 평면 rows(코드·동작·영문 상세 500행)를
// 파일 → L5 캔버스 → 맵 계층과 "반복 경고 다이제스트"로 재구성한다.
// 사람이 읽는 이름(l6 라벨·카테고리명)은 업로드한 인터뷰 JSON에서 뽑는다 — 서버 rows는
// consultant_code/카테고리 코드만 싣고 오므로, 스키마 변경 없이 이름을 노출하는 유일한 경로.
// 코드↔이름 대응 계약: 맵 코드=rows[].taskId, 맵 이름=rows[].l6, 카테고리=l5.nodeCode
// (backend/scripts/consultant_interview.py convert_interview).

import type { GovernanceDecision, GovernanceDiff, GovernanceField } from "./api";

export interface ImportRow {
  code: string;
  action: string;
  detail: string;
}

export interface IndexedMap {
  code: string;
  name: string;
  fileIndex: number;
  order: number;
  department: string;
  ownerRole: string;
  unitId: string;
}

export interface IndexedFile {
  name: string;
  l5Code: string;
  l5Name: string;
  categoryPath: string;
}

export interface InterviewIndex {
  files: IndexedFile[];
  maps: Map<string, IndexedMap>;
}

/** 상세 문구 분류 — 반복 경고를 묶는 그룹 키이자 사람이 읽는 문구(i18n)의 선택자. */
export type DetailKind =
  | "owner-fallback"
  | "owner-not-found"
  | "approver-not-found"
  | "sp-department-empty"
  | "duplicate-name"
  | "duplicate-code"
  | "unknown-category"
  | "in-trash"
  | "no-landing"
  | "canvas"
  | "linkage-skipped"
  | "published"
  | "other";

export type Severity = "error" | "warning" | "info";

export interface ReportMessage {
  kind: DetailKind;
  severity: Severity;
  subject: string; // 문구에서 뽑은 가변부(로그인 id·사유 등) — 없으면 ""
  numbers: number[]; // 캔버스 map id·노드수처럼 문구에 박힌 수치
  raw: string;
}

export interface ReportMapEntry {
  code: string;
  name: string;
  unitId: string;
  department: string;
  ownerRole: string;
  outcome: "created" | "updated" | "unchanged" | "error" | null;
  version: number | null; // created 행의 "published v1"
  outcomeDetail: string;
  messages: ReportMessage[];
}

export interface ReportCanvasEntry {
  code: string;
  name: string;
  path: string; // 루트→L5 카테고리 경로
  messages: ReportMessage[];
}

export interface ReportGroup {
  file: string; // "" = 어느 파일에도 매칭되지 않은 코드 묶음
  canvas: ReportCanvasEntry | null;
  maps: ReportMapEntry[];
}

export interface DigestGroup {
  key: string;
  kind: DetailKind;
  severity: Severity;
  count: number;
  raw: string; // kind === "other"일 때 화면에 그대로 쓰는 원문 표본
  subjects: string[];
  maps: { code: string; name: string }[];
}

export interface ImportReportView {
  groups: ReportGroup[];
  digest: DigestGroup[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 업로드한 인터뷰 JSON에서 코드→이름 색인을 만든다. 파싱 실패 파일은 호출부가 걸러 보낸다. */
export function buildInterviewIndex(files: { name: string; content: unknown }[]): InterviewIndex {
  const index: InterviewIndex = { files: [], maps: new Map() };
  files.forEach((file, fileIndex) => {
    const root = asRecord(file.content);
    const l5 = asRecord(root?.l5);
    const l5Code = asText(l5?.nodeCode);
    const cats = asRecord(root?.framework)?.categories;
    const byCode = new Map<string, { name: string; parent: string }>();
    if (Array.isArray(cats)) {
      for (const raw of cats) {
        const cat = asRecord(raw);
        const code = asText(cat?.code);
        if (code) byCode.set(code, { name: asText(cat?.name), parent: asText(cat?.parent) });
      }
    }
    // 카테고리 경로 — 루트→L5. parent 체인이 끊기면 거기서 멈춘다(어댑터가 별도 검증).
    const chain: string[] = [];
    let cursor = l5Code;
    while (cursor && byCode.has(cursor) && chain.length < 10) {
      const node = byCode.get(cursor);
      if (!node) break;
      chain.unshift(node.name || cursor);
      cursor = node.parent;
    }
    index.files.push({
      name: file.name,
      l5Code,
      l5Name: asText(l5?.label) || byCode.get(l5Code)?.name || l5Code,
      categoryPath: chain.join(" › "),
    });

    const rows = root?.rows;
    if (!Array.isArray(rows)) return;
    rows.forEach((raw, order) => {
      const row = asRecord(raw);
      const code = asText(row?.taskId);
      if (!code || index.maps.has(code)) return; // 중복 taskId는 어댑터가 에러로 잡는다
      index.maps.set(code, {
        code,
        name: asText(row?.l6) || code,
        fileIndex,
        order,
        department: asText(row?.department),
        ownerRole: asText(row?.ownerRole),
        unitId: asText(row?.unitId),
      });
    });
  });
  return index;
}

const PATTERNS: { kind: DetailKind; re: RegExp }[] = [
  { kind: "owner-fallback", re: /^owner missing/ },
  { kind: "owner-not-found", re: /^owner '(.*)' not found/ },
  { kind: "approver-not-found", re: /^approver '(.*)' not found/ },
  { kind: "sp-department-empty", re: /^sp_department empty$/ },
  { kind: "duplicate-name", re: /^duplicate map name '(.*)'/ },
  { kind: "duplicate-code", re: /^duplicate map code/ },
  { kind: "unknown-category", re: /^unknown category (.*)$/ },
  { kind: "in-trash", re: /^map is in trash/ },
  { kind: "no-landing", re: /^annual_count\/fte have no landing site/ },
  { kind: "linkage-skipped", re: /^linkage skipped - (.*)$/ },
  // verb는 created|augmented (import_consultant.apply_interview_linkage) — 새 동사가 생겨도 통과시킨다
  { kind: "canvas", re: /^canvas ([a-z]+) \(map (\d+), \+(\d+) nodes\/edges\)$/ },
  { kind: "published", re: /^published v(\d+)$/ },
];

/** 백엔드 상세 문구를 종류·가변부로 분해. 미등록 문구는 "other"로 원문을 그대로 보존한다. */
export function classifyDetail(action: string, detail: string): ReportMessage {
  const severity: Severity = action === "error" ? "error" : action === "warning" ? "warning" : "info";
  const raw = detail.trim();
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(raw);
    if (!m) continue;
    const captures = m.slice(1);
    const numbers = captures.filter((c) => /^\d+$/.test(c)).map(Number);
    const subject = /^\d+$/.test(captures[0] ?? "") ? "" : (captures[0] ?? "");
    return { kind, severity, subject, numbers, raw };
  }
  return { kind: "other", severity, subject: "", numbers: [], raw };
}

// 같은 종류 반복을 한 줄로 접기 위한 그룹 키 — "other"만 원문(가변부 마스킹)으로 구분한다.
function getDigestKey(msg: ReportMessage): string {
  if (msg.kind !== "other") return msg.kind;
  return `other:${msg.raw.replace(/'[^']*'/g, "'*'").replace(/\d+/g, "#")}`;
}

/** 평면 rows를 파일→맵 계층 + 경고 다이제스트로 재구성. */
export function buildImportReportView(rows: ImportRow[], index: InterviewIndex): ImportReportView {
  const groups: ReportGroup[] = index.files.map((f) => ({ file: f.name, canvas: null, maps: [] }));
  const orphan: ReportGroup = { file: "", canvas: null, maps: [] };
  const entryByCode = new Map<string, ReportMapEntry>();
  const canvasFileByCode = new Map<string, number>();
  index.files.forEach((f, i) => {
    if (f.l5Code) canvasFileByCode.set(f.l5Code, i);
  });

  const takeMapEntry = (code: string): ReportMapEntry => {
    const known = entryByCode.get(code);
    if (known) return known;
    const info = index.maps.get(code);
    const entry: ReportMapEntry = {
      code,
      name: info?.name ?? code,
      unitId: info?.unitId ?? "",
      department: info?.department ?? "",
      ownerRole: info?.ownerRole ?? "",
      outcome: null,
      version: null,
      outcomeDetail: "",
      messages: [],
    };
    entryByCode.set(code, entry);
    (info ? groups[info.fileIndex] : orphan).maps.push(entry);
    return entry;
  };

  for (const row of rows) {
    const msg = classifyDetail(row.action, row.detail);
    const canvasFile = index.maps.has(row.code) ? undefined : canvasFileByCode.get(row.code);
    if (canvasFile !== undefined) {
      const group = groups[canvasFile];
      const file = index.files[canvasFile];
      group.canvas ??= { code: row.code, name: file.l5Name, path: file.categoryPath, messages: [] };
      group.canvas.messages.push(msg);
      continue;
    }
    const entry = takeMapEntry(row.code);
    if (row.action === "created" || row.action === "updated" || row.action === "unchanged" || row.action === "error") {
      entry.outcome = row.action;
      entry.outcomeDetail = msg.raw;
      if (msg.kind === "published") entry.version = msg.numbers[0] ?? null;
      // 에러 행의 사유는 다이제스트에도 걸려야 한다 — 상단 요약이 "왜 막혔나"의 단일 창구.
      if (row.action === "error") entry.messages.push(msg);
    } else {
      entry.messages.push(msg);
    }
  }

  // 파일 안 맵 순서는 인터뷰 JSON rows 순서 — 리포트 행 순서(경고 우선 정렬)와 무관하게 고정한다.
  for (const group of groups) {
    group.maps.sort((a, b) => (index.maps.get(a.code)?.order ?? 0) - (index.maps.get(b.code)?.order ?? 0));
  }
  if (orphan.maps.length > 0) groups.push(orphan);

  const digestByKey = new Map<string, DigestGroup>();
  const collect = (msgs: ReportMessage[], owner: { code: string; name: string }) => {
    for (const msg of msgs) {
      if (msg.severity === "info") continue;
      const key = getDigestKey(msg);
      const group = digestByKey.get(key) ?? {
        key,
        kind: msg.kind,
        severity: msg.severity,
        count: 0,
        raw: msg.raw,
        subjects: [],
        maps: [],
      };
      group.count += 1;
      if (msg.severity === "error") group.severity = "error";
      if (msg.subject && !group.subjects.includes(msg.subject)) group.subjects.push(msg.subject);
      if (!group.maps.some((m) => m.code === owner.code)) group.maps.push(owner);
      digestByKey.set(key, group);
    }
  };
  for (const group of groups) {
    if (group.canvas) collect(group.canvas.messages, { code: group.canvas.code, name: group.canvas.name });
    for (const entry of group.maps) collect(entry.messages, { code: entry.code, name: entry.name });
  }
  const digest = [...digestByKey.values()].sort(
    (a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "error" ? -1 : 1),
  );

  return { groups, digest };
}

// ── 거버넌스 확인 섹션 — dry-run governance[]를 맵 단위로 묶고 체크 키를 왕복한다 (spec 2026-09-03 §6)

export interface GovernanceMapGroup {
  code: string;
  name: string;
  diffs: GovernanceDiff[];
}

const GOVERNANCE_FIELD_ORDER: GovernanceField[] = ["owner", "department", "approvers", "notes"];

// 체크 상태 키 — 코드에 ':'가 있어도 필드는 콜론이 없으니 마지막 ':'에서 자르면 복원된다
export function governanceKey(d: GovernanceDecision): string {
  return `${d.code}:${d.field}`;
}

export function parseGovernanceKey(key: string): GovernanceDecision {
  const at = key.lastIndexOf(":");
  return { code: key.slice(0, at), field: key.slice(at + 1) as GovernanceField };
}

export function groupGovernanceDiffs(diffs: GovernanceDiff[]): GovernanceMapGroup[] {
  const groups = new Map<string, GovernanceMapGroup>();
  for (const d of diffs) {
    const group = groups.get(d.code) ?? { code: d.code, name: d.name, diffs: [] };
    group.diffs.push(d);
    groups.set(d.code, group);
  }
  for (const group of groups.values()) {
    group.diffs.sort(
      (a, b) => GOVERNANCE_FIELD_ORDER.indexOf(a.field) - GOVERNANCE_FIELD_ORDER.indexOf(b.field),
    );
  }
  return [...groups.values()];
}

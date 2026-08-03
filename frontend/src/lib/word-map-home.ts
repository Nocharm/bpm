// Word 맵 홈 표현 파생 헬퍼 — 목록 분리·재생성 힌트·stale 앵커 판정.
// 설계: docs/design/2026-07-24-word-map-lifecycle-design.md §2·§5

// 홈 목록 분리 — 조직도/집계는 processMaps만, Word documents 섹션은 wordMaps만 사용한다.
export function splitMapsByMode<T extends { mode?: string }>(
  maps: T[],
): { processMaps: T[]; wordMaps: T[] } {
  const processMaps: T[] = [];
  const wordMaps: T[] = [];
  for (const m of maps) (m.mode === "word" ? wordMaps : processMaps).push(m);
  return { processMaps, wordMaps };
}

// 재임포트가 마지막 완결 문서 생성보다 새로우면 재생성 필요. 생성 이력이 없으면 힌트 없음.
export function needsRegenerate(map: {
  doc_imported_at?: string | null;
  doc_generated_at?: string | null;
}): boolean {
  if (!map.doc_imported_at || !map.doc_generated_at) return false;
  return new Date(map.doc_imported_at).getTime() > new Date(map.doc_generated_at).getTime();
}

// 카탈로그에 더 이상 없는 앵커를 참조하는 섹션 노드 id — 캔버스 배지·섹션 패널 경고용(재임포트 후 자동삭제 없음).
export function getStaleSectionNodeIds(
  nodes: { id: string; nodeType?: string; sectionAnchor?: string }[],
  sections: { anchor: string }[],
): Set<string> {
  const anchors = new Set(sections.map((s) => s.anchor));
  const stale = new Set<string>();
  for (const n of nodes) {
    if (n.nodeType === "section" && n.sectionAnchor && !anchors.has(n.sectionAnchor)) {
      stale.add(n.id);
    }
  }
  return stale;
}

// 타임스탬프 표시 — 홈 행/상세 카드는 날짜(YYYY-MM-DD)면 충분. KST 고정(lib/datetime.ts 규칙 — 브라우저 tz 무관).
export function formatDocStamp(value: string | null | undefined): string | null {
  if (!value) return null;
  // en-CA locale renders YYYY-MM-DD directly
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

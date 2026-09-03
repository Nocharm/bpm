// 인스펙터 속성·지표·상세 카드의 행 문법 — 읽기 전용이든 편집이든 같은 행 높이(32px)와 간격을 가진다
// (사용자 요청 2026-09-03: 일반 노드·SP 노드·읽기/편집 간 스페이서 정책 통일). 편집 컨트롤(입력 w-32 24px,
// 피커 트리거 24px, ＋ 버튼 22px)이 모두 이 높이 안에 들어간다. 스페이서는 URL 행 위 구분선 하나뿐.
export const INSPECTOR_ROW = "flex min-h-8 items-center justify-between gap-2 py-1";
export const INSPECTOR_ROW_LABEL = "inline-flex min-w-0 shrink-0 items-center gap-1 text-caption text-ink-secondary";

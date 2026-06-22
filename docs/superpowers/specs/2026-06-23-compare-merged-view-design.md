# 통합(병합) 비교 화면 재작성 — Design Spec

- 작성일: 2026-06-23
- 대상: `frontend/src/app/maps/[mapId]/compare/page.tsx` 및 diff/layout 모듈
- 상태: 승인됨 (브레인스토밍 완료)

## 1. 배경 / 문제

현재 비교 화면은 **좌/우 두 개의 ReactFlow 캔버스**를 나란히 띄운다(`compare/page.tsx`). 문제:

- **데이터에 노드가 있어도 캔버스에 노드가 안 뜬다** — 저장된 좌표(`pos_x`/`pos_y`)에 의존한 렌더링 경로가 깨져 빈 화면이 된다. (별개로 커밋 로그에 `compare-view dev-auth 403` 흔적도 있어, fetch/인증 경로가 데이터를 주는지 구현 첫 단계에서 재현·확인한다.)
- 좌/우 분리라 **차이를 한눈에 못 본다** — 같은 흐름을 두 번 훑어야 한다.

## 2. 목표

두 버전을 **하나의 병합 캔버스**에서 비교한다. **노드 위치는 무시**하고 **연결(엣지)만으로 자동 배치**하며, **추가/삭제된 엣지와 노드, 속성 변경 노드**를 색으로 한 화면에 표현한다.

비목표(이번 범위 밖):
- 서브프로세스(`linked_map_id`) 드릴인 비교
- 편집 기능 (조회 전용)
- 엣지 라벨 변경 감지 (연결 존재 여부만 비교)

## 3. 핵심 개념 — Union Graph

두 버전 그래프를 **합집합**으로 합쳐 한 캔버스에 그린다. 저장 좌표를 버리고 **dagre로 연결 기반 자동 배치**한다 → 좌표 의존 렌더 버그를 구조적으로 우회.

### 노드 상태 (기존 `lib/diff.ts` 매칭 재사용)

매칭은 `getLineageKey`(= `source_node_id ?? id`) 우선, 없으면 `(parentLineageKey, title)` fallback — `computeVersionDiff`와 동일.

| 상태 | 조건 | 표현 |
|------|------|------|
| `unchanged` | 양쪽 존재 · 속성 동일 | 중립색, 1개만 |
| `changed` | 양쪽 존재 · `FIELD_KEYS` 중 다름 | **앰버** 외곽/뱃지, 1개 |
| `added` | target에만 | **초록** |
| `removed` | base에만 | **빨강 + 점선 외곽** |

### 엣지 상태 (`source lineage → target lineage` 키)

| 상태 | 조건 | 표현 |
|------|------|------|
| `unchanged` | 양쪽 존재 | 회색 실선 |
| `added` | target에만 | 초록 실선 |
| `removed` | base에만 | 빨강 점선 |

removed 노드·엣지도 union 그래프에 포함시켜 dagre가 함께 배치 → 사라진 흐름의 위치가 한 화면에 드러난다.

## 4. 모듈 구성

| 파일 | 역할 |
|------|------|
| `frontend/src/lib/merge-diff.ts` (신규) | `diff.ts` 매칭 로직을 재사용해 **union 노드/엣지 + status** 산출 |
| `frontend/src/lib/compare-layout.ts` (신규) | `@dagrejs/dagre`로 union 그래프 좌표 계산 (방향 LR 기본) |
| `frontend/src/app/maps/[mapId]/compare/page.tsx` (재작성) | 버전 선택 → fetch → 병합 → 배치 → 단일 캔버스 렌더 + 변경 목록 |
| diff 노드/엣지 컴포넌트 | status별 스타일(토큰: `ring-added`/`text-error`/`bg-accent-tint` 등), 읽기전용 |

### 4.1 `merge-diff.ts` 인터페이스 (안)

```ts
export type MergedStatus = "unchanged" | "added" | "removed" | "changed";

export interface MergedNode {
  id: string;            // 안정 union id = lineageKey
  title: string;
  node_type: string;
  status: MergedStatus;
  changedFields: ChangedField[];  // changed일 때만 채움 (diff.ts 재사용)
  base: FlatNode | null;
  target: FlatNode | null;
}

export interface MergedEdge {
  id: string;            // `${sourceLineage}→${targetLineage}`
  source: string;        // MergedNode.id
  target: string;
  status: "unchanged" | "added" | "removed";
  label: string;
}

export interface MergedGraph {
  nodes: MergedNode[];
  edges: MergedEdge[];
  entries: NodeDiffEntry[];  // 변경 목록용 (diff.ts 타입 재사용)
}

export function buildMergedGraph(base: VersionGraph, target: VersionGraph): MergedGraph;
```

`diff.ts`의 `getLineageKey`/`FIELD_KEYS`/edge 키 로직을 공유한다 (중복 구현 금지 — 필요한 헬퍼는 `diff.ts`에서 export하거나 공통 모듈로 추출).

## 5. 화면 레이아웃

```
┌─ Compare ── [base ▾] → [target ▾] ──────────── [legend] ─┐
│  (단일 ReactFlow · 읽기전용 · dagre LR 배치)               │
│  노드/엣지 status별 색상 오버레이                           │
├──────────────────────────────────────────────────────────┤
│ Changes  ● Added(n)  ◌ Removed(n)  ◆ Changed(n)           │
│  + edge: Review → Audit                                   │
│  − edge: Review → Approve                                 │
│  ◆ node: "승인" (assignee)   ← 클릭 시 캔버스 포커스        │
└──────────────────────────────────────────────────────────┘
```

- 상단: base/target 드롭다운(좌우 분리 폐기), 범례. 기본값 base=published, target=최신.
- 중앙: 단일 캔버스 — `nodesDraggable=false`, `nodesConnectable=false`, `fitView`. 클릭 = 상세/포커스.
- 하단(또는 우측): 변경 목록. 항목 클릭 시 해당 노드/엣지로 `setCenter`·강조.

## 6. 성공 기준 (검증 가능)

1. base/target에 노드가 있으면 **반드시 캔버스에 보인다** (현재 버그 회귀 — 빈 화면 금지).
2. target에만 있는 엣지 → 초록, base에만 있는 엣지 → 빨강 점선.
3. 속성만 바뀐 노드 → 앰버 + 변경 목록에 바뀐 필드 표시.
4. 저장 좌표를 전혀 쓰지 않고도 흐름이 읽히게 배치된다 (dagre).
5. 변경 목록 항목 클릭 → 캔버스의 해당 요소로 이동·강조.

### 검증 방법

- `merge-diff.ts` 단위 테스트 (added/removed/changed 엣지·노드 케이스, AAA 패턴).
- 브라우저 검증: 시드 데이터로 두 버전 생성 후 compare 진입 → 노드 렌더 + diff 색상 육안 확인 (`docs/lessons/browser-verification.md` 따라 서버/원격 IP 또는 로컬 네이티브, dev.db 오염 주의).

## 7. 구현 순서 (플랜에서 상세화)

0. **재현·진단** — 현재 compare에서 `/api/versions/{id}/graph/all` fetch가 데이터를 주는지 확인 (403/빈 응답 여부 분리).
1. `merge-diff.ts` + 단위 테스트 (TDD).
2. `compare-layout.ts` (dagre).
3. `compare/page.tsx` 재작성 — 단일 캔버스 + 버전 선택 + 변경 목록.
4. diff 노드/엣지 컴포넌트 스타일(토큰).
5. 브라우저 검증 + 회귀 확인.

## 8. 리스크 / 주의

- **diff.ts 헬퍼 재사용**: `getLineageKey` 등이 현재 module-private. export로 노출하거나 공통 헬퍼로 추출 — 매칭 로직 중복 구현 금지.
- **flat 모델**: 서브프로세스 참조 모델(⑦)에서 `parent_node_id`는 대부분 null → path/location/descendant 로직은 사실상 no-op. merged 빌더는 노드 add/remove/change + 엣지 add/remove에 집중.
- **dagre 고립 노드**: 엣지가 없는 노드(연결 안 된 added/removed)도 배치되도록 dagre에 노드로 등록.
- **LF 줄바꿈·토큰 색상**: `rules/frontend/design.md` 준수 (raw hex 금지, 토큰만).

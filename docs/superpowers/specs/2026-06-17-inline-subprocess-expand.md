# 인라인 하위 프로세스 펼치기/접기 — 설계 스펙

> 작성 2026-06-17 · 대상 브랜치 `feat/canvas-view-improvements` · 상태: **구현 중**

> **개정 2026-06-18 (레이아웃 모델 변경, 사용자 피드백 반영):** 아래 §2 D5·§4.3의 "전부 하나의 평면 LR 흐름" 모델은 **폐기**. 펼침은 평면 병합이 아니라 **영역 컨테이너 모델**로 한다 — 펼친 노드 A 오른쪽에 **깊이 틴트 배경의 하위 영역 박스**를 삽입하고, 공간상 A보다 오른쪽 노드를 영역 폭만큼 우측 이동(왼쪽·A의 수동 배치는 보존, 전체 재배치 아님). 자식은 영역 안에서 로컬 LR 배치. `A→진입점(Start 등)`·`진출점(End 등)→후속` 게이트웨이로 연결, `A→B`는 숨김, 영역을 가로지르는 엣지는 반투명. 깊이가 다른 영역은 섞이지 않음. 나머지 결정(데이터 (a)·fullGraph 재사용·scope-split·ScopeWindow 존속)은 유지.

## 1. 목표

하위 프로세스 드릴인을 OS형 자유 창(`ScopeWindow`)에서 **같은 캔버스 인라인 펼치기/접기**로 전환한다. 새 창을 띄우지 않고, 하위 노드(Start·작업·End)를 현재 그래프에 합쳐 **하나의 LR dagre 흐름**으로 그린다.

## 2. 확정 결정 (1단계 조사 + 사용자 확인)

| # | 항목 | 결정 | 근거 |
|---|------|------|------|
| D1 | 데이터 저장 | **(a)** 자식 스코프(`nodes.parent_node_id`) 그대로 유지, 펼침은 뷰 합성. **백엔드 무변경** | 복제·diff·`replace_graph` 부분교체가 모두 `parent_node_id` 트리 의존. (b) 영구병합은 4개 지점 재설계 + "순수 뷰" 위반 |
| D2 | 로딩 | **기존 `fullGraph` 재사용** — 펼칠 때 메모리의 전체 트리에서 `parent_node_id` 필터. 신규 fetch/sessionStorage 없음 | `fullGraph`는 버전당 1회 무조건 선로딩됨(`page.tsx:823`). 자식 데이터가 이미 메모리에 있어 per-scope 지연로딩은 중복 |
| D3 | 캡 설정 | **프론트 config 모듈**(`lib`) 단일 상수 export. 추후 `/admin` 서버값으로 교체할 seam만 | 캡은 순수 클라이언트 렌더 관심사. 백엔드 표면 불필요 |
| D4 | ScopeWindow | **드릴인 용도만 제거, AI 채팅 존속**(방향 A: 최소 변경) | `AiChatPanel`은 `window-store`/`ScopeWindow`를 import조차 안 함. 창은 껍데기로만 재사용(`page.tsx:3699-3719`) |
| D5 | 레이아웃 | 펼친 자식 포함 **단일 `layoutWithDagre(rankdir:"LR")` 1회**. 상위/하위 정렬 분리 안 함 | `canvas.ts:459` — 자식/스코프 무지각, id 그래프만. 통합 LR이 스펙 step 2 그대로 |
| D6 | 편집성 | 펼친 자식은 **편집 가능**. 구조 편집(추가/삭제/라벨/색/엣지)은 **해당 자식 스코프로 분리 저장**(scope-split save). 펼침/접기 자체는 **비-dirty 순수 뷰**(A→B는 hide만, 재배선 없음) | step 3 불변식·삭제검사가 인라인 편집을 전제. step 4 "순수 뷰=데이터 재배선 아님"은 hide-not-rewire로 충족 |

## 3. 데이터 모델 복기

- 하위 프로세스 = `nodes.parent_node_id` 자기참조 FK 하나. 스코프 = `(version_id, parent_node_id)` 가상 캔버스 (`backend/app/models.py:78-83`).
- 엣지엔 `parent_node_id` 없음 → source 노드의 스코프로 암묵 귀속 (`backend/app/models.py:90-105`, `graph.py replace_graph`).
- `has_children`는 파생값(자식 행 존재 여부, `graph.py`). 빈 자식 맵은 `has_children=false`.
- `GET /versions/{id}/graph/all`(`getFullGraph`) = 전체 평면 트리, 버전당 1회. 이번 기능의 **자식 데이터 단일 소스**.
- 스코프별 저장 = `PUT /versions/{id}/graph?parent=<id>` (`saveGraph`, `api.ts:240`), 해당 스코프만 upsert+부분교체.

## 4. 아키텍처

### 4.1 상태 (page.tsx)

- 신규 `expandedInline: Set<string>` — 캔버스에 인라인 펼쳐진 노드 id 집합. `expandedOutline`(아웃라인 전용, `page.tsx:293`)과 **분리**. 스코프/버전 전환 시 초기화.
- 자식 데이터 소스: 기존 `fullGraph`(`page.tsx:292`). 추가 fetch 없음.
- 펼친 자식 노드/엣지는 **현재 `nodes`/`edges` state에 로드**하되 각 노드 `data.scopeId = parent_node_id`로 태그(현재 스코프 노드는 `scopeId = currentParentId`). → 모든 기존 편집 동작(이동/삭제/라벨/색)이 자동으로 작동.

### 4.2 렌더 파이프라인 (파생 — raw state 비오염)

ReactFlow에 넘기는 건 raw state가 아니라 파생 useMemo (`displayNodes:2533`, `styledEdges:2545`). 여기에 합성:
- **A→B 숨김**: 현재 스코프 엣지 중 `source === 펼친P`인 엣지에 `hidden:true` 부여(state 유지, 데이터 보존).
- **게이트웨이 view-edge**(합성, id 접두 `gw:`): 펼친 P마다 `P → 각 Start`(진입), `각 End → P의 후속 T`(복귀). state/저장 비포함, 레이아웃 입력엔 포함.
  - 기본 스타일: 흐림(opacity ~0.25, dashed). P 서브트리 노드 선택 시 강조(opacity ~0.9) — step 4 "하위 컴포넌트 선택 시 투명도를 높여 가시화".
- **경계 엣지**(자식↔외부 기타): 선택 시 opacity 상향.

### 4.3 레이아웃

펼침/접기 토글 시 1회: `layoutWithDagre(병합노드, 병합엣지)`.
- 레이아웃 입력 엣지 = `현재+자식 state 엣지 − 숨긴 A→B + 게이트웨이`. A→B를 입력에서 빼야 자식이 P와 B 사이 rank에 끼어듦.
- `rankdir:"LR"` 그대로. 옵션 변경 없음.
- 펼침/접기는 **비-dirty**(autosave 트리거 안 함). 매 펼침 시 재레이아웃(일관). 자식의 구조 편집만 dirty → scope-split 저장.

### 4.4 저장 (scope-split)

`saveCurrentScope`(`page.tsx:449-491`) 확장:
- state 노드/엣지를 `data.scopeId`로 그룹핑 → 스코프별 payload 생성 → 각 스코프에 `saveGraph(versionId, scopeId, payload)` PUT.
- 게이트웨이(`gw:`)·숨긴 플래그는 직렬화 제외(데이터 아님). 숨긴 A→B는 현재 스코프 payload에 **포함**(실데이터).
- dirty 추적도 스코프별(어느 스코프가 바뀌었는지)로 좁혀 불필요한 PUT 방지.

### 4.5 접기

`collapse(P)`: P 서브트리 스코프로 태그된 노드/엣지를 state에서 제거 + `expandedInline`에서 제외. 변경 없으면 저장 불요(편집분은 이미 autosave됨).

## 5. 동작 스펙

### 5.1 펼치기/접기 (step 2·4)
- 노드의 펼침 토글(기존 `DrillButton` 자리, `process-node.tsx:172`) → `expandedInline` 추가/제거 → 4.1~4.3 수행.
- 펼치면 B 등 오른쪽 노드가 오른쪽으로 밀림(dagre 처리, 상하 위치는 dagre 결정 — 의도된 동작 아님).
- 여러 개 동시 펼침 허용. 중첩 펼침(자식의 자식) 재귀 지원.

### 5.2 펼침 상태·로딩 (step 5)
- 재로딩 시 **모두 접힘**으로 시작(`expandedInline` 초기 빈 Set).
- 데이터는 메모리(`fullGraph`)에서 — 펼침/접힘 반복해도 **재요청 없음**(D2).
- **[모두 펼치기]/[모두 접기]** 버튼(브레드크럼/Panel 영역, `page.tsx:3060-3071` 인근 또는 ReactFlow `<Panel>`).
  - 모두 펼치기 = `fullGraph`의 모든 `has_children` 노드를 캡 한도 내에서 펼침. 메모리 작업이라 네트워크 진행률 불필요. 단 **렌더 안전장치**: 캡 초과 예상 시 펼치기 전 확인 모달, 대량 시 일괄 setState 1회로.

### 5.3 캡 (step 5, D3)
- `frontend/src/lib/expansion-config.ts`: `EXPANSION_LIMITS = { maxNodes: 300, maxDepth: 5 }` (단일 export, 주석에 "추후 /admin 서버값으로 교체" seam).
- 펼치기/모두펼치기 전 예상 인라인 노드 수 > `maxNodes` 또는 펼침 깊이 > `maxDepth` → 확인 모달.

## 6. 하위 프로세스 불변식 (step 3)

불변식: 하위는 **Start ≥ 1, End ≥ 1, 작업 ≥ 1**. Start=상위 진입 통로, End=상위 복귀 통로.

### 6.1 생성 (자동 생성)
- 진입: 노드 컨텍스트 메뉴 "Create subprocess"(기존 `ctx.openChild`, `page.tsx:2424` 대체). process 노드(자식 없음)만.
- **후속 없음 검사**: 현재 스코프에 `source === 노드`인 엣지가 없으면 모달 **[취소] / [화면에서 노드 선택] / [End 생성]**.
  - 화면에서 노드 선택 → 사용자가 후속 노드 클릭 → `노드→선택노드` 엣지 생성(현재 스코프) → 진행.
  - End 생성 → 현재 스코프에 End 노드 + `노드→End` 엣지 생성 → 진행.
- **진행**: 자식 스코프 payload `{Start, 작업×1, End}` + 엣지 `Start→작업→End` 구성 → `saveGraph(versionId, 노드id, payload)` → `refreshFullGraph()` → 노드 `has_children=true` → 자동 인라인 펼침.

### 6.2 삭제 검사
- 시점: 노드/엣지 삭제 시마다(`handleNodesDelete:1645` + 엣지 삭제 경로).
- 삭제 후 영향받는 자식 스코프에서 Start/End/작업 중 하나라도 0 → **확인 모달**("하위 전체를 삭제하고 해당 노드를 일반 노드로 되돌립니다").
  - 확인: 그 스코프 전체 비우기(`saveGraph(versionId, 스코프id, 빈 그래프)` → 백엔드가 서브트리 cascade 삭제) → 부모 노드 `has_children=false`(일반 노드 복귀) → 인라인 접기.
  - 취소: 삭제 취소(ReactFlow 낙관적 삭제를 되돌림 — `onBeforeDelete` 가드 또는 삭제 후 복원).

## 7. ScopeWindow 제거 맵 (step 6, D4)

**남김(AI 의존)**: `scope-window.tsx`, `window-store.ts`, `window-dock.tsx`(AI 창 최소화 복원), AI 블록 `page.tsx:3699-3719`, `aiDefaultGeom:1059`, `windowGeom` state.

**제거(드릴인 전용, 펼침으로 대체 후)**:
- `scopes.map` ScopeWindow 루프 `page.tsx:3296-3502`
- `handleDrillIn:1085`, `handleDrillById:1114`, `handleOpenSummaryChild:1124`, `focusScope:1135`, `closeScope:1166`
- `defaultGeom:1052`(cascade), `bringToFront:1066` + `zOrder` state `:283`
- 드릴인 컨텍스트 메뉴/인스펙터 진입점(`:2425`, `onDrill:2770`), WindowDock 드릴인 칩 분기 `:3503-3508,3521-3526`
- **유지**: `navigateTo:1071`(버전전환·검색·아웃라인 공용 — 삭제 금지), 브레드크럼/아웃라인 별도 검토.

## 8. 검증

- 백엔드: 변경 없음 → 기존 `pytest`, `ruff` 회귀 없음만 확인.
- 프론트: **프론트 단위 테스트 하네스 없음**(vitest/jest 미설치) → 게이트 = `tsc`·`eslint`·`next build` green + 수동 캔버스 검증. (가이드라인: 테스트 하네스 없으면 날조 금지, 수동 검증 명시.)
  - 신규 순수 로직은 `lib/inline-expand.ts`로 추출(page.tsx 비대화 방지 + 추후 하네스 도입 시 단위테스트 가능).
- 수동 검증 시나리오: 펼침/접힘 LR 정렬, A→B 숨김+복원, 게이트웨이 표시, 다중·중첩 펼침, 모두펼치기 캡 모달, 생성 자동생성, 후속없음 모달, 삭제 불변식 모달, AI 채팅 정상.

## 9. 범위 외

- Mermaid import/export(다음 작업). 흐름축 LR이라 추후 `flowchart LR` 1:1 매핑 염두.

## 10. 확인 요청 사항

1. **편집성 모델(D6)** — 펼친 자식을 인라인에서 편집(scope-split 저장)하는 방향이 맞는지. (대안: 보기 전용 + 별도 편집 진입)
2. **단일 plan vs 2 PR 분할** — 본 계획은 단일 phased plan(앱이 각 단계에서 동작 유지, 창 제거는 마지막). 분할 선호 시 알려주실 것.
3. 위 7장 제거 범위 중 **브레드크럼/아웃라인 계층 UI** 존치 여부(인라인과 중복 가능).

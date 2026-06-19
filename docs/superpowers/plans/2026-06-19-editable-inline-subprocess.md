# 인라인 하위 프로세스 편집 가능화 — merge-into-state 리팩터 계획

> 배경: 펼친 자식이 prop-only(파생 레이어)라 React Flow가 노드 이벤트·입력 이벤트를 라우팅하지 않음(브라우저 실측 확정). 이동/연결/추가/삭제/인라인편집을 바깥 캔버스처럼 하려면 자식을 진짜 RF-관리 state 노드로 합쳐야 한다.

## 2026-06-19 1차 시도 결과 (검증된 학습 — 다음 시도에 반영)
- **검증됨**: 자식을 RF-관리 state(`useNodesState`)에 넣으면 RF가 측정→**노드 이벤트(클릭/선택/드래그) 발화함**. 표시도 baseline과 픽셀 동일하게 유지 가능(buildScope는 현재 스코프만 입력, displayNodes가 state 자식으로 치환). 저장도 자식 제외 필터로 root 무오염·위치 보존 확인.
- **실패/철회**: 자식을 **메인 `nodes` state에 합치는** 방식은 blast radius가 너무 넓다 — `nodes`=현재스코프를 가정하는 거의 모든 곳(아웃라인, 모달 편집 라우팅 `handleSummaryPatch/LabelCommit`, `renameNode`, `startRename`, `onNodeClick/DoubleClick`, 인스펙터, **자식 스코프 debounce flush 저장**)이 깨진다. 라우팅을 `isMaterializedChild`로 다 고쳐도 flush 저장이 안 돼(원인 미해결) 모달 편집이 깨졌고, 시간상 안전히 통합 불가 → 1차 시도 reset.
- **다음 시도 권장 — 별도 `childNodes` state**: 메인 `nodes`는 현재 스코프 그대로 두고(=모든 기존 가정 유지·회귀 0), 자식은 **별도 `childNodes`** state(역시 RF가 측정하도록 displayNodes에 포함 + 커스텀 `onNodesChange`로 변경분을 nodes/childNodes로 분배). 이러면 아웃라인·저장·라우팅 등 `nodes` consumer를 전혀 안 건드린다(narrow blast radius). 자식 편집 저장만 scope-split로 별도 처리. 관련: [[inline-child-nodes-reactflow-gotcha]].

## 진행 상황 (별도 childNodes 방식 — 채택)
- **Step 1 완료** (`faadd96`): 별도 `childNodes` state + materialize effect(펼친 부모의 자식 추가/제거) + displayNodes가 파생 자식을 childNodes 객체로 치환 + 커스텀 `handleNodesChange`(변경분 nodes/childNodes 분배) + 중첩 접힘 정리. **검증: 표시 픽셀 동일(단일·중첩), 자식 클릭→선택(이벤트 발화), 모달 자식 편집 저장 정상(회귀 0), 아웃라인 깨끗, 죽은 입력 0.**
- **Step 2 완료** (`e9c4ae0`): 자식 `deletable:true` + Delete 시 `saveChildScopeAfterDelete`(getGraph→삭제 노드/엣지 제거→PUT, 그룹 보존) + fullGraph 낙관적 제거(materialize 재생성 방지). **검증: s-doc 선택+Delete → 화면 제거 + r-review 스코프 영속.** (테스트 중 `git checkout dev.db`가 실행 중 백엔드를 readonly로 만드는 함정 주의 — 백엔드 재시작 필요.)
- **Step 3 이동(드래그) 완료** (`0f3776b`): buildScope가 자식을 dagre 재배치 대신 **저장된 pos_x/pos_y 사용**(드래그 영속·인라인=드릴인 일관) + `childTop`을 세로중심→**앵커 상단정렬**(단일행 초기표시 동일, 세로 드래그 재중심화 튐 제거) + `draggingChildIds`(드래그 중 childNodes 절대위치) + `onNodeDragStart`(자식이면 childNodes를 파생위치로 맞춰 점프 방지+플래그) + `onNodeDragStop`(절대→스코프상대 = childNodes.pos − `inlineComposition.childOffsets`, fullGraph 낙관적 갱신, 자식 스코프 PUT). **검증: 단일·중첩 이동·영속(접기/재펼침 포함), 튐 없음, 초기 단일행 표시 동일, 모달·삭제 회귀 0.**
- **Step 4 연결(엣지) 완료** (`33c0bbd`): 펼침 중 `nodesConnectable` 켜고(전역) 현재 스코프(프레임) 노드는 `connectable:false`로 막아 **자식만 연결**. `onConnect`가 같은 자식 스코프 연결을 `createChildEdge`로 라우팅 — fullGraph에 낙관적 추가(buildScope.childEdges로 즉시 렌더) + 자식 스코프 PUT(노드/그룹 보존). **검증: 자식↔자식 연결 즉시 렌더(8→9) + 자식 스코프 영속, root 무오염, 드래그 회귀 0.** 함정: Playwright 연결 드롭은 정밀도가 매우 flaky(여러 번 재시도해야 착지) — 핸들 박스 중심으로 mousedown→중간점→타겟 핸들 패턴.
- **Step 5 추가 완료** (`bc3cad5`): 펼침 중 영역 빈 공간 우클릭→노드타입 선택 시 그 자식 스코프에 추가. `handleAddNode`가 클릭 x를 포함하는 가장 깊은 region 탐지(`inlineComposition` regions, TDZ 회피 위해 `inlineCompositionRef`로 읽음) → region offset(`scopeOffsets`)으로 스코프상대 변환 → `addChildNode`(fullGraph 낙관적 추가→materialize 렌더 + 자식 스코프 PUT). region 밖 클릭은 기존 현재 스코프 추가. **검증: 새 노드 즉시 렌더(9→10) 클릭 위치에 + 자식 스코프 영속(4→5).** 인라인 이름편집은 자식 in-node 입력 커밋 불안정 → 모달 유지.

## 캔버스/UX 항목
- **캔버스 좌상단 고정 완료** (`87feada`): `contentExtent`(패닝/노드 범위)를 대칭 `EXTENT_MARGIN`(600) → 비대칭(좌상단 `EXTENT_TOPLEFT_MARGIN`=120, 우하단 600). 위/왼쪽 무한 패닝 방지, 아래/오른쪽 성장 여유. 검증: pan-up이 상단 경계에서 정지.
- **하위영역 드롭존 — 미완(진단 기록, 큰 작업)**: 메인 캔버스 드롭존(`handleNodeDrag` 탐지 + `handleZoneDrop` 적용: swap/placeBeside/applyFlowEdges/충돌모달)은 현재 스코프 전용. 자식 적용 시 발견한 함정:
  1. `screenRectOf`가 `nodesRef.find`(현재 스코프)라 자식은 null → 링 위치 못 잡음. **수정: `reactFlow.getNode(id)`(표시 위치, 모든 렌더 노드)** 사용.
  2. `onNodeDrag`(handleNodeDrag)는 자식에도 발화함(테스트의 0은 **dev.db 오염**으로 드래그 자체가 안 된 것 — 깨끗하면 정상 83회 발화). nodesDraggable 변경 불필요.
  3. **`reactFlow.getIntersectingNodes(node)`가 자식엔 항상 빈 결과**(RF 내부 — displayNodes swap 자식은 internal positionAbsolute 누락 추정) → 타겟 미탐지 → 링 안 뜸. **수동 형제 겹침 판정 필요**(dragged child rect vs 같은 scopeId 형제들의 getNode rect).
  4. 적용: `onNodeDragStop` 자식 분기가 dropTarget 있으면 zone op을 **자식 스코프**에 적용+저장해야. swap(두 자식 위치 교환+저장)·insert(위치+자식스코프 엣지 재배선 via getGraph→변형→PUT)·충돌모달. 엣지 재배선이 가장 큼. 수백 줄 규모 → 단계별(탐지+swap 먼저, insert 후속) 권장.

## 좌표·저장 모델 (핵심 결정)
- **자식 = 진짜 state 노드.** `nodes` state에 `data.scopeId = 부모 id`로 태그, materialize 시점에 영역 위치로 배치.
- **현재 스코프 노드는 state 원위치 유지, 화면 shift만 derived.** 펼침으로 다운스트림이 밀리는 건 표시 전용 → 현재 스코프 저장 오염 없음.
- **저장 = scopeId별 분리 PUT**(`buildScopedGraphs`). 현재 스코프 노드는 원위치, 자식은 자기 스코프 좌표(영역 원점 기준 정규화).
- **접힘 = state에서 자식 제거**(저장은 이미 반영됨).

## displayNodes 파생 (화면)
- `nodes` state를 scopeId로 분리: 현재 스코프(=currentParentId/undefined) vs 자식(=펼친 id의 후손).
- 현재 스코프 다운스트림 노드: 자식 영역 footprint만큼 우측 shift (derived).
- 자식: state 위치 그대로.
- 영역(레인)·게이트웨이: 자식 state 위치에서 파생.

## 단계 (각 단계 브라우저 검증, 개별 커밋)
- **1a (foundation)**: 펼침 시 자식을 state로 materialize + 파생 합성 재작성(현재 스코프 shift/영역/게이트웨이) + scope-split 저장 + 접힘 정리. **화면은 현재와 픽셀 동일**해야 함(회귀 0 — baseline 스크린샷 대조). 편집은 아직 비활성(현 동작 유지).
- **1b**: 자식 드래그(이동) 활성 — 네이티브 RF 드래그가 자식 state 갱신, scope-split 저장. 현재 스코프 노드는 펼침 중 비드래그 유지.
- **1c**: 자식 인라인 이름편집 — 자식이 진짜 노드라 in-node 입력 이벤트 정상 커밋. capture-listener의 모달 가로채기를 타이틀 제외하도록 조정.
- **2**: 자식 구역 내 노드 추가·엣지 연결 — 스코프 판정(추가=커서가 든 영역, 엣지=양 끝 스코프). #1(좌표) 해소.
- **3**: 자식 삭제 — 네이티브, 불변식 검사 재사용.
- (후속) 중첩 펼침 편집, childEdits 오버레이 제거(자식이 진짜 노드라 불필요).

## 회귀 방지 가드
- 1a 후 펼침 화면이 baseline과 동일(레인·자식·shift·애니메이션·줌 불변·휠).
- 저장: 현재 스코프 PUT가 자식을 포함하지 않고, 자식 PUT가 자기 스코프만.
- 접힘 후 현재 스코프 노드 원위치 복귀.
- undo/redo·autosave dirty 정상.

# 인라인 하위 프로세스 편집 가능화 — merge-into-state 리팩터 계획

> 배경: 펼친 자식이 prop-only(파생 레이어)라 React Flow가 노드 이벤트·입력 이벤트를 라우팅하지 않음(브라우저 실측 확정). 이동/연결/추가/삭제/인라인편집을 바깥 캔버스처럼 하려면 자식을 진짜 RF-관리 state 노드로 합쳐야 한다.

## 2026-06-19 1차 시도 결과 (검증된 학습 — 다음 시도에 반영)
- **검증됨**: 자식을 RF-관리 state(`useNodesState`)에 넣으면 RF가 측정→**노드 이벤트(클릭/선택/드래그) 발화함**. 표시도 baseline과 픽셀 동일하게 유지 가능(buildScope는 현재 스코프만 입력, displayNodes가 state 자식으로 치환). 저장도 자식 제외 필터로 root 무오염·위치 보존 확인.
- **실패/철회**: 자식을 **메인 `nodes` state에 합치는** 방식은 blast radius가 너무 넓다 — `nodes`=현재스코프를 가정하는 거의 모든 곳(아웃라인, 모달 편집 라우팅 `handleSummaryPatch/LabelCommit`, `renameNode`, `startRename`, `onNodeClick/DoubleClick`, 인스펙터, **자식 스코프 debounce flush 저장**)이 깨진다. 라우팅을 `isMaterializedChild`로 다 고쳐도 flush 저장이 안 돼(원인 미해결) 모달 편집이 깨졌고, 시간상 안전히 통합 불가 → 1차 시도 reset.
- **다음 시도 권장 — 별도 `childNodes` state**: 메인 `nodes`는 현재 스코프 그대로 두고(=모든 기존 가정 유지·회귀 0), 자식은 **별도 `childNodes`** state(역시 RF가 측정하도록 displayNodes에 포함 + 커스텀 `onNodesChange`로 변경분을 nodes/childNodes로 분배). 이러면 아웃라인·저장·라우팅 등 `nodes` consumer를 전혀 안 건드린다(narrow blast radius). 자식 편집 저장만 scope-split로 별도 처리. 관련: [[inline-child-nodes-reactflow-gotcha]].

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

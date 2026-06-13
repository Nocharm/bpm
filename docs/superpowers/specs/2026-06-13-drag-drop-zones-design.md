# 드래그-오버 영역 선택 (앞/뒤/그룹) — 디자인 스펙

> 작성일 2026-06-13 · 선행 브랜치 `feat/whimsical-design`(미머지) 위에서 진행
> 노드를 다른 노드 위로 드래그해 머무르면 대상이 확장되며 드롭 영역(앞/뒤/그룹)을 제시한다.

## 목표

드래그 중인 노드 A를 노드 B 위에 **머무르게(dwell)** 하면 B가 가로로 확장되며 3개 드롭 영역이
펼쳐진다. 드롭을 **놓는 영역**으로 동작이 결정된다:
- **앞** — A를 B의 선행 단계로 흐름에 삽입
- **그룹** — A·B를 보이는 그룹 박스(부서/담당자 업무 묶음)로 묶음
- **뒤** — A를 B의 후행 단계로 흐름에 삽입

## 확정 결정 (브레인스토밍)

| 항목 | 결정 |
|---|---|
| 선택 방식 | 확장된 B 위의 **영역(zone)에 드롭하는 위치**로 앞/뒤/그룹 결정 |
| 앞/뒤 의미 | **흐름(엣지) 삽입**. 해당 방향에 기존 엣지가 있으면 **유지/삽입 되묻기** 팝오버 |
| 그룹 의미 | 계층(drill-in) 아님 — **부서/담당자 업무 묶음**, 보이는 컨테이너 박스 |
| 그룹 렌더 | **배경 사각형 오버레이** — 멤버 bounding box로 자동 산정, 노드 절대좌표 유지 |
| 구현 순서 | **2단계 분할** — Phase 1 프론트(인터랙션+앞/뒤), Phase 2 풀스택(그룹) |
| 겹침 처리 | zone 위 드롭=동작 실행, 그 외 빈 곳 겹침=기존 `resolveCollision` 폴백 |

---

## Phase 1 — 프론트엔드 인터랙션 (백엔드 변경 없음)

### 대상 파일
- `frontend/src/app/maps/[mapId]/page.tsx` — 드래그 추적·zone 상태·동작 디스패치
- `frontend/src/lib/canvas.ts` — 흐름 삽입 순수 함수(테스트 대상)
- `frontend/src/components/drop-zones.tsx` *(신규)* — 확장 영역 오버레이
- `frontend/src/components/keep-insert-popover.tsx` *(신규)* — 유지/삽입 되묻기
- `frontend/src/app/globals.css` — zone 확장 키프레임

### 인터랙션 흐름
1. **교차 감지** — `onNodeDrag`에서 `getIntersectingNodes(draggedNode)`로 A 아래 노드 B 산정(A 제외, 최상위 1개).
2. **Dwell 판정** — 같은 B를 `DWELL_MS`(300ms) 이상 연속 hover 시 `dropTarget=B.id` 활성. B가 바뀌거나 벗어나면 타이머 리셋.
3. **영역 표시** — `dropTarget` 활성 시 B 화면 위치(`reactFlow.flowToScreenPosition` 또는 측정 좌표)에 오버레이를 캔버스 컨테이너 좌표로 렌더. 좌=앞 / 중앙=그룹 / 우=뒤. CSS로 가로 확장(`ease-overshoot`, ~200ms, reduced-motion 가드).
4. **활성 영역** — 드래그가 영역 위를 지날 때 커서(=A 중심) 위치로 활성 zone 하이라이트.
5. **드롭(`onNodeDragStop`)** — 활성 zone 있으면 해당 동작, 없으면 `resolveCollision` 폴백. ESC/영역 밖이면 취소→폴백.

### 앞/뒤 흐름 삽입 (canvas.ts 순수 함수)
- **앞**: `getIncomingEdges(edges, B)` 존재 시 → 유지/삽입 되묻기. 삽입=기존 `X→B`를 `X→A`로 재연결 후 `A→B` 추가. 유지=`A→B`만 추가. 없으면 `A→B`만 추가.
- **뒤**: 대칭 — `getOutgoingEdges(edges, B)` 기준. 삽입=`B→Y`를 `A→Y`로, `B→A` 추가. 유지=`B→A`만.
- A 위치: B 좌/우로 인접 배치(그리드 스냅) 후 `resolveCollision`로 타 노드 겹침 회피.
- 신규 함수: `getIncomingEdges`, `getOutgoingEdges`, `insertNodeBefore(nodes, edges, aId, bId, rewire)`, `insertNodeAfter(...)` — 히스토리 1스냅샷·자동저장 대상.

### 되묻기 팝오버
- 충돌 시 드롭 지점에 팝오버: "유지(연결 추가만)" / "삽입(중간에 끼우기)". 선택 전까지 동작 보류. 상태 `pending: { mode, aId, bId } | null`.

### Phase 1 검증
- canvas.ts 삽입 함수 단위 테스트(유지/삽입/엣지 없음 3케이스).
- tsc/eslint/build green. 수동: dwell 확장·zone 드롭·되묻기·취소 폴백(로컬 Windows).

---

## Phase 2 — 그룹 (풀스택)

### 백엔드 (`backend/`)
- `groups` 테이블: `id`(str, 클라 생성), `version_id` FK(CASCADE), `parent_node_id`(스코프, nullable), `label`, `color`. pos/size는 **저장 안 함**(멤버 bbox로 파생; 멤버 0이면 그룹 삭제).
- `nodes.group_id`: nullable, `ForeignKey("groups.id", ondelete="SET NULL")`.
- 스키마: `GroupIn`/`GroupOut`, `GraphOut.groups: list[GroupOut]`, `NodeOut.group_id`. `GraphIn`(PUT)은 groups upsert + node.group_id 반영 — 스코프(version, parent) 단위 교체.
- 버전 복제: groups 신규 id 발급 + node.group_id 리맵.
- 테스트: 그룹 라운드트립, 멤버십, 복제 계승, 멤버 0 정리.

### 프론트엔드
- `Graph` 타입에 `groups`, `NodeData.groupId` 추가.
- **그룹 박스 렌더**: 각 그룹의 멤버 노드 bounding box(+패딩)로 사각형 산정. React Flow 노드 타입 `group`으로 bbox 위치·크기에 렌더, `zIndex` 최하·파스텔 fill(`color-mix`)+라벨. 멤버 이동 시 재산정. `parentId` 미사용(절대좌표 유지).
- 그룹 박스 드래그 → 멤버 노드 일괄 이동(onNodeDrag로 델타 전파).
- **그룹 zone 동작**: B가 그룹 소속이면 A를 그 그룹에 추가, 아니면 신규 그룹 `{B, A}` 생성(라벨 기본=B의 department/assignee 또는 빈값→사용자 편집).
- 멤버 추가: 기존 그룹 박스 위로 드롭 시 합류. 제거: 박스 밖으로 드래그 시 `group_id=null`, 멤버<1이면 그룹 삭제.
- 비교 화면: 그룹 박스는 읽기 전용 표시(diff는 범위 외 — 후속).

### Phase 2 검증
- 백엔드 pytest(그룹 CRUD·복제·정리), ruff.
- 프론트 tsc/eslint/build. 수동: 그룹 생성·합류·이탈·박스 이동·영속(새로고침 후 유지).

---

## 비범위 (YAGNI)

- 그룹 중첩(그룹 안의 그룹), 그룹 간 엣지 — 미지원.
- 그룹 diff 하이라이트(비교 화면) — 후속 과제.
- 스웜레인/자동 부서 배치 — 미채택(보이는 박스 방식 확정).
- React Flow `parentId`/`extent` 기반 멤버십 — 기존 위치 로직 보존 위해 미채택.

## 열린 후조정 포인트
- DWELL_MS(300ms), 확장 애니메이션 길이는 체감 후 조정.
- 그룹 라벨 기본값 규칙(부서 자동 vs 빈값)은 Phase 2 착수 시 확정.

# 캔버스 UX 정제 4종 — 설계 (2026-06-14)

브랜치: `feat/canvas-ux`. 직전 커밋(캔버스 4종 UI/UX)에 이어지는 사용성 정제 작업.

대상 파일(주):
- `frontend/src/components/scope-window.tsx`
- `frontend/src/app/maps/[mapId]/page.tsx`
- 신규 `frontend/src/components/window-dock.tsx`
- 신규 `frontend/src/components/node-summary-modal.tsx`
- `frontend/src/lib/i18n.tsx`(키 추가), `frontend/src/app/globals.css`(고스트/모달 모션 필요 시)

데이터/검증 경계 변경 없음 — 순수 프론트엔드. 기존 API(`listComments`/`createComment`, `getFullGraph`) 재사용.

---

## #1 최소화 → 좌하단 taskbar(dock) 스택

### 현재
`ScopeWindow`는 `geom.minimized`일 때 제자리에서 본문/리사이즈를 숨기고 타이틀바만 남긴다(`scope-window.tsx:185`, `196`). 여러 창을 최소화하면 각자 원위치에 흩어진 타이틀바로 남아 산만하다.

### 변경
- 최소화된 창은 제자리 렌더를 멈춘다.
- 캔버스 영역 **좌하단**에 dock을 두고, 최소화된 창마다 작은 칩(제목 + 복원 동작)을 가로로 쌓는다.
- 칩 클릭 → 해당 창 `minimized=false` + 최상단 포커스(`bringToFront`).
- 루트(chromeless) 창은 최소화 버튼이 없으므로 dock 대상이 아니다.

### 구현
- 신규 `window-dock.tsx`: `{ items: {key, title}[], onRestore(key) }` 받는 presentational 컴포넌트. 좌하단 `absolute` 배치, 칩은 `text-fine` 컴팩트(디자인 룰 밀도 준수), Lucide 아이콘(예: `Square`/복원).
- `page.tsx`: ScopeWindow 매핑 시 `geom.minimized`인 항목을 분리해 dock으로 보내고, 펼친 창만 `ScopeWindow`로 렌더.
- `ScopeWindow`: 최소화 내부 분기(타이틀바만 남기던 렌더) 제거 — 항상 펼친 창. 최소화 버튼은 유지하되 동작은 `geom.minimized=true`로 두고 실제 표현은 page+dock이 담당.

### 접근 비교
- **A (채택)**: dock 레이아웃/스택 순서를 page가 소유. 단일 출처라 z-order·복원 일관.
- B: ScopeWindow가 portal로 자기 칩 렌더 → 분산되어 스택 순서·정렬 관리가 번거로움.

---

## #2 아웃라인 새로고침 — 고스트 유지 + refetch 절감

### 증상
스코프 상/하 전환 시 아웃라인 목록이 사라졌다 다시 뜬다. 매 전환·저장마다 `refreshFullGraph`가 재요청되어, 서버 부하 시 깜빡임이 길어져 UX를 크게 해친다.

### 원인(가설)
`outline` useMemo는 라이브 `nodes`(현재 스코프)에 fullGraph의 타 스코프 노드를 합쳐 전체 트리를 만든다(`page.tsx:1779–1827`). 스코프 전환 순간 라이브 `nodes`가 잠깐 비고/교체되며 현재 스코프 행이 사라졌다가, 비동기 refetch가 끝나야 다시 채워진다. `setFullGraph`는 새 데이터로만 호출되고 null로 비우진 않으므로(=303), 깜빡임의 주원인은 라이브 nodes 공백 구간 + 과도한 refetch다.

### 변경
1. **비파괴 표시(고스트):** 전환 중 직전 아웃라인을 빈 목록으로 떨구지 않는다. 데이터 공백 구간에는 직전 결과를 유지하되 살짝 dim(고스트) 처리해 "갱신 중"임만 약하게 알린다.
2. **refetch 절감:** 스코프 전환만으로는 refetch하지 않는다(fullGraph에 이미 전체 트리 존재). `refreshFullGraph`는 저장 성공 후에만 호출하고, 동일 시점 중복 호출을 디듀프한다.
3. **in-place 갱신:** refetch가 도착해도 기존 행을 유지한 채 교체(언마운트→재마운트 회피, key 안정화).

### 구현 메모
- 구현 시 스코프 전환 경로(`page.tsx:575–619`)에서 라이브 nodes가 비는 구간을 확인하고, 아웃라인이 그 구간에 빈 트리를 만들지 않도록 직전 outline을 유지(예: 마지막 비어있지 않은 outline을 ref로 보관 후 공백이면 그것을 렌더).
- 고스트 시각은 `globals.css`에 약한 opacity 트랜지션으로. 새 모션 토큰 추가 없이 기존 duration/ease 사용.

---

## #3 더블클릭 → 서머리 모달 (연결 모드 제거)

### 제거
더블클릭=연결 일체를 제거한다:
- `onNodeDoubleClick`의 `setConnectSource`(`page.tsx:2148`).
- `connectSource` state, `completeConnect`, `onNodeClick`의 연결 완료 분기(2133), 상단 연결 배너(2000), `NodeActionsContext`의 `connectSource`/소스 링(process-node).
- 노드 연결은 **핸들 드래그(`onConnect`)만** 유지. (드래그 연결은 그대로 동작.)

### 추가
신규 `node-summary-modal.tsx`. 노드 더블클릭 시 해당 노드의 요약 모달을 연다. backdrop/바깥 클릭 또는 Esc로 닫힘. readOnly와 무관하게 열람 가능(작성 버튼은 readOnly 시 숨김).

### 모달 콘텐츠
- **전/후 단계:** 현재 스코프 엣지 기준 — 선행(`target===node.id`)·후행(`source===node.id`) 노드 제목 목록. 없으면 "없음".
- **하위 프로세스 이미지:** fullGraph에 `parent_node_id===node.id`인 자식이 있으면 기존 `ScopePreview(fullGraph, node.id)`를 고정 크기 썸네일로 렌더. 없으면 섹션 생략.
- **코멘트:** `listComments(versionId)` 중 `node_id===node.id`만 **읽기 전용 목록**(작성자·본문·해결여부). 모달 진입 시 1회 로드. 하단 "코멘트 추가" 버튼 → 인라인 textarea 펼침 → `createComment` 호출 후 목록 갱신. (별도 큰 모달 없이 인라인 입력으로 가볍게.)
- **추가 정보:** 노드 타입 라벨, 소속 그룹명(있으면).

### 구현 메모
- 모달은 page 레벨에서 `summaryNodeId` state로 제어. 더블클릭 핸들러가 `setSummaryNodeId(node.id)`.
- 콘텐츠 계산은 `nodes`/`edges`/`fullGraph`/`groups`에서 파생, 코멘트만 비동기 로드.
- 모달 elevation은 `--shadow-lg`(플로팅 오버레이), backdrop은 반투명. 디자인 룰 토큰만 사용.

---

## #4 드롭존 — 타일 적중 시에만 활성 + 링 넉넉히 유지

### 증상
dwell 후 커서 **방향**만으로 항상 zone(front/back/group/child)이 켜진다 — 조금만 움직여도 발동해 불편. 또 타일까지 커서를 옮기려 노드 겹침을 풀면 링이 사라진다.

### 변경
1. **타일 적중식 판정:** zone은 커서가 4개 타일 중 하나의 **hitbox 안**에 있을 때만 활성. 아니면 zone 없음(null).
2. **중립 드롭:** 드롭 시 활성 zone이 있으면 `handleZoneDrop`, 없으면 `resolveCollision`(그냥 겹쳐 밀어냄)과 동일.
3. **링 유지 강화:** 링/타일은 dwell 시 표시하되, 유지 경계를 타일 반경보다 충분히 크게(겹침 해제와 무관) 둬 커서를 타일로 옮겨도 사라지지 않게 한다. 커서가 바깥 경계를 벗어날 때만 해제.

### 구현 메모
- `handleNodeDrag`(현재 방향식 `activateZone`)을 타일 좌표 적중식으로 교체: dwell 대상 노드의 링 중심·반경으로 4타일 화면 좌표를 계산하고, 커서가 어느 타일 안인지로 `dropTarget.zone`을 설정(없으면 zone=null이되 dropTarget은 유지해 링은 표시).
- 유지 경계 = 타일 배치 반경 + 타일 크기 + 여유 마진(현재 `radius`는 타일 위치와 같아 경계가 타일에 붙어 있는 문제 → 경계를 더 키움).
- `onNodeDragStop`: `dropTargetRef.current?.zone`이 있으면 드롭 적용, 없으면 collision. 그룹 박스 합류(`groupDropTargetRef`)는 기존 우선순위 유지.

---

## 검증
- `npm run lint` clean, `npm run build`(TypeScript) green.
- 인터랙션(최소화 dock, 아웃라인 무깜빡임, 모달, 드롭존 타일 적중)은 원격이라 로컬(Windows) `npm run dev` 수동 확인 필요 — 각 항목 체크 시나리오를 PROGRESS에 남긴다.

## 비목표 (YAGNI)
- 모달에서 노드 편집/이동/삭제 — 요약·코멘트 추가만.
- dock의 드래그 재정렬·핀 — 단순 칩 스택만.
- 아웃라인의 낙관적 동시편집 — 고스트는 단일 사용자 전환 깜빡임 해소용.

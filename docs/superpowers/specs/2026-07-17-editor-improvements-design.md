# 편집 모드 개선 5종 — 설계 스펙

- 날짜: 2026-07-17
- 브랜치: `worktree-editor-improvements` (dev 기준, 워크트리 `.claude/worktrees/editor-improvements`)
- 주 파일: `frontend/src/app/maps/[mapId]/page.tsx`(8,622줄), `frontend/src/lib/canvas.ts`, `frontend/src/components/process-library-panel.tsx`, 기능 2·3에 한해 `backend/app/`
- 대상 노드 타입(`lib/canvas.ts:80`): `process`(일반) · `decision`(분기) · `start` · `end` · `subprocess`(Call Activity 링크)

## 목표

에디터(편집 모드)의 생산성·일관성을 높이는 독립적 개선 5종. 각 기능은 개별 검증 가능하며 순차 구현한다.

---

## 기능 1 — 노드 복사 / 붙여넣기 / Ctrl+드래그 복제

### 동작 명세
- **복사 대상:** `process` · `decision` · `end`. **제외:** `start`(싱글턴), `subprocess`(링크 유일성, 기능 2와 충돌 회피).
- **Ctrl+C:** 현재 선택된 노드 중 복사 가능한 것 + **그 노드들 사이의 엣지**(양 끝이 모두 복사 대상에 포함된 엣지)만 클립보드에 저장.
  - 선택에 복사 가능 노드가 하나도 없으면(예: start/subprocess만) → 저장 안 함 + 토스트 *"이 노드는 복사할 수 없습니다 — 일반·분기·끝만 가능"*.
  - 일부만 가능하면 가능한 것만 담고, 제외된 게 있으면 토스트로 안내.
- **Ctrl+V:** 클립보드 노드를 새 `genId()`로 재생성.
  - 위치: **같은 맵**에 붙여넣으면 원본 대비 `(+16,+16)` 오프셋 → `findFreeSpot`(page.tsx:2990)로 충돌 회피. **다른 맵**이면 현재 뷰포트 중앙 기준으로 상대 배치 유지.
  - 내부 엣지도 새 `genId()`로 재생성하되 source/target을 새 노드 id로 재매핑.
  - 라벨은 아래 "이름 규칙" 적용. 붙여넣은 노드를 선택 상태로 + flash(`bpm-node-flash`) + `scheduleAutoSave`. 반복 붙여넣기 시 오프셋 누적.
- **Ctrl+드래그(복제):** 노드 드래그 시작 시 Ctrl/⌘가 눌려 있으면:
  - 복사 가능 노드 → **원본은 시작 위치에 그대로 남고**, 사본이 포인터를 따라 이동해 드롭 위치에 놓임(결과: 원본 위치 + 드롭 위치 = 2개).
  - **복사 불가 노드(start·subprocess) → 차단하지 않고 평소처럼 이동**시키되 토스트로 안내(복제본만 생성 안 됨, 아래 시각 피드백도 없음).
  - 다중선택에 복사 가능/불가가 섞여 있으면: 가능한 노드만 복제, 나머지는 이동, 제외분이 있으면 토스트.
  - **시각 피드백(복제 모드 가시화):**
    - 드래그 중 **원본 위치에 반투명 잔상(ghost, 예: `opacity 0.4` + dashed 테두리)** 를 표시해 "여기에 사본이 남는다"를 미리 보여줌 → 드롭 시 그 자리에 실제 노드로 확정.
    - **끌려가는 노드(포인터 근처)에 `+` 배지/아이콘**(Lucide `Plus` 또는 `CopyPlus`, 16px)을 붙여 복제 모드임을 명시. 일반 이동(Ctrl 미포함) 및 복사 불가 노드에는 표시하지 않음.
    - 구현: `ctrlDragActive`/`ctrlDragGhosts`(포지션+데이터) 상태로 잔상 오버레이 렌더, 드래그 노드엔 `NodeActionsContext` 또는 transient className으로 `+` 배지 토글. `keyup`으로 Ctrl 해제 시 잔상·배지 즉시 제거(이동 모드로 전환).
- **이름 규칙(`(n)` 증분):** 원본 라벨 말미의 `" (n)"` 접미를 먼저 제거해 base를 구한 뒤, 현재 맵의 기존 라벨 집합에 대해 다음 빈 번호 부여.
  - `"새 단계 (2)"` 복사 → `"새 단계 (3)"`, `"새 단계"` 복사 → `"새 단계 (2)"`.
  - 앱 전역 규칙과 동일한 공백 포함 `" (n)"` 형식. 기존 `makeUniqueLabel`(`canvas.ts:481-496`)을 base-strip과 함께 재사용(신규 헬퍼 `stripCopySuffix` 또는 인라인).

### 클립보드 저장소 — `localStorage`
- 인메모리 ref 대신 **`localStorage`**(키 예: `bpm.nodeClipboard`)에 `{ nodes, edges, sourceMapId }` JSON 저장.
  - 근거: 같은 탭뿐 아니라 **다른 탭 / 다른 맵**으로 붙여넣기 지원(사용자 요구). `localStorage`는 평문 HTTP(원격 IP) secure-context 제약 밖(Web Crypto만 제약) → 서버에서도 동작.
  - 저장 payload는 렌더 파생 필드(`subEnds`·`locked`·`spDepartment` 등) 제외, 영속 데이터(label·nodeType·position·BPM/파라미터 필드·color·url 등)만. 크기 상한(예: 노드 200개) 두어 과대 payload 방지.

### 주요 삽입 지점
- 키보드: 조합키 핸들러 `page.tsx:6178`(Ctrl/⌘ 분기)에 `event.code === "KeyC"`/`"KeyV"` 추가. 입력창·모달 가드는 기존(`page.tsx:6140-6156`) 활용.
- 붙여넣기 생성 모델: `handleAddNode`(`page.tsx:3017-3115`) 흐름(pushHistory→genId→findFreeSpot→setNodes→select→autosave→flash) 재사용.
- Ctrl+드래그: `onNodeDragStart`(`page.tsx:6858`)에서 `event`의 ctrl/meta 감지 후 복제본 삽입. 다중은 `onSelectionDragStart`(`page.tsx:6889`).
- 복사 가능 판정 헬퍼: `isCopyableNodeType(nodeType)` 신설(`canvas.ts`) = `type in {process, decision, end}`.

### 엣지 케이스
- 그룹 소속(`groupIds`) 노드 복사: 붙여넣은 노드는 `groupIds: []`(그룹 미소속)로 생성(단순화). 그룹 전체 복제는 범위 밖.
- 복사한 원본이 삭제/변경된 뒤 붙여넣기: `localStorage` payload는 자립적이므로 그대로 재생성 가능.

---

## 기능 2 — 서브프로세스 링크 유일성

### 동작 명세
- **불변식:** 한 맵 안에서 같은 대상 맵(`linked_map_id`)은 **한 번만** 링크 가능.
- **FE(1차, 요구 문구 그대로):** 라이브러리 picker(`process-library-panel.tsx`)에서 **현재 맵에 이미 링크된 맵 행을 자동 비활성** + 사유 툴팁("이미 이 맵에 링크됨"). 기존 `blocked` 플래그(`:102-103`, 현재는 self-map + cycle)를 확장.
  - 패널에 현재 맵의 링크 집합을 전달해야 함 → props에 `linkedMapIds: Set<number>` 추가(현재 props는 `currentMapId`+`onClose`뿐).
  - 두 번째 진입 경로인 맵 드롭다운 "링크노드로 추가"(`addLinkNodeFromMap`, `page.tsx:3711-3762`)도 동일 차단(이미 링크된 맵이면 토스트).
- **백엔드(2차, 방어 — 사용자 승인):** graph PUT 업서트(`graph.py:274-276`)에서 같은 맵을 2개 이상 노드가 링크하면 **422 거부**. 기존 cycle 검사(`subprocess.py:119-144 assert_no_cycle`) 옆에 중복 링크 검사 추가.

### 엣지 케이스
- 링크 집합 계산: 현재 맵의 노드 중 `nodeType==="subprocess" && linkedMapId!=null`의 `linkedMapId` 모음. 자기 자신(편집 중 노드)의 링크는 재지정 시 제외.
- 복사 경로로 인한 우회 없음(기능 1에서 subprocess는 복사 제외).

---

## 기능 3 — 서브프로세스 설명 필드 + 등록 알림 ⚠️ 백엔드/DB 변경

### 설명 필드 `sp_description`
- **DB:** `ProcessMap.sp_description: Text|None` 신설(`models.py:92-113` sp_* 블록). **`db._ADDED_COLUMNS`(`db.py:16`)에 등록 필수** → 서버 배포 시 자동 ALTER 보강(운영 DB 리셋 없음).
- **스키마:** `SubprocessDesignationIn`(`schemas.py:48-91`, optional 멀티라인, 정규화=trim) · `MapOut`(`:546-559`) · `SubprocessRefOut`(`:688-708`)에 필드 추가. `designate_subprocess`(`maps.py:542-581`) upsert에 반영.
- **FE 3표면(동시 이동 필수):**
  - 지정 모달 `subprocess-designation-modal.tsx`(`DesignationForm` `:19-29`) — 설명 textarea 입력.
  - 인스펙터 카드 `subprocess-inspector-card.tsx`(`attrRows` `:105-113`) — 설명 표시 행.
  - 설정 패널 `subprocess-designation-panel.tsx`(`:34-44,92-102,127-135`) — 필드 목록 동기화.
- **api.ts 타입:** `MapSummary`(`:35-71`) · `SubprocessDesignationBody`(`:289-300`) · `SubprocessRef`(`:137-149`)에 `sp_description` 추가.

### 등록 알림
- **트리거:** `designate_subprocess`에서 **최초 지정 전이 시에만**(`found_map.sp_designated_at is None`, `maps.py:566` 분기) 알림. 이후 속성 편집(재지정)은 알림 없음.
- **수신자:** 맵 오너(`found_map.owner_id`) + 활성 승인자(`load_active_approvers(session, map_id)`, `workflow.py:84-96`). **지정을 수행한 본인(actor)은 제외**(checkout.py 패턴 준용, dedup).
- **호출:** `create_notifications(session, recipients, type="subprocess_registered", map_id=..., message=...)`(`workflow.py:45-81`, commit은 기존 `maps.py:579`에서). 메시지 예: `"'{맵 이름}'이(가) 서브프로세스로 등록되었습니다"`(동적 데이터라 한글 허용).
- **FE:** 벨(`notification-bell.tsx`)은 `message` 제네릭 렌더라 **무변경**. inbox 필터용으로 `notification-categories.ts:12-25`에 `subprocess_registered → subprocess` 카테고리 매핑 + `inbox.cat.subprocess` i18n 키 + inbox 아이콘 추가.

### 엣지 케이스
- 지정에 published 버전 필요(기존 409 가드 유지). 알림은 지정 성공 후에만.
- 승인자 0명·오너=actor면 수신자 비어 알림 미발송(정상).

---

## 기능 4 — Shift 드래그 축 고정

### 동작 명세
- 노드 드래그 중 **Shift가 눌려 있으면** 시작점 대비 이동량이 큰 축만 남기고 작은 축은 시작값으로 고정(수평 또는 수직 잠금).
- **적용 범위:** 단일 노드 드래그 · 다중선택 드래그 · 그룹 이동. 임베드(자식) 노드는 읽기전용이라 제외.

### 구현
- `shiftHeldRef`(ref)를 window `keydown`/`keyup`으로 갱신 — **`keyup` 리스너는 현재 없음 → 신설**.
- 좌표 확정 지점에서 축 고정 적용:
  - 일반(비확장) 경로: `handleNodesChange`/`dropDraggingPositions`(`page.tsx:1301-1334`)에서 position change의 좌표를 시작점(`dragStartPosRef`, `page.tsx:6860`) 기준으로 보정.
  - 다중선택 경로: `onSelectionDrag`(`page.tsx:6893-6908`)의 `dragLiveById` 기록 시 각 노드에 동일 델타-기반 축 고정(`dragStartOffsetRef`, `page.tsx:928`).
- 축 결정: `abs(dx) >= abs(dy)` → 수평 잠금(dy=0), 아니면 수직 잠금(dx=0). 기준은 드래그 시작점 대비 누적 델타.
- **RF 키 충돌 회피:** `selectionKeyCode`(기본 Shift=선택박스, pane) / `multiSelectionKeyCode`를 명시 설정해 노드 드래그 중 Shift와 겹치지 않게. 축 고정은 "활성 노드 드래그 중"에만 발동 → shift-click 선택추가와 공존.
- `snapToGrid`/`snapGrid[8,8]`(`page.tsx:6789-6790`) 유지 — 고정 축도 그리드 스냅.

---

## 기능 5 — SP 목록 접근 확대 + 검색 UX

### 접근 경로 추가
- **캔버스 빈 화면 우클릭 메뉴 맨 아래:** pane 컨텍스트 메뉴(`menuItems`, pane 분기 `page.tsx:4537`, 항목 `:4554-4566`)의 정렬·내보내기(`moreItem` `:4565`) **아래**에 구분선 + "서브프로세스 목록 열기"(Network 아이콘) 항목 추가 → `setLibraryOpen(true)`.
- **전역 단축키 `S`(수정자 없음):** 조합키 핸들러 B(`page.tsx:6137`)에 `event.code === "KeyS"` && no-modifier 바인딩 → `setLibraryOpen(true)`. 입력창·모달 가드는 기존 활용. 컨텍스트 메뉴가 열려 있을 땐 중복 방지(`if (menu) return`) — align 서브메뉴가 accel `s`를 쓰기 때문.
  - 확인됨: 3개 window keydown 리스너 어디에도 bare `S` 미바인딩(자유).

### 자동 포커스
- 패널은 열릴 때마다 새로 마운트(`{libraryOpen && <ProcessLibraryPanel .../>}`, `page.tsx:6717-6722`)되므로, 검색 input(`process-library-panel.tsx:80-90`)에 `useRef` + mount `useEffect(() => ref.current?.focus(), [])` 추가 → 기존 3경로(툴바 Network `page.tsx:6579` · ＋메뉴 `:6659` · 인스펙터 `:8255`) + 신규 2경로(우클릭·`S`) 모두 자동 포커스.

### 검색 엔진 향상
- 현재: `query`(`:20`) → `.includes`(이름만, `:38-42`).
- 변경: 공용 **`filterByQuery`**(`lib/search.ts:203`, `SearchSelect` 등과 동일 — 부분일치 + 한글 초성 + 로마자 초성 + 순차 매칭 + 랭킹)로 교체.
  - `filterByQuery(rows, query, (r) => [{ field: "name", text: r.name }, { field: "department", text: r.department }])` → `hits.map(h => h.item)`. **이름 + 부서** 검색.
  - `useInfiniteSlice`(이미 import `:10`)는 `SearchHit<T>[]` 수용 → 그대로 사용.

---

## 검증 계획

- **백엔드 pytest(TDD):** 기능 2 중복 링크 거부(422), 기능 3 `sp_description` 왕복 + 최초 지정 알림 생성(수신자=오너+승인자, actor 제외)·재지정 무알림.
  - 실행: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`(`.env` 존재 시 그린 전제).
- **프론트 vitest:** 라벨 `(n)` 증분·복사 가능 판정·클립보드 직렬화·picker 비활성 계산·축 고정 좌표 계산·`filterByQuery` 적용.
- **Playwright 실기동(서버/원격 IP 또는 dev):** Ctrl+C/V(같은 맵·다른 탭)·Ctrl+드래그(가능/불가)·Shift 축 고정(단일·다중)·토스트·우클릭 메뉴·`S`·자동포커스·초성 검색.
- **배포:** `sp_description` 자동 ALTER 보강 확인.

## 구현 순서 (독립 태스크)

1. **기능 4**(Shift 축 고정) — page.tsx 국소, 리스크 낮음.
2. **기능 1**(복사/붙여넣기/Ctrl드래그) — page.tsx + canvas.ts + localStorage.
3. **기능 5**(SP 목록 접근+검색) — 컨텍스트 메뉴·단축키·패널.
4. **기능 2**(링크 유일성) — FE picker + 백엔드 가드.
5. **기능 3**(SP 설명 + 알림) — 백엔드 컬럼/스키마/알림 + FE 3표면.

## 범위 밖 (YAGNI)

- 그룹 통째 복제, 크로스맵 서브프로세스 링크 복사, OS 클립보드 연동, 축 고정 각도 스냅(45°) 등은 이번 범위 밖.

# 에디터 UI 개선 — 사이드바·컨텍스트 메뉴·단축키 레전드 설계 스펙

> 작성일 2026-06-13 · 브랜치 `feat/editor-ui` (`feat/drop-zones` 위)
> 과밀한 헤더를 정리하고 좌/우 사이드바·구분된 컨텍스트 메뉴·단축키 레전드로 사용 편의성 개선.

## 확정 결정 (브레인스토밍)

| 항목 | 결정 |
|---|---|
| 좌 사이드바 | 3섹션 — Insert 팔레트 + Arrange 도구 + Outline(현재 스코프 트리) |
| 우 인스펙터 | 기존 조건부 aside를 **상시 패널**로 + 폭 조절(드래그) + 숨기기 |
| 컨텍스트 메뉴 | 기존 기능 편입 + `divider`로 기능별 구분 |
| 레전드 | 우하단 `?` 버튼 / `?` 키 토글, 반투명 패널 |

## 변경 대상

| 파일 | 변경 |
|---|---|
| `frontend/src/components/editor-left-sidebar.tsx` *(신규)* | Insert/Arrange/Outline 좌측 패널 |
| `frontend/src/components/shortcut-legend.tsx` *(신규)* | 반투명 단축키 안내 + 토글 |
| `frontend/src/components/context-menu.tsx` | `divider` 항목 타입 추가 |
| `frontend/src/app/maps/[mapId]/page.tsx` | 레이아웃 3분할, 핸들러 배선, 인스펙터 상시화·폭조절·숨김, 메뉴 항목 그룹화, 레전드 토글, `?` 키 |
| `frontend/src/lib/i18n-messages.ts` | 신규 키(en/ko) |

## ① 좌측 사이드바 (`editor-left-sidebar.tsx`)

세로 스택, 접기 가능(헤더 토글 또는 패널 → 버튼). 읽기전용 시 편집 액션 비활성.

- **Insert**: 타입 버튼 4종(start/process/decision/end) → `addNodeOfType(type)`가 뷰포트 중앙에 노드 생성. 색 프리셋(`COLOR_PRESETS`) 한 줄 → 선택 노드 색 즉시 변경(미선택 시 비활성).
- **Arrange**: 자동배치(`layoutWithDagre`)·왼쪽/위 정렬(`alignSelected`)·가로/세로 분배(`distributeSelected`). 헤더에서 이동.
- **Outline**: 현재 스코프 노드 목록(타입 아이콘 + 제목). 클릭 → 선택 + `fitView`로 센터. `hasChildren`이면 드릴 버튼(기존 `handleDrillIn` 재사용). *전 계층 트리는 범위 외 — 현재 스코프 한정.*

props: `{ readOnly, onAddType, onRecolor, onAutoLayout, onAlign, onDistribute, nodes(요약), selectedId, onSelectNode, onDrill, collapsed, onToggle }`.

## ② 우측 인스펙터 (page.tsx 내 기존 aside 통합·상시화)

- 상시 표시. 분기: 노드 선택→속성(제목·설명·타입·색·담당자/부서/시스템/기간·그룹·코멘트), 엣지 선택→라벨, 미선택→맵 이름·버전·노드 수 요약 + 그룹 목록.
- **폭 조절**: 좌측 가장자리 드래그 핸들. `inspectorWidth` 상태(기본 320, 220~480 clamp), `localStorage("bpm.inspectorWidth")` 영속.
- **숨기기**: `inspectorOpen` 상태 + 헤더 토글 버튼. 숨기면 캔버스가 확장.
- 기존 노드/엣지 편집 핸들러(`updateSelectedData` 등) 그대로 사용 — 동작 불변, 컨테이너만 변경.

## ③ 컨텍스트 메뉴 (`context-menu.tsx`)

`ContextMenuItem`에 구분선 추가: `{ divider: true }` 형태(또는 `type:"divider"`). 렌더 시 `<hr class="my-1 border-divider">`. 기존 항목은 `{label,onSelect,...}` 유지.

분류:
- **빈 캔버스**: 노드 추가 ┄ 자동배치·왼쪽정렬·위정렬·가로분배·세로분배 ┄ PNG 내보내기
- **노드**: 하위 열기 ┄ 삭제(danger)
- **엣지**: 라벨 편집 ┄ 삭제(danger)

## ④ 단축키 레전드 (`shortcut-legend.tsx`)

- 우하단 고정 `?` 아이콘 버튼(`HelpCircle`). 클릭 또는 `?`(Shift+/) 키로 토글. Esc 닫기.
- 패널: `bg-surface/85 backdrop-blur`, `shadow-lg`, 반투명. 항목(라벨+키):
  실행취소 `Ctrl+Z` / 재실행 `Ctrl+⇧Z` / 검색 `Ctrl+K` / 팬 `Space+드래그` / 박스선택 `드래그` / 연결 `더블클릭` / 그룹·앞·뒤 `노드 위 머무르기` / 삭제 `Del` / 취소 `Esc`.
- 입력 필드 포커스 중 `?`는 무시(기존 keydown 가드 패턴 따름).

## 헤더 (정리 후)

뒤로 · 검색 · 브레드크럼 · 저장상태 · 버전(새/이름/삭제/비교) · undo/redo · PNG · 저장 · 인스펙터 토글. (Arrange·노드추가는 좌측 이동.)

## 레이아웃

`<div flex flex-1>` = `[LeftSidebar][canvas flex-1 bg-canvas][Inspector(resizable)]`. 좌·우 접힘 시 캔버스가 남는 공간 차지. 단축키 레전드는 캔버스 컨테이너 우하단 absolute.

## 검증

- tsc / eslint / `next build` green.
- 수동(로컬): 좌 팔레트로 타입별 추가, Arrange 동작, Outline 클릭 센터·드릴, 인스펙터 폭조절·숨김, 컨텍스트 메뉴 구분선·동작, `?` 레전드 토글. 비교 화면 회귀 없음.

## 비범위 (YAGNI)

- 전 계층(스코프 교차) 아웃라인 트리 — 현재 스코프 한정.
- 좌측 팔레트 드래그-드롭 배치(현재 버튼 클릭=중앙 생성).
- 인스펙터 폭/사이드바 상태의 서버 영속(로컬 only).
- 컨텍스트 메뉴 신규 기능 추가(기존 기능 편입·분류만).

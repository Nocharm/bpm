# 설계 — 맵 에디터 · 비교화면 재디자인 (제자리 리스타일 + 컴포넌트 대체)

> 브랜치 `feat/editor-compare-redesign` (main 미머지). 작성 2026-06-28 (제자리 방식으로 개정).
> 마스터 트래커 `SCREEN-REDESIGN-EDITOR.md`(루트), 구현 단계 `docs/superpowers/plans/2026-06-28-editor-compare-redesign.md`, 커밋 로그 `PROGRESS.md`.
> 참고 목업: `docs/superpowers/specs/assets/editor-compare-redesign/` (18장).

## 1. 한 줄 요약

맵 **에디터 화면**과 **버전 비교화면**을 hifi 목업 기준으로 재디자인한다. **기존 에디터(`frontend/src/app/maps/[mapId]/page.tsx`, ~6724줄)의 동작을 전부 보존**한 채, 영역을 하나씩 **깨끗한 컴포넌트로 추출·교체하며 새 디자인을 입힌다**(제자리 리스타일). 제로베이스 리라이트가 아니다 — 단축키·애니메이션·내비게이션·드롭존·스코프·undo/autosave 등 수년치 검증된 인터랙션을 다시 구현하다 누락하는 위험을 피하기 위함.

## 2. 접근 결정 (개정)

이전 세션에서 "병렬 `/v2` 제로베이스" 안을 잡았으나, **"기존 동작 전부 보존"이 핵심 요건**임이 분명해져 폐기했다(`/v2` 스캐폴드 제거 — 커밋 `f25eaf6`). "같은 동작, 새 디자인"의 정석은 리라이트가 아니라 **제자리 리스타일**이다.

| # | 결정 | 값 |
|---|------|-----|
| D1 | 구현 전략 | **제자리 리스타일 + 컴포넌트 추출**(기존 page.tsx를 영역단위로 교체). `/v2` 병렬 라우트·컷오버 폐기 |
| D2 | 캔버스 엔진 | **불가침** — ReactFlow props/children(`5653–5927`)·드래그/드롭존·좌표/스코프·dagre 그대로 |
| D3 | AI 어시스턴트 | 이번 범위 — `AiChatPanel` 재스타일·연결(R10) |
| D4 | 비교화면 "To-Be 적용" | 에디터로 이동(단순 내비) — 백엔드 무변경 |
| D5 | 순서 | 에디터 먼저(R1~R11) → 비교 나중(C1~C3). 저위험·가시 우선 → 큰 구조변경으로 |

## 3. 비목표 (이번 범위 밖)
- 드롭존 8방향 중 4 추후 확장(현행 4방향 유지).
- 백엔드/DB 스키마 변경(갭 발견 시 작업 전 사용자 확인).
- "To-Be 적용"의 병합/복제(내비만).
- 서버 docker-compose 배포 검증(머지 전 별도).

## 4. 기존 에디터 구조 지도 (page.tsx ~6724줄)

제자리 작업의 토대. 영역별 인라인/컴포넌트 + 동작 위치.

### 4.1 영역 (JSX)
| 영역 | 위치 | 형태 |
|------|------|------|
| 상단바 | `5341–5559` | **인라인**(검색·undo/redo·라이브러리·인스펙터·AI·저장·상태배지) |
| 좌측 사이드바 | `5572–5594` | 컴포넌트 `EditorLeftSidebar` |
| 라이브러리 패널 | `5595–5600` | 컴포넌트 `ProcessLibraryPanel`(조건부) |
| 캔버스 | `5601–6191`(ReactFlow `5653–5927`) | **인라인 컨테이너** + ReactFlow(children: ViewportPortal·Background dots·Controls·`CanvasZoomScale`). **MiniMap 없음** |
| 우측 인스펙터 | `6195–6450` | **인라인**(노드/엣지 폼·`MapDetailCard`·`CommentSection`) |
| 하단 탭 | `6463–6603` | **인라인 탭바**(approval/version/download/design) + `WorkflowDashboard`·버전 select·PNG·엣지스타일 |
| 플로팅 오버레이 | `6613–6712` | 컴포넌트(edge 모달들·Group*·NodeSummary·ContextMenu·ShortcutLegend·AiChatPanel·ToastStack 등) |

### 4.2 이미 추출된 컴포넌트 (재스타일 대상)
`EditorLeftSidebar`·`ProcessLibraryPanel`·`CanvasZoomScale`·`ContextMenu`·`CommentSection`·`WorkflowDashboard`·`ApproverManager`·`AiChatPanel`·`EdgeBranchModal`·`EdgeActionModal`·`EdgeSelectModal`·`EdgeDecisionModal`·`GroupBox`·`GroupTitleBar`·`GroupBulkModal`·`NodeSummaryModal`·`ScopeWindow`·`ScopePreview`·`MapDetailCard`·`ShortcutLegend`·`Tooltip`·`ProcessNode`.

### 4.3 추출 필요 (인라인 → 신규 컴포넌트)
상단바 → `EditorTopbar`(+`MapNameDropdown`·`VersionPill`) · 우측 인스펙터+하단 탭 → `InspectorPanel`(+`TabProperties`/`TabMap`/`TabApproval`/`TabActivity`) · ＋노드 메뉴 → `AddNodeMenu`.

## 5. 보존 불변식 (전 단위 — 깨뜨리면 회귀)
동작 위치(page.tsx): 키보드 핸들러 `1425–1460` · 아웃라인 내비 `4924–5301` · undo/redo `1180–1232` · autosave `1036–1079`(2s) · 포커스 카메라/드릴 `5675–5683` · 펼침 애니 `.bpm-expand-anim`(350ms) · 컨텍스트 메뉴 `openMenu` · **ReactFlow props/children `5653–5927`**(snapToGrid·isValidConnection·onConnect·onNodeContextMenu 등). 체크아웃 잠금·읽기전용(뷰어/체크아웃/비-draft) 게이팅도 보존.

제약: LF · `genId()`(crypto.randomUUID 금지) · 디자인 토큰만(raw hex 금지; 노드 color·COLOR_PRESETS·PNG 배경은 데이터/출력 예외) · UI 영어/데이터 한글 · Lucide 16px/1.5 · 버튼 커서·눌림은 전역 base(컴포넌트엔 hover 배경만) · 호버 힌트·툴팁 유실 금지 · KST(`formatKst`) · React Compiler 수동메모 불일치 빌드실패 주의(trivial 핸들러는 plain 함수) · **백엔드/DB 스키마 변경 사전 확인**.

## 6. 구현 단위 (영역 R1~R11 + 비교 C1~C3)

상세 표·이미지·순서는 트래커 `SCREEN-REDESIGN-EDITOR.md`. 요약:

- **R1 캔버스 크롬** — MiniMap(좌하) 추가 + 줌 pill(하단중앙) 재스타일. `editor-overview.png`
- **R2 노드 비주얼** — 테두리 `#6e84a3`·셀렉션 링·도형. `process-node.tsx`. `inspector-properties-node.png`
- **R3 상단바** — 브레드크럼·맵네임 드롭다운·버전 pill·저장·undo/redo·＋/AI/공유/저장·토글 → `EditorTopbar` 추출. `editor-overview.png`·`topbar-mapname-dropdown.png`
- **R4 좌측 사이드바** — ＋노드 메뉴·정렬도구·단축키 카드(맥락 반응)·검색·아웃라인. `topbar-add-node-menu.png`
- **R5a~d 우측 인스펙터 4탭** — 인라인 인스펙터+하단탭 → `InspectorPanel`(속성/맵/승인/활동). `inspector-*.png`
- **R6 컨텍스트 메뉴** — 캔버스/노드/엣지/분기/그룹. `context-*.png`
- **R7 노드 편집 모달** — 더블클릭(드릴 충돌 정리). `group-context-and-node-modal.png`
- **R8 그룹** — 박스·타이틀바·일괄편집. `group-bulk-edit.png`
- **R9 기타 모달/오버레이** — edge 모달들·요약 등 토큰 통일.
- **R10 AI 패널** — `ai-chat-panel.png`
- **R11 드롭존** — 라디얼 링. `dropzone.png`
- **C1~C3 비교화면** — 셸·diff 캔버스·변경목록. `compare-screen.png`

## 7. 검증
- 단위별: `tsc` 0 · `eslint` 0 (+해당 시 `vitest`) → `/maps/{id}`(:3000) 라이브 → **:3100 OLD 동작 대조**(연결/단축키/애니 보존 확인) → 단위 커밋.
- 호버/포커스 전용 UI는 JS로 상태 강제 후 스크린샷(lessons `browser-verification`).
- 컷오버 개념 없음(제자리라 항상 동작). 머지 전 backend `pytest` 0(무변경 확인)·서버 배포 검증.

## 8. 리스크
- **R5 인스펙터 추출**이 최대 — 인라인 폼/탭 배선을 보존하며 통합. 단계 분할(R5a~d).
- **R7 더블클릭**: 현재 드릴 동작과 새 편집 모달 충돌 → 착수 시 결정(보존 원칙상 드릴 유지 방향).
- 추출 시 호버 힌트·툴팁·단축키 표시 등 부수동작 유실 주의(메모리 `refactor-preserve-secondary-behaviors`).

# 편집기 · 비교화면 재디자인 — 계획 · 검토 트래커 (단일)

목업(`docs/superpowers/specs/assets/editor-compare-redesign/`, 18장) 기준으로 **맵 에디터·버전 비교화면**을 재디자인. 브랜치 `feat/editor-compare-redesign`.
**방식: 제자리 리스타일 + 컴포넌트 대체** — 기존 에디터(`frontend/src/app/maps/[mapId]/page.tsx`, ~6724줄)의 **동작은 전부 보존**하고, 영역을 하나씩 깨끗한 컴포넌트로 **추출·교체하며 새 디자인 적용**. 제로베이스 리라이트 아님(동작 누락 위험 회피).
**작업 표준**: 영역(R) 단위로 분할 · 단위별 커밋 · 검토 직전 시현 데이터 세팅 · 이 표를 계속 갱신 · :3100 OLD와 동작 대조. 설계는 `docs/superpowers/specs/2026-06-28-editor-compare-redesign-design.md`, 구현 단계는 `docs/superpowers/plans/2026-06-28-editor-compare-redesign.md`.

## 검토 환경
| 로컬 | 브랜치 | URL |
|------|--------|-----|
| NEW | feat/editor-compare-redesign | http://localhost:3000/maps/{id} |
| OLD | main(워크트리 bpm-baseline) | http://localhost:3100/maps/{id} |
| backend | 공유 | :8000 (`AUTH_ENABLED=false DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.kim`) |

**시현 권한**: 편집 화면은 owner/editor(예: admin.kim), 뷰어 화면은 공개맵 viewer(user.lee)로 dev-login.

검증=tsc/lint(+해당 시 vitest) · 시현=브라우저(NEW ↔ OLD 대조) · 검토결과: ✅OK / 🔧수정→반영 / ⏳미정 / ⏸보류.

## 보존 불변식 (전 단위 공통 — 깨뜨리면 회귀)
기존 동작을 옮길 때 유실 금지. 위치(page.tsx 기준):
- 키보드 핸들러 `1425–1460`(Cmd+K·Esc·Cmd+Z/Y) · 아웃라인 내비 `4924–5301`(Tab/⇧Tab/Enter/Esc) · undo/redo `1180–1232` · autosave `1036–1079`(2s 디바운스) · 포커스 카메라/드릴 `5675–5683` · 펼침 애니 `.bpm-expand-anim`(350ms) · 컨텍스트 메뉴 `openMenu` · **ReactFlow props/children `5653–5927`**(snapToGrid·isValidConnection·onConnect 등) · 체크아웃 잠금·읽기전용(뷰어/비-draft) 게이팅.
- 제약: LF · `genId()`(crypto.randomUUID 금지) · 디자인 토큰만(raw hex 금지) · UI 영어/데이터 한글 · Lucide 16px/1.5 · 호버 힌트·툴팁 유실 금지 · 백엔드/DB 스키마 변경은 사전 확인.

## 마스터 표

| ID | 화면 | 단위 / 내용 | 검증 | 시현 | 검토결과 | 커밋 |
|----|------|-------------|------|------|---------|------|
| R1 | 캔버스 크롬 | **미니맵 추가(좌하)** + **줌 pill 재스타일**(하단중앙 `- 100% +`·전체화면). `<MiniMap>` ReactFlow children에 추가·`canvas-zoom-scale.tsx` 목업화. 이미지 `editor-overview.png` | tsc/lint✅ | ✅ | ✅ OK(줌 pill · 미니맵: 흰 배경·노드 실색 톤다운·뷰포트 악센트 채움 오버레이) | R1+ |
| R2 | 노드 비주얼 | 프로세스 테두리 `#909098`→**`#6e84a3`(slate, E3)** · **셀렉션 링을 노드간 슬라이드 인디케이터로(E4)** — `node-ring-selected`(2px accent+4px 12% 헤일로) + `node-selection-ring.tsx`(ViewportPortal 추종·단일선택 슬라이드·드래그 즉시추종·다중선택 노드별·시작끝 알약/그외 사각). `process-node.tsx`·`globals.css`. 이미지 `inspector-properties-node.png` | tsc/lint✅ | ✅ | ✅ OK(E3 테두리·E4 슬라이드 승인) | R2 |
| R3 | 상단바 | 상단바 제자리 재스타일 — **맵네임 드롭다운**(검색·최근맵·**private 필터**·호버/클릭 하위메뉴[맵열기·링크노드추가]·**확인모달**)·`>` 구분자·**버전 pill**(상태배지·확인모달)·저장상태·undo/redo·라이브러리·AI·저장·인스펙터(ghost). **편집 아닐 때 이동모달 생략**, 모달=`ConfirmDialog` 리치 폼 통일(유저그룹/맵삭제 동일). `MapNameDropdown`·`VersionPill` 추출 + `addLinkNodeFromMap`. 공유·전체화면 보류. 이미지 `editor-overview.png`·`topbar-mapname-dropdown.png` | tsc/lint✅ | ✅자가 | ⏳검토대기 | R3 |
| R4 | 좌측 사이드바 + **편집 툴바** | **R4a 편집 툴바(두 번째 상단바)** — 노드/정렬은 사이드바가 아니라 **메인 상단바 아래 둘째 바**에 편집기능 위주로, **편집모드(!readOnly)일 때만**. `editor-toolbar.tsx`: **＋Node 메뉴**(`add-node-menu`: 프로세스/판단/시작끝/하위프로세스→라이브러리)·**Auto layout**(dagre)·**정렬 4 + 분배 2**(기존 핸들러 재사용). page.tsx 헤더 아래 게이팅 배치. **R4b 노드 검색 이전 완료**(상단바→사이드바 아웃라인 위, `node-search.tsx`·`searchSlot` 주입·Cmd+K 보존). **남은 R4**: 단축키 카드(맥락 반응)·아웃라인 재스타일. `editor-left-sidebar.tsx`. 이미지 `topbar-add-node-menu.png`·`editor-overview.png` · 병렬 브랜치 `feat/editor-r4-left-sidebar`(R3 검토 병행) | R4a·R4b tsc/lint✅ | ✅자가 | ⏳ R4a·R4b 검토대기·단축키/아웃라인 후속 | R4a·R4b |
| R5a | 우측 인스펙터 | **탭 바(속성/맵/승인/활동) + 속성 탭**(빈상태·노드·엣지). `inspectorTab` 상태·접힘 시 재오픈 탭·폭 330. `InspectorPanel`+`TabProperties` 추출, page.tsx `6195–6450` 폼 배선 보존. 이미지 `inspector-properties-empty/node/edge.png` | — | — | ⏳ | — |
| R5b | 우측 인스펙터 | **맵 탭** — 가시성·소유자/협업자 카드·설명·노드 표시정보 토글·엣지 스타일(하단 design 탭에서 이동)·PNG. 기존 `MapDetailCard`·design/download 탭 배선 통합. 이미지 `inspector-map-tab.png` | — | — | ⏳ | — |
| R5c | 우측 인스펙터 | **승인 탭** — `WorkflowDashboard`를 하단 탭→상단 탭 승격(stepper·승인자·요청). 배선 보존. 이미지 `inspector-approval-tab.png` | — | — | ⏳ | — |
| R5d | 우측 인스펙터 | **활동 탭** — `CommentSection`(코멘트/답글/해결) + 버전 타임라인(현재/검토중/승인됨/게시됨·비교/복원) 통합. version 탭 배선 이동. 이미지 `inspector-activity-tab.png` | — | — | ⏳ | — |
| R6 | 컨텍스트 메뉴 | 캔버스/노드/엣지/분기엣지/그룹 메뉴 재스타일. `context-menu.tsx`(openMenu 로직 보존). 이미지 `context-canvas/node/edge/branch-edge.png`·`group-context-and-node-modal.png` | — | — | ⏳ | — |
| R7 | 노드 편집 모달 | 더블클릭 편집 모달(제목/설명/유형/색상/선행·후행/Esc·⌘S). ⚠️ **현재 더블클릭=하위프로세스 드릴** → 충돌, 착수 시 사용자와 정리(일반 노드=모달·서브프로세스=드릴 등). 이미지 `group-context-and-node-modal.png`(모달부) | — | — | ⏳ | — |
| R8 | 그룹 | 그룹 박스·타이틀바·일괄편집(부서/담당자)·색상. `group-box`·`group-title-bar`·`group-bulk-modal` 재스타일. 이미지 `group-bulk-edit.png`·`group-context-and-node-modal.png` | — | — | ⏳ | — |
| R9 | 기타 모달/오버레이 | 엣지 모달들(branch/action/select/decision)·`NodeSummaryModal`·dialog 토큰 통일 재스타일. | — | — | ⏳ | — |
| R10 | AI 패널 | `AiChatPanel` 재스타일 — 헤더·스레드·**제안 카드(맵에 추가/미리보기)**·퀵칩·입력. 배선 보존. 이미지 `ai-chat-panel.png` | — | — | ⏳ | — |
| R11 | 드롭존 | 노드 위 드래그 시 **라디얼 링**(4방향 앞/뒤/그룹/스왑) + "이미 연결됨→유지/중간삽입" 재스타일. 기존 드롭/충돌/dwell 로직 보존. 이미지 `dropzone.png` | — | — | ⏳ | — |
| C1 | 비교화면 | 비교 셸 — BASE/TARGET 셀렉터·swap·내보내기·**To-Be 적용=에디터 내비**·범례. `compare/page.tsx` 크롬 재스타일. 이미지 `compare-screen.png` | — | — | ⏳ | — |
| C2 | 비교화면 | diff 캔버스 — `buildMergedGraph` 재사용 + 새 `ProcessNode` diff 스타일(추가 green·삭제 red 점선·변경 amber). 이미지 `compare-screen.png` | — | — | ⏳ | — |
| C3 | 비교화면 | 변경사항 패널 — 필터(전체/추가/삭제/변경)·항목 리스트·클릭 포커스. 이미지 `compare-screen.png` | — | — | ⏳ | — |

## 비고
- **진행 순서**(권장): R1 → R2 → R3 → R4 → R5a~d → R6 → R7 → R8 → R9 → R10 → R11 → C1~C3. 저위험·가시 우선 → 큰 구조변경(R5 인스펙터)으로.
- 각 R는 독립 커밋 + :3100 OLD 동작 대조 + 이 표 갱신. 호버/포커스 전용 UI는 JS 상태 강제 후 스크린샷 검증(lessons `browser-verification`).
- **R5(인스펙터 4탭)**가 최대 단위 — 인라인 우측 패널(`6195–6450`)+하단 탭(`6463–6603`)을 `InspectorPanel`로 통합 추출. 각 탭 콘텐츠는 기존 배선 보존.
- R7 더블클릭 충돌은 착수 시 결정 — 보존 원칙상 드릴 동작을 잃지 않는 방향.

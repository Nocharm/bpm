# 편집기 · 비교화면 재디자인 — 계획 · 검토 트래커 (단일)

목업(`docs/superpowers/specs/assets/editor-compare-redesign/`, 18장) 기준으로 **맵 에디터·버전 비교화면**을 재디자인. 브랜치 `feat/editor-compare-redesign`.
**방식: 제자리 리스타일 + 컴포넌트 대체** — 기존 에디터(`frontend/src/app/maps/[mapId]/page.tsx`, ~6724줄)의 **동작은 전부 보존**하고, 영역을 하나씩 깨끗한 컴포넌트로 **추출·교체하며 새 디자인 적용**. 제로베이스 리라이트 아님(동작 누락 위험 회피).
**작업 표준**: 영역(R) 단위로 분할 · 단위별 커밋 · 검토 직전 시현 데이터 세팅 · 이 표를 계속 갱신 · :3100 OLD와 동작 대조. 설계는 `docs/superpowers/specs/2026-06-28-editor-compare-redesign-design.md`, 구현 단계는 `docs/superpowers/plans/2026-06-28-editor-compare-redesign.md`.

## 검토 환경
R1~R5a는 `feat/editor-compare-redesign` → main 머지 후 브랜치 삭제. 이후 단위는 main에서 딴 `feat/editor-redesign-r{n}` 브랜치로 진행(현재 R6 = `feat/editor-redesign-r6`). OLD :3100 bpm-baseline 워크트리는 제거됨 — 대조는 main(=배포 기준)과 로컬 실행으로.

| 로컬 | 브랜치 | URL |
|------|--------|-----|
| NEW | feat/editor-redesign-r6 | http://localhost:3000/maps/{id} |
| backend | 공유 | :8000 (`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys`, backend/.env) |

**시현 권한**: dev 로그인은 하드코딩 5인 → **디렉터리 검색 피커**(시드 전면 재구성, sysadmin=`admin.sys`). 편집 화면은 owner/editor, 뷰어 화면은 공개맵 viewer로 dev-login.

검증=tsc/lint(+해당 시 vitest) · 시현=브라우저(NEW ↔ OLD 대조) · 검토결과: ✅OK / 🔧수정→반영 / ⏳미정 / ⏸보류.

## 보존 불변식 (전 단위 공통 — 깨뜨리면 회귀)
기존 동작을 옮길 때 유실 금지. 위치(page.tsx 기준):
- 키보드 핸들러 `1425–1460`(Cmd+K·Esc·Cmd+Z/Y) · 아웃라인 내비 `4924–5301`(Tab/⇧Tab/Enter/Esc) · undo/redo `1180–1232` · autosave `1036–1079`(2s 디바운스) · 포커스 카메라/드릴 `5675–5683` · 펼침 애니 `.bpm-expand-anim`(350ms) · 컨텍스트 메뉴 `openMenu` · **ReactFlow props/children `5653–5927`**(snapToGrid·isValidConnection·onConnect 등) · 체크아웃 잠금·읽기전용(뷰어/비-draft) 게이팅.
- 제약: LF · `genId()`(crypto.randomUUID 금지) · 디자인 토큰만(raw hex 금지) · UI 영어/데이터 한글 · Lucide 16px/1.5 · 호버 힌트·툴팁 유실 금지 · 백엔드/DB 스키마 변경은 사전 확인.

## 마스터 표

| ID | 화면 | 단위 / 내용 | 검증 | 시현 | 검토결과 | 커밋 |
|----|------|-------------|------|------|---------|------|
| R1 | 캔버스 크롬 | **미니맵 추가(좌하)** + **줌 pill 재스타일**(하단중앙 `- 100% +`·전체화면). `<MiniMap>` ReactFlow children에 추가·`canvas-zoom-scale.tsx` 목업화. 이미지 `editor-overview.png` | tsc/lint✅ | ✅ | ✅ OK(줌 pill · 미니맵: 흰 배경·노드 실색 톤다운·뷰포트 악센트 채움 오버레이 · 줌아웃 시 페이드아웃·최대 투명도 0.65 뒤 노드 비침·패널 z 보존으로 노드 위 유지+클릭 시점이동 유효 · 크기 187×105=16:9·높이 105) | R1+ |
| R2 | 노드 비주얼 | 프로세스 테두리 `#909098`→**`#6e84a3`(slate, E3)** · **셀렉션 링을 노드간 슬라이드 인디케이터로(E4)** — `node-ring-selected`(2px accent+4px 12% 헤일로) + `node-selection-ring.tsx`(ViewportPortal 추종·단일선택 슬라이드·드래그 즉시추종·다중선택 노드별·시작끝 알약/그외 사각). `process-node.tsx`·`globals.css`. 이미지 `inspector-properties-node.png` | tsc/lint✅ | ✅ | ✅ OK(E3 테두리·E4 슬라이드 승인) | R2 |
| R3 | 상단바 | 상단바 제자리 재스타일 — **맵네임 드롭다운**(검색·최근맵·**private 필터**·**클릭** 하위메뉴(1개씩)[맵열기·링크노드추가]·**확인모달**·**새맵=생성모달**)·`>` 구분자·**버전 pill**(상태배지·확인모달)·저장상태·undo/redo·라이브러리·AI·저장·인스펙터(ghost). **편집 아닐 때 이동모달 생략**, 모달=`ConfirmDialog` 리치 폼 통일(유저그룹/맵삭제 동일). `MapNameDropdown`·`VersionPill` 추출 + `addLinkNodeFromMap`. 공유·전체화면 보류. 이미지 `editor-overview.png`·`topbar-mapname-dropdown.png` | tsc/lint✅ | ✅ | ✅ OK | R3 |
| R4 | 좌측 사이드바 + **편집 툴바** | **R4a 편집 툴바(두 번째 상단바)** — 노드/정렬은 사이드바가 아니라 **메인 상단바 아래 둘째 바**에 편집기능 위주로, **편집모드(!readOnly)일 때만**. `editor-toolbar.tsx`: **＋Node 메뉴**(`add-node-menu`: 프로세스/판단/시작끝/하위프로세스→라이브러리)·**Auto layout**(dagre)·**정렬 4 + 분배 2**(기존 핸들러 재사용). page.tsx 헤더 아래 게이팅 배치. **R4b 노드 검색 이전 완료**(상단바→사이드바 아웃라인 위, `node-search.tsx`·`searchSlot` 주입·Cmd+K 보존). **R4c 단축키 카드**(↵편집·Del삭제 추가+Del 배선, 맥락 반응)·**아웃라인은 이미 일치**(선택 accent bg·터미널 ○·하위프로세스 ▽들여쓰기). **노드정보 카드 보존**(목업엔 없음→R5b 맵 탭 이전 예정). 추가 fix: 노드생성 겹침방지·페이드반짝·Auto layout 선택반응. `editor-left-sidebar.tsx`·`add-node-menu`·`editor-toolbar`·`node-search`. **R4 브랜치 통합 완료**(FF→`feat/editor-compare-redesign`). 이미지 `topbar-add-node-menu.png`·`editor-overview.png` | tsc/lint✅ | ✅ | ✅ OK (노드정보 카드 R5b까지 보존 · 아웃라인 단축키 목록은 D2에서 정립) | R4a~c |
| R5a | 우측 인스펙터 | **탭 바(속성/맵/승인/활동) + 속성 탭**(빈상태·노드·엣지). `inspectorTab` 상태·접힘 시 재오픈 탭·폭 330. `InspectorPanel`+`TabProperties` 추출, page.tsx `6195–6450` 폼 배선 보존. 이미지 `inspector-properties-empty/node/edge.png` · **R5a 완료**: 신규 `inspector-panel.tsx`(탭바+**속성 빈상태**+맵요약) + **노드 폼**(제목/유형/색상/BPM 카드) + **엣지 폼**(소스→타겟·분기라벨·라벨·스타일·삭제) via `propertiesSlot`. **OLD와 우측 2배 나란히 비교**(4탭 후 OLD 제거). 보류: 설명·댓글·특수필드(OLD 유지)·터미널 라벨 "—"·연결 면 단순화. 단일 브랜치 통합 완료. **탭 바 반응형**(feat/editor-redesign-r6): 폭 넉넉하면(@container ≥430px) 전 탭 라벨 펼침·좁으면 선택 탭만 라벨(잘림 방지). | lint/build✅ | ✅ | ✅ OK | ed8de58·dfb99c7·2fac41b |
| R5b | 우측 인스펙터 | **맵 탭** — 가시성·소유자/협업자 카드·설명·노드 표시정보 토글·엣지 스타일(하단 design 탭에서 이동)·PNG. 기존 `MapDetailCard`·design/download 탭 배선 통합. 이미지 `inspector-map-tab.png` | lint/build✅ | ✅ | ✅ OK | a5044ce |
| R5c | 우측 인스펙터 | **승인 탭** — `WorkflowDashboard`를 하단 탭→상단 탭 승격(stepper·승인자·요청). 배선 보존. 이미지 `inspector-approval-tab.png` | lint/build✅ | ✅ | ✅ OK | 37581d8·9654620 |
| R5d | 우측 인스펙터 | **활동 탭** — `CommentSection`(코멘트/답글/해결) + 버전 타임라인(현재/검토중/승인됨/게시됨·비교/복원) 통합. version 탭 배선 이동. 이미지 `inspector-activity-tab.png` | lint/build✅ | ✅ | ✅ OK | 37581d8 |
| R6a | 컨텍스트 메뉴 | **컴포넌트 공통**(`context-menu.tsx`·openMenu 로직 보존) — 패널 라운드 `rounded-md`·여백 `py-1.5` 통일 + danger(삭제) 빨간 kbd 칩(`error` 틴트). 전 메뉴 즉시 반영, 내용/동작 무변경. | lint/build✅ | ✅ | ✅ OK | 6a8f13d |
| R6b | 컨텍스트 메뉴 | **캔버스(pane) 메뉴** — 노드타입 4행 아이콘(Square/Diamond/Circle/CircleDot·신규 `NODE_TYPE_ICONS`) + `기타›`(⋯)에 PNG 내보내기(Download·라벨 `Ctrl+⇧E` 전역키 유지; 최상위 승격은 사용자 결정으로 환원). **정렬 서브메뉴**: 세로 리스트 유지 + `Align`/`Distribute` 섹션 캡션(legend.align/distribute)·4방향 사이 divider 제거. **공통**(`context-menu.tsx`): 라벨 `whitespace-nowrap`+왼쪽("Center (horizontal)" 줄바꿈 해결)·비활성 `opacity-45`·`{caption}` 변형 추가·**하위메뉴 상하 뒤집기**(아래 넘치고 위 공간 있으면 위로 펼침, 좌우 뒤집기와 동일 패턴). 전체선택·라이브러리추가·노드추가 통합 미포함. 이미지 `context-canvas.png` | lint/build✅ | ✅ | ✅ OK | f9fc00c·e55494b·09e8d7e |
| R6c | 컨텍스트 메뉴 | **노드 메뉴** — 행 아이콘(편집 PencilLine·이름변경 Type·열기 Maximize2·삭제 Trash2) + **이름 변경 항목**(기존 `startRename`) + **F2 전역키 신규 바인딩**(선택 노드 이름편집, readOnly 가드) + danger 아이콘 빨강(삭제). **색상은 인라인 스와치 유지**(서브메뉴 안 함·사용자 결정). **F2 누르면 열린 컨텍스트 메뉴도 닫힘**. TDZ는 `startRenameRef`(useEffect 노출)로 회피. 이미지 `context-node.png` | lint/build✅ | ✅ | ✅ OK | b4ca7a0·26c5c5b |
| R6d | 컨텍스트 메뉴 | **엣지 메뉴** — 상단 "연결 면" 섹션 캡션(신규 i18n `edge.connection`) + 라벨편집(PencilLine·**F2**)·삭제(Trash2·빨강, **앞 스페이서 2줄**=divider 2개로 노드와 통일) 아이콘. **엣지 F2=라벨 리네임**(우클릭=엣지 선택, F2 시 메뉴 닫힘, readOnly 가드). edgeSides 연결면 패드·동작 그대로. **연결면 패드 개선**: 커넥터를 직선→**직각 꺾은선**(실제 캔버스 엣지처럼)·Start/End 라벨을 **박스 안으로 축소**(위 공간=꺾은선 라우팅)·**박스 hover 시 4변 히트박스 tint 노출**(클릭 가능 인지)·**커넥터 16조합 노드 뒤 통과 방지**(두 박스 사이 gap 세로 채널+상/하 레인으로만 라우팅해 돌아서 연결)·좌/우 변 pad 밖 잘림 수정(`HPAD` 좌우 여백)·화살표 축소(marker 7→5). node로 박스 미통과+바운드 수치 검증. 분기(Yes/No/기타) 편집은 인스펙터(R5a) 담당(context-branch-edge.png=인스펙터). 이미지 `context-edge.png`·`context-branch-edge.png` | lint/build✅ | ⏳ | 🔧 반영(검토대기) | — |
| R6e | 컨텍스트 메뉴 | **그룹 메뉴** — 그룹 이름변경(Type·신규 `ctx.renameGroup`, GroupTitleBar autoEdit 트리거·**F2 없음**=그룹 선택상태 미존재)·**색상 인라인 스와치**(`recolorGroup`)·멤버 일괄편집(SlidersHorizontal)·구분선·그룹 해제(Ungroup·**⌘⇧G 칩 생략**=미바인딩)·구분선·정렬·레이아웃(유지). GroupTitleBar: 렌더중 상태조정(effect 아님)+편집종료 시 신호해제(반복 재트리거). 이미지 `group-context-and-node-modal.png` | lint/build✅ | ✅ | ✅ OK | 7343974 |
| R7 | 노드 편집 모달 | 더블클릭 편집 모달(제목/설명/유형/색상/선행·후행/Esc·⌘S). ⚠️ **현재 더블클릭=하위프로세스 드릴** → 충돌, 착수 시 사용자와 정리(일반 노드=모달·서브프로세스=드릴 등). 이미지 `group-context-and-node-modal.png`(모달부) | — | — | ⏳ | — |
| R8 | 그룹 | 그룹 박스·타이틀바·일괄편집(부서/담당자)·색상. `group-box`·`group-title-bar`·`group-bulk-modal` 재스타일. 이미지 `group-bulk-edit.png`·`group-context-and-node-modal.png` | — | — | ⏳ | — |
| R9 | 기타 모달/오버레이 | 엣지 모달들(branch/action/select/decision)·`NodeSummaryModal`·dialog 토큰 통일 재스타일. | — | — | ⏳ | — |
| R10 | AI 패널 | `AiChatPanel` 재스타일 — 헤더·스레드·**제안 카드(맵에 추가/미리보기)**·퀵칩·입력. 배선 보존. 이미지 `ai-chat-panel.png` | — | — | ⏳ | — |
| R11 | 드롭존 | 노드 위 드래그 시 **라디얼 링**(4방향 앞/뒤/그룹/스왑) + "이미 연결됨→유지/중간삽입" 재스타일. 기존 드롭/충돌/dwell 로직 보존. 이미지 `dropzone.png` | — | — | ⏳ | — |
| C1 | 비교화면 | 비교 셸 — BASE/TARGET 셀렉터·swap·내보내기·**To-Be 적용=에디터 내비**·범례. `compare/page.tsx` 크롬 재스타일. 이미지 `compare-screen.png` | — | — | ⏳ | — |
| C2 | 비교화면 | diff 캔버스 — `buildMergedGraph` 재사용 + 새 `ProcessNode` diff 스타일(추가 green·삭제 red 점선·변경 amber). 이미지 `compare-screen.png` | — | — | ⏳ | — |
| C3 | 비교화면 | 변경사항 패널 — 필터(전체/추가/삭제/변경)·항목 리스트·클릭 포커스. 이미지 `compare-screen.png` | — | — | ⏳ | — |

## 비고
- **진행 순서**(권장): R1 → R2 → R3 → R4 → R5a~d → R6a~e → R7 → R8 → R9 → R10 → R11 → C1~C3. 저위험·가시 우선 → 큰 구조변경(R5 인스펙터)으로.
- **각 단위는 행(sub-unit)으로 쪼개 개별 트래킹** — R5a~d·R6a~e처럼 큰 R은 마스터 표에 서브유닛 행으로 분리한다. 이후 단위(R7~·C1~)도 착수 시 동일하게 행 분할.
- 각 단위는 독립 커밋 + main 동작 대조 + **PROGRESS·이 표 동반 갱신**(커밋 룰 `rules/common/git.md`). 호버/포커스 전용 UI는 JS 상태 강제 후 스크린샷 검증(lessons `browser-verification`).
- **R6 범위 = 재스타일 + 저비용, 하나씩**(일괄 변경 금지). 목업 신규 동작(복제·전체선택·앞뒤추가·Enter 편집모달)은 신규/키충돌/R7 침범이라 **후속(D/R7)으로 이월**, R6은 기존 동작 보존 + 시각 통일 + 저비용 위닝(F2 이름변경·PNG 승격 등)만.
- **R5(인스펙터 4탭)**가 최대 단위 — 인라인 우측 패널(`6195–6450`)+하단 탭(`6463–6603`)을 `InspectorPanel`로 통합 추출. 각 탭 콘텐츠는 기존 배선 보존.
- R7 더블클릭 충돌은 착수 시 결정 — 보존 원칙상 드릴 동작을 잃지 않는 방향.

## 보류 / 후속(D)
- **D2 아웃라인 단축키 목록 정립** — R4c에서 단축키 카드에 `Tab/⇧Tab/↵편집/Del삭제(+→/←/F)`를 넣었으나 **아웃라인에 맞는 최종 단축키 셋은 추후 정립**(표시·동작·우선순위). 현재 표시값은 잠정.
- **노드 정보 토글 카드** — 사이드바에 보존 중, **R5b(인스펙터 맵 탭)에서 "노드 표시정보 토글"로 이전**하며 사이드바에서 제거.

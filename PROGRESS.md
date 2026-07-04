# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/superpowers/specs·plans/`·`docs/spec.md` 참조.

## 2026-07-04 — R9d: 디시전 팝업 액션 라벨 단축(한/영)
- **`i18n-messages.ts`** — 타일 라벨을 짧게: `edge.actionBranch` "Make a branch"/"분기 만들기" → **"Branch"/"분기"**, `edge.actionIntercept` "Intercept a line"/"출력선에 인터셉트" → **"Intercept"/"인터셉트"**. 두 키는 디시전 팝업에서만 사용(타 화면 영향 없음). en·ko 양쪽 갱신.
- 검증: 프론트 lint 0 errors·build OK.

## 2026-07-04 — R9e 조정: EdgeActionModal Insert/Replace 위치 스왑
- **`edge-action-modal.tsx`** — Insert(흐름 삽입)가 디시전 Intercept와 사실상 같은 기능이라 **같은 2번째 위치**로 통일: 타일 순서를 Replace(1) / Insert(2)로 스왑(스태거 딜레이도 2번째=Insert로 이동). 위치만 변경, 동작·아이콘·라벨 무변경.
- 검증: 프론트 lint 0 errors·build OK.

## 2026-07-04 — R9g: EdgeSelectModal 리스트형 재디자인 + 행 hover 시 캔버스 엣지 하이라이트
- **`edge-select-modal.tsx`** — 개수 가변이라 타일 대신 리스트형: 헤더(캡션+우상단 X) → 최대 3.4행(≈132px) 내부 스크롤(`scrollbar-hidden`) → 하단 Cancel. 각 행=그리드 `[글리프+엣지필 2fr][쉐브론 auto][대상필 3fr]`: `BranchGlyph`(정지, Yes/No만 체크/엑스·그 외 기타 점) + 엣지라벨 필 + `ChevronRight` + 대상노드 필(균일폭·truncate). 필 `title` 툴팁으로 잘린 내용 표시. `edge-row-in` 스태거 페이드인. 클릭효과=행이 button이라 전역 press + hover accent.
- **`branch-icon.tsx`** — `animate` prop 추가(리스트는 정지 아이콘).
- **`globals.css`** — `edge-row-in` 키프레임(reduced-motion 가드) + `.react-flow__edge.edge-hover-highlight`(옵션 행 hover 시 캔버스 엣지 accent 하이라이트, 인라인 stroke보다 우선 `!important`+글로우).
- **`page.tsx`** — `edgeSelect.options`(및 미사용 `decisionDrop.options` 공유 shape)를 `{ edgeId, branchKind, edgeLabel, targetLabel }`로 구조화(`branchKindOf`). `hoveredEdgeId` 상태 + `styledEdges`가 hover 엣지에 `edge-hover-highlight` className 부여(deps 추가). EdgeSelectModal `onHoverOption` 배선, pick/close 시 하이라이트 해제.
- 엣지 팝업 4종(decision·action·branch·select) 재디자인 완료. 검증: lint 0 errors·build OK. 런타임(캔버스 하이라이트·실데이터 렌더)은 후속 인앱 확인.

## 2026-07-04 — R9f follow-up: 분기 출력 엣지 인스펙터 Yes/No/Other를 브랜치 타일 디자인으로 통일
- **`branch-icon.tsx`(신규)** — 분기 아이콘 공용 컴포넌트 `BranchGlyph`(kind/replayKey/size) 추출(EdgeBranchModal·인스펙터 공용, DRY). Yes=체크(브랜치 블루)·No=엑스(브랜치 레드)·Other=점 3개, globals.css `.edge-br-*` 애니 재사용.
- **`edge-branch-modal.tsx`** — 인라인 BranchIcon 제거, 공용 `BranchGlyph` 사용(동작 동일).
- **`page.tsx`** — 인스펙터 분기 선택 3버튼을 텍스트→**아이콘(BranchGlyph 20px)+라벨** flex-col 타일로 통일, 선택 상태 border-accent/bg-accent-tint/text-accent. `font-medium`(weight 500·디자인 규칙 위반) 제거.
- 검증: 프론트 lint 0 errors·build OK.

## 2026-07-04 — R9 fix: 결정 노드 분기 엣지를 브랜치 선택 후 생성(노드 드롭 경로)
- **`page.tsx`** — 노드 드롭 삽입(`applyFlowEdges`)이 마름모(decision)에서 나가는 fresh 엣지를 만들 때, 기존엔 엣지를 먼저 만들고(`setEdges(next)`) 분기 라벨 모달을 띄웠다(사용자 지적: "엣지가 먼저 생성됨"). 이제 fresh 결정-소스 엣지가 있으면 **삽입 전체를 보류**(setEdges 미실행)하고 `branchPrompt.kind:"pendingInsert"`(nextEdges·freshId 보관)로 모달만 띄운다. 선택 시 `handlePickBranch`가 nextEdges에 라벨을 얹어 삽입 적용, 취소 시 미적용(엣지 안 생김). 핸들 드래그(`onConnect` kind "connection")는 이미 선택 후 생성이라 무변경. 원자적 삽입이 반쯤 적용돼 깨지지 않도록 fresh 하나만이 아닌 삽입 전체를 미룸. 기존 kind "edge"(선생성 후 라벨)는 제거.
- 참고: 취소 시 드롭된 노드 위치(placeBeside)는 유지(엣지만 미생성).
- 검증: lint 0 errors·build OK(TS 유니온 타입 컴파일 통과). 실제 드롭 런타임 동작 시현은 후속(사용자 드롭 테스트).

## 2026-07-04 — R9f: EdgeBranchModal 재디자인(Yes/No/Other 3열 아이콘 타일)
- **`edge-branch-modal.tsx`** — 디시전/액션과 동일 체계: 헤더(uppercase 캡션 + 우상단 X) → 3열 경계 아이콘 타일 → 하단 Cancel. 커스텀 애니 SVG — **Yes**: 체크 그려짐(브랜치 블루 `--color-branch-yes`), **No**: 엑스 그려짐(브랜치 레드 `--color-branch-no`), **Other**: 점 3개 순차 팝(중립 ink-tertiary). Yes/No 색은 실제 캔버스 분기 엣지 색과 일치(데이터 색 → 토큰 규칙 예외). `BranchTile` 서브컴포넌트로 hover 아이콘 재생. 정지 상태도 그려진 최종형. position 중앙 폴백 보존.
- **`globals.css`** — `edge-br-check`/`edge-br-x1`/`edge-br-x2`/`edge-br-dot1~3` 클래스 추가(기존 `edge-branch-draw`/`edge-pop-in` 키프레임 재사용), reduced-motion 가드 포함.
- 동작 보존: 위치 클램프·중앙 폴백·Esc·바깥클릭·onPick(yes/no/other)·onClose·`branch.*` i18n 키. 검증: lint 0 errors·build OK, static CSS에 edge-br-* 확인.

## 2026-07-04 — R9e: EdgeActionModal 리치 재디자인(Insert/Replace 아이콘 타일 + 의미 애니메이션)
- **`edge-action-modal.tsx`** — 디시전 팝업과 동일 체계로 재설계: 헤더(uppercase 캡션 + 우상단 X) → 2열 경계 아이콘 타일 → 하단 Cancel. 커스텀 애니 SVG — **Insert**: 노드가 흐름 gap에 껴듦(디시전 Intercept 모션 `edge-box-mid`/`edge-conn` 재사용). **Replace**: `[A]—[B]` 수평 시작 → B 아래 새 노드 C 팝인 → 기존 A—B 엣지 페이드아웃 → 새 꺾은선 엣지 A→C가 아래로 나와 왼쪽으로 들어가며 그려짐(강조색=엣지 → 브랜치와 구분). 정지 상태도 교체 최종형(겹침 없음). 타일 팝 열림 1회, hover 시 아이콘만 재생.
- **`globals.css`** — Replace용 `edge-repl-node`/`edge-repl-old`/`edge-repl-edge` 클래스 + `edge-fade-out` 키프레임 추가, reduced-motion 가드에 포함. Insert는 기존 `edge-box-mid`/`edge-conn` 재사용.
- **`i18n-messages.ts`** — 라벨 단축: `edge.actionInsert` "Insert into flow"/"흐름에 삽입" → **"Insert"/"삽입"**, `edge.actionReplace` "Replace existing"/"기존 교체" → **"Replace"/"교체"**(두 키 EdgeActionModal 전용). en·ko.
- 동작 보존: 위치 클램프·Esc·바깥클릭·onInsert/onReplace/onClose·i18n 키. 검증: lint 0 errors·build OK, static CSS에 edge-repl-* 4종 확인.

## 2026-07-04 — R9d fix: 인터셉트 겹침 원천 차단 + 애니 견고화·심플화
- **증상**: 실제 화면이 프리뷰와 다름 — 아이콘 애니 미표시 + 인터셉트 선이 가운데 박스 밑에 겹쳐 보임. 원인은 브라우저가 옛 globals.css를 캐시해 `.edge-*` 규칙 미적용(그 경우 임시 커넥터 `isegStart`가 기본 opacity 1로 박스 밑에 노출). 빌드 산출 CSS엔 규칙 존재 확인.
- **`edge-decision-modal.tsx`·`globals.css`** — (1) 인터셉트에서 겹침 유발 임시 커넥터(`isegStart`)와 ㅁ-ㅁ widen 크로스페이드 제거 → **가운데 박스가 위에서 드롭 + 좌우 커넥터 페이드인**(좌우 박스 정적)으로 심플화. (2) 애니메이션을 `.edge-anim` 하위 게이트 없이 요소 클래스에 직접 부여. (3) **모든 요소의 '정지 상태 = 최종(그려진) 완성 상태'** → 애니가 없어도(감소모션·CSS 캐시) 겹침 없는 깨끗한 아이콘. tile-pop 포함 전부 `backwards` fill(전역 버튼 :active 눌림 보존).
- 참고: 애니 표시엔 새 CSS 로드 필요 → 하드 리프레시(Cmd/Ctrl+Shift+R) 또는 dev 재기동.
- 검증: 프론트 lint 0 errors·build OK. 새 CSS에 `edge-isegStart` 없음 확인(겹침 원천 제거).

## 2026-07-04 — R9d: 엣지 디시전 팝업 리치 재디자인(아이콘 타일 + 의미 애니메이션)
- **`edge-decision-modal.tsx`** — R9a 토큰 통일에서 더 나아가 재설계(사용자 방향): 헤더(uppercase 캡션 + 우상단 공통 X) → 2열 경계 아이콘 타일(`aspect-3/2`·24px/굵기2·hover accent 보더/틴트/아이콘) → 하단 Cancel 바. Lucide GitBranch/CornerDownRight → **커스텀 애니 SVG**(하위요소 애니 위한 의도적 예외, Lucide 라인 스타일 유지). **브랜치**=곡선이 base 원 위→node 원 좌측으로 뻗어 그려지고 끝 노드가 강조색으로 톡. **인터셉트**=ㅁ-ㅁ가 좌우로 벌어지며 가운데 박스가 위에서 드롭(강조색), 커넥터는 테두리만 연결(겹침 없음). 타일 팝은 열림 시 1회, hover 시엔 아이콘 SVG를 `replayKey`로 리마운트해 아이콘만 재생.
- **`globals.css`** — `.edge-*` 키프레임 8종 + 클래스 추가, `prefers-reduced-motion` 가드. tile-pop은 `backwards`만(forwards면 전역 버튼 `:active` 눌림 scale(.97)이 막힘).
- 동작 보존: 위치 클램프·Esc·바깥클릭 닫기·onBranch/onIntercept/onClose·i18n 키 그대로(신규 문자열 없음).
- 검증: 프론트 lint 0 errors·build OK. 나머지 3종(branch/action/select)은 하나씩 후속.

## 2026-07-04 — R9c: node-summary-modal 토큰 폴리시(굵기 500 제거 + shadow 클래스 정합)
- **`node-summary-modal.tsx`** — 대표 모달 대비 남은 이탈만 정리: (1) accent 버튼 3곳의 `font-medium`(weight 500·디자인 규칙 300/400/600만 허용 위반) 제거 → 대표 모달 accent 버튼과 동일(weight 클래스 없음=400). (2) 인라인 `style={{ boxShadow: "var(--shadow-lg)" }}` 3곳(메인 패널·미저장확인·부서변경 오버레이)을 `shadow-lg` 클래스로 교체 — `--shadow-lg` 토큰에 매핑되므로 시각 변화 없이 대표 모달과 동일 적용 방식. raw hex 없음 확인, 동작·구조 보존.
- 검증: 프론트 lint 0 errors·build OK. (브라우저 시현 후속.)

## 2026-07-04 — R9b: 확장 한계 확인 다이얼로그를 정규 ConfirmDialog로 교체
- **`page.tsx`** — 인라인 `capPrompt` 모달(`p-4`·`text-white`·인라인 `boxShadow`·`bg-ink 12%` 백드롭으로 대표 모달과 이탈)을 정규 `<ConfirmDialog>`(icon=`Maximize2`, title/message/confirm/cancel)로 교체 → 대표 모달 재사용으로 토큰 완전 정합. `confirmCapPrompt`가 자체적으로 `setCapPrompt(null)` 하므로 동작 보존. 마지막 사용처 제거로 고아가 된 `ModalBackdrop` import 제거.
- 참고: `expand-invariant-modal.tsx`는 사용처 0(죽은 코드) — R9에서 미변경·보고만. `prompt-dialog.tsx`는 이미 대표 모달과 정합 → 무변경.
- 검증: 프론트 lint 0 errors·build OK. (브라우저 시현 후속.)

## 2026-07-04 — R9a: 엣지 컨텍스트 팝업 4종 토큰 통일(context-menu 팝업 톤)
- **`edge-branch-modal.tsx`·`edge-action-modal.tsx`·`edge-select-modal.tsx`·`edge-decision-modal.tsx`** — 커서 위치 팝업이라 대표 모달(중앙 아이콘 원)이 아닌 `context-menu.tsx`(R6a) 팝업 컨벤션으로 통일: 패널 `p-1.5`→`py-1.5`+`text-caption`, 항목 `rounded-sm px-2 py-1`→`h-8 px-3` 풀폭 hover, 캡션 `text-fine`→uppercase tracking-wide font-semibold, cancel 앞 divider(`border-divider`) 추가. decision 아이콘 gap `1.5`→`2`. 위치/Esc/ModalBackdrop/onClose 동작·i18n 키 전부 보존(신규 문자열 없음).
- 검증: 프론트 lint 0 errors·build OK. (브라우저 시현 후속.)

## 2026-07-04 — 벌크 개별 마법사 이전→현재 필 + 버튼 아이콘·호버 반전 + 요약 표(대표모달 스타일)
- **`group-bulk-modal.tsx`** — (#1) 개별 선택 마법사에서 회색 "기존/값" 텍스트 제거, **이전→현재를 부서·담당자 필**로 완전 표기. (#2) 마법사 버튼 아이콘 추가(교체·추가·건너뛰기), **호버 시 버려지는 쪽 취소선+빨강**(기본/교체=기존 버림, 건너뛰기=새 값 버림으로 반전). 시스템/소요 마법사 버튼도 아이콘. (#4) 적용 후 요약을 **대표 모달 스타일**(아이콘 원+제목+요약박스)로, **이전→현재 표**(노드·이전(취소선)·→·현재).
- **`i18n-messages.ts`** — `bulk.summaryNode`/`before`/`after` en·ko 추가.
- 검증: 프론트 lint 0 errors·build OK.

## 2026-07-04 — 벌크 모달 컨트롤 재디자인: 속성 3탭 + 설정/비우기 필 + 충돌버튼 고정 + 색상 날개 플라이아웃
- **`group-bulk-modal.tsx`** — (#6) 속성 select→**아이콘 3분할 탭**(담당/부서·시스템·소요), 값 설정/비우기 라디오→**선택 필**(아이콘). (#3) 충돌 처리 4버튼: 미가용 옵션을 제거(위치 변동)하지 않고 **비활성 표시**로 고정. (#5) 색상 일괄: 하위 드롭다운→**옆으로 펼쳐지는 날개 플라이아웃**(화면 우측 가장자리면 좌측 반전, `getBoundingClientRect`로 판정).
- **`i18n-messages.ts`** — `bulk.modePeople` en·ko 추가.
- 검증: 프론트 lint 0 errors·build OK.

## 2026-07-04 — 노드 편집 모달 색상: 팔레트 기본 노출 + 더보기 시 헥사 입력창(재조정)
- **`node-summary-modal.tsx`** — 사용자 재요청: 팔레트(프리셋 스와치)를 기본 1줄로 노출, "더 보기" 시 헥사 입력창(#RRGGBB)만 노출. 직전 커밋의 카드 우측 플라이아웃·relative 래퍼 제거(원복).
- **`i18n-messages.ts`** — 미사용된 `field.colorDefault` 제거.
- 검증: 프론트 lint 0 errors·build OK.

## 2026-07-03 — 노드 편집 모달 색상: 1줄 축약 + 더보기 시 모달 오른쪽 플라이아웃
- **`node-summary-modal.tsx`** — 색상 영역을 평소 1줄(현재 색 스와치 + 값/기본색 + "더 보기" 토글)로 축약. `colorExpanded`/`shownColors`/`COLOR_COLLAPSED` 제거, `colorMoreOpen` 도입. 카드가 `overflow-hidden`이라 카드를 `relative` 래퍼로 감싸고, 팔레트+헥사 입력을 카드 밖 오른쪽(`absolute left-full`) 플라이아웃으로 노출.
- **`i18n-messages.ts`** — `field.colorDefault` en·ko 추가(`editor.moreColors` 재사용).
- 검증: 프론트 lint 0 errors·build OK. (브라우저 시현 검증 예정.)

## 2026-07-03 — 벌크 적용 후 변경 요약 → 확인 시 닫힘
- **`group-bulk-modal.tsx`** — Apply(또는 개별 마법사 완료) 후 `finishPeople`/`finish`가 적용 결과를 `summary` state로 수집(멤버 라벨 → 새 값, 비움은 "비움"), 최상위 렌더 분기로 요약 패널 노출. 확인 버튼(accent) → `onClose`로 모달 닫힘. 변경 0건이면 "적용된 변경 없음".
- **`i18n-messages.ts`** — `bulk.summaryTitle`/`summaryCount`/`summaryNone`/`confirm`/`cleared` en·ko 추가.
- 검증: 프론트 lint 0 errors·build OK.

## 2026-07-03 — 벌크 색상 섹션: 명칭 변경 + 호버 하위메뉴
- **`group-bulk-modal.tsx`** — 색상 라벨을 "그룹 내 노드 색상 일괄 변경"(en "Recolor group nodes")으로 변경, 스와치는 상시 노출 대신 라벨 호버 시 하위 메뉴(top-full 팝오버)로 노출. ChevronDown 표식.
- **`i18n-messages.ts`** — `bulk.color` 문구 en·ko 변경.
- 검증: 프론트 lint 0 errors.

## 2026-07-03 — Task 7: 그룹 벌크에서 start/end/subprocess 제외 + 제외 안내 + 교차부서 확인 필/빨강
- **`group-bulk-modal.tsx`** — prop `members`→`allMembers`, 파생 `members = allMembers.filter(hasBpmAttributes)`/`excludedMembers`. 속성(부서·담당자·시스템·소요) 충돌·적용 로직 전부 editable(=members)만 순회 → 차단 타입은 일괄 등록 대상 제외. 헤더 카운트는 전체(allMembers). 제외 안내 "총 n개 제외"(호버 시 Start/End/Subprocess 타입별 개수). 교차부서 확인(`bulk.crossDeptConfirm`)을 border-error/bg-error 박스 + AlertTriangle + 부서 old(취소선)→new 필 + 초기화 담당자 취소선 필로 재디자인.
- **`page.tsx`** — GroupBulkModal `members`에 `nodeType` 전달.
- **`i18n-messages.ts`** — `bulk.excluded` en·ko 추가.
- 검증: 프론트 lint 0 errors·build OK. (브라우저 시현 검증은 후속 모달 변경과 함께 일괄 예정.)

## 2026-07-03 — 최종 리뷰 픽스: 드리프트 경고 가드 + 부서 동일 재선택 no-op
- **`page.tsx`** — 드리프트 경고 계산에 `eligible !== null && hasBpmAttributes(nodeType)` 가드 추가(eligible 로드 전 오탐 배지·start/end/subprocess 조치불가 배지 방지).
- **`node-summary-modal.tsx`/`bpm-attribute-picker.tsx`** — `changeDept`/`handleDeptChange`에 `dept === 현재부서 → return` 조기 반환(SearchSelect가 동일값 재선택에도 onChange 발화 → 모달은 담당자 무단 초기화·인스펙터는 불필요 확인모달 방지).
- 검증: 프론트 lint 0 errors.

## 2026-07-03 — Task 6: BPM 속성 start/end/subprocess 숨김
- `canvas.ts` — `hasBpmAttributes()` helper 추가·export (process·decision만 true).
- `node-summary-modal.tsx` — `showAttributes: boolean` prop 추가; false면 담당자/부서/시스템/소요 입력 숨김.
- `page.tsx` — `hasBpmAttributes` import; `<NodeSummaryModal showAttributes=…>` 전달; 인스펙터 BPM 속성 카드 조건부 렌더.
- `process-node.tsx` — `NodeFields`에서 BPM 필드(assignee/department/system/duration)는 `hasBpmAttributes` false 노드에 표시 안 함.
- 검증: lint 0 errors·build OK.

## 2026-07-03 — Task 2: 노드 편집 모달 담당자 칩·부서 연동·변경 확인
- **`node-summary-modal.tsx`** — 부서: 단일 SearchSelect + 담당자 있을 때 변경 시 `pendingDept` 확인 오버레이(담당자 초기화). 담당자: 제거 가능 칩(드리프트 담당자 오류색 표시) + 부서 필터링 추가 픽커. `ATTR_FIELDS`에서 assignee/department 제거, system/duration만 유지. Esc·⌘S도 `pendingDept` 인식.
- **`i18n-messages.ts`** — `assignee.deptChangeTitle`/`assignee.deptChangeBody` en·ko 추가.
- 검증: 프론트 lint 0 errors·build OK.

## 2026-07-03 — 계획: 담당자/부서 통일 구현 플랜 작성
- 구현 계획 `docs/superpowers/plans/2026-07-03-assignee-department-unified.md` — 5 태스크(공용 로직+테스트 → 노드모달 칩·연동·확인 → 인스펙터 → 그룹벌크 결합 → 드리프트 경고). writing-plans로 작성, TDD·커밋 단위.

## 2026-07-03 — 설계: 담당자/부서 설정 로직 통일(3지점) 스펙 작성
- 신규 기능 설계 문서 `docs/superpowers/specs/2026-07-03-assignee-department-unified-design.md` — 부서 단일·담당자 같은부서 복수(콤마, 백엔드 무변경)·담당자↔부서 연동·부서변경 확인모달·벌크 결합세트(부서만 3옵션·담당자 4옵션·추가 교차부서 확인)·드리프트 경고. 브레인스토밍으로 확정.

## 2026-07-03 — R8b 충돌 버튼 4개 완전 균일 + 직관 아이콘
- **4개 버튼 크기 동일**(`group-bulk-modal.tsx`) — 버튼에 `whitespace-nowrap`(라벨 줄바꿈 방지→높이 균일) + grid 동일폭·중앙정렬로 4개 완전 동일.
- **아이콘 직관화** — skip `CircleSlash`→`SkipForward`(건너뛰기), individual `ListChecks`→`MousePointerClick`(개별 선택). replace=Replace·append=Plus 유지.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R8b 충돌 버튼 균일·아이콘 확대 + R8a 완료
- **충돌 옵션 버튼 개선**(`group-bulk-modal.tsx`) — 2×2 그리드 버튼 `justify-center`(내용 중앙→균일해 보임)·`py-2`·아이콘 14→**18px**·idle 텍스트 `text-ink`(가시성)·hover accent 보더.
- **R8a 완료 처리**(트래커) — 🔧→✅.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R8b 개선: 일괄편집 담당자/부서 피커 + 충돌 옵션 2×2 아이콘 그리드
- **담당자/부서 피커**(`group-bulk-modal.tsx`) — 값 입력을 노드 편집과 동일한 **SearchSelect**(assignee=users·department=departments, `getEligibleAssignees(versionId)` 로드)로. system/duration은 자유입력 유지. page.tsx가 `versionId` 전달.
- **충돌 처리 옵션 재디자인**(사용자 요구) — 라디오 세로 리스트 → **아이콘 + 2×2 그리드 버튼**(replace=Replace·append=Plus·skip=CircleSlash·individual=ListChecks·선택 시 accent). 한눈에 파악.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R8a 연필 제거 + R8b: 멤버 일괄편집 모달 재스타일
- **R8a 타이틀바 연필 삭제**(`group-title-bar.tsx`) — 사용자 요청, 리네임은 이름 더블클릭 유지. SquarePen import 제거.
- **R8b GroupBulkModal 재스타일**(`group-bulk-modal.tsx`) — **적용(저장) 버튼 accent primary**(목업 바이올렛), 그룹이름/색상/속성 섹션 사이 **구분선**(border-t)으로 카드형 구조화. 충돌 처리·개별 마법사·전 기능 보존.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R8a: 그룹 타이틀바 pill + 박스 dashed (R7 마감)
- **GroupTitleBar → pill**(`group-title-bar.tsx`) — 흰 배경+색 테두리 → **그룹색 배경 pill**(밝은 콘텐츠). 그립(이동)·색 점(팔레트 토글)·이름(흰 텍스트)·**연필 리네임 버튼 신규**·일괄편집 슬라이더. 색 팔레트에 현재색 선택 링·스와치 크기 up.
- **GroupBox 외곽선 dashed**(`group-box.tsx`) — 실선→`strokeDasharray 5 4`(목업). fill·orthogonal union·targeted 펄스 유지.
- R8을 R8a(타이틀바·박스)·R8b(일괄편집 모달)로 분할. R7b 완료로 R7 마감.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R7b 선후행 재디자인(타입 아이콘·세로 나열·가운데선·가장자리 화살표 hover) + R7a·R6 완료
- **선후행 재디자인**(`node-summary-modal.tsx`·`page.tsx`) — 칩 맨 앞 **노드 타입 아이콘**(`NavChip`·`NAV_TYPE_ICONS` process=Square/decision=Diamond/start=Circle/end=CircleDot/subprocess=Boxes)·여러 스텝은 **세로 나열**(가로 wrap→flex-col)·가운데 **세로 구분선**(border-r)·화살표는 **양 가장자리**만, 좌/우 컬럼 hover 시 **Previous/Next**(신규 i18n `summary.prev/next`) 노출. predecessors/successors를 `{id,label,nodeType}[]`로 확장(page.tsx `typeById`).
- **R7a·R6(a~e) 완료 처리**(트래커) — 사용자 승인, 🔧→✅.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R6d 히트박스 강조 방식 변경: 솔리드 → 파스텔 tint + accent 보더
- 사용자 요청 — 히트박스 톤은 **파스텔(투명 tint) 유지**, 강조는 **보더**로. strip `bg-accent/45`(솔리드톤) → `group-hover:bg-accent-tint`(파스텔) + `group-hover:border-accent`(보더). base에 `border border-transparent`로 상태별 크기 일관. 직접 hover는 `bg-accent/30`. 박스 border는 `accent/50`(부드럽게).
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R7a 색상(타입별 프리셋+커스텀 헥사) · R6d 히트박스 hover 강조
- **R7a 모달 색상**(`node-summary-modal.tsx`·`page.tsx`) — 전역 `COLOR_PRESETS` → **노드 타입별 세트**(`colorsForType(nodeType)`: 메인6/터미널3/디시전4, 컨텍스트 메뉴와 동일). **커스텀 헥사 입력란**(#RRGGBB, 좌측 미리보기 스와치) 추가 → 프리셋 외 임의 색 지정.
- **R6d 연결면 히트박스 hover 강조**(`context-menu.tsx`) — 박스 hover 시 4변 strip `bg-accent-tint`→`bg-accent/45`(더 뚜렷)·박스 border `accent/50`→`accent`·idle `divider/40`→`/50`.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 연결면 화살표 추가 축소 + 미니맵 페이드 종료점 1.6
- **연결면 커넥터 화살표 축소**(`context-menu.tsx` edgeSidesArrow) — marker 5×5→**4×4**, path 4.5→3.5.
- **미니맵 페이드 종료점**(`minimap-viewport-fill.tsx`) — `FADE_END` 2.0→**1.6**(채움비 1.6에서 완전 투명 = 더 일찍 사라짐, FADE_START 1.2 유지).
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R7b: 선행/후행 클릭 내비 + 미저장 변경 확인
- **선행/후행 클릭 내비**(`node-summary-modal.tsx`·`page.tsx`) — 텍스트 → **클릭 가능한 노드 칩**(←선행/후행→ 2열 박스). 클릭 시 `onNavigate`→`setSummaryNodeId`로 그 노드 편집 전환. predecessors/successors를 `{id,label}[]`로 확장(page.tsx `toRef`).
- **미저장 변경 확인**(사용자 요구) — 이동 시 버퍼가 dirty면 확인 오버레이(**저장하고 이동 / 저장 안 함 / 취소**). 저장하고 이동=현재 노드 반영 후 전환, 저장 안 함=폐기 후 전환, 취소=머무름. Esc는 오버레이부터 닫음. 신규 i18n 4키(`summary.unsavedTitle/Body`·`saveAndGo`·`discardAndGo`).
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R7a 보정: 라이브 편집 → 버퍼 편집(사용자 결정)
- **버퍼 편집 전환**(`node-summary-modal.tsx`) — 모든 편집필드(제목/설명/색상/담당자/부서/시스템/소요)를 로컬 `form` 버퍼로. **저장**(⌘S/버튼)=`onPatch`+`onCommitLabel`로 노드 반영 후 닫기, **취소**(Esc/바깥클릭/취소버튼)=버퍼 폐기. 노드 변경 시 렌더중 상태조정으로 버퍼 리셋(선후행 내비 대비). `handleSave` `useCallback`으로 effect deps 안정화(exhaustive-deps 경고 해소). 푸터 닫기→취소·저장(+Esc/⌘S 힌트). readOnly는 닫기만.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R7a: 노드 편집 모달 재스타일 + 설명(description) 필드
- **더블클릭 충돌 없음 확인** — 현재 이미 일반 노드 dblclick=편집모달(`NodeSummaryModal`)·서브프로세스=드릴·타이틀=리네임. 트래커 경고 해소, 재매핑 불필요.
- **description 프론트 배선** — `NodeData.description`·백엔드 schema에 이미 존재(**백엔드 무변경**). `NodeEditPatch`/props에 description 추가, 모달에 **설명 textarea**(라이브 `patchNode`, `{...node.data,...patch}`로 영속).
- **모달 재스타일**(`node-summary-modal.tsx`) — 헤더를 제목입력→"노드 편집"(`editor.nodeEdit`·SquarePen), 제목은 body 필드로 이동. 푸터(Esc/⌘S 힌트 + 닫기 버튼) 추가, ⌘S=브라우저 저장 막고 모달 닫기. 유형/색상/BPM/코멘트/하위프리뷰 보존.
- 결정: 저장 모델 **라이브 편집 유지**(동작 보존). 목업의 저장/취소(버퍼 편집)는 검토 시 필요하면 전환. R7을 R7a(재스타일)·R7b(선행/후행 클릭 내비)로 분할.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 연결면 패드 좌우 여백(잘림 수정)·화살표 축소 + 미니맵 16:9
- **좌/우 변 커넥터 pad 밖 잘림 수정**(`context-menu.tsx`) — 좌(source left)·우(target right) 변 커넥터가 박스 바깥(x=-STUB/+STUB)으로 나가 pad(svg 180폭) 밖으로 잘렸음. `HPAD=10` 좌우 여백 도입(`SRC_X0`/`TGT_X0`·`PAD_W`=200), `gx`도 gap 중앙(`srcX0+BOX_W+GAP/2`). 16조합 전부 박스 미통과 + `[0,PAD_W]` 내 수치 재검증.
- **화살표 축소**(edgeSidesArrow marker) — 7×7→5×5, path 6→4.5. End 위/아래에서 큰 화살표가 옆에서 꺾인 듯 보이던 것 완화.
- **미니맵 16:9**(`minimap-viewport-fill.tsx`) — 높이 105 유지, 폭 233→**187**(16:9).
- 검증: 프론트 lint 0·build OK + 16조합 라우팅/바운드 수치 검증.

## 2026-07-03 — 엣지 연결면 커넥터 라우팅 재작성(16조합 노드 뒤 통과 방지) + R6e 완료
- **커넥터가 노드 뒤로 지나 깨져 보이던 문제**(`context-menu.tsx orthConnector`) — 기존 "중간점 꺾기"는 일부 변 조합에서 박스 내부를 통과(svg가 박스 뒤라 잘려 보임). 두 박스 사이 **gap 세로 채널(x=gx)** + **박스 위/아래 레인(topY/botY)**만 쓰도록 재작성: 각 변을 자유 채널로 이스케이프→gx 세로 채널로 연결→타겟 변 진입. **16개 조합 전부 박스 내부 미통과**를 node 스크립트로 수치 검증(ALL OK). 미사용 `sideAnchor`/`sideDir` 제거.
- **R6e 완료**(트래커) — 사용자 승인, 🔧→✅, 커밋 `7343974`.
- 검증: 프론트 lint 0·build OK + 16조합 라우팅 수치 검증.

## 2026-07-03 — 엣지 메뉴 삭제 스페이서 2줄 통일 + 미니맵 크기(20:9·높이 70%)
- **엣지 삭제 앞 구분선 2개**(`page.tsx`) — 노드 메뉴는 color/delete 인접 divider로 삭제 앞이 2줄인데 엣지는 1줄이라, 엣지도 `{divider}×2`로 통일.
- **미니맵 크기**(`minimap-viewport-fill.tsx`) — `MM_W/MM_H` 200×150 → **233×105**(높이 기본의 70%=105, 비율 20:9≈233×105). MiniMap `style.width/height`로 지정(React Flow는 `style.width ?? defaultWidth` 사용), 오버레이 svg도 동일 치수라 좌표계 정렬 유지.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 에디터 재디자인 R6e: 그룹 컨텍스트 메뉴(이름변경·색상 인라인·해제 아이콘)
- **그룹 우클릭 메뉴**(`page.tsx` menuItems group 분기) — 그룹 이름변경(Type·신규 i18n `ctx.renameGroup`)·**색상 인라인 스와치**(`GROUP_COLOR_PRESETS`/`recolorGroup`)·멤버 일괄편집(SlidersHorizontal)·구분선·그룹 해제(Ungroup)·구분선·정렬·레이아웃(유지). 결정: F2 없음(그룹 선택상태 미존재)·⌘⇧G 칩 생략(미바인딩)·색상 인라인·정렬 유지.
- **그룹 이름변경 트리거**(`group-title-bar.tsx`) — 메뉴가 `setNewGroupId(groupId)`→`autoEdit`. 마운트 전용 useState로는 이미 뜬 그룹 재호출을 못 받으므로 **렌더 중 상태조정**(prevAutoEdit 비교, effect 아님 → `set-state-in-effect` 회피)으로 편집 진입. 편집 종료(blur/Esc) 시 `onAutoEditConsumed`로 신호 해제 → 반복 이름변경 재트리거.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 미니맵 클릭/스태킹 수정: 래핑 div 제거, 패널에 직접 opacity(z-index 보존)
- **버그**: 미니맵 페이드 opacity를 static 래핑 div에 주니 opacity<1이 새 **스태킹 컨텍스트**를 만들어 미니맵이 인터랙션 pane 아래로 내려가 클릭이 캔버스로 통과(최대 0.65 상한 후 항상 발생). 지도 위 클릭=캔버스 클릭으로 인식되던 원인.
- **수정**(`minimap-viewport-fill.tsx`) — 래핑 div 폐기. `MinimapFade`가 MiniMap+채움 오버레이를 직접 렌더하고 opacity/`zIndex:20`을 **각 Panel(이미 absolute + 패널 z-index)에 직접** 적용 → 스태킹 컨텍스트 신규 생성 없음, 미니맵이 노드/캔버스 위 유지·클릭(시점 이동) 유효. 완전 페이드 시에만 `pointer-events:none`. `page.tsx`는 `<MinimapFade nodeColor={...}/>`로 축약(MiniMap 직접 렌더 제거).
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 엣지 연결면 패드 개선(꺾은선 커넥터·라벨 박스 안·hover 히트박스) + R6c 완료
- **연결면 패드**(`context-menu.tsx EdgeSidesPad`) — ① 커넥터 직선→**직각 꺾은선**(`orthConnector`: 각 변에서 stub 후 중간 꺾음, 실제 캔버스 엣지처럼). ② Start/End 라벨을 박스 위→**박스 안 중앙·`text-[10px]`로 축소**(위 라벨행 제거, 그 공간을 꺾은선 상/하 라우팅에 사용; `VPAD`). ③ **박스 hover 시 4변 strip을 `group-hover:bg-accent-tint`로 노출** + `hover:border-accent/50` — 클릭 가능한 히트박스임을 인지.
- **R6c 완료**(트래커) — 사용자 승인, 🔧→✅, 커밋 `b4ca7a0·26c5c5b`.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 미니맵 최대 투명도 0.65 + R6b 완료 처리
- **미니맵 최대 불투명도 0.65**(`minimap-viewport-fill.tsx`) — `useMinimapFadeOpacity`에 `MAX_OPACITY=0.65` 도입, 완전 표시 구간도 0.65 상한(미니맵이 켜져 있어도 뒤쪽 노드가 비침). 페이드 곡선 `0.65→0`으로 스케일(FADE_START 1.2~FADE_END 2.0 유지).
- **R6b 완료**(트래커) — 사용자 승인, 🔧→✅, 커밋 `f9fc00c·e55494b·09e8d7e` 기입.

## 2026-07-03 — R6c/R6d 보정: F2 시 메뉴 닫힘 + 엣지 F2 리네임 + 엣지 삭제 divider(검토 피드백)
- **F2 시 컨텍스트 메뉴 닫힘**(`onFlowKey`) — F2 핸들러를 `!selectedId` 가드 위로 올리고 `setMenu(null)` 추가. 노드/엣지 모두 F2 누르면 편집 진입 + 열린 드롭다운 닫힘(기존엔 메뉴 유지되던 문제).
- **엣지 F2 = 라벨 리네임** — F2 핸들러에 `selectedEdgeId`(+`!readOnly`) 분기 추가(`startEdgeLabelEdit`). **우클릭 시 엣지 선택**(`onEdgeContextMenu`에 `setSelectedEdgeId`/`setSelectedId(null)` — 노드 우클릭과 동일)해 F2 대상 확정. 엣지 메뉴 `라벨 편집`에 `F2` 칩.
- **엣지 삭제 앞 divider** — 노드 메뉴처럼 삭제를 스페이서로 분리(`라벨 편집` / — / `삭제`).
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 에디터 재디자인 R6d: 엣지 컨텍스트 메뉴 캡션 + 아이콘
- **엣지 우클릭 메뉴**(`page.tsx` menuItems) — 상단에 "연결 면"(신규 i18n `edge.connection` = Connection/연결 면) 섹션 캡션 추가(연결면 패드 위, 목업 일치). 라벨 편집=PencilLine·삭제=Trash2 아이콘(삭제는 R6c 공통으로 빨강). 내용/동작(edgeSides 면 선택·라벨편집·삭제)은 그대로.
- 분기 종류(Yes/No/기타) 편집은 인스펙터 속성 탭(R5a) 담당 — 컨텍스트 메뉴엔 미포함(`context-branch-edge.png`=인스펙터).
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 에디터 재디자인 R6c: 노드 컨텍스트 메뉴 아이콘 + 이름변경(F2)
- **노드 우클릭 메뉴**(`page.tsx` menuItems) — 행 아이콘(편집=PencilLine·이름변경=Type·열기=Maximize2·삭제=Trash2). **이름 변경 항목 신규**(기존 `startRename` 배선) + **F2 전역키 바인딩**(`onFlowKey`: 선택 노드 이름편집, readOnly는 startRename이 가드). **색상은 인라인 스와치 유지**(서브메뉴화 안 함·사용자 결정).
- **공통**(`context-menu.tsx`) — danger 항목 아이콘도 빨강(`text-error`): 삭제 = 빨간 아이콘+라벨+칩(목업 일치).
- **TDZ 회피** — menuItems useMemo(위쪽)에서 아래 정의된 startRename 호출 → `startRenameRef`(useEffect 노출)로 우회(toggleInlineExpandRef와 동일 패턴). 빌드 TDZ 에러(`Cannot access variable before it is declared`) 해결.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 핫픽스: 미니맵 줌아웃 페이드(가득 차면 숨김·줌인 시 복귀)
- **미니맵 페이드**(`minimap-viewport-fill.tsx` + `page.tsx`) — 줌아웃으로 뷰포트 rect가 미니맵을 통째로 덮어 연보라로 가득 차면(무의미) 미니맵+오버레이를 opacity로 페이드 아웃, 줌인 시 페이드 인. 채움비 `r=min(vp.w/vbW, vp.h/vbH)` 기반: `r≤1.2` 불투명(가득 차자마자 안 사라지게 마진), `r≥2.0` 완전 투명. opacity가 ~0이면 `pointer-events:none`으로 클릭 비활성. 신규 `useMinimapFadeOpacity` 훅 + `MinimapFade` 래퍼(opacity는 containing block 미생성→Panel absolute 위치 안 깨짐). `transition-opacity duration-350 ease-smooth`로 연속 페이드.
- 검증: 프론트 lint 0·build OK, 페이드 곡선 수식 실행 확인(핏뷰=불투명·줌아웃=0·마진·pointer-events 컷). 라이브 브라우저 시각 확인은 인증 스택 미구성으로 미실시.

## 2026-07-03 — 컨텍스트 메뉴 하위메뉴 상하 뒤집기(위로 펼침)
- `context-menu.tsx SubmenuItem` — 좌우 뒤집기(`toLeft`)만 있던 것에 **상하(`toUp`)** 추가. hover 시 트리거 rect + 하위메뉴 높이 추정(`length*ITEM_HEIGHT+12`)으로 아래로 넘치고 위에 공간 있으면 `top:0`→`bottom:0`으로 위로 펼침. 화면 하단 근처 `정렬·레이아웃`/`기타` 서브메뉴 잘림 방지.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — R6b 보정: PNG 기타로 환원 + 정렬 서브메뉴 캡션·줄바꿈/비활성 개선(ASCII 확인 후)
- **PNG 최상위 승격 되돌림**(결정 1) — `기타›`(⋯ MoreHorizontal) 서브메뉴 안에 PNG 내보내기(Download, `Ctrl+⇧E`). 노드타입 4행 아이콘은 유지.
- **정렬·레이아웃 서브메뉴**(결정 3-3) — `Align`/`Distribute` 섹션 캡션(기존 `legend.align`/`legend.distribute` 재사용) + 4방향 정렬 사이 중간 divider 제거(한 그룹). 스트립 재디자인은 기각(리스트 유지, 결정 2).
- **공통 컴포넌트**(`context-menu.tsx`) — 결정 2: 항목 라벨 `whitespace-nowrap`("Center (horizontal)" 2줄 줄바꿈 = "센터(호라이즌)" 문제 해결) + 왼쪽 정렬. 결정 3-2: 비활성 항목 `opacity-45`로 뚜렷이. 신규 `{ caption }` 변형. 결정 3-1: 단축키 표시는 기존대로.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 에디터 재디자인 R6b: 캔버스 컨텍스트 메뉴 아이콘 + PNG 최상위 승격(→ 다음 커밋에서 환원)
- **캔버스(pane) 우클릭 메뉴**(`page.tsx` menuItems) — 노드타입 4항목에 Lucide 아이콘(process=Square·decision=Diamond·start=Circle·end=CircleDot, add-node-menu와 동일 매핑; 신규 module const `NODE_TYPE_ICONS`). PNG 내보내기를 `기타›` 하위메뉴에서 **최상위 항목으로 승격**(Download 아이콘, 라벨 `Ctrl+⇧E`=실제 전역키 유지 — 목업 ⌘E는 라벨거짓 방지로 미채택). 빈 `기타` 서브메뉴 제거.
- 범위 준수(재스타일+저비용): 전체선택(⌘A)·라이브러리에서 추가·노드추가 통합은 신규 동작이라 미포함. `ctx.more` i18n 키는 orphan으로 남김(제거 안 함).
- **R6a 완료 처리**(트래커) — 사용자 승인, 🔧→✅.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 트래커: R6 단일 행 → R6a~e 서브유닛 행 분리(R5식)
- `SCREEN-REDESIGN-EDITOR.md` 마스터 표 — R6 한 행에 뭉쳐있던 하위단계를 **R6a~e 개별 행**으로 분리(R5a~d와 동일 트래킹 단위). R6a=✅(6a8f13d), R6b~e=⏳. 비고에 “큰 R은 서브유닛 행으로 분할·이후 단위도 동일” 원칙 + R6 범위(재스타일+저비용) 명시. stale bit 정리(:3100 OLD 대조→main 대조, 진행순서 R6→R6a~e).

## 2026-07-03 — 커밋 룰: PROGRESS + 활성 트래커를 코드와 같은 커밋에 동반 갱신
- `rules/common/git.md` “Before Every Commit” 확장 — 기존 PROGRESS 갱신에 더해 **현재 검토 중인 체크리스트/트래커 md**(예 `SCREEN-REDESIGN-EDITOR.md`)의 내용·완료상태 변경도 **같은 커밋에** 반영하도록 명문화(별도 커밋으로 미루지 않음).

## 2026-07-03 — 에디터 재디자인 R5 마무리: 인스펙터 탭 바 반응형 + 트래커 완료 처리
- **탭 바 반응형**(`inspector-panel.tsx`) — 패널 루트에 `@container`, 탭 라벨 span에 `@[430px]:grid-cols-[1fr]`. 폭 넉넉하면(≥430px) 전 탭 라벨 펼침, 좁으면 기존대로 선택 탭만 라벨(아이콘엔 tooltip 유지) → 아이콘 숨김 없이 잘림 방지. 브레이크포인트=영문 4라벨 실측치 ~410px + 여유 20px, 최종 안전망은 `overflow-hidden`. 빌드 CSS에 `container-type:inline-size`·`min-width:430px` 생성 확인.
- **R5 완료 처리**(트래커) — R5a~d는 이미 main에 구현·머지(속성 ed8de58, 맵 a5044ce, 승인/활동 37581d8 등)인데 표가 ⏳로 stale이었음 → 전부 ✅ + 커밋 열 기입. 컴포넌트 상단 stale 주석(“속성 탭만 완성”)도 현행화.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 에디터 재디자인 R6a: 컨텍스트 메뉴 시각 통일(컴포넌트)
- **R6 착수**(브랜치 `feat/editor-redesign-r6`, main 기준) — 컨텍스트 메뉴 재스타일. 범위=재스타일+저비용(신규 동작 복제·전체선택·앞뒤추가·Enter편집모달은 후속). 목업 5장 기준 전 메뉴 시각 통일.
- **R6a 컴포넌트 공통**(`context-menu.tsx`) — 패널 `rounded`→`rounded-md`·`py-1`→`py-1.5`(라운드/여백 통일), danger(삭제) 칩 `KBD_DANGER_CLASS`(error 틴트 `border-error/30 bg-error/10 text-error`, 목업 빨간 Del 칩). menuHeight 클램프 +8→+12 동기화. 내용/동작 변경 없음.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 버전 카드 상세: 아이디 이름 옆 작게 + 날짜 텍스트 박스 위쪽
- **아이디** — 별도 열 → 이름과 같은 셀에 인라인(바로 옆), 폰트 `text-[10px]`(text-fine 12px보다 작게)·muted. 이름·아이디 각각 max-w 말줄임 유지.
- **날짜 텍스트 위치** — 날짜 박스 rowspan은 유지, 텍스트만 `align-middle`→`align-top`으로 박스 위쪽에.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 버전 카드 상세: 행 세로 중앙정렬 + 날짜 박스 rowspan 유지·시간과 상하 정렬
- **행 세로 중앙정렬** — `tr` `align-top`→`align-middle`. 왼쪽 상태필과 우측(이름·아이디·시간) 높이 중앙이 맞음(#2).
- **날짜 박스 rowspan 유지 + 정렬** — 날짜를 (직전 커밋의) 콘텐츠 높이 span에서 다시 **td 테두리(rowspan)**로 되돌려 여러 행을 덮되, 시간도 **td 테두리(셀=행 높이 채움)**로 만들어 rowspan 셀의 상단=첫 행·하단=마지막 행 → 첫/마지막 시간 박스와 상하 정확히 정렬(테이블 구조상 보장).
- 경계 `border-border-strong`·폭 고정(날짜 w-24·시간 w-14)은 유지.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 버전 카드 날짜/시간 박스: 진한 경계·폭 고정·상하 정렬
- **경계 진하게** — 날짜(연한 `border-divider`)·시간(`border-hairline`) → **`border-border-strong`**(#c9c9d1). 거의 안 보이던 테두리 가시화.
- **폭 고정** — 시간 박스 `w-14`(값에 따라 폭 안 흔들림), 날짜 박스 `w-24`, 둘 다 `text-center`·`whitespace-nowrap`.
- **상하 정렬** — 날짜 박스를 td 테두리(rowspan 높이 채움)에서 **내부 span(콘텐츠 높이)**로 변경 → 옆 시간 박스와 상단·하단 위치 동일(td는 align-top 유지).
- 검증: 프론트 lint 0·build OK(`.border-border-strong` 유틸 생성 확인).

## 2026-07-03 — 설정 승인큐 탭 everyone 접근(추후 개인별 승인 페이지 자리)
- **승인큐 탭 접근 개방** — `app/settings/page.tsx`에서 큐를 sysadmin 카테고리(depts/users와 함께)에서 빼 별도 **everyone 카테고리(`admin.catApprovals`)**로 분리. 누구나 좌측 탭에서 접근 가능.
- **내용 처리** — 큐 API 3종(pending groups/approval-requests/checkout)은 sysadmin 전용(403)이라, sysadmin은 기존 `ApprovalQueue`, 그 외는 **"준비 중" 안내**(`admin.approvalsComingSoon`) — 에러 토스트 방지. 개인별 승인 모음 콘텐츠는 후속.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 승인자 관리 오너+sysadmin 허용 + .env.example 정리
- **승인자 관리 권한** — 오너 전용 → **오너 OR sysadmin**. 백엔드 `set_approvers`에 sysadmin 오버라이드(세팅 화면은 이미 sysadmin=owner라 UI만 열리고 저장 시 403이던 잠재버그도 해소), 에디터 `canManageApprovers`에 `isSysadmin` 추가. 테스트 `test_set_approvers_owner_only`는 enforce로 전환 + sysadmin 허용 케이스 추가.
- **.env.example 정리** — sysadmin 섹션 명확화: `SYSTEM_ADMIN_LOGIN_IDS`(require_admin 별개)와 `BPM_SYSADMINS`(sysadmin) 구분, 서버(Keycloak 사용자명)/로컬(backend/.env, admin.sys) 각각 명시. 옛 예시 `admin.kim` 제거.
- 검증: 백엔드 381 passed·ruff clean / 프론트 lint 0·build OK.

## 2026-07-03 — 피커 모달: 선택 목록을 피커 위로 + 신규 항목 페이드인
- **문제**: 피커 드롭다운이 아래로 열려, 아래에 있던 선택 항목 리스트를 가려 실시간 추가가 안 보임.
- **선택 목록을 피커 위로** — 피커가 위·리스트가 아래였던 곳을 스왑: `approver-manager`·`group-detail`(블록 이동), `create-map-dialog`(협업자·결재자 `flex-col-reverse` 래퍼로 라벨 유지한 채 표시순 반전). `approvers-panel`·`collaborators-panel`·`groups-panel`은 이미 리스트가 위라 유지.
- **신규 항목 페이드인** — `globals.css` `@keyframes item-fade-in`(+`prefers-reduced-motion` 가드) → `.animate-item-in`을 로컬 상태 리스트 항목(approver-manager·group-detail·create-map·groups-panel)에 부여. 항목 마운트 시에만 재생돼 새로 추가된 것만 부드럽게 등장. (reload 기반 approvers/collaborators-panel은 전체 리플래시 방지 위해 미적용)
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 홈 상세에도 "이 버전으로 가기" + 에디터 ?version= 진입
- 홈(`app/page.tsx`) MapDetailCard에 `onGoToVersion` 연결 — 라우터로 `/maps/[id]?version=<vid>` 이동. 에디터에서만 보이던 버튼이 **홈 오른쪽 상세**에도 노출(현재 버전 개념 없어 전 버전에 노출).
- 에디터가 `?version=<id>`로 진입 시 해당 버전으로 개시(기본 선택보다 우선, `window.location.search`).
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 버전 카드 펼침 시 "이 버전으로 가기" 버튼
- 버전 타임라인 카드를 펼치면 버전 이름 바로 아래 **"이 버전으로 가기"** 버튼 노출(현재 보는 버전 제외). 클릭 시 `switchVersion`(전환 전 `saveCurrentScope`로 저장 → 손실 없음). 카드 토글과 분리(`stopPropagation`).
- `VersionTimeline`·`MapDetailCard`에 `onGoToVersion`·`currentVersionId` prop 추가, 에디터 버전 기록(MapDetailCard only="versions")에서 연결. 홈은 미연결(버튼 미노출). i18n `home.goToVersion`.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 승인탭 체크아웃 노출 축소·헤더 위 스왑 + 버전필 호버 아코디언(진행중 버전 바로가기)
- **체크아웃 탭 노출** — draft/rejected에서만(pending/approved/published/expired는 비어 있어 숨김). 위치를 워크플로 상태 헤더 **위로 스왑**(approval-panel).
- **버전필 호버 아코디언** — VersionPill 호버 시 게시 안 된(진행 중) 최근 버전이 있으면 아래에 플로트 아코디언으로 펼쳐져 바로가기(버전 마커·이름 + 상태 뱃지, 들여쓰기 커넥터). 클릭 시 전환(편집 중이면 확인 모달). pill↔패널 호버 갭은 `pt-1`로 브리지. 드롭다운 전환 로직은 `handlePick`로 공용화.
- 검증: 프론트 lint 0·build OK.

## 2026-07-03 — 회수 권한 상태별 분리 + 회수 모달 제출자→회수자 한줄 핸드오프(펼침 애니)
- **회수 권한** — 승인요청 단계(pending/approved)는 **제출자만**, 반려(rejected)는 현행대로 **+오너·sysadmin**(제출자 부재 대비). 백엔드 `withdraw_version` 상태별 게이트, 프론트 `canWithdraw`도 동일(rejected에서만 오버라이드). 신규 `test_withdraw_override_blocked_on_pending`.
- **회수 모달 핸드오프** — 체크아웃+제출자를 한 줄로(`제출자 → 회수자`)로 합쳐 누구에게 넘어가는지 한눈에. 제출자(중립)·회수자(accent) 모두 **필(pill)** 형식. **회수자≠제출자일 때만** 화살표(폭 중앙)가 1초에 걸쳐 좌→우로 늘어나고 you(오른쪽 정렬, ellipsis 없이 클립 허용)가 페이드인, 펼침 후 you를 페이드로 1회 깜빡(`WithdrawHandoff` + `ConfirmDialog.banner` 슬롯). 승인 초기화 안내 행 유지.
- 정리 — 미사용 i18n 키 `approval.checkoutToMe`·`approval.submitterBadge` 제거.
- 검증: 백엔드 381 passed·ruff clean / 프론트 lint 0·build OK.

## 2026-07-03 — 승인 후 거절 시 승인자 상태 'Rejected' 반영
- **버그**: 이미 승인한 승인자가 거절하면 거절은 되지만 승인자 목록에 상태가 'Approved'로 남음.
- **백엔드** — `reject_version`이 거절자의 `VersionApproval` 레코드 삭제(approvals에서 제외). `get_workflow_state`가 `rejected_by`(rejected 상태일 때 최근 'rejected' 이벤트 actor) 노출, `WorkflowStateOut`에 필드 추가.
- **프론트** — `WorkflowState.rejected_by` 추가. 모달 `approverStatusLines`·사이드 `ApprovalPanel` 목록 모두 반려자를 **Rejected**(X·error) 우선 표시. `approval.statusRejected` i18n(en "Rejected"/ko "반려").
- 검증: 백엔드 380 passed·ruff clean(신규 `test_reject_removes_own_approval_and_sets_rejected_by`) / 프론트 lint 0·build OK.

## 2026-07-03 — 전이 모달 재디자인(요약박스+영어 상태뱃지) + 체크아웃 용어 통일 + 회수 모달 체크아웃 정보
- **용어 통일** — UI의 "점유권/점유자/holder" 표현을 일괄 **체크아웃(checkout)** 으로(ko "점유권"→"체크아웃"·"점유자 없음"→"체크아웃 없음"·"편집권한 요청"→"체크아웃 요청" 등, en "No holder"→"Not checked out"). i18n 값만 변경(t() 사용처 자동 반영).
- **모달 디자인 통일(맵 삭제 모달식)** — `ConfirmDialog`에 행 우측 **상태 뱃지**(`badge`)·본인 **하이라이트**(`highlight`)·복수 요약박스(`sections`) 추가. 전이 모달(제출/승인/거절/회수/게시)의 산문 body를 버전 서브타이틀(`formatVersionMarker · label`)로 압축, 핵심은 요약박스/필로.
- **승인자 상태 = 영어 뱃지** — 승인자 목록 모달(승인/거절/회수)의 상태는 로케일 무관 **"Approved"/"Pending"** 영어 고정, 이름은 좌측·상태는 행 우측 끝 뱃지, 본인 행 accent 하이라이트.
- **회수 모달 요약** — **기존 제출자(submitter)** + **"→ 나"**(회수 시 체크아웃 이관) + "승인 초기화" 요약박스를 승인자 목록과 함께 표시. (회수 대상은 제출 시 체크아웃이 해제돼 보유자가 늘 없으므로 보유자 대신 제출자를 노출.)
- 검증: 프론트 lint 0·build OK. (픽셀 스모크는 사용자 Windows/서버 환경)

## 2026-07-03 — 점유 이동 draft 전용화 + 회수 오너/sysadmin 오버라이드 (거절본 점유 버그)
- **버그**: 거절본에 요청→승인으로 점유가 제출자와 다른 사람(B)에게 넘어가면, B(홀더)는 회수 불가·제출자 A만 회수 가능·A 회수 시 점유가 A로 복귀. 원인 — `withdraw_version`·프론트가 현재 홀더가 아닌 `submitted_by` 기준.
- **수정(점유 이동 draft 전용)** — 거절본이 홀더를 못 갖게 해 구조적으로 차단: `request_checkout`·`transfer_checkout` 허용 상태 `draft,rejected`→`draft`, `decide_checkout_request`에 draft-only 게이트 추가(이월 요청 승인 차단), 프론트 `checkoutInteractive`(approval-panel) `draft||rejected`→`draft`.
- **회수 오버라이드** — `withdraw_version` 권한 `submitted_by==user OR owner OR sysadmin`(제출자 부재 대비, transfer/decide와 일관). 프론트 `canWithdraw` prop 신설(page→ApprovalPanel→WorkflowActions), 게시는 제출자 전용 유지.
- 검증: 백엔드 379 passed·ruff clean(신규 `test_withdraw_owner_sysadmin_override`·`test_transfer_blocked_on_rejected`·`test_decide_blocked_on_non_draft`, `test_withdraw_submitter_only` enforce 전환) / 프론트 lint 0·build OK.

## 2026-07-02 — 버전 카드 상세: 마커·sticky·스크롤바숨김 재적용 + 스크롤 길이 제한
- 세 가지 재적용 — 65e094b 복원(헤더 버전 마커 `v{n}`/`(Draft)v.{n}`+말줄임, 1열 단계 필 sticky+cardBg, 가로 스크롤바 숨김).
- **스크롤 길이 제한** — 이름·아이디 열에 `max-w`(8rem·6rem)+truncate → 사이드바에서 상세 가로 스크롤이 너무 길어지지 않게(내용 폭 상한). 넓은 홈에선 w-full로 채워 스크롤 없음.
- 검증: 프론트 lint 0·build OK.

## 2026-07-02 — 버전 카드 상세: a151936 원본 디자인 복원 + 좁을 때만 좌우 스크롤
- 사용자 요청 — 내용 디자인은 `0fe62ef` 직전(`a151936`) 원본 그대로, 상세만 좁을 때 좌우 스크롤. 그간의 마커/sticky/scrollbar-hidden/flex(0fe62ef·65e094b·ff74c91)로 크기·정렬이 변한 것을 되돌림.
- `git checkout a151936 -- version-timeline.tsx`로 원본 복원(테이블 + rowspan 날짜박스, 헤더 마커·말줄임 없음, sticky 없음) 후, 상세 테이블만 `overflow-x-auto` + `w-full min-w-max`로 감싸 넓으면 채우고 좁으면 넘쳐 좌우 스크롤(스크롤바 표시 → 날짜·시각 도달 가능).
- 검증: 프론트 lint 0·build OK.

## 2026-07-02 — 버전 카드 상세: 날짜·시간 항상 표시(가로스크롤 폐기)
- **문제**: 상세 테이블에서 이름 열 `w-full`이 공간을 다 먹어 날짜·시각이 가로 스크롤(스크롤바 숨김) 밖으로 밀려 안 보임.
- **수정** (`version-timeline.tsx`) — 가로 스크롤 테이블(`w-max`/sticky/`scrollbar-hidden`) 폐기 → 오버플로 없는 flex 행 `[단계 필][이름·아이디 말줄임][날짜·시각 우측 고정]`. 좁은 사이드바·넓은 홈 상세 모두 날짜·시각 항상 표시. rowspan 날짜박스·cardBg 계산 제거.
- 검증: 프론트 lint 0·build OK.

## 2026-07-02 — 문서 갱신 + 완료/폐기 문서 정리
- **README 갱신** — 기능 목록에 승인 워크플로·버전 라이프사이클·점유권·권한(RBAC)·인증 추가. 시드 섹션을 종합 데모(조직도·직원401·맵12·그룹6, `admin.sys`, 로그인 피커, `DEV_ENFORCE_PERMISSIONS`)로 갱신. 죽은 링크 제거, Python 3.11→3.12.
- **폐기/완료 문서 삭제** — `docs/permission-demo-walkthrough.md`(삭제된 seed_permission_demo 기준·obsolete)·`docs/version-lifecycle-test-scenarios.md`(구현·pytest 완료된 검토 아티팩트, 삭제 시드 참조)·`docs/superpowers/HANDOFF-frontend-ui-improvements.md`(머지 완료 핸드오프)·`SCREEN-REDESIGN.md`(머지 완료 리디자인 트래커).
- 보존: `docs/superpowers/plans·specs/`(설계 기록)·`docs/spec.md`·PROGRESS(로그).

## 2026-07-02 — 구 시드 정리 + 기동 재시드 가드 + 로컬 권한검증 ON
- **구 데모 시드 5개 삭제** — `seed_reference_demo`·`seed_permission_demo`·`seed_compare_demo`·`seed_nesting_demo`·`seed_version_lifecycle_demo` 제거(reset_db 미사용). `seed_invariants`(테스트 의존)·`seed_org_demo`·`reset_db` 유지.
- **기동 재시드 가드** — `seed_local_employees`가 "직원 있으면 skip" → uvicorn 기동 시 구 5명(admin.kim 등)이 종합 시드 DB(401명)에 다시 섞이던 오염 방지. 빈 DB(테스트·최초)만 시드. dev.db 검증: 기동 재시드해도 401 유지·admin.kim 없음.
- **로컬 권한검증 ON** — `backend/.env`(gitignore) 생성: `DEV_ENFORCE_PERMISSIONS=true` + `BPM_SYSADMINS=admin.sys`. conftest에 enforce/auth baseline 고정 추가 → `.env`가 테스트에 새지 않음(376 passed 유지).
- 검증: 백엔드 376 passed·ruff clean(.env 존재 상태), reset_db OK.

## 2026-07-02 — 시드 DB 전면 재구성(조직도 400명·맵12·그룹6) + 로그인 피커
- **종합 시드 `scripts/seed_org_demo.py`** — 기존 분산 데모(reference/permission/compare/nesting/lifecycle) 대신 단일 시드로 통합. reset_db는 drop_all→seed_org_demo→verify만.
- **조직도** — 센터2(+관리센터)·담당2/센터·팀2~3/담당·파트1~3/팀, 리프 깊이 혼합(파트/팀/담당 리프). 직원 **401명(admin.sys 포함)** 라운드로빈 분포.
- **맵 12**(공개6/비공개6) — 오너·편집자·뷰어(유저/부서/그룹 혼합)·승인자, 버전 **v1~v5 게시(정상 워크플로 이벤트+승인이력)** + 최상위 draft(일부 rejected), 일부 이력에 반려·회수. **그룹 6**(유저2·파트2·혼합2).
- **로컬 로그인 피커** — `DevLoginModal`을 하드코딩 5명→백엔드 디렉터리 fetch+검색으로 교체(관리자 배지). `DirectoryUserOut`/`DirectoryUser`에 `role` 추가.
- 검증: reset_db 실행 OK(employees=401, maps=12, versions=72[만료48/게시12/draft10/rejected2], groups=6). 백엔드 376 passed·ruff clean / 프론트 lint 0·build OK. (구 시드 스크립트·구 데모 문서는 파일로 잔존하나 미사용)

## 2026-07-02 — 점유권 탭 프론트 UI(접이식·요청자·호버 결정·철회)
- **CheckoutPanel** (`checkout-panel.tsx`) — 프로그레스바 위 접이식(기본 접힘) 섹션. 현재 점유자 + 출처(누구에게서)·획득 상대시각("~분 전"), 미결 요청자 카드. 요청 있으면 헤더 **빨간 닷 + 개수**.
- **호버 결정·철회** — 결정권자(보유자/오너/sysadmin)는 요청 카드 호버 시 승인/거절 아이콘, 요청자는 자기 요청 철회(X). ApprovalPanel의 기존 단건 배너를 이 패널로 대체.
- **view-only(item 5)** — draft/rejected에서만 조작 가능(`interactive`), 그 외 상태는 opacity-60 + 버튼 숨김(확인용).
- **복수 요청 반영** — 헤더 "요청됨"을 본인 요청 여부로 수정. `WorkflowState`에 `pending_checkout_requests`/`checkout_holder_since`/`checkout_from` 타입 추가, `withdrawCheckoutRequest` API, `relativeAgo` datetime 헬퍼, i18n(checkout.*·time.*).
- 검증: 프론트 lint 0·build OK. (백엔드는 직전 커밋 65cf37d, 376 passed)

## 2026-07-02 — 점유권 탭 백엔드(요청자 복수·자동거절·철회·provenance)
- **요청자 복수 허용** — `request_checkout` dedup을 버전당→**요청자당 1건**으로 전환(여러 편집자 동시 요청 가능). request/transfer는 **draft/rejected에서만**(409 게이트).
- **승인 시 자동 거절 + provenance** — `decide` approve가 같은 버전의 다른 미결 요청을 자동 `rejected` 처리. 점유 이전(approve/transfer) 시 `MapVersion.checked_out_from`(직전 점유자=누구에게서) 기록. `_add_missing_columns` 보강.
- **요청 철회** — `POST /checkout-requests/{id}/withdraw`(요청자 본인만, pending만).
- **스키마(non-breaking)** — `WorkflowStateOut`에 `pending_checkout_requests`(복수)·`checkout_holder_since`(언제)·`checkout_from`(누구에게서) 추가, 기존 `pending_checkout_request`(단건)는 하위호환 유지.
- 검증: 백엔드 376 passed·ruff clean. (프론트 점유권 탭 UI는 후속 커밋)

## 2026-07-02 — 승인자 관리 설정탭 게이트 + 반려본 회수 플로우
- **승인자 관리 구멍 확인/보완** — 백엔드 `set_approvers`는 pending/approved면 409(모든 경로 차단, 테스트 있음)라 데이터는 안전. 갭은 **설정 페이지 `ApproversPanel` UI가 상태 게이트 없이 버튼 노출**하던 것 → `underApproval`(설정 페이지가 `getMap` versions로 계산) prop으로 추가/삭제 잠금 + 안내 배너. 에디터는 기존대로 `canManageApprovers`로 게이트. (expired+published만 있고 pending 없으면 변경 허용 = 안전, 다음 사이클용)
- **반려본은 회수(기록) 후 수정** — 프론트 `WorkflowActions`: rejected에서 submit 제거, withdraw(회수) 노출(submitter). 백엔드 `withdraw_version`: 반려본 회수는 승인 0건이어도 항상 `withdrawn` 기록(제출·반려 이력 유지). 즉 rejected → 회수(→draft, 기록) → 편집 → 재제출. 바로 재승인 요청 불가. 테스트 `test_withdraw_from_rejected_keeps_record`.
- 검증: 백엔드 374 passed·ruff clean / 프론트 lint 0·build OK.

## 2026-07-02 — 버전 카드 스크롤바 숨김·정렬 복구·sticky 배경 매칭
- **가로 스크롤바 숨김** — 상세 테이블 스크롤 컨테이너에 `scrollbar-hidden`(스크롤 중에도 숨김).
- **넓은 폭 좌우정렬 복구** — 앞서 `w-max`로 바꾸며 깨진 홈 상세 정렬을 `w-full min-w-max`(넓으면 100%·좁으면 max-content 오버플로) + 이름 열 `w-full` 복원으로 해결 → 넓은 폭에선 날짜/시간 우측 정렬, 좁은 폭에선 가로 스크롤.
- **sticky 1열 배경을 카드 배경에 매칭** — `bg-surface`→카드별 `cardBg`(현재 카드 `bg-accent-tint/30`, 그 외 `bg-surface`) + `group-hover` 동기화. 카드에 `group` 추가. 흰 열로 튀던 문제 해결.
- 검증: 프론트 lint 0 / build OK.

## 2026-07-02 — sysadmin 전맵 가시성 확인(코드 정상) + 회귀 테스트
- **확인 결과**: `list_maps`는 `is_sysadmin`이면 필터 없이 전 맵 반환 + `my_role="owner"` 부여(코드 정상). 회귀 테스트 `test_list_maps_sysadmin_sees_ungranted_private` 추가(grant 없는 private도 보임). 373 passed.
- **원인은 환경/식별자**: sysadmin 판정은 `is_sysadmin()` = **`BPM_SYSADMINS`**(콤마 구분 loginId). 이는 디렉터리 admin(`SYSTEM_ADMIN_LOGIN_IDS`→`Employee.role="admin"`)와 **별개 변수**. enforce/auth ON에서 `BPM_SYSADMINS`에 로그인ID가 없으면 전 맵 안 보임. 진단: `/api/me`의 `is_sysadmin` 확인.

## 2026-07-02 — 버전 카드 마커·말줄임·가로스크롤(사이드바 대응)
- **버전 카드에 버전 마커** (`version-timeline.tsx`) — 헤더에 버전 필과 동일한 마커(번호 작게 회색 `v{n}`/`(Draft)v.{n}` + 이름 강조)를 `formatVersionMarker`로 노출.
- **좁은 폭 말줄임/반응형** — 마커+이름을 `min-w-0 flex-1 truncate`로 묶어 사이드바처럼 좁아지면 이름을 이클립스 처리(깨짐 방지). 상태/현재 배지·시각은 `shrink-0`.
- **펼침 상세 가로 스크롤 + 1열 sticky** — 상세 테이블을 `overflow-x-auto`로 감싸고 `w-max`(내용 폭)로 바꿔 좁은 폭에서 가로 스크롤. 1열 단계 필 `<td>`는 `sticky left-0 bg-surface`로 고정 → 우측 사이드바에서 가로 스크롤로 시간대 확인 가능.
- 검증: 프론트 lint 0 / build OK (백엔드 변경 없음).

## 2026-07-02 — 모달 승인자 현황 + 승인자 관리 드래프트 한정
- **승인/거절/회수 모달에 승인자 현황** — 각 승인자를 승인 완료(Check)/대기(User) 아이콘 + `이름 · 상태`로 나열, **본인은 accent 하이라이트("나/you")**. `workflow.approvals`/`approvers` 기반. (제출 모달은 기존 명단 유지)
- **거절→나머지 비활성 확인**: `reject_version`은 `pending`에서만 동작하고 즉시 `rejected`로 전이 → 승인/거절 버튼은 `status==="pending"`에서만 렌더되므로, 1명이 거절하면 다른 승인자에겐 버튼이 사라짐(백엔드도 409). 의도대로 동작 확인.
- **승인자 관리 = 오너 + 드래프트 한정** — `set_approvers`는 종전대로 오너(created_by)만; 추가로 **pending/approved 버전이 있으면 409**(진행 중 변경이 tally를 깨 오류 유발). 프론트 ApprovalPanel의 관리 링크도 `canManageApprovers = 오너 && !승인진행중`으로 게이트(`isMapOwner` prop→`canManageApprovers`). 테스트 2종(pending 차단/draft 허용).
- 검증: 백엔드 372 passed·ruff clean / 프론트 lint 0·build OK.

## 2026-07-02 — 전이 액션 모달 통일(제출/승인/거절/게시/회수)
- **모달 디자인 통일** — 제출·승인·거절·게시·회수 확인을 모두 `ConfirmDialog`(아이콘 원 + 제목 + 본문 + 확인/취소)로 일원화. `WorkflowActions`의 자체 거절 모달·portal 제거(버튼만 노출, 각 액션이 page.tsx 모달을 연다). `onReject` 시그니처 `(reason)`→`()`.
- **ConfirmDialog 확장** — 선택 `input`(textarea) + `confirmDisabled` 추가 → 거절 사유 입력창을 통일 디자인 안에서 유지(danger, 사유 없으면 확인 비활성).
- **게시 모달** — 현재 게시본(`v{n} · label`)이 만료된다는 내용 라인 표시(현재 published 버전 조회).
- **회수 모달** — 기존 승인이 초기화되어 승인자들이 다시 승인해야 함을 안내.
- **거절 사유 노출**: 에디터 상단 상태 스트립의 빨간 배너(`wf.rejectedBanner`, 현재 버전 rejected 시). i18n `approval.{approve,publish,withdraw,reject}Confirm*` 추가.
- 검증: 프론트 lint 0 / build OK (백엔드 변경 없음).

## 2026-07-02 — 회수 조건부 트랙킹 + 승인요청 모달 + 승인탭 헤더
- **회수 조건부 트랙킹** (`withdraw_version`) — 현재 승인요청 사이클의 승인 수로 분기(submit이 매번 `VersionApproval` 리셋): 승인 0건 회수→해당 `submitted` 이벤트 삭제·`withdrawn` 미기록(흔적 없음), 승인 1건 이상 후 회수→`withdrawn` 기록(제출·승인 이력 유지). 프론트 타임라인의 withdrawn 제외 필터는 되돌림(이제 표시). 테스트 2종(0건 삭제/≥1건 유지).
- **승인 요청 확인 모달** — 제출 버튼이 바로 제출하지 않고 현재 승인자 목록을 `ConfirmDialog`(재활용)로 보여준 뒤 확인 시 제출. i18n `approval.submitConfirm*`.
- **승인 탭 헤더** — 좌상단 버전 풀네임 텍스트 라벨 제거, 그 자리에 버전 필(전환) 배치. 아이콘 액션은 `ml-auto`로 우측 정렬.
- 검증: 백엔드 370 passed·ruff clean / 프론트 lint 0·build OK.

## 2026-07-02 — 회수 트랙킹 백엔드 제외 + 버전 마커 표시
- **회수 이벤트 백엔드 제외** — `withdraw_version`에서 `record_version_event(... "withdrawn")` 제거 → DB에 회수 이벤트 자체를 안 남김(프론트 필터와 이중 안전). 테스트 `test_withdraw_records_event`→`test_withdraw_not_tracked`로 반전.
- **버전 마커 헬퍼** (`version-name.ts`) — `nextVersionNumber`(최대 번호+1) + `formatVersionMarker`: 번호 있으면 `v{n}`(long=`version {n}`), 드래프트는 `(Draft)v.{다음번호}`. vitest 9 통과.
- **버전 필 표시** (`version-pill.tsx`) — 버튼·드롭다운에서 마커를 작게 회색(`text-fine text-ink-tertiary`), 이름을 강조(`font-semibold`)로 분리. 승인본 번호 규칙은 유지.
- **우측 Properties 탭** (`inspector-panel.tsx`) — 맵 이름 위에 작은 `version {n}`(드래프트는 `(Draft)v.{n}`) 표시(`mapVersionMarker` prop, page.tsx 주입).
- 검증: 백엔드 369 passed, ruff clean · 프론트 vitest 9 / lint 0 / build OK.

## 2026-07-02 — 승인탭 갱신/워터마크/버전기록 3건
- **① 게시 후 우측 실시간 반영** — `runTransition`이 트랜지션마다 `getMap`으로 전체 버전 재로딩 → 게시 시 직전 published가 expired로 즉시 바뀌어 "published 2개" 안 보임(기존엔 작동 버전 1개만 로컬 병합).
- **② "Expired" 워터마크 글자간격 축소** — `tracking-[0.35em]`→`tracking-wide`, uppercase 제거(“Expired” 그대로). `approval-panel.tsx`.
- **③ 버전 기록 실시간 갱신 + 회수 제외** — 승인탭 하단 `MapDetailCard`(자체 fetch)에 `reloadKey` prop 추가, `runTransition`이 bump해 단계마다 재조회(이벤트 추가/상태 반영). `version-timeline.tsx`는 `withdrawn` 이벤트를 트랙킹에서 제외(필터).
- 검증: 프론트 lint 0 errors, production build OK.

## 2026-07-02 — 버전 라이프사이클 디테일 수정 5건
- **① 뷰어 드래프트 생성 차단** — 백엔드 `create_version`에 `require_map_role("editor")`, `acquire_checkout`에 `require_version_map_role("editor")` 게이트 추가. 프론트 "새 버전"(+) 버튼을 `isEditorRole`일 때만 노출.
- **② 점유 sticky(지정 인계 전용·자동해제 없음)** — `checkout.py` `is_checkout_active`를 TTL 만료 없이 "보유자 존재"로 변경. 이탈해도 점유 유지 → 인계는 요청(decide: 보유자/오너/sysadmin) 또는 이전(transfer)만. 프론트 에디터 진입 effect: 언마운트 자동 release 제거, heartbeat→상태 poll로 전환(요청 승인/이전 반영), 뷰어는 조회 생략.
- **③ 만료 시 스테퍼** — `approval-panel.tsx`: expired면 스테퍼 전체 비활성(회색) + "Expired" 워터마크(로케일 무관 고정).
- **④ 드래프트 있을 때 재게시로 중복 생성** — 프론트 "새 버전" 버튼을 `!hasDraft`로 게이트(재게시는 이미 `!hasDraft`). 백엔드는 이미 409 차단(회귀 테스트 통과).
- **⑤ 드래프트 삭제 권한** — 프론트는 이미 `isHolder` 전용. 백엔드 `delete_version`에 보유자|오너|sysadmin 게이트 추가.
- 검증: 백엔드 pytest **369 passed**(신규 게이트 3종 + sticky 테스트 추가/수정), ruff clean. 프론트 lint 0 errors, production build OK.

## 2026-07-02 — 프론트 before/after 비교 검증 방법 문서
- **docs: 프론트 2 + 백 1 비교 검증 요약** (`docs/frontend-compare-verification.md`) — 분기지점 `291f6d9`(A) ↔ HEAD(B)를 worktree로 각각 :3000/:3001에 띄우고 백엔드 1개(:8000)를 `/api` 프록시로 공유. DB 무관(프론트는 API로만 통신) 명시. 좀비 dev 정리·데이터는 로컬 sqlite(라이프사이클 UI는 데모시드)·worktree 정리 포함. PowerShell(사내 Windows) 우선.

## 2026-07-02 — 배포: version_number 컬럼 기동 자동보강
- **fix(db): `map_versions.version_number`를 `_add_missing_columns` 스톱갭에 추가** — 기존 DB(운영 서버 postgres 등)에 컬럼이 없으면 기동 시 자동 보강(nullable, 기존 행 생존)해 publish/workflow 500 회피. 구 스키마 시뮬레이션 검증 PASS + 전체 366 테스트 green(sqlite 무영향). (로컬 Postgres 전환 시도는 접고 로컬은 sqlite 유지 — 관련 문서 삭제.)

## 2026-07-02 — feat/version-lifecycle (test scenarios)
- **docs: 라이프사이클 테스트 시나리오 문서 추가** (`docs/version-lifecycle-test-scenarios.md`) — 정상(P1~P6)·예외(N1~N12)·관리자(A1~A6) 3분류 검토용 매트릭스. 각 시나리오에 화면(3화면 결정) + API 상태코드(403/409/422) 기대치 + 대응 pytest 함수 근거 매핑. 서두에 `DEV_ENFORCE_PERMISSIONS=true` 강제 모드 경고(안 그러면 전원 sysadmin→403 재현 불가) + 시드 엔터티 표. 인용 테스트 50개 green 확인.

## 2026-07-01 — feat/version-lifecycle (final fixes)
- **fix(versions): republish 권한 체크를 상태 체크보다 먼저 실행** — 403 가드를 409 가드 앞으로 이동(소스 상태 유출 방지). 순서: 404(소스 부재) → 403(editor+ 미보유) → 409(draft/pending 상태) → 409(기존 draft 존재) → 생성. sibling 엔드포인트(transfer/request/decide)와 동일 패턴으로 통일. 테스트 변경 없음(기본 테스트 사용자=sysadmin=owner → 권한 패스 후 상태 409 도달).
- **chore(i18n): 미사용 키 `perm.checkout.requestedAt` 제거** — en/ko 양쪽에서 삭제. checkout-requests 패널이 Clock을 인라인으로 렌더링해 이 키를 참조하지 않음(`git grep` 확인). tsc 0 / lint 0.

> **✅ DEPLOY NOTE (RESOLVED 2026-07-02) — feat/version-lifecycle**
>
> ~~기존 테이블에 `map_versions.version_number` 컬럼 미추가 → publish/workflow 500~~ →
> **기동 시 `_add_missing_columns`가 컬럼을 자동 보강**(nullable, 기존 행 생존)하도록 수정됨.
> 이제 서버 배포/덤프 복원 시 **수동 ALTER나 reset_db 불필요** — 기존 데이터 그대로 기동하면 된다.
> (신규 `checkout_requests` 테이블은 종전대로 `create_all`이 생성.)

**feat/version-lifecycle 전체 출하 요약:**
- Task 1: `version_number`(nullable int) + `expired` 상태 + publish 시 채번·이전 published → expired 전환
- Task 2: 점유권 이전(`POST /versions/{id}/transfer-checkout`) — 점유자·owner·sysadmin이 editor+ 대상에게
- Task 3: 점유권 요청(`POST /versions/{id}/request-checkout`) + 결정(`POST /checkout-requests/{id}/decide`)
- Task 4: 만료본 재게시(`POST /versions/{id}/republish`) — published/expired → 그래프 복제 새 draft
- Task 5: 프론트 `VersionStatus`에 `expired` 추가 + `WorkflowState` checkout 필드 + `formatVersionName`
- Task 6: 승인 탭 역할/상태 액션 매트릭스 (이전·요청·재게시 버튼 + pending 결정 배너) + 3개 화면 checkout-request 패널(맵 설정·settings sysadmin·approval panel)
- Task 6b: `GET /checkout-requests/pending` 맵·버전 컨텍스트 + `?map_id=` 필터
- Task 7: 점유권 이전 다이얼로그 검색 가능 편집자 피커
- 데모 시드: `scripts/seed_demo.py`에 checkout_requests 샘플 포함

## 2026-07-01 — feat/version-lifecycle (Task 6b)
- **feat(checkout): pending-requests 큐 맵·버전 컨텍스트 + map_id 필터 (Task 6b)** — `CheckoutRequestQueueOut` 신규 스키마(`map_id·map_name·version_label` 추가). `GET /checkout-requests/pending`: response_model → `list[CheckoutRequestQueueOut]`, 1-query JOIN(CheckoutRequest→MapVersion→ProcessMap), `?map_id=` 옵셔널 필터(per-map 설정 패널용). TDD: `test_checkout_pending_queue_context`·`test_checkout_pending_queue_map_id_filter` 신규(RED→GREEN). 366 passed, ruff clean.

## 2026-07-01 — feat/version-lifecycle (Task 7)
- **feat(approval): searchable editor picker for checkout transfer dialog (Task 7)** — `TransferCheckoutDialog` 컴포넌트 신규(`src/components/version/transfer-checkout-dialog.tsx`): accent 아이콘 원(ArrowLeftRight) + 검색 입력 + 선택 가능 편집자 목록(name primary, login_id secondary). 기존 inline native select → 컴포넌트로 교체. 재게시 ConfirmDialog에 `RotateCcw` 아이콘 추가(rich 레이아웃 활성화). i18n 신규 키 1개(en+ko: `approval.transferSearchPlaceholder`). tsc 0 errors, lint 0 errors(pw-smoke-task8 pre-existing warning 유지).

## 2026-06-29 — feat/version-lifecycle (continued, Task 6)
- **feat(approval): 역할/상태 액션 매트릭스 + checkout request/decide/transfer/republish 배선 + 기본 버전 선택 (Task 6)** — Part A: api.ts에 `transferCheckout·requestCheckout·decideCheckoutRequest·republishVersion·getMapEditors` 추가. Part B: 맵 로드 시 내 draft(점유 보유) → 최신 published → 첫 번째 순 기본 선택. Part C: approvalSlot 우측 아이콘 — 점유자+draft=이전·이름·삭제, editor+미점유+draft=요청(Hand)/요청됨(비활성)+"{이름} 편집 중", editor+expired+draft없음=재게시(RotateCcw). Part D: approval-panel.tsx에 pending_checkout_request 결정 배너(보유자/소유자/sysadmin에게 승인/거절 노출). Part E: 핸들러 배선 + 이전 다이얼로그(minimal) + 재게시 ConfirmDialog. i18n 신규 키 18개(en+ko). tsc 0·lint 0 errors.

## 2026-06-29 — feat/version-lifecycle (continued)
- **feat(version): expired 상태 타입 + WorkflowState checkout 필드 + formatVersionName 테스트 (Task 5 gap fill)** — ① `VersionStatus` 유니온에 `"expired"` 추가 → 연쇄: `version-status.ts`·`status-badge.tsx`·`approval-panel.tsx`(switch exhaustive) + i18n EN/KO 키 2개. ② `WorkflowState`에 `version_number?·checkout_holder?·pending_checkout_request?` 추가. ③ `version-name.test.ts` 신규(vitest 3/3). ④ `VersionPill` expired 필터 없음 확인(변경 없음). tsc 0·lint 0 errors.


- **feat(versions): 만료본 재게시 — published/expired → 그래프 복제 새 draft (Task 4)** — `POST /versions/{id}/republish` 추가: published·expired만 허용(draft·pending 409 차단), 맵당 draft 1개 규약(기존 draft 있으면 409), editor+ 미보유 403, `clone_graph` 재사용(nodes/edges/groups 복제, 새 id), label 승계, 생성자 점유권(`checked_out_by/at`) 부여. TDD: tests 4개 신규(RED→GREEN), 364 passed, ruff clean.

## 2026-06-29 — feat/version-lifecycle
- **feat(versions): 버전 번호 + expired 상태 — 모델·publish 로직 (Task 1)** — `MapVersion.version_number`(nullable int) 컬럼 추가. `workflow.EXPIRED` 상수. `publish_version`: MAX(version_number)+1 채번 → 게시 버전에 부여, 직전 published → `expired` 전환 + `expired` 이벤트 로그. `VersionOut.version_number` 필드 노출. `test_version_lifecycle.py` TDD 신규 작성(343 tests 통과, ruff clean).
- **feat(editor): 승인 탭 프론트 선작업 — 버전명 포맷·축소 pill·우측 아이콘 버튼 (feat/version-lifecycle)** — 스펙/계획(`docs/superpowers/specs·plans/2026-06-29-version-lifecycle*`) 기반 프론트 선행: ① `formatVersionName`(게시번호 있으면 `v{n} · {label}`, 미게시 라벨만) + `api.ts` `version_number?` 추가(백엔드 후속). ② `VersionPill` `compact` prop(승인탭 축소) + 라벨/드롭다운에 formatVersionName. ③ 승인탭 상단을 **버전 풀네임 라벨 + 축소 pill + 우측 아이콘 버튼(생성/이름변경/삭제, 호버 라벨)**으로 재구성(텍스트→아이콘, 우측정렬). 검증: tsc/eslint 0·브라우저(As-Is 라벨·축소 pill·아이콘 3, Delete 비활성·콘솔 0). **나머지(점유권 이전/요청·만료본 재게시 매트릭스·모달 + 백엔드 버전번호/만료/점유권 API)는 새 세션 서브에이전트 주도.**

## 2026-06-29
- **refactor(editor): R5 컷오버 — OLD 인스펙터·하단 대시보드 제거, 4탭 단일폭 확정 (feat/editor-compare-redesign)** — **A** OLD 인스펙터 컬럼 통째 삭제(OLD 속성 폼 + 하단 대시보드 승인/버전/다운로드/디자인 4탭). **B** 인스펙터 폭 `×2→×1`(316px), "NEW (R5)"·"OLD" 라벨·비교 accent 보더 제거. **C** orphan 정리: `bottomTab`·`dashboardHeight`(+localStorage 로드/저장)·`startDashboardResize`·`toolButton`. **D** `workflow-dashboard.tsx` 삭제(`ApprovalPanel`로 대체). **버전 CRUD 보존**: OLD 버전 탭이 유일 트리거였던 생성/이름변경/삭제를 승인 탭 버전 pill 옆으로 이관(생성·이름변경 항상, 삭제는 readOnly·단일버전 시 비활성 — OLD 동작 일치). 미사용 import(Bell/GitBranch/GitCompare/Plus/Link/Tooltip)·**F** i18n(`editor.tabVersion/tabDownload/tabDesign/currentVersion`·`dash.resize`·`sidebar.nodeInfo`) 제거. 검증: tsc 0·eslint 0(잔여 warning은 pw-smoke 무관)·브라우저(단일폭 316px·NEW/OLD 라벨 없음·4탭·버전 액션 +New/Rename 활성/Delete 비활성·콘솔 0). **R5 완료.**
- **fix(editor): R5 마무리 — 코멘트 작성자권한·Me아이콘·↵힌트, 승인탭 버전pill+타임라인 이동, 사이드바 노드인포 삭제 (feat/editor-compare-redesign)** — ② **코멘트 해결/재열기/삭제는 작성자에게만 노출**(타인 숨김, `currentUser`=login_id 비교, 백엔드도 author-only). ③ **본인 댓글은 이니셜 대신 Me 아이콘**(Hand, accent 채움). ④ **코멘트 단축키 힌트 "Enter"→↵ 기호**(잘림 완화). ⑤ **버전 타임라인 활동탭→승인탭 하단 이동 + 승인탭 상단 버전선택 pill(전환)**(`VersionPill` 재사용). ⑦ **좌측 사이드바 노드 표시정보 카드 삭제**(맵 탭으로 이관 완료, orphan props·state·import 정리). 답글(replies)은 데이터 모델에 없어 보류(별도 스키마 작업). 검증: tsc/eslint 0·브라우저(승인=As-Is pill+스테퍼+VERSIONS·활동=코멘트만·코멘트 Me Hand아이콘+작성자액션·↵힌트·사이드바 노드인포 제거·콘솔 0). ⏳ 검토대기. **컷오버(OLD 제거)는 사용자 최종 확인 후.**
- **fix(editor): R5c 승인 탭 목업 디자인 + R5d 코멘트 입력 게이팅·노드 네비 (feat/editor-compare-redesign)** — ① **R5c**: WorkflowDashboard 대신 **목업 디자인 신규 `ApprovalPanel`** — 3단계 스테퍼(제출→검토→게시, 상태별 done/active/error)·상태 배지·**승인자 현황**(아바타·이름[getDirectory 해석]·✓승인/대기)·**누구에게 검토 대기**(`approval.pendingOn`)·소유자 관리 링크 + 액션은 `WorkflowActions` 재사용. ② **R5d**: 코멘트 입력 **노드 선택 시만 활성**(미선택 시 "Select a node to add a comment" 점선 안내, `inputDisabled`), **코멘트 클릭 시 해당 노드로 네비게이션**(`onCommentClick`→`handleOutlineSelect(node_id)`). i18n `approval.*`·`comment.selectNodeToWrite`. 검증: tsc/eslint 0·브라우저(승인=스테퍼 Submit✓→Review✓→Publish·Approvers 1 Junho Kim / 활동=노드미선택 점선힌트·선택 시 textarea 활성·콘솔 0). 코멘트 클릭 네비는 시현 맵 코멘트 부재로 wiring만(검증된 handleOutlineSelect 재사용). ⏳ 검토대기.
- **feat(editor): R5c 승인 탭 + R5d 활동 탭 (feat/editor-compare-redesign)** — ① **R5c 승인 탭**: OLD 하단 패널의 `WorkflowDashboard`(스테퍼 Draft→Pending→Approved·승인자 목록·상태·승인요청/승인 액션)를 NEW 승인 탭으로 이관(`approvalSlot`, currentVersion 가드). ② **R5d 활동 탭**: 전체 코멘트(노드 단위 정렬, 작성칸 숨김 `hideInput` — 추가는 속성 탭) + **버전 타임라인**(MapDetailCard에 `only="versions"` 추가해 OLD 디자인 재사용)(`activitySlot`). `InspectorPanel`에 `approvalSlot`·`activitySlot` slot, `CommentSection`에 `hideInput`. **4개 탭(속성/맵/승인/활동) 모두 완성** — OLD 인스펙터 제거·폭 복원은 사용자 전체 승인 후. 검증: tsc/eslint 0·브라우저(승인=WorkflowDashboard 스테퍼·1/1 approved·Manage approvers / 활동=Comments 작성칸숨김+VERSIONS 타임라인 To-Be/As-Is·콘솔 0). ⏳ 검토대기.
- **fix(editor): R5b 협업자 영역을 코멘트 영역처럼 테두리 박스로 감싸 분리 (feat/editor-compare-redesign)** — 멤버 아코디언 `<details>`에 속성탭 코멘트 영역과 동일한 `rounded-md border border-hairline px-3 py-2` 박스 + `text-fine font-semibold text-ink` summary 적용 → 시각적으로 분리. 검증: tsc/eslint 0·브라우저(border+rounded 박스 확인). ⏳ 검토대기.
- **fix(editor): R5b 맵 탭 멤버 카드 = OLD '허용 인원' 디자인 재사용 + 아코디언 (feat/editor-compare-redesign)** — 자체 PersonRow/RoleBadge 디자인 폐기, **`MapDetailCard`에 `only="members"` 추가**(멤버 외 섹션·내부 헤더 게이트)해 OLD 인스펙터의 '허용 인원' 카드(아이콘·ME 손배지·타입별 그룹[Individuals/Teams/Groups]·**클릭 펼침**[id/직위/부서레벨 pill]·역할 배지)를 **그대로 재사용**. `MapInspectorTab`을 가시성 + **멤버 아코디언(`<details>`)** + 설명으로 단순화(perms/directory 자체 fetch 제거 → MapDetailCard 내부 처리). 검증: tsc/eslint 0·브라우저(COLLABORATORS 아코디언·ME 손아이콘·클릭→admin.kim·Owner 배지·OLD 인스펙터 VERSIONS 무결·콘솔 0). 사용자 지침(메인>상세 멤버/팀 디자인 재사용) 반영. ⏳ 검토대기.
- **fix(editor): R5a 속성 빈상태=맵타이틀+버전전환·앱아이콘 + 코멘트 힌트 키배지 (feat/editor-compare-redesign)** — ① **속성 탭 빈상태**: "Nothing selected" 대신 **맵 타이틀 + 버전 pill(전환 가능, 상단 `VersionPill` 재사용·확인모달 포함)**, 아이콘은 그룹 아이콘(Boxes)→**앱 대표 아이콘 `Workflow`**(로그인 화면 동일). `InspectorPanel`에 `mapName`·`versionControl` slot 추가, page.tsx가 `<VersionPill>` 주입. ② **코멘트 단축키 힌트를 키 배지(kbd)**로 — `[Enter] 줄바꿈 · [Ctrl]+[Enter] 전송` 가시성 향상. i18n `comment.keyNewline/keySend`. 검증: tsc/eslint 0·브라우저(빈상태 Workflow+맵명+As-Is pill·힌트 kbd 배지). ⏳ 검토대기.
- **fix(editor): R5b 맵 탭 오너/협업자 카드 — 기존 멤버 카드 디자인 재사용(RoleBadge·클릭 펼침) (feat/editor-compare-redesign)** — `map-inspector-tab.tsx`의 자체 역할 배지(ROLE_BADGE)·정적 PersonRow를 폐기하고 **기존 `RoleBadge` 컴포넌트 재사용** + **클릭 펼침 효과**(메인>상세 멤버 카드 패턴) — 카드 클릭 시 로그인 아이디 노출. 사용자 지침(앞으로 유사 정보는 멤버/팀 카드 디자인 재사용) 반영. 검증: tsc/eslint 0·브라우저(Owner RoleBadge·클릭→admin.kim 노출). ⏳ 검토대기.
- **fix(editor): R5 코멘트 박스 재구성 + 탭 스크롤 완전숨김 (feat/editor-compare-redesign)** — ① **작성칸 자동 확장**(스크롤 없이 아래로 늘어남) — `taRef`+`grow()`로 내용 높이만큼 height 재설정, `overflow-hidden`. ② **전송 버튼·단축키 힌트를 박스 안 하단 라인**으로(테두리 박스: 위 textarea, 아래 "Enter 줄바꿈 · Ctrl+Enter 전송" + 전송). Enter=줄바꿈/Ctrl+Enter=전송 유지. ③ **우측 탭 스크롤 완전 숨김**(`scroll-soft`→`scrollbar-hidden`, 4탭 공통). ④ **코멘트 리스트 스크롤은 노출** + **맨 아래로 버튼**(`scrollToBottom`, 코멘트 2개+ 시). i18n `comment.hint/goToBottom`. 검증: tsc/eslint 0·브라우저(힌트·박스내 버튼·scrollbar-hidden 2·scroll-soft 0). ⏳ 검토대기.
- **fix(editor): R5a 인스펙터 — 스크롤 자동숨김·코멘트 3줄·BPM ellipsis+담당자 정보카드 툴팁 (feat/editor-compare-redesign)** — ① **탭/코멘트 스크롤 자동숨김**: 인스펙터 탭 콘텐츠·코멘트 리스트·작성칸에 `scroll-soft`(평소 숨김·hover/스크롤 노출). ② **코멘트 작성칸 3줄**: `h-9`→`h-[4.5rem]`(72px). ③ **BPM 어트리뷰트 ellipsis + 호버 정보카드**: 담당자·부서 select `truncate`, **담당자에 Tooltip 정보카드**(이름/아이디/부서) — `Tooltip` 컴포넌트에 `content`(ReactNode)·`className` 추가(기존 label string 호환). 시스템·소요시간 입력은 `title`로 전체값. 검증: tsc/eslint 0·브라우저(코멘트칸 72px·scroll-soft 5개·BPM select 2). 담당자 정보카드는 assignee 데이터 있는 노드서 표시. ⏳ 검토대기.
- **fix(editor): R5b 맵 탭 목업 정합 재구성 — narrow 전용·엣지 스타일 아이콘화 (feat/editor-compare-redesign)** — MapDetailCard(버전 포함·넓은 폭이라 좁은 패널서 깨짐)를 빼고 **목업 전용 narrow `map-inspector-tab.tsx`** 신설: **가시성**(공개/비공개 토글, 현재값 표시·변경은 설정 승인플로) → **소유자**(getDirectory로 이름·소속 해석·ME) → **협업자**(listMapPermissions, 역할 배지·그룹 빌딩아이콘) → **설명**(updateMap 편집). 순서·폭 목업 일치. **엣지 스타일을 텍스트→아이콘**(Spline/CornerDownRight/Slash, 맵 전체 일괄). 노드 표시 토글·PNG는 유지. i18n `inspector.visibility/owner/collaborators`. 검증: tsc/eslint 0·브라우저(가시성 Public·소유자 Junho Kim·ME·엣지 아이콘 3·협업자 없으면 미표시·콘솔 0). 가시성 변경(승인플로)은 후속. ⏳ 검토대기.
- **feat(editor): R5 인스펙터 피드백 — 탭 아이콘화·내부스크롤·피커규칙·코멘트 활동디자인 (feat/editor-compare-redesign)** — ① **탭 아이콘화+선택 확장**: 탭을 아이콘(SlidersHorizontal/Map/CircleCheck/MessageSquare)으로, 선택 탭만 `grid 0fr→1fr`로 폭 늘며 라벨 노출(4탭 잘림 해결). ② **내부 스크롤**: 패널 루트·NEW 컬럼 `min-h-0` → 탭 콘텐츠가 전체 페이지 대신 내부 스크롤. ③ **BPM 피커 규칙**: 부서 선택 시 담당자 그 부서로 필터, 담당자 지정되면 부서 잠금(담당자에서 파생, `inspector.deptLocked`). ④ **코멘트 활동 디자인**: `CommentSection`을 아바타(이니셜)+이름+**상대시각**(`time.*`·마운트 시 now 1회 캡처로 purity 회피)+본문+해결/미해결·해결됨 배지+dim+입력행으로 재스타일(활동 탭 R5d 재사용). **답글(replies)은 데이터 모델에 없어 보류**(백엔드 스키마 변경 필요)·아바타 per-author 색은 토큰 제약으로 단일 tint. 검증: tsc/eslint 0·브라우저(아이콘 탭 Properties 확장·Map 아이콘). ⏳ 검토대기.
- **feat(editor): R5b NEW 맵 탭 — 가시성·소유자/협업자·설명·노드표시토글·엣지스타일·PNG (feat/editor-compare-redesign)** — `InspectorPanel`에 `mapTabSlot` 추가, page.tsx가 맵 탭 콘텐츠 주입: **MapDetailCard**(가시성·소유자·협업자·설명 재사용) + **노드 표시 정보 토글**(담당자/부서/시스템/소요시간/유형 — `NODE_DISPLAY_FIELDS`·`toggleDisplayField`, R4에서 보류했던 카드를 맵 탭으로 이전) + **엣지 스타일 맵 전체 일괄**(곡선/꺾은선/직선 → `setEdgeStyle`) + **PNG 다운로드**(`handleExportPng`). i18n `inspector.mapWide/nodeDisplay/edgeStyle/exportPng`. 검증: tsc/eslint 0·브라우저(맵 탭 전환→Node display/Edge style/Download PNG 노출). 미세 차이: MapDetailCard가 버전 목록도 포함(목업 맵탭엔 없음 — 버전은 활동 탭 R5d) → 추후 정리. ⏳ 검토대기.
- **feat(editor): R5a 노드 색상 커스텀(hex) 추가 — 설명은 생략 유지 (feat/editor-compare-redesign)** — NEW 노드 색상 섹션에 **커스텀 색상**: 프리셋 스와치 뒤 **Palette 토글 버튼**(편집 시) → hex 직접 입력칸(`#RRGGBB` 검증·Enter 확정), OLD와 동일 로직(`showHexInput` 공유). **설명(description)은 생략 유지**(사용자 결정 — 추후 필요 시 생성). 검증: tsc/eslint 0·브라우저(Palette 토글→hex 입력 노출). ⏳ 검토대기.
- **feat(editor): R5a BPM 속성 담당자·부서 피커화 — 자유입력 폐기(F5) (feat/editor-compare-redesign)** — 노드 BPM 속성의 **담당자·부서를 자유 입력→선택 피커**로. 신규 `bpm-attribute-picker.tsx`: `getEligibleAssignees(versionId)`[active 가드]로 **자격 직원/부서** 로드 → 담당자 select(직원, "이름 · 부서") + 부서 select. **담당자 선택 시 그 직원의 부서 자동 채움**. 레거시 자유입력 값은 목록에 없으면 옵션으로 보존. 시스템·소요시간은 입력 유지. `updateSelectedData` 배선. 검증: tsc/eslint 0·브라우저(담당자 6옵션[직원5+—]·부서 5옵션[부서4+—], 시스템/소요시간 입력). ⏳ 검토대기.
- **feat(editor): R5a 노드 속성 디테일 — end 토글·하위프로세스 버전선택·노드 코멘트 (feat/editor-compare-redesign)** — NEW 노드 폼 보강: ① **end 노드 대표엔드**를 체크박스→**토글 스위치**(role=switch). ② **하위프로세스 노드 버전선택** 신규 `subprocess-version-picker.tsx`(연결 맵 versions를 `getMap` fetch[active 가드]·**최신 추종 토글** + 해제 시 **버전 고정 드롭다운** + updateAvailable 시 업데이트). `updateSelectedData(followLatest/linkedVersionId)`·`handleUpdateSubprocess` 배선. ③ **노드 코멘트** 하단 배치(`CommentSection`·`selectedComments` 노드별·읽기전용도 작성). i18n `subprocess.versionTitle/pickVersion`. 검증: tsc/eslint 0·브라우저(End 노드→대표엔드 토글 ON·코멘트 섹션). **노드 타입 NEW↔OLD 비교 — 남은 갭 2: 설명(description)·색상 커스텀 hex (둘 다 목업이 의도적으로 생략 — 유지/복원 사용자 결정 대기).** 콘솔 신규 에러 0. ⏳ 검토대기.
- **feat(editor): R5a 완료 — NEW 속성 탭 엣지 폼 추가(빈상태·노드·엣지 전부) (feat/editor-compare-redesign)** — propertiesSlot에 **엣지 선택 폼**(목업 inspector-properties-edge): 헤더(→ 엣지 편집·X 닫기=selectedEdgeId 해제)·**소스→타겟**(노드명)·**분기 라벨**(디시전 분기일 때만 Yes/No/기타→`setSelectedEdgeBranch`)·**라벨**(input→`updateSelectedEdgeLabel`)·**연결 스타일**(곡선/꺾은선/직선 표시)·**엣지 삭제**(편집 시·`deleteElements`). 기존 핸들러 재사용. i18n `inspector.edgeEdit/branchLabel/label/connStyle/branchOther/deleteEdge`. **이로써 R5a(속성 탭 빈상태·노드·엣지) 완료.** 보류 폴리시: 터미널 소스/타겟 라벨 "—"(추후 terminalDisplayLabel), 연결 면 면-화살표는 스타일 표시로 단순화. 검증: tsc/eslint 0·브라우저(엣지 선택→폼 소스→타겟/라벨/스타일·비-디시전 분기 숨김·read-only 삭제 숨김·OLD 나란히). 콘솔 에러 2건은 테스트 합성 pointer 이벤트 아티팩트(실 마우스 무관). ⏳ 검토대기.
- **feat(editor): R5a NEW 속성 탭 노드 폼 — 제목/유형/색상/BPM 카드 (feat/editor-compare-redesign)** — NEW 인스펙터 속성 탭에 **노드 선택 시 폼**(목업 inspector-properties-node): 제목(input)·**유형(읽기전용 표시)**·색상(타입별 스와치)·**BPM 속성 카드**(담당자/부서/시스템/소요시간 — 라벨 좌·값 우 편집 인풋). `InspectorPanel`에 `propertiesSlot: ReactNode` 추가(빈상태는 내부, 선택 시 주입; 없으면 placeholder), page.tsx가 폼을 만들어 주입(기존 `updateSelectedData`·`colorsForType`·`NODE_TYPE_OPTIONS` 재사용). 목업대로 컴팩트 — **설명·댓글·end/subprocess 특수필드는 비교기간 OLD에 유지**(후속 이관). 엣지 폼은 placeholder 유지(다음). 검증: tsc/eslint 0·브라우저(노드 선택→NEW 폼 제목/유형/색상/BPM, OLD와 나란히 비교·콘솔 0). ⏳ 검토대기.
- **docs(editor): R3·R4 검토 완료(✅) + 브랜치 단일화 + 아웃라인 단축키 정립 보류(D2) (feat/editor-compare-redesign)** — R3(상단바)·R4(좌측 사이드바+편집 툴바) **검토 승인**으로 표시. `feat/editor-r5-inspector`를 FF로 통합·삭제해 **단일 브랜치 `feat/editor-compare-redesign`**로 정리(R1–R4 + R5 scaffold 포함). 트래커에 **D2 아웃라인 단축키 목록 정립** 보류 항목 추가(R4c의 ↵/Del 등 잠정). 노드 정보 카드는 R5b에서 이전 예정. 다음: R5a(인스펙터 속성 탭 노드/엣지 폼).
- **feat(editor): R5 scaffold — NEW 4탭 인스펙터 + OLD와 한 페이지 나란히 비교 (feat/editor-r5-inspector, R4 검토 병행)** — 우측 인스펙터 4탭(속성/맵/승인/활동)을 만들려면 기존 탭 제거가 필요한데, **전 탭 구현·승인 후 OLD 제거**하기로. 그동안 **우측 영역을 2배로** 늘려 **NEW(R5) ‖ OLD를 한 페이지에서 비교**. 신규 `inspector-panel.tsx`: 탭 바(`>`접기+속성/맵/승인/활동) + **속성 탭 빈상태**(Boxes 아이콘·"선택된 항목 없음"·노드추가/라이브러리/자동정렬 버튼[편집 시만]·맵 요약 카드[노드·엣지·하위프로세스 수·마지막 저장]). 노드/엣지 폼·맵/승인/활동 탭은 "구현 예정" 플레이스홀더(후속 R5a~d). page.tsx 인스펙터 컨테이너 폭 `*2`, NEW(accent 라벨)+OLD(라벨) 나란히. i18n `inspector.tab*`·`inspector.sum*` 등. 검증: tsc/eslint 0·브라우저(2배 폭·탭 전환·속성 빈상태/요약·read-only 시 추가버튼 숨김·placeholder·콘솔 0). ⏳ 검토대기.
- **feat(editor): R4c 사이드바 단축키 카드 — ↵편집·Del삭제 추가 + Del 배선 (feat/editor-compare-redesign, R4 브랜치 통합 후)** — 목업 단축키 카드(Tab/⇧Tab/↵/Del)에 맞춰 아웃라인 단축키에 **↵ 편집(이미 구현)·Del 삭제** 추가(맥락 반응, 읽기전용 시 dim). **Del 배선**: 캔버스 포커스는 ReactFlow `deleteKeyCode`가 처리하지만 아웃라인 포커스 시엔 미동작이라 `handleListKey`에 Delete/Backspace→`onDeleteNode`(=`reactFlow.deleteElements({nodes}})`) 추가. i18n `outlineNav.edit/delete`. 아웃라인은 이미 선택=accent bg·터미널 ○·하위프로세스 ▽+들여쓰기로 목업 일치(추가 재스타일 불요). **노드 정보 카드는 보존**(목업엔 없으나 R5b 맵 탭으로 이전 예정 — 그때까지 표시 토글 유지). 브랜치 `feat/editor-r4-left-sidebar`를 FF 머지로 `feat/editor-compare-redesign`에 통합·삭제. 검증: tsc/eslint 0·브라우저(카드 ↵/Del 노출·Del로 선택 노드 삭제 1→0·콘솔 0). ⏳ 검토대기.
- **fix(editor): R4 노드 생성 겹침 방지 + 페이드 반짝 + Auto layout 선택 반응 (feat/editor-r4-left-sidebar)** — ① **겹침 방지**: +Node/링크노드 생성이 항상 뷰포트 중앙 고정 → `findFreeSpot`로 기존 노드와 충돌 시 대각선(28px)으로 밀어 빈 자리에 배치. ② **페이드 반짝**: 새 노드에 `.bpm-node-flash`(opacity 2회 펄스 850ms, `prefers-reduced-motion` 가드) 부여 후 `flashNode`가 850ms 뒤 클래스 제거 → 어디 생겼는지 인지. raw `<style>`에 keyframe(Turbopack purge 회피). `handleAddNode`·`addLinkNodeFromMap` 양쪽. ③ **Auto layout 선택 반응**: 편집 툴바 Auto layout이 선택 무관 전체로만 동작하던 것 → 선택 노드 **2개 이상이면 `layoutSubsetWithDagre`로 부분 정렬**, 아니면 전체(컨텍스트 메뉴와 동일 분기). 검증: tsc/eslint 0·브라우저(노드 3개 대각선 cascade 겹침 0·flash 클래스 부여·전체 정렬 fallback·콘솔 0). 부분정렬 경로는 기존 컨텍스트 메뉴와 동일 코드. ⏳ 검토대기.
- **fix(editor): R3 맵 드롭다운 — 하위메뉴 호버 폐기→클릭 토글(1개씩) + 새 맵=생성 모달 (feat/editor-compare-redesign)** — 맵 행 하위메뉴(맵 열기·링크노드 추가)를 **호버로 열던 것 폐기, 클릭으로만 토글**(같은 행 재클릭=닫힘, activeId 단일이라 항상 1개만). **새 맵**은 홈(`/`)으로 나가던 `<Link>`를 폐기하고 **`CreateMapDialog` 생성 모달**을 띄움(드롭다운이 직접 호스팅, onClose/onCreated로 닫기). `Link` 임포트 제거. 검증: tsc/eslint 0·브라우저(클릭 토글 open→close·New map→생성 모달, URL 유지·콘솔 0). ⏳ 검토대기.
- **feat(editor): R4b 노드 검색을 상단바 → 좌측 사이드바 아웃라인 위로 이전 (feat/editor-r4-left-sidebar)** — R3에서 상단바 중앙에 임시 유지하던 노드 검색을 목업대로 **사이드바 아웃라인 헤더 아래**로 이전. 신규 `node-search.tsx`(제네릭 `NodeSearch<R>`: 검색 입력+결과 드롭다운+키보드 네비 ↑↓Enter Esc, 표시 전용). 검색 **상태·결과 계산은 page.tsx 소유**, `EditorLeftSidebar`엔 `searchSlot: ReactNode`로 주입(`<NodeSearch>` 엘리먼트 전달 — 다수 prop 스레딩 회피). 상단바 검색 블록 제거+우측 클러스터 `ml-auto`. **Cmd+K 보존**: 사이드바 검색 포커스, 접혀 있으면 `setLeftCollapsed(false)`+rAF로 펼친 뒤 포커스. 검증: tsc/eslint 0·브라우저(상단바 검색 제거·사이드바 위치·"New step (2)" 검색→결과→선택 시 카메라 포커스+인스펙터+검색어 클리어·Cmd+K 포커스). ⏳ 검토대기.
- **feat(editor): R4a 편집 툴바(두 번째 상단바) — +노드·자동정렬·정렬 (feat/editor-r4-left-sidebar, R3 검토 병행)** — 노드/정렬은 사이드바가 아니라 **메인 상단바 아래 두 번째 바**에 편집기능 위주로, **편집 모드(!readOnly)일 때만** 노출(사용자 재확인 반영). 신규 `editor-toolbar.tsx`: **＋Node 메뉴**(`add-node-menu.tsx`: Choose shape→프로세스/판단/**시작·끝(별도 항목 — 타입변경 미구현이라 끝 노드 생성 위해 분리)** + 구분선 + 하위프로세스"Link to process library"→라이브러리 패널)·**Auto layout**(dagre)·**정렬4(좌/가로중앙/상/세로중앙)+분배2(가로/세로)**. 정렬/자동배치 핸들러는 기존 컨텍스트 메뉴와 동일(`applyNodesTransform`+`layoutWithDagre`/`alignSelected`/`distributeSelected`). page.tsx 헤더 아래 `{!readOnly && <EditorToolbar/>}` 배치. (초안에서 사이드바에 뒀던 +노드를 둘째 바로 이전 — 사이드바 변경 원복.) i18n `addNode.*`·`nodeType.terminal`(정렬 라벨은 기존 `editor.align*`). 검증: tsc/eslint 0·브라우저(둘째 바 +Node/Auto layout/정렬 노출·Process 추가 동작·read-only에선 툴바 숨김 확인). R4 나머지(단축키 카드·노드 검색 이전·아웃라인 재스타일) 후속. ⏳ 검토대기.
- **feat(editor): R3 상단바 재디자인 — 맵네임 드롭다운·버전 pill 추출 + 이동 확인 흐름 (feat/editor-compare-redesign)** — 헤더 제자리 재스타일(좌: 사이드바토글·**MapNameDropdown**·`>`·**VersionPill** / 우: 상태·undo/redo·라이브러리·AI·저장·인스펙터, ghost 톤). **MapNameDropdown**: 박스 트리거+드롭다운(검색·최근맵·**private 필터**·현재맵 강조·새맵), 맵 행 **호버/클릭→인라인 하위메뉴[Open map·Add as link node(편집중만)]→확인모달**. **VersionPill**: accent pill+상태배지 드롭다운→확인모달. **즉시 이동/전환 폐기**(편집중일 때만 확인모달; 읽기전용은 즉시 실행). 확인모달=`ConfirmDialog` **리치 폼 통일**(아이콘원+lines, 유저그룹/맵삭제 동일)·편집중이면 미저장 경고 줄. `addLinkNodeFromMap`(라이브러리 드롭과 동일 subprocess 노드, 최신본 추종). 옛 `mapMenuOpen`/메뉴 제거·`ChevronDown`→`ChevronRight`. i18n 키 추가. 공유·전체화면 보류. 검증: tsc/eslint 0·브라우저 전경로 실동작(private필터·하위메뉴·링크노드삽입·즉시전환·리치모달·미저장경고)·콘솔 0. ⏳ 검토대기.
- **feat(editor): R2 노드 비주얼 — E3 테두리(slate) + E4 셀렉션 링을 노드간 슬라이드 인디케이터로 (feat/editor-compare-redesign)** — **E3**: 프로세스 기본 테두리 `#909098`→`#6e84a3`(slate). **E4**: 노드별 셀렉션 링(box-shadow) 폐기 → **단일 플로팅 인디케이터가 노드 사이를 슬라이드**. 신규 `node-selection-ring.tsx`(ViewportPortal·`useStore`로 선택노드 추종·단일선택은 고정 DOM으로 350ms 슬라이드·드래그 중 트랜지션 꺼 즉시추종·다중선택 노드별·시작끝 알약/그외 사각). `globals.css` `.node-ring-selected`(2px accent+4px 12% 헤일로). `process-node`는 셀렉션 링 제거(오버레이가 담당)·`selected` prop 미사용 정리. 검증: tsc/eslint 0·슬라이드 클래스 컴파일 확인·브라우저 승인. (dev CSS 스테일로 `.next` 캐시 비우고 dev 재기동한 이력.)
- **fix(editor): R1+ 미니맵 getNodesBounds 훅 버전으로 — 서브플로우 경고 제거 (feat/editor-compare-redesign)** — `minimap-viewport-fill`의 standalone `getNodesBounds(nodes)` → **`useReactFlow().getNodesBounds`**(내부 nodeLookup 반영). React Flow 콘솔 경고 재발 0건·서브플로우 bounds 정확도 개선. 검증: tsc/eslint 0.

## 2026-06-28
- **feat(editor): R1+ 미니맵 목업 정합 — 흰 배경·노드 실색 톤다운·뷰포트 악센트 채움 (feat/editor-compare-redesign)** — MiniMap `maskColor=transparent`(바깥 흰 배경)·`nodeColor` 함수로 **각 노드 실제 색 톤다운**(`color-mix 38%`, `resolveNodeStroke`를 `process-node`에서 export·`<MiniMap<AppNode>>`). MiniMap이 children 미렌더라 **동일 viewBox 오버레이 Panel**(`minimap-viewport-fill.tsx`)로 뷰포트를 반투명 악센트로 채움(목업의 '악센트 사각형'). 검증: tsc/eslint 0·정렬 브라우저 확인.
- **feat(versions): 드래프트 점유권 강탈은 sysadmin만 + 생성자 자동점유 (feat/editor-compare-redesign, 백엔드 변경=사용자 승인)** — `acquire_checkout`의 **force(강탈)를 sysadmin 전용**(비-sysadmin force→403), `create_version`이 **생성자를 점유권자로 자동 설정**. 편집은 기존대로 보유자만(graph.py) — sysadmin도 점유 없으면 수정 불가. 프론트 force-edit 버튼을 `is_sysadmin`에게만 노출(그 외 읽기전용 안내). 정식 인수(에디터 요청→승인큐 승인)는 모달/승인 디자인 후 후속. 검증: backend 342 passed(+2)·ruff·tsc/eslint 0. 스키마 무변경.
- **feat(editor): R1 캔버스 크롬 — 미니맵 추가 + 줌 pill 재스타일 (feat/editor-compare-redesign)** — ReactFlow `<MiniMap>`(좌하, 흰 배경·노드 톤다운·반투명 악센트 마스크) 추가, 기존 `<Controls>`(좌하 줌버튼) 제거. `canvas-zoom-scale`를 세로 눈금자→**하단중앙 인터랙티브 pill**(`− 100% + | ⛶`)로 교체: 줌인/아웃 `useReactFlow`, ⛶는 기존 `fitScopeTopLeft`(커스텀 좌상단 fit)·`editor.fitView` 툴팁 보존. i18n `editor.zoomIn/zoomOut`(en/ko). 줌 pill 디자인 승인, 미니맵 뷰포트 악센트 채움은 후속(React Flow 마스크 한계). 검증: tsc/eslint 0.
- **docs: 제자리 방식으로 스펙·플랜 재작성 + 마스터 트래커 신설 (feat/editor-compare-redesign)** — 스펙(`specs/2026-06-28-editor-compare-redesign-design.md`)·플랜(`plans/…`)을 **제자리 리스타일+컴포넌트 대체**로 재작성(기존 page.tsx 구조 지도·보존 불변식·R1 상세 포함). **마스터 트래커 `SCREEN-REDESIGN-EDITOR.md`** 신설(R1~R11+C1~C3 표, 이걸 기준으로 대체 진행). 구 `SCREEN-REDESIGN.md`에서 편집기 항목(E1~E4·I1~I6)을 새 트래커로 이관(혼동 제거).
- **refactor(approach): 에디터 재디자인 전략 전환 — 제로베이스 폐기 → 제자리 리스타일+컴포넌트 추출 (feat/editor-compare-redesign)** — 핵심 요건 '기존 동작(단축키·애니메이션·내비게이션·드롭존·스코프 딥뷰·undo/autosave) **전부 보존**'에는 제로베이스 리라이트가 동작 재구현·누락 위험이 큼(미니맵/줌 누락이 예고편). **표현만 바꾸고 동작은 보존하는 제자리 리스타일**로 전환. `/v2` 스캐폴드(U0.1·어댑터·읽기렌더) 제거. 기존 `maps/[mapId]/page.tsx`를 영역 단위로 추출·재스타일 예정. 스펙/플랜 개정 예정. (아래 /v2 항목들은 폐기된 경로의 이력.)
- **feat(editor-v2): Graph→Flow 어댑터 + vitest (U1.1, feat/editor-compare-redesign)** — `editor-v2/canvas/graph-adapters` `toFlowNodes`/`toFlowEdges`: **저장 좌표 보존**(비교화면 dagre와 달리)·NodeData required 필드 매핑(label=title 등)·source/target 면→핸들 id(`s-`/`t-`). `coerceSide` 가드로 `as` 회피. 테스트 2 통과. 검증: vitest·tsc·eslint 0.
- **feat(editor-v2): /v2 스캐폴드 — 셸 골격·데이터 로드 훅 (U0.1, feat/editor-compare-redesign)** — 신규 에디터 임시 라우트 `/maps/[mapId]/v2`(client `useParams`) + `editor-v2/editor-shell`(상단/좌264/캔버스/우330 4영역 골격) + `use-editor-data` 훅. 데이터: `getMap`의 `MapDetail.versions`로 버전목록(별도 listVersions 없음)·id는 number·그래프는 `getGraph(versionId)`·기본=최신버전. 린트는 async IIFE+active 가드(set-state-in-effect 회피). 구 에디터는 `/maps/[mapId]` 유지. 검증: tsc/eslint 0·`/maps/1/v2` 200·브라우저 4영역 렌더.
- **docs(plan): 에디터·비교 재디자인 구현계획 — File Structure 락인 + Phase 0–1 상세(스캐폴드+캔버스) (feat/editor-compare-redesign)** — `editor-v2/` 컴포넌트 트리·`/v2` 라우트·8페이즈 로드맵 확정. **Phase 0–1을 실행가능 완성 수준**으로(Task 1–7: 셸 골격·데이터로드 훅·Graph→Flow 어댑터+vitest·읽기렌더·E3/E4 노드토큰·인터랙션 배선·드롭존 링). P2–P7은 직전 JIT 플랜(React Flow 상대 구현·모달단위 검토 흐름 반영). 플랜: `docs/superpowers/plans/2026-06-28-editor-compare-redesign.md`.
- **docs(spec): 에디터·비교화면 제로베이스 재디자인 설계 스펙 + 목업 18장 리포지토리 복사 (feat/editor-compare-redesign)** — 맵 에디터·버전 비교화면을 hifi 목업 기준 제로베이스 재구현하는 설계 확정. 검증된 캔버스 엔진(React Flow·드래그/드롭존·좌표·스코프·dagre) **재사용** + UI 크롬(레이아웃·4탭 인스펙터·모달·오버레이·컨텍스트메뉴·그룹·AI 채팅·비교패널) **전부 신규**. 병렬 `/v2` 라우트로 **모달 단위** 구현→검토→커밋, :3100 OLD 대조 후 컷오버. 8 페이즈·~30 단위·단위별 참고 이미지 연결. 확정 결정: 병렬+컷오버·엔진재사용·AI 실연결·To-Be적용=내비·에디터먼저. 스펙: `docs/superpowers/specs/2026-06-28-editor-compare-redesign-design.md`, 에셋: `docs/superpowers/specs/assets/editor-compare-redesign/`(18장).
- **docs(handoff): 세션 정리 — 핸드오프·레슨·검토 데이터 세트·D1 보류 (feat/frontend-ui-improvements)** — `docs/superpowers/HANDOFF-frontend-ui-improvements.md`(완료/남은일/제약/데모데이터) + `docs/lessons/settings-and-forms.md`(모달/피커/카드헤더/소프트삭제/검증 패턴) + 메모리 `refactor-preserve-secondary-behaviors`(리팩터 시 호버 안내 등 부수동작 유실 금지). **유저그룹 전 상태 데모 데이터 세트**(pending/active/inactive/rejected/trash) dev.db 시드. **D1 보류**(트래커 ⏸). fix: L6에서 누락된 그룹 액션 호버 안내문구 복구.
- **feat(ui): 피커 모달 영역 추가 확보·Esc 닫기 + L6 마감(Add member 사이클 버튼과 통합·상태배지 우정렬) (feat/frontend-ui-improvements)** — ① **Esc로 피커 드롭다운 닫기**(`principal-picker`: Esc→검색비움+blur, 항목 유무 무관). ② 맵 생성 **결재자 영역 1.5줄 미리 확보**(h-[2.5rem]·scroll-soft)·유저그룹 **add-member 선택 칩 영역도 처음부터 확보**(고정 h). ③ **L6 마감**: 카드 헤더를 풀폭 버튼으로 되돌려 **상태배지 우측끝 정렬 복구**, 라이프사이클+**Add member를 카운트 아래 한 행**(GroupActions에 onAddMember·canEdit 추가, add 다이얼로그는 부모 controlled). 검증: tsc/lint 0·브라우저(Esc 닫힘·결재자/협업자/칩 영역 확보·상태배지 우정렬·Add member 동작).
- **refactor(groups): L6 멤버수 중복 제거 + 라이프사이클 버튼을 카드 헤더로 이동 (feat/frontend-ui-improvements)** — 펼침 시 멤버수가 두 번(카드 헤더·상세 스페이서) 나오던 것을 **카드 헤더의 것만 유지**. 라이프사이클 액션(rename/deactivate/…)을 새 **`GroupActions` 컴포넌트로 추출**해 **카드 헤더 우측(타이틀쪽, 토글 버튼 sibling — 중첩 버튼 회피)**에 배치. `GroupDetail`은 멤버 리스트·add member·매니저 토글만 담당(스페이서·hint·카운트 헤더 제거). `groups/[groupId]` 페이지도 헤더에 GroupActions. 검증: tsc/lint 0·브라우저(단일 카운트·헤더 버튼·rename 인라인 동작·정렬 유지).
- **feat(ui): 피커 모달 명단 높이 고정+자동숨김 스크롤 (feat/frontend-ui-improvements)** — 추가 시 모달이 늘거나 위치가 흔들리지 않도록 명단 영역을 **처음부터 확보**하고 내부 스크롤. globals `.scroll-soft`(평소 막대 숨김, hover/스크롤 시 노출). 맵 생성 협업자 명단=**고정 3.5행**(`create-map-dialog`, 4행째 살짝 보여 더 있음 암시)·그룹 생성 멤버/매니저 칩·add-member 선택 칩=`max-h`+scroll-soft(빈 박스 방지). 검증: tsc/lint 0·브라우저(맵 생성 협업자 6명→3.5행 고정·결재자/생성 버튼 위치 불변).
- **feat(groups): L3 가이드 간소화 + 매니저 권한 PPT식 칩 (feat/frontend-ui-improvements)** — SVG에 텍스트 욱여넣던 것을 **HTML 제목·칩 + 간소 SVG**로 분리. 라이프사이클은 **전진 흐름만**(5상태 아이콘+forward verb), 되돌리기는 **↺ Reversible 칩**(Withdraw·Re-request·Reactivate·Restore), **그룹 매니저 권한은 아이콘+키워드 칩**(Manage members·Assign managers·Rename·Deactivate·Delete/Restore, Lucide accent) = 그림·키워드 위주 PPT식. 키 `perm.group.lcReversible/lcMgrCan/lcPerm*`. 검증: tsc/lint 0·브라우저.
- **feat(groups): L5 add member 일괄 추가 + 모달 통일 / A13 요청자 카드 / 맵 리스토어·그룹비활성 모달 (feat/frontend-ui-improvements)** — ① **맵 Restore 확인 모달** 추가. ② **그룹 비활성 시 map_permissions 삭제**(잔존 방지) + deactivate 모달에 경고 줄(백엔드 340 passed). ③ **A13 요청자 카드**(이름 우선·아이디·소속, 메인 상세 유저 디자인 재활용·날짜 별도 행, 디렉터리 해석). ④ **L5 add member**: 한 명씩→**피커 다중 선택(칩) + Add N 일괄**, 모달 디자인 통일(헤더·안내·Cancel/Add). 키 `perm.group.picker*`·`toastMembersAdded`·`trash.confirmRestoreMap*`. 검증: tsc/lint 0·브라우저(맵 Restore 모달·A13 카드·L5 칩/Add 1 실제 추가→3 Members→복원).
- **feat(groups): L6+ 멤버 헤더 스페이서·멤버 카드 호버 컨트롤·정렬·매니저 확인모달 + L5 모달 간결화 (feat/frontend-ui-improvements)** — ① 멤버 헤더를 **스페이서(구분선) 위=버튼·아래=호버 안내문구**(IconActionButton에 `hint`/`onHoverChange` 추가)로 재구성. ② 멤버 카드 **호버 효과 + 호버 시 Remove·매니저 토글(Make/Unset) 노출**, **매니저 ★배지는 항상 노출**. ③ 멤버 정렬 **매니저→유저→팀(부서)**(안정 정렬). ④ **매니저 추가/제거 시 확인 모달**(L5 ConfirmDialog 재사용). ⑤ L5 모달(deactivate/reactivate/restore)을 삭제 모달처럼 **아이콘+간결 줄**로 보완. 키 `perm.group.confirm*L1/L2`·`unsetManager`. 검증: tsc/lint 0·브라우저(스페이서 위/아래·호버 컨트롤·정렬·Make/Unset 확인모달·Deactivate 간결 줄).
- **feat(settings): L4 아이콘 전용 버튼 + 호버 시 정렬방향 라벨 펼침 (feat/frontend-ui-improvements)** — 공용 `IconActionButton`(아이콘 항상, 라벨은 `grid-cols 0fr→1fr` 전이로 펼침, `align=left`→우로·`align=right`→좌로, `duration-350 ease-smooth`). 적용: **트래시 Restore**(맵·그룹 패널, 우정렬→좌로 펼침) + **그룹 라이프사이클 액션·Add member**(멤버 헤더 우측, 아이콘 전용 →L6의 always-text+별도 설명 span 폐기·hoveredAction/actionTone 제거). 검증: tsc/lint 0·브라우저(강제 펼침 시 "Rename ✏"/"Deactivate ⏸" 라벨 좌측 펼침·트래시 ↺ 아이콘 전용).
- **feat(groups): L3 유저그룹 가이드 SVG에 라이프사이클 반영 (feat/frontend-ui-improvements)** — 기존 3단계(신청→승인→사용)를 **5상태 라이프사이클**로 재설계: 신청→승인→활성→비활성→삭제예정. 상태 원은 **상태 배지와 동일 시맨틱 색**(changed/accent/added/ink-tertiary/error) + 아이콘(＋/✓/▶/⏸/🗑). 전이 화살표 **위=전진 동작**(Pending/Approve/Deactivate/Delete), **아래=↺ 되돌리기**(Withdraw/Reject·Re-request/Reactivate/Restore). 관리자 콜아웃 유지. 키 `perm.group.lc*`. 검증: tsc/lint 0·브라우저.
- **feat(groups): L5 그룹 삭제 즉시삭제 폐지→확인 모달+스케줄드 딜리션 + deactivate/reactivate/restore 모달 (item ④, feat/frontend-ui-improvements, 스키마 무변경)** — 백엔드 `GET /groups/deleted`(휴지통 목록, `deleted_at`·status≠rejected, 관리 가능분만) + `POST /groups/{id}/restore`(deleted_at 해제→inactive 복귀). 프론트: 공용 `ConfirmDialog` 리치 폼 확장(아이콘 원+요점줄). `group-detail`의 **delete/deactivate/reactivate를 확인 모달 게이트**(delete=리치 3줄, deactivate/reactivate=메시지형). 신규 `DeletedGroupsPanel`을 Scheduled deletion 탭에 **User groups 섹션**으로 추가, **restore도 확인 모달**. 검증: 백엔드 339 passed(휴지통 목록·복구·rejected제외·409)·tsc/lint 0·브라우저(Deactivate→Delete리치모달→휴지통→Restore모달→복구 전 흐름).
- **feat(approvals): A13 승인 큐 상세 가시성 before→after + 버튼 아이콘화 (item ②, feat/frontend-ui-improvements, 스키마 무변경)** — 백엔드 `visibility_change` 요청 시 현재값을 `payload.from_visibility`에 저장(JSON, 스키마 무변경). 프론트 `approval-queue`는 `VisibilityPill`로 **🔒 Private → 🌐 Public**(from 있을 때, A10 역할전환 패턴), 구 요청(from 없음)은 to만 폴백. Approve/Reject 버튼 **✓/✗ 아이콘화**. 검증: 백엔드 336 passed(payload 검증)·tsc/lint 0·브라우저(새 요청 Private→Public·구 요청 폴백·아이콘 버튼).
- **feat(groups): L6 그룹 상세 버튼을 멤버수 헤더 우측으로 + 호버 설명 페이드인 (item ③, feat/frontend-ui-improvements)** — `GroupDetail` 멤버 헤더를 `👥 {n} Members`(좌) + 상태별 **액션 버튼**(우, Add member 옆)으로 재구성. 항상 보이던 하단 필/푸터 제거 → 액션 버튼 **호버 시 설명이 페이드인**(`hoveredAction` + opacity transition). 자동삭제 카운트다운은 헤더 아래로. 상태별 액션은 `actions` 배열로 정리(`HintPill`/`ActionBtn` 제거→`actionTone`). 검증: tsc/lint 0·브라우저(active Rename/Deactivate·rejected Re-request/Delete+카운트다운 우측 배치). (호버 설명 위치는 피드백 시 미세조정 가능.)
- **docs(tracker): 신규 4건 분석·정리해 SCREEN-REDESIGN 추가 + L2 검증완료 표시** — ① **D1** Departments 고아조직 재연결(서브탭 [Departments\|Orphan], 백엔드 탐지·재매핑·고아정의 확인 필요) · ② **A13** 승인 큐 상세 변경값 before→after(Private→Public)·버튼 아이콘화(payload old값 확인) · ③ **L6** 그룹 상세 버튼을 멤버수 div 우측으로 이동·호버 시 설명 페이드인(프론트) · ④ **L5** 그룹 삭제 즉시삭제 폐지→확인 모달+Scheduled deletion行(백엔드 목록·복구). 구현 전 분석/확인 단계.
- **feat(groups): L2 그룹 라이프사이클 프론트 — 상태별 액션 + 재신청 프리필 모달 (feat/frontend-ui-improvements)** — api `withdraw/deactivate/reactivate/renameGroup` + `Group.name_changed_at` + `GroupStatus` `inactive` 추가. `GroupDetail` 펼침 하단 **상태별 액션**: pending=Withdraw · active=Rename(인라인·주1회)+Deactivate · inactive=Reactivate+Delete · rejected=Re-request+Delete. 각 상태 **아이콘/필 기능설명** + inactive 안내. 재신청은 `onReRequest`→패널이 **생성 모달을 값 채운 채 열고**(멤버/매니저 이름 해석) 제출 시 기존 거절 그룹 삭제. 상태 배지에 Inactive 추가. 모듈 컴포넌트 `HintPill`·`ActionBtn`. 검증: tsc/lint 0·브라우저(active Rename e2e·Deactivate→Inactive→Reactivate·pending Withdraw). 재신청 프리필=후속 확인.
- **feat(groups): L1 그룹 라이프사이클 백엔드 — withdraw·deactivate·reactivate·rename (feat/frontend-ui-improvements, 스키마=사용자 승인)** — 생성→신청(철회)→승인/거절→액티브/재신청→인액티브→삭제. 신규: `POST /groups/{id}/withdraw`(pending 철회=즉시제거), `/deactivate`(active→inactive), `/reactivate`(inactive→active), `PATCH /groups/{id}/name`(active만·**주 1회**=`name_changed_at`[스키마]·전역 중복금지). **DELETE 게이트**: active→409(비활성 먼저)·pending→409(철회)·rejected→하드·inactive→소프트(7일). 권한 판정은 `status=="active"`만이라 inactive 자동 제외. rename 주1회 체크는 DB측 비교(sqlite naive/pg aware tz 회피). 검증: 백엔드 336 passed(신규 6)·ruff. (프론트=L2 후속.)
- **feat(groups): 피커 빈 상태 전체 옵션 노출 + 그룹 이름 전역 중복 검사 (feat/frontend-ui-improvements)** — ① 모든 피커(`principal-picker`·`search-select`)가 **빈 입력(포커스) 시 선택 가능한 전체 옵션**을 노출(이전엔 검색해야만 떴음). `onMouseDown preventDefault`로 blur 전 선택 보장. ② 그룹 이름 **전역 중복 금지**: 백엔드 `create_group` 409 + `GET /groups/name-available`(스키마 무변경), 프론트 생성 모달이 디바운스(300ms) 실시간 검사 → 중복이면 빨간 테두리 + "다른 사람이 이미 사용 중입니다"(`perm.group.nameTaken`) + 제출 비활성. 검증: 백엔드 330 passed(중복 테스트·default name 고유화)·tsc/lint 0·브라우저(피커 5옵션·"구매 검토 위원회"→빨간 메시지).
- **feat(groups): A12 프론트 — 그룹 삭제/재신청 메뉴 + 아이콘/필 기능 설명 (item 4, feat/frontend-ui-improvements)** — api `deleteGroup`/`resubmitGroup` + `Group.deleted_at`. `GroupDetail` 펼침 하단에 **관리 액션**: 생성자/관리자/sysadmin이면 **Delete**(소프트삭제), rejected면 **Re-request + Delete**. **기능 설명을 아이콘/필**로(ⓘ 🗑"7일 보존 후 영구삭제" · ↻"거절 그룹 재신청 가능") + 거절/소프트삭제 **자동삭제 카운트다운**(빨강). 삭제 시 `onGroupGone`(패널=재조회·페이지=/settings 이동). 키 `perm.group.delete/deleteHint/resubmit/resubmitHint/autoDeleteIn/toastDeleted`. 검증: tsc/lint 0·브라우저(거절 그룹 펼침 액션·Re-request→pending 전환).
- **feat(groups): A12 그룹 소프트삭제·재신청·자동퍼지 (items 2·3 백엔드, feat/frontend-ui-improvements, 스키마 변경=사용자 승인)** — `user_groups.deleted_at` 컬럼 추가(model + `db.py _ADDED_COLUMNS` + `GroupOut`). 매니저/생성자/sysadmin이 **그룹 삭제**: `DELETE /groups/{id}` — rejected는 즉시 영구삭제, 그 외는 **소프트삭제**(`deleted_at=now`, 목록서 숨김, 7일 후 퍼지). **거절**(decide reject)도 `deleted_at=now` → 7일 자동삭제(목록엔 rejected로 유예 노출). **재신청** `POST /groups/{id}/resubmit`(rejected→pending). `_purge_expired_groups`(보존 7일) list 조회 시 lazy. 가시성: 소프트삭제 숨김(rejected 예외). 검증: 백엔드 329 passed(신규 4: 소프트삭제 숨김·재신청·거절삭제·퍼지)·ruff clean. (프론트 메뉴·item 4 설명 후속.)
- **feat(admin): A10 승인 큐 — 간소 카드 + 클릭 펼침 아코디언 (피드백 반영, feat/frontend-ui-improvements)** — 전 항목을 **간소 헤더**(종류 아이콘+필 + 식별자[그룹명/🗺Map]+chevron)로 노출, **클릭 시 상세 펼침**(가시성 확보 — `DetailRow` 라벨+필: 역할전환 `editor→removed`·가시성 필·요청자·요청시각 + Approve/Reject). 다중 펼침(Set). `Pill`/`DetailRow` 모듈레벨. 검증: tsc/lint 0·브라우저(3 컴팩트 카드·다운그레이드 펼침).
- **feat(groups): A11-④ 안내 가이드 재설계 — 아이콘 중심 + 매니저 설정·권한 (피드백 반영, feat/frontend-ui-improvements)** — SVG 가이드 간소화: 번호 원 → **아이콘 원**(＋신청·✓승인·→사용, 흰 glyph)·라벨·화살표, 텍스트 최소화. **관리자 콜아웃** 추가(하이라이트 박스: ★ Manager · "멤버의 ★로 지정"(설정) · "그룹 멤버 관리"(권한)). 토큰 색만, 키 `guideMgr*`. 검증: tsc/lint 0·브라우저.
- **feat(admin): A10 승인 큐 재설계 — 전 항목 카드 + 아이콘/필 한눈 (피드백 반영, feat/frontend-ui-improvements)** — 이전 "pill 요약→클릭 상세"(필터처럼 1개씩)를 폐기하고 **모든 대기 항목을 카드로 전부 노출**. 각 카드는 아이콘+필로 내용을 한눈에: 종류 아이콘/필(그룹=바이올렛·하향=앰버·가시성=중립)·🗺Map 필·**역할 전환**(`editor → removed/viewer` 화살표 필)·가시성 전환 필·👥멤버수·★매니저 필·요청자. Approve/Reject는 카드 우측. `Pill` 모듈레벨 헬퍼. 검증: tsc/lint 0·브라우저(3 케이스 카드 한눈 표시).
- **feat(home): H4 카드 호버 모달 재설계 (Message 4, feat/frontend-ui-improvements)** — `map-card.tsx` 호버 모달: (1) 노드/버전/허용인원 **숫자를 우측 정렬 pill**(accent-tint)로(기존 `라벨 — N` 폐기), (2) **오너를 카드 박스**(border+bg-surface-alt, "Owner" 캡션+이름)로, (3) **업데이트 시각을 맨 아래**(Clock+상대시각), (4) **허용인원 목록 삭제**. 목록 제거로 생긴 고아(`listMapPermissions` fetch·`members`/`membersError` state·`PrincipalIcon`·`Building2` import) 정리. 키 `home.owner`. 검증: tsc/lint 0·코드. (호버 트리거 로직 무변경 — 자동 발화는 도구 제약으로 미실행, 내용만 변경.)
- **feat(groups): A11-④ 유저그룹 상단 SVG 안내 가이드 (Message 3 완료, feat/frontend-ui-improvements)** — `groups-guide.tsx`: 목적("사람을 그룹으로 묶어 맵 권한 부여") + **신청①→승인②→사용③** 3단계 SVG 일러스트(바이올렛 번호 원·화살표·캡션). 디자인 토큰(`var(--color-*)`)만 사용, i18n(`perm.group.guide*`). 패널 상단(헤더 아래) 렌더. **Message 3 4건(①매니저 토글 ②카드 디자인 ③가시성 ④가이드) 전부 완료.** 검증: tsc/lint 0·브라우저.
- **feat(groups): A11-①② 매니저=멤버 카드 토글 + 멤버 카드 디자인 (Message 3, feat/frontend-ui-improvements)** — `group-detail.tsx`: 별도 "Managers" 섹션·Add manager 피커 제거 → **단일 Members 섹션**에서 멤버(user) 카드의 **★ Manager 토글**로 관리자 지정(관리자 ⊆ 멤버). 멤버 박스는 홈 상세형 **카드 디자인**(`PersonCard`: 둥근 박스·아이콘·이름·컨트롤). 멤버 아닌 관리자(생성자 등)는 별도 카드(★ active)로 노출, 멤버(user) 제거 시 관리자 캐스케이드. 키 `perm.group.manager/makeManager`. 검증: tsc/lint 0·브라우저(멤버 ☆/관리자 ★ 카드·토글 클릭 시 managerActive 전환).
- **feat(groups): A11-③ 그룹 가시성 필터 — 일반 유저는 '자신이 해당하는' 그룹만 (Message 3, feat/frontend-ui-improvements)** — `list_groups`/`get_group`: sysadmin은 전체, 그 외는 **생성자/관리자/직접 user 멤버/부서 멤버**(상태 무관)인 그룹만. 기존 "active 전체 + 본인 pending" 규칙 폐기. 부서 멤버십은 `_emp_org_path`(Employee org_path) + `logic.belongs_to_department` 재사용. 스키마 무변경. 검증: 백엔드 325 passed(가시성 테스트 새 규칙으로 재작성: 생성자/멤버 보임·stranger 안 보임).
- **feat(admin): A10 승인 큐 케이스 pill 요약 + 클릭 상세 (S6 추가, feat/frontend-ui-improvements)** — 승인 큐를 케이스별 **pill 요약**으로: 그룹 생성(바이올렛)·권한 하향(앰버)·가시성 변경(중립) 각 항목을 `{kind} · {요약}` pill로 노출, **클릭 시 상세 카드 펼침**(그룹: 이름·설명·관리자·멤버수·요청자 / 요청: 맵·payload 상세·요청자·요청시각) + Approve/Reject. 모든 케이스 실데이터 시드(대기 그룹·다운그레이드·가시성). `Field`는 모듈레벨(컴포넌트 내부 정의 린트 회피). 키 `perm.sysadmin.requestedAt`. 검증: tsc/lint 0·브라우저(3 pill·그룹/다운그레이드 상세).
- **feat(admin): A7 남은시간 빨간 강조 + A9 Departments 인원수 열 (S6 추가, feat/frontend-ui-improvements)** — (A7) Scheduled deletion 남은시간을 `text-error font-semibold`(빨간 강조)로. (A9) Departments 표가 **org 보기 OFF(기본)일 때 "인원수(Members)" 열** 추가 — `getAdminUsers().users`를 org_levels 전체 경로 일치로 부서별 집계(말단명 충돌 방지), org 보기 ON이면 기존 orgLevels 열. 키 `perm.sysadmin.deptColCount`(영/한). 검증: tsc/lint 0·브라우저(트래시 빨간 텍스트·Departments Sourcing Team 1=2 등).
- **feat(groups): A8 그룹 카드 인라인 상세 + 매니저=멤버 제한 (S6 추가, feat/frontend-ui-improvements)** — (1) 그룹 카드 클릭 시 `/groups/[id]` 이동 대신 **카드 아래 인라인 상세**(펼친 카드 `sm:col-span-2` 풀폭). 상세 페이지 본문(멤버·관리자·추가/삭제 편집)을 **공용 `components/groups/group-detail.tsx`**로 추출 → 페이지·패널 공용(DRY). 인라인 편집은 `onGroupChange`로 목록 state 갱신. (2) **매니저는 그룹 멤버(user) 중에서만** — 생성 다이얼로그·GroupDetail의 매니저 피커 후보를 멤버 user로 제한, 멤버(user) 제거 시 매니저에서도 캐스케이드, 후보 없으면 안내(`managerFromMembersHint`). 백엔드 `create_group`에 매니저⊆멤버(user) 검증(422, 생성자 자동매니저 예외) — 스키마 무변경. 검증: 백엔드 325 passed(신규 거부 테스트·기존 테스트 멤버화)·프론트 tsc/lint 0·브라우저(카드 인라인 멤버/매니저+편집·Add manager 피커가 멤버 user만).
- **feat(trash): A7 삭제 예정 카운트다운 — "N일/시간 뒤 삭제" (S6 추가, feat/frontend-ui-improvements)** — Scheduled deletion(`admin/deleted-maps-panel`)이 삭제 시각(`Deleted: {ts}`) 대신 **영구삭제까지 남은 시간**을 표시: `deleted_at + 7일(백엔드 RECOVERY_WINDOW) - now`로 ≥1일=`{n}일 뒤 삭제`, <1일=`{n}시간 뒤 삭제`, <1시간=`곧 삭제`. 절대 삭제시각은 title(hover) 유지. `now`는 lazy `useState`(순수성). 키 `trash.purgeInDays/Hours/Soon`(영/한). 검증: tsc/lint 0·브라우저(6일/5시간 케이스 동시 확인).
- **feat(admin): A6 DB 뷰어 디자인 (S6 추가, Image #2, feat/frontend-ui-improvements, 스키마 무변경)** — `<select>` 드롭다운 → **테이블 pill 선택**(아이콘+이름+**행수**) + **카드 컨테이너**(헤더 바: 테이블명 + 필터 + `{total} rows · {loaded} shown`) + **visibility 배지**(public 그린/private 그레이) + 하단 로딩("불러오는 중…")/끝 표시. 무한 스크롤(A1) 유지. 백엔드: `GET /api/admin/tables` 응답 `list[str]`→`list[{name,count}]`(`TableInfoOut`, SELECT COUNT만, **DB 스키마 무변경**) — 소비처 TableViewer 1곳. 검증: 백엔드 ruff·admin 7 passed(목록 테스트 shape 갱신)·프론트 tsc/lint 0·브라우저(pill 17개 행수·process_maps visibility 배지·version_events 84 스크롤 "84 rows · 84 shown"·All rows loaded).
- **feat(admin): A5 관리자 테이블 일괄 디자인 (S6 추가, Image #1, feat/frontend-ui-improvements)** — Employees/Departments/Users 평범한 표 → **공통 셸**(`admin/admin-table.tsx`: `TableCard` 둥근 카드 컨테이너 + `ADMIN_HEAD_ROW`/`ADMIN_TH`(헤더 bg·muted)·`ADMIN_ROW`/`ADMIN_TD`(divider·패딩·hover) + `RolePill`[admin/sysadmin=바이올렛·manager=그린·그외 무지]). 3개 테이블에 일괄 적용(컬럼/데이터 로직 무변경, 스타일만). 검증: tsc 0·lint 0·브라우저(Employees 역할 배지·Users Sysadmin pill·카드 컨테이너 일치).
- **feat(settings): A4 그룹/승인큐 max-width + 승인큐 nav 배지 (S6 추가 디자인, feat/frontend-ui-improvements)** — (1) `GroupsPanel`·`ApprovalQueue` 루트에 `max-w-4xl`로 좌우 폭 제한(와이드 화면에서 과하게 늘어나던 것 방지, 다른 표 탭은 풀폭 유지). (2) 설정 좌측 nav "Approval Queue"에 **대기 건수 배지**(그룹+요청) — 페이지 마운트 시 sysadmin 한정 선조회 + `ApprovalQueue` `onCountChange`로 결정 후 갱신. 검증: tsc 0·lint 0·브라우저(그룹 카드 max-w 적용·배지 "1"=실 pending 일치).
- **feat(perm): A3 승인 큐 실데이터 — 교차맵 sysadmin 큐 (S6, feat/frontend-ui-improvements, 스키마 무변경)** — `approval_requests` 테이블·생성·맵별 목록·decide·apply는 모두 기존 존재, **빠진 건 교차맵(전역) 목록 1개**였음. 백엔드: `GET /api/approval-requests`(sysadmin 전용, pending 최신순) 추가 — 신규 라우트만, **DB 스키마 무변경**. 프론트: `admin/approval-queue.tsx`의 mock(`usePermissions`/`decideRequest`) → 실 API(`listPendingApprovalRequests`+기존 `decideApprovalRequest`)로 교체, 권한 하향/가시성 행을 실 payload로 렌더(`principal:from→to`/`to_visibility`)·decide 후 재조회·진행중 버튼 비활성. mock 미리보기 주석·`currentUserId` prop 제거(부모 정리). 검증: 백엔드 324 passed(신규 교차맵 목록 테스트 2개)·ruff clean·프론트 tsc/lint 0·브라우저(시드 3건 표시→Reject 후 큐에서 사라짐+DB `rejected`/decided_by 기록).
- **feat(admin): A2 유저 그룹 카드 그리드 (S6, feat/frontend-ui-improvements)** — Groups 탭(`groups/groups-panel.tsx`)을 세로 리스트(`flex flex-col`) → **2열 카드 그리드**(`grid sm:grid-cols-2`)로: 카드 = 아이콘+이름(상단)·상태 배지(우상단)·설명(`line-clamp-2`)·**멤버 수**(하단 `mt-auto`). 검증: tsc 0·lint 0·브라우저(그룹 4개 시드 active/pending/rejected). 데모 그룹 4개 생성(구매 검토 위원회 등).
- **feat(admin): A1 DB 테이블 무한 스크롤 (S6 착수, feat/frontend-ui-improvements)** — sysadmin DB 뷰어(`admin/table-viewer.tsx`)를 prev/next 페이지 버튼 → **무한 스크롤**로: 내부 스크롤 컨테이너(`max-h-[60vh]`)+**sticky 헤더**, 하단 80px 도달 시 다음 50행 **append**(추가 로드만 420ms 스피너), **"N / total rows"** 카운트, 끝 **"All rows loaded"**(`db.rowsLoaded`/`db.allLoaded` 영/한). `loadedPage`(.then 설정)로 `isFetching` 파생해 set-state-in-effect 린트 회피, `loadingRef` 동기 가드로 스크롤 중복 방지. 검증: tsc 0·lint 0·브라우저(version_events 84행: 50→스크롤→84·끝 표시).
- **fix(ui): 드롭다운 클릭-어웨이 전체화면 오버레이가 페이지 전체 호버를 막던 근본원인 (검토 라운드 16-4, feat/frontend-ui-improvements)** — **DOM 정밀 분석으로 확증**: 필터·유저메뉴 드롭다운이 열리면 `fixed inset-0 z-[1000]`(pointer-events:auto) 오버레이가 **뷰포트 전체를 덮어** 카드·버튼의 `:hover`/포인터를 가로채 → "마우스 추적 안 됨·호버 안 따라옴". (`elementFromPoint`가 오버레이 반환, `cardBlockedByOverlay:true`로 확인.) **해결**: `filter-dropdown`(홈 상태/권한 필터)·`top-nav`(전역 유저 메뉴)의 오버레이 div 제거 → **`document` mousedown 외부클릭 리스너**로 대체. 확증: 드롭다운 **열린 상태에서도** `fullScreenOverlays:0`·`cardHittable:true`·메뉴 정상 동작. (search-select 등 다이얼로그 내 동일 패턴은 모달 백드롭 맥락이라 후순위.)
- **fix(home): 호버 모달이 디테일 패널을 가려 호버가 마우스를 안 따라오던 문제 (검토 라운드 16-3, feat/frontend-ui-improvements)** — 근본 원인: 호버 가능한 모달(`pointer-events` 활성 + 닫힘 디바운스)이 우측 디테일 패널 위를 덮어 그 영역 호버/클릭을 가로채 "호버가 안 따라옴"·"마우스 추적 안 됨"으로 느껴짐. **모달을 `pointer-events-none`(통과)로** + **카드 벗어나면 즉시 닫힘**으로 단순화(모달 호버 핸들러·150ms 디바운스 제거). 이제 모달은 읽기 전용, 디테일 패널/다른 카드 호버를 막지 않음. 브라우저 확인(모달 위로 마우스 통과·카드 이탈 시 즉시 닫힘).
- **fix(home): 카드 클릭 시 호버 모달이 안 풀리는 버그 + H2c·H3 완료 (검토 라운드 16-2, feat/frontend-ui-improvements)** — 카드 클릭(선택) 시 대기 중 **1초 open 타이머가 취소되지 않아** ①클릭 후 모달이 뒤늦게 떠 디테일 패널을 가리거나 ②열린 모달이 안 닫혀 마우스 추적이 막히던 문제. `onClick`에서 `clearOpen()`+`clearClose()`+`setModalOpen(false)` 선행. 언마운트 타이머 정리 effect 추가. 트래커 **H2c·H3 ✅ 완료** 체크. 검증: tsc 0·lint 0·브라우저(호버→모달→클릭=닫힘+선택 확인).
- **fix(home): H3 날짜박스 실제 높이·H2c 테두리색·카드 호버 모달 통합 (검토 라운드 16, feat/frontend-ui-improvements)** — **H3**: 날짜 박스를 inner span(h-full 미작동)→**`<td>` 자체에 테두리** → rowspan 만큼 실제 높이 증가(2일=2배·3일=3배 아래로), 날짜 윗 정렬. **H2c**: me(하이라이트) 행 펼침 필 테두리색 `border-divider`(배경처럼 어색)→**`border-ink-tertiary/40`**(부드러운 반투명). **카드 호버 간소화**: 인원 수 hover 툴팁 + 미선택 1.5초 요약 2개 → **하나의 모달**(모든 카드 **1초** 호버→우측, **요약+인원 목록** 포함), 모달 호버 유지(`clearClose`), **카드/모달 벗어나면 150ms 뒤 닫힘**. 인원 수는 표시만(호버 트리거 제거). 검증: tsc 0·lint 0·브라우저(모달·날짜박스·테두리 확인).
- **feat(home): 카드 재디자인(H4/H5 이미지)·H3 날짜 rowspan·H2c 테두리·역할이동·요약툴팁 (검토 라운드 15)** — **카드(이미지 반영)**: 메타 한 줄 = 좌[소유자·**상대시각**(방금/N분 전…, i18n+마운트시각)] / 우[**노드·버전·인원 수** Workflow·GitBranch·Users 아이콘]. 인원 수가 H4 호버 트리거(툴팁 유지). **member_count** 백엔드 집계 추가(`MapPermission` count). 새창버튼 제거→**우측상단 공개/비공개 아이콘**(Globe/Lock). **역할 배지=가시성 아이콘 왼쪽**으로 이동, **공개+뷰어면 생략**(에디터/오너만). **미선택 카드 1.5초 호버→우측 요약 툴팁**(아이콘 의미+값). **H3**: 날짜/시각 각각 필 + 같은 날짜는 **rowspan 박스 1개**(행 높이만큼, 날짜 윗 정렬) — 테이블 구조. **H2c**: me(하이라이트) 행 펼침 필 테두리 `border-hairline`→`border-divider`(투명 배경에서도 보이게). 검증: tsc 0·lint 0·백엔드 **322 passed·ruff clean**·브라우저 전부 확인.
- **feat(home): H5b 카드 집계 — 노드수(라이브)·버전수(전체)·소유자명 (검토 라운드 14, 사용자 승인 백엔드 변경)** — 맵 목록(`GET /maps` → `MapOut`)에 read-only 집계 3필드 추가: **version_count**(전체 버전), **node_count**(라이브=published 버전 노드, 없으면 최신 폴백 — 사용자 확정), **owner_name**(`created_by`→`Employee.name`). `list_maps`에 그룹 쿼리 4개(N+1 회피)+`_set_card_metrics` 헬퍼, ProcessMap transient attr 주입. 프론트 `MapSummary`+카드 메타에 Workflow(노드)·Layers(버전) 아이콘 표시, 소유자=`owner_name??created_by`. 테스트 +1(목록 집계) **322 passed·ruff clean**, tsc 0·lint 0. 데모: map 7 published 노드 6개 삽입. 브라우저 확인(Junho Kim·노드6·버전5 등).
- **feat(home): H4 카드 허용인원 호버 툴팁 + H5a 카드 소유자·수정시각 + H3 여러날짜 데모 + H2c 완료 (검토 라운드 14, feat/frontend-ui-improvements)** — **H4**: 카드 "Allowed members" 클릭 팝오버 → **호버 툴팁**(`onMouseEnter`/`onMouseLeave`, 닫힘 120ms 디바운스로 버튼→툴팁 이동 허용, 클릭-어웨이 오버레이 제거, 포커스 키보드 지원). **H5a**: 카드 3번째 줄 메타 **소유자(`created_by`)·수정시각(`updated_at`)**(User·Clock 아이콘) — 프론트 가능분. 소유자 '이름'·노드/버전 수는 H5b(백엔드). **H3 여러날짜 데모**: map 7 이벤트를 06-05~06-27 여러 날짜로 백데이트(version.created_at=최신 이벤트) → 날짜 중복제거가 날짜 바뀔 때만 표기 확인. **H2c ✅ 완료** 체크. 검증: tsc 0·lint 0·브라우저(H4 호버·H5a 메타·H3 dedup).
- **feat(versions): 생성 게이트=최신 published 필요 + withdraw 이벤트 기록 + H3 withdrawn·날짜중복제거 (검토 라운드 13, 사용자 승인 백엔드 변경)** — ②**생성 게이트 재강화**: `create_version`을 "최신 버전 status==published"로 — approved(승인했지만 미게시)에서도 차단, **게시해야 새 작업본 시작**(`select(MapVersion.status)`만 조회해 source clone selectinload 무효화 방지). ③**withdraw 이벤트 기록**: `withdraw_version`에 `record_version_event("withdrawn")` 추가(이전엔 status만 변경). 프론트 `version-timeline`에 **withdrawn 단계**(Undo2 아이콘·changed색·`home.verEvent.withdrawn` 영/한) + EVENT 매핑. ①**H3 날짜 중복 제거**: 상세행 시각이 직전 행과 **같은 날짜면 시각(HH:mm)만**, 첫 행만 날짜 표시(시각 우측정렬). 헤더 우측 시각 유지. 테스트: 생성 게이트 5케이스(draft/pending/rejected/approved 차단·published 허용)·withdraw 이벤트 기록 — **321 passed·ruff clean**, tsc 0·lint 0. 데모 **map 7 "Version History"**(v2=거절 이력, v3=철회 이력 포함). **서버 재기동**(stale·--reload 없음→sim+--reload, backend/ CWD).
- **fix(home): me 아이콘 폭 정렬·H2c 칩 투명+각 행·H3 펼침 높이유지 + H2/H2b/H6 완료 (검토 라운드 12, feat/frontend-ui-improvements)** — ②**me 배지 폭**: `Hand+ME`가 일반 아이콘(12px)보다 넓어 이름줄 어긋남 → 아이콘 래퍼 `w-6 justify-center` 고정폭으로 모든 멤버 아이콘 정렬. ③**H2c 칩 배경 제거**: 펼침 필 `bg-surface-alt/accent-tint/surface` → **투명(border만)** — 내 소속 하이라이트 행에서도 자연스럽게. ④**아이디·타이틀 각 행으로**: `flex-wrap`(같은 줄) → `flex-col items-start`(부서 레벨처럼 1줄씩). ⑥**H3 펼침 높이 유지**: 칩이 즉시 사라져 높이 줄었다 커지던 문제 → 칩 접힘(`grid-rows`+페이드)과 상세 펼침을 **동시 전환**(크로스페이드)해 높이 단조 증가. ①⑤ 트래커 **H2·H2b·H6 ✅ 완료** 체크. 검증: tsc 0·lint 0.
- **feat(versions): 새 버전 생성 게이트 강화 — 진행중 작업본 1개 제한 (검토 라운드 11 #2, 사용자 승인 백엔드 변경)** — 기존 `create_version`은 **draft 1건만** 차단해 rejected/pending/draft가 동시에 존재할 수 있었음(비현실적). **`status in {draft, pending, rejected}` 버전이 있으면 409**로 강화 — 작업본을 마무리(승인·게시)·삭제해야 새 버전 생성. `publish`가 기존 published를 approved로 강등하므로 approved=정상 이력 → approved/published는 통과. `versions.py:137`. 테스트 +3(pending/rejected 차단·published 후 허용), **319 passed·ruff clean**. 데모 맵 현실화: map 4(혼재) 삭제 → **map 5 "Version History Demo"**(As-Is/v2/v3 approved 이력 + v4 published + Working draft).
- **fix(home): 콜랩스올 섹션 헤더 우측 + 단계필 폭 통일 + 트래커 S6~8 상세 (검토 라운드 11, feat/frontend-ui-improvements)** — ①**모두접기 위치**: 상단 별도 행(컴포넌트 밀림) → **섹션 소제목 우측**(VERSIONS 헤더 우측=버전만 접기, Allowed members 헤더 우측=멤버만 접기). 단일 collapseAll → `collapseVersions`/`collapseMembers`. ②**H3 단계 필 폭 통일** `w-fit`→`w-24 justify-center`(Published/Submitted 등 동일 폭, 이름·아이디·시간 열 정렬 강화). ③**트래커 S6~8 상세 복원**(통합 문서라 A1~A3·E1~E4·I1~I6 단위 유지). 검증: tsc 0·lint 0·브라우저 확인.
## 2026-06-27
- **feat(home): H3·H2c 클릭 토글·다중 펼침·모두접기 + H3 상세행 그리드 정렬 (검토 라운드 10, feat/frontend-ui-improvements)** — ①**호버 펼침 → 클릭 토글**: 버전 박스·유저 멤버 행을 클릭하면 펼침/접힘(여러 개 동시), 호버는 **커서 포인터 + 일반 호버**(버전=hover bg, 유저=hover ring). 펼침 상태는 detail-card가 보유(VersionTimeline controlled), 키보드(Enter/Space) 지원. ②**모두 접기**: 펼친 게 있으면 상세 상단 우측에 "Collapse all"(`home.collapseAll`) — 버전·멤버 전부 접음. ③**H3 상세행 그리드 정렬**: `grid grid-cols-[auto_minmax(0,1fr)_auto_auto]`로 단계필·이름·**아이디**·시간 열 정렬(아이디 시작 위치 동일). H2 팀 호버는 유지(완료). 검증: tsc 0·lint 0.
## 2026-06-27
- **fix(home): H3 풀 타임스탬프·최신순·이징 + H2c 롤배지 위치 (검토 라운드 9, feat/frontend-ui-improvements)** — ①**H3 타임스탬프** `MM-DD HH:mm` → **`YYYY-MM-DD HH:mm`**(`formatKst`). ②**버전 최신순 정렬**(`[...versions].reverse()`) — idx 0=최신=Current 배지(백엔드는 오래된순 반환). ③**펼침 이징** `ease-smooth`(200ms) → **`ease-in-out`(300ms, 처음·끝 느리게)** — H3 상세행·H2c 유저 펼침 동일. ④**H2c 롤 배지 위치 고정**: 행 `items-center`→`items-start` — 펼쳐져도 역할 배지가 이름줄에 고정. 검증: tsc 0·lint 0. **데모: 5버전 맵(map 4 "Five-Version Demo")** API 생성 — As-Is[approved·4이벤트]/v2[rejected·3]/v3[published·4]/To-Be[pending·2]/Working[draft·1].
## 2026-06-26
- **fix(home): H3 상세행·H2c 펼침 필(pill) 기반 재디자인 — 가시성 (검토 라운드 8, feat/frontend-ui-improvements)** — 호버 펼침 정보밀도 과다·긴 라벨로 레이아웃 깨짐 보완. ①단계 라벨 축약: `submitted for approval`→`Submitted`(en 5종 Title Case, ko `승인 요청`→`요청`). ②**H3 상세행 필화**: `[단계 필(색·아이콘+짧은 라벨)] 이름 [아이디 필(괄호 제거)] 시간`, 간격↑(`py-0.5 gap-2`), 이름 truncate. 미사용 `STAGE_COLOR` 제거. ③**H2c 유저 펼침 필화**: 텍스트 다행 → **아이디·타이틀·부서레벨 필 wrapping**(괄호 없이, `flex-wrap gap-1`). 검증: tsc 0·lint 0.
- **fix(home): H3 칩 호버 상세행 + H2c 유저 다행 펼침 — 확정 사양 재작업 (검토 라운드 7재, feat/frontend-ui-improvements)** — 두 번 오해 후 확정 질문으로 사양 고정. ①**H3**: 평소 칩 2줄 → **박스 호버 시 칩 숨기고 이벤트별 상세 행**(단계 아이콘+라벨 · 이름(아이디) · 시간) 펼침. 단계=생성/요청/승인/거절/게시 5종(`STAGE_COLOR`). ②**H2c 유저 행**: 평소 [이름 / 말단부서] → 호버 시 [이름 / (아이디) / 타이틀 / 부서 레벨 **작은→큰 각 행**] 아래로 펼침(`group-hover` + `grid-rows` + 평소 말단부서 `group-hover:hidden`). 멤버 아이콘 상단 정렬. 검증: tsc 0·lint 0. [[ask-when-ambiguous]] 적용.
- **feat(home): H3 호버 펼침 히스토리(이름) + H2c 유저 호버 펼침 (검토 라운드 7, feat/frontend-ui-improvements)** — ①**H3 재구성**: 이벤트 칩을 **2줄까지 표시**(`max-h-12`) → **버전 박스 호버 시 전체 펼침**(`group-hover:max-h-48`, 200ms). 칩 행위자를 **아이디→이름**(`nameById` prop을 detail-card에서 주입). ②**H2c 유저 행 호버 펼침**: 평소 **이름만**(아이디·직급·부서 숨김) → 행 호버 시 **(아이디) 노출 + 직급·부서 2번째 줄이 아래로 펼쳐짐**(`group-hover` + `grid-rows-[0fr→1fr]`). 부서 상위소속/유저 상세는 CSS `group-hover`로, 팀 상위/하위 교차 하이라이트는 `hoveredPath` 상태 유지. 검증: tsc 0·lint 0.
- **feat(home): H3 버전 히스토리 재디자인 + H2 팀 호버 + H2b 구분선 (검토 라운드 6, feat/frontend-ui-improvements)** — 사용자 제공 이미지 기준. ①**H3 재작성**(`VersionTimeline`): 호버 펼침 폐기 → **좌측 타임라인 노드(최신 이벤트색·아이콘, 승인/게시=채움 green) + 버전 카드(라벨·상태배지·현재배지·시각) + 이벤트 칩(타입별 색·아이콘+행위자)** 항상 표시. 신규 i18n `home.verCurrent`. ②**H2 팀 호버**: 부서 2번째 줄은 평소 **구성원 수만**(상위 org 숨김), 팀 행 호버 시 상위 소속 노출 + **상위/하위 팀 하이라이트**(멤버수 중복 인지) — `hoveredPath` 상태·prefix 관계. ③**H2b 구분선**: 버전·인원 사이 세로선 `border-divider`(#f0f0f0, 흐림) → `border-hairline`(#e6e6ea, 진하게). 검증: tsc 0·lint 0.
- **feat(home): H3 버전 호버 펼침 + 상세 비율 2:1·세로선 + 멤버수 아이콘 (검토 라운드 5, feat/frontend-ui-improvements)** — ①**H3**: `VersionTimeline` 버전 카드 호버 시 이벤트 요약을 `grid-rows-[0fr→1fr]`(200ms)로 펼침 + 라벨 옆 ⓘ 힌트(호버 시 페이드). ②**상세 패널 비율**: 버전:인원 = `flex-1:flex-1`(1:1) → **`flex-[2]:flex-1`(2:1, 디자인)**, 컨테이너 `flex-wrap`→`flex-col sm:flex-row`, 인원 컬럼에 `sm:border-l`(버전·인원 사이 **세로 구분선**). ③**멤버 카운트 아이콘화**: 부서·그룹 2번째 줄 "N members" 텍스트 → `Users` 아이콘 + 숫자(· org1/상태). 검증: tsc 0·lint 0.
- **feat(home): H2 개정 — 멤버 2번째 줄 유형별 정보 + 디렉터리 title·org_path (검토 라운드 4, feat/frontend-ui-improvements)** — 멤버 행 2번째 줄을 유형별로: **유저=직급·말단 org**, **부서=구성원 수(해당 부서 경로로 시작하는 org_path 인원)·루트 org1**, **그룹=구성원 수·활성 상태**. ①**백엔드**(사용자 승인): `DirectoryUserOut`에 `title`·`org_path` 추가(읽기 전용, `Employee.title`·`org_l1~l5` 파생, 스키마 변경 없음), `/directory` 라우터가 채움. 디렉터리 계약 테스트 갱신(`...has_only_id_name_department` → `...excludes_sensitive_fields`, allowed_keys 확장, email/active 미노출 가드 유지). ②**프론트**: `DirectoryUser.title`, `titleById`/`orgPathById`/`groupInfo` 맵, 부서 카운트는 디렉터리 org_path 접두 매칭, 그룹은 `listGroups` 구성원수·상태. i18n `home.memberCount`·`home.group{Active,Pending,Rejected}`. 검증: backend **316 passed**·ruff clean, 프론트 tsc 0·lint 0, 디렉터리 API title·org_path 반환 확인.
- **feat(home): H2 멤버 행 2번째 줄 소속 + H1 필터 아이콘 (검토 라운드 3, feat/frontend-ui-improvements)** — ①**H2**: 맵 상세 허용 멤버 행을 2줄로 — 1줄(부서 말단/유저 이름(아이디)/그룹), 2줄 소속(부서=상위 org_path `›`, 유저=부서) 뮤트 표시. 디렉터리에서 `deptById`(id→부서) 구축, `deptParent` 헬퍼. ②**H1 아이콘**: `FilterDropdown`에 버튼/옵션 아이콘 지원 추가 — Status 버튼 `CircleDot`+옵션 상태색 점, Role 버튼 `ShieldCheck`+옵션 `Crown`/`PencilLine`/`Eye`. 검증: tsc 0·lint 0.
- **fix(home): H1 필터 드롭다운화·권한 필터 추가·H6 1:2 비율 (검토 라운드 2, feat/frontend-ui-improvements)** — ①**H1 개정**: 상태 필 행 → **멀티셀렉트 드롭다운**(신규 `FilterDropdown` 컴포넌트, 라벨+선택수+체크 목록) + **권한(역할) 필터 드롭다운 추가**(owner/editor/viewer, `my_role` 기준). Clear는 `ml-auto`로 **우측끝**. 신규 i18n `home.filterStatus/filterRole`. ②**H6 비율**: 폭만 바꿨던 것 보완 — 좌:우 컬럼을 `flex-1 : flex-[2]`(1:2)로, 동일 `max-w-[34rem]` 캡 제거(캡 때문에 1:1로 보이던 문제). 검증: tsc 0·lint 0.
- **feat(home): S5 H1 상태 필터 필 + H6 컨테이너 폭 1280 (feat/frontend-ui-improvements)** — ①**H1**: 홈 좌측에 상태 필(초안/검토중/승인됨/반려/게시) 다중선택 추가 — 가시성 탭과 **AND**(각 그룹 내 OR), 둘 다 비면 전체. 선택 시 "필터 해제"(신규 `home.filterClear`). `VERSION_STATUS_LABEL` 재사용. ②**H6**: 마스터-디테일 컨테이너 max-width `72rem`(1152)→`80rem`(1280). 검증: tsc 0·lint 0.
- **fix(home): viewer에게 허용 멤버 목록 노출 — 프론트 게이트 완화 (B1 완결, feat/frontend-ui-improvements)** — B1(a) 백엔드는 풀었으나 프론트가 여전히 `editor||owner`로 멤버 조회를 막던 부분(사용자 플래그한 "카드 상세창"). `map-detail-card`(멤버 fetch 게이트)·`map-card`(`canViewMembers`)를 `my_role !== null`(접근 권한자=viewer+)로 완화. 동반 fetch(`listGroups`·`getDirectory`)도 viewer 접근 가능(get_current_user) 확인. 검증: tsc 0·lint 0.
- **fix(viewer): 토스트 폭주·뷰어 체크아웃 배지·설정 좌측 패딩 (B2 외, feat/frontend-ui-improvements)** — 검토 라운드 1 버그/요청. ①**B2 토스트 폭주**: viewer가 설정 진입 시 권한 패널들이 각자 로드 403을 토스트로 띄워 누적 → 설정 `showToast`에서 `failed: 40[13]`(권한거부) 메시지 무음 처리. ②**뷰어 체크아웃 배지 제거**: 에디터 헤더의 `editingByOther`(+Force edit)·`editingMine` 배지를 `!isViewer`로 게이트(뷰어는 V1 배지+V2 스트립으로 충분, 체크아웃 UI 무의미). ③**MS1 좌측 패딩 확대**: 설정 main `p-6` → `py-6 pl-12 pr-6`(좌 24→48px). 검증: tsc 0·lint 0, viewer 설정·에디터 화면 확인(토스트 없음·배지 없음·멤버 표시·패딩↑).
- **feat(perm): viewer 멤버 목록 읽기 허용 (B1a, feat/frontend-ui-improvements)** — viewer가 홈 카드/설정에서 허용 멤버를 못 보던 문제. `GET /maps/{id}/permissions` 게이팅 `require_map_role("editor")` → `"viewer"`(읽기만; 추가/변경/삭제는 editor/owner 유지 — 비대칭). 사용자 승인 (a). 테스트 `test_collaborators_viewer_403` → `test_collaborators_viewer_can_read_not_write`(viewer GET 200·멤버 노출·POST 403). 검증: backend **316 passed**·ruff clean. **백엔드 변경**(프론트 브랜치, 사용자 승인 하 진행).
- **refactor(viewer): S4 검토 수정 — 읽기전용 안내 일반화·워터마크 자물쇠 제거·세이브 잠금 (feat/frontend-ui-improvements)** — 검토 라운드 1 반영. ①**읽기전용 안내 일반화**(`readOnlyMessage`): 클론 문구 삭제 + 사유별 — 뷰어 / 타인 체크아웃(`{name} is editing`) / 비-draft 상태(결재중·승인됨·게시됨). 에디터 노티스가 `readOnly` 전 사유 커버(기존 viewer 전용 → 확장), i18n `editor.viewerNotice/cloneToMine`·`err.copyMap` 제거하고 `editor.readonly.*` 5키 추가. ②**워터마크 자물쇠 제거**(보라 "READ ONLY"만). ③**Save 비활성+잠금 아이콘**으로 환원, 클론 버튼 제거(copyMap api는 유지, 프론트 노출 보류) → `handleClone`·`useRouter`·`copyMap`·`Copy` import 정리. 검증: tsc 0·lint 0, :3000 viewer 화면 확인. 버그 진단(B1 viewer 멤버 미표시=백엔드 게이팅·확인 필요, B2 토스트 폭주=패널 로드에러 토스트·프론트 수정 예정)은 검토문서 기록.
- **refactor(map-settings): MS1 검토 수정 — 콘텐츠 좌측 정렬 (feat/frontend-ui-improvements)** — 검토 라운드 1. 설정 우측 콘텐츠 중앙(`mx-auto`) → **왼쪽 정렬**(`flex w-full max-w-[680px]`, 좌측 패딩은 main `p-6` 유지, 과넓음 방지 반응형). 검증: tsc 0·lint 0.
- **feat(viewer): S4 에디터 뷰어 읽기전용 모드 — 배지·안내 스트립·워터마크·복제 (feat/frontend-ui-improvements)** — 화면 리디자인 S4(`app/maps/[mapId]/page.tsx`). **토대**: 에디터에 `my_role`(getMap) 저장 → `isViewer` 파생 → `readOnly`에 통합(뷰어는 항상 읽기 전용; 기존엔 체크아웃/상태만 봐서 draft 공개맵 뷰어가 편집 가능했던 허점 차단). **V1** 헤더 "읽기 전용" 배지(`Lock`). **V2** 헤더 아래 옐로우 안내 스트립(`bg-notice` 재사용 + `Info`, `editor.viewerNotice`). **V3** 워터마크 회색→**보라 accent 14%+`Lock`+"READ ONLY"**(`editor.watermark`). **V4** Save 버튼을 뷰어일 때 **"내 맵으로 복제"** primary로 교체(`copyMap`→새 맵 이동, `editor.cloneToMine`; 승인본 없음/중복명 409는 토스트). `data-id` 4개. **V5(버전 선택 pill)는 보류** — 기존 버전 컨트롤로 열람 가능, 후속. 검증: tsc 0·lint 0·build OK. 비뷰어(Daehyun Choi) 에디터 무변경 확인. **뷰어 화면 라이브 미확인** — 시드에 viewer 그랜트 없음(공개맵=편집역할, 비공개맵=비협업자 접근불가). 로직/타입/빌드 검증 완료.
- **feat(maps): S3 삭제 확인 모달 아이콘 64px (feat/frontend-ui-improvements)** — 화면 리디자인 S3. 기존 `delete-map-dialog.tsx`가 디자인과 이미 일치(빨간 휴지통 원·3줄 안내·취소/삭제) → 갭은 아이콘 원 56→**64px**(`h-16 w-16`, 아이콘 24→28)뿐. 재제작 없이 차이만 보완. 검증: tsc 0·lint 0·build OK.
- **feat(map-settings): S2 맵 설정 폭·뷰어 안내 스트립 (feat/frontend-ui-improvements)** — 화면 리디자인 S2(`app/maps/[mapId]/settings/page.tsx`). `MS1` 우측 콘텐츠 max-width `max-w-3xl`(768) → `max-w-[680px]`(중앙 정렬 유지). `MS2` 뷰어 읽기전용 안내 스트립을 평문 회색 → **옐로우 안내 박스**(신규 토큰 `--color-notice` `#fdf8ec`·`--color-notice-border` `#e2c98f` + `text-changed` + Lucide `Info`). `data-id="settings-readonly-notice"`. 검증: tsc 0·lint 0·build OK. 시각: 680px 중앙 정렬 확인(브라우저). 뷰어 노티스는 현 시드에 viewer 권한 테스트 유저가 없어 화면 트리거 미확인(마크업/토큰/타입은 검증) — S4 뷰어 작업 시 재확인 예정.
- **feat(login): S1 로그인 화면 디자인 반영 — 카드 풀 레이아웃 + dev 모달 멤버-로우 (feat/frontend-ui-improvements)** — 화면 리디자인 핸드오프 S1. ①로그인 페이지(`app/login/page.tsx`): 브랜드 마크(56px `accent-tint` 라운드 + Lucide `Workflow`) · 제목 · 안내문(신규 `login.subtitle`) · primary(`LogIn`) · 구분선("or"/"또는", 신규 `login.or`) · secondary Keycloak(`Lock`) · 푸터(신규 `login.terms`). **운영(`AUTH_ENABLED`)은 Keycloak 단독**, 로컬은 임시+Keycloak 이중(테스트 계정 로그인을 운영에 미노출 — 보안). ②dev 모달(`dev-login-modal.tsx`): 닫기 X(신규 `action.close`) · 행마다 `UserRound` + 이름(아이디) + 부서 2번째 줄 + 역할 배지(admin=accent/user=tertiary) + hover accent 보더·연보라. ③신규 토큰 `--color-ink-muted: #a0a0a8`(placeholder/뮤트 텍스트 재사용). i18n 영/한 동일 추가. 검증: tsc 0 · lint 0 · build OK(`/login` 정적) · 브라우저 3000↔3100 시각 비교.
- **fix(canvas): 캔버스 좌우 휠 패닝 활성화 (feat/frontend-ui-improvements)** — 에디터 캔버스에서 shift+휠·트랙패드 좌우 제스처가 먹히지 않던 문제. 원인: `panOnScrollMode`가 `PanOnScrollMode.Vertical`로 고정돼 React Flow가 세로 스크롤 델타만 패닝에 반영하고 가로 델타(deltaX)를 무시. 수정: `Vertical` → `Free`로 변경(`page.tsx:5770`) — 세로 휠=상하 패닝(기존 유지), shift+휠·트랙패드 좌우=가로 패닝(신규), Ctrl/Cmd+휠=줌(기존 유지). 주석도 좌우 패닝 반영해 갱신. enum 멤버 유효성은 `@xyflow/system` 타입 정의로 확인(`Free="free"`). 미실행: 브라우저 수동(실제 좌우 휠 패닝).

## 2026-06-25
- **fix(metrics): 로그인 기록 하루 1건 중복제거 — 맵 열 때마다 찍히던 것 수정 (feat/flow-rbac-improvements)** — 검토: `/api/me`가 앱 마운트(providers.publishMe)마다 호출 → 맵을 새 탭으로 열거나 새로고침·토큰갱신 시마다 LoginRecord 1건씩 쌓임(로그인 아님). 수정: `/me`에서 **KST 자정 이후 기록이 없을 때만** 추가 → "그날 접속" 단위 하루 1건. 테스트: 같은 날 3회 호출 → 1건. 검증: backend 316 passed·ruff clean.
- **feat(time)+fix(i18n): 타임스탬프 KST 기준 + 승인 대기 상태 영어 고정 (feat/flow-rbac-improvements)** — ①**KST**: 공용 `app/clock.py`(KST=UTC+9, `now()`) 신설, `models._now`·라우터의 `datetime.now(timezone.utc)`(maps·ai·graph·versions) 전부 KST로 통일. `checkout._as_aware`는 naive(스토어 기준시 KST)를 KST로 라벨링(기존 UTC 오인 → 체크아웃 만료 9h skew 버그 수정). 프론트 표시는 `lib/datetime.formatKst/Short`(Asia/Seoul 고정)로 — comment·삭제예정·버전 타임라인 적용(브라우저 tz 무관 KST). ②**승인 대기 영어 고정**: 상태 라벨 5개(`home.verStatus.pending`·`perm.rolePending`·`group.statusPending`·`visibilityPending`·`version.waitingApproval`) KO값을 영어로(토스트/문장은 한글 유지). 검증: backend **316 passed**·ruff clean, 프론트 tsc 0·lint 0err·vitest 36·build OK.
- **fix(i18n): 역할(Owner/Editor/Viewer) 라벨 한글에서도 영어 고정 (feat/flow-rbac-improvements)** — 한↔영 전환 중 에디터/뷰어 라벨이 레이아웃을 깨기 쉬워, KO 값도 영어로 고정. `perm.roleOwner/Editor/Viewer` + `perm.createDialog.collaboratorRole{Viewer,Editor}` 5개 키의 한글값을 Owner/Editor/Viewer로. 모두 i18n 키 경유라 RoleBadge·협업자 select·생성 다이얼로그 등 전 화면 일괄 적용(주석 외 하드코딩 역할어 없음). 검증: tsc 0·lint 0err·build OK.
- **feat(metrics): 로그인 기록 수집 — login_records 테이블 + /me 시 기록 (feat/flow-rbac-improvements)** — 사용자 현황조사용. `LoginRecord` 모델(login_id·name·occurred_at, 인덱스) 추가, `/api/me`(앱 로드 시 호출) 호출마다 1건 기록. 테이블은 startup `create_all`로 자동 생성(새 테이블이라 마이그레이션 불필요). 집계·리포트·중복제거는 후속(현재는 raw 기록만, 요청 범위). TDD 테스트(/me 2회→레코드 2건). 검증: backend **316 passed**·ruff clean.
- **fix: 리뷰 4차 — A1 엣지라벨 포커스·A2 아웃라인 Start/End·A3 핸들박스 히트박스+커넥터·F14 뒤로/리셋·AP 계층·설정 협업자 즉시추가 (feat/flow-rbac-improvements)** — **A1**: 엣지 더블클릭 시 인스펙터 입력이 인라인 박스 포커스를 뺏어 즉시 blur→커밋되던 버그 — 인라인 박스 못 띄울 때만 인스펙터 포커스(빈 라벨도 박스+캐럿). **A2**: 아웃라인 start/end 빈 라벨 "Untitled" → terminalDisplayLabel. **A3**: 핸들 박스 변 strip 8px 확대 + **박스 잇는 커넥터가 선택 면 반영**(절대배치 SVG). **F14**: `getFlowPathBackward`도 BFS(뒤로 분기) + pane click 시 flow 초기화(재선택 잔존 방지). **AP 계층**: 생성 다이얼로그 부서 협업자를 org_path 하위(센터→하위 팀/그룹 전원)까지 후보 포함. **설정 협업자 추가**: CollaboratorsPanel도 선택 즉시 추가(Add 버튼 제거). 검토문서 4차 추가. 검증: 프론트 tsc 0·lint 0err·vitest 36·build OK.
- **feat(create): 생성 협업자 드롭다운 선택 즉시 추가(Add 버튼 제거) + 검토문서 최신화 (feat/flow-rbac-improvements)** — 생성 다이얼로그 협업자 picker에서 **선택(클릭/Enter) 즉시 현재 역할로 추가** — 기존엔 선택 후 옆 Add 버튼을 눌러야 했고 역할 미설정 혼선. `handleAddCollab(pendingCollab)` → `addCollaborator(opt)`로 바꿔 onSelect에 직결, Add 버튼·선택 미리보기·`pendingCollab` 상태 제거. 검토 피드백 문서(2026-06-25-review-feedback-backlog) 전면 최신화(수정항목 1~3차 반영, F1/F14/ST/DL/HM 확인완료). 검증: 프론트 tsc 0·lint 0err·vitest 36·build OK.
- **feat: 리뷰 2차 — F14 분기 일괄 강조·ST 카드 축소·HM me아이콘·AP 소속자격·PV 단일옵션·세팅순서·카드 멤버 포털 (feat/flow-rbac-improvements)** — ①**F14**: `getFlowPathForward` BFS로 **분기 엣지 일괄 강조**(사이클/중복합류는 seen으로 차단). vitest +1(36). ②**ST**: 승인자 카드를 `grid-cols-3/4`+`aspect-[4/3]`로 ~2/3 축소·직사각형, 텍스트 truncate. ③**HM**: 본인 표시를 'me' 원형 배지 → **손든 사람(Hand) 아이콘 + 작은 ME**(악센트 선색). ④**AP**: 생성 다이얼로그 승인자 후보에 **부서 협업자의 부서원(부서명 매칭)·그룹 협업자의 멤버** 포함(설정은 서버 effective_role이 이미 부서권한 반영). ⑤**PV**: 생성 협업자 역할이 public이면 editor 1옵션 → 드롭다운 대신 정적 표시(화살표 제거). ⑥**세팅 순서**: 정보>공개범위>협업자>결재자>버전>결재대기>위험구역. ⑦**맵 카드 멤버 보기**: 리스트 overflow/z-index에 잘리던 팝오버를 **body 포털(fixed)**로(스크롤 시 닫힘). 검증: 프론트 tsc 0·lint 0err·vitest 36·build OK (백엔드 무변경).
- **feat: 수정항목 9건 (feat/flow-rbac-improvements)** — ①엣지 라벨 편집박스 또렷하게(accent ring·캐럿·placeholder). ②start/end 노드 기본 라벨 공란(표시는 Start/End). ③엣지 시작/끝 핸들 박스를 가로로 길고 낮게(상하공간 절약; 메뉴 박스는 edges 반응형이라 클릭 즉시 반영). ④캔버스 승인자 관리 모달을 생성 다이얼로그 picker(viewer+ PrincipalPicker+선택목록)로 통일. ⑤홈 상세 유저=이름(아이디 회색)·말줄임, 검색·필터탭을 좌측 리스트 컬럼 상단 같은 폭으로 이동. ⑥에디터 무선택 상세의 Open 버튼 제거(hideOpen). ⑦저장 시 start/end 누락 에러를 상단배너→토스트. ⑧노드 타입별 색 세트(메인6·start/end3·분기4)+접기(숨기기) 제거, 헥스는 인스펙터에서 아이콘(Palette)→입력 토글. ⑨생성 다이얼로그 협업자 picker 드롭다운 플로팅(absolute, 레이아웃 안 밀림)+추가된 협업자 권한 클릭 토글(viewer↔editor, 호버). 3개 커밋(#1/2/5/6/7 · #4/9 · #3/8). 검증: 프론트 tsc 0·lint 0err·vitest 35·build OK (백엔드 무변경).
- **feat: 리뷰 라운드 — F1(디시전 드롭 3분기)·F14(하이라이트 클램프)·ST(세팅 재구성)·DL(시각 삭제)·HM(조직 아이콘/me) (feat/flow-rbac-improvements)** — ①**F1**: 디시전 노드에 드롭(출력≥1) → `EdgeDecisionModal`(분기/인터셉트/취소). 분기=새 출력선+자동 라벨, 인터셉트=출력선 2개↑ 선택·1개 바로(`interceptIntoEdge` 추출, applyEdgeSelect 재사용). ②**F14**: `[`/`]`가 실제 끝/처음 도달 시 클램프(노드 수 불변이면 reach 고정) — 끝에서 `]` 눌러도 안 늘고 `[`가 바로 줄어듦. ③**ST**: 맵세팅을 탭→**단일 스크롤+좌측 앵커 내비**(IntersectionObserver 하이라이트), 승인자 **정사각형 카드**(이름·아이디 + 소속 최대5단). 백엔드 `EligibleApproverOut`(=디렉터리+`org_path`)로 `/directory` 계약 보존. ④**DL**: 삭제 안내를 `DeleteMapDialog`(아이콘+요점 3줄: 휴지통/7일복구/영구삭제)로 시각화, 홈·DangerZone 공용. ⑤**HM**: 멤버 부서 레벨별 아이콘(센터/담당/팀/그룹/파트) + 본인 'me' 배지. 검토 피드백 문서 재작성. PV·AP는 검토 보류. 검증: backend **315 passed**·ruff clean, 프론트 tsc 0·lint 0err·vitest 35·build OK.
- **fix(search): principal 검색 필터 한정 — 유저=이름+아이디, 부서/그룹=명칭만 (feat/flow-rbac-improvements)** — 버그: PrincipalPicker가 유저를 소속 `dept`로도 매칭 → "AI dev" 검색 시 그룹원들이 결과를 채워 정작 'AI dev' 그룹이 slice(8) 밖으로 밀려 안 보임. 수정: ①PrincipalPicker 검색 필드를 타입별로 — **유저=이름+아이디**, **부서·그룹=명칭(displayName)만** → 유저를 소속으로 매칭하지 않음(그룹이 상위 노출). ②SearchSelect: `sub`(부서 등)는 **표시 전용**으로, 검색은 `label`+신규 `keywords`. 담당자 옵션은 `keywords=아이디`(검색)·`sub=아이디·부서`(표시) → 담당자도 이름+아이디만 검색. 검증: 프론트 tsc 0·lint 0err·vitest 35·build OK.
- **feat(create+home): 생성 다이얼로그 승인자 자격(퍼블릭=전원)·가시성 변경 시 승인자 초기화·퍼블릭 우선 정렬·빈 상태 환영 화면 (feat/flow-rbac-improvements)** — ①생성 다이얼로그 승인자 후보: **public이면 전원**(전원 열람), private면 생성자+선택 user 협업자(기존). ②가시성(public/private) 변경 시 후보군이 바뀌므로 **승인자 초기화** — 이미 고른 승인자가 있으면 **안내 모달(ConfirmDialog) → 확인 시 변경+초기화**. ③**퍼블릭을 프라이빗보다 먼저** 노출(생성 모달 버튼; 홈 탭은 이미 all/public/private). ④**빈 상태 환영 화면**: 맵이 하나도 없으면 풀폭 `WelcomePlaceholder`(아이콘+환영문구+첫 맵 만들기 CTA)로 상세 자리까지 차지, 필터/검색 결과 없음은 별도 안내. 프론트 전용(공개 맵 승인자 eligible은 백엔드 기존 로직이 전원 반환). 검증: 프론트 tsc 0·lint 0err·vitest 35·build OK.
- **fix(maps)+feat(home): 생성 시 public 무시 버그 핫픽스 · 가시성 필터 탭 · 카드 레이아웃 (feat/flow-rbac-improvements)** — ①**핫픽스**: 맵 생성 시 public 선택이 무시되고 항상 private로 생성되던 버그. 원인=`MapCreate` 스키마·`createMap` api·`create_map` 엔드포인트 모두 visibility 미수용+하드코딩 `"private"`, 다이얼로그 `visibility` 선택값이 전송 안 됨. 수정: `MapCreate.visibility`(Literal, 기본 private) 추가 → 엔드포인트가 반영(생성자=owner라 즉시), api·다이얼로그가 선택값 전달. 회귀 테스트 2. ②**홈 필터**: 맵 목록에 **ALL/Public/Private 탭** 추가(가시성 필터), **검색창을 최상단 풀폭**으로 이동(제목·필터·New map은 아래 줄). ③**카드 레이아웃**: 최신 버전 상태(draft 등)를 **맵 이름 우측**으로, 승인멤버 버튼을 **하단 우측**(구 상태 자리, 드롭다운은 위로 펼침)으로 이동. 검증: backend **315 passed**·ruff clean, 프론트 tsc 0·lint 0err·vitest 35·build OK.
- **feat: 백로그 4차-② Settings v2 — PV(가시성 스테이징) · ST(승인자 카드) (feat/flow-rbac-improvements)** — ①**PV**: 가시성을 즉시토글 대신 **스테이징(private/public 선택) → "변경 적용" 버튼 + 적용버튼 근처 변경 미리보기**로 재구성(visibility-control). 변경은 기존 visibility-request(승인 워크플로) 경유 — 적용 시 pending 마커만. **퍼블릭 전환 승인 적용 시 백엔드가 잔존 viewer 그랜트 제거**(`_apply_request`, PV-1 결정). ②**ST**: approvers-panel 결재자 표시를 필 → **아이디·이름 카드 그리드**(로딩 고스트는 기존 SkeletonPills 유지). **범위 한정**: PV 스테이징은 가시성 컨트롤에 적용(퍼블릭 전환 체크포인트 본래 취지). 협업자/승인자 목록 추가·제거는 기존처럼 즉시 적용 — 전(全) 설정 일괄 스테이징은 추후. TDD 테스트(퍼블릭 전환 viewer 제거). 검증: backend **313 passed**·ruff clean, 프론트 tsc 0·lint 0err·vitest 35·build OK. 미실행: 브라우저 수동(가시성 미리보기·적용·승인흐름, 승인자 카드).
- **feat: 백로그 4차-① DL — 맵 소프트삭제 + 휴지통 복구 (feat/flow-rbac-improvements)** — `ProcessMap.deleted_at` 추가, `delete_map`은 즉시삭제 대신 deleted_at 기록(소프트). `list_maps`/`get_map`이 삭제건 제외 + 조회 시 7일 경과분 lazy 영구삭제(`_purge_expired`, 별도 배치 없음). 신규 `GET /api/maps/deleted/list`(오너=본인·sysadmin=전체) + `POST /api/maps/{id}/restore`(owner 게이트). 프론트: 전역 설정에 "삭제 예정" 탭(everyone, 서버가 오너/sysadmin 필터) + `DeletedMapsPanel`(복구·삭제시각), 삭제 확인문구를 "휴지통 7일 복구"로 갱신 + 홈 삭제 시 안내 토스트. `MapOut.deleted_at`·`MeOut` 무관. TDD 테스트(소프트삭제→목록제외→휴지통노출→복구). 검증: backend **312 passed**·ruff clean, 프론트 tsc 0·lint 0err·vitest 35·build OK. 결정: lazy 정리·복구는 오너/관리자. 미실행: 브라우저 수동(삭제→휴지통→복구).
- **feat: 백로그 3차 — HM-3(조직 표기) · AP(승인자 viewer+ 제한) (feat/flow-rbac-improvements)** — ①**HM-3**: 맵 상세 멤버에서 부서는 org_path 말단만 표시 + **센터>담당>팀>그룹>파트**(이름 접미사 KO/EN 판별) 순 정렬. ②**AP**: 승인자 지정 후보를 viewer+ 자격자로 제한. F5의 자격 계산을 `permissions/access.get_eligible_users(map_id)`로 추출(versions의 eligible-assignees도 이걸 재사용) + 신규 `GET /api/maps/{id}/eligible-approvers`(viewer 게이트). 프론트: approvers-panel이 전체 디렉터리 대신 `listEligibleApprovers` 사용, 생성 다이얼로그 승인자 picker는 **생성자+선택한 user 협업자**로 클라 제한(부서/그룹 확장은 설정에서). 부수: create-map-dialog의 기존 useCallback 2개(컴파일러 setter 추론 충돌)를 plain 함수로. TDD 테스트 1(eligible-approvers). 검증: backend **311 passed**·ruff clean, 프론트 tsc 0·lint 0err·vitest 35·build OK. 미실행: 브라우저 수동(부서 말단/정렬·승인자 후보 제한).
- **feat(search): 백로그 2차 — 검색 일괄 개선(SR) (feat/flow-rbac-improvements)** — ①**SR-3 엔진**(`lib/search.ts`): subsequence(순서만 맞으면) 매칭 추가 + 결과 **우선순위 정렬(정확>접두>부분>초성/로마자>subsequence)** — `filterByQuery` 사용하는 모든 검색(홈·SearchSelect·PrincipalPicker)에 일괄 적용. vitest +3(12). ②**SR-1 키 내비**: SearchSelect·PrincipalPicker에 `↓`/`Tab`=다음·`↑`/`Shift+Tab`=이전·`Enter`=선택·`Esc`, 활성행 하이라이트(effect 없이 onChange에서 리셋). ③**SR-2 유저**: 아이디(loginId)도 검색 대상 + **아이디·부서 동시 노출**(picker 행 / 담당자 SearchSelect sub). ④**SR-4 위치고정**: SearchSelect 드롭다운 absolute overlay라 입력창 위치 불변. 검증: tsc 0·eslint 0err·vitest 35·build OK. 미실행: 브라우저 수동(키 내비·아이디검색·subsequence·정렬).
- **feat(ui): 백로그 1차 — 모달 블러·카드 타이틀 히트박스·부서 소속 하이라이트 (feat/flow-rbac-improvements)** — ①**BL**: dim 모달 11곳에 `backdrop-blur-sm` 일관 적용(컨텍스트 팝업 edge-*는 의도적 투명 유지). ②**HM-1**: 홈 맵 카드 타이틀 링크를 `inline-block max-w` truncate로 — **텍스트로만 열림**(우측 여백 클릭은 카드 선택). ③**HM-2**: 상세 멤버 하이라이트에 **부서 소속** 추가 — `/api/me`·`MeOut`·CurrentUser에 `org_path` 노출, `isMine`이 belongs_to_department 규약(정확/prefix"/")로 내 부서 그랜트 강조. 결정 반영: SR-3 정확>접두>subsequence·PV 확인모달(백로그 §3). 검증: backend 310·ruff clean, 프론트 tsc 0·lint 0err·vitest 32·build OK. 미실행: 브라우저 수동(블러·히트박스·부서 하이라이트).
- **docs: 검토 현황 + 후속 백로그 재구성 (feat/flow-rbac-improvements)** — 브랜치 구현 완료/검토전 현황표 + 2026-06-25 추가 요청(SR 검색 일괄개선·BL 모달 블러·ST 맵세팅 재구성·DL 소프트삭제+복구·PV 퍼블릭전환 체크포인트/역할드롭다운·AP 승인자 viewer제한·HM 홈 카드/소속/조직표기)을 테마별로 정리. `docs/superpowers/plans/2026-06-25-review-feedback-backlog.md`. (코드 변경 없음, 다음 작업 계획용.)
- **fix(editor): 2차 피드백 — F14 키 스왑·F1 분기모달 재디자인/다중출력 선택·F5 검색 드롭다운 (feat/flow-rbac-improvements)** — ①**F14 키 반대로**: `[`/`]`=하이라이트 경로 증감(뷰 고정), **Tab/Shift+Tab=흐름상 다음/이전 노드 포커스 이동(+중앙)**. getNext/PrevNodeAlongFlow 재사용. ②**F1 분기모달**: 음영 배경 폐기→EdgeActionModal과 동일 컨텍스트 팝업(투명·마우스 위치·세로 목록). ③**F1 다중출력**: 출력선 ≥2(분기 등) 노드에 드롭 삽입 시 **어느 출력선에 끼울지 선택 모달**(신규 `EdgeSelectModal`, 라벨="엣지라벨 → 다음노드") → source→target→X로 해당 선만 삽입, 분기 라벨 보존, 타 분기 유지. 단일 출력은 삽입/교체/취소 유지. ④**F5 드롭다운**: 담당자/부서 native select→`SearchSelect`(검색+`Highlight` 매치 하이라이트, 목록서만 선택, 레거시 값 보존). i18n edge.selectOutput·field.searchPlaceholder. 검증: tsc 0·eslint 0err·vitest 32·build OK. 미실행: 브라우저 수동(키 스왑·분기/선택 모달·검색 드롭다운).
- **fix(maps): F12 보완 — 맵 이름 전역 유니크 + 복사 확인 모달 + 홈 카드 강조 (feat/flow-rbac-improvements)** — ①백엔드 `_assert_unique_name`로 생성·복사·이름변경에서 이름 중복 409(전역 유니크). 세션 공유 DB라 이름 재사용하던 테스트 헬퍼들(version/wf/graph/notif/collab/subprocess/ad-active map)을 카운터로 유니크화 + test_ai 5곳 헬퍼화 + uniqueness 테스트 2. ②프론트: 복사가 즉시 실행되지 않고 **이름 입력 확인 모달**(PromptDialog, 중복 시 inline error 유지) → 생성 후 에디터가 아닌 **홈에서 새 맵 카드로 선택·스크롤·쉬머(animate-pulse ring) 강조**(2.5초). 복사 로직을 MapDetailCard→홈으로 끌어올림(onCopy 콜백), MapCard에 `highlighted` 추가, PromptDialog에 `error` prop. i18n home.copyTitle/copyNameLabel/copyCreated. 검증: backend **310 passed**·ruff clean, 프론트 tsc 0·eslint 0err·vitest 32·build OK. 미실행: 브라우저 수동(복사 모달·중복차단·홈 강조).
- **fix(editor): F1 재설계 — 출력 충돌 시 삽입/교체/취소 모달(마우스 위치) + 분기 모달도 마우스 위치 (feat/flow-rbac-improvements)** — 자동 스왑+토스트 폐기. 비-decision 노드에 2번째 출력(핸들 드래그·노드 드롭 양쪽) 시 **마우스 위치에 삽입/교체/취소 3지선다 모달**(화면 클램프, 바깥 mousedown·Esc 닫힘). 삽입=흐름에 끼움(source→target + 기존 출력을 target 뒤로, `insertNodeAfter` rewire), 교체=기존 출력 제거 후 source→target(`removeOutgoingEdges`+insert). decision 노드는 분기(다중 출력) 예외 유지. 신규 `EdgeActionModal`·`clampToViewport`, `EdgeBranchModal`에 `position` 추가(분기 모달도 마우스 위치). `createEdge`는 단순 추가로 환원(충돌은 onConnect가 처리). i18n edge.outputConflict/actionInsert/actionReplace. 검증: tsc 0·eslint 0err·vitest 32·build OK. 미실행: 브라우저 수동(드래그/드롭 2번째 출력 모달·삽입/교체 결과·분기 모달 위치).
- **fix(editor): F14 재설계 — Tab/Shift+Tab으로 흐름 하이라이트 경로 증감 (feat/flow-rbac-improvements)** — 기존 `]`/`[` 노드이동·setCenter 폐기. 노드 선택 후 **Tab=전방으로 하이라이트 경로 1엣지 확장**, **Shift+Tab=축소→초기→후방 확장**(뷰 고정, 패닝 없음). 부호 정수 `flowReach`(>=0 전방 reach+1엣지, <0 전방1+후방 -reach엣지), anchor≠선택이면 0으로 파생 리셋(set-state-in-effect 회피). 순수 헬퍼 `getFlowPathForward`/`getFlowPathBackward`(첫 출력/입력 따라가며 사이클·끝 중단) + vitest 3. styledEdges가 즉시 이웃 + 확장 경로를 edge-out/in 색으로 하이라이트. 아웃라인 리스트엔 `data-editor-outline` 부여해 그쪽 포커스 시 Tab 기본동작 양보. 검증: tsc 0·eslint 0err·vitest 32. 미실행: 브라우저 수동(노드 선택 후 Tab/Shift+Tab 경로 증감).
- **feat(ui): 버튼 아이콘 통일·호버 툴팁 + 네이티브 대화상자→플로팅 모달 (feat/flow-rbac-improvements)** — ①신규 `Tooltip`(portal+fixed 호버, overflow 안 잘림)·`PromptDialog`(블러 백드롭 `backdrop-blur-sm`, 바깥 mousedown·Esc 닫힘, Enter 제출, 빈 값 비활성). `ConfirmDialog`에도 blur 추가(공용). ②아이콘 적용(Lucide 16/14·strokeWidth 1.5): 인스펙터 탭 4(Bell/GitBranch/Download/Palette, 아이콘+라벨), 버전 버튼 4(Plus/PencilLine/Trash2/GitCompare — **아이콘 전용 + Tooltip**, aria-label), AI 토글(Sparkles + "AI"), 맵 상세 footer(Open=ArrowUpRight·Settings·Trash2 아이콘+라벨). ③네이티브 dialog 4곳 교체: 버전 생성/이름변경(page.tsx `window.prompt`→PromptDialog), 버전 삭제(`window.confirm`→ConfirmDialog danger), 버전 반려(versions-publish-panel `window.prompt`→PromptDialog multiline). 버전 핸들러는 plain 함수로 전환(React Compiler 자동 메모 — 수동 useCallback이 setter 추론과 충돌해 `preserve-manual-memoization` 에러나던 것 해소). 검증: tsc 0·eslint 0err·vitest 29·build OK. 미실행: 브라우저 수동(아이콘·툴팁·블러 모달·바깥클릭 닫힘).
- **feat(node): 담당자/부서 조회권한자 제한 (P2/F5, feat/flow-rbac-improvements)** — 노드 담당자/담당부서 자유입력 폐기 → 맵 조회권한(viewer+) 보유 직원만 선택. 신규 `GET /api/versions/{vid}/eligible-assignees`(viewer 게이트) — 공개 맵=전 직원, 비공개=직원별 `logic.effective_role` 벌크 재사용(권한모델 동일, 데이터 1회 로드)으로 viewer+ 만. 응답 `{users:[{id,name,department}], departments:[...]}`. 프론트 node-summary-modal의 assignee/department를 자격 목록 `<select>`로(저장은 기존처럼 표시명 문자열 — 모델 변경·AI 담당자매칭 영향 없음; 기존 값은 후보에 없어도 현재값 유지 노출), system/duration은 자유입력 유지. TDD 테스트 2개(비공개 필터·공개 전원). 검증: backend 전체 **308 passed**·ruff clean, 프론트 tsc 0·lint 0err·vitest 29·build OK. **잔여(보고)**: 큰 디렉터리(공개 맵)에서 native select가 길어짐 → 검색형 picker는 후속. 식별자(login_id) 저장 전환도 후속(현재 표시명 저장).
- **feat(editor): 플로우 따라가기 스테퍼 (P2/F14, feat/flow-rbac-improvements)** — 노드 선택 후 `]`=다음 노드 / `[`=이전 노드로 선택을 이동시켜 엣지 하이라이트(styledEdges)가 흐름을 따라 넘어가게 함 + 해당 노드로 setCenter. 순수 헬퍼 `getNextNodeAlongFlow`/`getPrevNodeAlongFlow`(첫 출력/입력 엣지) 신규 + vitest 2. 아웃라인이 방향키를 쓰므로 충돌 회피 위해 bracket 키 사용, 입력/모달 중엔 무시. 검증: vitest 29·tsc 0·eslint 0err. 미실행: 브라우저 수동(노드 선택 후 ]/[ 로 흐름 이동·하이라이트). (현재 캔버스 프레임 기준 동작.)
- **feat(perm): 맵 설정 협업자·결재자 스켈레톤 로딩 (P2/F8, feat/flow-rbac-improvements)** — 데이터 도착 전 "협업자 없음"·"결재자 0 경고"가 잘못 떴는데, `loading` 상태(초기 true→로드 finally false) 도입해 로딩 중엔 스켈레톤(animate-pulse `bg-surface-alt`) 표시, 빈/경고는 로드 완료 후에만. 신규 `components/permissions/loading-skeleton.tsx`(SkeletonRows/SkeletonPills) 공용. collaborators·approvers 패널 적용. 검증: tsc 0·lint 0err·vitest 27. 미실행: 브라우저 수동(느린 네트워크 스로틀로 스켈레톤 확인).
- **feat(maps): 승인본 기준 맵 복사 (P2/F12, feat/flow-rbac-improvements)** — `POST /api/maps/{id}/copy`(viewer+ 게이트) — 원본 맵의 최신 승인본(approved/published) 그래프를 새 private 맵의 초기 As-Is(draft)로 깊은복사. 승인본 없으면 409. `versions._clone_graph`를 공개 `clone_graph`로 승격해 재사용, `MapCopy` 스키마 신규. 프론트: `copyMap` api + 맵 상세카드 footer에 **승인본 있을 때만** "복사" 버튼 → 성공 시 새 맵 에디터로 이동. i18n `home.copyFromApproved`. TDD 테스트 2개(승인본 복사·승인본 없음 409). 검증: backend 전체 **306 passed**·ruff clean, 프론트 tsc 0·lint 0err. 미실행: 브라우저 수동(복사 버튼·이동).
- **fix(editor): P1 피드백 — 드롭 단일출력 강제·회귀 토스트·버전 드래프트 토스트 (F1/F2/F11, feat/flow-rbac-improvements)** — ①**F1 드롭 경로**: 핸들드래그만 막혀 있던 단일출력 제약을 노드 드롭에도 적용 — `handleZoneDrop`에서 back존+비-decision B의 충돌(2번째 출력) 시 "keep"(분기) 프롬프트 없이 자동 흐름삽입(rewire)+토스트. ②**F2 회귀 토스트**: A↔B 회귀를 `isValidConnection` 무음 거부 대신 `onConnect`/`handleZoneDrop`에서 토스트로 안내(역행은 Decision 우회 유도, `edge.reciprocalBlocked`). ③**F11 토스트**: 새 버전 생성 409(드래프트 존재)를 status 대신 토스트로(`err.versionDraftExists`). i18n: `edge.reciprocalBlocked`·`err.versionDraftExists` en/ko 추가, `edge.outputSwapped` 문구 일반화. 검증: tsc 0·eslint 0err·vitest 27·build OK(후행). 미실행: 브라우저 수동(드롭 분기차단·회귀 토스트·드래프트 토스트).
- **fix(perm): P1 피드백 — 퍼블릭 맵은 viewer 불가·editor만 (F9 정정, feat/flow-rbac-improvements)** — 이전 구현(맵 설정에서 퍼블릭도 viewer 허용)이 의도와 반대였음. 정정: 퍼블릭 맵은 viewer 지정 불가(전원 열람이라 불필요), editor만. 맵 설정 `viewerGrantDisabled={isPublic}` 복원. UI는 **viewer 선택지 자체를 숨김**(AddForm·CollaboratorRow, 단 기존 viewer 행은 editor 교정용으로 표시 유지). 백엔드 방어: `add_permission`·`update_permission`이 퍼블릭 맵 viewer 부여/변경을 409로 거부 + 테스트 2개. 검증: backend 전체 304 passed·ruff clean, tsc/lint/vitest clean.

## 2026-06-24
- **feat(auth): 관리자 권한 단순화 — 시스템 관리자(sysadmin)가 흡수 (P1/F6, feat/flow-rbac-improvements)** — 별도 admin 티어(`Employee.role`+`require_admin`)를 sysadmin으로 통합. auth.py `require_admin`(Employee.role 기반)→`require_sysadmin`(`is_sysadmin`), employees.py(직원조회·AD동기화) 게이트 전환. 이번 변경으로 미사용된 `get_current_employee` + `Employee`/`get_session`/`AsyncSession` import 정리. 프론트 전역 설정 `canAccess`의 `admin` 게이트를 `isSysadmin`으로 흡수. test_employees 2개(요구 admin 403)를 sysadmin enforce 픽스처로 정정(user.lee 비-sysadmin→403, admin.kim sysadmin→200). 검증: backend 전체 **302 passed**·ruff clean, 프론트 tsc 0·lint 0err·vitest 27. **잔여(보고)**: `Employee.role`은 정보용으로 유지(/me·admin콘솔 표시)하나 권한은 부여 안 함 → 운영상 관리자는 `BPM_SYSADMINS`에 등록해야 함. `system_admin_login_ids` 설정은 이제 권한상 무의미(완전 폐기는 후속 결정).
- **feat(perm): 맵 설정에서 퍼블릭 맵 뷰어 지정 허용 (P1/F9, feat/flow-rbac-improvements)** — 퍼블릭 맵은 전원 열람이라 협업자 추가 시 viewer가 비활성화됐는데(`viewerGrantDisabled`), 맵 설정에서는 권한 변경으로 viewer 지정이 가능하도록 `viewerGrantDisabled={false}`로 고정(맵 설정 한정). 미사용된 `isPublic` 파생값 제거. 생성 다이얼로그의 퍼블릭=editor 기본은 유지. 검증: tsc 0·eslint 0err. 미실행: 브라우저 수동(퍼블릭 맵 설정에서 viewer 선택 가능).
- **feat(editor): 노드 출력 1개 고정 — 자동 스왑 + 토스트 (P1/F1, feat/flow-rbac-improvements)** — 핸들 드래그로 비-decision 노드에 두 번째 출력 엣지를 그리면 기존 출력을 제거하고 새 연결로 교체(자동 스왑) 후 토스트 안내("분기는 Decision"). decision 노드는 다중 출력(분기) 허용으로 예외. 순수 헬퍼 `removeOutgoingEdges`(canvas.ts) 신규 + `createEdge`(page.tsx, onConnect 경로) 적용. i18n `edge.outputSwapped` en/ko. vitest 2개 추가. 검증: vitest 27·tsc 0·eslint 0err. 미실행: 브라우저 수동(2번째 출력 스왑·decision 분기 유지). (드롭존 삽입 경로는 기존 rewire 의미가 흐름 구조 유지 — 미변경.)
- **feat(versions): 맵당 draft 1개 제한 (P0/F11, feat/flow-rbac-improvements)** — `create_version`에 가드 추가 — 맵에 status=`draft` 버전이 있으면 새 버전 생성 409(진행중 수정본 1개만 허용, request #11). `MapVersion.status` 기본값이 draft라 초기 버전도 대상 → 클론은 소스를 승인/제출 후에. 신규 테스트 `test_create_version_blocked_when_draft_exists`(차단+승인후 허용). 기존 클론/생성 테스트 7개(test_versions 6 + test_subprocess 1)를 소스 draft 직접승인 헬퍼 `_approve_version`로 재작성(클론 기능 검증 보존; 그중 `test_clone_leaves_source_untouched`는 가드로 우연 통과하던 false-pass도 교정). 프론트 `handleCreateVersion`은 기존 try/catch로 409 메시지 표시(무변경). 검증: backend 전체 **302 passed**·ruff clean. 미실행: 네이티브 브라우저 수동 스모크(새 버전 버튼 409 안내).
- **feat(perm): 승인 대기 시 승인 권한자 표시 (P0/F10 프론트, feat/flow-rbac-improvements)** — 협업자 패널에서 다운그레이드/제거가 pending이면 토스트에 "승인 가능: {이름들}" 노출(`perm.toastGatedBy`). `listApprovers`로 맵 지정 승인자 조회(초기 Promise.all에 추가) → login_id를 디렉터리 표시명으로, 없으면 `perm.approversNone`("지정 승인자 또는 시스템 관리자"). 파생값 `approverDisplayNames`는 렌더 단계 계산. i18n en/ko 2키 추가. 검증: tsc 0·eslint 0err·vitest 25. 미실행: 네이티브 브라우저 수동 스모크(비-오너 다운그레이드 토스트·오너 즉시적용).
- **feat(perm): 오너 다운그레이드 무승인 (P0/F10 백엔드, feat/flow-rbac-improvements)** — `update_permission`·`delete_permission`에서 행위자 `get_effective_role`이 `owner`(sysadmin은 effective_role에서 owner로 해석)면 editor→viewer/제거 승인 게이트를 건너뛰고 즉시 적용. 비-오너 행위자는 기존대로 pending 지연. 기존 다운그레이드/decide 테스트 6개의 pending 생성 주체를 owner→비-오너 `actor.ed`로 변경(지연 경로 커버 보존) + 오너 즉시적용 테스트 2개 신규. 검증: 백엔드 전체 301 passed·ruff clean. (프론트 승인자 표시는 후속 커밋.)
- **feat(editor): 노드간 1:1 회귀(A↔B) 방지 (P0/F2, feat/flow-rbac-improvements)** — 이미 `target→source` 엣지가 있으면 `source→target` 추가를 막아 2노드 사이클 차단(분기 필요시 Decision 사용 유도). 순수 헬퍼 `hasReciprocalEdge`(canvas.ts) 신규 → 드롭존 경로 `withEdge` 가드 + 핸들드래그 경로 `isValidConnection`(page.tsx) 양쪽 적용. vitest `canvas.test.ts` 3개 추가. 검증: vitest 25·tsc 0·eslint 0err(pw-smoke 기존 warning 1, 무관). 미실행: 네이티브 브라우저 수동 스모크(드래그 거부·드롭 무변경).
- **feat(ad): AD 동기화 제외항 추가 (P0/F15, feat/flow-rbac-improvements)** — `EXCLUDED_ORG_L1`에 `Application Users`·`HR`·`Service`·`External Users`(기존 소문자 `External users`와 병기, 대소문자 정확일치라 무해) 추가. 순수 frozenset 확장, 로직 무변경. `test_org.py` 단언 추가. 검증: pytest 25 passed·ruff clean. 미실행: 라이브 AD OU 정확 표기 확인(케이스). 계획 `docs/superpowers/plans/2026-06-24-process-flow-rbac-improvements.md`.
- **fix/feat 5건 묶음 — sysadmin env·드롭존 연결제약·엣지사이드 UI·엣지 중앙 라벨편집·시작끝 표시 (main 직접)** — ①`docker-compose.yml` backend env에 `BPM_SYSADMINS: ${BPM_SYSADMINS:-}` 추가(서버에 관리자 부재 해소, `.env.example`엔 이미 존재). ②드롭존 흐름삽입이 시작/끝 규칙을 우회하던 버그 — 순수 `violatesTerminalRule`(canvas.ts)로 `isValidConnection`·드롭존 공통 판정, `activateZone`/`handleZoneDrop`에서 front(드래그→대상)·back(대상→드래그) 양방향 차단 + 위반 타일 흐림 표시(`dropTarget.frontBlocked/backBlocked`, ref-in-render 회피). ③엣지 우클릭 면선택 UI에 엣지모양(점선+화살촉 `EdgeShape`) 추가 + 하위프로세스(라이브러리) 끝점은 입력=좌/출력=우 고정이라 면선택 **잠금**(`sourceLocked`/`targetLocked`). ④엣지 더블클릭 시 인스펙터 외에 **캔버스 엣지 중점에 인라인 라벨 박스**(신규 `components/edge-label-editor.tsx`, 위치는 이벤트 시점 계산해 state 저장). ⑤시작/끝 노드는 라벨링해도 표시는 항상 `Start`/`End`(i18n 무관), 사용자 라벨은 괄호로 — `terminalDisplayLabel`(canvas.ts)+`ProcessNode`. 순수로직 vitest `canvas.test.ts` 신규(6). 검증: vitest 22·tsc 0·eslint 0err·build OK. 미실행: 네이티브 브라우저 수동 스모크(②드래그 거부·③락/모양·④중앙박스 실렌더).
- **fix(editor): 하위프로세스 인라인 펼침 진출 게이트웨이 우측 출발 (main 직접)** — 라이브러리 하위프로세스를 펼치면 끝노드→다음 노드 엣지가 끝노드 **왼쪽**에서 나가던 버그. 근본원인: `lib/inline-expand.ts` `makeGateway`가 게이트웨이 엣지를 **sourceHandle 미지정**으로 생성 → React Flow가 진출(끝→후속) 엣지를 끝노드 첫 source 핸들(좌)에 붙임. 수정: 진출 게이트웨이 `sourceHandle=s-right`/`targetHandle=t-left`, 진입은 `targetHandle=t-left`. vitest `inline-expand.test.ts` 신규(2). 검증: vitest 16·tsc 0·lint clean·build OK.
- **feat(editor): 시작=출발 전용·끝=도착 전용 연결 제약 (main 직접)** — `isValidConnection` 추가 — 시작 노드로 들어오는 연결(target=start) 차단, 끝 노드에서 나가는 연결(source=end) 차단. 수동 드래그 연결에만 적용(게이트웨이·기존 엣지 무영향). 검증: tsc 0·lint clean·build OK.
- **chore(git): dev.db 추적 제외** — `.gitignore`의 `!backend/dev.db` 부정 규칙 제거(`*.db`로 무시), `git rm --cached backend/dev.db`로 추적 해제. 로컬 파일은 유지·시드로 재생성. (원격 작업용 더미DB 추적 정책 폐기.)

## 2026-06-23
- **feat(editor): 엣지 우클릭 메뉴 개편 — Start|End 테두리-클릭 면 선택 + 라벨편집·삭제 + 더블클릭 라벨편집 (main 직접)** — 기존 화살표 십자패드(CrossPad) 면 선택을 **Start(좌)·End(우) 박스의 테두리(상/우/하/좌)를 클릭**해 출발/도착 면을 고르는 위젯으로 교체(`context-menu.tsx` 신규 `edgeSides` 아이템 + `wide` 패널 옵션, 선택 변=악센트). 그 아래 **라벨 편집·엣지 삭제** 항목 추가. **엣지 더블클릭=라벨 편집 모드**(엣지 선택+인스펙터 라벨 입력 포커스, `startEdgeLabelEdit`+input ref). i18n `edge.startBox`·`edge.endBox`·`edge.editLabel`. 미사용이 된 `CrossPad`/`pad` 아이템·`PAD_BUTTONS`·Arrow 아이콘 import 데드코드 제거. 검증: tsc 0·eslint clean·build OK(수동 브라우저 확인 권장).
- **fix(editor): 엣지 수동 연결 시 source=오른쪽/target=왼쪽 기본 고정 (main 직접)** — `createEdge`(onConnect 경로)가 잡은 핸들 면을 그대로 써서 끝 노드를 후속으로 끌면 시작이 왼쪽이 되던 버그. 근본원인: 자동 경로(`withEdge`/insert)는 이미 s-right 명시인데 수동만 `connection` 핸들 그대로 spread. 수정: createEdge에서 source=`s-right`/target=`t-left` 기본 고정, 예외 decision source(분기 분산)·subprocess 끝점(전용 in/__primary__ 핸들)은 잡은 핸들 유지. 검증: tsc 0·eslint clean(수동 브라우저 확인 권장). 면 변경 UI는 후속 엣지 우클릭 메뉴(작업중).
- **시드 정합성 + 검색/승인자 UX — 설계 (feat/seed-and-search, base=main 7b72ebc)** — ①시드 워크플로 정합성: 시드 후 멱등 정규화 패스(`seed_invariants.py`)로 모든 맵 owner+승인자≥1, 비-draft 버전 submitted_by+승인자+승인이력 보정 + 불변식 pytest. ②재사용 검색 `lib/search.ts`(deps 없음): 부분/한글초성/로마자초성(ㅇ묵음) 매치를 원문 인덱스 range로 반환, 콤마 AND·필드 OR `filterByQuery`, 공용 `<Highlight>`, vitest. ③승인자 필(pill) UI(settings+생성다이얼로그) + picker 소속검색·하이라이트. ④홈 맵 검색창+카드명 하이라이트. **구현 완료(subagent-driven 8태스크)**: 백엔드 pytest 298·ruff clean, 프론트 vitest 14·tsc 0·lint 0err·build OK. 전체-브랜치 리뷰(opus) "merge-ready"(Critical/Important 0). 설계 `docs/superpowers/specs/2026-06-23-seed-and-search-design.md`, 계획 `docs/superpowers/plans/2026-06-23-seed-and-search.md`. 미실행: 수동 브라우저 스모크(네이티브 환경).
- **통합(병합) 비교 화면 재작성 — 구현·검증 완료 (feat/compare-merged-view)** — 좌/우 2캔버스 분리 폐기 → 단일 **병합 캔버스**(조회 전용). 저장 좌표(pos) 무시·기존 `layoutWithDagre`(rankdir LR) 연결 기반 자동배치, 노드 added/removed/changed(`ProcessNode` diff 링 재사용)·엣지 added/removed(초록/빨강 점선) 색상 + 변경 목록 클릭 `fitView` 포커스. **Task 0**: 빈 캔버스 진짜 원인=`DevGate`가 `setDevUser`를 effect에서 호출(자식 fetch effect가 먼저 실행→첫 `getMap`이 `X-Dev-User` 없이 나가 local-dev 폴백 403)→`AuthGate`처럼 **렌더 단계 동기 호출**로 수정. **Task 1**: `lib/diff.ts` lineage 매칭(`getLineageKey`/`FIELD_KEYS` export) 재사용한 신규 `lib/merge-diff.ts`(union 노드/엣지+status) + **vitest 신규 셋업**(devDep)·단위 5개. **Task 2**: `compare/page.tsx` 전면 재작성(base→target 드롭다운 기본 oldest→newest)+i18n 5키. 검증(브라우저, map 9 시드 오라클): `GET /maps/9` **200**(403 해결)·단일 캔버스 7노드·**added 1/removed 1/changed 2 일치**·엣지 추가3/삭제3·포커스 동작·pageerror 0, 회귀(home·editor) 정상. lint·build·vitest 5/5 clean. 설계 `docs/superpowers/specs/2026-06-23-compare-merged-view-design.md`, 플랜 `docs/superpowers/plans/2026-06-23-compare-merged-view.md`. (브라우저 스모크 `scripts/pw-verify-compare.mjs`는 기존 pw-smoke들처럼 `playwright-core` 수동설치 전제.)
- **브랜딩 풀네임화 — "BPM" 약자 → "Business Process Map"** — 탭 타이틀(`layout.tsx`), 홈 h1(`page.tsx`, +`data-id="home-title"`), i18n `app.name`·`login.title`(en/ko). 사용자 요청. (i18n 부분은 Task 7 커밋 dec9ef8에 동봉됨, layout/page는 별도 커밋.)
- **맵 카드·상세정보 개편 — 구현 완료 (feat/map-card-detail-redesign, subagent-driven 12태스크)** — 카드(이름=같은탭 열기·우상단=새탭·description 숨김), 상세(description 경계박스·버전 git-log 타임라인·footer Open 삭제·삭제 확인모달·좁은폭 카드아래 아코디언), description 입력 복원(생성 다이얼로그+설정 Details 탭), 버전 생애주기 이벤트 로그(신규 `version_events` 테이블·created/submitted/approved/rejected/published 누가·언제 + 멱등 백필). 신규 컴포넌트 `confirm-dialog`·`version-timeline`·`map-details-panel`. 설계 `docs/superpowers/specs/2026-06-23-map-card-detail-redesign-design.md`, 계획 `docs/superpowers/plans/2026-06-23-map-card-detail-redesign.md`. 검증: 백엔드 pytest 296·ruff clean, 프론트 tsc 0·lint 0err·build OK. 전체-브랜치 리뷰 통과(opus, "merge with fixes"). 후속 fix 적용: `MapVersion.events` `lazy="selectin"` 제거(불필요 over-fetch 해소) → `create_map`만 events eager-load(get_map과 동일). 미실행: 수동 브라우저 스모크(네이티브 환경 권장).

## 2026-06-22
- **AI 채팅 개편 (Phase 0~6, feat/ai-enhancements 병합)** — AiProposal 5종(graph 생성 / answer / walkthrough / analysis / ops 증분편집). 자연어 맵 생성(그룹·어트리뷰트) + 증분 ops 편집(add/remove/connect/relabel/set_attr, 좌표·색·담당자·그룹 메타 보존), read-only 분석 findings + 노드 하이라이트, 워크스루 스텝퍼+자동재생(2.5초), 조직 디렉터리 주입(담당자 매칭), 매뉴얼 근거 answer(범위 밖은 "모른다"). 백엔드: `ai_prompt.py`(직렬화+계약+`_structure_hints` 환각감소)·`routers/ai.py`(`AiProposal.model_validate_json` 검증·편집계열 다운그레이드·502 내부 URL 은닉)·`schemas.py`(AiNode/Group/Op/Step/Finding + graph 그룹키 무결성 검증)·`test_ai.py`(AI 서버 mock, 5종 계약+거부 케이스). 프론트: `ai-chat-panel.tsx`(스텝퍼·findings 리스트)·`page.tsx`(`applyAiProposal`/`applyAiOps`/`highlightNode`; persist는 기존 검증경로 `saveGraph→replace_graph`(editor 게이트·validate_process·assert_no_cycle) 경유, 우회 없음). 설계 `docs/superpowers/specs/2026-06-22-ai-overhaul-design.md`. 검증(브랜치): pytest 278·ruff·lint 0err·build clean. 머지: schemas/page/api/i18n 자동병합, PROGRESS만 충돌 해소. 미해결(Minor, 보고됨): ops add 그룹은 기존그룹 매칭만(자동배정은 모델이 기존 id 방출 시에만, 안전폴백=무그룹) · AI 라우트 viewer 게이트 없음(단 출처 `GET /graph`·`/api/directory`가 이미 인증사용자 전원 공개 → 신규 노출 아님, 넓은 read-path 게이팅은 Phase 7).
- **하위프로세스 권한 마스킹 — Task 3 양방향 검증 완료 + compare 403 기록 (mask Task 3, feat/expand-sync, 검증 전용·코드 무변경)** — 3중첩 픽스처(L1·L2 owner user.lee → L3 owner user.choi, `DEV_ENFORCE_PERMISSIONS=true`)로 차단/허용 양방향 스모크. **차단**: user.lee→L3 및 user.choi→L1/L2 = `200+{locked:true,nodes:[],edges:[]}`(데이터 미유출), UI 봉인(Lock 뱃지·expand 버튼 0·아웃라인 chevron 0·expand-all이 잠긴 L3 미펼침). **허용**: user.choi→L3(소유자, 직접 열기+API `200 locked=false nodes>0`)·sysadmin(admin.kim)→L1→L2→L3 풀 통과 → 잠금은 구조 아닌 **권한 조건부**이며 과하지 않음. 관측 매트릭스=기대 일치, pageerror 0. 회귀: depth-2 드릴·일반맵·포커스모드·expand/collapse-all 무회귀. **기록(이 기능 무관, 별도 저우선)**: `/maps/{id}/compare` 가 초기 `GET /maps/{id}` 에서 dev-auth 타이밍 레이스로 403(`X-Dev-User` 헤더가 요청 뒤에 세팅→`local-dev` 폴백→빈 캔버스). **일반 맵에서도 재현**되고 마스킹 diff는 compare·dev-auth 미접촉 → 이 기능의 회귀 아님(compare는 resolved 미호출이라 마스킹 영향 0). dev 전용 추정. 별도 dev-login 헤더 타이밍 수정으로 분리 권장. `.git/sdd/mask-task3-report.md`. **마스킹 Task 0~3 완료**(각 implementer+reviewer 통과, whole-branch 최종리뷰는 사용자 결정으로 생략).
- **잠긴 하위프로세스 마스킹 렌더 — 프론트 게이트 전환 (mask Task 2, feat/expand-sync)** — Task 1 서버가 viewer 미만 호출자에게 반환하는 `200 + {locked:true, nodes:[], edges:[]}` 를 UI가 존중하게 함: 잠긴 링크맵 호스트는 Lock 뱃지를 달고 펼침/드릴 불가(캔버스+아웃라인), 단 호스트 노드와 입력/대표출력 엣지는 유지(Option 1 봉인 박스). **잠금은 status 아닌 응답 body(`g.locked`)로 판정** — eager loader `.then(g)`가 `g.locked`면 `lockedKeys`(state)에 키 기록(resolvedCache엔 미저장 → getEmbed null → buildCompositeTree가 자식 없는 봉인 호스트 유지), `.catch`는 실제 네트워크/5xx만. 새 `lockedKeys: Set<string>` state + `lockedKeysRef` 미러. 게이트 3곳 잠금 인지화: `canExpand`·`isDrillableHost`·`injectSubEnds`(잠금 키면 `data.locked:true` — 모든 subprocess 렌더 경로가 통과하는 **단일 전파점**). 아웃라인은 `OutlineNode.locked`로 `buildOutline`이 펼침 화살표 억제. `process-node.tsx` `LockedBadge`(lucide `Lock`) — `SubprocessHandles` 불변(엣지 유지). i18n `subprocess.locked`. `api.ts` `Graph.locked?`, `canvas.ts` `NodeData.locked`·`OutlineNode.locked`. 부수: `handleSummaryOpenChild` useCallback 추출(react-hooks/refs 룰). lint·tsc·build clean, 렌더 스모크 pageerror 0. `.git/sdd/mask-task2-report.md`.
- **resolved 권한 마스킹 서버 차단 (mask Task 1, feat/expand-sync)** — `GET /api/library/processes/{map_id}/resolved` 에서 viewer 미만 호출자를 완전 잠금. `GraphOut`에 `locked: bool = False` 추가(하위 호환). `resolved_graph`에 `user: str = Depends(get_current_user)` 주입, 권한 체크를 `_load_graph` 호출 전 최초 수행: `role_rank(get_effective_role(...)) < role_rank("viewer")` → `GraphOut(nodes=[], edges=[], locked=True)` 즉시 반환(그래프 미빌드). None(맵 없음·권한 없음)=rank 0→자동 잠금. 수정: `library.py`·`schemas.py`. 신규 테스트 4개(`tests/test_library_mask.py`): below-viewer→200+locked+빈배열, viewer/owner/sysadmin→실그래프. ruff clean, **266 passed**. `.git/sdd/mask-task1-report.md`.
- **딥드릴 합성 id — L2→L3 더블클릭 드릴 수정 (mask Task 0, 마스킹 전제)** — 근본원인은 합성 id 미해석이 아니라 **이벤트 라우팅**: 캔버스 캡처 `dblclick` 핸들러가 현재 프레임 노드를 전부 RF에 위임했는데, 딥뷰(읽기전용, `data.scopeId!=null`) 프레임 노드에는 React Flow가 `onNodeDoubleClick`을 발화 안 해 L2→L3 드릴이 죽음. 수정: 캡처 가드를 `scopeId`로 분기 — 루트 편집(`scopeId==null`)만 RF 위임(드릴+이름편집 보존), 딥뷰 읽기전용은 직접 `drillIntoSubprocess`. L2→L3 진입·L1→L2·이름편집·일반맵·아웃라인 depth-3 무회귀, pageerror 0, lint·tsc·build clean. `.git/sdd/mask-task0-report.md`.
- **마스킹 게이트 자리(no-op) + 3중첩 데모 픽스처 (expand-sync Task 2)** — 펼침/드릴 수렴 3지점을 미래 마스킹이 뒤집을 "게이트 자리"로(동작 불변): ① `canExpand=true` no-op + `toggleInlineExpand` 최상단 가드 ② `isDrillableHost` 주석 ③ `canvas.ts` `isSubprocessExpandable(type)` 추출. ADDITIVE 3중첩 시드 `seed_nesting_demo`(L3=user.choi 소유로 마스킹 비대칭 사전 마련). ruff·pytest 262·lint·tsc·build clean, depth-3 SYNC 스모크. `.git/sdd/expand-sync-task2-report.md`.
- **아웃라인 접기 드릴인 모드 인지 (expand-sync Task 1)** — 드릴인(scopes)으로 펼친 하위프로세스를 아웃라인에서 접으면 캔버스가 안 접히던 버그 수정. `collapseIntentRef`(명시 접기 가드) + mode-aware `collapseSubprocessRow`(드릴인=scope pop+가드·인라인=토글), scope-load effect가 가드 1사이클 소비. page.tsx만 수정. lint·tsc·build clean. `.git/sdd/expand-sync-task1-report.md`.
- **feat(editor): 툴바 최소화 → 하단 탭 패널 + 헤더 재구성 + 홈카드 커서** (`claude/frontend-ux-improvements`) — 홈 카드 `cursor-pointer select-none`. 에디터: 우측 인스펙터 하단을 **탭 패널**(승인/버전/다운로드/맵 디자인)로, 툴바의 버전(현재버전·생성·리네임·삭제·컴페어)·PNG·엣지스타일을 거기로 이동·상단 제거, 모두 펼치기/접기 버튼 제거(`expandAll`/`collapseAll`·`UnfoldHorizontal`/`FoldHorizontal` 정리). 헤더 좌상단=아웃라인 토글(사이드바 닫기 이동)+맵이름 드롭다운(목록/루트로), 브레드크럼 제거(`handleBreadcrumb` 정리, 드릴인 복귀=조상클릭/드롭다운 루트로), 검색 가운데 `mx-auto`+`w-72`. 사이드바 펼침 닫기버튼 제거. 검증: tsc·lint·build clean.
- **feat(home/editor): 내 소속 멤버 하이라이트·가시성 색·카드 최신상태 필·인스펙터 상세** (`claude/frontend-ux-improvements`) — ①상세 멤버에서 내 소속(user=내 loginId / group=내가 속한 그룹, `listGroups`) 행을 투명 악센트(`bg-accent/10`)로 하이라이트(dept는 org-path 필요해 보류). ②public/private 필 색 구분(`visibility-status.visibilityPillClass`: public=added, private=neutral). ③**백엔드(스키마 무변경)**: `list_maps`가 맵별 최신 버전 상태(`latest_version_status`) 동봉(1쿼리) → 카드 우측아래 상태 필. ④에디터 인스펙터 "선택 없음"에 MapDetailCard(footer 없이) 노출. 공유 `lib/version-status.ts` 추출. 검증: ruff·pytest 270(+1)·tsc·lint·build clean.
- **feat(home): 카드 바로열기 버튼 + 상세 버전·멤버 좌우 + 멤버 그룹핑** (`claude/frontend-ux-improvements`) — 카드 호버 액션을 삭제→**바로 열기**(에디터 직행, ExternalLink, 전원)로 교체(삭제는 상세 하단에만), MapCard `onDelete` prop 제거. 상세 카드의 **버전·허용인원을 좌우(flex-wrap)** 배치. 멤버를 **개인→팀→유저 그룹** 순 그룹핑 + 그룹 사이 스페이서(gap-3). i18n memberUser/Dept/Group 추가. 검증: tsc·lint·build clean.
- **feat(home): 동일폭 2패널 + 카드 선택전용 + 상세 하단 버튼바** (`claude/frontend-ux-improvements`) — 리스트·상세를 같은 폭(flex-1 + `max-w-[34rem]`)·`min-w-[18rem]`(안 깨짐)·전체 `max-w-[72rem]` 중앙·좌우 `px-8`. 카드 타이틀의 에디터 직행 제거(클릭=선택만, span), 카드 More 제거·삭제(owner)만 유지. 상세 하단 **고정 버튼바**: 왼쪽 [열기][맵 설정] / 오른쪽 [삭제](owner), 우측 위 [열기] 유지. MapDetailCard 내부 스크롤+footer 구조, onDelete prop. 미사용 home.more 제거. 데스크톱 전용이라 상세(xl)는 사실상 상시 노출. 검증: tsc·lint·build clean.
- **feat(home): 카드 폭 축소 + 상세창에 허용 인원** (`claude/frontend-ux-improvements`) — 리스트 폭 `max-w-sm`로 제한(카드 과폭 해소), 상세 패널은 `flex-1`로 확장(타임라인·멤버 공간). 상세 카드에 허용 인원 섹션 추가(`listMapPermissions`, editor+ 한정). #2 버전 타임스탬프 타임라인은 백엔드 필요(스키마에 submit/publish 시각 미기록) — 별도 결정. 검증: tsc·lint·build clean.
- **feat(home): 마스터-디테일 레이아웃 + New map 우상단** (`claude/frontend-ux-improvements`) — 홈을 풀높이 div로(페이지 스크롤 X, **리스트만 내부 스크롤**). New map 버튼 우상단 이동. 카드 선택(`MapCard` selected/onSelect) → **넓은 화면(xl)에서 우측 상세 카드**(`map-detail-card.tsx`: 가시성·역할·버전+승인상태, getMap만 사용·백엔드 무변경). 선택은 파생(첫 맵 폴백, 이펙트 없음). **확인 결과: "누가 들어가도 owner"는 버그 아님** — `is_sysadmin`이 AUTH_ENABLED=false & DEV_ENFORCE_PERMISSIONS=false면 전원 True(로컬 잠금 방지)→sysadmin=owner. 실제 역할은 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=…` 또는 AUTH_ENABLED=true에서. 검증: tsc·lint·build clean.
- **feat(map-settings): 맵 설정 레이아웃을 /settings와 동일하게** (`claude/frontend-ux-improvements`) — `/maps/[mapId]/settings`를 헤더+가로탭 → **좌측 세로 탭 레일 + 우측 콘텐츠**로 전환(설정 콘솔과 동일 패턴). 레일: 뒤로가기·맵이름·탭 버튼(좌측정렬, active=bg-accent-tint)·하단 현재유저+[Dev]전환. 읽기전용 알림은 콘텐츠 상단으로, dev 스위처 드롭다운은 좌하단 앵커. 로직(게이팅·effectiveRole·visibleTabs·refreshMap) 불변, JSX 레이아웃만 교체. 검증: tsc·lint·build clean.
- **feat(editor): 사이드바 하단 설정 버튼 + 뷰모드 워터마크 배경** (`claude/frontend-ux-improvements`) — 에디터 좌측 사이드바 하단에 `/settings` 진입 버튼(펼침=sticky bottom 라벨, 접힘=`mt-auto` 아이콘으로 왼쪽 아래 유지). 편집 불가(`readOnly`=타 사용자 체크아웃/상태 잠금) 시 점(dot) 그리드를 끄고 "읽기 전용" 워터마크(중앙 대형·faint·회전, pointer-events-none) 표시 → 뷰모드 즉시 인지. i18n 1키(editor.viewOnly). 백엔드 무변경. 검증: tsc·lint·build clean.
- **feat(home): 프로세스맵 카드 리디자인** (`claude/frontend-ux-improvements`) — 홈 목록을 카드로(`components/maps/map-card.tsx`). 카드 좌하단 메타 한 줄(가시성·역할 뱃지 + **"허용된 인원 보기" 드롭다운** = `listMapPermissions` lazy fetch). 인원 조회는 서버 editor+ 게이트라 **editor/owner 카드에만** 버튼 노출. 호버 시에만 **더보기(→맵 설정)·삭제(owner만)** 버튼 표시. RoleBadge·visibility 라벨 재사용, i18n 3키. 백엔드 무변경. 검증: tsc·lint·build clean.
- **feat(settings): DB 테이블 뷰어 탭** (`claude/frontend-ux-improvements`) — 설정 콘솔에 sysadmin 전용 "Database" 카테고리 추가. 백엔드(스키마 무변경·읽기전용 인트로스펙션): `GET /api/admin/tables`(메타데이터 테이블명) + `GET /api/admin/tables/{name}`(서버측 페이징/정렬/필터). 안전장치: sysadmin 게이트·테이블/정렬컬럼 메타데이터 검증·q 바인드 파라미터·SELECT 전용. 프론트 `table-viewer.tsx`: 테이블 선택→표, 헤더 클릭 정렬, 필터(디바운스), 100행 초과 시 페이징. 좌측 바 유지·우측 갱신은 기존 /settings 레이아웃 그대로. 검증: ruff·pytest 269(신규 7)·tsc·lint·build clean.
- **feat(UX): 어드민 콘솔 → 설정(/settings) 통합 + 그룹 탭 편입** (`claude/frontend-ux-improvements`) — `/admin`을 **`/settings`(누구나 접근)** 로 전환, 좌측 탭이 권한별로 다르게: Groups(모두)·조직(admin)·권한(sysadmin). `/groups` 인덱스를 `components/groups/groups-panel.tsx`로 추출해 Groups 탭으로(상세 `/groups/[groupId]` 유지, back→/settings). top-nav 드롭다운=설정+로그아웃만(Admin·Groups 링크 흡수). 미사용 i18n(nav.adminPage·navLink·consoleTitle·noAccess) 제거, nav.settings 추가. 백엔드 무변경. 검증: tsc·lint·build clean(라우트 /settings·/groups/[groupId], /admin·/groups 인덱스 제거).
- **feat(admin/UX): 어드민 + 시스템 어드민 페이지 통합** (`claude/frontend-ux-improvements`) — `/admin`(직원·role) + `/admin/permissions`(권한·sysadmin)를 한 `/admin` 콘솔로 합치고 **좌측 세로 탭 레일**(카테고리: 조직/권한, 스페이서 구분)로 분리. 권한별 카테고리 노출(admin→Employees / sysadmin→큐·부서·사용자), 둘 다 없으면 안내. 직원 테이블을 `components/admin/employee-table.tsx`로 추출, top-nav 두 링크→단일 "관리자 페이지". `/admin/permissions` 라우트 제거. 백엔드 무변경(서버 가드 기존). 검증: tsc·lint·build clean(라우트 7개, /admin/permissions 사라짐).
- **fix(seed): 빈 영어 데모 맵에 노드 채움 + Version Workflow v1↔v2 diff** — `seed_permission_demo`의 4개 맵(Public/Private/Roles/Version Workflow)이 노드 0개였음 → `_build_flow` 헬퍼로 선형 흐름 시드. Version Workflow는 v2에 `source_node_id` 계보로 added(Test)·changed(Release→Release & Notify) 부여해 그 맵 자체 비교도 의미있게. 검증: reset_db 후 9개 맵 전부 노드>0, map8/map9 diff 정상.
- **feat(seed): 버전 비교 데모 맵 추가** — `seed_compare_demo`(reset_db ADDITIVE 5단계) 신설. "Version Comparison Demo (As-Is / To-Be)" 맵 1개에 As-Is(published)·To-Be(draft) 2버전, To-Be `source_node_id`로 As-Is 계보 연결 → 비교 화면에서 추가(품질 점검)/삭제(수기 승인)/변경(신용 검토 담당자·출고→출고/배송) 하이라이트. 검증: reset_db 후 diff 규칙 재현 = added 1·removed 1·changed 2. db-seed.md 갱신.
- **fix(seed): 권한 데모 맵 버전 누락 → 에디터 크래시 수정** — `seed_permission_demo._create_map`이 버전 없이 맵 생성 → Public/Private/Roles 맵을 열면 에디터 `versions[0].id`에서 `cannot read properties of undefined (reading 'id')`. 정상 `create_map` 라우터처럼 초기 "As-Is" 버전을 시드(`seed_version=True` 기본, Version Workflow 맵만 자체 v1/v2라 False). 검증: reset_db 후 8개 맵 전부 ≥1 버전(이전 5/6/7 = 0).
- **서버 시드 활성화** — `backend/Dockerfile`에 `COPY scripts/ scripts/` 추가(시드 스크립트가 이미지에 없어 컨테이너에서 `reset_db` 불가였음). 이제 서버에서 `docker compose up -d --build backend` 후 `docker compose exec backend python -m scripts.reset_db`로 시드. `db-seed.md`에 "서버(docker-compose)에서 시드" 섹션, `deploy.md` §3에 포인터 추가.
- **md 문서 최신화 + 압축**(메인 기준) — `db-seed.md` 전면 재작성(stale `seed_dummy.py`→실제 `reset_db.py` 4단계: drop/create+직원+참조데모+권한데모, 부분 시드·권한 강제 검증), `deploy.md`+`deploy-auth-ad.md` 단일 런북 병합, `spec.md` 데이터모델·구현순서 최신화(parent_node_id 폐기→subprocess 참조·RBAC), CLAUDE.md 상태줄·README·lessons 현행화, `PROGRESS.md` 한 줄 요약으로 압축(175→약55줄).

## 2026-06-21
- **권한 워크플로 데모 시드 + EN/KO 가이드** — `reset_db`가 호출하는 ADDITIVE `seed_permission_demo`(가시성 대비 맵·3종 principal 협업자·pending 결재 2·활성/비활성 승인자·그룹 2·버전 워크플로). 가이드 `docs/permission-demo-walkthrough.md`(8단계).
- **권한 whole-branch 리뷰 픽스 + mock-store dead code 정리** — create-dialog `.catch` 폴백, 고아 모달 제거, Layer 1-4 후 외부참조 0 심볼(types/logic/store) 제거. pytest 262 pass.
- **권한 Layer 4(유저그룹) 완료** — 스키마 3테이블 + `effective_role` 그룹 principal 활성(user/dept 멤버십), 그룹 관리 API(`/groups` CRUD·승인 큐·멤버≥2·관리자≥1), 프론트 그룹 화면·협업자 그룹 grant 실 API 배선. cross-map 결재 큐 엔드포인트는 미생성(보고). 협업자 피커 데이터소스를 한글 mock→영문 실 디렉터리(`/api/directory`)로 교체.
- **권한 Layer 3(프론트 실 API 배선) 완료** — 역할 컨텍스트 서버 단일화(`/api/me.is_sysadmin`·`MapOut.my_role`)·시드 영문화(AD 정렬), 맵 권한 화면 6종(협업자·결재자·가시성·위험구역·생성·결재대기) + 버전 게시 워크플로를 Layer-2 엔드포인트로 전환(서버 진실·낙관적 갱신 금지). MAP cross-map 큐는 라벨된 mock 미리보기 유지.
- **권한 Layer 2(백엔드 게이트·관리 API) 완료** — 맵 엔드포인트 권한 게이트(가시성 필터·viewer/editor/owner·체크아웃 보유 강제) + 권한 관리 엔드포인트(협업자 CRUD·다운그레이드 승인 pending·owner 이양·가시성 요청·결재 결정). pytest 216 pass.
- **캔버스 회귀 픽스 3건** — ① 펼침 영역 가로지른 루트 드래그 드롭 좌표 보정(고정점 풀이) ② 아웃라인이 접힌 하위프로세스를 펼치기 가능으로 표시 ③ obsolete "child" 드롭존 제거 + 하위프로세스 엣지 핸들 보정(`withSubprocessHandles`).

## 2026-06-20
- **하위프로세스 참조 모델(Call Activity) — 백엔드+프론트 완료**. 인라인 계층 편집(`parent_node_id`, 버그 원천) 폐기 → 루트에서만 편집, 하위는 다른 프로세스를 링크해 읽기전용 펼침. 백엔드: 노드 평면화·subprocess 참조/대표끝/엣지핸들 필드·프로세스 검증·순환 차단·라이브러리/해석 API(120 tests). 프론트(9태스크): 합성트리(compositeTree로 링크맵 resolved를 네임스페이스 parent로 임베드 → 렌더 폴리시 무변경)·동적 끝핸들·하위 편집경로 제거·읽기전용 딥뷰 드릴인·라이브러리 드래그·다중출구+버전 업데이트 배지·follow-latest. 설계 `specs/2026-06-20-subprocess-reference-model-design.md`.
- **포커스 시 조상이 활성 영역을 "감싸도록"** — `ancestorContextNodes`를 재귀 감싸기로 재작성(앞 형제=왼쪽·뒤 형제=오른쪽), 깊은 드릴인 시 좌측 붕괴 수정.
- **권한 관리(Permission Management) UI-first mock 구현(Phase 1-3)** — mock 레이어(타입·시드·순수 판정·in-memory store) → 맵 권한 UI(협업자·결재자·가시성·위험구역·버전 게시 상태기계·승인자 재지정) → 유저그룹·sysadmin 콘솔(`/admin/permissions` 통합 승인 큐·부서 동적 깊이·사용자 목록). 설계 `specs/2026-06-20-permission-management-design.md`. (이후 Layer 1-4에서 실 백엔드로 대체)
- **복잡한 깊이4 테스트 맵 추가**(`seed_complex_demo.py`) — 하위보유 노드 3개·깊이4 중첩 + 그룹·속성·description·decision 분기·엣지 라벨·루프백.

## 2026-06-19
- **포커스 모드 — 활성 스코프 dim/편집** (`feat/active-scope-focus-mode`). 비활성(인라인 자식/조상) 스코프 읽기전용 dim → 클릭 시 그 스코프를 활성 `nodes`化(`navigateTo`+카메라 보정, 드롭존·그룹·정렬 네이티브) → 제자리 토글로 정착. 깊이별 레인 세로 경계선·틴트(flat 5%)·셰브론 절대깊이 통일, 조상 감싸기 레인, fit/팬 좌상단 스냅 제거, exit 카메라 통합 보정. 자식 다중선택 드래그 1개만 이동 버그 수정.
- **인라인 하위 프로세스 편집 가능화 — 별도 `childNodes` state 방식**. (메인 nodes 합치기는 광범위 회귀로 reset.) displayNodes 합성 + 커스텀 `onNodesChange` 분배로 RF 측정·이벤트 발화하며 메인 nodes 무손상. 레인 안 자식 삭제·이동(저장 pos)·연결·추가 4종. 이름편집은 모달 유지. 계획 `plans/2026-06-19-editable-inline-subprocess.md`.
- **레슨런 문서화**(`docs/lessons/`) — canvas-react-flow·scope-save-and-coordinates·browser-verification·react-ts-patterns + README, CLAUDE.md "Lessons" 섹션 링크.
- 줌아웃 시 캔버스 좌상단 고정 풀리던 버그 수정(`translateExtent` 우하단을 pane/minZoom 이상으로 → centering 차단).

## 2026-06-18
- **인라인 펼치기/접기 전면 구현** — 드릴인 자유창(`ScopeWindow`)을 같은 캔버스 인라인 펼침으로 전환. 자식 노드 가시화(measured 직접 주입·미측정=visibility:hidden 회피), 더블클릭 편집(raw dblclick 캡처 — RF가 prop-only 자식에 이벤트 미발화), 영역 = 전체높이 세로 레인(`InlineRegionBands`), 중첩(재귀) 지원, 모두 펼치기/접기 + 펼침 캡(노드300/깊이5), ease-in-out 슬라이드, 휠=상하이동·Ctrl+휠=줌. `/graph/all`에 `has_children` 추가. 하위 생성/삭제 불변식 모달(Start/작업/End).
- 마이너 버그 묶음 — 언그룹 undo 그룹 복원, 그룹 2명 미만 자동제거, 노드 타입 변경 삭제, 토스트 우상단 스택, 아웃라인 삭제 지연.
- 드롭/삽입 엣지 좌-좌 붙던 버그 수정(`s-right`/`t-left` 기본 핸들 명시).
- 아웃라인 키보드 내비게이션(↓/Tab·↑/⇧Tab·→펼침·←/F 접고이동) + 고정 단축키 안내 카드, 선택행 자동 스크롤.

## 2026-06-17
- 엣지 핸들 변 커스텀(`source_side`/`target_side` 컬럼, 노드 4변 8핸들, 우클릭 십자 패드). 설계 `specs/2026-06-17-edge-handle-side-customization-design.md`.
- decision 분기 엣지 Yes/No 색상(파스텔 블루/레드 토큰, `branchKindOf`).
- 모달 외부클릭 닫기 버그 수정(공용 `ModalBackdrop` — mousedown·click 모두 백드롭일 때만).
- 노드·그룹 이름 캔버스 내 중복 금지(`(2)` 자동 접미사), 캔버스 좌측 줌 인디케이터, AI 채팅 세로 스크롤 수정.

## 2026-06-16
- **Keycloak 로그인 + 사내 AD(LDAP) 동기화 + 로컬 임시 로그인** — 백엔드 `employees` 테이블·`app/ad/`(DN 파싱·필터·ldap3·sync_one/all+5분 가드)·`X-Dev-User`·`require_admin`·`/api/me·employees·employees/sync`. 프론트 `/login` 게이트·임시 로그인 모달·TopNav 드롭다운·`/admin` 직원 테이블. 배포 절차·compose `LDAP_*` 배선. 설계 `specs·plans/2026-06-16-keycloak-login-ad-sync*`.
- insecure context(평문 HTTP) 픽스 — `crypto.randomUUID`/`crypto.subtle`가 secure context 전용 → 노드/엣지 생성은 `lib/id.ts genId`(getRandomValues 폴백), Keycloak 로그인은 `disablePKCE:true`. **localhost에선 재현 안 됨**(secure context). 로그인 직후 첫 `GET /maps` 401 레이스 수정(토큰 렌더 단계 동기 반영).
- 서버(사내 71번) 배포 성공 — node:22→20-alpine, compose 명시 서브넷(172.36.0.0/16). 앱 노출 포트 9787→3333 일괄 변경.
- DB 초기화·시드 문서/스크립트 등록(`docs/db-seed.md`). decision 분기 모달 누락(드롭 경로) 수정. 전역 버튼 인터랙션 base(커서·scale 0.97).

## 2026-06-15
- **온프레미스 AI 채팅** — 백엔드 OpenAI 호환 프록시(`ai_client`/`ai_prompt`/`routers/ai`, 502 내부 URL 비노출) + 프론트 채팅·미리보기·적용·모델 드롭다운(`/v1/models`). 접속 테스트 `docs/ai-connectivity-test.md`. 설계 `specs/2026-06-15-ai-chat-flowchart-design.md`.
- 그룹 = 다중 태그 모델(`nodes.group_ids` JSON, 레거시 `group_id` 무손실 병합) + 중첩(하위 그룹) + 멤버 일괄 편집. 그룹 박스 = bbox − 비멤버 notch.
- 메뉴 단축키 2계층화(가속기 + 전역 조합, IME 무관 `event.code`) + 정렬 메뉴 재구성(가운데 정렬·날개 통합). 아웃라인 들여쓰기=계층만·키보드 편집. 캔버스 무한 확장 → bbox 기반 fit.
- 에디터 14종 배치(호버·요약모달 편집·인라인 리네임·드롭존 교환·그룹 생성/해제·엣지 스타일 전역·AI 플로팅 창 등).

## 2026-06-14
- **버전 승인 워크플로우 풀스택** — Draft→Pending→Approved→Published(+Rejected), 맵별 만장일치 승인자, 수동 게시+구버전 강등, 인앱 알림, 대시보드(라이프사이클 stepper). 설계 `specs/2026-06-14-version-approval-workflow-design.md`.

## 2026-06-13
- **에디터 UI 대개편** — 좌 아웃라인 트리·우 인스펙터·컨텍스트 메뉴·단축키 레전드·드래그 드롭존·비활성창 정적 프리뷰. 설계 `specs/2026-06-13-{editor-ui,drag-drop-zones,node-interactions}-design.md`.
- 그룹(업무 묶음) 풀스택(`groups` 테이블·박스·타이틀바). Whimsical 디자인(바이올렛 #6A41FF·파스텔·dot-grid). 설계 `specs/2026-06-13-whimsical-design-design.md`, `rules/frontend/design.md`.

## 2026-06-12
- OS형 자유 창(드릴인 `ScopeWindow`)·UI 디자인 시스템(Tailwind4 `@theme`·Pretendard·Lucide)·전역 네비바+i18n(en/ko)·박스선택. 설계 `specs/2026-06-12-*`.
- 기능 확장 Phase A/B/C(`docs/spec.md` §7) — A: undo/redo·컨텍스트메뉴·자동저장·색/모양. B: BPM 속성·버전 diff(계보)·초성 검색·PNG. C: 체크아웃 잠금·노드 코멘트.
- 문서 명령 bash/PowerShell 병기 원칙(`rules/common/documentation.md`).

## 2026-06-11
- 초기 구축(spec §6 ①~⑤): 스캐폴딩(Next+FastAPI+nginx+compose) → 맵 CRUD+캔버스 → 계층(드릴다운·브레드크럼)+정렬(dagre) → 버전관리+비교 → Keycloak 인증(AUTH_ENABLED). 기능 명세 `docs/spec.md`. 프로젝트명 BPM 확정.

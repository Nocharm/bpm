# Progress

## 2026-07-18 — 맵 이름 변경 승인 워크플로우 설계 스펙 (worktree-map-rename-workflow)
- 브레인스토밍으로 요구 확정(요청=editor 이상, 승인=오너/sysadmin 1인, 오너/sysadmin은 즉시 적용+pending supersede, 맵당 pending 1건, Settings 진입, 알림 5종) 후 설계 스펙 작성 — `docs/superpowers/specs/2026-07-18-map-rename-workflow-design.md`. 접근: 기존 `ApprovalRequest`에 `kind='map_rename'` 확장(DDL 불요), decide·Inbox는 kind별 오너/sysadmin 게이트 분기, `PATCH /maps` name은 오너/sysadmin 전용으로 조임(에디터 403), 신설 2엔드포인트(요청 생성·본인 취소). 리뷰 반영: 행위자 토스트를 알림 시점과 대칭으로 추가(§5.4 — 수신 측은 알림, 행위자는 토스트로 경계 유지). 구현 계획 작성 — `docs/superpowers/plans/2026-07-18-map-rename-workflow.md`(7태스크 TDD: BE 요청/조임/decide/Inbox 4 + FE Settings/Inbox 2 + pw 왕복 1, 실코드·게이트 명시).
- **Task 1**: 백엔드 요청 생성·pending 조회·취소 엔드포인트 + 공용 알림 헬퍼 — `RenameRequestIn` 스키마·`load_map_user_collaborators`·`notify_map_renamed` workflow 함수·3개 POST/GET/DELETE 엔드포인트. TDD: test_map_rename_workflow.py 9/9 green(editor 요청 생성 + 오너 알림·중복 409·미승인 422·권한 403, pending 조회·본인 취소 204·타인 취소 403·미존재 404). 게이트: pytest 650/650·ruff clean.

## 2026-07-18 — persist-effect StrictMode 리셋 잔존 2건 픽스: edgeStyle·inspectorWidth (dev 직접 커밋)
- params-ui-sync에서 적발된 진범 패턴(상태-의존 effect 영속 → StrictMode 이중 마운트가 hydration 전 기본값으로 저장값 덮어씀)의 잔존 전수 스캔: 실버그 2건(`bpm.edgeStyle`·`bpm.inspectorWidth`, dev 한정 증상) + 자체 완화 2건(`bpm.home.filters` skip-guard, `bpm.windows.*` 디바운스+cleanup — 존치) + 나머지 9곳은 핸들러/lazy-init로 안전.
- 수정: persist effect 2개 제거 — edgeStyle은 스타일 버튼 onClick에서, inspectorWidth는 리사이저 드래그 종료(pointerup)에서 최종값(`lastW`) 1회 영속.
- 검증: pw 프로브(일회용, 미커밋) 6/6 — 저장값 선주입 후 마운트 유지(straight/480 리셋 없음)·폭 480 레이아웃 적용·버튼 클릭 즉시 영속·드래그 종료 영속(500)·재로드 왕복. 게이트: tsc 0·lint 0 err.

## 2026-07-18 — 6필드 파라미터 미반영 표면 동기화: 그룹 일괄 편집·파라미터 표시 토글·stale 스크립트 (worktree-params-ui-sync)
- 조사(에이전트 3병렬): 그룹 일괄 편집은 people/system/duration만 지원(5필드 누락·PARAM_FIELDS 미사용·SP 전면 배제), 캔버스 파라미터 칩은 토글 불가(항상 표시), 그 외 제품 표면은 전부 6필드 반영 확인 — 잔존은 pw-verify-export/sp-params 스크립트 2개뿐. 방향 확정: 일괄 편집 6필드 전부(SP는 annual_count·fte 허용) + "Parameters" 통합 토글 1개(기본 ON). 계획 `docs/superpowers/plans/2026-07-18-params-ui-sync.md`.
- **Task 1**: `lib/bulk-params.ts` 신설 — `canBulkEditField`(모드별 대상: people/system=hasBpmAttributes, 파라미터=getEditableParamFields), `buildBulkAttrPatch`(비용 설정 시 반대 통화 소거·비우기는 양쪽 소거), `isBulkParamField`. vitest 7/7 (TDD RED→GREEN).
- **Task 2+3**: `NodeDisplayToggle`("params" 추가)·`NODE_DISPLAY_TOGGLES`·`parseDisplayToggles`(v2 키 우선, 레거시 저장값은 params ON 이관 — 기존 사용자 칩이 꺼지는 회귀 방지) + `NodeParams`를 토글로 게이팅·`NodeFields`는 params 제외. compare 뷰는 `["params"]` 주입으로 칩 종전 표시 보존, Provider 없는 임베드는 defaultActions에 params 포함으로 보존. vitest 5/5 신규, 전체 500/500·tsc 0.
- **Task 4**: 에디터 토글 state를 `NodeDisplayToggle[]`(기본 `["assignee","params"]`)·localStorage `bpm.nodeDisplayFields.v2`(레거시 키는 이관 소스로만 읽고 유지)로 전환, 맵 탭 "노드 표시 정보" 카드에 Parameters 스위치 행 추가(`field.params` EN/KO). lint 0 err·tsc 0.
- **Task 5**: 그룹 일괄 편집을 6필드 전체로 확장 — `BulkAttrField = "system" | ParamField`, 모드 탭을 PARAM_FIELDS 순회로 생성(라벨=PARAM_LABEL_KEY, 아이콘=캔버스 칩과 동일). 모드별 멤버십 `canBulkEditField`(SP는 annual_count·fte 모드에 포함, people/system/나머지 4필드는 종전대로 제외). 비용 모드는 반대 통화 보유도 충돌로 취급(`getExistingAttrRaw`)·표시는 실보유 통화 기호(`displayExistingAttr`)·적용은 `buildBulkAttrPatch`로 반대 통화 소거. 파라미터 모드는 append 정책 봉인(숫자 콤마 append→백엔드 소거 유실, 기존 duration append 잠복 버그 해소), 입력은 ParamInput 공용. tsc 0·lint 0 err·vitest 500/500.
- **Task 6**: stale 검증 스크립트 2개를 6필드 모델로 이행 — pw-verify-export.mjs(입력 6필드·CSV 14컬럼 Cost_KRW/Cost_USD/Annual_Count/FTE·Excel 16컬럼·USD 경로 디시전 노드·표시형 1h15m/₩300 계약 + **추가 stale 2건 발견·수정**: Parameters 그룹 기본접힘 미대응, Excel 형식 선택 모달 미대응), pw-verify-sp-params.mjs(시드 cost_krw·지정 PUT 4필드·Σ 4개=headcount 평균 포함·sp_cost_krw·칩 ₩0.3). 실기동 green: export 22/22, sp-params 24/24 (백엔드 8907·프론트 3207, reset_db 시드).
- **Task 7**: 신규 브라우저 검증 `pw-verify-params-ui-sync.mjs` 14/14 green — 8모드 탭·cost_krw 일괄(통화 전환 충돌→Replace·Bravo USD 소거·SP 제외)·fte 일괄(SP 포함 4멤버)·칩 ₩500·토글 OFF/새로고침 유지/ON 복귀·레거시 이관. 검증이 **StrictMode 리셋 잠복 버그 적발·수정**: displayFields persist effect가 이중 마운트에서 hydration 전 기본값을 저장소에 덮어써 OFF 상태가 리셋(ui-improvement-5 때 알려진 잠복 이슈) → 영속을 토글 핸들러로 이동. 모달 루트에 `data-id="group-bulk-modal"` 부여(컨벤션). 최종 게이트: lint 0 err·tsc 0·vitest 500/500·build OK.

## 2026-07-18 — 인스펙터 Subprocess 탭: 지정 메타 + 역참조(used-by) 목록 (worktree-sp-usage-tab)
- **백엔드**: `GET /api/maps/{map_id}/subprocess-usage` 신설(viewer+, DDL 없음) — 지정 메타(designated/시점/행위자 `sp_changed_by`) + 지정이 가리키는 버전(최신 게시본 라이브 해석: id·number·label) + 이 맵을 링크한 부모 맵 목록. 사용처 판정은 부모의 **라이브 버전**(게시본 max id, 없으면 최신 — list_maps 노드 수 규칙과 동일) 기준 노드 수. 소프트삭제 부모 제외, 열람 불가 부모는 이름 미노출 `hidden_count` 집계(effective_role). 테스트 6종(test_subprocess_usage.py).
- **프론트**: 인스펙터에 **Subprocess 탭** 추가 — 지정된 맵에서만 노출(importSlot과 같은 조건부 탭 패턴, Map 탭 뒤). 상단 지정 정보 박스(버전 v{n}·라벨, 지정 시점 KST, 지정자 UserPill, 최신게시본 추종 안내 노트) + "이 맵을 연결한 맵" 목록(행=맵 이동 Link, 오우닝 부서 캡션, 링크 노드 수 ×n 칩, 빈/숨김 상태 문구). 지정/해제 시 `onDesignationChange` 콜백으로 usage 재조회(탭 노출 동기화). 지정 해제로 슬롯이 사라지면 열려있던 탭은 Map 탭으로 렌더 파생 폴백(effect 불요).
- 게이트: pytest 641(+6)·ruff·vitest 488·tsc 0·lint 0·build OK. pw 실측(ko/en): 맵3에서 탭 노출·지정 메타·연결 맵 3건(×2 칩·부서 캡션) 렌더 확인.

## 2026-07-18 — 권한 마스킹 표면 정리: 아웃라인 잠금 화살표 억제 + WBS 잠긴 SP 행 살리기 (worktree-inline-expand-drag-fix)
- 조사(권한 강제 백엔드 + yerin.yoo〈맵1 무권한〉 실측): 캔버스는 봉인 정상, Excel 1안은 SP 행+denied 노트 정상, CSV/Word는 링크맵 데이터 자체가 안 실려 무변경. sp_* 지정 정보는 잠금 사용자에게도 노출(지정 카드=공개 메타데이터, 현행 유지).
- **아웃라인 버그 픽스**: 현재 스코프의 잠긴 SP 행에 펼침 화살표가 그대로 표시되고 클릭이 무반응이던 문제 — outline memo가 `node.data.locked`를 읽었지만 nodes state엔 locked가 없음(주입은 displayNodes 렌더 시점). `lockedKeys` 직접 조회(canExpand와 동일 판정)로 교체 — 임베드/심층 행은 종전부터 정상. 미지정 SP도 함께 억제(resolved가 locked 반환). 키보드 `→` 펼침도 hasChildren=false로 자동 차단.
- **WBS(2안) 잠긴 SP 행 살리기**: 종전엔 잠긴/해석실패 SP가 이름조차 없는 익명 "(access denied)" 노트 1줄로 소실 → **번호 달린 잎 행**(Task=SP 제목, 파라미터·설명은 1안 SP 행과 동일 소스: 지정정보 상속+베이스·추가분 합성, next 포함) + 레벨 경로에 SP 제목을 단 denied 노트로 변경. 잎 행이 rowByNodeId에 들어가 규칙4 주석 대상도 유지. TDD(RED→GREEN), 시트 기록은 무변경.
- 게이트: vitest 475/475·tsc 0·lint 0 err·build OK. pw 실측: 아웃라인 화살표 잠금·미지정 모두 1→0, WBS 미리보기가 잎 행+denied 노트 형태로 출력(맵2, yerin.yoo).

## 2026-07-18 — 맵 상세 카드·인스펙터에 오우닝 부서 노출 (worktree-create-map-picker-ux)
- 요청: 맵 상세 화면/인스펙터에 협업 부서처럼 오우닝 부서를 보이게. 진단 = 상세 카드(홈)는 헤더 필로만 노출·`only="members"`(에디터 인스펙터 Map 탭 재사용) 모드에선 헤더가 생략돼 오우닝 부서가 **전혀 안 보임**.
- 수정: `MapDetailCard` 멤버 컬럼 최상단에 오우닝 부서를 협업 부서 행과 동일 스타일(레벨 아이콘·부서명, 한글명 폴백)로 노출 — `data-id="map-detail-owning-member"`, `Editor · locked/고정` 서브라벨 + editor RoleBadge, accent-tint 강조. `only` 무관 렌더라 상세 카드·인스펙터 양쪽 동시 반영. `detail.owning_department`를 const로 좁혀 클로저 타입 안전.
- 게이트: lint 0 err·tsc 0. 실앱(map 2 Employee Onboarding·owning=Analytics Part 1) 상세 aside + 인스펙터 Map 탭 EN/KO 4종 캡처 확인.

## 2026-07-18 — 새 맵 만들기 모달 UX 3종: 오우닝 부서 정렬·선택 후 스크롤 다운·협업자 빈 안내 (worktree-create-map-picker-ux)
- **오우닝 부서 피커 정렬**: `PrincipalPicker`에 `myDeptsFirst` prop 추가 — browse(빈 검색) 시 내 소속 부서 체인(`me.orgPath` 기준 `isMyDept`)을 맨 위로, 작은 단위(깊은 org_path=세그먼트 많음)부터 정렬. 검색 랭킹엔 불개입. 오우닝 부서 피커에만 적용(승인자용 `managersFirst`와 배타).
- **선택 후 결재자로 스크롤 다운**: 오우닝 부서를 고르면 피커가 잠금 행으로 바뀌며 닫히고(기존 동작), `approversRef.scrollIntoView({block:"end"})`로 맨 아래 결재자 피커까지 스크롤 — 작은 뷰포트에서 아래 피커를 상단 피커로 착각하던 문제 해소.
- **협업자·결재자 빈 안내문구**: 두 목록이 비었을 때(`collaborators.length===0` / `approvers.length===0`) 박스 중앙에 회색 초대 문구 — `collaboratorsEmpty`("Search below to add editors or viewers.")·`approversEmpty`("Search below to add approvers."), 한글 "…추가해보세요" 병기. "아직 없다"식 부정 표현 대신 초대형. 피커가 `flex-col-reverse`로 목록 **아래**에 있어 "search below". 오우닝 부서 잠금 행과 무관.
- 게이트: lint 0 err·tsc 0. 실앱(admin.sys·백엔드 8901·프론트 3200) 모달 캡처로 EN/KO 빈 안내 2종 확인. 정렬 순서·선택 후 스크롤은 로컬 실행에서 확인 권장.

## 2026-07-18 — 노드 편집 모달 선행/후행 밴드 잘림 수정
- 버그: 노드 편집 모달의 선행/후행(이전/이후) 내비가 모달 높이에 따라 안 보이거나 잘림. 근본원인 = 내비가 스크롤 바디 안 flex 자식인데 `shrink-0` 없음 + 내부 칩이 `overflow-y-auto`라 min-height가 0으로 붕괴 → 콘텐츠 넘치면 flex-shrink가 밴드를 테두리(4px)까지 뭉갬. 격리 재현으로 확정(nav 높이 4px).
- 수정: 내비 블록을 스크롤 바디 밖 `shrink-0` 고정 밴드(푸터 위)로 분리 — 스크롤 위치·모달 높이와 무관하게 항상 노출. 칩 자체 `max-h-[104px]`+내부 스크롤 유지. `node-summary-modal.tsx` 1파일.
- 검증: 실앱(admin 로그인·코멘트 6건 주입해 오버플로 강제)에서 바디 끝까지 스크롤해도 밴드 `fullyInViewport` 유지·칩 35px(붕괴 없음), 읽기전용 모달 포함. 게이트: lint 0 err·build OK.

## 2026-07-18 — 읽기전용 노드 더블클릭 모달 복구 (worktree-inline-expand-drag-fix)
- 부수 발견 수정: 읽기전용에서 노드 더블클릭이 모달을 안 열던 원인 = `nodesDraggable=false`라 노드에 `nopan` 클래스가 없어 **d3-zoom 더블클릭 줌 필터를 통과 → d3가 `stopImmediatePropagation`으로 이벤트를 소비** → React 합성 `onNodeDoubleClick` 미발화(편집 모드는 nopan이 차단해 정상). 계측으로 확정: DOM dblclick은 노드 도달, 합성만 실종.
- 수정: `zoomOnDoubleClick={!readOnly}` 1줄 — 읽기전용에서 더블클릭 줌을 꺼 이벤트가 React까지 버블. 편집 모드 동작 무변경.
- pw: 읽기전용(taeyang.oh) dblclick → 모달+합성 설명 표시·textarea 없음 ✓, 편집(admin.sys) dblclick → 모달+편집 폼 ✓. 게이트: vitest 475/475·lint 0 err·tsc 0·build OK.

## 2026-07-18 — 읽기전용 모달에 설명 표시 (worktree-inline-expand-drag-fix)
- 후속②: 읽기전용 모달(축약형)이 타입/그룹만 보여주고 설명을 누락하던 것 → 설명 블록 추가(있을 때만, 인스펙터와 동일 스타일). subprocess는 `mergeSubprocessDescription`(링크맵 베이스+추가분) 합성 표시.
- pw 검증(taeyang.oh로 읽기전용 재현): 우클릭→정보 수정 경로에서 합성 3줄 표시 ✓, 편집 textarea 없음 ✓. **부수 발견(기존 동작, 미수정)**: 읽기전용에선 노드 더블클릭이 모달을 애초에 안 연다(200ms에도 미오픈) — 읽기전용 모달 진입은 우클릭 정보 수정/E키만. 게이트: vitest 475/475·lint 0 err·tsc 0·build OK.

## 2026-07-18 — UX 통일 후속 2건: Excel 설명 합성 + 아웃라인 자식 이름편집 차단·토스트 (worktree-inline-expand-drag-fix)
- **Excel(1안)만 설명 합성 반영**: `buildExcelModel` 행 생성에서 subprocess면 `mergeSubprocessDescription(subprocess_refs[sp_description], node.description)` — 그래프에 이미 있는 `subprocess_refs` 재사용, TDD 1건(RED→GREEN). WBS(2안)는 SP가 행을 안 차지해 무변경, Word/CSV는 사용자 지시로 제외(CSV는 왕복 계약상 추가분만이 맞음).
- **아웃라인 자식 행 이름편집 차단+토스트**: 행 더블클릭·Enter(편집 단축키) 모두 `item.hierarchy`(하위 스코프 행) 게이트 — 편집 input 대신 토스트("링크맵의 읽기전용 노드입니다 — 해당 맵에서 편집하세요", en 병기). 종전엔 편집 UI가 뜨고 저장이 조용히 증발했음. 루트 행 편집은 회귀 없음(pw 확인).
- 게이트: vitest 475/475(신규 1)·lint 0 err·tsc 0·build OK. pw: 자식 행 dblclick → input null+토스트 표시, 루트 행 정상 편집.

## 2026-07-18 — 서브프로세스 UX 통일 6종: 딥뷰 봉인·자식 상호작용 통일·읽기전용 메뉴·펼치기 메뉴·모달 피커 패리티·설명 상속 (worktree-inline-expand-drag-fix)
- 조사(라이브 계측)로 확인된 불일치/고장 일괄 정리. 사용자 지시: ①봉인 ②선택효과 통일 ③읽기전용 안내 ④메뉴 펼치기 ⑤모달 패리티 + 설명 상속.
- **자식 더블클릭 봉인(깊이 무관)**: 임베드 자식 dblclick 캡처 핸들러가 하던 딥뷰 드릴인(`drillIntoSubprocess`) 제거 — 인라인 펼침과의 이중 렌더(React 중복 key)·오프스크린 스코프 창·빈 캔버스 고장의 유일 진입로였음. 이벤트는 계속 삼켜 RF 줌/모달도 차단. `isDrillableHost`/`drillIntoSubprocess` 삭제(스코프 창 머신은 존치).
- **자식 클릭 선택효과 통일**: 캔버스 클릭이 `selectedId`도 동기화(아웃라인 행 하이라이트 일치), 아웃라인 다른-스코프 선택이 RF `selected`(테두리+불투명)도 동기화(펼침 반영 다음 틱 setTimeout 안에서 childNodes 싱크). 같은-스코프 아웃라인 선택은 자식 선택 해제 대칭 추가.
- **자식 우클릭 = "(읽기전용)" 1항목 안내 메뉴**: ContextMenu에 `note` 변형(회색·기울임·비인터랙티브) 신설, 노드 메뉴 빌더가 현재 스코프 밖 대상이면 안내 1개만 반환 — 캔버스(종전 차단)·아웃라인(종전 풀 편집 메뉴 오노출) 공통 경로로 통일.
- **서브프로세스 우클릭 메뉴에 하위 프로세스 펼치기/접기**: 액션 바 `expandable`과 동일 조건. nodes state엔 subEnds가 없어(displayNodes 파생 주입) `injectSubEnds`를 거쳐 판정해야 함(1차 시도 실패 원인). 구 `hasChildren` "열기" 항목은 레거시 데이터용으로 존치.
- **모달 연결 버전 패리티**: `SubprocessVersionPicker`(최신 추종 토글·버전 고정·업데이트)를 편집 모달에 슬롯(`versionPickerSlot`)으로 주입 — 인스펙터와 동일 컴포넌트·즉시 반영. IIFE 내 인라인 클로저가 react-hooks/refs 오탐 → 톱레벨 `handleSummaryUpdateSubprocess`로 호이스트.
- **설명 상속(베이스+추가분)**: 노드 description엔 이 맵의 추가분만 저장, 표시는 링크맵 `sp_description`(SubprocessRef로 이미 클라이언트 도달) + 줄바꿈 + 추가분 합성(`lib/subprocess-description.ts`, vitest 5). 모달은 베이스 읽기전용 블록 + 추가분 textarea(플레이스홀더 안내), 인스펙터는 합성 표시. 등록(지정) 시 설명 입력은 기존 기능 그대로.
- **게이트**: vitest 474/474·lint 0 err·tsc 0·build OK. 라이브 pw 6검증(메뉴 펼치기/접기 라벨 전환·캔버스↔아웃라인 선택 상호 동기화·봉인(중첩 서브 dblclick에도 스코프 붕괴/중복 key 0)·읽기전용 메뉴 양표면·모달 토글 API 영속·추가분 분리 저장+합성 표시) 전부 그린.
- **후속(미처리)**: Excel/Word/CSV 내보내기는 subprocess 설명에 추가분만 실림(합성 미반영) · 읽기전용 모달 변형은 설명 자체 미표시(기존) · 아웃라인 자식 행 더블클릭 이름편집 UI는 여전히 뜨고 조용히 무시됨(우클릭만 정리됨).

## 2026-07-17 — 인라인 펼침 드래그 버그 3종 해소: 팬텀 링 카메라 점프(#2)·Shift 축고정(#3a)·Ctrl복제 드리프트(#3b) (worktree-inline-expand-drag-fix)
- 핸드오프 `docs/superpowers/specs/2026-07-17-inline-expand-drag-bugs-NEXT-SESSION.md`의 ②③ 해소. dev 기준 브랜치.
- **#2 "프리즈" 근본 원인 반전**: 가설(no-op 커밋)은 라이브 계측으로 **반증** — 제자리 커밋은 무해. 진범은 `screenRectOf`가 `nodesRef`(저장좌표)로 링 rect를 계산 → 펼침 중 footprint-shifted 노드 드래그 시 dwell 링이 실제 노드보다 footprint(예: 868px)만큼 왼쪽(화면 밖)에 잡히고, `ensureRingVisible`이 팬텀 링을 향해 카메라를 200ms 애니메이션 팬(드롭 후에도 지속, d3 줌 플라이트) → 노드가 화면 밖으로 밀려 이전 좌표 클릭이 전부 빗나감 = "하드 프리즈"로 관측. 수정: `reactFlow.getNode`(표시좌표) 사용 + 현재 스코프 멤버십 가드 유지(읽기전용 임베드 자식은 기존대로 링 제외).
- **표시↔저장 환산 헬퍼 추출**: `lib/inline-shift.ts` `displayToSavedX`/`offsetAtSavedX` — finalize의 고정점 반복 루프(도달 불가 갭 표시값에서 진동 발산)를 구간 직해+앵커 클램프로 대체. vitest 7건(경계·왕복·갭 클램프·다중 앵커).
- **#3a**: 펼침 추적 경로는 position 변경이 suppress로 버려져 `dropDraggingPositions`의 축 고정을 안 탐 → `handleNodeDrag` 라이브 기록 시점에 `constrainToAxis` 직접 적용(다중선택 `onSelectionDrag` 경로와 대칭).
- **#3b**: `applyCtrlDragCopy` 원위치 복귀가 `ghost.position`(RF 보고값=표시좌표)을 저장좌표로 박던 것 → `rootOffsets`로 표시→저장 환산한 `resetPos`를 updater 밖에서 선계산(StrictMode 순수성 유지). 미펼침은 오프셋 없음=기존 동작.
- **게이트**: 프론트 단독(백엔드 0줄). vitest 469/469(신규 7 포함)·lint 0 err·tsc 0·build OK. 라이브 Playwright(시드 맵2 v12 펼침 상태): 드롭 후 노드 화면 내 유지+재드래그 ALIVE, Shift 드래그 y 고정(RF raw y=224에도 커밋 y=200), Ctrl복제 원본 API 저장좌표 무오염(540,264)+사본 정확 환산(1672→804), 평면 맵 회귀 없음.
- 백로그 잔여 해소: `applyCtrlDragCopy`(Ctrl+드래그 노드 복제)가 내부 엣지를 복제할 때 `sourceHandle`/`targetHandle`을 매번 `right`/`left`로 하드코딩 → 디시전 분기 엣지가 한쪽으로 뭉치던 문제(Ctrl+C/V paste는 앞선 백로그에서 해소됨, Ctrl+드래그판만 잔존). `edge.sourceHandle ?? sourceHandleId("right")`/`edge.targetHandle ?? targetHandleId("left")`로 원본 핸들 보존·없을 때만 폴백(handlePaste와 동일 관례). 2줄.
- 게이트: lint 0·tsc 0·vitest 462/462. 프론트 단독(백엔드 무변경). 리뷰된 동일 패턴 재사용이라 라이브 pw 생략.

## 2026-07-17 — 에디터 백로그 픽스 2건: 붙여넣기 엣지 핸들측 보존 + add-node 즉시 선택 (worktree-editor-backlog)
- `worktree-editor-improvements`가 남긴 후속 미해결 ①·④ 해소. **FIX1**: `handleCopy`가 `sourceHandle`/`targetHandle`을 클립보드 엣지에 캡처 안 하고 `handlePaste`가 매 엣지에 `right`/`left`를 하드코딩 — 디시전 Yes/No 분기 엣지가 붙여넣기 후 한쪽으로 뭉치던 버그. `lib/node-clipboard.ts`(`ClipboardEdge`+`buildPaste`)와 `handleCopy`/`handlePaste`(page.tsx)에서 핸들을 캡처·전달하고, 없을 때만 기존 기본값(`right`/`left`)로 폴백. Ctrl드래그 사본(`beginCtrlDrag`)의 동일 하드코딩은 스코프 밖이라 유지.
- **FIX4**: `handleAddNode`가 새 노드를 `selected:true` 없이 추가(별도 `setSelectedId`만 호출) — `handleCopy`는 RF `node.selected` 필터라 방금 추가한 노드는 재클릭 전까지 Ctrl+C가 안 먹힘. `handlePaste`와 동일 패턴(기존 선택 해제+새 노드 `selected:true`)으로 통일.
- TDD: `node-clipboard.test.ts`에 `buildPaste` 핸들 보존/미지정 폴백 테스트 2건(RED 확인 후 GREEN). 게이트: lint 0·tsc 0·vitest 462 전부 그린.
- 실기동: 좀비 백엔드(삭제된 `editor-improvements` 워크트리의 고아 uvicorn, 8000 500) kill 후 이 워크트리 자체 백엔드로 재기동. `pw-verify-node-copy.mjs`에 시나리오 (e) 추가(＋메뉴로 노드 추가 직후 재클릭 없이 Ctrl+C→Ctrl+V → 정확히 1개 복제) — 전체 17/17 PASS, 콘솔 에러 0.
- **②·③ 보류(다음 세션)**: ②노드 프리즈는 라이브 계측 결과 "서브프로세스 인라인 펼침 상태 + footprint-shifted 노드" 한정 기존 버그(`2a78b6b`, `finalizeRootDrag` no-op 커밋), ③도 같은 펼침 좌표 머신 → 근본 원인·재현·수정 방향을 `docs/superpowers/specs/2026-07-17-inline-expand-drag-bugs-NEXT-SESSION.md`에 기록(커밋 `c36c400`). 후속 잔여: Ctrl드래그 사본 엣지 핸들 하드코딩(FIX1의 Ctrl드래그판, 스코프 밖).

## 2026-07-17 — 메인 탭 UX 개선 구현 완료 (worktree-main-tabs-ux)
- dev `0b72270` 기준 신규 브랜치. 설계 `docs/superpowers/specs/2026-07-17-main-tabs-ux-design.md`, 구현 계획 `docs/superpowers/plans/2026-07-17-main-tabs-ux.md`(16 TDD 태스크).
- **구현 완료(Task 1–15)** — subagent-driven(태스크별 구현+2단계 리뷰). 전부 클라이언트, **백엔드 무변경**(git diff 확인). 커밋 `b746c7b`…`28f9077`(구현+리뷰 픽스 포함). 최종 게이트: **tsc 0 · vitest 471/471(신규 org-tree/donut-geometry/recent-order 포함) · lint 0 errors(무관 사전 warning 1) · build 성공(전 라우트)**. Task 10 대시보드는 라이브 Playwright 10/10(auto-expand 포함) 검증.
  - 리뷰 픽스 5건: T1 테스트 픽스처 타입(tsc), T4 좁은화면 인라인 상세 renderCard, T5 도넛 `-0` offset, T7 recent-top peek/commit 분리(StrictMode), T10 auto-expand deps 축소(refresh clobber).
  - ⚠️ **미검증(배포 전 권장)**: Inbox/Notices 다이제스트·Feedback 딥링크·조직도 아코디언은 서버/원격 IP 실기동 브라우저 확인 미완(로컬 게이트만 통과).
- 스코프 5항목(전부 클라·백엔드 무변경): ①Maps 좌측 = 나의부서 즐겨찾기 + 오우닝부서 조직도 아코디언(모두접기, 카드 디자인 유지+`[SP]` 배지, 목록/상세 양쪽) ②Maps 우측 홈 대시보드 = 최근열람(최상단·스태거 진입) + 내오너 문서 상태 도넛(세그먼트 클릭→목록, 기본 draft) + 승인필요 단계 그래프(status 파생); 대시보드 맵행 hover→Open·클릭→선택(좌측 자동펼침 포커스) ③Feedback 작성하단 최근피드백 카드+`?feedback=<id>` 딥링크 ④Inbox 미선택 우측 활동요약 다이제스트 ⑤Notices 동일 다이제스트.
- 사용자 요청 "알림 카테고리 아이콘+필터"는 dev(`lib/notification-categories.ts`+inbox)에 이미 구현되어 스코프 제외.
- **Task 1-4 구현**: `lib/org-tree.ts`(순수 헬퍼 `buildOrgTree`/`filterMyDeptMaps`) + `OrgAccordion`/`MyDeptFavorites` 컴포넌트(Task 1-3) → `page.tsx` 좌측 브라우즈 컬럼에 배선(Task 4). 브라우즈 모드는 이제 "나의 부서 즐겨찾기(핀)" + 오우닝부서 조직도 아코디언(모두접기, 롤업 카운트)만 렌더 — 기존 최근열람 밴드는 좌측에서 제거(우측 대시보드로 이동 예정, Task 7). 검색·필터 모드(평면 리스트+최근매치 상단고정)는 무변경. 내 정보(`getMe`)·디렉터리(`getDirectory`)로 초기 펼침을 내 `org_path` 조상 경로로 시드. tsc/lint/build 전부 그린.
  - `useDirectory()`(`lib/directory.ts`)는 유저 Map만 노출(부서 미포함, 다른 4곳이 그 계약에 의존)이라 브리프 가정과 달라 `getDirectory()`를 page.tsx에서 직접 fetch — 공유 훅은 무변경.
- **Task 11 구현**: `feedback/page.tsx`에 딥링크 `?feedback=<id>` — 목록 로드 후 해당 id가 있으면 상세 모달 1회 오픈(`useRef` 가드), 모달 close 시 param 제거. `useSearchParams` 대신 `window.location.search` 직접 파싱으로 Next.js Suspense 경계 요구를 회피(빌드 시 `/feedback`이 정적 페이지로 유지됨 확인). tsc/lint/build 전부 그린.
- **Task 12 구현**: `feedback-side-panel.tsx` 작성폼 아래 "내 최근 피드백" 섹션 — 패널 `open` 시 `listFeedback()` 페치 후 `author === getCurrentUser()?.loginId`(정확한 필드명은 `current-user.ts` 확인) 필터·`created_at` desc 상위 5개. 카드 클릭 → `/feedback?feedback=<id>`(Task 11 딥링크) 이동 + `onClose()`. kind/status 필은 `feedback-meta.ts` 기존 토큰(`FEEDBACK_KIND_STYLE`·`FEEDBACK_STATUS_STYLE`) 재사용, 이모지 미사용. i18n 키 2종(`feedback.yourRecent`, `feedback.viewOnPage`) en+ko 추가. tsc/lint/build 전부 그린.
- **Task 7 구현**: `lib/recent-order.ts`(TDD, `readTopChanged` — sessionStorage `bpm.home.recentTop`로 최상단 id 변화 감지) + `RecentOpenedList`(최근열람 렌더, top 변경 시 `slideDown` 스태거 진입 — `motion-safe:` 가드, 45ms 딜레이). `globals.css`에 `@keyframes slideDown` 신설(기존 미존재 확인). vitest 4/4·tsc·lint 그린(무관 사전 warning 1건 제외).

## 2026-07-17 — 편집 모드 개선 5종 구현 완료 (worktree-editor-improvements)
- 계획 `docs/superpowers/plans/2026-07-17-editor-improvements.md`의 13 TDD 태스크 전부 구현 + 서브에이전트 리뷰 통과. 브랜치 커밋 `c064f89`…`467b82d`(18 코드 커밋). dev 기준, **미머지·미푸시**.
- **(1) 노드 복사/붙여넣기/Ctrl드래그**: Ctrl+C/V + Ctrl드래그 복제. 복사 대상 process·decision·end(start·subprocess 제외·토스트). `localStorage` 클립보드로 크로스탭/크로스맵. 다중+내부엣지. `makeCopyLabel`(`(n)` 증분). 붙여넣기 누적 오프셋+findFreeSpot(반복 Ctrl+V 겹침 방지). Ctrl드래그=원본 잔상+`+`배지, 사본 드롭. Ctrl+C는 노드 미선택 시 네이티브 복사 통과. 순수 헬퍼 `lib/drag-constrain`·`node-clipboard`·`canvas`(vitest).
- **(2) 서브프로세스 링크 유일성**: FE picker 이미 링크된 맵 자동 비활성+툴팁·`addLinkNodeFromMap` 차단. 백엔드 graph PUT 422 가드 — **기존 중복링크는 grandfather**(증가분만 차단: `count>1 and count>stored_counts[mid]`)해 운영 맵 브릭 방지.
- **(3) SP 설명 + 등록 알림**: `ProcessMap.sp_description` 신설(`_ADDED_COLUMNS` 등록=자동 ALTER)·스키마 3읽기경로·FE 3표면(모달/카드/패널)·`get_subprocess_refs` 채움. 최초 지정 시 오너+활성승인자 알림(`subprocess_registered`, actor 제외, 영문 메시지)·inbox `subprocess` 카테고리.
- **(4) Shift 축 고정**: `constrainToAxis`로 단일·다중선택(overlay 포함)·그룹 이동 축 고정. selectionKeyCode=null.
- **(5) SP 목록 접근+검색**: pane 우클릭 메뉴 하단 항목 + 전역 `S` 단축키(입력/모달/menu 가드)·검색 자동포커스·공용 `filterByQuery`(이름+부서 초성/로마자/순차).
- **게이트(최종 467b82d)**: 백엔드 pytest **635 pass**·ruff clean. 프론트 lint 0·tsc 0·vitest **429 pass**·build OK. Playwright 실검증(실서버 기동) 실행: node-copy 14/14·ctrl-drag 31/31·library-search 7/7·library-open 8/8·link-unique 13/13, 콘솔 에러 0.
- **후속(미해결)**: ①붙여넣기 엣지 핸들측 소실(분기 엣지 시각 뭉침, 위상/라벨은 보존) ②연속 평범 드래그 시 노드 프리즈(**기존 버그**, 이 브랜치 무관) ③인라인 펼침 상태에서 단일 Shift축고정 비활성·Ctrl드래그 사본 좌표 드리프트 가능(좁은 케이스) ④add-node 후 즉시 Ctrl+C 미복사(selectedId≠node.selected).

## 2026-07-17 — 편집 모드 개선 5종 설계 스펙 (worktree-editor-improvements)
- dev 기준 신규 브랜치·워크트리. 설계 `docs/superpowers/specs/2026-07-17-editor-improvements-design.md`(구현 대기).
- 범위: (1) 노드 복사/붙여넣기/Ctrl드래그(process·decision·end 한정, start·subprocess 제외·토스트, localStorage 클립보드로 크로스탭/크로스맵, `(n)` 증분, 다중+내부엣지) (2) 서브프로세스 링크 유일성(FE picker 자동 비활성 + 백엔드 422 가드) (3) SP 설명 필드 `sp_description`(백엔드/DB 자동ALTER) + 최초 지정 시 오너·승인자 알림 (4) Shift 드래그 축 고정(단일·다중·그룹) (5) SP 목록 우클릭 메뉴·`S` 단축키·자동포커스·`filterByQuery` 초성검색.
- 조사: 노드 모델/드래그·서브프로세스 지정·알림·SP패널/검색 4개 read-only 탐색 완료. 결정: subprocess 복사 제외(기능2 충돌 회피), 다중+엣지 복사, 붙여넣기 오프셋, 백엔드 가드 추가, DB 변경 승인, Ctrl드래그 잔상+`+`배지.
- 구현 계획 `docs/superpowers/plans/2026-07-17-editor-improvements.md`(TDD 13태스크, 순서 4→1→5→2→3). 순수 헬퍼는 vitest·백엔드는 pytest·page.tsx 배선은 Playwright 검증.

## 2026-07-17 — Excel 출력 양식 2안(WBS) + 형식 선택 모달 (worktree-excel-export)
- 미리보기 행 스태거 등장 애니메이션 — 기존 `item-fade-in` 키프레임 재사용(`globals.css` `.preview-row-in`, 350ms ease-smooth both + 행별 45ms 딜레이, reduced-motion 가드), 양 형식 테이블 공통. 실측: computed style로 클래스·딜레이 확인 + pw 19/19 회귀 그린.
- 설계 `docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md`. 신규 `lib/excel-wbs.ts` — 잎 업무 행+레벨 경로(`levels`), SP 무행(레벨 값=SP 노드 타이틀·루트=맵 이름), start/end 전부 삭제(Next 종착 텍스트 유지), 무라벨 디시전 flow-through·`[No:라벨]` 주석(SP 대상 소멸)은 1안과 동일 체계. 시트 "WBS": 동적 Level 1..N 컬럼(회색 `FF9CA3AF`)+1안 속성 꼬리(numFmt 정의 파생).
- Excel 버튼 → 형식 선택 모달(`components/excel-export-modal.tsx`): 한/영 세그먼트 토글 디자인 탭(Process Map/WBS)+첫 8행 미리보기(lazy 빌드·캐시)+Download. 파일명 WBS는 `_WBS` 접미. 다운로드는 `downloadWorkbookXlsx` 공용화(exceljs 동적 import 유지).
- 게이트: vitest 전체·tsc·lint·build 그린.
- 실기동 검증 pw-verify-excel-wbs.mjs 시나리오 12종·assertion 19/19 PASS(모달 플로우·양 형식 다운로드 파싱 — WBS 레벨 컬럼·SP 무행·start/end 0행·주석·1안 회귀·콘솔 0).

## 2026-07-17 — Excel 출력 양식 2안(WBS) 설계 확정 (worktree-excel-export)
- 레벨 컬럼 WBS 시트+형식 선택 모달(토글 탭·미리보기) 설계 — 사용자 확정 4건(모든 행 반복+회색 톤다운·start/end 전부 삭제·SP Next 이름 유지·모달 토글탭). 설계 docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md, 계획 docs/superpowers/plans/2026-07-17-excel-export-wbs-v2.md.

## 2026-07-17 — Excel 출력 양식 개선 1안 구현 (worktree-excel-export)
- 설계 `docs/superpowers/specs/2026-07-17-excel-export-format-v1-design.md` 4규칙 구현: ①무라벨 병렬 디시전 행 제거+Next flow-through(라벨은 최종 대상까지 전파) ②첫 start 외 start 행 제거 ③기본 제목("end", trim·대소문자 무시) end 행 제거(Next의 End 표기는 유지) ④라벨 분기 대상 Name에 `[디시전No:라벨]` 주석(행 객체 참조로 역방향·다이아몬드 안전). No는 모델에서 확정(`ExcelNodeRow.no`).
- CSV 내보내기는 왕복 계약이라 미적용. 게이트: vitest 전체·tsc·lint·build 그린.
- 실기동 검증 pw-verify-excel-format-v1.mjs 10/10 PASS(스크래치 맵 픽스처 → xlsx 파싱 — 행 제거·flow-through·주석·No 연속·콘솔 0).
- 최종 리뷰 백로그 해소: ①재수렴 시 Next·주석 중복 제거(같은 (대상,라벨) 쌍 1회 — 사용자 확정 정책) ②행 상한 도달 시 `return`→`break`로 이미 출력된 행의 주석 보존 ③혼합 디시전 무라벨 분기→삭제 디시전 flow-through 회귀 테스트 추가, pw 규칙2 체크를 Type 컬럼 기반으로 강화(미도달 start 픽스처는 PUT /graph의 start=1 검증 때문에 불가 — 모델 vitest가 판별 담당). 게이트 vitest 433·tsc·lint·build 그린, pw 재실행 10/10. 잔여: Windows 실물 Excel 눈검증 1회(배포 전 수동).

## 2026-07-17 — Excel 출력 양식 개선 1안 설계 확정 (worktree-excel-export)
- 엑셀 산출물 2종 분리 작업의 1단계 설계 — 구조 노드 행 정리(무라벨 디시전·첫 start 외·기본 제목 end)+분기 주석(`Name [디시전No:라벨]`)·Next flow-through 규칙 확정. 설계 `docs/superpowers/specs/2026-07-17-excel-export-format-v1-design.md`. CSV는 왕복 계약이라 미적용. Groups 반영 검토 — 정상(무명 그룹만 제외됨).

## 2026-07-16 — 매뉴얼 버튼 일관화 + /manual 외부 매뉴얼 드롭다운 (worktree-manual-buttons)
- 분산 유지 구조에서 표기 통일: 에디터 툴바 매뉴얼(D2)을 네이티브 title→스타일드 `<Tooltip>`으로 통일, 외부 새 탭 버튼(D2 툴바·D3 CSV 액션)에 `ExternalLink` 큐 추가(내부 /manual 라우팅과 구분 — 에디터 우상단 BookOpen 2개 혼동 해소).
- `/manual` 뷰어에 "한눈에 보기"(At a glance) 드롭다운 신규 — `getMe()`의 `manual_url`(편집사이트)·`csv_manual_url`(CSV안내)을 앵커로. 둘 다 미설정이면 트리거 숨김. i18n 키 `manual.externalMenu`·`manual.editSite` 추가.
- 설계 `docs/superpowers/specs/2026-07-16-manual-buttons-rearrange-design.md`. 게이트: lint/tsc/build 그린 · 브라우저 실검증 `pw-verify-manual-dropdown.mjs` 8/8 통과(API 모킹, 콘솔 에러 0 — 트리거 노출/드롭다운 2항목/external 큐/window.open 대상 URL, 둘 다 미설정 시 트리거 숨김). 백엔드 무변경.

## 2026-07-16 — CSV 매뉴얼 버튼 배포 파이프라인 개통 + compose 누락 방지 룰 (worktree-manual-buttons)
- CSV 임포트 안내 버튼(`csv-manual-link`, 홈 CSV 생성 모달·에디터 임포트 모달)이 프로덕션에서 절대 안 뜨던 문제 — `settings.csv_manual_url`(env `CSV_MANUAL_URL`)이 `.env.example`·`settings.py`·`schemas.py`·`main.py`엔 있었으나 **`docker-compose.yml` backend `environment:`에만 누락**. backend 서비스엔 `env_file:`가 없어 `.env` 값이 컨테이너에 도달 못 함 → `/me`가 빈 값 반환 → 버튼 영구 숨김(로컬 네이티브에선 정상이라 미발견). `MANUAL_URL`(편집 매뉴얼, 툴바 F9)은 이미 전달됨.
- `docker-compose.yml`에 `CSV_MANUAL_URL: ${CSV_MANUAL_URL:-}` 추가(파이프라인 개통).
- 재발 방지: `rules/backend/config.md`에 "새 Environment 카테고리 Settings 필드는 backend `environment:` 블록에도 반드시 매핑" 룰 명문화(no `env_file:` 근본 원인·`CSV_MANUAL_URL` 선례 기록). CLAUDE.md `@import` 대상이라 다음 세션 자동 로드.

## 2026-07-18 — 로그인 실패 시 막다른 빨간 화면 제거 + 세션 유효 시 무클릭 자동 복구 (main)
- 증상: 일부 유저가 Keycloak 로그인 직후 홈("/")에 빨간 "Auth error: …" 한 줄만 뜨는 막다른 화면에 갇히거나, 로그인 카드에 도달하지 못함. 근본 원인: `AuthGate`(`frontend/src/components/providers.tsx`)의 미인증→`/login` 리다이렉트 effect가 `!auth.error`로 가드돼 에러 시 동작 안 함 + 유일한 복구 effect가 `login_required`만 처리 → 그 외 에러(oidc `No matching state`·토큰 교환 실패·`consent_required`·시계 오차 등)는 복구 경로 없는 데드엔드 렌더로 낙하.
- 수정: 데드엔드 빨간 렌더 삭제(→ 에러는 not-authenticated로 로딩 화면 후 `/login` 복귀). 에러를 종류별 분기 — `login_required`(세션 없음, 정상)는 곧바로 카드+silent 억제, 그 외는 **세션이 살아있을 수 있으니 silent 자동 재시도 1회**(무클릭 로그인) 후 소진 시에만 카드로 폴백. 재시도 상한 1로 지속성 에러(시계 오차·스토리지 차단) 무한 리다이렉트 루프 방지.
- 파일: `providers.tsx`(effect 분기·데드엔드 제거·미사용 `useI18n`/`t` 정리), `lib/auth-return.ts`(`tryConsumeAuthRetry`/`clearAuthRetry`, 상한 1), `lib/auth-return.test.ts`(카운터 2건). i18n 키 `auth.error`는 미사용이나 데이터라 존치.
- 게이트: vitest 416 pass(신규 2)·lint clean(기존 무관 경고 1)·build(tsc+React Compiler) OK. **미검증**: 실제 Keycloak 에러 경로는 로컬 재현 불가(`AUTH_ENABLED=false`) — 서버 배포 후 수동 확인 필요(세션 유효 무클릭 로그인·콜백 새로고침 복구·세션 없음 카드 표시).

## 2026-07-16 — 새 맵 생성 시 Start·End 자동 시드 (worktree-workflow-improvements)
- 빈 새 맵이 캔버스가 비어 있던 문제 — `create_map`(`backend/app/routers/maps.py`)이 초기 버전에 Start·End 노드 2개를 자동 삽입(엣지 없음, 고정 LR 좌표, id=uuid hex). CSV 임포트 생성과 동일한 UX. 설계 `docs/superpowers/specs/2026-07-16-new-map-start-end-seed-design.md`.
- 범위: 새 맵의 초기 버전만(빈 새 버전·복사는 대상 아님). CSV 생성 경로 무영향(`PUT /graph` 전체 교체로 시드가 CSV 노드로 대체 — 중복 없음). `validate_process` 통과(start 1·대표 end 1·제목 유니크).
- 테스트: `test_maps.py`(생성 후 graph에 start/end 존재)·`test_graph.py`의 `test_new_version_has_empty_graph`→`test_new_map_version_seeds_start_end` 갱신. 게이트: pytest 609 pass·ruff clean. 브라우저 실검증 `pw-verify-new-map-seed.mjs` 5/5(에디터 Start·End 2노드 렌더, 엣지 0, 콘솔 에러 0).

## 2026-07-16 — 서브프로세스 워크플로 2건 개선 — 구현 완료 (worktree-workflow-improvements)
- 설계 `docs/superpowers/specs/2026-07-16-subprocess-workflow-improvements-design.md` + 계획 `docs/superpowers/plans/2026-07-16-subprocess-workflow-improvements.md`(TDD 3태스크). 구현 커밋: 백엔드 `f54f1dd`·프론트 생성경로 `432f8bf`·승인탭 카드 `cd25843`.
- **(1) `follow_latest`(최신본 추종) 생성 기본 ON — 모든 생성 경로 통일**: 라이브러리 드롭(`page.tsx:3701`)·AI 변환(`page.tsx:613`)·CSV 임포트 기본값(`csv-import.ts:186`)·`NodeIn` 스키마(`schemas.py`)·`Node` DB 컬럼 ORM 기본값(`models.py`) 5지점 `false→true`. `addLinkNodeFromMap`은 이미 ON. 읽기/직렬화 폴백 `?? false`는 유지(기존 노드 드리프트 방지, 마이그레이션 없음). 테스트: `test_graph.py`(생략 시 True 저장)·`csv-import.test.ts`(임포트 노드 follow_latest true).
- **(2) 게시본 승인 탭에 서브프로세스 지정 카드 노출**: 기존 `SubprocessInspectorCard`를 승인 탭(`approvalSlot`)의 `ApprovalPanel` 아래·버전 목록 위에 재사용(백엔드 무변경, `spCanManage`/`spDisabledReason` 게이팅 재사용).
- **게이트**: 백엔드 pytest 608 pass·ruff clean. 프론트 vitest 414 pass·tsc 0·lint 0 err(pre-existing 경고 1)·build OK. 브라우저 실검증 `pw-verify-approval-sp-card.mjs` 9/9 pass(게시본 카드 활성+지정 모달 진입, 미게시본 비활성+사유 노트, 콘솔 에러 0).

## 2026-07-16 — whole-branch 최종 리뷰 픽스: 퍼지 후 재조회 + 벨 인박스 내 이동
- **Finding 1(Critical) 픽스** — `table-viewer.tsx`: 퍼지 확정 시 `setPage(1)`이 이미 page=1이라 no-op되어 fetch effect가 재실행되지 않고 `isFetching`이 영구 true(무한 "Loading…")로 굳는 버그. `refreshTick` state 추가 + fetch effect deps에 포함 + `onPurged`에서 tick 증가로 강제 재트리거.
- **Finding 2(Important) 픽스** — `notification-bell.tsx` `handleOpen`: `/inbox` 체류 중 클릭 시 `router.push`가 같은 라우트라 리마운트 없어 딥링크 소비 무동작 → 현재 경로가 `/inbox`면 `window.location.assign`으로 하드 네비게이션 강제.
- **검증 보강** — `pw-verify-notifications.mjs` 시나리오 6에 회귀 가드 신설(check "6b"): 퍼지 후 테이블 재조회 GET 대기 + "Loading…" 스피너 미잔존·"No rows"/실제 행 렌더 확인.
- 게이트: tsc/lint/build 그린. E2E 클린 재시드 후 재실행 10/10 PASS(신설 6b 포함). 상세: `.superpowers/sdd/final-review-fixes.md`.

## 2026-07-16 — Task 12 완료: 전체 게이트 + Playwright 실검증 (알림 퍼지 브랜치 최종)
- **Task 12 리뷰 픽스** — pw 스크립트 단언 강화 3건: 콘솔 에러 총량 게이트 신설(check 8 `consoleErrors.length === 0` — validateDOMNesting 외 임의 런타임 에러도 FAIL, 실측 0건이라 allowlist 불요) · 퍼지 정확 감소 단언(확정 버튼 라벨에서 N 파싱 → `after === before - N`, 부분 삭제 버그 감지) · 시나리오 ① 알림 탭 활성 직접 단언(탭 세그먼트 스코프 `text-accent` + Approvals 비활성). 클린 DB 전체 재실행 9/9 PASS, 서버 종료·dev.db 재시드 정리 완료.
- **Task 12 완료** — 전체 게이트 그린: backend pytest 624 passed·ruff clean, frontend vitest 416 passed·tsc 0 errors·lint 0 errors(무관 사전 경고 1건)·next build 성공. `frontend/scripts/pw-verify-notifications.mjs` 신규(`pw-verify-dashboard.mjs` 하네스 재사용 — playwright-core+시스템 Chrome, devUser `admin.sys`) — 벨 딥링크/개별삭제, 알림탭 카테고리 필·선택삭제·읽음삭제·날짜이전삭제, 관리자 기간 퍼지(미리보기→확정→행수 감소) 6개 시나리오 + 콘솔 에러(validateDOMNesting) 수집, 클린 DB(reset_db+seed_org_demo)에서 8/8 PASS. 잔여 리스크: `worktree-workflow-improvements`(미머지, `inbox/page.tsx` 승인 탭 수정)와 향후 머지 시 충돌 가능성 — 상세: `.superpowers/sdd/task-12-report.md`.

## 2026-07-16 — Task 11 완료: 매뉴얼 알림 삭제·보존·퍼지 반영 + 감사 불일치 4건 교정
- **Task 11 완료** — `user-manual-general-{ko,en}.md` 알림·승인 절 재작성: 벨 5초 폴링·클릭 시 알림 탭 이동+자동읽음·항목별 삭제(X), 알림 탭은 페이지 진입 시 1회 로드(자동 갱신 없음), 카테고리 필터 5종(전체/버전/점유권/권한/공지)+선택모드 일괄삭제+읽은 알림 삭제+날짜지정 삭제(확인 모달, 복구불가), 1인당 최근 100건 보존, checkout·permission 벨 알림 반영 · 공지 읽음이 브라우저(기기)별 localStorage임을 명시. `admin-manual-{ko,en}.md` — 공지 삭제는 하드 삭제·휴지통 없음·복구불가(단 기 발송 벨 알림은 잔존)로 교정 + "알림 기간 삭제(퍼지)" 절 신설(§8, `notifications` 테이블 선택 시 기간 지정→preview 모달 기본 전체선택→체크 해제 확정→하드삭제) + 100건 보존 항목 추가. `backend/app/manual.md` 벨 서술 1문장 확장(클릭 이동·삭제·100건). `docs/alarm-audit.md` §8 불일치 4건(①인박스 갱신주기 ②보존정책 공백 ③공지 하드삭제 ④공지 읽음 기기별) 전부 교정 완료.

## 2026-07-16 — Task 10 완료: 관리자 퍼지 UI (테이블 뷰어 + 모달)
- **Task 10 재리뷰 픽스** — aliveRef effect setup에서 `aliveRef.current = true;` 복원 1줄(StrictMode dev의 mount→cleanup→re-mount에서 useRef(true) 초기값이 재설정되지 않아 영구 false → purge 실패 시 catch 즉시 return으로 에러 무표시+busy 데드락 방지). tsc/lint 그린.
- **Task 10 리뷰 픽스** — 퍼지 모달 3건(`notification-purge-modal.tsx`만): busy 중 닫힘 차단(백드롭 onClick `if (!busy)` 가드 + Cancel `disabled={busy}` — in-flight 중 닫혀 onPurged가 다른 테이블 상태를 오염시키는 경로 차단) · runPurge catch에 `aliveRef` 언마운트 가드(preview effect의 alive와 일관) · 로딩/에러 배타(preview 실패 시 스피너 숨김 — `groups === null` 분기 안에서 `!error &&`로 처리해 TS null-narrowing 유지, 리뷰 제안의 `groups === null && !error ?` 삼항 조건 변경은 else 분기 `groups.length` null 타입 에러라 조정) + runPurge 시작 시 `setError(null)`. tsc/lint/build 그린.
- **Task 10 완료** — `notification-purge-modal.tsx` 신규(preview `(type,message)` 묶음을 체크박스로 확정 후 하드 삭제, 기본 전체 선택, `bg-error`/`text-on-accent`는 `confirm-dialog.tsx` 등에서 이미 쓰이는 기존 theme 토큰이라 그대로 사용) · `table-viewer.tsx` 훅업 — 헤더 바 우측에 `selected === "notifications"`일 때만 기간 입력 2개+삭제 버튼(날짜 역전 시 disabled) 노출, 퍼지 완료 시 `setPage(1)`/`setLoadedPage(0)`/`setRows([])`+`listDbTables()` 재조회로 표·pill 카운트 동기화 · i18n 8키 EN·KO 양쪽. tsc 0 errors, lint 0 errors(무관 사전 경고 1건), next build 통과.

## 2026-07-16 — Task 9 완료: 알림 탭 딥링크·카테고리 필·선택/읽음/날짜 삭제
- **Task 9 완료** — `inbox/page.tsx`: 벨 딥링크(`?notification=<id>`) 마운트 effect fetch `.then` 안에서 소비(탭 전환·선택·읽음 처리·`router.replace("/inbox")`로 파라미터 소거) · 카테고리 필 필터(`getNotificationCategory` 체인, `useInfiniteSlice` resetKey에 `categoryFilter` 포함) · 선택모드(체크박스 토글, 카드 클릭이 selectMode에서 toggle로만 동작)+읽음 삭제+날짜 이전 삭제 툴바 · 개별 삭제 버튼(카드 시간 필 옆) · `ConfirmDialog`는 같은 파일 `ApprovalDetail` 승인/반려 모달 시그니처 그대로 재사용(danger+icon+message 1줄) · `typeIcon`에 `checkout_`/`permission_` prefix 매핑 추가 · i18n 14키 EN·KO 양쪽 추가. tsc 0 errors, lint 0 errors(무관 사전 경고 1건), vitest 416/416 passed.
- **Task 9 리뷰 픽스** — 알림 카드 외곽 `<button>`→`<div role="button" tabIndex={0}>`(내부 삭제 버튼과의 button-in-button `validateDOMNesting` 콘솔 에러 해소 — 클라이언트 마운트 시 renderer가 검사하므로 SSR 무관하게 실측 발생하던 문제, onKeyDown Enter/Space+`cursor-pointer` 부착, 승인 탭 카드는 내부 버튼 없어 미접촉) · 체크박스 input→Lucide `CheckSquare`/`Square` 시각 표현(토글은 카드 클릭 유지) · `performBulkDelete` 성공 후 `setBeforeDate("")` 리셋 · `deleteOne`이 selectedIds에서도 해당 id 제거. tsc/lint/vitest 재실행 전부 그린(416/416).
- **Task 9 재리뷰 픽스** — 카드 `onKeyDown`에 `e.target !== e.currentTarget` 가드 1줄(내부 삭제 버튼 포커스에서 Enter/Space 시 keydown 버블링으로 카드의 preventDefault가 버튼 활성화를 취소하고 열람이 대신 실행되는 "삭제 대신 열람" 회귀 방지). tsc/lint 그린.

## 2026-07-16 — Task 8 완료: 벨 드롭다운 삭제 버튼 + 클릭 네비게이션
- **Task 8 완료** — FE 벨 드롭다운: import 추가(lucide-react `X`, next/navigation `useRouter`, api `deleteNotification`) · 핸들러 2개(plain function, async catch 주석) · `handleDelete` — API 호출 후 UI 필터 제거 · `handleOpen` — 드롭다운 닫고 `/inbox?notification=${id}` 라우트 · `<li>` 교체 — `cursor-pointer` + `hover:bg-surface-alt` + onClick 핸들러 + 기존 mark-read 버튼 stopPropagation + 신규 delete 버튼(`X` icon 12px strokeWidth 1.5, text-error hover) · i18n 2개 키 추가(EN `"notif.delete": "Delete"` 615행, KO `"notif.delete": "삭제"` 1986행) · tsc 0 errors, npm run lint 0 errors (unrelated test warning). `git diff --stat`: notification-bell.tsx 39줄 추가/4줄 제거, i18n-messages.ts 2줄 추가.

## 2026-07-16 — Task 7 완료: FE API 클라이언트 + 카테고리 lib
- **Task 7 완료** — FE notification delete/purge API 클라이언트 + 카테고리 매핑: `notification-categories.ts` 신설(type → category 매핑 함수 `getNotificationCategory`, 상수 `NOTIFICATION_CATEGORIES` 4종: version/checkout/permission/notice) · `api.ts` 신규 5함수·3인터페이스 추가(`deleteNotification`·`bulkDeleteNotifications`/`NotificationBulkDelete`/`NotificationBulkDeleteResult`·`previewNotificationPurge`·`purgeNotifications`/`NotificationPurgeGroup` — 백엔드 T5/T6 머지됨 계약 구현) · 신규 테스트 3건(TDD RED→GREEN) · vitest 3/3 passed, tsc 0 errors. 회귀 무변화(기존 모듈만 신규 export 추가).
- **Task 7 리뷰 픽스** — `previewNotificationPurge` 쿼리스트링 `encodeURIComponent` 부착(getDashboardTimeseries 관례 일치) · `NotificationBulkDelete.read_only`를 `boolean`→`true`로 협소화(백엔드가 false를 422로 거부 — 컴파일 타임 차단). vitest 3/3 passed, tsc 0 errors.

## 2026-07-16 — 알림 통합·삭제(퍼지)·100개 한도 구현 계획 (worktree-alarm-audit)
- 산출물: `docs/superpowers/plans/2026-07-16-notification-purge.md` — 12태스크 TDD 체크리스트(백엔드 6·프론트 4·매뉴얼 1·게이트/pw 1). 실제 코드·테스트 코드 포함, 수정 지점 file:line 명시.
- 주요 결정: `create_notifications` async화(호출 7지점 await), permission 알림은 공용 헬퍼 `_notify_permission_request`로 3지점 공유, purge 응답은 `NotificationBulkDeleteOut` 재사용, 딥링크는 useSearchParams 대신 window.location 파싱(Suspense 회피).
- **Task 1 완료** — 인덱스 2종 + `_ADDED_INDEXES` 부트스트랩: `models.py` Notification `__table_args__` 추가 · `db.py` `_ADDED_INDEXES` + `_add_missing_indexes` 함수 + init_models 호출 · 테스트 3/3 passed.
- **Task 2 완료** — `create_notifications` async화 + 인당 `NOTIFICATION_CAP=100` 트리밍(오래된 순 삭제, 읽음 무관): `workflow.py` 시그니처 async 전환 + 호출 7지점 전부 `await` 부착(`workflow.py` 내부 2·`versions.py` 4·`notices.py` 1) · 신규 테스트 1건(TDD RED→GREEN) · 회귀 5개 파일 86 passed, 전체 스위트 609 passed, ruff clean.
- **Task 3 완료** — checkout 벨 알림 3종(`checkout_requested/approved/rejected`, inbox 전용이던 비대칭 해소): `checkout.py` `request_checkout`에 요청 통지(현 점유자+오너, 요청자 제외, 중복 제거) · `decide_checkout_request`에 결과 통지(요청자 본인 + 벌크 자동거절 전 캡처한 다른 미결 요청자) · 신규 테스트 2건(TDD RED→GREEN) · 회귀 3개 파일 18 passed, 전체 스위트 611 passed, ruff clean.
- **Task 4 완료** — permission 벨 알림 3종(`permission_requested/approved/rejected`): `permissions.py` 생성 3지점(update/delete_permission 다운그레이드, request_visibility_change)에 공용 헬퍼 `_notify_permission_request`(활성 승인자, 요청자 제외) 훅업 · `decide_approval_request`는 reject/approve 양 분기에 `_notify_permission_decision`(요청자에게 결과) 훅업 · 신규 테스트 1건(TDD RED→GREEN) · 회귀 3개 파일 80 passed, 전체 스위트 613 passed, ruff clean.
- **Task 4 리뷰 픽스** — 테스트 공백 2건 보강(production 무변경): approve 경로 `permission_approved` 내용 단언(test_notifications.py) · 다운그레이드 생성 지점 kind("a permission change")·map_name·요청자 제외 단언(test_permission_endpoints.py, enforce 필요라 해당 파일 — auth off는 전원 owner라 지연 분기 미도달) · 전체 스위트 615 passed, ruff clean.
- **Task 5 완료** — 사용자 삭제 API 2개(개별 DELETE + 범용 bulk-delete): `schemas.py` `NotificationBulkDeleteIn`(ids/read_only/before 택1 검증)·`NotificationBulkDeleteOut` · `notifications.py` `DELETE /{id}` 본인 수신분만(타인 404) · `POST /bulk-delete` 조건 3종(ids 교집합, read=true 필터, before 날짜 00:00 미만) · `test_notifications.py` 신규 테스트 4건 TDD RED→GREEN · 전체 스위트 615→615 passed(15개 알림 테스트), ruff clean.
- **Task 6 완료** — 관리자 퍼지 API 2개(`GET /admin/notifications/purge-preview` + `POST /admin/notifications/purge`, sysadmin 전용): `schemas.py` `NotificationPurgeGroupOut`/`NotificationPurgeGroupIn`/`NotificationPurgeIn`(`from`/`to`는 Python 예약어라 `Field(alias=...)`) · `admin.py` `_build_kst_range`([from 00:00, to+1일 00:00) KST) + preview(type·message 묶음 집계, last_at desc)·purge(확정 묶음 하드삭제, `Task 5`의 `NotificationBulkDeleteOut` 재사용, `deleted=max(result.rowcount, 0)` — `rowcount or 0`은 -1 미방어라 교정) · `test_admin_notifications.py` 신규 테스트 3건 TDD RED(404)→GREEN · 전체 스위트 619→622 passed, ruff clean.
- **Task 6 리뷰 픽스** — 테스트 공백 3건 보강(production 무변경, test_admin_notifications.py만): POST purge도 non-sysadmin 403 단언(유효 body — 빈 groups면 422가 게이트 선행) · to 경계일 포함 검증(to일 23:00 KST 포함·to+1일 00:30 제외, `_seed`에 hour/minute 확장) + groups 2개로 or_ 다중 분기 커버 · preview last_at DESC 정렬을 격리 범위(6/25~30)에서 순서로 단언 · 파일 5 passed, 전체 스위트 624 passed, ruff clean.

## 2026-07-16 — 알림 통합·삭제(퍼지)·100개 한도 설계 스펙 (worktree-alarm-audit)
- 감사 결과 기반 설계 확정 — 산출물: `docs/superpowers/specs/2026-07-16-notification-purge-design.md`.
- 사용자 확정 4건: 승인 알림은 요청+처리결과 양쪽 / 100캡은 읽음 무관 오래된 순 / 관리자 퍼지 미리보기는 type+message 묶음(수신자 수 표시) / 후속 중 인덱스+매뉴얼 보정 포함(페이지네이션·자동 retention 제외).
- 골자: 신규 알림 type 6종(checkout·permission 요청/결과, 수신자=inbox 노출 대상과 일치) · 사용자 삭제 API 2개(개별 DELETE + 범용 bulk-delete: ids/read_only/before 택1) · 관리자 purge-preview/purge(기간+묶음 확정, sysadmin) · `create_notifications` 내 인당 100캡 트리밍 · 인덱스 2종 + db.py `_ADDED_INDEXES` 자동 보강 · 벨 클릭→`/inbox?notification=<id>` 딥링크 · 알림 탭 카테고리 필 5종+선택/조건 삭제 · 테이블 뷰어 notifications 한정 퍼지 UI. DB 신규 컬럼 없음.

## 2026-07-16 — 알람(알림) 기능 전수 조사·퍼지(삭제) 경로 분류 (worktree-alarm-audit)
- 읽기 전용 감사 — 코드 변경 없음. 산출물: `docs/alarm-audit.md`.
- **명확화**: "알람" = 3개 서브시스템(벨 notifications / 수신함 inbox / 공지 notices). inbox는 테이블 없는 실시간 집계 뷰. 생성 경로는 단일 헬퍼 `create_notifications` 호출 7지점·type 6종. checkout(점유권 이전)은 inbox 전용 — 벨 알림 미생성(비대칭).
- **퍼지 분류**: 프로덕션 삭제 경로는 공지 sysadmin 하드 삭제(D1) 단 1개. 벨 알림(`Notification`)은 삭제 API·프론트 UI·retention·cascade 전부 없음(FK 의도적 미설정, `models.py:325`) — 읽음 UPDATE만 가능, 무한 누적. 스크립트 경로는 reset_db(D2)·seed_inbox_demo(D3)뿐.
- 부수 발견: `notifications` 테이블 인덱스 전무 + GET 전건 반환 + 전 사용자 5초 폴링 → 장기 성능 리스크. 매뉴얼 불일치 4건(인박스 갱신 주기·보존 정책 공백·공지 하드삭제·공지 읽음 localStorage). 후속 후보는 docs/alarm-audit.md §9.
## 2026-07-13 — 매뉴얼 커버리지 감사 후속 픽스: 번들 스테일·오우닝 부서·회수 규칙 (main)
- fable 에이전트 커버리지 감사(READ-ONLY, i18n·라우터 대조) 결과 중 "핵심" 갭을 반영. 지적 4건은 코드로 직접 재검증(swap 드롭존은 초기 grep이 `[mapId]` 대괄호 디렉터리에서 누락되는 ugrep 함정이라 Python으로 재확인).
- **번들 `backend/app/manual.md` 스테일 교정(AI 사용법 근거 — 적극적 오답 제거)**: 게시 시 직전 게시본은 "Approved로 강등"이 아니라 **Expired(만료·최종)** + 순차 버전번호 채번(`versions.py:641–659`); 폐기된 인라인 드릴다운 서술 삭제→하위프로세스 참조/딥뷰(⑦)로 교정; 드롭존 "하위"→swap; 강제 점유는 **sysadmin 전용**·체크아웃 요청/이전 추가(`versions.py:289`); 회수 규칙(Pending/Approved=제출자만, Rejected=+오너/sysadmin, 회수자 체크아웃 재부여, `versions.py:744–763`); 맵 생성 필수(오우닝 부서·결재자·공개범위); 코멘트 진입은 더블클릭이 아니라 컨텍스트 메뉴.
- **오우닝 부서(Owning department) 문서화(한/영)**: general 역할 표·§2 맵 만들기 필수 단계·§5 설정 탭 3곳 추가 — 부서원 자동 Editor 권한(`maps.py:253`, 생성 다이얼로그 필수).
- **회수 규칙 통일 교정(한/영)**: general §3.5·admin §10을 실제 게이트(제출자/오너/sysadmin 구분)로 정정.
- **관리자 임직원 임포트 3종(한/영)**: admin §7에 한글 이름 임포트(스키마·충돌 skip/overwrite)·부서 정보 임포트·부서 재지정 추가(기존엔 AD 동기화만).
- **editing(한/영)**: §2 swap 드롭존, §11 `Alt+←`/`Alt+→`(사이드바/인스펙터 토글, `editor-left-sidebar.tsx:269`) 추가.
- 범위 조정: 미니맵·메뉴키 액셀러레이터·노드 표시필드 토글·한/영 UI 토글·버전 이름변경/삭제·AI env 변수는 이번 "핵심만" 범위에서 제외(백로그).

## 2026-07-13 — 매뉴얼·README 최신화 + 사용자 매뉴얼 편집/그외 분할 + 릴리스 노트 (main)
- 지난 1주 신규 기능(회당 파라미터 6필드·CSV/AI 가져오기·CSV로 새 맵·PNG/Excel/CSV/Word 내보내기·운영 대시보드 확장·자동 로그인/딥링크·노드 URL 링크)이 매뉴얼(2026-07-09판)에 빠져 있어 전면 갱신.
- **사용자 매뉴얼을 편집/그외 2문서로 분할** — 기존 `docs/manual/user-manual-{ko,en}.md`(단일 15장, 코드 미참조 소스 문서) 삭제하고 `user-manual-editing-{ko,en}.md`(에디터·노드·회당 파라미터·그룹·하위프로세스·저장/검증·가져오기·내보내기·AI·단축키)와 `user-manual-general-{ko,en}.md`(로그인·홈·버전/승인·비교·설정·공지/알림·유저그룹·FAQ)로 재구성. 뷰어(F10)는 한/영 페어를 같은 순번으로 매칭하므로 editing=0·general=1 순으로 업로드 전제.
- 회당 파라미터는 UI 실 라벨(회당 소요시간(h)/추가비용(원·$)/투입인원/연간 건수/FTE, EN "Duration / run (h)" 등)·소요시간 시.분 표기(0.30=30분→`1h30m`)·비용 통화 배타·SP 상속 4필드·Σ 합산(비용 합/인원 평균)을 `lib/params.ts`·`lib/duration.ts` 실동작 기준으로 기술.
- `admin-manual-{ko,en}.md` §8을 "데이터베이스 뷰어와 운영 대시보드"로 확장 — 대시보드 5섹션+기간 필터+열람 권한 위임(Access 사이드바) 반영, 콘솔 지도 Dashboard 행·상단 크로스레퍼런스·갱신일 갱신.
- `backend/app/manual.md`(AI 사용법 근거 겸 번들 fallback)에 노드 속성·회당 파라미터·가져오기·내보내기 항목 추가. `README.md` 기능 목록에 파라미터·가져오기/내보내기 추가.
- 사용자용 릴리스 노트 `docs/notices/2026-07-13-release.md` 신설(기존 2026-07-06-release.md 형식).

## 2026-07-13 — 런칭 사실 문서 반영 (main)
- 서비스가 이미 런칭돼 운영 데이터가 있음(서버는 `0a9d19d`, 7/10 기준)이 확인돼 `docs/db-seed.md`·`README.md`·`CLAUDE.md`·회당 파라미터 설계문서에서 "미런칭이라 리셋 자유"·"DB 재생성 필수" 전제를 제거하고 **운영 서버 `reset_db`(drop_all) 금지**를 명시. 서버 스키마는 배포만으로 자동 보강(`db.py _add_missing_columns`; 신규 컬럼은 `_ADDED_COLUMNS` 수동 등록 필수)이고, 폐기된 구 파라미터 컬럼(`etf`/`cost`/`extra`·`sp_*`)은 7/11 도입분이라 운영 DB에 존재하지 않아 드롭·NOT NULL 충돌 위험 없음. 형식 검증 이전의 자유텍스트 `duration`은 이관 없이 폐기 결정.

## 2026-07-13 — 최종 whole-branch 리뷰 픽스: 통화 편도 pick·링크 없는 AI subprocess·Σ designated 게이트 (worktree-node-params)
- **[Critical]** `mergeNode`(csv-import.ts)·`resolveAiParamPatch`(params.ts)가 통화 배타를 candidate 자기 안에서만 체크해, 한쪽 통화만 채운 CSV 행/AI patch가 반대쪽 "기존" 통화값을 못 지워 두 통화가 동시에 저장되는 결함(422 루프·`isCostFieldDisabled`가 양쪽을 동시 잠가 탈출구 없음) 수정. `resolveCostFields`(mergeNode용, next/existing 병합)·`clearCounterpartCurrency`(resolveAiParamPatch용, patch에 반대쪽 `""` 추가) 신설, `isCostFieldDisabled`는 둘 다 값이 있으면 잠그지 않도록 탈출구 추가.
- **[Minor]** `AiNode.node_type`이 자유 문자열이라 AI가 링크 없는 `"subprocess"` 노드를 신규 생성할 수 있던 결함 — `coerceAiNewNodeType`(params.ts) 신설, `aiNodeToGraphNode`(page.tsx)·`buildGraphFromAiProposal`의 신규 노드 후보 생성 지점 2곳에서 링크 없는 subprocess를 process로 강등.
- **[Minor]** `param-sum.ts`의 `collectValues`가 `subprocess_refs`를 `designated` 게이트 없이 읽어, 지정 해제(`undesignate_subprocess`는 `sp_designated_at`만 null화하고 행 값은 남김) 후에도 Σ가 남은 값을 합산하던 불일치 — 인스펙터와 동일한 `getInheritedParams`로 소스 통일.
- **[Minor, comment only]** `AiNodeAttributes`(schemas.py) 독스트링이 "NodeIn과 동일 제약"이라 오해를 유발 — 실제로는 숫자 정규화기가 없고 duration·통화 배타만 검증함을 명시, 최종 정규화는 PUT /graph의 NodeIn에서 일어남을 기록. `csv-export.ts`에 서브프로세스 자기값 vs excel-export.ts 상속값 의도적 차이를 설명하는 주석 추가.
- TDD로 진행(신규 테스트 15종 먼저 추가 → 소스 stash로 red 확인 → 소스 복원 후 green). 게이트 전부 그린: pytest 607, vitest 413(395→413, 신규 18), ruff/tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T11: 시드·문서 갱신 + 전체 게이트 (worktree-node-params)
- `seed_org_demo.py` 데모값을 신규 6필드 모델에 맞게 갱신 — SP 지정 시드(`DESIGNATED_SPECS`)의 옛 자유텍스트 duration("3 days" 등)이 `normalize_duration` 무효 판정으로 응답 경계에서 조용히 소거되던 걸 발견해 H.MM 유효값(72/24/48/4)으로 교체하고 `sp_cost_krw`/`sp_headcount`도 채움, Vendor Management 맵(idx 11) 노드는 `cost_usd`만 채워 통화 배타를 실측 시연. `docs/db-seed.md`에 컬럼 개명(구 `etf`/`cost`/`extra`, SP `sp_etf`/`sp_cost`/`sp_extra` 폐기)으로 인한 DB 재생성 필수 경고 추가, `CLAUDE.md` 노드 속성 체크리스트·숫자 파라미터 계약 문단을 신규 6필드 + 비용 배타(422) + SP 편집 제한(3표면 강제) 기준으로 갱신. 전 레포 구 명칭 스윕 — 실사용 코드/문서 잔재 0건(테스트·주석의 매치는 전부 의도된 회귀 pin/폐기 서술). 게이트 전부 그린: pytest 607, vitest 395, ruff/tsc/lint/build clean, reset_db 무오류.

## 2026-07-13 — 리뷰 픽스: resolveAiParamPatch 무효 에코가 기존값을 지우던 결함 (worktree-node-params)
- `resolveAiParamPatch`(`lib/params.ts`)가 무효 에코(예: duration "2일", cost_krw "abc")를 `""`로 정규화해 patch에 그대로 담던 결함 수정 — page.tsx ops `set_attr`가 patch를 `node.data`에 직접 스프레드하므로 기존 값이 조용히 지워졌다(graph-merge 경로는 `mergeNode`의 `pick`이 `""`를 "건드리지 않음"으로 해석해 이미 안전했음). 정규화 실패 시 이제 키 자체를 결과에서 생략(명시적 `""` 에코는 여전히 "지움"으로 patch에 남음). 같은 원리로 `dropConflictingCurrency`도 통화 배타 위반 시 `cost_krw`/`cost_usd`를 `""`로 채우는 대신 키를 생략하도록 변경(csv-import.ts 호출부는 `?? ""`로 받아 동작 불변, resolveAiParamPatch 호출부는 이제 두 키가 patch에서 빠져 기존 값을 보존). `params.test.ts`에 무효 에코/명시적 빈값/통화충돌/콤마 에코/SP 게이트 6종 신규 pin, `csv-import.test.ts`에 병합 경로가 같은 위반 케이스에서 기존값을 지키는지 확인하는 pin 3종 추가(두 AI 경로 드리프트 방지). 395 tests green(389→395), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T10: AI 변환단 SP 제한·비용 배타 강제 (worktree-node-params)
- 프론트 `AiNodeAttributes`(api.ts)에 백엔드 T2가 이미 노출한 `cost_krw`/`cost_usd`/`headcount`/`annual_count`/`fte` 5필드를 추가(그동안 프론트 AI 타입엔 없었음). `lib/params.ts`에 순수 헬퍼 2종 신설 — `dropConflictingCurrency`(원·달러 동시 지정 시 둘 다 드롭)와 `resolveAiParamPatch`(page.tsx ops set_attr 전용, 정규화→통화배타→`dropUneditableParams` 순으로 적용해 SP 노드에서 통화 위반이 SP 드롭 경고에 겹치지 않게 함). `csv-import.ts`의 `buildGraphFromAiProposal`(graph 병합)이 두 헬퍼 + 기존 `mergeNode`/`dropUneditableParams`를 재사용해 SP 4필드 드롭·통화 배타를 CSV와 동일한 문구로 warnings에 싣는다. `page.tsx`의 `aiNodeToGraphNode`(ops add, 신규 노드라 SP 게이트는 미적용·통화 배타만)와 ops `set_attr` 블록(기존 노드, `resolveAiParamPatch` 호출 — SP/통화 위반은 색과 같은 방식으로 조용히 드롭, 이 경로엔 프리뷰 경고 채널이 없음)도 동일 규칙으로 맞춰 두 AI 경로의 비대칭을 없앴다. 377→389 tests green(신규 12), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T9: Excel 내보내기 컬럼·서식 (worktree-node-params)
- `excel-export.ts` 컬럼을 `No,Name,Type,Description,Assignee,Department,System,Duration (h),Cost (KRW),Cost (USD),Headcount,Annual volume,FTE,URL,Groups,Next` 16컬럼으로 개편, numFmt 6종(`0.00`/`#,##0`/`#,##0.00`)을 `COLUMNS` 정의에서 파생시켜(`"numFmt" in c` 순회) 셀 인덱스 하드코딩을 없앰(컬럼 재배열 시 인덱스 어긋남 방지). 서브프로세스 행의 duration/cost_krw/cost_usd/headcount는 노드 자신의 값이 아니라 링크 맵의 sp_* 라이브 참조(`graph.subprocess_refs`, `getInheritedParams` 재사용 — 캔버스 인스펙터·Σ 합산과 동일 소스)에서 가져오도록 수정, annual_count·fte는 노드 행 그대로. 시트 기록 로직을 `writeExcelSheet(workbook, model)`로 분리해 Blob/anchor(DOM) 없이도 vitest로 numFmt·빈 셀 유지를 검증(exceljs는 여전히 `downloadExcel`에서만 dynamic import — 번들 분리 유지). 377 tests green(신규 7), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T8: CSV 임포트/익스포트 14컬럼 (worktree-node-params)
- CSV 헤더를 `Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next` 14컬럼으로 개편(`csv-import.ts`/`csv-export.ts` 대칭). 숫자 셀은 `stripThousands`로 천단위 콤마를 허용, 원·달러 동시 기재 행은 `Row N: fill only one of Cost_KRW / Cost_USD` 에러로 저장 전 차단(백엔드 422 사전 방지). 리뷰 지적 수정: `mergeNode`가 서브프로세스 매칭 행에 duration/cost_krw/cost_usd/headcount(링크 맵 지정값)를 그대로 덮어쓰던 결함 — `lib/params.ts`에 공유 순수 헬퍼 `dropUneditableParams(nodeType, candidate)` 신설(subprocess는 annual_count·fte만 통과), CSV 경로는 드롭 발생 시 기존 warnings 채널로 안내. Task 10(AI 변환단)이 같은 헬퍼를 재사용할 수 있게 시그니처를 공용으로 유지. `buildAiPromptText`의 개명 이전 잔재 컬럼 설명(ETF/Cost/Extra)도 정리. `docs/samples/*.csv` 3종을 새 컬럼으로 재작성(자유텍스트 duration→H.MM 숫자, 파일당 1행 Cost_USD 배타 예시) — 재작성 전 3종 전부 duration 형식 불일치로 임포트 100% 실패였던 선재 결함도 함께 해소. 370 tests green(신규 9), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T7: SP 노드 부분 편집(연간 건수·FTE) + 인스펙터/요약/비교 반영 (worktree-node-params)
- Parameters 섹션을 `hasBpmAttributes` 게이트에서 분리해 자체 카드/그룹으로 승격 — start/end 외 모든 타입이 `PARAM_FIELDS` 6행을 렌더한다. subprocess는 회당 4필드가 링크 맵 지정값(라이브 참조)이라 읽기전용 텍스트(`—` 폴백)로, 연간 건수·FTE만 `ParamInput`으로 편집·저장(같은 SP를 쓰는 두 맵이 서로 다른 연간 물량을 가질 수 있음, design 2026-07-13 §3.1). 표시형은 순수 함수 `lib/params.ts`의 `formatParamValue`(duration→1h30m, 비용→₩/$+천단위)로 단일화해 캔버스 칩(`process-node.tsx`)과 인스펙터·요약 모달이 같은 규칙을 쓰고, 상속값 추출은 `getInheritedParams(SubprocessRef)`로 분리(미지정→전부 빈 값). 인스펙터 SP 어트리뷰트 카드에서 파라미터 4행은 제거(중복 표시 방지). 비교 화면 `displayFieldValue`에 비용 천단위 콤마 추가. 361 tests green(신규 7), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T6: SP 지정 Σ 4버튼 + placeholder 미리보기 (worktree-node-params)
- SP 지정 모달에 Σ 버튼을 4행 전부(duration/cost_krw/cost_usd/headcount)로 확장(기존 headcount 제외 조건 삭제), 모달 오픈 시 게시본 그래프를 1회 로드해 4개 Σ 결과를 각 입력의 `placeholder`(회색 이탤릭, `placeholder:italic placeholder:text-ink-tertiary`)로 미리 노출 — 값이 이미 있으면 HTML 기본 동작으로 자동 숨김, 채우려면 Σ 클릭 필요. 비용 배타(`isCostFieldDisabled`)를 Σ 버튼에도 적용. placeholder 표시형 결정은 순수 함수 `lib/param-sum.ts`의 `formatSumPreview(field, raw)`로 분리해 vitest로 검증(jsdom 미설치라 DOM 마운트 테스트는 추가하지 않음 — CLAUDE.md 방침). 패널·인스펙터 카드의 SP 어트리뷰트 표시행도 비용 2필드를 캔버스 칩과 동일 서식(`₩`/`$` + `formatThousands`)으로 통일. 354 tests green(신규 4), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T5: 천단위 콤마 + 비용 배타 + 칩 표시 (worktree-node-params)
- `lib/duration.ts`에 `formatThousands`/`stripThousands` 추가, `ParamInput`이 비용 2필드(cost_krw/cost_usd)에 포커스아웃 시 콤마 표시(포커스 중은 원문) 적용, `process-node.tsx` 칩은 `₩1,250,000`/`$1,200.50` 서식(cost_usd 아이콘도 Coins로 통일). 비용 배타(한쪽 값 있으면 반대쪽 disabled)는 `lib/params.ts`의 `isCostFieldDisabled` 헬퍼로 통일해 인스펙터(page.tsx)·노드 요약 모달·SP 지정 모달 3개 호출부에 적용. `@testing-library/react`·jsdom 미설치라 컴포넌트 테스트는 추가하지 않고 `duration.test.ts`/`params.test.ts`에 순수 로직 테스트로 대체(350 tests green), tsc/lint/build clean.

## 2026-07-13 — Σ 인원 평균 정수 도메인 (worktree-node-params)
- 인원 평균을 float 나눗셈에서 정수 스케일 도메인으로 이동 — 1.005×3이 1.00으로 깎이던 반올림 손실 차단(리뷰 Important).


프로젝트 진행 현황 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.

## 2026-07-13 — 노드 파라미터 재정의 T4: Σ 합산 규칙 재작성 (node-params)
- `lib/param-sum.ts`의 `sumParamField`가 `SpParamField`(4종) 전체를 받도록 확장. `duration`/`cost_krw`/`cost_usd`는 기존대로 합(통화 2필드 독립), `headcount`는 값 있는 일반 노드의 평균(소수점 2자리, SP 노드는 분자·분모 모두 제외)으로 변경. 호출부(`subprocess-designation-modal.tsx`)는 `SummableField` 대신 `SpParamField`로 시그니처만 갱신(headcount Σ 버튼 추가는 Task 6). 339 tests green(신규 5), tsc/lint clean.

## 2026-07-13 — 노드 파라미터 재정의 T3: 프론트 개명 스윕 + 편집 가능 필드 정의 (node-params)
- 프론트 전 표면을 신규 키(`duration`/`cost_krw`/`cost_usd`/`headcount`/`annual_count`/`fte`)로 개명하고 `lib/params.ts`에 `PARAM_FIELDS`(표시 순서)·`SP_PARAM_FIELDS`(SP 지정 4종)·`getEditableParamFields(nodeType)`(start/end 없음, subprocess는 연간건수·FTE만) 도입. i18n은 `field.costKrw`/`costUsd`/`annualCount`/`fte` 신규 키(EN·KO), 구 `field.etf`/`cost`/`extra` 삭제. `NodeData`의 회당 파라미터 키는 `PARAM_FIELDS`로 일반 인덱싱하므로 snake 유지, SP 라이브 참조는 `spCostKrw`/`spCostUsd`. 동작 변경 없음(콤마 서식·통화 배타·Σ 규칙·CSV/Excel 스키마·AI 가드는 후속 태스크). 329→334 tests green, tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T2: AI 계약 확장 (node-params)
- `AiNodeAttributes`에 `cost_krw`/`cost_usd`/`headcount`/`annual_count`/`fte` 추가(부분 갱신 시맨틱: None=유지) + 공용 `_assert_single_currency` 재사용한 통화 배타 검증. `ai_prompt.py` 3곳(그래프 스키마 예시·규칙 텍스트·`_serialize_node`) 동기화, subprocess 노드는 `annual_count`·`fte`만 수정 가능하다는 제한을 프롬프트에 명시. 603→607 tests green, ruff clean.

## 2026-07-13 — 노드 파라미터 재정의 T1: 백엔드 개명·비용 배타 (node-params)
- `duration`/`cost_krw`/`cost_usd`/`headcount`/`annual_count`/`fte`로 개명(구 `etf`/`cost`/`extra` 폐기, 이관 없음), SP 지정은 `sp_duration`/`sp_cost_krw`/`sp_cost_usd`/`sp_headcount` 3종만. cost_krw·cost_usd 동시 값은 model_validator에서 422(공용 `_assert_single_currency`). models/db/schemas/routers(graph·versions·maps)/subprocess.py 갱신, `get_subprocess_refs` select/unpack 동시 수정. 599→603 tests green, ruff clean.

## 2026-07-13 — 노드 파라미터 재정의 설계 (main)
- 회당 단가 모델로 의미 확정(회당 소요시간·회당 추가비용(원/달러 배타 2필드)·회당 투입인원·연간 건수·FTE), SP 지정은 3종만 + 인원 Σ는 평균(SP 제외)·Σ 미리보기 placeholder, CSV 14컬럼·Excel 서식·AI 계약(6필드 읽기/쓰기, SP는 연간건수·FTE만) 반영 — 스펙 `docs/superpowers/specs/2026-07-13-node-params-redefinition-design.md`. 운영 미배포라 DB 재생성 전제(기존 cost 값 폐기).

## 2026-07-13 — 노드 파라미터 재정의 구현 계획 (main)
- 11개 태스크 TDD 체크리스트 작성 — 백엔드 개명·비용 배타(T1), AI 계약(T2), 프론트 개명 스윕·편집 집합(T3), Σ 규칙(T4), 콤마 서식(T5), SP Σ placeholder(T6), 에디터 SP 부분편집(T7), CSV 14컬럼(T8), Excel 서식(T9), AI 변환단 강제(T10), 시드·문서·전체검증(T11). 계획 `docs/superpowers/plans/2026-07-13-node-params-redefinition.md`.

## 2026-07-12 — CLAUDE.md 세션 학습 반영 (main)
- 숫자 파라미터(duration H.MM) 계약 레슨 추가(이중 정규화 동기화·경계 소거 증발·표시형·raw dict 우회), backend pytest .env 함정 커맨드(bash/PS 병기), frontend AGENTS.md에 ParamInput 필수·내보내기 라이브러리 dynamic import 규칙.

## 2026-07-12 — 운영 대시보드 마무리 (dashboard-design)
- 설정 카테고리 순서 조정 — Analytics를 승인큐·그룹 뒤로. 대시보드 권한만 받은 비-sysadmin이 설정을 열 때 첫 탭(=풀블리드 대시보드)에 강제 착지하던 문제 해소(대시보드는 탭을 눌러 진입). sysadmin은 영향 없음.

## 2026-07-11 — 운영 대시보드 설계 (dashboard-design)
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-dashboard.md` (10태스크: 모델·판정 → 열람 게이트·MeOut → 설정 API → /summary → /timeseries → 프론트 순수함수·바인딩·i18n → 차트 5종 → 풀블리드 패널·탭 게이팅 → 우측 사이드바 2탭 → 브라우저 검증). 실행 순서는 T9를 T8보다 먼저(사이드바 선행이라야 패널 빌드가 한 번에 통과).
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-dashboard-design.md`. 스텁(진입 카드+로그인 3지표)을 리더 보고용 실운영 대시보드로 재작성: 신규 테이블 2개(`dashboard_permissions` 인원·부서·그룹 열람 권한 / `dashboard_coverage_depts` 커버리지 분모 부서), summary(스냅샷)·timeseries(기간 필터 전용) API 분리, 풀블리드 3열(좌 요약 레일 · 중앙 지표 그리드 · 우 인스펙터형 Access/Coverage 사이드바), 차트는 의존성 없이 자체 SVG/CSS.
- T1 모델·권한 판정 — `dashboard_permissions`·`dashboard_coverage_depts` 테이블 + `logic.can_view_dashboard()` 순수 함수(sysadmin·user·department 하위·group 멤버십·기본거부 5케이스 테스트, TDD RED→GREEN).
- T2 열람 게이트 — `require_dashboard_viewer`(sysadmin 또는 권한 행) 도입, 라우터 게이트를 엔드포인트별로 분리(ai-usage는 sysadmin 유지), `/api/me`에 `can_view_dashboard` 노출.
- T3 설정 API — 대시보드 권한 행 CRUD(중복 409·삭제 204)와 커버리지 분모 부서 GET/PUT(통째 교체·멱등). 열람은 뷰어, 변경은 sysadmin.
- T4 `/summary` 스냅샷 — 맵 현황·버전 상태 분포·부서 커버리지(하위 부서 맵을 상위 지정 부서에 귀속)·운영 항목(코멘트/알림/점유요청)·최근 버전 이벤트 10건. 지정 부서 0개면 0% (0 나눗셈 차단).
- T5 `/timeseries` — 일별 로그인·맵 생성·버전 생성(KST 버킷, 빈 날 0 채움). from>to·366일 초과는 422. 프리셋 환산은 프론트 책임.
- T6 프론트 기반 — `lib/dashboard-chart.ts` 순수 함수(nice 스케일·프리셋→KST 날짜범위·todayKeyKst, vitest 7케이스), api.ts 대시보드 바인딩 7종, `CurrentUser.canViewDashboard`(providers.tsx + settings dev-switch 양쪽 발행부 갱신), i18n 키 en/ko 39종. 기존 `dashboard.openCard` 등 4개 진입카드 키는 `dashboard-panel.tsx`가 아직 참조 중이라 삭제 보류(Task 8에서 참조 제거 확인 후 삭제).
- T7 차트 컴포넌트 — StatCard·BarChart(값 비례 막대, 최댓값 액센트)·LineChart(자체 SVG viewBox)·HBarList(버전상태·커버리지 공용)·PeriodFilter(프리셋 3종+달력). 라이브러리 무추가, 색은 전부 토큰.
- T9 우측 사이드바 — Access(인원·부서·그룹 피커로 권한 부여/제거)·Coverage(분모 부서 선택, 항상 전체 목록 PUT=멱등) 2탭. sysadmin에게만 렌더.
- T8 대시보드 패널 재작성 — 진입 카드 제거(탭 클릭이 곧 대시보드), 설정 탭 레일을 풀블리드 3열로 교체. 좌 요약 레일·중앙 지표 그리드(활동·성장·버전상태·커버리지·최근 이벤트)·AI 사용량은 sysadmin 한정. 설정 탭 게이팅에 `dashboard` Access 추가. `getDashboard()`/`DashboardMetrics`(구 바인딩)와 진입카드 잔재 i18n 키 9종 삭제. tsc·lint·build·vitest(297) 전부 통과.
- T10 브라우저 검증 — `frontend/scripts/pw-verify-dashboard.mjs` 6항목(풀블리드 교체·스탯 렌더·막대 수=기간·기간 변경 시 스냅샷 불변·커버리지 부서 추가 반영·비-sysadmin 권한 열람 게이팅) 6/6 PASS. 초안 대비 2건 수정: ① Coverage 부서 추가는 `SearchSelect` 메뉴가 `document.body` 포털(fixed)이라 사이드바 스코프가 아니라 페이지 스코프로 찾아야 함, ② check6은 "Dashboard 탭 버튼 노출"이 아니라 대시보드 루트(`data-id="dashboard"`) 노출로 판정 — dashboard 권한만 있는 비-sysadmin은 그 카테고리가 `allTabs[0]`이 되어 클릭 없이 즉시 풀블리드로 전환되므로 탭 버튼 자체가 생기지 않는다. 실측 발견 1건(테스트 픽스, 프로덕션 무변경): summary/timeseries 응답 도착과 React 커밋 사이 한 틱 지연 — 좌 레일을 곧장 읽으면 "—" 자리표시를 오탐, 300ms 안정화 대기로 해결. 전 게이트 그린: pytest 595·ruff 0·vitest 297·tsc 0·lint 0(신규)·build 0.
- 최종 리뷰 픽스(머지 전) — 11건: 커버리지 저장 시 중앙 카드 미갱신(`summaryNonce` 트리거, range는 여전히 deps 밖)·커스텀 기간 빈값/366일 초과 방지·라우터 default-deny 게이트 복원(`require_dashboard_viewer`)·죽은 `ChartScale.ticks` 제거·단일포인트 라인차트 원 중앙 정렬·이벤트 리스트 key에 event_type 추가·Access 피커 중복 후보 제외·`maps_created` deleted_at 비대칭 주석화·`CoverageDeptsIn.org_paths` 200자 제한·테스트명 `test_dashboard_requires_dashboard_viewer` 개명·`todayKeyKst`→`getTodayKeyKst`. 전 게이트 그린: pytest 595·ruff 0·vitest 297·tsc 0·lint 0(신규)·build 0. 상세: `.superpowers/sdd/final-review-fixes.md`.

## 2026-07-11 — CLAUDE.md 노드 속성 체크리스트 (main)
- Lessons에 노드 속성 추가 시 열거 지점 7곳 + CSV·AI 정규화 대칭 규칙 추가 — duration 정규화 갭(230a9e8) 재발 방지.

## 2026-07-12 — 최종 리뷰 픽스: 그룹 일괄편집 duration 모드 계약 정합 (sp-params-sum)
- `group-bulk-modal.tsx` duration 모드가 브랜치 계약(숫자 입력 강제+1h30m 표시)에서 누락 — 값 입력을 `ParamInput`(field="duration", ariaLabel, 신규 `placeholder` prop)으로 교체(자유텍스트가 applyGroupAttribute 경유로 들어갔다 백엔드 소거로 조용히 소실되던 갭 봉합, system 모드는 자유텍스트 유지), 충돌 팝오버·개별 마법사 existing/value·적용 요약 before/after의 duration 표시에 `displayAttrValue` 헬퍼(1h30m, 무효 시 원문 폴백 — compare 패턴) 적용. 게이트: vitest 304/304·tsc 0에러·lint 기존 경고 1건·build 0에러.

## 2026-07-12 — worktree-sp-params-sum 병합 (worktree-word-export)
- 머지 전 최신화: `worktree-sp-params-sum`(최신 main 기반, 41커밋 — SP 파라미터·Excel/CSV 내보내기·AI 사용량 계측 포함)을 Word 내보내기 브랜치에 병합(통합 테스트용). 충돌 5파일 해결 — 인스펙터 내보내기 영역은 PNG/Excel/CSV 3버튼 행 + 하단 Word 버튼으로 통합, i18n·package.json 합집합, lockfile 재생성. main 잔여 문서 커밋(b502df0)도 후속 머지.
- 병합 검증: vitest 322/322(word-export 18 포함)·tsc 0·lint 0에러(기존 경고 1)·build 성공·pytest 572. e2e — pw-verify-word-export 11/11(PNG 버튼 체크를 옛 라벨 "Download PNG" → `data-id="export-png"`로 보정, 병합으로 3버튼 행 라벨이 "PNG"로 바뀜)·pw-verify-sp-params 24/24, 콘솔 에러 0.

## 2026-07-12 — Task 6: SP 파라미터 브라우저 실기동 검증 + 배포 노트 (sp-params-sum)
- `pw-verify-sp-params.mjs` 신설 — 스크래치 맵 A(게시 체인 submit→approve→publish API 미러)에서 지정 모달 5입력+Σ 4개(headcount 제외) 확인, Σ(duration) 0.45+0.30=1.15(1h15m)·Σ(cost) 0.1+0.2=0.3·저장 200·영속 확인. 맵 B(미게시)는 Designate 진입 버튼 자체가 disabled(hasPublished 게이트)라 정상 UI로는 모달을 열 수 없음을 실측 — React `SimpleEventPlugin`이 DOM `disabled` 속성이 아니라 파이버 `props.disabled`를 보고 클릭을 억제하므로 속성만 지우는 우회는 무효였고, `__reactProps$*` 파이버 키로 실제 `onClick`(openModal) 핸들러를 직접 호출해 모달을 강제로 띄운 뒤 Σ 버튼 4개 전부 disabled임을 확인(진입 게이트와 Σ 내부 게이트가 동일 전제라 이 상태는 정상 내비게이션으로는 도달 불가 — 강제오픈 프로브로만 검증 가능). 맵 C에 맵 A를 subprocess로 링크해 노드 칩 `1h15m`+`0.3` 라이브 반영 확인. 에디터 인스펙터 Parameters 그룹 기본 접힘(`aria-expanded=false`)→펼침→duration `1.30`입력·blur `1h30m`·포커스 `1.30`복원·새로고침 후 펼침 유지(localStorage) 확인. 24/24 PASS, 콘솔 에러 0.
- 게이트 재확인: backend pytest 572 passed·ruff clean. frontend vitest 22 files/304 tests passed·tsc --noEmit 0에러·lint 0에러(기존 미관련 경고 1건만)·build 성공.
- **배포 노트**: sp 4컬럼(`sp_headcount`/`sp_etf`/`sp_cost`/`sp_extra`, Task 2)은 `create_all`이 기동 시 자동 보강하므로 프론트/백은 **반드시 동시 배포**(구버전 프론트가 신버전 백엔드에 4필드 없는 payload를 보내는 조합, 또는 그 역은 지정 모달 저장이 깨짐). 레거시 sp 자유텍스트(구 `sp_duration` 자유입력 값)는 API 응답 3표면(`MapOut`·`SubprocessRefOut`·라이브러리 목록, Task 2)에서 이미 정규식 미매치 시 `null`로 소거되므로 기능상 즉시 문제는 없으나, DB에 남은 원본 값은 그대로다. 원하면 배포 후 1회 물리 정리:
  `UPDATE process_maps SET sp_duration = NULL WHERE sp_duration IS NOT NULL AND sp_duration !~ '^[0-9]+(\.[0-9]{1,2})?$';`
- **dev.db 상태**: 로컬 검증에서 생성한 스크래치 맵(SP-Params A/B/C, 6회 실행분)은 전부 스크립트 종료 시 소프트삭제(`deleted_at` 설정) 완료 — 활성 맵 수는 시드 그대로 12개 유지, 휴지통에만 잔존(다른 pw-verify-*.mjs와 동일 패턴, 완전 복원은 `git checkout backend/dev.db` + 백엔드 재시작).

## 2026-07-11 — Word 도형 순서도 내보내기 설계 (worktree-word-export)
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-word-export-design.md`. SOP에 하이퍼링크 살아있는 순서도를 붙여넣기 위한 `.docx` 생성(Word 순정 플로차트 도형 + 라벨/URL라벨 하이퍼링크 + 전체 그룹화). SmartArt(링크 불가)·HTML 복붙(도형 유실) 검토 후 제외. OOXML 직접 생성 + `fflate` 단일 의존성, 진입점은 인스펙터 맵 탭(PNG 무변경). 흑백톤 + Arial/바탕체 11pt.
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-word-export.md` (4태스크: 순수 빌더+노드 도형 → 연결선/엣지 라벨 → 진입점 통합 → 브라우저 검증. 접점 idx·inline 그룹 호환은 T4 실측 보정 항목).
- T1: word-export.ts 순수 빌더 — docx 4파트 조립 + 노드 도형(프리셋 매핑·흑백·Arial/바탕체 11pt·하이퍼링크 rels) + fflate 도입, vitest 10건.
- T2: 연결선 bentConnector3 + stCxn/endCxn 접점(도형 이동 시 추종) + 분기 라벨 텍스트박스 + 역방향 flip, vitest 4건 추가.
- T3: exportCanvasWord 다운로드 트리거 + i18n 2쌍(en/ko) + 인스펙터 맵 탭 하단 Word 버튼(data-id=inspector-export-word, PNG 무변경).
- T4: `frontend/scripts/pw-verify-word-export.mjs` — 버튼/다운로드/unzip 4파트/도형·연결선 수/하이퍼링크/흑백·폰트/콘솔 11항목, 로컬 실행 **11/11 PASS**(2회 재현, 콘솔에러 0). 브리프 원안 조정: 데모 시드(`reset_db`)는 모든 draft가 타인(데모 유저) 체크아웃 상태라 원안처럼 기본 로드 버전에 바로 URL 노드를 PUT하면 항상 409 — sysadmin(admin.sys)으로 draft를 force 체크아웃 인수해 검증하고, 종료 시 그래프 원복 PUT(200) + 체크아웃을 원 점유자(taeyang.oh)에게 이전(transfer, 200)해 dev.db를 원상복구(draft가 없는 맵이면 ④는 SKIP 로그). ⚠️ Word 실물 열기·복붙·링크 클릭·접점(`SIDE_TO_CXN_IDX`) 위치는 Windows 수동 검증 대기.
- 최종 리뷰 픽스: rels Target URL 정규화(new URL, 실패 시 링크 생략)·buildDocx 빈 배열 throw·엣지 라벨 bounds 클램프·스펙 함수명 정합.

## 2026-07-11 — Task 5: SP 표시 전면 — 칩 5종·1h30m 적용·읽기 표면 (sp-params-sum)
- `NodeData`(canvas.ts)에 spHeadcount/spEtf/spCost/spExtra 추가 + page.tsx subprocess_refs→data 매핑 확장. `NodeParams`(process-node.tsx)의 subprocess 분기를 sp 5종으로 확장, duration 칩만 `formatDurationHm` 적용(filled 판정도 포맷 결과 기준 — 레거시 방어). 읽기 표면 3곳(subprocess-inspector-card·subprocess-designation-panel·page.tsx `inspector-subprocess-attrs`)에 파라미터 4행 추가 + duration 포맷. compare/page.tsx에 공용 `displayFieldValue` 헬퍼 신설, 3곳(fieldsOf·목록·사이드패널)의 duration before/after/current를 포맷.
- 게이트: vitest 304/304·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트)·build 0에러.

## 2026-07-11 — Task 4: SP 지정 모달 숫자 5종 입력 + Σ 합산 버튼 (sp-params-sum)
- `subprocess-designation-modal.tsx`의 duration 자유텍스트 입력을 `PARAM_FIELDS` 5종 블록(`ParamInput`, ariaLabel 포함 — Task 3 확정 계약)으로 교체, duration/etf/cost/extra 4필드에 Σ 버튼(게시본 그래프 `useRef` 1회 fetch 캐시·`sumParamField`로 setForm만 갱신·저장은 기존 Save 경유) 추가. headcount는 Σ 미지원. `DesignationForm`에 4필드 추가 + 호출측 2파일(`subprocess-inspector-card.tsx`·`subprocess-designation-panel.tsx`)의 initial 조립에 `sp_headcount` 등 4필드 미러(tsc 강제). i18n `sp.sumAllNodes`/`sp.sumNeedsPublished` en/ko.
- 게이트: vitest 304/304·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트)·build 0에러.

## 2026-07-11 — Task 3 리뷰 픽스: ParamInput ariaLabel 복원 (sp-params-sum)
- 리팩터에서 탈락했던 요약모달 param 입력의 `aria-label` 회귀 픽스(라벨 span은 input과 미연결 — 스크린리더 접근명 공백). ParamInput에 옵셔널 `ariaLabel` prop 추가(브리프 인터페이스 결함 보강), 인스펙터·요약모달 양쪽에 `t(PARAM_LABEL_KEY[key])` 전달(인스펙터는 원래 없던 것을 이번에 추가). tsc 0에러·lint 0에러·vitest 304 passed.

## 2026-07-11 — Task 3: 공용 ParamInput + 인스펙터/요약모달 리팩터 + Parameters 접기 (sp-params-sum)
- 신규 `components/param-input.tsx`(단일 input focus/blur 표시 스왑 — duration만 비포커스 시 `formatDurationHm`, 나머지 4필드는 항상 raw) + `lib/params.ts`에 `readParamsCollapsed`/`writeParamsCollapsed`(localStorage `bpm.paramsCollapsed`, 저장값 없으면 기본 접힘). 인스펙터(page.tsx)·노드 요약 모달의 Parameters 인라인 타이핑필터/blur정규화 중복 구현을 ParamInput으로 대체, 접기 헤더(들여쓰기 `ml-2 border-l pl-2`+채워진 개수 `(n)`)를 두 지점에 동일 패턴으로 추가(같은 localStorage 키 공유 — 인스펙터/요약모달 토글 상태 연동).
- 게이트: vitest 304 passed·tsc --noEmit 0에러·lint 0에러(기존 미관련 경고 1건)·build 0에러.

## 2026-07-11 — Task 2 리뷰 픽스: 라이브러리 목록 레거시 sp_duration 소거 (sp-params-sum)
- `routers/library.py` `list_processes`가 raw dict 직렬화로 MapOut/SubprocessRefOut validator를 우회 — 레거시 자유텍스트("3일")가 라이브러리 API로 누출되던 잔여 경로 봉합(조립부에서 `normalize_duration` 소거, 무효→None). `test_sp_params.py`에 라이브러리 목록 단언 1건 추가. pytest 572 passed(571+1)·ruff 0에러.
- 스펙 §2 보정 — 레거시 sp_duration 소거 경로에 library 목록(raw dict) 추가(Task 2 리뷰 발견 반영).

## 2026-07-11 — Task 2: 백엔드 sp 4컬럼 + 지정 경계 정규화 + 응답 레거시 소거 (sp-params-sum)
- `ProcessMap`에 sp_headcount/sp_etf/sp_cost/sp_extra 4컬럼(`db.py _ADDED_COLUMNS` 멱등 보강 포함) 추가. `SubprocessDesignationIn`이 duration 포함 5필드를 경계에서 정규화(무효→`""`, NodeIn과 동일 시맨틱) — `designate_subprocess`·`get_subprocess_refs`에 4필드 배선. 응답 경로 레거시 소거 신설 — `MapOut.sp_duration`·`SubprocessRefOut.duration`에 무효→None validator(레거시 자유텍스트 직삽입이 GET을 깨지 않게). TDD 3케이스(지정 시 숫자 정규화·무효값 소거·레거시 응답 소거를 MapOut+subprocess_refs 양쪽에서 실단언) 신규 `test_sp_params.py`. pytest 571 passed(568+3)·ruff 0에러.

## 2026-07-11 — Task 1: formatDurationHm + sumParamField 순수 유틸 (sp-params-sum)
- TDD 완료 — `lib/duration.ts`에 `formatDurationHm(raw: string): string` 추가(정규화 후 "1h30m" 표시형), `lib/param-sum.ts` 신규(sumParamField 게시본 직합·subprocess는 sp값·duration 분환산 캐리·부동소수 오차 차단). api.ts SubprocessRef/MapSummary/SubprocessDesignationBody에 headcount/etf/cost/extra 4필드 확장. vitest 304/304 (formatDurationHm 8케이스+param-sum 6케이스 포함)·tsc --noEmit 0에러·lint 경고 0건(기존 미관련).

## 2026-07-11 — SP 숫자 파라미터 + Σ 합산 + duration 표시형(1h30m) 설계 (main)
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-sp-params-sum-duration-format.md` (6태스크: 포맷·합산 유틸 → 백엔드 sp 4컬럼+경계 소거 → 공용 ParamInput+접기 → 지정 모달 5입력+Σ → 표시 전면(칩 5종·1h30m) → 브라우저 검증).
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-sp-params-sum-duration-format-design.md`. SP 지정 속성을 숫자 5종으로 확장(sp 4컬럼 추가·레거시 자유텍스트 소거), 지정 모달에 Σ 합산 버튼(게시본 직합·sub는 subprocess_refs sp값·duration 분환산 캐리), duration 표시형 1h30m 통일(편집 중만 1.30, CSV/Excel 예외), 인스펙터 Parameters 그룹 들여쓰기+접기(기본 접힘·localStorage 퍼시스트).

## 2026-07-11 — AI duration 정규화 대칭 픽스 (main)
- AI 그래프 제안 경로(`buildGraphFromAiProposal`·`aiNodeToGraphNode`)의 duration을 CSV와 동일하게 `normalizeDuration`으로 정규화 — 무효 에코("3일")가 pick에 채택돼 백엔드 소거로 기존 유효값이 유실되던 갭 봉합(numeric-params 머지 교차점 리뷰에서 발견). vitest 290·tsc 0·lint 0.

## 2026-07-11 — AI 실모델 스모크 체크리스트 (main)
- `docs/ai-real-model-smoke.md` 신규 — 실모델 검증 절차(연결 확인→.env 기동(bash/PowerShell 병기)→S1~S8 시나리오→판정·후속 매핑). S1 제목 에코 매칭률이 핵심 변수, 로컬은 OpenAI 호환 키 대체 가능(Claude 네이티브는 어댑터 작업 필요).

## 2026-07-11 — Task 1: duration 정규화 유틸 (FE/BE 동치) (numeric-params-export)
- TDD 완료 — 프론트엔드 `lib/duration.ts`·`lib/duration.test.ts` + 백엔드 `app/duration.py`·`tests/test_duration.py` 신규. 브리프의 테스트 케이스 19개(FE) + 15개(BE) 전수 통과(`DURATION_PATTERN`/`NUMERIC_PATTERN` 정규식, H.MM 정규화·1자리 10분 단위·60분 이월·소수부 0 정수 변환). 타입/린트 검증: frontend npm run test 19/19·tsc--noEmit 0에러 / backend pytest 15/15·ruff 0에러.
- 스펙 §5 진입점 문구 보정 — 드롭다운→나란한 3버튼(구현 확정 반영). 디시전 칩 시각 재검증: 픽스(0a2bc5a) 후 pw 22/22 PASS + 와이드 스크린샷·elementFromPoint 실가시성 확인.

## 2026-07-11 — Task 2: 백엔드 숫자 파라미터 4컬럼 + NodeIn/AI 경계 정규화 (numeric-params-export)
- Node에 headcount/etf/cost/extra 4컬럼(`db.py _ADDED_COLUMNS` 멱등 보강 포함) 추가, `NodeIn`이 duration 포함 5필드를 경계에서 정규화 — 무효값은 422 대신 `""` 소거(`from_attributes=True` 응답 경로가 레거시 자유텍스트로 깨지지 않게). `AiNodeAttributes.duration`은 None(생략)을 그대로 보존(부분 갱신 시맨틱). 필드 열거 지점(`routers/graph.py` upsert, `routers/versions.py` clone_graph) 미러 완료, `sp_duration`(ProcessMap SP 속성)은 미변경. AI 프롬프트에 duration H.MM 규칙 한 줄 추가. 시드에 데모값 채움. 기존 `test_bpm_attributes_roundtrip`의 자유텍스트 duration 단언을 새 정규화 계약에 맞춰 갱신. pytest 556 passed·ruff 0에러. 리뷰 픽스: `seed_compare_demo.py`의 자유텍스트 duration("3일"/"1일")을 H.MM 숫자("3"/"1")로 교체 — 경계 소거로 duration diff 시연이 사라지는 문제.

## 2026-07-11 — Task 3: 프론트 입력·노드 칩·diff·AI apply (numeric-params-export)
- `lib/params.ts` 신설(PARAM_FIELDS 5종 메타) + GraphNode/NodeData에 headcount/etf/cost/extra 옵셔널 추가 + 데이터 왕복 4곳(로드 매핑·buildGraph·신규노드 기본값 3곳·AI apply duration 정규화 경유) 배선.
- 인스펙터·요약모달에 Parameters 입력 그룹(5필드, 타이핑은 숫자만 허용·blur에서 정규화) + 노드 카드에 파라미터 칩(아이콘+숫자만, subprocess는 spDuration만) — NodeDisplayField에서 duration 제거(구설정 잔재는 로드 시 필터).
- 버전 비교 diff 필드 4종 추가(ChangedField·FIELD_KEYS·compare FIELD_MSG) + compare buildAppNodes에도 4필드 매핑(노드 칩이 비교화면에도 온전히 뜨도록).
- 게이트: tsc 0에러·vitest 263 passed·lint(경고 1건, 기존 미관련 스크립트)·build 0에러.
- 리뷰 픽스: compare 사이드 Properties 패널의 하드코딩 필드 목록에 4파라미터(headcount/etf/cost/extra) 추가 — FIELD_MSG·온캔버스 diff 필은 신규 파라미터를 보여주는데 상세 패널만 누락됐던 비일관 해소.
- 브라우저 검증 픽스(Task 8 FAIL): 디시전 마름모 칩 overflow — 파라미터 칩을 타이틀 레이어(max-w-20)에서 빼 마름모 아래 절대배치 캡션(`top-full left-1/2 -translate-x-1/2 w-max max-w-40`, justify-center)으로 이동. 절대배치라 React Flow 측정 크기(h-24 w-24) 불변 → 핸들·엣지 앵커 무영향. NodeParams에 옵셔널 className만 추가, 타 셸 배치 무변경.

## 2026-07-11 — Task 4: CSV 임포트 숫자 파라미터 5컬럼 확장 (numeric-params-export)
- `lib/csv-import.ts`에 headcount/etf/cost/extra 4컬럼 추가(HEADER_COLUMNS·MAX_LEN·NODE_DEFAULTS·mergeNode pick·행 매핑), duration은 자유텍스트 대신 `normalizeDuration` H.MM 검증으로 전환, 5필드 모두 정규화된 값을 노드에 저장. `buildTemplateCsv`(13컬럼)·`buildAiPromptText`(Duration H.MM 규칙+4컬럼 규칙) 갱신.
- TDD: 브리프 신규 테스트 2건 RED(`Unknown column "Headcount"`) 확인 후 구현 → GREEN. duration이 자유텍스트("2 days" 등)였던 기존 테스트 4건을 숫자값으로 갱신(테스트 수는 순감소 없이 73→75).
- 게이트: csv-import 75/75·전체 vitest 265/265·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트).

## 2026-07-11 — Task 5: CSV 내보내기(왕복) (numeric-params-export)
- `lib/csv-export.ts`(`buildCsvFromGraph`·`orderNodesByFlow`) 신규 — csv-import 13컬럼 포맷 미러, 표현 불가 구조(추가 end·라벨있는 End행 엣지·제목 중복·outgoing<2 decision·start 연결 상이)는 warnings로 명시. 브리프 코드에서 `orderNodesByFlow`의 outgoing Map 초기화를 `Map.set().get()` 체이닝 트릭에서 통상적인 get-or-set 패턴으로 단순화(동작 동일, 가독성만 개선).
- TDD: `csv-export.test.ts` 11케이스(왕복 불변·분기라벨 보존·이스케이프 원문보존·추가 end 경고·라벨 End행 경고·제목중복 경고·start 불일치 경고·숫자파라미터 undefined 안전 직렬화·orderNodesByFlow 3종[정상/무-start/사이클]) 모듈 부재로 RED 확인 후 구현 → 1회 실행에 11/11 GREEN.
- 게이트: csv-export 11/11·전체 vitest 276/276·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트, 무변화).
- 리뷰 픽스: 테스트 공백 1건 보강 — 무라벨 End행 엣지가 다른 outgoing과 병존(`outs.length > 1`)하는 분기 케이스 추가(경고 발화 + Next 셀 드랍 단언), csv-export 12/12.
- 최종 리뷰 픽스 3건: ① Next 대상 제목의 `;`/`:`·엣지 라벨의 `;`는 재임포트 오파싱 경고 추가(그대로 내보내되 warning, 테스트 +1 → csv-export 13/13) ② 에디터 handleExportCsv의 BOM 보이지 않는 리터럴 → 유니코드 이스케이프 표기(포매터 증발 방지) ③ 백엔드 test_ai 픽스처 duration "1일"→"1"(validator 소거로 죽은 값 복원).

## 2026-07-11 — Task 6: Excel 모델 빌더(재귀·순환·상한·locked) (numeric-params-export)
- `lib/excel-export.ts`(`buildExcelModel`) 신규 — 서브프로세스 노드 바로 아래에 링크 맵 전체를 depth+1로 재귀 인라인, 조상 맵 경로(ancestry Set)로 순환 차단(circular 1행), fetch 실패/locked는 denied 1행, 행 상한(`EXCEL_MAX_ROWS`=2000, 옵션 `maxRows`) 초과 시 rowLimit 1행 후 전 재귀 레벨 즉시 중단, 같은 (mapId,followLatest,pinned)는 fetch 1회 메모이즈. 브리프 Step 3 코드를 그대로 구현(변경 없음).
- 자체 결정 규칙: ①rowLimit 행 자체는 상한을 넘겨서라도 push되어 최종 rows.length가 maxRows보다 1 클 수 있음(브리프 코드 그대로, 테스트로 박제). ②truncated는 클로저 공유 플래그라 상한 도달 즉시 모든 재귀 레벨의 다음 for-반복에서 무조건 return — rowLimit 행은 정확히 1개만 생성됨. ③인터페이스에 루트 그래프 자신의 mapId가 없어(Graph 타입에 id 없음) ancestry가 빈 Set으로 시작 — 루트를 직접 역참조하는 순환은 fetchResolved로 루트를 한 번 더 확장(한 단계 깊은 복제)한 뒤에야 닫힌다(circular 1행은 여전히 보장, 유한 정지도 보장). 루트가 아닌 두 서브맵 간 순환은 즉시 차단됨 — 두 케이스 모두 테스트로 구분.
- TDD: `excel-export.test.ts` 10케이스(재귀 인라인+depth·루트 자기참조 순환 1행(지연 차단 확인)·비루트 서브맵간 순환 즉시차단·다이아몬드 인라인+fetch 1회 스파이·locked denied·fetch reject denied·행 상한 단순+재귀중 상한(rowLimit 1개 보장)·start/end 포함 next에 End 라벨 표기·groups는 링크 맵 자신 기준) 모듈 부재로 RED 확인 후 구현 → 1회 실행에 10/10 GREEN.
- 게이트: excel-export 10/10·전체 vitest 287/287·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트, 무변화).
- 리뷰 픽스(Important): 루트 맵 자기/상호참조 순환이 스펙(조상 경로 즉시 차단, design §4)을 어기고 루트를 한 바퀴 더 인라인하던 결함 — args에 옵셔널 `rootMapId?: number` 추가(기존 필드 전부 유지), 초기 ancestry를 rootMapId로 시드. 루트 상호참조 테스트를 rootMapId 기준(즉시 circular + 루트 re-fetch 0회 스파이 단언)으로 갱신, rootMapId 생략 시 기존 지연 차단 동작 케이스를 별도로 남겨 하위호환 박제. **Task 7 소비 계약: `buildExcelModel` 호출 시 현재 맵 id를 `rootMapId`로 전달할 것.** excel-export 11/11·전체 vitest 288/288·tsc 0에러.

## 2026-07-11 — Task 7: exceljs 기록 + 다운로드 3버튼 (numeric-params-export)
- `exceljs`(dynamic import) 설치·`downloadExcel` 구현(`lib/excel-export.ts`) — 헤더 연보라 필·note 행 3종(circular/denied/rowLimit)·URL 하이퍼링크 셀·`outlineLevel=min(depth,7)`·duration 컬럼 `numFmt "0.00"`. exceljs 실 타입에 맞춰 브리프의 `as never` 캐스팅 없이 `AddWorksheetOptions.properties`가 이미 `Partial<WorksheetProperties>`라 그대로 대입.
- 에디터 인스펙터(맵 탭) PNG 단일 버튼(`handleExportPng`, 옛 ~4297) → PNG/Excel/CSV 3버튼 나열로 교체. 공용 `buildExportFileName(ext)` 헬퍼로 파일명 규칙(sanitize+stamp) 통일 — PNG도 이 헬퍼로 리팩터(출력 동일, 라벨만 "Download PNG"→"PNG"로 축약해 3버튼 정렬). `buildGraph(nodesRef.current, edgesRef.current, groupsRef.current)`는 저장 경로(1366행)와 동일 소스 — 실물 확인 후 브리프 추정 그대로 사용. Excel은 `rootMapId: mapId` 전달(Task 6 소비 계약), `truncated`/CSV `warnings` 발생 시 토스트.
- i18n 6키(en/ko): `inspector.exportExcel`/`exportCsv`("Excel"/"CSV"), `err.exportExcel`, `export.csvWarnings`, `export.excelTruncated`. PNG 아이콘(`Download`)은 부수 동작 보존 원칙에 따라 유지, Excel/CSV는 `FileSpreadsheet`/`FileDown` 신규.
- 게이트: vitest 288/288·tsc --noEmit 0에러·lint 경고 1건(기존 `pw-smoke-task8.mjs`, 무관)·build 0에러 — exceljs는 별도 청크(912K)로 분리, app-build-manifest 어디에도 정적 참조 없음(dynamic import 격리 확인).

## 2026-07-11 — Task 8: 통합 검증(브라우저 실기동) + 배포 노트 (numeric-params-export)
- `frontend/scripts/pw-verify-export.mjs` 신규 — reset_db 시드 + 스크래치 맵으로 6시나리오 21/22 PASS: ①파라미터 5입력 blur 정규화(0.75→1.15)+노드칩 5개 ②새로고침 저장왕복 ③CSV 다운로드 13컬럼·숫자값→재임포트 머지 프리뷰 0 added/0 removed·그래프 무변경 ④Excel 다운로드를 exceljs로 재독해 — 맵A(제어 데이터) 숫자 셀 5종 실수형·하이퍼링크 {text,hyperlink}, 맵2(Employee Onboarding) 서브프로세스 재귀 인라인 행+outlineLevel=1 ⑤콘솔 에러 0. 조정 2건: 내보내기 3버튼은 인스펙터 "Map" 탭 안(탭 전환 헬퍼), 노드/엣지 id는 rid() 32자 hex(소프트삭제된 이전 실행 행과 UNIQUE 충돌 — dev.db는 전역 유니크).
- **유일 FAIL(Task 3 이월, 미수정)**: 디시전(마름모) 노드 파라미터 칩 overflow — 마름모 대각선 130.2px vs 콘텐츠 102.3×89.5(내접 조건 w+h≤D 위반, 191.8>130.2). 칩이 마름모 경계 밖 코너까지 침범. 증거: `/tmp/pw-verify-export/06-decision-params.png`. 픽스 여부는 컨트롤러 판단 대기.
- 게이트 전종: pytest 556 passed·ruff 0에러·vitest 288/288·tsc --noEmit 0에러·lint 경고 1건(기존 `pw-smoke-task8.mjs`, 무관)·build 0에러.
- **배포 노트**: ① 프론트/백 **동시 배포 필수** — `NodeIn` 5필드 정규화(백)와 인스펙터 입력/칩/CSV·Excel(프론트)이 스키마 연동, 한쪽만 배포 시 신규 파라미터 저장·표시 불일치. 신규 4컬럼은 `db.py _ADDED_COLUMNS` 멱등 보강으로 자동 추가(수동 DDL 불요). ② 서버 1회 정리 SQL(**선택** — validator가 무효 duration을 응답 경계에서 `""` 소거하므로 방치해도 무해, 물리 정리를 원할 때만): `UPDATE nodes SET duration = '' WHERE duration !~ '^[0-9]+(\.[0-9]{1,2})?$';`

## 2026-07-11 — 숫자 파라미터 + Excel/CSV 내보내기 구현 계획 (main)
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-numeric-params-excel-csv-export.md` (8태스크: 정규화 유틸 FE/BE 동치 → 백엔드 4컬럼+경계 소거 → 프론트 입력/칩/diff → CSV 임포트 확장 → CSV 내보내기(왕복 불변 테스트) → Excel 모델(재귀) → exceljs 기록+3버튼 → 브라우저 검증). 무효값은 422 대신 "" 소거(from_attributes 응답 경로 보호), 내보내기 진입점은 3버튼 나열.

## 2026-07-11 — 숫자 파라미터 5종 + Excel/CSV 내보내기 설계 (main)
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md`. duration 자유텍스트 → 숫자 파라미터 5종(duration H.MM 표기·60분 이월, headcount/etf/cost/extra 십진수, 기존 컬럼 재사용+4컬럼 추가), CSV 임포트 갱신+왕복용 CSV 내보내기 신설(재임포트 diff 0 기준), Excel(.xlsx) 클라이언트 exceljs 내보내기(서브프로세스 전체 재귀 인라인·순환 조상검사·행 상한 2,000·locked 마스킹). Word는 다음 세션.

## 2026-07-11 — AI 사용량 계측·매뉴얼 선별 (worktree-ai-usage-manual)
- B1 1/3: call_ai가 usage를 AiReply로 반환, _ask_and_validate가 시도 전체 누적(실패 시 HTTPException에 동봉).
- B1 2/3: ai_usage_events 테이블(create_all 자동)·성공은 write-through 동봉·실패는 ok=false 별도 커밋(502 전파 유지).
- B1 3/3 백엔드: GET /api/dashboard/ai-usage — SQL 집계(합계·실패·상위5), sysadmin 전역 게이트.
- 픽스: 집계 테스트에 상위 목록 내림차순 정렬 단언 추가(공유 DB 오염 무관 상대순서 검증).
- B2: 매뉴얼 30k 절단 → 섹션 선별(## 분할·2-gram 점수·TOC 상시·budget 12k, 소형 매뉴얼 무변화).
- 픽스: 매뉴얼 선별 header 단독 budget 초과 시 절단 보장(+테스트)·_extract_bigrams 개명.
- B1 프론트: Dashboard 탭 스텁에 AI usage 섹션(StatCard 4·상위 2표·빈 상태), i18n 9키.
- T6 브라우저 검증 + 최종 게이트 — `frontend/scripts/pw-verify-ai-usage.mjs` 신규(이벤트 2건 앱모델 시드→설정>Analytics>Dashboard 진입카드→AI usage 섹션 3체크: ①섹션 가시 ②토큰 합계(1,290) 렌더 ③상위 사용자 verify.user 노출, 3/3 PASS). 조정: 진입카드 클릭 직후 `GET /dashboard/ai-usage` 응답 도착 전에 텍스트를 읽어 "—" 자리표시로 오탐하던 레이스 — 응답 대기 추가로 해결. 스크립트는 실행마다 이벤트를 누적하므로 재실행 전 reset_db 필요(주석 명시). 게이트: pytest 550 passed·ruff 0에러·vitest 244 passed·tsc 0에러·lint(경고 1건, `pw-smoke-task8.mjs` 기존 미관련)·build 0에러.
- 완료: B1 사용량 계측/집계·B2 매뉴얼 선별. 배포: 신규 테이블 create_all 자동 — 수동 DDL 불요. 사용자 확인(3002 데모) 후 main 머지.

## 2026-07-11 — AI 사용량 계측(B1)·매뉴얼 섹션 선별(B2) 설계·계획 (main)
- 설계 스펙 + 구현 계획(6태스크) 커밋 — `docs/superpowers/specs/2026-07-11-ai-usage-manual-select-design.md`, `docs/superpowers/plans/2026-07-11-ai-usage-manual-select.md`. 호출별 이벤트(`ai_usage_events`, 원문 미저장)·대시보드 스텁 확장·`## `분할+2-gram 섹션 선별(budget 12k, 소형 무변화). 머지는 사용자 최종 확인 후.

## 2026-07-11 — CSV 검증 스크립트 owning_department 대응 + 실행 (worktree-pw-verify-owning-dept)
- `owning_department` 필수 필드(4e5a0f7)가 두 pw-verify 스크립트를 깨뜨림 — merge는 raw `POST /maps`에 부서 미포함 422, create-flow는 생성 다이얼로그 `Create`가 오우닝부서 미선택으로 disabled. 두 스크립트 다 이 필드 이전 작성.
- 수정: merge는 `/directory`에서 부서 id 얻어 POST 바디에 `owning_department` 추가. create-flow는 결재자 앞에 오우닝부서 피커 선택(첫 `Search by name` 입력) 추가, 없으면 남은 ⑥ 검사 스킵.
- 실측 실행(localhost): **create-flow 21/21**(클립보드 SKIP=secure context, drag-drop·createdRef NOT COVERED), **merge 31/31**(AI챗 2 NOT COVERED). 콘솔 에러 0, 시드 소프트삭제.
- merge ⑦ 접기잠금 FAIL은 스크립트 버그였음(제품 정상) — "Toggle inspector" 라벨 버튼이 둘(툴바 no-op enabled + 패널 접기 disabled), `.first()`가 툴바를 잡음. 불변식 기준(패널 접기 `[disabled]` + 툴바 클릭해도 Import 탭 유지)으로 교체. **csv-import-merge 브랜치 인스펙터 잠금이 코드리뷰 아닌 실행으로 처음 검증됨.**
- ⚠️ 클립보드 수정은 여전히 미검증 — localhost는 secure context라 SKIP. 평문 HTTP 서버(:3333)에서 `BASE_URL=http://<IP>:3333`로 재실행해야 실검증.

## 2026-07-11 — AI graph 제안 CSV 병합 통합 + 담당자/부서 기본 금지 설계 (main)
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-ai-graph-merge-design.md`. AI graph 전량 교체가 비교모드 무의미화 + 서브프로세스 링크 파괴("색 변경" 현상의 진짜 원인 — 타입이 process로 바뀌며 바이올렛 고정 해제)를 CSV 병합 파이프라인 완전 공유로 해결. 디렉터리 프롬프트 제거, 담당자/부서는 사용자 명시 요청 시에만.
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-ai-graph-merge.md` (5태스크: 백엔드 프롬프트→병합 진입점→page.tsx 전환→탭/카드 UX→브라우저 검증).
- 백엔드: 조직 디렉터리 프롬프트 제거, 담당자/부서는 명시 요청 시에만(규칙②)·미입력 힌트 축소(소요시간만).
- 병합 공용화: pick/mergeNode 모듈 추출(무변경) + buildGraphFromAiProposal(매칭 id 재사용·서브프로세스 보존·base 있으면 AI 그룹 무시) vitest 8종.
- 에디터: applyAiProposal(전량 교체) 폐기 → enterAiGraphPreview(병합 프리뷰, previewSource=csv 슬롯 공유+importOrigin), ops set_attr 서브프로세스 색 무시.
- UX: Import 탭 origin 라벨(AI/CSV)·챗 graph 카드는 안내 푸터(커밋 버튼은 ops 전용), i18n 2키.
- T5 브라우저 검증 + 최종 게이트 — `frontend/scripts/pw-verify-ai-graph-merge.mjs` 신규(맵2 draft, subprocess 노드 보유 시드로 4체크: ①graph 제안→Import 탭 노출 ②Apply 후 매칭 노드 id 불변+신규 노드 추가 ③챗 카드 안내 푸터 ④서브프로세스 node_type·linked_map_id 보존 +콘솔에러 0, 11/11 PASS). 브리프 골자에서 두 가지 조정: (a) 시드 draft 버전은 다른 사용자 체크아웃이 미리 걸려 있어(sticky 점유 데모) `force:true`로 인수해야 PUT /graph가 통과 — checkout 없이는 409/423; (b) 시드 그래프는 `node_type="process"`가 아니라 "task"/"subprocess"를 쓰고, AI 제안이 base의 start/end 노드를 echo하지 않으면 병합 결과에 시작 노드가 0개가 되어 백엔드 `validate_process`가 422 — 매칭 대상을 타입 무관 필터로 바꾸고 proposal에 start/end를 항상 echo하도록 수정. 맵 1 기본 선택 버전(published)은 편집 불가라 `?version=`으로 draft(id 12)에 직접 진입. 게이트 4종: pytest 538 passed·ruff 0에러·vitest 242 passed·tsc 0에러·lint(경고 1건, `pw-smoke-task8.mjs` 기존 미관련)·build 0에러.
- 완료: AI graph 병합 파이프라인 — 비교모드 유의미화·서브프로세스 보존. 배포 영향 없음(DB 무변경).
- 최종리뷰 픽스: 제안이 start/end 누락 시 base 유지(불투명 422 제거)·중복제목 테스트·ops 주석·카드 문구 중립화.

## 2026-07-11 — 오우닝 부서 누락 태그 위치·표기 변경 (worktree-owning-badge-move)
- 홈 카드의 누락 태그를 타이틀 행에서 우측 하단 카운트 자리(노드·버전·인원 수)로 이동 — 누락 맵은 카운트 대신 TriangleAlert + "No owning dept"(언어 무관 영어 고정, 역할/상태 패턴)로 대체 표시. data-id 유지로 pw-verify 스크립트 무변경. lint·tsc·build·vitest 234 초록.
- 누락 태그를 필 형태로 — `rounded-full bg-error/10`(토큰 color-mix 10% 반투명 틴트, recent-badge 필 패턴) + text-error. 빌드 CSS에서 유틸 생성 실측 확인. lint·build 초록.
- 태그 문구 "No owning dept" → "Dept unassigned" (사용자 선택 — 상태 서술·2단어, en/ko 사전 동일 영어). lint·build 초록.
- 우측 상세 카드(map-detail-card) 가시성·역할 필 행에 오우닝 부서 필 추가 — 지정 시 Building2 + 부서명(accent-tint 필, 한글명 우선 formatDeptName), 미지정 시 홈 카드와 동일한 "Dept unassigned" 반투명 경고 필. lint·tsc·build 초록.
- 상세 헤더 Open 버튼 삭제 + 필 3종(공개·역할·오우닝 부서)을 설명 아래에서 헤더 우측으로 이동(열기는 카드 타이틀 링크로 유지). 무용해진 `hideOpen` prop 제거 — 소비처 2곳(inspector 탭·에디터 page.tsx, 후자는 ugrep 브래킷 함정으로 tsc가 적발) 정리. lint·tsc·build·vitest 234 초록.
- 상세 헤더 공개·역할 필을 오우닝 부서 필과 동일한 반투명 필로 통일(+아이콘: Globe/Lock·Crown/PencilLine/Eye, 색 의미는 기존 visibilityPillClass·RoleBadge 유지 — public/editor=added, owner=accent, private/viewer=중립). 버전 타임라인은 최근 3개만 기본 노출 + "{n}개 더보기/접기" 토글, 접힌 카드 이벤트 칩은 1줄 고정(nowrap 잘림)·게시 칩은 우측 고정에 이름 생략(이름은 툴팁, 좌측 칩에서 제외). lint·tsc·build·vitest 234 초록.
- 버전 카드 "이 버전으로 가기" — 펼침 전용 버튼을 없애고 카드 호버 시 상태 필이 버튼으로 페이드 교체(grid 겹침 + opacity 전환, 이동 불가 카드는 상태 필 고정, 비호버 시 pointer-events 차단으로 오클릭 방지). 우측 생성일시는 제목과 세로 중앙정렬(items-center). lint·tsc·build·vitest 234 초록.
- 상태 필(+호버 버튼)을 버전 이름 바로 우측으로 — 이름 span의 flex-1 제거, 겹침 셀 justify-items-start(이름에 밀착·버튼은 오른쪽으로 성장). lint·tsc·build 초록.
- Current 배지 제거 — 기준이 "최신 생성 버전"(idx 0)일 뿐 열람 중/게시본과 무관해 정보가치 낮음(사용자 결정). 최신 카드의 연보라 하이라이트는 유지, 고아가 된 `home.verCurrent` 키 en/ko 삭제. lint·tsc·build·vitest 234 초록.
- 호버 스왑 정련 — "이 버전으로 가기"는 펼침 상태에서만(위치는 이름 우측 유지), 접힘 카드는 "Click for details" 안내 필로 스왑. 버튼 좌측 클릭 불가 버그 수정(투명 상태 필이 opacity<1 스태킹 컨텍스트로 위에 떠 클릭을 삼킴 → 필 pointer-events-none). 버튼 자체 호버는 accent 채움(hover:bg-accent+text-on-accent). i18n `home.verClickHint` en/ko. lint·tsc·build·vitest 234 초록.
- 스왑 크로스페이드 350→700ms(토큰 사다리 최장, "1초 정도" 요청 대응) — 호버 초반에 상태 필을 인지할 수 있게. 버튼 페이드는 래퍼로 옮기고 버튼 색 호버는 transition-colors 150ms로 분리(700ms면 굼뜸). lint·tsc·build 초록.

## 2026-07-10 — 후속 정비: 비교화면 로드 실패 처리 + AI 게이트/페이로드 잔무 (worktree-ai-followup-fixes)
- 비교화면 로드 effect 3곳 try/catch — 403은 에디터와 동일한 비공개 맵 안내 모달(홈 이동), 그 외는 인라인 오류 표시로 무한 로딩 제거. 브라우저 검증 `pw-verify-compare-403.mjs` 4/4(403 모달·홈 이동·500 인라인·정상 무회귀).
- AI 게이트/페이로드 리뷰 잔무 3건: public 맵 `/graph/all` 게이트 assert, toPayload walkthrough vitest, 스모크 check17 `.catch`+detail. 덤: `chat-sessions.test.ts:82` never 타입 에러 수정 — 직전 픽서의 "tsc 0 errors" 보고가 허위였고 next build는 테스트 파일 타입 에러로 안 깨져 잠복(이후 게이트에 tsc --noEmit 상시 포함).

## 2026-07-10 — 맵 필수 필드 '오우닝 부서' 설계
- 모든 맵에 책임 부서 필수화 설계 확정 — 생성 시 지정 필수(모든 조직 레벨), 파생 권한 방식(권한 행 없이 `effective_role`에서 오우닝 부서 소속 = editor 바닥값)으로 잠금 에디터 구현, 부서 리더 자동 승인자(제거 가능)·피커 우선 노출, 기존 맵은 NULL=누락 + 설정 owner/sysadmin 수동 지정 + 홈 필터·배지. `docs/superpowers/specs/2026-07-10-owning-department-design.md`.
- 구현 계획 작성 — 8태스크(백엔드 3·프론트 4·시드/검증 1), `docs/superpowers/plans/2026-07-10-owning-department.md`. 기존 테스트 52곳의 생성 호출엔 **앵커 부서**(어떤 테스트 액터도 소속되지 않는 시드 직원 org)를 주입해 파생 editor가 기존 403 단언을 오염시키지 않게 한다. `MapCreate` 필수화로 프론트 미반영 중간 커밋은 맵 생성이 불가하므로 워크트리 브랜치에서 원자적으로 머지.
- T1 백엔드 — `process_maps.owning_department` 컬럼 + `MapCreate` 필수 필드 + 라우터 `_assert_known_department`(known org_path 아니면 422) + copy 상속. conftest에 `owning.anchor`(비활성) 앵커 부서 시드, 기존 테스트 52곳에 앵커 부서 주입(sed 기계적 + 분할라인 1곳 수동). pytest 526 passed·ruff 0에러.
- T2 백엔드 — `logic.effective_role`에 `owning_department: str | None = None` 키워드 추가, grants 루프와 baseline 사이에 소속(prefix 하위 포함)이면 editor 바닥값 삽입(권한 행이 없어 해제·다운그레이드 불가="잠금"). 호출부 3곳(`access.py` get_effective_role/get_eligible_users, `maps.py list_maps`) 패스스루. 순수 로직 4 + enforce 통합 3 테스트, pytest 533 passed·ruff 0에러.
- T3 백엔드 — `PUT /maps/{id}/owning-department`(owner 게이트, `OwningDepartmentIn` 스키마, `_assert_known_department` 재검증) 추가, 레거시 NULL 맵의 최초 지정도 동일 엔드포인트로 처리. `POST /maps/{id}/permissions`에 오우닝 부서와 동일 department principal이면 409 가드(하위/상위 부서 grant는 허용). MapPermission 삽입 없음 — 컬럼만 갱신하면 파생 editor가 자동으로 새 부서를 따라간다. 스펙 문서 "중복 방지 가드" 400→409 정정. 신규 5 테스트, pytest 538 passed·ruff 0에러.
- T4 프론트 — `api.ts` 인터페이스 `MapSummary.owning_department` 필드 + `setOwningDepartment()` 함수, `principal-picker.tsx` `pinnedIds` prop + 브라우즈 IIFE로 핀 고정 + 배지 로직 확장, i18n 키 `perm.principalDeptLead` (en/ko). npm run lint·build 0에러.
- T5 프론트 — `createMap()` 4번째 인자 `owningDepartment` 필수화(호출부 1곳 동반 갱신), 생성 모달에 오우닝 부서 필드(피커→선택 후 잠금 표시+X 재선택) 추가·생성 게이트에 편입, 부서 리더 자동 승인자(제거 가능·부서 재선택 시 자동분만 교체)·`pinnedIds`로 승인자 피커 상단 고정, 오우닝 부서 소속원을 private 승인자 후보군에 편입, 협업자 목록에 잠금 행 노출. i18n 키 `perm.owningDept.*` (en/ko). npm run lint(경고 1건 무관)·build·vitest 234 passed.
- T5 리뷰 픽스 — `autoLeaderRef` 상태 오염 2건: ⓐ `applyOwningDept`가 dedup으로 실제 추가 안 했을 때도 리더를 auto로 기록해 수동 추가분이 clear 시 삭제되던 버그(실추가 시에만 ref 기록), ⓑ 자동 추가된 리더 pill을 수동 제거해도 ref가 남아 재선택/clear가 동명 수동 재추가분을 지우던 버그(`handleRemoveApprover`를 plain 함수로 전환·제거 대상이 추적 리더면 ref 해제). lint·build·vitest 234 passed.
- T6 프론트 — 설정 화면에 오우닝 부서 Assign/Change(owner 게이트) + 협업자 잠금 행 추가. `map-details-panel.tsx`에 부서 표시/피커 블록(미지정 시 경고+Assign, 지정 시 잠금뱃지+Change), `collaborators-panel.tsx`에 합성 잠금 행(MapPermission 미생성, 표시 전용) 추가, `settings/page.tsx`에 `owningDepartment` state 배선(초기 로드+refreshMap 양쪽) + `isOwner`/`onChanged` prop 전달. i18n 키 `perm.owningDept.title/missingNotice/assignBtn/changeBtn/saved` (en/ko). npm run lint(경고 1건 무관)·build 0에러.
- T6 리뷰 픽스 — 협업자 패널에서 잠금 행이 보이는데 "No collaborators yet."이 같이 뜨던 자기모순 UI 수정: 빈 목록 안내를 `perms.length === 0 && !owningDepartment`일 때만 렌더(오우닝 부서는 권한 행을 만들지 않아 신규 맵 대부분이 두 문구를 동시 노출하던 문제). lint(경고 1건 무관)·build 0에러.
- T7 프론트 — 홈에서 오우닝 부서 누락 맵 구분: 카드에 "No owning dept" 배지(departed 배지와 동일 error 톤), Owning 필터 드롭다운(누락-only 토글, sessionStorage 영속·listKey·Clear 편입), i18n `home.filterOwning/owningMissing*` (en/ko). ⚠️ 구현 에이전트가 메인 체크아웃에 커밋한 것을 cherry-pick으로 워크트리 이관 후 main은 원복. npm run lint/build 0에러.
- T8 시드+브라우저 검증+최종 게이트 — `seed_org_demo.py` `_seed_maps`에 idx%3==0 맵만 오우닝 부서 누락으로 남기는 2/3·1/3 분배 추가(brief 코드 그대로). `frontend/scripts/pw-verify-owning-dept.mjs` 신규 — brief 6시나리오 + 리뷰 요청 2건(리더 수동추가·오우닝 dedup 겹침, 협업자 빈 문구 공존 금지) 총 29체크. **SETUP 필요**: `seed_org_demo.py`가 `DeptInfo`(부서장)를 시드하지 않아(어드민 JSON 임포트 전용) 리더 자동추가·핀고정 시연이 불가능했던 갭을 스크립트가 실행 시점에 `/api/admin/dept-info` PUT으로 부서장 1명을 런타임 심어 메움(디렉터리에서 동적 선택, 하드코딩 아님) — dev.db에 영구 반영, 완전 복원은 `git checkout backend/dev.db`+백엔드 재시작. reset_db 직후 클린 실행 29/29 PASS·console errors 0(재실행은 ⑥의 시드 맵 영구 변경으로 "count=4" 단언이 count=3으로 어긋날 수 있음 — 재현 아님, 클린 1회 실행 기준). 스크립트는 관례상 `frontend/scripts/`에 둠(brief는 `backend/scripts/`라 적었으나 기존 pw-verify-*.mjs 9개 전부 frontend/scripts/에 있고 playwright-core도 frontend에만 설치되어 그쪽이 맞음 — cwd 불일치를 바로잡음). 시나리오 ⑧은 통과했지만 구조적으로 비판별적 — `create_map()`이 항상 owner 권한 행을 삽입해 `perms.length === 0`이 어떤 맵에서도 참일 수 없으므로 T6 수정("No collaborators yet." 가드)을 실질 검증하지 못함. 게이트 4종: pytest 538 passed·ruff 0에러·vitest 234 passed·lint(경고 1건, `pw-smoke-task8.mjs` 기존 미관련)·build 0에러.
- 최종 리뷰 마감 3건 — 부분실패 안내 문구에 오우닝 부서 언급 추가(재시도 시 미반영 사실을 숨기지 않도록, en/ko), 협업자 패널 잠금 행에 `!loading` 게이트 추가(스켈레톤과 동시 노출 방지), 홈 필터 sessionStorage 복원 시 `owningFilter` 값을 UI가 만들 수 있는 `"missing"`으로만 좁힘(임의 문자열 복원 시 전체 맵 필터아웃 방지). lint(경고 1건 기존·미관련)·build 0에러·vitest 234 passed.

## 2026-07-10 — CSV로 새 맵 만들기 + 클립보드 수정 설계 (worktree-csv-create-flow)
- **클립보드 버그 확정**: 복사 4곳(`csv-template-actions.tsx:32`, `markdown-view.tsx:179·188·198`)이 전부 `navigator.clipboard?.writeText()`. `navigator.clipboard`는 secure context 전용인데 서버는 원격 IP + 평문 HTTP → `undefined`. `?.`가 삼켜 **에러 없이 실패하고 버튼은 "복사됨!"을 띄운다**. localhost는 secure context라 재현 안 됨(`CLAUDE.md` 경고 그대로).
- 3조각 설계 — Ⓐ `lib/clipboard.ts` `copyText()`(execCommand 폴백 + boolean 반환, 호출부 4곳이 실패를 표시) Ⓑ 백엔드 `csv_manual_url`(Settings→`/api/me`, `manual_url`과 동일 경로, DB 무변경) Ⓒ 홈 분할 버튼 → CSV 드롭존 모달(요약 확인) → `CreateMapDialog`에 파일 아코디언·이름/설명 프리필·`createdRef` 재시도. `docs/superpowers/specs/2026-07-10-csv-create-flow-design.md`.
- 생성 시점엔 `listEligibleAssignees(versionId)`를 못 쓴다(버전 부재) → `getDirectory()`로 `CsvDirectory` 조립. 순수 함수 `stripCsvExtension`·`toCsvDirectory`만 TDD, 클립보드는 vitest가 node 환경이라 **단위 테스트 불가**(브라우저·평문 HTTP 오리진에서 검증).
- 구현 계획 작성 — 7태스크 34스텝, `docs/superpowers/plans/2026-07-10-csv-create-flow.md`. `execCommand`는 사용자 제스처 안에서 **동기 호출**해야 하므로 insecure 분기는 `await` 전에 실행한다. `CreateMapDialog`는 `map-name-dropdown.tsx`도 마운트하므로 `csv` prop은 반드시 optional.
- Ⓐ `lib/clipboard.ts` `copyText()` — insecure context면 textarea+execCommand 동기 폴백, 성공 여부를 boolean으로 반환. 호출부 4곳이 실패 시 성공 표시·onCopy를 내지 않는다. 단위 테스트 불가(vitest node 환경) — 브라우저·평문 HTTP에서 검증. vitest 219·lint 0에러.
- Ⓑ 백엔드 `csv_manual_url` — Settings → `MeOut` → `/api/me`(기존 `manual_url`과 동일 경로, DB 무변경). `.env.example`에 `CSV_MANUAL_URL=`. pytest +1.
- Ⓒ 순수 헬퍼 `stripCsvExtension`·`toCsvDirectory` — 생성 시점엔 `listEligibleAssignees(versionId)`를 못 써서 `/api/directory`로 담당자/부서를 해석한다. departments는 말단명(org_path 아님). vitest 231·lint 0에러.
- Ⓒ `CsvTemplateActions`에 CSV 매뉴얼 버튼(값 없으면 숨김) + 프롬프트 버튼 라벨을 "다른 AI에게 부탁하기"로. 에디터 임포트 모달도 같은 컴포넌트라 함께 적용. vitest 231·lint 0에러.
- Ⓒ `CreateMapDialog`에 optional `csv` prop — 파일명 아코디언(요약·경고 펼침), 이름·설명을 확장자 뗀 파일명으로 프리필, `createdRef`로 저장 실패 후 맵 재생성 없이 재시도. `createNotice`·`sectionTitle` 키 제거. vitest 231·lint 0에러.
- Ⓒ 홈 분할 버튼(쉐브론 → "CSV로 새 맵 만들기") + `csv-create-modal.tsx` — 드롭존(클릭=탐색기, 드래그&드롭)·양식/매뉴얼/프롬프트 3버튼·파싱 에러 차단·요약 2단계. 디렉터리 로드 전 [확인] 비활성. `csv` prop이 앞 커밋에서 선반영돼 이 커밋 단독으로 빌드 초록.
- Ⓒ 리뷰 픽스 — 쉐브론 메뉴가 다이얼로그 뒤에 남던 문제(stopPropagation 범위 축소·좌측 버튼이 메뉴 닫음), 임포트 실패 경로가 성공 토스트를 띄우던 문제(`onCreated(silent)`), `getMe()` 실패가 모달 전체를 막던 문제(디렉터리와 분리), 디렉터리 로드 전 드롭이 조용히 무시되던 문제(로딩 상태·비활성). vitest 231·lint 0에러.
- Ⓒ 브라우저 검증 스크립트 `pw-verify-csv-create-flow.mjs` — 클립보드(평문 HTTP 오리진에서만 유효)·분할버튼·파싱 에러 차단·프리필·아코디언·담당자 해석 경고·매뉴얼 버튼 7시나리오. **아직 미실행**(서버 필요).
- Ⓒ 전체 리뷰 픽스 — 맵 생성 후 협업자/결재자 단계가 실패하면 고아 맵이 목록에도 안 뜨고 재시도가 이름 409로 막히던 문제. `createdRef`를 `createMap` 직후 기록하고, 비멱등인 `addMapPermission`은 `grantedRef`로 건너뛰며, 멱등 PUT인 `setMapApprovers`는 매번 재전송. 바깥 catch가 `onCreated(true)`로 고아를 노출. 디렉터리 로드 실패 시 드롭존 비활성. vitest 231·lint 0에러.

## 2026-07-10 — CSV 임포트 머지 전환 설계 (worktree-csv-import-merge)
- 원인 규명: 임포트 후 비교가 전부 변경으로 잡는 건 비교 버그가 아니라 임포트의 전체 교체 탓 — ⓐ `diff.ts:203` `edgeKey`가 노드 계보 키만 써서 새 id면 전 엣지 오탐, ⓑ `NODE_DEFAULTS`(`csv-import.ts:104`)가 color/assignee/department/group_ids를 초기화해 정당한 `changed` 유발. 덤으로 코멘트(`graph.py:194`)·그룹까지 삭제 중.
- 해법: 프론트에서 제목 일치 노드의 **id를 재사용**하면 `graph.py:242` upsert가 제자리 UPDATE라 계보·코멘트·그룹이 보존되고 엣지 키가 안정된다. **백엔드 변경 0줄.**
- 3단계 설계 확정 — ① 새맵 다이얼로그는 템플릿 다운로드+프롬프트 복사만(+노티스), 생성 후 항상 에디터 이동 ② 이름 기준 머지 임포트(서브프로세스 `node_type` 보존) ③ 캔버스 프리뷰(`data.diffStatus` 재사용)+인스펙터 Import 탭(삭제/유지 선택, 탭·접기 잠금). `docs/superpowers/specs/2026-07-10-csv-import-merge-design.md`.
- 구현 계획 작성 — 9태스크 42스텝(태스크당 1커밋), `docs/superpowers/plans/2026-07-10-csv-import-merge.md`. 컴포넌트 테스트가 0개(전부 `lib/` 순수 모듈)라 TDD는 `csv-import.ts`·`diff.ts`에만 적용하고 UI는 lint·build·브라우저 실검증으로 확인. 신규 노드 부분정렬은 `buildGraphFromCsv` 안에서 1회만(프리뷰 재실행 금지 — 앵커 어긋남).
- ①-b 설명·담당자·부서 컬럼 추가 결정 — CSV 9열. 담당자는 login_id로 적고 임포트가 `eligible` 디렉터리로 이름 해석(이름 직접 표기도 통과), 부서는 정식명 또는 한글명, 미해석은 원문 저장 + 비차단 경고. 설명은 `Text` 컬럼이라 길이 제한 없음(`MAX_LEN` 제외). **백엔드는 담당자를 검증하지 않는다**(`NodeIn`은 길이만) — 안전망은 프론트 드리프트 배지뿐.
- **빈 셀 = 기존 값 유지**를 전 속성 열에 일관 적용. 근거: AI 프롬프트(`csv-import.ts:395`)가 "불명확한 속성은 비워두라"고 지시하므로 빈 칸이 값을 지우면 AI 생성 CSV 재임포트마다 속성이 전멸한다. `Next`만 예외(빈 값 = 말단).
- `docs/samples/*.csv` 3종이 이미 낡음(헤더에 `URL_Label` 누락, 파서의 열 부분집합 허용이 은폐) — 9열로 재작성 예정.
- ① 새맵 다이얼로그 축소 — CsvTemplateActions 추출(템플릿·프롬프트만), 노티스 추가, 생성 후 항상 에디터 이동. `mapCreatedImportFailed` 키 제거. vitest 162·lint 0에러.
- ①-b CSV 컬럼 확장 — Description(길이 제한 없음, Text 컬럼)·Assignee(login_id→이름 해석, 이름 직접 표기도 통과)·Department(한글 부서명→정식명) + 비차단 경고(미해석 담당자·미지 부서·부서 불일치). 백엔드는 담당자를 검증하지 않아 프론트 드리프트 배지가 유일한 안전망. vitest 174·lint 0에러.
- ①-b 템플릿·AI 프롬프트에 Description·Assignee(계정 id)·Department 규칙 추가, "빈 칸=건드리지 않음" 명시. `docs/samples/*.csv` 3종은 헤더가 URL_Label 없이 낡아 있어 9열로 재작성. vitest 174·lint 0에러.
- ② `buildGraphFromCsv(text, context?)` 이름 기준 머지 — 제목 일치 노드 id 재사용(계보·코멘트·그룹 보존), 빈 셀=기존 값 유지, 서브프로세스 node_type 보존, 신규 노드만 부분 dagre. `withKeptNodes` 추가. vitest 191·lint 0에러.
- ② 에디터 배선 — CsvImportSection `context`(base + eligible 디렉터리), 요약/확인 모달을 추가·갱신·삭제 실카운트로, 행 경고 노출, Import 버튼을 `eligible !== null`로 게이팅. vitest 191·lint 0에러.
- ② 비교 회귀 테스트 `diff.test.ts` 신설 — 클론+머지 시나리오에서 미변경 엣지가 오탐되지 않고 실제 변경만 잡히는지 6케이스. vitest 197.
- ③ 프리뷰 상태 기계 일반화(`aiPreviewRef`→`previewRef` + `previewSource`) + CSV 머지 프리뷰 진입/확정/취소. 소멸 노드·엣지 `diffStatus`/빨간 점선. 확인 모달 폐지. vitest 197·lint 0에러. ⚠️ Apply/Cancel UI는 다음 커밋(Import 탭).
- ③ 인스펙터 Import 탭(`forcedTab`/`lockTabs`, 프리뷰 중 다른 탭·접기 잠금) — MarkdownView 요약 + 행 경고 + 소멸 노드 React 리스트(클릭→캔버스 포커스) + 삭제/유지 세그먼트 + Apply/Cancel, 버튼별 리치 툴팁. vitest 197·lint 0에러.
- ③ 리뷰 픽스 — ConfirmDialog 폐지로 고아가 된 i18n 키 3종 제거, 인스펙터 잠금 조건을 `importSlot`과 단일 조건으로 통일(잠복 덫 제거), `tabIntro` 플레이스홀더 `{updated}`→`{matched}`. vitest 197·lint 0에러.
- ③ 전체 브랜치 리뷰 픽스 — AI/CSV 프리뷰 상호 배타(중첩 시 미승인 AI 그래프가 자동저장되던 데이터 안전 버그), `previewRef`를 소스 유니온으로 통일, 고아 `disabled` prop 제거, 폐기된 설계문서 참조 갱신. vitest 197·lint 0에러.
- ③ 브라우저 검증 스크립트 `pw-verify-csv-import-merge.mjs` 작성 — 프리뷰 충돌·머지 후 비교 무오탐·빈 셀 보존·삭제/유지·담당자 해석 경고·서브프로세스 보존·인스펙터 잠금 7시나리오. **아직 미실행**(서버 필요) — 실행 명령은 스크립트 헤더 주석 참조.

## 2026-07-10 — SearchSelect 드롭다운 포털화 + 노드 편집 모달 스크롤 (worktree-select-portal)
- 버그: BPM 속성의 부서 드롭다운이 `absolute`라 노드 편집 모달(`overflow-hidden`)·인스펙터(`overflow-y-auto`)에 잘림. `elementFromPoint`로 실측 — 모달은 전 높이에서, 인스펙터는 vh≤620에서 아래 모서리가 가려짐.
- `search-select.tsx` 기본 모드도 addMode처럼 **body 포털 + fixed**로. 좌표는 트리거 rect 기준(`computeMenuPos`: 아래 우선 → 위 → 클램프, `fitContent`면 우측 정렬), 열린 동안 `resize`/`scroll`(capture) 재계산, 닫힘 시 좌표 비움. z=1350(백드롭 1340) — 노드 모달(1200)·서브프로세스 모달(1300) 위.
- `node-summary-modal.tsx` 본문에 `min-h-0` + `scrollbar-hidden`. flex 자식의 `min-height:auto`(=min-content)가 축소를 막으면 `overflow-y-auto`가 죽고 카드의 `overflow-hidden`이 선행/후행 내비를 잘라 닿을 수 없게 되는 잠복 결함. 스크롤바만 감추고 스크롤은 유지.
- ⚠️ 사용자가 보고한 "모달 세로 스크롤 소실"은 400~800px 전 구간에서 **재현 실패**(본문은 항상 스크롤됨). 위 `min-h-0`은 원인 가설에 대한 선제 방어이며, 재발 시 창 크기·노드 내용 필요.
- 검증: `scripts/pw-verify-search-select-portal.mjs` 20/20(4개 높이 × 인스펙터·모달, 콘솔 에러 0) · 기존 스모크 21/21·10/10 회귀 없음 · vitest 184 · lint 0에러 · build.

## 2026-07-10 — 인원 카드 부서명 한글화 (worktree-korean-dept-card)
- 버그: 한글 모드에서 이름은 한글인데 부서명이 전부 영문. `map-detail-card.tsx`가 부서 표시에 `dept_info.korean_name`도 `employees.korean_dept`도 **한 번도 읽지 않았다** — 영문 org 세그먼트만 렌더.
- 수정 4곳(유저 행 말단 부서 · 펼침 레벨 필 · 팀 행 이름 · 팀 행 호버 상위 경로). 순수 함수 3종 신설: `buildKoreanDeptByPath`(확정 dept_info 우선, 없으면 직원 신고 korean_dept 폴백) · `buildOrgPathChain` · `formatDeptName`(ko=한글||영문, en=영문). 아이콘 레벨 판정·정렬은 영문 리프 유지.
- 폴백은 직원이 실제 소속된 말단 경로만 채운다 — 상위 조직은 dept_info 임포트 전엔 영문. 데이터 없는 한글명을 지어내지 않는다.
- 실측(한글 모드): 「지원팀」(korean_dept 폴백) · 「배송실」(dept_info) · 「Operations Center」(둘 다 없음 → 영문). 영어 모드는 무변경. vitest 184 · lint 0에러 · build · `pw-verify-hotfix-ui-6.mjs` 21/21.

## 2026-07-10 — 새 맵 모달: 죽은 여백 제거, 시작 위치 상향 (worktree-modal-top)
- 직전 `pb-40`(160px) 철회 — 긴 화면(≥900px)에서 스크롤 없이 액션행 위 죽은 여백만 남았다. 빈 패딩으로 스크롤을 만들지 않는다.
- 모달 시작 위치 `pt-8`→**`pt-4`**, `max-h` `100dvh-4rem`→**`100dvh-2rem`**. 1280 폭 실측: 900px 이상에서 모달 833px·스크롤 0, 500px에서도 액션 버튼 화면 안(스크롤 컨테이너 밖이라 밀리지 않음).
- 드롭다운 방향은 배치 알고리즘에 일임 — 뷰포트 ≥1000px면 아래 5줄, 미만이면 옆. 잘림·위 flip 없음.
- 실측: vitest 172 · lint 0에러 · build 통과 · `pw-verify-hotfix-ui-6.mjs` 21/21(콘솔 에러 0).

## 2026-07-10 — 새 맵 모달 상단 정렬 + 하단 패딩 (worktree-modal-tall)
- 사용자 피드백 반영: 모달을 중앙 정렬에서 **상단 정렬(`items-start pt-8`)**로, `max-h`를 `100dvh-13rem` → `100dvh-4rem`으로 늘려 세로를 최대한 쓴다. 본문 스크롤 컨테이너에 `pb-40`(160px) 추가 — 마지막 결재자 피커를 그만큼 위로 올릴 수 있어 드롭다운이 뷰포트 높이와 무관하게 아래로 열린다(끝까지 스크롤 시 피커 아래 ≈265px).
- 대가: 본문이 스크롤되지 않는 긴 화면(≥1080px)에선 `pb-40`이 액션행 위 빈 여백으로 남는다(모달 993px). 짧은 화면에선 스크롤 여유로 소비.
- 실측: 1280×580 모달 32~548(이전 372px 중앙) · vitest 172 · lint 0에러 · build 통과 · `pw-verify-hotfix-ui-6.mjs` 20/20(콘솔 에러 0).

## 2026-07-10 — 핫픽스 UI 6 설계 (worktree-hotfix-ui-6)
- 4항목 설계 확정 — ① Back to editor 테두리 버튼, ② 피커 드롭다운 portal+fixed(아래 우선/부족하면 옆, 위 flip 금지), ③ 마스터-디테일 breakpoint 1280→980(`--breakpoint-split`) + 공지·인박스 탭 확대 적용, ④ 부서 tree JSON 임포트(파서 교체 + 백엔드 `known`을 org 전 레벨로 확장). `docs/superpowers/specs/2026-07-10-hotfix-ui-6-design.md`.
- 조사: 피커는 이미 floating이었고 밀림 원인은 `scrollIntoView` 반창고 — 진짜 문제는 모달 본문 `overflow-y-auto` 클리핑. `/api/directory`는 이미 전 org 레벨을 내려주므로 `known` 확장만으로 상위 부서 한글 검색·부서장 체인이 켜짐.
- T1 Back to editor를 테두리 컴팩트 버튼(ArrowLeft 16px/1.5, `self-start`)으로. T2 피커 드롭다운을 body portal + fixed로 옮기고 `scrollIntoView` 제거 — 배치는 `lib/dropdown-placement.ts`(아래→오른쪽→왼쪽→축소, 위 flip 없음). T3 생성 모달 `max-h`를 `100dvh-13rem`으로 낮춰 580px에서도 드롭다운이 아래로 열림. vitest 170·lint 0에러·build 통과.
- T4·T5 마스터-디테일 분기점을 `xl`(1280) → 커스텀 `--breakpoint-split`(980px)으로. 공지·인박스(알림·승인)도 맵 탭과 같은 아코디언 패턴 적용 — 상세를 `NoticeDetail`/`NotificationDetail`로 추출해 우측 패널과 아코디언이 공유. vitest 170·lint 0에러·build 통과.
- T7 브라우저 실측 검증 2종 통과 — `pw-verify-hotfix-ui-6.mjs` 19/19(밀림 0px·드롭다운 미클리핑·below/right 배치·3탭 940↔1100 전환·레일 버튼), `pw-verify-dept-tree-import.mjs` 10/10(모달 업로드 updated=4·상위 레벨 한글명 조인·본부/실 한글 검색·부서장 이름 검색). 콘솔 에러 0. 검증 중 `perm.backToEditor` 문자열에 박혀 있던 `←` 글리프(main의 기존 이중 화살표 버그) 제거.
- T6 부서 임포트를 조직도 tree JSON(`enDeptNm`/`deptNm`/`dheadUserId` + `children` 재귀)으로 교체. 백엔드 `import_dept_info`의 현존 부서 판정을 `org_l1~l5 ∪ department`로 확장 — 상위 부서(본부·실)에도 dept_info가 생겨 피커 상위 부서 한글 검색과 `/api/me` 상위 부서장 체인이 처음으로 동작. 부서장은 login_id만 저장하고 이름은 생성 다이얼로그가 디렉터리로 조인해 검색 키워드에 합침. `test_directory`의 "상위 프리픽스엔 dept_info 없음" 전제가 깨져 미임포트 부서로 교체. vitest 172·pytest 510·ruff·lint·build 통과.

## 2026-07-10 — AI 권한 게이트 + 페이로드 저장 설계 (main)
- AI 챗·그래프 조회 viewer 게이트 + `ai_chat_messages.payload` 저장(카드 히스토리 재현) 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-10-ai-gate-payload-design.md`. 사용자 결정 3건(게이트 범위=AI+그래프 GET 2종, 과거 graph/ops=읽기전용, 카드=메시지 부착형 통일).
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-10-ai-gate-payload.md` (6태스크: 게이트→payload 백엔드→뷰모델→카드 통일→프론트 영향 점검→스모크·enforce 검증).
- 게이트 1/2: ai/chat·graph GET 2종에 require_version_map_role("viewer") 부착 + 게이트 테스트 6종.
- 페이로드 1/2: ai_chat_messages.payload TEXT(+_ADDED_COLUMNS)·kind별 서브셋 직렬화·조회 시 오염 NULL 강등.
- 페이로드 2/2 준비: 프론트 뷰모델 kind/payload 보존·toPayload(vitest).
- 픽스: chat-sessions 테스트 TS 컴파일 에러 2건(payload 필드 누락·리터럴 widening) — tsc 게이트로 검출.
- 카드 통일: 분리 state 제거→메시지 부착(ai-chat-cards.tsx), graph/ops 읽기전용 요약+라이브 커밋 카드 부착, 히스토리 워크스루 자동재생 없음.
- 프론트 영향 점검: 그래프 GET 호출처 5곳(editor 3·compare 2) 전수 조사 — 전부 선행 `getMap` viewer 게이트 통과 후에만 호출돼 신규 403 노출 없음(compare 페이지의 getMap 자체 에러 미처리는 Task1 이전부터의 기존 결함, 크래시 아닌 무한 로딩).
- 픽스: `highlightNode`에 사라진 노드 가드(`nodesRef.current.some`) 추가 — 히스토리 카드가 삭제된 노드를 가리킬 때 전체 deselect + 원점(0,0) fitView 점프 방지.
- Task 6(스모크·enforce 검증, 브랜치 마지막): `pw-smoke-ai-chat-history.mjs`에 체크 17(SMOKE-second에 `kind="analysis"` payload 메시지 시드 → `page.reload()` 후 `[data-id="ai-analysis-card"]` 재현 확인) 추가 + 기존 로딩-팁 대기에 `.catch()` 방어(크래시 방지, 판정은 그대로 FAIL 기록). 실행 결과 17개 체크 중 15개는 항상 PASS(신규 체크 17 포함), 체크 "3a/3b"(SMOKE-paging 초기 30개 로드)만 4회 중 3회 간헐적 FAIL — 원인은 `ai-chat-panel.tsx:285-290`(새 메시지 로딩 시 하단 스크롤 effect)과 `:564-569`(`onScroll`의 `beginLoadOlder` 상단 트리거)의 레이스: 30개가 패널 높이를 넘겨 스크롤 가능해지는 순간 브라우저 scroll-anchoring이 `scrollTop=0`인 중간 스크롤 이벤트를 발생시켜 `beginLoadOlder`가 오발동, 아직 스크롤 안 한 시점에 다음 페이지(10개)를 미리 당겨온다(초기 30 대신 40으로 관측). `git diff`로 대조 확인 — 이 두 구간은 Task 1~5가 건드리지 않은 기존 코드라 이번 브랜치의 회귀가 아님(선재 결함, 픽스는 스코프 밖 — 무단 수정 안 함, 컨트롤러 판단 필요).
- enforce 수동 검증(`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=true`, port 8000, private map=2/version=11): ① 무권한 유저(`bora.choi`) GET graph → **403**, ② 동일 유저 POST ai/chat → **403**, ③ viewer 권한 유저(`doyun.lim2`) GET graph → **200**(실 데이터) + POST ai/chat → **502**(AI 서버 미구성 — 게이트 통과 확인, 403 아님). 3케이스 전부 기대대로.
- 최종 게이트: backend pytest 521 passed · ruff 0 · frontend vitest 234 passed(18 files) · lint 0 errors(1건 pre-existing 경고) · build 성공(10 라우트).
- **배포 노트**: 서버는 startup `_ADDED_COLUMNS`가 `ai_chat_messages.payload` 컬럼을 자동 보강 — 별도 수동 DDL 불요.
- 최종리뷰 픽스: toPayload graph 판정을 백엔드 규칙(nodes|edges|groups)과 정렬 + stale 주석 정리.

## 2026-07-10 — 문서 정리: 완료 SDD 문서 삭제 + PROGRESS compact (main)
- `docs/superpowers/` 완료 plans·specs 72개 + editor-compare-redesign 에셋(1.9MB) + `docs/frontend-compare-verification.md` 삭제 — 최근 2건(ui-batch2·member-card-icons)만 유지, 전부 git history에 보존.
- PROGRESS.md 1713→321줄 compact — 2026-07-07 이후 원문 유지, 06-11~07-06은 기능 단위 요약(`## 이전 이력 compact` 섹션).
- 워크트리 `ui-improvement-3`·로컬 브랜치 정리(main 머지 확인 후). 원격 `origin/worktree-ui-improvement-3`은 별도 삭제 필요.

## 2026-07-09 — UI 개선 배치 2 설계 (worktree-ui-improvement-5)
- 7항목 설계 확정 — 새맵 모달 dvh+숨김 스크롤·맵 목록 가로스크롤 방지·전체맵 권한>시간 정렬(순수 간격)·허용인원 역할 간격·서브프로세스 노트 축약·노드 표시 URL(라벨/LINK)·URL 배지(좌상단 표시 전용). `docs/superpowers/specs/2026-07-09-ui-batch2-design.md`.
- 구현 계획 작성 — 8태스크(항목당 1커밋 + 통합 시각 검증), `docs/superpowers/plans/2026-07-09-ui-batch2.md`. URL 배지는 좌상단이 코멘트 배지와 충돌해 좌하단으로 정정(사용자 확인).
- ① 새맵 모달 max-h-[calc(100dvh-2rem)]·본문 scrollbar-hidden 내부 스크롤. vitest 147·lint 0에러.
- ② 맵카드 목록 overflow-x-hidden — 가로 스크롤 방지(카드 min-w-0는 T8 실측 후 판단). vitest 147·lint 0에러.
- ③ 브라우즈 전체맵 owner→editor→viewer·updated_at 정렬 + 역할 경계 순수 간격(h-2). vitest 147·lint 0에러.
- ④ 허용 인원 타입 그룹 내 역할 정렬(owner→editor→viewer)·클러스터 간격(h-1.5) — 홈·인스펙터 공용. vitest 147·lint 0에러.
- ⑤ 서브프로세스 노트 한 줄 축약 + 전체 문구 툴팁(spNoteFull, EN/KO) — 속성탭·Map 탭 공용. vitest 147·lint 0에러.
- ⑦ 노드 표시 필드 nodeType→url(라벨 있으면 라벨, 없으면 LINK, subprocess는 spUrl/spUrlLabel) — localStorage 위생은 기존 hydration 필터가 처리. vitest 147·lint 0에러.
- ⑧ 노드 URL 배지 좌하단 표시 전용(액센트 틴트·툴팁=URL) — 좌상단은 코멘트 배지와 충돌해 위치 정정, 비교뷰는 data 미탑재로 자동 미표시. vitest 147·lint 0에러.
- ⑨ Map 탭 협업자 기본 접힘 + 서브프로세스 카드 엣지 스타일 아래로 이동(사용자 추가 요청). vitest 147·lint 0에러.
- ⑩ 노티스·인박스 빈 여백 클릭 = 선택 해제(맵 탭 패턴 미러, 카드·상세 stopPropagation). vitest 147·lint 0에러.
- ⑪ 피커 바깥 클릭 닫힘(검색어 유지·재검색)·전체 지우기 X 버튼 — principal-picker(open 상태화+scrollIntoView)·search-select(검색어 보존)·transfer 다이얼로그(X만). vitest 147·lint 0에러.
- ⑬ 분기(마름모) 노드 코너 배지 안쪽 12px 조정(배지 position prop화, 타 노드 무변경). vitest 147·lint 0에러.
- ⑭ 미니맵 페이드 줌 기준 교체 — ≥90% 유지·90→40% 선형 감소·≤40% 소멸. vitest 147·lint 0에러.
- ⑮ Alt+←/→ 좌측 사이드바·우측 인스펙터 토글 + More shortcuts 플라이아웃 항목 추가. vitest 147·lint 0에러.
- ③④ 스페이서를 순수 간격 → 회색 가로선(border-hairline)으로 교체(사용자 피드백). vitest 147·lint 0에러.

## 2026-07-09 — 피커 한글 검색 (worktree-ui-improvement-3)
- 유령 principal 배지: 협업자 목록(퇴사 유저 Departed·소멸 부서 Missing, 로딩 전 오탐 가드)·승인자 카드(Departed)·맵 카드 오너(owner_name null → id 폴백 + Departed) — text-error 약한 배지 + title 안내. 점유자 표면은 프룬 자동 해제로 유령 케이스 소멸이라 미적용. 브라우저 체크 배지 4종 PASS.
- 소멸 부서 일괄 재지정: `GET/POST /api/admin/dept-remap` — 현 조직 프리픽스에 없는 부서 경로의 맵 권한·그룹 멤버 참조 집계, 현존 경로로 일괄 이동(같은 맵/그룹 중복은 병합 — 권한은 높은 역할 유지). 부서 탭 하단 Missing departments 카드(경로·참조 수·SearchSelect 대상 선택·Reassign). pytest 509(+4)·브라우저 재지정 플로우 실측 PASS.
- 퇴사자(AD 프룬) 승인 데드락 해소: `_load_approvers` 바이어스 뒤집기(직원 행 없음=활성→제외, `workflow.load_active_approvers`로 공용화) + 프룬 직후 `reconcile_departures` — 퇴사자 점유 자동 해제, pending 재평가(잔여 승인자 전원 기승인→Approved 전이+제출자 알림, 유효 승인자 0명→플로우 취소·draft 복귀·생존 제출자 점유 재부여·오너/제출자 `approval_cancelled` 알림). 테스트 가상 승인자는 conftest 전역 시드(notif-*는 공지 브로드캐스트 오염 방지로 파일 지연 시드). pytest 509 GREEN. `/api/me`에 `manager_ids`(내 org 체인 리프→루트 부서장, 본인 제외) 추가 → CurrentUser 스토어 배선. PrincipalPicker 우측 라벨 — 내 상위 부서장 유저는 "Manager"·내 소속 부서(체인 프리픽스)는 "My Dept"를 accent-tint 필로 약한 하이라이트, 그 외 기존 개인/부서/그룹 유지. 승인자 피커 3곳(approvers-panel·approver-manager·create-map-dialog)은 빈 검색 브라우즈 시 매니저를 상단 고정(`sortManagersFirst`, 검색 랭킹 불변). pytest 501·vitest 162·기존 스모크 9/9·신규 브라우저 체크 7/7 GREEN.
- 피커 부서 검색 dept_info 연동: `/api/directory` 부서 항목·`eligible-assignees`에 dept_info(한글 부서명·부서장) 조인/맵 전달. PrincipalPicker 부서 필드=[영문명, 한글명(확정), 부서장, 관찰 키워드]·부서 행도 유저와 동일 한/영 토글(ko=`한글 (영문)`), SearchSelect 부서 옵션 label lang 연동+키워드 확장(`buildDepartmentOptions(departments, users, lang, deptInfos)`). dept_info 임시 시드(12/14 부서, 공백 섞음). pytest 500·vitest 159·기존 피커 스모크 9/9·신규 브라우저 체크 5/5(한글부서명·부서장 검색 top-pin·ko/en 토글) GREEN.
- 부서 정보 JSON 임포트: 새 `dept_info` 테이블(영문 리프 부서명 PK + korean_name·manager) + `PUT /api/admin/dept-info`(현존 부서만·빈 필드 보존·unknown 보고) + `/admin/users` departments 조인. 부서 탭 열 개편(한글 부서=임포트값·부서장 신설, 직원 집계 필 폐기 — `aggregateDeptKoreanDepts` 제거), 임포트 모달(다운로드·충돌 단계 없음, 임시 필드명 dept/koreanName/manager — 소스 키 확정 시 `dept-info-import.ts` 상수만 변경). pytest 498·vitest 156·lint·build·브라우저 체크 8/8 GREEN.
- 설정 사용자 탭 흡수·부서 탭 이동: 사용자 탭 고유 정보(sysadmin 태그·active 상태)를 직원관리 테이블로 옮기고(`EmployeeOut.active/is_sysadmin` 추가) UserTable·Permissions 카테고리 삭제, 부서 탭은 조직(Directory) 카테고리 하위로. 고아 i18n 키 6종 정리. pytest 493·vitest 150·lint·build·브라우저 체크 7/7 GREEN.
- 최종 리뷰 폴리시: SelectOption 타입 중복 제거(search-select 것 재사용), eligible-approvers에 korean_dept 전달(+테스트 단언), 스펙 후속 섹션(점유권 이전 육안 확인·부서 하이라이트 툴팁·스모크 시드 원복 백로그). ⚠️ 최초 폴리시 커밋(5b5beb9)이 스펙 문서·테스트를 훼손해 리셋 후 재적용.
- 전 피커(협업자·담당자/부서·점유권 이전) 한글이름·한글그룹(부서 항목 파생 키워드) 검색 + 행 표시 lang 연동 + 점유권 이전 스코어링 통일 설계 — `docs/superpowers/specs/2026-07-09-picker-korean-search-design.md`.
- 구현 계획(5 task: BE 필드 전달 → lib 빌더 → PrincipalPicker+어댑터 → SearchSelect·점유권 → 스모크) — `docs/superpowers/plans/2026-07-09-picker-korean-search.md`.
- Task 1(BE): `DirectoryUserOut.korean_dept` 추가 + directory/eligible-assignees·approvers/editors 4개 엔드포인트가 korean_name·korean_dept 실값 전달하도록 보강(스키마 미신설, 미전달 지점만 채움). pytest 492 GREEN·ruff 0.
- Task 2(FE lib): api.ts `DirectoryUser.korean_dept?` + `EligibleAssignees.users` 항목에 `korean_name?, korean_dept?` 추가. korean-dept.ts 신규 함수 3개 + import/interface 정리(`deriveDeptKoreanKeywords`, `buildAssigneeOptions`, `buildDepartmentOptions`, `SelectOption` 신규). TDD 3개 describe 추가(테스트 150 GREEN·lint 0에러·무관 warning 1 허용)
- Task 3(FE PrincipalPicker+어댑터): `PrincipalOption`에 `koreanName`(유저)·`koreanKeywords`(부서) 추가, 검색 필드 유저=이름+한글이름+아이디/부서=부서명+한글그룹명, 행 표시는 `lang` 연동(반대 언어 괄호 보조). `MockUser.korean_name?` 추가 + 어댑터 6곳(collaborators-panel·approvers-panel·approver-manager·create-map-dialog·groups-panel·group-detail)에 `korean_name` 배선, dept를 넘기는 4곳(collaborators-panel·create-map-dialog·groups-panel·group-detail)에 `deriveDeptKoreanKeywords` 전달. lint 0·vitest 150·build 통과.
- Task 4(FE SearchSelect·점유권): 담당자/부서 옵션 구성 3화면(node-summary-modal·bpm-attribute-picker·group-bulk-modal)을 `buildAssigneeOptions`/`buildDepartmentOptions` 호출로 교체(사전 filter·value·onChange 불변), 점유권 이전 다이얼로그는 `filterByQuery`(name→koreanName→id)+`formatRosterName` lang 연동으로 전환. vitest 150·lint 0에러·build 성공.
- Task 5(브라우저 스모크+최종 게이트): `pw-smoke-picker-korean.mjs` 신규(협업자 피커: 한글이름 검색·초성 ㅈㅎㅈ·한글그룹 부서 top-pin·ko 토글 primary, 9/9 PASS, 첫 실행부터 수정 없이 GREEN) + 기존 스모크 3종 회귀(member-card 11/11·korean-names 17/17·korean-dept 5/5) 전부 PASS. 최종 게이트: pytest 492·ruff 0 / lint 0에러(무관 warning 1)·vitest 150·build 성공. 점유권 이전 필터 전환은 vitest+수동 확인 대상(스모크 제외, 브리프 명시).
## 2026-07-09 — 멤버 카드 아이콘 톤·조직 레벨 아이콘 설계 (worktree-ui-improvement-4)
- 멤버 카드 아이콘 ink-muted 회색·왼쪽 패딩 6px + `LEVEL_ICONS` 건축+조각 세트(Landmark/Building2/Building/House/Puzzle) 설계 확정 — 비주얼 컴패니언 시안 선정(톤 3안 중 C·세트 3안 중 C).
- 구현 계획 작성 — 3태스크(톤·패딩 / 아이콘 세트 / :3002 시각 검증), `docs/superpowers/plans/2026-07-09-member-card-icons.md`.
- 변경 1 구현 — 아이콘 컨테이너 `text-ink-muted`·행 패딩 `pl-1.5`(스켈레톤 동기화). vitest 147·lint 0에러.
- 변경 2 구현 — `LEVEL_ICONS`=[Landmark, Building2, Building, House, Puzzle]·`Boxes` import 제거. vitest 147·lint 0에러.

## 2026-07-09 — 자동 로그인 로딩 최소 노출 0.6s (feat/auto-login-min-visible)
- `/login` silent 시도 전 `AUTO_LOGIN_MIN_VISIBLE_MS=600` 최소 대기(모듈 로드와 병렬) — 로딩 화면 순간 플래시 방지, 리다이렉트 중 화면 유지로 Keycloak 왕복 내내 이어져 보임. 수동 버튼·일반 페이지 로드에는 지연 없음. vitest 148·lint 0에러·build·딥링크 스모크 PASS.

## 2026-07-09 — SSO 전체 로그아웃 패널 (feat/logout-sso-panel)
- 로그아웃 직후 /login 카드 아래 1회성 패널 — "모든 세션 로그아웃" 버튼이 Keycloak `end_session` 호출(같은 realm 다른 앱 세션도 종료, 문구 명시). removeUser 직전 id_token을 `bpm.ssoLogoutHint`로 확보해 확인 화면 없이 즉시 종료(id_token_hint). 자동 재로그인(소비형 억제)은 유지 — 사용자 결정. deploy.md §1 post-logout URI 실사용 명시. vitest 148·lint 0에러·build·딥링크 스모크 회귀 PASS. 서버 실검증 케이스 ⑥ 추가(스펙 3차 라운드).

## 2026-07-09 — 비공개 맵 403 안내 게이트 (feat/login-polish-403-gate)
- `ApiError(status)` 신설(api.ts, 메시지 형식 유지) — 에디터 초기 로드 403이면 raw 에러 문자열 대신 Lock 아이콘 안내 모달(단일 확인 버튼, ConfirmDialog `cancelLabel` 옵셔널화) 표시, 확인/닫기 모두 홈 이동. i18n `mapAccess.*` en/ko. 스모크 `pw-smoke-map-403.mjs`(라우트 목 403) 4체크 + 딥링크 회귀 4체크 ALL PASS. vitest 147·lint 0에러·build OK.

## 2026-07-09 — 로그인 전환 폴리시·정상접근 자동 로그인 (feat/login-polish-403-gate)
- `AuthLoadingScreen` 신설(브랜드+스피너, item-fade) — `/login` silent 시도 중 카드 플래시 제거, AuthGate 로딩·returnTo 대기 화면 통일. 억제 플래그를 소비형으로 변경(`consumeAutoLoginSkip`) — 로그아웃/실패 직후 1회만 카드, 이후 정상접근은 세션 있으면 자동 로그인(모듈 캐시 1회 판정, StrictMode 안전, 실패 시 플래그 원복).

## 2026-07-09 — 자동 로그인+딥링크 복원 구현 (feat/auto-login-deeplink)
- Task 3: `pw-smoke-login-deeplink.mjs` — dev 모드 딥링크(/maps/2)→/login→dev 로그인→원맵 복귀·consume·unsafe(//evil.com) 거부 4체크 ALL PASS. Keycloak prompt=none 경로는 서버 배포 후 3케이스 실검증 필요(스펙 §검증).
- Task 2: silent 로그인 배선 — `/login` mount 시 `signinRedirect({prompt:"none"})` 자동 1회(시도 직전 skip 플래그로 루프 차단), AuthGate가 `login_required`를 에러 아닌 "카드로" 신호로 처리 + returnTo 저장/복원(복원 대기 중 홈 플래시 방지), DevGate·dev 픽에도 동일 복원, 로그아웃 시 자동 재로그인 억제. vitest 145·lint 0에러·build OK.
- Task 1: `frontend/src/lib/auth-return.ts` 신설 — returnTo 저장/peek/consume(내부 경로 검증, open redirect 방지) + autoLoginSkip 플래그. vitest 7케이스 TDD(145 전체 통과).

## 2026-07-09 — 자동 로그인+딥링크 복원 설계 (feat/auto-login-deeplink)
- 딥링크 진입 시 Keycloak SSO 세션 있으면 버튼 없이 자동 로그인 후 원래 페이지 복귀, 세션 없으면 현행 로그인 카드 유지(prompt=none 사전 체크) — 설계 승인·스펙 저장(`docs/superpowers/specs/2026-07-09-auto-login-deeplink-design.md`). 로그아웃 직후 자동 재로그인 억제 플래그 포함. 구현 계획: `docs/superpowers/plans/2026-07-09-auto-login-deeplink.md`(태스크 3 — 헬퍼 TDD·배선·스모크).

## 2026-07-09 — AD 동기화 비활성 제외 + 프룬 (worktree-ui-improvement-2)
- 비활성(uac 0x2) 계정 동기화 제외 + 전체 동기화 시 스테일 source=ad 행 프룬 설계 — `docs/superpowers/specs/2026-07-09-ad-sync-inactive-exclusion-design.md`.
- 구현 완료(TDD): to_employee_fields 비활성 제외, sync_all 프룬(빈 스캔 가드·local 보존, 단일 DELETE)·SyncSummary/응답/탭 메시지에 purged 추가 — 신규 테스트 3종, pytest 492·ruff 0·lint 0·vitest 138·build 통과.
- 멤버 카드 개선 설계: 아이콘 확대(접힌 카드 높이)·유저 이름 한/영 토글+펼침 반대말 필·그룹 이름 해석 + **부서 매핑 기능 철회**(모달·PUT·필터 삭제, 관찰용 열·툴팁 유지, 툴팁 1열화) — `docs/superpowers/specs/2026-07-09-member-card-korean-names-design.md`.
- 멤버 카드 구현 계획(4 task: BE directory+철회 → FE 철회·툴팁 1열 → 카드 아이콘·토글·필 → 스모크) — `docs/superpowers/plans/2026-07-09-member-card-korean-names.md`. employees.korean_name/korean_dept·임포트는 유지 확인 완료.
- Task 1(BE): `GET /api/directory` 유저 항목에 `korean_name` 추가(TDD, 신규 테스트 1종), `PUT /api/admin/departments/korean-dept`+`DeptKoreanDeptIn/Out`+매핑 테스트 5종 삭제(관찰용 `test_admin_users_include_korean_fields`는 유지). `test_ad_active.py`의 directory 최소필드 화이트리스트에 `korean_name` 반영. pytest 488·ruff 0.
- Task 2(FE): 부서 매핑 UI 철회 — `dept-korean-modal.tsx` 삭제, `department-table.tsx`의 `needsOnly` 필터·`mappingDept`·행 더블클릭/cursor-pointer 제거(관찰용 `dept-kr-cell`·`RosterHover`·`dept-row`는 유지), `api.ts` `setDeptKoreanDept`·`korean-dept.ts` `shouldFlagDeptMapping`(+테스트)·i18n 7키 삭제(`admin.deptKrCol`은 유지). 명단 툴팁을 `flex-wrap`→`flex-col` 1열로 변경. `pw-smoke-korean-dept.mjs`에서 모달/필터 시나리오 제거하고 시드→탭 진입→2필→호버 툴팁만 유지(필터 소실로 대상 행은 스크롤 폴백 탐색). vitest 137·lint 0·build 성공, 잔재 grep 0.
- Task 3(FE): `map-detail-card.tsx` 멤버 카드 — 아이콘 12→22px 확대(Me 뱃지 Hand 20+ME 9px 세로 스택, 컨테이너 `h-9 w-9` 중앙정렬), 유저 이름 `lang` 토글(ko=한글 우선, en=영문)+펼침 시 반대 언어 필(`data-id="member-alt-name"`), 그룹 행 id 노출을 `groupNameById`로 이름 해석, `MembersSkeleton` 아이콘 자리 `h-9 w-9`로 동기. `api.ts` `DirectoryUser.korean_name?` 추가. vitest 137·lint 0·build 성공.
- Task 4(스모크+게이트): `pw-smoke-member-card.mjs` 신규(admin.sys 소유 테스트맵 자동 생성+협업자·그룹 부여+한글이름 임포트 → Me 뱃지·en/ko 이름줄·펼침 alt 필·그룹명 해석) 11/11(cleanup 체크 포함). `pw-smoke-korean-names.mjs` 17/17, `pw-smoke-korean-dept.mjs` 5/5 회귀 통과. 최종 게이트: pytest 488·ruff 0 / vitest 137·lint 0(무관 파일 warning 1)·build 성공. 서버 기동 중 발견: 메인 dev.db엔 admin.sys가 소유·멤버인 맵이 없어(Me 뱃지 전제 불충족) 스모크가 테스트맵을 직접 생성하도록 설계 — 제품 결함 아님, 데모 시드 특성.
- 전체 브랜치 리뷰 반영: `sync_all` 프룬 가드를 `if raws:`→`if valid_ids:`로 강화(스캔이 비어있지 않아도 전원 제외면 프룬 스킵, 회귀 테스트 1종 추가) + `to_employee_fields`의 죽은 `is_active` 재계산 정리·`LDAP_USER_FILTER` 범위 주석·`docs/deploy.md` 프룬 백업 권고·`korean-dept.ts` 헤더 참조 수정·`test_ad_active.py` docstring 보정.

## 2026-07-09 — 임베드 프로브 리다이렉트 SSRF 차단 (main)
- 푸시 보안 리뷰 반영: `embed_probe.probe_embeddable`가 `follow_redirects=True`로 자동 추종하던 것을 **수동 추종(최대 5홉)**으로 교체 — 홉마다 스킴(http/https)·호스트 SSRF 가드(`_is_probe_refused_host`) 재적용. 외부 서버가 302로 루프백/메타데이터(169.254.169.254)를 가리켜 최초-URL 검사만 통과시키던 우회 차단. 리다이렉트로 스킴 변경(file:// 등)도 거부. pytest +2(481)·ruff 0.

## 2026-07-09 — 배포 문서·compose 동기화 (main)
- `docker-compose.yml`에 `AI_ENDPOINTS` 패스스루 추가(누락 시 서버 .env에 설정해도 컨테이너 미전달 — 배포 브레이커였음). `docs/deploy.md` §2에 AI env 블록(AI_ENDPOINTS 포함), §3에 AI 런타임 반영 방법 + **업그레이드 노트(`DROP TABLE IF EXISTS ai_chat_logs;` 1회, psql 명령 포함)** 추가.

## 2026-07-09 — AI 다중 엔드포인트+모델 .env 구성 (feat/ai-multi-endpoint)
- `AI_ENDPOINTS`(JSON 배열, .env 전용 — 토큰 시크릿) 신설: 항목당 name·base_url·token·model(기본)·models(노출 목록, 비우면 /models 자동 조회). 비우면 기존 단일 AI_BASE_URL 폴백(하위호환). 모델 추가/삭제는 .env 수정+재기동.
- `ai_client.py`: `AiEndpoint`/`get_ai_endpoints`(검증 포함)/`resolve_endpoint` — 모델 선택자 `"이름::모델"`로 엔드포인트 라우팅(무접두는 첫 엔드포인트, 구형 하위호환), `list_models`는 전 엔드포인트 합산(다중이면 `이름::모델` id, 단일이면 종전 형식·개별 조회 실패는 기본 모델 폴백). 채팅 셀렉터는 `이름 / 모델`로 표시(전송 값 원본).
- 검증: pytest 471(신규 7 — 파싱/검증·라우팅·선택 엔드포인트 호출·합산·단일 형식 유지·조회 실패 폴백)·ruff 0·vitest 120·lint 0·build.

## 2026-07-09 — AI 챗 서버 저장 구현 (feat/ai-chat-server-history)
- Task 1: 세션/메시지 모델 + 계약 확장(AiChatRequest/AiProposal session_id, Out 스키마 4종).
- Task 2: `/ai/chat` write-through — `derive_chat_title` 헬퍼(`app/chat_history.py`) + 라우터에 세션 소유/맵 검증(AI 호출 전 404 fail-fast)·질문/답변 2행 적재를 AI 실패 시 미적재로 한 트랜잭션 처리. pytest 457·ruff 0.
- Task 3: 신규 라우터 `app/routers/ai_sessions.py` — `GET /api/ai/chat-sessions[?map_id=]`(맵 이름·메시지 수, 소프트삭제 맵 제외, 본인 것만)·`GET .../{id}/messages?before=&limit=`(최신순으로 떠서 has_more 판정 후 오름차순 페이지)·`DELETE .../{id}`(ORM cascade로 메시지 동반 삭제, 204). 전부 본인 소유만(타인 404). pytest 462·ruff 0.
- Task 4: 보존 상한 3종을 `app_settings`(런타임 조정, 기본 세션 20/메시지 200/기간 180일)로 노출 — `chat_history.py`에 `prune_chat_session_messages`(세션 내 메시지 상한, 오래된 순 삭제)·`prune_map_chat_sessions`(사용자×맵 세션 상한, ORM delete로 메시지 cascade)·`prune_expired_chat_sessions`(기간 만료, 목록 조회 시 기회적 실행) 추가. `/ai/chat` 적재 직후 메시지·세션 상한 훅업, `GET /ai/chat-sessions` 진입 시 만료 정리 훅업. PUT `/admin/app-settings`가 3필드(1–200/10–2000/7–3650) 부분 갱신 수용. pytest 466·ruff 0.
- Task 5: `ai_chat_logs` 흡수·제거 — `AiChatLog` 모델·`AI_CHAT_LOG_KEY`/`is_ai_chat_log_enabled`·`AppSettingsOut/Update.ai_chat_log_enabled`·`/ai/chat`의 구 로깅 write 블록·구 로깅 테스트 2종 삭제. `_to_out`은 관리 4키 중 최신 갱신 행 기준으로 `updated_by/updated_at` 산출. **서버 배포 시 `DROP TABLE ai_chat_logs;` 1회 수동 실행 필요**(더 이상 코드가 쓰지 않는 잔여 테이블). pytest 464·ruff 0.
- Task 6+7: 프론트 서버 세션 전환 — `chat-sessions.ts` 재작성(뷰모델 `ChatMessage`{id/role/content/at}·`createLocalMessage`(음수 낙관 id)·`toChatMessage`, localStorage 스토어 폐기)·`api.ts`에 `getAiChatSessions/getAiChatMessages/deleteAiChatSession`+`aiChat(session_id)`+`AiProposal.session_id`. `AiChatPanel` 코어를 서버 세션 로딩·전송·커서 페이징으로 전환(`mapId` prop, 현재 맵 세션 드롭다운·지연 새 대화·상단 스크롤 페이징·404 폴백·인라인 재시도), 세션 한도/용량바/카운터 제거. i18n 5키 삭제·3키 추가. 편차: 브리프의 `set-state-in-effect` disable 4개가 React Compiler 컴포넌트 bail로 전부 unused 경고 → 제거(0/0 유지). vitest 120·lint 0·build.
- Task 8: 히스토리 확장 — 드롭다운에 "다른 맵 대화" 섹션(맵 이름 접두 + 이동, 접기/펼침) 추가, 현재 맵 목록 항목에 삭제 버튼(`ConfirmDialog` 재도입) 추가, 다른 맵 세션은 읽기전용(입력·전송·빠른칩 비활성 + 안내 배너의 "이 맵 열기"로 이동), `AiChatPanelProps.initialSessionId`+`/maps/{mapId}?aiChat=<sessionId>` 딥링크로 패널 자동 오픈+세션 활성. i18n 6키 추가(EN/KO). vitest 120·lint 0(1 pre-existing warning)·build.
- Task 9: 관리자 설정 패널 — Q&A 적재 토글(+activeNotice)을 보존 상한 3필드(대화 수/메시지 수/보관 일수) 편집 카드로 교체. `AppSettings`/`putAppSettings` 타입에서 `ai_chat_log_enabled` 제거, 3필드 추가. 저장 전 로컬 범위 검증(1–200/10–2000/7–3650, 서버 422 이전 차단). i18n 5키 삭제 + 8키 추가(EN/KO). 팁 관리 섹션 무변경. vitest 120·lint 0(1 pre-existing warning)·build.
- Task 10: 기본 팁·매뉴얼 동기화 — `DEFAULT_AI_CHAT_TIPS` 구식 2건(4개 제한·40개 캡) 교체, `backend/app/manual.md`·`docs/manual/user-manual-{ko,en}.md` §AI 도우미를 서버 저장·다른 맵 대화·관리자 보존 상한 문구로 갱신(날짜 2026-07-09), `docs/manual/admin-manual-{ko,en}.md` §12에서 Q&A 적재 토글 설명을 보존 상한 3키(표)와 "항상 서버 저장(사용자·맵 단위, 본인만 조회)" 설명으로 교체 + 콘솔 지도 "AI 챗" 행 설명 갱신. pytest 7/7(test_app_settings.py), 잔재 grep 0.
- Task 11: 브라우저 e2e 스모크 + 전체 게이트 — 신규 `frontend/scripts/pw-smoke-ai-chat-history.mjs`(playwright-core + 시스템 Chrome, dev.db `SMOKE-` 세션 3종 시드) 13개 어서션 전부 PASS: 대화 바 자동 활성·현재 맵 2건/다른 맵 토글 1건·서버 페이징 30→(로딩 팁)→40·타맵 세션 포린 배너+입력 disabled+이 맵 열기·`?aiChat=` 딥링크 이동+자동 오픈·mocked `/ai/chat` 낙관 말풍선·삭제+새 대화 폴백·콘솔 에러 0. 제거된 UX(localStorage 4개 제한·용량바)를 테스트하던 구 스모크 `pw-smoke-ai-chat-sessions.mjs` 삭제(컨트롤러 승인). dev.db는 시드 정리 후 백업으로 원복(SMOKE 0행·ai_chat 테이블 없음·맵 12건). 게이트: pytest 464·ruff 0·vitest 120·lint 0(1 pre-existing warning)·build 성공.
- 최종 리뷰 반영: `fix(ai-chat): reload thread on retry + clear stale thread on switch` — 메시지 로딩 effect deps에 `messagesReload` 추가(Retry 버튼이 목록뿐 아니라 활성 스레드도 재시도), non-null 분기 진입 시 `setMessages([])`로 스테일 스레드 즉시 클리어(세션 전환 실패 시 이전 세션 스레드가 새 제목 아래 오귀속되던 버그 해소). 스모크에 체크 9(a/b/c) 추가 — 실패 경로에서 historyError+Retry 노출, 오귀속 없음(li 0개), Retry로 30개 복구. 16/16 PASS. 게이트 재확인(vitest 120·lint 0·build).
- 드롭다운 삭제 버튼 호버 노출 — 대화 목록 항목의 삭제 버튼을 행 호버 시에만 표시하고, 활성 대화는 같은 슬롯에 체크 표시를 두었다가 호버 시 삭제 버튼으로 크로스페이드(duration-150). 스모크 체크 ⑦ 셀렉터를 행(.group) 기준 hover→클릭으로 보정. 스모크 16/16 재확인·vitest 120·lint 0·build.

## 2026-07-08 — AI 챗 서버 저장 + 맵 단위 히스토리 설계 확정 (feat/ai-chat-server-history)
- 브레인스토밍으로 결정 확정: 서버 DB 저장(정규화 2테이블 + `/ai/chat` write-through), 대화 귀속 사용자×맵(다른 맵 대화는 열람만+이동 버튼), 보존 개수+기간 혼합(app_settings 상한 3종), 히스토리 목록형 UX(4개 제한·LRU 제거), localStorage 마이그레이션 없음, ai_chat_logs 흡수·제거. 스펙: `docs/superpowers/specs/2026-07-08-ai-chat-server-history-design.md`.
- 구현 계획 작성: 11개 태스크(백엔드 모델→write-through→조회 API→보존 상한→로그 제거→프론트 API→패널 코어→히스토리 확장→설정 패널→매뉴얼→e2e 스모크), TDD·커밋 단위 명세. 플랜: `docs/superpowers/plans/2026-07-08-ai-chat-server-history.md`.

## 2026-07-08 — AI 계약 URL 갭 보완 + 증분편집(ops) 확장 (feat/ai-incremental-edit)
- URL 갭: `AiNodeAttributes`에 url/url_label 추가(NodeIn 동일 제약), `ai_prompt` 직렬화에 `링크=` 노출 + 규칙 ⑦(재생성 시 에코 보존), `aiNodeToGraphNode` url 매핑 — graph 재생성 시 기존 노드 URL 소실 해소.
- 증분편집 확장: ops 신규 액션 3종 — `disconnect`(연결 끊기)·`set_edge_label`(분기 라벨)·`set_desc`(노드 설명) + 사이 삽입 패턴(add+disconnect+connect) 프롬프트 예시. **set_attr 부분 갱신 시맨틱**(None=유지·""=지움 — 기존엔 생략 필드가 ""로 덮여 소실되던 잠재 버그 해소). 라우터 미지 참조 표면화에 신규 액션 반영. 매뉴얼 3종(번들·user ko/en) 증분 편집 능력 갱신.
- 검증: pytest 451(신규 6)·ruff·vitest 134·lint 0·build. 브라우저 e2e 14/14(AI 응답 playwright 모킹 — 사이 삽입/disconnect/엣지 라벨/set_desc/url만 set_attr 후 기존 담당자 보존 실증/graph 재생성 url 에코/베이스라인 원복).

## 2026-07-08 — 임베드 체크: 차단 사이트 폴백 카드 즉시 표시 (feat/embed-check)
- 보안 리뷰 반영: 프로브가 루프백·링크로컬(메타데이터)·비유니캐스트 대상 거부(사설 RFC1918은 기능 목적상 허용 유지, httpx2는 저장소 표준이라 교체 제안 기각). pytest +1(445).
- `GET /api/embed-check`(신규 embed_probe·routers/embed) — 대상 URL의 X-Frame-Options/CSP frame-ancestors를 서버가 판독(httpx2, 4s, 리다이렉트 추종), 미리보기 패널이 차단 verdict 수신 시 크롬 오류 화면 대신 기존 폴백 카드를 즉시 표시(판정 불가는 기존 동작 유지). pytest +6(444)·vitest 134·build 클린, E2E(google→카드/wikipedia→iframe) PASS. SSRF 노트: 인증 전용·http(s)만·불리언만 노출.
## 2026-07-09 — 유저 한글이름 필드 + 일괄 등록 모달 설계 (worktree-ui-improvement)
- P2 최종 리뷰 반영: 이름만 임포트(dept 미기입) 시 부서 탭 매핑으로 채운 `korean_dept`를 소거하지 않도록 수정(빈 dept는 미기입으로 취급) + 회귀 테스트 1건, 추출 드롭다운 Esc/외부클릭 닫힘(투명 backdrop, 문서 리스너 없이), dept 스모크에 "매핑 후 단일 필" 직접 검증 추가, 설계 문서 파싱 실패 문단을 배열/객체 자동판별로 갱신 — pytest 454(신규 포함) PASS·ruff clean.
- 부서 매핑·추출 옵션 구현 계획 작성(5 task: BE PUT/필드 → lib → 부서 탭 UI → 스플릿 버튼 → 스모크) — `docs/superpowers/plans/2026-07-09-dept-korean-mapping.md`.
- 부서 한글명 매핑 관리(부서 탭 필터·korean dept 열·명단 툴팁·더블클릭 매핑 모달·전원 덮어쓰기 PUT) + 유저 추출 옵션(스플릿 버튼 4종) 설계 확정 — `docs/superpowers/specs/2026-07-09-dept-korean-mapping-design.md`.
- 조회 도구 응답 배열 포맷 임포트 + `korean_dept` 컬럼 신설 — 루트 배열([{userId,status,name,dept,…}], not_found/error 무시)·객체 맵 양쪽 자동 판별, PUT entries가 {name,dept} 객체로 확장(양쪽 max_length 200), 테이블 korean dept 열 추가. 스모크 15/15(배열 1차·맵 충돌 경로)·pytest 447·vitest 144·build 통과.
- AD 미제공 한글이름을 `Employee.korean_name`으로 추가하고 어드민 Employees 탭에서 JSON 임포트(skip/overwrite 충돌 확인·미보유 목록 다운로드)하는 설계 확정 — `docs/superpowers/specs/2026-07-09-user-korean-name-import-design.md`.
- 구현 계획 작성(6 task: BE 컬럼/엔드포인트 TDD → FE 파서 lib/모달/탭 wiring → 브라우저 스모크) — `docs/superpowers/plans/2026-07-09-user-korean-name-import.md`.
- Task 1 DONE: `korean_name` 컬럼 TDD 구현(2/2 테스트 통과·440 tests 회귀) — models.py Employee/schemas.py EmployeeOut 노출·AD _upsert 보존 검증.
- Task 2 DONE: `PUT /api/employees/korean-names` 엔드포인트 TDD 구현(5개 신규 테스트·445 tests 통과) — skip/overwrite 모드·미보유 목록 반환·sysadmin 권한 검증.
- Task 3 DONE: FE 파서·분류·다운로드 lib TDD 구현(6개 신규 테스트·140 tests 통과·0 lint 에러) — parseKoreanNamesJson/classifyKoreanNames/buildMissingIdsJson 순수함수·EmployeeRow korean_name 필드.
- Task 4 DONE: FE API 클라이언트·i18n·모달 컴포넌트(api.ts KoreanNamesImportSummary/importKoreanNames + i18n 14 keys en/ko + korean-name-modal.tsx 모달·3단계·무한스크롤 충돌 툴팁 + lint 0 err·vitest 140 pass).
- Task 5 DONE: FE Employees 탭 wiring(korean_name 열·Add Korean Names 버튼·모달 마운트, lint 0 err·vitest 140 pass·build PASS).
- Task 6 DONE_WITH_CONCERNS: 브라우저 스모크 11/12(신규/충돌 skip·overwrite·다운로드·테이블 반영 전부 PASS) — `pw-smoke-korean-names.mjs`. 기존 DB ALTER 자동보강 실증(레거시 dev.db 복사→재기동→401행 전부 `korean_name:""`). 발견: `korean-name-modal.tsx` 충돌 툴팁이 `<p>` 안에 `<div>`를 중첩해 콘솔 hydration-nesting 경고 2건(제품 결함, 미수정 — 컨트롤러 판단 대기). 최종 게이트 4종(pytest 445·ruff·lint·vitest 140·build) 전부 PASS.
- Task 6 후속 fix(컨트롤러 승인): `korean-name-modal.tsx` 충돌 문구 래퍼 `<p>`→`<div>`로 div-in-p 중첩 제거 — 스모크 12/12 PASS(콘솔 에러 0), lint 0 err·vitest 140·build PASS.
- 리뷰 후속: 스모크 헤더에 재실행 전제(DB `korean_name` 리셋) 주석 추가 — `pw-smoke-korean-names.mjs`, lint 0 err.
- 전체 브랜치 최종 리뷰 반영: 툴팁 호버 갭 제거(`mt-1`→패딩 래퍼)로 flaky 닫힘 해소, `entries` 값 max_length=200 서버 검증 추가(Postgres VARCHAR(200) DataError 500 방지, 422 테스트 1건), BE 테스트 헬퍼 `_korean_name_of`→`_get_korean_name` 리네임, FE any 캐스트 제거(`Object.entries(data as Record<string, unknown>)`), 파일 읽기 실패 시 에러 표시(`onFile` try/catch), ko 조사 띄어쓰기·en 타이틀 대문자 통일, Cancel 버튼 `data-id` 추가, 스모크에 툴팁 유지 체크 추가(13/13 PASS) — pytest 446·ruff·lint·vitest 140·build 전부 PASS.
- P2-Task 1 DONE: AdminUserOut korean 필드 + PUT /api/admin/departments/korean-dept 일괄 갱신 TDD 구현(6개 신규 테스트·453 tests 통과) — schemas.py DeptKoreanDeptIn/Out 2클래스 추가·admin.py 엔드포인트 등록·AdminUserOut korean_name/korean_dept 필드 노출·sysadmin 권한 검증.
- P2-Task 2 DONE: FE korean-dept lib + api TDD 구현(8개 신규 테스트·152 tests 통과·0 lint errors) — api.ts AdminUser korean_name/korean_dept 필드 + setDeptKoreanDept 함수·korean-dept.ts getDeptMembers/aggregateDeptKoreanDepts/shouldFlagDeptMapping/formatRosterName/buildExportIds 순수함수·vitest 모든 엣지케이스 커버.
- P2-Task 3 DONE: 부서 탭 UI 개편(매핑 필요 필터·korean dept 열·인원수 호버 명단 툴팁·행 더블클릭 매핑 모달) — department-table.tsx 확장·dept-korean-modal.tsx 신규·i18n 8키 en/ko, lint 0 err(불필요한 exhaustive-deps disable 제거)·vitest 152 pass·build 통과.
- P2-Task 4 DONE: FE 스플릿 버튼 4옵션 추출(missing/deptSample/random50/all) — korean-name-modal.tsx split button·i18n 4키 en/ko + buildExportIds·EXPORT_FILENAMES·exportMenuOpen state·menu 드롭다운, lint 0 err·vitest 152 pass·build 통과.
- P2-Task 5 DONE: 브라우저 스모크(부서 매핑 신규 9/9 `pw-smoke-korean-dept.mjs` + 추출 메뉴 체크 추가 후 17/17 `pw-smoke-korean-names.mjs`) 전부 첫 실행 PASS + 최종 게이트(pytest 453·ruff·lint 0 err·vitest 152·build) 전부 통과. 발견 결함 없음.

## 2026-07-07 — feat/url-viewer 머지 (main)
- 머지 후속: 스모크가 초안 버전으로 전환 후 진행 — 상태 배너 기능이 게시본을 기본 열람으로 바꿔 스모크 전제가 깨진 것 보정.

## 2026-07-07 — 에디터 읽기전용 배너 재편 + 저장 상태 필/실패 배너 (feat/editor-status-banner)
- 읽기전용 배너를 사유별 구조(톤·아이콘·굵은 타이틀+설명)로 재편 — 뷰어(중성/Eye) > **타인 점유(경고/PencilLine, 점유자 이름 디렉터리 해석 "이름 (id)" + 승인 탭 요청 안내)** > 게시(액센트/BadgeCheck) > 만료(중성/Archive, 신규 분기) > 승인(경고/CircleCheck) > 결재 중(경고/Hourglass). 상태 타이틀은 한/영 모두 영어 고정(Pending approval/Approved/Published/Expired). 헤더 점유 칩도 이름 해석 적용. 만료가 "결재 진행 중"으로 나오던 기존 미분기 해소.
- 저장 상태 표시를 필 형식으로 — 저장 중(중성)·저장됨(green/added·체크)·저장 실패(red/error·경고 아이콘, 짧은 라벨). **실패 상세는 상단 error 배너로 노출(err.message + 재시도 힌트), 다음 저장 성공까지 유지**(`saveErrorDetail`). 구 키 editor.readonly.*(5종)·editor.saveError 제거, 신규 키 13종(en/ko).
- 검증: vitest 122·lint 0·build·브라우저 스모크 18/18(점유자 본인 무배너/타인 점유 이름 배너/뷰어/게시/만료 톤·PUT 차단으로 실패 필+상세 배너 유지→수동 저장 성공 시 해소·콘솔 0). dev.db 원복 확인.

## 2026-07-07 — 에디터 UI: 상태별 워터마크 + 인스펙터 서브프로세스 지정 카드 (main 직접)
- 워터마크: 게시본 PUBLISHED(액센트)·만료본 EXPIRED(회색 `text-ink-tertiary`)·그 외 READ ONLY — 상태 텍스트 한/영 모두 영어 고정(`editor.watermarkPublished/Expired`).
- 인스펙터 속성 탭(빈 상태)·맵 탭에 `SubprocessInspectorCard` 신설 — 지정 상태 뱃지(영어 고정 Designated/Not designated)+어트리뷰트+연결 절차 노트("지정은 다른 맵이 이 맵을 임베드하기 위한 절차"). 버튼(지정/수정/해제)은 **게시 버전 열림 + 오너·sysadmin**일 때만 활성, 비활성 시 사유 노트 표시(`inspector.spNeedPublishedOpen/spOwnerOnly`). 지정 모달은 설정 화면 패널에서 `SubprocessDesignationModal`로 추출해 공용화(동작 동일).
- 검증: vitest 122·lint 0·build·브라우저 스모크 18/18(PUBLISHED/EXPIRED 워터마크·카드 뱃지/노트·게시본 활성·만료본 비활성+사유·모달 개폐·지정 반영·해제 복원·콘솔 0). 노트: 만료본 상단 읽기전용 배너가 "결재 진행 중" 문구로 나오는 기존 미분기(statusNoticeKey에 expired 분기 없음)는 범위 외 — 후속 후보.

## 2026-07-07 — AI 챗 다중 대화: 최대 4개 + 이전 대화 열기 + 최오래 닫기 확인 (feat/ai-chat-sessions)
- `chat-sessions.ts`(신규): 세션 스토어 파싱/직렬화·구 단일배열 포맷 자동 이행·최오래 세션 선정·제목 파생(첫 사용자 메시지 40자)·세션당 40개 캡 — 테스트 14. localStorage 키 `bpm.aiChat.v{versionId}` 유지.
- `AiChatPanel`: 대화 전환 바(이전 대화 드롭다운 최신순·활성 체크·카운터 n/4 + 새 대화 버튼). 5번째 새 대화 → ConfirmDialog(최대 4개 안내 + 가장 오래전에 연 대화 "닫힘" 뱃지) → 확인 시 최오래 퇴출+새 대화. 빈 대화 재사용(빈 세션 중복 방지), 응답 대기 중 전환해도 원 대화에 append, 버전 전환 시 교차 저장 가드. i18n 5키(en/ko).
- 검증: vitest 119·lint 0 errors·build PASS·브라우저 스모크 18/18(`frontend/scripts/pw-smoke-ai-chat-sessions.mjs` — 드롭다운/전환/한도 모달/취소 유지/퇴출/localStorage/레거시 이행/콘솔 에러 0).
- 후속(사용자 검토): 새 대화 버튼 ↔ 폰트 툴(−T＋) 자리 교환 — 새 대화는 창 헤더에 아이콘만(트리거는 `onRegisterNewChat` ref 등록), 폰트 툴은 대화 전환 바 우측(`onFontScaleChange`, 배율 상태는 페이지 유지). 창 최상단 바 아이콘 호버 툴팁 박스 `IconTip` 신설 — 이름변경·새대화·내보내기 + ScopeWindow 최소화/최대화/닫기 공통 적용(native title 제거). 스모크 21/21.
- 문서 정리: 매뉴얼 5종 갱신(번들 `backend/app/manual.md` §5 + user/admin ko·en — 다중 대화 4개·타임스탬프·청킹 로딩·입력 링·용량바·관리자 "AI 챗 설정" 12장 신설). 완료 트래커 4종 삭제(SCREEN-NEW-PAGES·SCREEN-REDESIGN-COMPARE·SCREEN-REDESIGN-EDITOR·SUBPROCESS-DESIGNATION — 전문은 git 이력). 트래커 잔여 후속 메모: 에디터 아웃라인 단축키 셋 정립·노드 정보 토글 카드 인스펙터 이전(에디터 D), 매뉴얼 읽기테마 범위·피드백 열람 정책(신규화면), U5 노드 표시필드 영속 복귀 현상(서브프로세스).
- 후속 3: 기능 팁 20종 확대 + 설정 관리 — 기본 팁을 서비스 전반 FAQ 20종(`app/app_settings.py DEFAULT_AI_CHAT_TIPS`)으로 DB 관리 전환. `GET /api/ai/tips`(전 사용자)·`PUT /api/admin/app-settings` 부분 갱신(`ai_chat_tips`, 빈 목록=기본 복원, 팁당 200자·최대 50개). 설정 "AI 챗" 탭에 팁 편집기(한 줄당 1개, 개수 카운터). 패널은 서버 팁 조회(실패 시 i18n 5종 폴백). 잔여 링 숫자는 회색톤(text-ink-tertiary)으로. 검증: pytest 433·vitest 122·lint 0·build·스모크 41/41(커스텀 팁 저장→채팅 노출→기본 복원 e2e).
- 후속 2: ① 입력 잔여 링(퀵칩 행 우측, instruction 2000자 대비 — 75% 주의 amber·90% 경고 error, 잔여 카운트+호버 툴팁, textarea maxLength) ② 세션 저장 용량 진행바(대화 전환 바 아래, 세션당 40개 캡 대비 동일 임계색) ③ 메시지 타임스탬프(`ChatMessage.at`, KST MM-DD HH:mm 노출, 저장은 시간 역순 `order:"desc"` — v2/레거시 파싱 호환) ④ 청킹 로딩(최근 12개 먼저, 스크롤 상단 도달 시 스피너+기능 팁 5종 노출 후 이전 청크, 스크롤 위치 보존) ⑤ AI 챗 Q&A DB 적재 토글 — 백엔드 `app_settings`(KV)+`ai_chat_logs` 테이블, GET/PUT `/api/admin/app-settings`(sysadmin), `ai_chat`서 설정 ON일 때 질문/답변/시간/사용자 적재(테스트 기간 ON 예정), 설정 콘솔 "AI 챗" 탭 토글 패널. 검증: pytest 430·vitest 122·lint 0·build·스모크 36/36.
## 2026-07-07 — URL 라벨 + 필 입력 + 서브프로세스 지정 URL 설계 (feat/url-viewer)
- 설계 스펙: 노드 url_label(액션 바 버튼 텍스트 대체·호버 열기 아이콘), 인스펙터/모달 공용 UrlLabelField 2행 필(URL X=동반 삭제·라벨 X=라벨만), subprocess는 지정 단계 sp_url/sp_url_label(호스트 수정 불가) — `docs/superpowers/specs/2026-07-07-url-label-design.md`. 풀스택(DB 컬럼 3·API·프론트) 사용자 확정.
- 스펙 보정(사용자 검토): CSV url_label 컬럼 추가 — URL 없는 라벨은 에러 없이 무시 + 임포트 전 서머리에 무시 건수 표기.
- 구현 계획 작성(Task 1~7: 백엔드 컬럼·캐스케이드 → 프론트 배선 → UrlLabelField → 액션 바 라벨 → 지정 모달 → CSV → 스모크): `docs/superpowers/plans/2026-07-07-url-label.md`.
- Task 1: 백엔드 — nodes.url_label·process_maps.sp_url/sp_url_label + 캐스케이드 validator + refs 동봉 (pytest 430).
- Task 2: 프론트 배선 — NodeData.urlLabel·spUrl/spUrlLabel, 그래프 왕복(toAppNodes/buildGraph)·injectSubEnds 주입.
- Task 3: UrlLabelField — 인스펙터·편집 모달 공용 2행 필 편집기(URL X=동반 삭제, 라벨 X=라벨만) + 스모크 셀렉터 이행.
- Task 3 fix: 모달 isDirty·navSaveAndGo에 url/urlLabel 포함 — 칩 내비 시 URL 변경 유실 방지.
- Task 4: 액션 바 — 라벨 텍스트 대체·호버 열기 아이콘·subprocess는 spUrl/spUrlLabel 소스.
- Task 5: 지정 모달 URL·라벨 입력(http(s) 검증·라벨은 URL 있을 때만) + 호스트 인스펙터 읽기전용 URL 행.
- Task 6: CSV url_label 컬럼(선택) — URL 없는 라벨 무시+ignoredLabelCount 서머리 표기, 템플릿·AI 프롬프트 갱신.
- Task 7: 스모크 라벨 대체/원복 시나리오 + 전체 게이트(pytest 430·lint·vitest 117·build) 클린.
- 최종 리뷰 반영: 라벨 행 게이트를 url.trim()으로 — 공백 URL 레거시 행에서 라벨 유령 표시 방지.

---

## 이전 이력 compact (2026-06-11 ~ 2026-07-06) — 상세는 git history의 PROGRESS.md 참고

### 노드 액션 바 + 링크 미리보기 (2026-07-06 · feat/url-viewer)
- 단일 노드 포커스 시 하단 통합 액션 바(펼치기→링크 열기→그룹 나가기) + 우측 520px 슬라이드 iframe 미리보기(로딩 애니·임베드 차단 폴백). 구 버튼(그룹 모서리 나가기·ExpandToggleButton) 제거.
- `isHttpUrl` 가드로 노드 URL의 XSS 백로그 해소 + 보안 하드닝 `isSafePreviewUrl`(자기 오리진 URL 차단 — sandbox 탈출 벡터 봉쇄).
- 스모크 `pw-smoke-node-action-bar` 신설, 전체 게이트 클린.

### CSV 임포트 + 외부 AI 왕복 (2026-07-06)
- 노드 `url` 필드 신설(String 500, `db.py _ADDED_COLUMNS` 백필) + 인스펙터 URL 입력. 클라이언트 파싱(`csv-import.ts` — RFC4180·UTF-8/EUC-KR·자동 Start/End·Next≥2 decision 추론·dagre 배치·행 상한 500) 후 기존 `PUT /graph` 재사용.
- 진입 2경로: 새 맵 다이얼로그 "CSV로 시작" + 에디터 툴바 전체 교체(체크아웃 보유자·루트 스코프 한정, 교체 확인 모달·undo 1회).
- 외부 AI 왕복: 절차 추출용 AI 프롬프트 복사 버튼 + CSV 붙여넣기 textarea(```csv 펜스 관용). 테스트용 샘플 CSV 3종 `docs/samples/`.
- 최종 E2E+회귀 게이트: pytest 423·vitest 93·브라우저 라이브 체크 전부 통과.

### AI 챗 강화 1차 (2026-07-06 · feat/ai-chat)
- 대화 히스토리 버전별 localStorage 저장/복원 + '새 대화'(⚠️ 이후 07-08 서버 저장 구조로 대체됨).
- AI 근거를 번들 manual.md → 등록 매뉴얼 문서(manual_docs, ko 우선·30k자 가드)로 교체, 답변 마크다운 서식 규칙 신설.
- `_structure_hints` 확장 — 도달성·라벨 없는 분기·막다른 노드·BPM 속성 누락·중복 제목 사전탐지(환각 감소).

### 서브프로세스 지정(Designation) U1~U7 (2026-07-06 · worktree-feat+subprocess-detail)
- 오너가 맵 설정에서 지정해야 라이브러리 피커에 노출(Call Activity 소비 게이트). `ProcessMap` sp_* 컬럼 7개(+백필), PUT/DELETE `/maps/{id}/subprocess-designation`(오너/sysadmin·게시버전 409·부서 필수 422·해제 멱등+프리필).
- `subprocess_refs` 그래프 동봉 + 미지정/삭제 맵 resolve는 권한 무관 locked → 캔버스 경고 삼각형+펼침 봉인. 맵 드롭다운 '링크 노드로 추가'에도 동일 지정 필터 적용.
- 노드 카드가 지정 어트리뷰트(부서·시스템·소요) 라이브 표시, 인스펙터 읽기전용 카드. subprocess 색은 타입 기본 바이올렛 단일 고정(색 UI 숨김).
- 데모 시드 지정 4종+소비 노드. pytest 415. ⚠️ 노드 표시 필드 localStorage가 리로드 시 기본값 복귀하는 기존 현상 관찰(본 작업 무관, 백로그).

### 매뉴얼 시스템 S8~S9·F9~F11 (2026-07-05~06)
- `manual_docs`: 단일 게시본 → 다중 문서(title·language·sort_order 컬럼, 제목 자동 추출·레거시 ko 흡수) + CRUD API(쓰기 sysadmin). `/manual` 뷰어(TOC·본문검색 점프·읽기폭·읽기테마·언어 전환 시 동일 순번 유지), 관리 패널(마크다운/HTML 편집·미리보기·게시, HTML은 dompurify sanitize).
- `MANUAL_URL` env → 에디터 툴바 매뉴얼 버튼. ⚠️ compose에 backend 전달 누락으로 배포 무동작이었음(수정 완료 — 신규 Settings는 compose 병기 확인 필수).
- 매뉴얼 4종(user/admin × en/ko) 코드 실측 기반 작성, 뷰어 파서 지원 문법만 사용.

### 에디터 소소 폴리시 F6~F15 + 단축키·줌 (2026-07-06)
- 노드 검색 단축키 Ctrl+K → `/`(키캡 버튼·플레이스홀더 축약, 아웃라인 검색 동일 패턴).
- 서브프로세스 1차 검증 피드백 F1~F5: 비교뷰 subprocess 4변 핸들, 펼침 게이트웨이 targetHandle 보정, `isConnectable` 전 핸들 전달(+접힘 시 표시 전용 `sp-ends:*` 파생 엣지), 더블클릭=편집 모달(드릴인 제거), 타이틀 편집 4진입점 차단. 펼침 레인 헤더 강조+맵 이동 버튼+미저장 경고(F6).
- 단축키 안내를 우하단 레전드 → 사이드바 'More shortcuts' 플로팅 패널로 이관, 줌 컨트롤 우하단 이동. ConfirmDialog 요점 줄 말줄임 제거(F7)·우클릭 플라이아웃 폭 보정.

### 자동정렬 가로/세로 + flow-layout 공용화 (2026-07-06)
- `lib/flow-layout.ts` 신설 — 비교 화면의 spine 판정·백본 직선화·핸들 변 선택을 일반화, 에디터 `autoLayoutFlow`(dagre→척추→직선화→엣지 핸들 재지정). 비교 페이지는 로컬 구현 삭제 후 lib 재사용.
- 정렬 메뉴 가로(⇧L)/세로(⇧K) 2항목 분화, 부분 정렬(선택 2+)은 방향 dagre만. 노드+엣지 한 스냅샷(undo 1회).

### 성능·로딩·검색 개선 (2026-07-06)
- 직원 5000명 대비 25청크 무한스크롤(`use-infinite-slice`) — 피커 3종·관리자 테이블 3종·스크롤 목록 11곳(에디터 아웃라인은 제외).
- PNG 내보내기 엣지 소실 수정 — html-to-image가 SVG 하위 요소 스타일을 인라인하지 않는 것이 원인 → 캡처 직전 엣지·화살촉 인라인 스타일 주입 후 원복(`applyEdgeFixups`), 전 엣지 검은 실선·pixelRatio 2, 비교 export 공용화.
- 검색 랭킹 v2(정확>접두>단어시작>중간>초성>시퀀스 + 공백 AND + 타이브레이크) 전 소비처 공통, 피커 검색 캡 삭제·부서/그룹 최고 랭크 상단 핀. 맵 상세 로딩 스피너+고스트 행(버전 프레임 리플로우 제거).

### DB 마이그레이션 9800 검증 스택 (2026-07-06)
- `docs/db-migration-9800.md` — 운영(9900) 복사본 검증: 스키마 diff(신규 테이블 4·컬럼 9·expired), 마이그레이션=최신 backend 1회 기동(create_all+`_ADDED_COLUMNS` 멱등, DDL 스크립트 불요), pg_dump→db만 기동→복원→전체 기동 순서, version_number 백필 SQL, 롤백(additive).
- `docker-compose.dev.yml` 9800 오버라이드(-p bpm-dev 격리). ⚠️ 실전 트러블: ① `docker exec -t` 덤프는 TTY가 CR을 섞어 아카이브 손상 → `-t` 제거 ② compose 오버라이드 `ipam.config`는 누적 병합이라 대역 바꿔도 Pool overlaps → dev 클론 compose 직접 수정 ③ heredoc은 `-it` 불가 → `-i`.

### 신규 화면 4종 S1~S10 — 피드백·공지·인박스·대시보드 (2026-07-05~06 · worktree feat+new-pages)
- 공유 셸: TopNav 3-way 탭(맵/공지/인박스, 세그먼트 pill)·미로그인 Login 표시. 공용 컴포넌트 확립 — UserPill(이름 우선+1초 호버 유저 카드)·TimePills(상대/날짜 2필)·SearchBox(`/` 단축키·초성 검색)·Pagination·IconPillFilter.
- 피드백: `Feedback` 모델(+reply·수정/답글/완료 시각) + 사이드 패널(4000자 카운터) + `/feedback` 페이지(집계·필터·표·페이징) + 상세/관리 모달(상태변경=관리자·답글·작성자 draft 수정/삭제).
- 공지: `Notice` 모델 + `/notices` 뷰어(카드 목록·읽음은 localStorage 캐시·notify_all 알림 fan-out) + 설정 콘텐츠 관리 탭(등록/수정 모달·자체 date-range 캘린더·아코디언 미리보기). 마크다운 뷰어 대비 강화·복사 토스트. 릴리스 공지 초안 `docs/notices/2026-07-06-release.md`.
- 인박스: 알림 탭(read-all)+승인 대기 탭 — `GET /api/inbox/approvals`가 버전 승인·점유권 이전·권한/가시성 요청 3출처 집계, 상세에서 승인/반려(공용 ConfirmDialog·승인자 현황·멤버 보기·마크다운 요약). 알림 메시지 요청자 id→이름 해석(`get_display_name`).
- 대시보드: 설정 분석 카테고리 진입 스텁 + `GET /api/dashboard`(login_records 집계 — 고유 접속자·총 로그인·최근 7일, 나머지 지표는 후속).

### 비교화면 재디자인 C0~C4 (2026-07-05 · feat/compare-redesign, main 머지 a914063)
- 3단 read-only 구성(좌 변경 패널[필터칩·종류 필터·클릭 포커스]·중 캔버스·우 속성 인스펙터[before→after 취소선]) + 헤더 BASE/TARGET pill·swap·PNG export·READ ONLY 워터마크. DB 스키마 무변경.
- diff 노드 스타일(상태 뱃지·틴트·삭제 점선)+before→after 필, passthrough 삭제 엣지는 우회 아크(`RemovedArcEdge`), 엣지 변경 목록은 양끝 기존 노드인 실배선 변경만(중복 제거).
- LR/TB 방향 토글 + 연결성 기반 spine 직선화(`computeSpine`/`alignBackbone`, 실측 렌더 폭 기준) + 의미 기반 핸들 변 직접 배정(그리디 회피 폐기 — 곁가지 꼬임 해소). 데모 시드 `seed_compare_demo`(계보 공유 2버전, map 13).
- 폴리시: 노드 클릭/hover 포커스 링 슬라이드, 휠/키 에디터화(팬·Ctrl 줌·Space 그랩·Tab 흐름 이동), 엣지 라벨 반투명+블러, 포커스 잔상 제거. 진입 버튼은 게시본 있을 때만(BASE 기본=게시본).

### 홈 최근 열람 + 저장 조건 체크리스트 (2026-07-05)
- recent-maps localStorage 캐시(최신 11) — 브라우즈 최근 밴드(접기/펼침)·검색 매치 상단 고정+배지·검색/필터 sessionStorage 유지(새로고침·로고 클릭은 초기화)·빈 여백 클릭 선택해제.
- 좌상단 맵 제목 칩 = 저장 조건 아코디언(`MapTitleChecklist`): 시작 1개·대표 끝·끝 이름 중복 없음·잘못된 다중 출력 감지(문제 노드 클릭 이동). 수동 저장·승인 시작만 차단(autosave·백엔드 불변). 노드 모달 제목 저장 유실 버그 수정.

### 에디터 재디자인 R6~R11 (2026-07-03~04 · feat/editor-redesign 계열)
- R6 컨텍스트 메뉴: 시각 통일(danger 빨간 칩)·전 항목 아이콘·F2 이름변경(노드·엣지)·그룹 메뉴(이름변경·색 인라인)·하위메뉴 상하 뒤집기. 엣지 연결면 패드 직각 커넥터 재작성(16조합 박스 미통과 수치검증).
- R7 노드 편집 모달: 라이브→버퍼 편집(저장/취소·⌘S), 설명 필드, 선후행 클릭 내비+미저장 확인, 속성 영역 우측정렬·구분선·담당자 ＋플라이아웃(body 포털·fitContent). R8 그룹: 타이틀바 색 pill·박스 dashed·벌크 모달 재설계(속성 3탭·충돌 2×2·개별 마법사 이전→현재 필·요약 표).
- R9 엣지 팝업 5종(decision·action·branch·select·Keep/Insert) 리치 재디자인 — 커스텀 애니 SVG(정지 상태=최종형·reduced-motion 가드), select는 리스트형+행 hover 시 캔버스 엣지 하이라이트. 분기 엣지는 브랜치 선택 후 생성(노드 드롭 경로도 보류-적용으로 원자화).
- R10 AI 패널: 공용 `MarkdownView`(자체 파서·XSS safeHref·GFM 표·태그 필·행/인라인 복사) + 스레드 재스타일·헤더 자동 타이틀·폰트 배율·퀵칩·인채팅 제안 카드·최소화 스파클 드래그. R11 드롭존 SVG 부채꼴 링+극좌표 히트테스트(스왑 S 이동).
- 미니맵: 줌아웃 페이드(채움비 기반)·클릭 스태킹 수정(패널에 직접 opacity)·크기 조정. ScopeWindow 8방향 리사이즈·min-h-0 스크롤 수정. 한영 전환 세그먼트 토글.

### 담당자/부서 설정 로직 통일 (2026-07-03)
- 3지점(노드 모달·인스펙터·그룹 벌크) 통일: 부서 단일 + 담당자 같은 부서 복수(콤마, 백엔드 무변경), 담당자↔부서 연동(선택 시 부서 자동), 부서 변경 시 담당자 초기화 확인 모달, 드리프트 경고(부서 불일치 담당자 오류색).
- 그룹 벌크: 결합세트(부서만 3옵션·담당자 4옵션·교차부서 확인 재디자인)·start/end/subprocess 벌크 제외(`hasBpmAttributes`) — 해당 타입은 BPM 속성 입력/표시 자체를 숨김.

### 오류방지·편집 UX R11b (2026-07-04)
- 시작 노드 싱글턴(추가 시 기존으로 이동 안내), 스왑은 같은 종류만(subprocess↔process 예외, `canSwapTypes`), `D` 삭제 가속기+복수선택 삭제 메뉴, 승인 요청 전 `saveCurrentScope` 강제(지금 보는 내용=승인 대상 보장).

### 버전 라이프사이클 후속 폴리시 (2026-07-02~03)
- 점유(체크아웃) sticky — TTL 자동해제 폐기, 인계는 요청 승인/이전만. 요청자 복수 허용+승인 시 타요청 자동거절+철회+provenance(`checked_out_from`). 점유 이동은 draft 전용(거절본 점유 버그 구조 차단).
- 회수 권한 상태별: pending/approved=제출자만, rejected=+오너·sysadmin. 거절 시 거절자 승인 레코드 삭제+`rejected_by` 노출, 반려본은 회수(기록) 후 재제출. 승인자 관리 = 오너 OR sysadmin, 승인 진행 중엔 409.
- 전이 모달(제출/승인/거절/게시/회수) ConfirmDialog 통일 — 요약박스·승인자 현황(본인 하이라이트)·상태는 영어 뱃지, 회수는 제출자→회수자 핸드오프 시각화. UI 용어 "점유권"→"체크아웃" 통일. 버전 마커 `v{n}`/`(Draft)v.{n}` 공통화, 버전 카드 상세 레이아웃 다듬기(rowspan 날짜박스·sticky 1열·말줄임).
- 홈 상세·버전 카드에 "이 버전으로 가기"+에디터 `?version=` 진입, 승인탭 체크아웃 접이식 패널(요청자 카드·호버 결정·철회), 설정 승인큐 탭 everyone 공개(비-sysadmin은 준비 중 안내), 피커 선택 목록 위로+신규 항목 페이드인.

### 시드 전면 재구성 + 로컬 권한검증 (2026-07-02)
- 단일 종합 시드 `seed_org_demo`(조직 센터/담당/팀/파트·직원 401[admin.sys 포함]·맵 12[공개6/비공개6, v1~v5 게시 정상 워크플로 이벤트]·그룹 6), 구 데모 시드 5종 삭제, reset_db=drop_all→seed→verify. 기동 재시드 가드(빈 DB만 시드 — 오염 방지).
- 로컬 권한검증 ON: `backend/.env`에 `DEV_ENFORCE_PERMISSIONS=true`+`BPM_SYSADMINS=admin.sys`(conftest baseline 고정으로 테스트 미오염). ⚠️ 미설정 시 전원 sysadmin=owner라 viewer 시현 불가. DevLoginModal은 하드코딩 5명→디렉터리 fetch 피커.
- README 갱신·폐기 문서/완료 트래커 삭제.

### 버전 라이프사이클 본편 (2026-06-29~07-02 · feat/version-lifecycle)
- `version_number`(게시 시 채번) + `expired` 상태(재게시 시 이전 published 전환+이벤트), 점유권 이전/요청/결정 API(transfer/request/decide-checkout), 만료본 재게시(그래프 복제 새 draft·생성자 점유), 프론트 역할/상태 액션 매트릭스+이전 다이얼로그 검색 피커+pending 결정 배너.
- 생성 게이트 강화: draft/pending/rejected 존재 시 409, 최신이 published여야 새 버전. 뷰어 드래프트 생성 차단, 드래프트 삭제=보유자|오너|sysadmin.
- ⚠️ 배포 RESOLVED: 기존 DB의 `map_versions.version_number`는 기동 시 `_add_missing_columns` 자동 보강(수동 ALTER·reset 불필요). 신규 `checkout_requests` 테이블은 create_all이 생성.

### 에디터 재디자인 R1~R5 (2026-06-28~29 · feat/editor-compare-redesign)
- 전략 전환: 제로베이스 `/v2` 리라이트 폐기 → **제자리 리스타일+컴포넌트 추출**(단축키·드롭존·스코프·undo/autosave 등 기존 동작 전부 보존). 마스터 트래커 단위 검토 방식 확립.
- R1 미니맵(노드 실색 톤다운·뷰포트 악센트 채움)+줌 pill, R2 셀렉션 링=노드 간 슬라이드 인디케이터(`NodeSelectionRing`), R3 상단바(MapNameDropdown·VersionPill·편집 중 이동 확인 모달), R4 편집 툴바(+Node·자동정렬·정렬/분배, 편집 모드만)+노드 검색 사이드바 이전+단축키 카드(↵/Del 배선).
- R5 인스펙터 4탭(속성/맵/승인/활동) — NEW‖OLD 나란히 비교 후 컷오버(OLD 인스펙터·하단 대시보드 제거, 버전 CRUD는 승인 탭으로 이관). BPM 담당자/부서 피커화(eligible-assignees), ApprovalPanel 3단 스테퍼, 멤버 카드=MapDetailCard 재사용, 코멘트 작성자 권한·노드 네비.
- 백엔드(사용자 승인): 드래프트 점유 강탈은 sysadmin 전용 + 생성자 자동 점유.

### 화면 리디자인 S1~S8 + 홈·그룹·관리자 개편 (2026-06-26~28 · feat/frontend-ui-improvements)
- S1 로그인 카드(운영은 Keycloak 단독·dev 모달은 로컬만), S2~S3 맵 설정 폭/노티스·삭제 모달, S4 에디터 뷰어 읽기전용 모드(my_role 통합 — draft 공개맵 뷰어 편집 허점 차단·배지·안내 스트립·워터마크), B1 viewer 멤버 목록 읽기 허용(GET permissions viewer 게이트, 쓰기는 editor+ 유지).
- 홈 H1~H6: 상태+역할 멀티셀렉트 필터 드롭다운, 멤버 행 2줄+호버 펼침(디렉터리에 title·org_path 추가), 버전 타임라인(단계 필·rowspan 날짜박스·클릭 토글·withdrawn 표시), 카드 재디자인+호버 모달(1초·pointer-events 통과), 카드 집계 version_count/node_count/owner_name/member_count(그룹 쿼리로 N+1 회피). ⚠️ 드롭다운 클릭-어웨이 전체화면 오버레이가 페이지 전체 호버를 가로채던 근본원인 → document mousedown 리스너로 교체.
- 그룹 라이프사이클 L1~L6: withdraw/deactivate/reactivate/rename(active만·주1회 `name_changed_at`)+`user_groups.deleted_at` 소프트삭제(7일 퍼지·휴지통·복구)+재신청 프리필, 매니저⊆멤버(★토글·캐스케이드), 그룹 이름 전역 중복 검사(실시간), 가이드 SVG(5상태 라이프사이클), 비활성 시 map_permissions 삭제, 피커 빈 포커스 전체 옵션.
- 관리자: A1 DB 뷰어 무한스크롤, A5~A6 테이블 공통 셸+테이블 pill(행수), A7 삭제 카운트다운, A9 부서 인원수 열, A10 승인 큐 카드+클릭 아코디언, A13 가시성 before→after(`payload.from_visibility`). 캔버스 좌우 휠 패닝(PanOnScrollMode.Free).

### 플로우 규칙 + RBAC 개선 (2026-06-24~25 · feat/flow-rbac-improvements)
- 플로우: F1 디시전 드롭 분기/인터셉트 모달+다중 출력 선택 모달(비-decision 2번째 출력=삽입/교체/취소, 마우스 위치 팝업), F2 회귀(A↔B) 차단(+토스트 안내), F14 흐름 하이라이트(`[`/`]` 경로 증감·Tab/⇧Tab 흐름 이동, BFS 분기 일괄), 시작=출발/끝=도착 전용, F11 맵당 draft 1개 제한.
- 권한: F5 담당자/부서=조회권한자(viewer+)만(eligible-assignees), F10 오너 다운그레이드 무승인+비-오너는 승인 가능자 토스트, F6 admin 티어를 sysadmin으로 흡수(⚠️ 운영 관리자는 `BPM_SYSADMINS` 등록 필수 — `Employee.role`은 정보용), F9 퍼블릭 맵 viewer 지정 불가(백엔드 409 방어), F15 AD 제외 OU 추가, F12 승인본 기준 맵 복사+맵 이름 전역 유니크, AP 승인자 viewer+ 자격 제한.
- Settings v2: PV 가시성 스테이징(선택→변경 적용+미리보기, 퍼블릭 전환 승인 적용 시 잔존 viewer 그랜트 제거)·ST 맵 설정 단일 스크롤+앵커 내비·승인자 카드. DL 맵 소프트삭제(`ProcessMap.deleted_at`·휴지통 7일 lazy 퍼지·복구·"삭제 예정" 탭).
- 인프라: 타임스탬프 KST 통일(`app/clock.py` — 체크아웃 만료 9h skew 수정, 프론트 formatKst Asia/Seoul 고정), `login_records` 테이블(/me 시 KST 하루 1건 중복제거), 역할(Owner/Editor/Viewer)·승인 대기 상태 라벨 영어 고정. 생성 시 public 무시 버그 핫픽스(MapCreate.visibility 미수용이 원인).
- UX: 검색 SR(우선순위 정렬·subsequence·키 내비·아이디 검색·principal 검색 필드 타입별 한정), Tooltip/PromptDialog 신설(native prompt/confirm 4곳 교체·모달 blur 통일), 홈 가시성 탭·빈 상태 환영 화면·협업자 선택 즉시 추가, 승인자 후보 규칙(public=전원·가시성 변경 시 초기화 확인).

### 설정 콘솔 통합 + 홈/에디터 UX (2026-06-22 · claude/frontend-ux-improvements)
- /admin·/admin/permissions·/groups를 **/settings 단일 콘솔**로 통합(좌측 세로 탭 레일, 권한별 카테고리: Groups 모두·조직 admin·권한 sysadmin). DB 테이블 뷰어 탭(읽기전용 인트로스펙션·서버측 페이징/정렬/필터·SELECT 전용 안전장치).
- 홈 마스터-디테일 시작(맵 카드 리디자인·우측 상세 카드[버전+허용 인원+하단 버튼바]·멤버 그룹핑), 카드 최신 버전 상태 필(`latest_version_status` 1쿼리 동봉), 내 소속 멤버 하이라이트.
- 에디터: 툴바 축소→하단 탭 패널(승인/버전/다운로드/디자인 — 이후 R5로 대체), 읽기전용 워터마크, 사이드바 설정 버튼, 맵 설정도 세로 레일로. ⚠️ "누구나 owner"는 버그 아님 — AUTH_ENABLED·DEV_ENFORCE_PERMISSIONS 둘 다 off면 전원 sysadmin(로컬 잠금 방지 설계).

### AI 채팅 개편 Phase 0~6 (2026-06-22 · feat/ai-enhancements)
- `AiProposal` 5종(graph 생성/answer/walkthrough/analysis/ops 증분편집) — 자연어 맵 생성(그룹·어트리뷰트), ops 편집(add/remove/connect/relabel/set_attr — 좌표·색·담당자·그룹 메타 보존), read-only 분석 findings+노드 하이라이트, 워크스루 스텝퍼+자동재생, 조직 디렉터리 주입(담당자 매칭), 매뉴얼 근거 answer(범위 밖은 "모른다").
- persist는 기존 `saveGraph→replace_graph` 검증 경로 경유(우회 없음). `ai_prompt.py` 직렬화+`_structure_hints`로 환각 감소, 502 시 내부 URL 은닉.
- ⚠️ 보고된 미해결: AI 라우트 viewer 게이트 없음(원천 API가 이미 인증자 전원 공개라 신규 노출 아님 — 넓은 read-path 게이팅은 후속 Phase).

### 하위프로세스 권한 마스킹 (2026-06-22 · feat/expand-sync)
- resolved API(`/library/processes/{id}/resolved`)가 viewer 미만이면 `200+{locked:true, nodes:[], edges:[]}`(그래프 미빌드 — 데이터 미유출), 프론트는 Lock 뱃지+펼침/드릴/아웃라인 봉인(호스트 노드·엣지는 유지). 3중첩 픽스처로 차단/허용 양방향 스모크.
- 딥드릴 L2→L3 수정(캡처 dblclick을 scopeId로 분기 — 딥뷰 노드는 RF가 이벤트 미발화), 아웃라인 접기 드릴인 모드 인지, 마스킹 게이트 자리(no-op) 선매설.
- ⚠️ 기록(별건): dev-login `X-Dev-User` 헤더 타이밍 레이스로 compare 초기 GET 403 → 빈 캔버스(dev 전용, 이후 DevGate 렌더 단계 동기 호출로 수정).

### 맵 카드·상세 개편 + 병합 비교 + 시드/검색 (2026-06-23)
- 맵 카드·상세정보 개편 — 버전 git-log 타임라인, **신규 `version_events` 테이블**(created/submitted/approved/rejected/published, 누가·언제 + 멱등 백필), 삭제 확인 모달, description 입력 복원.
- 비교 화면을 좌/우 2캔버스 → **단일 병합 캔버스**로 재작성(lineage 매칭 `merge-diff.ts`·diff 색·클릭 fitView 포커스) + vitest 셋업 도입. 빈 캔버스 진짜 원인=DevGate `setDevUser` effect 호출 → 렌더 단계 동기 호출로 수정.
- 시드 정합성 멱등 패스(`seed_invariants` — 전 맵 owner+승인자, 비-draft 이력 보정) + 재사용 검색 lib(`lib/search.ts` — 부분/한글초성/로마자, `filterByQuery`·`<Highlight>`) + 승인자 필 UI + 홈 검색. 엣지 우클릭=Start/End 박스 테두리 면 선택+라벨 편집(더블클릭), 수동 연결 기본 핸들 s-right/t-left 고정. 브랜딩 "Business Process Map" 풀네임화.

### 권한 관리 RBAC Layer 1~4 (2026-06-20~21)
- UI-first mock(Phase 1-3) → 실 백엔드 전환: Layer 2 맵 엔드포인트 게이트(가시성 필터·viewer/editor/owner·체크아웃 보유 강제)+권한 관리 API(협업자 CRUD·다운그레이드 승인 pending·owner 이양·가시성 요청·결재 결정), Layer 3 프론트 실 API 배선(서버 진실·낙관적 갱신 금지, `/api/me.is_sysadmin`·`MapOut.my_role` 단일화), Layer 4 유저그룹(스키마 3테이블·`effective_role` 그룹 principal[user/dept 멤버십]·그룹 CRUD/승인 큐·협업자 그룹 grant).
- 권한 데모 시드+워크스루 가이드, whole-branch 리뷰 후 mock 스토어 dead code 정리. 캔버스 회귀 픽스 3건(펼침 가로지른 드래그 좌표·아웃라인 펼침 표시·obsolete 드롭존+서브프로세스 엣지 핸들).

### 하위프로세스 참조 모델(Call Activity) (2026-06-20)
- 인라인 계층 편집(`parent_node_id`) 폐기 → 평면 노드 + 다른 맵 링크 읽기전용 임베드. 백엔드: 노드 평면화·subprocess 참조/대표끝/엣지핸들 필드·프로세스 검증·순환 차단·라이브러리/해석 API.
- 프론트 9태스크: 합성트리(compositeTree — 링크맵 resolved를 네임스페이스 parent로 임베드, 렌더 폴리시 무변경)·동적 끝핸들·하위 편집경로 제거·읽기전용 딥뷰 드릴인·라이브러리 드래그·다중출구+버전 업데이트 배지·follow-latest.
- 권한 관리 UI-first mock 구현(이후 Layer 1-4 실 백엔드로 대체), 깊이4 복잡 테스트 맵 시드.

### 캔버스 인라인 펼침·포커스 모드·레슨 (2026-06-18~19)
- 인라인 펼치기/접기 전면 구현(세로 레인·중첩 재귀·캡 노드300/깊이5·모두 펼치기/접기), prop-only 자식 함정 우회(measured 직접 주입·raw dblclick 캡처). 자식 편집은 별도 `childNodes` state 방식(⚠️ 메인 nodes 합치기는 광범위 회귀로 reset — 이후 ⑦에서 인라인 편집 자체 폐기).
- 포커스 모드 — 비활성 스코프 dim/읽기전용·클릭 시 활성화(`navigateTo`+카메라 보정)·조상 감싸기 레인. 아웃라인 키보드 내비게이션.
- `docs/lessons/` 4종 신설(canvas-react-flow·scope-save-and-coordinates·browser-verification·react-ts-patterns) + CLAUDE.md Lessons 섹션.

### 초기 구축 ~ 중반 기능 (2026-06-11~17)
- 스펙 §6 ①~⑤: 스캐폴딩(Next+FastAPI+nginx+compose) → 맵 CRUD+캔버스 → 계층(드릴다운)+dagre 정렬 → 버전관리+비교 → Keycloak 인증(AUTH_ENABLED). Whimsical 디자인 시스템(@theme 토큰·바이올렛 #6A41FF·dot-grid, `rules/frontend/design.md`) + 에디터 UI 대개편(아웃라인·인스펙터·컨텍스트 메뉴·드롭존) + 그룹 풀스택(이후 다중 태그 `nodes.group_ids` JSON+중첩+일괄 편집).
- 버전 승인 워크플로 풀스택(Draft→Pending→Approved→Published+Rejected, 맵별 만장일치 승인자·수동 게시+구버전 강등·인앱 알림). 온프레미스 AI 채팅(OpenAI 호환 프록시·모델 드롭다운). 엣지 핸들 변 커스텀(`source_side`/`target_side` 컬럼·4변 8핸들)·분기 Yes/No 색. 기능 확장 Phase A/B/C(undo/redo·자동저장·BPM 속성·버전 diff 계보·초성 검색·PNG·체크아웃 잠금·노드 코멘트).
- Keycloak 로그인+사내 AD(LDAP) 동기화(`employees` 테이블·`app/ad/`·X-Dev-User·/admin 직원 테이블) + 서버(사내 71번) 배포 성공(포트 3333·명시 서브넷·시드 스크립트 이미지 포함). ⚠️ 평문 HTTP insecure context — `crypto.randomUUID`/Web Crypto 미동작 → `genId()` 사용·Keycloak `disablePKCE`(localhost는 secure context라 재현 안 됨 — 서버/원격 IP로 검증).

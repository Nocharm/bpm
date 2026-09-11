# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-09-11 — 노드 assignee_role 컬럼(백엔드) (dev)

- `nodes.assignee_role`(단일값, 담당자 옆 표시) 신설 — `NodeIn`에 trim validator 얹고 graph upsert·version clone에 이월. 감사(`ref_audit.scan_user_refs`)는 역할을 사람 이름으로 취급하지 않도록 무영향 고정(테스트로 못박음). `process_maps.sp_assignee_role`은 Task 3에서 모델을 붙일 예정이라 DDL만 함께 등록(`db.py` `_ADDED_COLUMNS`). 전체 스위트 1471 green.
- **Task 3**: `process_maps.sp_assignee_role` 모델 컬럼 + SP 지정 PUT/응답/호스트 그래프 대칭 — `SubprocessDesignationIn.assignee_role`(trim, 빈값 None) 저장, `MapOut.sp_assignee_role`로 상세 노출, `SubprocessRefOut.assignee_role`로 호스트 맵 `subprocess_refs`에 상속. 전체 스위트 1472 green.

## 2026-09-11 — 관리 목록 엔진(역할·시스템 카탈로그) 백엔드 1단계 (dev)

- `app_settings.py`에 범용 관리 목록 헬퍼(`normalize_managed_list`/`get_managed_list`/`set_managed_list`) 추가하고 기존 `get_exposed_positions`를 그 위로 재구현. 신규 목록 `assignee_roles`(역할, 빈 목록 기본)·`systems`(시스템, `Other` 예약 항목이 항상 0번)를 얹고 `GET /api/catalogs`(로그인 유저 전원 읽기)를 신설, `PUT /admin/app-settings`에도 편집 필드와 `available_systems`(사용 중 값 승격 후보) 노출. 테스트 4종 추가, 전체 스위트 1468 green.
- **Task 4**: 프론트 카탈로그 클라이언트 기반 — `api.ts` `Catalogs`/`getCatalogs()`·`AppSettings.assignee_roles/systems/available_systems`·`putAppSettings` 패치 확장. `lib/catalogs.ts` 신설 — 모듈 캐시 `useCatalogs()`/`invalidateCatalogs()`(`lib/directory.ts` 패턴) + 순수 함수 `normalizeToCatalog`/`commitSystem`/`formatSystem`(시스템 불일치=Other+원문 메모 보존 규칙). i18n 12키(en/ko) 추가. 아직 UI 미연결. `catalogs.test.ts` 8종 green, 전체 vitest 968 green, tsc/lint clean.
- **Task 5**: `components/suggest-input.tsx` — 자유입력+제안 드롭다운 공용 엔진(`SuggestInput`). `lib/search.filterByQuery` 랭킹·↑↓/Enter/Esc/blur 확정·body 포털 `z-[1400]`(row=인스펙터 행 / field=팝오버 전폭). 아직 미사용(다음 태스크에서 연결). a11y 경고(`role="combobox"`에 `aria-controls` 누락) 1건을 `aria-controls`+메뉴 `id` 추가로 해소. 리뷰 지적으로 메뉴가 열린 동안의 외부 `value` 변경 유실을 픽스 — `seen`/`draft` 동기화를 `!open`일 때만 함께 반영하도록 조건 통합. tsc/lint clean, vitest 968 green.
- **Task 6**: 프론트 데이터 배관 — `assignee_role`을 `api.ts`(GraphNode/SubprocessRef/MapSummary/SubprocessDesignationBody)·`canvas.ts`(NodeData/spAssigneeRole)·page.tsx 그래프↔노드 변환 5곳+신규 노드 리터럴 3곳·`csv-import.ts`(NODE_DEFAULTS/mergeNode 기존값 보존/AI 표면 제외)·`diff.ts`(ChangedField/FIELD_KEYS/FIELD_MSG)·`excel-export.ts`/`excel-wbs.ts`(Role 열, Assignee 다음)까지 스레딩. CSV 열·AI 어트리뷰트는 노출 안 함(패스스루만). vitest 969 green, tsc/lint clean.
- **Task 7**: 역할 표시·편집 연결 — `components/role-chip.tsx` 신설(액센트 틴트 칩), 캔버스 담당자 줄(`process-node.tsx` NodeFields)·인스펙터 읽기 행(`attribute-read-rows.tsx`, SP 상속 공용)·편집 행(`bpm-attribute-picker.tsx`, `SuggestInput` 자동완성)에 배선, page.tsx 3개 호출부(일반 노드 읽기/편집·SP 읽기)에 `assignee_role` 전달. 부서·담당자 페어 로직과 무관 — role 행은 `onChange({ assignee_role })`만 호출. tsc/lint clean, vitest 969 green, COMPONENTS.md 재생성(258개).
- **Task 8**: `components/permissions/role-tile.tsx` 신설(`DeptAssigneeTiles`와 분리, 클릭 위치 팝오버+`SuggestInput`) — 노드 편집 모달·SP 지정 모달(편집)·Subprocess 탭·홈 맵 상세 SP 섹션(읽기)에 배선. `DesignationForm.assignee_role` 필수 필드로 승격, 생성 6곳(usage tab·inspector card ×2·designation panel ×2·inbox) 전부 `sp_assignee_role` 채움. tsc/lint clean, vitest 969 green, COMPONENTS.md 재생성(259개).
- **Task 9**: `components/system-suggest-input.tsx` 신설(`SuggestInput`+`commitSystem` 정규화 — 목록 일치=표기 저장, 자유값=Other+원문 메모, 인스펙터 행만 `ConfirmDialog` 교체/유지 확인) — 인스펙터 시스템 행·노드 편집 모달·SP 지정 모달 팝오버 3표면에 배선, `FallbackHint` 적용도 `commitSystem` 경유로 통일. 나머지 읽기 4표면(Subprocess 탭·인스펙터 카드·홈 맵 상세 SP 섹션·SP 프리뷰 피크)은 `formatSystem`으로 저장값 `Other`만 i18n 라벨 표시. 리뷰 픽스: `SuggestInput`이 커밋 직후(`resyncPending`) 값이 안 바뀌어도 draft를 저장값으로 되돌리도록 — 부모가 입력을 정규화·기각해도(시스템 Other 유지) 입력창이 버려진 글자를 보여주지 않는다. tsc/lint clean, vitest 969 green, COMPONENTS.md 재생성(260개).
- **Task 10**: 설정 Catalogs 탭 — `lib/catalog-csv.ts`(`parseCatalogCsv`/`mergeCatalogValues`, 1열 CSV 파싱+대소문자 무시 병합) + `components/settings/catalogs-panel.tsx`(역할·시스템 두 `ManagedListCard`, 칩 삭제·직접 추가·CSV 임포트·사용 중 값 승격 체크·저장 후 `invalidateCatalogs()`), 조직 카테고리에 탭 배선(sysadmin 편집/`getAppSettings`, 그 외 읽기전용/`getCatalogs`). i18n 18키(en/ko). vitest 972 green(신규 3), tsc/lint clean, COMPONENTS.md 재생성(261개). **리뷰 픽스**: 형제 카드 저장·재조회마다 미저장 초안이 날아가던 버그 — `seen` 참조 비교를 `JSON.stringify` 내용 비교(`valuesKey`)로, 조회 effect deps에서 `t` 제거(언어 토글 재조회 방지, 에러는 렌더 시점에 `humanizeApiError`).
- **Task 11**: Playwright 스모크(`scripts/pw-smoke-assignee-role.mjs`) — 인스펙터 역할 자동완성 저장→캔버스 칩, 시스템 자유값→Other+원문 메모, Catalogs 탭 CSV 임포트→`/catalogs` 반영, 9/9 green. 브랜치 종료 — 역할(assignee_role) 단일값 칸 + 관리 목록 엔진(역할·시스템 카탈로그) 기능 dev 구현 완료(CSV/AI 표면 노출은 후속 과제로 이관, `docs/design/2026-08-24-data-surface-parity-design.md` 후속 절).

## 2026-09-11 — 대시보드 섹션 순서·내 부서 직속 범위·점유 아코디언·승인 딥링크 (dev)

- **섹션 순서** (최근 열어본|업무 체계) → (내 부서|내 문서) → (승인 필요|최근 변경) — 사용자 지시. **내 부서**: 고른 부서가 직접 소유한 맵만 목록·지표에 올리고 하위 부서 맵은 건수 한 줄(`splitDeptMaps`, 직속 0건이면 빈 상태 + "하위 부서 맵 N건" 풋). 좌측 트리의 내 부서 섹션(`filterMyDeptMaps`, 자손 포함)은 그대로. **하위 부서 모달** `dept-sub-maps-modal.tsx`: 건수(지표 줄·빈 상태 풋) 클릭 → 부서별 맵 묶음. 부서 행 = 범위 전환(체인 밖 부서는 드롭다운 맨 위에 끼움, `isAllowedScope`는 내 최상위 조직 아래면 허용) + 좌측 조직 트리를 조상까지 펼치고 노드로 스크롤(`onRevealDept`, ref 소비 후 orgOpen 효과에서 스크롤), 맵 행 = 선택.
- **점유 목록**: `useClosingKeys` 아코디언 펼침/접힘, 행 선두는 맵 공개 범위 아이콘(Globe/Lock — `MeDashboardCheckoutOut.visibility` 추가) 이고 클릭 대기 링이 그 자리를 대체(`HoverLinkedRow leading`). **링 회전** 한 바퀴→반 바퀴(호 채움 0.6초 동일). **승인 필요 행** 클릭은 맵 상세 대신 `/inbox?approval=<kind>:<id>` — 인박스가 파라미터를 소비해 승인 탭 전환·카드 선택·스크롤(`?notification=`과 같은 패턴).
- **상태|버전 탭 + 막대 재디자인**: 내 부서·내 문서 헤더 우측 세그먼트 탭(`DistributionTabs`, 카드별 localStorage 영속). 버전 탭은 맵을 미게시·게시본 최신·업데이트 진행 중·재확인 필요 넷으로 센다(`bucketOfMap` — 만료/반려→재확인, 최신이 게시/확정→최신, 게시본 있는데 최신이 진행 중→업데이트 중). BE 목록 응답에 `latest_version_number`·`published_version_number` 추가(행 메타 `v1 → Draft` 칩). 막대는 2px 간격 알약 조각 + 폭 전환 애니 + 조각 호버↔범례 필 연동(선택/호버 중 나머지 조각 opacity 35%). 옛 `StatusBar`/`StatusLegend`는 범용 `Distribution`으로 통합(목업 `docs` 없음 — 아티팩트로 비교 후 A안 확정). **차트 채움 토큰** `--color-chart-*`(draft·pending·approved·published·rejected·expired) 신설 — 텍스트 시맨틱(added/changed/error)은 조각으로 깔면 칙칙하다는 피드백. `VERSION_STATUS_TONE.dot`이 전부 이 토큰을 보므로 맵 카드·행·비교 화면 상태 점도 같이 밝아진다(pill 텍스트 색은 그대로).
- **업무 체계 행 연계 캔버스 버튼**: 상시 노출 → 행 호버(키보드 포커스 포함) 시에만 grid 0fr→1fr로 열리며 등장(진입 300ms 지연·이탈 즉시, 맵 행 열기 버튼과 같은 규칙). ⚠️ 페이드는 `<button>`이 아니라 감싼 span에 — 전역 `button { transition: transform }`(globals.css, 무레이어)이 유틸리티 transition·delay를 덮어쓴다(맵 행은 `<a>`라 무사했음).
- **빈 상태 재배치**: `DashboardSection`에 `empty` 슬롯 — 아이콘+문구 세로 스택을 본문 중앙(2열 stretch 높이 기준)에 띄우고, 다음 행동(새 맵 만들기·체계 탐색·내 부서 맵·하위 부서 맵 N건)은 헤더 우측 `more` 링크로 이동. `DashboardEmpty.action` 제거. 빈 상태 컨테이너는 측정 래퍼(bodyRef) 밖이라 자연 높이·펼침 토글 판정에 안 잡힌다.
- **권한 게이트 검토**(변경 없음): 대시보드의 모든 블록이 기존 API 집합을 재사용 — 맵 계열은 `GET /maps`(load_my_roles 가시성 필터) 위에서 FE가 자르고, 최근 변경은 owner/editor 맵만(BE), 결재는 inbox 큐, 체계는 get_admin_scope seed, 점유·요청·알림·피드백은 본인 행만. 하위 부서 건수·최근 열람도 접근 가능 맵으로만 센다.

## 2026-09-11 — 대시보드 후속 4종 + 지연 0.6초·행 선택 지연 (dev)

- **프로필 부서**: 긴 조직 경로 대신 말단 부서만 무채색 필(전체 경로는 title). **최근 변경 행**: 조각(유저 필·맵 이름·버전 칩·글자)을 flex items-center로 세로 중앙 정렬(실측 중심 y 전부 동일), 맵 이름만 말줄임·버전 칩은 안쪽 span 말줄임.
- **섹션 간 맵 호버 연동** `dashboard-hover.tsx`(Provider+`useHoverMap`): 맵 행·최근 변경·결재·점유 행이 같은 맵이면 함께 `bg-surface-alt` 강조(pearl은 실측상 안 보여 한 단계 진하게). 버튼 행은 `HoverLinkedRow`로 통일(`data-map-id`·`data-linked`).
- **SP 섹션**: 빈 값 표기를 전부 짧은 대시(`–`)로. 부서는 값이 있으면 이전처럼 헤더 없이 필이 타일을 대신하되(사용자 재확인), `DeptPill` fill 변형의 여백·아이콘을 빈 타일 머리 행과 같게(px-2.5 py-2·아이콘 16·gap-2) 맞춰 두 상태의 아이콘·이름 좌표가 일치.
- **섹션 셸**: 접힌 채 넘치면 헤더는 고정하고 본문(`-body`, scroll-soft)만 안에서 스크롤 — 휠은 안쪽이 먼저, 끝에 닿으면 바깥 대시보드로 체이닝(기본값). 헤더 자체 클릭도 펼침/접기(안의 슬롯·더보기·토글은 전파 차단). 자연 높이는 헤더+본문 안쪽 래퍼 두 곳을 ResizeObserver로 잰다(스크롤 박스는 자기 높이가 잘려 못 잰다).
- **지연 실행**: `NAV_DELAY_MS` 1000→600(CSS 링 동기), 훅에 `toggleAction(key, run)` 추가 — 맵 행 클릭(카드 선택)·결재/점유/최근 변경 행 클릭도 0.6초 대기 후 선택, 재클릭 취소(맵 행은 상태 점 자리, 버튼 행은 좌측 가장자리에 링 + 행 틴트). 실측: 행 취소 후 대시보드 유지·선택 807ms·알림 이동 730ms(클릭 왕복 포함).

## 2026-09-11 — 1클릭 지연 이동 (dev)

- **이동 메뉴 폐기 → 지연 이동**: 활동 타일(결재·요청·미읽음·피드백)·프로필 알림/체계 설정/설정 버튼·결재 카드 링크아웃·대시보드 맵 행/맵 카드의 "열기"가 클릭 즉시 `router.prefetch` 후 1초 카운트다운 링(`components/nav-ring.tsx`, `NAV_DELAY_MS`=CSS 1000ms)으로 바뀌고 이동, 그 사이 다시 클릭하면 취소. `lib/use-delayed-nav.ts` — 전역 단일 대기(다른 대상 시작 시 이전 취소), 언마운트 시 폐기, 새 탭 modifier는 브라우저 기본. 열기 버튼은 대기 중 호버가 끝나도 열린 채 유지.
- 랜드마인: 훅 인스턴스 식별자를 `useRef({}).current`로 렌더 중 읽으면 `react-hooks/refs` 린트 실패 — `useState(() => ({}))`로. `GoToMenu`는 부서 범위 피커만 남았다.
- 실측(3051): 타일 클릭→링·취소 후 URL 불변, 알림 버튼 1초 후 `/inbox`, 맵 행 열기 1초 후 `/maps/24`, 피드백 대기 중 설정 클릭 시 피드백 링 해제·`/settings` 착지. `pw-verify-home-dashboard.mjs` 18/18.

## 2026-09-11 — 개인 대시보드 미세 조정 6종 (dev)

- **부서 카드**: 헤더는 "내 부서"만, 부서명은 헤더 우측 드롭다운(상위 없으면 정적 필 — `DashboardSection.aside` 슬롯 신설), 맵 수·트리 보기는 내 문서처럼 하단 링크아웃 행(`home.dash.deptFoot`)으로 이동(지표 행의 "맵 N"은 중복이라 제거).
- **최근 변경**: 문장 템플릿을 토큰 단위로 쪼개(`renderTemplate`) 유저=필·맵=굵은 이름·버전=칩(라벨형은 `max-w-24` 절단)으로 구분, 이벤트 종류 아이콘 칩(버전 타임라인과 같은 톤)은 행 끝. **맵 행**: 상태 점이 맨 앞, SP 아이콘은 이름 바로 뒤.
- **섹션 높이 상한** `SECTION_CAP`(272px) + overflow hidden + 하단 페이드, 넘칠 때만 헤더에 펼침 토글(max-height 350ms) — 2열 그리드는 stretch로 좌우 같은 높이. **상단 sticky**: 프로필+타일 블록 `sticky -top-4`(컨테이너 패딩 보정) + `bg-surface-alt/85`·`backdrop-blur-[3px]` + 하단 그라데이션으로 지나가는 섹션을 흐린다.
- **후속**: 부서 범위 피커는 무채색 — 필 호버 `bg-surface-alt`/`text-ink`, 메뉴 현재 항목 `bg-surface-pearl` 굵게(공용 `GoToMenu.active` 스타일, 다른 소비자는 active 미사용).
- 검증: tsc·lint·vitest 953·카탈로그 그린, `pw-verify-home-dashboard.mjs` 18/18(sticky·행 순서·이벤트 아이콘 체크 추가), 실측 admin.sys·yerin.jang(부서 맵 2·드롭다운 4단) 캡처.

## 2026-09-11 — db-viewer 읽기전용 조회 연결 검증 후 철수 (dev)

- 같은 71번 서버 db-viewer가 이 앱 Postgres를 읽는 연결을 9910에서 검증(전용 external 브리지 `dbv-bpm9910` 10.203.1.0/24 + 별칭 + `dbviewer_ro`) — **연결 성공**. 이후 가이드는 db-viewer 저장소가 총괄하기로 하고 이 저장소의 compose `dbv` 네트워크 합류·`DBV_*` env·런북 md/html·문서 포인터(setup-once A9·deploy §3·9910 §2)를 전부 되돌렸다(운영은 아직 미연결 — external 네트워크 선행 요구를 compose에 남기지 않는다). 교훈만 기록: 별칭은 스택마다 달리, `down -v`는 롤을 지운다(pg_dump는 롤 미포함), 브리지 대역은 사내 실제 호스트와 겹치면 안 된다.

## 2026-09-11 — 개인 대시보드 미세 개선 8종 (dev)

- **행**: 제목 톤다운(ink-secondary)·SP는 맵 카드와 같은 아이콘 박스·상태는 점 인디케이터만(툴팁 라벨, 범례 라벨은 유지)·열기 버튼은 맵 카드 호버 필과 동일 디자인 + 버튼 자체 호버(액센트 테두리) + `grid-cols-[0fr→1fr]`로 폭이 열리며 우측 항목이 밀리는 등장(진입 300ms 지연, 이탈 즉시).
- **이동 메뉴**(`go-to-menu.tsx`): 결재/요청/미읽음/피드백 타일·승인 카드 링크·프로필 알림 버튼은 바로 이동하지 않고 마우스 위치에 "…로 이동" 메뉴를 먼저 띄운다(설정·체계 설정은 바로 이동). 아이콘·active 옵션으로 선택형 메뉴에도 재사용.
- **필터 강조**: "내 맵만"·상태 필터 버튼이 좌측 필터를 바꾸면 필터 행이 `filter-flash` 900ms 1회 강조(onAnimationEnd로 해제).
- **내 부서 범위 드롭다운**: 리프→루트 조상 경로 선택(체크 표시), `bpm.home.dashDeptScope` 영속(현재 경로 조상이 아니면 리프로 복원). 카드가 필터 전 전체 맵을 받아 범위로 거른다.
- **스크롤 숨김**: 대시보드 루트 `scrollbar-hidden`. 실측(bora.hwang, 1600px): 점·아이콘·열기 슬라이드·범위 Growth Center 7건 리로드 유지·이동 메뉴·강조 attr 확인.

## 2026-09-11 — 맵 카드 호버 모달 화면 하단 반전 (dev)

- **원인**: 호버 요약 모달이 `fixed`로 카드 상단(`rect.top`)에만 고정되고 뷰포트 높이를 보지 않아, 화면 아래쪽 카드에서는 모달 하단이 잘렸다(높이는 행 수에 따라 가변).
- **수정**: `lib/clamp-viewport.placeBesideAnchor`(상단 정렬 → 넘치면 카드 하단 정렬로 반전 → 그래도 안 들어가면 여백 클램프, 단위 테스트 3) + 모달 ref 레이아웃 이펙트에서 실측 `offsetHeight`로 top 확정(`getBoundingClientRect`는 등장 애니메이션 `scale(0.98)` 첫 프레임에 4px 작게 잰다). 실측(700px 뷰포트, 카드 하단 676px): 모달 하단 676px 정렬.

## 2026-09-11 — 홈 개인 대시보드 재구성 + 프로필 빠른 액션 (feat/map-tab-dashboard)

- **배경**: 맵 탭 미선택 aside가 최근 열람·오너 도넛·승인 3카드뿐이라 오너 맵 없는 유저는 카드 하나만 남고, 과다 유저는 목록이 무제한으로 늘어졌다. HTML 목업(빈약·중간·과다 3시나리오) 확정 후 구현.
- **구성**: 프로필 마스트헤드(아바타·역할 칩 Sysadmin/체계 권한자·부서 경로·직전 로그인 + 빠른 액션 — 내 맵만 필터는 라벨, 알림·체계 설정·설정은 아이콘 전용+툴팁) → 활동 타일 5(결재 대기·내가 낸 요청·점유 중 버전(클릭 시 목록 펼침)·미읽음·내 피드백) → (승인 필요|내 문서) → (내 부서 맵|업무 체계) → (최근 변경|최근 열어본). 2열은 aside 폭 `@container 42rem` 기준. 모든 섹션 **행 상한(3~6) + "N건 더" 링크아웃**, 빈 데이터는 `null` 반환 대신 **한 줄 빈 상태 + 다음 행동**. 도넛은 상태 분포 바+범례 필터로 대체(`charts/donut`·`donut-geometry` 삭제).
- **백엔드**: `GET /api/me/dashboard`(`routers/me_dashboard.py`) 단일 집계 — 결재/요청/점유/미읽음/피드백 수·직전 로그인·점유 목록·내 요청·최근 이벤트(오너/편집자 맵, 내 draft 잡음 제외)·권한 카테고리별 L5/미확정/슬롯 대기. `list_maps`의 유효 역할 블록을 `permissions/access.load_my_roles`로 추출해 공유. 스키마 변경 없음.
- **검증**: backend pytest 1463·ruff 그린 / tsc·lint·vitest 950(신규 `dashboard-stats.test.ts` 5)·카탈로그 그린 / `pw-verify-home-dashboard.mjs` 16/16(도넛 체크→범례 클릭·신규 섹션 5종·타일 렌더로 갱신). 실측 admin.sys(오너 19·점유 2·이벤트 20)·admin.kim(전부 빈 상태) 캡처.

## 2026-09-10 — 트리 조상 강조 템포 조정 (feat/tree-guide-tempo)

- **피드백**: 200ms 즉응이 촘촘한 트리에서 마우스를 따라 행마다 튀어 어지럽다. 전환을 350ms `ease-smooth`로 늦추고 진입 지연 120ms(스치는 이동은 반응 안 함)·이탈 지연 80ms를 둔다. 휴식 규칙의 transition=이탈, 활성 규칙의 transition=진입으로 나눠 비대칭 지연 구현. 템포 값은 `:root` `--tree-tempo`/`--tree-delay-in`/`--tree-delay-out` 한 곳. 이름 색·굵기도 같은 템포(정적 굵기라 굵기는 즉시).

## 2026-09-10 — 트리 조상 강조 2차: 가이드 라인 + 밀림 애니메이션 (feat/tree-ancestor-guide)

- **배경**: 1차(이름만 검정)가 12px에서 너무 약했다. 목업 4안(현재/A 글자 강화/B 행 틴트/C 가이드 라인) 비교 후 **A+C** 확정(사용자).
- **구현**: 헤더 `[data-tree-head]`에 `::before` 2px 액센트 선(원래 들여쓰기 자리, scaleY 0→1 200ms)이 켜지고 `--tree-shift: 10px`로 체브론·이름이 오른쪽으로 밀렸다가 호버가 떠나면 당겨진다(padding-left 전환). 들여쓰기는 인라인 px 대신 `--tree-indent` 변수 + `pl-[calc(...)]` 클래스(`lib/tree-indent.ts` 단일 소스 — 업무 체계는 div 헤더/button 패딩이 분리라 변수·클래스 분리). 호버 행 자신도 선을 켜 조상과 한 줄로 잇는다. 조상 이름은 검정 + **500**. reduced-motion이면 전환 없음.
- **굵기 500 확정**: 굵기 사다리(300/400/600) 밖이지만 600은 12px 행에서 과하다는 사용자 결정 — 유일한 예외로 `rules/frontend/design.md`에 명시.
- **검증**: tsc·lint·vitest 948·카탈로그 그린. 실측(부서 Growth Team 호버): Growth Center·Marketing Office pad +10px·선 scaleY(1)·500·검정, 형제 Brand Team 미변. 업무 체계: 선택 EPCV는 선·밀림만(액센트 유지). `pw-smoke-framework.mjs`의 `framework-node > button` 셀렉터는 헤더 div 도입(이전 커밋) 이후 낡은 것 — 이번 변경과 무관.

## 2026-09-10 — 홈 맵 상세 SP 섹션: 타일 단위 메모 아이콘 호버 + 부서 타일 축소 (feat/home-sp-tile-hover)

- **메모 아이콘 일괄 스왑 원인**: 섹션 루트가 "모두 펼치기" 버튼용 무명 `group`이라 `.group:hover .note-swap-*`가 섹션 어디를 호버해도 안의 모든 타일 아이콘을 한꺼번에 바꿨다. 섹션은 named group `group/sp`로 바꿔(멤버 카드 `group/member` 선례) 타일의 무명 `group` 호버만 스왑을 켠다.
- **부서 타일(DeptPill block)**: 글자 caption→fine, 보조 이름(반대 언어)은 필 호버 때만 opacity로 노출(자리는 유지 — 호버로 그리드 행 높이 안 튐), 인터랙티브면 `cursor-pointer`. 아이콘은 열 밖 `mt-0.5` 고정 오프셋 대신 이름과 같은 행 `items-center`로 — 글자 크기를 바꿔도 세로 중앙 유지(사용자 지적).
- **열 비율**: BPM 속성 그리드(≥40rem) 부서 1.5→1.75fr, 담당자 1.5→1.28fr(85%), 시스템 스택 3fr 유지 — 실측 219/160/375px. 담당자 미입력은 "Not set" 대신 짧은 대시(`vertHead` emptyText).
- **트리 조상 강조(부서·업무 체계 공용)**: 하위 행(또는 L5 박스 안 맵 카드)을 호버하면 그 경로의 상위 행 이름만 검정(`--color-ink`)으로 — 펼친 행은 tertiary 톤다운이라 가지를 잃기 쉬웠다. CSS `li[data-tree-node]:has(li:hover)` + 헤더 훅 `data-tree-head`/`data-tree-name`(globals.css, 비레이어라 Tailwind 색 유틸리티를 이김). 선택 행(업무 체계)은 액센트 유지(훅 미부여). 실측: 부서 Growth Team 호버→Growth Center·Marketing Office만 검정, 형제 Brand Team 제외 / 업무 체계 L5 호버→Facility·계측 보전·Calibration 기획 및 운영 / 카드 호버→소유 L5까지 5단.
- **노트 카드**: 제목 caption-strong→fine semibold·본문 caption→fine→**11px(leading-snug)**, 제목은 카드형도 한 줄 말줄임(전문은 title 속성 — 줄바꿈 예외 폐기). 출처(Imported)·수정됨 표시는 행 호버 때만(opacity, 편집/삭제 버튼과 같은 규칙). `ClipBody`는 클립 중(넘침·미펼침)에만 내용 하단 `pb-8` — 끝까지 스크롤해도 마지막 노트가 h-10 페이드 밑에 깔리지 않는다(설명 섹션도 같은 공용이라 함께 적용).
- **검증**: tsc·lint·vitest 948·카탈로그 그린. 신규 스모크 `scripts/pw-smoke-home-sp-tile-hover.mjs` 9/9(섹션 호버=펼치기 버튼만·타일 호버=그 타일 아이콘만·부서 12px·중앙 gap 0·pointer). 보조 이름 호버 노출은 시드에 한글 부서명이 없어 미실측.

## 2026-09-10 — 홈 맵 상세 SP 섹션: 미지정 맵도 접힌 채 노출 + 부서 타일 상시 경고 픽스 (feat/home-sp-section)

- **섹션 상시 노출**: SP 미지정이고 값·메모도 없는 맵은 섹션을 아예 안 그렸는데(목업 v5 결정), 톤다운 배경·muted 헤더·`Not designated` 필로 접힌 채 남긴다(사용자 지시). 펼치면 빈 타일(Not set)만 보인다.
- **부서 타일 상시 경고 원인**: 섹션이 `DeptPill`에 저장 리프명 대신 해석된 슬래시 조직 경로를 넘겨 유효 리프 집합(`buildDeptLeaves`, 세그먼트/리프명 집합) 대조가 항상 실패 → 정상 지정 부서도 고아 경고. 저장값(리프명)을 그대로 넘기고 경로 해석은 필이 다시 하도록 정정(인스펙터·지정 모달 타일과 같은 호출 방식).
- **검증**: tsc·lint·vitest 948·카탈로그 그린. 신규 스모크 `scripts/pw-smoke-home-sp-section.mjs` 9/9(맵 1 Order Fulfillment=Brand Part 1 경고 없음, 맵 2 Employee Onboarding 접힌 회색 섹션).

## 2026-09-10 — 노드 고아 부서·담당자 경고: 인라인 아이콘 + 배지 호버 내역 (dev)

- **기존 우하단 배지 실태**: `AssigneeWarningBadge`는 "담당자 부서 불일치" `title` 하나로 세 상황(재직자 명단에 없음·이 맵 열람권한 없음·부서 드리프트)을 뭉쳐 있었고, 판정 소스가 `eligible`(맵 열람권한자)이라 **비공개 맵에서 재직자를 미등재로 오판**했다. 부서 고아는 아예 신호가 없었고 SP 노드는 `hasBpmAttributes` 가드로 제외됐다.
- **구현**: 판정을 `/directory`(active 전 직원) 기준으로 옮겨 감사(`app/ref_audit.load_valid_sets`)와 같은 집합을 보게 하고(`lib/node-ref-warnings.ts` 단일 소스), `eligible`은 "열람권한 없음"만 가르는 역할로 축소. 캔버스는 속성 줄 아이콘만 경고색으로 바꾸고(글자색 유지 — 노드가 많아도 도배 안 됨) 우하단 배지에 건수 + 호버 내역(`HoverTip`)을 붙였다. `DeptPill`·`AssigneePills`는 스스로 고아를 판정해 인스펙터·노드 편집 모달·홈 상세가 같은 톤을 공유한다. 새 토큰 `--color-warn`(#b45309) — 고아는 error가 아니라 "확인 필요"라 error 재사용은 과하다(사용자 결정).
- **가드**: 디렉터리 미도착이면 `refCheck=null`로 판정 자체를 건너뛴다 — 로드 전 판정은 전 노드를 경고로 물들인다. 비교·프리뷰 표면도 null(디렉터리를 안 부른다). 판정은 노드 컴포넌트가 컨텍스트로 직접 해서 RF 노드 data를 안 건드린다(재렌더 churn 없음).
- **검증**: tsc·lint·vitest 945(신규 9)·카탈로그 그린. 브라우저 캡처 `scripts/pw-orphan-warning-shots.mjs` 4/4(8047/3047, `seed_ref_audit_demo`).

## 2026-09-10 — 임포트 부서 인덱싱: sp_department 리프화 + "/" 든 부서명 사전 (dev)

- **문제**: JSON 임포트가 `owning_department`만 조직 트리에 정렬하고 `sp_department`엔 전달물 전체 경로를 그대로 박았다(실측 `Quality Center/QC Department/...`). 앱의 sp_department 계약은 리프명이라 라이브러리 부서 트리는 어느 부서를 눌러도 0건(임포트 값이 별도 루트로 튐), 고아 참조 감사는 임포트 맵을 전부 고아로 신고했다.
- **구현**: `resolve_sp_department`가 착지 경로의 리프명을 쓴다. 착지 실패한 값에서 리프를 뽑는 건 금지 — `A/ADC T/F`의 마지막 칸은 `F`라 가짜 부서가 생긴다(전달값 통째로 유지). 부서명 자체에 `/`가 든 실부서(`ADC T/F`, `AX/PI Department`)는 경로 구분자와 같은 문자라 쪼개면 두 칸으로 찢어져 영영 미매칭이었다 — `collect_slashed_dept_names`가 조직 미러에서 그런 이름 사전을 만들고 `merge_slashed_segments`가 **쪼개기 전에** 전각형으로 되붙인다(세그먼트 경계 치환·긴 이름 우선으로 오탐/비결정성 차단).
- **검증**: backend pytest 1459·ruff 그린. 신규 테스트 5종(4종은 구현 전 red 확인).
- **잔여**: 리프 표기 통일은 보류 — `/` 든 부서의 리프가 임포트는 전각형(트리·감사와 일치), 피커는 원본형(`Employee.department`)이라 갈린다. 임포트와 무관한 기존 문제라 별도 건으로 남긴다.

## 2026-09-09 — 고아 참조 감사 구현 (feat/ux-polish)
- **문제**: 기존 소멸 부서 재지정은 조직 경로 3곳(맵 부서 권한·그룹 부서 멤버·오우닝)만 봤다. 노드·SP 지정의 담당부서(리프명)·담당자(이름)와 사용자 참조(오너·협업자·승인자·그룹·카테고리)는 조직개편·퇴직 뒤 조용히 낡는다.
- **구현**(`docs/design/2026-09-09-ref-audit-design.md`, 플랜 10 Task): 참조 12곳을 **온디맨드 스캔**(저장 테이블 없음, `app/ref_audit.py`) → 설정 > 조직 > "Orphaned refs" 탭에서 값별 그룹·라인 체크로 일괄 replace/remove(노드 필드는 드래프트 필요라 캐치·체크 불가), 오너에게 오너당 1건 묶음 알림(`ref_fix_requested`)·오너 교체 시 `owner_assigned`, 홈 카드 "Stale refs" 배지 + Owning 필터를 Issues로 확장. 노드 스캔은 게시본+최신 드래프트. 데모 시드 `backend/scripts/seed_ref_audit_demo.py` + 브라우저 스모크 `frontend/scripts/pw-smoke-ref-audit.mjs`(10/10 PASS) 추가.
- **검증**: backend pytest·ruff 전체 그린, frontend tsc·lint·vitest·컴포넌트 카탈로그 그린. 포트 8047/3047으로 스모크 확인.
- **랜드마인**: 그룹 카드 인터랙티브 `data-id`는 Task 8 수정으로 `${kind}-${value_kind}-${value}` 접미사가 붙어 `^=` prefix 스코프 필요. `ref-audit-panel`은 GET 완료 전에도 마운트돼 `.count()` 즉시 호출은 로딩 중 0으로 오탐(그룹 로케이터 `waitFor` 선행 필요). 부서 뷰는 아코디언 미펼침 시 `MapCard` 언마운트라 배지 확인은 검색(평면 목록)으로 우회. 인박스는 좁은 화면용 카드-아래 아코디언이 상세를 이중 마운트(`split:hidden`)해 칩 개수가 2배로 잡히므로 우측 aside로 스코프.
- **최종 리뷰 수정**: 홈 배지(`GET /api/maps`)와 감사 스캔의 드래프트 스코프를 `ref_audit.load_target_versions`로 단일화(최신 버전이 draft가 아니어도 최신 드래프트는 계속 센다) — 배지·탭이 다른 숫자를 보이던 어긋남 제거. `count_stale_refs_by_map`의 노드 조회에 SQL 사전 필터(`department`/`assignee` 후보만)를 추가해 `GET /api/maps` 핫패스의 행 볼륨을 줄이되 온디맨드 스캔 방식은 유지(컨트롤러 판단). 그 외: 죽은 `_NAME_SOURCES`/`refAudit.pickUser` 제거, 패널 에러 표시가 Rescan 버튼을 가리던 것 인라인으로 전환, 그룹 카드 `data-id` 2종 키 접미사 보강, 부서 테이블·orgchart·9910 문서의 낡은 "dept-remap" 문구를 "ref-audit"로 정정.

## 2026-09-09 — 임포트 리포트 UI 4종: 세그먼트 토글·L5 미리보기·3노드 높이·노트 내용 diff (feat/ux-polish)
- **거버넌스 유지/교체 드롭다운 재디자인** — 컨트롤은 드롭다운 그대로 두고 **펼친 목록만** 앱 디자인으로(네이티브 `option` 목록은 OS가 그려 리포트 톤과 어긋났다). 트리거+포털 목록(체크 표시·아이콘·hover), 섹션 본문이 `max-h` 스크롤이라 `absolute`면 잘려 body 포털+fixed(z 1250, SearchSelect와 같은 계약)·아래 공간 부족 시 위로 플립. 스모크는 `selectOption` → 트리거 열고 `-replace` 클릭으로 이관.
- **L5 연계 캔버스 미리보기 신설** — 캔버스 행 호버 시 Preview 노출(맵 행과 같은 규칙). `buildL5PreviewGraph`가 파일 최상위 `relations.edges`로 rows(subprocess)+`externalTasks`를 잇고, 백엔드 `expand_linkage_branches`처럼 택일 팬아웃 앞에만 분기 노드를 세운다(전부 `parallel`이면 제외). 미선언 끝점은 코드 그대로가 제목.
- **미리보기 높이 1.5노드 → 5노드(266px) + 펼침/접힘 애니메이션**(grid-rows 0fr↔1fr, 350ms). 랜드마인: 맵 목록 4행 캡의 `useLayoutEffect` 실측이 전환 시작 전 값을 재 미리보기가 잘렸다 — 열리는 행은 안쪽 `data-preview-body`의 `scrollHeight`로 보정해 목록이 같은 속도로 늘어나게 했다.
- **임포트 노트 거버넌스는 내용 비교가 1차**(백엔드 동반 수정) — `diff_import_notes`가 (kind, title) 키로 짝지어 added/removed/changed만 남기고, **차이가 없으면 행 자체를 안 내려보낸다**(재삽입해도 결과가 같아 그냥 skip). 다르면 `GovernanceDiffOut.note_changes`로 실어 보내 행 호버 시 뜨는 "변경사항 자세히"가 git diff식 아코디언(`-` 기존 / `+` 남을 본문)을 편다. 종전 "임포트 노트가 있으면 항상 결정 행"은 폐기 — 회귀 테스트도 새 계약으로 옮겼다.
- **검증**: backend pytest 1440·ruff, vitest 917(L5 빌더 5케이스 신설), tsc·lint·카탈로그, 스모크 interview-import 26/26, 캡처 7장(호버 노출·펼침·드롭다운 열림·노트 diff). 포트 8047/3047.

## 2026-09-09 — 홈 맵 상세 패널 섹션 재구성: 설명|노트 3:2 + 서브프로세스 정보 타일(원문 메모 병합) (dev)
- **배경(사용자)**: 맵 이름 아래 설명/서브프로세스 정보/인터뷰 원문 메모/노트 4박스가 헤더 없이 이어져 시스템에 익숙하지 않은 사용자에게 구분이 안 보임. HTML 목업 5차(워스트 케이스 데이터)로 레이아웃을 확정한 뒤 구현.
- **후속 라운드(2026-09-09)**: 부서는 말줄임 알약 → **줄바꿈 둥근 사각형**(`DeptPill variant="block"`, 14px — 긴 부서명 전문 노출), BPM 속성은 **2행**(시스템 / GMP·URL 1:2), 입력물·산출물 각 행에 **데이터 형식 필**(`parseIoRows`가 `sp_*_forms`를 줄 번호로 1:1 짝지음 — 글머리 음수 들여쓰기가 필 안에 상속돼 겹치므로 `indent-0` 필수), 노트 헤더의 접기 제거 → **설명 헤더가 두 섹션을 함께 접음**(`SectionHeader`는 `onToggle` 없으면 정적 span). 필수/선택 플래그는 SP 지정에 컬럼이 없어(노드 `input_flags`만 존재) 미표시 — 필요 시 백엔드 컬럼 추가 필요. 형식 필은 `align-middle`+행 줄높이(18px)+`-top-px`로 행 글자와 세로 중앙 일치(실측 오차 0.2px), 8rem 초과는 말줄임(제목에 전문). 결합 IO 타일의 반쪽은 `flex-1` 균등분할이면 글자가 중간에서 잘려 **자연 높이**로 바꿔 그리드 행이 따라 늘게 함. 항목이 많으면 3줄 클램프 대신 **반쪽별 세로 스크롤**(`max-h-16`+`scroll-soft`, 4행째가 살짝 보여 더 있음 암시)과 **행 호버 배경**(클릭 동작·커서 없음). 부서는 값이 있으면 **필이 곧 타일**(헤더 생략, `DeptPill fill`+`subLabel`로 반대 언어명을 필 안 톤다운 줄로), 없을 때만 비활성 헤더 타일. URL은 값이 있을 때만 폭(1:2)을 갖고 비면 36px 아이콘 타일로 줄어 GMP가 남는 폭(124→335px)을 가져간다.
- **구조**: 상단 3:2 **설명 | 노트(카드형)** — 둘 다 접힘 높이 136px 클립(처음 272 → 사용자 지시로 절반)(스크롤바 숨김·하단 페이드·헤더 펼치기/접기, `components/clip-body.tsx`), 헤더는 공용 `SectionHeader`(체브론+아이콘+제목+건수). 하단 전폭 **서브프로세스 정보**(`maps/map-detail-sp-section.tsx`, 순수 로직 `lib/sp-detail.ts`): BPM 속성=부서 필(1.5/6, `DeptPill label`=UI 언어 이름, 클릭 조직 모달, 아랫줄 반대 언어명 톤다운 — 처음 트리안은 사용자 지시로 필로 회귀)·담당자 인물 필(1/6, `AssigneePills` 호버/클릭 인물 카드)·3행 높이 클립(셀을 absolute로 채워 fr 행 성장 차단) + 시스템·URL·GMP 스택, 수행 지표 1행 타일 3열, 입출력=결합 타일(5/12, 글머리 목록)+시작/종료 조건(7/12) — 본문은 내용 높이에 맞추고 상한 3줄 클램프(사용자 지시). 폭 <40rem(컨테이너 쿼리 `@[40rem]`)이면 세로 쌓임. **기본 접힘**: BPM 속성 + 수행 지표 헤더까지만 보이고 지표 타일·입출력은 `grid-rows 0fr↔1fr` 아코디언 — 섹션 호버 시 헤더의 지정 필이 「모든 섹션 펼치기/접기」 버튼으로 크로스페이드(`group-hover`), 누르면(또는 접힌 수행 지표 헤더 클릭) 안의 그룹까지 전부 펼침 — 버튼은 상태 필 **왼쪽**에 절대 배치(줄바꿈 없음, 필은 그대로). **SP 미지정 맵**(값·메모는 있음)은 섹션 배경 `surface-alt`·헤더 톤다운으로 접힌 채 시작(`SectionHeader muted`); 값·메모도 없으면 미노출. **노트 추가·수정은 카드형(홈)에서 모달**(`ModalBackdrop`, 취소/확정 버튼, ⌘/Ctrl+Enter 확정) — 접힘 높이 안에 인라인 폼이 들어갈 자리가 없다. 에디터 맵 탭 등 목록형은 인라인 폼 유지.
- **메모 규칙**: 메모 있는 타일은 아이콘 점 + 호버 스왑 + 클릭 원문 팝오버(FallbackHint 읽기), 대표값 없을 때만 폴백 톤(점선·회색 12px, `SpFieldTile labelFixed`로 라벨 유지). 홈 카드의 `MapFallbackNotes`·`map-detail-io` 블록은 제거(에디터 맵 탭·비교 화면은 그대로). 패널 본문 스크롤바 숨김(`scrollbar-hidden`).
- **용어**: 「인터뷰 원문 메모」→ **「원문 메모 / Source note」**(필 「원문 기준 / from source note」) — i18n·매뉴얼·spec 표기 교체. `MapNotesSection`에 `icon/layout="cards"/clipHeight/defaultCollapsed` 추가(카드형은 노트가 없어도 빈 상태를 그려 3:2 열을 비우지 않음).
- **검증**: vitest 922(신규 sp-detail 10)·tsc·lint·카탈로그, 실화면(3010) 캡처 — 기본/호버/팝오버/노트 펼침/좁은 폭 614px/에디터 맵 탭 회귀 없음, 콘솔 에러 0. 스모크 import-followups 22/23(실패 1은 스크립트의 백엔드 8000 직접 호출), field-promotion·framework는 홈 이전 단계(임포트 API·트리)에서 중단 — 기존 기록대로 낡은 스크립트, 셀렉터만 `map-detail-sp-section`으로 갱신. 랜드마인: 클립 넘침 측정은 ref 객체가 아니라 **콜백 ref**로(비동기 로드 뒤 마운트되는 본문을 ref 객체+deps 이펙트는 놓친다).

## 2026-09-08 — 인터뷰 JSON 0.5 외부 L6 참조(`externalTasks`) + 드라이런 리포트 2열 (feat/interview-external-refs → dev)
- **목적**: 컨설턴트가 L5 단위로 전달하면서 타 L5의 L6를 "소속 L5 코드 + 불확실한 이름"으로만 아는 경우(taskId 없음)를 임포트가 받도록, 우리가 JSON 계약을 먼저 제안·구현(컨설턴트 측 Fable 5.1이 이 계약대로 생성). 스펙 `docs/superpowers/specs/2026-09-07-interview-external-refs-design.md`, 플랜 `docs/superpowers/plans/2026-09-07-interview-external-refs.md`, 컨설턴트 전달용 계약 `docs/samples/interview-json-0.5.md`, 필드 맵 `docs/qa/interview-import-field-map.md`.
- **계약(A안, 사용자 결정)**: 최상위 `externalTasks[]` `{refId, l5{nodeCode,label}, l6|null, note}` — 엣지 끝점은 rows taskId → refId → 미선언 원문(기존 taskId 플레이스홀더+경고) 순으로 해석, 양쪽 외부면 드롭. 외부 L5 계보는 `framework.categories`에 그대로 동봉(create-only, 라우터 병합은 홈 주장 우선, 끊긴 외부 체인은 경고 후 제외). 플레이스홀더는 제목 `l6∥(L6 unspecified) L5명`·출처 `placeholder_category_id`·계보키 `external_ref_lineage_key(홈 L5|refId)`. 자동 연결은 **같은 L5 안 정규화 이름(`normalize_task_name`) 정확 일치 라이브 맵 1건만**(임포트 시 선해소 + 후차 `resolve_external_placeholders` 이름 경로), 2건+는 경고·플레이스홀더 유지, 재임포트는 미연결 노드 제목·출처만 갱신. 리포트 문구 5종은 FE `interview-report.ts` PATTERNS와 verbatim 계약. 어댑터는 0.4/0.5 수용, 0.3 거부("re-deliver as 0.5"). 조사 중 발견한 외부 엣지 `quote` KeyError(dry-run 500)도 픽스.
- **거버넌스 배선**: 후차 해소 시 `fw_external_linked` 알림(캔버스 단위 1건, 캔버스 L5·출처 L5의 직속+조상 관리자, 실행자 제외, 인박스 subprocess 카테고리)+`VersionEvent(external_linked)`·타임라인 라벨. `framework.categories[].admins`(L1~L5 어느 행)로 카테고리 관리자 **add-only**(외부 행은 경고 후 무시). 확인된 것: 확정 게이트는 확정 시점 재검증, 관리자 추가는 sysadmin 경로, dry-run은 알림·이벤트 롤백. 미보정(기존): `slot_changed` FE 라벨 없음, 선해소·수동 Connect는 알림 없음.
- **샘플 7종 0.5 재작성**(`brr-large-l5.json`→`brr-l5.json`): 파일당 L6 ≥4·행마다 decision+branch·loop, 파일마다 parallel·bypass·exception·handoff, 외부 참조 시나리오 매트릭스(직결·정규화 일치·불일치·`l6:null`·계보 동봉 빈 카테고리·계보 없음 origin unknown), 3종에 seed 로그인 admins. `backend/tests/test_samples_0_5.py`가 규격(의도 경고 화이트리스트)+B세트 e2e(4파일→qa-deviation 후차 해소 4건) 고정. 스모크 앵커 Created 9·Notes 41·교정 준비 노트 7행.
- **드라이런 리포트 2열(A안, HTML 목업 4차 승인 후 구현)**: 좌 = 요약 카드(강조 톤 6셀) · 확인 필요(종류별 접기, 펼치면 맵 칩) · 외부 L6(상태 필=필터, 비해당 행은 제거 대신 흐림) · 카테고리 관리자 · 거버넌스(유지↩/교체⇄ 드롭다운, 굵은 값=적용 뒤 값·버려지는 값 취소선). 우 = L5 파일 카드(`Lv5` 필 색=검증 결과, L1~L4 계보 필+업무체계 탐색 아이콘(계보 코드를 `/nodes`로 따라 id 해석, 미적용 L5는 안내), 외부 L6 필·파일명 우측, 맵·노트 수) + 항상 펼친 맵 목록(4행 캡·숨은 스크롤·모두 보기) + 행 미리보기(`lib/interview-preview.ts`가 rows[i].actions/relations를 백엔드 그래프 규칙과 동형으로 그려 에디터 자동정렬 → ScopePreview, Start 기준 시야). 맵/L5 클릭 → 좌측 FLIP 재정렬(`lib/use-flip-order.ts`)·강조·흐림, 좌측 호버 → 우측 강조, 하단 바 필터 상태+Clear. 사용자는 이름 필(UI 언어→영어→아이디, 인물 카드 재활용), 섹션 i 툴팁. **파일 이슈**(어댑터 경고: 자기 반복 ◇ 합성·판단 승격·외부 L5 계보 없음·seq 폴백·기타)도 다이제스트·맵 행 ⚠·요약 경고 수에 합침(`a0N`/`seq N`은 단계 이름으로). `frontend/src/components/admin/import-report/`(9파일)+`components/info-tip.tsx`, `import-governance-review.tsx`는 `governance-section.tsx`로 대체.
- **검증**: backend pytest 1437·ruff, vitest 912, tsc·lint·카탈로그, 스모크 interview-import 26/26(`Lv5` data-state·select), import-followups·framework-slot·node-modal-tiles 그린, 리포트 캡처 19/19(포커스·필터·모두 보기·미리보기·한글·파일 이슈). 별건: field-promotion 스모크는 임포트 검사 통과 후 홈 Framework 트리 단계에서 타임아웃(이 트랙 무관). 포트 8047/3047로 실행(8000·8010·3010은 다른 세션 점유).

## 2026-09-07 — 슬라이드 매뉴얼 4종 재생성: 08-31 이후 md 델타 반영 (docs/manual-pdf-refresh)
- **범위 판단**: md 매뉴얼 6종은 09-07 커밋까지 증분 갱신돼 최신(잔여 3커밋은 체크박스 모양·모션 리팩터라 문서 영향 없음) → 실제 정체는 08-31에 만든 슬라이드 HTML/PDF. `git diff e89aabe5..HEAD -- docs/manual/*.md`(225+/71−)를 델타로 삼아 슬라이드에 흡수.
- **관리자 덱 35→40장**: ⑤ 프레임워크를 2장→7장으로 재편(카테고리 관리·레벨 위임 / 권한자 / 확정 거버넌스 / 슬롯 변경 / 현황판 / 인터뷰 임포트 2장), 설정 레일·배치 작업(지금 백업·다운로드)·승인 큐(`fw_slot`·대체 처리자) 문구 갱신. **사용자 덱 60→65장**: 체계 필 슬롯 연결·이동·이양, 노드 편집 창(타일), AI 컨설턴트 인터뷰, 초안·확정본 열람 규칙, 끊긴 링크 교체·슬롯 이력 신설 + 홈·복사·맵 설정·에디터·노드 속성·IO·라이브러리 필터·피크·미등록·지정 관리·버전·결재함·CSV·내보내기·Framework 보기·L5 캔버스·확정·플레이스홀더·FAQ 문구 갱신. 실화면 재촬영 13장(관리/현황 뷰·슬롯 다이얼로그·분류 요약 카드·배치 작업·필터 팝오버·미등록 필터·새 피크·노드 편집 창·차콜 L5·확정 게이트·연결 다이얼로그·미싱 노드), 나머지 이미지는 기존 유지. TOC `data-goto`는 섹션 구분 슬라이드에서 재계산, 날짜 2026-09-07.
- **PDF**: `docs/manual/slides/export-pdf.mjs`(playwright-core + 시스템 Chrome, 1280×720 1장/페이지) 추가 — 이전엔 생성 절차가 없었음. 검증: 4덱 브라우저에서 새 슬라이드 렌더·`.col-text` 넘침 측정(영문 8장 문구 축약으로 해소)·PDF 페이지 수 = 슬라이드 수. AI 인터뷰 화면은 로컬 AI 비활성으로 이미지 없이 문구만.
- **전수 감사(사용자 지시 "증분 말고 처음부터 끝까지")**: md 3종(KO+EN)을 코드(i18n 사전·설정 화면·라우터·Settings) 근거로 처음부터 끝까지 대조해 56건 정정 — 관리자 13(권한 콘솔→직원 관리 태그, 탭 라벨 4종, 승인 큐 반려 사유 없음, 로컬 계정 Sysadmin 토글은 로컬 전용, 위임 범위(seed 자신 불가), 메이저 확정은 중간 마이너만 프룬, AI access 스위치·`EMBED_URL`, §14 `AI_TIMEOUT_SECONDS` 기본 60) · 사용 안내 18(슬롯 즉시 적용=확인 창 "바로 적용"+토스트·철회권 오너/sysadmin, 홈 필터 오우닝·SP, **체크아웃 30분 자동 해제 없음**(`checkout.py` TTL 미사용 — 관리자 §10·`CHECKOUT_TTL_MINUTES` 행도 제거), 게시는 제출자만, 셀프 게시 문구, 승인 대기 6종, PNG 카드 오너, 공지 읽음=열면 표시, Inbox 배지 15초, 알림 필터 서브프로세스) · 맵 편집 25(**딥 뷰 폐기**(더블클릭=노드 편집 창), 하위프로세스 만들기 우클릭 삭제, 펼치기 메뉴명·액션 바, 디시전 드롭 분기/인터셉트, CSV 20열·미지 열 오류·500행, Excel "Process Map"·2,000행, CSV 경고 실제 목록, 인터뷰 버튼 Ask about this/Draw now/Start over, 외부 L6는 L6 피커에서 드래그, 배너 "연결(Connect)"·플레이스홀더 만들기, 슬롯 이력 패널 우상단, `Ctrl+Y`). 미검증 12건은 감사 보고에만 남김. **슬라이드 2차**: 4덱 210장을 md와 전수 대조(관리자 결함 0, 사용자 6)한 결과와 md 감사 정정을 덱에 반영 — 사용자 65→66장(단축키 요약 슬라이드 신설, 딥 뷰 슬라이드를 "노드 다듬기와 링크된 맵 열기"로 개편·낡은 모달 스크린샷 제거, 내보내기 KO에 EN과 같은 스크린샷), 슬롯/체크아웃/게시/CSV·Excel/인터뷰 라벨/외부 L6/슬롯 이력 위치 등 문구 30여 장 갱신, dev 머지로 바뀐 라이브러리 필터 팝오버(미등록 스위치·부서 트리 플라이아웃·권한 필) 재촬영 2장. 제품 관찰(코드 미수정): 죽은 i18n 키 4종, `settings.checkout_ttl_minutes`·`sp_description` 잔존, 범례 "Double-click → Connect"·드롭존 Swap 누락, `ai.readOnly` 문구 드리프트, 하드코딩 라벨(AI access·KB Upload/Refresh).

## 2026-09-07 — 슬롯 거버넌스 UX 2라운드: 트리 모션·L5 플레이스홀더 생성·라이브러리 필터 (feat/fw-slot-handover → dev)

- **CLAUDE.md 감사(claude-md-improver)**: 낡은 수치·목록 교정(에디터 ~12,500줄, `settings-and-forms` lessons), 프론트 게이트(tsc·vitest·카탈로그 검사)와 Playwright/dev 인증 관례를 Commands에, 이번 트랙들의 계약(오버레이 z 사다리·라이브러리 행 부서=`sp_department` 리프명·`useSectionMotion`/`CheckInput`)을 Lessons에 추가. 템플릿 메타 문구 제거. `frontend/AGENTS.md`엔 zsh `--include` 인용 함정.
- **트리(사용자 요청)**: 슬롯 배정 모달·플레이스홀더 연결 다이얼로그·"Framework L6" 목록(같은 `FrameworkTreePicker`) 모두 하위 후보가 하나뿐이면 끝까지 자동 펼침(L5·갈래에서 멈춤, 6홉 상한)하고, 펼침/접힘은 홈 트리의 `accordion-open/close/static`(`useClosingKeys`)으로 시선이 따라가게 — 사용자가 클릭한 노드만 `open`, 자동 펼침은 `static`, 접힘은 고스트 `close` 뒤 언마운트, 쉐브론 회전.
- **L5 플레이스홀더 생성**: "Framework L6" 라이브러리 하단 입력+버튼(`framework-placeholder-name/create`)으로 미연결 subprocess 노드를 만든다(`linked_map_id`·`placeholder_category_id` null, 가운데 빈자리 배치·플래시·토스트). 임포트 플레이스홀더와 같은 룩("Connect" CTA → 연결 다이얼로그), 확정 게이트 `placeholder`가 막는다. 연결 다이얼로그에는 이 footer가 뜨지 않는다.
- **라이브러리 필터(일반 맵)**: `/library/processes` 행에 `my_role`(배치 해석, sysadmin=owner) 동봉 → `lib/library-filters.ts`(부서 전체경로/말단 매칭·권한 any-of·미등록은 재조회 플래그, `bpm.library.filters` 영속) + 패널 Filter 팝오버(부서 다중선택·Owner/Editor/Viewer·미등록 토글)와 × 달린 필·일괄 삭제·"N of M". `library-unregistered-toggle`은 팝오버 안으로(수동 검증 스크립트 2종에 팝오버 열기 추가).
- 검증: pytest 1392·ruff·tsc·lint·vitest 879·build 그린, `pw-smoke-framework-slot` 20/20·framework-admin 7/7·delegation 18/18(리셋 DB), 컨트롤러 브라우저 검증(트리 자동 펼침/클래스, 필터 6/6, 플레이스홀더 8/8).
- **리뷰 후속 수정(F1/F4/F5/F11 트리 모션, F8/F9/F3/F2 라이브러리 필터)**: 아코디언은 콘텐츠 도착 후에만 마운트(빈 박스 위 애니메이션 헛돎 방지), 피커·모달의 중복 모션 배선을 `useSectionMotion` 훅(`lib/use-closing-keys.ts`)으로 통합, 자동 드릴인은 재펼침 전 고스트-close 취소, 쉐브론 회전 `motion-safe:`. 필터 팝오버 `w-52`로 224px 패널 안쪽에, 필터는 지연 초기화로 교체(마운트 이펙트 제거 — `showUnregistered` 영속 시 중복 fetch 해소), 죽은 i18n 키 `library.showUnregistered` 제거, 매뉴얼 문구 갱신. 게이트 tsc·lint·vitest 879·catalog 그린(FE 전용).
- **부서 필터 트리화(사용자 요청 — 조직 트리 500개)**: 팝오버 부서 섹션이 행에서 뽑은 distinct 목록 대신 **내 부서 체인만**(루트→내 부서, 들여쓰기·"내 부서" 마크, 부서 미지정이면 트리 루트 + 체인 밖 활성 필터) 노출하고, "전체 부서…"가 팝오버 우측 도킹 포털 `LibraryDeptFlyout`(조직도 부서 ∪ 행 부서 트리·검색·아코디언 드릴인·내 부서 찾기 120ms 스태거+스크롤+플래시)을 연다. 부서 매칭은 **서브트리 의미**로 확장(`rowDept === s || startsWith("s/")`, 레거시 리프명 일치 유지 — 경계를 "/"까지 봐 "Growth Center"가 "Growth Center 2"를 삼키지 않음). 역할 필터는 체크박스 대신 **한 줄 필 토글**(앞 아이콘 Crown/PenLine/Eye, 선택 시 Check로 교체; 빈 선택=전체) — 사용자 지시. 부서 체크는 이름 **앞** 자리 유지(행 호버/포커스/선택 시만 노출 — 뒤로 옮겼다가 사용자 지시로 복귀), 미등록 맵은 **맨 위 스위치 행**(행 클릭도 토글)으로 재배치 — 사용자 지시. 플라이아웃 행 배선: 클릭=체크, 더블클릭=펼침/접힘(쉐브론과 동일). 회귀 스크립트 `pw-verify-sp-placeholder.mjs`는 팝오버를 닫고 드래그하도록 보정(①~③ 통과), ④ 지정 모달 타일 UI 드리프트는 TODO. 재리뷰 마이너: 트리 소스도 패널의 부서 인덱스를 공유(재계산 제거). 3차: 검색은 영문/한글명 양쪽(표시는 언어별 `formatDeptName`), 플라이아웃 폭 `w-max` 288~416px+말줄임(왼쪽 도킹은 right 정렬), 행 우클릭 `ContextMenu`(선택/펼치기·접기/부서 정보 — `OrgInfoModal elevated`로 플라이아웃 위).
- 위 작업에 딸린 공유화: 트리 빌드·검색을 `lib/dept-path-tree.ts`로 이관(관리자 부서 피커와 공유), `useDirectoryDepartments()`를 `lib/directory.ts`에 추가(유저 맵과 같은 fetch 1회 공유), `lib/me.ts` `useMe()` 신설(모듈 캐시). 게이트 tsc·lint·vitest 886·catalog(227) 그린.
- 픽스(브라우저 검증): 행의 `department`는 `sp_department`라 실무상 **리프명만** 담긴다("Brand Part 1") — 조직도 리프 역인덱스(`buildDeptPathIndex`/`resolveDepartmentPaths`)로 경계에서 전체 경로를 복원해, 트리에 중복 루트가 생기고 상위 부서 선택이 "0 of 8"이 되던 것 해소(인덱스 미전달 시 예전 동작 유지). vitest 893.
- **필터 체크박스 디자인 통일(사용자 지시)**: 라이브러리 필터 팝오버 3종(부서·권한·미등록)의 네이티브 체크박스를 앱 공통 커스텀 체크로 전환 — `components/check-input.tsx` 신설(`CheckInput`), `framework-confirm-section.tsx` 메이저 승급 토글의 기존 인라인 마크업도 이걸로 교체(시각 변화 없음). `data-id`는 라벨이 아닌 `<input>`으로 이동해 `pw-verify-sp-peek.mjs`/`pw-verify-sp-placeholder.mjs`의 `[data-id="library-unregistered-toggle"] input` 셀렉터를 직접 매치로 수정. 게이트 tsc·lint·vitest 879·catalog(226개) 그린. 후속(사용자 지시): 모양은 라운드 네모 유지 — 16px 박스에 `rounded-sm`(8px)은 원이 돼 `rounded-xs`(5px)로 조정(확인 섹션 토글도 같은 모양). 재리뷰 후속: 모션 훅 접근자 `getSectionClass`(동사 규칙)·쉐브론 회전은 `motion-safe:duration-150`(감속 모션이면 실제로 정지).

## 2026-09-06 — Framework 슬롯 거버넌스: 승인 워크플로·캔버스 재지정·임포트 플레이스홀더·UX 개선 (feat/fw-slot-handover → dev)
- **배경·결정**: 슬롯 이양이 `category_id`·`consultant_code`만 옮기고 홈 L5 캔버스·계보·알림을 안 따라가던 결함 4종(UPDATE 순서 unique 500·캔버스 맵에 슬롯 허용·이양 후 캔버스 표류·복사+은퇴 시 슬롯 휴지통 잔존)을 실행으로 확인 → 슬롯 변경 5액션(assign·unassign·move·replace·delete)을 승인 종류 하나 `fw_slot`으로 통일. 스펙 `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md`(개정 각주 포함), 플랜 4종 `docs/superpowers/plans/2026-09-06-fw-slot-track-*.md`, 명세 `docs/spec.md` §7 슬롯 수명주기 절.
- **코어(트랙 A+B)**: `app/framework_slots.py` validate→plan→apply 단일 루틴 + `framework_slot_events` 이력, `POST /maps/{id}/slot-changes`(dry_run 미리보기·L5 직속 관리자 즉시 적용), 대체·삭제 시 홈 캔버스 노드 자동 재지정(엣지 유지·중복 쌍 합치기·계보 `retired_to_map_id`, 슬롯을 되찾으면 리셋), refs에 superseded·시각 3종·후계자, 해제 링크는 `stale_link` 게이트. 캔버스는 미싱 룩+배너("Removed/Handed over/Deleted - replace")·최근 이양 배지(14일)·호버 슬롯 이력 패널.
- **승인(트랙 C)**: 비관리자 owner는 `ApprovalRequest(kind="fw_slot")` 요청(중복 대기 409 — 관리자 즉시 적용·레거시 어댑터도 같은 가드), 다측 승인(move는 양 L5 각 1명, 요청자가 관리하는 side는 생성 시 자동 승인, 동일인 1회), 적용 시 sides·target owner 재검증(드리프트 409, 요청 유지), 거절 알림·철회(`GET/DELETE …/slot-changes/pending`), 인박스·설정 큐·맵 승인 탭·벨(`fw_slot_requested/applied/rejected`), 결정권 `can_decide_slot`=잔여 side 기준(`can_decide_slot_for_map` 공용, 맵 승인 목록 열람도 공유). FE 공용 `SlotChangeDialog`(안내/요청, busy 중 닫기 차단, 해제·삭제 위험 톤)·배정 모달 대기 배너/철회·`SlotDeleteDialog`(후계자)·복사+은퇴 해제/승계 라디오(슬롯 원본은 이름 편집 가능)·옛 체크아웃 저장 422 "reload" 안내.
- **임포트 플레이스홀더(트랙 D)**: 어댑터가 한쪽 끝점만 없는 엣지를 `external`로 보존 → 임포터가 taskId 제목의 플레이스홀더 노드(`source_node_id = make_node_id("__ext__", code)`, `app/lineage.py`)를 엣지와 함께 배치(새 캔버스는 정렬에 포함) → 재전달 시 `resolve_external_placeholders`가 draft 캔버스에서만·휴지통 맵 제외·타인 체크아웃 존중으로 해소, 슬롯 수령(assign/move)도 플레이스홀더를 채움. 재임포트는 계보 키 우선·linked_map_id 폴백(백필)으로 중복 없음.
- **UX 개선(트랙 F, 사용자 요청)**: 슬롯 모달·배너 시인성(아이콘 디스크·모드/진행 필·impact 칩·side 카드·선택 카드·진입 모션, 짧은 대시), 호버 이력 패널은 이력이 있을 때만 우상단 "L5 map" 태그 자리에(반투명), 플레이스홀더 연결은 체계 트리 선택 → 우측 SP 피크형 플라이아웃 → Connect(안내 L5 자동 펼침·안내 밖 확인 게이트·키보드 행).
- **검증**: QA `docs/qa/2026-09-fw-slot-governance-qa.md`(기능 26/26·시나리오 S1~S10, 컨트롤러 실브라우저) · `pw-smoke-framework-slot.mjs` 20/20 · pytest 1390·ruff·tsc·lint·vitest 863·build 그린. 검증 중 결함 3건(L5 관리자 맵 승인 목록 403·삭제 노드 범용 CTA·복사 이름 잠금 409)과 리뷰 결함(어댑터 대기 가드·sides 재검증·Esc 이중 처리·재임포트 중복·배치 겹침·체크아웃 무시) 수정. framework 스모크 4종의 낡은 임포트 확인 단계 보정; `pw-smoke-framework`·`-canvas`·`copy-purge`는 dev에서도 낡은 스크립트(홈 트리 셀렉터·draft 열람 룰·워터마크 Title case·시드 부서) — 별도 정비 필요.
- **잔여·주의**: A+B+C+D+F는 한 배포 단위(부분 배포 불가). 후속: 해소된 플레이스홀더 리포트 카운터/칩, 슬라이드 재생성(매뉴얼 연결 흐름 변경), `notifBody.fw_slot_*` 문구 보강, 서버 Postgres(9910) 배포 검증. (2026-09-07: 철회권을 요청자·현재 오너·sysadmin으로 넓혀 오너 이전 뒤 데드엔드 해소 — 대기 조회 `can_withdraw`, 배너 "submitted by another user" 필.)

## 2026-09-03 — 5라운드: 인스펙터 행 통일·IO 열 배치·SP 부서 말단 필·독 장면 이동 (dev)
- **인스펙터 행 문법 통일**(사용자 피드백 "SP와 일반 노드 스페이서·폭이 다름"): `lib/inspector-row.ts`(`INSPECTOR_ROW` min-h-8·py-1, `INSPECTOR_ROW_LABEL`)를 속성 피커·시스템/GMP/URL 행·지표 카드·조건 행·SP 상속 행(속성·IO·조건)이 공유 — 읽기/편집 모두 32px 행, 스페이서는 URL 위 구분선 하나(일반 노드 정책). fitContent 피커 트리거는 입력과 같은 24px(py-0.5). SP IO 상속 표시는 자체 렌더 대신 `MultiValueInput readOnly`(링크 아이콘·호버·드롭다운 유지).
- **SP 속성 부서=말단 필**: `DeptPill`(말단+조직 모달)을 신설해 타일·SP 상속 행·읽기 전용 일반 행이 공유(attribute-tiles의 DeptLeafPill/모달 상태 이관). 담당자도 `AssigneePills`. 후속(사용자 피드백): 필 `min-w-0`으로 카드 밖 오버플로우 차단 + 호버(보더 액센트·틴트·그림자), **읽기 전용 속성 행 공용화** `AttributeReadRows`(부서 필·인물 필·시스템+메모 힌트·GMP 배지·링크 필) — 일반 노드 읽기 전용과 SP 상속 표시가 같은 컴포넌트, `BpmAttributePicker`는 편집 전용으로.
- **IO 목록 열 배치**(인스펙터·타일 팝오버, 읽기/편집): 인덱스(w-5) / 형식 필(고정 폭 5.5rem, 카탈로그 아이콘, 미지정은 점선 자리표시, `DataFormPicker column`) / 라벨 말줄임 + R/O 플래그. 읽기 헤드리스(타일 팝오버)의 중복 헤더 제거.
- **독 장면 이동**(사용자 요청): 후행으로 가면 양쪽 독이 왼쪽으로 빠지고(`dock-exit-left`) 새 카드는 오른쪽에서 들어옴(`dock-enter-from-right`), 선행은 반대 — `travel` 상태가 방향을 기억.
- 검증: tsc·eslint·vitest 850·`pw-smoke-node-modal-tiles.mjs` 63/63.

## 2026-09-03 — 편집 모달 4라운드: 담당자 인물 필·지정 모달 조건 타일·아코디언 잘림·타일 오버플로우 (dev)
- **담당자 인물 필**(사용자 요청): 저장된 담당자(영문 name)를 디렉터리에서 해석해 필로(중립 톤 surface-alt — 액센트 톤 부서 필과 구분, 사용자 피드백), 호버 0.7초/클릭 시 기존 인물 카드(`PersonHoverCard`, 이름·아이디·말단 부서+조직 경로). 신규 공용 `AssigneePills` — 노드 편집 모달·지정 모달 타일(+피커 초안 칩)·인스펙터 BPM 속성 담당자 행이 공유. 미해석 이름은 정적 필.
- **지정 모달 시작·종료 조건 타일** 누락 보완 — `SubprocessDesignationIn.start_condition/end_condition`(None=미변경, 승격 필드 PATCH와 같은 `sp_*` 컬럼)·`DesignationForm` 5개 빌더·Subprocess 탭 읽기 타일.
- **펼친 채 열면 섹션이 잘리던 문제**: 원인은 `AutoHeight`가 `getBoundingClientRect`로 재는데 모달 팝인(scale 0.92→1) 중이라 줄어든 값이 고정된 것 — RO `borderBoxSize`/`offsetHeight`(레이아웃 높이)로 교체. **타일 오버플로우**: 읽기 타일에 ref가 없어 라벨 생략 판정이 안 돌던 것 교정 + 루트 `overflow-hidden`, 조건 타일 값은 `valueSize="fine"`. **메모 점**은 호버 시 25%로 흐려짐(아이콘 교체 가시성).
- **독 카드 레이아웃**(사용자 결정): 1행 색 점+라벨, 2행 타입 단독(점이 두 줄을 걸치던 좌측 열 폐기). **섹션 헤더 높이 통일**: 세 섹션 헤더 행을 `h-5`로 고정하고 '모두 펼치기' 버튼의 호버 패딩은 음수 마진(-my-1)으로 흡수 — 전부 접었을 때 첫 헤더만 살짝 높던 것 교정(노드 모달·지정 모달, 실측 20/20/20px).
- **인터뷰 임포트 드라이런 카드**(사용자 요청): 결과 본문(요약·다이제스트·파일 리포트·거버넌스 확인)과 하단 [Cancel][Apply] 바를 한 테두리(`rounded-md border`) 안에 — 바는 고정(sticky) 없이 카드 맨 아래(본문이 바 뒤로 넘어가는 게 거슬린다는 피드백, 끝까지 내려서 클릭). **적용 완료 후** 본문에 반투명 음영(`interview-import-applied-overlay`)을 덮고 푸터 문구를 "적용 완료"로 바꿔 두 번 누르지 못하게(Apply 비활성은 기존, Cancel로 닫기).
- 검증: pytest 1347·vitest 850·`pw-smoke-node-modal-tiles.mjs` 63/63(담당자 필→인물 카드, 조건 타일 저장, 잘림 회귀, 점 페이드)·`pw-smoke-interview-import.mjs` 25/25(카드·음영·Cancel 도달 검사 추가, 거버넌스 체크 수는 전후 +1로 교정, 노트 행은 `li`만 집계 — 노트 CRUD 이후 행마다 edit/delete 버튼이 붙어 접두 매칭이 3배였음 — 배지는 i18n "Exception" 대소문자 무시).

## 2026-09-03 — 노드 레벨 data_form 폐기 + 메모 아이콘 호버 효과 3라운드 (dev)
- **`nodes.data_form` 폐기**(사용자 결정 — 운영 미사용 컬럼): 자료 형식은 IO 항목별 `output_forms`/`input_forms`만. 인터뷰 임포트의 `dataForm`은 산출물이 항상 하나라 **유일한 산출물의 폼(`output_forms`)으로 착지**(`CanonicalNode.output_forms`, 배열로 바뀌면 줄 정렬로 확장). 모델·NodeIn·AI 속성 스키마·graph upsert·clone·확정 시그니처·AI 프롬프트·인터뷰 에이전트 프롬프트·FE 타입/에디터/편집 모달 타일/인스펙터 폴백 행/diff/비교/CSV(21열→20열, 예전 파일의 Data_Form 열은 무시)/템플릿/i18n에서 제거. 물리 컬럼은 `db._drop_legacy_node_data_form`(기동 비치명 스텝)으로 드랍 — 롤백은 이 커밋 이후 버전 사이에서만 안전.
- **메모 아이콘 호버**(사용자 피드백): 흰 칩 폐기 → 타일 자체가 호버 시 흰 배경+보더 강조(`SpFieldTile` 편집 타일·메모 있는 읽기 타일), 아이콘은 같은 자리에서 크로스페이드 + 액센트로 한 번 튀었다 가라앉는 일회 애니메이션(`.note-swap-*`, reduced-motion 제외), 메모 점은 호버 전 60%→호버 100%.
- 검증: pytest 1347·vitest 850·`pw-smoke-node-modal-tiles.mjs` 55/55·`pw-smoke-field-promotion.mjs`(output_forms 착지 단언으로 갱신).

## 2026-09-03 — 컴포넌트 카탈로그 + 편집 모달 피드백 2라운드 (dev)
- **컴포넌트 카탈로그**(사용자 지시): `frontend/COMPONENTS.md`를 `scripts/build-component-catalog.mjs`가 생성(파일·컴포넌트·역할=머리 주석 첫 문장·사용처=임포터, `--check`) — 일괄 UI 수정 전 사용처 확인, 컴포넌트 추가·이동·사용처 변경 시 같은 커밋에서 재생성. 룰 `rules/frontend/components.md`(CLAUDE.md import)·`frontend/AGENTS.md` gotcha.
- **독 호버 = 레이아웃 확대**: scale 변환의 래스터 뒤틀림 피드백 → 폭 +12px(모달 쪽)·세로 패딩 +4px·액센트 보더 트랜지션으로 교체(위아래 카드는 높이만큼 자연히 벌어짐). **원문 메모 표시**: 메모 있는 아이콘 모서리 점(호버 전), 호버 시 아이콘 뒤 흰 칩(틴트 타일 위에서도 교체가 보임). **내 부서 필**은 PrincipalPicker 치수로 통일(테두리 제거·py-0.5).
- **Subprocess 탭**: 게시본이 아닌 버전이면 지정값 위 워터마크("게시본이 아닙니다"/"아직 게시본이 없습니다") + 수정 자리에 '게시본으로 이동'(액센트 테두리, `switchVersion`). 빈 값도 "미입력" 회색 타일로 남기고(누락 가시화), 대표값 없이 메모만 있으면 메모를 임시값 스타일(점선·기울임·"인터뷰 원문 기준" 필)로 — `SpFieldTile placeholder/valueTone`, `DeptAssigneeTiles placeholder`.
- Q&A: 편집 창 변경은 일괄 되돌리기 없음 — Ctrl+Z 단계별(모달 열린 채로도 동작, 입력 포커스 밖에서). 일반 노드의 지표 폴백은 데이터 모델에 없음(노드는 `system_fallback`만, 시간·빈도 메모는 맵 지정값).
- 검증: tsc·eslint·vitest 850·스모크 55/55(카탈로그 `--check` 포함).

## 2026-09-03 — 노드 편집 모달 실사용 피드백 9종 (dev)
- **양방향 라이브 동기**(사용자 요청 "인스펙터와 편집 창 값 싱크"): 편집 창 버퍼+하단 저장(⌘S)을 폐기하고 팝오버 확정·제목·설명 타이핑·부서/담당자·원문 메모가 노드에 즉시 반영(`patchLive`) → 인스펙터가 같은 상태를 본다. 반대로 props가 바뀌면 렌더 중 diff로 폼과 "변경 없는" 열린 팝오버 초안까지 갱신(IO는 `ioSync` 키로 편집기 리마운트). 하단은 완료(Esc)만, 미저장 확인 오버레이·변경 필드 표시 제거. 노드 데이터는 같은 메모리 state라 로딩·스켈레톤은 불필요.
- **사이드 독**: 호버 시 잘리던 안쪽 경계 → 스크롤 상자 안쪽 여백(px-3.5/py-2)+폭 200으로 해결, scale 1.1 + 6px 이동 + `hover:my-1.5`(margin 트랜지션으로 위아래 카드가 벌어짐). 클릭 전환은 고스트(클릭 카드 자리→가운데로 커지며 페이드)+가운데 카드(반대편 독 자리로 줄어들며 페이드) 380ms 후 노드 교체, 새 카드는 `summary-card-in` 팝인(`--swap-*` CSS 변수 실측 주입, reduced-motion은 즉시 전환).
- **원문 메모 표면**: 노드에 있는 폴백은 `system_fallback` 하나 — 시스템 타일 호버 메모 아이콘(보기·수정·적용)+시스템 팝오버 메모 칸, SP 노드 연간 건수 타일은 링크 맵 빈도 원문(읽기). 지정 모달의 메모 4필드 타일에도 호버 메모 아이콘(폼 버퍼 반영). 회당 지표의 다른 폴백(시간·실작업)은 맵 단위 지정값에만 존재해 노드 타일엔 없음. `SpFieldTile` 편집 타일을 button→role=button div로(중첩 버튼 유효화) + 포털 내부 클릭은 `contains` 가드로 타일 팝오버 오픈 차단.
- **IO 팝오버 '다른 노드에서 불러오기'**(+ Add 옆, 초안 있으면 잠김) — page의 IoImportModal 재사용(z 1360으로 팝오버 위, 필터 autoFocus라 Esc가 팝오버까지 닫지 않음). **부서 피커 내 부서 태그**(`SelectOption.tag`, 타일 피커·인스펙터 피커 모두 근접도 정렬+태그). **인스펙터**: BPM 속성 행 아이콘+라벨 통일(시스템 행머리=FallbackHint 호버 스왑), SP 지표 행은 참고치 Info를 라벨 뒤로·입력 `shrink-0`으로 맨 우측 동일 폭(라벨이 먼저 truncate), 툴팁은 `w-max`+`wide`(fixed 박스가 우측 앵커에서 150px로 쪼그라들던 원인).
- 검증: tsc·eslint·vitest 850·`pw-smoke-node-modal-tiles.mjs` 49/49. 매뉴얼 편집 ko/en 노드 편집 창 절 갱신.

## 2026-09-03 — 노드 편집 모달 타일화 + Subprocess 탭 지정 파라미터 (feat/node-modal-tiles)
- **노드 편집 모달(더블클릭·정보 수정)을 SP 지정 모달 디자인으로**(사용자 지시): 제목·설명은 유지, 유형·색·속성(부서·담당자=두 열 가로지르는 행 타일, 시스템·링크·GMP)·지표 7·입출력/조건을 2열 타일 + 클릭 위치 팝오버로. 폭 512 통일. 읽기 전용은 값 있는 타일만 정적, 입출력만 읽기 팝오버(사용자 결정). SP 노드는 상속 속성·4지표·IO/조건 읽기 타일 + 연간/FTE 편집(참고치 안내). 부서 확인 오버레이는 팝오버 안 "담당자 해제" 안내로 대체(Esc=취소).
- **비용 단일 타일**(사용자 결정): ₩/$ 두 타일 → 한 타일, 팝오버 앞 단위 탭(`CostUnitTabs`)+배타 안내, 타일엔 단위 필(`CurrencyPill`). 지정 모달·노드 모달 공통. **부서 피커 내 부서 체인 우선**(`sortDepartmentsByOrgProximity`, 새 맵 오우닝 부서 피커 규칙) — 공용 `DeptAssigneeTiles`가 두 모달을 담당.
- **PopoverActionBar**(사용자 결정): 변경 없음=취소 단독(셰브론 없음), 변경 시 저장+셰브론이 폭 트랜지션으로 열림·라벨 페이드, 글자·높이 축소. **Subprocess 탭**: '이 맵을 연결한 맵' 아래 **지정 파라미터** 읽기 타일(1열 행 타일) + 오너/관리자 '수정'→지정 모달(`SubprocessUsageTab`이 상세 자체 조회). 원문 메모 있는 파라미터는 행 호버 시 아이콘이 메모 아이콘으로(`SpFieldTile iconSlot` + `FallbackHint restIcon`).
- **선후행 사이드 독**(사용자 요청): 모달 하단 밴드 → 백드롭 좌우에 떠 있는 간소 카드(색 점·라벨·타입, `NavDock`), 호버 시 scale 1.05 + 모달 쪽 8px(`translate`/`scale` 속성 트랜지션·ease-spring), 클릭=노드 전환(변경 있으면 확인 유지). 백드롭은 자기 자신 mousedown만 닫아 독 클릭이 모달을 안 닫는다.
- **부서 타일 값=말단 부서 필**(사용자 결정): 필 클릭=조직 정보 모달(`OrgInfoModal` 중앙 변형, 경로는 디렉터리 말단 일치로 해석), 필 밖 타일 클릭=피커. 타일 값은 안 잘리고 라벨이 먼저 줄어든다(생략 후에만 값 truncate).
- 검증: tsc·lint·vitest 850(+2)·`pw-smoke-node-modal-tiles.mjs` 26/26. 랜드마인: 축소 캔버스에서 노드 더블클릭이 제목을 맞히면 이름 편집으로 빠진다 — 스모크는 우클릭 "Edit info"로 연다. 타일 값은 안 잘리고 라벨이 먼저 줄어든다(생략 후에만 값 truncate).

## 2026-09-03 — 매뉴얼 6종 main 기준 보완 (main)
- 8/31 이후 델타를 md 매뉴얼에 반영(사용자 지시 "메인 기준 검토·보완"): L5 확정 거버넌스(confirmed 상태·게이트 6·직속 확정권·확정 요청·draft 열람 룰·차콜 배경·분류 노트), 레벨 위임·권한자 모달·현황판·홈 분류 요약 카드, 임포트 거버넌스 체크·오너 미확정·부서 경로 해석·0.4 착지 규칙, 인터뷰 원문 메모·노트 CRUD·SP 참고치·타일 지정 모달·팝오버 공통 조작, SP 피크 재배치·링크된 맵 열기·Framework 칩 좌상단·온보딩 말풍선, 온디맨드 백업, CSV 21열(`input_flags`) 정합. 사용자 매뉴얼에 없던 **AI 컨설턴트 인터뷰** 절 신설. 문구는 i18n 실값 대조.
- 슬라이드 매뉴얼(`docs/manual/slides/`)은 실화면 캡처 파이프라인이라 이번엔 재생성하지 않음 — md와 어긋난 상태(후속).

## 2026-09-03 — 컨설턴트 임포트 후속 1~6: 거버넌스 확인·원문 메모·노트·참고치·지정 모달 (dev)
- **배경**: 임포트 폴백 6종·노트·값 대체 전수조사(아티팩트 "임포트 폴백 지도") — 폴백은 오너 전용 표면뿐, L5 스코프 노트는 조회 경로 없음, 오너 대기 플래그는 수동 이전으로 안 꺼져 재전달이 수동 배정을 덮던 구멍 4종. 설계 `docs/superpowers/specs/2026-09-03-import-governance-review-design.md`·`…-import-fallback-followups-design.md`.
- **재임포트 결정 UI**: 오너·오우닝 부서·승인자·임포트 노트 교체는 dry-run "Governance changes"에서 체크한 것만 적용(`decisions`, 미매칭 422; 노트는 사람이 고친 임포트 노트가 없을 때만 기본 체크, 사용자 노트 불변). 오너 대기 예외 폐지·수동 이전이 플래그 해제·카드 "Owner unconfirmed" 필. 확인 다이얼로그 → 리포트 하단 고정 [Cancel][Apply] 바.
- **표면 확장**: 인터뷰 원문 메모 5종 `PATCH /maps/{id}/fallback-notes`(editor) + `MapFallbackNotes`(에디터 맵 탭=점유권자 편집·홈 카드·비교 요약 기본 접힘; 행머리 아이콘 호버 스왑, 팝오버 360). 노트 CRUD(맵=오너, L5=체인 관리자/sysadmin, `edited_at`) + `MapNotesSection` 프리셋 칩·'[' 자동완성·비권한자 안내, 에디터 맵 탭 순서 SP 카드→원문 메모→노트(L5 캔버스는 카테고리 스코프). SP 지정 참고치 `sp_annual_count/sp_fte`(임포트는 맵 지정값+L5 캔버스 노드 둘 다, 노드 인스펙터 Info 호버). SP 지정 모달 타일 재디자인(`max-w-lg`, 2열 타일 라벨 톤다운+값 우측, 클릭 위치 팝오버·Σ·원문 메모, IO 플라이아웃은 헤드리스 편집기 + 푸터 OK 줄 맨 앞 '+ Add'). SP 카드 액션 행 wrap.
- **소형 입력 팝오버 공통 경험**(`PopoverActionBar`, 사용자 결정): kbd 키 안내(Enter/⌘·Ctrl+Enter/Esc, "바깥 클릭" 문구 제거) + 상태형 주 버튼(변경 없음 Cancel / 있음 Save=저장하고 닫기 / 메뉴 Save 후 Saved) + 셰브론 메뉴 3종(Save·Save and close·Close without saving). 적용: SP 타일 팝오버·인터뷰 원문 메모 팝오버·노트 폼. 바깥 클릭은 변경 있을 때만 저장. 큰 편집 모달은 대상 밖.
- **사용자 노출 문구 긴 대시 → 짧은 대시** 일괄 전환(i18n·JSX·문자열 리터럴·백엔드 API/리포트 메시지·테스트 단언, 150파일 605줄; 코드 주석·docs 유지). FE 파서 `linkage skipped -` 동기.
- 검증: pytest 1347·vitest 848·스모크 `pw-smoke-interview-import.mjs` 23/23·`pw-smoke-import-followups.mjs` 23/23. 랜드마인: 개발 서버를 `| head`로 띄우면 EPIPE로 죽는다(파일 로그), 지정 모달은 게시본에서만 활성, 에디터 goto는 domcontentloaded.

## 2026-09-03 — SP 피크 재배치·목업 드래그·우클릭 맵 이동·프레임워크 탐색 좌상단 통일 (dev)
- **SP 미리보기 피크 재배치**: 헤더를 정보 표면(좌: 맵 이름·오너·게시 버전 / 우: 업무체계 경로·미지정 안내)으로 바꾸고 인스펙터 탭을 좌측, 추가/이동 버튼은 미리보기 우상단에 떠 있는 독립 버튼 2개로(추가=강조색, 한 줄 고정+말줄임) — 패널 높이를 이분할하던 세로 레일은 과하다는 피드백으로 폐기. 목업 노드는 클릭(드롭다운) 유지 + 드래그→캔버스 드롭 추가(`dragPayload`, 행 드래그와 동일 dataTransfer 계약) — 드래그 중 피크는 언마운트 대신 visibility 숨김(언마운트=Chrome 드래그 취소), dragend에서 닫음.
- **피크 미리보기 휠 줌**: SVG 프리뷰 위 휠이 줌 스텝(100~300%, 커서 지점 앵커 고정 — 버튼 줌은 중앙 앵커로 통일). 휠은 프리뷰가 preventDefault+stopPropagation로 전부 소비해 뒤 캔버스·패널과 동시 입력되지 않는다 (React `onWheel`은 루트 passive라 preventDefault 무시 → 네이티브 리스너로 부착).
- **새 맵 AI 컨설턴트 온보딩 말풍선 i18n+가시성**(사용자 요청): 하드코딩 영문이라 한글 UI에서도 영어로 뜨던 것을 `consultOnboard.*` 키 7종(en/ko)으로 이관. 내용은 액센트 틴트 아이콘 배지 + 아이콘 태그 필 3종(인터뷰·문서 첨부·초안 자동 생성) + 화살표 시작 버튼으로 재구성, 본문은 `break-keep`(한국어 어절 보존).
- **피크·라이브러리 UX 5종**(사용자 요청): ①미리보기 SVG `select-none` — 라벨이 드래그 선택되면 팬(초점 이동)이 겉돌던 문제. ②헤더 업무체계 경로를 클릭 트리거로(FrameworkPeekTrigger 재사용) — 체계 트리 플라이아웃 + "다른 체계 검색" 모달. 둘 다 body 포털이라 피크가 먼저 닫히는 것을 막으려 `onOpenChange`로 호스트 자동 닫힘(바깥클릭·이탈)을 억제. ③부서 칩 호버 카드 유예 닫기(500ms) 폐기 → 즉시 페이드아웃(`.animate-item-out` 140ms, 페이드 중 재진입은 되살림). ④피크 액션 폭 통일(추가·이동·게시본 표기 8.5rem) + 이동 버튼을 우하단으로 내리고 게시본 표기를 그 위에. ⑤SP 우클릭 "링크된 맵 열기"를 삭제 아래 구분선 뒤 맨 끝으로(캔버스 이탈 동작 분리). pw 14/14 통과.
- **SP 노드 우클릭 "링크된 맵 열기"**: 링크 부재/삭제·권한 없음(locked)이면 비활성, 클릭 시 이탈 확인 게이트(openMapPrompt). autosave 반영 전 신규 노드는 캔버스 state 폴백으로 해석.
- **프레임워크 탐색 배선·위치 통일**: 헤더 칩의 검색 불능은 회귀가 아니라 `onBrowse` 미배선 — 칩과 L5 탐색기 풋터에 "다른 체계 검색"(FrameworkBrowseModal) 배선. 일반 등록 맵은 칩을 좌상단으로 스왑(제목+저장 체크리스트는 우상단, 플라이아웃 우측 개방) — L5 캔버스와 같은 자리 인식. pw 검증 18/18+스크린샷 7종.

## 2026-09-02 — 컨설턴트 임포트 미세조정: 오너 표기·부서 트리 해석·라이브러리 호버 카드 (dev)
- **오너 표기 owner_id 기준 통일**: 카드·상세 owner_name·에디터 인스펙터가 전부 `created_by`를 보고 있어 임포트 맵(created_by=임포터 ≠ owner_id)에서 임포터가 노출되던 간극 교정 — BE 목록/상세 해석·`MapOut.owner_id` 노출·FE 폴백 3표면(`owner_name ?? owner_id ?? created_by`) 일괄 전환. 미등재 오너는 id+퇴사 배지 폴백.
- **전달물 부서 트리 해석 + L6 owning 등록**: `rows[].department`(루트부터 N단계 슬래시 경로)를 완전일치만 보던 것을 4단 사다리로 — known 완전일치 → 선두 드랍(트림 정렬) → 유일 세그먼트-서픽스 → departments 미러 체인 정렬(직원 없는 부서도 트림 canonical 착지). 실패 시 NULL 대신 정규화 경로 그대로 등록(as delivered), 오너 pending이어도 부서만으로 owning 등록(임포터 org 폴백은 계속 금지). 구 엔진이 owning 없이 만든 pending 맵은 재전달에서 부서만 채움 — 홈 부서 트리에 임포트 부서 그룹이 바로 선다.
- **라이브러리 부서 칩 호버 카드**: 중앙 모달+백드롭 블러 → 커서 앵커 고정 카드(`OrgInfoModal anchored` 변형 — 백드롭 없음·클램프+실측 보정·마우스 추적 좌표) 전환, 칩엔 호버 어포던스(리프트+보더+섀도) 추가. map-detail-card의 중앙 모달 용법은 불변.
- **L5 워터마크 마스크 기울임**: 스탬프(CONFIRMED/DRAFT)가 -24°라 수평 중앙 띠 마스크론 스탬프 양끝이 위아래 로고 타일과 겹침 — 마스크 밴드를 같은 각도(156deg 그라데이션, 36~64%)로 기울여 평행 정렬.
- **framework draft 열람 룰 재정립**(사용자 결정): 라이브 draft는 sysadmin·자기/조상 카테고리 권한자만 열람 — 맵 상세 versions에서 draft 제외(`can_view_draft` 노출)+draft 그래프 403(BE 강제), 뷰어는 최신 confirmed 스냅샷 착지(없으면 빈 상태 안내). 상태 배너 3종(Draft=앰버 상시·Confirmed=액센트·Superseded=회색+최신 라벨) + 확정 스탬프는 최신=한 줄 `CONFIRMED vX.Y`·과거=2단 `SUPERSEDED+LATEST vX.Y`(회색 톤). 상태 배너에 우측 닫기 버튼(버전:사유 키 — 맵 재진입·버전 전환 시 재노출). 워터마크 표기는 전부 Title case(Confirmed/Draft/Superseded/Published/Expired/Read only — 가독성, uppercase 클래스 제거).

## 2026-09-02 — 권한자 관리 UX 3종: 드롭다운 z·버퍼+확인·트리 인라인 표시 (dev)
- 권한자 모달 백드롭 z-1300이 피커 z 계약(호스트 ≤1200·드롭다운 1250)을 위반해 드롭다운이 블러 뒤로 가던 것 교정. 편집은 로컬 버퍼로 바꾸고 확인 버튼 1회만 서버 저장(부서 지정 Confirm 게이트 선례 — 취소/Esc/백드롭=폐기).
- 설정 트리 행의 코드 옆에 그 카테고리에 직접 붙은 권한자를 인라인 표시(2명+초과 +N 호버 툴팁) — 이름은 언어 기준 이중 표기 `주이름(보조이름)`(ko: 한글(영문)·en: 영문(한글), person-hover-card 규칙의 한 줄 판, 모달 필 동일) — 신규 `GET /categories/permissions-map`(1쿼리, sysadmin=전체·위임 관리자=스코프 필터) + 모달 확정 시 즉시 갱신.

## 2026-09-02 — height-shift 충돌 기반 전환 + 에디터·임포트 개선 (feat/height-shift-collision-only)
- **height-shift 충돌 기반 전환**: 커진 노드의 Y축 보정을 전역 계단함수 → 충돌 기반 필드로(`lib/height-shift.ts` 재작성) — 성장분은 저장 여백을 먼저 흡수, X 겹침 열만 `min(저장 간격, 16px)` 유지하며 밀리고 같은 행은 max 동기화. 역변환은 열 프로브 이분탐색(`invertDisplayY`)+드래그 자기 푸셔 제외, 저장 좌표 불변·BE/임포트 배치 무변경. `pw-smoke-height-shift.mjs` 계약 재작성 14/14.
- **에디터/설정 UX 4종**: 펼침 자식 엣지 라벨 알약 복원(`styleEdgeLabelPill` 공용화), 라이브러리 부서 칩 리프 한 줄 표기+호버 조직 모달(닫힘 500ms 유예), 대시보드 브라우저 뒤로가기 → 설정 레일 복귀(popstate), 펼침 자식/게이트웨이 엣지 사용감 통일 — F14 하이라이트 경계 관통·자식 엣지 선택 개방(읽기전용 인스펙터)·게이트웨이 "흐름 안내 엣지" 안내(selected는 styledEdges 직접 세팅 — 자식은 edges state 밖이라 RF 에코 소실).
- **인터뷰 임포트**: dry-run 이슈 메시지 전수(어댑터 49종+라우터 3종) 영어+한글 병기. self edge(A→A)는 드랍 대신 분기 노드 합성 — L6 `a{seq}r` 합성+진출 이설+승격 복원, L5 단독 진출도 강제 fork+back 등록, 이름은 고정 "반복 여부(자동 생성됨)"(`LOOP_BRANCH_NODE_NAME` 단일 소스, 팬아웃 유래는 "{이름} 결과" 유지), quote 노트 보존·자동 생성 노티. 설계 문서 3종 동기화.

## 2026-09-02 — 트랙 C: 레벨 위임·현황판·레벨 요약 카드 머지 — 스펙 §1~§8 전 항목 구현 완료 (dev)
- 레벨 인지 판정(`resolve_category_admin`·`get_admin_scope`·`/me` category_admin_root_ids)과 카테고리 CRUD 위임 5게이트(생성·개명·정렬=서브트리 seed 포함 / 이동·삭제=seed 금지+새 부모 검사 / 임명=하위 레벨만 / **L5-only 관리자는 구조 변경 전체 403** / 루트 생성·임포트=sysadmin). fw_confirm 요청 철회(`DELETE .../fw-confirm-requests/pending`, 점유 미반환)+그룹 수신자 실증.
- 현황판 `GET /categories/framework-overview`(배치 검사기 — 캔버스 수 무관 고정 쿼리, 단건 동치 테스트 6코드 전수)+설정>Framework Manage↔Status 테이블, 레벨 요약 `GET /categories/{id}/summary`(전체 공개·can_edit_linkage)+홈 트리 행 선택→aside 요약 카드(맵 선택 배타·빈공간 복귀). 위임 관리자는 설정 탭에서 자기 서브트리만(frameworkAdmin 접근). 실패 필 라벨은 부정형(`framework.gateFail.*`)으로 분리.
- 검증: 신규 스모크 `pw-smoke-framework-delegation.mjs` 18/18(위임 재현은 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys` — 기본 false는 전원 sysadmin 바이패스). 게이트 pytest 1311·vitest 833·build 그린.

## 2026-09-02 — 트랙 B: 확정 게이트 6종 + 점유·직속 L5 확정권 + 확정 요청 워크플로 (feat/fw-track-b-gates)
- 확정 게이트 6종(missing_l6·placeholder·stale_link·l6_unpublished·noexit_cycle·plain_fanout — 병행 팬아웃은 전부 `Edge.gateway=parallel`이면 예외)을 체크아웃 점유·직속 L5 관리자(`is_direct_l5_admin`) 자기확정권과 함께 `perform_framework_confirm`에 통합, `GET /maps/{id}/confirm-readiness`(+`can_confirm`)를 체크리스트 단일 소스로 노출하고 라이브 draft 삭제를 차단했다.
- 상위 관리자용 확정 위임 요청 워크플로(`kind='fw_confirm'`, 직속 L5/sysadmin은 409→직접확정 유도)를 승인 표면에 통합, FE엔 Approval 탭 게이트 체크리스트+확정 버튼 disabled 연동·요청 CTA·알림 3종을 붙였다. 스모크(`pw-smoke-framework-canvas.mjs`)는 게이트 체크리스트 중심(플레이스홀더 노드 임시 주입으로 위반→해소 결정적 검증) 24/24, 요청 워크플로는 BE 10케이스로 갈음.
- **머지 전 최종 리뷰 후속 4건**: 에디터 그래프 왕복(`toAppEdges`/`buildGraph`)에서 빠져있던 `Edge.gateway` 직렬화를 placeholder_category_id 선례대로 보강(안 하면 저장마다 병행 팬아웃 예외가 서버에서 소거됨) — vitest 3건 추가. 확정 요청 생성 시 요청자의 draft 점유를 자동 해제(요청=편집권 이양, sticky 점유가 decide 확정을 상시 409로 막던 교착 해소) — BE 1건 추가. `fw_confirm_requested` 수신자에 sysadmin(대체 처리자) 합류. 스펙 §4에 게이트 6 판정 기준(source 노드 out-degree) 각주 추가.

## 2026-09-02 — 문서 정리: main 머지 완료 스펙·플랜 폐기 + PROGRESS 아카이브 (dev)
- 폐기 정책(`rules/common/documentation.md`)에 따라 main 머지 완료분 삭제: superpowers 스펙 5(approval-comments·collab-staging·topnav·io-linking·node-spacing)+플랜 12(거버넌스 r3~r6·8월 트랙 전부·framework-l5-linkage)+design 1(field-promotion — 구현 완료·QA 문서 존치). 코드 주석 참조는 파일명으로 강등(`git grep` 전수 확인). 유지: 미구현·핸드오프·전제 스펙(consultant-hierarchy·governance-ux A/B/C·data-surface-parity·interview-import 8/18·v04 2종·framework 8-28 스펙·트랙 A 스펙/플랜).
- PROGRESS 8/18 이전 137줄을 `docs/history/PROGRESS-archive.md`(2026-09-02 이동분)로 아카이브.

## 2026-09-02 — Framework L5 퍼블리시 거버넌스: 스펙 확정 + 트랙 A 머지 (dev)
- 브레인스토밍으로 스펙 확정(`docs/superpowers/specs/2026-09-02-framework-l5-publish-governance-design.md`): 완결성 게이트 6종·`confirmed` 상태 분리·옆문 봉쇄·레벨별 권한 차등·확정 요청 워크플로·현황판. 구현은 트랙 A(상태·봉쇄)→B(게이트·요청)→C(권한·현황판) 순.
- **트랙 A 구현 머지**: 확정 스냅샷 published→confirmed 분리(멱등 startup 이전·게시 순번 채번 중단·삭제 보호), 옆문 봉쇄(versions 8종+승인자/협업자/개명·SP요청 422 — 실파손 경로였음: 확정 후 create-version이 빈 draft 확정, 게시 옆문은 스냅샷 전량 expired / 설정 페이지 4탭·에디터 버튼 숨김), 시각 언어(CONFIRMED·DRAFT 스탬프 -24°·브랜드 워터마크 중앙 띠 마스크·타임라인 칩·다크 PNG export). 게이트 pytest 1255·vitest 821·스모크 14/14.
- 트랙 B 인계: plain_fanout 게이트는 임포트의 "전부 parallel 팬아웃 합법" 예외 반영 필요·framework 라이브 draft DELETE 미차단(게이트 설계 때 판단).

## 2026-09-01 — 대형맵 임포트 스트레스 더미 (dev)
- `docs/samples/framework-linkage-dummy/brr-large-l5.json` — 대형맵 드래그/렌더 성능 실측용 인터뷰 0.4 세트(완제품 배치기록 검토). L6 6개 중 "제조기록 전수 검토"가 대형맵: 12구획×(착수+점검 20+취합) 팬아웃 격자 = **268노드·497엣지**(R2 실측 규모). 시험기록 대조 100노드, L5 연계 캔버스 8노드(분기 2), 유닛 간 IO 완전일치 5쌍, branch/loop/bypass/exception·decision/handoff 포함.
- 로컬 검증: dry-run 어댑터 이슈 0(경고는 기존 더미 세트와 동일 클래스 — owner null 관례 + 로컬 데모 db에 없는 승인자 jihoon.park/sujin.han), apply로 6맵+연계 캔버스 생성, 에디터에서 268/497 렌더·드래그·드롭 영속 실측 확인.

## 2026-09-01 — 캔버스 드래그 성능 라운드 2: 드래그 중 nodes 동결 (perf/canvas-drag-r2)
- 일반 드래그의 dragging=true 프레임을 `nodes` state에 커밋하지 않고(페이지 리렌더·`[nodes]` memo 재계산 0) 드롭 flush 1회만 커밋. 352노드·351엣지 스트레스 맵 프로드 A/B(순서 교차): **avg 47~49→17.2ms/frame(-64%), p95 150→16.8ms(-89%), over33 176→2** — vsync(16.7ms) 락. 엣지 0 맵도 avg 39→16.9·p95 116.7→16.8.
- 설계는 인라인 펼침의 suppress+라이브 오버레이 일반화 — 단, **controlled RF는 부모가 position을 되돌려줘야만 노드가 움직인다**(스토어는 `onNodesChange` 디스패치만, 내부 미갱신 — 1302줄 "ref면 안 됨" 주석이 정답이었다). 그래서 프레임당 라이브 좌표를 RF props 동기화와 같은 채널(`useStoreApi().getState().setNodes`)로 직접 흘린다 — 노드·엣지·선택링·액션바(dragging 플래그)가 전부 따라오고, 드래그 중 다른 state 변경 시엔 displayNodes의 모듈 맵(`generalDragLive`) 오버레이가 stale adopt(스냅백)를 막는다. **트레이드오프: 스토어 직행은 세미-내부 API** — RF 메이저 업그레이드 시 이 echo가 첫 점검 대상(깨지면 "드래그 무반응"으로 즉시 드러남).
- 동결 제외 게이트: Shift 축고정 프레임(보정 좌표를 RF에 되돌려야 시각 잠금 — 기존 per-frame 커밋 유지), 그룹 멤버 제스처(그룹박스가 nodes 기반 memo라 라이브 추종 필요), 인라인 펼침(전용 dragLiveById 경로 유지). 드롭 후 존/충돌/ctrl-복사·autosave는 flush가 stop 콜백보다 먼저 큐잉되는 RF 순서(소스 확인)에 그대로 얹힘.
- 검증: 신규 `pw-verify-drag-freeze.mjs` 15/15(커서1:1+영속·Shift 중간프레임 이탈0·다중선택·그룹박스 라이브·링 표시/해제·undo)·`pw-verify-zone-swap.mjs`(swap 실행+aStart 계약) + 기존 shift 17/21·ctrl 29/31·밴드 연속성·펼침 드래그 — **전 항목 베이스라인(64dfbc35 별도 빌드)과 픽셀 단위 동일**(mid-drag 엣지 끝점 거리까지 일치). 게이트 lint·vitest 812·build 그린.
- 기존 이슈 확인(이번 변경 무관, 베이스라인 동일 재현): 다중선택 시 `.react-flow__nodesselection-rect` 오버레이 미렌더, Ctrl 드래그 mid-drag 고스트(`.bpm-node-ghost`) 미표시 — 별도 추적 필요.
- 측정 랜드마인: `next start`의 `/api` rewrite는 **BACKEND_URL을 빌드 시점에 굽는다** — 런타임 env로 안 바뀌므로 측정용 빌드는 `BACKEND_URL=… npm run build`로 만들 것(안 그러면 기본 8000의 공용 dev.db에 테스트 데이터가 들어간다. 이번에 들어간 5개 맵은 하드 퍼지 완료).

## 2026-09-01 — 임포트 dry-run 리포트 가독성 재구성 (dev)
- 리포트가 코드(taskId)·영문 상세 500행 평면 테이블이라 같은 경고가 20번 반복돼 읽히지 않았다. **파일 → L5 연계 캔버스 → 맵** 계층으로 접고, 1열을 사람이 아는 이름(L6 라벨·카테고리 경로)으로 바꿨다. 반복 경고는 상단 "확인 필요" 다이제스트에 종류별 1줄(영향 맵 이름 + 개수)로 접는다. 고유키(taskId·unitId·카테고리 코드)는 Hash 아이콘 호버 툴팁으로만 노출.
- 맵 이름은 서버 rows에 없다 — 업로드한 인터뷰 JSON에서 코드→이름 색인을 만들어 붙인다(`lib/interview-report.ts`, 백엔드 스키마 무변경). 미등록 상세 문구는 원문 그대로 통과시켜 정보 손실 없음.
- 툴팁은 위 공간이 없으면 **아래로 플립**한다(경계에서 클램프만 하면 앵커 행을 덮었다). 정렬은 CSS `translate` 속성으로 — Tailwind v4 `-translate-*`와 같은 속성이라 `transform`으로 덮으면 두 번 밀린다.

## 2026-09-01 — 0.4 임포트 트랙 핸드오프 문서 (dev)
- `docs/design/2026-09-01-interview-import-v04-result.md` — 이번 트랙의 최종 결과문서(확정 계약·검증 수치·한계 7건·확장 계획 5건·후속 점검 6건). 시행착오는 뺐고, 규칙 근거는 같은 날 설계 스냅샷, 필드 대조는 `docs/qa/interview-import-field-map.md`로 분리.
- 최우선 후속은 **실파일 0.4 dry-run 대조** — unknown key 리포트가 그대로 어댑터 수정 목록이 된다.

## 2026-09-01 — 0.4 전 기능 더미 1세트 (dev)
- `docs/samples/framework-linkage-dummy/change-control-l5.json` — 변경관리 L5 + L6 4건. seq·branch(exclusive/parallel)·loop·bypass, decision/handoff kind, exception variant, IO 완전일치 체인을 한 파일에 다 태운 시연용 세트.
- 실 임포트 확인: 어댑터 이슈 0 · L6 4맵(24노드/25엣지, 분기 승격 4) · 연계 캔버스 7노드(분기 3개, 위/아래 팬아웃) · IO 자동 연결 21건 · 자동 draft 4건 · L5 노트 8건. `분류 확정 CR`을 두 노드가 내는 경우 최근접 상류(동률이면 낮은 seq)가 선택되는 것까지 확인.

## 2026-09-01 — L5 분기 출구 팬아웃 배치 (dev)
- 분기 노드를 세워도 캔버스가 한 줄이라 어디서 갈라지는지 선만으론 안 읽혔다. 분기 출구를 **오른쪽 위 → 아래 → 옆 순**으로 벌리고 엣지 출구 핸들(`s-top`/`s-bottom`/`s-right`)을 기하에 맞췄다. 분기 노드는 일반 노드라 4면 핸들을 다 쓸 수 있다(SP는 좌 `in`·우 `__primary__` 고정).
- 행 배정은 먼저 배정된 쪽이 이긴다 — 두 갈래가 같은 L6로 합류할 때 나중 분기가 위치를 흔들면 안 된다. 출구 변은 최종 행에서 되뽑아 기하와 항상 일치시킨다(4번째부터는 위/아래로 한 칸씩 더).
- 검증: pytest 1249(신규 4)·ruff 그린 + 실 서버 임포트로 `◇준비결과 ─위→ 현장 수행 / ─아래→ 보고(bypass)` 시각 확인.

## 2026-09-01 — L5 연계 캔버스 분기 노드 (dev)
- L5의 L6 연계는 `A→B, B→A(loop), B→C`가 가능한데 분기가 다중 out-edge로만 표현돼 어디서 갈라지는지 안 보였다. L6 맵은 branch 엣지의 src를 decision으로 승격하지만 캔버스 src는 subprocess라 타입을 못 바꾼다 → **팬아웃 앞에 분기 노드를 새로 끼운다**(`B → ◇(B 결과) → A|C`). 조건 라벨은 분기 노드 출구 엣지가 들고 간다.
- 기준: 나가는 엣지 2개 이상 && 전부 `gateway=parallel`은 아님(병행은 택일이 아니라 마름모가 오독을 만든다 — L6 승격 제외 규칙과 동일). 재임포트 재사용은 계보 키(`__branch__{src}`), 핸들은 끝점 타입별(SP=in/`__primary__`, 분기=`t-left`/`s-right` — 섞으면 RF가 엣지를 조용히 버린다).
- 검증: pytest 1245(신규 5)·ruff 그린 + 실 서버 임포트로 `준비 → ◇준비 결과 → {수행, 보고}`, `수행 → ◇수행 결과 → {보고, 준비(loop)}` 확인.

## 2026-09-01 — L5 연계 캔버스 사이클 배치 (dev)
- 사용자 지적대로 SP 노드끼리 `kind:"loop"`으로 **사이클이 생길 수 있는 구조**였고, L6 맵과 달리 캔버스 배치엔 `back_pairs`를 안 넘기고 있었다. 사이클이 남으면 Kahn 큐가 비어 **전원이 leftover로 떨어져 랭크가 노드 나열 순서로 매겨진다** — 같은 그래프인데 전달 순서만 뒤집으면 배치가 뒤집히는 걸 실측 확인(멀쩡해 보였던 건 `map_codes`가 우연히 진입 L6부터였기 때문).
- 되돌아가는 엣지를 랭크에서 먼저 걷어내 선행→분기 순서를 확정하고 복귀 엣지를 그 위에 그리도록 변경. 제거 대상은 전달물의 `kind:"loop"`(확정) + DFS가 찾은 잔여 back edge(보완, 진입 노드부터 탐색). 이를 위해 `InterviewLinkageEdge.kind`를 엔진까지 전달(저장 안 됨).
- 검증: pytest 1240(신규 5)·ruff 그린 + rows를 역순으로 전달해도 캔버스가 흐름 순(준비→수행→보고)으로 배치됨을 실 서버에서 확인.

## 2026-09-01 — 첫 자동배치에서 엣지 라벨↔노드 간섭 제거 (dev)
- 실측이 추정을 뒤집었다: 라벨은 이미 `maxWidth:160`에 걸려 있었고, 진짜 원인은 **랭크 간격 240 − 노드 폭 170 = 틈 70px**이라 어떤 읽을 만한 폭도 안 들어간다는 것(신규 스크립트 `pw-measure-edge-label-overlap.mjs`로 3개 맵 17건 실측).
- 라벨 최대폭을 배치의 입력으로 승격 — 랭크 간격을 **그 구간을 지나는 엣지 라벨 폭**에서 계산한다(`estimate_label_width`: 한글 1em·그 외 0.55em 근사 후 최대폭 클램프). 라벨 없는 구간은 240 유지 — 일률적으로 넓혔더니 맵이 과하게 커졌다(중간 시도, 폐기). 최대폭 상수는 FE `canvas.ts EDGE_LABEL_MAX_WIDTH`와 동기.
- 검증: 같은 스크립트로 재측정 17건 → **0건**, 맵이 뷰포트에 다 들어옴. pytest 1235(신규 4)·ruff·tsc·lint 그린.

## 2026-09-01 — 임포트 후처리 3종: IO 자동 연결·가로 자동정렬·편집용 draft (dev)
- **IO 자동 연결** — 아웃풋 줄과 인풋 줄이 완전일치하고 흐름상 순방향이면 IO 링크(원본↔미러)로 잇는다. 후보가 여럿이면 최근접 상류 하나(한 항목=링크 1개 불변식). 항목 id는 전달 좌표에서 파생한 결정적 sha1 — uuid4면 재임포트마다 바뀌어 기존 미러가 끊긴다. 샘플 7개 맵에서 40건 연결, 전부 흐름 순방향. 전달물이 고유키를 싣기 시작하면 텍스트 대신 그 키로 잇는다.
- **가로 자동정렬** — 노드·엣지를 다 만든 뒤 배치를 최종화. 에디터 `autoLayoutFlow`(LR)의 파이썬 동치본 `scripts/consultant_layout.py`(dagre 대신 rank+배리센터, 그 뒤 computeSpine·alignBackbone·핸들 지정은 TS 이식). L5 연계 캔버스는 **새로 만들 때만** 적용(보강은 "추가만·이동 없음"). ⚠️ 좌표는 시그니처 밖이라 무변경 재임포트는 배치를 갱신하지 않는다.
- **게시본 위 편집용 draft** — 게시 직후 자동 생성(점유권자 없음 — 실행자로 잡으면 실오너가 강탈 없이 편집 불가). 손 안 댄 draft는 재전달이 새 버전으로 재사용해 이력에 쌓이지 않게 했다(편집 흔적이 있으면 보존하고 새 버전을 따로 게시).
- 검증: pytest 1231(신규 17)·ruff 그린, 실 서버 신규 L5 apply — IO 8건·주 흐름 직선 정렬·역행 loop top 핸들·draft 1건 확인.

## 2026-09-01 — 컨설턴트 인터뷰 JSON 0.4 임포트 (dev)
- 전달 스키마가 흐름 그래프를 싣기 시작(`relations`) — 0.3에선 seq 순서로 추측하던 흐름이 이제 명시 엣지(seq/branch/loop/bypass + exclusive/parallel 게이트웨이·조건·근거 발화)로 온다. **0.3은 거부**(수용하면 흐름이 조용히 일직선으로 뭉개짐), 저장소 샘플 5종은 0.4로 변환.
- L7 엣지는 맵 그래프로(라벨=label+condition 2줄, branch면 src를 decision 승격 — `actions[].kind`는 분기를 안 알려준다, loop은 Start 배선 판정에서만 제외), 최상위 L6 엣지는 **L5 연계 캔버스를 시드/보강**(추가만·이동 없음, 타인 체크아웃이면 스킵). 이걸로 0.4에서 처음 값이 실리는 `annual_count`/`fte`가 SP 노드에 착지 — 종전엔 착지면이 없어 경고 후 버려졌다.
- ⚠️ 실브라우저에서 밟은 함정: 서버가 만든 SP 끝점 엣지에 전용 핸들(`in`/`__primary__`)을 안 넣으면 **React Flow가 엣지를 조용히 버린다**(DB엔 있는데 캔버스엔 선이 없음) → `docs/lessons/canvas-react-flow.md` §6에 기록, 회귀 테스트 추가.
- 필드 착지·무시·조용한 오변환 전수 대조표: `docs/qa/interview-import-field-map.md`. 검증: pytest 1214(신규 20)·ruff·vitest 812·tsc·lint 그린 + 실 서버 dry-run/apply(경고 0)·연계 캔버스/분기·루프 스크린샷.

## 2026-09-01 — 핫픽스: 피크 목업 드롭다운 "해당 맵으로 이동" 무반응 (dev)
- 목업 드롭다운 메뉴가 body 포털이라 피크의 바깥클릭 닫기(mousedown 캡처)에 걸려 **click 전에 피크째 언마운트** → 이동 게이트(openMapPrompt) 미표시·추가 항목도 동일 사망. 내부 mockMenu 닫기 핸들러엔 제외가 있었는데 피크 레벨 핸들러에 누락 — mockMenuRef를 공유해 양쪽 모두 제외.
- 검증: 신규 `pw-verify-peek-mock-open.mjs` RED(gateVisible 0)→GREEN(게이트 표시·콘솔 에러 0), lint·vitest 812·build 그린.

## 2026-09-01 — 온디맨드 백업 + 백업파일 로컬 다운로드 (dev)
- 일간 사이드카만 있던 백업에 **온디맨드 경로** 추가 — 설정 > Batch jobs DB 백업 카드에 "Backup now"·백업 파일 목록·다운로드. postgres는 backend가 `${BACKUP_DIR}/backup.request` 트리거를 쓰고 사이드카(60s→5s 폴링)가 소비해 pg_dump, 로컬 sqlite는 backend가 backup API로 즉시 사본. backend 컨테이너에 `${BACKUP_DIR}` 마운트 추가(compose).
- 파일명 화이트리스트(`bpm-*.dump|sqlite`)로 경로 탈출 차단, 전부 sysadmin 게이트. 검증: pytest 1200 그린(신규 6), `pw-verify-backup-ui.mjs` E2E(실행→목록→다운로드 577KB) 통과.

## 2026-09-01 — 캔버스 드래그 성능 라운드 1 (dev)
- 352노드·351엣지 스트레스 맵 실측(프로드): 드래그 평균 41.5ms/frame·p95 125ms → **35.5ms·p95 100ms**. 최대 병목은 꺾은선 엣지의 장애물 회피 — 엣지마다 `useNodes` 전체를 filter+map+inflate해 **매 프레임 엣지×노드 규모 객체 생성**(GC 폭증) → 노드 배열 identity당 1회 공유 캐시 + 양끝 노드는 스캔 중 스킵 + 밴드 프루닝·최근접 후보 조기종료.
- displayNodes의 프레임당 낭비 2건 제거 — 담당자 드리프트 판정을 users 선형 스캔에서 name→dept Map으로, height-shift 오프셋 적용 노드는 WeakMap identity 캐시로 무변경 노드 리렌더 차단. 남은 병목은 페이지 전체 리렌더(거대 JSX)+RF 스토어 팬아웃 — 다음 라운드는 드래그 중 `nodes` 동결(dragLive 일반화) 검토.
- ⚠️ 측정 중 발견한 랜드마인: `nodes.id`/`edges.id`가 **전역 PK**라 다른 버전에 같은 id로 graph PUT하면 upsert가 기존 버전의 노드 행을 새 버전으로 **이관(탈취)**한다 — 실데이터는 uuid라 충돌 없지만 CSV 왕복(export→다른 맵 import) 같은 id 재사용 경로는 위험. 경계 가드 미구현(후속).

## 2026-09-01 — 운영 대시보드 "새벽 조감도" 재구성 (dev)
- 설정 > Dashboard를 L5 하늘 프레임 문법으로 전면 재구성 — 상단 네브바만 라이트로 남기고 그 아래 전체(지표+Access 사이드바)가 흰 거터 위 `.bpm-l5-sky` 라운드 프레임 하나(거터가 네브바와의 단절을 잇는다). 좌 요약 레일 폐지 — KPI 4종은 하늘 위 유리 타일 밴드(SkyStat), 운영 카운터 3종은 헤더 우측 승격.
- 카드·차트까지 전부 다크(사용자 지시) — 섹션 유리면 `bg-surface/10`+`text-canvas` 계열, 차트/막대/상태 톤은 새 파생 토큰 `--color-accent-sky`와 color-mix 라이트닝으로 재조색, StatCard는 SkyStat으로 흡수·삭제. 폼 입력(SearchSelect·date)만 라이트 필드 유지, 프레임 내 스크롤바 `.bpm-sky-scroll`. 워터마크·스포트라이트는 L5 폐기 결정과 동기화해 넣지 않음.
- 검증: tsc 0·eslint 0·vitest 812 그린, `pw-shot-dashboard-sky.mjs` 3장(전체/스크롤/커버리지+직접기간) 콘솔 에러 0.

## 2026-09-01 — 인스펙터 3종: L5 SP 카드 은닉 통일·표시정보 일괄 토글·팝오버 가장자리 보정 (dev)
- **L5 SP 지정 카드**가 속성 탭에서만 숨겨지고 맵·승인 탭엔 남아 있었다 — 세 탭 모두 `!isFrameworkMap` 게이트로 통일(지정 자체가 서버 422라 노출이 곧 혼동). 일반 맵은 종전대로 세 탭 모두 노출.
- **노드 표시 정보 헤더에 전체 보이기/숨기기** 추가 — 카테고리별 눈 아이콘은 있었지만 전체가 없었다. 헤더는 접힘/펼침 공용이라 접은 채로도 쓸 수 있다(접기 버튼 안에 버튼을 못 넣어 헤더를 행으로 분리).
- **팝오버 가장자리 보정** — 인스펙터가 화면 오른쪽 끝이라 오너·승인자 필 카드(`UserHoverCard`)와 SP 안내 툴팁(`Tooltip`)이 화면 밖으로 나갔다. 높이가 가변이고 툴팁은 CSS 변형으로 중앙정렬돼 **크기 추정 배치가 불가** → `getViewportOverflow`(실측 박스 기반 보정량)를 새로 두고 레이아웃 이펙트에서 붙인 뒤 밀어 넣는다(페인트 전이라 튐 없음, `visibility`로 첫 프레임 가림).
- 검증: 신규 `pw-verify-inspector-round.mjs` 20/20 — 보정은 "화면 안이더라" 대신 **보정 없는 원래 자리를 계산해 실제로 벗어났는지까지** 확인(오너 카드 우측 127px 당김, 강제 가장자리 툴팁 y −173→8). 게이트 tsc 0·lint 0·vitest 812.

## 2026-09-01 — L5 워터마크 가시성 상향 + 커서 스포트라이트 (dev)
- 회사(SΛMSUNG BIOLOGICS)·서비스(Business Process Map) 워터마크가 하늘에 묻혀 읽히지 않는다는 지적 — 화이트 **6% → 24%**(0.06/0.10/0.13/0.16/0.20을 런타임 override로 실화면 대조 후 사용자 지정값 24%로 확정).
- **커서 스포트라이트는 시도 후 폐기**(재제안 금지) — 커서를 따라 하늘을 밝히는 광원을 넣었다가(넓고 옅은 단일 광 → 반경 1/3+잔상 3겹) "조잡하다"는 판단으로 걷어냈다. 꼬리가 시선을 커서로 끌어 배경이 아니라 장식으로 읽히고, 반경을 좁히자 은은한 조명이 손전등이 됐다. **L5 하늘은 정적으로 둔다** — 정체성은 워터마크 24%가 진다. 성능은 문제가 아니었다(합성 레이어 transform만 갱신, 프레임 간격 구성 무관 median 16.7ms). 구현이 필요해지면 git 이력(e237479c·cf68558d)에 남아 있다.
- 측정 함정 기록: 스윕 중 잡히던 long task 2건은 글로우와 무관했다 — 글로우를 지운 구성에서도 **로드 후 t≈5.5s에 고정 발생**(`unknown:window`, 앱 폴링 추정). 측정 순서 때문에 처음엔 글로우에 귀속돼 보였다. A/B는 순서를 바꿔 한 번 더 볼 것.
- 검증 중 확인: 오래 떠 있던 dev 서버는 **Turbopack CSS 영속 캐시 탓에 `.bpm-l5-sky` 규칙이 비어(`background-image: none`) L5 캔버스가 흰 배경으로 렌더**된다 — 소스·프로덕션 빌드는 정상. 톤 판정 전 `frontend/.next` 삭제 후 재기동이 필요하다(기존 랜드마인 재확인).

## 2026-09-01 — 펼친 하위프로세스 안에서 Tab이 캔버스를 벗어나던 버그 (fix/sp-tab-focus)
- 자식 스코프의 **끝 노드에서 Tab, 진입 노드에서 Shift+Tab**을 누르면 다음 노드로 못 가고 브라우저 기본 Tab이 살아나 캔버스 밖 버튼으로 포커스가 튀었다. 원인은 스테퍼가 따라가는 엣지 집합에 **게이트웨이(호스트→자식 진입, 자식 끝→후속)가 빠져 있어** 자식 스코프가 흐름의 섬이 됐던 것 — 게다가 다음 노드가 없으면 `preventDefault` 없이 빠져나가 기본 동작이 그대로 실행됐다.
- `buildStepFlowEdges`(lib/inline-expand.ts)로 "화면에 보이는 흐름"(가려진 A→B 제외 + 게이트웨이 포함)을 만들어 스테퍼에 물렸다. 이제 아웃라인과 같은 순서로 호스트→자식 진입→…→자식 끝→후속을 오간다. **Tab은 노드 선택 중이면 항상 `preventDefault`** — 막다른 노드에서도 포커스가 새지 않는다(비교 화면이 이미 쓰던 규칙과 통일).
- 일반 맵과 L5 업무체계 맵이 같은 에디터·같은 합성 경로라 한 번의 수정으로 둘 다 교정됐다. 검증: 신규 `pw-verify-sp-tab-focus.mjs` 26/26(두 맵 × 진입/복귀/내부 순회/막다른 포커스 유지) — 수정 전 동일 스크립트로 6건 FAIL 재현. 게이트 tsc 0·lint 0·vitest 812·build OK.

## 2026-09-01 — L5 연계 캔버스 "새벽 조감도" 아이덴티티 (feature/l5-dark-shell 머지)
- L5 캔버스에 전용 시각 정체성 부여. 여덟 라운드 시행착오(은은한 회색→차콜→다크 셸→프레임→미드톤→링·그리드·도트 변주) 끝에 브레인스토밍으로 목표 이미지("전략 조감도 × 새벽 그라데이션 × 임원 보고용 플랫")를 확정하고 안착. **최종**: 흰 거터 위 라운드 프레임(라이트 토글에도 유지 — 컨트롤 위치 불변) + 네이비(`#1B2743`)→차콜(`#363843`) **86% 알파** 세로 그라데이션 하늘(`.bpm-l5-sky`) + **SΛMSUNG BIOLOGICS ↔ 아이콘+Business Process Map 2종 사선 타일 워터마크**(-24°·화이트 6%·노드 아래·뷰포트 고정) + 우상단 L5 태그 토글(Moon/Sun, `bpm.l5CanvasBg` 사용자 전역 영속, 칩 20px 인셋 고정) + 도트 없음 + RF 어트리뷰션 숨김(`proOptions`). L5 인스펙터의 SP 지정 카드는 숨김(서버 422 차단과 UI 정합 — 노드 선택 시 L6 등록요청 CTA는 유지).
- 폐기·재제안 금지 결정(design.md §7 명문화): 표면 단색 재도색(어떤 색이든 라이트 크롬과 "깨진 테마" 충돌)·크롬 다크 셸(다크모드화). 함정 기록: Turbopack 런타임 클래스 purge → raw `<style>`·**CSS 영속 캐시는 `.next` 삭제로만 해소**·반투명 그라데이션 밑 background-color 언더레이는 알파 이중 적층·absolute inset-0 자식은 컨테이너 padding 무시·스크린샷 톤 판정은 픽셀 실측으로. 홈 목록의 L5 제외는 `lib/word-map-home.ts splitMapsByMode`가 정답(트리 L5 행으로만 진입, 검색 리스트는 예외적으로 노출).
- 검증 `pw-verify-l5-canvas-bg.mjs` 27/27 + 픽셀/DOM 실측 · tsc 0 · lint 0 · vitest 807 · build OK.

## 2026-08-31 — 중첩 펼침 영역 메뉴는 가장 안쪽 맵 기준 (dev)
- A>B>C로 하위프로세스를 겹쳐 펼친 상태에서 **C 안에서 우클릭해도 B가 대상**이 됐다 — 좌표 히트테스트가 "마지막 매치=바깥"을 돌려줬기 때문. 바깥 영역이 안쪽을 항상 포함하므로 `depth`가 가장 큰 매치를 고르도록 뒤집었다(호버 강조도 같은 함수라 함께 교정).
- 대상이 헷갈리지 않게 **영역 메뉴 첫 줄에 그 링크맵 이름**을 박았다(`ContextMenuItem`에 `title` 변형 추가 — `caption`은 대문자 변환이라 고유명사에 부적합).
- **영역 헤더의 맵 이름 클릭 = 즉시 접기 → 그 영역 기준 메뉴 열기**(사용자 요청). 실수로 전체가 닫히는 사고를 없앤다. 이름을 눌러 연 메뉴는 대상이 자명해 헤더를 생략한다. 헤더 버튼들의 클릭/우클릭은 pane으로 새지 않게 `stopPropagation`.
- 검증: 신규 `pw-verify-nested-region-menu.mjs` 12/12(중첩 2단 펼침·안쪽 우클릭 헤더 이름·접기는 C만·이름 클릭은 미접힘+메뉴·이름 메뉴 접기도 C·열기 이동 대상 /maps/3). 게이트 tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — 오우닝 부서 미지정 필에서 바로 지정 (dev)
- 홈 상세 카드의 "Dept unassigned" 필(권한 필 오른쪽)을 **오너/시스템 관리자에 한해 버튼으로** 바꿔 클릭 시 부서 지정 모달을 연다 — 경고만 띄우고 조치 경로가 없던 것을 이었다. 좌측 맵 카드의 태그는 목록 밀도상 그대로 둔다(비클릭 span).
- 피커는 설정 화면 오우닝 지정과 동일 컴포넌트·옵션(`PrincipalPicker` `deptTreeBrowse`), 저장은 기존 `PUT /maps/{id}/owning-department`. 게이트는 `my_role === "owner"` 하나로 충분 — sysadmin은 `effective_role`이 owner로 해석돼 서버 `require_map_role("owner")`와 판정이 일치한다.
- **모달 z를 1300 → 1200으로 내렸다**(사용자 신고: 목록이 안 뜸) — 피커 드롭다운 포털이 z=1250 고정이라 1300짜리 모달 뒤로 깔렸다. 피커를 쓰는 모달은 1200대여야 한다는 기존 계약(생성 모달과 동일)에 맞춘 것.
- **행 클릭은 선택까지만, 확정은 Confirm**(선택 전 비활성) — 잘못 눌린 부서가 즉시 저장되던 것을 막는다. 선택 후엔 새 맵 모달처럼 피커를 선택 행(X로 재선택)으로 교체 — 드롭다운이 Confirm을 덮는 문제도 함께 사라진다.
- 검증: `pw-verify-owning-assign.mjs` 14/14(카드 태그는 span 유지·상세 필은 button·모달·**목록이 모달 위에 뜸(히트테스트)**·**행 클릭만으론 미저장**·Confirm 활성화·서버 저장·필 전환). 게이트 tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — 미리보기 팬·링크 행 포커스·피커 드릴인 (dev)
- **미리보기 줌은 스크롤바 대신 드래그(그랩)** — 좁은 피크 안에서 스크롤바는 조준이 어렵고 클릭도 안 먹었다. `overflow:hidden` 상태에서도 동작하는 scrollLeft/Top을 포인터 드래그로 움직인다(캡처 기반, 절대 좌표 환산이라 드리프트 없음).
- **목업 호버 방향 반전**(사용자 지적) — 기본=현재 맵 표시 기준, 호버=전체 파라미터. 호버로 *줄어들면* 커서가 목업 밖으로 나가 unhover→확대→재hover 점프 루프가 생긴다. 항상 아래로 자라는 방향이면 커서가 계속 안쪽이라 루프가 사라진다.
- **이미 맵에 있는 행 클릭 = 그 노드로 포커스** — 추가가 불가능한 행에 미리보기를 띄우는 건 의미가 없었다. 커서·호버도 "금지"에서 "이동"으로 바꿔 클릭 가능함을 알린다(라이브러리·트리 피커 공통).
- **트리 피커는 열릴 때 내 위치(캔버스 결착 L5)까지 자동 드릴인** — 매번 L1부터 파고들 필요가 없다. 체인 각 단계를 병렬 fetch해 한 번에 펼친다.
- 피크 헤더에 **"해당 맵으로 이동"** 버튼 추가(추가 버튼 왼쪽) — 목업 드롭다운에만 있던 동선을 올렸고, 클릭은 기존 이탈 확인 게이트를 그대로 탄다.
- 검증: `pw-verify-ux8-round.mjs` 23/23(항목 12·13·14·16 추가) · `pw-smoke-framework-canvas.mjs` 13/13(자동 드릴인 레이스로 이미 열린 행을 닫던 단계 수정). 게이트 tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — SP 설명 일원화 · 노트 섹션 · 슬롯 게이트 (dev)
- **`sp_description` 폐기, 맵 `description`으로 일원화** — 운영에서 둘을 따로 채우는 사례가 없어 이중 관리만 남아 있었다(사용자 확인). 지정 화면에서 고치면 맵 설명이 함께 바뀐다. 모델 컬럼·`_ADDED_COLUMNS`·`MapOut.sp_description` 제거, `SubprocessRefOut.sp_description`은 소비처(캔버스 설명 합성·Excel)가 많아 이름을 유지한 채 소스만 맵 설명으로 교체(빈 문자열은 None 정규화). **기존 DB 컬럼은 nullable이라 남겨둔 채 무시** — 드랍은 별도 정리 시점에.
- SP 더블클릭 상세 모달에 **링크맵 노트 섹션** 추가 — 기존 `MapNotesSection` 재사용(기본 접힘·영속 없음·노트 없으면 섹션 자체가 안 뜸)이라 신규 상태 없음.
- **슬롯 해제/변경 파급효과 게이트** — 되돌리기 어려운 두 동작만 즉시 실행 대신 영향 패널로 막는다(최초 연결은 게이트 없음). 해제=에러 톤, 변경=changed 톤 + 현재 경로·영향 목록(체계 트리 이동/제거·연계 캔버스 소속/외부 전환)·`subprocess-usage` 기반 참조 맵 수(있을 때만).
- **폐기 컬럼 물리 삭제**(사용자 결정) — `_drop_legacy_sp_description`를 비치명 부트스트랩 스텝에 추가해 배포 1회 기동으로 `process_maps.sp_description`을 드랍한다. ⚠️ 드랍 후 이 커밋 이전 코드로 롤백하면 해당 컬럼에 쓰다 죽는다.
- 검증: 신규 `pw-verify-slot-notes-desc.mjs` 10/10 · `pw-shot-external-l6-mock.mjs` 6/6(외부 L6 목업 흰 바디+5px 좌측 탭, 같은 L5는 파스텔 필 유지 회귀 포함). 게이트 BE pytest 1195·ruff 0·3.11 compileall 0 / FE tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — 캔버스/피크 UX 8종 (dev)
- 팝오버 앵커를 **커서 좌상단 기준**으로 전환 — 체계 피크(FrameworkPeekTrigger)와 피크 목업 드롭다운이 트리거 오른쪽/아래 고정이라 화면 끝에서 뷰포트를 벗어나 찾기 어려웠다. 렌더 후 실측 클램프(ResizeObserver, state 대신 DOM style write로 set-state-in-effect 회피).
- SP 미리보기 피크: 폭·높이 1.5배(40vw→60vw, 32vh→48vh) + 줌 1~3배(ScopePreview에 `zoom` — viewBox를 좁히는 대신 SVG를 키워 브라우저 스크롤로 이동, 팬 구현 불필요) + 이탈 400ms 유예 닫힘 + 목업 높이 아코디언(호버로 표시 필드가 바뀔 때 점프하던 것). 외부 L6 목업을 캔버스 C안(흰 바디+좌측 컬러 탭)과 일치시킴 — 파스텔 필이라 실제 렌더와 달라 보였다.
- 트리 피커: 하위 후보가 하나뿐인 단계는 자동 드릴인(갈래가 생기면 정지), 현재 L5 `aria-current` 하이라이트. SP 노드의 체계 아이콘 더블클릭이 노드 편집 모달까지 새던 것 차단. PNG 출력에서 "최신본 따르는 중" 배너 생략(화면 전용 상태 표시 — 노드 높이도 그만큼 감소).
- 검증: 신규 `pw-verify-ux8-round.mjs` 14/14 + 기존 `pw-smoke-framework-canvas.mjs` 12/12(자동 드릴인으로 이미 열린 행을 재클릭해 닫던 단계를 aria-expanded 가드로 수정). 게이트 tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — 배포 문서 최신화 + 1회성 셋업 분리 (dev)
- `docs/deploy/setup-once.md` 신설 — 배포 문서 전반에 흩어져 있던 1회성 작업을 **A. 스택 구축 1회**(Docker 전제·Keycloak 클라이언트/URI·AD 서비스 계정·n8n 웹훅 2종·`.env`+시크릿 발급·백업 디렉터리·서브넷 분리·빈 DB 시드)와 **B. 릴리스 이후 1회**(ai_chat_logs 드랍·KB 백필·필드 승격 재임포트·HR 첫 sync+고아 경로 이관·노출 직책 확정)로 갈라 모았다. 성격이 달라서(B4만 재실행 위험) 항목마다 재실행 안전성을 명시.
- `db-migration-9910.md` 전면 재작성 — **`dc910` alias 전제 제거**(셸 새로 열면 조용히 깨지는 전제였다), 모든 명령을 `docker compose -p bpm-9910 --env-file .env.9910 …` 완전형으로. 회차마다 갱신할 스키마 델타 표를 현재 dev 기준(L5 연계 캔버스 6컬럼+`category_permissions`)으로 교체하고 델타 산출법(`git diff … db.py models.py`)을 명시. §5 로그인 확인 절과 §9 backend 기동 실패 트러블슈팅을 신설 — 이번 사고(3.11 SyntaxError)와 fail-closed 오진 경로를 여기서 끊는다.
- `deploy.md` §1은 setup-once 포인터로 축약(코드·매뉴얼이 §1·§2.1을 참조해 번호는 고정), §5에 "로그인 무반응이면 인증보다 backend 생존 먼저" 진단 순서 + 4행 추가. CLAUDE.md Operations 제약표에 런타임 버전 갭 행 추가. backup/db-seed/kb-embedding/docs README·`docker-compose.dev.yml` 주석 상호참조 정리.
- **운영 포트 표기 정정 3333 → 9900 전수**(사용자 확인) — 문서 5종·`.env.example`·`docker-compose.yml` 기본값·nginx 주석·pw 스크립트 주석. 3333은 6월 마이그레이션 이후 어디에도 실재하지 않는 값이었는데 README/CLAUDE.md/spec이 계속 "서버 노출 포트"로 안내하고 있었다. README의 backend 스택 표기도 Python 3.12 → **3.11(배포 이미지 기준)**로 정정 — 이번 기동 불능의 근원이 이 오표기와 같은 계열이다.

## 2026-08-31 — 서버 기동 불능 핫픽스: PEP 695 제네릭 → TypeVar (dev)
- 9910 로그인 무반응의 진범은 인증이 아니라 backend 기동 실패였다 — `graph.py`의 `def _apply_placeholder_paths[NodeT: NodeIn]`(PEP 695, 3.12+)이 배포 런타임 `python:3.11-slim`에서 import SyntaxError → 크래시 루프 → `/api/auth/mode` 무응답 → FE가 fail-closed로 빈 issuer/client_id의 Keycloak 카드를 그려 버튼이 죽은 것처럼 보였다(bb05acbc, 8/29 도입).
- 로컬 venv가 3.12라 pytest 1193·ruff 전부 green이었다 — **런타임 버전 갭이 게이트를 통째로 우회**. `backend/ruff.toml` 신설(`target-version = "py311"`)로 같은 문법을 기존 린트 게이트가 잡도록 고정(Dockerfile 베이스 상향 시 동반 상향).
- 검증: 3.11 venv에 requirements.txt 실설치 후 `import app.main` 성공(188 routes) — 컨테이너 기동과 동등. 수정 전 원본은 동일 조건에서 SyntaxError 재현.

## 2026-08-31 — 매뉴얼 최신화 + 슬라이드 매뉴얼(HTML/PDF) (main)
- md 매뉴얼 6종을 8/25 이후 델타(81커밋)로 최신화 — L5 연계 캔버스 신규 챕터(편집 §11), 복사/원본 대체(retire) 재편, 비교 필드 diff 상태색·버전 선택, 알림 리치 렌더, SP 피크/인라인 펼침/폭 조절/업무체계 필, IO 링크 표식·필수/선택, 인스펙터 소유·승인자/요약 아코디언, 반려 시 체크아웃 복귀, 피커 근접도 정렬, 관리자(Batch jobs·DB 백업 사이드카·휴지통 즉시삭제·연계 권한자·지식기반·AI 프롬프트·BACKUP_* env).
- `docs/manual/slides/` 신설 — 사용자/관리자 × 한/영 4종 PPT형 스탠드얼론 HTML(←/→·클릭 이동, 전환 애니, 목차 점프, 인쇄=1슬라이드 1페이지) + PDF 4종. 실화면 스크린샷 127컷을 로컬 시드(org+compare+inbox+프레임워크 임포트 5종+연계 캔버스 v1.0/외부 L6/플레이스홀더 주입)로 Playwright 캡처(ko/en 각각) 후 내장. md가 원본 — 갱신 시 함께 재생성.

## 2026-08-30 — SP 펼침 UX 7종 (dev)
- 펼친 자식 Tab 순회(자식 엣지 합류+선택 이원 라우팅), 펼침 중 방향키 점프 픽스(비제스처 이동 rootOffsets 역변환 — ySteps 게이트 구간의 무변환 유출이 진범), 포커스 비행 앵커 줌(연속 아웃라인/Tab 이동에도 d3 비행의 일시 줌아웃이 목표 줌으로 눌러앉지 않음), 임베드 자식 GMP 필 읽기전용(span).
- 틴트 영역: 호버 강조(래퍼 pointermove 히트테스트 — 상시 selection 모드라 RF onPaneMouseMove 미바인딩) + 우클릭 메뉴(링크맵 열기=확인 게이트·접기, 겹침은 최상단만). 영역 헤더 개편: 서피스 필+큰 이름+열기 아이콘, 링크맵 업무체계 5단계 전체 경로 라벨(클릭=체계 피크).
- 체계 피크 유예 닫힘 400ms(플라이아웃 6px 갭 이동에도 유지, 재진입 취소 — FrameworkPeekTrigger 전 경로 일괄) + 탐색 버튼을 "다른 체계 검색" 라벨 풋터 행으로 승격. page.tsx의 리터럴 NUL 바이트 2개(\u0000 이스케이프화 — git 바이너리 취급 해소). pw-verify-sp-ux7 31체크 ALL PASS·tsc/lint/vitest 807 그린.

## 2026-08-30 — 드래그 Y 연속화 + SP 미리보기 피크 (dev)
- height-shift(노드정보 노출) 중 드래그가 밴드 갭에서 스톨→점프하던 것을 제스처 오프셋 동결(선형 항등 왕복)로 연속화 — 드롭 확정만 계단 역변환이라 저장 좌표 의미 불변(실측 스텝점프 23.8px·드리프트 5.6px·저장=표시 일치).
- 라이브러리/L5 트리 피커 행 클릭·2.5s 호버 → SP 미리보기 피크(창 비례 40vw/32vh): 게시본 그래프(ScopePreview에 캔버스 타입색 적용 — 조상 창·요약 모달도 통일) + 우측 탭(노드/상세). 노드 탭=실노드 미러 목업(전체 파라미터: 속성·파라미터 칩·GMP 배지·조건·IO 체크리스트 박스, L5 캔버스의 타 L5 출신은 홈 L5 색+출처 배지 선반영), 호버=현재 맵 표시 기준 스왑, 클릭=추가/해당 맵 이동(openMapPrompt 확인 게이트). 상세 탭=속성3+SP 파라미터5+조건·IO·GMP+메타(게시 버전 v마커·게시 시각·업무체계 전체 레벨), 빈 값은 톤다운 대시. viewer 미만은 잠금 안내+추가 가능(메타 조회 생략), 미등록은 기존 등록 확인 체인.
- BE: 라이브러리 목록에 SP 파라미터 4종(touch_time·cost_krw·cost_usd·headcount) 동봉(미지정 마스킹 동일·테스트 확장). 검증 스크립트 pw-verify-drag-continuity·pw-verify-sp-peek(5시나리오) 커밋 — pytest 1193·vitest 807·tsc/lint 그린.

## 2026-08-30 — 탐색 모달 이동 확인 게이트 (dev)
- 탐색 모달의 이동 3지점(맵 행·L5 연계 아이콘·검색 맵 결과)을 F6 "링크맵 열기"(openMapPrompt)와 동일 문구·아이콘의 ConfirmDialog 게이트로 전환 — 확인 시에만 에디터 이탈, Esc/Cancel은 최상위(확인)만 닫고 탐색 모달·피크 유지. E2E 6/6.

## 2026-08-30 — 탐색 모달 = 추가 창(피크 유지) + 검색 (dev)
- 사용자 정정 반영: 탐색 모달은 피크를 대체하지 않고 위에 추가로 뜬다 — 바깥닫기/마우스리브 억제 + **포털 자식 클릭이 React 트리로 트리거 onClick까지 버블돼 토글이 피크를 닫던 버그**를 DOM 포함 가드로 픽스(포털 버블 랜드마인 재발 사례).
- 탐색 모달 검색: BE `GET /api/categories/search`(ilike 카테고리+맵, 가시성 마스킹, 경로 동봉 — /nodes보다 앞 등록) + FE 디바운스 300ms, 카테고리 결과 클릭=해당 경로 펼침 합류(expandTo)·맵 결과 클릭=이동. E2E 5/5.

## 2026-08-30 — 피크→체계 탐색 모달 (dev)
- 드릴인 피크 헤더에 탐색 버튼(FolderTree) → FrameworkBrowseModal: framework-tree-state 엔진 재사용, 체인 openIds 시드로 현재 경로 펼침·형제 브랜치 아코디언·맵/연계 클릭 이동(현재 링크맵 하이라이트). E2E 5/5.

## 2026-08-30 — 외부 L6 출처 배지 클릭 드릴인 (dev)
- FrameworkPeekTrigger로 피크 범용화(필=아이콘+3초 호버/클릭, 배지=클릭 전용) — 캔버스 외부 L6의 출처 배지 클릭 시 출신 L5 드릴인 피크(FrameworkChip 재활용). spOriginCategoryId 주입(spAttrs). E2E 2/2.

## 2026-08-30 — 비-L5 이양 차단 배너 재디자인 (dev)
- 앰버 텍스트 한 줄 → TriangleAlert+틴트 박스(볼드 제목/설명 2단, Title/Desc 키 분리)로 시인성 강화.

## 2026-08-30 — 그립-핸들 이격·배정/이양 모달 L5 반영 (dev)
- 그립 이격(사용자 정정 반영): 수평 이동 대신 경계 위(right-0) 유지 + 시작 높이 top-7(28px)로 낮춰 출력 핸들(anchorTop 18, 12.5~23.5px) 아래부터 — 세로 비중첩 실증(E2E 5/5). 배정 모달: L5만 선택·시딩(레거시 비-L5 지정은 미시딩)·비-L5 말단 muted, 이양 섹션은 currentLevel!==5면 재배정 유도 문구로 대체(서버 409 미러). PickLeafHint 문구 L5로 갱신.

## 2026-08-30 — 후속 6종: 필 개선·폭 영속·rejected 점유·L5 전용 슬롯·그립 UX (dev)
- ①필: 배경 제거·첫줄 정렬(self-start)·호버 배경만·클릭 즉시 피크(3초 호버 유지). ②nodes.width 컬럼(_ADDED_COLUMNS·ge100 le400)로 폭 영속 — 드래그 중 로컬, 확정 시 onResizeNode→autosave, 리로드 유지 E2E. ③반려 시 점유를 제출자에게 복귀(빈 점유를 먼저 연 editor+/관리자가 자동 점유로 편집권 가져가는 구멍 픽스, 테스트 동반 — withdraw 경로는 동일 갭 후속 검토). ④맵 슬롯 L5 전용 확정: 배정 422·이양 시 레거시 비-L5 슬롯 409·칩/피커/홈트리 상위 레벨 맵 목록 미노출(아코디언만). ⑤⑥그립: 노드 호버 시 표시·전체 높이·호버 액센트. E2E 9/9.

## 2026-08-30 — SP 업무체계 필+피크·SP 노드 폭 조절 (dev)
- 일반 맵 SP 노드: 링크맵이 프레임워크 소속이면 이름 옆 FolderTree 필, 3초 호버 시 FrameworkChip 재사용 팝오버(defaultOpen 드릴인·floating=false 스킨 분리, 포털 고정 좌표). E2E 7/7.
- SP 노드 자체 폭 조절(요약 모달 리사이즈는 사용자 정정으로 원복): 우측 하단 그립 드래그 180=최소→120%(216) 클램프, zoom 보정(드래그 시작 시 스토어 read — 전 노드 zoom 구독 금지), 표시 전용(저장 없음)·편집 표면 한정(isConnectable 게이트). E2E 6/6.

## 2026-08-30 — L5 캔버스 개선 5종 배치 (dev)
- ①이양 후계자: process_maps.retired_to_map_id(copy retire 기록)·refs 체인추적 successor 동봉·스테일 배너=Replace CTA→다이얼로그 추천 카드(직결). ②undesignated 바디를 플레이스홀더 점선 에러 룩으로 통일(코너 삼각 배지 제거·잠금 억제). ③변경 요약을 접힘 1줄(카운트 필)→펼침로, change-summary-section으로 추출해 일반 맵 승인 탭(승인자 아래)에도 게시본 기준 요약 추가 — 라이브 계보를 rootGraph에서 주입해 게시본 열람 시 전량 삭제+추가 오탐 픽스. ④트리 피커 드래그에 카테고리 동봉→낙관 참조로 드롭·연결 즉시 외부 L6 스타일. ⑤COLOR_PRESETS lib 승격 + 비교 화면에 외부 C안·플레이스홀더 스타일 재현(full-graph 출처 경로 주입 포함). E2E 12/12.

## 2026-08-29 — 플레이스홀더 수동 연결 UX (dev)
- 배너 CTA→연결 다이얼로그: 출처 L5 후보 우선(유사도 랭킹 lib/framework-connect·정확 일치 배지)·트리 드릴로 타 L5 탐색·이미 캔버스 맵 비활성. 안내 밖 L5 선택 시 경로 비교 확인 모달 게이트(사용자 요구). 연결 시 출처 소거+follow_latest, E2E 8/8. (2026-09-06 트랙 F에서 유사도 랭킹 목록을 체계 트리+미리보기 플라이아웃으로 교체 — 확인 게이트·연결 규칙은 유지)

## 2026-08-29 — 플레이스홀더 그릇 준비 (dev)
- nodes.placeholder_category_id(_ADDED_COLUMNS 등록·미지 카테고리 422)·연계 캔버스 검증 완화(linked 필수 해제)·응답 경로 주입·clone/시그니처 포함·에디터 왕복+에러톤 출처 배지 — 임포트 착지 지점 완성 (§10.1). CSV/AI 병합은 ...existing 스프레드가 보존이라 무변경.

## 2026-08-29 — 외부 L6 C안·플레이스홀더 에러레드 (dev)
- 연계 캔버스 외부 L6 = 뉴트럴 바디+좌측 5px 홈 L5 컬러 탭+틴트 배지·아이콘(시안 4종 중 사용자 선정 C안 — 기존 18% 파스텔은 홈과 구분 약함).
- 플레이스홀더(linked_map_id 빈 SP) = 점선 에러레드 바디+동톤 배너. 개념 확정(§10.1): 임포트가 타 L5 소속 L6를 자리로 파두고 후차 연결 — 출처 L5 컬럼·검증 완화는 임포트 트랙으로 분리.
- compare가 linkedMapId 미전달로 모든 SP에 "링크 미지정" 배너 오표시하던 기존 버그 동봉 픽스. 명시 null만 강스타일 적용(미전달 표면 가드).

## 2026-08-29 — 메이저 체크박스 커스텀 통일 (dev)
- 네이티브 체크박스를 앱 언어로 교체 — appearance-none rounded-sm(hairline→checked:accent) + peer-checked Lucide Check(text-on-accent).

## 2026-08-29 — 타임라인 더보기 최상위 기준 (dev)
- 3개 클램프를 최상위 아이템(그룹=1) 기준으로 산정하고, 펼친 그룹의 하위 멤버는 슬라이스 무관 전부 노출(2단계: topItems slice → open 그룹 평면 전개).

## 2026-08-29 — 토글 체크 리빌 + 그룹 라벨/들여쓰기 (dev)
- 유지/삭제 요약은 평소 숨기고 체크 시 grid-rows 아코디언으로 리빌(체크 행위가 읽기 유도). 그룹 헤더 라벨 vX.x → "버전 N"(i18n home.verMajorGroup), 펼친 멤버 카드는 ml-7 들여쓰기로 하위 표시.

## 2026-08-29 — 메이저 토글 구체 필 + 버전 메이저 그룹핑 (dev)
- 토글 아래 산문 설명이 안 읽힌다는 피드백 → 실제 유지/영구삭제 라벨 필 행(MajorImpactRows, 토글 compact·모달 배너 공용)으로 교체, 최초 확정만 짧은 문구(majorDescFirst). 버전 타임라인에 groupByMajor(framework 맵 한정) — vX.Y 연속 구간을 마이너 2개↑일 때 그룹 헤더(Layers·개수·최신 필·최신시각)로 접고 클릭 시 멤버 카드 평면 삽입(최신 메이저가 앞), 카드 강조는 idx→newestId 기준으로 교정.

## 2026-08-29 — 인스펙터 확정 섹션 안내 시인성 (dev)
- 확정 섹션 4곳을 모달과 같은 필 언어로 통일 — 최신 확정 캡션(Workflow 아이콘+초록/muted 필)·메이저 토글 목표 버전 필·무변경 안내(Info+버전 필)·변경 요약 헤더(GitCompare+기준 필)와 엣지 증감(Spline+색상별 +N/-N/~N 필). i18n 5키 재편(latestLabel/notConfirmedShort/noChangesAfter/changesTitle/edgesLabel).

## 2026-08-29 — 메이저 승급 모달 시인성 (dev)
- 안내문구를 ConfirmDialog 리치 폼으로 재구성 — 유지(Archive+초록 필)/영구 삭제(Trash2+빨강 취소선 필, 없으면 None 필) 행 + 비가역 경고 라인(TriangleAlert). 최초 확정(스냅샷 없음)은 배너 생략. i18n majorModalPrune/NoPrune → Keep/Delete/None/Irreversible 4키로 분해.

## 2026-08-28 — L5 캔버스 개선 7종 (feature/l5-canvas-refinements)
- 사용자 피드백 반영: 소속 L6 삭제 금지(onBeforeDelete 필터+서버 422)·외부 L6=홈 L5별 색(SubprocessRefOut.category_id, subprocess 단일색 규칙에 외부 예외)·분기/끝 노드 허용(끝 규칙 포함)·좌상단 체크리스트→L5 탐색기(전 레벨 트리·내 위치·타 L5 열기/생성)·우상단 칩→"L5 map" 태그·메이저 승급 토글 행+영구삭제 안내 모달(직전 라인 X.0·최종만 유지 프룬, FrameworkConfirmOut.pruned_labels)·확정 게이트(레이아웃 외 변경 없으면 409/버튼 비활성, FIELD_MSG lib 승격+computeVersionDiff·엣지 시그니처로 변경 요약 노출). 게이트: pytest 1189·vitest 803·tsc/lint/ruff 그린·스모크 12/12·기능 검증 11/11.

## 2026-08-28 — Framework L5 연계 캔버스 구현 (feature/framework-l5-canvas)
- 스펙 전체 구현 완료: BE(모델 4컬럼+category_permissions·역할 파생 mode 분기·멱등 linkage-map 시드/자동 보강·framework-confirm maj.min·subprocess-only 검증·가드 4종·표면 3종) + FE(트리 L5 버튼·에디터 모드 플러밍·Confirm 섹션·트리 피커·출신 배지·권한자 모달·홈 제외). 게이트: pytest 1186·vitest 795·tsc/lint/ruff 그린·실브라우저 스모크 10/10(`pw-smoke-framework-canvas.mjs`).

## 2026-08-28 — 비교화면 버전 선택 명확화 + 필드 diff 상태색 (feature/compare-ux)
- 상단 BASE/TARGET가 어느 쪽 기준인지 안 읽히는 피드백 → 역할 캡션을 언어설정 따르는 "기준 (변경 전)/대상 (변경 후)"로 교체하고, native select을 커스텀 드롭다운으로 바꿔 행에 상태 필+변경일(`VersionOut.updated_at` 신규 노출, 모델엔 기존 존재) 표시. 반대편 선택 버전 행은 역할 태그+클릭 스왑(동일 쌍 차단). 변경 사항 패널 제목 아래 "base → target" 방향 캡션 상시 노출. 게이트: pytest 1179·vitest 802·tsc/lint/ruff 그린 + 실브라우저 캡처.
- 필드 diff를 파라미터 단위 상태색으로 세분화(생성=초록·삭제=빨강+취소선·변경=노랑 배경+바뀐 부분만 취소선/굵게 — `lib/compare-field-diff` 공통 접두·접미 절단) — 변경 목록 행·캔버스 DiffFieldPills 공용(`components/compare-field-diff.tsx`). 잘린 긴 값(설명 등)은 호버 시 전체 내용 팝오버(clampToViewport, overflow 실측 판정). vitest 8건 추가(802).

## 2026-08-28 — Framework L5 연계 캔버스 설계 스펙 (main)
- L5 "상세보기" 캔버스(소속 L6=subprocess 노드 전원 배치·타 L5의 L6 가져오기·Start/End 없음) 브레인스토밍 확정: 실맵 `mode="framework"`+`ProcessCategory.linkage_map_id` 1:1(L6 목록 오염 차단), 카테고리 레벨별 권한자 신설(하향 상속·캔버스 한정), 라이브 편집+본인 확정 스냅샷(minor/major), 열 때 자동 보강. 스펙: `docs/superpowers/specs/2026-08-28-framework-l5-linkage-canvas-design.md` · 구현 플랜: `2026-08-28-framework-l5-linkage-canvas.md`(폐기 — git history) (16태스크).

## 2026-08-27 — 인스펙터 UX 3종: 요약 아코디언·소유/승인자 섹션·SP 카드 Linked from (main)
- 속성 빈상태 개편: ① 맵 요약을 아코디언화(기본 접힘 — 접힘 헤더 우측 아이콘+숫자 3쌍이 요약을 대신, 영속 없음) ② 그 위에 소유·승인자 섹션 신설(`map-ownership-section.tsx`, 맵 탭 협업자 섹션과 같은 details 박스 — 오우닝 부서 리프·오너/승인자 UserPill, 표시 전용). ③ SP 지정 카드에 Linked from(역참조) 하위 아코디언 — page.tsx `spUsage`를 prop으로 공유(카드별 재조회 없음)해 3개 탭 마운트 일괄 적용, designated일 때만·기본 접힘·영속 없음(카드 접으면 리셋). 소유·승인자는 언어설정 우선노출+폴백 — 이름은 approval-panel resolve 규칙(ko=korean_name∥영문), 부서는 formatDeptName+buildKoreanDeptByPath(모듈 캐시로 세션당 1회 fetch — 빈상태가 선택 변경마다 리마운트되는 것 대응). tsc/lint/vitest 794 + 실브라우저 스크린샷 7장(ko/en 언어 전환 포함, 콘솔 에러 0) 검증.

## 2026-08-27 — 캔버스 노드 IO 링크 행 호버 하이라이트 (main)
- 인스펙터 IO 링크 항 호버의 상대 노드·경로 엣지 하이라이트를 노드 내 IO 행에서도 동일 점등 — 계산을 `computeIoLinkHighlight`(io-items.ts 단일 소스)로 추출해 두 표면 공용, 캔버스 쪽은 NodeActions 컨텍스트 `onHoverIoLink`(ref 미러 stable 콜백)로 배선. 링크 행(`linkState!=="plain"`)에만 이벤트를 달아 plain 행 hover는 상태 무변동. 단위테스트 3건+실브라우저 스크린샷(미러→원본·원본→미러·소등) 검증.

## 2026-08-27 — 배치 작업 상태 표시: 설정 > Batch jobs 탭 (dev)
- 백업·인원(HR)동기화의 최근 시도 시각·성공/실패를 설정 Database 카테고리 새 탭(sysadmin)에서 표시. 새 테이블 `batch_job_runs`는 (job, outcome) 복합 PK upsert라 "최신 성공·실패만 보전"이 스키마로 강제 — 정리 배치 불필요. HR은 `run_full_sync`(가드 중단·예외=failure, 스로틀은 미기록), 백업은 사이드카가 psql로 기록(CREATE IF NOT EXISTS 가드 — 모델과 스키마 계약, 변경 시 양쪽 동기화). pytest 5건+docker e2e+실브라우저 스크린샷 검증.

## 2026-08-27 — DB 자동 백업(db-backup 사이드카) + 복구 런북 (main)
- 운영 안정성 요구로 일간 배치 백업 도입. compose 사이드카(postgres:16-alpine 재사용, 04:00 KST + 기동 베이스라인, `pg_restore --list` 검증 통과 시에만 확정, 14일 보존)로 결정 — 호스트 crontab은 git 밖 설정이라, 앱 내 스케줄러는 앱 장애와 결합이라 배제. 로컬 Docker로 덤프→검증→보존정리→복원→실패경로 e2e 실측.
- 1단계는 서버 디스크만(사용자 결정) — 디스크 장애 무방비 한계·오프서버 확장 경로·`.env` 수동 사본 필요를 `docs/deploy/backup.md`에 기록.

## 2026-08-27 — IO 단일 항목은 헤더 없이 행 하나로 (main)
- 항목이 1개뿐인 IO 박스는 헤더(펼침 토글·카운트)가 과함 — 헤더를 생략하고 행이 박스를 직접 채운다. side 구분은 체크박스 자리가 담당: 휴식 시 인풋/아웃풋 아이콘 상시(헤더 대체), 호버·체크 시 체크박스(일반 행과 동일 — 첫 구현의 호버=아이콘은 반대라 정정). 접힘 상태는 단일 모드에서 무시(헤더가 없어 다시 펼 수 없음). 2개 이상은 기존 목록 그대로. 상태별 실브라우저 스크린샷 검증.

## 2026-08-27 — 가시성 동봉 드롭다운 세로 줄바꿈 픽스 (main)
- ko에서 승인 요청 모달의 공개 범위 드롭다운을 열면 '비공개'가 Current 필에 밀려 한 글자씩 세로로 꺾이던 것 — 옵션 행 nowrap+필 shrink-0, 메뉴 w-max(트리거보다 옵션이 넓을 때 콘텐츠 폭). 셀프게시 팝오버·설정 게시 패널 공용 컴포넌트라 세 표면 동시 해결. before/after 실측.

## 2026-08-27 — IO 항 분리: 대시 폐기 → 행간 (main)
- 체크박스 자리 상시 대시는 지저분하다는 피드백으로 즉시 폐기(같은 날 롤백). 대신 행간 `space-y-[3px]`로 항 분리 — 2줄 클램프 항목이 덩어리로 구분. 3.5줄 캡은 새 스트라이드(18+3px) 기준 max-h 63→72px 재조정. 호버 체크박스·체크 유지 동작은 원래대로.

## 2026-08-27 — 캔버스 IO 링크 표식·필수/선택 호버 색 (main)
- NodeIoDetails 행에 링크 상태 표식 — 원본(output_ids)·미러(input_links/output_links) 공통 Link2 액센트 아이콘+방향 툴팁, 독립(plain) 항은 없음. SP 노드는 로컬 링크 필드가 없어 제외(체크 키 규칙과 동일). 인풋 행 호버 색으로 필수/선택 구분 — 필수=`bg-error/10` 로즈·선택=중립 surface-alt(+기존 뮤트 텍스트), 행 title 툴팁(Required/Optional input) 동반.

## 2026-08-26 — 피커 조직 근접도 정렬 (main)
- 협업자 피커(새 맵 모달·설정 협업자 추가)와 담당자 지정 피커(인스펙터·편집 모달)의 기본(무검색) 순서를 이름순 → 내 조직 근접도 순으로: `lib/org-proximity`(다리 수 0~3=3다리 내 우선, 4=밖, 5=org 빈 사람 최후순위, 버킷 내 이름순). 검색은 로직 그대로 — PrincipalPicker·SearchSelect 모두 filterByQuery 랭킹이라 입력 순서와 무관. eligible-assignees 응답엔 org_path가 없어 디렉터리 스토어(fetch-on-use 캐시)로 보강. 승인자 피커는 기존 순서 유지.
- 검증: 유닛 5케이스 + 실브라우저(협업자 피커 상단 8명 전원 내 파트, 검색 랭킹 유지). 담당자 플라이아웃(addMode) 자동화는 헤드리스에서 안 열려 스샷 미확보 — 동일 정렬 함수·배선이라 로직 동일, 수동 1회 확인 권장.

## 2026-08-26 — 알림 상세 행위자 유저 필 (main)
- 상세 문장의 {actor} 자리를 파츠 분할(`formatNotificationBodyParts`, 센티널 ⟬actor⟭)해 필로 렌더. 카드가 UserHoverCard(간이)가 아니라 **PersonHoverCard**(인물 카드 — 직급 필·메신저·말단 부서+조직 경로 아코디언, ko는 한글명 우선) 재사용으로 확정. 필은 surface+헤어라인·caption 크기 — 상세 패널(surface-alt) 위에서 bg-surface-alt 필이 묻히는 시인성 픽스. 버전·이름·인용의 따옴표 표기도 일괄 칩 처리 — 센티널을 RichVar 6종(actor/version/from/to/copy/snippet)으로 확장, 템플릿이 감싸던 따옴표는 파츠 빌드 시 제거(버전 칩은 v번호 뱃지 동반), 플레인 텍스트 표면(벨/카드/검색)은 따옴표 유지. 후속: 칩=카드 어포던스로 통일 — 버전 칩은 인터랙티브(0.7s 호버/클릭 → 버전 카드: 상태·생성 KST·`?version=` 딥링크 이동, getMap lazy 1회·missing 폴백), 카드가 애매한 이름류(from/to/copy)는 볼드 텍스트, 인용은 이탤릭 “…” — 칩 모양은 카드 열리는 것에만. 행위자 필 이름은 언어선택 병기(ko 한글(영어)/en 영어(한글), 한글명 없으면 영문 단독), 버전 칩·카드는 라벨 앞 톤다운 v번호. 행위자 없는 유형·레거시는 1파츠 유지. ⚠️ Edit 도구 \uXXXX가 리터럴 NUL로 박히는 함정 재발 — 파이썬 바이트 치환으로 교정.

## 2026-08-26 — 알림 리치 렌더·전수 컨텍스트 보강 (main)
- 26개 생성 지점 전수: `notifications.payload`(JSON, `_ADDED_COLUMNS` 자동 ALTER)에 맵 이름·버전 라벨/번호·행위자·사유 등 구조화 동봉, 영어 `message`도 맵 이름 포함으로 보강(레거시 표시·폴백 겸용). `workflow.get_map_name` 헬퍼.
- FE `lib/notification-format.ts` — type+payload를 언어 토글에 맞는 {유형 칩·제목(맵 이름)·상세 문장}으로 렌더(en/ko 템플릿 26유형+기계 사유 코드 번역, 자유 텍스트 사유·공지 제목은 원문). payload 없는 레거시/미지 유형은 message 원문 폴백. 벨 드롭다운 2줄 리디자인(w-96·아이콘·시각)·받은함 카드/상세(유형 칩+절대 KST) 적용, 검색은 렌더 텍스트 포함.
- 검증: BE pytest 1173(payload 계약 테스트 추가)·FE vitest 782(포매터 7케이스) / 실브라우저 — 실워크플로(submit→approve→publish·reject)로 알림 생성 후 ko/en 벨·받은함·레거시 폴백·반려 사유 스샷 확인, 콘솔 에러 0.

## 2026-08-26 — retire 시 원본 협업자·승인자 이어받기 (main)
- 휴지통 체크 시 원본 `listMapPermissions`+`listApprovers`를 협업자 → 승인자 순으로 스테이징(제출 체인 grant→PUT 순서와 일치). 본인 행·오우닝 파생 부서 제외, 타인 owner 행은 editor 강등, 접근 없는 승인자는 viewer 보강(private 복사본 결재 보장). 해제 시 자동분만 제거(수동 추가 보존, autoLeaderRef 패턴). 요약박스 4번째 라인 안내. 스모크 25체크 + 새 맵 DB 권한/승인자 실측 대조. 참고: sqlite 로컬 한정 영구삭제 후 map_permissions 고아 잔존(FK CASCADE 미강제 — postgres는 DDL cascade로 정상).

## 2026-08-25 — 복사 모달 retire 섹션 시인성 리디자인 (main)
- 휴지통 체크를 선택 카드로(체크 시 앰버 `border-changed/40 bg-changed/10`+Trash2 아이콘) + 체크 시 ConfirmDialog lines 어법의 아이콘 요약박스 3줄(태그 rename·7일 보관·알림). SP 경고는 앰버 박스가 아코디언·확인 체크까지 감싸고 확인 문구는 caption-strong으로 상향.

## 2026-08-25 — 복사 워크플로 재편 (main)
- 게이트: 게시(published/expired) 이력 1회 이상인 맵만 복사(FE 버튼 비활성+툴팁, BE 409 — status 판정: pre-ALTER 게시본은 version_number NULL 가능). Word 승격(convert)은 기존 승인본 기준 예외. 기본 원본 버전도 approved→published로 상향.
- 복사 모달을 CreateMapDialog `copy` 모드로 통합(전용 CopyMapDialog 폐기) — 버전 선택+비게시 안내·오너 잠금 행·오우닝 프리필·공개범위(BE `MapCopy.visibility`)·협업자/승인자는 기존 스테이징 체인 재사용.
- 알림: 복사 시 원본 오너 `map_copied`(행위자 제외). 오너 전용 `retire_source` — 원본 "(Pending deletion)" rename(중복 카운터·200자 절단)+휴지통행, 승인자·editor+ `map_retired`, 새 맵은 원본 이름 유지(모달에서 이름 고정). SP 지정 맵은 사용처 아코디언+확인 체크 필수(FE 게이트).
- 검증: BE pytest 1164(신규 test_map_copy_workflow 9)·ruff / FE tsc·lint·vitest 767 / pw-smoke-copy-purge 23체크 실브라우저(retire 실집행→알림 sqlite 실측→휴지통 즉시삭제까지).

## 2026-08-25 — 휴지통 즉시 영구삭제 (sysadmin, main)
- `DELETE /maps/{id}/permanent` — sysadmin 전용(403)·휴지통 상태만(활성 맵 409), KB 청크 소거 포함 기존 lazy purge 로직 재사용. 설정 휴지통 행에 sysadmin 한정 Delete now 버튼+danger 확인 모달. 7일 보존은 기본 유지 — 즉시삭제는 명시적 관리자 액션만.

## 2026-08-25 — 맵 복사 버전 선택 + 드래프트 열기 (main)
- 복사 모달을 이름 전용 PromptDialog에서 전용 CopyMapDialog로 — 원본 버전 드롭다운(전체 버전, 기본=최신 승인본, 승인 여부 무관 `MapCopy.version_id`), 성공 시 카드 쉬머 대신 새 맵 에디터로 직행(게시본 없는 새 맵은 versions[0]=드래프트가 기본 오픈). 카드 복사 버튼 게이트도 승인본 보유 → 버전 보유로 완화. 검증: pytest 버전 선택/기본/타맵 404 + pw-smoke-copy-purge 실브라우저(드래프트 선택 복사 → DB 계보 m*v6 실측).

## 2026-08-25 — 맵 복사 500 픽스 (main)
- 운영 서버 복사 500 원인: 자동 ALTER로 추가된 `doc_sections`(DDL DEFAULT 없음)가 pre-ALTER 행에서 NULL → `copy_map`의 `list(None)` TypeError. `or []` 소거 + 서버 상태(컬럼 드롭→nullable 재추가)를 재현한 회귀 테스트. 같은 함정의 직렬화 계층은 `schemas._coerce_doc_sections`가 이미 방어 — 라우터만 누락이었다.

## 2026-08-25 — 릴리스 문서 최신화 (main)
- 매뉴얼 6종을 현재 main 기준으로 갱신 — 편집: GMP 분류·IO 불러오기(Linked/Disconnect)·간격 자동 조정+엣지 우회·몸체 드롭 빠른 연결·start/end 타입 필·Framework 칩·PNG 정보 카드·Map 탭 비교 버튼 / 사용 안내: LDAP 로그인 화면·비교 화면 개편(요약 탭·엣지 라벨 diff·선모양·임시 드래그) / 관리자: 로컬 계정 절 신설(설정→조직, ldap 전용)+`AUTH_JWT_SECRET`/`AUTH_JWT_TTL_HOURS` 레퍼런스.
- 릴리스 공지 8월 3차 초안 `docs/notices/2026-08-25-release.md` — 872a953b(운영 배포) 이후 변경분 대상.

## 2026-08-25 — dev → main 릴리스 머지
- 8/19(shimmer) 이후 dev 전체(144 커밋)를 main에 반영 — LDAP 인증 폴백+로컬 계정 · 인터뷰 필드 승격(touch_time 7번째 파라미터·노드 IO/조건/data_form·활동별 GMP) · 인스펙터/편집 모달 재설계(아코디언·레이지 세이브·데이터 폼 피커·비용 통화 토글) · 노드 IO 연결(불러오기) · height-shift 노드 간격 자동 재조정+엣지 우회 · 비교화면 리프레시(세션 드래그·요약 탭·최신화)+start/end 노드 · 에디터 프레임워크 트리 칩 · PNG 내보내기 정보 카드 · SP 상태 배너/노드 카드 UX · React 19.2 useEffectEvent. 상세는 아래 항목들.
- **배포 시 필요**: ① `.env`에 인증 3키 추가(`AUTH_MODE`·`AUTH_JWT_SECRET`·`AUTH_JWT_TTL_HOURS`) — keycloak 유지면 `AUTH_MODE` 공란으로 무회귀, ldap 전환 시 `AUTH_JWT_SECRET` 필수. frontend `NEXT_PUBLIC_KEYCLOAK_*` 빌드 args는 폐기(런타임 `GET /api/auth/mode` 조회)라 compose에서 제거된 상태. ② 스키마는 자동 ALTER(`nodes` 승격/IO 링크/gmp 계열·`process_maps` sp_* 계열, `db.py _ADDED_COLUMNS`) — 리셋 불가. ③ **FE/BE 동시 배포 필수** — 구 FE의 graph PUT이 승격 필드를 소거한다(`docs/deploy/db-migration-9910.md` §8).
- 게이트(머지 후 main 기준): BE pytest 1150 passed·ruff 0 / FE vitest 767 passed(55 files)·tsc 0·lint 0·build OK.
- 정리 완료(08-26): 원격 `feat/io-linking`·`feat/node-spacing`(main 완전 병합·열린 PR 없음)을 로컬에서 삭제 — 원격 실행 환경의 ref 삭제 403은 로컬 push로 우회. 원격은 dev·main만 유지.

## 2026-08-25 — SP GMP 필 숨김·우측 핸들 dot 정렬 (dev)
- 미분류 GMP 호버 필은 수정 가능할 때만(SP는 링크 맵 상속 read-only·읽기전용 모드 제외) — 클릭 유도만 되던 필 제거. SP 단일 끝 핸들 dot이 50% 중앙에 남아 엣지 앵커(라벨 라인)와 어긋나던 것 — 단일 끝은 18px 앵커, 다중 끝만 분산 유지.

## 2026-08-25 — 프레임워크 플라이아웃 이동 게이트 (dev)
- 맵 탭 버전 필 우측 액션 클러스터 최좌측에 버전 비교 아이콘 버튼(GitCompare) — 하단 CTA와 동일 게이트(게시본 없으면 비활성+안내 툴팁).
- IO 박스 헤더(3노드 타입 공통 NodeIoDetails)에 행과 같은 호버 하이라이트(enabled 한정 bg-surface-alt+글자 진하게) 추가.
- 우측 프레임워크 칩 플라이아웃의 맵 이동에 F6 "링크맵 열기"와 동일한 미저장 경고 확인 모달(openMapPrompt) 재사용 — FrameworkChip onNavigate 게이트 prop, 미제공 시 직접 이동 폴백.

## 2026-08-25 — SP 상태 배너 4종 완성 (dev)
- 배너 체인: 업데이트 가능(액센트) > 지정 해제(에러 톤, 코너 뱃지와 동조) > 플레이스홀더 링크 미지정(앰버 changed 톤 — 해제와 강도 구분) > 버전 고정(중립 박스) > 최신본 추종(박스 없는 semibold 글자 한 줄 — 초록·중립박스안 거쳐 확정, 색=조치 필요 상태만). follow_latest는 전 노드 공통 불리언이라 실링크+지정 유효 게이트, 실렌더 스크린샷 검증.

## 2026-08-25 — 분기 액션 바(바로가기 버튼) 겹침 픽스 (dev)
- 가려지던 건 배지가 아니라 선택 시 노드 하단의 액션 바(링크 버튼) — 분기 하단 확장 블록(파라미터/조건/IO)과 같은 공간이었다. 배지는 원위치(bottom-0) 복귀, 액션 바가 확장 블록(data-id=node-below-extension) 높이를 실측(offsetHeight=줌 무관 레이아웃값, 초기 layout effect+이후 ResizeObserver)해 그 아래로 내려간다.

## 2026-08-25 — 몸체 드롭 빠른 연결 (dev)
- 엣지 드래그를 핸들이 아닌 노드 몸체 위에서 놓으면 기본 핸들로 즉시 연결(정방향=왼쪽 타깃·SP는 in 핸들, 역방향=오른쪽 소스·SP 소스는 제외). 드래그 중 몸체 위에선 커스텀 connectionLine(QuickConnectLine)이 기본 핸들에 스냅된 미리보기를 그려 핸들 포착과 동일한 느낌 — 판정 헬퍼(canQuickConnect)를 미리보기·드롭이 공유해 결과 일치. 기존 onConnect 플로우(디시전 분기 모달·출력 충돌 모달·회귀 차단·터미널 규칙) 그대로 재사용.

## 2026-08-25 — 노드 카드 후속 2건 (dev)
- 분기 조건/IO 박스는 노드 밖 상시 노출이 산만 — 선택(활성) 시에만 렌더(속성/지표 줄은 유지). 미분류(Unclassified) GMP 필은 공간 미차지 기본 숨김 — 노드 호버 시 좌상단 부유로만(분류 진입점 유지, 위치 override는 미분류에선 무시).

## 2026-08-25 — 노드 카드 UX 일괄 7건 (dev)
- IO 목록: 호버 휠은 캔버스 팬 대신 목록 스크롤(nowheel+overflow-y-auto, capped 한정)·미선택 노드 헤더 클릭은 토글 없이 선택만(선택 후 클릭부터 접힘/열림)·분기(decision)도 속성/지표/조건/IO를 마름모 아래 절대배치로 동일 수준 노출(IO 박스 framed 보더 강조).
- URL: 노드 내 라벨 줄 삭제(좌하 배지+액션 바가 전부), 링크 버튼은 등록 시 무조건 노출·뷰어 패널도 무조건 오픈 — 단 iframe 로드·새탭 열기는 기존 안전 판정 유지(비안전 URL은 즉시 폴백 카드, http(s) 외 스킴은 새탭 버튼 숨김).
- start/end 선택 링 rounded-full→rounded-[19px](키 큰 노드에서 링이 노드 뒤로 숨던 회귀)·SP 핸들 라벨 라인 18px 앵커(+justify-start, 다중 끝 핸들은 분산 유지)·모든 노드 더블클릭 시 인스펙터 속성 탭 자동 전환(논스 신호). pw-smoke-io-links 26/26.

## 2026-08-25 — height-shift 펼침 중 적용 + 드래그 지터 픽스 (dev)
- 인라인 펼침 중 height-shift 전면 비활성(spec §7 게이트)이던 것을 합성 **입력**에 Y 오프셋을 베이크하는 방식으로 적용 — childTop·regions bbox·rootOffsets(표시−저장)가 자동 일관, 역변환은 상시 스텝(heightStepsRef)으로 toSavedPoint·finalizeRootDrag Y를 통일(드롭 위치 기준 — 시작 오프셋 빼기의 밴드 교차 오차 제거). 표시단은 펼침 중 renderYOffsets 이중적용 게이트.
- 커진 노드(앵커) 드래그 시 마우스·원위치 사이를 튀는 지터 — 자기 밴드가 매 프레임 따라 움직여 표시/역변환이 서로 쫓던 것. 드래그 시작 시 스텝 동결(dragFrozenSteps), 드롭 시 해제(트윈 복귀). pw-smoke-height-shift 12/12(펼침 상태 드래그 라운드트립 포함).

## 2026-08-25 — 에디터 프레임워크 트리 칩 (dev)
- 프레임워크 등록 맵이면 에디터 캔버스 우상단에 체인 트리 칩(FrameworkChip) — 좌상단 저장 체크리스트 칩 디자인 재활용(반투명·크로스페이드·grid-rows 아코디언). 행 클릭 시 좌측 플라이아웃(행 top 실측 배치 — 아코디언 클립 밖으로)에 카테고리 맵 목록, 클릭으로 다른 맵 이동. ScopeWindow topRightSlot 신설.

## 2026-08-25 — PNG 내보내기 정보 카드+배경·비교 잘림 픽스 (dev)
- 비교 PNG 우측 끝 노드 잘림 — minZoom 0.5 클램프로 큰 맵이 1600×1000에 못 들어가던 것. 프레임을 bounds×minZoom에 맞춰 확장(MAX 4096 비율 축소)하고 fit이 항상 이기도록 zoom 하한을 낮춰 전달.
- PNG(에디터/비교) 공통: 투명 캡처 후 캔버스 합성 — bg-canvas+dot-grid 배경, 하단 정보 카드(이름·오우닝부서 리프·오너·버전(비교는 base→target)·게시일(published 이벤트)·프레임워크 경로). 게시일은 findPublishedAt(events) 공용 헬퍼, 오너명은 get_map에 owner_name 동봉(목록과 동일 Employee 소스, 테스트 추가).

## 2026-08-25 — 비교 드래그 끊김 픽스 (dev)
- 비교 캔버스 드래그가 매 프레임 sessionPos를 갱신해 laidNodes→nodeCenters→handleSides→appEdges 전부 재계산·전 노드/엣지 identity 교체로 화면 전체가 새로고침되듯 끊기던 문제 — 드래그 프레임은 applyNodeChanges(rfNodes)로만 반영하고 sessionPos는 드롭 시점 1회 커밋으로 전환.

## 2026-08-24 — React 19.2 패턴 도입: useEffectEvent 적용 + Activity 판정 룰 (dev)
- React/Next 최신 기능 6종 적용성 검토 → 가치 판정: useEffectEvent·Activity만 채택, Cache Components(전 페이지 클라이언트 컴포넌트라 대상 없음)·Compiler 활성화(검증 비용 별도 결정)는 보류.
- 체크아웃 폴링(에디터)을 useEffectEvent로 전환 — deps의 versions 배열 identity·t가 목록 갱신·언어 전환마다 인터벌 재구독+acquireCheckout 즉시 재호출하던 것 제거(게이트는 selectedVersionStatus 파생값으로 유지). Activity는 코드 적용 없이 룰만 — 기존 설계 3곳(배지 소스 display:none·FrameworkTree 강제 리마운트·pw strict mode)과 충돌해 함부로 쓰면 안 됨을 lessons §8로 명문화.
## 2026-08-24~26 — AI 계약 최신화 + 인터뷰 JSON 임포트 점검 (feat/ai-contract-parity 머지)
- 데이터 표면 패리티(CSV 왕복·Excel)는 다음 브랜치로 이관 — 설계 초안 `docs/design/2026-08-24-data-surface-parity-design.md`(검토값 CSV 왕복 확정·system_fallback 미결·Word 내보내기 제외).
- 챗 계약 승격 필드 반영: `_INSTRUCTIONS` attributes 예시·파라미터 의미·SP 제한 확장(IO/조건은 "대화 근거만" 가드) + `_serialize_node`에 실작업·입력/출력("; " 조인·80자 컷)·양식·조건·GMP 노출. gmp는 읽기 전용 — `AiNodeAttributes`에 없어 편집 에코는 스키마가 거른다. 스키마·FE 수신부는 필드 승격(8/20) 때 이미 준비돼 프롬프트 갭만 봉합.
- touch_time 7종 완성(인터뷰 표면): 인터뷰어 규칙9 params_table·드래프터 attributes 예시(+input/output/조건/양식)·첨부 추출기 계약·apply-params `_PARAM_FIELDS`·FE params 표(Touch 열·48rem)·`PARAM_TABLE_KEYS`. CLAUDE.md의 낡은 "6필드/나머지 4필드" 문구를 7필드/5필드로 정정.
- ops set_attr 승격 텍스트 반영: `resolveAiTextPatch` 신설(params.ts — null=유지·""=지움, IO 텍스트 변경 시 폼·링크·플래그 폐기 = mergeNode 줄 정렬 계약 미러, 동일 에코는 보존, SP 전체 드롭) + page.tsx set_attr 스프레드 배선 — 기존엔 AI가 보낸 input/output/조건/양식이 조용히 버려졌다.
- 인터뷰 JSON 임포트 점검: 키 전수 소비 대조·샘플 2종 dry-run 이슈 0. `artifact_role` 유실 회귀 봉합(승격 리팩터가 [Interview] KV를 지우며 전용 컬럼 없이 증발 → 기록성 키로 잔류 복원, 스모크 [5] 단언 동기) + l5/tasks/exceptions 미지 키 경고 추가. summary·labelSource 미소비는 설계 "미저장" 의도 유지. 잔여: 실파일 dry-run(사용자 제공 필요).
- 머지 직전 main(1cc0c4a1, 08-25 릴리스) 역머지 — 충돌은 PROGRESS뿐, page.tsx 자동 병합(set_attr 배선 유지 확인). 최종 게이트: BE pytest 1172·ruff / FE vitest 775·tsc·lint·build 그린.

## 2026-08-24 — 비교화면 리프레시 + start/end 노드 개선 (feat/compare-refresh 머지)
- start/end 노드: 커스텀 라벨 시 타입 필(Start/End)+제목 분리(좌정렬)·rounded-[19px] 고정 곡률(계란형 방지), 노트(description)는 캔버스 미노출 — 인스펙터/편집 모달 전용(캔버스 노출 1차안은 피드백으로 철회). hasCustomTerminalLabel(canvas.ts).
- 비교 최신화: 유지 엣지 라벨 변경 감지(MergedEdgeStatus "changed"+labelChange, 옐로)·저장 line_style대로 렌더(직선/곡선/꺾은선)·인스펙터 확장(touch_time·GMP 행+IO/양식/조건 블록 diff+엣지 포커스 패널)·변경 목록 세로 필드 행(truncate+툴팁)·동좌표 삭제 노드 순차 오프셋. location은 레거시 계층 마커라 diff 미대상 확정.
- 세션 한정 드래그(sessionPos 키에 방향·버전 쌍 → 전환 시 자동 원위치·리셋 effect 불필요, 핸들 변·목록/Tab 내비 모두 옮긴 좌표 기준)·인스펙터 2탭: 요약 = 7파라미터 버전 합계(BASE→TARGET+delta, sumVersionParam — SP 5종 위임·annual_count/fte 자체값 합·headcount 평균 표기)+기여 노드 목록(클릭=포커스)+확장 섹션 4종(구조·시스템 집합 diff·부서/담당자 지정률·GMP 분포, 공용 SummaryCard)+표시 선택 드롭다운(체크 숨김, 트리거 (-N)).
- 시드: scripts.seed_compare_demo 워스트케이스 확장(17필드 동시 변경·통화 전환·동일 이웃 삭제 2개·라벨/선모양 3종). ⚠️ seed_org_demo 맵은 버전 간 source_node_id 계보가 없어 비교화면 데모 불가 — 비교 검증은 이 데모 맵으로.

## 2026-08-23~24 — 노드 간격 자동 재조정 height-shift + 엣지 우회 (feat/node-spacing 머지)
- height-shift: 표시 높이(실측)로 커진 노드 아래 전체를 저장 Y 계단함수로 밀어냄 — 저장 좌표 절대 불변(표시=저장+X inline-shift+Y height-shift), lib/height-shift.ts 밴드 병합(같은 행 max·스택 합산)·inline-shift 역변환 재사용·rAF 트윈 350ms(즉시 3조건)·인라인 펼침 중 비활성. 드래그/생성/스왑/Ctrl복사 전 경로 역변환, 그룹 오버레이·PNG bounds 표시 공간 전환, 성장 후 1회 재핏(80ms 디바운스·마운트 1.5s 창).
- 엣지 우회(lib/edge-detour): 꺾은선의 기본 3구간 경로가 표시 bbox(+12px) 관통 시 무교차 최소 이탈 회랑으로 직각 우회(무회랑=폴백, 직선·곡선 불변). 라벨은 무가림 최장 구간 중앙. 프로세스 좌우 핸들 제목 라인 18px 고정(이웃 엣지 수평).
- 검증: FE vitest 760(height-shift 9·edge-detour 11)·pw-smoke-height-shift 12/12·브라우저 QA T8/U6/W6 전부 통과(docs/qa/node-spacing-qa.md). 스펙/플랜 docs/superpowers/(main 머지 시 삭제 정책).

## 2026-08-21~24 — 노드 IO 연결(불러오기) 완결 (feat/io-linking 머지)
- IO 항목 링크 그룹(원본 1 아웃풋/SP + 미러 N, itemId-only·줄 정렬 텍스트 컬럼 6개)·불러오기 4시나리오(미러/인수/승계/합류)·전파+정합화 겸용 propagateIoLinks — 단일 소스 lib/io-items.ts. CSV Input_Flags 왕복·일괄편집/복사 소거 가드·플레이스홀더 브로큰 플로우 경고.
- 에디터 UI 웨이브: GMP 픽커 즉시적용+되돌리기 안내(collapse 미리보기·캔버스 반영), IO 체크리스트 3단계(0/3.5줄/전체)+그룹 동반 체크·체크 동기 애니, 인박스 행 컨트롤(R/O 플래시)·2줄 클램프·양식 아이콘 맨 뒤·필수/선택 색·Show more 호버, 디시전 1:1.2+3줄 클램프+배지 코너+인쇄 클램프 해제, 엣지 라벨 160px 랩, kbd 줄바꿈 힌트(Alt/Shift+Enter), SP 마크 인라인·양식 스레딩·버전 배너 2종(한 줄+툴팁), UI em-dash→하이픈 전수.
- 검증: BE pytest 1149·FE vitest 740·pw-smoke-io-links 26/26·브라우저 QA 121항목 118✅(docs/qa/io-linking-qa.md). 랜드마인은 docs/lessons·메모리에 흡수.
## 2026-08-20 — 좁은 인스펙터 입력 오버플로 픽스 (dev)
- 통일 폭 입력의 shrink-0가 원인 — w-32/w-44는 상한으로 두고 min-w-0+축소 허용(메트릭스·조건·시스템·URL·SP 지정 4행). 인스펙터 최소 폭 300px에서 경계 이탈 0 실측(여유 폭에선 통일 폭 유지).

## 2026-08-20 — 섹션 스페이서 규칙 통일 + IO 항목 번호 (dev)
- 스페이서(구분선)는 분리가 필요한 경계에만: 어트리뷰트=URL 위 1개(부서/담당/시스템 무구분, BpmAttributePicker·인스펙터·SP 지정 공통), Metrics=무구분(지정 모달의 행 구분선 제거), 입출력 조건=Output↔시작 조건 경계 1개. 링크 라벨은 URL 하위 항목으로 한 단 더 들여쓰기+축소 글자(UrlLabelField·지정 모달). 입출력 각 항목 앞 회색 번호(1. 2. — 편집 행·읽기 행·SP 상속 표시 공통). 들여쓰기 세로선 유지.

## 2026-08-20 — SP 안내 툴팁 키워드 구조화 (dev)
- 문장식(spNoteFull) 폐기 → 아이콘+키워드 행(Library/Embed, caption-strong)+회색 보완설명+하단 회색 요지 한 줄로 재구성 — 한눈에 파악하는 구조 (사용자 정정 반영).

## 2026-08-20 — 모달 헤더 아이콘·지정 상태 필 + 툴팁 카드 가시성 (dev)
- SP 지정 모달 헤더에 Workflow 아이콘+지정 상태 필(Designated/Not designated, 영어 고정 — SP 카드 뱃지 규칙, `designated` prop 호출부 3곳). 벌크 모달 헤더에 SlidersHorizontal 아이콘. Tooltip 리치 콘텐츠(content) 변형을 카드형으로 승격(caption 14px·max-w-72·여유 패딩) — SP 섹션 ⓘ 안내 가시성 개선, 아이콘 호버 액센트.

## 2026-08-20 — 모달 상단 고정 + 높이 전환 아코디언 + SP 지정 모달 섹션화/스크롤 (dev)
- 벌크·노드 편집·SP 지정 모달을 상단 고정(items-start+pt)으로 바꿔 내용 변화 시 위치 점프 제거. 높이 변화는 AutoHeight(인박스 컴포넌트 재사용)로 스무딩 — 벌크는 카드 전체+카테고리 패널+충돌 박스, 편집/지정 모달은 각 섹션 바디(상시 마운트 래퍼+내부 조건부라 열림/닫힘 모두 애니메이션).
- SP 지정 모달 섹션화: BPM attributes(부서·담당·시스템·URL)/Metrics(SP 5필드+Σ)/I-O & Conditions 아코디언(공유 접힘 키)+모두 접기/펼치기 버튼, max-h+내부 스크롤로 작은 창에서 Save 항상 도달. 실브라우저 7항목(top 불변 실측·600px 창)+스모크 25/25.

## 2026-08-20 — 편집 모달 섹션 일괄 접기/펼치기 (dev)
- BPM attributes 헤더 우측에 아이콘+라벨 버튼(모달은 공간 여유) — 인스펙터 탭 바 버튼과 동일 판정(하나라도 펼침→모두 접기), 모달 3섹션은 로컬 state 직접 제어(공유 영속 키 write 유지). 왕복 실측 검증.

## 2026-08-20 — 데이터 폼 피커(자동완성)·짧은 대시·탭 폭·SP 지정 통일 (dev)
- IO 항목별 자료 형식을 상시 입력칸 → 피커로 전환(`data-form-picker.tsx`): 행 호버 시 아이콘 → 자동완성 드롭다운(카탈로그 12종 `lib/data-forms.ts`, 확장자/영문/한글 유사도=lib/search 재사용, ↑/↓ 이동·Enter/Space 선택, 무일치 자유값은 "추가" 행으로만 확정, body portal). 완료 상태는 필 비활성 표시(카탈로그=아이콘 동반, 기타=텍스트만). 인스펙터·편집 모달·SP 지정 모달 3표면 공유(MultiValueInput).
- 빈값 플레이스홀더 "—"→"-" 전 표면 스윕(주석 제외 15파일). 인스펙터 탭바는 선택 탭 라벨 shrink-0(비선택 탭이 먼저 말줄임), 우측 일괄 버튼 유지. SP 지정 모달 단일행 입력 w-44 통일.
- 검증: data-forms 단위 5·실브라우저 10항목·스모크 25/25(피커 플로 반영)·게이트 그린(vitest 670)·매뉴얼 EN/KO 갱신.

## 2026-08-20 — 모달 저장→인스펙터 즉시 동기 + 모달 버퍼 변경 노출 (dev)
- 편집 모달 저장이 인스펙터에 바로 안 비치던 원인 2건 수정: MultiValueInput 행 버퍼가 외부 값 변경에 미동기(렌더 중 상태 조정으로 외부 변경만 리셋 — 자기 커밋 에코·입력 중 빈 행은 보존), NodeMetricsCard 활성 통화가 외부 통화 전환에 미동기(로컬 비용 draft 없을 때만 재판정).
- 모달에 버퍼 내용 노출: 변경 섹션 헤더에 점(•) + 푸터에 "Unsaved: {변경 필드 목록}"(비용 2필드는 Cost / run 하나로 접음). 실브라우저 6항목·스모크 25/25.

## 2026-08-20 — 인스펙터 입력 상시 노출·통일 폭 + 모달 어트리뷰트 아코디언 (dev)
- 편집 가능한 인라인 입력(수행 지표·조건·data_form·시스템·URL)은 호버 시에만 보이던 영역을 상시 박스(bg-surface-alt+hairline)로 노출, 폭은 최단 행 기준 w-32(128px)로 전 행 통일(모달 표면은 w-44 — NodeDetailsFields/UrlLabelField `inputWidth` prop), 포커스 시 액센트 보더. 읽기전용은 기존 투명 디자인 유지. MultiValueInput 행에도 포커스 보더.
- 편집 모달 BPM 속성(부서/담당/시스템+URL 편입)을 수행 지표와 동일 아코디언 섹션화 — `bpm.attrsCollapsed` 인스펙터와 키 공유. 실브라우저 4항목(폭 128 균일 실측·accent 보더·모달 섹션 공유 키)+스모크 25/25.

## 2026-08-20 — 인스펙터 섹션 일괄 접기/펼치기 (dev)
- 인스펙터 탭 바 맨 오른쪽에 아이콘 버튼(호버 툴팁) — 하나라도 펼쳐져 있으면 모두 접기, 모두 접혀 있으면 모두 펼치기. 아코디언 상태가 컴포넌트별로 흩어져 있어 DOM 컨벤션으로 수렴: 헤더 버튼 `data-acc-toggle`(aria-expanded)+`<details data-acc>`를 탭 콘텐츠에서 쿼리(활성 탭만 마운트=탭 스코프), MutationObserver로 아이콘/툴팁 동기화. 실브라우저 6항목 검증.

## 2026-08-20 — 인스펙터 2차 디자인 라운드 (dev)
- 벌크 카테고리 정리: 순서 속성/수행 지표/입출력·조건, 쉐브론 삭제·선택 점(•)은 라벨 앞. Node display를 공용 컴포넌트(`node-display-section.tsx`)로 추출 — 카테고리 계단 구성·행 전체 클릭 토글(hover), 승격 토글 추가(입력/산출 별도, 시작·종료 조건은 "conditions" 하나로 통합 — 캔버스는 두 줄 렌더), 속성 탭 기본 화면(맵 요약 아래)에도 노출. 맵 탭 노트는 기본 접힘 아코디언·Edge style은 보더 카드로 통일. 인스펙터 설명(읽기전용)은 호버 편집 아이콘/더블클릭 → 편집 모달 설명 자동 포커스(`initialFocus`).
- 검증: 실브라우저 10항목 + pw-smoke-field-promotion 25/25(노트 접힘 반영)·게이트 그린(vitest 665)·매뉴얼 EN/KO 갱신.

## 2026-08-20 — IO 항목별 데이터 폼 + 벌크 카테고리 재편 + BPM 속성 아코디언 (dev)
- 데이터 폼을 IO 항목별 값으로 승격: 신규 정렬 컬럼 4개(`nodes.input_forms/output_forms`·`process_maps.sp_input_forms/sp_output_forms`, 줄 1:1 정렬·`_ADDED_COLUMNS` 자동 ALTER). 기존 노드 `data_form`은 임포트 폴백 유지(항목별 값 없을 때만 행 표시). MultiValueInput에 항목별 폼 열 추가 — 인스펙터·편집 모달·SP 지정 모달(단일행 입력→MultiValueInput 교체) 3표면 공유, SP 상속 표시는 " · form" 접미. 정렬 무효화 규칙 3곳 동일: 재임포트 승계(항목 텍스트 불변 시만, gmp 계보 패턴)·CSV/AI 병합(mergeNode)·벌크(교체=소거, append=유지). diff/compare 필드 등록, CSV/Excel/AI 표면은 제외(병합 보존, 후속 트랙).
- 그룹 일괄 편집 재편: 카테고리 3버튼 한 행(수행 지표/입출력·조건/속성) + 클릭 시 아래 패널에 하위 모드 버튼 펼침(재클릭=접힘, 현재 모드 카테고리는 점 표시). IO·조건 4필드 벌크 모드 신설 — IO는 textarea(줄=항목)·append=줄 추가. 인스펙터 BPM attributes 카드 2곳(일반·SP 상속)도 동일 아코디언(기본 접힘, `bpm.attrsCollapsed`).
- 검증: BE 1146·ruff / FE 665·tsc·lint·build / 실브라우저 신규 10항목 + pw-smoke-field-promotion 25/25(폴백 행 숨김 계약·attrs 접힘 반영, [11][12]에 폼 회귀 추가). 매뉴얼 EN/KO 갱신.

## 2026-08-20 — 인스펙터 레이지 세이브 + 비용 통화 토글 (dev)
- 수행 지표·입출력 조건 두 섹션을 자동 저장→명시 저장(버퍼+헤더 Save 버튼, 노드 전환 시 미저장분 폐기)으로 전환하며 카드를 `node-metrics-card`/`node-details-card` 컴포넌트로 추출(key 리마운트=버퍼 리셋). 비용은 배타 계약이라 KRW/USD 2행을 ₩/$ 세그먼트 토글 1행으로 통합 — 반대 통화 값이 있으면 "저장 시 삭제" 인라인 안내+되돌리기(인스펙터·편집 모달 동일). 검증: 신규 시나리오 14/14 + pw-smoke-field-promotion 25/25(레이지 계약 반영, [8]은 c0c532a에서 제거된 배지 단언 정정)·게이트 그린·매뉴얼 EN/KO 갱신.

## 2026-08-20 — I/O & Conditions 아코디언 + 두 섹션 행 아이콘 (dev)
- 입출력·조건 섹션을 수행 지표와 동일한 아코디언(기본 접힘·채움 개수 배지·`bpm.detailsCollapsed` 인스펙터↔편집 모달 공유)으로 전환. 두 섹션 전 행에 12px 아이콘(수행 지표=PARAM_ICON 공용 추출 `components/param-icons.ts` — 캔버스 칩·일괄 편집 탭과 3표면 공유 / IO·조건=`DETAIL_FIELD_ICONS`: 입력 LogIn·산출 LogOut·형식 FileType·시작 Play·종료 Flag). 게이트 662·tsc 0·build OK, 기본 접힘 실브라우저 확인.

## 2026-08-20 — 승격 카드 용어 확정 (dev)
- 혼동 제거(사용자 지시) — 노드 카드 타이틀 "Details/상세 속성" → **"I/O & Conditions/입출력 · 조건"**, "Parameters/파라미터" → **"Metrics/수행 지표"**. i18n 값+매뉴얼 4종 일괄 스윕(코드 식별자·설정 "상세" 탭명은 유지), 매뉴얼의 낡은 "6필드" 표기도 7로 정정. 상세 디자인 피드백은 용어 확정 후 사용자 진행 예정.

## 2026-08-20 — 인터뷰 필드 승격 + 활동별 GMP (feat/field-promotion → dev)
- 인터뷰 텍스트 직렬화 키를 고유 필드로 승격(기조: 노드↔SP 대칭) — **touch_time 7번째 공용 파라미터**(duration H.MM 완전 미러: 정규화·Σ·CSV 20열·Excel·일괄편집·SP 상속 5필드·칩=스톱워치 아이콘), 노드 input/output(개행 복수·Details 카드/편집 모달 공용 `NodeDetailsFields`)·시작/종료 조건·data_form(IO 종속 행)·system_fallback, 맵 sp_조건·GMP 3값+폴백 5종. 설계 `2026-08-19-field-promotion-design.md`.
- **대표+폴백 검토 흐름**: 임포트는 폴백에 원문([Interview]=Owner role만·노드 KV=Rule/Screen/Quote만), 검토는 `PATCH /maps/{id}/process-fields`(오너, SP 지정 무관)+설정 Conditions & GMP 카드+`FallbackHint` 팝오버(원문·수정·적용). 엔진은 sp_gmp 비교·갱신 제외, 폴백 수정은 재전달이 덮음(전달분이 진실). openItems·tasks.note도 노트 보존.
- **활동별 GMP**: `nodes.gmp`(3값, 무효 "" 소거) — 캔버스 필 태그(맵 탭 GMP 토글, 노드 안쪽 라벨 왼쪽 위, 미분류=아이콘만, 45% 틴트 보더), 편집 모드 필 클릭=클릭 지점 분류 피커, **분류가 일반 노드 색 자동 확정**(GMP_NODE_COLORS)+마우스 지점 안내 모달(2단 되돌리기: 이전 분류로/색만). SP 노드는 링크 맵 sp_gmp read-only 상속 필. **재임포트 승계**(계보 이어받기·시그니처 제외 — 검토값 보존).
- 검증: QA 문서 `docs/qa/2026-08-20-field-promotion-qa.md` 43항목 전부 ✅(스모크 `pw-smoke-field-promotion.mjs` 25/25 + GMP 6체크 + 3차 5체크 + 회귀 15/15·7/7·25/25). 게이트 BE 1143·ruff 0 / FE 662·tsc 0·build OK. ⚠️ 서버 배포는 FE/BE 동시 필수(구 FE의 graph PUT이 승격 필드 소거) — 재임포트 1회로 백필(`docs/deploy/db-migration-9910.md` §8). 시스템 라이브러리는 별도 트랙.

## 2026-08-19 — LDAP 인증 폴백 + 로컬 계정 (dev, 완료)
- 9910을 LDAP으로 열어 Keycloak 없이도 AD bind + 설정 화면 발급 로컬 계정(컨설턴트용)으로 로그인하게 함. 설계 스냅샷 `2026-08-19-auth-fallback-ldap-design.md`는 서버 Keycloak 로그인 실검증 후 폐기(git history 보존) — 운영 계약은 `docs/deploy/deploy.md` §2.1·`docs/spec.md`가 담당.
- 구현: `AUTH_MODE=keycloak|ldap|dev`를 `GET /api/auth/mode`로 런타임 노출(프론트 빌드타임 상수 폐기) · 자체 서명 HS256 세션 토큰(`app/tokens.py`, `AUTH_JWT_SECRET` 필수) · `POST /api/auth/login`(로컬 계정 우선→AD bind 폴백, 5회/5분 스로틀) · 설정 화면 로컬 계정 CRUD + sysadmin 부여(`local_credentials`, 메모리 캐시) · 프론트 3모드 게이트(`AuthGate`/`DevGate`/`LdapGate`)와 모드별 로그인 화면.
- Task 11(마감): frontend 빌드 args(`NEXT_PUBLIC_KEYCLOAK_*`) 완전 제거 — top-nav 로그아웃·`keycloak-login.ts`도 런타임 조회(`getCachedAuthMode`)로 전환. `docs/deploy/deploy.md`에 인증모드 절 추가(AUTH_JWT_SECRET 필수·컨설턴트 계정 회수 절차·토큰 무효화 불가+시크릿 교체 kill switch·단일 워커 캐시 주의). `scripts/pw-smoke-ldap-login.mjs` 신설(5시나리오 10체크, 실브라우저 통과). 리뷰 픽스 4건 — ldap-session 만료 파싱 NaN을 만료로 처리, auth-mode 폴백 결과는 캐시하지 않음(재시도 허용), 죽은 `login.or` i18n 키 제거. 전체 그린: backend 1129 passed+ruff clean, frontend tsc/lint/vitest 652 passed/build 통과.
- 최종 리뷰 하드닝 3건: ① 로그인 로컬 분기를 `credential 존재`가 아니라 `credential + employee.source=='local'`로 강화 — HR 동기화가 충돌 loginId를 `source='hr'`로 전환한 뒤 orphan credential로 계속 로그인되는 구멍 차단, AD로 폴백. ② `is_sysadmin`의 `_granted_sysadmins` 캐시 항을 `resolved_auth_mode()=='ldap'`일 때만 인정 — ldap→keycloak 전환 후 관리 엔드포인트가 404라 회수 불가능한 잔여 부여가 새는 문제를 predicate에서 차단(env 목록은 모드 무관 유지). ③ 로컬 계정 표에 active 토글(deactivate/reactivate) 추가 — 스펙 §5·`docs/deploy/deploy.md` 오프보딩 절차가 요구하던 차단 기능이 UI에 없었던 결함. `docs/deploy/deploy.md`에 AD 첫 로그인 전제(HR 미동기화 계정은 401) 한 문장 추가. 전체 그린: backend 1132 passed+ruff clean, frontend tsc/lint/vitest 652 passed/build 통과.
- 서버 검증: **Keycloak 로그인 실검증 확인**(런타임 모드 전환·빌드 ARG 제거·PKCE 경로 무회귀). 잔여 검증: 실 AD bind·ldap 모드 평문 HTTP·`AUTH_MODE=ldap` compose 전환.

## 2026-08-19 — 로딩 플레이스홀더(shimmer) 일괄 도입 + 첫 렌더 애니메이션 억제 (dev)
- 실서비스에서 보이던 3종 깜빡임 — ①공지 작성자 필이 아이디→이름으로 바뀜 ②홈 새로고침 시 "맵 없음" 화면이 1초쯤 떴다가 뒤집힘 ③좌측 조직도가 렌더 후 아코디언 애니메이션을 우르르 재생. 공통 원인은 "데이터 없는 상태를 먼저 그린다"라, 그 자리를 shimmer 스켈레톤(`globals.css .skeleton` + `components/skeleton.tsx`)으로 채우는 방향으로 통일.
- ① `useDirectoryState().ready`로 "아직 안 온 것"과 "모르는 사람"을 구분 — 도착 전 UserPill은 스켈레톤 필. ② 홈은 맵+내 정보+디렉터리가 모두 settled될 때까지 `HomeSkeleton`(같은 1:2 레이아웃). ③ `useClosingKeys.getSectionClass`가 사용자가 접거나 편 뒤에만 `accordion-open`을 주고, 그 전(첫 페인트·localStorage 복원·시드)에는 애니메이션 없는 `accordion-static`.
- 검증: `scripts/pw-smoke-loading.mjs`(API 지연 주입) 수정 전 3/7 → 수정 후 7/7. 미조정: ClampedList의 `clamp-size` 높이 전환은 복원 시 1회 재생되나, 첫 펼침 애니메이션을 잃을 위험이 있어 그대로 뒀다.

## 2026-08-19 — 승인 대기 필 압축(유저 카드 이름·부서 복구) (main 직접)
- 인원 카드에서 `editor → viewer · Approval pending` 필이 행 폭을 통째로 먹어 이름/부서가 0px로 뭉개지던 문제(실측: 이름열 0px·필열 265px) — 필을 **목표 역할만 남긴 압축형**(⏳ Viewer / ⏳ removed)으로 바꾸고 전체 내역(현재→목표·요청자)은 툴팁으로. 공용 `components/permissions/pending-change-pill.tsx`로 추출해 홈·인스펙터 카드와 설정 협업자 패널이 같은 문법을 쓴다.
- 맵 상세 카드에선 staged 태그와 같은 **2번째 줄**로 내리고 우측 필 열에 `shrink-0` — 이름열 103~113px 확보·클리핑 0(실브라우저 before/after 실측, 홈·인스펙터 두 표면).

## 2026-08-19 — 인박스 스크롤바 제거·선택 해제 범위 축소·이름 클릭 (main 직접)
- 인박스 우측 상세에 늘 떠 있던 스크롤바 — `AutoHeight`가 border-box 높이에 테두리를 안 더해 1~2px이 모자랐던 것. 올림+테두리 보정으로 넘침 자체를 없애고, 실제로 넘칠 때만 보이도록 `scroll-quiet`(스크롤 중에만 노출, `useQuietScroll`)를 상세·좌측 목록·긴 textarea에 적용.
- 내용을 클릭·드래그만 해도 선택이 풀리던 문제(멤버 보기 버튼 포함) — 해제 판정을 "빈 여백을 **직접** 눌렀을 때만"(target===currentTarget)으로 바꾸고 홈/인박스의 자식 stopPropagation 가드 의존을 제거. 인박스는 배경이 click, 가드는 mousedown이라 단계까지 어긋나 있었다.
- 사용자 이름 필(UserPill) — 포인터 커서·호버 틴트 추가, **클릭하면 1초 대기 없이 즉시** 인물 카드(부모 행 선택으로 번지지 않음). PersonHoverCard 계열은 이미 동일 동작.

## 2026-08-19 — 드롭다운 안 닫힘 진범: stopPropagation 가드 (main 직접)
- 맵 상세 카드 **안쪽**을 클릭하면 조직/인물 드롭다운이 남던 진짜 원인 — 카드의 선택-해제 방지 `stopPropagation` 가드가 버블을 끊어 메뉴의 window mousedown 리스너까지 이벤트가 도달하지 못했다. 메뉴·팝업·드롭다운 6곳(ContextMenu·PersonInfoPopup·홈 생성메뉴·top-nav·알림벨·피드백 노트·필터)의 바깥닫힘 리스너를 **캡처 단계**로 전환해 해소(실브라우저 좌/우클릭·카드 내부 클릭·Esc 8항목 통과).

## 2026-08-19 — 인스펙터 맵탭 인물/조직 메뉴 복구 + 메뉴 닫힘 강화 (main 직접)
- 에디터 인스펙터 Map 탭에서 부서·유저 카드 좌/우클릭이 무반응이던 원인: `MapDetailCard`가 `showFooter={false}`(인스펙터) 조기 반환에서 **오버레이 블록(컨텍스트 메뉴·조직 정보·인물 팝업)을 렌더하지 않음** — 상태만 바뀌고 화면엔 아무것도 없었다. 오버레이를 변수로 추출해 두 반환 모두에서 렌더.
- 메뉴·팝업이 fixed 좌표라 목록이 움직이면 엉뚱한 자리에 남던 문제 — `ContextMenu`·`PersonInfoPopup`에 스크롤(캡처)·리사이즈 닫힘 추가(바깥 클릭·Esc는 기존). 실브라우저 8항목 통과(인스펙터 메뉴·팝업·스크롤 닫힘, 홈 단일 메뉴 유지).

## 2026-08-19 — 인박스 결재 주체 표시 + 상세 높이 애니메이션 (main 직접)
- 관리자 인박스에서 "관리자라서 보이는 건지, 내가 결재자인지" 구분이 안 되던 문제 — `/inbox/approvals`에 `deciders`·`pending_on`·`approved_by`·`via_sysadmin` 추가(kind별 결재 주체: 버전/권한·가시성=지정 승인자, 이름변경·SP지정=오너, 점유권=점유자+오너). 카드에 대기 필(2명+n), 상세에 결재자/대기 행과 관리자 열람 안내.
- 우측 상세를 **내용 높이**로 바꾸고(`components/auto-height.tsx`, ResizeObserver+height 트랜지션 350ms, 첫 측정은 무애니) 카드 전환 시 이전 높이에서 이어지게 — 승인·알림 상세 공용. 게이트 BE 1077·ruff 0 / FE 640·tsc 0·lint 0·build OK, 실브라우저 8항목(대기 필·높이 추종·전환 중간값 관측).

## 2026-08-19 — 8월 2차 릴리스 문서 (main 직접)
- 공지 초안 `docs/notices/2026-08-19-release.md` 신설(연결선 모양·라벨 줄바꿈·창 닫기·피드백 노트/알림·GLM-5.2 이관) + docs 인덱스 등록.
- 매뉴얼 6종 갱신 — 편집(엣지별 선 모양·일괄 변경·Shift/Alt+Enter 줄바꿈·단축키 행), 사용 안내(피드백 노트·알림 수신), 관리자(알림 보내기 2종·노트 수정이력/아카이브·`feedback_notes` 퍼지, 설정 레퍼런스에 AI_BASE_URL/AI_MODEL/AI_MAX_TOKENS/AI_TIMEOUT_SECONDS). README 기능 줄 1건.

## 2026-08-19 — dev → main 릴리스 머지
- 8/18 이후 dev 전체를 main에 반영 — 엣지별 선 모양(서버 영속+일괄 변경 모달)·GLM-5.2/SGLang 사고모드 이관·인터뷰 임포트 정리(variant 보존)·피드백 노트/수동 알림·노드/엣지 라벨 줄바꿈·모달 닫기 규칙(Esc·mousedown). 상세는 아래 항목들.
- **배포 시 필요**: 서버 `.env` AI 설정 교체(`AI_BASE_URL=https://gpu02.sbiologics.com/v1`·`AI_MODEL=glm-5.2`·`AI_API_TOKEN`·`AI_MAX_TOKENS=8000`, 타임아웃 120~180 권장). 스키마는 자동 ALTER(edges.line_style·feedback 알림 시각 2종·feedback_notes 2종) + 신규 테이블(feedback_notes·feedback_note_revisions·map_notes) 자동 생성.
- 게이트(머지 후 main 기준): BE pytest 1077·ruff 0 / FE vitest 640·tsc 0·lint 0·build OK.

## 2026-08-19 — 액션 variant 보존 + 예외 색 분리 (feat/interview-variant → dev)
- 실파일 검증 피드백 반영 — `variant`가 통째로 버려지던 갭 해소: `normal` 외 값은 `Variant:` 줄로 노드 노트 보존, `exception`은 노드 색 rose(#c2849a, COLOR_PRESETS 수동 동기)로 시각 분리. 흐름 분기는 앵커 정보 부재로 미구현(협의 확장 포인트). CanonicalNode.color 신설·엔진 passthrough·시그니처 포함(색 변경=새 버전 감지). 샘플에 예외 액션 추가. 게이트 BE 1068·ruff 0(머지 후 재확인).

## 2026-08-19 — 모달 닫기 규칙 통일: Escape + 바깥 누름(mousedown) (dev)
- 공용 `ModalBackdrop`이 단일 지점 — 바깥 **mousedown 즉시 닫기**(mouseup 대기 없음, 내부 드래그→바깥 릴리즈 오작동도 함께 해소)와 **Escape 닫기**(겹친 모달은 스택으로 최상위만) 제공. 오버레이를 직접 들고 있던 5곳(피드백 상세·공지 편집·알림 퍼지·인터뷰 파라미터/드로우·조직 정보)을 여기에 흡수 — 36개 모달이 같은 규칙.
- 홈: 빈 여백 **누름**으로 선택 해제(상세/카드 가드도 mousedown 기준), 생성 메뉴 바깥 닫기 리스너도 mousedown. 실브라우저 10항목 통과(Esc 단계별·mousedown 즉시 닫힘·드래그 오작동 없음·홈 디셀렉).

## 2026-08-19 — 피드백 노트·수동 알림 + 이름/라벨 Alt+Enter 줄바꿈 (dev)
- 피드백 알림을 **자동 발송 → 관리자 수동 발송**으로 전환(사용자 결정) — 답글 저장은 무통지, 저장 버튼 옆 "알림 보내기"(확인 모달 → 발송 → 토스트)와 상태변경 알림 버튼(**피드백당 1회**, 발송 후 잠금)으로 분리. `feedback.reply_notified_at`/`status_notified_at`로 이전 발송 여부를 모달 메타에 표시. 본인 피드백 셀프 발송은 서버 400(관리자도 피드백 작성자가 될 수 있어 실재하는 경우).
- **`feedback_notes` 테이블 신설** — 누구나 자유롭게 노트 작성, 목록 테이블 노트 버튼 → body portal 플라이아웃에서 내용+시간순 로그 열람·추가. 스레드(작성자 이어달기)는 계속 보류.
- 알림 버튼 발견성 픽스(실사용 피드백) — 관리자에게 **항상 노출**하고 못 보내는 경우만 사유 툴팁으로 비활성(본인 작성/답글 미저장/상태알림 기발송). 기존엔 `!isAuthor` 조건이 버튼을 통째로 숨겨 "관리자인데 안 보인다"가 됐고, done 상태에선 답글 영역째 사라져 알림도 못 보냈다.
- 노트 라이프사이클(사용자 결정): **수정은 작성자만 + 직전 본문을 `feedback_note_revisions`에 스냅샷**(플라이아웃에서 이력 펼침), **삭제는 아카이브까지만**(`archived_at`, 기본 숨김+보기 토글) — 되돌릴 수 없는 **영구삭제는 관리자 DB 테이블의 퍼지 버튼**에서만(알림 퍼지 선례). 겸사로 피드백 하드삭제 시 노트/이력 정리 추가(sqlite FK CASCADE 기본 비활성이라 고아 행이 남던 경로).
- 랜드마인: portal 자식(ConfirmDialog)의 이벤트는 **React 트리를 따라 버블**해 오버레이 `onClick=onClose`가 삼켜 모달이 닫혔다 — 오버레이 밖 형제로 분리(실측).
- 노드 이름 3표면(캔버스 인라인·인스펙터·편집 모달)을 textarea로 전환 — **Enter=커밋, Alt/Shift+Enter=줄바꿈**(Shift는 사용자 요청으로 추가). 캔버스 렌더 `whitespace-pre-wrap`, 실측 추정기(estimateNodeWidth/countTitleLines)는 \n 세그먼트별 계산.
- 엣지 라벨도 동일 규칙(Enter 커밋·Alt/Shift+Enter 줄바꿈) 적용 — SVG `<text>`는 줄바꿈 불가라 커스텀 엣지(`multiline-edge.tsx`, EdgeLabelRenderer HTML 라벨, compare의 LabeledSmoothEdge 선례)로 빌트인 3타입을 덮어씀. 라벨은 pointer-events-none이라 선택·더블클릭 편집·컨텍스트 메뉴는 아래 path로 통과(실브라우저 7항목 확인). 게이트: BE 1068·ruff 0 / FE 640·tsc 0·lint 0·build OK, 실브라우저 스팟(Alt+Enter 입력→저장 "\n" 확인→리로드 2줄 렌더) 통과.

## 2026-08-18 이전
- 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-09-02·08-12 이동분 포함) + git history.

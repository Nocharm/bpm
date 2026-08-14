# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-08-14 — 상단 네비 반응형 구현 (fix/frontend-minor)
- **최종 리뷰 픽스(컨트롤러 직접)** — 강등 아이콘 버튼 3곳 aria-label(피드백·유저 메뉴·언어 전환)·클론 패리티 2건(인박스 뱃지 min-w-[1.125rem]·언어 활성 font-semibold). 게이트: vitest 643·tsc 0·lint 0 error. ※ 서브에이전트가 동일 픽스를 main에 오커밋(9e16857, 미푸시) — 로컬 main 원복 필요.
- **Task 1: `lib/display-stage.ts` TDD 완료** — `pickDisplayStage(available, stageWidths, marginPx=8)` 순수 함수(4 test 통과, tsc clean). 폭 실측 기반 단계 판정: 모든 단계가 미측정이거나 부족하면 강등(length로 반환), margin은 진동 방지 여유.
- **Task 2: `top-nav.tsx` 4단계 반응형 배선** — `pickDisplayStage` + 측정 복제 4개(S0~S3, 비상호작용 스팬·InboxBadge/NotificationBell은 정적 플레이스홀더)로 `stage` 실측, RO+rAF 초기 산정(deps `[lang, userName, tabIndex]`, 필터 모드 훅 선례). 라이브 전환: S1 탭 비활성 아이콘만+title(활성만 라벨, IconPillFilter 문법 350ms), 세그먼트 래퍼 `grid-cols-3`→`inline-flex`(S0 시각 동일) — InboxBadge는 라벨 유무와 무관 상시 렌더. S2 피드백 버튼 아이콘만(매뉴얼 아이콘 버튼과 동일 스타일)+Tooltip. S3 언어 토글 현재 언어 1버튼(클릭 즉시 전환)+Tooltip(신규 i18n `nav.langSwitchEn`/`nav.langSwitchKo`). S4 이름 버튼 → `User` 16px 아이콘+Tooltip(user.name), 드롭다운·로그아웃 구조 불변, 비로그인 Login 버튼은 전 단계 불변. 게이트: vitest 643 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **Task 3: 브라우저 검증 + 실측 픽스 2건** — `scripts/pw-verify-topnav-responsive.mjs`(1440/1200/1000/860/760px×EN·KO, 좌우그룹 충돌·줄바꿈·오버플로 실측 rect 기반, S1 클릭 네비 확인, 62/62 pass·콘솔에러 0). 실측 중 진짜 버그 2건 발견·수정: ① 복제 벨 플레이스홀더 `p-1.5`(+12px 과대측정, 실 `NotificationBell`은 무패딩) — 실 크기로 맞춤. ② 측정 복제 4개가 `absolute left-0`만 있고 `right` 미지정이라 containing block(nav 전체폭) 기준 shrink-to-fit 계산되어 **좁은 뷰포트에서 자연폭이 클램프되어 과소측정**(스테이지 오판 유발 확인 — 원인 ①②로 760px에서 실제보다 이른 단계로 진입했었음) → `w-max` 추가로 뷰포트 무관 고정. 설계 스펙 §5의 "760px→S4" 가정은 두 픽스 반영 후 실측으로 반증(시드 데이터 기준 760px는 S1까지만, 진짜 S4는 avail<~644px/폭 ~660대) — 버그 아니라 "필요한 만큼만 강등"이 의도대로 동작한 결과. 760 앵커를 실측대로 S1로 교정 + 보조 600px에서 S4 도달 확인(캐스케이드 전 구간 배선 검증). 최종 게이트: vitest 643·tsc clean·lint 0 error·build OK.
- **Task 3 리뷰 픽스**: Critical — `w-max`로 자연폭을 살린 측정 복제(S0~S3)가 `visibility:hidden`이어도 조상 스크롤 가능 오버플로엔 반영돼 좁은 뷰포트에서 문서 실 가로 스크롤 유발 가능(nav 자체엔 `overflow-hidden` 금지 — 유저메뉴·벨 드롭다운이 nav 40px 박스 아래로 나가야 함) → 전용 클리핑 래퍼(`absolute inset-0 overflow-hidden`)로 복제 4개만 격리(클론 자체 scrollWidth는 조상 클리핑과 무관해 측정치 그대로 정확 — 실측 확인). 검증 스크립트에 `document.documentElement.scrollWidth<=innerWidth` 가드 추가(74/74 pass, +12). Important — 스펙 §5에 "760→S1 정정(T3 실측)" 각주 추가. 재게이트: vitest 643·tsc clean·lint 0 error·build OK.

## 2026-08-14 — 상단 네비 반응형 설계·플랜 (fix/frontend-minor)
- **설계 스펙**: `docs/superpowers/specs/2026-08-14-topnav-responsive-design.md` — 폭 실측 기반 4단계 누적 강등(S1 탭 활성만 라벨(IconPillFilter 문법·인박스 뱃지 상시) → S2 피드백 아이콘 → S3 언어 토글 1개(클릭 즉시 전환) → S4 이름 User 아이콘). 판정은 `pickDisplayStage` + 측정 복제 4개(비상호작용 스팬·뱃지/벨 플레이스홀더).
- **구현 플랜**: `docs/superpowers/plans/2026-08-14-topnav-responsive.md` — 3태스크(lib TDD·top-nav 배선·브라우저 검증). T9 교훈 반영: 오버플로 단언은 scrollWidth 금지(복제 오염)·가시 rect 기반.

## 2026-08-14 — 조직/인물 카드 후속 (dev 직접)
- **후속(피드백)**: 부서 행·오우닝 부서 카드 좌클릭도 우클릭과 동일한 조직 정보 메뉴(펼침 없는 카드라 포인터 어포던스와 배선 일치) · 인물 카드에 직급·보직 필 추가(`formatTitleWithPosition` 재사용 — allowlist 보직만, 멤버 행 펼침 필과 동일 표기).
- **승인 워크플로 패널 리디자인**: 상태를 태그 필로 승격(Approved/Pending/Rejected 틴트 필 + 호버 시 이벤트 기반 시각·코멘트 툴팁 — `hover-tip.tsx` 신설·150ms 지연·비인터랙티브), 승인자 행에 인물 카드 부착+이름 한/영 전환, 제출 컨텍스트는 호버 아이콘만(제출자·시각·코멘트 — 영구 노출 지양 지시), 진행 필(n/m)·대기자 필 나열·반려 사유 라인·동봉 가시성 필, 스테퍼 위계 강화(원 32px·연결선 4px·활성 라벨 caption-strong). 사이클 판정은 최신 submitted 이벤트 이후만(재제출 시 이전 사이클 승인 시각 오표시 방지). `ApprovalPanel.events` prop 신설(에디터 `currentVersion.events` 전달, API 무변경).

## 2026-08-14 — 협업자 스테이징 UX 구현 (fix/frontend-minor)
- **T1 BE request_id** — `PendingChangeOut.request_id` 필드 신규 추가(요청자 본인 철회 용). schemas.py 184·permissions.py 117-120 수정, test 1216-1254 assert 강화(pending 생성 응답 req_id 캡처 추가). TDD: RED(assert 실패 `request_id` 미노출) → GREEN(1042 tests passed, ruff clean).
- **T2 FE forecastStagedOp** — 권한 op별 즉시/승인 예측 함수(BE `requires_downgrade_approval` 미러). permission-staging.ts에 `forecastStagedOp(op, grantRole, actorIsOwner): "instant" | "approval"` 추가, 5개 test case(add·viewer→editor·editor→viewer·remove·owner) 전부 green. TDD: RED → GREEN(15 tests passed, tsc clean).
- **T3 FE applyStagedOps records** — 저장 결과 상세 레코드(되돌리기 재료). `AppliedOpRecord` interface 신규, `StagedResult.records` 필드 추가(outcome + createdPermission/approvalRequest/prev 스냅샷), `applyStagedOps` 시그니처 `permsById?: Map<number, MapPermission>` param 신규. 호출부 2곳 업데이트(collaborators-panel·map-detail-card)에서 permsById 전달. TDD: RED(records undefined) → GREEN(17 tests passed, 620 전체 시험, tsc/lint 0 error).
- **T4 설정 협업자 패널 예고·중복픽스·호버캔슬·회수** — 공용 `HoverSwapPill`(hover-swap-pill.tsx) 신규, i18n 5키(forecastInstant/Approval·cancelPill·pending.withdraw/withdrawDone) EN·KO 양쪽 추가, `MapPermission.pending_change`에 `request_id` 타입 반영. `collaborators-panel.tsx`: 역할 배지 pending prop 제거(실제 role 상시 표시, 배지 pending 중복 소거), pending 상세 태그는 본인 요청이면 HoverSwapPill로 회수(`withdrawApprovalRequest`), 스택 태그는 X버튼 대신 HoverSwapPill+forecast 아이콘(Zap/Hourglass, `forecastStagedOp` 사용)로 교체(행 태그·staged-add 고스트 행 양쪽). 패널에 `isOwner` prop 신규(settings/page.tsx에서 전달). 게이트: vitest 627 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T5 맵 카드(홈 미리보기·에디터 맵 탭) 동일 4종** — `map-detail-card.tsx`에 T4와 동일 패턴 적용: 역할 배지 `pending` prop 제거+고정폭(`ROLE_PILL_WIDTH_CLASS`) 상시 적용(중복 pending 표시 픽스), `removable`에 `!perm.pending_change` 추가(pending 행은 Remove 어포던스 자체를 닫음 — 쌓으면 저장 시 서버 409), pending 상세 태그는 본인 요청(`loginId` 일치)이면 HoverSwapPill로 회수, 스택 제거 태그·staged-add 태그 모두 X버튼 제거하고 HoverSwapPill+forecast 아이콘(`forecastStagedOp`)로 교체(제거 태그는 아이콘 포함폭이 60px를 넘어 이 필에서만 `min-w-[60px]`로 완화, 공유 상수는 불변). `handleWithdrawPending` 신규: 카드엔 `onToast`가 없어 기존 저장 핸들러와 동일한 재조회 경로(`setLocalReloadKey`)로 반영, 에러는 기존 `stagedSaveError` 배너로 노출(패널의 onToast와 다른 채널). 게이트: vitest 627 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T6 되돌리기(직전 저장 1회분)** — `lib/permission-undo.ts` 신규: `buildUndoPlan(records, actorIsOwner)`(applied add→remove-added·applied change→restore-role·applied remove→re-add·pending→withdraw·failed 제외, `forecastStagedOp` 재사용) + `executeUndoPlan(mapId, items)`(액션별 API 순차 실행, 개별 실패 비차단·pending 집계 — 저장과 동일 정책). `UndoLastApplyModal`(confirm-dialog 백드롭/카드/z-[1300] 패턴 재사용) 신규: 항목별 필+forecast 아이콘(Zap/Hourglass) 목록. 두 표면(`collaborators-panel.tsx`·`map-detail-card.tsx`) 공통 배선: `lastApply` state(컴포넌트 메모리만, 페이지 이탈 시 소멸 — 영속 안 함, 스펙대로), Save 성공 경로에서 `outcome!=="failed"` records로 세팅, Save/Cancel 바가 안 보일 때(`stagedOps.length===0 && lastApply`)만 Undo 버튼 노출(공존 안 함), 확인 후 1회성 소거(재저장 전까지 재사용 불가). 이름 해석은 패널=기존 `resolvePrincipalName`, 카드=기존 staged-add 행과 동일 소스(`nameById`/`groupNameById`/`formatDeptName`) 재사용. 카드는 `onToast` 부재라 저장 핸들러와 동일하게 실패시에만 `stagedSaveError` 배너(성공/승인대기는 재조회 반영만, 일관성 유지). TDD: RED(`permission-undo.test.ts` 모듈 없음) → GREEN(5 tests). 게이트: vitest 632 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T7 오우닝 부서 피커 조직도 브라우즈** — `lib/dept-browse.ts` 신규: `buildDeptBrowseRows(deptOptions, myOrgPath, pinnedCap=3)` — 내 소속 체인을 깊은 단위부터 최대 3개 pinned(트리에서 제외), 나머지는 세그먼트 정렬(=DFS, 부모가 자식의 접두라 항상 먼저 옴) + `depth` 부여. `deptLeaf`·`deptLevelRank`·레벨 아이콘 사다리(센터/담당/팀/그룹/파트)를 `map-detail-card.tsx`에서 `components/maps/dept-level-icon.tsx`로 순수 이동(`DeptLevelIcon` 컴포넌트로 감쌈, size 기본 14) — 카드 3개 사용처(MemberIcon·오우닝 멤버 행·staged-add 행) 임포트 전환, 동작 무변경. `PrincipalPicker`에 `deptTreeBrowse` prop 신규(기존 `myDeptsFirst`는 유일 사용처 교체로 소거) — 빈 검색 브라우즈 시 내 체인 pinned(들여쓰기 없음) → 구분선(pinned 0개면 생략) → 조직도 트리(들여쓰기 `12+depth*14`, 부서 아이콘은 `DeptLevelIcon`)로 렌더, 키보드 내비·infinite slice는 기존 `{item, matches:[]}` hit 형태 그대로라 무변경. 검색 중엔 기존 랭킹 플랫 리스트 그대로(트리 미적용). 호출부 2곳(`create-map-dialog.tsx`·`map-details-panel.tsx` 오우닝 피커) 전환, 협업자/승인자 피커(managersFirst·pinnedIds) 무변경. TDD: RED(모듈 없음) → GREEN(3 tests). 게이트: vitest 635 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존), build OK.
  - **리뷰 픽스**: 트리 브라우즈 부서 아이콘이 `PrincipalIcon`의 `shrink-0 text-ink-tertiary`를 안 받아 색·shrink가 형제 행과 달랐던 문제 — `DeptLevelIcon`에 `className` prop 신규(기본 `""`, 카드 기존 사용처는 무변경) 추가, 피커 호출부에서 `className="shrink-0 text-ink-tertiary"` 전달. 게이트: vitest 635 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T8 홈 필터 필 3단계 반응형** — `lib/filter-display.ts` 신규: `pickFilterDisplayMode(available, {full,label}, marginPx=8)` — 고정 브레이크포인트 아닌 실측 폭 비교(측정 전 폭 0이면 강등 금지, full 유지). `FilterDropdown`에 `display?: "full"|"label"|"icon"` prop 추가(기본 full, 버튼에 `title` 상시 부여) — 기존 유일 사용처(page.tsx)만 있어 하위호환 리스크 없음 확인(grep: inbox/notices/feedback 미사용). `home-filter-pills.tsx` 신규: page.tsx의 상태·역할·오우닝·SP 필터 4종 FilterDropdown + `STATUS_ORDER` 상수를 그대로 이식(로직 무변경, `measureOnly`시 dataId 미부여). page.tsx 배선: 필터 행 `flex shrink-0`→`relative flex min-w-0`(실측 가능하게 축소 허용), 라이브 `HomeFilterPills` + 보이지 않는 측정 복제 2개(`display="full"`/`"label"`, `measureOnly`, absolute+invisible+pointer-events-none+aria-hidden, dataId 없음) + ResizeObserver(행·두 복제 관찰, `homeView`/`lang` 변경 시 재관찰) — 최초 산정은 `requestAnimationFrame`으로 이연(`react-hooks/set-state-in-effect` 회피, RO 콜백은 이펙트 밖이라 무관). 방어 보강: `FilterDropdown` 버튼·루트에 `shrink-0 whitespace-nowrap` 추가 — 브리프가 Task 9로 미룬 Clear 버튼 잠식 엣지케이스(측정에 Clear 폭 미포함)에서도 실패 모드를 "세로 줄바꿈"이 아닌 "여유폭 흡수 실패 시 오버플로"로 강등(같은 파일 내 최소 변경). TDD: RED(모듈 없음, import 실패) → GREEN(4 tests). 게이트: vitest 639 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존), build OK. 잔여: Clear 버튼 폭이 margin(8px)에 실제로 흡수되는지는 1130px 실측 필요 — Task 9에서 브라우저 검증.
- **T9 브라우저 실구동 검증 + 최종 게이트** — `scripts/pw-verify-collab-staging.mjs`(38 시나리오: 설정 패널 스테이징 4종+홈 카드/에디터 탭 재확인 2종+새맵 오우닝 피커)·`scripts/pw-verify-home-filter-responsive.mjs`(22 시나리오: 1440/1130/1000/900px×EN·KO 줄바꿈·오버플로+1130px Clear 활성 케이스) 신규, 전부 실 Chrome+백엔드로 green. **실측으로 발견한 진짜 버그 2건 픽스**(T8에서는 안 잡힘 — 맵 목록이 항상 캐시돼 있던 로컬 조건에서만 우연히 동작했음): ① `filterMode` 측정 effect의 deps가 `[homeView, lang]`뿐이라, 초기 렌더에 `maps`가 아직 비어(`visibleMaps.length===0`) `WelcomePlaceholder`가 뜨는 동안 effect가 null-ref로 조기 반환하고, `maps` 도착 후 필터 행이 처음 마운트돼도 deps 불변이라 다시 안 돎 — `filterMode`가 초기값 "full"에 영구 고정되고 리사이즈도 못 잡는 실사용 버그. `maps.length`를 deps에 추가해 맵 도착 시 effect 재실행하도록 수정(page.tsx). ② 1130px에서 Clear 버튼이 뜨면 그 폭이 가용폭 계산에서 빠져 있어 진짜 가로 오버플로(13.6px) 발생 — `clearBtnRef`를 같은 훅에서 관찰해 `row.clientWidth - (clearWidth + gap)`을 `pickFilterDisplayMode`에 전달하도록 수정, Clear 노출/소멸 시 effect 재부착은 `hasActiveFilter`(기존 JSX 조건 추출·재사용)를 deps에 추가해 해결. 스크립트 자체의 측정 방법도 2건 교정: `row.scrollWidth`는 측정용 invisible 복제(항상 full폭)가 얹혀 오염되므로 가시 버튼 bounding rect 기반 실측으로 대체, `offsetTop` 동일성 대신 세로 중심(`top+height/2`) 비교로 교체(Clear는 패딩 없는 텍스트라 필 버튼과 자연 높이가 달라 같은 줄이어도 offsetTop이 어긋남). 게이트 전부 그린: FE vitest 639·tsc 0·lint 0 error(무관 스크립트 warning 1건 기존)·build OK / BE pytest 1042·ruff 0. dev.db는 두 스크립트 모두 net-zero 설계(스테이징 add/remove는 전부 취소·되돌리기, 새맵 다이얼로그는 Cancel)로 실행 후 원상태 확인.
- **최종 리뷰 픽스 2건** — BE `requires_downgrade_approval` docstring에 FE `forecastStagedOp` 미러 참조 추가(규칙 수정 시 동기화점 명시) · FE collaborators-panel Remove 버튼에 `!isPending` 게이트 추가(pending 행 제거 차단, 저장 시 409 방지). 게이트: BE ruff/pytest 59 green / FE vitest 639·tsc 0·lint 0 error·build OK.

## 2026-08-14 — 협업자 스테이징 UX 7종 설계 스펙 (fix/frontend-minor)
- **구현 플랜**: `docs/superpowers/plans/2026-08-14-collab-staging-ux.md` — 9태스크(TDD·태스크당 커밋·게이트 명시, 브라우저 검증은 Task 9 일괄). 실측 앵커: BE `PendingChangeOut`(schemas.py:184)·pending 직렬화 단일 지점(permissions.py:117)·카드 60px 필 공유 지오메트리·측정 복제 기반 필터 모드 판정.
- **설계 확정·문서화**: `docs/superpowers/specs/2026-08-14-collab-staging-ux-design.md` — ① 스테이지 필 즉시/승인 예고(Zap/Hourglass, FE forecast 미러) ② pending 필 중복 렌더·고정폭 깨짐 픽스 ③ 스테이지 필 호버 캔슬 전환(X버튼 제거) ④ pending 회수(BE `PendingChangeOut.request_id` 추가+기존 철회 API) ⑤ 변경적용→되돌리기(직전 1회 메모리, 확인 모달+역방향 예고) ⑥ 오우닝 부서 피커 조직도 브라우즈(내 부서 3개 고정+들여쓰기 트리) ⑦ 홈 필터 필 3단계 반응형(full/label/icon, 실측 기반). 구현은 `fix/frontend-minor` 워크트리에서.

## 2026-08-14 — 승인 워크플로 코멘트 + 에러 인간화 (feat/approval-comments → dev 머지)
- **전이 코멘트**: submit/approve/publish/withdraw 4단계 선택 코멘트 → 기존 `VersionEvent.note` 재사용(스키마 무변경). 무기록 바로철회(pending·승인 0건)는 submitted 이벤트 하드삭제로 코멘트 자동 동반 삭제 — FE 철회 모달도 같은 조건으로 입력란 숨김(서버·UI 대칭). 에디터·설정 패널 두 마운트 공용 `transitionComment` 1개, 오픈 10곳 전부 리셋.
- **받은함 사유 픽스**: `ApprovalRequest.decision_reason` 컬럼(`_ADDED_COLUMNS` 자동 ALTER) — 비버전 거절도 선택 사유 입력(`isVersion || isApprovalRequest`), reject 시 저장 + 거절 알림 말미 `": {reason}"` 동봉(빌더 3종). 기존엔 입력 사유가 API로 전달되지 않고 유실.
- **에러 인간화 전수**: Group A 28파일 ~50곳 `humanizeApiError` 전환 — 미매핑 폴백만 `(HTTP nnn)` 꼬리표, 원문 JSON은 api.ts throw 2곳 `console.error` 보존, 에러 토스트 톤(XCircle+`border-error`, 성공 토스트 무톤 — onToast prop `(msg, tone?)` 확장). ⚠️ settings 401/403 억제는 문자열 포맷 결합 유지(양단 경고 주석) — status 기반 전환은 후속 결정.
- **거절 배너·코멘트 모달**: 에디터 헤더 배너를 에러 틴트 칩 + 거절자 필(스테일 가드 `workflow.version_id` 대조)로 재디자인(`wf.rejectedBanner`→`wf.rejectedLabel`). 버전 카드 MessageSquare 카운트 버튼(0건 숨김) → 코멘트 이력 모달(`comment-history-modal.tsx`, 클릭점→중앙 확대 `comment-modal-in` 350ms overshoot·바깥 mousedown 즉시 닫힘·Escape·`eventsReloadKey` 액션 후 재조회).
- 검증: 태스크 리뷰 8/8 + 최종 전체 리뷰 승인(머지 가능), BE pytest 1050·ruff 0 / FE lint 0 error·tsc 0·vitest 620·build OK, Playwright+Chrome 실구동 6항목 전판 PASS. 설계·플랜: `docs/superpowers/{specs,plans}/2026-08-14-approval-comments*`.
- **후속(피드백)**: 버전 타임라인(`version-timeline.tsx` — 홈 맵 상세·인스펙터 맵 탭 공용)에도 버전별 코멘트 카운트 버튼(0건 숨김) → 동일 `CommentHistoryModal` 재사용 (dev 직접).
- **후속(피드백)**: 승인 모달에 요청자 제출 코멘트 배너(`requester-comment-banner.tsx` — 최신 submitted 이벤트 note) — 에디터·설정 패널(`ApproveConfirmDialog.submitComment`)·받은함(맵 상세 lazy 조회) 3표면. 에디터 `versions`를 `VersionDetail[]`로 상향(전 지점이 getMap 상세 주입이라 안전) (dev 직접).
- **후속(피드백)**: 반려 모달 3표면에도 요청자 코멘트 배너 + 승인 요청(submit) 모달에 반려 기록 시 이전 반려 배너(에러 톤, 최신 rejected 이벤트 note·반려자 — `findLatestRejection`) (dev 직접).
- **후속(피드백)**: 버전 히스토리 이름 한/영 전환(`useDirectory`+`lang` — ko는 한글명·영문 폴백) + 아이디 hover 0.7초 인물 카드(`person-hover-card.tsx` 공용 — 한/영 이름 치환·`mysingleim://` 메신저 링크·말단 부서+조직 경로 아코디언) (dev 직접).
- **후속(피드백)**: 허용 인원 목록 우클릭 — 인물 행=메신저 보내기·부서/오우닝 카드=조직 정보(에디터 `ContextMenu` 재사용) → `org-info-modal.tsx` 신설(클릭점→중앙 확대·브레드크럼 이동·구성인원 조직장 우선 6.5행 클램프 스크롤·하위 조직 재귀 아코디언, 디렉터리 캐시만 사용) (dev 직접).
- **마이너 픽스 4건**: 타임라인 코멘트 버튼 카드 호버 시에만 노출 · 인물 카드 트리거 호버 어포던스+클릭 즉시 열림 · 호버 카드 포털 이벤트가 React 트리로 버블링돼 버전 카드 접힘/열림 토글되던 것 차단(click/mousedown/keydown stopPropagation) · 멤버 스택 오우닝 부서 행에도 우클릭 조직 정보(부서 행과 동일 카드 인식) (dev 직접).
- **후속(피드백)**: 부서/오우닝 카드 호버 어포던스(링+포인터, 인물 행과 통일) · 버전 카드 우클릭 메뉴(이 버전으로 가기·코멘트 보기 — 비활성 조건 포함) · 타임라인 `group`→`group/vercard` 네임드 그룹(인스펙터 details.group 조상 충돌로 호버 리빌 오작동 교정, R5-2 동일 함정) · 에디터 go-to는 `requestGoToVersion` 가드로 편집 중 전환 확인 모달 유지(`version-switch-confirm.tsx` 공용 추출, VersionPill도 사용) · 인물 우클릭 메뉴에 Info(스탠드얼론 `PersonInfoPopup`, 버블링 차단) (dev 직접).

## 2026-08-14 — QA 문서 정비: ai 2건 삭제·dev-vs-main 로컬 검증·alarm-audit 재검증 부기 (dev 직접)
- **ai-connectivity-test·ai-real-model-smoke 삭제**(사용자 확인 완료분) + `docs/README.md`·`.env.example` 참조 정리.
- **dev-vs-main 체크리스트 로컬 검증**: 카테고리 Add/Rename(트리 반영·`ui-` code)·Delete 기본 동작(연결 맵 거부 사유·묶음 삭제, sqlite) + 샘플 전달물 임포트로 CM-PUR-001 게시 v1·SP 지정·CM-PUR-003 연계 subprocess 임베드 실브라우저 확인 — 남은 미체크는 9910 Postgres FK 재확인뿐.
- **alarm-audit 재검증 부기**: ed15440 감사 이후 해소된 결론 명시(사용자 삭제 API·인당 100캡·sysadmin 퍼지·type 6→18종·checkout 벨 비대칭 해소·create_notifications async).

## 2026-08-14 — 거버넌스 QA 전수 브라우저 검증 + 결함 픽스 4건 (dev 직접)
- **QA 체크리스트 68항목 전수 검증**(P0·C·B·A·R2~R6·회귀) — Playwright+시스템 Chrome, 결정적 QA 시드(O/E/V 3역할·맵 4종·리셋 DB). 전 항목 통과 처리, 백엔드 계약 항목(P0-6·A-3/4/8/10 연쇄)은 API 실호출 검증·항목 비고 부기.
- **발견·픽스 4건**: ① R5-1 Remove 필 상하 6px 커짐(오버레이가 래퍼 라인박스 덮음 → 내부 span 분리, `map-detail-card.tsx`) ② 설정 결재 대기 탭이 실제 승인자에게 미노출(mock permState 게이트 → `listApprovers` 실서버 목록, `settings/page.tsx`) ③ 인박스 배지 첫 폴 X-Dev-User 미주입 레이스(`api.ts` devUser localStorage 부트 시드) ④ 비권한자 에디터 승인 탭 403 무한 재요청 루프+원문 토스트(`pending-approvals-panel.tsx` 조회 게이트+초기 로드 무토스트).
- 관찰(후속 판단): 협업자 패널 pending 행 잠금으로 오너 직접 강등 UI 진입점 없음(백엔드 supersede 계약은 유효). 게이트: FE vitest 620·lint 0 error·tsc 0·build OK(백엔드 무변경).

## 2026-08-13 — 거버넌스 R6: 인스펙터 재정비 (feat/governance-r6 → dev 머지)
- **맵 탭**: 버전 선택 행(VersionPill+관리 아이콘)을 승인 탭→맵 탭 최상단으로 이동, 노드 디스플레이(항목 아이콘 5종 추가)/엣지 스타일 섹션 기본 접힘 아코디언화(`useClosingKeys`+`accordion-open/close` 공유 인스턴스).
- **승인 탭 재배치**: 결재 대기(최상단)→드래프트 CTA(드래프트 有=전환/無=생성, 옛 버전 행 자리)→승인 워크플로(접힘 섹션, 헤더에 StatusBadge — `ApprovalPanel hideHeader`로 중복 헤더 제거)→SP 지정→버전 카드. 체크아웃 UI는 draft 전용(rejected 제외 — Withdraw가 draft 복귀+체크아웃 재부여라 막다른 상태 아님).
- **협업자 클램프**: 개인(user) 그룹만 4행 초과 시 3.3행(177px, `clamp-size` 재사용) + 전체 펼치기/접기 토글.
- **SP 카드 버튼 행 통합**: 지정 버튼(`Workflow` 아이콘)+우측 정렬 게시본 가기(`ArrowRight`)/등록 요청(`BadgeCheck`) 한 행, reason은 순수 노트로. R10 계약 무변경.
- 최종 리뷰 Critical 픽스: 접힘 전환으로 `PendingApprovalsPanel` 언마운트→카운트 배지 0 고정 회귀 — 패널 상시 마운트+완전 접힘만 `hidden` 3분기로 복원. QA `## R6` 7항목+문구 교정 3건. 게이트: BE pytest 1042·ruff 0 / FE vitest 620·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 R5: 멤버 행 Remove 필 폴리시 (feat/governance-r5 → dev 머지)
- 사용자 피드백 5건 일괄: 스왑 크기 불변(고정폭 `w-[60px]`을 RoleBadge 신설 `className` prop으로 — `min-w-[72px]` wrapper 폐기)·X 아이콘 제거(문구만)·`invisible`→opacity 페이드(`duration-150`)·행 루트 `group`→`group/member`(인스펙터 `<details.group>` 조상 누수로 전 행 동시 스왑되던 버그 해소)·제거 예정 태그를 소속 줄 우측 2행으로 분리(권한 필 유지, 취소 X 공간 예약+hover 페이드 인). EN `perm.staged.remove` "To remove"→"Remove"(60px 폭 맞춤).
- 브라우저 실측 검증(Playwright+Chrome): bounding box 0px 이동·인스펙터 1행만 스왑·전 역할 우측 정렬 일치. QA R4-4 교정+`## R5` 4항목. 게이트: FE vitest 620·lint 0 error·tsc 0·build OK(백엔드 무변경).

## 2026-08-13 — 거버넌스 R4: 가시성 UX 4건 (feat/governance-r4 → dev 머지)
- **승인자 모달 가시성 배지**: 승인자 관리 모달 우측 상단에 현재 가시성 배지(Globe/Lock, 라이브 state 스레딩).
- **동봉 픽커 드롭다운화**: pill 행 → "공개 범위"(EN "Visibility") 라벨 + 우측 드롭다운(아이콘·current 옵션에 리터럴 "Current" 필). 계약 불변(재선택=해제 포함) — 3표면 배선 무변경. `perm.visibilityCurrent`는 visibility-control 사용처 잔존으로 유지.
- **인스펙터 가시성 3:1 + 워크플로 모달**: 3:1 그리드는 전원 공통, 전환 클릭만 오너 전용 → ConfirmDialog(현재→대상·승인자 이름 필·0명이면 confirm 비활성·조회 실패는 별도 에러) → `requestVisibilityChange`, 409는 humanize+pending 재조회. mapId 전환 시 모달 상태 강제 리셋(stale target 방지). ConfirmDialog `dialogId` optional prop(타 호출부 무변화).
- **멤버 행 제거 hover 스왑**: 카드/인스펙터의 제거 X 폐기 → RoleBadge 자리에 hover/focus 시 빨간 Remove 필 스왑(min-w 72px 실측, opacity/pointer-events 토글로 Tab 도달 유지 — 구 X의 focusable-invisible 결함도 해소). 설정 패널은 select UX 유지·X만 absolute 전환+`pr-8` 공통화로 정렬 교정(사용자 확정 범위).
- QA `docs/qa/governance-ux-checklist.md` R4 섹션 5항목(최종 리뷰가 문구 2건 교정 — 배지 표면·스택 적립 동작). 게이트: BE pytest 1042·ruff 0 / FE vitest 620·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 R3: 후속 정비 6건 (feat/governance-r3 → dev 머지)
- R2 리뷰 이월분 정비: SP ⓘ 클릭이 접힘 토글 안 함(stopPropagation) · SP 등록 409 문구 i18n(`apiError.spDesignationPending`) · `stageRoleChange`로 원복 선택 시 staged op 소거(no-op 스택 방지, 협업자 패널 — 맵 카드는 role 변경 UI 없음) · 결재 대기 카운트에서 동봉 행 제외(`isBundledRow`, 목록 표시는 유지).
- **새 맵 모달 협업자 팝오버 통일**: `RolePopover`를 `role-popover.tsx`로 공용 추출(무변화 리팩터) 후 create-map-dialog도 클릭 위치 2-step 팝오버+하이라이트+추가 플래시로 전환(role select 폐기, 퍼블릭은 Editor만·2-step 유지). 고아 키 `collaboratorRoleViewerDisabled` 제거.
- **체크아웃 폴 중지**: 본인 강등 pending 409(`PERMISSION_PENDING_DETAIL_PREFIX` 단일 소스) 감지 시 인터벌 정지(첫 폴 실패는 생성 생략). 알려진 한계: pending이 반려로 해소돼도 자동 재개 없음(새로고침/버전 전환으로 재개) — 후속: focus 재시도. `checkout===null` readOnly 미강제는 cosmetic(서버 graph PUT이 비보유자 저장 거부) — 후속 후보.
- QA `docs/qa/governance-ux-checklist.md` R3 섹션 5항목. 게이트: BE pytest 1042·ruff 0 / FE vitest 620·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 R2: QA 피드백 반영 (feat/governance-r2 → dev 머지)
- **pending 가시성·복구**: 행 단위 pending 노출(`PermissionOut.pending_change`·`WorkflowStateOut.bundled_visibility`)로 요청자 아닌 유저에게도 승인 대기 태그(→role·요청자) 표시. `lib/api-errors.ts` `humanizeApiError`(서버 detail 전방일치 10종→i18n) 16개 catch 지점 — 409도 pending 재조회로 마커·철회 버튼 복구(막다른 상태 제거).
- **상호 배제**: 체크아웃 보유자·pending/approved 제출자 대상 권한 변경 차단(오너 직접 적용 포함) ↔ 본인 pending 다운그레이드 시 체크아웃·제출 차단(승인/반려는 무관).
- **전이 다이얼로그 공용화 + pill 동봉**: 버전 전이 5종 다이얼로그를 `components/version/`으로 추출해 설정 패널을 공용 전환(승인자 미표시 표면 드리프트 근본 해소). 동봉 UI는 체크박스→`VisibilityBundlePicker` pill로 3표면(에디터·패널·셀프 게시 팝오버) 통일, 승인 확인 모달에 동봉 변경 내용 공개.
- **스택 저장**: 권한 편집을 두 표면(협업자 패널·맵 카드)에서 적립+Save 일괄/Cancel 폐기(`lib/permission-staging.ts`). Save 부분 실패는 dismissible 인라인 배너(`stagedSaveError`) — 카드 생존(최종 리뷰 픽스).
- **홈/피커**: 맵 탭 협업자 기본 펼침 + 오너 섹션 정렬(`renderMemberRow` 공유, owner 행 불변식 유지). 협업자 추가는 클릭 위치 `RolePopover` 2-step(+선택 하이라이트·staged-add 플래시), `PrincipalPicker` coords/highlightId 하위호환 확장.
- **에디터/SP**: 승인 탭 하단 결재 대기 접이식 섹션+카운트 필(`PendingApprovalsPanel` 재사용). SP 안내 ⓘ 호버 툴팁화+카드 본문 기본 접힘(sessionStorage `bpm.inspector.spOpen`, 3마운트 공유). SP reason 행 액션 2종 — 게시본 가기(`switchVersion`)·등록 요청(pending이면 disabled+요청자/시각 툴팁, `disabledReasonKind` 분기).
- QA: `docs/qa/governance-ux-checklist.md` R2 섹션 16항목. 게이트: BE pytest 1042·ruff 0 / FE vitest 617·lint 0 error·tsc 0·build OK. origin/dev 2c3170e 푸시 완료.

## 2026-08-13 — 관리자 UX: 동기화 로딩·테이블 CSV (feat/admin-sync-csv → dev 머지)
- **인원 동기화 로딩**: sync 버튼 Loader2 스피너 + busy가 후속 재조회까지 커버(재조회 실패는 err.message로 전파 — 삼킴 제거).
- **관리자 테이블 CSV 내보내기**: 공용 `lib/csv.ts`(escapeCsvCell — **수식 인젝션 가드**('=+-@탭CR' 시작 셀 ' 접두, 보안 리뷰 반영)·buildCsv CRLF·downloadCsv BOM `\uFEFF` 이스케이프 접두) + `ExportCsvButton` → employees/departments/notices 3표(화면 동일 컬럼·전체 데이터). DB 테이블 뷰어는 신설 `GET /api/admin/tables/{name}/export`(sysadmin·read_table 미러·**PK 타이브레이커 정렬**·500행 스트리밍·JSON 셀 json.dumps·BOM 미부착)로 현재 정렬/필터 그대로 전체 내보내기 — 모든 원시 테이블 커버.
- **계약**: FE `escapeCsvCell` ↔ BE `_escape_csv_cell` 동치 유지(파리티 테스트로 고정), BOM 접두는 FE downloadCsv 단일 지점. 게이트: BE pytest 1036·ruff 0 / FE vitest 606·lint 0 error·tsc 0·build OK. origin 푸시 대기.

## 2026-08-12~13 — 거버넌스 UX 확장 4페이즈 (feat/governance-ux → dev 머지)
- **설계 재검토**(docs/design/2026-08-08-governance-ux-design.md 개정): 코드 실측으로 P0 선행 정비 신설, B 게이트 editor 확정, C는 red dot→count pill+top-nav 배지, 구현 순서 P0→C→B→A.
- **P0 라이프사이클 대칭화**: visibility/permission 요청에 중복 409·요청자 withdraw(DELETE /approval-requests/{id})·직접 적용 supersede(+알림), 소프트삭제 스윕 통일(_get_map_or_404·inbox block3·sysadmin 큐), 승인자0 409, FE pending 마커 새로고침 복원+철회 버튼.
- **C 승인 탭 통합**: per-map 목록 게이트 오너 확대(_assert_owner_or_approver), PendingApprovalsPanel 4종 전종+행별 결정권(rename/sp=오너·나머지=승인자), 좌측 레일·top-nav 인박스 pending 카운트 배지(InboxBadge 15s 폴링).
- **B 카드 멤버 편집**: AddCollaborator 추출 재사용, map-detail-card에 editor+ 게이트 추가/제거(owner·오우닝 부서 행 보호, 강등은 승인 경유+pending 배지).
- **A 게시 동봉**: submit에 to_visibility 동봉(SubmitIn, payload.version_id 링크 — DDL 무변경) → 버전 만장일치 편승, publish 시 _apply_request 재사용 적용, reject/withdraw/delete_version 연쇄 종결, 직접 decide·withdraw 409, standalone pending은 동봉이 supersede. FE 3표면(에디터 모달·설정 패널·셀프 게시 팝오버) 체크박스 — **오너 전용**(최종 리뷰가 에디터 우회 적발→게이트 봉쇄), 결재 대기 행은 "Decided with version approval" 읽기전용.
- **최종 전체 리뷰**(opus)에서 Critical 1(동봉 오너 게이트 우회)+Important 3(범용 철회·sysadmin 큐·approved 버전 삭제 고아화) 적발→픽스웨이브로 봉쇄. QA: `docs/qa/governance-ux-checklist.md`(P0 7·C 5·B 5·A 11·회귀 4). 게이트 최종: BE pytest 1028·ruff 0 / FE vitest 599·lint 0 error·tsc 0·build OK. 사용자 실검증(9910)·origin 푸시 대기.

## 2026-08-12 — 9910 검증 반영 + 관리 탭 후속 2종
- 검증: 멱등 재실행·카테고리 관리·홈 노출·회귀 스팟 사용자 확인 완료(잔여: CM-PUR-001 연계 SP 노드 1건). 오우닝 부서장 자동핀은 **보류 결정**(현행 유지).
- **Move 모달 트리화**: 캐스케이드 → 지정 모달과 동일한 조직도식 트리(루트 행·자기 서브트리 숨김·깊이 초과 위치 비활성·잔여 422는 인라인 표시 — 블러 뒤 토스트 안 보이던 문제 해소). category-cascade 헬퍼 완전 폐기.
- **삭제 묶음 정책**: 서브트리에 연결 맵 1개라도 있으면 409, 없으면 하위 카테고리까지 통째 삭제. 게이트 BE 997·FE 598·admin 스모크 11/11·move 검증 8/8.
- **묶음 삭제 500 픽스(9910 실측)**: ORM 개별 delete는 플러시 순서 비보장 → 부모 선삭제 시 Postgres 자기참조 FK 즉시 강제로 IntegrityError(sqlite는 FK 미강제라 로컬 무재현). 레벨 역순 명시적 벌크 DELETE로 교체, 3레벨 회귀 테스트.

## 2026-08-08~12 — 컨설턴트 전사 체계 수용 + 홈 프레임워크 UX (feat/consultant-hierarchy → dev 머지·푸시)
- **Phase 1**(스키마·canonical 파서·멱등 임포트 엔진+CLI — uuid id+`source_node_id` 계보, 부분 재전달 연계 승계) → **Phase 2**(카테고리 lazy API·홈 Framework 토글+트리·상세 뱃지/I/O·연결/이양) → **Framework 관리 탭**(카테고리 CRUD+웹 JSON 대량 임포트 — 이제 기본 경로, 재임포트 시 전체 level BFS 재계산) → **홈 뷰 UX**(검색/필터 공유·원클릭 캐스케이드·펼침/리스트 영속·틴트 박스·3.5 클램프(숨김 스크롤바·내부 스크롤)·펼침/접힘 애니(고스트 렌더)·스티키 헤더·카드 이름 클릭=선택+호버 Open) → **지정 모달 조직도식 트리**(리프만 선택) → 상세 카테고리 필 최상단 행.
- 조직 기준 전환(dept_info→departments·EDW 직책) 후속 통합 — `import_consultant`를 orgchart resolver로 정합(피커·검증과 단일 소스), 9910 픽스(has_org_info·한/영 트리·단절 체인 폴백 등).
- 게이트 최종: BE pytest 997·ruff 0 / FE vitest 600·tsc·lint 0·build OK / 실브라우저 스모크 framework 25/25·home-dept 23/23·admin 11/11·지정 모달 6/6. **웹 임포트·슬롯 이양 사용자 실검증 완료(2026-08-12).** 남은 것: `docs/qa/dev-vs-main-checklist.md` 미체크 4항목 → main 머지·운영 배포.

## 2026-08-10 — 사용자·조직도 소스 교체(AD→n8n HR 웹훅, dev 머지)
- employees 단일 소스를 AD→n8n HR 웹훅으로 교체(`app/hr/` 클라이언트+sync 코어+내장 스케줄러), LDAP은 title 전용 패스로 축소. 퇴직자 active=false+피커/디렉터리 제외, email 모델 제거(운영 NOT NULL 완화 부트스트랩), departments 미러 신설, 드라이런 프리뷰+삭제 20% 상한 가드. 잔여 후속은 체크리스트 백로그 1~6.

## 2026-08-04 이전
- 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-08-12 이동분 포함) + git history.

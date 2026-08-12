# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-08-13 — 거버넌스 A 게시 동봉 (feat/governance-ux)
- **QA 체크리스트**: `docs/qa/governance-ux-checklist.md` 신설 — 4페이즈 사용자 실검증 항목(P0 7·C 5·B 4·A 9·회귀 4) + docs/README 인덱스 등록.
- **A 완결 게이트**: BE pytest 1023·ruff 0 / FE vitest 599·lint 0 error·tsc 0·build OK. 승인요청 3표면(에디터 모달·설정 패널·셀프 게시 팝오버)에서 가시성 변경을 동봉하면 버전 만장일치에 편승해 publish 시 적용, reject/withdraw 시 함께 종결(부분 승인 없음·직접 decide 409).
- **Task A1 완결 게이트**: BE pytest 1017·ruff 0 / 신규 test_version_bundle.py 4건 전부 PASS. `SubmitIn` 스키마(to_visibility optional), `submit_version` 함수가 bundle payload 수용(동봉 가시성 변경을 버전 결정에 병합)·단독 pending 요청 supersede·approval_requests 생성(version_id 링크).
- **Task A2 완결 게이트**: BE pytest 1023·ruff 0 / test_version_bundle.py 신규 6건 전부 PASS. `_find_bundled_visibility` 헬퍼 + publish·reject·withdraw·decide·inbox 5 표면 동봉 처리(연쇄 적용·종결·409 직결정·박스 제외). 원형 import 확인: permissions.py→versions.py 의존 없음, 함수-로컬 import 안전. supersede query 단독 요청만(version_id None 필터) 대체, 다른 버전의 동봉 간섭 원천차단.
- **Task A3 — FE 승인요청 모달 동봉 체크박스**: `submitVersion(id, toVisibility?)`(FE) + `ConfirmDialog` `children` 슬롯(순수 추가 prop) + page.tsx 승인요청 모달에 체크박스(반대 가시성 target 표시). page.tsx가 `getMap` 결과에서 visibility를 담는 state가 원래 없어(mapName/mapMode 등만 있었음) `mapVisibility` state 신설. `t(key, vars)`는 이미 `{name}` 치환 지원 확인(`perm.toastGatedBy` 선례) — 두 키 분리 불필요. 게이트: FE vitest 598·lint 0 error·tsc 0·build OK.
- **Task A4 — FE 셀프 게시 체인 + 설정 패널 표면**: `runSelfPublishChain(id, toVisibility?)` 확장, `SelfPublishPopover`에 `bundleLabel?` prop(체크박스 렌더, `onYes(bundleVisibility)`)로 시그니처 확장 — 사용처 2곳(에디터 page.tsx·versions-publish-panel.tsx) 동시 갱신. `VersionsPublishPanel`은 버전당 `VersionRow` 하위 컴포넌트 구조라 `submitConfirmOpen`/`bundleVisibility` state를 행(row) 단위로 배치(versionId가 이미 프op 스코프라 panel 단위 `submitConfirmFor` 불필요), `visibility` prop을 panel→row로 스레딩·settings/page.tsx가 기존 `visibility` state를 전달. 직접 submit 버튼을 ConfirmDialog(A3 children 슬롯 재사용) 경유로 전환. 회귀 발견: `runSelfPublishChain` 시그니처 변경으로 기존 `self-publish.test.ts`의 `submitMock` 인자 단언(`toHaveBeenCalledWith(7)`)이 `(7, undefined)`로 어긋나 수정 + 동봉 케이스 신규 테스트 1건 추가. 게이트: FE vitest 599·lint 0 error·tsc 0·build OK.
- **Task A5 — FE 결재 대기 패널 동봉 행 표시**: `PendingApprovalsPanel`에서 동봉 행(kind='visibility_change'·version_id 링크)을 읽기전용으로 표시 — `isBundled` 판정 후 버튼 조건부에 우선 이상(canDecideKind 위에). i18n `bundledWithVersion` EN/KO 2키 추가. 게이트: FE vitest 599·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 B 카드 멤버 편집 (feat/governance-ux)
- **B 완결 게이트**: BE pytest 1013·ruff 0(무변경 확인) / FE vitest 598·lint 0 error·tsc 0·build OK. 홈/에디터 맵 카드에서 멤버 추가·제거가 설정 화면과 같은 규칙(승격 즉시·강등 승인 경유)으로 가능.
- **Task B1 — AddCollaborator 컴포넌트 추출**: `collaborators-panel.tsx`의 로컬 `AddCollaboratorForm`(+어댑터 `toPickerGroups`)을 `add-collaborator.tsx`로 순수 이동, `export function AddCollaborator`로 승격(맵 상세 카드 재사용 준비, Task B2). 동작·마크업 무변경. 게이트: vitest 598·lint 0 error·tsc 0·build OK.
- **Task B2 — 맵 상세 카드 멤버 추가/제거 배선**: `map-detail-card.tsx`에 `canManageMembers`(editor+) 게이트로 행별 제거 버튼(owner 행·오우닝 부서 synthetic 행 제외, `e.stopPropagation()`) + pending 배지(RoleBadge) + 하단 `AddCollaborator` 추가 행을 배선(협업자 패널과 동일한 addMapPermission/removeMapPermission·pending 규칙, `localReloadKey` 재조회). 게이트: vitest 598·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 C 승인 탭 통합 (feat/governance-ux)
- **C 완결 게이트**: BE pytest 1013·ruff 0 / FE vitest 598·lint 0 error·tsc 0·build OK. 결재 대기 탭이 4종 전종을 다루고(행별 결정권=서버 게이트와 일치), 좌측 레일·top-nav 인박스에 pending 카운트 배지.
- **Task C1 — 결재 목록 게이트 오너 확대**: `GET /api/maps/{map_id}/approval-requests`를 오너(비승인자)에게도 허용 — `_assert_owner_or_approver` 헬퍼 신설, `list_approval_requests` 런타임 판정 전환. rename/sp 결정권자인 오너가 통합 결재 대기 탭을 보기 위한 전제. 테스트 2건 추가, pytest 1013·ruff OK.
- **Task C2+C3 — 결재 대기 탭 4종 통합 + 레일 배지**: `PendingApprovalsPanel`을 permission_downgrade/visibility_change/map_rename/sp_designation 4종으로 확대, 행별 결정권(`canDecideKind` — rename/sp는 오너, 나머지는 승인자) + `onCountChange` 콜백. 설정 페이지는 `canSeeApprovals = canDecide || isOwner`로 탭 게이트 확대하고 좌측 레일에 pending 카운트 배지 추가. i18n 4키(EN/KO). 게이트: vitest 598·lint 0 error·tsc 0·build OK.
- **Task C4 — top-nav 인박스 카운트 배지**: `InboxBadge` 신설 컴포넌트(`src/components/inbox-badge.tsx` — `listInboxApprovals` 15s 폴링, notification-bell 선례), top-nav NAV_TABS 인박스 탭에 조건부 렌더. 게이트: vitest 598·lint 0 error·tsc 0·build OK.

## 2026-08-12~13 — 거버넌스 P0 선행 정비 (feat/governance-ux)
- **P0 완결 게이트**: BE pytest 1011·ruff 0 / FE vitest 598·lint 0 error·tsc 0·build OK. visibility/permission 승인 요청이 rename/sp와 대칭(중복 409·withdraw·supersede)이 됐고 소프트삭제 유령 pending·승인자0 데드락 해소 — A(게시 동봉)·C(승인 탭 통합)의 전제 충족.
- **Task 1 — visibility_change 요청 가드 3종**: 무변경 422(`to_visibility == current`) · 중복 409(pending 요청 존재) · 승인자0 409(`load_active_approvers` 결과 공집합). 기존 permission 테스트 6건 회귀 확인(approver 시드 추가+test_auth_off_management_open 승인자 inline 추가). 게이트 59/59.
- **Task 2 — permission_downgrade 중복 409**: `_find_pending_downgrade` 헬퍼(payload 필터링)로 같은 grant 대상 pending 다운그레이드 요청 감지, PATCH/DELETE 중복 제출 시 409 차단. grant 단위 격리(다른 grant은 영향 無). TDD 테스트 2건 추가·pytest 1002·ruff OK.
- **Task 3 — 오너 직접 적용 시 pending 다운그레이드 supersede**: `_supersede_pending_downgrades` 헬퍼로 update_permission/delete_permission/transfer_owner 3곳에서 pending 다운그레이드를 무효화+요청자 알림(permission_superseded type). TDD 테스트 3건·workflow.create_notifications 활용.
- **Task 4 — pending 가시성 요청 peek + 요청자 철회**: GET `/maps/{map_id}/visibility-requests/pending`(viewer 게이트)·DELETE `/approval-requests/{request_id}`(요청자 전용, permission_downgrade/visibility_change 한정, pending→withdrawn). 중복 가드 해제로 철회 후 재요청 가능. TDD 테스트 3건 추가, pytest 1008·ruff OK.
- **Task 5 — 소프트삭제 스윕 통일**: `_get_map_or_404`에 `deleted_at` 체크 추가(권한/가시성/승인목록 전부 404, rename 선례와 대칭), `_apply_request`의 downgrade·visibility_change 분기에 삭제 맵 멱등 가드, sysadmin 전역 큐(`list_pending_approval_requests`)·inbox block 3에 `ProcessMap.deleted_at.is_(None)` 필터 추가. TDD 테스트 3건 추가, 기존 회귀 없음(전체 그린) — pytest 1011·ruff OK.
- **Task 6 — FE pending 마커 복원 + 철회 버튼**: `visibility-control.tsx`의 `pending` state를 `pendingReq: ApprovalRequest | null`로 승격, 마운트 시 `getPendingVisibilityRequest`로 서버 pending 복원(새로고침 유지) + `withdrawApprovalRequest`로 철회 버튼(오너 전용) 연결. api.ts 2함수 추가(`getPendingRenameRequest` 패턴 미러)·i18n 2키(EN/KO). 게이트: vitest 598·lint 0 error·tsc 0·build OK.

## 2026-08-12 — 거버넌스 UX 설계 재검토 반영
- 코드 실측 재검토로 설계 문서 개정: **P0 선행 정비 신설**(visibility/permission 라이프사이클 대칭화·소프트삭제 스윕 통일·승인자 0명 데드락 409), A 배선 표면 3곳+withdraw 연쇄, B 게이트 editor 기준 확정, C는 red dot→count pill+top-nav inbox 배지. 구현 순서 P0→C→B→A 확정.

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

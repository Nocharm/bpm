# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-08-13 — 거버넌스 R4: 가시성 UX (feat/governance-r4)
- 승인자 관리 모달 우측 상단에 맵 현재 가시성 배지 추가(Globe/Lock 아이콘, perm.visibilityPublic/perm.visibilityPrivate i18n).
- U2 동봉 픽커 재설계: pill 행 → 라벨("Visibility"/"공개 범위") + 우측 드롭다운(Globe/Lock/ChevronDown, current 옵션엔 리터럴 "Current" 필). 3 사용처(에디터·패널·셀프 게시 팝오버) 배선 무변경, `perm.visibilityCurrent`는 `visibility-control.tsx`가 여전히 써서 유지.
- U3 인스펙터 맵 탭 가시성 3:1 + 워크플로 시작 모달: 4열 그리드(현재 3열+전환 1열 아이콘)는 전원 공통 레이아웃, 전환 클릭 인터랙션(버튼+모달)만 오너 전용(비오너는 같은 3:1 지오메트리를 정적 `<div>`로). 전환 클릭 → `ConfirmDialog`(승인자 이름 필 목록+0명 경고로 confirm 비활성, 조회 실패는 별도 에러로 구분) → `requestVisibilityChange`, 409는 `humanizeApiError`+pending 재조회로 복구(막다른 상태 금지). mapId 전환 시 모달 상태 강제 리셋(링크맵 열기 등 stale target 방지). `ConfirmDialog`에 선택적 `dialogId` prop 추가(기존 호출부 전부 기본값 유지, 무변화).
- U4 카드 멤버 행(`map-detail-card.tsx`): 제거 X버튼 폐기 → RoleBadge 자리에 hover/focus 시 같은 자리·크기의 빨간 Remove 필로 스왑(`min-w-[72px]`, Remove ×의 Pretendard 실측폭 69.2px 기준으로 Viewer/Editor보다 좁을 때 잘림 방지). 버튼은 opacity/pointer-events 토글(=Tab 순서 유지, `focus:`/`group-focus-within:`로 키보드 도달) — display 토글은 부서/그룹 행처럼 상위 tabIndex 없는 행에서 키보드로 영영 못 여는 회귀라 배제. 설정 패널(`collaborators-panel.tsx`)은 select UX 그대로, X만 같은 opacity 패턴으로 absolute 전환(행 `pr-8` 공통화로 뱃지/select 우측 정렬 통일) — 선택 UX 변경 없음(사용자 확정 범위).
- **U5 최종 게이트 + QA R4 + PROGRESS 마감**: BE 1042·FE 620·lint 1 warning / QA `docs/qa/governance-ux-checklist.md` R4 섹션 5항목(승인자 배지·동봉 드롭다운·인스펙터 3:1 모달·카드 제거 hover 스왑·패널 X 정렬).

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

# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-08-14 — 협업자 스테이징 UX 구현 (fix/frontend-minor)
- **T1 BE request_id** — `PendingChangeOut.request_id` 필드 신규 추가(요청자 본인 철회 용). schemas.py 184·permissions.py 117-120 수정, test 1216-1254 assert 강화(pending 생성 응답 req_id 캡처 추가). TDD: RED(assert 실패 `request_id` 미노출) → GREEN(1042 tests passed, ruff clean).
- **T2 FE forecastStagedOp** — 권한 op별 즉시/승인 예측 함수(BE `requires_downgrade_approval` 미러). permission-staging.ts에 `forecastStagedOp(op, grantRole, actorIsOwner): "instant" | "approval"` 추가, 5개 test case(add·viewer→editor·editor→viewer·remove·owner) 전부 green. TDD: RED → GREEN(15 tests passed, tsc clean).
- **T3 FE applyStagedOps records** — 저장 결과 상세 레코드(되돌리기 재료). `AppliedOpRecord` interface 신규, `StagedResult.records` 필드 추가(outcome + createdPermission/approvalRequest/prev 스냅샷), `applyStagedOps` 시그니처 `permsById?: Map<number, MapPermission>` param 신규. 호출부 2곳 업데이트(collaborators-panel·map-detail-card)에서 permsById 전달. TDD: RED(records undefined) → GREEN(17 tests passed, 620 전체 시험, tsc/lint 0 error).
- **T4 설정 협업자 패널 예고·중복픽스·호버캔슬·회수** — 공용 `HoverSwapPill`(hover-swap-pill.tsx) 신규, i18n 5키(forecastInstant/Approval·cancelPill·pending.withdraw/withdrawDone) EN·KO 양쪽 추가, `MapPermission.pending_change`에 `request_id` 타입 반영. `collaborators-panel.tsx`: 역할 배지 pending prop 제거(실제 role 상시 표시, 배지 pending 중복 소거), pending 상세 태그는 본인 요청이면 HoverSwapPill로 회수(`withdrawApprovalRequest`), 스택 태그는 X버튼 대신 HoverSwapPill+forecast 아이콘(Zap/Hourglass, `forecastStagedOp` 사용)로 교체(행 태그·staged-add 고스트 행 양쪽). 패널에 `isOwner` prop 신규(settings/page.tsx에서 전달). 게이트: vitest 627 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T5 맵 카드(홈 미리보기·에디터 맵 탭) 동일 4종** — `map-detail-card.tsx`에 T4와 동일 패턴 적용: 역할 배지 `pending` prop 제거+고정폭(`ROLE_PILL_WIDTH_CLASS`) 상시 적용(중복 pending 표시 픽스), `removable`에 `!perm.pending_change` 추가(pending 행은 Remove 어포던스 자체를 닫음 — 쌓으면 저장 시 서버 409), pending 상세 태그는 본인 요청(`loginId` 일치)이면 HoverSwapPill로 회수, 스택 제거 태그·staged-add 태그 모두 X버튼 제거하고 HoverSwapPill+forecast 아이콘(`forecastStagedOp`)로 교체(제거 태그는 아이콘 포함폭이 60px를 넘어 이 필에서만 `min-w-[60px]`로 완화, 공유 상수는 불변). `handleWithdrawPending` 신규: 카드엔 `onToast`가 없어 기존 저장 핸들러와 동일한 재조회 경로(`setLocalReloadKey`)로 반영, 에러는 기존 `stagedSaveError` 배너로 노출(패널의 onToast와 다른 채널). 게이트: vitest 627 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).

## 2026-08-14 — 협업자 스테이징 UX 7종 설계 스펙 (fix/frontend-minor)
- **구현 플랜**: `docs/superpowers/plans/2026-08-14-collab-staging-ux.md` — 9태스크(TDD·태스크당 커밋·게이트 명시, 브라우저 검증은 Task 9 일괄). 실측 앵커: BE `PendingChangeOut`(schemas.py:184)·pending 직렬화 단일 지점(permissions.py:117)·카드 60px 필 공유 지오메트리·측정 복제 기반 필터 모드 판정.
- **설계 확정·문서화**: `docs/superpowers/specs/2026-08-14-collab-staging-ux-design.md` — ① 스테이지 필 즉시/승인 예고(Zap/Hourglass, FE forecast 미러) ② pending 필 중복 렌더·고정폭 깨짐 픽스 ③ 스테이지 필 호버 캔슬 전환(X버튼 제거) ④ pending 회수(BE `PendingChangeOut.request_id` 추가+기존 철회 API) ⑤ 변경적용→되돌리기(직전 1회 메모리, 확인 모달+역방향 예고) ⑥ 오우닝 부서 피커 조직도 브라우즈(내 부서 3개 고정+들여쓰기 트리) ⑦ 홈 필터 필 3단계 반응형(full/label/icon, 실측 기반). 구현은 `fix/frontend-minor` 워크트리에서.

## 2026-08-14 — 승인 워크플로 코멘트 + 에러 인간화 설계 스펙 (dev 직접)
- **설계 확정·문서화**: `docs/superpowers/specs/2026-08-14-approval-comments-design.md` — ① Group A(~50곳) 원시 JSON 에러 humanizeApiError 전수 스윕(폴백에만 HTTP 코드) ② 거절 배너 재디자인(거절자 필+사유) ③ 전이 모달 4종 선택 코멘트(`VersionEvent.note` 재사용, 스키마 무변경 — 바로철회 시 자동 동반 삭제) ④ 버전 카드 코멘트 보기 모달(클릭점→중앙 확대, 바깥 mousedown 닫힘) ⑤ 받은함 거절 사유 유실 버그 픽스(`ApprovalRequest.decision_reason` 컬럼). 구현은 `feat/approval-comments` 워크트리에서.
- **구현 플랜**: `docs/superpowers/plans/2026-08-14-approval-comments.md` — 9태스크(TDD·태스크당 커밋·게이트 명시). 실측 보강: 받은함 비버전 거절은 사유 입력란 자체가 부재(`isVersion` 게이트)·approve 이벤트는 승인자별 기록·에러 틴트는 `border-error/40 bg-error/10` 기존 패턴 재사용.

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

# 거버넌스 UX 확장 — 게시 모달 가시성 동봉 · 맵 카드 권한 편집 · 승인 탭 통합

> 2026-08-08 브레인스토밍 확정 · **2026-08-12 코드 실측 재검토 반영**(선행 정비 P0 추가, A/B/C 세부 확정). 컨설턴트 체계 이양([`2026-08-08-consultant-hierarchy-design.md`](2026-08-08-consultant-hierarchy-design.md)) 후 오너 수백 명이 유지보수를 시작하면 필요해지는 승인 체계 UX 확장. **임포트 파이프라인과 독립** — 별도 구현·배포 가능.

## P0. 선행 정비 — A·C의 전제 (2026-08-12 실측에서 드러난 결함)

ApprovalRequest kind 4종(`permission_downgrade`·`visibility_change`·`map_rename`·`sp_designation`) 간 기능 비대칭 — rename/sp에는 있는 안전장치가 visibility/permission에 없다.

1. **라이프사이클 대칭화** — `visibility_change`·`permission_downgrade`에 중복 pending 가드(409)·withdraw(요청자 회수)·supersede를 추가(rename의 `_supersede_pending_rename` 패턴). 현재는 같은 맵에 pending이 무한히 쌓이고 회수 불가. A의 "visibility_change 자동 생성" 방식이 설정 화면 가시성 스테이징(`visibility-control.tsx`)의 standalone pending과 충돌하지 않으려면 **dedupe+supersede가 A의 전제조건**.
2. **소프트삭제 스윕 통일** — `permissions.py` `_get_map_or_404`가 `deleted_at`을 안 봐서 삭제된 맵에도 visibility 요청·권한 변경·승인 목록 조회가 성공하고, inbox block 3(visibility/permission)에 유령 pending이 남는다(rename/sp block 4·5는 필터됨). `_get_map_or_404` 404 처리 + inbox block 3 필터 + sysadmin 전역 큐(`GET /api/approval-requests`)도 동일 필터.
3. **승인자 0명 데드락 해소** — 버전 submit은 승인자 0명이면 409(`versions.py`)인데 visibility-request는 무조건 pending 생성 → 승인자 없는 맵의 비-sysadmin 오너는 가시성을 영원히 못 바꿈. 동일한 409 가드 추가.

## A. 게시 전이 모달에 가시성 변경 동봉

- 게시/승인요청 전이 모달에 **"가시성 변경 포함" 옵션**(public↔private 선택) 추가 → 승인자가 버전 전이와 가시성 변경을 **한 번의 결정으로** 승인.
- 정책 정합: `visibility_change`는 오너도 항상 승인 필요(2026-08-07 확정 정책 — 오너 스킵 재제안 금지). 동봉은 스킵이 아니라 **두 승인의 병합**이므로 정책 위반이 아님 — 결정권자는 여전히 승인자/sysadmin.
- **두 체계는 완전 분리돼 있음(실측)**: 버전 워크플로(`MapVersion.status`+`VersionApproval` — 승인자 **만장일치**, publish는 제출자만)와 ApprovalRequest(**선착 1인** decide)는 테이블·상태 enum·decide 핸들러를 공유하지 않고, `ApprovalRequest`에 `version_id` 컬럼도 없다. 구현 방향(플랜에서 확정): ① `ApprovalRequest`에 `version_id` 연계를 추가해 visibility_change 요청을 자동 생성·버전 결정에 종속시키거나, ② 버전 submit payload에 동봉 정보를 담고 publish 시 `_apply_request` 동등 로직으로 연쇄 적용.
- **동봉 가시성은 버전 만장일치 규칙에 편승** — 단독 요청(1인 decide)보다 엄격해지는 방향이므로 정책 위반 아님. 명시적으로 이 의미론을 채택한다.
- 반려 시 둘 다 반려(부분 승인 없음) + **withdraw 연쇄**: 버전 회수(pending/approved/rejected→draft) 시 동봉 가시성도 `withdrawn` 처리.
- **배선 표면 3곳**: 에디터 submit 확인 모달(ConfirmDialog), 설정 화면 `versions-publish-panel`(독립 구현 — 동일 옵션 필요), **셀프 게시 팝오버 체인**(`runSelfPublishChain` submit→approve→publish, 에디터+설정 2곳 존재) — 셀프 체인 종단에서 동봉 가시성도 함께 적용.

## B. 맵 상세 카드에서 에디터·뷰어 목록 편집

- 홈 Maps 탭 **맵 상세 카드의 기존 멤버 목록**(`map-detail-card.tsx` — 현재 read-only)에 편집 배선 추가 — 에디터·뷰어(비공개맵의 열람 게이트)를 추가/제거. 에디터 내 설정 화면까지 들어가지 않아도 관리 가능.
- **노출 게이트는 백엔드 기준(editor)** — 오너/sysadmin뿐 아니라 에디터도 편집 가능(2026-08-12 확정). 백엔드 PATCH/DELETE 게이트가 이미 `editor`이고, 강등/제거는 어차피 `permission_downgrade` 승인 경유(오너 스킵 정책 그대로), 추가(승격)=즉시.
- 기존 설정 화면(협업자 패널)과 **같은 권한 API 배선 재사용**(`addMapPermission`/`changeMapPermission`/`removeMapPermission` + `PermissionMutationResult.pending` 분기) — 표면만 추가, 규칙 이원화 금지.
- **오우닝 부서 파생 행은 편집 대상 제외** — 카드·협업자 패널 양쪽 다 synthetic locked 행(권한 행 삽입 금지 불변식 유지).
- **pending 마커 대칭**: downgrade pending을 멤버 행 마커로 표시하되, 카드에 넣으면 협업자 패널에도 동일하게 넣는다(현재는 토스트 `toastGatedBy`뿐이라 두 표면이 불일치하게 됨).
- 카드 사용처 3곳(홈 인라인 아코디언·홈 사이드 패널·에디터 Map 탭 `only="members"`) 공통으로 편집 후 reload 배선.

## C. 승인 탭 통합 + pending 카운트 배지

- 설정 화면 결재 대기 탭(`PendingApprovalsPanel` — 현재 `permission_downgrade`·`visibility_change` 2종만 필터)을 **ApprovalRequest 4종 전종**으로 확대. 각 항목에서 바로 승인/반려.
- **kind별 결정권자가 다름(실측)**: rename/sp_designation=오너(or sysadmin), permission/visibility=승인자(or sysadmin) → 행별로 결정 가능 여부를 계산하고, 결정 불가 행은 읽기전용 노출.
- **탭 노출 게이트 확대**: 현재 `canDecide`(승인자/sysadmin)만 → **승인자 OR 오너**로. 안 그러면 승인자가 아닌 오너는 rename pending을 못 본다. per-map 목록 API(`GET /maps/{id}/approval-requests`, 현재 approver 전용 게이트)도 동일 완화.
- **red dot → accent count pill로 변경(2026-08-12 확정)**: 코드베이스에 빨간 닷 패턴 없음(`bg-error`는 파괴 버튼 전용), 기존 선례는 count pill(inbox 탭 라벨·관리자 설정 좌측 레일). 결정권자 기준 pending 존재 시 탭 라벨에 카운트 pill.
- **top-nav `/inbox` 배지 추가(2026-08-12 채택)**: 전역 표면 — `notification-bell` 5초 폴링 선례에 편승. pending 카운트 소스 필요: 신규 count 엔드포인트 또는 `GET /api/inbox/approvals`에 count 모드(현재는 전체 목록을 받아 클라이언트가 세야 함).
- A의 동봉 승인도 이 목록에 단일 항목(버전+가시성)으로 나타난다.

## 백로그 (낮은 우선순위 — 이번 트랙에 비포함)

- `DecisionIn`에 반려 사유 필드 — 버전 reject(사유 필수)와 대칭, 반려 알림에 사유 동봉.
- status 어휘 정리: approve 경로는 `applied`를 기록하고 `approved`는 선언만 존재 — 새 코드가 `approved`를 가정하지 않도록 최소 문서화.
- decide에 요청자 본인 제외 없음(승인자면 셀프 승인 가능) — 셀프 게시 팝오버 선례상 허용 유지, 정책만 명시.

## 구현 메모

- 구현 순서(2026-08-12 확정): **P0 선행 정비 → C(조회+배지, 최저 비용·즉효) → B(표면 추가) → A(두 체계 연결, 최대 규모)**. 각각 독립 커밋 가능.
- 백엔드는 ApprovalRequest kind 체계가 이미 있으나, P0 대칭화·스윕이 선행돼야 조회 API+FE 작업으로 끝난다. A만 decide/publish 연쇄 적용 로직 추가.
- 우선순위는 컨설턴트 이양 시점(오너 대량 발생) 전 완료가 목표.

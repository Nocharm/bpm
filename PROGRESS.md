# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-08-12 — 거버넌스 P0 선행 정비 Task 1·2·3·4 (feat/governance-ux)
- **Task 1 — visibility_change 요청 가드 3종**: 무변경 422(`to_visibility == current`) · 중복 409(pending 요청 존재) · 승인자0 409(`load_active_approvers` 결과 공집합). 기존 permission 테스트 6건 회귀 확인(approver 시드 추가+test_auth_off_management_open 승인자 inline 추가). 게이트 59/59.
- **Task 2 — permission_downgrade 중복 409**: `_find_pending_downgrade` 헬퍼(payload 필터링)로 같은 grant 대상 pending 다운그레이드 요청 감지, PATCH/DELETE 중복 제출 시 409 차단. grant 단위 격리(다른 grant은 영향 無). TDD 테스트 2건 추가·pytest 1002·ruff OK.
- **Task 3 — 오너 직접 적용 시 pending 다운그레이드 supersede**: `_supersede_pending_downgrades` 헬퍼로 update_permission/delete_permission/transfer_owner 3곳에서 pending 다운그레이드를 무효화+요청자 알림(permission_superseded type). TDD 테스트 3건·workflow.create_notifications 활용.
- **Task 4 — pending 가시성 요청 peek + 요청자 철회**: GET `/maps/{map_id}/visibility-requests/pending`(viewer 게이트)·DELETE `/approval-requests/{request_id}`(요청자 전용, permission_downgrade/visibility_change 한정, pending→withdrawn). 중복 가드 해제로 철회 후 재요청 가능. TDD 테스트 3건 추가, pytest 1008·ruff OK.

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

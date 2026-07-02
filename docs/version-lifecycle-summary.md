# Version Lifecycle & Approval — 구현 요약 (fix 참고용)

`feat/version-lifecycle` 브랜치에서 한 작업 정리. **나중에 픽스할 때 "어디를 봐야 하는지"** 빠르게 찾기 위한 레퍼런스.
분기점 `291f6d9`(R5 컷오버) 이후 53커밋. 설계 원본은 `docs/superpowers/specs·plans/2026-06-29-version-lifecycle-*`.

> 관련 규칙: 캔버스/에디터 함정은 `docs/lessons/`, 프론트 `grep`은 ugrep이라 `[mapId]` 대괄호 디렉터리 건너뜀 → `git grep`/`find` 사용. 타임스탬프는 KST(`backend/app/clock.now`, `frontend/src/lib/datetime`). id는 `genId()`(crypto.randomUUID 금지, 서버 평문 HTTP).

---

## 1. 버전 번호 · 상태(expired) — 라이프사이클 코어

- **채번**: `version_number`는 **게시(publish) 시** 맵별 max+1로 부여, 이후 불변. 미게시(draft/pending/approved/rejected)는 `null`.
  - `backend/app/routers/versions.py::publish_version` — 채번 + 직전 `published`를 `expired`로 강등(terminal, 승인 흐름 복귀 불가).
- **상태 상수**: `backend/app/workflow.py` (DRAFT/PENDING/APPROVED/PUBLISHED/REJECTED/EXPIRED), `is_editable_status`.
- **재게시**: `republish_version` — published/expired → 그래프 복제(`clone_graph`)한 새 draft + 생성자 체크아웃. 권한(editor+)을 **status보다 먼저** 검사(status leak 방지, `06d954a`).
- 프론트 상태 타입: `frontend/src/lib/version-status.ts`, 표시명: `version-name.ts::formatVersionMarker`(`v3`/`(Draft)v.4`)·`nextVersionNumber`(+vitest `version-name.test.ts`).
- **서버 배포**: `backend/app/db.py::_add_missing_columns`가 기동 시 `version_number`·`checked_out_from`를 자동 보강 → 운영 postgres 수동 ALTER 불필요.

## 2. 체크아웃(점유권)

- **모델**: `models.py` — `MapVersion.checked_out_by/at/from(provenance)`, `CheckoutRequest`(status pending/approved/rejected/withdrawn).
- **핵심 규칙 — 점유 이동은 draft 전용** (`e3255de`): 거절본이 홀더를 갖게 되면 회수 로직과 충돌하는 버그 때문에, 다음 3곳 + 프론트 모두 **draft에서만**:
  - `routers/checkout.py::request_checkout`(draft만) / `decide_checkout_request`(draft-only 게이트, approve 시 나머지 요청 자동거절) / `withdraw_checkout_request`(요청자 본인).
  - `routers/versions.py::transfer_checkout`(draft만, 홀더|오너|sysadmin, 대상 editor+).
  - 프론트 `approval-panel.tsx::checkoutInteractive = status==="draft"`.
- **주의**: 제출(submit) 시 `checked_out_by=None`으로 해제됨 → **pending/approved/rejected엔 홀더 없음**. 그래서 체크아웃 패널은 draft/rejected에서만 노출(`4d6897b`).
- 프론트 UI: `checkout-panel.tsx`(접이식, 보유자+provenance "N분 전"·요청자 카드 호버 결정/철회·빨간닷), `version/transfer-checkout-dialog.tsx`(검색 피커).
- 승인큐 3화면 노출: 에디터 승인탭 / `settings/page.tsx`(sysadmin) / `map-settings/checkout-requests-panel.tsx`(owner|sysadmin). 큐 컨텍스트(map/version)·이름 해석은 `admin/approval-queue.tsx`.

## 3. 승인 워크플로 · 회수

- 전이: `versions.py` submit/approve/reject/publish/withdraw. approve 전원 승인 시 자동 APPROVED, publish는 submitter만.
- **승인 후 거절 → Rejected 반영** (`f26a573`): `reject_version`이 거절자의 `VersionApproval` 삭제 + `get_workflow_state`가 `rejected_by`(rejected일 때 최근 'rejected' 이벤트 actor) 노출. 프론트 `approverStatusLines`(page.tsx)·`approval-panel.tsx` 목록이 Rejected 우선 표시.
- **회수 권한 상태별 분리** (`39f65c5`): pending/approved(승인요청중)=**제출자만**, rejected=**+오너/sysadmin**(제출자 부재 대비). 백엔드 `withdraw_version` + 프론트 `canWithdraw`(page.tsx) 동일.
- **회수 재획득**: withdraw는 회수자에게 체크아웃 재부여, draft로. 승인 0건 회수는 submitted 이벤트 삭제(흔적 없음), 반려/승인1+ 회수는 withdrawn 기록.
- **승인자 관리 게이트**: `approvers.py::set_approvers`가 pending/approved면 409. 프론트도 draft/pre-approval에서만(`canManageApprovers`).

## 4. 모달 디자인 컨벤션 (앞으로도 이 방식)

- `confirm-dialog.tsx` — 맵 삭제 모달식 압축(아이콘 원+제목+서브타이틀+요약박스). 지원: `icon`·`lines`·`sections`(복수 박스)·`ConfirmLine.badge`(우측 상태 뱃지)·`highlight`(본인 행)·`banner`(커스텀 슬롯)·`input`.
- 전이 모달(제출/승인/거절/회수/게시)은 page.tsx에서 이 컴포넌트로 통일. 승인자 목록 **상태 뱃지는 로케일 무관 영어**("Approved"/"Pending"/"Rejected").
- **회수 모달 핸드오프**: `withdraw-handoff.tsx` — 제출자→회수자 한 줄(둘 다 pill). 회수자≠제출자일 때만 "→ 회수자"를 로딩 후 1초 펼침 + 페이드 1회 깜빡.
- **용어**: UI의 "점유권/점유자/holder" → **체크아웃/checkout** 통일(i18n en/ko).

## 5. 버전 탐색 UI

- `version-pill.tsx` — 클릭 드롭다운(전 버전, 편집 중이면 확인 모달) + **호버 아코디언**(게시 안 된 진행중 버전 바로가기, `handlePick` 공용, `pt-1` 호버갭 브리지).
- `maps/version-timeline.tsx` — 버전 카드(마커·상태·sticky 1열·가로스크롤숨김) + **펼침 시 "이 버전으로 가기"**(`onGoToVersion`→`switchVersion`, 현재 버전 제외). `map-detail-card.tsx`가 `onGoToVersion`/`currentVersionId` 전달.
- `switchVersion`(page.tsx)은 전환 전 `saveCurrentScope()`로 저장 → 손실 없음.

## 6. 시드 / 로컬 검증

- **종합 시드**: `backend/scripts/seed_org_demo.py`(조직도 ~400명·sysadmin `admin.sys`·맵12[공개6/비공개6, v1~v5 워크플로+일부 반려/회수]·그룹6). `reset_db.py`: drop→seed→verify. 구 분산 데모 시드 삭제, 기동 재시드 가드(`ad/service.py`).
- **로컬 권한 검증**: `backend/.env`(gitignore) `DEV_ENFORCE_PERMISSIONS=true`·`BPM_SYSADMINS=admin.sys`. 비강제 모드는 전원 sysadmin이라 역할 경계 검증 불가 → 테스트는 `_transfer_enforce` 픽스처로 enforce 고정. conftest가 baseline 고정해 `.env`가 테스트에 안 샘.
- 로그인 피커: `dev-login-modal.tsx`(디렉터리 fetch+검색).

## 7. 잔여 / 백로그 (비차단)

- **미검증**: 애니메이션·픽셀 레이아웃은 build까지만 — 사내 Windows/서버(원격 IP) 브라우저 스모크 남음(secure-context·라이브 AD는 서버에서만 재현).
- **백로그**: list_editors 그룹확장 DRY · dept 조회 O(N) · `decide` 승인 시 역할 미재검증 · T6 신원가정(`me.username==login_id`) 라이브 AD 확인 · rejected 상태에서 체크아웃 패널은 홀더 없음(view-only, 대개 빈 상태).

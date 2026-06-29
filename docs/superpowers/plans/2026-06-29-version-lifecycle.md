# 버전 라이프사이클 · 승인 탭 재구성 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven). 단계는 체크박스(`- [ ]`).
> **설계**: `docs/superpowers/specs/2026-06-29-version-lifecycle-design.md` (결정 §5 확정).

**Goal:** 게시 기준 버전 순차번호(v1, v2…) 부여 + 직전 게시본 만료(expired) 종료 + 점유권 이전/요청 + 만료본 재게시 + 승인 탭 재구성.

**Architecture:** 백엔드(FastAPI/SQLAlchemy) 스키마·워크플로 변경 먼저 → 프론트(`approval-panel.tsx` + page.tsx 배선) 재구성. 점유권 요청은 기존 승인큐 인프라 연동.

**Tech Stack:** Python/FastAPI/SQLAlchemy/Pydantic · Next.js/@xyflow/react · sqlite(로컬)/postgres(서버), startup `create_all`(마이그레이션 후속).

## Global Constraints
- 버전 번호: 맵별 순차, **게시 시** 채번, 불변. 표시 `v{n} · {label}`(미게시는 `{label}`).
- 라이프사이클: publish → 직전 published를 **`expired`**(approved 강등 폐기). active published 맵당 1개.
- 점유권 요청 승인자: **점유자 + 오너 + sysadmin**. 리네임/삭제는 **드래프트만**(점유자). transfer 대상은 **editor+**.
- 권한 검증은 백엔드 경계. KST 타임스탬프(`app/clock.now`). id는 `genId()`. 토큰만(raw hex 금지), UI 영어/데이터 한글, Lucide 16px sw1.5.
- DB 스키마 변경 → `models.py` 컬럼 추가(기존 데이터 `version_number` NULL 허용). 테스트는 `backend/tests/`.

---

### Task 1: 버전 번호 + expired 상태 (모델·publish 로직)
**Files:** Modify `backend/app/models.py`(MapVersion), `backend/app/routers/versions.py`(publish), `backend/app/schemas.py`(WorkflowState/VersionSummary), Test `backend/tests/test_version_lifecycle.py`
**Interfaces — Produces:** `MapVersion.version_number: int|None`; status `expired`; `WorkflowState.version_number`.

- [ ] **1.1** 테스트 작성: ① 게시 시 `version_number` 1부터 순차 ② 2번째 게시 시 직전 published가 `expired`(approved 아님) ③ 만료본 번호 불변. (`pytest tests/test_version_lifecycle.py::test_publish_numbers_and_expires`)
- [ ] **1.2** 실패 확인.
- [ ] **1.3** `models.py`: `version_number: Mapped[int|None] = mapped_column(Integer, nullable=True)`. status 주석에 `expired` 추가.
- [ ] **1.4** `versions.py` `publish_version`: 채번 `next = (MAX(version_number) for map)+1 or 1` → 대상에 부여; 직전 `published` 조회 → `status="expired"`(이벤트 로그 `expired` 기록). VersionStatus literal/상수에 `expired` 추가.
- [ ] **1.5** `schemas.py`: `WorkflowState`·`VersionSummary`·`VersionDetail`에 `version_number: int|None`. 상태 enum/Literal에 `expired`.
- [ ] **1.6** 테스트 통과 + `ruff check`. 커밋.

### Task 2: 점유권 이전 + 편집권한자 피커 API
**Files:** Modify `backend/app/routers/checkout.py`, `backend/app/routers/maps.py`(editors 목록) 또는 `permissions.py`, Test 동 파일.
**Interfaces — Consumes:** Task1 status. **Produces:** `POST /versions/{id}/checkout/transfer {to}`; `GET /maps/{mapId}/editors → [{login_id,name,...}]`; `WorkflowState.checkout_holder: str|None`.

- [ ] **2.1** 테스트: ① 점유자가 editor+에게 transfer → 점유 이전 ② 비-editor 대상 거부(422) ③ 비점유·비오너 호출 거부(403) ④ 오너/sysadmin transfer 가능.
- [ ] **2.2** 실패 확인.
- [ ] **2.3** `GET /maps/{mapId}/editors`: 맵 permissions에서 role∈{owner,editor} 유저 + 디렉터리 이름 머지.
- [ ] **2.4** `POST /versions/{id}/checkout/transfer`: 권한(점유자|오너|sysadmin) + 대상 editor+ 검증 → checkout holder 갱신. `WorkflowState`에 `checkout_holder` 추가.
- [ ] **2.5** 테스트 통과 + ruff. 커밋.

### Task 3: 점유권 요청 + 승인큐 연동
**Files:** Modify `backend/app/models.py`(CheckoutRequest), 신규/수정 `backend/app/routers/checkout.py`, 승인큐 라우터(`approvals`/`notifications`), Test.
**Interfaces — Produces:** `checkout_requests` 테이블; `POST /versions/{id}/checkout/request`; `POST /checkout-requests/{id}/decide {approve}`; `WorkflowState.pending_checkout_request: {id,requested_by}|None`.

- [ ] **3.1** 테스트: ① editor·미점유 request 생성 ② 중복 request 시 409 ③ 점유자/오너/sysadmin approve → 점유 이전+요청 closed ④ reject → 요청 closed, 점유 유지 ⑤ viewer request 거부.
- [ ] **3.2** 실패 확인.
- [ ] **3.3** `models.py`: `CheckoutRequest`(id, version_id FK, requested_by, status, created_at KST).
- [ ] **3.4** `request`/`decide` 엔드포인트 + 승인큐(기존 pending 목록 API)에 checkout request 노출. `WorkflowState.pending_checkout_request` 추가.
- [ ] **3.5** 테스트 통과 + ruff. 커밋.

### Task 4: 만료본 재게시(드래프트 생성)
**Files:** Modify `backend/app/routers/versions.py`, Test.
**Interfaces — Produces:** `POST /versions/{id}/republish → VersionSummary(new draft)`.

- [ ] **4.1** 테스트: ① expired 버전 republish → 그 그래프 복제한 새 draft 생성·점유 부여 ② 드래프트 이미 있으면 409 ③ editor+ 아니면 403 ④ non-expired에도 허용?(spec: 만료본 경로) → expired만 또는 published도? **published/expired 허용, draft/pending 차단**.
- [ ] **4.2** 실패 확인.
- [ ] **4.3** `republish`: 대상 버전 그래프(nodes/edges/groups) 복제 → 새 draft(label 승계 또는 신규) + 생성자 점유. 기존 map-copy 로직 참고(`maps.py:267`).
- [ ] **4.4** 테스트 통과 + ruff. 커밋.

### Task 5: 프론트 — 버전명 포맷 + pill 축소·번호 + 상단 라벨
**Files:** Create `frontend/src/lib/version-name.ts`(`formatVersionName`), Modify `frontend/src/components/version-pill.tsx`, `frontend/src/lib/api.ts`(타입), `frontend/src/components/approval-panel.tsx`.
**Interfaces — Consumes:** Task1 `version_number`. **Produces:** `formatVersionName(v): string`.

- [ ] **5.1** `api.ts`: `VersionSummary/Detail`·`WorkflowState`에 `version_number?: number|null`·`checkout_holder?`·`pending_checkout_request?` 추가.
- [ ] **5.2** `version-name.ts`: `formatVersionName(v)` → 번호 있으면 `v{n} · {label}` 아니면 `{label}`. (단위 테스트 vitest.)
- [ ] **5.3** `version-pill.tsx`: 라벨에 `formatVersionName` 적용 + **축소**(작은 패딩/text-fine). 드롭다운 항목·만료본 노출.
- [ ] **5.4** `approval-panel.tsx` 상단: **현재 버전 풀네임 라벨**(좌) + pill(축소). tsc/eslint 0. 커밋.

### Task 6: 프론트 — 우측 아이콘 버튼 + 역할/상태 매트릭스 + 기본 선택
**Files:** Modify `frontend/src/components/approval-panel.tsx`, `frontend/src/app/maps/[mapId]/page.tsx`(기본 선택·핸들러 주입).
**Interfaces — Consumes:** Task2/3 `checkout_holder`/`pending_checkout_request`, Task5.

- [ ] **6.1** 기본 선택(page.tsx): 진입 시 versionId = 점유 보유면 내 draft, 아니면 최신 published. (기존 초기 선택 로직 보강.)
- [ ] **6.2** `approval-panel.tsx` 우측 아이콘 영역(우측정렬, `Tooltip` 호버 라벨):
  - 점유자+draft: 이전(`ArrowLeftRight`)·리네임(`PencilLine`)·삭제(`Trash2`).
  - editor·미점유+draft: 편집권한 요청(`Hand`/`BellPlus`) + "{checkout_holder 이름} 편집 중"(디렉터리 해석). pending이면 "요청됨" 비활성.
  - editor+expired 선택(draft 없음): 재게시(`RotateCcw`).
- [ ] **6.3** 핸들러 배선(page.tsx): onTransfer/onRequestCheckout/onRepublish/리네임/삭제 → Task2/3/4 API + 기존 handleRename/DeleteVersion. tsc/eslint 0. 커밋.

### Task 7: 프론트 — 모달(점유권 이전·재게시)
**Files:** Create `frontend/src/components/version/transfer-checkout-dialog.tsx`, `republish-dialog.tsx`(또는 `ConfirmDialog`/`DeleteMapDialog` 재사용), Modify `approval-panel.tsx`/page.tsx.

- [ ] **7.1** 이전 모달: `DeleteMapDialog` 디자인 참고 — 아이콘(accent) + 편집권한자 피커(`GET /maps/{id}/editors`, 검색) + 확인/취소. 선택 시 transfer.
- [ ] **7.2** 재게시 안내 모달: 아이콘 + "이 버전 기준 드래프트 생성·승인 재진행" + 확인 → republish → 생성된 draft로 전환.
- [ ] **7.3** 브라우저 검증(권한 시뮬 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.kim`): 점유자=3버튼·이전모달 / 편집권한만=요청+이름 / 만료선택=재게시모달 / 번호표시. 콘솔 0. 커밋.

### Task 8: 통합 검증 + 시드
**Files:** Modify `docs/db-seed.md`/시드 스크립트(만료·다중 게시본 데모), `PROGRESS.md`.
- [ ] **8.1** 데모 시드: 게시본(v1 expired, v2 published) + draft + 점유/요청 상태 — 매트릭스 전 케이스 재현.
- [ ] **8.2** 로컬 네이티브 전 경로 + 서버 compose 확인. PROGRESS 갱신. 커밋.

---

## Self-Review
- **스펙 커버리지**: 버전번호(T1·T5) · expired(T1) · 이전(T2·T7) · 요청(T3·T6) · 재게시(T4·T7) · 매트릭스(T6) · 모달(T7) ✓.
- **타입 일관**: `version_number`(api.ts ↔ schemas.py), `checkout_holder`/`pending_checkout_request`(T2/T3 ↔ T6).
- **마이그레이션 주의**: `create_all`은 신규 컬럼/테이블 자동 생성하나 **기존 sqlite/postgres 파일엔 컬럼 자동추가 안 됨** → 로컬은 `reset_db`, 서버는 마이그레이션/리셋 필요(배포 노트에 명시).

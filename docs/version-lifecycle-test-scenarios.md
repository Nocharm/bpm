# Version Lifecycle — Test Scenarios / 버전 라이프사이클 테스트 시나리오

`feat/version-lifecycle` 검토용 테스트 시나리오. **정상(Positive) · 예외(Negative) · 관리자(Admin/sysadmin)** 3분류로,
각 시나리오는 화면(수동 검토)과 API 계약(상태코드) 양쪽 기대치를 함께 적는다. 근거 열은 백엔드 테스트 함수 또는
엔드포인트/코드 위치를 가리킨다.

대상 기능: 게시 시 순차 버전번호(v1, v2…)·직전 게시본 만료(`expired`)·점유권 이전(transfer)·점유권 요청/결정
(request/decide, 승인큐)·만료본 재게시(republish).

---

## 0. 준비 / Setup

### 0.1 반드시 권한 강제 모드로 실행 — 안 그러면 모든 Negative(403)가 재현 안 됨

`DEV_ENFORCE_PERMISSIONS` 기본값(False)에서는 **전원이 sysadmin → 모든 맵 owner** 로 판정된다. 이 상태에서는
viewer 차단·비권한자 차단 같은 403 시나리오가 전부 통과해 버려 **검증 자체가 무의미**하다. 아래처럼 강제 모드로 띄운다.

```bash
# === bash (macOS/Linux) — backend/ 에서 ===
python -m scripts.reset_db                       # 데모 시드 재생성 (seed_version_lifecycle_demo 포함)
DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.kim \
  .venv/bin/uvicorn app.main:app --reload --port 8000
```

```powershell
# === PowerShell (Windows) — backend\ 에서 ===
python -m scripts.reset_db
$env:DEV_ENFORCE_PERMISSIONS="true"; $env:BPM_SYSADMINS="admin.kim"
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

프런트는 `npm run dev`(:3000). 로그인 화면 스위처로 dev 유저를 전환한다(선택값은 `bpm.devUser` 에 저장).

> ⚠️ 403/422 권한 시나리오는 **로컬 강제 모드에서만** 재현된다. 라이브 배포는 Keycloak/AD 실계정으로 별도 확인.
> API 레벨 재현은 `backend/tests/test_version_lifecycle.py` + `test_workflow.py` 의 pytest 로도 가능(권한 케이스는 `auth_enabled`/`dependency_overrides` 로 실역할 주입).

### 0.2 시드 엔터티 / Seeded entities (`seed_version_lifecycle_demo`)

**Map 1 — "Version Lifecycle Demo"** (private, owner = `user.lee`)

| 버전 | 상태 | version_number | 비고 |
|------|------|----------------|------|
| v1 | `expired` | 1 | 직전 게시본, v2에 의해 대체됨 |
| v2 | `published` | 2 | 현재 활성 게시본 |
| v3 | `draft` | (none) | `user.park` 점유 중. 별도 pending 점유요청 존재 |

- Pending `CheckoutRequest`: `user.choi` → v3 (승인큐/결정 배너 구동용, "Requested / 요청됨" 배지)

**Map 2 — "Republish Demo"** (private, owner = `user.lee`)

| 버전 | 상태 | version_number | 비고 |
|------|------|----------------|------|
| v1 | `expired` | 1 | draft 없음 → 만료본에 **Republish** 버튼 노출 |

**유저 / Users**

| login_id | 이름 | 역할(데모 맵 기준) |
|----------|------|--------------------|
| `admin.kim` | Junho Kim | **sysadmin** (`BPM_SYSADMINS=admin.kim`) + Map1 결재자(approver) |
| `user.lee` | Minjae Lee | 맵 **owner** |
| `user.park` | Soyeon Park | **editor** — v3 점유자(holder) |
| `user.choi` | Daehyun Choi | **editor** — 비점유 요청자(pending requester) |
| `user.jung` | Hana Jung | **viewer** |

### 0.3 점유권 요청/결정이 보이는 3개 화면 / Three approval screens

점유권 요청(checkout request)의 결정(Approve/Reject)은 아래 3화면에서 모두 가능해야 한다.

- ① **에디터 승인탭** — 맵 에디터의 Approval 탭 결정 배너(`approval-panel.tsx`)
- ② **Settings 승인큐** — `/settings` 전역 승인큐(`admin/approval-queue.tsx`, checkout_request 항목)
- ③ **맵설정 checkout 탭** — `/maps/[mapId]/settings` 의 checkout 탭(`map-settings/checkout-requests-panel.tsx`)

---

## 1. 정상 시나리오 / Positive

| ID | 시나리오 | 액터 | 전제 | 동작 | 기대결과 (UI / HTTP) | 근거 |
|----|----------|------|------|------|----------------------|------|
| **P1** | 게시 시 채번 + 직전 게시본 만료 | `user.park`(holder) → `admin.kim`(approver) | Map1: v2 published#2, v3 draft(park 점유) | v3 승인탭에서 Submit → `admin.kim` Approve → Publish | v3 = `published`, **version_number = 3**. v2 → `expired`(상태 배지 "Expired/만료됨"), v2 번호 **2로 불변**. v1 번호 1 불변 | `test_publish_numbers_and_expires`, `test_publish_demotes_prior` · `POST /versions/{id}/publish` |
| **P2** | 만료본 재게시(republish) | `user.park`(editor) | Map2: v1 expired, **draft 없음** | v1 승인탭 → **Republish**(확인 다이얼로그 "Republish version / 버전 재게시") 확인 | HTTP **201**. 새 `draft` 생성, version_number = null, label 승계, 그래프 복제(노드/엣지/그룹 **새 id**), 호출자(park) 점유 | `test_republish_expired_creates_draft` · `POST /versions/{id}/republish` |
| **P3** | 점유권 이전(transfer) | `user.park`(holder) | Map1: v3 draft, park 점유 | v3 승인탭 → 이전 다이얼로그(검색 피커)에서 `user.choi` 선택 → 확인 | 점유가 **choi로 이전**(`checked_out_by=user.choi`). 피커에는 editor+만 노출(viewer 제외) | `test_transfer_holder_to_editor` · `POST /versions/{id}/checkout/transfer` |
| **P4** | 요청 → 결정(승인) : 3화면 결정 | `user.park`(holder) 또는 `user.lee`(owner) | Map1: v3에 choi의 pending 요청 존재 | ①승인탭 배너 / ②Settings 승인큐 / ③맵설정 checkout 탭 중 한 곳에서 **Approve/승인** | 요청 status `pending → approved`, 점유가 **choi로 이전**. 세 화면 어디서 눌러도 동일 결과 | `test_checkout_request_approve_moves_checkout`, `test_checkout_request_owner_approve` · `POST /checkout-requests/{id}/decide` |
| **P5** | 비점유 editor의 점유권 요청 | `user.choi`(editor, 비점유) | 대상 버전에 **미결 요청 없음** (예: 요청 초기화 후) | 승인탭에서 **Request checkout / 편집권한 요청** | HTTP **201**, `CheckoutRequest(pending)` 생성. 버튼 → "Requested / 요청됨"(비활성). 점유자에겐 "{name} editing / 편집 중" 표기 | `test_checkout_request_editor_non_holder` · `POST /versions/{id}/checkout/request` |
| **P6** | workflow 상태의 version_number | 임의 열람자 | Map1 | v3(draft) workflow 조회 → 게시 후 조회 | draft: `version_number = null`. 게시 후: 그 버전의 확정 번호 | `test_workflow_state_version_number` · `GET /versions/{id}/workflow` |

---

## 2. 예외 시나리오 / Negative

| ID | 시나리오 | 액터 | 동작 | 기대결과 (UI / HTTP) | 근거 |
|----|----------|------|------|----------------------|------|
| **N1** | viewer는 점유권 요청 불가 | `user.jung`(viewer) | Map1 v3 요청 시도 | HTTP **403** "only an editor or owner can request checkout". UI: 요청 버튼 미노출 | `test_checkout_request_viewer_403` (checkout.py:40) |
| **N2** | 버전당 미결 요청은 1건 | `user.choi`(또는 누구든) | 이미 pending 요청이 있는 v3에 재요청 | HTTP **409** "a pending checkout request already exists". UI: "Requested / 요청됨" 비활성 | `test_checkout_request_duplicate_409`, `test_checkout_request_different_user_409` (checkout.py:54) |
| **N3** | 점유자 본인 요청 무의미 | `user.park`(holder) | 자신이 점유한 v3에 요청 | HTTP **409** "you already hold the checkout". UI: holder는 요청 버튼 대신 점유자용 액션 | `request_checkout` self-check (checkout.py:47) |
| **N4** | 이전 대상이 editor+ 아님 | `user.park`(holder) | v3 점유를 `user.jung`(viewer)에게 이전 | HTTP **422** "transfer target must be an editor or owner". UI: 피커에 viewer 미노출(API 직접 호출 시 422) | `test_transfer_non_editor_target_422` (versions.py:317) |
| **N5** | 점유 없는 버전 이전 | 임의 권한자 | `checked_out_by = null` 버전 이전 | HTTP **409** "no active checkout to transfer" | `test_transfer_no_checkout_409` (versions.py:314) |
| **N6** | 비점유·비오너의 이전 시도 | `user.choi`(editor, 비점유) | v3 점유 이전 시도 | HTTP **403** "only the checkout holder, map owner, or sysadmin can transfer". UI: 이전 버튼 미노출 | `test_transfer_non_holder_non_owner_403` (versions.py:307) |
| **N7** | 재게시 — draft 이미 존재 | `user.park`(editor) | Map1(v3 draft 존재)에서 v1/v2 재게시 | HTTP **409** "a draft already exists for this map". UI: draft 있으면 Republish 버튼 미노출 | `republish_version` one-draft rule · `test_republish_draft_exists_409` |
| **N8** | 재게시 — 소스 상태 부적격 | 임의 editor | draft/pending/approved/rejected 버전 재게시 | HTTP **409** "cannot republish a {status} version"(published·expired만 허용). UI: Republish는 expired에만 노출 | `republish_version` status gate · `test_republish_source_status_gates` |
| **N9** | 비editor 재게시 | `user.jung`(viewer) | Map2 v1(expired) 재게시 | HTTP **403** "editor or owner required to republish"(소스 상태보다 **먼저** 검사 → 상태 유출 없음) | `republish_version` perm-before-status · `test_republish_no_editor_role_403` |
| **N10** | 이미 결정된 요청 재결정 | 결정 권한자 | approved/rejected 된 요청을 다시 decide | HTTP **409** "request already {status}" | `decide_checkout_request` (checkout.py:91) |
| **N11** | 비권한자 요청 결정 | `user.choi`(비점유·비오너·비sysadmin) | choi의 요청을 choi 스스로/제3자가 decide | HTTP **403** "only the checkout holder, map owner, or sysadmin can decide". UI: 결정 배너 미노출 | `test_checkout_request_non_holder_decide_403` (checkout.py:105) |
| **N12** | 게시/대기 버전 삭제 불가 | 임의 권한자 | `published`/`pending` 버전 삭제 | HTTP **409** "cannot delete a {status} version" | `test_delete_blocked_on_published` (versions.py) |

---

## 3. 관리자 시나리오 / Admin (sysadmin)

`admin.kim` 은 `BPM_SYSADMINS=admin.kim` 로 지정된 sysadmin이며, 모든 맵에서 **owner로 판정**된다.

| ID | 시나리오 | 액터 | 동작 | 기대결과 | 근거 |
|----|----------|------|------|----------|------|
| **A1** | 승인큐 전체 열람 | `admin.kim` | `/settings` 승인큐 열람 | **모든 맵**의 pending 점유 요청이 보인다(choi→v3 포함). 비sysadmin은 "내가 점유한 버전 또는 내가 owner인 맵"만 | `test_checkout_pending_queue_for_holder`, `test_checkout_pending_queue_context` (checkout.py:146) |
| **A2** | 임의 요청 결정 | `admin.kim` | choi의 v3 요청을 Approve/Reject | 점유자·오너가 아니어도 **결정 가능**. Approve 시 점유가 choi로 이전 | `test_checkout_request_sysadmin_approve` (checkout.py:105) |
| **A3** | 임의 점유 이전 | `admin.kim` | v3 점유를 임의 editor+에게 이전 | 점유자가 아니어도 **이전 가능**(holder-agnostic) | `test_transfer_owner_and_sysadmin_can_transfer` (versions.py:307) |
| **A4** | sysadmin = 전맵 owner | `admin.kim` | 맵 목록/설정/승인탭 열람 | grant 무관하게 **모든 맵 열람**, republish·approver 관리 등 owner 액션 가능 | `get_effective_role` sysadmin→owner |
| **A5** | owner 패리티(비sysadmin) | `user.lee`(owner) | v3 점유 요청 결정 / 점유 이전 | 점유자가 아니어도 **owner 자격**으로 결정·이전 가능(맵 범위 한정) | `test_checkout_request_owner_approve`, `test_transfer_owner_and_sysadmin_can_transfer` |
| **A6** | map_id 필터(맵설정 큐) | `admin.kim` / owner | 맵설정 checkout 탭 진입 | 큐가 **해당 맵 요청만**으로 필터링(`?map_id=`) | `test_checkout_pending_queue_map_id_filter` (checkout.py:143) |

---

## 4. 커버리지 매핑 / Traceability

| 기능 | 정상 | 예외 | 관리자 |
|------|------|------|--------|
| 게시 채번·만료 | P1, P6 | — | A4 |
| 재게시 republish | P2 | N7, N8, N9 | A4 |
| 점유 이전 transfer | P3 | N4, N5, N6 | A3, A5 |
| 요청 request | P5 | N1, N2, N3 | — |
| 결정 decide / 승인큐 | P4 | N10, N11 | A1, A2, A5, A6 |
| 버전 삭제 가드 | — | N12 | — |

자동화 회귀는 `backend/tests/test_version_lifecycle.py`(게시 채번·만료·republish 4종) + `test_workflow.py`(점유/전이) 로 커버.
점유 요청/결정·승인큐 3화면·역할 게이트는 위 수동 시나리오로 검토한다.

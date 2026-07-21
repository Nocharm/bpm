# 맵 이름 변경 승인 워크플로우 — 설계 (2026-07-18)

## 목표

맵 이름 변경 기능을 만든다(현재 이름 변경 UI 없음 — 생성 시 고정). 에디터의 변경은
오너/시스템 관리자의 **1인 승인**을 거쳐 반영되고, 오너/시스템 관리자 본인의 변경은
즉시 반영된다. 요청·결정·적용 각 단계에서 알림을 발송한다.

## 확정 요구사항

| 항목 | 결정 |
|---|---|
| 요청 권한 | 오너 / 에디터 / sysadmin (editor 이상) |
| 승인 규칙 | 맵 **오너 또는 sysadmin 중 1인** 결정 (버전 워크플로우의 전원 승인과 다름) |
| 자기승인 | 오너/sysadmin 본인 변경은 요청 없이 **즉시 적용** |
| pending 제한 | 맵당 rename 요청 1건. 오너 직접 변경 시 기존 pending 자동 무효화(superseded) |
| 진입점 | Settings 페이지 (Details 섹션, description 편집 옆) |
| 알림 | 요청 생성·승인/반려/무효화·이름 적용 각각 발송 |

## 기존 인프라 (재사용)

- `ApprovalRequest` 테이블 — kind(`permission_downgrade`/`visibility_change`) + JSON payload
  + status(`pending`/`rejected`/`applied`) + 1인 결정 엔드포인트
  `POST /approval-requests/{id}/decide` (permissions.py).
- Inbox 통합 승인 큐 `GET /inbox/approvals` — kind별 노출 대상 필터
  (점유권 이전은 이미 "오너 또는 sysadmin" 필터 패턴 사용, inbox.py).
- 알림 `workflow.create_notifications` + 프론트 알림 렌더.
- `PATCH /maps/{id}` (update_map) — 현재 editor 게이트로 name/description 수정 가능
  (프론트는 description만 사용 중).
- `_assert_unique_name` — 맵 이름 중복 검사 (maps.py).

## 설계

### 1. 데이터 모델 — 변경 없음 (DDL 불요)

`ApprovalRequest`에 `kind='map_rename'` 추가. payload는
`{"to_name": str, "from_name": str}` (from_name은 요청 시점 이름, 이력용 —
Inbox의 before 표시는 라이브 `pm.name` 사용).

status 값 2개 추가(문자열 컬럼이라 스키마 변경 없음):

- `superseded` — 오너/sysadmin 직접 변경으로 무효화
- `withdrawn` — 요청자 본인 취소

### 2. 백엔드 API

#### 2.1 요청 생성 — `POST /maps/{map_id}/rename-requests` (신설, maps.py)

- 게이트: `require_map_role("editor")`.
- 검증: to_name 비어있지 않음·200자 이하·현재 이름과 다름 → 422,
  `_assert_unique_name` (요청 시점 fail-fast) → 409,
  같은 맵에 pending `map_rename` 존재 → 409 (맵당 1건).
- 생성: `ApprovalRequest(kind='map_rename', payload={to_name, from_name}, requested_by=user)`.
- 알림: 맵 오너들(user principal, 요청자 제외)에게 발송.
- 응답: `ApprovalRequestOut`.

#### 2.2 결정 — `POST /approval-requests/{request_id}/decide` (기존 확장, permissions.py)

- 권한 게이트를 kind별 분기:
  - `map_rename` → **오너 또는 sysadmin** (신규 assert — 기존 owner 판정 헬퍼 재사용)
  - 기존 kind → 기존 `assert_approver_or_sysadmin` 유지 (동작 불변)
- approve: `_assert_unique_name` **재검사** — 요청 후 다른 맵이 그 이름을 선점했으면
  409를 반환하고 요청은 pending 유지(결정권자가 수동 reject 가능).
  통과 시 `map.name = to_name` → status `applied` (기존 관례: approve 즉시 적용) →
  알림(요청자 + 협업자, §4).
- reject: status `rejected` → 요청자 알림. 변경 없음.

#### 2.3 요청 취소 — `DELETE /maps/{map_id}/rename-requests/pending` (신설, maps.py)

- 게이트: 해당 맵의 pending rename 요청의 `requested_by == user` 본인만. 아니면 403.
- pending 없으면 404. 있으면 status `withdrawn` (행 보존 — 이력).
- 알림 없음 (본인 취소).

#### 2.4 직접 변경 — `PATCH /maps/{map_id}` (기존 조임, maps.py)

- `payload.name`이 있고 실제로 이름이 바뀌는 경우:
  - 호출자가 오너/sysadmin이 아니면 **403** + detail로 rename-requests 경로 안내
    (조용히 무시하지 않음 — 명시적 실패).
  - 오너/sysadmin이면 기존대로 `_assert_unique_name` 후 즉시 적용.
  - 적용 시 pending `map_rename` 요청이 있으면 `superseded`로 전이 + 그 요청자에게 알림.
  - 협업자 알림 (§4).
- `description` 경로는 기존 그대로 (editor 가능, 동작 불변).

### 3. Inbox 통합 큐 — `GET /inbox/approvals` (기존 확장, inbox.py)

approval_request 블록에서 kind별 노출 대상 분리:

- `map_rename`: **내가 오너인 맵 또는 sysadmin** — 점유권 이전(checkout_transfer)의
  `owner_map_ids` 서브쿼리 패턴 재사용.
- 기존 kind(권한 하향·가시성): 기존 승인자 필터 유지 (동작 불변).

카드 필드: `before = pm.name`(라이브), `after = payload.to_name`, kind 표기 `map_rename`.

### 4. 알림 (모두 `workflow.create_notifications`)

| 시점 | 수신자 | 내용 |
|---|---|---|
| 요청 생성 | 맵 오너들 (요청자 제외) | rename 요청 도착 — 요청자·from→to |
| approve 적용 | 요청자 | 승인됨 |
| reject | 요청자 | 반려됨 |
| superseded | 요청자 | 오너 직접 변경으로 무효화됨 |
| 이름 실제 변경 (직접·승인 공통) | 맵 협업자 전원 (user principal, 행위자 제외) | "맵 이름 A → B 변경" |

알림 type 문자열·메시지는 기존 permission 계열(`_notify_permission_decision`) 관례를
따른다(영어 메시지). 프론트 알림 렌더에 신규 type 문구 매핑 추가.

### 5. 프론트엔드

#### 5.1 Settings > Details (`map-details-panel.tsx`)

- description 필드 위에 **이름 편집 필드** 추가.
- `my_role` 기준 분기:
  - owner / sysadmin → 저장 시 `updateMap(mapId, {name})` 즉시 적용 + 토스트.
  - editor → 저장 시 `createRenameRequest(mapId, toName)` → "Rename pending" 배지
    표시(요청명·요청자, 본인 요청이면 취소 버튼 → `withdrawRenameRequest`).
  - viewer → 읽기전용 표시.
- pending 존재 시 이름 필드에 대기 중 배지 노출(맵 이름 자체는 미변경 상태 유지).

#### 5.2 Inbox 승인함 카드

기존 generic approval_request 카드에 `map_rename` kind 제목 매핑 + before → after 표시.
결정 버튼은 기존 decide 호출 재사용.

#### 5.3 API 클라이언트 (`lib/api.ts`)

`createRenameRequest`, `withdrawRenameRequest` 추가. `updateMap`은 기존 그대로.

#### 5.4 토스트 — 알림 시점과 대칭 (기존 toast 인프라·`onToast` 재사용)

행위자 본인 화면에는 즉시 토스트, 상대방에게는 §4의 알림 — 같은 사건을 양쪽에서
일관되게 표현한다. 문구는 UI 영어, i18n 키(EN/KO) 추가.

| 상황 (행위자) | 토스트 |
|---|---|
| 오너/sysadmin 직접 변경 성공 | "Map renamed" — pending 요청이 supersede된 경우 그 사실 포함 |
| 에디터 요청 생성 성공 | "Rename request sent for approval" |
| 요청자 본인 취소 | "Rename request withdrawn" |
| Inbox approve 성공 | "Rename approved — new name applied" |
| Inbox reject 성공 | "Rename request rejected" |
| 실패: 중복 이름 409 · pending 중복 409 · 승인 시 이름 선점 409 · 권한 403 | 에러 토스트로 사유 표시 (백엔드 detail 기반) |

수신 측(오너에게 요청 도착, 요청자에게 결정 통지 등)은 토스트가 아니라 §4 알림으로
전달한다 — 세션에 없는 사용자에게 토스트는 불가능하므로 경계를 명확히 유지.

### 6. 엣지 케이스

- 요청 시점과 승인 시점 사이 이름 선점 → decide approve가 409, pending 유지 (§2.2).
- 요청 후 요청자가 협업자에서 제거됨 → 요청은 유효하게 남고 결정 가능 (별도 처리 없음).
- 오너가 여러 명 → 전원에게 요청 알림, 아무나 1인이 결정.
- 소프트삭제된 맵 → 기존 라우터 관례대로 404 (deleted_at 체크).
- sysadmin이 요청 생성 경로를 호출 → 허용 (프론트는 즉시 적용 경로를 태우지만
  백엔드는 막지 않음 — 단순화).

## 테스트

### 백엔드 (pytest)

- 요청 생성: 성공 / 중복 이름 409 / pending 중복 409 / viewer 403 / 동일 이름 422.
- decide 게이트: 오너 OK / 승인자(비오너) 403 / sysadmin OK / 에디터 403.
- approve: 이름 적용 + applied + 알림 / 경합 중복 시 409 + pending 유지.
- reject: rejected + 알림.
- PATCH 조임: 에디터 name 403 / 오너 name OK + pending superseded / description은 editor 그대로.
- withdraw: 본인 OK / 타인 403 / pending 없음 404.
- Inbox: 오너에게 노출 / 비오너 승인자에게 미노출 / sysadmin 노출, before/after 값.

### 프론트 / 게이트

- tsc `--noEmit`, vitest, `npm run build`, ruff.
- Playwright 검증 스크립트: 오너 즉시 변경 왕복 / 에디터 요청 → 오너 Inbox 승인 → 이름 반영.
  각 단계에서 §5.4 토스트 노출 확인 포함.
- 전체 그린 기준: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" pytest`.

## 구현 시 확인 포인트

- 알림 type 문자열은 구현 시 기존 notification type 목록(프론트 렌더 매핑 포함)을
  확인해 관례에 맞춰 확정한다.
- decide의 owner 판정은 기존 권한 헬퍼(`get_effective_role` 또는 owner 전용 assert)를
  재사용하고 새 판정 로직을 만들지 않는다.
- `map-details-panel.tsx`의 `my_role` 전달 경로(Settings 페이지에서 이미 내려오는지) 확인.

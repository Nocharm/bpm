# AD 동기화 비활성 계정 제외 + 스테일 행 프룬 — 설계

날짜: 2026-07-09 · 브랜치: worktree-ui-improvement-2

## 목적

AD 비활성 계정(userAccountControl 0x2)이 employees에 유입·잔류하지 않게 동기화 조건을 갈무리한다. 비활성 계정이 테이블에서 사라지므로 추출 목록·Employees 탭·부서 집계·디렉터리가 자동 정리된다(UI 측 별도 필터 불필요 — 후속 UI 작업의 전제).

## 변경

### 1. 유입 차단 (`backend/app/ad/service.py`)

`to_employee_fields`에서 `is_active(raw.user_account_control)`가 False면 None 반환(제외) — 기존 제외 규칙(조직·이름 패턴)과 같은 경로로 `excluded` 카운트 합산. `sync_one`(로그인 시 1인 동기화)도 같은 함수를 쓰므로 자동 적용(제외 시 기존 행 유지 — 프룬은 전체 동기화 전담).

### 2. 스테일 행 프룬 (`sync_all`)

스캔 성공 후, 이번 스캔의 **유효(비제외) login_id 집합에 없는 `source="ad"` 행을 삭제**:

- 비활성화된 계정·퇴사자·신규 제외 대상이 AD 전체 동기화 한 번으로 테이블에서 제거된다.
- `source="local"`(개발 시드) 행은 보존.
- **가드**: 스캔 결과가 0건이면 프룬 스킵(LDAP 이상 시 전멸 방지).
- 단일 `DELETE ... WHERE source='ad' AND login_id NOT IN (...)` 문으로 수행, `rowcount`를 `purged`로 보고.
- employees를 FK로 참조하는 테이블 없음(확인) — 삭제 안전. 과거 데이터의 login_id 이름 해석은 id fallback.
- 삭제 행의 korean_name/korean_dept도 함께 사라짐 — 재활성화 시 새 행으로 재유입, 한글이름은 재임포트(의도된 트레이드오프).

### 3. 가시화

`SyncSummary`·`SyncSummaryOut`·프론트 `SyncSummary`에 `purged: int` 추가, Employees 탭 동기화 결과 메시지에 `· purged N` 표시.

## 테스트

- `to_employee_fields`: uac 0x202(비활성) → None.
- 전체 동기화 프룬: 사전 시드된 stale `source="ad"` 행 삭제 + `source="local"` 보존 + 비활성 raw 미생성 + `purged` 보고 (기존 mocked sync 패턴 재사용).
- 스캔 0건 → 프룬 스킵(기존 ad 행 보존, purged 0).
- 기존 sync 테스트 회귀(응답에 purged 추가돼도 기존 단언 유지).

## Out of scope

- 비활성 계정의 소프트 보관(archive 테이블 등) — 필요 시 후속.
- `Employee.active` 컬럼 제거 — 프룬 후 사실상 항상 True지만 스키마 축소는 별건.

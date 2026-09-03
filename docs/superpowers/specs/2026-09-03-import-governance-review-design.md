# 인터뷰 임포트 거버넌스 확인 적용 — 설계

2026-09-03 · 브랜치 `feat/consultant-import-fallbacks` · 컨설턴트 임포트 후속 1/6.
조사 배경: 재임포트가 오너·오우닝 부서·승인자를 조용히 교체하는 경로가 있고(오너 대기 맵),
수동 오너 이전이 대기 플래그를 내리지 않아 다음 재전달이 수동 배정을 덮어쓴다.

## 1. 목표

- 재임포트가 **거버넌스 3필드(오너·오우닝 부서·승인자)** 를 바꾸려면 사람이 dry-run 리포트에서
  항목별로 **체크한 것만** 적용한다. 체크 안 한 항목은 현재값 유지.
- 대상은 전달값이 현재값과 다른 **모든 기존 맵**(오너 확정 여부 무관). "오너 대기" 예외 분기는 제거.
- 콘텐츠(이름·설명·SP 지정값·폴백·그래프·노트)는 지금처럼 항상 적용. 리포트 `updated` 행이 그대로 알림.
- `consultant_owner_pending`은 "오너 미확정" 표시로만 남기고 화면에 노출한다. 수동 오너 이전이 플래그를 내린다.

## 2. 결정

| 결정 | 선택 | 이유 |
|---|---|---|
| 결정 전달 | 무상태 — dry-run 응답에 차이 목록, apply 요청에 체크 목록 동봉 | 임포트가 초 단위라 서버 스테이징(토큰·만료)은 비용만 늘림 |
| 체크 범위 | 거버넌스 3종만 | 사용자 결정 2026-09-03. 이름·검토값은 리포트 표기로 충분 |
| 대상 맵 | 전달값이 다른 모든 기존 맵 | 사용자 결정 2026-09-03. 기본 해제라 안전 |
| 확인 다이얼로그 | 제거 — 리포트 하단 고정 바 [Cancel][Apply]가 확인 역할 | 체크 + 명시적 Apply가 이미 2단 확인 |
| 신규 맵 | 변경 없음 — 전달값으로 생성, 오너 없으면 임포터 + 대기 플래그 | 현재값이 없어 "차이"가 성립하지 않음. 경고 행 유지 |

## 3. API 계약

`POST /categories/import-interview` (sysadmin)

요청 `InterviewImportIn`에 추가:

```
decisions: list[GovernanceDecisionIn] = []   # apply 때만 의미. dry-run은 무시
GovernanceDecisionIn = { code: str, field: "owner" | "department" | "approvers" }
```

응답 `InterviewImportOut`에 추가:

```
governance: list[GovernanceDiffOut]
GovernanceDiffOut = {
  code: str, name: str,                 # 맵 consultant_code · 맵 이름(표시용)
  field: "owner" | "department" | "approvers",
  current: str, delivered: str,         # 승인자는 login을 ", "로 join (current는 정렬, delivered는 전달 순)
  applied: bool                         # apply에서 체크돼 실제 교체됐을 때만 true
}
```

- 차이 산출은 dry-run·apply 공통, 결과 동일.
- apply의 `decisions` 중 이번 전달분 차이에 없는 (code, field)는 **422** `unknown governance decision <code>/<field>`
  (엔진이 미매칭 집합을 돌려주고 라우터가 commit 전에 거부).

## 4. 엔진 (`backend/scripts/import_consultant.py`)

`import_delivery(..., governance_decisions: set[tuple[str, str]] | None = None)`.
`ImportReport`에 `governance: list[GovernanceDiff]` 추가 (`GovernanceDiff` dataclass = 응답 필드와 동형).

기존 맵(`consultant_code` 매칭)마다:

| 필드 | 전달값 | 차이 조건 | 체크 시 적용 |
|---|---|---|---|
| owner | `cmap.owner` | 전달값이 None이 아니고 현재 `owner_id`와 다름 | `owner_id` 교체, owner 권한행 `principal_id`/`granted_by` 이전, `consultant_owner_pending=False`, governance 행 `owner X assigned`. employees에 없으면 경고 |
| department | `resolve_owning_department(delivered dept, delivered owner ?? current owner)` 결과 경로 | 결과가 None이 아니고 현재 `owning_department`와 다름 | `owning_department` 교체. 경로 해석 경고는 지금처럼 warning 행 |
| approvers | `dict.fromkeys(cmap.approvers)` | 전달 목록이 비어 있지 않고 집합이 현재 `MapApprover`와 다름 | 전부 삭제 후 재삽입. employees에 없으면 경고 |

- 위 표로 기존 `if found.consultant_owner_pending and assigned_owner is not None` 분기와
  `elif ... owning_department is None` 분기를 **대체**한다(대기 맵도 같은 규칙).
- 체크되지 않은 차이는 아무것도 쓰지 않는다. `sp_changed_at`/`updated_at`도 건드리지 않는다.
- 전달값이 비어 있으면(owner None, approvers []) 차이 없음 — "지우기"는 임포트로 못 한다.

## 5. 대기 플래그 노출·해제

- `schemas.MapSummary`에 `consultant_owner_pending: bool = False` 추가(from_attributes, 목록·상세 공통).
- `POST /maps/{id}/transfer-owner`가 `consultant_owner_pending = False`로 내린다.
- 프론트: 맵 카드의 오너 표시 두 곳(`map-card.tsx` 메타 줄·오너 카드)에 `Owner unconfirmed` 필(경고 톤,
  `data-id="map-owner-pending"`), 툴팁 "Imported without an owner — the importer holds it until handover".
  설정 페이지는 오너를 따로 표시하지 않아 대상 밖.

## 6. 프론트 (설정 › Framework › Interview import)

흐름: 파일 선택 → **Dry-run** → 리포트(요약·다이제스트·파일별) → **Governance changes 섹션** → 하단 고정 바.

- 새 컴포넌트 `frontend/src/components/admin/import-governance-review.tsx`
  - props: `diffs: GovernanceDiff[]`, `checked: Set<string>`(키 `${code}:${field}`), `onToggle(key)`,
    `onToggleAll(next: boolean)`, `applied: boolean`(apply 결과 보기 — 체크박스 대신 적용/유지 배지).
  - 맵 단위 그룹(이름 + 코드), 필드 행: 라벨(Owner / Owning dept / Approvers) · `current → delivered` ·
    체크박스. 체크 해제 = "Keep current" 중립 톤, 체크 = diff `changed` 토큰. 상단 "Check all / Clear".
  - `data-id`: `import-governance-review`, `import-governance-row-${code}-${field}`,
    `import-governance-check-${code}-${field}`, `import-governance-check-all`.
  - 차이가 0건이면 섹션 대신 한 줄 "No governance changes".
- 순수 헬퍼 `groupGovernanceDiffs(diffs)`는 `lib/interview-report.ts`에 두고 vitest.
- `framework-panel.tsx`
  - 상태 `governanceChecked: Set<string>` — dry-run 결과 수신 시 비움, 파일 추가/삭제 시 `interviewResult`와
    함께 무효화(stale apply 차단).
  - apply는 `decisions = [...checked].map(split)` 동봉. 성공 응답의 `governance[].applied`로 결과 표시.
  - 기존 상단 [Dry-run][Apply] 중 Apply와 ConfirmDialog 제거. 리포트 아래 `sticky bottom-0` 바:
    [Cancel](리포트·체크 초기화) [Apply · N maps · M governance changes]. Apply는 리포트가 있을 때만 활성.
- i18n en/ko: `framework.governance.title/keepCurrent/checkAll/clear/none/field.owner/field.department/
  field.approvers/applied/kept`, `framework.importApplyBar`, `map.ownerPending`, `map.ownerPendingHint`.

## 7. 검증

- BE (`backend/tests/test_import_governance.py`, 기존 임포트 픽스처 재사용)
  - 확정 오너 맵·대기 맵 모두 3필드 차이 산출, dry-run과 apply 결과 동일
  - decisions 없음 → 현재값 전부 유지(대기 맵 포함), 대기 플래그 유지
  - owner 체크 → owner_id·권한행·플래그 해제, approvers 체크 → 교체, department 체크 → 교체, 미체크 필드는 유지
  - 전달값 None/[] → 차이 없음 · 미매칭 decision → 422 · `transfer-owner` → 플래그 해제
  - `MapSummary`에 `consultant_owner_pending` 직렬화
- FE: `groupGovernanceDiffs` vitest · tsc · lint. Playwright `pw-smoke-interview-import.mjs`에
  "dry-run → 체크 → apply → applied 배지" 시나리오, 스크린샷 사용자 공유(SendUserFile).
- 문서: `docs/qa/interview-import-field-map.md` §1 rows(owner/approvers/department)·§4 거버넌스 2행 갱신, PROGRESS.

## 8. 범위 밖

폴백 필드 노출(2번), 노트 CRUD(3번), SP 지정 연간횟수/FTE(4번), 지정 모달 재디자인(5번),
인스펙터 버튼 줄바꿈(6번)은 각각 별도 설계. 임포트 리포트 영속화는 미착수.

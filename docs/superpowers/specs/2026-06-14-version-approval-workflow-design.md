# 버전 승인 워크플로우 — 설계 문서

**작성일:** 2026-06-14
**상태:** 승인됨 (구현 대기)
**관련:** `docs/spec.md` §3.4 버전 관리, §7 Phase C 협업(체크아웃·코멘트)

## 1. 목적

버전이 상태 구분 없이 평평하게 존재하던 것을, **생성→검토→승인→게시**로 흐르는 라이프사이클 거버넌스로 격상한다. 만장일치 승인 게이트와 인앱 알림으로 As-Is→To-Be 전환을 통제한다.

## 2. 범위 결정 (브레인스토밍 확정)

| 결정 | 선택 | 비고 |
|------|------|------|
| 라이프사이클 수준 | 승인 워크플로우 | 제출→검토→승인/반려 + 역할 구분 |
| 상태 모델 | Draft → Pending → Approved → Published (+Rejected) | label과 직교하는 `status` |
| 승인자 결정 | 맵별 지정 승인자 | Keycloak 역할 의존 없음, 앱 내 관리 |
| 승인 정족수 | **만장일치** | 지정 승인자 전원 승인해야 통과 |
| 게시 규칙 | 수동 Publish + 구버전 강등 | 맵당 Published 1개, 명시적 게시 시점 통제 |
| 이력 깊이 | 상태 + 행위자 스탬프만 | 전이 로그 테이블 없음 |
| 편집·제출·게시 권한 | 체크아웃 보유자 = 작성자 | submit 시점 보유자를 `submitted_by`로 박제 |
| 알림 | 인앱 알림(폴링) | 외부 의존 없음, 기존 5초 폴링 패턴 재사용 |

## 3. 상태 모델 · 전이 · 권한

```
 Draft/Rejected ──submit──▶ Pending ──(전원 approve)──▶ Approved ──publish──▶ Published
       ▲                       │                            │                    │
       │                       ├─(누구든 reject+사유)─▶ Rejected                  │
       └───────withdraw────────┴────────────────────────────┘   새 버전 publish 시 │
                                                          기존 Published→Approved 자동강등
```

**편집 가능 상태 = {Draft, Rejected} 만.** Pending/Approved/Published 는 읽기 전용. 확정 버전을 고치려면 기존 복제(clone) 기능으로 새 Draft 버전을 떠서 작업한다.

| 전이 | 행위자 | 효과 |
|------|--------|------|
| Draft/Rejected 편집 | 체크아웃 보유자 | 기존 체크아웃 잠금 그대로 |
| → Pending (submit) | 체크아웃 보유자 | `submitted_by` 기록, 체크아웃 해제, 승인 tally 초기화, 승인자 전원 알림 |
| approve (개별) | 지정 승인자 각자 | tally에 본인 승인 기록. **전원 승인 시 자동 → Approved** |
| → Rejected | 지정 승인자 중 1인 | 사유 필수, submitter 알림 |
| → Published (publish) | submitted_by (=작성자) | 기존 Published 강등, 승인자 전원 알림 |
| → Draft (withdraw) | submitted_by | 회수·재편집, 체크아웃 재획득 |

**역할 3종**
- **작성자** = submit 시점의 체크아웃 보유자 (`map_versions.submitted_by`로 박제). 게시·회수 권한 보유.
- **승인자** = 맵별 지정(`map_approvers`). 전원 승인해야 통과(만장일치), 1인 반려 시 Rejected.
- **맵 소유자** = `process_maps.created_by`. 승인자 지정 권한.

**박제 근거:** 게시는 승인 한참 뒤라 체크아웃이 만료됐을 수 있으므로, submit 시점 보유자를 `submitted_by`에 고정해 게시/회수 권한을 안정적으로 부여한다.

## 4. 데이터 모델 변경

```
map_versions   + status         enum(draft|pending|approved|published|rejected) default 'draft'
               + submitted_by    str  null
               + reject_reason   str  null      # 최신 반려 사유만

map_approvers  map_id(FK), user_id            # 맵별 지정 승인자 (복수)

version_approvals  id, version_id(FK), approver(user), approved_at
                   # 현재 사이클 tally — submit/재submit 시 해당 version 행 전체 삭제(리셋)

notifications  id, recipient(user), type, map_id, version_id, message, read, created_at
```

이력은 "스탬프만" 원칙 유지 — 과거 전이 로그는 없고, `version_approvals`는 현재 사이클 집계용(재제출 시 리셋)이다. 스키마는 startup `create_all`로 반영(Alembic 후속).

## 5. 만장일치 판정 로직

1. `submit`: 해당 version의 `version_approvals` 행 전체 삭제(리셋) → status=pending, submitted_by 기록, 체크아웃 해제, 승인자 전원에게 알림.
2. `approve`: 호출 승인자에 대해 `version_approvals` 행 추가(중복 무시).
3. 추가 후 `count(version_approvals) == count(map_approvers)` 이면 자동 status=approved 전이.
4. `reject`: 1인이라도 호출 시 status=rejected, reject_reason 기록, submitter 알림. tally는 다음 submit에서 리셋.
5. **승인자 미지정(0명) 맵은 submit 차단** — 맵 소유자가 먼저 승인자를 지정해야 한다(409).

## 6. API 표면

기존 `routers/versions.py`에 전이 엔드포인트 추가, 승인자/알림은 신규 라우터.

```
# 전이 (권한·상태 가드 후 전환)
POST   /api/versions/{id}/submit                 # 체크아웃 보유자 → Pending
POST   /api/versions/{id}/approve                # 지정 승인자 → tally 기록, 전원이면 Approved
POST   /api/versions/{id}/reject   {reason}      # 지정 승인자 → Rejected
POST   /api/versions/{id}/publish                # submitted_by → Published (+기존 강등)
POST   /api/versions/{id}/withdraw               # submitted_by → Draft

# 승인자 지정 (맵 소유자만)
GET    /api/maps/{id}/approvers
PUT    /api/maps/{id}/approvers   {user_ids[]}

# 알림 (본인 것만)
GET    /api/notifications?unread=true             # 폴링
POST   /api/notifications/{id}/read
```

- 전이 엔드포인트는 **상태 가드** 필수: 잘못된 상태 호출 시 `409 Conflict`(예: Draft에 approve). 권한 불일치는 `403`.
- `VersionOut`에 `status`, `submitted_by`, `reject_reason`, `approvals`(승인자별 완료 여부), `approvers` 추가 노출.
- 검증은 API 경계(Pydantic + 상태/권한 가드). 내부 재검증 없음.

## 7. 프론트 UX

- **상태 배지**: 버전 목록·에디터 헤더에 상태 pill(Draft 회색 / Pending 앰버 / Approved 초록 / Published 바이올렛 액센트 / Rejected 적색). 토큰만 사용(raw hex 금지, `rules/frontend/design.md`).
- **액션 버튼**(상태+역할 조건부 노출):
  - 체크아웃 보유자: Draft/Rejected → `Submit for approval`, Pending/Approved → `Withdraw`, Approved → `Publish`
  - 승인자: Pending → `Approve` / `Reject(사유 모달)`, 본인 승인 완료 시 "n/m 승인" 진행 표시
  - 맵 소유자: 맵 설정에 `Manage approvers`(사용자 선택)
- **알림 벨**: 상단 우측 Lucide `bell` 16px, 미읽음 점. 드롭다운 목록, 클릭 시 해당 맵/버전 이동 + read 처리. 코멘트 폴링과 동일 주기(5초).
- **Rejected 표시**: 에디터 상단 반려 사유 배너 + 재편집 안내.
- 편집 가드: Pending/Approved/Published 진입 시 캔버스 읽기전용(기존 체크아웃 읽기전용 경로 재사용).
- UI 영어 기본, 동적 데이터·주석만 한글.

## 8. 기존 기능 상호작용

- **체크아웃**: 유지하되 **편집 가능 상태(Draft/Rejected)에서만 획득 허용**. submit 시 자동 해제. heartbeat TTL 로직 변경 없음.
- **복제(clone)**: 확정(Approved/Published) 버전 재편집은 기존 복제로 새 Draft 생성 — 변경 없음. 복제본 status=draft 시작.
- **삭제**: Published 삭제 금지(409), Pending 삭제 금지(승인 진행 중) 추가. 기존 "마지막 버전 삭제 금지"·"타인 체크아웃 시 삭제 금지" 유지.
- **비교 화면**: 변경 없음. 상태 배지만 함께 표시.

## 9. 테스트 (pytest)

- 전이 happy path: draft→pending→(전원 approve)→approved→published.
- 만장일치 경계: 승인자 2명 중 1명만 approve → pending 유지; 2명째 → approved.
- 반려: pending→reject(사유)→rejected, 재submit 시 tally 리셋 확인.
- 권한 거부: 비승인자 approve→403, Draft에 approve→409, submitted_by 아닌 사용자 publish→403.
- 강등: 새 버전 publish 시 기존 published→approved.
- 가드: 승인자 0명 맵 submit→409, Published 삭제→409.
- 알림 생성: submit→승인자 전원 notification row, publish→승인자 알림.
- 외부 의존(Keycloak) 없음 — AUTH_ENABLED 미설정 로컬 경로로 사용자 식별.

## 10. 구현 순서 (spec.md §7 Phase D 로 제안)

1. DB 모델 변경(create_all)
2. backend 전이/승인자/알림 API + pytest (green 확인)
3. 프론트 상태배지·액션·알림벨
4. 통합 검증(로컬 네이티브 실행)
5. `docs/spec.md` §7 Phase D 반영 + 커밋

각 단계 종료 시 pytest/ruff/tsc/eslint/build 통과 후 커밋.

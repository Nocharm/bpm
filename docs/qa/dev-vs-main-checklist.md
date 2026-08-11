# dev ↔ main 미반영분 확인 체크리스트 · 백로그

> 기준: main `4980277` ↔ dev `60ba560` (2026-08-11). dev에만 있는 변경은 **3묶음** — 각 항목의 상세는 링크된 설계 문서가 원본이며 여기선 중복 서술하지 않는다. main 머지·운영 배포 전 이 문서의 확인 항목을 소거할 것.

## 미반영 묶음 요약

| 머지 커밋 | 묶음 | 설계 원본 |
|---|---|---|
| `1423f41` | 컨설턴트 전사 7단계 체계 수용 (Phase 1+2) | [`docs/design/2026-08-08-consultant-hierarchy-design.md`](../design/2026-08-08-consultant-hierarchy-design.md) |
| `953d5cb` | 사용자·조직도 소스 AD→n8n HR 웹훅 교체 | [`docs/design/2026-08-10-hr-webhook-directory-design.md`](../design/2026-08-10-hr-webhook-directory-design.md) |
| `60ba560` | 조직 기준 departments 전환 + EDW 직책 부서장 | [`docs/design/2026-08-11-departments-org-basis-design.md`](../design/2026-08-11-departments-org-basis-design.md) |

## 배포 시 통합 순서 (세 묶음이 함께 나갈 때)

1. **배포** — 스키마 자동 보강 확인: `employees.email` NOT NULL 완화 부트스트랩 로그 1회 + `dept_code`·`position` 자동 ALTER (`db.py _ADDED_COLUMNS`). 최초 배포는 `HR_SYNC_INTERVAL_HOURS=0`으로 스케줄러 OFF.
2. **HR 웹훅 이행** — HR 설계 §9 절차: `POST /api/employees/sync-preview` 드라이런 → **login_id 케이스 불일치 0 확인이 진행 조건** → 첫 수동 sync → dept-remap 콘솔로 고아 경로 이관 → 스케줄러 24h 활성.
3. **EDW 직책 이행** — departments 설계 §7 절차: n8n에 [`docs/deploy/n8n/hr-position-workflow.json`](../deploy/n8n/hr-position-workflow.json) 임포트(자격증명 2곳 지정) → `.env`에 `N8N_POSITION_URL` → sync 1회 후 `position_refreshed`/`position_unmatched` 확인 → 설정 Employees 탭에서 노출 직책 조정.
4. **컨설턴트 체계** — 서버 실환경(9910)에서 Framework 트리·임포트 결과 실검증.

## 묶음별 확인 항목 (서버/실데이터에서만 가능한 것)

### ① 컨설턴트 7단계 체계 (`1423f41`)
- [ ] 9910 실서버에서 Framework 토글·lazy 트리·연결/이양 모달·SP I/O 실동작 확인 (로컬 게이트는 통과: BE 924·FE 605·스모크 8/8)
- 다음 단계 후보(설계 참조): 거버넌스 UX 확장([`2026-08-08-governance-ux-design.md`](../design/2026-08-08-governance-ux-design.md), 미구현) 또는 스케일 하드닝

### ② HR 웹훅 (`953d5cb`) — 설계 §9 이행·§11 실데이터 검증
- [ ] 웹훅 URL 철자 확정(계약서 표기 `webhoop` 오타 여부)
- [ ] orgLevels가 루트→리프 순서인지 실응답으로 확인
- [ ] HR 영문 부서명 ↔ 기존 AD OU 표기 diff 규모 (sync-preview로 정량화)
- [ ] loginId ↔ sAMAccountName 대소문자 일치 (불일치 0이 이행 진행 조건)
- [ ] 6레벨 조직 실재 여부 (`truncated_levels` 카운트)
- [ ] 운영 Postgres email NOT NULL 완화 스텝 배포 로그 1회 확인

### ③ 조직 기준 전환 + EDW 직책 (`60ba560`) — 설계 §7 이행·§8 한계
- [ ] n8n hr-position 워크플로 실호출 — `dbo.VW_HR_EMP_CENTER_MAPPING` 응답 필드(EMPID·DEPTCO·FRNM)·DT 필터 실검증
- [ ] AD `employeeNumber` 실값 확인 — `position_unmatched` 크면 **사번 zero-padding 불일치**(EDW `00100` vs AD `100`) 우선 의심 → `lstrip("0")` 정규화 후보
- [ ] 첫 sync 후 dept-remap 콘솔에서 경로 이동분(HR orgLevels ↔ departments 계층 불일치) 확인·이관
- [ ] 수집된 직책 목록 보고 노출 allowlist(기본: 그룹장·파트장·팀장·센터장) 조정

## 결정 대기

- **오우닝 부서장 자동 승인자 제안·핀 복원 여부** — 새 맵 생성 모달의 해당 기능이 dept_info.manager 소멸로 기능 상실(코드 정리됨, `create-map-dialog.tsx`의 `autoLeaderRef` 스캐폴딩 잔존). EDW position 기반으로 복원할지 사용자 결정 필요.

## 백로그 (코드 후속 — 우선순위순)

### HR 웹훅 잔여 (2026-08-10 최종 리뷰 유예분)
1. **case-mismatch 실 sync 무방비** (우선) — 프리뷰만 감지, 상시 운영 중 HR 표기 변경 시 신규행 생성+구행 삭제로 참조 고아. sync 요약 카운트 추가 또는 중단 정책.
2. 프리뷰가 count 불일치·삭제 상한 초과 abort를 미예고
3. sync 라우터 웹훅 장애 시 제네릭 500 → 명시적 503
4. `reconcile_departures` IN절 무청크 (구 sqlite 이론 리스크)
5. lifespan `hr_task.cancel()` 후 await 미수행 (dev --reload 좀비 가능)
6. ~~프리뷰 dept_info 고아가 pre-state 기준~~ → **소멸** (`60ba560`에서 dept_info 고아 리포트 자체 삭제)

### 조직 기준 전환 잔여 (2026-08-11 최종 리뷰 Minor 유예분)
7. position 갱신/소거 카운터 분리(`position_erased`) — 이행 검수가 이 숫자 의존, 대량 소거 사고 판독용
8. `fetch_positions` 빈 URL 시 HR URL 폴백 풋건 — 명시 raise 가드
9. `/api/me` 체인 워크·깊이 상수(15)가 `orgchart._MAX_DEPTH`와 이중화 — 헬퍼 추출
10. 체인 중간 단절 시 부분 경로 무통지 사용 — 로그 또는 docstring 명시
11. `employee-table` 노출 직책 카드 초기 GET `.catch(() => undefined)` 무통지 삼킴
12. 스테일 Playwright 스크립트 2종 정리 — `pw-verify-dept-tree-import.mjs`·`pw-smoke-korean-names.mjs`(삭제된 모달·버튼 타깃, 영구 브로큰)

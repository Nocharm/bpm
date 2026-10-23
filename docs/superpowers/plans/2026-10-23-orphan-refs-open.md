# 고아 참조 일반 사용자 오픈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sysadmin 전용 고아 참조 일괄 정리를, 각자 평소 권한 범위 안에서 모두가 쓰는 화면(빨간 점 안내 + 그림 설명 + 카드 그리드 + 상세 창)으로 연다.

**Architecture:** 스캔(`app/ref_audit.py`)은 그대로 두되 노드 줄을 맵 단위로 바꾸고, actor 기준 범위·줄별 결과 판정(`app/ref_audit_policy.py`)과 적용(`app/ref_audit_apply.py`)을 새 모듈로 분리한다. 평소 라우터의 거버넌스 판정 조각은 `app/permissions/governance.py`로 옮겨 라우터와 감사가 같은 함수를 쓴다(공통 규칙). 프런트는 새 API 3+1개를 쓰는 `components/ref-audit/` 묶음으로 화면을 새로 만들고 기존 sysadmin 패널을 지운다.

**Tech Stack:** FastAPI · SQLAlchemy async · Pydantic v2 · pytest / Next.js(React 19) · TypeScript · Tailwind v4 토큰 · vitest · Playwright(시스템 Chrome).

**Spec:** `docs/design/2026-10-23-orphan-refs-open-design.md` (시안: claude.ai 아티팩트 "고아 참조 시안" 4판 + 2026-10-23 피드백)

## Global Constraints

- 작업 위치: dev 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`. 커밋은 dev에, **푸시는 사용자 확인 후**.
- 커밋 메시지 `type(scope): English summary — 한국어 요약`, 끝에 세션 attribution 2줄. 커밋마다 `PROGRESS.md` 1–3줄 갱신(같은 커밋).
- 백엔드 런타임 py3.11 문법(`ruff.toml target-version=py311`). 전체 그린: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/`.
- 프런트 게이트: `npx tsc --noEmit -p tsconfig.json` · `npm run lint` · `npx vitest run` · `node scripts/build-component-catalog.mjs --check`.
- UI 문구: en 기본 + ko(`src/lib/i18n-messages.ts` 두 블록), **긴 대시(—) 금지**, 아이콘 Lucide 16px/strokeWidth 1.5, 색은 토큰만(raw hex 금지), 인터랙티브 요소에 `data-id`, 굵기 300/400/600, 라이트 전용.
- 오버레이 z: 모달 1200(공용 `ModalBackdrop`), 모달 안 피커 1250, 포털 드롭다운 1350. 떠 있는 표면은 `glass`(글자 많은 창은 `glass glass-dense`).
- 결과 어휘(서버·프런트 공통): `direct` · `checkout` · `new_draft` · `approval` · `notify` · `locked` · `pending`. 잠김 사유: `in_workflow` · `request_pending` · `owner_left` · `in_approval` · `framework` · `not_eligible`. 경고: `no_access`.
- 빨간 점·`summary.actionable` = 결과가 `direct|checkout|new_draft|approval`인 줄의 곳 수 합(알림·잠김·게시 대기 제외).
- 새 Draft 라벨: `Reference cleanup`. 알림 유형은 기존 `ref_fix_requested` 재사용(payload `as: "owner"|"holder"`).
- 제거 금지 소스: `map_owner` · `owning_dept` · `sp_dept`. 부서 카드는 제거 모드 없음.

## Review Focus

1. **같은 이름의 서로 다른 고아가 한 카드로 합쳐짐**(다른 경로의 같은 리프, 같은 이름의 퇴직자 둘) → 적용은 줄별 `from_value`로만 써서 엉뚱한 값을 바꾸지 않아야 한다. Task 4 `test_cards_merge_keeps_per_line_from_value`.
2. **GET과 적용 사이에 상태가 바뀜**(누가 점유를 가져감, 이미 고쳐짐) → 적용 시점 판정을 따르고 건너뛴 줄을 이유와 함께 돌려준다. Task 5 `test_apply_redecides_when_checkout_taken_meanwhile`, `test_apply_skips_already_fixed_line`.
3. **담당자 목록에 대체 대상이 이미 있음**("Alive, Gone" → Gone을 Alive로) → 중복 없이 "Alive". Task 5 `test_node_assignee_replace_dedupes`.
4. **한 노드에 퇴직자 둘**("Gone A, Gone B")에서 한 명만 대체 → 다른 한 명은 그대로 남고 다른 카드에 계속 보인다. Task 5 `test_node_assignee_replace_touches_only_from_value`.
5. **Editor 맵이 하나도 없는 사용자** → 빈 화면·`actionable=0`, 403 없음. Task 4 `test_viewer_only_user_sees_empty_page`.

---

### Task 1: 거버넌스 판정 공용 헬퍼

**Files:**
- Create: `backend/app/permissions/governance.py`
- Modify: `backend/app/routers/permissions.py` (`_assert_user_not_in_workflow`·`_find_pending_downgrade`·`_is_owning_department_member`·`_notify_permission_request`가 새 함수를 호출), `backend/app/routers/approvers.py` (in-flight 판정), `backend/app/routers/versions.py` (`_find_own_pending_downgrade`)
- Test: `backend/tests/test_governance_helpers.py`

**Interfaces:**
- Produces (모두 `app.permissions.governance`):
  - `async def is_in_active_workflow(session, map_id: int, login_id: str) -> bool` — 편집 가능 버전의 점유자이거나 PENDING·APPROVED 버전 제출자.
  - `async def find_pending_downgrade(session, map_id: int, permission_id: int) -> ApprovalRequest | None`
  - `async def has_own_pending_downgrade(session, map_id: int, login_id: str) -> bool`
  - `async def has_version_in_approval(session, map_id: int) -> bool` — PENDING·APPROVED 버전 존재.
  - `async def is_owning_department_member(session, login_id: str, owning_department: str | None) -> bool`
  - `async def notify_permission_request(session, *, map_id: int, map_name: str, requested_by: str, kind: str) -> None`
  - `async def build_removal_request(session, *, grant: MapPermission, requested_by: str) -> ApprovalRequest` — `kind="permission_downgrade"`, payload `{permission_id, principal_type, principal_id, from_role, to_role: None}`, `status="pending"`, `session.add`까지(커밋 X).

- [ ] **Step 1: 실패 테스트** — `test_is_in_active_workflow_holder_and_submitter`(DRAFT 점유자 True, PENDING 제출자 True, PUBLISHED 점유 흔적 False), `test_has_version_in_approval`(APPROVED만 있어도 True), `test_has_own_pending_downgrade`, `test_build_removal_request_payload`(payload 키·`to_role is None`).
- [ ] **Step 2:** `.venv/bin/python -m pytest tests/test_governance_helpers.py -q` → ImportError로 FAIL.
- [ ] **Step 3:** 함수 구현(라우터의 현행 로직을 옮김, 동작 변경 없음) 후 라우터 3곳이 새 함수를 쓰게 바꾼다. 라우터의 HTTP 예외 문구·상태 코드는 그대로.
- [ ] **Step 4:** 새 테스트 + 기존 `tests/test_permissions*.py tests/test_approvers*.py tests/test_versions*.py tests/test_checkout*.py` → PASS.
- [ ] **Step 5:** 커밋 `refactor(permissions): share governance predicates with the audit path — 거버넌스 판정 공용화`.

### Task 2: 스캔 — 노드 줄을 맵 단위로, APPROVED 빈틈 메우기

**Files:**
- Modify: `backend/app/ref_audit.py`
- Test: `backend/tests/test_ref_audit.py` (노드 관련 기대값 재작성)

**Interfaces:**
- Produces:
  - `@dataclass NodeTarget: map_id: int; published_id: int | None; working_id: int | None; working_status: str | None; checked_out_by: str | None` — working = 맵의 최신 버전이 `published`·`expired`가 아니면 그 버전.
  - `async def load_node_targets(session) -> dict[int, NodeTarget]`
  - `RefLine`에 필드 추가: `pending: bool = False`, `working_status: str | None = None`, `checked_out_by: str | None = None`, `from_value: str = ""`(스캔이 채움, 그룹 value와 같음).
  - 노드 줄 `target_id`: `node_dept:{map_id}` · `node_assignee:{map_id}`. `version_id` = 고칠 대상 버전(working, 없으면 published). `count` = 그 버전의 노드 수. 게시본에만 있고 working에 없으면 `pending=True`, `version_id=published_id`, `count`=게시본 노드 수.
  - `load_target_versions`는 홈 배지용으로 유지하되 APPROVED도 working으로 포함(`in_review`에 APPROVED 추가).
  - `FIXABLE`·`OWNER_ACTIONABLE`·`send_fix_requests`·`apply_remap`·`_parse_target`는 Task 5에서 지운다(이 태스크에선 건드리지 않음).
- [ ] **Step 1: 실패 테스트** — `test_node_lines_one_per_map_targeting_working_version`(게시본 2·Draft 1 → 줄 1개, `target_id == f"node_dept:{map_id}"`, `version_id == draft`, `count == 1`), `test_node_line_pending_when_only_published_has_value`(`pending is True`), `test_node_line_includes_approved_working_version`, `test_load_target_versions_includes_approved`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** `load_node_targets` 구현, `scan_dept_refs`·`scan_user_refs`의 노드 구간이 이를 쓰게 변경. 기존 `old` 구 드래프트 픽스처 기대값(구 드래프트 제외)은 유지.
- [ ] **Step 4:** `tests/test_ref_audit.py` 전체 PASS(기존 노드 기대값은 새 정의로 갱신, `test_list_maps_stale_ref_count_matches_audit_scan_scope`는 "홈 배지=게시본+working 각각" 정의로 이름·단언 수정).
- [ ] **Step 5:** 커밋 `feat(ref-audit): one node line per map aimed at the working version — 노드 줄 맵 단위·게시 대기`.

### Task 3: actor 범위와 줄별 결과 판정

**Files:**
- Create: `backend/app/ref_audit_policy.py`
- Test: `backend/tests/test_ref_audit_policy.py`

**Interfaces:**
- Consumes: Task 1 헬퍼, Task 2 `RefLine`·`NodeTarget`, `app.permissions.access.load_my_roles`·`get_admin_scope`, `app.permissions.deps.is_group_manager`, `workflow.load_active_approvers`.
- Produces:
  - `Outcome = Literal["direct","checkout","new_draft","approval","notify","locked","pending"]`; `ACTIONABLE: frozenset[str] = {"direct","checkout","new_draft","approval"}`.
  - `@dataclass NotifyTo: id: str; name: str; role: Literal["owner","holder"]`
  - `@dataclass Decision: outcome: Outcome; reason: str | None = None; notify_to: NotifyTo | None = None; warning: str | None = None`
  - `@dataclass ActorScope: login_id: str; is_sysadmin: bool; roles: dict[int, str]; managed_group_ids: set[int]; manageable_category_ids: set[int]` — `roles`는 editor·owner만 남긴다. 카테고리는 `_assert_can_manage_appointments`와 같은 규칙(sysadmin 전체, 아니면 admin 범위 안 + `level > min(seed levels)`).
  - `async def load_actor_scope(session, login_id: str) -> ActorScope`
  - `def is_line_visible(line: RefLine, scope: ActorScope) -> bool` — 맵 줄: `map_id in roles`(소프트삭제 맵 오우닝 줄은 sysadmin만), 그룹 줄: `group_id in managed_group_ids` 또는 sysadmin, 카테고리 줄: `category_id in manageable_category_ids`.
  - `@dataclass DecisionContext` — 판정에 필요한 사실을 한 번에 로드: 맵(owner_id·mode·visibility·owning_department), grant id→(role, principal_type, principal_id, map_id), in-approval 맵 id 집합, 맵별 재직 승인자 목록, 대기 다운그레이드 permission id 집합, (map_id, login) 워크플로 참여 쌍, actor의 대기 다운그레이드 맵 id 집합, `NodeTarget` 사전, 직원 표시명(login→name), 재직 login 집합.
  - `async def load_decision_context(session, lines: list[RefLine], scope: ActorScope) -> DecisionContext`
  - `def decide(line: RefLine, scope: ActorScope, ctx: DecisionContext, *, mode: str = "replace", to_value: str | None = None) -> Decision` — 순수 함수, 설계 §5·§6 표 그대로. `to_value`가 있으면: `map_owner`는 새 오너가 후보(명시 editor+ 또는 주관 부서 소속, ctx에 후보 집합 로드)가 아니면 `locked/not_eligible`; `node_assignee` 대체는 대상이 그 맵 열람권이 없으면 `warning="no_access"`(판정은 그대로). `mode="remove"`이고 소스가 제거 금지면 `locked/not_eligible`이 아니라 호출부가 422로 거른다(판정 대상 아님).
- [ ] **Step 1: 실패 테스트(표 기반)** — `@pytest.mark.parametrize`로 소스×역할 판정표:
  - `test_decide_collab_viewer_grant_direct_for_editor`, `test_decide_collab_editor_grant_approval_for_editor_direct_for_owner`, `test_decide_collab_departed_in_workflow_locked`(`reason == "in_workflow"`), `test_decide_collab_request_pending_locked`, `test_decide_approval_without_active_approver_notifies_owner`(`outcome == "notify"`, `notify_to.role == "owner"`).
  - `test_decide_owner_line_owner_left_for_editor`, `test_decide_owner_line_not_eligible_target`(to_value 비후보 → `not_eligible`).
  - `test_decide_approver_in_approval_locked_even_for_sysadmin`, `test_decide_approver_editor_notifies_owner`, `test_decide_owning_dept_and_sp_editor_notify_owner_direct_owner`.
  - 노드 6가지: `test_decide_node_no_working_new_draft`, `test_decide_node_mine_direct`, `test_decide_node_unheld_checkout`, `test_decide_node_actor_pending_downgrade_locked`, `test_decide_node_held_by_other_notifies_holder`(`notify_to.role == "holder"`), `test_decide_node_in_approval_locked`, `test_decide_node_pending_line_pending`.
  - `test_decide_framework_map_locked`, `test_decide_notify_without_owner_locked_owner_left`, `test_decide_node_assignee_no_access_warning`.
  - 범위: `test_scope_editor_sees_editor_maps_only`, `test_scope_group_manager_sees_group_lines`, `test_scope_category_appointment_rule`, `test_scope_sysadmin_sees_everything`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** 구현. 판정은 `decide` 한 곳, 로딩은 `load_*` 두 함수(쿼리 수는 줄 수와 무관하게 고정).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** 커밋 `feat(ref-audit): decide each line by the actor's normal permissions — 줄별 평소 권한 판정`.

### Task 4: 카드 조립 + 읽기 API(GET·summary)

**Files:**
- Create: `backend/app/ref_audit_cards.py`, `backend/app/routers/ref_audit.py`
- Modify: `backend/app/schemas.py` (구 `RefAuditOut`·`RefGroupOut`·`RefLineOut` 교체), `backend/app/main.py` (라우터 등록), `backend/app/routers/admin.py` (GET `/admin/ref-audit` 삭제)
- Test: `backend/tests/test_ref_audit_api.py`

**Interfaces:**
- Produces:
  - `@dataclass CardLine: line: RefLine; decision: Decision; map_role: str | None`
  - `@dataclass RefCard: kind: Literal["dept","user"]; key: str; label: str; sub: str; lines: list[CardLine]`
  - `async def build_cards(session, groups: list[RefGroup], scope, ctx) -> list[RefCard]` — 범위 밖 줄 제거·빈 카드 제거. 부서: `key = label = 리프명`, `sub = 경로 그룹의 상위 경로("A/B/C" → "A › B")`, 없으면 "". 사람: 로그인 값은 비활성 직원 기록으로 이름을 찾아 `key = login`, `label = 이름`, `sub = login`; 이름 값은 직원 `name`·`korean_name`으로 login을 찾으면 같은 key로 합치고, 못 찾으면 `key = label = 값`, `sub = ""`.
  - `def count_actionable(cards: list[RefCard]) -> int`
  - 스키마: `RefNotifyToOut{id,name,role}`, `RefCardLineOut{target_id, from_value, source, count, outcome, reason?, notify_to?, warning?, map_id?, map_name?, map_role?, version_id?, version_label?, group_id?, group_name?, category_id?, category_name?}`, `RefCardOut{kind,key,label,sub,lines}`, `RefAuditScopeOut{maps,groups,categories}`, `RefAuditOut{departments,users,scope,generated_at}`, `RefAuditSummaryOut{actionable:int}`.
  - `GET /api/ref-audit` → `RefAuditOut`, `GET /api/ref-audit/summary` → `RefAuditSummaryOut` (둘 다 로그인만 필요, 403 없음).
- [ ] **Step 1: 실패 테스트** — `test_get_ref_audit_editor_scope_and_outcomes`(Editor 헤더로 다른 맵 줄 없음, 줄마다 `outcome` 존재), `test_cards_merge_path_and_leaf_into_one_dept_card`, `test_cards_merge_login_and_name_into_one_user_card`, `test_cards_merge_keeps_per_line_from_value`, `test_summary_counts_only_actionable_places`(notify·locked·pending 제외), `test_viewer_only_user_sees_empty_page`, `test_admin_ref_audit_routes_removed`(404).
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현 + 라우터 등록 + 구 GET 삭제.
- [ ] **Step 4:** PASS + 기존 `test_ref_audit.py`의 구 API 테스트(`test_get_ref_audit_requires_sysadmin_and_returns_sections`)는 삭제.
- [ ] **Step 5:** 커밋 `feat(ref-audit): open the audit read API to every user in their scope — 감사 조회 API 일반 오픈`.

### Task 5: 미리보기·적용 API (a/b/c·승인 요청·알림)

**Files:**
- Create: `backend/app/ref_audit_apply.py`
- Modify: `backend/app/routers/ref_audit.py`, `backend/app/schemas.py` (구 `RefRemapIn/Out`·`RefNotify*` 삭제), `backend/app/routers/admin.py` (remap·notify 삭제), `backend/app/ref_audit.py` (`FIXABLE`·`OWNER_ACTIONABLE`·`send_fix_requests`·`apply_remap`·`_parse_target` 삭제, `_apply_line`·`_replace_owner`·`_resolve_to_value`는 apply 모듈로 이동)
- Test: `backend/tests/test_ref_audit_apply.py` (구 remap·notify 테스트는 여기로 옮겨 새 API로 재작성)

**Interfaces:**
- Consumes: Task 1~4 전부, `app.routers.versions.clone_graph`(함수 안 지연 import — 순환 방지), `record_version_event`, `workflow.create_notifications`.
- Produces:
  - 스키마: `RefTargetIn{target_id: str(3..100), from_value: str(1..1200)}`, `RefApplyIn{kind: "dept"|"user", mode: "replace"|"remove" = "replace", to_value: str(max 1200) = "", targets: list[RefTargetIn] (min 1)}`, `RefPreviewLineOut{target_id, outcome, reason?, notify_to?, warning?}`, `RefPreviewOut{lines}`, `RefApplyOut{places: dict[str,int], drafts: list[{map_id:int, version_id:int}], approval_requests: int, notified: int, skipped: list[{target_id:str, reason:str}]}`.
  - `async def preview_targets(session, *, actor: str, body: RefApplyIn) -> list[tuple[str, Decision]]`
  - `async def apply_targets(session, *, actor: str, body: RefApplyIn) -> RefApplyOut` — 한 트랜잭션, commit은 라우터.
  - `class RemapError(ValueError)` (유지) → 라우터 422.
  - 노드 쓰기: `async def write_node_values(session, version_id: int, source: str, from_value: str, to_name: str, mode: str) -> int` — 부서는 일치하면 교체/비움, 담당자는 `split_names` 후 from만 교체·제거하고 순서 유지 중복 제거, 바뀐 노드 수 반환, 버전 `updated_at` 갱신.
  - `POST /api/ref-audit/preview` → `RefPreviewOut`, `POST /api/ref-audit/apply` → `RefApplyOut`.
- 적용 규칙(설계 §5·§6):
  - 검증 먼저 전부: target 소스가 kind와 맞는지, remove인데 제거 금지 소스면 422, replace인데 `to_value` 무효면 422. 범위 밖·이미 바뀐 줄은 422가 아니라 `skipped`(`out_of_scope`·`already_changed`).
  - `direct`(설정류): 현행 `_apply_line` 동작. 사람·부서 grant 대체는 공개 맵 viewer·오우닝 부서와 같은 대상이면 새 grant 추가 생략(제거만).
  - `approval`: 대체면 새 grant 즉시 추가(중복이면 높은 역할 유지), 옛 grant는 `build_removal_request` + `notify_permission_request`.
  - 노드 `direct`: working에 `write_node_values`. `checkout`: working 점유를 actor로(`checked_out_at=now`) 후 쓰기. `new_draft`: `MapVersion(label="Reference cleanup")` 생성 → `clone_graph(published)` → `record_version_event(..., "created", actor)` → 점유 actor → 쓰기, `drafts`에 추가.
  - `notify`: 수신자별 1건 `ref_fix_requested`(payload `{actor, actor_name, count, as, maps: [{id, name, node_dept, node_assignee, sp_dept, sp_assignee, owning_dept, map_approver}]}`), `notified` = 수신자 수.
  - `locked`·`pending` 줄이 targets에 오면 `skipped`(이유 = reason 또는 `pending`).
- [ ] **Step 1: 실패 테스트** — `test_apply_node_direct_on_my_checkout`, `test_apply_node_takes_unheld_checkout`(`checked_out_by == actor`), `test_apply_node_creates_reference_cleanup_draft`(새 버전 label, 게시본 노드 불변, `drafts` 1건), `test_apply_node_held_by_other_sends_holder_notification`(수신자=점유자, payload `as == "holder"`, 노드 불변), `test_apply_collab_editor_by_editor_creates_approval_request`(ApprovalRequest 1건, 새 grant 존재, 옛 grant 남음), `test_apply_collab_editor_by_owner_direct`, `test_apply_approver_in_approval_skipped_for_sysadmin`, `test_apply_remove_blocked_source_422`, `test_apply_invalid_to_value_422_no_partial`, `test_apply_redecides_when_checkout_taken_meanwhile`, `test_apply_skips_already_fixed_line`, `test_node_assignee_replace_dedupes`, `test_node_assignee_replace_touches_only_from_value`, `test_preview_reports_not_eligible_owner_target`, `test_preview_reports_no_access_warning`, 그리고 구 테스트에서 옮긴 `test_apply_merges_duplicate_grant_keeping_higher_role`·`test_apply_sp_dept_writes_leaf_and_stamps`·`test_apply_owner_replace_deletes_departed_grant`.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현 + 구 admin 경로·스키마·함수 삭제.
- [ ] **Step 4:** 백엔드 전체 그린(Global Constraints 명령) + ruff.
- [ ] **Step 5:** 커밋 `feat(ref-audit): preview and apply under the common rules — 미리보기·적용(공통 규칙)`.

### Task 6: 프런트 API·순수 로직

**Files:**
- Modify: `frontend/src/lib/api.ts` (구 `RefLine`·`RefGroup`·`RefAudit`·`getRefAudit`·`postRefRemap`·`postRefNotify` 교체)
- Rewrite: `frontend/src/lib/ref-audit.ts`, `frontend/src/lib/ref-audit.test.ts`

**Interfaces:**
- Produces (`@/lib/api`): `RefOutcome`, `RefLockReason`, `RefNotifyTo`, `RefCardLine`, `RefCard`, `RefAuditData`(= 서버 `RefAuditOut`), `RefApplyBody`, `RefPreviewLine`, `RefApplyResult`, `getRefAudit(): Promise<RefAuditData>`, `getRefAuditSummary(): Promise<{actionable: number}>`, `postRefPreview(body): Promise<{lines: RefPreviewLine[]}>`, `postRefApply(body): Promise<RefApplyResult>` (경로 `/ref-audit`, `/ref-audit/summary`, `/ref-audit/preview`, `/ref-audit/apply`).
- Produces (`@/lib/ref-audit`):
  - `type Bucket = "fix" | "notify" | "lock" | "pend"`; `bucketOf(outcome: RefOutcome): Bucket` (`direct|checkout|new_draft|approval`→fix, `notify`→notify, `locked`→lock, `pending`→pend)
  - `tallyCard(card: RefCard): {fix: number; notify: number; lock: number; pend: number; places: number}` (곳 = `count` 합)
  - `sortCards(cards: RefCard[]): RefCard[]` — 전부 게시 대기인 카드는 뒤, 나머지는 fix 내림차순 → notify 내림차순 → label.
  - `summarizeMapRows(card: RefCard): {key: string; label: string; count: number; isGroup: boolean; isMore: boolean}[]` — 맵·그룹·카테고리별 곳 수 내림차순, 2개 이하면 그대로, 3개 이상이면 [1위, "외 N개"(나머지 합)].
  - `buildRingGradient(tally): string` — `conic-gradient(var(--color-added) 0% a%, var(--color-warn) …, var(--color-border-strong) …, var(--color-accent) …)`, 0인 구간 생략.
  - `forecastOutcomes(lines: {outcome: RefOutcome; count: number}[]): Map<RefOutcome, number>` (체크된 줄만 넘김)
  - `isLineCheckable(outcome: RefOutcome): boolean` (fix·notify 버킷만)
  - `REMOVE_BLOCKED: ReadonlySet<RefSource>`, `OUTCOME_META: Record<RefOutcome, {labelKey: MessageKey; icon: LucideIcon; tone: "ok"|"accent"|"warn"|"mute"|"pend"}>`, `SOURCE_ICON: Record<RefSource, LucideIcon>`(경우 아이콘 8종: Crown·Stamp·Users·Building2·Workflow·Layers·Group·FolderTree).
- [ ] **Step 1: 실패 테스트** — `tallyCard`(설계 예시 카드: fix 6·notify 2·places 8), `sortCards`(게시 대기 카드 맨 뒤), `summarizeMapRows`(3개 맵 → 2행, 둘째 행 `isMore`·합계), `buildRingGradient`(0 구간 생략·끝 100%), `forecastOutcomes`, `isLineCheckable`.
- [ ] **Step 2:** `npx vitest run src/lib/ref-audit.test.ts` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + `npx tsc --noEmit -p tsconfig.json`. 구 패널(`components/admin/ref-audit-panel.tsx`·`ref-group-card.tsx`)은 바뀐 타입으로 컴파일되지 않으므로 이 태스크에서 삭제하고, settings의 refs 탭 렌더는 Task 9 전까지 `null`로 둔다(구 admin API는 Task 4·5에서 이미 사라져 기능상 손실 없음).
- [ ] **Step 5:** 커밋 `feat(ref-audit): client types and card math for the open audit — 프런트 타입·카드 집계`.

### Task 7: 빨간 점 길 안내 + 설정 탭 위치

**Files:**
- Create: `frontend/src/lib/ref-audit-summary.ts`, `frontend/src/lib/ref-audit-summary.test.ts`
- Modify: `frontend/src/components/top-nav.tsx`, `frontend/src/app/settings/page.tsx`, `frontend/src/components/maps/map-card-warnings-modal.tsx`, `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Produces:
  - `REF_AUDIT_CHANGED_EVENT = "bpm:ref-audit-changed"`; `notifyRefAuditChanged(): void`(window 이벤트 발행)
  - `useRefAuditSummary(enabled: boolean): number` — 마운트·이벤트 때 `getRefAuditSummary()`, 실패하면 0(콘솔 경고), 언마운트 가드.
  - TopNav: `actionable > 0`이고 메뉴가 닫혀 있으면 이름 버튼 우상단 점(`data-id="nav-ref-dot"`), 메뉴가 열리면 "설정" 줄 오른쪽 점(`data-id="nav-settings-ref-dot"`). 점 = 8px `bg-error` 원 + `ring-2 ring-surface`(아이콘 축소 단계 stage≥4에서도 같은 위치).
  - Settings: `CATEGORIES`에 `{labelKey: "admin.catChecks", access: "everyone", tabs: [{id: "refs", labelKey: "admin.refAuditTab"}]}`를 "승인" 앞에 추가, "조직"에서 refs 제거. 탭 옆 점(`data-id="settings-tab-refs-dot"`). 딥링크 화이트리스트에 `refs` 추가(`?tab=refs`).
  - 홈 경고 모달의 `home.staleRefsNote` 옆에 `/settings?tab=refs` 링크(`data-id="map-warnings-open-refs"`, 문구 `home.staleRefsOpen`).
  - i18n: `admin.catChecks` en "Checks" / ko "점검", `home.staleRefsOpen` en "Open orphaned refs" / ko "고아 참조 열기".
- [ ] **Step 1: 실패 테스트** — `useRefAuditSummary`가 이벤트로 재조회하는지(fetch 모킹 2회), 실패 시 0.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** vitest·tsc·lint PASS.
- [ ] **Step 5:** 커밋 `feat(nav): guide users to fixable orphaned refs with a red dot — 빨간 점 길 안내·점검 분류`.

### Task 8: 페이지 히어로 + SVG 설명 그림

**Files:**
- Create: `frontend/src/components/ref-audit/ref-audit-hero.tsx`, `frontend/src/components/ref-audit/ref-audit-illustration.tsx`, `frontend/src/components/ref-audit/ref-outcome-chip.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 6 `OUTCOME_META`·`tallyCard`.
- Produces:
  - `RefOutcomeChip({outcome, count?, recipient?}: {outcome: RefOutcome; count?: number; recipient?: string})` — 칩 1개(톤 색은 토큰: ok=`added`, accent, warn, mute=`surface-alt`/`ink-tertiary`, pend=점선 accent). `recipient`가 있으면 "오너에게 알림 · 이름"처럼 붙인다.
  - `RefAuditHero({page, loading, onRescan}: {page: RefAuditData | null; loading: boolean; onRescan: () => void})` — 왼쪽: eyebrow·제목·한 줄 설명·숫자 3개(부서 카드 수·사용자 카드 수·고칠 곳=fix 버킷 곳 합)·범위 칩(`scope.maps`·`scope.groups`·`scope.categories`가 0이면 숨김)·다시 스캔. 오른쪽: 그림 + 결과 범례(호버 한 줄 설명) + 힌트. 높이 목표: 1440×900 뷰포트에서 화면 위쪽 약 1/3.
  - `RefAuditIllustration()` — 시안의 SVG(viewBox 760×260: 오늘의 조직도 · 끊긴 고리 · 데모 맵 "Employee Onboarding"(Start → Process Request → Order Fulfillment) · 그룹 · 카테고리)를 토큰 클래스로 옮긴다. 이름은 중립 표기(i18n: 나/Me, 사용자 A/User A, 팀 B/Team B …). 경우 아이콘 8개는 HTML 버튼 오버레이(퍼센트 좌표, `data-id="ref-case-<source>"`), 호버·포커스 시 설명창(`glass glass-dense`, 어디/누가 역할 칩/대체·제거 아이콘 칩(대체 ArrowLeftRight accent, 제거 Trash2 error, 불가는 취소선 회색, 부분 허용은 "사람만"/"담당자만")/주의 한 줄). 설명 문구는 설계 §5 표에서 한 줄로.
- [ ] **Step 1:** 스토리 대신 렌더 스모크 테스트 `ref-audit-hero.test.tsx`(jsdom): 숫자 3개·범위 칩 숨김 규칙, 경우 버튼 8개 존재.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** vitest·tsc·lint PASS.
- [ ] **Step 5:** 커밋 `feat(ref-audit): illustrated hero with per-case hover help — 그림 설명·경우별 호버`.

### Task 9: 부서·사용자 섹션과 카드

**Files:**
- Create: `frontend/src/components/ref-audit/ref-audit-page.tsx`, `frontend/src/components/ref-audit/ref-dept-card.tsx`, `frontend/src/components/ref-audit/ref-user-card.tsx`
- Modify: `frontend/src/app/settings/page.tsx` (refs 탭이 `RefAuditPage` 렌더), `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 6·8.
- Produces:
  - `RefAuditPage()` — 로드·에러·빈 상태(`data-id="ref-audit-empty"`), 히어로, 두 섹션(`data-id="ref-audit-depts"`·`"ref-audit-users"`). 섹션 그리드: 컨테이너 폭이 되면 `grid-cols-[1.35fr_1fr]`, 아니면 1열. 카드 그리드: 부서 `repeat(auto-fill,minmax(196px,1fr))`, 사용자 `repeat(auto-fill,minmax(128px,1fr))`(아바타 축소분만큼 시안 144→128). 카드 클릭 → Task 10 다이얼로그.
  - `RefDeptCard({card, onOpen})` — `aspect-[4/3]`, 윗변 3px warn 띠(게시 대기만이면 accent 띠·시계 타일), 머리줄 [각진 점선 타일 · 이름(2줄 clamp) · › 상위 경로] + 오른쪽 숫자(곳 수, 단위 글자 없음, `text-[17px]` 600), 가운데 `summarizeMapRows` 최대 2줄(맵 아이콘·이름 말줄임·곳 수), 아래 결과 막대(버킷 비율)·집계 한 줄. `data-id="ref-card-dept-${key}"`.
  - `RefUserCard({card, onOpen})` — `aspect-square`, 가운데 정렬, 아바타 지름 36px(링 두께 3px, 시안 50px에서 축소)·이니셜은 이름 첫 글자·퇴직 표식(UserX 10px), 이름·로그인(없으면 `refAudit.nameOnly`), 집계 한 줄, 오른쪽 위 숫자(단위 글자 없음, `text-[15px]` 600). `data-id="ref-card-user-${key}"`.
- [ ] **Step 1:** 렌더 테스트 `ref-audit-cards.test.tsx` — 부서 카드 맵 줄 3개 이상이면 "외 N" 행, 숫자 옆 단위 글자 없음, 게시 대기 카드 표식, 사용자 카드 링 style에 `conic-gradient`.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS + tsc·lint.
- [ ] **Step 5:** 커밋 `feat(ref-audit): department and person card grids — 부서·사용자 카드 그리드`.

### Task 10: 상세 창(대체·제거·미리보기·적용)

**Files:**
- Create: `frontend/src/components/ref-audit/ref-detail-dialog.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 6 API·로직, `ModalBackdrop`, `DeptTreePicker`(부서 대체), `PrincipalPicker`(사람 대체, 현 패널과 같은 props), `ConfirmDialog`, `notifyRefAuditChanged`.
- Produces: `RefDetailDialog({card, onClose, onApplied}: {card: RefCard; onClose: () => void; onApplied: (result: RefApplyResult) => void})`
  - 머리: 타일/아바타 · 이름 · `sub · 맵 n · 곳 n` · 닫기.
  - 대체 줄: `[사라진 이름(점선 warn)] → [피커 | 지우기(error)]` + 세그먼트 `대체(ArrowLeftRight) | 제거(Trash2)`(부서 카드는 제거 disabled + 툴팁 `refAudit.deptReplaceOnly`). 제거 모드면 이름에 취소선.
  - 본문: 맵·그룹·카테고리별 묶음. 머리의 맵 이름은 `next/link` `href=/maps/${map_id}`(새 탭 아님, `data-id="ref-line-map-link-${map_id}"`), 그룹은 `/settings?tab=groups`, 역할 칩(`map_role`), 버전 상태 글자. 줄: 체크(`isLineCheckable`가 아니면 disabled) · 소스 아이콘+라벨 · 내용(노드 n개/설정 이름) · 짧은 메모(reason·warning 번역) · `RefOutcomeChip`(알림이면 `recipient = notify_to.name`).
  - 대상·모드가 바뀌면 `postRefPreview` → 줄 판정·경고 갱신(디바운스 없이 마지막 요청만 반영). 대상이 없으면 GET 판정을 쓴다.
  - 아래: "적용하면" `forecastOutcomes` 칩들 · 취소 · 적용(`바꾸기 n` accent / `지우기 n` error, 대체인데 대상 없거나 0이면 disabled). 적용 → `ConfirmDialog`(내 점유 Draft 줄이 있으면 "열어 둔 에디터는 새로 고침" 안내 포함) → `postRefApply` → `onApplied(result)` → `notifyRefAuditChanged()`.
  - `RefAuditPage`는 `onApplied`에서 토스트(`refAudit.appliedToast`: "N곳 반영 · M곳 게시 필요 · K명 알림 · L건 승인 요청", 0인 항목 생략) 후 재조회.
- [ ] **Step 1:** 렌더 테스트 `ref-detail-dialog.test.tsx` — 부서 카드 제거 버튼 disabled, 알림 줄 칩에 수신자 이름, 맵 링크 href, 잠김 줄 체크 disabled, 제거 모드 적용 버튼 문구.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS + tsc·lint.
- [ ] **Step 5:** 커밋 `feat(ref-audit): detail dialog with map links, recipients and preview — 상세 창·맵 바로가기·수신자 표시`.

### Task 11: 문서·카탈로그·브라우저 검증

**Files:**
- Modify: `frontend/COMPONENTS.md`(생성), `docs/manual/user-manual-general-ko.md`·`-en.md`, `docs/manual/admin-manual-ko.md`·`-en.md`, `docs/manual/user-manual-editing-ko.md`·`-en.md`(고아 참조 언급 문장만: "설정 › 점검 › 고아 참조, 내 권한 범위", 긴 대시 금지), `backend/app/manual.md`(언급이 있으면), `PROGRESS.md`, `CLAUDE.md` Lessons에 한 줄(감사=공통 규칙·판정 단일 소스 `ref_audit_policy.decide`)
- Create: `frontend/scripts/pw-smoke-ref-audit-open.mjs`

**Interfaces:**
- Consumes: `backend/scripts/seed_ref_audit_demo.py`(데모 고아 시드), 로컬 포트 3047/8048(`--webpack`), `BPM_SYSADMINS=admin.sys DEV_ENFORCE_PERMISSIONS=true`.
- [ ] **Step 1:** 스모크 스크립트 — Editor 사용자와 `admin.sys` 각각: 상단 이름 점 보임 → 메뉴 열면 설정 줄 점 → 설정 › 점검 › 고아 참조 탭 점 → 히어로 경우 아이콘 호버 설명창 → 부서 카드 클릭 → 대상 선택 → 미리보기 칩 갱신 → 적용 → 토스트 → 카드·점 갱신. 캡처 `../.shots/ref-audit-open-*.png`. 콘솔 에러 0.
- [ ] **Step 2:** `node scripts/build-component-catalog.mjs` 후 `--check` PASS.
- [ ] **Step 3:** 프런트·백엔드 전체 게이트(Global Constraints) PASS, 스크린샷을 사용자에게 공유(SendUserFile).
- [ ] **Step 4:** 커밋 `docs(ref-audit): manuals, catalog and smoke for the open audit — 매뉴얼·카탈로그·스모크`.

# Subprocess Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미등록(SP 미지정) 맵을 subprocess 노드로 먼저 링크하고, 등록 요청(ApprovalRequest kind='sp_designation')을 보내거나 새 맵을 즉시 생성해 연결한다.

**Architecture:** DDL 없음. 플레이스홀더 = 미지정 맵을 `linked_map_id`로 링크한 subprocess 노드(기존 `designated=False` 경고 렌더 재사용). 등록 요청은 map_rename 워크플로 완전 미러(생성/pending/철회/범용 decide). 수락의 실제 경로는 `PUT /subprocess-designation`이 pending 요청을 자동 applied 처리하는 것(모달 저장만으로 완결).

**Tech Stack:** FastAPI + SQLAlchemy(async) / Next.js + React / pytest + vitest + Playwright(pw-verify 스크립트).

**Spec:** `docs/superpowers/specs/2026-07-19-subprocess-placeholder-design.md`

## Global Constraints

- 작업 위치: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/sp-placeholder` (브랜치 `worktree-sp-placeholder`). 머지는 사용자 요청 시에만.
- 알림 메시지·UI 문자열 영어(동적 데이터만 한글). i18n 키는 EN/KO 두 블록 모두 추가.
- raw hex 금지 — 토큰 클래스만. Lucide 16px strokeWidth 1.5.
- 백엔드 테스트 실행: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (backend/에서).
- 커밋마다 PROGRESS.md 같은 커밋에 갱신. 커밋 메시지 `type(scope): English — 한국어`.
- `PUT /subprocess-designation`의 게시본 필수(409) 불변식은 유지 — 절대 완화하지 않는다.

---

### Task 1: BE — library `include_undesignated` + 가시성 필터

**Files:**
- Modify: `backend/app/routers/library.py` (list_processes, 22-88행)
- Test: `backend/tests/test_sp_designation_workflow.py` (신규)

**Interfaces:**
- Produces: `GET /api/library/processes?include_undesignated=true` — 각 행에 `"designated": bool` 추가(항상). 미지정 행은 role≥viewer 가시성 필터, `department/assignee/system/duration=None` 마스킹(직전 지정 잔존값 유출 방지).

- [x] **Step 1: 실패 테스트 작성** — 신규 파일에 rename 테스트의 `enforce`/`act_as`/`_seed` 패턴 복제(`test_map_rename_workflow.py` 25-48행 참조). 시드 헬퍼는 `sp_designated_at` 유무·visibility 인자화:

```python
"""sp_designation 워크플로 테스트 — 플레이스홀더 링크·등록 요청·수락 (spec 2026-07-19)."""
# seed_sp_map(name, *, designated, visibility="public", published=True) -> map_id
#   ProcessMap(owning_department="Owning Anchor Division", visibility, sp_designated_at=now|None)
#   + MapVersion(label="v1", status="published", version_number=1) (published=True일 때)
#   + MapPermission owner/editor/viewer 3행 (rename 테스트 seed 미러)

class TestLibraryUndesignated:
    def test_default_excludes_undesignated(self, client, enforce): ...
    def test_flag_includes_visible_undesignated_with_flag_and_masked_attrs(self, client, enforce): ...
    def test_flag_hides_private_undesignated_from_stranger(self, client, enforce): ...
    def test_designated_rows_have_designated_true(self, client, enforce): ...
```

- [x] **Step 2: RED 확인** — `pytest tests/test_sp_designation_workflow.py -q` → FAIL (designated 키 없음/미지정 미포함)
- [x] **Step 3: 구현** — `list_processes`에 `include_undesignated: bool = Query(False)`, `user: str = Depends(get_current_user)` 추가. 기본 쿼리 where에서 `sp_designated_at.is_not(None)`을 조건부로: 플래그 시 전체 로드 후 미지정 맵만 가시성 판정. 가시성은 `maps.py list_maps` 194-247행의 배치 패턴 재사용(sysadmin 조기 전체 허용 → Employee org_path → 대상 맵 MapPermission 일괄 → MapApprover set → group ids → `logic.effective_role(...) is not None`). 행 dict에 `"designated": designated_at is not None` 추가, 미지정 행은 sp 어트리뷰트 4종 None.
- [x] **Step 4: GREEN + 전체 회귀** — 신규 테스트 + `pytest tests/ -q` 전체 그린
- [x] **Step 5: Commit** — `feat(library): opt-in undesignated maps with visibility filter — 미지정 맵 옵트인 노출`

### Task 2: BE — sp-designation-requests 생성/조회/철회 + 알림

**Files:**
- Modify: `backend/app/routers/maps.py` (rename 엔드포인트 569-673행 아래에 미러 추가), `backend/app/schemas.py` (`SpDesignationRequestIn` 신설, `RenameRequestIn` 43행 옆)
- Test: `backend/tests/test_sp_designation_workflow.py` (클래스 추가)

**Interfaces:**
- Produces: `POST /api/maps/{map_id}/sp-designation-requests` (body `{from_map_id: int}`, 201, viewer 게이트) / `GET .../pending` (row|null, viewer) / `DELETE .../pending` (204, 요청자만). payload 서버 구성 `{from_map_id, from_map_name, map_name}`. 알림 `sp_designation_requested` → owner 롤 협업자(요청자 제외).

- [x] **Step 1: 실패 테스트** — `TestCreateSpRequest`(201·payload 박제·오너 알림 map_id 필터 단언, 이미 지정 409, 중복 pending 409, 삭제 맵 404), `TestPendingWithdraw`(null→row, 타인 철회 403, 무 pending 404). rename 테스트 261행식 `client.post(f"/api/maps/{map_id}/sp-designation-requests", json={"from_map_id": host_id})`.
- [x] **Step 2: RED 확인** (404 Not Found)
- [x] **Step 3: 구현** — `create_rename_request`(569-623행) 미러: 게이트 `require_map_role("viewer")`, 404(삭제)·409(`sp_designated_at is not None` → "map is already designated")·409(dup pending). from_map은 `session.get(ProcessMap, payload.from_map_id)`로 이름 해석(없으면 ""). 알림 message: `f"{requester_name} requested to register '{found_map.name}' as a subprocess"`.
- [x] **Step 4: GREEN + 전체 회귀**
- [x] **Step 5: Commit** — `feat(subprocess): sp designation request endpoints — SP 등록 요청 생성·조회·철회`

### Task 3: BE — decide 통합 + Inbox 블록 + PUT 자동 적용

**Files:**
- Modify: `backend/app/routers/permissions.py` (decide 게이트 388행, `_apply_request` 443행 부근, `_notify_permission_decision` 479행 부근)
- Modify: `backend/app/routers/inbox.py` (block 3 필터 116행, block 4 아래 block 5 신설)
- Modify: `backend/app/routers/maps.py` (`designate_subprocess` 736행 `was_new` 블록 + `_apply_pending_sp_designation` 헬퍼)
- Test: `backend/tests/test_sp_designation_workflow.py` (클래스 추가)

**Interfaces:**
- Consumes: Task 2의 요청 행(kind='sp_designation').
- Produces: 범용 decide가 sp_designation 처리(오너 게이트, reject→`sp_designation_rejected`, approve는 미지정 시 409 pending 유지·삭제 맵 멱등 applied). PUT 최초 지정 시 pending 자동 applied + `sp_designation_approved`. Inbox에 오너 게이트 카드(detail=payload).

- [x] **Step 1: 실패 테스트** — `TestDecideSp`(오너 reject→rejected+알림, editor decide 403, approver(비오너) 403, sysadmin ok, **approve 미지정 409 & pending 유지**, 삭제 맵 approve 멱등 applied), `TestAutoApplyOnDesignate`(pending 중 오너 PUT 지정 → 요청 applied + 요청자 `sp_designation_approved` 알림 — 게시본 있는 시드 필수), `TestInboxSp`(오너에게 노출·approver에겐 미노출·삭제 맵 숨김·detail.from_map_name).
- [x] **Step 2: RED 확인**
- [x] **Step 3: 구현** —
  - permissions.py 388행: `if req.kind in ("map_rename", "sp_designation"):` → owner 게이트.
  - `_apply_request`에 분기: 맵 없음/삭제 → return(멱등), `sp_designated_at is None` → `raise HTTPException(409, "map is not designated yet — save the designation first")` (커밋 전 중단 → pending 유지), 지정돼 있으면 no-op(PUT이 이미 적용).
  - `_notify_permission_decision`에 분기: `type=f"sp_designation_{outcome}"`, message `f"Your subprocess registration request for '{req.payload.get('map_name','')}' was {outcome}"`.
  - inbox.py block 3: `ApprovalRequest.kind.not_in(["map_rename", "sp_designation"])`. block 5: block 4(153-191행) 미러, kind만 교체, `detail: req.payload`, before/after None.
  - maps.py: `_supersede_pending_rename`(544-566행) 미러 헬퍼 `_apply_pending_sp_designation(session, map_id, *, actor, map_name)` — status="applied", decided_by/at, 알림 `sp_designation_approved`. `designate_subprocess`의 `if was_new:` 블록 끝에서 호출.
- [x] **Step 4: GREEN + 전체 회귀 + ruff** — `ruff check app/ tests/`
- [x] **Step 5: Commit** — `feat(subprocess): decide integration + inbox card + auto-apply on designation — 수락 체인·자동 적용`

### Task 4: FE — api/피커 토글/새 맵 프리필 자동링크

**Files:**
- Modify: `frontend/src/lib/api.ts` (LibraryProcess에 `designated: boolean`, `listLibraryProcesses(includeUndesignated=false)`, sp 요청 3함수)
- Modify: `frontend/src/components/map-name-dropdown.tsx` (토글·배지·2단 확인·onToast·initialName/onCreatedMap 전달)
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx` (`initialName?`, `onCreatedMap?`)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (MapNameDropdown 마운트 6948행에 `onToast={showToast}`)
- Modify: `frontend/src/lib/i18n-messages.ts` (EN/KO 키)
- Test: 기존 vitest 스위트 그린 + `npx tsc --noEmit`

**Interfaces:**
- Consumes: Task 1·2의 API.
- Produces: `createSpDesignationRequest(mapId, fromMapId): Promise<ApprovalRequest>` / `getPendingSpDesignationRequest(mapId)` / `withdrawSpDesignationRequest(mapId)` (Task 5·6이 사용). CreateMapDialog `onCreatedMap?: (mapId: number, name: string) => void`(지정 시 router.push 생략).

- [x] **Step 1: api.ts** — `listLibraryProcesses(includeUndesignated = false)`: 플래그 시 `"/library/processes?include_undesignated=true"`. 요청 3함수는 rename 3함수(295-308행) 미러(`/maps/${mapId}/sp-designation-requests`).
- [x] **Step 2: map-name-dropdown** —
  - state `showUnregistered`(기본 false). 라이브러리 fetch(51-63행)를 `showUnregistered` 의존으로 확장(켜면 재조회). 토글 UI는 검색 인풋 아래 체크박스 행(`text-fine`, `library.showUnregistered`).
  - 행 배지: 라이브러리 행 존재 && `!row.designated` → "Not registered" 필(`text-fine text-ink-tertiary border-hairline`).
  - 링크 버튼 게이트 `canAddLink`는 불변(미지정 행은 플래그 켰을 때만 서버가 반환하므로 자동 확장).
  - `Pending` kind에 `"link-unreg"` 추가: 미지정 맵의 링크 버튼은 이 kind. 확인 1(링크 확인, 기존 문구 재사용) onConfirm → `onAddLinkNode(id, name)` 후 `setPending({kind:"request", map})` 전환 → 확인 2(`library.requestTitle/Message`, confirmLabel "Send request", cancelLabel "Link only") onConfirm → `createSpDesignationRequest(map.id, mapId)` → 성공 토스트 `library.requestSent`, 409 → `library.requestAlreadyPending`; onClose → 링크만.
  - 신규 prop `onToast?: (msg: string) => void`.
  - footer newMap(224-237행): `isEditing`이면 `<CreateMapDialog initialName={query.trim() || undefined} onCreatedMap={(id, name) => { setShowCreate(false); closeAll(); onAddLinkNode(id, name); }}>`.
- [x] **Step 3: create-map-dialog** — Props에 `initialName?: string; onCreatedMap?: (mapId: number, name: string) => void;`. `useState(csvBaseName)` → `useState(initialName ?? csvBaseName)`. `handleCreate` 성공 말미(313-315행): `onCreatedMap` 있으면 `onCreated(); onClose(); onCreatedMap(created.mapId, trimmed); return;` (router.push 생략).
- [x] **Step 4: i18n 키 추가(EN/KO)** — `library.showUnregistered`, `library.notRegistered`, `library.requestTitle`, `library.requestMessage`, `library.requestSent`, `library.requestAlreadyPending`.
- [x] **Step 5: 게이트** — `npx tsc --noEmit` 0, `npm run lint` 신규 에러 0, `npx vitest run` 전체 그린
- [x] **Step 6: Commit** — `feat(editor): picker unregistered-map toggle + create-and-link flow — 피커 미등록 토글·생성 즉시 링크`

### Task 5: FE — 인스펙터 등록 요청 CTA

**Files:**
- Create: `frontend/src/components/subprocess-registration-cta.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (SubprocessVersionPicker 마운트 아래, `selectedSpRef && !selectedSpRef.designated` 조건)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 4의 요청 3함수, `useCurrentMockUser`.
- Produces: `<SubprocessRegistrationCta linkedMapId fromMapId onToast? />` — pending 조회 후 CTA/Requested 배지/본인 철회 렌더.

- [ ] **Step 1: 컴포넌트** — 마운트 시 `getPendingSpDesignationRequest(linkedMapId)`(실패는 조용히 null). 상태: 미pending → "Request registration" 버튼(`sp.request.cta`) → 생성 성공 시 pending 갱신+토스트 `sp.request.sent`, 409 → 재조회+`library.requestAlreadyPending`. pending && 본인 → "Requested" 배지 + Withdraw(`sp.request.withdraw`) → 철회 시 토스트 `sp.request.withdrawn`. pending && 타인 → 배지만. 스타일: 인스펙터 카드 관례(`rounded-md border border-hairline px-3 py-2 text-caption`).
- [ ] **Step 2: page.tsx 마운트 + i18n(EN/KO)** — `sp.request.cta/pending/withdraw/sent/withdrawn`.
- [ ] **Step 3: 게이트** — tsc 0, lint 신규 0, vitest 그린
- [ ] **Step 4: Commit** — `feat(inspector): request-registration CTA on undesignated links — 미등록 링크 등록요청 CTA`

### Task 6: FE — Inbox sp_designation 카드

**Files:**
- Modify: `frontend/src/app/inbox/page.tsx` (approvalTitle 73행·approvalSummary 86행 분기, actApproval 280행 분기, ApprovalDetail sp 브랜치, 지정 모달 상태)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: InboxApproval(title="sp_designation", detail={from_map_name,...}), `SubprocessDesignationModal`(mapId, publishedVersionId, initial, onSaved, onClose), `getMap`.
- Produces: 수락=모달 저장만으로 완결(decide 호출 없음), Reject=기존 경로.

- [ ] **Step 1: 라벨/요약** — `inbox.reqKind.sp_designation`("Subprocess registration"), `inbox.summary.sp_designation`("Register `{map}` as a subprocess — requested from `{from}`.", from=detail.from_map_name).
- [ ] **Step 2: ApprovalDetail sp 브랜치** — `approval.title === "sp_designation"`일 때 useEffect로 `getMap(approval.map_id)` 로드(실패 무시) → 게시본 = versions 중 status published 최대 id. 게시본 있으면 "Go to published version" 링크(`/maps/{id}?version={pubId}`, 새 탭), 없으면 `inbox.sp.noPublished` 안내 + Approve 버튼 비활성. Approve 클릭 → `onSpAccept(approval, detail)` 콜백(신규 prop) — decide 호출하지 않음. Reject은 기존 onAct(false).
- [ ] **Step 3: 페이지 모달 체인** — `spModal: {approval, detail, publishedVersionId} | null` state. onSpAccept에서 세팅. `SubprocessDesignationModal` 마운트(initial은 detail.sp_* → DesignationForm 매핑, subprocess-inspector-card 74-88행 프리필 미러). onSaved → 토스트 `inbox.toast.spDesignated` + `listInboxApprovals()` 재조회 + 모달 닫기. actApproval의 reject 분기에 `sp_designation` 토스트(`inbox.toast.spRejected`) 추가.
- [ ] **Step 4: i18n(EN/KO)** — `inbox.reqKind.sp_designation`, `inbox.summary.sp_designation`, `inbox.sp.goPublished`, `inbox.sp.noPublished`, `inbox.toast.spDesignated`, `inbox.toast.spRejected`.
- [ ] **Step 5: 게이트 + Commit** — tsc·lint·vitest → `feat(inbox): sp designation card with designation-modal accept — 등록요청 수락 카드`

### Task 7: 통합 게이트 + Playwright 검증 + 문서

**Files:**
- Create: `frontend/scripts/pw-verify-sp-placeholder.mjs` (기존 `pw-verify-map-rename.mjs` 하네스 관례 미러)
- Modify: `PROGRESS.md`

**Interfaces:** 없음(검증 전용).

- [ ] **Step 1: 전체 게이트** — backend `pytest tests/ -q` + `ruff check app/ tests/` / frontend `npx tsc --noEmit` + `npm run lint` + `npx vitest run` + `npm run build`
- [ ] **Step 2: pw 시나리오** — 백엔드(포트 89xx, DEV_ENFORCE_PERMISSIONS=true·BPM_SYSADMINS=admin.sys)+프론트(32xx) 실기동: ① 에디터 피커 토글 → 미등록 맵 배지 확인 → 링크+요청 발송(토스트) → 노드 미지정 경고 배지 확인, ② 인스펙터 CTA Requested 배지·철회, ③ 오너 전환 → Inbox 카드 확인 → 게시본 없는 맵 Accept 비활성 안내, 게시본 있는 맵 Accept → 지정 모달 저장 → 카드 소멸 + 요청자 알림, ④ Reject 경로, ⑤ 피커 "Create new map" 프리필 → 생성 → 자동 링크 확인. 콘솔 에러 0 필수(의도적 4xx 필터 허용).
- [ ] **Step 3: PROGRESS.md 갱신 + Commit** — `test(sp-placeholder): pw end-to-end verification — 실기동 검증`

## Self-Review 결과

- 스펙 §1(모델)=Task 없음(DDL 무), §2-1=T1, §2-2~4=T2, §2-5~8=T3, §3=T4·T5, §4=T6, §6=각 태스크+T7 — 커버 완료.
- 타입 일관성: `createSpDesignationRequest(mapId, fromMapId)` T4 정의·T5/T6 소비 일치. `onCreatedMap(mapId, name)` T4 내 정의·소비.
- 미지정 배지 렌더 소스는 오토세이브 후 `refreshFullGraph`→`rootGraph.subprocess_refs` — 검증 완료(page.tsx 1433-1445행).

# Governance R3: 후속 정비 6건 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** R2 최종 리뷰·태스크 리뷰가 defer한 후속 6건(F1~F6)을 한 라운드로 정비한다.

**Architecture:** 전부 프론트엔드(+i18n). 새 맵 모달의 협업자 추가를 R6 role 팝오버 패턴으로 통일(RolePopover 공용 추출 — 두 번째 사용처 등장으로 추상화 정당), 나머지는 소규모 로직/문구 정비.

**Tech Stack:** Next.js/TS/React(React Compiler), vitest.

## Global Constraints

- 브랜치 `feat/governance-r3`(기점 dev 2c3170e), 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/governance-r3`.
- FE 게이트 4종(각 태스크): `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`. BE는 T5에서만(무변경 확인용).
- i18n 신설 키는 EN/KO 양쪽. raw hex 금지. data-id `surface-role`. React Compiler — 수동 memo 금지.
- 커밋: `type(scope): English — 한국어` + PROGRESS.md R3 섹션 한 줄 APPEND 동일 커밋.
- 백엔드 코드 무변경(전 태스크).

---

### Task T1: F2 ⓘ 클릭 전파 차단 + F4 SP 지정 409 humanize

**Files:** Modify `frontend/src/components/subprocess-inspector-card.tsx` · `frontend/src/lib/api-errors.ts` · `frontend/src/lib/i18n-messages.ts`

1. **F2**: 카드 헤더 접이식 `<button>` 안의 ⓘ(`Tooltip`+`Info`) 래퍼에 클릭 전파 차단 — Tooltip을 감싼 요소에 `onClick={(e) => e.stopPropagation()}`(필요 시 wrapper `<span>` 신설). 아이콘 클릭이 접힘/펼침을 더 이상 토글하지 않아야 함. `subprocess-usage-tab.tsx`는 접이식 아님 — 건드리지 않는다.
2. **F4**: 백엔드 detail `"a designation request is already pending"`(backend/app/routers/maps.py:756, 코드 수정 금지 — 문자열만 참조)을 `api-errors.ts` DETAIL_PREFIX_MAP에 추가 → 신설 키 `apiError.spDesignationPending` EN "A registration request is already pending for this map." / KO "이미 이 맵의 등록 요청이 승인 대기 중입니다." (기존 apiError.* 키 근처 앵커, 기존 매핑 형식 그대로).
3. 게이트 4종 → 커밋 `fix(inspector): stop info-icon toggling collapse + humanize SP pending 409 — ⓘ 클릭 전파 차단·SP 등록 409 문구`

### Task T2: F3 no-op 스택 변경 드롭 + F6 카운트 동봉 제외

**Files:** Modify `frontend/src/lib/permission-staging.ts` · `frontend/src/lib/permission-staging.test.ts` · `frontend/src/components/permissions/collaborators-panel.tsx` · `frontend/src/components/maps/map-detail-card.tsx` · `frontend/src/components/permissions/pending-approvals-panel.tsx`

1. **F3**: `permission-staging.ts`에 신설:
   ```ts
   // 현재 role을 다시 선택하면 그 행의 staged op를 지운다(no-op change를 쌓지 않음 — R2 최종 리뷰 후속).
   // change 후 원복뿐 아니라 staged remove 후 원래 role 재선택도 "원상 유지" 의도이므로 같은 키로 소거된다.
   export function stageRoleChange(
     ops: StagedOp[],
     permissionId: number,
     toRole: "viewer" | "editor",
     currentRole: string,
   ): StagedOp[] {
     if (toRole === currentRole) {
       return removeStagedOp(ops, { kind: "change", permissionId, toRole });
     }
     return upsertStagedOp(ops, { kind: "change", permissionId, toRole });
   }
   ```
   두 표면의 role 변경 핸들러(현재 `upsertStagedOp(..., { kind: "change", ... })` 호출 지점 — 각 파일 grep)를 `stageRoleChange(ops, perm.id, toRole, perm.role)`로 교체.
2. **F3 테스트**(`permission-staging.test.ts` 기존 스타일에 추가): ① toRole===currentRole이면 기존 change op 소거 ② staged remove 상태에서 currentRole 선택 시 remove도 소거 ③ 다른 role이면 upsert와 동일 동작.
3. **F6**: `pending-approvals-panel.tsx` `countPending`(:27) — 동봉 행(`r.kind === "visibility_change" && r.payload.version_id != null`, 파일 내 :168 동일 판정 참조) 제외. 이 행은 버전 승인으로만 결정되는 읽기전용이라 결재 대기 배지에 세지 않는다(목록 표시는 유지 — 렌더 로직 무변경). 판정을 로컬 헬퍼 `isBundledRow(r)`로 빼서 :168과 공유.
4. 게이트 4종 → 커밋 `fix(permissions): drop no-op staged changes + exclude bundled rows from pending count — 원복 선택 소거·동봉 행 카운트 제외`

### Task T3: F1 새 맵 모달 협업자 추가 — role 팝오버 통일

**Files:** Create `frontend/src/components/permissions/role-popover.tsx` · Modify `frontend/src/components/permissions/add-collaborator.tsx` · `frontend/src/components/permissions/create-map-dialog.tsx` · `frontend/src/lib/i18n-messages.ts`(필요 시)

1. **RolePopover 공용 추출**: `add-collaborator.tsx`의 로컬 RolePopover를 `role-popover.tsx`로 이동(named export, props 그대로 — 후보 이름·클릭 좌표·viewerGrantDisabled·onPick(role)·onClose. 두 번째 사용처 등장 — 추상화 정당). `add-collaborator.tsx`는 import로 전환, **동작·마크업 byte 동일**(무변화 리팩터).
2. **create-map-dialog 전환**(:615-655 협업자 블록):
   - 우측 role `<select>`(:645-655?)·public 정적 Editor 라벨(:637-643)·`pendingCollabRole` state 제거.
   - `PrincipalPicker onSelect={addCollaborator}`(:633) → `(opt, coords) => setPendingPick(...)`(coords 없으면 입력 wrapper rect 하단 폴백 — add-collaborator.tsx와 동일 패턴) + `highlightId` 전달.
   - RolePopover 렌더: 버튼 클릭 → 기존 `addCollaborator` 로직으로 로컬 `collaborators` 리스트에 append(맵 생성 전 로컬 스테이징 — 서버 호출 없음, 기존 그대로) + pendingPick 해제. 퍼블릭이면 Viewer 미노출·Editor만으로 2-step 유지(R6 계약).
   - 기존 부가 동작 보존: 추가된 행의 role 태그 클릭 토글(:246)·excludeIds(:358)·빈목록 문구·3.5행 스크롤 영역.
   - **추가 플래시**: 방금 추가된 행(:677 리스트)에 `picker-flash` + `scrollIntoView({block:"nearest"})`(R6의 lastAddedKey 패턴 재사용, data-id 기반).
   - 미사용화되는 i18n 키(예: collaboratorRole* 셀렉트 전용 키)가 생기면 사용처 0 확인 후 제거, report에 기록. 라벨 재사용 가능하면 신설 금지.
3. 게이트 4종 → 커밋 `feat(permissions): unify create-map collaborator picker with role popover — 새 맵 모달 협업자 추가 팝오버 통일`

### Task T4: F5 체크아웃 폴 — 본인 pending 강등 409 시 폴 중지

**Files:** Modify `frontend/src/app/maps/[mapId]/page.tsx`(체크아웃 폴 effect :2477-2510 부근, `CHECKOUT_POLL_MS`로 검색)

1. 폴 catch에서 **본인 권한 변경 pending 409**(R1 역방향 뮤텍스 — `getApiErrorDetail`이 `api-errors.ts` DETAIL_PREFIX_MAP의 `apiError.permissionPending`류 매핑 접두와 일치하는지로 판정; 정확한 백엔드 detail은 versions.py acquire_checkout에서 grep)를 감지하면:
   - `setStatus(humanizeApiError(err, t))` 1회(이미 R2 픽스로 인간화됨 — 유지) 후 **인터벌 중지**(재시도 스팸 제거). effect 구조상 `intervalId`를 클로저 변수로 두고 catch에서 guard 후 `clearInterval`. 첫 poll(인터벌 설정 전) 실패 시엔 플래그로 인터벌 생성 자체를 생략.
   - 다른 에러는 기존 동작 유지(다음 폴 재시도).
2. 편집 차단 확인(코드 검증만): 체크아웃 미보유(checkout null/mine=false) 상태에서 편집 affordance가 이미 게이트되는지 확인해 report에 기록 — 추가 read-only 배선은 스코프 밖.
3. 검증: 이 파일은 컴포넌트 테스트가 없음 — 게이트 4종 + 폴 중지 로직의 코드 경로 self-review로 갈음(브라우저 검증은 QA 체크리스트로 이관).
4. 게이트 4종 → 커밋 `fix(editor): stop checkout polling on own pending-downgrade 409 — 본인 강등 대기 시 폴 중지`

### Task T5: 최종 게이트 + QA R3 소섹션 + PROGRESS 마감

**Files:** Modify `docs/qa/governance-ux-checklist.md` · `PROGRESS.md`

1. BE 전체(`AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + ruff — 무변경 확인) + FE 4종.
2. QA 문서 `## R2` 섹션 뒤에 `## R3 (후속 정비)` 추가 — 5항목: R3-1 새 맵 모달 협업자 role 팝오버(퍼블릭 Editor 2-step 포함)·R3-2 SP ⓘ 클릭이 접힘 안 바꿈·R3-3 role 원복 선택 시 스택 태그 소거(Save 시 no-op 미집계)·R3-4 SP 등록 요청 중복 409 읽기 쉬운 문구·R3-5 본인 강등 대기 중 드래프트 진입 시 안내 1회+반복 에러 없음(+동봉 행이 결재 대기 배지에 안 세짐). 헤더 게이트 수치 실측 갱신.
3. PROGRESS R3 한 줄 마감 → 커밋 `docs(qa): R3 follow-ups verification checklist — R3 후속 정비 검증 체크리스트`

실행 순서: T1→T2→T3→T4→T5.

## Self-Review 결과

- F1~F6 ↔ T1(F2·F4)/T2(F3·F6)/T3(F1)/T4(F5) 전부 매핑, T5 마감.
- stageRoleChange의 "remove 후 원복 선택=remove 소거"는 의도 문서화(주석+테스트 ②) — 키가 kind-무관이라 자연 동작.
- RolePopover 추출은 두 번째 사용처(create-map-dialog) 등장으로 정당 — add-collaborator.tsx 쪽은 무변화 리팩터로 검증.

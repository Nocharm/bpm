# 협업자 스테이징 UX 7종 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 협업자 편집의 즉시/승인 예고·pending 필 중복 픽스·호버 캔슬·pending 회수·되돌리기 + 오우닝 피커 조직도 브라우즈 + 홈 필터 3단계 반응형.

**Architecture:** 스테이징 스택(`lib/permission-staging.ts`)에 forecast 순수 함수와 op별 상세 결과(records)를 추가하고, 3개 표면(맵 카드 2마운트 + 설정 패널)이 공용 `HoverSwapPill`로 취소/회수 인터랙션을 통일한다. 되돌리기는 메모리 스냅샷 → 역방향 플랜(`lib/permission-undo.ts`) → 확인 모달. 백엔드는 `PendingChangeOut.request_id` 1필드만 추가.

**Tech Stack:** Next.js + TS strict + Tailwind 토큰, vitest(lib), FastAPI + pytest(BE 1건), Playwright+시스템 Chrome(최종 검증).

**Spec:** `docs/superpowers/specs/2026-08-14-collab-staging-ux-design.md` (사용자 승인 완료)

## Global Constraints

- **작업 위치**: 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/frontend-minor` (브랜치 `fix/frontend-minor`). 서브에이전트 디스패치 시 절대경로 명시 + 시작 시 `pwd`·`git branch --show-current` 확인 필수.
- **raw hex 금지** — 토큰 클래스만(`rules/frontend/design.md`). 이모지 금지, Lucide 아이콘(필 내부 12px, 버튼 14px, strokeWidth 1.5).
- **UI 문구 영어**, i18n 키는 `lib/i18n-messages.ts`의 EN 블록·KO 블록 **양쪽** 추가.
- **React Compiler**: trivial setState 핸들러는 plain function(useCallback 금지 — deps 불일치 시 빌드 실패).
- **버튼 커서/눌림은 전역 base** — 컴포넌트엔 hover 배경만 추가.
- **다크모드 스타일 금지**, 2-space 들여쓰기, `interface` 우선, `any` 금지.
- **FE/BE 이중 구현(forecast)**: 수정 시 양쪽 동기화 주석 필수(`backend/app/permissions/logic.py` ↔ `frontend/src/lib/permission-staging.ts`).
- **커밋마다 `PROGRESS.md` 같은 커밋에 갱신**(`rules/common/git.md`) — "2026-08-14 — 협업자 스테이징 UX 구현(fix/frontend-minor)" 섹션에 불릿 추가. 커밋 메시지는 `type(scope): English — 한국어` 병기.
- **게이트**(각 태스크 커밋 전): 해당 테스트 그린 + `npx tsc --noEmit` + `npm run lint`(frontend 변경 시), `ruff check app/ tests/`(backend 변경 시). 브라우저 실구동 검증은 Task 9에서 일괄(서버 기동 비용 때문 — 각 태스크는 코드 게이트까지).
- frontend 명령은 `frontend/`에서, backend 명령은 `backend/`에서 실행.

---

### Task 1: BE — `PendingChangeOut.request_id`

**Files:**
- Modify: `backend/app/schemas.py:184-188` (PendingChangeOut)
- Modify: `backend/app/routers/permissions.py:117-124` (list_permissions 직렬화)
- Test: `backend/tests/test_permission_endpoints.py:1216-1252` (기존 테스트 보강)

**Interfaces:**
- Produces: `GET /api/maps/{id}/permissions` 응답의 `pending_change`가 `{to_role, requested_by, request_id}` — Task 5·6·7이 FE에서 `request_id`로 철회 호출.

- [ ] **Step 1: backend venv 셋업(워크트리 최초 1회)**

```bash
cd backend
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt \
  || (python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt)
```

- [ ] **Step 2: 기존 테스트에 request_id 단언 추가(실패 확인)**

`test_permissions_list_exposes_pending_change`에서 pending 생성 응답(PATCH/DELETE의 `approval_request.id`)을 캡처해 단언을 확장한다. 기존 `== {"to_role": ..., "requested_by": ...}` 딕셔너리 동등 단언 2곳(1235, 1251 부근)에 `"request_id": <캡처한 id>` 키를 추가:

```python
    req_id = res.json()["approval_request"]["id"]  # pending 을 만든 PATCH/DELETE 응답에서 캡처
    ...
    assert by_principal["ed"]["pending_change"] == {
        "to_role": "viewer",
        "requested_by": "own.er",   # 기존 값 유지 — 실제 테스트의 기존 기대값 그대로
        "request_id": req_id,
    }
```

- [ ] **Step 3: 실패 확인**

```bash
AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" \
  .venv/bin/python -m pytest tests/test_permission_endpoints.py::test_permissions_list_exposes_pending_change -q
```
Expected: FAIL (KeyError 또는 dict 불일치 — request_id 없음)

- [ ] **Step 4: 구현**

`schemas.py`:

```python
class PendingChangeOut(BaseModel):
    """행에 걸린 pending 다운그레이드 요약 — to_role None = 제거 요청 (R2)."""

    to_role: str | None
    requested_by: str
    # 요청자 본인 철회(DELETE /approval-requests/{id})용 — 에디터는 맵 승인요청 목록을 못 읽는다
    request_id: int
```

`permissions.py` list_permissions:

```python
        pending_change = (
            PendingChangeOut(
                to_role=req.payload.get("to_role"),
                requested_by=req.requested_by,
                request_id=req.id,
            )
            if req is not None
            else None
        )
```

- [ ] **Step 5: 그린 확인 + 전체 스위트**

```bash
AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q
.venv/bin/ruff check app/ tests/
```
Expected: 전부 PASS. (PendingChangeOut 응답을 dict 동등 비교하는 다른 테스트가 깨지면 같은 방식으로 request_id 추가.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/permissions.py backend/tests/test_permission_endpoints.py PROGRESS.md
git commit -m "feat(perm): expose pending_change.request_id for requester withdraw — pending 마커에 request_id 노출(본인 회수용)"
```

---

### Task 2: FE lib — `forecastStagedOp`

**Files:**
- Modify: `frontend/src/lib/permission-staging.ts`
- Test: `frontend/src/lib/permission-staging.test.ts`

**Interfaces:**
- Produces: `forecastStagedOp(op: StagedOp, grantRole: string | undefined, actorIsOwner: boolean): "instant" | "approval"` — Task 4·5·6이 스테이지 필 아이콘·Undo 모달 예고에 사용.

- [ ] **Step 1: 실패 테스트 작성** — `permission-staging.test.ts`에 describe 추가:

```ts
describe("forecastStagedOp", () => {
  it("add는 항상 instant", () => {
    expect(
      forecastStagedOp({ kind: "add", principalType: "user", principalId: "u1", role: "editor" }, undefined, false),
    ).toBe("instant");
  });

  it("viewer→editor 승격은 instant", () => {
    expect(forecastStagedOp({ kind: "change", permissionId: 1, toRole: "editor" }, "viewer", false)).toBe("instant");
  });

  it("editor→viewer 다운그레이드는 approval", () => {
    expect(forecastStagedOp({ kind: "change", permissionId: 1, toRole: "viewer" }, "editor", false)).toBe("approval");
  });

  it("editor 제거는 approval, viewer 제거는 instant", () => {
    expect(forecastStagedOp({ kind: "remove", permissionId: 1 }, "editor", false)).toBe("approval");
    expect(forecastStagedOp({ kind: "remove", permissionId: 1 }, "viewer", false)).toBe("instant");
  });

  it("오너 actor는 전부 instant", () => {
    expect(forecastStagedOp({ kind: "change", permissionId: 1, toRole: "viewer" }, "editor", true)).toBe("instant");
    expect(forecastStagedOp({ kind: "remove", permissionId: 1 }, "editor", true)).toBe("instant");
  });
});
```

임포트 라인에 `forecastStagedOp` 추가.

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/lib/permission-staging.test.ts
```
Expected: FAIL — `forecastStagedOp` is not exported

- [ ] **Step 3: 구현** — `permission-staging.ts`에 추가:

```ts
// 이 op가 저장 시 즉시 적용될지 승인 대기로 갈지 예측 — BE 판정의 FE 미러.
// ⚠️ backend/app/permissions/logic.py requires_downgrade_approval + routers/permissions.py의
// actor_role=owner 즉시 적용 규칙과 동치 유지(양쪽 수정 시 동기화). 어긋나도 표시만 틀리고
// 실동작 진실은 서버 응답(mutation.pending)이다.
export function forecastStagedOp(
  op: StagedOp,
  grantRole: string | undefined,
  actorIsOwner: boolean,
): "instant" | "approval" {
  if (actorIsOwner || op.kind === "add") return "instant";
  if (grantRole !== "editor") return "instant";
  if (op.kind === "remove") return "approval";
  return op.toRole === "viewer" ? "approval" : "instant";
}
```

- [ ] **Step 4: 그린 확인**

```bash
npx vitest run src/lib/permission-staging.test.ts && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/permission-staging.ts frontend/src/lib/permission-staging.test.ts PROGRESS.md
git commit -m "feat(perm): forecastStagedOp instant/approval predictor — 스테이지 즉시/승인 예측 FE 미러"
```

---

### Task 3: FE lib — `applyStagedOps` 상세 records + `permsById`

**Files:**
- Modify: `frontend/src/lib/permission-staging.ts` (StagedResult 확장)
- Modify: `frontend/src/components/permissions/collaborators-panel.tsx:320` (호출부 파라미터 추가)
- Modify: `frontend/src/components/maps/map-detail-card.tsx:283` (호출부 파라미터 추가)
- Test: `frontend/src/lib/permission-staging.test.ts`

**Interfaces:**
- Consumes: `MapPermission`, `ApprovalRequest` 타입(`@/lib/api`), `PermissionMutationResult.approval_request`.
- Produces:

```ts
export interface AppliedOpRecord {
  op: StagedOp;
  outcome: "applied" | "pending" | "failed";
  createdPermission?: MapPermission;   // add 성공 시 — 역방향: 이 id 제거
  approvalRequest?: ApprovalRequest;   // pending 생성 시 — 역방향: withdraw
  prev?: { principalType: PrincipalType; principalId: string; role: string }; // change/remove의 저장 직전 스냅샷
  message?: string;                    // failed 시 서버 detail 원문
}
export interface StagedResult {
  applied: number;
  pending: number;
  failed: { op: StagedOp; message: string }[];
  records: AppliedOpRecord[];
}
export async function applyStagedOps(
  mapId: number,
  ops: StagedOp[],
  permsById?: Map<number, MapPermission>,
): Promise<StagedResult>;
```

- [ ] **Step 1: 실패 테스트 작성** — 기존 applyStagedOps describe에 추가(모킹 스타일은 파일 상단 vi.mock 그대로):

```ts
  it("records에 op별 결과·생성물·prev 스냅샷을 담는다", async () => {
    const created = { id: 9, principal_type: "user", principal_id: "u1", role: "editor", granted_by: "me" };
    addMock.mockResolvedValue(created as never);
    changeMock.mockResolvedValue({ pending: false, permission: {} } as never);
    removeMock.mockResolvedValue({
      pending: true,
      approval_request: { id: 77, status: "pending" },
    } as never);
    const perms = new Map([
      [1, { id: 1, principal_type: "user", principal_id: "v1", role: "viewer", granted_by: "x" }],
      [2, { id: 2, principal_type: "user", principal_id: "e2", role: "editor", granted_by: "x" }],
    ]);
    const ops: StagedOp[] = [
      { kind: "add", principalType: "user", principalId: "u1", role: "editor" },
      { kind: "change", permissionId: 1, toRole: "editor" },
      { kind: "remove", permissionId: 2 },
    ];

    const result = await applyStagedOps(7, ops, perms as never);

    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({ outcome: "applied", createdPermission: { id: 9 } });
    expect(result.records[1]).toMatchObject({
      outcome: "applied",
      prev: { principalType: "user", principalId: "v1", role: "viewer" },
    });
    expect(result.records[2]).toMatchObject({
      outcome: "pending",
      approvalRequest: { id: 77 },
      prev: { principalType: "user", principalId: "e2", role: "editor" },
    });
  });

  it("실패 op는 records에 failed+message로 남는다", async () => {
    addMock.mockRejectedValue(new Error("409 conflict"));
    const result = await applyStagedOps(7, [
      { kind: "add", principalType: "user", principalId: "u1", role: "viewer" },
    ]);
    expect(result.records[0]).toMatchObject({ outcome: "failed", message: "409 conflict" });
  });
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/lib/permission-staging.test.ts
```
Expected: FAIL — `records` undefined

- [ ] **Step 3: 구현** — `applyStagedOps` 본문 교체(카운트·failed 동작은 불변):

```ts
export async function applyStagedOps(
  mapId: number,
  ops: StagedOp[],
  permsById?: Map<number, MapPermission>,
): Promise<StagedResult> {
  const result: StagedResult = { applied: 0, pending: 0, failed: [], records: [] };
  for (const op of ops) {
    // change/remove 역방향(되돌리기) 재료 — 저장 직전 스냅샷. add는 서버 생성물이 재료.
    const prevPerm = op.kind === "add" ? undefined : permsById?.get(op.permissionId);
    const prev = prevPerm
      ? {
          principalType: prevPerm.principal_type as PrincipalType,
          principalId: prevPerm.principal_id,
          role: prevPerm.role,
        }
      : undefined;
    try {
      if (op.kind === "add") {
        const created = await addMapPermission(mapId, op.principalType, op.principalId, op.role);
        result.applied += 1;
        result.records.push({ op, outcome: "applied", createdPermission: created });
      } else {
        const mutation =
          op.kind === "change"
            ? await changeMapPermission(mapId, op.permissionId, op.toRole)
            : await removeMapPermission(mapId, op.permissionId);
        if (mutation.pending) {
          result.pending += 1;
          result.records.push({ op, outcome: "pending", approvalRequest: mutation.approval_request, prev });
        } else {
          result.applied += 1;
          result.records.push({ op, outcome: "applied", prev });
        }
      }
    } catch (err) {
      const message = getApiErrorDetail(err);
      result.failed.push({ op, message });
      result.records.push({ op, outcome: "failed", message });
    }
  }
  return result;
}
```

임포트에 `type MapPermission, type ApprovalRequest` 추가(`@/lib/api`). 기존 테스트가 `toEqual`로 result 전체를 비교한다면 `records` 포함으로 갱신.

- [ ] **Step 4: 호출부 2곳에 permsById 전달(동작 무변경)**

`collaborators-panel.tsx` `handleSaveStaged`:

```ts
const result = await applyStagedOps(mapIdNum, stagedOps, new Map(perms.map((p) => [p.id, p])));
```

`map-detail-card.tsx` 저장 핸들러(283행 부근, members 목록 사용):

```ts
const result = await applyStagedOps(mapId, stagedOps, new Map((members ?? []).map((m) => [m.id, m])));
```

- [ ] **Step 5: 그린 확인**

```bash
npx vitest run src/lib/permission-staging.test.ts && npx tsc --noEmit && npm run lint
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/permission-staging.ts frontend/src/lib/permission-staging.test.ts \
  frontend/src/components/permissions/collaborators-panel.tsx frontend/src/components/maps/map-detail-card.tsx PROGRESS.md
git commit -m "feat(perm): applyStagedOps per-op records with prev snapshots — 저장 결과 상세 레코드(되돌리기 재료)"
```

---

### Task 4: 설정 패널 — 예고 아이콘·pending 중복 픽스·호버 캔슬·회수 (+공용 HoverSwapPill·i18n)

**Files:**
- Create: `frontend/src/components/permissions/hover-swap-pill.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (EN 1186 부근·KO 2798 부근 양쪽)
- Modify: `frontend/src/lib/api.ts:893` (pending_change 타입)
- Modify: `frontend/src/components/permissions/collaborators-panel.tsx`
- Modify: `frontend/src/app/maps/[mapId]/settings/page.tsx:396` (isOwner prop)

**Interfaces:**
- Consumes: Task 1 `request_id`, Task 2 `forecastStagedOp`, `withdrawApprovalRequest`(`api.ts:989`).
- Produces(Task 5·6 재사용):

```tsx
// hover-swap-pill.tsx
export function HoverSwapPill(props: {
  base: ReactNode;          // 기본 필 내용(아이콘+문구) — 크기 결정자
  swapLabel: string;        // 호버/focus-visible 시 회색 필 라벨
  onActivate: () => void;
  title?: string;           // 버튼 툴팁(예: forecast 문구)
  disabled?: boolean;
  dataId?: string;
  className?: string;       // 래퍼 버튼 추가 클래스(고정폭 등)
}): ReactNode;
```

- [ ] **Step 1: i18n 키 추가(EN·KO 양쪽)**

```ts
// EN 블록
"perm.staged.forecastInstant": "Applies immediately on save",
"perm.staged.forecastApproval": "Needs approval after save",
"perm.staged.cancelPill": "Cancel",
"perm.pending.withdraw": "Withdraw",
"perm.pending.withdrawDone": "Request withdrawn",
// KO 블록
"perm.staged.forecastInstant": "저장 시 즉시 적용",
"perm.staged.forecastApproval": "저장 시 승인 필요",
"perm.staged.cancelPill": "취소",
"perm.pending.withdraw": "회수",
"perm.pending.withdrawDone": "요청을 회수했습니다",
```

- [ ] **Step 2: api.ts pending_change 타입 확장**

```ts
  pending_change?: { to_role: string | null; requested_by: string; request_id: number } | null;
```

- [ ] **Step 3: HoverSwapPill 구현**

```tsx
"use client";

// 호버 스왑 필 — 기본 필이 호버/키보드 포커스 시 같은 자리·같은 크기의 회색 액션 필로
// 크로스페이드(150ms). 스테이지 취소·pending 회수 공용 문법 (map-detail-card 역할→Remove 스왑 선례).

import type { ReactNode } from "react";

export function HoverSwapPill({
  base,
  swapLabel,
  onActivate,
  title,
  disabled = false,
  dataId,
  className = "",
}: {
  base: ReactNode;
  swapLabel: string;
  onActivate: () => void;
  title?: string;
  disabled?: boolean;
  dataId?: string;
  className?: string;
}) {
  if (disabled) {
    return <span className={`relative inline-flex items-center justify-center ${className}`}>{base}</span>;
  }
  return (
    <button
      type="button"
      data-id={dataId}
      title={title}
      className={`group/swap relative inline-flex items-center justify-center ${className}`}
      onClick={(e) => {
        e.stopPropagation(); // 카드 유저 행은 클릭=펼침 토글 — 필 클릭이 행 토글로 새지 않게
        onActivate();
      }}
    >
      <span className="inline-flex items-center transition-opacity duration-150 group-hover/swap:opacity-0 group-focus-visible/swap:opacity-0">
        {base}
      </span>
      {/* 오버레이가 래퍼(=base 크기)를 그대로 채워 지오메트리 불변 */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center rounded-sm border border-hairline bg-surface text-fine text-ink-secondary opacity-0 transition-opacity duration-150 group-hover/swap:bg-surface-alt group-hover/swap:opacity-100 group-focus-visible/swap:opacity-100"
      >
        {swapLabel}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: collaborators-panel 행 개편** — `CollaboratorRow` 수정:

(a) **pending 중복 제거**: 역할 배지 분기(152행 부근)에서 `isPending`을 배지 pending 표시에 쓰지 않는다:

```tsx
      {isOwner || isPending || stagedRemove ? (
        <RoleBadge role={role} />
      ) : controlsDisabled ? (
```

(pending 행은 컨트롤 잠금 유지 — select 미노출 조건은 기존 그대로. `RoleBadge`의 `pending` prop 자체는 삭제하지 않는다.)

(b) **pending 상세 태그**(173-180행)에 truncate + 본인 요청이면 HoverSwapPill로 회수:

```tsx
      {pendingChange && (
        pendingChange.requested_by === currentUserId ? (
          <HoverSwapPill
            dataId={`perm-pending-withdraw-${perm.id}`}
            title={t("perm.pending.by", { name: pendingByName })}
            swapLabel={t("perm.pending.withdraw")}
            onActivate={() => onWithdrawPending(perm)}
            base={
              <span className="min-w-0 max-w-full truncate rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
                {perm.role} → {pendingChange.to_role ?? t("perm.pending.removed")} · {t("perm.pending.tag")}
              </span>
            }
          />
        ) : (
          <span
            className="min-w-0 max-w-full truncate rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed"
            title={t("perm.pending.by", { name: pendingByName })}
          >
            {perm.role} → {pendingChange.to_role ?? t("perm.pending.removed")} · {t("perm.pending.tag")}
          </span>
        )
      )}
```

(c) **스택 태그(183-201행) — X버튼 제거, HoverSwapPill + forecast 아이콘**:

```tsx
      {stagedOp && (
        <HoverSwapPill
          dataId={`perm-staged-cancel-${perm.id}`}
          title={t(forecast === "approval" ? "perm.staged.forecastApproval" : "perm.staged.forecastInstant")}
          swapLabel={t("perm.staged.cancelPill")}
          onActivate={() => onCancelStaged(stagedOp)}
          base={
            <span
              className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${
                stagedRemove ? "border-error text-error" : "border-changed text-changed"
              }`}
            >
              {forecast === "approval" ? (
                <Hourglass size={12} strokeWidth={1.5} />
              ) : (
                <Zap size={12} strokeWidth={1.5} />
              )}
              {stagedChange
                ? `${t(role === "editor" ? "perm.roleEditor" : "perm.roleViewer")} → ${t(stagedChange.toRole === "editor" ? "perm.roleEditor" : "perm.roleViewer")} · ${t("perm.staged.change")}`
                : t("perm.staged.remove")}
            </span>
          }
        />
      )}
```

행 상단에 `const forecast = stagedOp ? forecastStagedOp(stagedOp, perm.role, actorIsOwner) : "instant";` 추가. `CollaboratorRow` props에 `actorIsOwner: boolean`·`onWithdrawPending: (perm: ApiPermission) => void` 추가, lucide 임포트에 `Hourglass, Zap` 추가(X는 남는 사용처 확인 후 정리).

(d) **staged add 고스트 행**(403-431행)의 태그+X도 동일 치환:

```tsx
          <HoverSwapPill
            dataId={`perm-staged-add-cancel-${addKey}`}
            title={t("perm.staged.forecastInstant")}
            swapLabel={t("perm.staged.cancelPill")}
            onActivate={() => handleCancelStaged(op)}
            base={
              <span className="inline-flex items-center gap-1 rounded-sm border border-added px-1.5 py-0.5 text-fine text-added">
                <Zap size={12} strokeWidth={1.5} />
                {t("perm.staged.add")}
              </span>
            }
          />
          <RoleBadge role={op.role} />
```

(기존 X `<button>` 삭제.)

(e) **패널 본체**: props에 `isOwner: boolean` 추가, `handleWithdrawPending` plain function 추가:

```ts
  async function handleWithdrawPending(perm: ApiPermission) {
    if (!perm.pending_change) return;
    try {
      await withdrawApprovalRequest(perm.pending_change.request_id);
      onToast(t("perm.pending.withdrawDone"));
      await reload();
    } catch (err) {
      onToast(humanizeApiError(err, t));
    }
  }
```

`CollaboratorRow` 렌더에 `actorIsOwner={isOwner}` `onWithdrawPending={(p) => void handleWithdrawPending(p)}` 전달. `withdrawApprovalRequest` 임포트 추가.

- [ ] **Step 5: settings 페이지에서 isOwner 전달** — `settings/page.tsx:396` `<CollaboratorsPanel ...>`에 `isOwner={isOwner}` 추가(변수는 162행 기존재).

- [ ] **Step 6: 게이트**

```bash
npx vitest run && npx tsc --noEmit && npm run lint
```
Expected: 전부 PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/permissions/hover-swap-pill.tsx frontend/src/lib/i18n-messages.ts frontend/src/lib/api.ts \
  frontend/src/components/permissions/collaborators-panel.tsx "frontend/src/app/maps/[mapId]/settings/page.tsx" PROGRESS.md
git commit -m "feat(perm): panel forecast icons, single pending pill, hover-cancel, withdraw — 설정 패널 예고·중복픽스·호버캔슬·회수"
```

---

### Task 5: 맵 카드(홈 미리보기·에디터 맵 탭) — 동일 4종 적용

**Files:**
- Modify: `frontend/src/components/maps/map-detail-card.tsx`

**Interfaces:**
- Consumes: Task 4의 `HoverSwapPill`·i18n 키·`request_id` 타입, Task 2 `forecastStagedOp`. 카드의 `isOwner`(`:377`)·`loginId`·`ROLE_PILL_WIDTH_CLASS`(`:71`).

- [ ] **Step 1: pending 중복 제거(572-576행)** — RoleBadge에서 pending 표시 제거·고정폭 복원:

```tsx
                  <RoleBadge role={perm.role as MapRole} className={ROLE_PILL_WIDTH_CLASS} />
```

- [ ] **Step 2: pending 행 Remove 스왑 게이트** — `removable`(513행)에 `!perm.pending_change` 추가(이미 pending인 grant에 remove를 쌓으면 저장 시 서버 409 — 어포던스 자체를 닫는다):

```ts
    const removable = canManageMembers && perm.role !== "owner" && !stagedRemove && !perm.pending_change;
```

- [ ] **Step 3: pending 상세 태그(603-612행)** — truncate + 본인 요청이면 회수 스왑(패널과 동일 패턴, 카드는 `nameById`·`loginId` 사용):

```tsx
              {perm.pending_change && (
                perm.pending_change.requested_by === loginId ? (
                  <HoverSwapPill
                    dataId={`map-detail-pending-withdraw-${perm.id}`}
                    title={t("perm.pending.by", {
                      name: nameById.get(perm.pending_change.requested_by) ?? perm.pending_change.requested_by,
                    })}
                    swapLabel={t("perm.pending.withdraw")}
                    onActivate={() => void handleWithdrawPending(perm)}
                    className="max-w-full"
                    base={
                      <span className="min-w-0 max-w-full truncate rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
                        {perm.role} → {perm.pending_change.to_role ?? t("perm.pending.removed")} · {t("perm.pending.tag")}
                      </span>
                    }
                  />
                ) : (
                  <span
                    className="min-w-0 max-w-full truncate rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed"
                    title={t("perm.pending.by", {
                      name: nameById.get(perm.pending_change.requested_by) ?? perm.pending_change.requested_by,
                    })}
                  >
                    {perm.role} → {perm.pending_change.to_role ?? t("perm.pending.removed")} · {t("perm.pending.tag")}
                  </span>
                )
              )}
```

`handleWithdrawPending`은 Task 4(e)와 동일 본문(재조회는 카드의 기존 저장 후 재조회 경로 재사용 — 저장 핸들러가 쓰는 members 리로드 함수 호출).

- [ ] **Step 4: 스택 제거 태그(616-635행)** — X버튼 삭제, HoverSwapPill(고정폭 유지):

```tsx
            {stagedRemove && (
              <HoverSwapPill
                dataId={`map-detail-staged-cancel-${perm.id}`}
                title={t(
                  forecastStagedOp({ kind: "remove", permissionId: perm.id }, perm.role, isOwner) === "approval"
                    ? "perm.staged.forecastApproval"
                    : "perm.staged.forecastInstant",
                )}
                swapLabel={t("perm.staged.cancelPill")}
                onActivate={() => handleCancelStaged({ kind: "remove", permissionId: perm.id })}
                base={
                  <span
                    className={`inline-flex items-center justify-center gap-1 rounded-sm border border-error px-1.5 py-0.5 text-fine text-error ${ROLE_PILL_WIDTH_CLASS}`}
                  >
                    {forecastStagedOp({ kind: "remove", permissionId: perm.id }, perm.role, isOwner) === "approval" ? (
                      <Hourglass size={12} strokeWidth={1.5} />
                    ) : (
                      <Zap size={12} strokeWidth={1.5} />
                    )}
                    {t("perm.staged.remove")}
                  </span>
                }
              />
            )}
```

주의: `ROLE_PILL_WIDTH_CLASS`(60px)에 아이콘+문구가 넘치면 아이콘 포함 실측으로 폭 상수를 이 필에서만 완화(`min-w-[60px]`) — 기존 역할/Remove 필은 불변.

- [ ] **Step 5: staged add 행(984-1035행)** — 태그+X를 HoverSwapPill로 치환(Task 4(d)와 동일 마크업, dataId `map-detail-staged-add-cancel-${addKey}`).

- [ ] **Step 6: 게이트 + Commit**

```bash
npx vitest run && npx tsc --noEmit && npm run lint
git add frontend/src/components/maps/map-detail-card.tsx PROGRESS.md
git commit -m "feat(perm): map card forecast icons, single pending pill, hover-cancel, withdraw — 맵 카드 예고·중복픽스·호버캔슬·회수"
```

---

### Task 6: 되돌리기 — `lib/permission-undo.ts` + 확인 모달 + 두 표면 배선

**Files:**
- Create: `frontend/src/lib/permission-undo.ts`
- Create: `frontend/src/lib/permission-undo.test.ts`
- Create: `frontend/src/components/permissions/undo-last-apply-modal.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`(EN·KO)
- Modify: `frontend/src/components/permissions/collaborators-panel.tsx`
- Modify: `frontend/src/components/maps/map-detail-card.tsx`

**Interfaces:**
- Consumes: Task 3 `AppliedOpRecord`, Task 2 `forecastStagedOp`, `withdrawApprovalRequest`.
- Produces:

```ts
export interface UndoPlanItem {
  action: "remove-added" | "restore-role" | "re-add" | "withdraw";
  principalType: PrincipalType;
  principalId: string;
  fromRole?: string;
  toRole?: string;
  forecast: "instant" | "approval";
  permissionId?: number;
  role?: "viewer" | "editor";
  requestId?: number;
}
export function buildUndoPlan(records: AppliedOpRecord[], actorIsOwner: boolean): UndoPlanItem[];
export async function executeUndoPlan(
  mapId: number,
  items: UndoPlanItem[],
): Promise<{ done: number; pending: number; failed: { message: string }[] }>;
```

- [ ] **Step 1: i18n 키(EN·KO)**

```ts
// EN
"perm.undo.button": "Undo",
"perm.undo.buttonTitle": "Undo the last saved change",
"perm.undo.title": "Undo last change?",
"perm.undo.desc": "{count} items will be reverted as below.",
"perm.undo.removeAdded": "Remove added",
"perm.undo.reAdd": "Re-add",
"perm.undo.withdrawReq": "Withdraw request",
"perm.undo.confirm": "Undo",
"perm.undo.cancel": "Keep",
"perm.undo.result": "{done} reverted · {pending} pending approval · {failed} failed",
// KO
"perm.undo.button": "되돌리기",
"perm.undo.buttonTitle": "직전 저장한 변경을 되돌립니다",
"perm.undo.title": "직전 변경을 되돌릴까요?",
"perm.undo.desc": "{count}개 항목이 아래와 같이 되돌려집니다.",
"perm.undo.removeAdded": "추가분 제거",
"perm.undo.reAdd": "재추가",
"perm.undo.withdrawReq": "요청 회수",
"perm.undo.confirm": "되돌리기",
"perm.undo.cancel": "유지",
"perm.undo.result": "{done}건 되돌림 · {pending}건 승인 대기 · {failed}건 실패",
```

- [ ] **Step 2: 실패 테스트 작성** — `permission-undo.test.ts`(api는 permission-staging.test.ts와 같은 방식으로 `vi.mock("./api")` — `withdrawApprovalRequest` 포함):

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

import { buildUndoPlan, executeUndoPlan } from "./permission-undo";
import type { AppliedOpRecord } from "./permission-staging";
import {
  addMapPermission,
  changeMapPermission,
  removeMapPermission,
  withdrawApprovalRequest,
} from "./api";

vi.mock("./api", () => ({
  addMapPermission: vi.fn(),
  changeMapPermission: vi.fn(),
  removeMapPermission: vi.fn(),
  withdrawApprovalRequest: vi.fn(),
  getApiErrorDetail: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

beforeEach(() => vi.clearAllMocks());

const rec = (partial: Partial<AppliedOpRecord>): AppliedOpRecord => partial as AppliedOpRecord;

describe("buildUndoPlan", () => {
  it("applied add → remove-added(에디터 actor의 editor 추가 역방향은 approval)", () => {
    const plan = buildUndoPlan(
      [
        rec({
          op: { kind: "add", principalType: "user", principalId: "u1", role: "editor" },
          outcome: "applied",
          createdPermission: { id: 9, principal_type: "user", principal_id: "u1", role: "editor", granted_by: "me" },
        }),
      ],
      false,
    );
    expect(plan).toEqual([
      {
        action: "remove-added",
        principalType: "user",
        principalId: "u1",
        fromRole: "editor",
        forecast: "approval",
        permissionId: 9,
      },
    ]);
  });

  it("applied change → restore-role(원래 역할 복원)", () => {
    const plan = buildUndoPlan(
      [
        rec({
          op: { kind: "change", permissionId: 3, toRole: "editor" },
          outcome: "applied",
          prev: { principalType: "user", principalId: "v1", role: "viewer" },
        }),
      ],
      false,
    );
    expect(plan[0]).toMatchObject({
      action: "restore-role",
      permissionId: 3,
      role: "viewer",
      fromRole: "editor",
      toRole: "viewer",
      forecast: "approval", // editor→viewer 복원은 다운그레이드
    });
  });

  it("applied remove → re-add(instant)", () => {
    const plan = buildUndoPlan(
      [
        rec({
          op: { kind: "remove", permissionId: 4 },
          outcome: "applied",
          prev: { principalType: "department", principalId: "A/B", role: "viewer" },
        }),
      ],
      false,
    );
    expect(plan[0]).toMatchObject({ action: "re-add", principalId: "A/B", role: "viewer", forecast: "instant" });
  });

  it("pending → withdraw(instant), failed → 제외", () => {
    const plan = buildUndoPlan(
      [
        rec({
          op: { kind: "remove", permissionId: 5 },
          outcome: "pending",
          approvalRequest: { id: 77 } as never,
          prev: { principalType: "user", principalId: "e2", role: "editor" },
        }),
        rec({ op: { kind: "remove", permissionId: 6 }, outcome: "failed", message: "409" }),
      ],
      false,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ action: "withdraw", requestId: 77, forecast: "instant" });
  });
});

describe("executeUndoPlan", () => {
  it("액션별 API 호출·pending 집계·실패 비차단", async () => {
    vi.mocked(removeMapPermission).mockResolvedValue({ pending: true } as never);
    vi.mocked(changeMapPermission).mockResolvedValue({ pending: false } as never);
    vi.mocked(addMapPermission).mockRejectedValue(new Error("boom"));
    vi.mocked(withdrawApprovalRequest).mockResolvedValue(undefined as never);

    const summary = await executeUndoPlan(7, [
      { action: "remove-added", principalType: "user", principalId: "u1", forecast: "approval", permissionId: 9 },
      { action: "restore-role", principalType: "user", principalId: "v1", forecast: "instant", permissionId: 3, role: "viewer" },
      { action: "re-add", principalType: "user", principalId: "x", forecast: "instant", role: "viewer" },
      { action: "withdraw", principalType: "user", principalId: "e2", forecast: "instant", requestId: 77 },
    ]);

    expect(summary).toEqual({ done: 2, pending: 1, failed: [{ message: "boom" }] });
    expect(removeMapPermission).toHaveBeenCalledWith(7, 9);
    expect(changeMapPermission).toHaveBeenCalledWith(7, 3, "viewer");
    expect(withdrawApprovalRequest).toHaveBeenCalledWith(77);
  });
});
```

- [ ] **Step 3: 실패 확인**

```bash
npx vitest run src/lib/permission-undo.test.ts
```
Expected: FAIL — 모듈 없음

- [ ] **Step 4: `lib/permission-undo.ts` 구현**

```ts
// 되돌리기 플랜 — 직전 저장(records)의 역방향을 조립·실행. 스냅샷 기반이라 타인이 먼저 바꾼
// grant는 개별 실패로만 남는다(정합 복원 시도 없음 — 설계 §5 리스크 수용).

import {
  addMapPermission,
  changeMapPermission,
  getApiErrorDetail,
  removeMapPermission,
  withdrawApprovalRequest,
  type PrincipalType,
} from "./api";
import { forecastStagedOp, type AppliedOpRecord } from "./permission-staging";

export interface UndoPlanItem {
  action: "remove-added" | "restore-role" | "re-add" | "withdraw";
  principalType: PrincipalType;
  principalId: string;
  fromRole?: string;
  toRole?: string;
  forecast: "instant" | "approval";
  permissionId?: number;
  role?: "viewer" | "editor";
  requestId?: number;
}

export function buildUndoPlan(records: AppliedOpRecord[], actorIsOwner: boolean): UndoPlanItem[] {
  const items: UndoPlanItem[] = [];
  for (const r of records) {
    if (r.outcome === "failed") continue;
    if (r.outcome === "pending") {
      if (r.approvalRequest && r.prev) {
        items.push({
          action: "withdraw",
          principalType: r.prev.principalType,
          principalId: r.prev.principalId,
          fromRole: r.prev.role,
          forecast: "instant",
          requestId: r.approvalRequest.id,
        });
      }
      continue;
    }
    if (r.op.kind === "add" && r.createdPermission) {
      items.push({
        action: "remove-added",
        principalType: r.op.principalType,
        principalId: r.op.principalId,
        fromRole: r.op.role,
        forecast: forecastStagedOp(
          { kind: "remove", permissionId: r.createdPermission.id },
          r.op.role,
          actorIsOwner,
        ),
        permissionId: r.createdPermission.id,
      });
    } else if (r.op.kind === "change" && r.prev) {
      const restored = r.prev.role as "viewer" | "editor";
      items.push({
        action: "restore-role",
        principalType: r.prev.principalType,
        principalId: r.prev.principalId,
        fromRole: r.op.toRole,
        toRole: restored,
        forecast: forecastStagedOp(
          { kind: "change", permissionId: r.op.permissionId, toRole: restored },
          r.op.toRole,
          actorIsOwner,
        ),
        permissionId: r.op.permissionId,
        role: restored,
      });
    } else if (r.op.kind === "remove" && r.prev) {
      items.push({
        action: "re-add",
        principalType: r.prev.principalType,
        principalId: r.prev.principalId,
        toRole: r.prev.role,
        forecast: "instant",
        role: r.prev.role as "viewer" | "editor",
      });
    }
  }
  return items;
}

// 순차 실행 — 저장(applyStagedOps)과 동일한 개별 실패 비차단 정책.
export async function executeUndoPlan(
  mapId: number,
  items: UndoPlanItem[],
): Promise<{ done: number; pending: number; failed: { message: string }[] }> {
  const summary = { done: 0, pending: 0, failed: [] as { message: string }[] };
  for (const item of items) {
    try {
      if (item.action === "withdraw" && item.requestId !== undefined) {
        await withdrawApprovalRequest(item.requestId);
        summary.done += 1;
      } else if (item.action === "re-add" && item.role) {
        await addMapPermission(mapId, item.principalType, item.principalId, item.role);
        summary.done += 1;
      } else if (item.action === "remove-added" && item.permissionId !== undefined) {
        const res = await removeMapPermission(mapId, item.permissionId);
        if (res.pending) summary.pending += 1;
        else summary.done += 1;
      } else if (item.action === "restore-role" && item.permissionId !== undefined && item.role) {
        const res = await changeMapPermission(mapId, item.permissionId, item.role);
        if (res.pending) summary.pending += 1;
        else summary.done += 1;
      }
    } catch (err) {
      summary.failed.push({ message: getApiErrorDetail(err) });
    }
  }
  return summary;
}
```

- [ ] **Step 5: 그린 확인**

```bash
npx vitest run src/lib/permission-undo.test.ts
```
Expected: PASS

- [ ] **Step 6: 확인 모달** — `undo-last-apply-modal.tsx`. 구조는 `confirm-dialog.tsx`의 백드롭/카드/z-index 패턴을 그대로 따른다(열기 전 참조). 내용:

```tsx
"use client";

// 되돌리기 확인 모달 — 직전 저장분의 역방향 항목을 필+아이콘으로 가시화(모달 컨벤션:
// 아이콘 + 요약 박스 + 필 압축). 실행은 호출측 onConfirm.

import { Hourglass, RotateCcw, Zap } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { UndoPlanItem } from "@/lib/permission-undo";
import type { PrincipalType } from "@/lib/api";

import { PrincipalIcon } from "./principal-picker";

export function UndoLastApplyModal({
  items,
  resolveName,
  busy,
  onConfirm,
  onClose,
}: {
  items: UndoPlanItem[];
  resolveName: (type: PrincipalType, id: string) => string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    /* 백드롭·카드·버튼 행은 confirm-dialog.tsx 패턴 그대로(z-[1300]) — 목록만 커스텀 */
    ...
  );
}
```

항목 행 마크업(카드 내부 목록):

```tsx
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-sm bg-surface-alt p-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-caption text-ink">
              <PrincipalIcon type={item.principalType} />
              <span className="min-w-0 flex-1 truncate">{resolveName(item.principalType, item.principalId)}</span>
              <span className="rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-secondary">
                {item.action === "remove-added" && `${t("perm.undo.removeAdded")} (${item.fromRole})`}
                {item.action === "restore-role" && `${item.fromRole} → ${item.toRole}`}
                {item.action === "re-add" && `${t("perm.undo.reAdd")} ${item.toRole}`}
                {item.action === "withdraw" && t("perm.undo.withdrawReq")}
              </span>
              <span
                title={t(item.forecast === "approval" ? "perm.staged.forecastApproval" : "perm.staged.forecastInstant")}
                className="text-ink-tertiary"
              >
                {item.forecast === "approval" ? (
                  <Hourglass size={12} strokeWidth={1.5} />
                ) : (
                  <Zap size={12} strokeWidth={1.5} />
                )}
              </span>
            </li>
          ))}
        </ul>
```

헤더는 `RotateCcw` 16px + `t("perm.undo.title")`, 요약줄 `t("perm.undo.desc", { count: items.length })`, 버튼 `t("perm.undo.cancel")`(보더형)·`t("perm.undo.confirm")`(accent, busy 시 스피너+disabled).

- [ ] **Step 7: 두 표면 배선(각각 동일 패턴)**

패널(`collaborators-panel.tsx`)·카드(`map-detail-card.tsx`) 공통:

```ts
  const [lastApply, setLastApply] = useState<AppliedOpRecord[] | null>(null); // 직전 저장 1회분 — 메모리만(이탈 시 소멸)
  const [undoOpen, setUndoOpen] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
```

저장 핸들러 성공 경로에서(스택 클리어 직전):

```ts
      const kept = result.records.filter((r) => r.outcome !== "failed");
      setLastApply(kept.length > 0 ? kept : null);
```

Save/Cancel 바 아래(스택 비어 있고 lastApply 있을 때만) Undo 버튼:

```tsx
      {stagedOps.length === 0 && lastApply && (
        <div className="mt-2 flex items-center justify-end border-t border-hairline pt-2">
          <button
            type="button"
            data-id="perm-undo-last"
            title={t("perm.undo.buttonTitle")}
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={() => setUndoOpen(true)}
          >
            <RotateCcw size={14} strokeWidth={1.5} />
            {t("perm.undo.button")}
          </button>
        </div>
      )}
      {undoOpen && lastApply && (
        <UndoLastApplyModal
          items={buildUndoPlan(lastApply, isOwner)}
          resolveName={(type, id) => resolvePrincipalName(type, id, dirUsers, dirDepts, groups)}
          busy={undoBusy}
          onClose={() => setUndoOpen(false)}
          onConfirm={() => void handleUndoConfirm()}
        />
      )}
```

```ts
  async function handleUndoConfirm() {
    if (!lastApply) return;
    setUndoBusy(true);
    try {
      const summary = await executeUndoPlan(mapIdNum, buildUndoPlan(lastApply, isOwner));
      const text = t("perm.undo.result", {
        done: summary.done,
        pending: summary.pending,
        failed: summary.failed.length,
      });
      const failureText = summary.failed.map((f) => humanizeApiError(f.message, t)).join(" · ");
      onToast(failureText ? `${text} — ${failureText}` : text);
      setLastApply(null); // 1회성 — 재저장 전까지 Undo 불가
      setUndoOpen(false);
      await reload();
    } finally {
      setUndoBusy(false);
    }
  }
```

카드 쪽 차이: `isOwner` 기존 변수(`:377`), 이름 해석은 카드의 기존 `nameById`/디렉터리 소스, 리로드는 저장 핸들러가 쓰는 members 재조회 경로, 토스트는 카드의 기존 토스트/에러 배너 경로(`stagedSaveError`와 동일한 노출 방식 사용 가능 — 저장 결과 표기와 일관되게). 패널 쪽: `isOwner`는 Task 4에서 추가한 prop.

- [ ] **Step 8: 게이트 + Commit**

```bash
npx vitest run && npx tsc --noEmit && npm run lint
git add frontend/src/lib/permission-undo.ts frontend/src/lib/permission-undo.test.ts \
  frontend/src/components/permissions/undo-last-apply-modal.tsx frontend/src/lib/i18n-messages.ts \
  frontend/src/components/permissions/collaborators-panel.tsx frontend/src/components/maps/map-detail-card.tsx PROGRESS.md
git commit -m "feat(perm): one-shot undo of last saved change with forecast modal — 직전 변경 되돌리기(확인 모달·역방향 예고)"
```

---

### Task 7: 오우닝 부서 피커 — 조직도 브라우즈

**Files:**
- Create: `frontend/src/lib/dept-browse.ts`
- Create: `frontend/src/lib/dept-browse.test.ts`
- Create: `frontend/src/components/maps/dept-level-icon.tsx` (map-detail-card에서 추출)
- Modify: `frontend/src/components/maps/map-detail-card.tsx:88-115` (추출부 임포트 전환)
- Modify: `frontend/src/components/permissions/principal-picker.tsx`
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx:502-510`
- Modify: `frontend/src/components/permissions/map-details-panel.tsx:291-299`

**Interfaces:**
- Consumes: `PrincipalOption`(principal-picker), 카드의 `deptLeaf`/`deptLevelRank`/레벨 아이콘 사다리(`:88-115`).
- Produces:

```ts
// lib/dept-browse.ts
export interface DeptBrowseRow {
  option: PrincipalOption;
  depth: number;    // org_path 세그먼트 수 - 1 (절대 깊이)
  pinned: boolean;  // 내 소속 체인 상단 고정 여부
}
export function buildDeptBrowseRows(
  deptOptions: PrincipalOption[],
  myOrgPath: string | null,
  pinnedCap?: number, // 기본 3
): DeptBrowseRow[];
```

```tsx
// components/maps/dept-level-icon.tsx
export function deptLeaf(orgPath: string): string;
export function deptLevelRank(leaf: string): number;
export function DeptLevelIcon({ leaf, size }: { leaf: string; size?: number }): ReactNode;
```

- [ ] **Step 1: 실패 테스트 작성** — `dept-browse.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildDeptBrowseRows } from "./dept-browse";
import type { PrincipalOption } from "@/components/permissions/principal-picker";

const dept = (id: string): PrincipalOption => ({
  principalType: "department",
  principalId: id,
  displayName: id.split("/").pop() ?? id,
});

const OPTIONS = [
  dept("HQ"),
  dept("HQ/Div A"),
  dept("HQ/Div A/Team 1"),
  dept("HQ/Div A/Team 2"),
  dept("HQ/Div B"),
  dept("HQ/Div B/Team 3"),
];

describe("buildDeptBrowseRows", () => {
  it("내 체인은 깊은 단위 먼저 최대 3개 pinned, 트리 섹션에서 제외된다", () => {
    const rows = buildDeptBrowseRows(OPTIONS, "HQ/Div A/Team 1", 3);
    const pinned = rows.filter((r) => r.pinned).map((r) => r.option.principalId);
    expect(pinned).toEqual(["HQ/Div A/Team 1", "HQ/Div A", "HQ"]);
    const tree = rows.filter((r) => !r.pinned).map((r) => r.option.principalId);
    expect(tree).toEqual(["HQ/Div A/Team 2", "HQ/Div B", "HQ/Div B/Team 3"]);
  });

  it("체인이 캡보다 길면 얕은 조상이 트리 섹션에 남는다", () => {
    const rows = buildDeptBrowseRows(OPTIONS, "HQ/Div A/Team 1", 2);
    const pinned = rows.filter((r) => r.pinned).map((r) => r.option.principalId);
    expect(pinned).toEqual(["HQ/Div A/Team 1", "HQ/Div A"]);
    expect(rows.filter((r) => !r.pinned).map((r) => r.option.principalId)).toContain("HQ");
  });

  it("트리 섹션은 DFS 순서(부모 먼저·형제 하위 묶임) + depth 부여", () => {
    const rows = buildDeptBrowseRows(OPTIONS, null);
    expect(rows.map((r) => r.option.principalId)).toEqual([
      "HQ",
      "HQ/Div A",
      "HQ/Div A/Team 1",
      "HQ/Div A/Team 2",
      "HQ/Div B",
      "HQ/Div B/Team 3",
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 1, 2]);
    expect(rows.every((r) => !r.pinned)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/lib/dept-browse.test.ts
```
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `lib/dept-browse.ts`:

```ts
// 오우닝 부서 피커 브라우즈 행 조립 — 내 체인 상단 고정(캡) + 나머지 조직도 DFS.
// 세그먼트 단위 정렬이 곧 DFS: 부모 경로가 자식의 접두라 항상 먼저 온다.

import type { PrincipalOption } from "@/components/permissions/principal-picker";

export interface DeptBrowseRow {
  option: PrincipalOption;
  depth: number;
  pinned: boolean;
}

function compareSegments(a: string, b: string): number {
  const as = a.split("/");
  const bs = b.split("/");
  const len = Math.min(as.length, bs.length);
  for (let i = 0; i < len; i += 1) {
    const cmp = as[i].localeCompare(bs[i]);
    if (cmp !== 0) return cmp;
  }
  return as.length - bs.length;
}

export function buildDeptBrowseRows(
  deptOptions: PrincipalOption[],
  myOrgPath: string | null,
  pinnedCap = 3,
): DeptBrowseRow[] {
  const isMine = (id: string): boolean =>
    !!myOrgPath && (myOrgPath === id || myOrgPath.startsWith(`${id}/`));
  const mine = deptOptions
    .filter((o) => isMine(o.principalId))
    .sort((a, b) => b.principalId.split("/").length - a.principalId.split("/").length)
    .slice(0, pinnedCap);
  const pinnedIds = new Set(mine.map((o) => o.principalId));
  const rest = deptOptions
    .filter((o) => !pinnedIds.has(o.principalId))
    .sort((a, b) => compareSegments(a.principalId, b.principalId));
  return [
    ...mine.map((option) => ({ option, depth: option.principalId.split("/").length - 1, pinned: true })),
    ...rest.map((option) => ({ option, depth: option.principalId.split("/").length - 1, pinned: false })),
  ];
}
```

- [ ] **Step 4: 그린 확인**

```bash
npx vitest run src/lib/dept-browse.test.ts
```
Expected: PASS

- [ ] **Step 5: 레벨 아이콘 추출** — `map-detail-card.tsx:88-115`의 `deptLeaf`·`deptLevelRank`·레벨 아이콘 배열(주석 포함 원문 그대로)을 `components/maps/dept-level-icon.tsx`로 이동, `DeptLevelIcon` 컴포넌트로 감싸고(기존 아이콘 렌더 방식 유지, size 기본 14) 카드는 새 모듈에서 임포트. **동작 무변경**(순수 이동) — 카드의 기존 사용처가 컴파일되는지 `npx tsc --noEmit`로 확인.

- [ ] **Step 6: PrincipalPicker `deptTreeBrowse`** — prop 추가:

```ts
  /** 부서 전용 피커의 브라우즈를 조직도 트리로 — 내 체인 최대 3 고정 + 들여쓰기 DFS (오우닝 피커용). */
  deptTreeBrowse?: boolean;
```

브라우즈 분기(`:161-191`)에서 `deptTreeBrowse`면 `buildDeptBrowseRows(all.filter(o => o.principalType === "department"), me?.orgPath ?? null)`로 rows를 만들고, `hits` 형태(`{item, matches: []}`)로 매핑한다(순서가 곧 렌더 순서 — 키보드 내비·infinite slice 무변경). rows 메타는 `Map<principalId, DeptBrowseRow>`로 보관해 렌더에서 조회:

- 행 들여쓰기: 버튼 `style={{ paddingLeft: 12 + row.depth * 14 }}` (pinned 행은 들여쓰기 없음 — 12 고정).
- 행 아이콘: `deptTreeBrowse` 브라우즈 중 부서 행은 `PrincipalIcon` 대신 `<DeptLevelIcon leaf={deptLeaf(opt.principalId)} />`.
- pinned 마지막 행 뒤 구분선: `<div aria-hidden className="my-1 border-t border-hairline" />` (pinned 0개면 생략).
- 검색 중(`query.trim()`)에는 기존 랭킹 리스트 그대로(트리 미적용).

- [ ] **Step 7: 호출부 2곳** — `create-map-dialog.tsx:502` 오우닝 피커에 `deptTreeBrowse` 추가(기존 `myDeptsFirst`는 제거 — deptTreeBrowse가 pinned를 대체), `map-details-panel.tsx:292`에 `deptTreeBrowse` 추가. 협업자/승인자 피커는 무변경.

- [ ] **Step 8: 게이트 + Commit**

```bash
npx vitest run && npx tsc --noEmit && npm run lint
git add frontend/src/lib/dept-browse.ts frontend/src/lib/dept-browse.test.ts \
  frontend/src/components/maps/dept-level-icon.tsx frontend/src/components/maps/map-detail-card.tsx \
  frontend/src/components/permissions/principal-picker.tsx frontend/src/components/permissions/create-map-dialog.tsx \
  frontend/src/components/permissions/map-details-panel.tsx PROGRESS.md
git commit -m "feat(picker): owning-dept browse as indented org tree with my-chain pins — 오우닝 피커 조직도 브라우즈(내 체인 3고정)"
```

---

### Task 8: 홈 필터 필 3단계 반응형

**Files:**
- Create: `frontend/src/lib/filter-display.ts`
- Create: `frontend/src/lib/filter-display.test.ts`
- Create: `frontend/src/components/maps/home-filter-pills.tsx`
- Modify: `frontend/src/components/maps/filter-dropdown.tsx`
- Modify: `frontend/src/app/page.tsx:698-809` (필터 행 치환)

**Interfaces:**
- Produces:

```ts
// lib/filter-display.ts
export type FilterDisplayMode = "full" | "label" | "icon";
/** 들어가는 가장 풍부한 단계 선택. 측정 전(폭 0)엔 full. margin은 진동 방지 여유. */
export function pickFilterDisplayMode(
  available: number,
  widths: { full: number; label: number },
  marginPx?: number, // 기본 8
): FilterDisplayMode;
```

```tsx
// components/maps/home-filter-pills.tsx
export function HomeFilterPills(props: {
  display: FilterDisplayMode;
  measureOnly?: boolean; // true: dataId 미부여(중복 셀렉터 방지) — 측정 복제용
  homeView: "departments" | "framework";
  statusFilter: Set<string>;
  onToggleStatus: (v: string) => void;
  permFilter: Set<string>;
  onTogglePerm: (v: string) => void;
  owningFilter: Set<string>;
  onToggleOwning: (v: string) => void;
  spFilter: Set<string>;
  onToggleSp: (v: string) => void;
}): ReactNode;
```

- `FilterDropdown`에 `display?: FilterDisplayMode`(기본 "full") 추가 — 다른 사용처(inbox/notices/feedback) 무변경.

- [ ] **Step 1: 실패 테스트 작성** — `filter-display.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { pickFilterDisplayMode } from "./filter-display";

describe("pickFilterDisplayMode", () => {
  const widths = { full: 400, label: 300 };

  it("full+margin이 들어가면 full", () => {
    expect(pickFilterDisplayMode(408, widths)).toBe("full");
  });

  it("full은 안 되고 label은 되면 label", () => {
    expect(pickFilterDisplayMode(407, widths)).toBe("label");
    expect(pickFilterDisplayMode(308, widths)).toBe("label");
  });

  it("label도 안 되면 icon", () => {
    expect(pickFilterDisplayMode(307, widths)).toBe("icon");
  });

  it("측정 전(0 폭)엔 full 유지", () => {
    expect(pickFilterDisplayMode(0, { full: 0, label: 0 })).toBe("full");
    expect(pickFilterDisplayMode(500, { full: 0, label: 0 })).toBe("full");
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/lib/filter-display.test.ts
```
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `lib/filter-display.ts` 구현**

```ts
// 홈 필터 필 표시 단계 판정 — 실측 폭 기반(고정 브레이크포인트 아님). full=아이콘+라벨,
// label=라벨만, icon=아이콘만. margin(px)은 스크롤바·서브픽셀 진동 방지 여유.

export type FilterDisplayMode = "full" | "label" | "icon";

export function pickFilterDisplayMode(
  available: number,
  widths: { full: number; label: number },
  marginPx = 8,
): FilterDisplayMode {
  if (widths.full <= 0 || widths.label <= 0) return "full"; // 측정 전 — 강등 금지
  if (available >= widths.full + marginPx) return "full";
  if (available >= widths.label + marginPx) return "label";
  return "icon";
}
```

- [ ] **Step 4: 그린 확인**

```bash
npx vitest run src/lib/filter-display.test.ts
```
Expected: PASS

- [ ] **Step 5: `FilterDropdown` display prop** — 버튼 내용부(59-65행)를 모드 분기로:

```tsx
        {display !== "label" && icon}
        {display !== "icon" ? (count > 0 ? `${label} · ${count}` : label) : count > 0 ? `· ${count}` : null}
        <ChevronDown ... />
```

시그니처: `display = "full"` 기본값 prop 추가, 버튼에 `title={label}` 상시 부여(icon 모드 가독 보완). 기존 사용처는 무변경으로 컴파일돼야 한다.

- [ ] **Step 6: `HomeFilterPills` 추출** — `page.tsx:700-792`의 FilterDropdown 4개(+`STATUS_ORDER` 상수·`VERSION_STATUS_LABEL/STYLE` 임포트 — page.tsx의 다른 사용처는 grep로 확인해 남기거나 이동)를 새 컴포넌트로 이식. 각 FilterDropdown에 `display={display}` 전달, `dataId={measureOnly ? undefined : "home-status-filter"}` 방식으로 measureOnly 시 dataId 미부여. 옵션 정의·onToggle은 props로 받은 것을 그대로 배선(로직 무변경 이동).

- [ ] **Step 7: page.tsx 배선** — 필터 행(698행 `home-filter-row` div)을:

```tsx
              <div
                data-id="home-filter-row"
                ref={filterRowRef}
                className="relative flex min-w-0 items-center gap-1.5"
              >
                <HomeFilterPills display={filterMode} homeView={homeView} ...핸들러 그대로 />
                {/* 측정 복제 — 보이지 않게 자연폭만 잰다(absolute라 레이아웃 불참여, dataId 없음) */}
                <div ref={measureFullRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1.5">
                  <HomeFilterPills display="full" measureOnly homeView={homeView} ...동일 props />
                </div>
                <div ref={measureLabelRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1.5">
                  <HomeFilterPills display="label" measureOnly homeView={homeView} ...동일 props />
                </div>
                {/* Clear 버튼은 기존 그대로(793-808행) — ml-auto 유지 */}
              </div>
```

`shrink-0` → `min-w-0`(행이 할당 폭만큼 줄어들 수 있어야 실측이 성립). 모드 산정은 ResizeObserver로:

```ts
  const filterRowRef = useRef<HTMLDivElement | null>(null);
  const measureFullRef = useRef<HTMLDivElement | null>(null);
  const measureLabelRef = useRef<HTMLDivElement | null>(null);
  const [filterMode, setFilterMode] = useState<FilterDisplayMode>("full");

  // 실측 기반 3단계 — 측정 복제(absolute invisible)의 자연폭 vs 행 가용폭. i18n/뷰 전환은
  // 복제가 같은 props로 다시 그려지므로 자동 반영. RO 콜백 내 setState는 라이브 행 폭이
  // 모드에 따라 변해도 복제 폭은 불변이라 진동하지 않는다.
  useEffect(() => {
    const row = filterRowRef.current;
    const full = measureFullRef.current;
    const label = measureLabelRef.current;
    if (!row || !full || !label) return;
    const update = () => {
      setFilterMode(
        pickFilterDisplayMode(row.clientWidth, {
          full: full.scrollWidth,
          label: label.scrollWidth,
        }),
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(row);
    ro.observe(full);
    ro.observe(label);
    return () => ro.disconnect();
  }, [homeView, lang]); // 필 개수·언어가 복제 폭을 바꾸는 유이한 축
```

주의: Clear 버튼이 떠 있을 때 행 가용폭을 잠식하므로 `row.clientWidth`가 아닌 `row.clientWidth - clearWidth`가 필요하면 Clear에 ref를 달아 빼준다(간단 유지 — Clear는 text-fine 소형이라 margin 8px로 흡수되는지 1130px 실측 후 결정, Task 9에서 확인). `react-hooks/set-state-in-effect` 린트에 걸리면 최초 1회 산정을 `requestAnimationFrame(update)`로 이연.

- [ ] **Step 8: 게이트 + Commit**

```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
git add frontend/src/lib/filter-display.ts frontend/src/lib/filter-display.test.ts \
  frontend/src/components/maps/home-filter-pills.tsx frontend/src/components/maps/filter-dropdown.tsx \
  frontend/src/app/page.tsx PROGRESS.md
git commit -m "feat(home): 3-stage responsive filter pills via measured widths — 홈 필터 필 실측 3단계 반응형"
```

---

### Task 9: 브라우저 실구동 검증(3표면 + 반응형) + 최종 게이트

**Files:**
- Create: `frontend/scripts/pw-verify-collab-staging.mjs`
- Create: `frontend/scripts/pw-verify-home-filter-responsive.mjs`
- Modify: (검증에서 발견된 결함 픽스)

**사전 준비** (`docs/lessons/browser-verification.md` 필독 — dev.db 오염·좀비 프론트 함정):

```bash
# 좀비 정리 후 백엔드(시드 리셋) + 프론트 기동
pkill -f "next dev" ; pkill -f "uvicorn app.main" ; sleep 1
cd backend && DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys .venv/bin/python -m scripts.reset_db
DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys .venv/bin/uvicorn app.main:app --port 8000 &
cd ../frontend && npm run dev &
```

- [ ] **Step 1: `pw-verify-collab-staging.mjs` 작성** — playwright-core + 시스템 Chrome(기존 `scripts/pw-verify-owning-dept.mjs` 구조 참고). 시나리오(에디터 권한 데모 유저로):
  1. 설정 페이지: 협업자 viewer 추가 스테이지 → `perm-staged-add-cancel-*` 필에 Zap 확인, hover 시 "Cancel" 전환(computed opacity), 클릭 취소.
  2. editor 행 제거 스테이지 → Hourglass(승인 예고) 확인 → Save → pending 필 **1개만**(`perm.rolePending` 텍스트 부재 + 상세 태그 존재) 확인.
  3. 본인 pending 필 hover → "Withdraw" 전환 → 클릭 → pending 소멸 확인.
  4. viewer 추가 → Save → Undo 버튼 노출 → 클릭 → 모달 항목/예고 아이콘 렌더 확인 → 확인 → 행 소멸 + Undo 버튼 소멸.
  5. 홈 미리보기 카드 + 에디터 맵 탭에서 2·3 요약 재확인(같은 data-id 프리픽스 `map-detail-*`).
  6. 새 맵 모달 오우닝 피커: 브라우즈에 pinned "My Dept" 행·구분선·들여쓰기(paddingLeft 차등) 확인.
- [ ] **Step 2: `pw-verify-home-filter-responsive.mjs` 작성** — 뷰포트 1440/1130/1000/900px × EN·KO: `home-filter-row` 안 버튼들의 `offsetTop` 동일(세로 줄바꿈 없음)·행 `scrollWidth <= clientWidth`(가로 넘침 없음) 단언 + 각 조합 스크린샷(스크래치패드 저장). 1130px에서 Clear 버튼 활성 상태로도 1회 측정(Task 8 Step 7 주의사항 판정 — 넘치면 clearWidth 차감 픽스 적용).
- [ ] **Step 3: 실행·결함 픽스 루프** — 실패 항목은 원인 규명 후 해당 파일 수정, 재실행으로 그린 확인(같은 픽스 2회 실패 시 중단·보고).
- [ ] **Step 4: 최종 게이트 전체 실행**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint && npm run build
cd ../backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
```
Expected: 전부 그린

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/pw-verify-collab-staging.mjs frontend/scripts/pw-verify-home-filter-responsive.mjs PROGRESS.md
git commit -m "test(perm): browser verification for staging UX + responsive filters — 스테이징 UX·필터 반응형 실구동 검증"
```

---

## Self-Review 결과 (플랜 작성 시 수행)

- **스펙 커버리지**: ①forecast=T2+T4/T5 · ②중복픽스=T4(a)(b)/T5(1)(3) · ③호버캔슬=T4(c)(d)/T5(4)(5) · ④회수=T1+T4(b)(e)/T5(3) · ⑤되돌리기=T3+T6 · ⑥피커=T7 · ⑦반응형=T8 · 검증=T9. 갭 없음.
- **타입 일관성**: `AppliedOpRecord`/`StagedResult`(T3) ↔ `buildUndoPlan` 소비(T6), `FilterDisplayMode`(T8) ↔ `HomeFilterPills.display`, `DeptBrowseRow`(T7) 정의·소비 일치 확인.
- **알려진 유동 지점**(실행 시 실측 판단, placeholder 아님): 카드 60px 고정폭 필의 아이콘 수용(T5 Step 4 주의), Clear 폭 차감 필요 여부(T8 Step 7 ↔ T9 Step 2), 기존 applyStagedOps 테스트의 result 전체 동등 단언 갱신(T3 Step 3).

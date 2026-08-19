"use client";

// 협업자 관리 패널 — 서버 권한 목록 조회·역할 변경·제거·추가 (실 API) /
// Collaborators panel wired to the real Layer-2 permissions API.
// 편집은 즉시 적용되지 않는다 — 화면상 스택(permission-staging)에 적립되고 Save를 눌러야 일괄 실행,
// Cancel이면 폐기된다(R2 QA 피드백). 서버가 진실인 pending 마커(perm.pending_change)는 그대로 유지 —
// 그건 서버 상태, 스택 태그는 아직 서버에 보내지 않은 로컬 의도라 별개다.
// 표시명·피커 후보: 사용자·부서는 실 /api/directory, 그룹은 실 active 그룹(Layer 4 Task 4). /
// Display names / picker: users+departments from real /api/directory; groups from real active groups.

import { useCallback, useEffect, useState } from "react";
import { Hourglass, Loader2, LockKeyhole, RotateCcw, X, Zap } from "lucide-react";

import {
  getDirectory,
  listGroups,
  listMapPermissions,
  withdrawApprovalRequest,
  type DirectoryDept,
  type DirectoryUser,
  type Group,
  type MapPermission as ApiPermission,
  type MapRole,
  type PrincipalType,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import {
  applyStagedOps,
  forecastStagedOp,
  upsertStagedOp,
  removeStagedOp,
  stageRoleChange,
  type AppliedOpRecord,
  type StagedOp,
} from "@/lib/permission-staging";
import { buildUndoPlan, executeUndoPlan } from "@/lib/permission-undo";

import { AddCollaborator } from "./add-collaborator";
import { HoverSwapPill } from "./hover-swap-pill";
import { PendingChangePill } from "./pending-change-pill";
import { PrincipalIcon } from "./principal-picker";
import { RoleBadge } from "./role-badge";
import { SkeletonRows } from "./loading-skeleton";
import { UndoLastApplyModal } from "./undo-last-apply-modal";

interface CollaboratorsPanelProps {
  mapId: string;
  /** 현재 유저 id — 자기 자신 행에 대한 역할 변경 금지 판단에 사용 / Used to disable self-change. */
  currentUserId: string;
  /** 편집 가능 여부 (editor 이상만 true) / Whether controls are enabled. */
  canEdit: boolean;
  /** 현재 유저가 이 맵의 오너인지 — forecastStagedOp 예측에 사용 / Owner status, feeds forecastStagedOp. */
  isOwner: boolean;
  /** 토스트 발행 콜백 / Callback to show a toast message. */
  onToast: (msg: string) => void;
  /** 공개 맵이면 viewer 그랜트 비활성 — 전원 열람 가능 / Disable viewer role when map is public. */
  viewerGrantDisabled?: boolean;
  /** 오우닝 부서 org_path — 있으면 잠금 행(합성 표시, MapPermission 아님)을 목록 맨 위에 표시 /
   * Owning department org_path — when set, renders a synthetic locked row (not a MapPermission). */
  owningDepartment?: string | null;
}

// 표시명 해석 — 실 디렉터리/그룹 우선, 없으면 principalId 폴백 /
// Resolve display name from real directory (users/depts) and real groups; fall back to id.
function resolvePrincipalName(
  principalType: PrincipalType,
  principalId: string,
  dirUsers: DirectoryUser[],
  dirDepts: DirectoryDept[],
  groups: Group[],
): string {
  if (principalType === "user") {
    return dirUsers.find((u) => u.id === principalId)?.name ?? principalId;
  }
  if (principalType === "department") {
    return dirDepts.find((d) => d.id === principalId)?.name ?? principalId;
  }
  return groups.find((g) => String(g.id) === principalId)?.name ?? principalId;
}

// 개별 행 — 이름, 아이콘, 역할, 변경/제거 컨트롤 / Individual permission row.
function CollaboratorRow({
  perm,
  currentUserId,
  canEdit,
  isPending,
  stagedOp,
  viewerGrantDisabled,
  actorIsOwner,
  dirUsers,
  dirDepts,
  groups,
  onChangeRole,
  onRemove,
  onCancelStaged,
  onWithdrawPending,
}: {
  perm: ApiPermission;
  currentUserId: string;
  canEdit: boolean;
  isPending: boolean;
  /** 이 행을 겨냥한 스택 op(change/remove) — 있으면 서버 반영 전 로컬 예정 표시 / staged local intent for this row, if any. */
  stagedOp?: StagedOp & { kind: "change" | "remove" };
  /** 퍼블릭 맵이면 viewer 선택지 숨김 — 단, 현재 역할이 viewer면 표시(editor로 교정 가능) /
   * Public map: hide viewer option (unless this grant is already viewer, so it can be fixed to editor). */
  viewerGrantDisabled?: boolean;
  /** 현재 유저가 이 맵의 오너인지 — forecastStagedOp의 즉시적용/승인 예측에 사용 / Owner status for forecast. */
  actorIsOwner: boolean;
  dirUsers: DirectoryUser[];
  dirDepts: DirectoryDept[];
  groups: Group[];
  onChangeRole: (perm: ApiPermission, toRole: MapRole) => void;
  onRemove: (perm: ApiPermission) => void;
  onCancelStaged: (op: StagedOp) => void;
  onWithdrawPending: (perm: ApiPermission) => void;
}) {
  const { t } = useI18n();
  const principalType = perm.principal_type as PrincipalType;
  const displayName = resolvePrincipalName(principalType, perm.principal_id, dirUsers, dirDepts, groups);
  // 유령 principal — 디렉터리에서 사라진 유저(퇴사) / 현 조직에 없는 부서(조직개편).
  // 목록 로딩 전(빈 배열) 오탐 방지를 위해 로드된 뒤에만 판정.
  const isGhost =
    principalType === "user"
      ? dirUsers.length > 0 && !dirUsers.some((u) => u.id === perm.principal_id)
      : principalType === "department"
        ? dirDepts.length > 0 && !dirDepts.some((d) => d.id === perm.principal_id)
        : false;
  const role = perm.role as MapRole;
  const isOwner = role === "owner";
  // 자기 자신 행은 역할/제거 비활성 / Disable controls on own row.
  const isSelf = principalType === "user" && perm.principal_id === currentUserId;
  const controlsDisabled = !canEdit || isOwner || isSelf;
  // 요청자 표시명 — 실 디렉터리 우선, 없으면 login id 폴백 / requester display name.
  const pendingChange = perm.pending_change;
  const pendingByName = pendingChange
    ? dirUsers.find((u) => u.id === pendingChange.requested_by)?.name ?? pendingChange.requested_by
    : "";
  const stagedRemove = stagedOp?.kind === "remove";
  const stagedChange = stagedOp?.kind === "change" ? stagedOp : null;
  const forecast = stagedOp ? forecastStagedOp(stagedOp, perm.role, actorIsOwner) : "instant";

  return (
    // relative+group+pr-8 — 제거 X는 absolute라 공간을 차지하지 않는다, 공통 pr로 오너/본인(뱃지)
    // 행과 편집(select) 행의 우측 요소가 같은 x좌표에서 끝나 정렬이 흔들리지 않는다 (U4).
    <div
      className={`group relative flex items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 hover:bg-surface-alt ${stagedRemove ? "opacity-60" : ""}`}
    >
      {/* 유형 아이콘 / Type icon */}
      <PrincipalIcon type={principalType} />

      {/* 이름 / Display name */}
      <span className="min-w-0 flex-1 truncate text-caption text-ink">
        {displayName}
        {isGhost && (
          <span
            data-id="ghost-badge"
            className="ml-1.5 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-error"
            title={t(principalType === "department" ? "perm.badgeMissingNote" : "perm.badgeDepartedNote")}
          >
            {t(principalType === "department" ? "perm.badgeMissing" : "perm.badgeDeparted")}
          </span>
        )}
      </span>

      {/* 역할 뱃지 or 드롭다운 / Role badge or dropdown */}
      {isOwner || isPending || stagedRemove ? (
        <RoleBadge role={role} />
      ) : controlsDisabled ? (
        <RoleBadge role={role} />
      ) : (
        <select
          className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink"
          value={stagedChange?.toRole ?? role}
          onChange={(e) => onChangeRole(perm, e.target.value as MapRole)}
        >
          {/* 퍼블릭 맵은 viewer 선택지 숨김 — 단 기존 viewer는 표시(editor로 교정 가능) */}
          {(!viewerGrantDisabled || role === "viewer") && (
            <option value="viewer">{t("perm.roleViewer")}</option>
          )}
          <option value="editor">{t("perm.roleEditor")}</option>
        </select>
      )}

      {/* 상세 태그 — 서버 진실(pending_change)일 때만, staged remove 여부와 무관하게 항상 렌더
          (하드 제약: R2 서버-진실 마커는 스택 태그와 별개로 유지) / detail tag only once server-confirmed,
          rendered unconditionally regardless of any staged op on this row. */}
      {pendingChange && (
        <PendingChangePill
          dataId={`perm-pending-withdraw-${perm.id}`}
          role={perm.role}
          toRole={pendingChange.to_role ?? null}
          requesterName={pendingByName}
          canWithdraw={pendingChange.requested_by === currentUserId}
          onWithdraw={() => onWithdrawPending(perm)}
        />
      )}

      {/* 스택 태그 — 로컬 예정(change/remove), 호버 시 Cancel로 스왑 / staged tag, hover-swaps to Cancel */}
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

      {/* 제거 버튼 — absolute+hover라 flex 공간을 차지하지 않는다(정렬 교정, U4). display 아닌
          opacity 토글이라 Tab 포커스는 유지되고 focus:/group-focus-within:로 키보드 사용자도 도달 가능. /
          Remove button: absolute + opacity-hover so it reserves no flex space; opacity (not display)
          keeps it tab-reachable, revealed via focus:/group-focus-within: for keyboard users. */}
      {!isOwner && !controlsDisabled && !stagedRemove && !isPending && (
        <button
          type="button"
          title={t("perm.removeButton")}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-ink-tertiary opacity-0 pointer-events-none transition-opacity duration-150 hover:bg-surface-alt hover:text-error focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          onClick={() => onRemove(perm)}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

export function CollaboratorsPanel({
  mapId,
  currentUserId,
  canEdit,
  isOwner,
  onToast,
  viewerGrantDisabled = false,
  owningDepartment,
}: CollaboratorsPanelProps) {
  const { t } = useI18n();
  const mapIdNum = Number(mapId);

  // 서버 권한 목록 / Server-sourced permissions list.
  const [perms, setPerms] = useState<ApiPermission[]>([]);
  // 초기 로드 중 — 데이터 도착 전 "협업자 없음" 대신 스켈레톤 표시 (F8).
  const [loading, setLoading] = useState(true);

  // 실 디렉터리 — 피커 후보와 표시명 해석에 사용 (Layer 4 Task 0) /
  // Real directory for picker candidates and display-name resolution.
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);
  // 실 active 그룹 — 그룹 협업자 옵션·표시명 (Layer 4 Task 4) /
  // Real active groups for group collaborator options and display names.
  const [groups, setGroups] = useState<Group[]>([]);

  // 편집 스택 — 화면에 쌓인 add/change/remove, Save 전까지 서버에 반영되지 않는다 (R2 QA 피드백).
  const [stagedOps, setStagedOps] = useState<StagedOp[]>([]);
  const [savingStaged, setSavingStaged] = useState(false);
  // 방금 적립된 add op — 해당 고스트 행에 플래시 강조. 1.2s 후 자연 소멸 (R2 QA 피드백).
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null);
  // 되돌리기 — 직전 저장 1회분 records. 메모리만(페이지 이탈 시 소멸, 영속 안 함).
  const [lastApply, setLastApply] = useState<AppliedOpRecord[] | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);

  // 방금 적립된 고스트 행을 화면 안으로 — 페이지 이탈 없이 "nearest"만 사용.
  useEffect(() => {
    if (!lastAddedKey) return;
    document.querySelector(`[data-id="staged-add-${lastAddedKey}"]`)?.scrollIntoView({ block: "nearest" });
  }, [lastAddedKey]);

  const reload = useCallback(async () => {
    try {
      const rows = await listMapPermissions(mapIdNum);
      setPerms(rows);
    } catch (err) {
      onToast(humanizeApiError(err, t));
    }
  }, [mapIdNum, onToast, t]);

  // 초기 로드 — 인라인 async + active 가드(언마운트 후 setState 방지) /
  // Initial load: inline async with an active guard (avoids set-state-after-unmount).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, dir, groupRows] = await Promise.all([
          listMapPermissions(mapIdNum),
          getDirectory(),
          listGroups(),
        ]);
        if (active) {
          setPerms(rows);
          setDirUsers(dir.users);
          setDirDepts(dir.departments);
          setGroups(groupRows);
        }
      } catch (err) {
        if (active) onToast(humanizeApiError(err, t));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [mapIdNum, onToast, t]);

  // 편집 액션은 즉시 API를 부르지 않고 스택에 적립만 — Save에서 일괄 실행 (trivial setState라 plain
  // function으로: React Compiler가 useCallback 수동 deps와 어긋나면 빌드가 깨진다, frontend/AGENTS.md).
  function handleAdd(principalType: PrincipalType, principalId: string, role: "viewer" | "editor") {
    setStagedOps((ops) => upsertStagedOp(ops, { kind: "add", principalType, principalId, role }));
    setLastAddedKey(`${principalType}:${principalId}`);
    window.setTimeout(() => setLastAddedKey(null), 1200); // 플래시 애니메이션 후 리셋(재추가 시 재발화)
  }

  function handleChangeRole(perm: ApiPermission, toRole: MapRole) {
    if (toRole === "owner") return; // select는 viewer/editor만 제공 — 방어적 가드
    setStagedOps((ops) => stageRoleChange(ops, perm.id, toRole, perm.role));
  }

  function handleRemove(perm: ApiPermission) {
    setStagedOps((ops) => upsertStagedOp(ops, { kind: "remove", permissionId: perm.id }));
  }

  function handleCancelStaged(op: StagedOp) {
    setStagedOps((ops) => removeStagedOp(ops, op));
  }

  // 본인이 낸 승인 대기 요청 회수 — 서버 마커(pending_change)를 직접 지우므로 즉시 재조회.
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

  // Save — 스택을 일괄 실행하고 결과를 토스트로, 성공분은 재조회로 반영 후 스택 클리어.
  // 개별 실패는 전체를 막지 않는다(R1 상호배제 409 등도 failed로만 수집).
  async function handleSaveStaged() {
    setSavingStaged(true);
    try {
      const result = await applyStagedOps(mapIdNum, stagedOps, new Map(perms.map((p) => [p.id, p])));
      const summary = t("perm.staged.result", {
        applied: result.applied,
        pending: result.pending,
        failed: result.failed.length,
      });
      const failureText = result.failed.map((f) => humanizeApiError(f.message, t)).join(" · ");
      onToast(failureText ? `${summary} — ${failureText}` : summary);
      const kept = result.records.filter((r) => r.outcome !== "failed");
      setLastApply(kept.length > 0 ? kept : null);
      setStagedOps([]);
      await reload();
    } finally {
      setSavingStaged(false);
    }
  }

  function handleCancelAllStaged() {
    setStagedOps([]); // 저장 안 하면 작업 취소 — 서버 호출 없이 스택만 비움
  }

  // 직전 저장 1회분의 역방향을 실행 — 1회성이라 성공/부분실패 무관하게 재저장 전까지 다시 못 부른다.
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

  const stagedAdds = stagedOps.filter((op): op is StagedOp & { kind: "add" } => op.kind === "add");
  // 이미 부여된 principalId + 스택에 추가 예정인 principalId (피커 제외용) — 안 그러면 재선택 시
  // 고스트 행은 그대로인데 스택 role만 조용히 덮어써져 헷갈린다 / also exclude staged-add principals.
  const excludeIds = new Set([...perms.map((p) => p.principal_id), ...stagedAdds.map((op) => op.principalId)]);
  const stagedByPermId = new Map<number, StagedOp & { kind: "change" | "remove" }>();
  for (const op of stagedOps) {
    if (op.kind !== "add") stagedByPermId.set(op.permissionId, op);
  }

  return (
    <div className="flex flex-col gap-0.5">
      {/* 로딩 중 스켈레톤 / Skeleton while loading (F8) */}
      {loading && <SkeletonRows />}

      {/* 빈 목록 안내 — 로딩 끝난 뒤에만. 잠금 행이 보이면 "협업자 없음"과 모순이라 숨김 /
          Empty-state only after load; suppressed when the owning-dept locked row is visible. */}
      {!loading && perms.length === 0 && !owningDepartment && (
        <p className="py-4 text-caption text-ink-tertiary">{t("perm.noCollaborators")}</p>
      )}

      {/* 오우닝 부서 잠금 행 — 합성 표시(MapPermission 아님), 실 권한 목록 위에 고정 /
          Owning-department locked row: synthetic display, not a real permission, pinned above the list. */}
      {!loading && owningDepartment && (
        <div
          data-id="owning-dept-locked-row"
          className="flex items-center gap-2 rounded-sm bg-surface-alt px-2 py-1.5"
        >
          <PrincipalIcon type="department" />
          <span className="min-w-0 flex-1 truncate text-caption text-ink">
            {resolvePrincipalName("department", owningDepartment, dirUsers, dirDepts, groups)}
            <span className="ml-1.5 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary">
              {t("perm.owningDept.title")}
            </span>
          </span>
          <span
            title={t("perm.owningDept.lockedNote")}
            className="inline-flex shrink-0 items-center gap-1 text-fine text-ink-tertiary"
          >
            <LockKeyhole size={14} strokeWidth={1.5} />
            {t("perm.owningDept.lockedEditor")}
          </span>
        </div>
      )}

      {perms.map((perm) => (
        <CollaboratorRow
          key={perm.id}
          perm={perm}
          currentUserId={currentUserId}
          canEdit={canEdit}
          isPending={perm.pending_change != null}
          stagedOp={stagedByPermId.get(perm.id)}
          viewerGrantDisabled={viewerGrantDisabled}
          actorIsOwner={isOwner}
          dirUsers={dirUsers}
          dirDepts={dirDepts}
          groups={groups}
          onChangeRole={handleChangeRole}
          onRemove={handleRemove}
          onCancelStaged={handleCancelStaged}
          onWithdrawPending={(p) => void handleWithdrawPending(p)}
        />
      ))}

      {/* 스택에 적립된 추가 예정 — 고스트 행(점선 테두리) + 태그(호버 시 Cancel로 스왑) /
          Staged "to add" rows — dashed ghost row with a hover-to-cancel tag. */}
      {stagedAdds.map((op) => {
        const addKey = `${op.principalType}:${op.principalId}`;
        return (
        <div
          key={`add:${addKey}`}
          data-id={`staged-add-${addKey}`}
          className={`flex items-center gap-2 rounded-sm border border-dashed border-hairline px-2 py-1.5 ${
            lastAddedKey === addKey ? "motion-safe:animate-[picker-flash_1200ms_ease-in-out]" : ""
          }`}
        >
          <PrincipalIcon type={op.principalType} />
          <span className="min-w-0 flex-1 truncate text-caption text-ink">
            {resolvePrincipalName(op.principalType, op.principalId, dirUsers, dirDepts, groups)}
          </span>
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
        </div>
        );
      })}

      {/* 협업자 추가 폼 — 편집자 이상만 / Add form for editor+ only */}
      {canEdit && (
        <AddCollaborator
          excludeIds={excludeIds}
          viewerGrantDisabled={viewerGrantDisabled}
          dirUsers={dirUsers}
          dirDepts={dirDepts}
          groups={groups}
          onAdd={handleAdd}
        />
      )}

      {/* Save/Cancel — 스택에 쌓인 게 있을 때만 노출 / Save/Cancel bar, shown only while ops are staged */}
      {stagedOps.length > 0 && (
        <div className="mt-2 flex items-center justify-end gap-2 border-t border-hairline pt-2">
          <button
            type="button"
            data-id="perm-staged-cancel"
            disabled={savingStaged}
            className="rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
            onClick={handleCancelAllStaged}
          >
            {t("perm.staged.cancel")}
          </button>
          <button
            type="button"
            data-id="perm-staged-save"
            disabled={savingStaged}
            className="inline-flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void handleSaveStaged()}
          >
            {savingStaged && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            {t("perm.staged.save")}
          </button>
        </div>
      )}

      {/* 되돌리기 — 스택이 비어 있고 직전 저장분이 있을 때만(Save 바와 배타적, 동시 노출 안 함) /
          Undo bar: only when the stack is empty and a last apply exists (never coexists with Save bar). */}
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
    </div>
  );
}

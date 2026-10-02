"use client";

// 협업자 관리 패널 — 서버 권한 목록 조회·역할 변경·제거·추가 (실 API) /
// Collaborators panel wired to the real Layer-2 permissions API.
// 편집은 즉시 적용되지 않는다 — 화면상 스택(permission-staging)에 적립되고 Save를 눌러야 일괄 실행,
// Cancel이면 폐기된다(R2 QA 피드백). 서버가 진실인 pending 마커(perm.pending_change)는 그대로 유지 —
// 그건 서버 상태, 스택 태그는 아직 서버에 보내지 않은 로컬 의도라 별개다.
// 표시명·피커 후보: 사용자·부서는 실 /api/directory, 그룹은 실 active 그룹(Layer 4 Task 4). /
// Display names / picker: users+departments from real /api/directory; groups from real active groups.
// 행 = 아바타 · 이름(언어별 주/보조명)+아이디·직급 · 소속/구성원 · 부여자·일시 · 역할 메뉴(MenuSelect). 유저 행은
// PersonHoverCard(호버/클릭), 부서 행은 OrgInfoModal(클릭). Owner 항목은 TransferOwnerDialog 게이트 (2026-10-01).

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Building2, Crown, Eye, Hourglass, Loader2, LockKeyhole, Pencil, RotateCcw, User, Users, X, Zap } from "lucide-react";

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
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { formatTitleWithPosition } from "@/lib/korean-dept";
import { belongsToDepartment } from "@/lib/owner-candidates";
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
import { useKoreanDeptByPath } from "@/components/map-ownership-section";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { MenuSelect, type MenuSelectItem } from "@/components/menu-select";
import { OrgInfoModal } from "@/components/org-info-modal";
import { PersonHoverCard } from "@/components/person-hover-card";

import { AddCollaborator } from "./add-collaborator";
import { HoverSwapPill } from "./hover-swap-pill";
import { PendingChangePill } from "./pending-change-pill";
import { PrincipalIcon } from "./principal-picker";
import { RoleBadge } from "./role-badge";
import { SkeletonRows } from "./loading-skeleton";
import { TransferOwnerDialog } from "./transfer-owner-dialog";
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
  onToast: (msg: string, tone?: "error") => void;
  /** 공개 맵이면 viewer 그랜트 비활성 — 전원 열람 가능 / Disable viewer role when map is public. */
  viewerGrantDisabled?: boolean;
  /** 오우닝 부서 org_path — 있으면 잠금 행(합성 표시, MapPermission 아님)을 목록 맨 위에 표시 /
   * Owning department org_path — when set, renders a synthetic locked row (not a MapPermission). */
  owningDepartment?: string | null;
  /** 행 수(잠금 행 포함) — 섹션 헤더 카운트 / Row count incl. the locked row, for the section header. */
  onCountChange?: (count: number) => void;
}

// 행 그리드 — 아바타 · 이름 · 소속 · 부여 · 역할(+태그) · 제거. 역할 열은 내용 폭(태그가 붙으면 늘어난다)이라
// 행마다 독립 grid면 태그 길이에 따라 소속·부여 열이 어긋난다 → 목록이 열을 소유하고 행은 subgrid로 공유.
const LIST_GRID = "grid grid-cols-[28px_minmax(0,1fr)_150px_112px_auto_24px] gap-x-2.5 gap-y-0.5";
const ROW_GRID = "col-span-full grid grid-cols-subgrid items-center";

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

// 이니셜 — 영문 이름의 단어 머리글자 2개(없으면 아이디 앞 2글자)
function initialsOf(name: string, fallback: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const text = words.length >= 2 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? fallback).slice(0, 2);
  return text.toUpperCase();
}

function Avatar({ principalType, name, id }: { principalType: PrincipalType; name: string; id: string }) {
  if (principalType === "user") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-[11px] font-semibold text-accent">
        {initialsOf(name, id)}
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-alt text-ink-tertiary">
      {principalType === "department" ? (
        <Building2 size={15} strokeWidth={1.5} />
      ) : (
        <Users size={15} strokeWidth={1.5} />
      )}
    </span>
  );
}

// 부여 열 — 작은 라벨 + 부여자·일시 / Granted column: tiny label + grantor · date.
function GrantedCell({ label, by, at }: { label: string; by: string; at?: string | null }) {
  const date = at ? formatKst(at).slice(5, 10) : "";
  return (
    <span className="min-w-0 text-fine leading-tight text-ink-tertiary">
      <span className="block text-[10px] uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="block truncate" title={at ? formatKst(at) : undefined}>
        {by}
        {date ? ` · ${date}` : ""}
      </span>
    </span>
  );
}

// 부서 이름 — 클릭 시 조직 정보 모달 / Department name opens the org info modal on click.
function DeptNameButton({ path, label, koreanDeptByPath }: { path: string; label: string; koreanDeptByPath: Map<string, string> }) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        data-id={`collab-dept-info-${path}`}
        className="truncate rounded-xs text-left text-caption text-ink hover:text-accent"
        onClick={(e) => setOrigin({ x: e.clientX, y: e.clientY })}
      >
        {label}
      </button>
      {origin && (
        <OrgInfoModal orgPath={path} koreanDeptByPath={koreanDeptByPath} origin={origin} onClose={() => setOrigin(null)} />
      )}
    </>
  );
}

// 개별 행 — 아바타·이름·소속·부여·역할·제거 / Individual permission row.
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
  koreanDeptByPath,
  onChangeRole,
  onTransferOwner,
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
  /** 현재 유저가 이 맵의 오너인지 — forecastStagedOp의 즉시적용/승인 예측 + Owner 항목 노출 / Owner status. */
  actorIsOwner: boolean;
  dirUsers: DirectoryUser[];
  dirDepts: DirectoryDept[];
  groups: Group[];
  koreanDeptByPath: Map<string, string>;
  onChangeRole: (perm: ApiPermission, toRole: MapRole) => void;
  onTransferOwner: (perm: ApiPermission) => void;
  onRemove: (perm: ApiPermission) => void;
  onCancelStaged: (op: StagedOp) => void;
  onWithdrawPending: (perm: ApiPermission) => void;
}) {
  const { t, lang } = useI18n();
  const principalType = perm.principal_type as PrincipalType;
  const displayName = resolvePrincipalName(principalType, perm.principal_id, dirUsers, dirDepts, groups);
  const user = principalType === "user" ? dirUsers.find((u) => u.id === perm.principal_id) : undefined;
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
  const grantedByName = dirUsers.find((u) => u.id === perm.granted_by)?.name ?? perm.granted_by;

  // 이름 — 언어설정 기준 주 이름, 다른 언어 이름은 보조(PersonHoverCard와 같은 규칙)
  const koreanName = user?.korean_name ?? "";
  const primaryName = lang === "ko" ? koreanName || displayName : displayName;
  const secondaryName = lang === "ko" ? (koreanName ? displayName : "") : koreanName;
  const titleLine = user ? formatTitleWithPosition(user.title ?? "", user.position ?? "") : "";
  const group = principalType === "group" ? groups.find((g) => String(g.id) === perm.principal_id) : undefined;
  const deptMembers =
    principalType === "department"
      ? dirUsers.filter((u) => belongsToDepartment(u.org_path ?? "", perm.principal_id)).length
      : 0;
  const deptKorean = principalType === "department" ? (koreanDeptByPath.get(perm.principal_id) ?? "") : "";
  const deptParents = principalType === "department" ? perm.principal_id.split("/").slice(0, -1).join(" / ") : "";

  // 역할 메뉴 항목 — viewer(공개 맵이면 기존 viewer만)·editor·Owner(오너가 editor 행에서만, 빨간 계열 → 이전 확인 모달)
  const roleItems: MenuSelectItem[] = [
    ...((!viewerGrantDisabled || role === "viewer")
      ? [{ value: "viewer", label: t("perm.roleViewer"), icon: <Eye size={13} strokeWidth={1.5} /> }]
      : []),
    { value: "editor", label: t("perm.roleEditor"), icon: <Pencil size={13} strokeWidth={1.5} /> },
    ...(actorIsOwner && principalType === "user" && !isGhost && role === "editor"
      ? [{ value: "owner", label: t("perm.roleOwner"), icon: <Crown size={13} strokeWidth={1.5} />, tone: "danger" as const }]
      : []),
  ];

  const ghostBadge = isGhost && (
    <span
      data-id="ghost-badge"
      className="ml-1 shrink-0 rounded-sm border border-hairline px-1 py-px text-[10px] text-error"
      title={t(principalType === "department" ? "perm.badgeMissingNote" : "perm.badgeDepartedNote")}
    >
      {t(principalType === "department" ? "perm.badgeMissing" : "perm.badgeDeparted")}
    </span>
  );

  // 이름 블록 — 유저는 호버 카드(카드 상단 배너에 이 맵 권한 1줄) / name block; users get the hover card
  const nameBlock: ReactNode =
    principalType === "user" ? (
      <PersonHoverCard
        userId={perm.principal_id}
        className="block min-w-0"
        notice={
          <span className="flex items-center gap-1.5">
            <RoleBadge role={role} />
            <span className="truncate text-fine text-ink-tertiary">
              {t("perm.collab.grantedBy")} {grantedByName}
              {perm.granted_at ? ` · ${formatKst(perm.granted_at).slice(0, 10)}` : ""}
            </span>
          </span>
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-caption text-ink">{primaryName}</span>
          {secondaryName && <span className="truncate text-fine text-ink-tertiary">{secondaryName}</span>}
          {ghostBadge}
        </span>
        <span className="block truncate text-fine text-ink-tertiary">
          {perm.principal_id}
          {titleLine ? ` · ${titleLine}` : ""}
        </span>
      </PersonHoverCard>
    ) : principalType === "department" ? (
      <span className="block min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <DeptNameButton path={perm.principal_id} label={deptLeaf(perm.principal_id) || displayName} koreanDeptByPath={koreanDeptByPath} />
          {deptKorean && <span className="truncate text-fine text-ink-tertiary">{deptKorean}</span>}
          {ghostBadge}
        </span>
        {deptParents && <span className="block truncate text-fine text-ink-tertiary">{deptParents}</span>}
      </span>
    ) : (
      <span className="block min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-caption text-ink">{displayName}</span>
          {ghostBadge}
        </span>
        <span className="block truncate text-fine text-ink-tertiary">{t("perm.collab.userGroup")}</span>
      </span>
    );

  // 소속 열 — 유저는 말단 부서, 부서/그룹은 구성원 수 / affiliation column
  const affiliation: ReactNode =
    principalType === "user" ? (
      user ? (
        <span className="flex min-w-0 items-center gap-1 text-fine text-ink-secondary">
          <Building2 size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <span className="truncate">{deptLeaf(user.org_path ?? "") || user.department}</span>
        </span>
      ) : (
        <span className="text-fine text-ink-muted">{t("perm.collab.notInDirectory")}</span>
      )
    ) : (
      <span className="flex min-w-0 items-center gap-1 text-fine text-ink-secondary">
        <User size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <span className="truncate">
          {t("perm.collab.members", { n: principalType === "department" ? deptMembers : (group?.members.length ?? 0) })}
        </span>
      </span>
    );

  return (
    <div
      data-id={`collab-row-${perm.id}`}
      className={`group relative ${ROW_GRID} rounded-sm py-1.5 pl-1.5 pr-1 hover:bg-surface-alt ${stagedRemove ? "opacity-60" : ""}`}
    >
      <Avatar principalType={principalType} name={displayName} id={perm.principal_id} />
      {nameBlock}
      {affiliation}
      <GrantedCell label={t("perm.collab.grantedBy")} by={grantedByName} at={perm.granted_at} />

      {/* 역할 열 — 태그(위)·뱃지 또는 메뉴(아래) 두 줄. 한 줄로 나란히 두면 긴 태그가 열 폭을 먹는다 /
          role column: pending/staged tags stacked above the badge or menu */}
      <span className="flex flex-col items-end justify-center gap-1">
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
        {isOwner || isPending || stagedRemove || controlsDisabled ? (
          <RoleBadge
            role={role}
            className={isOwner ? "inline-flex items-center gap-1" : ""}
          />
        ) : (
          <MenuSelect
            dataId={`collab-role-${perm.id}`}
            className="w-[92px]"
            value={stagedChange?.toRole ?? role}
            items={roleItems}
            onChange={(next) => {
              if (next === "owner") onTransferOwner(perm);
              else onChangeRole(perm, next as MapRole);
            }}
          />
        )}
      </span>

      {/* 제거 버튼 — opacity 토글이라 Tab 포커스는 유지되고 focus:/group-focus-within:로 키보드 사용자도 도달 가능 /
          Remove button: opacity (not display) keeps it tab-reachable, revealed on hover/focus. */}
      {!isOwner && !controlsDisabled && !stagedRemove && !isPending ? (
        <button
          type="button"
          title={t("perm.removeButton")}
          className="justify-self-center rounded-sm p-0.5 text-ink-tertiary opacity-0 pointer-events-none transition-opacity duration-150 hover:bg-surface-alt hover:text-error focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          onClick={() => onRemove(perm)}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      ) : (
        <span />
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
  onCountChange,
}: CollaboratorsPanelProps) {
  const { t } = useI18n();
  const mapIdNum = Number(mapId);
  const koreanDeptByPath = useKoreanDeptByPath();

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
  // 역할 메뉴 Owner 항목 → 소유권 이전 확인 모달(위험 구역과 같은 게이트) / Owner item → transfer confirm gate.
  const [transferTarget, setTransferTarget] = useState<ApiPermission | null>(null);

  // 방금 적립된 고스트 행을 화면 안으로 — 페이지 이탈 없이 "nearest"만 사용.
  useEffect(() => {
    if (!lastAddedKey) return;
    document.querySelector(`[data-id="staged-add-${lastAddedKey}"]`)?.scrollIntoView({ block: "nearest" });
  }, [lastAddedKey]);

  // 섹션 헤더 카운트 — 실 권한 행 + 오우닝 부서 잠금 행 / header count: grants + locked row
  useEffect(() => {
    if (loading) return;
    onCountChange?.(perms.length + (owningDepartment ? 1 : 0));
  }, [loading, perms.length, owningDepartment, onCountChange]);

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
    if (toRole === "owner") return; // owner는 이전 모달 경로 — 방어적 가드
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
      onToast(failureText ? `${summary} - ${failureText}` : summary);
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
      onToast(failureText ? `${text} - ${failureText}` : text);
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
  const owningMembers = owningDepartment
    ? dirUsers.filter((u) => belongsToDepartment(u.org_path ?? "", owningDepartment)).length
    : 0;

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
      <div className={LIST_GRID}>
      {!loading && owningDepartment && (
        <div data-id="owning-dept-locked-row" className={`${ROW_GRID} rounded-sm bg-surface-alt py-1.5 pl-1.5 pr-1`}>
          <Avatar principalType="department" name={owningDepartment} id={owningDepartment} />
          <span className="block min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <DeptNameButton
                path={owningDepartment}
                label={deptLeaf(owningDepartment) || resolvePrincipalName("department", owningDepartment, dirUsers, dirDepts, groups)}
                koreanDeptByPath={koreanDeptByPath}
              />
              {koreanDeptByPath.get(owningDepartment) && (
                <span className="truncate text-fine text-ink-tertiary">{koreanDeptByPath.get(owningDepartment)}</span>
              )}
              <span className="shrink-0 rounded-sm border border-hairline px-1 py-px text-[10px] text-ink-tertiary">
                {t("perm.owningDept.title")}
              </span>
            </span>
            <span className="block truncate text-fine text-ink-tertiary">
              {owningDepartment.split("/").slice(0, -1).join(" / ")}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1 text-fine text-ink-secondary">
            <User size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            <span className="truncate">{t("perm.collab.membersAllEditors", { n: owningMembers })}</span>
          </span>
          <GrantedCell label={t("perm.collab.grantedBy")} by={t("perm.collab.autoOnCreate")} />
          <span className="flex justify-end">
            <span
              title={t("perm.owningDept.lockedNote")}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-tertiary"
            >
              <LockKeyhole size={13} strokeWidth={1.5} />
              {t("perm.owningDept.lockedEditor")}
            </span>
          </span>
          <span />
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
          koreanDeptByPath={koreanDeptByPath}
          onChangeRole={handleChangeRole}
          onTransferOwner={setTransferTarget}
          onRemove={handleRemove}
          onCancelStaged={handleCancelStaged}
          onWithdrawPending={(p) => void handleWithdrawPending(p)}
        />
      ))}
      </div>

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
      {transferTarget && (
        <TransferOwnerDialog
          mapId={mapIdNum}
          targetId={transferTarget.principal_id}
          targetName={resolvePrincipalName("user", transferTarget.principal_id, dirUsers, dirDepts, groups)}
          onToast={onToast}
          onClose={() => setTransferTarget(null)}
        />
      )}
    </div>
  );
}

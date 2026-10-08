"use client";

// 맵별 결재 대기 패널 — 오너·승인자·sysadmin, 실 API / Per-map pending approvals panel (owner/approver/sysadmin), real API.
// permission_downgrade·visibility_change·map_rename·sp_designation 4종 — version_publish는 버전 탭, owner-transfer는 confirm 모달에서 처리.
// 서버 진실: approve 시 서버가 각 kind의 변경을 적용한다. 결정 후 요청 목록을 재조회한다(낙관적 갱신 금지).

import { Clock, Users } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  decideApprovalRequest,
  getPendingSlotChange,
  listApprovalRequests,
  listGroups,
  type ApprovalRequest,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { isSlotAction, SLOT_ACTION_KEY } from "@/lib/framework-slot-state";
import { useI18n } from "@/lib/i18n";
import { type MessageKey } from "@/lib/i18n-messages";
import { useAgo } from "@/lib/use-ago";
import { DeptPill } from "@/components/dept-pill";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import type { ToastItem } from "@/components/toast-stack";
import { Tooltip } from "@/components/tooltip";
import { UserPill } from "@/components/user-pill";
import { genId } from "@/lib/id";

// 결재 대기 탭이 다루는 ApprovalRequest 6종 — 결정권은 kind별로 다름(오너 vs 승인자 vs 직속 L5 관리자) (설계 §C)
const APPROVAL_KINDS = new Set([
  "permission_downgrade",
  "visibility_change",
  "map_rename",
  "sp_designation",
  "fw_confirm",
  "fw_slot",
]);

// 버전에 동봉된 visibility_change 행 — 버전 승인으로만 결정되는 읽기전용이라 결재 대기 배지에 세지 않는다.
function isBundledRow(r: ApprovalRequest): boolean {
  return r.kind === "visibility_change" && r.payload.version_id != null;
}

function countPending(rows: ApprovalRequest[]): number {
  return rows.filter((r) => r.status === "pending" && APPROVAL_KINDS.has(r.kind) && !isBundledRow(r)).length;
}

// 페이로드 원시 값 → 표시 라벨(역할은 영어 고정 라벨, 공개범위는 i18n). 모르는 값은 원문 그대로.
const ROLE_LABEL_KEY: Record<string, MessageKey> = {
  owner: "perm.roleOwner",
  editor: "perm.roleEditor",
  viewer: "perm.roleViewer",
};
const VISIBILITY_LABEL_KEY: Record<string, MessageKey> = {
  public: "perm.visibilityPublic",
  private: "perm.visibilityPrivate",
};

// 변경 내용 "전 → 후" — 전 값은 톤다운, 긴 값은 자르지 않고 줄바꿈.
function ChangeText({ from, to }: { from?: string; to: string }) {
  return (
    <span className="min-w-0 text-caption text-ink [overflow-wrap:anywhere]">
      {from !== undefined && (
        <>
          <span className="text-ink-tertiary">{from}</span>
          <span className="mx-1 text-ink-tertiary">→</span>
        </>
      )}
      {to}
    </span>
  );
}

interface Props {
  mapId: string;
  /** rename/sp_designation 행 결정권 — 오너(sysadmin 포함) 여부. */
  isOwner: boolean;
  /** permission/visibility 행 결정권 — 지정 승인자 또는 sysadmin 여부. */
  isApprover: boolean;
  /** fw_confirm 행 결정권 — 직속 L5 관리자 또는 sysadmin 여부(`MapDetail.can_confirm`). */
  canConfirm: boolean;
  /** fw_slot 행 결정권 — 직속 L5 관리자 또는 sysadmin(`MapDetail.can_decide_slot`). */
  canDecideSlot: boolean;
  /** pending 개수 통지 — 좌측 레일 배지용(로드·결정 후 호출). */
  onCountChange?: (count: number) => void;
  /** 결정 후 호출 — 호스트가 맵/협업자 데이터를 재조회하도록 / Called after a decision so the host can refetch map data. */
  onDecided?: () => void;
  onToast: (item: ToastItem) => void;
}

export function PendingApprovalsPanel({
  mapId,
  isOwner,
  isApprover,
  canConfirm,
  canDecideSlot,
  onCountChange,
  onDecided,
  onToast,
}: Props) {
  const { t } = useI18n();
  const ago = useAgo();
  const mapIdNum = Number(mapId);

  // 서버 결재 요청 목록 / Server-sourced approval requests.
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  // 결정 진행 중인 요청 id — 더블클릭/중복 결정 방지 / Ids being decided, to disable buttons.
  const [decidingIds, setDecidingIds] = useState<Set<number>>(new Set());
  // fw_slot 행의 잔여 side 기준 결정권 — null=미조회/조회실패(canDecideSlot prop로 폴백), 조회되면
  // 그 값을 그대로 신뢰(false도 유효한 답) — 부분 승인 후 이미 결정한 관리자의 버튼을 숨긴다 (fix round 1 #2b).
  const [slotCanDecide, setSlotCanDecide] = useState<boolean | null>(null);

  // 목록 열람 권한 — 서버 게이트(오너/승인자/sysadmin)와 동일 + fw_confirm/fw_slot 결정권(직속 L5 admin).
  // 없으면 조회 자체를 건너뛴다: 403 → 토스트 → 부모 상태 변경 → 이펙트 deps(콜백 아이덴티티)
  // 재실행의 무한 재요청 루프 방지 (QA).
  const canList = isOwner || isApprover || canConfirm || canDecideSlot;

  const reload = useCallback(async () => {
    if (!canList) return;
    try {
      const rows = await listApprovalRequests(mapIdNum);
      setRequests(rows);
      onCountChange?.(countPending(rows));
      // MapDetail.can_decide_slot는 페이지 로드 시점 스냅샷이라 결정 후 갱신되지 않는다(onDecided는
      // workflow만 재조회) — fw_slot이 여전히 pending이면 여기서 직접 최신 can_decide를 받아온다.
      const hasPendingSlot = rows.some((r) => r.kind === "fw_slot" && r.status === "pending");
      if (!hasPendingSlot) {
        setSlotCanDecide(null);
      } else {
        try {
          const pending = await getPendingSlotChange(mapIdNum);
          setSlotCanDecide(pending?.can_decide ?? null);
        } catch {
          setSlotCanDecide(null);
        }
      }
    } catch (err) {
      onToast({ id: genId(), message: humanizeApiError(err, t) });
    }
  }, [canList, mapIdNum, onToast, onCountChange, t]);

  // 초기 로드 — active 가드로 언마운트 후 setState 방지. 실패는 조용히(벨 폴링 선례) —
  // 초기 조회 에러 토스트는 위 루프의 연료가 된다 / Initial load; silent on failure.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!canList) {
        if (active) onCountChange?.(0);
        return;
      }
      try {
        const rows = await listApprovalRequests(mapIdNum);
        if (active) {
          setRequests(rows);
          onCountChange?.(countPending(rows));
        }
      } catch {
        // 일시 실패/권한 경합 — 다음 상호작용(reload)에서 회복
      }
    })();
    return () => {
      active = false;
    };
  }, [canList, mapIdNum, onCountChange]);

  const handleDecide = useCallback(
    async (requestId: number, decision: "approve" | "reject") => {
      setDecidingIds((prev) => new Set(prev).add(requestId));
      try {
        await decideApprovalRequest(requestId, decision);
        // 서버가 적용함 — 목록 + 호스트의 맵 데이터(역할/가시성) 재조회 / Server applied; refetch list + host map data.
        await reload();
        onDecided?.();
        onToast({
          id: genId(),
          message:
            decision === "approve"
              ? t("perm.approvals.toastApproved")
              : t("perm.approvals.toastRejected"),
        });
      } catch (err) {
        onToast({ id: genId(), message: humanizeApiError(err, t) });
      } finally {
        setDecidingIds((prev) => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
      }
    },
    [reload, onDecided, onToast, t],
  );

  const pendingRequests = requests.filter(
    (r) => r.status === "pending" && APPROVAL_KINDS.has(r.kind),
  );

  // 그룹 대상 행이 있을 때만 그룹 이름을 받아 온다. 못 받거나 안 보이는 그룹(서버 가시성 규칙)은 id 폴백이라
  // 실패해도 표시는 유지된다 — 토스트 없이 조용히.
  const [groupNames, setGroupNames] = useState<Map<string, string>>(new Map());
  const hasGroupRow = pendingRequests.some(
    (r) => r.kind === "permission_downgrade" && r.payload.principal_type === "group",
  );
  useEffect(() => {
    if (!hasGroupRow) return;
    let active = true;
    listGroups()
      .then((groups) => {
        if (active) setGroupNames(new Map(groups.map((g) => [String(g.id), g.name])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [hasGroupRow]);

  function canDecideKind(kind: string): boolean {
    if (kind === "fw_confirm") return canConfirm;
    // slotCanDecide(신선한 잔여 side 조회)가 있으면 우선 — 없으면(미조회/실패) prop으로 폴백.
    if (kind === "fw_slot") return slotCanDecide ?? canDecideSlot;
    return kind === "map_rename" || kind === "sp_designation" ? isOwner : isApprover;
  }

  function formatRole(role: unknown): string {
    if (role == null) return t("perm.approvals.roleRemoved");
    const key = ROLE_LABEL_KEY[String(role)];
    return key ? t(key) : String(role);
  }

  function formatVisibility(vis: unknown): string {
    const key = VISIBILITY_LABEL_KEY[String(vis ?? "")];
    return key ? t(key) : String(vis ?? "");
  }

  // 권한 하향 대상 — 내부 키(user:id·group:id) 대신 이름 필 / Target principal as a name pill, not the raw key.
  function renderPrincipal(req: ApprovalRequest): ReactNode {
    const type = String(req.payload.principal_type ?? "");
    const id = String(req.payload.principal_id ?? "");
    if (type === "user") return <UserPill loginId={id} />;
    // 부서 principal_id는 조직 경로 — DeptPill은 말단 이름으로 고아 판정하므로 말단만 넘긴다(category-dept-modal 선례)
    if (type === "department") {
      return <DeptPill department={deptLeaf(id)} dataId={`pending-approval-dept-${req.id}`} />;
    }
    return (
      <span className="inline-flex min-w-0 items-center gap-1 rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary">
        <Users size={12} strokeWidth={1.5} className="shrink-0" />
        <span className="truncate">{groupNames.get(id) ?? id}</span>
      </span>
    );
  }

  // 요청 내용 — kind별, 자르지 않고 줄바꿈 / Request detail by kind, wrapped rather than truncated.
  function renderDetail(req: ApprovalRequest): ReactNode {
    const p = req.payload;
    if (req.kind === "permission_downgrade") {
      return (
        <>
          {renderPrincipal(req)}
          <ChangeText from={formatRole(p.from_role)} to={formatRole(p.to_role)} />
        </>
      );
    }
    if (req.kind === "visibility_change") {
      return (
        <ChangeText
          from={p.from_visibility == null ? undefined : formatVisibility(p.from_visibility)}
          to={formatVisibility(p.to_visibility)}
        />
      );
    }
    if (req.kind === "map_rename") {
      return <ChangeText from={String(p.from_name ?? "")} to={String(p.to_name ?? "")} />;
    }
    if (req.kind === "sp_designation") {
      // 요청 발원 맵 표시 — 이 맵을 SP로 등록해달라는 요청
      return <ChangeText to={String(p.from_map_name ?? p.map_name ?? "")} />;
    }
    if (req.kind === "fw_confirm") {
      return <ChangeText to={String(p.note ?? "")} />;
    }
    if (req.kind === "fw_slot") {
      const action = isSlotAction(p.action) ? t(SLOT_ACTION_KEY[p.action]) : String(p.action ?? "");
      const target = typeof p.to_map_name === "string" && p.to_map_name ? ` → ${p.to_map_name}` : "";
      return <ChangeText to={`${action}${target}${p.note ? ` · ${String(p.note)}` : ""}`} />;
    }
    return <ChangeText to={JSON.stringify(p)} />;
  }

  if (pendingRequests.length === 0) {
    return (
      <p className="py-8 text-center text-caption text-ink-tertiary">
        {t("perm.approvals.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {pendingRequests.map((req) => {
        const kindLabel =
          req.kind === "permission_downgrade"
            ? t("perm.approvals.kindDowngrade")
            : req.kind === "visibility_change"
              ? t("perm.approvals.kindVisibility")
              : req.kind === "map_rename"
                ? t("perm.approvals.kindRename")
                : req.kind === "fw_confirm"
                  ? t("approval.kindFwConfirm")
                  : req.kind === "fw_slot"
                    ? t("approval.kindFwSlot")
                    : t("perm.approvals.kindSpDesignation");
        const isDeciding = decidingIds.has(req.id);
        const isBundled = isBundledRow(req);

        // 세로 카드(사용자 결정 2026-10-08 A안) — 인스펙터 최소 폭 300에서도 잘리지 않게 폭과 무관한 세 줄:
        // 종류·요청 시각 / 대상·변경 내용 / 요청자·결정 버튼
        return (
          <div
            key={req.id}
            data-id={`pending-approval-${req.id}`}
            className="rounded-md border border-hairline bg-surface px-3 py-2.5"
          >
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
                {kindLabel}
              </span>
              <Tooltip label={formatKst(req.created_at)} className="ml-auto shrink-0">
                <span className="inline-flex items-center gap-1 whitespace-nowrap text-fine text-ink-tertiary">
                  <Clock size={12} strokeWidth={1.5} />
                  {ago(req.created_at)}
                </span>
              </Tooltip>
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">{renderDetail(req)}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-divider pt-2">
              <span className="text-fine text-ink-tertiary">{t("perm.approvals.requesterLabel")}</span>
              <UserPill loginId={req.requested_by} />
              {/* 승인/거절 버튼 — 결정권 없는 행은 안내만 / Approve / reject buttons — read-only hint otherwise */}
              {isBundled ? (
                <span className="ml-auto text-right text-fine text-ink-tertiary">
                  {t("perm.approvals.bundledWithVersion")}
                </span>
              ) : canDecideKind(req.kind) ? (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    data-id={`pending-approval-approve-${req.id}`}
                    disabled={isDeciding}
                    className="rounded-sm border border-added px-2.5 py-1 text-fine text-added hover:bg-surface-alt disabled:opacity-50"
                    onClick={() => void handleDecide(req.id, "approve")}
                  >
                    {t("perm.approvals.approve")}
                  </button>
                  <button
                    type="button"
                    data-id={`pending-approval-reject-${req.id}`}
                    disabled={isDeciding}
                    className="rounded-sm border border-error px-2.5 py-1 text-fine text-error hover:bg-surface-alt disabled:opacity-50"
                    onClick={() => void handleDecide(req.id, "reject")}
                  >
                    {t("perm.approvals.reject")}
                  </button>
                </div>
              ) : (
                <span className="ml-auto text-right text-fine text-ink-tertiary">
                  {req.kind === "map_rename" || req.kind === "sp_designation"
                    ? t("perm.approvals.ownerDecides")
                    : t("perm.approvals.approverDecides")}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

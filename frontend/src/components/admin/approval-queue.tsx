"use client";

// 시스템 관리자 승인 큐 — 큐에 들어올 수 있는 케이스(그룹 생성 · 권한 하향 · 가시성 변경)를
// pill로 요약해 노출하고, 클릭하면 상세 + 승인/반려가 펼쳐진다 (모두 실 API). /
// Sysadmin approval queue: each pending case (group creation / permission downgrade / visibility
// change) is a summary pill; clicking one expands its detail with Approve/Reject. All real API.
// 그룹: GET /api/groups/pending + POST /api/groups/{id}/decide. 맵: GET /api/approval-requests + decide.

import { useCallback, useEffect, useState } from "react";

import {
  decideApprovalRequest,
  decideGroup,
  listPendingApprovalRequests,
  listPendingGroups,
  type ApprovalRequest,
  type Group,
} from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import type { ToastItem } from "@/components/toast-stack";

interface Props {
  onToast: (item: ToastItem) => void;
  // 좌측 nav 배지용 — 로드/결정 후 대기 건수 보고 / report pending count for the nav badge.
  onCountChange?: (count: number) => void;
}

// 큐 항목 — 그룹 생성 또는 맵 승인요청(권한 하향/가시성 변경) / a queue item.
type QueueItem =
  | { key: string; kind: "group_create"; group: Group }
  | { key: string; kind: "permission_downgrade" | "visibility_change"; req: ApprovalRequest };

// 상세 필드 행 / detail field row.
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-fine">
      <span className="shrink-0 text-ink-tertiary">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

export function ApprovalQueue({ onToast, onCountChange }: Props) {
  const { t } = useI18n();

  const [pendingGroups, setPendingGroups] = useState<Group[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ApprovalRequest[]>([]);
  const [decidingKeys, setDecidingKeys] = useState<Set<string>>(new Set());
  // 클릭으로 펼친 항목 key (단일) / the expanded item's key.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [groups, requests] = await Promise.all([
        listPendingGroups(),
        listPendingApprovalRequests(),
      ]);
      setPendingGroups(groups);
      setPendingRequests(requests);
      onCountChange?.(groups.length + requests.length);
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    }
  }, [onToast, onCountChange]);

  // 초기 로드 — 인라인 async + active 가드(set-state-in-effect 회피) / Initial load.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [groups, requests] = await Promise.all([
          listPendingGroups(),
          listPendingApprovalRequests(),
        ]);
        if (active) {
          setPendingGroups(groups);
          setPendingRequests(requests);
          onCountChange?.(groups.length + requests.length);
        }
      } catch (err) {
        if (active) onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      active = false;
    };
  }, [onToast, onCountChange]);

  const items: QueueItem[] = [
    ...pendingGroups.map((g) => ({ key: `g${g.id}`, kind: "group_create" as const, group: g })),
    ...pendingRequests.map((r) => ({
      key: `r${r.id}`,
      kind: r.kind as "permission_downgrade" | "visibility_change",
      req: r,
    })),
  ];
  const expandedItem = items.find((i) => i.key === expandedKey) ?? null;

  // kind별 라벨 + pill 색 / per-kind label and pill color.
  function kindMeta(kind: QueueItem["kind"]): { label: string; cls: string } {
    if (kind === "group_create") {
      return {
        label: t("perm.sysadmin.kindGroupCreate"),
        cls: "border-accent-tint-border bg-accent-tint text-accent",
      };
    }
    if (kind === "permission_downgrade") {
      return { label: t("perm.sysadmin.kindDowngrade"), cls: "border-changed text-changed" };
    }
    return { label: t("perm.sysadmin.kindVisibility"), cls: "border-hairline text-ink-secondary" };
  }

  // pill 한 줄 요약 / one-line pill summary.
  function chipSummary(item: QueueItem): string {
    if (item.kind === "group_create") return item.group.name;
    if (item.kind === "permission_downgrade") {
      return String(item.req.payload.principal_id ?? `${t("perm.sysadmin.mapLabel")} ${item.req.map_id}`);
    }
    return `${t("perm.sysadmin.mapLabel")} ${item.req.map_id}`;
  }

  // 요청 payload 상세 요약 / request payload detail.
  function requestDetail(req: ApprovalRequest): string {
    if (req.kind === "permission_downgrade") {
      const p = req.payload;
      const from = String(p.from_role ?? "");
      const to = p.to_role == null ? t("perm.approvals.roleRemoved") : String(p.to_role);
      return `${String(p.principal_type)}:${String(p.principal_id)}  ${from} → ${to}`;
    }
    return String(req.payload.to_visibility ?? "");
  }

  async function decideItem(item: QueueItem, decision: "approve" | "reject") {
    setDecidingKeys((prev) => new Set(prev).add(item.key));
    try {
      if (item.kind === "group_create") await decideGroup(item.group.id, decision);
      else await decideApprovalRequest(item.req.id, decision); // approve → 서버가 즉시 적용
      onToast({
        id: genId(),
        message: decision === "approve" ? t("perm.sysadmin.toastApproved") : t("perm.sysadmin.toastRejected"),
      });
      setExpandedKey(null);
      await reload();
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    } finally {
      setDecidingKeys((prev) => {
        const next = new Set(prev);
        next.delete(item.key);
        return next;
      });
    }
  }

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-caption text-ink-tertiary">
        {t("perm.sysadmin.queueEmpty")}
      </p>
    );
  }

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      {/* 케이스 pill 요약 — 클릭 시 상세 펼침 / case pills; click to expand */}
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const meta = kindMeta(item.kind);
          const expanded = expandedKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-fine transition-colors ${
                expanded ? "ring-1 ring-accent " : ""
              }${meta.cls}`}
              onClick={() => setExpandedKey(expanded ? null : item.key)}
            >
              <span className="font-semibold">{meta.label}</span>
              <span className="opacity-80">· {chipSummary(item)}</span>
            </button>
          );
        })}
      </div>

      {/* 펼친 항목 상세 + 승인/반려 / expanded detail + decide */}
      {expandedItem && (
        <div className="flex flex-col gap-3 rounded-md border border-hairline bg-surface p-4">
          <div className="flex flex-col gap-1.5">
            {expandedItem.kind === "group_create" ? (
              <>
                <Field label={t("perm.group.nameLabel")} value={expandedItem.group.name} />
                {expandedItem.group.description && (
                  <Field label={t("perm.group.descLabel")} value={expandedItem.group.description} />
                )}
                <Field
                  label={t("perm.sysadmin.managerLabel")}
                  value={expandedItem.group.managers.join(", ")}
                />
                <Field
                  label={t("perm.group.membersSection")}
                  value={String(expandedItem.group.members.length)}
                />
                <Field
                  label={t("perm.sysadmin.requesterLabel")}
                  value={expandedItem.group.created_by}
                />
              </>
            ) : (
              <>
                <Field
                  label={t("perm.sysadmin.mapLabel")}
                  value={String(expandedItem.req.map_id)}
                />
                <Field label={t("perm.sysadmin.detailLabel")} value={requestDetail(expandedItem.req)} />
                <Field
                  label={t("perm.sysadmin.requesterLabel")}
                  value={expandedItem.req.requested_by}
                />
                <Field
                  label={t("perm.sysadmin.requestedAt")}
                  value={formatKst(expandedItem.req.created_at)}
                />
              </>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-sm border border-added px-3 py-1 text-fine text-added hover:bg-surface-alt disabled:opacity-40"
              onClick={() => void decideItem(expandedItem, "approve")}
              disabled={decidingKeys.has(expandedItem.key)}
            >
              {t("perm.sysadmin.approve")}
            </button>
            <button
              type="button"
              className="rounded-sm border border-error px-3 py-1 text-fine text-error hover:bg-surface-alt disabled:opacity-40"
              onClick={() => void decideItem(expandedItem, "reject")}
              disabled={decidingKeys.has(expandedItem.key)}
            >
              {t("perm.sysadmin.reject")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

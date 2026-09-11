// 홈 대시보드 — 내 결재 대기 큐. 종류 칩(아이콘+라벨)·맵·요청자·경과, 5행 상한 + 인박스 링크아웃. status 파생 단계만(백엔드 무변경).
"use client";

import { ArrowLeftRight, CheckCircle2, FileSignature, Inbox, KeyRound, Layers, Link2, Pencil } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { listInboxApprovals, type InboxApproval } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { useAgo } from "@/lib/use-ago";
import { useDelayedNav } from "@/lib/use-delayed-nav";
import { HoverLinkedRow } from "@/components/maps/dashboard-hover-row";
import { DashboardEmpty, DashboardFoot, DashboardSection } from "@/components/maps/dashboard-section";
import { SkeletonLine } from "@/components/skeleton";

const ROW_CAP = 5;

// 종류 판정 — approval_request는 title이 세부 종류(map_rename·sp_designation·fw_slot·visibility/permission).
function resolveKind(a: InboxApproval): { key: MessageKey; icon: ReactNode; cls: string } {
  const icon = (n: ReactNode) => n;
  if (a.kind === "version_approval")
    return { key: "inbox.approvalKind.version_approval", icon: icon(<FileSignature size={12} strokeWidth={1.5} />), cls: "bg-accent-tint text-accent-elevated" };
  if (a.kind === "checkout_transfer")
    return { key: "inbox.approvalKind.checkout_transfer", icon: icon(<ArrowLeftRight size={12} strokeWidth={1.5} />), cls: "bg-changed/10 text-changed" };
  if (a.title === "map_rename")
    return { key: "inbox.reqKind.map_rename", icon: icon(<Pencil size={12} strokeWidth={1.5} />), cls: "border border-hairline bg-surface-alt text-ink-secondary" };
  if (a.title === "sp_designation")
    return { key: "inbox.reqKind.sp_designation", icon: icon(<Link2 size={12} strokeWidth={1.5} />), cls: "bg-accent-tint text-accent" };
  if (a.title === "fw_slot")
    return { key: "inbox.reqKind.fw_slot", icon: icon(<Layers size={12} strokeWidth={1.5} />), cls: "bg-added/10 text-added" };
  return { key: "inbox.approvalKind.approval_request", icon: icon(<KeyRound size={12} strokeWidth={1.5} />), cls: "border border-hairline bg-surface-alt text-ink-secondary" };
}

interface ApprovalsCardProps { onSelect: (id: number) => void }

export function ApprovalsCard({ onSelect }: ApprovalsCardProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const dir = useDirectory();
  const [items, setItems] = useState<InboxApproval[]>([]);
  // 조회 실패와 진짜 0건을 구분 — 실패 시 "모두 처리됨"으로 오인시키지 않는다
  const [loadError, setLoadError] = useState(false);
  // 도착 전 0건도 마찬가지 — 빈 상태를 먼저 띄웠다가 목록으로 뒤집히지 않게 스켈레톤으로 대기
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void listInboxApprovals()
      .then((r) => { if (active) { setItems(r); setLoadError(false); } })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  // 인박스 이동은 1클릭 지연 이동 — 1초 안에 다시 클릭하면 취소 (사용자 지시 2026-09-11)
  const { pending, toggle } = useDelayedNav();
  const goInbox = () => toggle("/inbox");
  const inboxLabel = pending === "/inbox" ? t("home.dash.navCancel") : t("home.dash.inboxTab");
  return (
    <DashboardSection
      dataId="home-needs-approval"
      icon={<Inbox size={16} strokeWidth={1.5} />}
      title={t("home.needsApproval")}
      count={loading ? null : items.length}
      countHot={items.length > 0}
      more={items.length > ROW_CAP ? { label: inboxLabel, onClick: goInbox } : undefined}
    >
      {loading ? (
        <div className="flex flex-col gap-2 border-t border-divider px-3 py-3">
          <SkeletonLine className="w-4/5" />
          <SkeletonLine className="w-3/5" />
          <SkeletonLine className="w-2/3" />
        </div>
      ) : items.length === 0 ? (
        <DashboardEmpty
          icon={<CheckCircle2 size={14} strokeWidth={1.5} />}
          text={loadError ? t("home.approvalsLoadError") : t("home.dash.approvalsEmpty")}
        />
      ) : (
        <>
          {items.slice(0, ROW_CAP).map((a) => {
            const k = resolveKind(a);
            return (
              <HoverLinkedRow
                key={`${a.kind}:${a.id}`}
                mapId={a.map_id}
                dataId={`home-approval-${a.kind}-${a.id}`}
                onClick={() => onSelect(a.map_id)}
                className="flex w-full items-center gap-2 border-t border-divider px-3 py-1.5 text-left"
              >
                <span className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-semibold ${k.cls}`}>
                  {k.icon}
                  {t(k.key)}
                </span>
                <span className="min-w-0 flex-1 truncate text-caption text-ink">{a.map_name}</span>
                <span className="max-w-[30%] shrink-0 truncate text-fine text-ink-secondary">{dir.get(a.requester)?.name ?? a.requester}</span>
                {a.version_number != null && <span className="shrink-0 text-fine text-ink-tertiary">v{a.version_number}</span>}
                <span className="shrink-0 text-fine text-ink-tertiary">{ago(a.created_at)}</span>
              </HoverLinkedRow>
            );
          })}
          {items.length > ROW_CAP && <DashboardFoot label={pending === "/inbox" ? t("home.dash.navPending", { dest: t("home.dash.destInbox") }) : t("home.dash.approvalsMore", { n: items.length - ROW_CAP })} onClick={goInbox} />}
        </>
      )}
    </DashboardSection>
  );
}

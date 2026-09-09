"use client";

// 고아 참조 그룹 카드 — 값(소멸 경로/리프/로그인/이름) 하나에 걸린 참조 라인을 체크해 일괄 replace/remove 하고,
// 고칠 수 없는 노드 라인은 맵 오너에게 알림. 부서·사용자 섹션이 공유(ref-audit-panel.tsx 전용).
import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

import {
  postRefNotify,
  postRefRemap,
  type RefGroup,
  type RefLine,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { CheckInput } from "@/components/check-input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PersonHoverCard } from "@/components/person-hover-card";
import { DeptTreePicker, type DeptPathOption } from "@/components/admin/dept-tree-picker";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { useI18n } from "@/lib/i18n";
import type { User as PickerUser } from "@/lib/mock/permissions";
import {
  countNotifyOwners,
  isLineCheckable,
  listCheckableTargets,
  listNotifyTargets,
  REMOVE_BLOCKED,
  SOURCE_LABEL_KEY,
  summarizeSources,
  VALUE_KIND_LABEL_KEY,
  type RemapMode,
} from "@/lib/ref-audit";

interface RefGroupCardProps {
  group: RefGroup;
  deptOptions: DeptPathOption[];
  pickerUsers: PickerUser[];
  userDepartments: Record<string, string>;
  sectionClass: string;
  expanded: boolean;
  onToggle: () => void;
  // 적용/알림 뒤 재스캔 + 결과 문구 — 부모가 상태를 가진다
  onDone: (message: string) => void;
}

const BTN = "rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";

function LineSubject({ line }: { line: RefLine }) {
  if (line.map_id !== null) {
    return (
      <Link href={`/maps/${line.map_id}`} className="truncate text-ink hover:text-accent hover:underline">
        {line.map_name}
      </Link>
    );
  }
  if (line.group_id !== null) return <span className="truncate">{line.group_name}</span>;
  return <span className="truncate">{line.category_name}</span>;
}

export function RefGroupCard({
  group, deptOptions, pickerUsers, userDepartments, sectionClass, expanded, onToggle, onDone,
}: RefGroupCardProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<RemapMode>("replace");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<{ id: string; label: string } | null>(null);
  const [pickingDept, setPickingDept] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "notify" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const checkable = listCheckableTargets(group, mode);
  const selected = [...checked].filter((id) => checkable.includes(id));
  const notifyIds = listNotifyTargets(group);
  const notifyOwners = countNotifyOwners(group);
  const key = `${group.kind}-${group.value_kind}-${group.value}`;

  const switchMode = (next: RemapMode) => {
    setMode(next);
    // remove로 바꾸면 제거 불가 라인의 체크가 풀린다
    if (next === "remove") {
      setChecked((prev) => new Set([...prev].filter((id) => {
        const ln = group.lines.find((l) => l.target_id === id);
        return ln !== undefined && !REMOVE_BLOCKED.has(ln.source);
      })));
    }
  };

  const toggleAll = () => {
    setChecked(selected.length === checkable.length ? new Set() : new Set(checkable));
  };

  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await postRefRemap({
        kind: group.kind, from_value: group.value, mode,
        to_value: mode === "replace" ? target?.id : undefined, target_ids: selected,
      });
      const applied = Object.values(res.applied).reduce((a, b) => a + b, 0);
      const skipped = res.skipped.length ? t("refAudit.appliedSkipped", { n: res.skipped.length }) : "";
      onDone(t("refAudit.applied", { n: applied, skipped }));
    } catch (err) {
      setError(humanizeApiError(err, t));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const notify = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await postRefNotify(notifyIds);
      const skipped = res.skipped_maps.length ? t("refAudit.notifiedSkipped", { n: res.skipped_maps.length }) : "";
      onDone(t("refAudit.notified", { recipients: res.recipients, maps: res.maps, skipped }));
    } catch (err) {
      setError(humanizeApiError(err, t));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const canApply = selected.length > 0 && (mode === "remove" || target !== null) && !busy;

  return (
    <div className="rounded-md border border-hairline bg-surface" data-id={`ref-audit-group-${key}`}>
      <button
        type="button"
        data-id="ref-audit-group-toggle"
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-alt"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
        <span className={`min-w-0 flex-1 truncate text-caption-strong text-error ${group.value_kind === "path" ? "font-mono" : ""}`}>
          {group.value}
        </span>
        <span className="rounded-full border border-hairline px-2 py-0.5 text-fine text-ink-tertiary">
          {t(VALUE_KIND_LABEL_KEY[group.value_kind])}
        </span>
        <span className="hidden shrink-0 text-fine text-ink-tertiary md:inline">
          {summarizeSources(group).map(([source, count]) => `${t(SOURCE_LABEL_KEY[source])} ${count}`).join(" · ")}
        </span>
      </button>

      {expanded && (
        <div className={sectionClass}>
          <div className="flex min-w-0 flex-col border-t border-divider">
            <div className="flex items-center gap-3 bg-surface-alt px-4 py-1.5 text-fine text-ink-tertiary">
              <CheckInput
                data-id="ref-audit-check-all"
                checked={checkable.length > 0 && selected.length === checkable.length}
                disabled={checkable.length === 0}
                onChange={toggleAll}
                aria-label="select all"
              />
              <span>{selected.length}/{checkable.length}</span>
            </div>
            {group.lines.map((line) => {
              const ok = isLineCheckable(line, mode);
              const blocked = line.fixable && !ok;
              const hint = !line.fixable ? t("refAudit.draftOnly") : blocked ? t("refAudit.cannotRemove") : "";
              return (
                <div
                  key={line.target_id}
                  data-id={`ref-audit-line-${line.target_id}`}
                  data-checkable={ok ? "true" : "false"}
                  className={`flex items-center gap-3 border-b border-divider px-4 py-2 text-caption last:border-0 ${ok ? "text-ink" : "text-ink-tertiary"}`}
                >
                  <CheckInput
                    data-id="ref-audit-line-check"
                    checked={checked.has(line.target_id) && ok}
                    disabled={!ok}
                    onChange={() => setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(line.target_id)) next.delete(line.target_id);
                      else next.add(line.target_id);
                      return next;
                    })}
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <LineSubject line={line} />
                    {line.owner_id && (
                      <PersonHoverCard userId={line.owner_id} className="shrink-0 text-fine text-ink-tertiary">
                        {line.owner_name ?? line.owner_id}
                      </PersonHoverCard>
                    )}
                  </span>
                  <span className="shrink-0 text-fine">
                    {t(SOURCE_LABEL_KEY[line.source])}
                    {line.version_status && ` · ${t(line.version_status === "draft" ? "refAudit.versionDraft" : "refAudit.versionPublished")}`}
                  </span>
                  <span className="w-16 shrink-0 text-right text-fine">
                    {line.version_status ? t("refAudit.nodes", { n: line.count }) : "—"}
                  </span>
                  {hint ? (
                    <span className="shrink-0 text-ink-tertiary" title={hint} data-id="ref-audit-line-hint">
                      <Info size={13} strokeWidth={1.5} />
                    </span>
                  ) : <span className="w-[13px] shrink-0" />}
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2 border-t border-divider px-4 py-2.5" data-id="ref-audit-actions">
              {group.kind === "user" && (
                <span className="flex items-center gap-1 rounded-sm border border-hairline p-0.5 text-fine">
                  {(["replace", "remove"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      data-id={`ref-audit-mode-${m}`}
                      className={`rounded-xs px-2 py-1 ${mode === m ? "bg-accent-tint text-accent" : "text-ink-secondary hover:bg-surface-alt"}`}
                      onClick={() => switchMode(m)}
                    >
                      {t(m === "replace" ? "refAudit.replaceWith" : "refAudit.remove")}
                    </button>
                  ))}
                </span>
              )}
              {mode === "replace" && group.kind === "dept" && (
                <>
                  <span className="text-fine text-ink-tertiary">{t("refAudit.reassignTo")}</span>
                  <button type="button" data-id="ref-audit-pick-dept" className={`${BTN} max-w-[18rem] truncate`}
                          title={target?.id ?? ""} onClick={() => setPickingDept(true)}>
                    {target?.label ?? t("refAudit.pickDept")}
                  </button>
                </>
              )}
              {mode === "replace" && group.kind === "user" && (
                target ? (
                  <button type="button" data-id="ref-audit-pick-user" className={BTN} onClick={() => setTarget(null)}>
                    {target.label}
                  </button>
                ) : (
                  <span className="min-w-[16rem]" data-id="ref-audit-pick-user">
                    <PrincipalPicker
                      users={pickerUsers}
                      departments={[]}
                      groups={[]}
                      excludeIds={new Set()}
                      userDepartments={userDepartments}
                      onSelect={(opt: PrincipalOption) => {
                        if (opt.principalType === "user") setTarget({ id: opt.principalId, label: opt.displayName });
                      }}
                    />
                  </span>
                )
              )}
              <span className="flex-1" />
              <button type="button" data-id="ref-audit-apply" className={PRIMARY} disabled={!canApply}
                      onClick={() => setConfirm("apply")}>
                {t("refAudit.apply", { n: selected.length })}
              </button>
              <button type="button" data-id="ref-audit-notify" className={BTN}
                      disabled={busy || notifyIds.length === 0}
                      title={notifyIds.length > 0 && notifyOwners === 0 ? t("refAudit.ownerMissing") : ""}
                      onClick={() => setConfirm("notify")}>
                {t("refAudit.notify", { n: notifyOwners })}
              </button>
            </div>
            {error && <p className="px-4 pb-2 text-fine text-error" data-id="ref-audit-error">{error}</p>}
          </div>
        </div>
      )}

      {pickingDept && (
        <DeptTreePicker
          title={t("admin.deptPickTitle")}
          departments={deptOptions}
          onPick={(path) => {
            setTarget({ id: path, label: deptLeaf(path) });
            setPickingDept(false);
          }}
          onClose={() => setPickingDept(false)}
        />
      )}
      {confirm === "apply" && (
        <ConfirmDialog
          title={t(mode === "remove" ? "refAudit.confirmRemoveTitle" : "refAudit.confirmApplyTitle")}
          message={mode === "remove"
            ? t("refAudit.confirmRemoveMsg", { from: group.value, n: selected.length })
            : t("refAudit.confirmApplyMsg", { from: group.value, to: target?.label ?? "", n: selected.length })}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          danger={mode === "remove"}
          onConfirm={() => void apply()}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "notify" && (
        <ConfirmDialog
          title={t("refAudit.confirmNotifyTitle")}
          message={t("refAudit.confirmNotifyMsg", {
            owners: notifyOwners,
            maps: new Set(group.lines.filter((l) => !l.fixable).map((l) => l.map_id)).size,
          })}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => void notify()}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

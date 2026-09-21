"use client";

// 캠페인 ③ L6 연결 — AI 제안 relations를 표로 편집(entry·edges)하고 L5 캔버스 미리보기(ImportMapPreview scope=canvas)로 확인 후 확정.

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import { getApiErrorDetail, getFrameworkInterviewTask, type FwInterviewSession } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ImportMapPreview } from "@/components/admin/import-report/map-preview";

const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const FIELD = "rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink";
const KINDS = ["seq", "branch", "loop", "bypass"] as const;

interface Edge { src: string; dst: string; kind: (typeof KINDS)[number]; gateway?: "exclusive" | "parallel" | null; condition?: string | null; label?: string | null }
interface Relations { entry: { taskId: string; triggerType: "manual" | "timer" | "message" | "condition"; label?: string | null }; edges: Edge[] }

interface RelationsStepProps {
  session: FwInterviewSession;
  busy: boolean;
  onPropose: () => void;
  onConfirm: (relations: Record<string, unknown>) => void;
}

export function RelationsStep({ session, busy, onPropose, onConfirm }: RelationsStepProps) {
  const { t } = useI18n();
  const taskIds = useMemo(() => [...session.tasks].sort((a, b) => a.seq - b.seq).map((x) => x.task_id), [session.tasks]);
  // 부모가 session.relations 내용으로 key를 리마운트하므로(page.tsx) 마운트 시 1회 초기화만 한다 —
  // 폴링이 만드는 새 session 객체가 편집 중인 엣지를 덮어쓰지 않는다.
  const [relations, setRelations] = useState<Relations>(() => (session.relations as unknown as Relations | null) ?? { entry: { taskId: taskIds[0] ?? "", triggerType: "manual", label: "" }, edges: [] });
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 태스크 id+상태만의 서명 — session.tasks 배열은 폴링마다 새 참조라 그대로 deps에 두면 매번 재요청한다.
  const taskSignature = useMemo(() => session.tasks.map((x) => `${x.id}:${x.status}`).join(","), [session.tasks]);

  useEffect(() => {
    let alive = true;
    Promise.all(session.tasks.map((x) => getFrameworkInterviewTask(session.id, x.id)))
      .then((details) => { if (alive) setRows(details.map((d) => ({ taskId: d.task_id, ...(d.row ?? {}) }))); })
      .catch((err) => { if (alive) setError(getApiErrorDetail(err)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taskSignature already captures every id+status change in session.tasks
  }, [session.id, taskSignature]);

  const previewSource = useMemo(() => (rows ? { rows, relations } : null), [rows, relations]);
  function updateEdge(i: number, patch: Partial<Edge>) {
    setRelations((prev) => ({ ...prev, edges: prev.edges.map((e, k) => (k === i ? { ...e, ...patch } : e)) }));
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" data-id="fw-consult-relations">
      <div className="flex items-center gap-2">
        <span className="text-body-strong text-ink">{t("fwConsult.stepRelations")}</span>
        <span className="text-fine text-ink-tertiary">{t("fwConsult.relationsHint")}</span>
        <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-propose-relations" disabled={busy} onClick={onPropose}>
          <Sparkles size={14} strokeWidth={1.5} />{t("fwConsult.proposeRelations")}
        </button>
        <button type="button" className={PRIMARY} data-id="fw-consult-confirm-relations" disabled={busy || !relations.entry.taskId} onClick={() => onConfirm(relations as unknown as Record<string, unknown>)}>
          {t("fwConsult.confirmRelations")}
        </button>
      </div>
      {error && <p className="text-caption text-error" data-id="fw-consult-relations-error">{error}</p>}
      <div className="flex items-center gap-2 text-caption">
        <span className="text-ink-secondary">{t("fwConsult.entry")}</span>
        <select className={FIELD} data-id="fw-consult-entry" value={relations.entry.taskId} onChange={(e) => setRelations((p) => ({ ...p, entry: { ...p.entry, taskId: e.target.value } }))}>
          {taskIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <select className={FIELD} data-id="fw-consult-entry-trigger" value={relations.entry.triggerType} onChange={(e) => setRelations((p) => ({ ...p, entry: { ...p.entry, triggerType: e.target.value as Relations["entry"]["triggerType"] } }))}>
          {["manual", "timer", "message", "condition"].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <table className="w-full text-fine" data-id="fw-consult-edges">
        <thead>
          <tr className="text-ink-tertiary">
            <th className="text-left">{t("fwConsult.edgeSrc")}</th>
            <th className="text-left">{t("fwConsult.edgeDst")}</th>
            <th className="text-left">{t("fwConsult.edgeKind")}</th>
            <th className="text-left">{t("fwConsult.edgeGateway")}</th>
            <th className="text-left">{t("fwConsult.edgeCondition")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {relations.edges.map((e, i) => (
            <tr key={i} data-id={`fw-consult-edge-${i}`}>
              <td><select className={FIELD} data-id={`fw-consult-edge-src-${i}`} value={e.src} onChange={(ev) => updateEdge(i, { src: ev.target.value })}>{taskIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></td>
              <td><select className={FIELD} data-id={`fw-consult-edge-dst-${i}`} value={e.dst} onChange={(ev) => updateEdge(i, { dst: ev.target.value })}>{taskIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></td>
              <td><select className={FIELD} data-id={`fw-consult-edge-kind-${i}`} value={e.kind} onChange={(ev) => updateEdge(i, { kind: ev.target.value as Edge["kind"] })}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></td>
              <td><select className={FIELD} data-id={`fw-consult-edge-gateway-${i}`} value={e.gateway ?? ""} onChange={(ev) => updateEdge(i, { gateway: (ev.target.value || null) as Edge["gateway"] })}><option value="">-</option><option value="exclusive">exclusive</option><option value="parallel">parallel</option></select></td>
              <td><input className={`${FIELD} w-full`} data-id={`fw-consult-edge-condition-${i}`} value={e.condition ?? ""} onChange={(ev) => updateEdge(i, { condition: ev.target.value })} /></td>
              <td><button type="button" className="rounded-sm px-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.removeEdge")} data-id={`fw-consult-edge-remove-${i}`} onClick={() => setRelations((p) => ({ ...p, edges: p.edges.filter((_, k) => k !== i) }))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className={SECONDARY} data-id="fw-consult-edge-add" onClick={() => setRelations((p) => ({ ...p, edges: [...p.edges, { src: taskIds[0] ?? "", dst: taskIds[1] ?? taskIds[0] ?? "", kind: "seq" }] }))}>
        {t("fwConsult.addEdge")}
      </button>
      {previewSource && (
        <div className="min-h-64 flex-1">
          <ImportMapPreview source={previewSource} scope="canvas" dataId="fw-consult-relations-preview" hideClose onClose={() => undefined} />
        </div>
      )}
    </div>
  );
}

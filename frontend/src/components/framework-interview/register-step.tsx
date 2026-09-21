"use client";

// 캠페인 ④ 등록 — 조립된 0.5 문서를 기존 인터뷰 임포트(dry-run→apply)로 넣고 리포트 UI를 재사용. JSON 다운로드·완료 안내.
// TaskPreviewModal: 완료 카드 미리보기(ImportMapPreview scope=map).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Download } from "lucide-react";

import {
  getApiErrorDetail, getFrameworkInterviewDocument, getFrameworkInterviewTask, importInterview, openLinkageMap,
  type FwInterviewSession, type InterviewImportResult,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { buildImportReportView, buildInterviewIndex, governanceKey, parseGovernanceKey } from "@/lib/interview-report";
import { ImportMapPreview } from "@/components/admin/import-report/map-preview";
import { InterviewImportReport, type InterviewPhase } from "@/components/admin/import-report/interview-import-report";
import { ModalBackdrop } from "@/components/modal-backdrop";

const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface RegisterStepProps { session: FwInterviewSession; busy: boolean; onApplied: () => void }

export function RegisterStep({ session, busy, onApplied }: RegisterStepProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<InterviewImportResult | null>(null);
  const [phase, setPhase] = useState<InterviewPhase>(null);
  const [governanceChecked, setGovernanceChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const fileName = `${session.category_code}-ai-consult.json`;
  const files = useMemo(() => (doc ? [{ name: fileName, content: doc }] : []), [doc, fileName]);
  const index = useMemo(() => buildInterviewIndex(files), [files]);
  const view = useMemo(() => (result ? buildImportReportView(result.rows, index, result.files) : null), [result, index]);

  useEffect(() => {
    let alive = true;
    getFrameworkInterviewDocument(session.id).then((d) => { if (alive) setDoc(d); }).catch((err) => { if (alive) setError(getApiErrorDetail(err)); });
    return () => { alive = false; };
  }, [session.id]);

  async function runImport(apply: boolean) {
    if (!doc) return;
    setPhase(apply ? "apply" : "dryrun");
    setError(null);
    try {
      const r = await importInterview({ files, apply, label: session.label, decisions: apply ? [...governanceChecked].map(parseGovernanceKey) : undefined });
      setResult(r);
      if (!apply) setGovernanceChecked(new Set(r.governance.filter((d) => d.default_checked).map(governanceKey)));
      if (apply && r.applied) onApplied();
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setPhase(null);
    }
  }

  function download() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }

  async function openCanvas() {
    setOpening(true);
    setError(null);
    try {
      const { map_id } = await openLinkageMap(session.category_id);
      router.push(`/maps/${map_id}`);
    } catch (err) {
      setError(getApiErrorDetail(err));
      setOpening(false);
    }
  }

  if (session.status === "applied") {
    return (
      <div className="flex flex-col gap-3 p-4" data-id="fw-consult-done">
        <p className="text-caption text-ink">{t("fwConsult.done")}</p>
        {error && <p className="text-caption text-error" data-id="fw-consult-done-error">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className={SECONDARY} data-id="fw-consult-open-canvas" disabled={opening} onClick={() => void openCanvas()}>{t("fwConsult.openCanvas")}</button>
          <button type="button" className={SECONDARY} data-id="fw-consult-download" onClick={download} disabled={!doc}><Download size={14} strokeWidth={1.5} />{t("fwConsult.download")}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4" data-id="fw-consult-register">
      <div className="flex items-center gap-2">
        <span className="text-body-strong text-ink">{t("fwConsult.stepRegister")}</span>
        <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-download" onClick={download} disabled={!doc}><Download size={14} strokeWidth={1.5} />{t("fwConsult.download")}</button>
        <button type="button" className={SECONDARY} data-id="fw-consult-dryrun" disabled={busy || !doc || phase !== null} onClick={() => void runImport(false)}>{t("fwConsult.dryRun")}</button>
      </div>
      {error && <p className="text-caption text-error" data-id="fw-consult-register-error">{error}</p>}
      {result && view && (
        <InterviewImportReport
          result={result} view={view} index={index} files={files}
          governanceChecked={governanceChecked}
          onToggleGovernance={(key) => setGovernanceChecked((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
          onToggleAllGovernance={(next) => setGovernanceChecked(next ? new Set(result.governance.map(governanceKey)) : new Set())}
          phase={phase}
          onCancel={() => { setResult(null); setGovernanceChecked(new Set()); }}
          onApply={() => void runImport(true)}
          onToast={(m) => setError(m)}
        />
      )}
    </div>
  );
}

RegisterStep.TaskPreviewModal = function TaskPreviewModal({ sessionId, taskPk, onClose }: { sessionId: number; taskPk: number; onClose: () => void }) {
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let alive = true;
    getFrameworkInterviewTask(sessionId, taskPk).then((d) => { if (alive) setSource({ taskId: d.task_id, ...(d.row ?? {}) }); }).catch(() => undefined);
    return () => { alive = false; };
  }, [sessionId, taskPk]);
  return createPortal(
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4">
      <div className="h-[70vh] w-[80vw] rounded-md bg-surface p-3" data-id="fw-consult-task-preview" onClick={(e) => e.stopPropagation()}>
        {source && <ImportMapPreview source={source} scope="map" dataId="fw-consult-task-preview-canvas" onClose={onClose} />}
      </div>
    </ModalBackdrop>,
    document.body,
  );
};

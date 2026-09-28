"use client";

// 캠페인 ④ 등록 — 조립된 0.5 문서를 기존 인터뷰 임포트(dry-run→apply)로 넣고 리포트 UI를 재사용. JSON 다운로드·완료 안내.
// 등록이 끝나면 리포트를 남긴 채 반투명 레이어 + 가운데 완료 카드(아이콘·문구·버튼)를 띄운다 — 화면이 갑자기 비지 않게(사용자 요청 2026-09-28).
// 리포트가 없는 채로 들어오면(새로고침 뒤) 완료 카드만 가운데 놓는다.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleCheck, Download, ExternalLink, Loader2 } from "lucide-react";

import {
  getApiErrorDetail, getFrameworkInterviewDocument, importInterview, openLinkageMap,
  type FwInterviewSession, type InterviewImportResult,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { buildImportReportView, buildInterviewIndex, governanceKey, parseGovernanceKey } from "@/lib/interview-report";
import { InterviewImportReport, type InterviewPhase } from "@/components/admin/import-report/interview-import-report";

const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const PRIMARY = "inline-flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";

interface RegisterStepProps {
  session: FwInterviewSession;
  busy: boolean;
  onApplied: () => void;
  onBack: () => void;  // 연결 단계로 되돌아가기(관계 편집 유지)
}

export function RegisterStep({ session, busy, onApplied, onBack }: RegisterStepProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<InterviewImportResult | null>(null);
  // 등록 단계 진입 즉시 dry run이 도는 상태로 시작한다(이펙트 안 동기 setState 회피)
  const [phase, setPhase] = useState<InterviewPhase>(() => (session.status === "applied" ? null : "dryrun"));
  const [governanceChecked, setGovernanceChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const fileName = `${session.category_code}-ai-consult.json`;
  const files = useMemo(() => (doc ? [{ name: fileName, content: doc }] : []), [doc, fileName]);
  const index = useMemo(() => buildInterviewIndex(files), [files]);
  const view = useMemo(() => (result ? buildImportReportView(result.rows, index, result.files) : null), [result, index]);

  // 문서를 받자마자 dry run을 자동으로 돌린다 — 등록 단계에 들어오면 리포트가 바로 보이게(사용자 요청 2026-09-21).
  // 문서 fetch → dry run 체인을 한 이펙트에 두어 setState는 전부 비동기 콜백 안에서만 일어난다.
  useEffect(() => {
    if (session.status === "applied") return;
    let alive = true;
    getFrameworkInterviewDocument(session.id)
      .then(async (d) => {
        if (!alive) return;
        setDoc(d);
        const name = `${session.category_code}-ai-consult.json`;
        const r = await importInterview({ files: [{ name, content: d }], apply: false, label: session.label });
        if (!alive) return;
        setResult(r);
        setGovernanceChecked(new Set(r.governance.filter((g) => g.default_checked).map(governanceKey)));
      })
      .catch((err) => { if (alive) setError(getApiErrorDetail(err)); })
      .finally(() => { if (alive) setPhase(null); });
    return () => { alive = false; };
  }, [session.id, session.status, session.category_code, session.label]);

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

  const applied = session.status === "applied";
  const doneCard = (
    <div className="fw-fade-in flex w-[min(28rem,90%)] flex-col items-center gap-3 rounded-md border border-hairline bg-surface p-6 text-center shadow-lg" data-id="fw-consult-done">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-tint text-accent">
        <CircleCheck size={24} strokeWidth={1.5} />
      </span>
      <span className="text-body-strong text-ink">{t("fwConsult.doneTitle")}</span>
      <p className="text-caption text-ink-secondary">{t("fwConsult.done")}</p>
      {error && <p className="text-caption text-error" data-id="fw-consult-done-error">{error}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={PRIMARY} data-id="fw-consult-open-canvas" disabled={opening} onClick={() => void openCanvas()}>
          {opening ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> : <ExternalLink size={14} strokeWidth={1.5} />}
          {t("fwConsult.openCanvas")}
        </button>
        <button type="button" className={SECONDARY} data-id="fw-consult-download" onClick={download} disabled={!doc}><Download size={14} strokeWidth={1.5} />{t("fwConsult.download")}</button>
      </div>
    </div>
  );
  if (applied && !(result && view)) {
    return (
      <div className="flex min-h-[60vh] flex-1 items-center justify-center p-4" data-id="fw-consult-done-host">
        {doneCard}
      </div>
    );
  }
  return (
    <div className="relative flex flex-col gap-3 p-4" data-id="fw-consult-register">
      {applied && (
        // 리포트 위 반투명 흰 레이어(리포트의 sticky 툴바 z-3보다 위) — 방금 확인한 드라이런 결과가 뒤에 남아 있어 완료가 "그 결과가 들어갔다"로 읽힌다
        <div className="absolute inset-0 z-[10] flex items-start justify-center bg-surface/75 pt-16 backdrop-blur-[1px]" data-id="fw-consult-done-overlay">
          {doneCard}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={SECONDARY} data-id="fw-consult-back-relations" disabled={busy || phase === "apply" || applied} onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.5} />{t("fwConsult.backToRelations")}
        </button>
        <span className="text-body-strong text-ink">{t("fwConsult.stepRegister")}</span>
        {phase === "dryrun" && (
          <span className="inline-flex items-center gap-1 text-fine text-ink-tertiary" data-id="fw-consult-dryrun-running">
            <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-accent" />{t("fwConsult.dryRunRunning")}
          </span>
        )}
        {!applied && <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-download" onClick={download} disabled={!doc}><Download size={14} strokeWidth={1.5} />{t("fwConsult.download")}</button>}
        {!applied && <button type="button" className={SECONDARY} data-id="fw-consult-dryrun" disabled={busy || !doc || phase !== null} onClick={() => void runImport(false)}>{t("fwConsult.dryRun")}</button>}
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

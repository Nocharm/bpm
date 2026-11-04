"use client";

// 새 실행 창 — 이름·기준 버전(게시본·지난 게시본)·나만/공유 작은 탭·공유 참여자를 받아 실행을 만든다(design run-check §4.1).
// 지난 게시본을 고르면 만들기 전에 "현재 게시본이 아니에요" 한 단계를 거치고, 열린 실행 상한(409)에 막히면 창 안에
// 내가 정리할 수 있는 실행(개인=여러 맵의 내 개인 실행, 공유=이 맵에서 내가 시작한 공유 실행)을 중단 버튼과 함께 보인다.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";

import {
  createRun,
  getMeDashboard,
  listRuns,
  stopRun,
  type RunDetail,
  type RunList,
  type VersionDetail,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/me";
import { getRunCapKind, humanizeRunError } from "@/lib/run-view";
import { formatVersionMarker } from "@/lib/version-name";
import { MenuSelect } from "@/components/menu-select";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { UserPill } from "@/components/user-pill";
import { RunParticipantPicker } from "@/components/run/run-participant-picker";
import { RunScopeTabs } from "@/components/run/run-scope-tabs";

// 이름 길이 상한 — BE RunCreateIn.name max_length와 같다
const RUN_NAME_MAX = 200;

interface RunStartDialogProps {
  mapId: number;
  versions: VersionDetail[];
  // 지금 화면의 버전 — 게시본·지난 게시본이면 기본 선택
  currentVersionId: number;
  onClose: () => void;
  onCreated: (detail: RunDetail) => void;
}

// 상한에 막혔을 때 정리할 수 있는 실행 한 줄
interface CapRow {
  runId: number;
  name: string;
  mapName: string;
}

interface CapState {
  kind: "solo" | "shared";
  // 읽는 중이면 null
  rows: CapRow[] | null;
}

export function RunStartDialog({ mapId, versions, currentVersionId, onClose, onCreated }: RunStartDialogProps) {
  const { t } = useI18n();
  const me = useMe()?.username ?? null;
  const runnable = versions.filter((version) => version.status === "published" || version.status === "expired");
  const published = runnable.find((version) => version.status === "published") ?? null;
  const [name, setName] = useState("");
  const [versionId, setVersionId] = useState<number | null>(
    () => runnable.find((version) => version.id === currentVersionId)?.id ?? published?.id ?? runnable[0]?.id ?? null,
  );
  const [scope, setScope] = useState<"solo" | "shared">("solo");
  const [participants, setParticipants] = useState<string[]>([]);
  // 지난 게시본 안내 단계 — "실행 시작"을 누르면 한 번 거친다
  const [isAskingOld, setIsAskingOld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cap, setCap] = useState<CapState | null>(null);
  // 상한 목록에서 하나라도 중단했으면 다시 시작해 보라고 안내한다
  const [hasFreed, setHasFreed] = useState(false);
  // 중단 요청 중인 실행 — 그동안 중단 버튼을 모두 꺼 두 번 누름이 두 번 보내지 않게
  const [stoppingId, setStoppingId] = useState<number | null>(null);
  const stoppingRef = useRef(false);

  const selected = runnable.find((version) => version.id === versionId) ?? null;
  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && selected !== null && !busy;
  const markerOf = (version: VersionDetail) => formatVersionMarker(version, versions);

  const loadCapRows = async (kind: "solo" | "shared"): Promise<CapRow[]> => {
    if (kind === "solo") {
      // 개인 상한은 사람당(맵 합산) — 맵을 가로지르는 목록은 홈 대시보드 응답이 갖고 있다
      const dashboard = await getMeDashboard();
      return dashboard.runs
        .filter((run) => run.scope === "solo")
        .map((run) => ({ runId: run.run_id, name: run.name, mapName: run.map_name }));
    }
    // 공유 상한은 맵당 — 이 맵에서 내가 시작한 공유 실행만 내가 중단할 수 있다(BE can_manage = 시작한 사람)
    const rows: CapRow[] = [];
    let page = 1;
    let list: RunList;
    do {
      list = await listRuns(mapId, { tab: "open", mine: true, page });
      for (const run of list.items) {
        if (run.scope === "shared" && run.starter === me) rows.push({ runId: run.id, name: run.name, mapName: run.map_name });
      }
      page += 1;
    } while ((page - 1) * list.page_size < list.total);
    return rows;
  };

  const showCap = async (kind: "solo" | "shared") => {
    setCap({ kind, rows: null });
    try {
      const rows = await loadCapRows(kind);
      setCap({ kind, rows });
    } catch (err) {
      setCap(null);
      setError(humanizeRunError(err, t));
    }
  };

  const create = async (targetVersionId: number) => {
    setBusy(true);
    setError(null);
    setIsAskingOld(false);
    try {
      const detail = await createRun(mapId, {
        name: trimmedName,
        version_id: targetVersionId,
        scope,
        participants: scope === "shared" ? participants : [],
      });
      onCreated(detail);
    } catch (err) {
      const capKind = getRunCapKind(err);
      setError(humanizeRunError(err, t));
      if (capKind !== null) await showCap(capKind);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = () => {
    if (!canSubmit || selected === null) return;
    if (selected.status === "expired") {
      setIsAskingOld(true);
      return;
    }
    void create(selected.id);
  };

  const handleStop = async (runId: number) => {
    // 렌더를 기다리지 않는 가드 — 같은 틱의 두 번째 누름도 막는다
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStoppingId(runId);
    try {
      await stopRun(runId);
      setCap((prev) => (prev?.rows ? { ...prev, rows: prev.rows.filter((row) => row.runId !== runId) } : prev));
      setError(null);
      setHasFreed(true);
    } catch (err) {
      setError(humanizeRunError(err, t));
    } finally {
      stoppingRef.current = false;
      setStoppingId(null);
    }
  };

  const excludeIds = new Set([...participants, ...(me ? [me] : [])]);

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div data-id="run-start-dialog" className="flex w-full max-w-md flex-col gap-4 rounded-md border p-6 glass glass-dense">
        {isAskingOld && selected !== null ? (
          <div data-id="run-start-old" className="flex flex-col gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-notice-border bg-notice text-changed">
              <AlertTriangle size={18} strokeWidth={1.5} />
            </span>
            <h2 className="text-body-strong text-ink">{t("run.start.oldTitle")}</h2>
            <p className="text-caption text-ink-secondary">
              {published
                ? t("run.start.oldBody", { old: markerOf(selected), current: markerOf(published) })
                : t("run.start.oldBodyNoCurrent", { old: markerOf(selected) })}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                data-id="run-start-old-continue"
                className="rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                onClick={() => void create(selected.id)}
              >
                {t("run.start.oldContinue", { old: markerOf(selected) })}
              </button>
              {published && (
                <button
                  type="button"
                  data-id="run-start-old-current"
                  className="rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus"
                  onClick={() => {
                    setVersionId(published.id);
                    void create(published.id);
                  }}
                >
                  {t("run.start.oldUseCurrent", { current: markerOf(published) })}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-body-strong text-ink">{t("run.start.title")}</h2>
              <RunScopeTabs
                dataIdPrefix="run-start-scope"
                isShared={scope === "shared"}
                sharedLabel={t("run.scope.shared")}
                onSolo={() => setScope("solo")}
                onShared={() => setScope("shared")}
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-fine text-ink-tertiary">{t("run.start.name")}</span>
              <input
                autoFocus
                data-id="run-start-name"
                className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
                value={name}
                maxLength={RUN_NAME_MAX}
                placeholder={t("run.start.namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) handleSubmit();
                }}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-fine text-ink-tertiary">{t("run.start.version")}</span>
              <MenuSelect
                dataId="run-start-version"
                className="w-full py-1.5 text-caption"
                value={versionId === null ? "" : String(versionId)}
                items={runnable.map((version) => ({
                  value: String(version.id),
                  label: `${markerOf(version)} · ${version.label}`,
                  hint: version.status === "published" ? t("run.start.versionCurrent") : t("run.start.versionPast"),
                }))}
                onChange={(value) => setVersionId(Number(value))}
              />
            </div>
            {scope === "shared" ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-fine text-ink-tertiary">{t("run.start.participants")}</span>
                {participants.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {participants.map((loginId) => (
                      <span
                        key={loginId}
                        data-id={`run-start-participant-${loginId}`}
                        className="inline-flex items-center gap-0.5 rounded-sm border border-hairline bg-surface pr-0.5"
                      >
                        <UserPill loginId={loginId} />
                        <button
                          type="button"
                          data-id={`run-start-participant-remove-${loginId}`}
                          aria-label={t("run.start.removeParticipant")}
                          title={t("run.start.removeParticipant")}
                          className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-error"
                          onClick={() => setParticipants((prev) => prev.filter((id) => id !== loginId))}
                        >
                          <X size={12} strokeWidth={1.5} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <RunParticipantPicker
                  mapId={mapId}
                  excludeIds={excludeIds}
                  onPick={(loginId) => setParticipants((prev) => (prev.includes(loginId) ? prev : [...prev, loginId]))}
                />
                <p className="text-fine text-ink-tertiary">{t("run.start.participantsHint")}</p>
              </div>
            ) : (
              <p className="text-fine text-ink-tertiary">{t("run.start.soloHint")}</p>
            )}
            {error !== null && (
              <p data-id="run-start-error" className="text-caption text-error">
                {error}
              </p>
            )}
            {cap !== null && (
              <div data-id="run-start-cap" className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-alt p-2">
                <p className="text-fine font-semibold text-ink-secondary">{t("run.start.capHeading")}</p>
                {hasFreed && <p className="text-fine text-added">{t("run.start.capFreed")}</p>}
                {cap.rows === null ? (
                  <p className="text-fine text-ink-tertiary">{t("common.loading")}</p>
                ) : cap.rows.length === 0 ? (
                  <p className="text-fine text-ink-tertiary">
                    {cap.kind === "solo" ? t("run.start.capEmptySolo") : t("run.start.capEmptyShared")}
                  </p>
                ) : (
                  <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                    {cap.rows.map((row) => (
                      <li
                        key={row.runId}
                        data-id={`run-start-cap-row-${row.runId}`}
                        className="flex items-center gap-2 rounded-xs bg-surface px-2 py-1"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-caption text-ink">{row.name}</span>
                          <span className="truncate text-fine text-ink-tertiary">{row.mapName}</span>
                        </span>
                        <button
                          type="button"
                          data-id={`run-start-cap-stop-${row.runId}`}
                          disabled={stoppingId !== null}
                          className="shrink-0 rounded-sm border border-error/40 px-2 py-0.5 text-fine text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => void handleStop(row.runId)}
                        >
                          {t("run.start.capStop")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-id="run-start-cancel"
                className="rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                onClick={onClose}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="run-start-submit"
                disabled={!canSubmit}
                className="rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleSubmit}
              >
                {t("run.start.submit")}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}

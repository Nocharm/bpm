"use client";

// 실행 바 — 실행 모드 맵 화면의 캔버스 위 띠(정적 크롬). 실행 이름·참여자·진행·영구 보존·나만/공유 작은 탭·실행 메뉴(⋯)·닫기,
// 위에 "현재 게시본이 아니에요" 안내 줄, 아래에 "중단된 실행이에요" 줄(design run-check §4.3·§4.4).
// 실행 상세가 오기 전엔 불러오는 중, 처음 읽기가 실패하면 오류 줄과 "실행 닫기"만 보인다(R24).
// 변경은 서버 응답의 전체 상세로 세션을 바꾸고(session.update), 409·403이면 최신 상세로 다시 읽은 뒤 알린다.

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Bookmark, Check, Loader2, MoreHorizontal, Square, UserPlus, X } from "lucide-react";

import {
  ApiError,
  deleteRun,
  patchRun,
  reopenRun,
  shareRun,
  stopRun,
  updateRunParticipants,
  type RunDetail,
} from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useDirectoryState } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/me";
import { humanizeRunError } from "@/lib/run-view";
import type { RunSession } from "@/lib/use-run-session";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { Tooltip } from "@/components/tooltip";
import { UserPill } from "@/components/user-pill";
import { RunParticipantPicker } from "@/components/run/run-participant-picker";
import { RunScopeTabs } from "@/components/run/run-scope-tabs";

// 겹쳐 보일 참여자 필 수 — 나머지는 "+n"
const VISIBLE_PARTICIPANTS = 3;

type ToastFn = (msg: string, tone?: "error") => void;

interface RunBarProps {
  // 실행 상세가 오기 전·실패했을 때 null
  session: RunSession | null;
  loadError: string | null;
  onToast: ToastFn;
  // `?run=` 없이 같은 버전으로 — 실행 모드를 나온다
  onClose: () => void;
  // 현재 게시본 열기 — 맵에 게시본이 없으면 null(링크를 숨긴다)
  onOpenCurrentVersion: (() => void) | null;
}

export function RunBar({ session, loadError, onToast, onClose, onOpenCurrentVersion }: RunBarProps) {
  const { t } = useI18n();
  if (session === null) {
    return (
      <div
        data-id="run-bar"
        data-state={loadError !== null ? "error" : "loading"}
        className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-1.5 text-caption"
      >
        {loadError !== null ? (
          <>
            <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0 text-error" />
            <span className="shrink-0 font-semibold text-error">{t("run.bar.loadFailed")}</span>
            <span data-id="run-bar-error" className="min-w-0 truncate text-ink-secondary">
              {loadError}
            </span>
          </>
        ) : (
          <>
            <Loader2 size={14} strokeWidth={1.5} className="shrink-0 animate-spin text-ink-tertiary" />
            <span className="text-ink-tertiary">{t("run.bar.loading")}</span>
          </>
        )}
        {/* 읽는 중에도 나갈 수 있게 — 느린 응답을 기다리지 않고 맵 화면으로 */}
        <button
          type="button"
          data-id="run-bar-close"
          className="ml-auto shrink-0 rounded-sm border border-hairline bg-surface px-2 py-0.5 text-fine text-ink hover:bg-surface-alt"
          onClick={onClose}
        >
          {t("run.bar.close")}
        </button>
      </div>
    );
  }
  return (
    <RunBarBody session={session} onToast={onToast} onClose={onClose} onOpenCurrentVersion={onOpenCurrentVersion} />
  );
}

/**
 * 떠 있는 팝오버 닫기 — 바깥 누름·Esc. 안쪽 누름은 React 이벤트로 표시한다: 포털로 뜬 피커 목록도 React 트리를 따라
 * 팝오버 뿌리까지 버블하므로 DOM contains로는 놓치는 클릭을 잡는다. 창(window) 버블 리스너는 React 처리 뒤에 판단한다.
 * 돌려준 함수를 팝오버(와 트리거) 뿌리의 onPointerDown에 단다. 트리거를 눌러 열 때 남은 표시는 열면서 지운다 — 남겨 두면
 * 열린 뒤 첫 바깥 누름을 안쪽으로 오인해 두 번 눌러야 닫혔다.
 */
function usePopoverDismiss(isOpen: boolean, close: () => void): () => void {
  const insideRef = useRef(false);
  const handleClose = useEffectEvent(close);
  useEffect(() => {
    if (!isOpen) return;
    insideRef.current = false;
    const handleDown = () => {
      if (!insideRef.current) handleClose();
      insideRef.current = false;
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("pointerdown", handleDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);
  return () => {
    insideRef.current = true;
  };
}

interface RunBarBodyProps {
  session: RunSession;
  onToast: ToastFn;
  onClose: () => void;
  onOpenCurrentVersion: (() => void) | null;
}

interface RunMenuItem {
  key: string;
  label: string;
  hint: string;
  isDanger: boolean;
  onSelect: () => void;
}

function RunBarBody({ session, onToast, onClose, onOpenCurrentVersion }: RunBarBodyProps) {
  const { t } = useI18n();
  const me = useMe()?.username ?? null;
  const { users } = useDirectoryState();
  const { detail } = session;
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirm, setConfirm] = useState<"stop" | "delete" | null>(null);
  const markMenuInside = usePopoverDismiss(menuOpen, () => setMenuOpen(false));
  const markPeopleInside = usePopoverDismiss(peopleOpen, () => setPeopleOpen(false));

  const isOpen = detail.status === "open";
  const isShared = detail.scope === "shared";
  const myParticipant = me === null ? null : (detail.participants.find((p) => p.login_id === me) ?? null);
  // 시작한 사람을 맨 앞에 — 겹친 필의 첫 자리
  const participantIds = [
    ...detail.participants.filter((p) => p.login_id === detail.starter),
    ...detail.participants.filter((p) => p.login_id !== detail.starter),
  ].map((p) => p.login_id);
  const canEditPeople = isShared && detail.can_manage && detail.status !== "summarized";
  const { done, total } = detail.progress;
  const versionMarker = detail.version_number !== null ? `v${detail.version_number}` : detail.version_label;

  // 서버 변경 하나 — 응답 상세로 세션을 바꾸고, 먼저 바뀜·권한(409·403)이면 최신으로 다시 읽는다
  const runChange = async (request: () => Promise<RunDetail>, okMessage: string | null): Promise<boolean> => {
    setBusy(true);
    try {
      session.update(await request());
      if (okMessage !== null) onToast(okMessage);
      return true;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 403)) void session.reload();
      onToast(humanizeRunError(err, t), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteRun(detail.id);
      onToast(t("run.bar.deleted"));
      onClose();
    } catch (err) {
      onToast(humanizeRunError(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const reopen = () => void runChange(() => reopenRun(detail.id), t("run.bar.reopened"));

  const menuItems: RunMenuItem[] = [];
  if (myParticipant !== null) {
    menuItems.push({
      key: "mute",
      label: myParticipant.muted ? t("run.bar.unmute") : t("run.bar.mute"),
      hint: myParticipant.muted ? t("run.bar.unmuteHint") : t("run.bar.muteHint"),
      isDanger: false,
      onSelect: () =>
        void runChange(
          () => patchRun(detail.id, { muted: !myParticipant.muted }),
          myParticipant.muted ? t("run.bar.unmuted") : t("run.bar.muted"),
        ),
    });
  }
  if (detail.can_manage && isOpen) {
    menuItems.push({
      key: "stop",
      label: t("run.bar.stop"),
      hint: t("run.bar.starterOnlyHint"),
      isDanger: true,
      onSelect: () => setConfirm("stop"),
    });
  }
  if (detail.can_manage && (detail.status === "done" || detail.status === "stopped")) {
    menuItems.push({
      key: "reopen-menu",
      label: t("run.bar.reopen"),
      hint: t("run.bar.starterOnlyHint"),
      isDanger: false,
      onSelect: reopen,
    });
  }
  if (detail.can_manage) {
    menuItems.push({
      key: "delete",
      label: t("run.bar.delete"),
      hint: t("run.bar.starterOnlyHint"),
      isDanger: true,
      onSelect: () => setConfirm("delete"),
    });
  }

  const statusDot =
    detail.status === "open" ? "bg-accent" : detail.status === "done" ? "bg-run-done" : "bg-ink-tertiary";
  const visibleIds = participantIds.slice(0, VISIBLE_PARTICIPANTS);
  const restIds = participantIds.slice(VISIBLE_PARTICIPANTS);

  return (
    <>
      {!detail.version_is_current && (
        <div
          data-id="run-bar-old-version"
          className="flex items-center gap-2 border-b border-notice-border bg-notice px-4 py-1.5 text-caption text-changed"
        >
          <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="shrink-0 font-semibold">{t("run.bar.oldTitle")}</span>
          <span className="min-w-0 truncate">{t("run.bar.oldDesc", { version: versionMarker })}</span>
          {onOpenCurrentVersion !== null && (
            <button
              type="button"
              data-id="run-bar-open-current"
              className="shrink-0 font-semibold underline underline-offset-2 hover:opacity-80"
              onClick={onOpenCurrentVersion}
            >
              {t("run.bar.openCurrent")}
            </button>
          )}
        </div>
      )}
      <div
        data-id="run-bar"
        data-state="ready"
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-hairline bg-surface px-4 py-1.5"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot}`} />
          <span data-id="run-bar-name" className="max-w-80 truncate text-caption-strong text-ink" title={detail.name}>
            {detail.name}
          </span>
        </span>
        {isShared && (
          <div className="relative flex items-center" onPointerDown={markPeopleInside}>
            <span data-id="run-bar-participants" className="flex items-center">
              {visibleIds.map((loginId, index) => (
                <span key={loginId} className={`rounded-sm ring-2 ring-surface ${index > 0 ? "-ml-1" : ""}`}>
                  <UserPill loginId={loginId} />
                </span>
              ))}
              {restIds.length > 0 && (
                <Tooltip content={restIds.map((id) => users.get(id)?.name ?? id).join(", ")}>
                  <span className="-ml-1 rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary ring-2 ring-surface">
                    +{restIds.length}
                  </span>
                </Tooltip>
              )}
            </span>
            {canEditPeople && (
              <Tooltip label={t("run.bar.participantsEdit")}>
                <button
                  type="button"
                  data-id="run-bar-participants-edit"
                  aria-label={t("run.bar.participantsEdit")}
                  aria-expanded={peopleOpen}
                  className="ml-1 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                  onClick={() => setPeopleOpen((value) => !value)}
                >
                  <UserPlus size={14} strokeWidth={1.5} />
                </button>
              </Tooltip>
            )}
            {peopleOpen && (
              <div
                data-id="run-bar-participants-pop"
                className="absolute left-0 top-full z-[1100] mt-1 flex w-72 flex-col gap-2 rounded-md border p-2 glass glass-dense"
              >
                <p className="text-fine font-semibold text-ink-tertiary">{t("run.bar.participants")}</p>
                <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                  {participantIds.map((loginId) => (
                    <li
                      key={loginId}
                      data-id={`run-bar-participant-${loginId}`}
                      className="flex items-center gap-2 rounded-xs px-1 py-0.5"
                    >
                      <UserPill loginId={loginId} />
                      {loginId === detail.starter ? (
                        <span className="ml-auto text-fine text-ink-tertiary">{t("run.bar.starter")}</span>
                      ) : (
                        <button
                          type="button"
                          data-id={`run-bar-participant-remove-${loginId}`}
                          aria-label={t("run.bar.removeParticipant")}
                          title={t("run.bar.removeParticipant")}
                          disabled={busy}
                          className="ml-auto rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-error disabled:opacity-40"
                          onClick={() =>
                            void runChange(() => updateRunParticipants(detail.id, { add: [], remove: [loginId] }), null)
                          }
                        >
                          <X size={12} strokeWidth={1.5} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <RunParticipantPicker
                  mapId={detail.map_id}
                  excludeIds={new Set(participantIds)}
                  onPick={(loginId) =>
                    void runChange(() => updateRunParticipants(detail.id, { add: [loginId], remove: [] }), null)
                  }
                />
              </div>
            )}
          </div>
        )}
        <div data-id="run-bar-progress" className="flex items-center gap-2">
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-hairline">
            <span
              className="block h-full rounded-full bg-run-done transition-[width] duration-350 ease-smooth"
              style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
            />
          </span>
          <span className="text-fine tabular-nums text-ink-secondary">{t("run.bar.progress", { done, total })}</span>
        </div>
        {detail.can_keep ? (
          <button
            type="button"
            data-id="run-bar-keep"
            aria-pressed={detail.keep}
            disabled={busy}
            className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-fine disabled:opacity-60 ${
              detail.keep
                ? "border-accent-tint-border bg-accent-tint font-semibold text-accent"
                : "border-hairline bg-surface text-ink-secondary hover:bg-surface-alt"
            }`}
            onClick={() =>
              void runChange(
                () => patchRun(detail.id, { keep: !detail.keep }),
                detail.keep ? t("run.bar.keepOff") : t("run.bar.keepOn"),
              )
            }
          >
            <Bookmark size={14} strokeWidth={1.5} fill={detail.keep ? "currentColor" : "none"} />
            {detail.keep ? t("run.bar.kept") : t("run.bar.keep")}
          </button>
        ) : (
          detail.keep && (
            <span data-id="run-bar-keep" className="inline-flex items-center gap-1 text-fine font-semibold text-accent">
              <Bookmark size={14} strokeWidth={1.5} fill="currentColor" />
              {t("run.bar.kept")}
            </span>
          )
        )}
        {detail.status === "done" && (
          <span
            data-id="run-bar-done"
            className="inline-flex items-center gap-1 rounded-full border border-added/40 bg-added/10 px-2 py-0.5 text-fine text-added"
          >
            <Check size={12} strokeWidth={1.5} />
            {t("run.bar.done")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <RunScopeTabs
            dataIdPrefix="run-bar-scope"
            isShared={isShared}
            sharedLabel={isShared ? t("run.scope.sharedCount", { n: participantIds.length }) : t("run.scope.shared")}
            onSolo={() => undefined}
            onShared={() => setShareOpen(true)}
            soloDisabledReason={isShared ? t("run.bar.soloLocked") : undefined}
            sharedDisabledReason={!isShared && !(detail.can_manage && isOpen) ? t("run.bar.shareUnavailable") : undefined}
          />
          {menuItems.length > 0 && (
            <div className="relative" onPointerDown={markMenuInside}>
              <Tooltip label={t("run.bar.more")}>
                <button
                  type="button"
                  data-id="run-bar-more"
                  aria-label={t("run.bar.more")}
                  aria-expanded={menuOpen}
                  className={`rounded-sm p-1 text-ink-secondary hover:bg-surface-alt ${menuOpen ? "bg-surface-alt text-ink" : ""}`}
                  onClick={() => setMenuOpen((value) => !value)}
                >
                  <MoreHorizontal size={16} strokeWidth={1.5} />
                </button>
              </Tooltip>
              {menuOpen && (
                <div
                  data-id="run-bar-menu"
                  className="absolute right-0 top-full z-[1100] mt-1 w-64 rounded-md border p-1 glass glass-dense"
                >
                  {menuItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      data-id={`run-bar-${item.key}`}
                      disabled={busy}
                      className={`flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-caption disabled:opacity-40 ${
                        item.isDanger ? "text-error hover:bg-error/10" : "text-ink hover:bg-surface-alt"
                      }`}
                      onClick={() => {
                        setMenuOpen(false);
                        item.onSelect();
                      }}
                    >
                      {item.label}
                      <span className="text-fine text-ink-tertiary">{item.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Tooltip label={t("run.bar.close")}>
            <button
              type="button"
              data-id="run-bar-close"
              aria-label={t("run.bar.close")}
              className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt"
              onClick={onClose}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </div>
      </div>
      {detail.status === "stopped" && (
        <div
          data-id="run-bar-stopped"
          className="flex items-center gap-2 border-b border-hairline bg-surface-alt px-4 py-1.5 text-caption text-ink-secondary"
        >
          <Square size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="shrink-0 font-semibold text-ink">{t("run.bar.stoppedTitle")}</span>
          <span className="min-w-0 truncate">{t("run.bar.stoppedDesc", { at: formatKstShort(detail.ended_at) })}</span>
          {detail.can_manage && (
            <button
              type="button"
              data-id="run-bar-reopen"
              disabled={busy}
              className="shrink-0 rounded-sm border border-hairline bg-surface px-2 py-0.5 text-fine text-ink hover:bg-surface-alt disabled:opacity-40"
              onClick={reopen}
            >
              {t("run.bar.reopen")}
            </button>
          )}
        </div>
      )}
      {shareOpen && (
        <RunShareDialog
          mapId={detail.map_id}
          starter={detail.starter}
          onClose={() => setShareOpen(false)}
          onShare={async (picked) => {
            const hasShared = await runChange(() => shareRun(detail.id, picked), t("run.bar.sharedToast"));
            if (hasShared) setShareOpen(false);
          }}
        />
      )}
      {confirm === "stop" && (
        <ConfirmDialog
          dialogId="run-bar-stop-confirm"
          title={t("run.bar.stopConfirmTitle")}
          message={`${t("run.bar.stopConfirmBody")} ${detail.keep ? t("run.bar.stopConfirmKept") : t("run.bar.stopConfirmSummary")}`}
          confirmLabel={t("run.bar.stopConfirm")}
          cancelLabel={t("common.cancel")}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void runChange(() => stopRun(detail.id), t("run.bar.stoppedToast"));
          }}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          dialogId="run-bar-delete-confirm"
          title={t("run.bar.deleteConfirmTitle")}
          message={t("run.bar.deleteConfirmBody")}
          confirmLabel={t("run.bar.delete")}
          cancelLabel={t("common.cancel")}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void handleDelete();
          }}
        />
      )}
    </>
  );
}

interface RunShareDialogProps {
  mapId: number;
  starter: string;
  onClose: () => void;
  onShare: (participants: string[]) => Promise<void>;
}

// 나만 → 공유 전환 작은 창 — 함께할 사람을 하나 이상 골라야 공유한다(BE RunShareIn min_length=1)
function RunShareDialog({ mapId, starter, onClose, onShare }: RunShareDialogProps) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const handleShare = async () => {
    setBusy(true);
    try {
      await onShare(picked);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div data-id="run-share-dialog" className="flex w-full max-w-sm flex-col gap-3 rounded-md border p-6 glass glass-dense">
        <h2 className="text-body-strong text-ink">{t("run.bar.shareTitle")}</h2>
        <p className="text-caption text-ink-secondary">{t("run.bar.shareBody")}</p>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {picked.map((loginId) => (
              <span
                key={loginId}
                data-id={`run-share-participant-${loginId}`}
                className="inline-flex items-center gap-0.5 rounded-sm border border-hairline bg-surface pr-0.5"
              >
                <UserPill loginId={loginId} />
                <button
                  type="button"
                  data-id={`run-share-participant-remove-${loginId}`}
                  aria-label={t("run.bar.removeParticipant")}
                  title={t("run.bar.removeParticipant")}
                  className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-error"
                  onClick={() => setPicked((prev) => prev.filter((id) => id !== loginId))}
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              </span>
            ))}
          </div>
        )}
        <RunParticipantPicker
          mapId={mapId}
          excludeIds={new Set([...picked, starter])}
          onPick={(loginId) => setPicked((prev) => (prev.includes(loginId) ? prev : [...prev, loginId]))}
        />
        <p className="text-fine text-ink-tertiary">{t("run.bar.shareHint")}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-id="run-share-cancel"
            className="rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-id="run-share-submit"
            disabled={picked.length === 0 || busy}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void handleShare()}
          >
            {t("run.bar.shareSubmit")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}

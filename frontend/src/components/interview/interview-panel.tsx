"use client";

// 인터뷰 우측 대화 패널 — 메시지 스트림(마크다운)·퀵리플라이 보기·첨부 관리 (design 2026-07-23 §6)
// 선택지(맵 안) 비교는 캔버스 플로팅 창에서 — 여기서는 안내만. 노드 멘션은 window 이벤트로 수신.
// 2026-07-26 리디자인: 스테이지 칩·전환 디바이더·메시지 그룹핑·typing dots·컴포저 카드·픽커 핀·스크롤 다운.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, Check, File, FileChartPie, FileCode, FileSpreadsheet, FileText, FileType,
  Files, FolderOpen, HardDrive, Headset, Info, Layers, Lightbulb, Loader2, Paperclip,
  RotateCcw, Send, SkipForward, X,
  type LucideIcon,
} from "lucide-react";

import { getAiTips, type InterviewState } from "@/lib/api";
import { choiceOptionsOf, stageIndex, stagesForMode } from "@/lib/interview";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { MarkdownView } from "@/components/markdown-view";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { QuestionOptions } from "@/components/interview/question-options";

// 프리뷰 노드 "Ask about this node" 버튼 → 입력창 멘션 삽입용 커스텀 이벤트 이름
export const MENTION_EVENT = "iv-mention";
// 첨부 안내 열기 — 패스트트랙(문서로 바로 그리기)이 페이지에서 첨부 플로우를 트리거 (design 2026-07-29)
export const ATTACH_EVENT = "iv-open-attach";

// 채팅 글자 크기(px) — 브라우저별 저장. 기본 13(기존 14 caption보다 한 단계 작게)
const FONT_KEY = "bpm.consultChatFont";
const FONT_STEPS = [12, 13, 14, 16] as const;
const FONT_DEFAULT = 13;

const INPUT_MAX_LEN = 4000; // 백엔드 InterviewTurnIn.content max_length와 동일
const INPUT_MAX_PX = 128; // 입력창 자동 확장 상한 — max-h-32와 동기
const CHARCOUNT_SHOW_AT = INPUT_MAX_LEN - 400; // 상한 근접 시에만 카운터 노출
const SCROLL_DOWN_AT = 160; // 바닥에서 이만큼(px) 이상 올라가면 스크롤 다운 버튼 노출

// 답변 대기 팁 — 서버 관리 팁(getAiTips) 우선, 미설정 시 i18n 폴백 (AI 챗과 동일 소스)
const TIP_KEYS = ["ai.tip1", "ai.tip2", "ai.tip3", "ai.tip4", "ai.tip5"] as const;

// 첨부 칩 확장자 아이콘 — 색은 토큰만(브랜드색 대응: 시트=added, 프레젠테이션=changed, 문서=accent, PDF=error).
// 현재 업로드 가능 포맷(pdf/docx/xlsx/txt/md) 외 확장자도 표시용으로 미리 매핑.
const ATTACH_ICONS: Array<{ exts: string[]; icon: LucideIcon; cls: string }> = [
  { exts: ["xlsx", "xlsm", "xls", "csv"], icon: FileSpreadsheet, cls: "text-added" },
  { exts: ["ppt", "pptx"], icon: FileChartPie, cls: "text-changed" },
  { exts: ["doc", "docx"], icon: FileText, cls: "text-accent" },
  { exts: ["pdf"], icon: FileType, cls: "text-error" },
  { exts: ["md", "markdown"], icon: FileCode, cls: "text-ink-tertiary" },
  { exts: ["txt"], icon: FileText, cls: "text-ink-tertiary" },
];

function getAttachmentIcon(filename: string): { icon: LucideIcon; cls: string } {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const found = ATTACH_ICONS.find((entry) => entry.exts.includes(ext));
  return found ?? { icon: File, cls: "text-ink-tertiary" };
}

// 업로드 가능 판정 — 백엔드 계약과 동일(parsing.ALLOWED_EXTENSIONS / MAX_ATTACHMENT_BYTES)
const ALLOWED_EXTS = new Set(["pdf", "docx", "xlsx", "txt", "md"]);
const MAX_ATTACH_BYTES = 20 * 1024 * 1024;
const COLLAPSED_CHIPS = 5; // 접힘 시 노출 첨부 칩 수(대략 두 줄)
const REVIEW_LIST_CAP = 8; // 리뷰 모달 섹션당 표시 상한 — 초과분은 "+N more" 요약 행

interface ReviewFile {
  file: File;
  reason: string | null; // null=업로드 가능, 그 외 불가 사유(영문 UI)
}

function reviewSelectedFiles(files: File[]): ReviewFile[] {
  return files.map((file) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTS.has(ext)) return { file, reason: "Unsupported format" };
    if (file.size > MAX_ATTACH_BYTES) return { file, reason: "Over 20 MB" };
    return { file, reason: null };
  });
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function readFontPx(): number {
  if (typeof window === "undefined") return FONT_DEFAULT;
  const stored = Number(window.localStorage.getItem(FONT_KEY));
  return (FONT_STEPS as readonly number[]).includes(stored) ? stored : FONT_DEFAULT;
}

interface InterviewPanelProps {
  interview: InterviewState;
  busy: boolean;
  error: string | null;
  // 첨부 실패 — 턴 에러와 분리(턴 Retry가 무관한 옛 턴을 재전송하지 않게, hardening T15)
  attachError?: string | null;
  // 서버 반영 전의 낙관적 사용자 메시지 — 실패 시에도 유지되어 Retry 재전송 대상을 보여준다
  pending: string | null;
  hasChoices: boolean;
  onSend: (content: string) => void;
  onSkip: () => void;
  onRetry: () => void;
  // 파일 1개 업로드 — 성공 여부 반환(복수 업로드 진행/실패 표시용). 실패 시 에러 표시는 호출자(page)가 담당.
  onAttach: (file: File) => Promise<boolean>;
  onDeleteAttachment: (attachmentId: number) => void;
}

export function InterviewPanel({
  interview, busy, error, attachError = null, pending, hasChoices,
  onSend, onSkip, onRetry, onAttach, onDeleteAttachment,
}: InterviewPanelProps) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [fontPx, setFontPx] = useState(readFontPx);
  const [tips, setTips] = useState<string[]>([]);
  const [showAttachInfo, setShowAttachInfo] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  // 복수/폴더 첨부 — 선택 파일 리뷰 목록(가능/불가+사유) 및 순차 업로드 진행 상태
  const [reviewFiles, setReviewFiles] = useState<ReviewFile[] | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
    failed: string[];
  } | null>(null);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  // 첨부 잔류 정리(2026-07-28) — 워터마크 이하 id는 컴포저 칩 대신 배지+플라이아웃으로.
  // 마운트 시점 기존 첨부는 즉시 배지로 접힌다(재개 세션 잔류 방지).
  const [attachWatermark, setAttachWatermark] = useState(() =>
    interview.attachments.reduce((max, a) => Math.max(max, a.id), 0),
  );
  const [attachListOpen, setAttachListOpen] = useState(false);
  const attachListRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fontRef = useRef<HTMLDivElement>(null);

  const live = interview.messages.filter((m) => !m.superseded);
  const last = live[live.length - 1];
  // 퀵리플라이 보기 — 마지막 메시지가 컨설턴트 질문 + options payload일 때만
  const quickReplies =
    interview.status === "active" && !busy && last?.role === "consultant" && last.kind === "question"
      ? ((last.payload as { options?: string[] } | null)?.options ?? [])
      : [];
  const activeChoices = interview.status === "active" ? choiceOptionsOf(live) : null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [live.length, busy, pending]);

  // 프리뷰 노드 멘션 수신 — setState는 이벤트 핸들러 안에서만 (react-hooks/set-state-in-effect 준수)
  useEffect(() => {
    const handleMention = (event: Event) => {
      const label = (event as CustomEvent<string>).detail;
      if (!label) return;
      setInput((prev) => (prev ? `${prev} [노드: ${label}] ` : `[노드: ${label}] `));
      inputRef.current?.focus();
    };
    window.addEventListener(MENTION_EVENT, handleMention);
    return () => window.removeEventListener(MENTION_EVENT, handleMention);
  }, []);

  // 패스트트랙 첨부 열기 수신 — 첨부 버튼 클릭과 동일하게 안내 모달부터
  useEffect(() => {
    const handleOpenAttach = () => setShowAttachInfo(true);
    window.addEventListener(ATTACH_EVENT, handleOpenAttach);
    return () => window.removeEventListener(ATTACH_EVENT, handleOpenAttach);
  }, []);

  // 대기 팁 — 서버 관리 팁 1회 로드(실패 시 i18n 폴백 유지)
  useEffect(() => {
    let alive = true;
    void getAiTips()
      .then((result) => {
        if (alive && result.tips.length > 0) setTips(result.tips);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // `/` 단축키 — 입력 요소 밖에서 누르면 채팅 입력창 포커스 (플레이스홀더에 표기)
  useEffect(() => {
    const handleSlash = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)
      )
        return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", handleSlash);
    return () => window.removeEventListener("keydown", handleSlash);
  }, []);

  // 전송/답변 후 포커스 복원 — busy 동안 disabled로 포커스가 풀리는 문제.
  // 보기 픽커(quickReplies)가 떠 있으면 픽커의 키보드 포커스를 뺏지 않는다(픽커 autofocus가 자식 effect로 선행).
  useEffect(() => {
    if (!busy && interview.status === "active" && quickReplies.length === 0)
      inputRef.current?.focus();
  }, [busy, interview.status, quickReplies.length]);

  // 입력창 높이 반응형 — 내용에 맞춰 min(1행)~INPUT_MAX_PX 자동 확장 (DOM만 조정, setState 없음)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_PX)}px`;
  }, [input]);

  // 전송 시 최근 첨부 칩을 배지로 접는다 — 컴포저 잔류 방지
  function sealAttachments() {
    setAttachWatermark(interview.attachments.reduce((max, a) => Math.max(max, a.id), 0));
  }

  function submit() {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    sealAttachments();
    onSend(content);
  }

  function selectFont(px: number) {
    setFontPx(px);
    setFontOpen(false);
    window.localStorage.setItem(FONT_KEY, String(px)); // 영속은 핸들러에서 (StrictMode effect 리셋 함정)
    inputRef.current?.focus();
  }

  // 글자 크기 팝오버 — 바깥 클릭(capture)·Escape 닫힘
  useEffect(() => {
    if (!fontOpen) return;
    const handleDown = (event: PointerEvent) => {
      if (fontRef.current && !fontRef.current.contains(event.target as Node)) setFontOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFontOpen(false);
    };
    window.addEventListener("pointerdown", handleDown, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleDown, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [fontOpen]);

  // 첨부 플라이아웃 — 바깥 클릭(capture)·Escape 닫힘 (Aa 팝오버와 동일 패턴)
  useEffect(() => {
    if (!attachListOpen) return;
    const handleDown = (event: PointerEvent) => {
      if (attachListRef.current && !attachListRef.current.contains(event.target as Node)) {
        setAttachListOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAttachListOpen(false);
    };
    window.addEventListener("pointerdown", handleDown, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleDown, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [attachListOpen]);

  // 파일/폴더 선택 결과 — 숨김 파일(.DS_Store 등) 제외 후 리뷰. 유효 단일 파일은 모달 없이 즉시 업로드.
  function handleFilesPicked(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => !f.name.startsWith("."));
    setShowAttachInfo(false);
    if (files.length === 0) return;
    const reviewed = reviewSelectedFiles(files);
    if (reviewed.length === 1 && reviewed[0].reason === null) {
      void runUpload([reviewed[0].file], false);
    } else {
      setReviewFiles(reviewed);
    }
  }

  // 순차 업로드 — 진행/실패를 uploadProgress로 노출. 모달 경유(viaModal)면 실패 시 모달을 유지해 실패 행을 보여준다.
  async function runUpload(files: File[], viaModal: boolean) {
    setUploadProgress({ done: 0, total: files.length, failed: [] });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const ok = await onAttach(files[i]);
      if (!ok) failed.push(files[i].name);
      setUploadProgress({ done: i + 1, total: files.length, failed: [...failed] });
    }
    if (failed.length === 0 || !viaModal) {
      setReviewFiles(null);
      setUploadProgress(null);
    }
  }

  // 스크롤 다운 버튼 — 바닥에서 일정 이상 올라갔을 때만 (setState는 스크롤 이벤트 핸들러에서)
  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > SCROLL_DOWN_AT);
  }

  // 팁 로테이션 — 턴이 쌓일 때마다 다음 팁 (별도 상태 없이 렌더 파생)
  const tipCount = tips.length > 0 ? tips.length : TIP_KEYS.length;
  const tipText =
    tips.length > 0 ? tips[live.length % tipCount] : t(TIP_KEYS[live.length % tipCount]);

  const stages = stagesForMode(interview.mode);
  const stageIdx = stageIndex(interview.current_stage, interview.mode);
  const stageLabel = stages[stageIdx]?.label ?? interview.current_stage;

  // 컨설턴트 아바타 — 메시지 런 헤더·typing dots 공용
  const consultantBadge = (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
      <Headset size={12} strokeWidth={1.5} />
    </span>
  );

  // 리뷰 모달 파생 — 가능/불가 섹션 분리, 업로드 진행(체크/스피너/실패)을 행 아이콘·뱃지로 오버레이
  const eligibleReviews = reviewFiles?.filter((r) => r.reason === null) ?? [];
  const ineligibleReviews = reviewFiles?.filter((r) => r.reason !== null) ?? [];
  const uploadFinished = uploadProgress !== null && uploadProgress.done >= uploadProgress.total;
  const reviewSections: ConfirmLine[][] = [];
  if (reviewFiles !== null) {
    const eligibleLines: ConfirmLine[] = eligibleReviews.slice(0, REVIEW_LIST_CAP).map((r, i) => {
      const meta = getAttachmentIcon(r.file.name);
      const MetaIcon = meta.icon;
      let icon = <MetaIcon size={16} strokeWidth={1.5} className={meta.cls} />;
      let badge: ConfirmLine["badge"];
      if (uploadProgress !== null) {
        if (uploadProgress.failed.includes(r.file.name)) {
          icon = <X size={16} strokeWidth={1.5} className="text-error" />;
          badge = { text: "Failed", tone: "warn" };
        } else if (i < uploadProgress.done) {
          icon = <Check size={16} strokeWidth={1.5} className="text-added" />;
          badge = { text: "Done", tone: "approved" };
        } else if (i === uploadProgress.done) {
          icon = <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-accent" />;
        }
      }
      return { icon, text: `${r.file.name} · ${formatSize(r.file.size)}`, badge };
    });
    if (eligibleReviews.length > REVIEW_LIST_CAP)
      eligibleLines.push({
        icon: <File size={16} strokeWidth={1.5} />,
        text: `+${eligibleReviews.length - REVIEW_LIST_CAP} more files`,
        tone: "muted",
      });
    if (eligibleLines.length > 0) reviewSections.push(eligibleLines);
    const ineligibleLines: ConfirmLine[] = ineligibleReviews
      .slice(0, REVIEW_LIST_CAP)
      .map((r) => ({
        icon: <X size={16} strokeWidth={1.5} />,
        text: `${r.file.name} · ${formatSize(r.file.size)}`,
        tone: "muted" as const,
        badge: { text: r.reason ?? "", tone: "warn" as const },
      }));
    if (ineligibleReviews.length > REVIEW_LIST_CAP)
      ineligibleLines.push({
        icon: <File size={16} strokeWidth={1.5} />,
        text: `+${ineligibleReviews.length - REVIEW_LIST_CAP} more files`,
        tone: "muted",
      });
    if (ineligibleLines.length > 0) reviewSections.push(ineligibleLines);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-id="interview-panel">
      {/* 채팅 글자 크기 — .md는 자체 font-size(caption)가 있어 상속 개방 오버라이드 필요 */}
      <style>{`[data-id="interview-panel"] .md{font-size:inherit;}`}</style>
      {/* 현재 스테이지 칩 — 스트림 위 고정 */}
      <div
        className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-1.5"
        data-id="iv-stage-chip"
      >
        <span
          className={
            "h-1.5 w-1.5 rounded-full " +
            (interview.status === "active" ? "bg-accent" : "bg-ink-muted")
          }
        />
        <span className="text-caption-strong">{stageLabel}</span>
        <span
          className={
            "text-fine text-ink-muted" + (interview.status === "active" ? "" : " capitalize")
          }
        >
          {interview.status === "active"
            ? `Stage ${stageIdx + 1} of ${stages.length}`
            : interview.status}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <ul
          ref={listRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-3"
          style={{ fontSize: fontPx }}
        >
          {live.map((message, i) => {
            const prev = live[i - 1];
            const stageChanged = message.stage !== prev?.stage;
            const dividerLabel = stages.find((s) => s.key === message.stage)?.label;
            const isConsultantBody = message.role === "consultant" && message.kind !== "notice";
            // 같은 스테이지에서 컨설턴트 메시지가 이어지면 헤더 생략 + 간격 축소 (메시지 그룹핑)
            const continuesRun =
              !stageChanged &&
              isConsultantBody &&
              prev?.role === "consultant" &&
              prev.kind !== "notice";
            return (
              <li
                key={message.id}
                className={continuesRun ? "mt-1.5" : "mt-4 first:mt-1"}
                data-id={`iv-msg-${message.kind}`}
              >
                {stageChanged && dividerLabel ? (
                  <div className="mb-3 flex items-center gap-2 pt-1" data-id="iv-stage-divider">
                    <span className="h-px flex-1 bg-hairline" />
                    <span className="text-fine text-ink-muted">{dividerLabel}</span>
                    <span className="h-px flex-1 bg-hairline" />
                  </div>
                ) : null}
                {message.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-xs bg-accent-tint px-3.5 py-2 text-ink">
                      {message.content}
                    </div>
                  </div>
                ) : message.kind === "notice" ? (
                  <div className="flex items-start gap-2 rounded-md bg-surface-alt px-3 py-2">
                    <Info size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-tertiary" />
                    <span className="text-fine text-ink-secondary">{message.content}</span>
                  </div>
                ) : (
                  <>
                    {!continuesRun ? (
                      <div className="mb-1 flex items-center gap-1.5">
                        {consultantBadge}
                        <span className="text-fine font-semibold text-ink-secondary">Consultant</span>
                      </div>
                    ) : null}
                    <MarkdownView source={message.content} className="min-w-0 max-w-[92%]" />
                  </>
                )}
              </li>
            );
          })}
          {pending !== null ? (
            <li className="mt-4" data-id="iv-pending">
              <div className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-xs bg-accent-tint px-3.5 py-2 text-ink opacity-70">
                  {pending}
                </div>
              </div>
            </li>
          ) : null}
          {activeChoices && hasChoices ? (
            <li
              className="mt-4 flex items-center gap-2 rounded-md border border-accent-tint-border bg-accent-tint/50 px-3 py-2 text-caption text-ink-secondary"
              data-id="iv-choices-hint"
            >
              <Layers size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
              Compare the proposed maps on the canvas and pick one.
            </li>
          ) : null}
          {busy ? (
            <li className="mt-4" data-id="iv-thinking">
              <div className="flex items-center gap-1.5">
                {consultantBadge}
                <span className="inline-flex items-center gap-1 px-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-ink-muted"
                      style={{ animation: `lp-dot 1.1s ease-in-out ${i * 0.2}s infinite` }}
                    />
                  ))}
                </span>
              </div>
              <div
                className="mt-1.5 flex items-start gap-1.5 pl-6.5 text-fine text-ink-muted"
                data-id="iv-tip"
              >
                <Lightbulb size={12} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                {tipText}
              </div>
            </li>
          ) : null}
          {error ? (
            <li
              className="mt-4 rounded-md border border-error/40 bg-error/5 px-3 py-2 text-caption text-error"
              data-id="iv-error"
            >
              {error}
              <button className="ml-2 inline-flex items-center gap-1 text-caption-strong" onClick={onRetry}>
                <RotateCcw size={16} strokeWidth={1.5} /> Retry
              </button>
            </li>
          ) : null}
          {attachError ? (
            <li
              className="mt-4 rounded-md border border-error/40 bg-error/5 px-3 py-2 text-caption text-error"
              data-id="iv-attach-error"
            >
              {attachError}
            </li>
          ) : null}
        </ul>
        {showScrollDown ? (
          <button
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-hairline bg-surface p-1.5 text-ink-secondary shadow-lg hover:bg-surface-alt"
            title="Scroll to latest"
            onClick={() =>
              listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
            }
            data-id="iv-scroll-down"
          >
            <ArrowDown size={14} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
      <div className="px-2 pb-2 pt-1.5">
        {/* 보기 픽커 — 스크롤에 밀리지 않게 컴포저 위 핀 고정 */}
        {quickReplies.length > 0 ? (
          <div className="mb-1.5" data-id="iv-quickreplies">
            <QuestionOptions
              options={quickReplies}
              disabled={busy}
              onSelect={(value) => {
                sealAttachments();
                onSend(value);
              }}
              onFreeType={() => inputRef.current?.focus()}
            />
          </div>
        ) : null}
        {/* 컴포저 카드 — 첨부·입력·액션을 한 카드로 통합, 포커스는 카드 테두리로 표시 */}
        <div
          className="rounded-lg border border-hairline bg-surface shadow-md transition-colors duration-150 focus-within:border-accent"
          data-id="iv-composer"
        >
          {(() => {
            // 컴포저 칩은 "이번 메시지에 보낼" 최근 첨부만 — 전송하면 배지+플라이아웃으로 접힌다
            const recent = interview.attachments.filter((a) => a.id > attachWatermark);
            if (recent.length === 0 && !(uploadProgress !== null && reviewFiles === null)) {
              return null;
            }
            return (
            <div className="flex flex-wrap items-center gap-1 px-2.5 pt-2">
              {(chipsExpanded ? recent : recent.slice(0, COLLAPSED_CHIPS)).map((a) => {
                const fileIcon = getAttachmentIcon(a.filename);
                const FileIcon = fileIcon.icon;
                return (
                <span
                  key={a.id}
                  className={
                    "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-fine " +
                    (a.status === "parsed" ? "bg-surface-alt text-ink-secondary" : "bg-error/10 text-error")
                  }
                  title={a.error || a.filename}
                  data-id="iv-attachment-chip"
                >
                  <FileIcon
                    size={13}
                    strokeWidth={1.5}
                    className={"shrink-0 " + (a.status === "parsed" ? fileIcon.cls : "text-error")}
                  />
                  {a.filename}
                  <button
                    className="rounded-xs text-ink-muted hover:text-error"
                    title="Remove document"
                    onClick={() => onDeleteAttachment(a.id)}
                    data-id="iv-attachment-delete"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </span>
                );
              })}
              {recent.length > COLLAPSED_CHIPS ? (
                <button
                  className="inline-flex items-center rounded-xs bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary hover:text-ink"
                  onClick={() => setChipsExpanded((v) => !v)}
                  data-id="iv-attach-more"
                >
                  {chipsExpanded
                    ? "Show less"
                    : `+${recent.length - COLLAPSED_CHIPS} more`}
                </button>
              ) : null}
              {uploadProgress !== null && reviewFiles === null ? (
                <span
                  className="inline-flex items-center gap-1 rounded-xs bg-accent-tint px-1.5 py-0.5 text-fine text-accent"
                  data-id="iv-uploading-chip"
                >
                  <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
                  Uploading…
                </span>
              ) : null}
            </div>
            );
          })()}
          <textarea
            ref={inputRef}
            className="max-h-32 min-h-9 w-full resize-none bg-transparent px-3 py-2 text-body outline-none"
            rows={1}
            maxLength={INPUT_MAX_LEN}
            placeholder={
              interview.status === "active" ? "Type your answer…  ( / to focus)" : "Interview finished"
            }
            disabled={interview.status !== "active" || busy}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            data-id="iv-input"
          />
          <div className="flex items-center gap-0.5 px-1.5 pb-1.5 text-ink-tertiary">
            <button
              className="rounded-sm p-1.5 hover:bg-surface-alt hover:text-ink"
              title="Attach document"
              onClick={() => setShowAttachInfo(true)}
              data-id="iv-attach"
            >
              <Paperclip size={15} strokeWidth={1.5} />
            </button>
            {interview.attachments.length > 0 ? (
              <div className="relative" ref={attachListRef}>
                <button
                  className={
                    "relative rounded-sm p-1.5 hover:bg-surface-alt hover:text-ink " +
                    (attachListOpen ? "bg-surface-alt text-ink" : "")
                  }
                  title="Attached documents"
                  onClick={() => setAttachListOpen((v) => !v)}
                  data-id="iv-attach-badge"
                >
                  <Files size={15} strokeWidth={1.5} />
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[10px] font-semibold text-on-accent">
                    {interview.attachments.length}
                  </span>
                </button>
                {attachListOpen ? (
                  <div
                    className="absolute bottom-full left-0 z-30 mb-1.5 w-72 rounded-md border border-hairline bg-surface p-1.5 shadow-lg"
                    data-id="iv-attach-flyout"
                  >
                    <div className="px-1.5 pb-1 text-fine text-ink-muted">Attached documents</div>
                    <ul className="max-h-48 overflow-y-auto">
                      {interview.attachments.map((a) => {
                        const fileIcon = getAttachmentIcon(a.filename);
                        const FlyIcon = fileIcon.icon;
                        return (
                          <li
                            key={a.id}
                            className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-surface-alt"
                            data-id="iv-attach-flyout-row"
                          >
                            <FlyIcon
                              size={14}
                              strokeWidth={1.5}
                              className={"shrink-0 " + (a.status === "parsed" ? fileIcon.cls : "text-error")}
                            />
                            <span
                              className={
                                "min-w-0 flex-1 truncate text-fine " +
                                (a.status === "parsed" ? "text-ink-secondary" : "text-error")
                              }
                              title={a.error || a.filename}
                            >
                              {a.filename}
                            </span>
                            <button
                              className="shrink-0 rounded-xs p-0.5 text-ink-muted hover:text-error"
                              title="Remove document"
                              onClick={() => onDeleteAttachment(a.id)}
                              data-id="iv-attach-flyout-delete"
                            >
                              <X size={13} strokeWidth={1.5} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            <span className="mx-0.5 h-4 w-px bg-hairline" />
            {/* 채팅 글자 크기 — Aa 팝오버에서 4단계 직접 선택, 브라우저별 저장(localStorage) */}
            <div className="relative" ref={fontRef}>
              <button
                className={
                  "rounded-sm px-1.5 py-1 text-fine hover:bg-surface-alt hover:text-ink " +
                  (fontOpen ? "bg-surface-alt text-ink" : "")
                }
                title="Text size"
                onClick={() => setFontOpen((v) => !v)}
                data-id="iv-font"
              >
                Aa
              </button>
              {fontOpen ? (
                <div
                  className="absolute bottom-full left-0 z-20 mb-1.5 flex items-end gap-0.5 rounded-md border border-hairline bg-surface p-1 shadow-lg"
                  data-id="iv-font-pop"
                >
                  {FONT_STEPS.map((px) => (
                    <button
                      key={px}
                      className={
                        "flex w-8 flex-col items-center rounded-sm px-1 pb-0.5 pt-1 leading-none " +
                        (px === fontPx
                          ? "bg-accent-tint text-accent"
                          : "text-ink-secondary hover:bg-surface-alt")
                      }
                      title={`${px}px`}
                      onClick={() => selectFont(px)}
                      data-id={`iv-font-opt-${px}`}
                    >
                      <span style={{ fontSize: px }}>A</span>
                      <span className="mt-0.5 text-fine">{px}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {interview.status === "active" && interview.current_stage !== "review" ? (
              <>
                <span className="mx-0.5 h-4 w-px bg-hairline" />
                <button
                  className="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-fine hover:bg-surface-alt hover:text-accent disabled:opacity-40"
                  title="Mark unanswered items as TBD and move on"
                  disabled={busy}
                  onClick={onSkip}
                  data-id="iv-skip-stage"
                >
                  <SkipForward size={12} strokeWidth={1.5} />
                  Skip stage
                </button>
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
              {input.length >= CHARCOUNT_SHOW_AT ? (
                <span className="text-fine text-ink-muted" data-id="iv-charcount">
                  {input.length.toLocaleString()} / {INPUT_MAX_LEN.toLocaleString()}
                </span>
              ) : null}
              <button
                className="rounded-md bg-accent p-1.5 text-on-accent disabled:opacity-40"
                disabled={interview.status !== "active" || busy || !input.trim()}
                onClick={submit}
                data-id="iv-send"
              >
                <Send size={15} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
      {showAttachInfo
        ? createPortal(
            <ModalBackdrop
              onClose={() => setShowAttachInfo(false)}
              className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
            >
              <div
                data-id="iv-attach-info"
                className="flex w-full max-w-sm flex-col items-center gap-4 rounded-md bg-surface p-6 text-center shadow-lg"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-tint text-accent">
                  <Paperclip size={22} strokeWidth={1.5} />
                </div>
                <div className="flex flex-col gap-1">
                  <h2 className="text-body-strong text-ink">Attach documents</h2>
                  <p className="text-caption text-ink-tertiary">
                    The consultant reads the documents and uses them as interview context.
                  </p>
                </div>
                <ul className="flex w-full flex-col gap-1 rounded-sm bg-surface-alt p-2 text-left">
                  {[
                    { icon: FileText, text: "Formats: PDF, DOCX, XLSX, TXT, MD" },
                    { icon: HardDrive, text: "Max size: 20MB per file" },
                    { icon: FolderOpen, text: "Multiple files or a whole folder at once" },
                  ].map((line) => (
                    <li
                      key={line.text}
                      className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-caption text-ink"
                    >
                      <line.icon size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                      <span className="min-w-0 flex-1 break-keep">{line.text}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex w-full items-center gap-2">
                  <button
                    className="mr-auto rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink hover:bg-surface-alt"
                    onClick={() => setShowAttachInfo(false)}
                    data-id="iv-attach-info-cancel"
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink hover:bg-surface-alt"
                    onClick={() => folderRef.current?.click()}
                    data-id="iv-attach-folder"
                  >
                    <FolderOpen size={16} strokeWidth={1.5} />
                    Choose folder
                  </button>
                  <button
                    className="rounded-sm bg-accent px-2.5 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
                    onClick={() => fileRef.current?.click()}
                    data-id="iv-attach-files"
                  >
                    Choose files
                  </button>
                </div>
              </div>
            </ModalBackdrop>,
            document.body,
          )
        : null}
      {reviewFiles !== null ? (
        <ConfirmDialog
          title="Review selected files"
          message={`${eligibleReviews.length} of ${reviewFiles.length} files can be uploaded.`}
          confirmLabel={
            uploadProgress !== null
              ? uploadFinished
                ? "Close"
                : `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
              : eligibleReviews.length > 0
                ? `Upload ${eligibleReviews.length} ${eligibleReviews.length === 1 ? "file" : "files"}`
                : "Nothing to upload"
          }
          cancelLabel={uploadProgress === null ? "Cancel" : undefined}
          icon={<Paperclip size={22} strokeWidth={1.5} />}
          sections={reviewSections}
          confirmDisabled={
            (uploadProgress !== null && !uploadFinished) ||
            (uploadProgress === null && eligibleReviews.length === 0)
          }
          onConfirm={() => {
            if (uploadFinished) {
              setReviewFiles(null);
              setUploadProgress(null);
            } else if (uploadProgress === null && eligibleReviews.length > 0) {
              void runUpload(eligibleReviews.map((r) => r.file), true);
            }
          }}
          onClose={() => {
            if (uploadProgress !== null && !uploadFinished) return; // 업로드 중 닫힘 방지
            setReviewFiles(null);
            setUploadProgress(null);
          }}
        />
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.txt,.md"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFilesPicked(e.target.files);
          e.target.value = "";
        }}
        data-id="iv-file-input"
      />
      {/* 폴더 선택 — webkitdirectory는 @types/react 타이핑에 없어 ref 콜백으로 부여 */}
      <input
        ref={(el) => {
          folderRef.current = el;
          el?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFilesPicked(e.target.files);
          e.target.value = "";
        }}
        data-id="iv-folder-input"
      />
    </div>
  );
}

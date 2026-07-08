"use client";

// 에디터 AI 채팅 패널 — 순서도 생성/편집 지시 + 사용법 안내 (design 2026-06-15)
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  Info,
  Lightbulb,
  Loader2,
  MessageSquare,
  Minus,
  Paperclip,
  Pause,
  Play,
  Plus,
  Route,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { MarkdownView } from "@/components/markdown-view";
import {
  aiChat,
  deleteAiChatSession,
  getAiChatMessages,
  getAiChatSessions,
  getAiModels,
  getAiTips,
  type AiChatSessionSummary,
  type AiChatTurn,
  type AiFinding,
  type AiProposal,
  type AiStep,
} from "@/lib/api";
import { createLocalMessage, toChatMessage, type ChatMessage } from "@/lib/chat-sessions";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

const MAX_INSTRUCTION_CHARS = 2000; // 백엔드 AiChatRequest.instruction max_length와 동일
const RING_CAUTION = 0.75; // 입력 사용률 주의 임계
const RING_WARNING = 0.9; // 입력 사용률 경고 임계
const CHAT_PAGE_SIZE = 30; // 서버 커서 페이징 단위 — 최초/이전 기록 로딩 공통
const OLDER_LOAD_DELAY_MS = 450; // 이전 기록 로딩 애니메이션(팁 노출) 최소 시간

// 이전 기록 로딩 중 노출하는 기능 팁 — 서버(설정 콘솔 관리, 기본 20종) 조회 실패 시 i18n 폴백 5종
const TIP_KEYS = ["ai.tip1", "ai.tip2", "ai.tip3", "ai.tip4", "ai.tip5"] as const;

// 사용률 → 링/바 색 (기본 accent, 75% 주의 amber, 90% 경고 error)
function getUsageColor(ratio: number): string {
  if (ratio >= RING_WARNING) return "var(--color-error)";
  if (ratio >= RING_CAUTION) return "var(--color-changed)";
  return "var(--color-accent)";
}

function formatMessageTime(at: number): string {
  return formatKstShort(new Date(at).toISOString()); // KST "MM-DD HH:mm" (앱 표준)
}

interface AiChatPanelProps {
  mapId: number;
  versionId: number;
  aiEnabled: boolean;
  canEdit: boolean;
  initialSessionId?: number | null; // ?aiChat=<id> 딥링크 — 세션 목록 최초 로딩 시 우선 활성화
  onGraphProposal: (proposal: AiProposal) => void;
  onOpsProposal: (proposal: AiProposal) => void;
  onHighlightNode: (nodeId: string) => void;
  onToast?: (message: string) => void;
  // graph/ops 제안 미리보기 — 캔버스에 미리 적용된 상태를 채팅 내 카드로 커밋/취소.
  aiPreviewActive?: boolean;
  onCommitPreview?: () => void;
  onDiscardPreview?: () => void;
  fontScale?: number; // 대화 전환 바 −T＋ 로 조절되는 스레드 상대 폰트 배율
  onFontScaleChange?: (scale: number) => void; // 폰트 배율 변경 — 상태는 페이지가 보유(창 닫아도 유지)
  onAutoTitle?: (title: string) => void; // 마지막 답변 키워드로 자동 타이틀 보고
  onRegisterNewChat?: (startNewChat: () => void) => void; // 새 대화 트리거를 창 헤더 버튼에 노출
}

// 빠른 프롬프트 칩 — 아이콘 버튼(호버 시 이름·설명 툴팁). 클릭 시 라벨을 즉시 전송.
const QUICK_CHIPS = [
  { key: "ai.chipAnalyze", descKey: "ai.chipAnalyzeDesc", Icon: Search },
  { key: "ai.chipSummarize", descKey: "ai.chipSummarizeDesc", Icon: FileText },
  { key: "ai.chipWalkthrough", descKey: "ai.chipWalkthroughDesc", Icon: Route },
  { key: "ai.chipImprove", descKey: "ai.chipImproveDesc", Icon: Lightbulb },
] as const;

export function AiChatPanel({
  mapId,
  versionId,
  aiEnabled,
  canEdit,
  initialSessionId,
  onGraphProposal,
  onOpsProposal,
  onHighlightNode,
  onToast,
  aiPreviewActive = false,
  onCommitPreview,
  onDiscardPreview,
  fontScale = 1,
  onFontScaleChange,
  onAutoTitle,
  onRegisterNewChat,
}: AiChatPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  // 서버 세션 히스토리 — 전체 목록(내 것 전부, 맵 정보 포함)과 활성 세션. null=새 대화(서버 행 없음, 첫 전송 시 생성)
  const [allSessions, setAllSessions] = useState<AiChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessionsReload, setSessionsReload] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false); // 드롭다운 "다른 맵 대화" 섹션 펼침
  const [deleteTarget, setDeleteTarget] = useState<AiChatSessionSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState(false); // 목록/메시지 로딩 실패 — 인라인 재시도
  const initializedRef = useRef(false); // 최초 목록 로딩 시 1회만 최근 세션 자동 활성화
  const [tips, setTips] = useState<string[]>([]); // 서버 관리 기능 팁 — 빈 배열이면 i18n 폴백
  const [tipIndex, setTipIndex] = useState(0);
  const prevScrollHeightRef = useRef<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [findings, setFindings] = useState<AiFinding[]>([]); // 최근 analysis 결과 (Phase 4)
  const [steps, setSteps] = useState<AiStep[]>([]); // 워크스루 단계 (Phase 5)
  const [stepIndex, setStepIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 스레드가 하단에서 떨어져 있으면 "맨 아래로" 버튼 노출.
  const [showToBottom, setShowToBottom] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 응답 도착 시 활성 세션 판별용 미러 — 전송 후 세션을 전환해도 findings/steps가 남의 세션에 뜨지 않게.
  const activeSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const mapSessions = allSessions.filter((item) => item.map_id === mapId);
  const activeMeta = allSessions.find((item) => item.id === activeSessionId) ?? null;
  const otherSessions = allSessions.filter((item) => item.map_id !== mapId);
  const isForeign = activeMeta !== null && activeMeta.map_id !== mapId;

  // 이전 페이지 로딩 — 스피너+기능 팁을 최소 시간 보여주며 서버에서 더 오래된 기록을 붙인다
  const beginLoadOlder = () => {
    const el = scrollRef.current;
    const oldest = messages.find((message) => message.id > 0); // 낙관(음수 id) 제외
    if (!el || loadingOlder || !hasMore || activeSessionId === null || !oldest) return;
    const targetSessionId = activeSessionId; // 응답 도착 시 세션 판별용 캡처 — send()와 같은 패턴
    prevScrollHeightRef.current = el.scrollHeight;
    setTipIndex(Math.floor(Math.random() * Math.max(1, tips.length || TIP_KEYS.length)));
    setLoadingOlder(true);
    void Promise.all([
      getAiChatMessages(targetSessionId, oldest.id, CHAT_PAGE_SIZE),
      new Promise((resolve) => window.setTimeout(resolve, OLDER_LOAD_DELAY_MS)),
    ])
      .then(([result]) => {
        // 지연(450ms) 중 세션 전환 — 다른 세션 스레드에 병합되지 않게 버린다
        if (activeSessionIdRef.current !== targetSessionId) return;
        setMessages((prev) => [...result.messages.map(toChatMessage), ...prev]);
        setHasMore(result.has_more);
      })
      .catch(() => onToast?.(t("ai.historyError")))
      .finally(() => setLoadingOlder(false));
  };

  // 이전 청크가 붙은 뒤 스크롤 위치 보존 — 늘어난 높이만큼 내려서 보던 지점 유지
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || prevScrollHeightRef.current === null) return;
    el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
    prevScrollHeightRef.current = null;
  }, [messages]);

  // 세션 목록 로딩 — 마운트·갱신 트리거 시. 최초 1회만 현재 맵의 최근 세션을 자동 활성화.
  useEffect(() => {
    let alive = true;
    void getAiChatSessions()
      .then((result) => {
        if (!alive) return;
        setAllSessions(result.sessions); // server fetch hydration (async — no set-state-in-effect)
        setHistoryError(false);
        if (!initializedRef.current) {
          initializedRef.current = true;
          const initial =
            initialSessionId != null
              ? result.sessions.find((item) => item.id === initialSessionId)
              : undefined;
          const recent = result.sessions.find((item) => item.map_id === mapId);
          setActiveSessionId(initial ? initial.id : recent ? recent.id : null);
        }
      })
      .catch(() => {
        if (alive) setHistoryError(true);
      });
    return () => {
      alive = false;
    };
  }, [mapId, sessionsReload, initialSessionId]);

  // 활성 세션 메시지 로딩 — 최근 페이지부터. 새 대화(null)는 빈 스레드.
  useEffect(() => {
    if (activeSessionId === null) {
      // 주의: React Compiler가 이 컴포넌트를 bail-out 중이라 set-state-in-effect 룰이 침묵 — 재컴파일되면 표면화됨(disable 주석 필요)
      setMessages([]); // reset thread for fresh chat
      setHasMore(false);
      return;
    }
    let alive = true;
    void getAiChatMessages(activeSessionId, undefined, CHAT_PAGE_SIZE)
      .then((result) => {
        if (!alive) return;
        setMessages(result.messages.map(toChatMessage)); // server fetch hydration (async — no set-state-in-effect)
        setHasMore(result.has_more);
        setHistoryError(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof Error && err.message.includes(" 404")) {
          // 정리(보존 상한 등)로 사라진 세션 — 목록 새로고침 후 새 대화 폴백
          setActiveSessionId(null);
          setSessionsReload((value) => value + 1);
        } else {
          setHistoryError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [activeSessionId]);

  const resetTransient = () => {
    setFindings([]);
    setSteps([]);
    setStepIndex(0);
    setAutoplay(false);
    setLoadingOlder(false);
  };

  const refreshSessions = () => setSessionsReload((value) => value + 1);

  const switchSession = (sessionId: number | null) => {
    setListOpen(false);
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    resetTransient();
  };

  const startNewChat = () => {
    setListOpen(false);
    if (activeSessionId === null) return; // 이미 새 대화 — 빈 상태 재사용
    switchSession(null);
  };

  // 새 대화 트리거를 창 헤더(page.tsx) 버튼에 노출 — 최신 클로저 유지 위해 매 렌더 재등록
  useEffect(() => {
    onRegisterNewChat?.(startNewChat);
  });

  // 입력 내용에 따라 textarea 높이 자동 확장(최대 max-h-32 = 128px)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  // 새 메시지·생각중 표시가 추가되면 항상 최신(하단)으로 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy]);

  // 마지막 어시스턴트 답변에서 제목 키워드 추출 → 헤더 자동 타이틀
  useEffect(() => {
    if (!onAutoTitle) return;
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    if (!last) return;
    const heading = last.content.match(/^#{1,6}\s+(.+)$/m);
    const raw = (heading ? heading[1] : last.content)
      .replace(/[#>*`\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const title = raw.split(" ").slice(0, 6).join(" ").slice(0, 40);
    if (title) onAutoTitle(title);
  }, [messages, onAutoTitle]);

  // 기능 팁 조회(진입 1회) — 설정 콘솔에서 관리, 실패 시 i18n 폴백 유지
  useEffect(() => {
    let alive = true;
    void getAiTips()
      .then((result) => {
        if (alive && result.tips.length > 0) setTips(result.tips);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 서빙 모델 목록 조회(진입 1회, AI 활성일 때만) — 첫 모델을 기본 선택
  useEffect(() => {
    if (!aiEnabled) return;
    let alive = true;
    void getAiModels()
      .then((result) => {
        if (alive && result.models.length > 0) {
          setModels(result.models);
          setModel(result.models[0]);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [aiEnabled]);

  // 워크스루 스텝 변경 시 해당 노드 포커스 (공유 헬퍼 재사용).
  // 초기 마운트(창 열림)에는 포커스하지 않는다 — 창을 열 때 캔버스가 이동하지 않도록. 스텝이 실제로 바뀔 때만 이동.
  const focusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = steps.length > 0 ? `${stepIndex}:${steps[stepIndex]?.node_id ?? ""}` : "";
    if (focusKeyRef.current === null || key === focusKeyRef.current) {
      focusKeyRef.current = key; // 첫 실행(마운트)·변화 없음(StrictMode 재호출) → 포커스 생략
      return;
    }
    focusKeyRef.current = key;
    if (steps.length > 0 && steps[stepIndex]) {
      onHighlightNode(steps[stepIndex].node_id);
    }
  }, [steps, stepIndex, onHighlightNode]);

  // 자동재생 — 2.5초 간격, 마지막 스텝에서 정지 (D5)
  useEffect(() => {
    if (!autoplay || steps.length === 0) return;
    if (stepIndex >= steps.length - 1) {
      // 주의: React Compiler가 이 컴포넌트를 bail-out 중이라 set-state-in-effect 룰이 침묵 — 재컴파일되면 표면화됨(disable 주석 필요)
      setAutoplay(false); // 마지막 스텝 도달 시 정지 — 기존 동작(세션 도입 전부터)
      return;
    }
    const timer = setTimeout(() => setStepIndex((index) => index + 1), 2500);
    return () => clearTimeout(timer);
  }, [autoplay, stepIndex, steps.length]);

  const send = async (override?: string) => {
    const instruction = (override ?? input).trim();
    if (!instruction || busy || !aiEnabled || isForeign) return;
    if (override === undefined) setInput("");
    setBusy(true);
    const targetSessionId = activeSessionId;
    const userMessage = createLocalMessage("user", instruction);
    const nextMessages: ChatMessage[] = [...messages, userMessage];
    setMessages(nextMessages);
    // 최근 6턴만 history로 전송
    const history: AiChatTurn[] = nextMessages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    try {
      const proposal = await aiChat(versionId, instruction, history, model || null, targetSessionId);
      // graph/ops/answer 활성 — 빈 message(핸들러 없는 kind)는 미지원 안내로 폴백 (규칙 ③b)
      const content = proposal.message || t("ai.unsupportedKind");
      // 응답 도착 시점에도 같은 세션을 보고 있을 때만 낙관 append — 전환했다면 서버 재로딩이 원장
      if (activeSessionIdRef.current === targetSessionId) {
        setMessages((prev) => [...prev, createLocalMessage("assistant", content)]);
        setFindings(proposal.kind === "analysis" ? proposal.findings : []);
        setSteps(proposal.kind === "walkthrough" ? proposal.steps : []);
        setStepIndex(0);
        setAutoplay(false);
      }
      if (
        targetSessionId === null &&
        proposal.session_id != null &&
        activeSessionIdRef.current === targetSessionId
      ) {
        // 신규 세션 채택 — 아직 새 대화를 보고 있을 때만(다른 대화로 이동했다면 끌어오지 않음).
        // 활성 전환은 메시지 재로딩(서버 원장)을 데려온다
        setActiveSessionId(proposal.session_id);
      }
      refreshSessions(); // 목록의 updated_at·건수 갱신
      if (proposal.kind === "graph") {
        onGraphProposal(proposal);
      } else if (proposal.kind === "ops") {
        onOpsProposal(proposal);
      }
    } catch (err) {
      if (activeSessionIdRef.current === targetSessionId) {
        // 서버 미저장 에러 표시 — 새로고침하면 사라지는 게 의도
        setMessages((prev) => [
          ...prev,
          createLocalMessage("assistant", err instanceof Error ? err.message : t("ai.error")),
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div className="flex h-full flex-col bg-surface">
      {models.length > 0 && (
        <div className="flex items-center gap-1 border-b border-hairline p-2">
          <span className="text-fine text-ink-tertiary">{t("ai.model")}</span>
          <select
            className="min-w-0 flex-1 rounded-sm border border-hairline px-1 py-0.5 text-fine"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            aria-label={t("ai.model")}
          >
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* 대화 전환 바 — 현재 맵의 서버 세션 드롭다운 + 새 대화(지연 생성). */}
      <div className="relative flex items-center gap-1 border-b border-hairline px-2 py-1.5">
        <button
          type="button"
          data-id="ai-chat-list"
          aria-label={t("ai.chatList")}
          onClick={() => setListOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-fine text-ink-secondary hover:bg-surface-alt hover:text-ink"
        >
          <History size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="truncate">{activeMeta?.title || t("ai.clearChat")}</span>
          <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        </button>
        {/* 폰트 상대 배율 −T＋ — 창 헤더에서 이동(새 대화 버튼과 자리 교환) */}
        <div
          data-id="ai-font-scale"
          className="flex shrink-0 items-center overflow-hidden rounded-sm border border-hairline"
        >
          <button
            type="button"
            title={t("ai.fontSmaller")}
            aria-label={t("ai.fontSmaller")}
            onClick={() =>
              onFontScaleChange?.(Math.max(0.8, Math.round((fontScale - 0.1) * 10) / 10))
            }
            className="px-1.5 py-0.5 text-ink-secondary hover:bg-surface-alt"
          >
            <Minus size={13} strokeWidth={1.8} />
          </button>
          <span className="px-1 text-fine text-ink-secondary">T</span>
          <button
            type="button"
            title={t("ai.fontLarger")}
            aria-label={t("ai.fontLarger")}
            onClick={() =>
              onFontScaleChange?.(Math.min(1.4, Math.round((fontScale + 0.1) * 10) / 10))
            }
            className="px-1.5 py-0.5 text-ink-secondary hover:bg-surface-alt"
          >
            <Plus size={13} strokeWidth={1.8} />
          </button>
        </div>
        {listOpen && (
          <>
            {/* 바깥 클릭 닫힘 — add-node-menu와 동일한 투명 오버레이 패턴 */}
            <div className="fixed inset-0 z-20" onClick={() => setListOpen(false)} />
            <div
              data-id="ai-chat-list-menu"
              className="absolute left-2 top-full z-30 mt-1 flex max-h-80 w-72 flex-col overflow-y-auto rounded-sm border border-hairline bg-surface p-1 shadow-lg"
            >
              <button
                type="button"
                data-id="ai-chat-new"
                onClick={startNewChat}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-fine text-ink-secondary hover:bg-surface-alt"
              >
                <Plus size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                <span className="min-w-0 flex-1 truncate text-left">{t("ai.clearChat")}</span>
                {activeSessionId === null && (
                  <Check size={13} strokeWidth={1.7} className="shrink-0 text-accent" />
                )}
              </button>
              {mapSessions.length === 0 && (
                <span className="px-2 py-1.5 text-fine text-ink-tertiary">{t("ai.noChats")}</span>
              )}
              {mapSessions.map((item) => (
                <div key={item.id} className="flex items-center">
                  <button
                    type="button"
                    data-id="ai-chat-list-item"
                    onClick={() => switchSession(item.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-fine hover:bg-surface-alt ${
                      item.id === activeSessionId ? "text-ink" : "text-ink-secondary"
                    }`}
                  >
                    <MessageSquare size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {item.title || t("ai.clearChat")}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-ink-tertiary">
                      {formatKstShort(item.updated_at)}
                    </span>
                    {item.id === activeSessionId && (
                      <Check size={13} strokeWidth={1.7} className="shrink-0 text-accent" />
                    )}
                  </button>
                  <button
                    type="button"
                    data-id="ai-chat-delete"
                    aria-label={t("ai.deleteChat")}
                    onClick={() => setDeleteTarget(item)}
                    className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-error"
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
              {otherSessions.length > 0 && (
                <>
                  <button
                    type="button"
                    data-id="ai-chat-other-toggle"
                    onClick={() => setOtherOpen((value) => !value)}
                    className="mt-1 flex items-center gap-1.5 rounded-sm border-t border-hairline px-2 py-1.5 text-fine text-ink-tertiary hover:bg-surface-alt"
                  >
                    <ChevronDown
                      size={12}
                      strokeWidth={1.5}
                      className={`shrink-0 transition-transform ${otherOpen ? "" : "-rotate-90"}`}
                    />
                    {t("ai.otherMaps")}
                    <span className="rounded-full bg-surface-alt px-1.5 tabular-nums">
                      {otherSessions.length}
                    </span>
                  </button>
                  {otherOpen &&
                    otherSessions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        data-id="ai-chat-other-item"
                        onClick={() => switchSession(item.id)}
                        className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-fine hover:bg-surface-alt ${
                          item.id === activeSessionId ? "text-ink" : "text-ink-secondary"
                        }`}
                      >
                        <MessageSquare
                          size={13}
                          strokeWidth={1.5}
                          className="shrink-0 text-ink-tertiary"
                        />
                        <span className="min-w-0 flex-1 truncate text-left">
                          <span className="text-ink-tertiary">{item.map_name}</span> · {item.title || t("ai.clearChat")}
                        </span>
                      </button>
                    ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 헤더 경계 근처 페이드 — 스크롤 시 내용이 선에서 끊기지 않고 흐려지는 효과 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-surface to-transparent" />
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          setShowToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
          if (el.scrollTop <= 4) beginLoadOlder(); // 상단 도달 → 이전 기록 청크 로딩
        }}
        onCopy={() => onToast?.(t("ai.copied"))}
        style={{ zoom: fontScale }}
        className="scrollbar-hidden min-h-0 flex-1 select-text overflow-y-auto p-3 pt-4"
      >
        {!aiEnabled && (
          <p className="mb-2 rounded-sm bg-surface-alt p-2 text-fine text-ink-tertiary">
            {t("ai.disabled")}
          </p>
        )}
        {aiEnabled && !canEdit && (
          <p className="mb-2 text-fine text-ink-tertiary">{t("ai.readOnly")}</p>
        )}
        {historyError && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-sm bg-surface-alt p-2 text-fine text-ink-secondary">
            {t("ai.historyError")}
            <button
              type="button"
              onClick={() => {
                setHistoryError(false);
                refreshSessions();
              }}
              className="rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink hover:bg-surface"
            >
              {t("ai.retry")}
            </button>
          </div>
        )}
        <ul data-id="ai-thread" className="flex flex-col gap-3">
          {/* 이전 기록 로딩 — 스피너 + 기능 팁 (스크롤 상단 도달 시) */}
          {loadingOlder && (
            <li data-id="ai-loading-older" className="flex flex-col items-center gap-1.5 py-2">
              <span className="flex items-center gap-1.5 text-fine text-ink-tertiary">
                <Loader2 size={14} strokeWidth={1.6} className="animate-spin text-accent" />
                {t("ai.loadingOlder")}
              </span>
              <span className="flex items-center gap-1.5 rounded-sm bg-accent-tint px-2 py-1 text-fine text-accent">
                <Lightbulb size={12} strokeWidth={1.6} className="shrink-0" />
                {tips.length > 0
                  ? tips[tipIndex % tips.length]
                  : t(TIP_KEYS[tipIndex % TIP_KEYS.length])}
              </span>
            </li>
          )}
          {messages.map((message) =>
            message.role === "user" ? (
              <li
                key={message.id}
                className="flex max-w-[80%] flex-col items-end gap-0.5 self-end"
              >
                <span className="whitespace-pre-wrap rounded-md rounded-br-sm bg-accent px-3 py-2 text-caption text-on-accent">
                  {message.content}
                </span>
                {message.at !== null && (
                  <span className="text-[10px] text-ink-tertiary">
                    {formatMessageTime(message.at)}
                  </span>
                )}
              </li>
            ) : (
              <li key={message.id} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
                  <Sparkles size={12} strokeWidth={1.5} />
                </span>
                <div className="flex min-w-0 max-w-[80%] flex-1 flex-col gap-0.5">
                  <MarkdownView
                    source={message.content}
                    className="min-w-0"
                    onCopy={() => onToast?.(t("ai.copied"))}
                  />
                  {message.at !== null && (
                    <span className="text-[10px] text-ink-tertiary">
                      {formatMessageTime(message.at)}
                    </span>
                  )}
                </div>
              </li>
            ),
          )}
          {busy && (
            <li className="flex items-center gap-2 text-fine text-ink-tertiary">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
                <Sparkles size={12} strokeWidth={1.5} />
              </span>
              {t("ai.thinking")}
            </li>
          )}
        </ul>
        {findings.length > 0 && (
          <div className="mt-3 flex max-w-[80%] flex-col gap-2">
            <span className="flex items-center gap-1.5 px-0.5 text-caption-strong text-ink">
              <Search size={14} strokeWidth={1.6} className="text-accent" />
              {t("ai.analysisTitle")}
              <span className="rounded-full bg-surface-alt px-1.5 text-fine text-ink-tertiary">
                {findings.length}
              </span>
            </span>
            {findings.map((finding, index) => {
              const sev = finding.severity;
              // 심각도별 좌측 레일·아이콘 톤 — high=경고 빨강, medium=액센트, low=중성
              const rail =
                sev === "high"
                  ? "border-l-error"
                  : sev === "medium"
                    ? "border-l-accent"
                    : "border-l-divider";
              const iconTone =
                sev === "high"
                  ? "bg-error/10 text-error"
                  : sev === "medium"
                    ? "bg-accent-tint text-accent"
                    : "bg-surface-alt text-ink-tertiary";
              return (
                // finding 클릭 → 해당 노드 캔버스 하이라이트 (D4: 설명+하이라이트만)
                <button
                  key={`finding-${index}`}
                  type="button"
                  className={`group flex w-full gap-2.5 rounded-[3px] border border-l-[3px] border-hairline ${rail} bg-surface p-2.5 text-left shadow-sm hover:bg-surface-alt disabled:opacity-60`}
                  onClick={() => onHighlightNode(finding.node_ids[0])}
                  disabled={finding.node_ids.length === 0}
                >
                  <span
                    className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${iconTone}`}
                  >
                    {sev === "high" ? (
                      <AlertTriangle size={14} strokeWidth={1.7} />
                    ) : (
                      <Info size={14} strokeWidth={1.7} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-caption-strong text-ink">{finding.category}</span>
                      <span
                        className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase ${
                          sev === "high" ? "bg-error/10 text-error" : "bg-surface-alt text-ink-tertiary"
                        }`}
                      >
                        {finding.severity}
                      </span>
                    </span>
                    <span className="mt-1 block text-fine leading-relaxed text-ink">
                      {finding.message}
                    </span>
                    {finding.suggestion && (
                      <span className="mt-1.5 flex items-start gap-1.5 rounded-xs bg-accent-tint px-2 py-1 text-fine text-accent">
                        <Lightbulb size={13} strokeWidth={1.6} className="mt-px shrink-0" />
                        <span>{finding.suggestion}</span>
                      </span>
                    )}
                  </span>
                  {finding.node_ids.length > 0 && (
                    <ArrowUpRight
                      size={14}
                      strokeWidth={1.5}
                      className="mt-px shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
        {steps.length > 0 && (
          <div className="mt-3 max-w-[80%] overflow-hidden rounded-sm border border-hairline bg-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-hairline bg-surface-alt px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-caption-strong text-ink">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint text-accent">
                  <Route size={13} strokeWidth={1.7} />
                </span>
                {t("ai.walkthrough")}
              </span>
              <div className="flex items-center gap-0.5">
                {/* 스텝 진행 도트 — 현재/완료/예정 */}
                <span className="mr-1.5 flex items-center gap-1">
                  {steps.map((step, i) => (
                    <span
                      key={step.order}
                      className={`h-1.5 w-1.5 rounded-full ${
                        i === stepIndex
                          ? "bg-accent"
                          : i < stepIndex
                            ? "bg-accent/40"
                            : "border border-hairline bg-surface-pearl"
                      }`}
                    />
                  ))}
                </span>
                <span className="mr-1 text-fine tabular-nums text-ink-tertiary">
                  {stepIndex + 1} / {steps.length}
                </span>
                <button
                  type="button"
                  aria-label={t("ai.prevStep")}
                  className="rounded-sm p-1 hover:bg-surface-pearl disabled:opacity-40"
                  onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                  disabled={stepIndex === 0}
                >
                  <ChevronLeft size={16} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label={t("ai.nextStep")}
                  className="rounded-sm p-1 hover:bg-surface-pearl disabled:opacity-40"
                  onClick={() =>
                    setStepIndex((index) => Math.min(steps.length - 1, index + 1))
                  }
                  disabled={stepIndex === steps.length - 1}
                >
                  <ChevronRight size={16} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label={t("ai.autoplay")}
                  className={`rounded-sm p-1 hover:bg-surface-pearl ${autoplay ? "text-accent" : ""}`}
                  onClick={() => setAutoplay((value) => !value)}
                >
                  {autoplay ? (
                    <Pause size={16} strokeWidth={1.5} />
                  ) : (
                    <Play size={16} strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-start gap-2 px-2.5 py-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-on-accent">
                {stepIndex + 1}
              </span>
              <p className="text-caption leading-relaxed text-ink">{steps[stepIndex]?.narration}</p>
            </div>
          </div>
        )}
        {/* graph/ops 제안 미리보기 — 캔버스에 적용된 미리보기를 채팅 안에서 커밋/취소 */}
        {aiPreviewActive && (
          <div className="mt-3 max-w-[80%] overflow-hidden rounded-sm border border-accent-tint-border bg-surface shadow-md">
            <div className="flex items-center gap-2 border-b border-accent-tint-border bg-accent-tint px-2.5 py-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-on-accent">
                <Sparkles size={12} strokeWidth={1.8} />
              </span>
              <span className="text-caption-strong text-accent">{t("ai.previewTitle")}</span>
            </div>
            <div className="p-2.5">
              <p className="text-fine leading-relaxed text-ink">{t("ai.previewHint")}</p>
              <div className="mt-2.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={onCommitPreview}
                  className="flex flex-1 items-center justify-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
                >
                  <Check size={14} strokeWidth={1.8} />
                  {t("ai.previewAdd")}
                </button>
                <button
                  type="button"
                  onClick={onDiscardPreview}
                  className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                >
                  {t("approvers.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {showToBottom && (
        <button
          type="button"
          aria-label={t("ai.toBottom")}
          onClick={() =>
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
          }
          className="absolute bottom-2 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-surface text-ink-secondary shadow-lg hover:bg-surface-alt hover:text-accent"
        >
          <ChevronDown size={16} strokeWidth={1.5} />
        </button>
      )}
      </div>
      <div className="border-t border-hairline p-2">
        {isForeign && activeMeta && (
          <div
            data-id="ai-foreign-banner"
            className="mb-2 flex items-center justify-between gap-2 rounded-sm bg-accent-tint p-2 text-fine text-accent"
          >
            <span className="min-w-0">{t("ai.foreignChat", { map: activeMeta.map_name })}</span>
            <button
              type="button"
              data-id="ai-open-map"
              onClick={() => router.push(`/maps/${activeMeta.map_id}?aiChat=${activeMeta.id}`)}
              className="shrink-0 rounded-sm bg-accent px-2.5 py-1 text-fine text-on-accent hover:bg-accent-focus"
            >
              {t("ai.openMap")}
            </button>
          </div>
        )}
        {/* 빠른 기능 — 첨부 + 아이콘 칩(호버 시 이름·설명 툴팁) */}
        <div className="mb-2 flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t("ai.attach")}
            title={t("ai.attach")}
            onClick={() => onToast?.(t("ai.comingSoon"))}
            disabled={!aiEnabled}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-hairline text-ink-tertiary hover:border-accent hover:text-accent disabled:opacity-40"
          >
            <Paperclip size={16} strokeWidth={1.5} />
          </button>
          <span className="mx-0.5 h-5 w-px bg-hairline" />
          {QUICK_CHIPS.map((chip) => (
            <div key={chip.key} className="group relative">
              <button
                type="button"
                disabled={!aiEnabled || busy || isForeign}
                onClick={() => void send(t(chip.key))}
                aria-label={t(chip.key)}
                className="flex h-9 w-9 items-center justify-center rounded-sm border border-hairline text-ink-secondary hover:border-accent hover:bg-accent-tint hover:text-accent disabled:opacity-40"
              >
                <chip.Icon size={16} strokeWidth={1.5} />
              </button>
              {/* 호버 툴팁 — 기능 이름 + 짧은 설명 */}
              <div className="pointer-events-none absolute bottom-full left-0 z-10 mb-1.5 hidden w-44 rounded-sm border border-hairline bg-surface p-2 shadow-lg group-hover:block">
                <div className="text-caption-strong text-ink">{t(chip.key)}</div>
                <div className="mt-0.5 text-fine leading-snug text-ink-tertiary">
                  {t(chip.descKey)}
                </div>
              </div>
            </div>
          ))}
          {/* 입력 잔여 링 — instruction 상한(2000자) 대비 사용률. 75% 주의(amber)·90% 경고(error) */}
          {(() => {
            const ratio = Math.min(1, input.length / MAX_INSTRUCTION_CHARS);
            const remaining = Math.max(0, MAX_INSTRUCTION_CHARS - input.length);
            const color = getUsageColor(ratio);
            const circumference = 2 * Math.PI * 9;
            return (
              <div
                data-id="ai-input-ring"
                className="group relative ml-auto flex h-9 shrink-0 items-center gap-1"
              >
                {ratio >= RING_CAUTION && (
                  <span className="text-fine tabular-nums text-ink-tertiary">{remaining}</span>
                )}
                <svg width="22" height="22" viewBox="0 0 22 22" className="-rotate-90">
                  <circle
                    cx="11"
                    cy="11"
                    r="9"
                    fill="none"
                    stroke="var(--color-hairline)"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx="11"
                    cy="11"
                    r="9"
                    fill="none"
                    stroke={color}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - ratio)}
                  />
                </svg>
                {/* 호버 툴팁 — 잔여 문자수 */}
                <div className="pointer-events-none absolute bottom-full right-0 z-10 mb-1.5 hidden whitespace-nowrap rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink shadow-lg group-hover:block">
                  {t("ai.inputRemaining", { n: remaining })}
                </div>
              </div>
            );
          })()}
        </div>
        {/* 입력 행 — 입력(자동 높이) + 전송 */}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            className="scrollbar-hidden max-h-32 min-h-[36px] flex-1 resize-none rounded-md border border-hairline px-3 py-2 text-caption outline-none focus:border-accent disabled:bg-surface-alt"
            rows={1}
            maxLength={MAX_INSTRUCTION_CHARS}
            placeholder={
              aiEnabled ? (isForeign ? t("ai.foreignPlaceholder") : t("ai.placeholder")) : t("ai.disabled")
            }
            value={input}
            disabled={!aiEnabled || isForeign}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // ⌘/Ctrl+Enter=전송, Enter=줄바꿈. IME 조합 중(한글)엔 전송하지 않음.
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-accent text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void send()}
            disabled={!aiEnabled || busy || input.trim().length === 0 || isForeign}
            aria-label={t("ai.send")}
          >
            <ArrowUp size={16} strokeWidth={1.8} />
          </button>
        </div>
        {/* 단축키 힌트 — keycap */}
        <div className="mt-1.5 flex gap-3 text-fine text-ink-tertiary">
          <span className="flex items-center gap-1">
            <kbd className="rounded-xs border border-hairline bg-surface-alt px-1 py-px text-[10px] text-ink-secondary">
              Enter
            </kbd>
            {t("ai.hintNewline")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded-xs border border-hairline bg-surface-alt px-1 py-px text-[10px] text-ink-secondary">
              ⌘/Ctrl
            </kbd>
            +
            <kbd className="rounded-xs border border-hairline bg-surface-alt px-1 py-px text-[10px] text-ink-secondary">
              Enter
            </kbd>
            {t("ai.hintSend")}
          </span>
        </div>
      </div>
    </div>
      {deleteTarget && (
        <ConfirmDialog
          icon={<Trash2 size={28} strokeWidth={1.5} />}
          title={t("ai.deleteChat")}
          message={t("ai.deleteChatMessage")}
          lines={[
            {
              icon: <MessageSquare size={14} strokeWidth={1.5} />,
              text: deleteTarget.title || t("ai.clearChat"),
              highlight: true,
            },
          ]}
          confirmLabel={t("ai.deleteChat")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            void deleteAiChatSession(target.id)
              .then(() => {
                if (activeSessionIdRef.current === target.id) switchSession(null);
                refreshSessions();
              })
              .catch((err: unknown) =>
                onToast?.(err instanceof Error ? err.message : t("ai.error")),
              );
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

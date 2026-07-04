"use client";

// 에디터 AI 채팅 패널 — 순서도 생성/편집 지시 + 사용법 안내 (design 2026-06-15)
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Paperclip,
  Pause,
  Play,
  Route,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MarkdownView } from "@/components/markdown-view";
import {
  aiChat,
  getAiModels,
  type AiChatTurn,
  type AiFinding,
  type AiProposal,
  type AiStep,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiChatPanelProps {
  versionId: number;
  aiEnabled: boolean;
  canEdit: boolean;
  onGraphProposal: (proposal: AiProposal) => void;
  onOpsProposal: (proposal: AiProposal) => void;
  onHighlightNode: (nodeId: string) => void;
  onToast?: (message: string) => void;
}

// 빠른 프롬프트 칩 — 클릭 시 해당 문구를 즉시 전송(i18n 라벨 = 프롬프트).
const QUICK_CHIPS = [
  "ai.chipAnalyze",
  "ai.chipSummarize",
  "ai.chipWalkthrough",
  "ai.chipImprove",
] as const;

export function AiChatPanel({
  versionId,
  aiEnabled,
  canEdit,
  onGraphProposal,
  onOpsProposal,
  onHighlightNode,
  onToast,
}: AiChatPanelProps) {
  const { t } = useI18n();
  // TEMP DEV SEED — R10 시각 확인용 샘플(표·태그·헤딩·코드·인용). R10 완료 후 `[]`로 되돌릴 것.
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "user", content: "이 프로젝트 아키텍처를 표랑 태그도 써서 마크다운으로 정리해줘." },
    {
      role: "assistant",
      content:
        "# BPM 아키텍처 요약\n\n프로세스맵을 그리는 웹 서비스입니다. 관련 태그: #frontend #backend #docker\n\n## 컨테이너 구성\n\n| 레이어 | 스택 | 역할 |\n| --- | --- | --- |\n| frontend | Next.js + React Flow | 캔버스·노드·엣지 편집 |\n| backend | FastAPI + SQLAlchemy | 맵/버전 CRUD·검증 |\n| db | PostgreSQL | 맵·노드·엣지 영속 |\n| proxy | nginx | `/`→front, `/api`→back |\n\n## 경계\n\n- 브라우저 → **:3333**(nginx) → (Next.js | FastAPI) → PostgreSQL\n- 입력 검증은 *backend API 경계*에서만\n\n```ts\n// nginx 라우팅 예시\nlocation /api { proxy_pass http://backend:8000; }\n```\n\n> 로컬은 네이티브 실행, 서버는 docker-compose로 배포합니다.",
    },
    { role: "user", content: "권한 롤은 어떻게 나뉘어? #rbac" },
    {
      role: "assistant",
      content:
        "## 권한 롤\n\n역할별 권한 요약입니다. 태그: #rbac #security\n\n| 롤 | 맵 편집 | 승인 | 유저관리 |\n| --- | --- | --- | --- |\n| viewer | ✕ | ✕ | ✕ |\n| editor | ○ | ✕ | ✕ |\n| approver | ○ | ○ | ✕ |\n| sysadmin | ○ | ○ | ○ |\n\n### 승인 워크플로\n\n1. editor가 버전 작성 → **제출**\n2. approver가 검토 → 승인/반려\n3. 승인 시 게시(가시성 반영)\n\n주의할 점:\n\n- 점유권(checkout)은 편집자 1인 배타적\n- 반려 시 요청자에게 회수 알림\n\n#### 참고\n\n- 타임스탬프는 **KST**(`clock.now()`)\n- id는 `genId()` 사용(`crypto.randomUUID` 금지)\n\n> 권한 검증은 backend에서 강제합니다(`DEV_ENFORCE_PERMISSIONS`).\n\n---\n\n자세한 건 [권한 문서](https://example.com/rbac)를 참고하세요.",
    },
    { role: "user", content: "테스트랑 빌드는 어떤 명령으로 돌려?" },
    {
      role: "assistant",
      content:
        "## 테스트 · 빌드\n\n태그: #testing #ci\n\n| 대상 | 명령 | 비고 |\n| --- | --- | --- |\n| backend | `pytest tests/ -q` | AAA 패턴 |\n| frontend | `npm run lint` | strict TS |\n| build | `npm run build` | standalone |\n\n- 외부 의존성은 **목킹**, 내부 로직은 실제 경로로 검증\n- 커밋 전 전체 스위트, 개발 중엔 단건\n\n```bash\n.venv/bin/python -m pytest tests/test_maps.py -q\n```\n\n각 코드 행은 더블클릭, 인라인 `코드`는 클릭으로 복사됩니다.",
    },
    { role: "user", content: "노드 속성 전체를 아주 넓은 표로 보여줘. #wide" },
    {
      role: "assistant",
      content:
        "## 노드 속성 매트릭스\n\n좌우로 스크롤되는 넓은 표입니다. 태그: #wide #table #overflow\n\n| ID | 노드 | 유형 | 담당부서 | 담당자 | 담당자ID | 상태 | 색상 | 선행 | 후행 | 우선순위 | 예상시간 | 실제시간 | 리스크 | SLA | 승인자 | 코멘트 | 생성일 | 최종수정 | 버전 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| N01 | Start | event | 공정기획팀 | 김민수 | user.kms | 승인 | slate | - | 접수 | 높음 | 0.5h | 0.4h | 하 | 24h | 최유진 | 프로세스의 시작 지점으로 외부 트리거를 수신한다 | 2026-06-20 | 2026-07-01 | v5 |\n| N02 | 접수 | task | 영업관리팀 | 이서연 | user.lsy | 검토중 | teal | Start | 검증 | 보통 | 2.0h | 2.5h | 중 | 48h | 최유진 | 고객 요청을 접수하여 담당 부서로 라우팅한다 | 2026-06-21 | 2026-07-02 | v5 |\n| N03 | 검증 | task | 품질보증팀 | 박지훈 | user.pjh | 반려 | amber | 접수 | 승인 | 높음 | 3.0h | 4.0h | 상 | 8h | 최유진 | 입력 데이터의 정합성과 필수값을 검증한다 | 2026-06-22 | 2026-07-03 | v5 |\n| N04 | 승인 | decision | 경영지원팀 | 최유진 | user.cyj | 승인 | violet | 검증 | End | 긴급 | 1.0h | 0.8h | 상 | 4h | 대표이사 | 최종 승인 게이트를 통과시키고 게시한다 | 2026-06-23 | 2026-07-04 | v5 |\n| N05 | End | event | 공정기획팀 | 김민수 | user.kms | 승인 | rose | 승인 | - | 낮음 | 0.2h | 0.2h | 하 | 24h | 최유진 | 프로세스 종료 지점으로 결과를 기록한다 | 2026-06-20 | 2026-07-04 | v5 |\n\n표가 대화창 80% 폭을 넘으면 내부에서 좌우로 스크롤됩니다. 마지막 줄까지 스크롤하면 우하단 **맨 아래로** 버튼이 사라집니다.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  // TEMP DEV SEED — R10b 카드 확인용. 확인 후 `[]`로 되돌릴 것.
  const [findings, setFindings] = useState<AiFinding[]>([
    { severity: "high", category: "validation", node_ids: ["n1"], message: "시작 노드에 선행 연결이 없어 흐름이 끊깁니다.", suggestion: "Start를 접수 노드와 연결하세요." },
    { severity: "medium", category: "naming", node_ids: ["n2"], message: "노드 라벨이 모호합니다(‘task’).", suggestion: "동사+목적어 형태로 구체화하세요." },
    { severity: "low", category: "layout", node_ids: [], message: "분기 간격이 좁아 가독성이 떨어집니다.", suggestion: "" },
  ]); // 최근 analysis 결과 (Phase 4)
  const [steps, setSteps] = useState<AiStep[]>([
    { order: 1, node_id: "n1", narration: "Start — 외부 트리거를 수신해 프로세스를 개시합니다." },
    { order: 2, node_id: "n2", narration: "접수 — 고객 요청을 담당 부서로 라우팅합니다." },
    { order: 3, node_id: "n3", narration: "검증 — 입력 데이터의 정합성을 확인합니다." },
  ]); // 워크스루 단계 (Phase 5)
  const [stepIndex, setStepIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 스레드가 하단에서 떨어져 있으면 "맨 아래로" 버튼 노출.
  const [showToBottom, setShowToBottom] = useState(false);

  // 새 메시지·생각중 표시가 추가되면 항상 최신(하단)으로 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy]);

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
      setAutoplay(false);
      return;
    }
    const timer = setTimeout(() => setStepIndex((index) => index + 1), 2500);
    return () => clearTimeout(timer);
  }, [autoplay, stepIndex, steps.length]);

  const send = async (override?: string) => {
    const instruction = (override ?? input).trim();
    if (!instruction || busy || !aiEnabled) return;
    if (override === undefined) setInput("");
    setBusy(true);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: instruction }];
    setMessages(nextMessages);
    // 최근 6턴만 history로 전송
    const history: AiChatTurn[] = nextMessages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    try {
      const proposal = await aiChat(versionId, instruction, history, model || null);
      // graph/ops/answer 활성 — 빈 message(핸들러 없는 kind)는 미지원 안내로 폴백 (규칙 ③b)
      const content = proposal.message || t("ai.unsupportedKind");
      setMessages((prev) => [...prev, { role: "assistant", content }]);
      setFindings(proposal.kind === "analysis" ? proposal.findings : []);
      setSteps(proposal.kind === "walkthrough" ? proposal.steps : []);
      setStepIndex(0);
      setAutoplay(false);
      if (proposal.kind === "graph") {
        onGraphProposal(proposal);
      } else if (proposal.kind === "ops") {
        onOpsProposal(proposal);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: err instanceof Error ? err.message : t("ai.error") },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
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
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) setShowToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
        }}
        onCopy={() => onToast?.(t("ai.copied"))}
        className="scrollbar-hidden min-h-0 flex-1 select-text overflow-y-auto p-3"
      >
        {!aiEnabled && (
          <p className="mb-2 rounded-sm bg-surface-alt p-2 text-fine text-ink-tertiary">
            {t("ai.disabled")}
          </p>
        )}
        {aiEnabled && !canEdit && (
          <p className="mb-2 text-fine text-ink-tertiary">{t("ai.readOnly")}</p>
        )}
        <ul className="flex flex-col gap-3">
          {messages.map((message, index) =>
            message.role === "user" ? (
              <li
                key={`${message.role}-${index}`}
                className="max-w-[80%] self-end whitespace-pre-wrap rounded-md rounded-br-sm bg-accent px-3 py-2 text-caption text-on-accent"
              >
                {message.content}
              </li>
            ) : (
              <li key={`${message.role}-${index}`} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
                  <Sparkles size={12} strokeWidth={1.5} />
                </span>
                <MarkdownView
                  source={message.content}
                  className="min-w-0 max-w-[80%] flex-1"
                  onCopy={() => onToast?.(t("ai.copied"))}
                />
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
          <div className="mt-3 flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 px-0.5 text-fine text-ink-tertiary">
              <Search size={13} strokeWidth={1.5} />
              {t("ai.analysisTitle")}
            </span>
            {findings.map((finding, index) => {
              const isHigh = finding.severity === "high";
              return (
                // finding 클릭 → 해당 노드 캔버스 하이라이트 (D4: 설명+하이라이트만)
                <button
                  key={`finding-${index}`}
                  type="button"
                  className="group flex w-full gap-2 rounded-sm border border-hairline bg-surface-alt p-2 text-left hover:bg-surface-pearl disabled:opacity-60"
                  onClick={() => onHighlightNode(finding.node_ids[0])}
                  disabled={finding.node_ids.length === 0}
                >
                  <span className={`mt-px shrink-0 ${isHigh ? "text-error" : "text-ink-tertiary"}`}>
                    {isHigh ? (
                      <AlertTriangle size={15} strokeWidth={1.6} />
                    ) : (
                      <Info size={15} strokeWidth={1.6} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-caption-strong text-ink">{finding.category}</span>
                      <span
                        className={`rounded-full px-1.5 py-px text-fine ${
                          isHigh ? "bg-error/10 text-error" : "bg-surface-pearl text-ink-tertiary"
                        }`}
                      >
                        {finding.severity}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-fine text-ink">{finding.message}</span>
                    {finding.suggestion && (
                      <span className="mt-1 block border-l-2 border-accent-tint-border pl-2 text-fine text-ink-tertiary">
                        {finding.suggestion}
                      </span>
                    )}
                  </span>
                  {finding.node_ids.length > 0 && (
                    <ArrowUpRight
                      size={13}
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
          <div className="mt-3 overflow-hidden rounded-sm border border-hairline bg-surface-alt">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="flex items-center gap-1.5 text-caption-strong text-ink">
                <Route size={14} strokeWidth={1.5} className="text-accent" />
                {t("ai.walkthrough")}
              </span>
              <div className="flex items-center gap-0.5">
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
            {/* 진행바 — 현재 스텝 비율 */}
            <div className="h-0.5 bg-surface-pearl">
              <div
                className="h-full bg-accent transition-all duration-350"
                style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
              />
            </div>
            <p className="px-2 py-2 text-fine text-ink">{steps[stepIndex]?.narration}</p>
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
        {/* 빠른 프롬프트 칩 — 클릭 시 즉시 전송 */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_CHIPS.map((chipKey) => (
            <button
              key={chipKey}
              type="button"
              disabled={!aiEnabled || busy}
              onClick={() => void send(t(chipKey))}
              className="rounded-full border border-hairline px-2.5 py-1 text-fine text-ink-secondary hover:border-accent hover:bg-accent-tint hover:text-accent disabled:opacity-40"
            >
              {t(chipKey)}
            </button>
          ))}
        </div>
        {/* 입력 행 — 첨부 + 입력 + 전송 (첨부는 디자인 플레이스홀더) */}
        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label={t("ai.attach")}
            title={t("ai.attach")}
            onClick={() => onToast?.(t("ai.comingSoon"))}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-hairline text-ink-tertiary hover:border-accent hover:text-accent disabled:opacity-40"
            disabled={!aiEnabled}
          >
            <Paperclip size={16} strokeWidth={1.5} />
          </button>
          <textarea
            className="scrollbar-hidden max-h-32 min-h-[36px] flex-1 resize-none rounded-md border border-hairline px-3 py-2 text-caption outline-none focus:border-accent disabled:bg-surface-alt"
            rows={1}
            placeholder={aiEnabled ? t("ai.placeholder") : t("ai.disabled")}
            value={input}
            disabled={!aiEnabled}
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
            disabled={!aiEnabled || busy || input.trim().length === 0}
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
  );
}

"use client";

// 사용 매뉴얼 뷰어 — 다중 문서(F10): 제목 드롭다운(맵 제목 버튼식)으로 현재 한/영 토글에 맞는 목록 노출.
// 언어 전환 시 직전 문서와 같은 순번의 문서를 열어 유지(한/영 페어 동일 소팅 가정). 문서가 없으면 번들 manual.md fallback.
// 좌 TOC(H2/H3 파생) + 우 MarkdownView. 본문검색(/ 포커스)·읽기폭·본문 한정 읽기 테마 토글. (design 2026-07-05)

import { ChevronDown, Contrast, MoveHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getManual,
  getManualDoc,
  listManualDocs,
  type ManualDoc,
  type ManualDocSummary,
  type ManualLang,
} from "@/lib/api";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { useSlashFocus } from "@/lib/use-slash-focus";
import { HtmlView } from "@/components/html-view";
import { MarkdownView } from "@/components/markdown-view";
import { SearchBox } from "@/components/search-box";
import { TimePills } from "@/components/time-pills";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { Tooltip } from "@/components/tooltip";

interface TocEntry {
  level: 2 | 3;
  text: string;
}

// 본문에서 H2/H3만 목차로 파생 — 펜스 코드블록 내부의 #는 제외.
function parseToc(md: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let inCode = false;
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    if (/^```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = raw.match(/^(#{2,3})\s+(.+)$/);
    if (m) {
      entries.push({
        level: m[1].length as 2 | 3,
        text: m[2].replace(/[*`_]/g, "").trim(),
      });
    }
  }
  return entries;
}

export default function ManualPage() {
  const { t, lang } = useI18n();
  const [doc, setDoc] = useState<(ManualDoc & { title?: string }) | null>(null);
  // 현재 언어의 문서 목록 + 선택 문서 — 드롭다운(F10). null=로딩 전.
  const [docList, setDocList] = useState<ManualDocSummary[] | null>(null);
  const [docId, setDocId] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // 직전에 열려 있던 문서의 목록 내 순번 — 언어 전환 시 같은 순번 문서를 연다
  const docIndexRef = useRef(0);
  const [search, setSearch] = useState("");
  const [matchPos, setMatchPos] = useState(-1);
  const [activeToc, setActiveToc] = useState(-1);
  const [readWide, setReadWide] = useState(false);
  const [readTheme, setReadTheme] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 현재 지속 강조 중인 매치 블록 — 다음 매치 이동/검색 변경 시 해제 대상
  const highlightedRef = useRef<HTMLElement | null>(null);
  useSlashFocus(searchRef);

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((toast) => toast.id !== id));
  // useCallback으로 안정 참조 유지 — renderedBody(useMemo) 재계산을 막아 검색 강조가 유지되도록.
  // t는 컨텍스트 값이라 ManualPage 자체 리렌더 간 불변.
  const notifyCopied = useCallback(
    () => setToasts((prev) => [{ id: genId(), message: t("ai.copied") }, ...prev]),
    [t],
  );

  // 언어(한/영 토글) 기준 목록 로드 — 전환 시 직전 순번의 문서를 열어 문맥 유지 (F10)
  useEffect(() => {
    let alive = true;
    listManualDocs(lang as ManualLang).then((rows) => {
      if (!alive) return;
      setDocList(rows);
      if (rows.length === 0) {
        // 등록 문서 없음 — 번들 manual.md 단일 문서 fallback (기존 동작)
        setDocId(null);
        getManual().then((data) => {
          if (alive) setDoc(data);
        });
        return;
      }
      const index = Math.min(docIndexRef.current, rows.length - 1);
      docIndexRef.current = index;
      setDocId(rows[index].id);
    });
    return () => {
      alive = false;
    };
  }, [lang]);

  // 선택 문서 로드 + 순번 기록
  useEffect(() => {
    if (docId === null) return;
    let alive = true;
    getManualDoc(docId).then((data) => {
      if (alive) setDoc(data);
    });
    return () => {
      alive = false;
    };
  }, [docId]);

  const content = doc?.content ?? "";
  const isHtml = doc?.format === "html";
  // TOC는 마크다운 헤딩에서 파생 — html 게시본은 헤딩 파싱 대상이 아니라 TOC 없이 전폭 렌더.
  const toc = parseToc(content);
  // 본문 엘리먼트를 content 기준 메모이즈 — 검색 매치 이동 등 다른 state 변경으로 ManualPage가
  // 리렌더돼도 dangerouslySetInnerHTML이 재주입되지 않도록(=검색 강조가 유지되도록).
  // 포맷=html이면 DOMPurify로 정화한 HtmlView, 아니면 자체 파서 MarkdownView.
  const renderedBody = useMemo(
    () =>
      isHtml ? (
        <HtmlView source={content} />
      ) : (
        <MarkdownView source={content} onCopy={notifyCopied} />
      ),
    [isHtml, content, notifyCopied],
  );

  // 목차 클릭 → 렌더된 N번째 헤딩으로 스크롤 (TOC와 동일 필터라 인덱스 일치)
  const scrollToHeading = (index: number) => {
    setActiveToc(index);
    const headings = bodyRef.current?.querySelectorAll("h2, h3");
    headings?.[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 직전에 강조한 매치 블록의 인라인 강조 해제 (다음 매치 이동·검색어 변경·검색 해제 시 호출)
  const clearHighlight = () => {
    const prev = highlightedRef.current;
    if (prev) {
      prev.style.backgroundColor = "";
      prev.style.borderRadius = "";
      highlightedRef.current = null;
    }
  };

  // 본문검색 — 매치 블록으로 순환 스크롤 + 강조 유지(다음 매치로 이동하거나 검색을 바꾸거나 해제할 때까지 지속)
  const jumpToMatch = () => {
    const q = search.trim().toLowerCase();
    const root = bodyRef.current;
    if (!q || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits: HTMLElement[] = [];
    let node = walker.nextNode();
    while (node) {
      if (node.textContent?.toLowerCase().includes(q) && node.parentElement) {
        if (!hits.includes(node.parentElement)) hits.push(node.parentElement);
      }
      node = walker.nextNode();
    }
    if (hits.length === 0) return;
    const next = (matchPos + 1) % hits.length;
    setMatchPos(next);
    const el = hits[next];
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    clearHighlight(); // 이전 매치 강조를 지운 뒤 현재 매치만 지속 강조
    el.style.backgroundColor = "var(--color-accent-tint)";
    el.style.borderRadius = "4px";
    highlightedRef.current = el;
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-8 py-6">
      <div className="mx-auto flex min-h-0 w-full max-w-[80rem] flex-1 flex-col gap-4">
        {/* 헤더 — 타이틀+메타(좌) · 본문검색(중) · 읽기 도구(우) */}
        <div className="flex shrink-0 items-center gap-4">
          <div className="flex items-center gap-2">
            {/* 제목 = 문서 드롭다운(맵 제목 버튼식) — 현재 한/영 토글에 맞는 목록 노출 (F10).
                등록 문서가 없으면(번들 fallback) 기존 정적 타이틀 유지 */}
            {docList && docList.length > 0 ? (
              <div className="relative">
                {/* 맵 화면 제목 드롭다운과 동일한 테두리 버튼 — 긴 제목은 말줄임 (F11) */}
                <button
                  type="button"
                  data-id="manual-doc-dropdown"
                  className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-body-strong text-ink hover:bg-surface-alt"
                  aria-haspopup="listbox"
                  aria-expanded={listOpen}
                  onClick={() => setListOpen((v) => !v)}
                >
                  <span className="max-w-[20rem] truncate">
                    {doc?.title || t("manual.title")}
                  </span>
                  <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                </button>
                {listOpen && (
                  <>
                    <div className="fixed inset-0 z-[1000]" onClick={() => setListOpen(false)} />
                    <div className="absolute left-0 z-[1001] mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-hairline bg-surface py-1 shadow-lg">
                      {docList.map((row, index) => (
                        <button
                          key={row.id}
                          type="button"
                          className={
                            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption hover:bg-surface-alt " +
                            (row.id === docId ? "text-accent" : "text-ink")
                          }
                          onClick={() => {
                            docIndexRef.current = index;
                            setDocId(row.id);
                            setListOpen(false);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{row.title}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <h1 className="text-tagline text-ink">{t("manual.title")}</h1>
            )}
            {doc &&
              (doc.updated_at ? (
                <span className="flex items-center gap-1">
                  <span className="text-fine text-ink-tertiary">{t("manual.updated")}</span>
                  <TimePills iso={doc.updated_at} nowMs={nowMs} />
                </span>
              ) : (
                <span className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary">
                  {t("manual.bundled")}
                </span>
              ))}
          </div>

          {/* 검색은 본문 상단 중앙으로 이동(F11) — 헤더는 제목(좌)·읽기 도구(우)만 */}
          <div className="flex-1" />

          {/* 읽기 도구 — 읽기폭·본문 한정 읽기 테마 */}
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip label={t("manual.readWidth")}>
              <button
                type="button"
                aria-pressed={readWide}
                onClick={() => setReadWide((v) => !v)}
                className={
                  "rounded-sm p-1.5 " +
                  (readWide
                    ? "bg-accent-tint text-accent"
                    : "text-ink-tertiary hover:bg-surface-alt hover:text-ink")
                }
              >
                <MoveHorizontal size={16} strokeWidth={1.5} />
              </button>
            </Tooltip>
            <Tooltip label={t("manual.readTheme")}>
              <button
                type="button"
                aria-pressed={readTheme}
                onClick={() => setReadTheme((v) => !v)}
                className={
                  "rounded-sm p-1.5 " +
                  (readTheme
                    ? "bg-accent-tint text-accent"
                    : "text-ink-tertiary hover:bg-surface-alt hover:text-ink")
                }
              >
                <Contrast size={16} strokeWidth={1.5} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* TOC(좌) | 본문(우) — 헤딩이 없으면(html 게시본 등) TOC 숨기고 본문 전폭 */}
        <div className="flex min-h-0 flex-1 gap-4">
          {toc.length > 0 && (
          <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-hairline pr-3 md:flex">
            <span className="mb-2 px-2 text-caption-strong text-ink-secondary">
              {t("manual.toc")}
            </span>
            <nav className="flex flex-col gap-0.5">
              {toc.map((entry, index) => (
                <button
                  key={`${index}-${entry.text}`}
                  type="button"
                  onClick={() => scrollToHeading(index)}
                  className={
                    "truncate rounded-xs px-2 py-1 text-left text-caption transition-colors " +
                    (entry.level === 3 ? "pl-5 " : "") +
                    (index === activeToc
                      ? "bg-accent-tint text-accent"
                      : "text-ink-secondary hover:bg-surface-alt hover:text-ink")
                  }
                >
                  {entry.text}
                </button>
              ))}
            </nav>
          </aside>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            {/* 본문검색 — 본문 영역 최상단 가운데 (F11) */}
            <div className="flex shrink-0 justify-center pb-3">
              <SearchBox
                className="w-full max-w-md"
                value={search}
                onChange={(value) => {
                  clearHighlight();
                  setSearch(value);
                  setMatchPos(-1);
                }}
                placeholder={t("manual.searchPlaceholder")}
                inputRef={searchRef}
                onEnter={jumpToMatch}
                dataId="manual-search"
              />
            </div>
            <article
              ref={bodyRef}
              className={
                "min-w-0 flex-1 overflow-y-auto px-6 py-4 " +
                // 본문 한정 읽기 테마 — 라이트 전용·토큰 제약상 다크 대신 warm paper 패널(테두리+그림자로 명확히 구분)
                (readTheme
                  ? "rounded-md border border-hairline bg-surface-pearl shadow-md"
                  : "rounded-sm")
              }
            >
              <div className={"mx-auto " + (readWide ? "max-w-none" : "max-w-[46rem]")}>
                {content === "" ? (
                  <p className="text-caption text-ink-tertiary">{t("manual.empty")}</p>
                ) : (
                  renderedBody
                )}
              </div>
            </article>
          </div>
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

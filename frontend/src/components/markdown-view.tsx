"use client";

// 마크다운 뷰어 — AI 답변·게시글·매뉴얼 공용. 경량 자체 파서(의존성 無): 헤딩(H1~H3)·리스트(정렬/비정렬)·
// 코드블록/인라인코드·인용·수평선·링크·강조/기울임. 코드블록 hover 복사, 블록별 hover 하이라이트(현재 위치).
// 출력은 esc(< > &) 처리 후 dangerouslySetInnerHTML — 스타일은 globals.css `.md`.

import { useCallback } from "react";

const COPY_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 링크 href sanitize — http(s)/상대/앵커/mailto만 허용, javascript:·data: 등은 차단(XSS 방지).
function safeHref(url: string): string {
  return /^(https?:\/\/|\/|#|mailto:)/i.test(url.trim()) ? url : "#";
}

// 인라인 서식(escape 후 적용) — 코드/굵게/기울임/링크. 텍스트는 이미 escape되어 raw HTML 주입 불가.
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, text: string, url: string) =>
        `<a href="${safeHref(url)}" target="_blank" rel="noreferrer">${text}</a>`,
    );
}

function markdownToHtml(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      let code = "";
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code += lines[i] + "\n";
        i++;
      }
      i++;
      html += `<div class="md-codewrap"><pre><code>${escapeHtml(
        code.replace(/\n$/, ""),
      )}</code></pre><button class="md-copy" type="button" aria-label="Copy">${COPY_ICON}</button></div>`;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      html += "<hr>";
      i++;
      continue;
    }
    if (/^#{1,3}\s/.test(l)) {
      const h = l.match(/^#+/)![0].length;
      html += `<h${h}>${inline(l.replace(/^#+\s/, ""))}</h${h}>`;
      i++;
      continue;
    }
    if (/^>\s?/.test(l)) {
      let q = "";
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        q += lines[i].replace(/^>\s?/, "") + " ";
        i++;
      }
      html += `<blockquote>${inline(q.trim())}</blockquote>`;
      continue;
    }
    if (/^\s*[-*]\s/.test(l)) {
      let items = "";
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items += `<li>${inline(lines[i].replace(/^\s*[-*]\s/, ""))}</li>`;
        i++;
      }
      html += `<ul>${items}</ul>`;
      continue;
    }
    if (/^\s*\d+\.\s/.test(l)) {
      let items = "";
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items += `<li>${inline(lines[i].replace(/^\s*\d+\.\s/, ""))}</li>`;
        i++;
      }
      html += `<ol>${items}</ol>`;
      continue;
    }
    if (l.trim() === "") {
      i++;
      continue;
    }
    let p = l;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3}\s|>|\s*[-*]\s|\s*\d+\.\s|```|-{3,}\s*$)/.test(lines[i])
    ) {
      p += " " + lines[i];
      i++;
    }
    html += `<p>${inline(p)}</p>`;
  }
  return html;
}

export function MarkdownView({ source, className = "" }: { source: string; className?: string }) {
  // 코드블록 복사 — dangerouslySetInnerHTML라 컨테이너에서 위임 처리.
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const btn = (event.target as HTMLElement).closest(".md-copy");
    if (!btn) return;
    const code = btn.parentElement?.querySelector("code")?.textContent ?? "";
    void navigator.clipboard?.writeText(code);
    btn.classList.add("md-copy-done");
    window.setTimeout(() => btn.classList.remove("md-copy-done"), 1200);
  }, []);

  return (
    <div
      className={`md ${className}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: markdownToHtml(source) }}
    />
  );
}

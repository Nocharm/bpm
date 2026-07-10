"use client";

// 마크다운 뷰어 — AI 답변·게시글·매뉴얼 공용. 경량 자체 파서(의존성 無): 헤딩(H1~H3)·리스트(정렬/비정렬)·
// 코드블록/인라인코드·인용·수평선·링크·강조/기울임. 코드블록 hover 복사, 블록별 hover 하이라이트(현재 위치).
// 출력은 esc(< > &) 처리 후 dangerouslySetInnerHTML — 스타일은 globals.css `.md`.

import { copyText } from "@/lib/clipboard";

const COPY_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 링크 href sanitize — http(s)/상대/앵커/mailto만 허용, javascript:·data: 차단.
// 공백·제어문자·따옴표/꺾쇠 포함 URL도 거부(href 속성 탈출 XSS 방지).
function safeHref(url: string): string {
  const trimmed = url.trim();
  if (/[\s"'<>`]/.test(trimmed)) return "#";
  return /^(https?:\/\/|\/|#|mailto:)/i.test(trimmed) ? trimmed : "#";
}

// 속성값 인코딩 — 따옴표를 엔티티로(속성 탈출 방지). <>&는 escapeHtml에서 이미 처리됨.
function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
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
        `<a href="${escapeAttr(safeHref(url))}" target="_blank" rel="noreferrer">${text}</a>`,
    )
    // 인라인 태그 필 — 공백/시작 뒤 #word 를 알약 뱃지로(#는 표기에서 제거).
    // -·. 는 영숫자 사이에서만 허용(#v2.4 → v2.4, 문장 끝 마침표 "#tag." 는 제외).
    .replace(
      /(^|\s)#([0-9A-Za-z_가-힣](?:[-.]?[0-9A-Za-z_가-힣])*)/g,
      '$1<span class="md-tag">$2</span>',
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
      // 행 단위 span — 더블클릭 시 해당 행만 복사. `\n` join으로 textContent(=전체 복사)·빈 행 보존.
      const codeLines = code
        .replace(/\n$/, "")
        .split("\n")
        .map((ln) => `<span class="md-codeline">${escapeHtml(ln)}</span>`)
        .join("\n");
      html += `<div class="md-codewrap"><pre><code>${codeLines}</code></pre><button class="md-copy" type="button" aria-label="Copy">${COPY_ICON}</button></div>`;
      continue;
    }
    // GFM 표 — 헤더행 + 구분행(---) + 본문행. 구분행은 파이프 포함 필수(hr와 구분).
    const next = lines[i + 1];
    if (
      /\|/.test(l) &&
      next !== undefined &&
      /\|/.test(next) &&
      /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(next)
    ) {
      const splitCells = (row: string): string[] =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const head = splitCells(l)
        .map((c) => `<th>${inline(c)}</th>`)
        .join("");
      i += 2;
      let body = "";
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") {
        body +=
          "<tr>" +
          splitCells(lines[i])
            .map((c) => `<td>${inline(c)}</td>`)
            .join("") +
          "</tr>";
        i++;
      }
      html += `<div class="md-tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      html += "<hr>";
      i++;
      continue;
    }
    if (/^#{1,6}\s/.test(l)) {
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
      !/^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s|```|-{3,}\s*$)/.test(lines[i])
    ) {
      p += " " + lines[i];
      i++;
    }
    html += `<p>${inline(p)}</p>`;
  }
  return html;
}

// 복사 후 짧은 강조 플래시.
function flashCopied(el: Element): void {
  el.classList.add("md-copied");
  window.setTimeout(() => el.classList.remove("md-copied"), 700);
}

export function MarkdownView({
  source,
  className = "",
  onCopy,
}: {
  source: string;
  className?: string;
  onCopy?: () => void; // 복사 성공 시 호출(토스트 등). 프로그램 복사라 네이티브 copy 이벤트는 안 뜬다.
}) {
  // 클릭 위임(dangerouslySetInnerHTML) — ①코드블록 복사 버튼 ②인라인 코드 클릭 복사.
  // 복사 실패(서버는 insecure context) 시에는 성공 표시도 onCopy도 내지 않는다.
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const btn = target.closest(".md-copy");
    if (btn) {
      const code = btn.parentElement?.querySelector("code")?.textContent ?? "";
      void copyText(code).then((ok) => {
        if (!ok) return;
        btn.classList.add("md-copy-done");
        window.setTimeout(() => btn.classList.remove("md-copy-done"), 1200);
        onCopy?.();
      });
      return;
    }
    // 인라인 코드(pre 밖의 code) 클릭 → 텍스트 복사.
    const codeEl = target.closest("code");
    if (codeEl && !codeEl.closest("pre")) {
      void copyText(codeEl.textContent ?? "").then((ok) => {
        if (!ok) return;
        flashCopied(codeEl);
        onCopy?.();
      });
    }
  };

  // 코드블록 행 더블클릭 → 해당 행만 복사.
  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const line = (event.target as HTMLElement).closest(".md-codeline");
    if (!line) return;
    void copyText(line.textContent ?? "").then((ok) => {
      if (!ok) return;
      flashCopied(line);
      onCopy?.();
    });
  };

  return (
    <div
      className={`md ${className}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      dangerouslySetInnerHTML={{ __html: markdownToHtml(source) }}
    />
  );
}

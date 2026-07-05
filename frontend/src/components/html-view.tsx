"use client";

// 게시된 HTML 매뉴얼 렌더 — 포맷=html 게시본용. DOMPurify로 XSS 제거 후 `.md` 타이포로 표시.
// 마크다운 게시본은 markdown-view(자체 파서)를 쓰고, 이 컴포넌트는 원문이 HTML일 때만 사용.
// 두 소비처(/manual 뷰어·설정 미리보기) 모두 데이터를 클라이언트에서 fetch하므로
// SSR 시엔 콘텐츠가 비어 렌더되지 않는다 — sanitize는 window 존재 시에만(서버 no-op).

import DOMPurify from "dompurify";
import { useMemo } from "react";

export function HtmlView({ source, className = "" }: { source: string; className?: string }) {
  const clean = useMemo(
    () => (typeof window === "undefined" ? "" : DOMPurify.sanitize(source)),
    [source],
  );
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}

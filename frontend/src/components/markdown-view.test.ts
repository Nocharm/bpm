// 마크다운 뷰어 문단·줄바꿈 단위 테스트 — 한 줄 바꿈은 <br>, 빈 줄은 문단 나눔
import { describe, expect, it } from "vitest";

import { markdownToHtml } from "./markdown-view";

describe("markdownToHtml paragraphs", () => {
  it("keeps a single newline as a line break inside one paragraph", () => {
    expect(markdownToHtml("첫 줄\n둘째 줄")).toBe("<p>첫 줄<br>둘째 줄</p>");
  });

  it("splits paragraphs on a blank line", () => {
    expect(markdownToHtml("문단 하나\n\n문단 둘")).toBe("<p>문단 하나</p><p>문단 둘</p>");
  });

  it("still ends a paragraph at a list or heading", () => {
    expect(markdownToHtml("소개\n- 항목")).toBe("<p>소개</p><ul><li>항목</li></ul>");
    expect(markdownToHtml("소개\n## 제목")).toBe("<p>소개</p><h2>제목</h2>");
  });

  it("keeps an indented continuation line inside its list item", () => {
    expect(markdownToHtml("- 항목\n  이어지는 줄\n- 다음")).toBe("<ul><li>항목<br>이어지는 줄</li><li>다음</li></ul>");
  });

  it("marks indented bullets as sub items", () => {
    expect(markdownToHtml("- 상위\n  - 하위")).toBe('<ul><li>상위</li><li class="md-sub">하위</li></ul>');
  });
});

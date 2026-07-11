"""매뉴얼 섹션 선별 — 질문과 어휘가 겹치는 섹션만 budget 내로 (design 2026-07-11 B2)."""

import re

_HEADING = re.compile(r"^## ", re.MULTILINE)
_TITLE_WEIGHT = 3  # 제목 매칭 가중 — 본문 우연 일치보다 제목 일치가 신호가 강하다


def _bigrams(text: str) -> set[str]:
    """공백·기호 제거 후 2-gram — 형태소 분석 없이 한국어 어휘 겹침을 근사."""
    compact = re.sub(r"[\s\W_]+", "", text)
    return {compact[i : i + 2] for i in range(len(compact) - 1)}


def select_manual_sections(text: str, instruction: str, budget: int) -> str:
    """## 헤딩 단위로 질문 관련 섹션을 골라 budget(자) 내로 구성.

    전체가 budget 이하면 원문 그대로(소형 매뉴얼 무변화). TOC(전체 헤딩 목록)와
    프리앰블은 항상 포함해 모델이 매뉴얼 지형을 잃지 않게 한다. 전 섹션 0점이면
    원문 앞쪽 섹션 순(보수적 폴백 — 종전 절단과 유사).
    """
    if len(text) <= budget:
        return text

    matches = list(_HEADING.finditer(text))
    if not matches:
        return text[:budget]

    preamble = text[: matches[0].start()].rstrip()
    sections: list[tuple[str, str]] = []  # (제목 줄, 섹션 전문)
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[m.start() : end].rstrip()
        title = body.splitlines()[0].removeprefix("## ").strip()
        sections.append((title, body))

    query = _bigrams(instruction)
    scored = []
    for index, (title, body) in enumerate(sections):
        score = len(query & _bigrams(title)) * _TITLE_WEIGHT + len(query & _bigrams(body))
        scored.append((score, index))
    if all(score == 0 for score, _ in scored):
        picked_order = list(range(len(sections)))  # 폴백 — 원문 앞쪽부터
    else:
        picked_order = [index for _, index in sorted(scored, key=lambda x: (-x[0], x[1]))]

    toc = "\n".join(f"- {title}" for title, _ in sections)
    header = f"{preamble}\n\n[매뉴얼 목차]\n{toc}\n" if preamble else f"[매뉴얼 목차]\n{toc}\n"
    remaining = budget - len(header)
    chosen: set[int] = set()
    for index in picked_order:
        body = sections[index][1]
        if len(body) + 1 > remaining:
            continue
        chosen.add(index)
        remaining -= len(body) + 1
    parts = [header] + [sections[i][1] for i in sorted(chosen)]  # 원문 순서 복원
    return "\n".join(parts)

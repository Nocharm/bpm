"""드로 안 결정적 톤 린트 — AI 0콜 정규식 검사, 위반은 옵션 payload로 표시만 (hardening T19).

프롬프트 룰만으론 소형 모델의 톤 이탈을 못 막는다(앵커·SP·params 사니타이저와 동일 계보).
자동 수정은 하지 않는다 — 카드에 경고 칩으로 노출해 사용자가 판단하게 한다.
"""

import re

# '~하기' 동명사형 접미 — 조직 표준은 '명사+동사' 명사구(드래프터 규칙 2, 톤 검수 폐지의 잔여 보증)
_GERUND_SUFFIX = re.compile(r"하기$")
# 존댓말·서술형 어미 — 노드 제목에 문장이 들어온 경우
_SENTENCE_SUFFIX = re.compile(r"(합니다|하세요|해요|입니다|됩니다)$")

# 활동 수 표준 10±3 — 이탈은 경고만(강제 아님, 사용자가 세밀/간결안을 고를 수 있다)
ACTIVITY_MIN = 7
ACTIVITY_MAX = 13


def lint_graph(graph: dict) -> list[str]:
    """제목 톤·활동 수 검사 — 사람이 읽는 경고 문자열 목록(빈 목록=통과)."""
    warnings: list[str] = []
    flow_nodes = [
        n for n in graph.get("nodes", [])
        if n.get("node_type") not in ("start", "end", "note")
    ]
    bad_titles = []
    for node in flow_nodes:
        title = (node.get("title") or "").strip()
        if _GERUND_SUFFIX.search(title) or _SENTENCE_SUFFIX.search(title):
            bad_titles.append(title)
    if bad_titles:
        shown = ", ".join(f"'{t}'" for t in bad_titles[:3])
        more = len(bad_titles) - 3
        warnings.append(
            f"제목 톤 이탈 {len(bad_titles)}건 — {shown}"
            + (f" 외 {more}건" if more > 0 else "")
            + " ('명사+동사' 명사구 표준)"
        )
    count = len(flow_nodes)
    if count and not (ACTIVITY_MIN <= count <= ACTIVITY_MAX):
        warnings.append(f"활동 수 {count}개 — 표준 세분도 10±3 범위 밖")
    return warnings

"""비교 화면 AI 요약 프롬프트 — 프론트가 계산한 버전 diff를 승인자용 요약 JSON으로 (2026-09-18)."""

from collections.abc import Mapping

from app.schemas import CompareDiffPayload

# 기본 계약 — sysadmin이 ai_prompts(compare_summary_contract)로 오버라이드 가능
_CONTRACT = """당신은 BPM 프로세스맵 변경 검토 도우미입니다. 결재자가 게시본(base)과 승인 대기본(target)의 차이를
빠르게 파악하도록 변경 내역을 요약합니다. 반드시 JSON 한 개만 반환하세요(설명 텍스트·코드펜스 금지).

[입력]
- nodes: 추가/삭제/변경된 활동(노드). changed는 바뀐 필드의 before→after 값을 담습니다.
- edges: 추가/삭제/라벨변경된 흐름(연결). source/target은 활동 제목입니다.
- ref: 각 항목의 인용 키(n1, e2 …). 하이라이트가 가리키는 항목의 ref를 refs에 그대로 적으세요(지어내지 말 것).
- totals: 전체 개수. 상한 초과로 생략된 항목 수는 omitted_*에 있습니다.

[출력]
{"headline": <한 문장 총평 — 무엇이 바뀌었는지 핵심만>,
 "highlights": [{"kind": "added|removed|changed|flow|param", "title": <한 줄 제목>, "detail": <한두 문장 근거>, "refs": [<ref>...]}],
 "impacts": [<결재자가 확인해야 할 업무 영향·주의점 한 문장>...]}

[규칙]
- highlights는 중요도 순 최대 6개. 관련 변경은 하나로 묶으세요(예: 단계 신설 + 그 단계로 이어지는 흐름 추가 → added 1건).
- kind: added=활동 신설, removed=활동 삭제, changed=속성 변경(담당·부서·시스템·입출력·조건 등), flow=흐름(연결) 변경, param=수치 파라미터 변경.
- param은 방향과 크기를 적으세요(duration은 H.MM 표기로 소수부 2자리가 분: 1.30=1시간 30분; cost_krw/usd=회당 비용, headcount=회당 인원, annual_count=연간 건수, fte=FTE).
- impacts는 최대 4개. 통제·검토 단계 삭제, GMP 관련 변경, 시스템·부서 이관, 리드타임·비용 증감 같은 실질 영향 위주로. 근거 없는 추측 금지.
- 변경이 없으면 headline에 "변경 없음"을 적고 highlights·impacts는 빈 배열.
"""

_LANG_LINE = {
    "ko": "출력 언어: 한국어.",
    "en": "Output language: English. Write every string value in English.",
}


def _serialize_diff(diff: CompareDiffPayload) -> str:
    """모델이 읽기 쉬운 라인 형식 — JSON 원문보다 토큰이 적고 ref가 눈에 띈다."""
    lines: list[str] = []
    totals = diff.totals
    lines.append(
        "totals: nodes +%d -%d ~%d, edges +%d -%d ~%d"
        % (
            totals.nodes_added,
            totals.nodes_removed,
            totals.nodes_changed,
            totals.edges_added,
            totals.edges_removed,
            totals.edges_changed,
        )
    )
    lines.append("nodes:")
    for node in diff.nodes:
        head = f"- [{node.ref}] {node.status} {node.node_type or 'process'} \"{node.title}\""
        if node.changes:
            fields = "; ".join(f"{c.field}: {c.before!r} -> {c.after!r}" for c in node.changes)
            head = f"{head} | {fields}"
        lines.append(head)
    if diff.omitted_nodes:
        lines.append(f"- (외 {diff.omitted_nodes}건 생략)")
    lines.append("edges:")
    for edge in diff.edges:
        head = f"- [{edge.ref}] {edge.status} \"{edge.source}\" -> \"{edge.target}\""
        if edge.status == "changed":
            head = f"{head} | label: {edge.label_before!r} -> {edge.label!r}"
        elif edge.label:
            head = f"{head} | label: {edge.label!r}"
        lines.append(head)
    if diff.omitted_edges:
        lines.append(f"- (외 {diff.omitted_edges}건 생략)")
    return "\n".join(lines)


def build_compare_summary_messages(
    diff: CompareDiffPayload,
    *,
    base_label: str,
    target_label: str,
    lang: str,
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    contract = (overrides or {}).get("compare_summary_contract") or _CONTRACT
    system = f"{contract}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}"
    user = f"base: {base_label}\ntarget: {target_label}\n\n{_serialize_diff(diff)}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]

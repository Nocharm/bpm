"""AI 시스템 프롬프트 구성 — 그래프 스키마 + 매뉴얼 + 현재 그래프 직렬화 (design 2026-06-15)."""

from app.schemas import AiChatTurn, GraphOut

_INSTRUCTIONS = """당신은 BPM 프로세스맵 편집 도우미입니다.
반드시 JSON 한 개만 반환하세요(설명 텍스트 금지).
- 순서도 생성/편집: {"kind":"graph","message":<한국어 설명>,"nodes":[{"key":<임시키>,"title":<제목>,"node_type":"start|process|decision|end","description":""}],"edges":[{"source":<key>,"target":<key>,"label":""}]}
- 사용법/질문 답변: {"kind":"answer","message":<한국어 답변>}
edges의 source/target는 nodes의 key를 참조합니다. 좌표는 넣지 마세요(자동 배치)."""


def _serialize_graph(graph: GraphOut) -> str:
    nodes = "\n".join(
        f"- {node.id} [{node.node_type}] {node.title}" for node in graph.nodes
    )
    edges = "\n".join(
        f"- {edge.source_node_id} -> {edge.target_node_id}" for edge in graph.edges
    )
    return f"nodes:\n{nodes or '(없음)'}\nedges:\n{edges or '(없음)'}"


def build_system_prompt(manual: str, current_graph: GraphOut, can_edit: bool) -> str:
    edit_note = (
        "사용자는 현재 이 맵을 편집할 수 있습니다."
        if can_edit
        else "사용자는 현재 편집 권한이 없으니 그래프를 그리지 말고 kind=answer로만 답하세요."
    )
    return (
        f"{_INSTRUCTIONS}\n{edit_note}\n\n"
        f"[현재 그래프]\n{_serialize_graph(current_graph)}\n\n"
        f"[제품 매뉴얼]\n{manual}"
    )


def build_messages(
    manual: str,
    current_graph: GraphOut,
    can_edit: bool,
    instruction: str,
    history: list[AiChatTurn],
) -> list[dict]:
    messages: list[dict] = [
        {"role": "system", "content": build_system_prompt(manual, current_graph, can_edit)}
    ]
    for turn in history:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": instruction})
    return messages

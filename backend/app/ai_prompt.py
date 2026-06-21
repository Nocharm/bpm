"""AI 시스템 프롬프트 구성 — 그래프 스키마 + 매뉴얼 + 현재 그래프 직렬화 (design 2026-06-15)."""

from app.schemas import AiChatTurn, GraphOut, NodeOut

_INSTRUCTIONS = """당신은 BPM 프로세스맵 편집 도우미입니다.
반드시 JSON 한 개만 반환하세요(설명 텍스트 금지).

[활성 모드 — 지금은 아래 둘만 방출하세요]
- 순서도 생성/편집: {"kind":"graph","message":<한국어 설명>,
    "groups":[{"key":<임시키>,"label":<그룹명>,"color":"","parent_key":null}],
    "nodes":[{"key":<임시키>,"title":<제목>,"node_type":"start|process|decision|end","description":"",
              "attributes":{"assignee":"","department":"","system":"","duration":"","color":""},
              "group_key":<groups의 key 또는 null>}],
    "edges":[{"source":<key>,"target":<key>,"label":""}]}
- 사용법/질문 답변: {"kind":"answer","message":<한국어 답변>}

[규칙]
1. edges의 source/target와 node.group_key는 같은 응답 안의 key를 참조합니다. 좌표는 넣지 마세요(자동 배치).
2. 노드 id 규칙: 신규 노드는 새 임시 key. [현재 그래프]의 기존 노드를 유지/수정할 때는 그 노드의 id를 key로 그대로 쓰고, 기존 attributes·group·제목을 보존하세요(빈값으로 덮어쓰지 말 것).
3. attributes(담당자/부서/시스템/소요시간)는 아는 경우만 채우고, 모르면 빈 문자열로 두세요. 지어내지 마세요.
4. [현재 그래프]에 없는 노드를 참조하지 말고, 부득이하면 message에 그 사실을 적으세요.
5. node_type="subprocess" 로 표시된 노드는 다른 맵의 읽기전용 참조입니다 — 내부는 편집 대상이 아니며 루트만 편집합니다.
6. ops/walkthrough/analysis 종류는 아직 사용하지 마세요(추후 활성)."""


def _serialize_node(node: NodeOut) -> str:
    meta: list[str] = []
    if node.assignee:
        meta.append(f"담당={node.assignee}")
    if node.department:
        meta.append(f"부서={node.department}")
    if node.system:
        meta.append(f"시스템={node.system}")
    if node.duration:
        meta.append(f"소요={node.duration}")
    if node.group_ids:
        meta.append(f"그룹={','.join(node.group_ids)}")
    suffix = f" {{{', '.join(meta)}}}" if meta else ""
    # 서브프로세스 참조는 읽기전용 컨텍스트로만 노출 (계약 규칙 ④)
    if node.node_type == "subprocess" and node.linked_map_id is not None:
        suffix += f" (subprocess→map {node.linked_map_id}, READ-ONLY)"
    return f"- {node.id} [{node.node_type}] {node.title}{suffix}"


def _serialize_graph(graph: GraphOut) -> str:
    # 노드 id를 반드시 노출 — ops/편집이 기존 노드를 참조하는 생명선 (계약 규칙 ②)
    groups = "\n".join(
        f'- {group.id} "{group.label}"'
        + (f" (parent {group.parent_group_id})" if group.parent_group_id else "")
        for group in graph.groups
    )
    nodes = "\n".join(_serialize_node(node) for node in graph.nodes)
    edges = "\n".join(
        f"- {edge.source_node_id} -> {edge.target_node_id}"
        + (f' "{edge.label}"' if edge.label else "")
        for edge in graph.edges
    )
    return (
        f"groups:\n{groups or '(없음)'}\n"
        f"nodes:\n{nodes or '(없음)'}\n"
        f"edges:\n{edges or '(없음)'}"
    )


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

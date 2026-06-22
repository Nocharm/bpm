"""AI 시스템 프롬프트 구성 — 그래프 스키마 + 매뉴얼 + 현재 그래프 직렬화 (design 2026-06-15)."""

from app.schemas import AiChatTurn, GraphOut, NodeOut

_INSTRUCTIONS = """당신은 BPM 프로세스맵 편집 도우미입니다.
반드시 JSON 한 개만 반환하세요(설명 텍스트 금지).

[모드 선택]
- 빈 캔버스이거나 "그려/만들어/새로" 처럼 처음부터 생성 → graph(전체).
- [현재 그래프]가 비어있지 않고 "추가/바꿔/삭제/이동/연결" 처럼 일부만 편집 → ops(증분). 기존 노드의 좌표·색·담당자·그룹은 그대로 보존됩니다.
- 사용법/질문 → answer.

[graph — 전체 생성]
{"kind":"graph","message":<설명>,
 "groups":[{"key":<임시키>,"label":<그룹명>,"color":"","parent_key":null}],
 "nodes":[{"key":<임시키>,"title":<제목>,"node_type":"start|process|decision|end","description":"",
           "attributes":{"assignee":"","department":"","system":"","duration":"","color":""},
           "group_key":<groups의 key 또는 null>}],
 "edges":[{"source":<key>,"target":<key>,"label":""}]}
예) "구매 발주 프로세스 그려줘" → start "발주 요청" → process "견적 검토" → end (각 노드 담당자 매칭).

[ops — 증분 편집]
{"kind":"ops","message":<설명>,"ops":[
  {"action":"add","node":{"key":<새임시키>,"title":...,"node_type":...,"attributes":{...},"group_key":null}},
  {"action":"connect","source":<기존id또는새키>,"target":<기존id또는새키>,"label":""},
  {"action":"relabel","node_id":<기존id>,"title":<새제목>},
  {"action":"set_attr","node_id":<기존id>,"attributes":{"assignee":"홍길동"}},
  {"action":"remove","node_id":<기존id>}]}
예) "견적 검토 뒤에 '승인' 추가해" → add(승인) + connect(견적검토 id → 승인 새키).

[규칙]
1. graph의 edges·group_key는 같은 응답의 key 참조. ops의 node_id·source·target은 [현재 그래프]의 기존 id를 그대로 쓰고, 같은 배치에서 add한 노드는 그 새 key로 참조하세요. 좌표는 넣지 마세요(자동 배치).
2. 담당자/부서(attributes)는 [조직 디렉터리]의 실제 인물·부서와 매칭해 채우고, 디렉터리에 없거나 모르면 빈 문자열로 두세요(지어내지 말 것).
3. [현재 그래프]에 없는 노드를 참조하지 말고, 부득이하면 message에 그 사실을 적으세요.
4. node_type="subprocess" 노드는 다른 맵의 읽기전용 참조 — 내부를 편집(ops 대상)하지 말고 루트만 다루세요.
5. walkthrough/analysis 종류는 아직 사용하지 마세요(추후 활성)."""


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


def build_system_prompt(
    manual: str,
    current_graph: GraphOut,
    can_edit: bool,
    directory: list[str] | None = None,
) -> str:
    edit_note = (
        "사용자는 현재 이 맵을 편집할 수 있습니다(graph/ops 가능)."
        if can_edit
        else "사용자는 편집 권한이 없습니다 — graph/ops를 만들지 말고 kind=answer로만 답하세요."
    )
    dir_block = "\n".join(f"- {line}" for line in (directory or [])) or "(없음)"
    return (
        f"{_INSTRUCTIONS}\n{edit_note}\n\n"
        f"[조직 디렉터리 — 담당자/부서는 여기서 매칭]\n{dir_block}\n\n"
        f"[현재 그래프]\n{_serialize_graph(current_graph)}\n\n"
        f"[제품 매뉴얼]\n{manual}"
    )


def build_messages(
    manual: str,
    current_graph: GraphOut,
    can_edit: bool,
    instruction: str,
    history: list[AiChatTurn],
    directory: list[str] | None = None,
) -> list[dict]:
    messages: list[dict] = [
        {
            "role": "system",
            "content": build_system_prompt(manual, current_graph, can_edit, directory),
        }
    ]
    for turn in history:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": instruction})
    return messages

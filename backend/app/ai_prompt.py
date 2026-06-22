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

[analysis — 분석/개선점 (읽기 전용, 편집 권한 불필요)]
{"kind":"analysis","message":<요약>,"findings":[
  {"severity":"high|medium|low","category":"bottleneck|orphan|cycle|missing|naming",
   "node_ids":[<관련 기존 id>],"message":<문제점>,"suggestion":<개선안>}]}
[구조 힌트]가 주어지면 우선 반영하세요. node_ids는 [현재 그래프]의 기존 id만 사용.

[walkthrough — 단계별 안내 (읽기 전용, 편집 권한 불필요)]
{"kind":"walkthrough","message":<요약>,"steps":[
  {"order":1,"node_id":<기존 id>,"narration":<설명>}]}
순서는 [현재 그래프]의 흐름(시작→끝)을 따르고, node_id는 기존 id만 사용.

[규칙]
1. graph의 edges·group_key는 같은 응답의 key 참조. ops의 node_id·source·target은 [현재 그래프]의 기존 id를 그대로 쓰고, 같은 배치에서 add한 노드는 그 새 key로 참조하세요. 좌표는 넣지 마세요(자동 배치).
2. 담당자/부서(attributes)는 [조직 디렉터리]의 실제 인물·부서와 매칭해 채우고, 디렉터리에 없거나 모르면 빈 문자열로 두세요(지어내지 말 것).
3. [현재 그래프]에 없는 노드를 참조하지 말고, 부득이하면 message에 그 사실을 적으세요.
4. node_type="subprocess" 노드는 다른 맵의 읽기전용 참조 — 내부를 편집(ops 대상)하지 말고 루트만 다루세요.
5. answer는 [제품 매뉴얼]에 근거해 답하고 가능하면 섹션(예: "3. 승인 워크플로우")을 인용하세요. 매뉴얼에 없는 내용은 모른다고 답하세요(지어내지 말 것)."""


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


def _has_cycle(adjacency: dict[str, list[str]]) -> bool:
    """방향 그래프 순환 탐지 — DFS 3색(WHITE/GRAY/BLACK)."""
    white, gray, black = 0, 1, 2
    color = {node: white for node in adjacency}

    def visit(node: str) -> bool:
        color[node] = gray
        for nxt in adjacency[node]:
            if color.get(nxt) == gray:
                return True
            if color.get(nxt) == white and visit(nxt):
                return True
        color[node] = black
        return False

    return any(color[node] == white and visit(node) for node in adjacency)


def _structure_hints(graph: GraphOut) -> list[str]:
    """분석 환각 감소용 구조 사전탐지 — 고아 노드·순환을 코드로 잡아 힌트 제공 (Phase 4)."""
    node_ids = {node.id for node in graph.nodes}
    adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}
    indeg = {nid: 0 for nid in node_ids}
    outdeg = {nid: 0 for nid in node_ids}
    for edge in graph.edges:
        if edge.source_node_id in node_ids and edge.target_node_id in node_ids:
            adjacency[edge.source_node_id].append(edge.target_node_id)
            outdeg[edge.source_node_id] += 1
            indeg[edge.target_node_id] += 1
    hints: list[str] = []
    orphans = sorted(nid for nid in node_ids if indeg[nid] == 0 and outdeg[nid] == 0)
    if orphans:
        hints.append(f"고아 노드(연결 없음): {', '.join(orphans)}")
    if _has_cycle(adjacency):
        hints.append("순환(cycle) 존재")
    return hints


def build_system_prompt(
    manual: str,
    current_graph: GraphOut,
    can_edit: bool,
    directory: list[str] | None = None,
) -> str:
    edit_note = (
        "사용자는 현재 이 맵을 편집할 수 있습니다(graph/ops 가능)."
        if can_edit
        else "사용자는 편집 권한이 없습니다 — graph/ops는 만들지 말고 answer/analysis/walkthrough(읽기 전용)로만 답하세요."
    )
    dir_block = "\n".join(f"- {line}" for line in (directory or [])) or "(없음)"
    hints = _structure_hints(current_graph)
    hint_block = (
        "[구조 힌트]\n" + "\n".join(f"- {hint}" for hint in hints) + "\n\n" if hints else ""
    )
    return (
        f"{_INSTRUCTIONS}\n{edit_note}\n\n"
        f"[조직 디렉터리 — 담당자/부서는 여기서 매칭]\n{dir_block}\n\n"
        f"{hint_block}"
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

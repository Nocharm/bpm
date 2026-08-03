"""유사 서브프로세스 제안 — 작업본의 연속 process 체인을 게시 맵 코퍼스와 대조 (design 2026-07-23 §7).

수락 시 그래프 치환은 라우터(sp-accept)가, 프롬프트/카드 노출은 프론트가 담당 — 여기는 후보 계산만.
"""

from app.kb import embed_client, retrieval

SP_MIN_CHAIN = 3  # 제안 최소 구간 길이 — 짧은 구간은 링크 가치가 없다
SP_MIN_SIMILARITY = 0.65  # 검색 기본 임계(0.5)보다 상향 — 오제안 비용이 커서 보수적


def find_process_chains(graph: dict) -> list[list[dict]]:
    """분기 없는 연속 process 노드 체인(길이 3+) — 선형 구간만 서브프로세스 후보."""
    nodes = {n["key"]: n for n in graph.get("nodes", [])}
    nexts: dict[str, list[str]] = {}
    prevs: dict[str, list[str]] = {}
    for edge in graph.get("edges", []):
        nexts.setdefault(edge["source"], []).append(edge["target"])
        prevs.setdefault(edge["target"], []).append(edge["source"])

    def is_chainable(key: str) -> bool:
        node = nodes.get(key)
        return (
            node is not None
            and node.get("node_type") == "process"
            and len(nexts.get(key, [])) <= 1
            and len(prevs.get(key, [])) <= 1
        )

    chains: list[list[dict]] = []
    visited: set[str] = set()
    for key in nodes:
        if key in visited or not is_chainable(key):
            continue
        before = prevs.get(key, [])
        if len(before) == 1 and is_chainable(before[0]):
            continue  # 체인 중간 — 시작점에서만 걷는다
        chain: list[dict] = []
        cursor: str | None = key
        while cursor is not None and cursor not in visited and is_chainable(cursor):
            visited.add(cursor)
            chain.append(nodes[cursor])
            following = nexts.get(cursor, [])
            cursor = following[0] if len(following) == 1 else None
        if len(chain) >= SP_MIN_CHAIN:
            chains.append(chain)
    return chains


async def suggest_subprocess(session, interview) -> dict | None:
    """가장 긴 체인을 게시 맵 코퍼스와 대조 — 임계 이상 top-1(자기 맵·기링크 맵 제외).

    EmbedError는 전파 — 호출측이 침묵 스킵한다(제안은 기회주의적).
    """
    if not embed_client.is_embed_enabled():
        return None
    graph = interview.working_graph or {}
    chains = find_process_chains(graph)
    if not chains:
        return None
    linked = {
        n.get("linked_map_id")
        for n in graph.get("nodes", [])
        if n.get("node_type") == "subprocess" and n.get("linked_map_id")
    }
    chain = max(chains, key=len)
    query = " → ".join(n.get("title", "") for n in chain)
    hits = await retrieval.search(session, query)
    for hit in hits:
        if hit.source_type != "map" or hit.score < SP_MIN_SIMILARITY:
            continue
        target_id = hit.meta.get("map_id")
        if not target_id or target_id == interview.map_id or target_id in linked:
            continue
        return {
            "map_id": target_id,
            "map_name": hit.meta.get("map_name", ""),
            "node_keys": [n["key"] for n in chain],
            "score": round(hit.score, 3),
        }
    return None

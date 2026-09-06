"""Deterministic lineage key derivation — shared by the interview importer (scripts/) and
in-app placeholder resolution (framework_slots.py).

Lives in app/ (not scripts/) so app/ never imports scripts/ — scripts already imports app
at module scope (see scripts/import_consultant.py), and app/routers/categories.py notes the
reverse would cycle, hence its own deferred import. scripts.import_consultant re-exports
these names so `from scripts.import_consultant import make_node_id` keeps working.
"""

import hashlib


def make_node_id(map_code: str, node_code: str) -> str:
    # 컨설턴트 코드에서 파생한 결정적 값 — Node.id(테이블 전역 PK)로는 못 쓴다(재게시마다 충돌).
    # source_node_id 계보 루트로만 쓴다 — clone_graph와 같은 계보 규약(diff.ts getLineageKey)이라
    # 재임포트해도 버전 비교 diff가 노드를 매칭한다. 실제 Node.id는 빌드마다 uuid4로 새로 발급.
    return "c" + hashlib.sha1(f"{map_code}|{node_code}".encode()).hexdigest()[:24]


EXTERNAL_LINEAGE_SCOPE = "__ext__"


def external_lineage_key(code: str) -> str:
    """타 L5 taskId 플레이스홀더의 계보 키 — 캔버스 L5와 무관하게 코드만으로 결정돼 재전달 해소가 전 캔버스를 찾는다."""
    return make_node_id(EXTERNAL_LINEAGE_SCOPE, code)

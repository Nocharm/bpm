"""Deterministic lineage key derivation — shared by the interview importer (scripts/) and
in-app placeholder resolution (framework_slots.py).

Lives in app/ (not scripts/) so app/ never imports scripts/ — scripts already imports app
at module scope (see scripts/import_consultant.py), and app/routers/categories.py notes the
reverse would cycle, hence its own deferred import. scripts.import_consultant re-exports
these names so `from scripts.import_consultant import make_node_id` keeps working.
"""

import hashlib
import unicodedata


def make_node_id(map_code: str, node_code: str) -> str:
    # 컨설턴트 코드에서 파생한 결정적 값 — Node.id(테이블 전역 PK)로는 못 쓴다(재게시마다 충돌).
    # source_node_id 계보 루트로만 쓴다 — clone_graph와 같은 계보 규약(diff.ts getLineageKey)이라
    # 재임포트해도 버전 비교 diff가 노드를 매칭한다. 실제 Node.id는 빌드마다 uuid4로 새로 발급.
    return "c" + hashlib.sha1(f"{map_code}|{node_code}".encode()).hexdigest()[:24]


EXTERNAL_LINEAGE_SCOPE = "__ext__"


def external_lineage_key(code: str) -> str:
    """타 L5 taskId 플레이스홀더의 계보 키 — 캔버스 L5와 무관하게 코드만으로 결정돼 재전달 해소가 전 캔버스를 찾는다."""
    return make_node_id(EXTERNAL_LINEAGE_SCOPE, code)


def external_ref_lineage_key(home_code: str, ref_id: str) -> str:
    """externalTasks[].refId 플레이스홀더의 계보 키 — 파일 안에서만 유일한 refId를 홈 L5 코드로
    네임스페이스한다. 미선언 원문 코드(taskId)는 external_lineage_key를 그대로 쓴다 (spec 2026-09-07 §6.2)."""
    return make_node_id(EXTERNAL_LINEAGE_SCOPE, f"{home_code}|{ref_id}")


def normalize_task_name(name: str) -> str:
    """"정확 일치" 비교용 — NFKC·casefold·공백 전부 제거("OOS 접수" == "OOS접수"). 자동 연결은 이 값이
    같은 맵이 그 L5에 정확히 1개일 때만 (spec 2026-09-07 §6.2)."""
    return "".join(unicodedata.normalize("NFKC", name).casefold().split())

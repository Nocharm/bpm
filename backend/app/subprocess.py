"""하위프로세스 참조 모델 — 프로세스 검증·순환 탐지·링크 버전 해석 (순수 함수)."""

from app.schemas import NodeIn


def validate_process(nodes: list[NodeIn]) -> None:
    """프로세스 그래프 규칙 검증 — 위반 시 ValueError. (spec §3.3)"""
    if not nodes:
        return
    starts = [n for n in nodes if n.node_type == "start"]
    if len(starts) != 1:
        raise ValueError(f"시작 노드는 정확히 1개여야 합니다 (현재 {len(starts)}개).")
    ends = [n for n in nodes if n.node_type == "end"]
    names = [e.title for e in ends]
    if len(names) != len(set(names)):
        raise ValueError("끝 노드 이름이 중복되었습니다 (끝 이름은 유니크해야 함).")
    primaries = [e for e in ends if e.is_primary_end]
    if len(primaries) > 1:
        raise ValueError(f"대표 끝은 1개여야 합니다 (현재 {len(primaries)}개).")

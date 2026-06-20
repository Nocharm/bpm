"""하위프로세스 참조 모델 — 프로세스 검증·순환 탐지·링크 버전 해석."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MapVersion, Node
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


async def resolve_linked_version(
    session: AsyncSession,
    map_id: int,
    follow_latest: bool,
    pinned_version_id: int | None,
) -> int | None:
    """렌더할 버전 id 결정 — follow_latest면 최신 발행본, 아니면 고정. (spec §5)"""
    if not follow_latest and pinned_version_id is not None:
        return pinned_version_id
    published = await session.scalar(
        select(MapVersion.id)
        .where(MapVersion.map_id == map_id, MapVersion.status == "published")
        .order_by(MapVersion.id.desc())
    )
    if published is not None:
        return published
    return await session.scalar(
        select(MapVersion.id)
        .where(MapVersion.map_id == map_id)
        .order_by(MapVersion.id.desc())
    )


async def assert_no_cycle(
    session: AsyncSession, version_id: int, nodes: list[NodeIn]
) -> None:
    """이 버전 저장이 참조 사이클을 만들면 ValueError. (spec §4)"""
    self_map_id = await session.scalar(
        select(MapVersion.map_id).where(MapVersion.id == version_id)
    )
    targets = {n.linked_map_id for n in nodes if n.node_type == "subprocess" and n.linked_map_id}
    seen: set[int] = set()
    stack = list(targets)
    while stack:
        m = stack.pop()
        if m == self_map_id:
            raise ValueError("순환 참조입니다 — 자기 자신을 직접/간접 하위로 가져올 수 없습니다.")
        if m in seen:
            continue
        seen.add(m)
        # m 맵의 모든 버전 노드가 참조하는 맵들을 따라간다
        refs = (
            await session.scalars(
                select(Node.linked_map_id)
                .join(MapVersion, Node.version_id == MapVersion.id)
                .where(MapVersion.map_id == m, Node.linked_map_id.is_not(None))
            )
        ).all()
        stack.extend(r for r in refs if r is not None)

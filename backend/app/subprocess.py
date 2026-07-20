"""하위프로세스 참조 모델 — 프로세스 검증·순환 탐지·링크 버전 해석."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MapVersion, Node, ProcessMap
from app.schemas import NodeIn, SubprocessRefOut


def validate_process(nodes: list[NodeIn]) -> None:
    """프로세스 그래프 규칙 검증 + 대표 끝 기본값 설정 — 위반 시 ValueError. (spec §3.3)

    끝 노드가 있고 is_primary_end 미지정(0개)이면 sort_order 최소 끝을 대표로 기본 지정.
    """
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
    # spec §3.3: 끝이 있는데 대표가 없으면 sort_order 최소(동점은 payload 순서) 끝을 기본 지정
    if ends and not primaries:
        first_end = min(ends, key=lambda e: e.sort_order)
        first_end.is_primary_end = True


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


async def get_subprocess_refs(
    session: AsyncSession, nodes: list[NodeIn]
) -> dict[int, SubprocessRefOut]:
    """그래프 내 subprocess 노드들의 링크 대상 지정 정보 — 라이브 참조 (spec 2026-07-06).

    soft-delete·영구삭제된 맵은 designated=False 취급 → 프론트가 경고+잠금 렌더.
    """
    targets = {
        n.linked_map_id for n in nodes if n.node_type == "subprocess" and n.linked_map_id
    }
    if not targets:
        return {}
    rows = (
        await session.execute(
            select(
                ProcessMap.id,
                ProcessMap.name,
                ProcessMap.sp_designated_at,
                ProcessMap.deleted_at,
                ProcessMap.sp_department,
                ProcessMap.sp_assignee,
                ProcessMap.sp_system,
                ProcessMap.sp_duration,
                ProcessMap.sp_cost_krw,
                ProcessMap.sp_cost_usd,
                ProcessMap.sp_headcount,
                ProcessMap.sp_url,
                ProcessMap.sp_url_label,
                ProcessMap.sp_description,
            ).where(ProcessMap.id.in_(targets))
        )
    ).all()
    refs = {
        mid: SubprocessRefOut(
            designated=designated_at is not None and deleted_at is None,
            name=name,
            department=department,
            assignee=assignee,
            system=system,
            duration=duration,
            cost_krw=cost_krw,
            cost_usd=cost_usd,
            headcount=headcount,
            url=url,
            url_label=url_label,
            sp_description=sp_description,
        )
        for (
            mid,
            name,
            designated_at,
            deleted_at,
            department,
            assignee,
            system,
            duration,
            cost_krw,
            cost_usd,
            headcount,
            url,
            url_label,
            sp_description,
        ) in rows
    }
    for missing in targets - refs.keys():  # 링크 대상 맵이 영구삭제된 경우
        refs[missing] = SubprocessRefOut(designated=False)
    return refs


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

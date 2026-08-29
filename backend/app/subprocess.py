"""하위프로세스 참조 모델 — 프로세스 검증·순환 탐지·링크 버전 해석."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MapVersion, Node, ProcessCategory, ProcessMap
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


def validate_framework_canvas(nodes: list[NodeIn]) -> None:
    """framework 연계 캔버스 규칙 — subprocess(링크드·플레이스홀더) + 분기·끝 허용, start/process 차단.

    링크 없는 subprocess = 플레이스홀더(미등록 L6 자리, design 2026-08-28 §10.1) — 임포트가 파두고
    후차 연결한다. 끝 노드는 일반 맵과 동일 규칙(이름 유니크·대표 ≤1·자동 대표 지정)을 적용한다.
    """
    for n in nodes:
        if n.node_type not in ("subprocess", "decision", "end"):
            raise ValueError(
                "framework canvas allows subprocess, decision, and end nodes only"
            )
    ends = [n for n in nodes if n.node_type == "end"]
    names = [e.title for e in ends]
    if len(names) != len(set(names)):
        raise ValueError("끝 노드 이름이 중복되었습니다 (끝 이름은 유니크해야 함).")
    primaries = [e for e in ends if e.is_primary_end]
    if len(primaries) > 1:
        raise ValueError(f"대표 끝은 1개여야 합니다 (현재 {len(primaries)}개).")
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
                ProcessMap.sp_touch_time,
                ProcessMap.sp_input,
                ProcessMap.sp_output,
                ProcessMap.sp_input_forms,
                ProcessMap.sp_output_forms,
                ProcessMap.sp_input_ids,
                ProcessMap.sp_output_ids,
                ProcessMap.sp_start_condition,
                ProcessMap.sp_end_condition,
                ProcessMap.sp_frequency_fallback,
                ProcessMap.sp_gmp,
                ProcessMap.sp_url,
                ProcessMap.sp_url_label,
                ProcessMap.sp_description,
                ProcessMap.category_id,
                ProcessMap.retired_to_map_id,
            ).where(ProcessMap.id.in_(targets))
        )
    ).all()
    refs: dict[int, SubprocessRefOut] = {}
    category_id_by_map: dict[int, int | None] = {}
    # 은퇴 체인 출발점 — 삭제된 링크맵의 retired_to (후계자 추적용, 2026-08-30)
    retire_heads: dict[int, int] = {}
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
        touch_time,
        sp_input,
        sp_output,
        sp_input_forms,
        sp_output_forms,
        sp_input_ids,
        sp_output_ids,
        start_condition,
        end_condition,
        frequency_fallback,
        sp_gmp,
        url,
        url_label,
        sp_description,
        category_id,
        retired_to_map_id,
    ) in rows:
        if deleted_at is not None and retired_to_map_id is not None:
            retire_heads[mid] = retired_to_map_id
        refs[mid] = SubprocessRefOut(
            designated=designated_at is not None and deleted_at is None,
            deleted=deleted_at is not None,
            name=name,
            department=department,
            assignee=assignee,
            system=system,
            duration=duration,
            cost_krw=cost_krw,
            cost_usd=cost_usd,
            headcount=headcount,
            touch_time=touch_time,
            input=sp_input,
            output=sp_output,
            input_forms=sp_input_forms,
            output_forms=sp_output_forms,
            input_ids=sp_input_ids,
            output_ids=sp_output_ids,
            start_condition=start_condition,
            end_condition=end_condition,
            frequency_fallback=frequency_fallback,
            gmp=sp_gmp,
            url=url,
            url_label=url_label,
            sp_description=sp_description,
        )
        category_id_by_map[mid] = category_id
    # 링크맵 체계 경로 — 캔버스 외부 L6 출신 배지 소스(라이브 파생) (design 2026-08-28 §8)
    if any(cid is not None for cid in category_id_by_map.values()):
        from app.routers.categories import build_category_paths  # 지역 관례 — 순환 회피(maps.py:66)

        cat_rows = (
            await session.execute(
                select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
            )
        ).all()
        paths = build_category_paths(cat_rows)
        for mid, cid in category_id_by_map.items():
            if cid is not None:
                refs[mid].category_path = paths.get(cid)
                # 홈 L5 id — 캔버스 외부 L6 색상 키(같은 L5=같은 색) (2026-08-28 개선)
                refs[mid].category_id = cid
    for missing in targets - refs.keys():  # 링크 대상 맵이 영구삭제된 경우
        refs[missing] = SubprocessRefOut(designated=False, deleted=True)
    # 이양 후계자 — 은퇴 체인을 살아있는 맵까지 추적해 동봉(교체 다이얼로그 추천 소스) (2026-08-30)
    for mid, head in retire_heads.items():
        cursor: int | None = head
        seen: set[int] = set()
        for _ in range(5):  # 연쇄 이양 상한 — 순환·폭주 방어
            if cursor is None or cursor in seen:
                break
            seen.add(cursor)
            row = (
                await session.execute(
                    select(
                        ProcessMap.id,
                        ProcessMap.name,
                        ProcessMap.deleted_at,
                        ProcessMap.retired_to_map_id,
                    ).where(ProcessMap.id == cursor)
                )
            ).first()
            if row is None:
                break
            if row.deleted_at is None:
                refs[mid].successor_map_id = row.id
                refs[mid].successor_name = row.name
                break
            cursor = row.retired_to_map_id
    return refs


async def get_placeholder_category_paths(
    session: AsyncSession, nodes: list[NodeIn]
) -> dict[int, str]:
    """플레이스홀더(미등록 SP)의 출처 L5 경로 — 배지 표시 소스 (design 2026-08-28 §10.1)."""
    targets = {
        n.placeholder_category_id
        for n in nodes
        if n.node_type == "subprocess"
        and n.linked_map_id is None
        and n.placeholder_category_id
    }
    if not targets:
        return {}
    from app.routers.categories import build_category_paths  # 지역 관례 — 순환 회피(maps.py:66)

    cat_rows = (
        await session.execute(
            select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
        )
    ).all()
    paths = build_category_paths(cat_rows)
    return {cid: path for cid in targets if (path := paths.get(cid)) is not None}


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

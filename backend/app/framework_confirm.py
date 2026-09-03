"""Framework 확정 본체 — 게이트 6종·체크아웃 점유·직속 L5 권한 통합 (Track B Task 3).

라우터(maps.py)와 향후 요청 승인 경로가 공용으로 부르는 단일 진입점. 라우터는 404/mode
체크 이후 이 모듈에 위임하는 얇은 어댑터로 남는다.
"""

from fastapi import HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import workflow
from app.checkout import is_checkout_active
from app.clock import now as now_kst
from app.models import (
    CheckoutRequest,
    Comment,
    Edge,
    Group,
    MapVersion,
    Node,
    ProcessMap,
    VersionApproval,
    VersionEvent,
)
from app.permissions import logic
from app.permissions.access import get_framework_category_id, is_direct_l5_admin
from app.subprocess import validate_confirm_readiness
from app.version_events import record_version_event


def _canvas_content_signature(nodes: list[Node], edges: list[Edge]) -> tuple:
    """레이아웃 무시 콘텐츠 시그니처 — 확정 게이트용 (2026-08-28 개선).

    노드는 계보 키(source_node_id∥id)로 정렬해 FE computeVersionDiff(FIELD_KEYS)와 같은
    콘텐츠 필드 + 링크 정체성만 비교한다. 좌표·sort_order·엣지 시각 필드(side/line_style)·
    그룹 멤버십은 배치 취급이라 제외 — FE 게이트와 판정 기준을 맞춘다(lib/diff.ts).
    """
    lineage = {n.id: (n.source_node_id or n.id) for n in nodes}
    node_sig = sorted(
        (
            n.source_node_id or n.id, n.title, n.description, n.node_type, n.color,
            n.assignee, n.department, n.system, n.duration, n.touch_time,
            n.cost_krw, n.cost_usd, n.headcount, n.annual_count, n.fte,
            n.input, n.output, n.input_forms, n.output_forms, n.gmp,
            n.start_condition, n.end_condition,
            n.linked_map_id, n.follow_latest, n.is_primary_end,
            n.placeholder_category_id,  # 플레이스홀더 출처도 링크 정체성 (design §10.1)
        )
        for n in nodes
    )
    edge_sig = sorted(
        (
            lineage.get(e.source_node_id, e.source_node_id),
            lineage.get(e.target_node_id, e.target_node_id),
            e.label, e.source_handle or "", e.target_handle or "",
        )
        for e in edges
    )
    return (tuple(node_sig), tuple(edge_sig))


# 스냅샷 영구삭제 스윕 대상 — sqlite는 FK CASCADE 미강제라 명시 벌크 삭제(delete_category 선례)
_VERSION_CHILD_MODELS = (Node, Edge, Group, Comment, VersionApproval, VersionEvent, CheckoutRequest)


async def load_confirm_draft(session: AsyncSession, map_id: int) -> MapVersion | None:
    """확정 대상 draft 조회 — nodes/edges/groups selectinload(게이트 검사기·시그니처 비교 전제).

    confirm 본체와 readiness GET(maps.py)이 공유.
    """
    return await session.scalar(
        select(MapVersion)
        .where(MapVersion.map_id == map_id, MapVersion.status == "draft")
        .order_by(MapVersion.id.desc())
        .options(
            selectinload(MapVersion.nodes),
            selectinload(MapVersion.edges),
            selectinload(MapVersion.groups),
        )
    )


async def perform_framework_confirm(
    session: AsyncSession, found_map: ProcessMap, user: str, major: bool
) -> tuple[MapVersion, list[str]]:
    """라이브 draft를 스냅샷(confirmed)으로 확정 — 권한자/sysadmin 본인 확정, 상위 승인 없음.

    순서: mode 422 → 권한(직속 L5 관리자/sysadmin) 403 → draft 조회 409 → 게이트 6종 422 →
    체크아웃 점유(빈 값은 확정자가 자동 획득, 타인 보유는 409) → 무변경 게이트(major 우회) 409 →
    채번·프룬·clone·이벤트. (snapshot, pruned_labels) 반환.

    마이너 확정은 직전 스냅샷 대비 레이아웃 외 변경이 있을 때만(없으면 409 — 손쉬운 버전
    남발 방지). 메이저 승급은 의도된 의식이라 게이트를 우회하되, 직전 메이저 라인의 중간
    마이너를 영구삭제한다(X.0·X.최종만 유지, 삭제 라벨은 응답 동봉) (2026-08-28 개선).
    """
    if found_map.mode != "framework":
        raise HTTPException(status_code=422, detail="not a framework linkage canvas")
    if not logic.is_sysadmin(user):
        category_id = await get_framework_category_id(session, found_map.id)
        if category_id is None or not await is_direct_l5_admin(session, user, category_id):
            raise HTTPException(
                status_code=403, detail="direct L5 admin or sysadmin only"
            )

    draft = await load_confirm_draft(session, found_map.id)
    if draft is None:
        raise HTTPException(status_code=409, detail="canvas has no draft version")

    failures = await validate_confirm_readiness(session, found_map, draft)
    if failures:
        raise HTTPException(
            status_code=422,
            detail="confirm gates failed: " + ", ".join(f.code for f in failures),
        )

    # 점유 — 빈 값은 확정자가 자동 획득, 타인 보유는 409 (spec §4 점유)
    if not is_checkout_active(draft):
        draft.checked_out_by = user
        draft.checked_out_at = now_kst()
    elif draft.checked_out_by != user:
        raise HTTPException(
            status_code=409, detail="another user holds the draft checkout"
        )

    map_id = found_map.id
    # fw 채번 — (major,minor) 최댓값 기준. 최초 1.0
    fw_rows = (
        await session.execute(
            select(MapVersion.fw_major, MapVersion.fw_minor).where(
                MapVersion.map_id == map_id, MapVersion.fw_major.is_not(None)
            )
        )
    ).all()
    if not fw_rows:
        new_major, new_minor = 1, 0
    else:
        cur_major, cur_minor = max(fw_rows)
        if not major:
            # 무변경 게이트 — 최신 스냅샷과 콘텐츠 동일하면 409 (좌표만 이동은 변경 아님)
            latest = await session.scalar(
                select(MapVersion)
                .where(
                    MapVersion.map_id == map_id,
                    MapVersion.fw_major == cur_major,
                    MapVersion.fw_minor == cur_minor,
                )
                .options(selectinload(MapVersion.nodes), selectinload(MapVersion.edges))
            )
            if latest is not None and _canvas_content_signature(
                draft.nodes, draft.edges
            ) == _canvas_content_signature(latest.nodes, latest.edges):
                raise HTTPException(
                    status_code=409,
                    detail=f"no content changes since v{cur_major}.{cur_minor}",
                )
        new_major, new_minor = (
            (cur_major + 1, 0) if major else (cur_major, cur_minor + 1)
        )

    pruned_labels: list[str] = []
    if major and fw_rows:
        # 직전 메이저 라인 정리 — X.0과 X.최종만 유지, 중간 마이너 영구삭제 (사용자 결정 2026-08-28)
        prev_major, prev_max_minor = cur_major, cur_minor
        prune_rows = (
            await session.execute(
                select(MapVersion.id, MapVersion.label)
                .where(
                    MapVersion.map_id == map_id,
                    MapVersion.fw_major == prev_major,
                    MapVersion.fw_minor > 0,
                    MapVersion.fw_minor < prev_max_minor,
                )
                .order_by(MapVersion.fw_minor)
            )
        ).all()
        for vid, label in prune_rows:
            for child in _VERSION_CHILD_MODELS:
                await session.execute(sa_delete(child).where(child.version_id == vid))
            await session.execute(sa_delete(MapVersion).where(MapVersion.id == vid))
            pruned_labels.append(label)

    snapshot = MapVersion(
        map_id=map_id, label=f"v{new_major}.{new_minor}", status=workflow.CONFIRMED,
        fw_major=new_major, fw_minor=new_minor, submitted_by=user,
    )
    session.add(snapshot)
    await session.flush()
    # 순환 회피 지역 import(maps.py:66 스타일) — app.routers 패키지 초기화 중 재진입 위험
    from app.routers.versions import clone_graph

    await clone_graph(session, draft, snapshot.id)
    record_version_event(session, snapshot.id, workflow.CONFIRMED, user)
    await session.commit()
    await session.refresh(snapshot)
    return snapshot, pruned_labels

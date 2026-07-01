"""개발용 DB 초기화 — drop_all + create_all + 로컬 직원 5명 + 참조 데모 맵 + 권한 데모 시드.

운영/서버 환경에서 실행 금지. sqlite dev.db 전용 (postgres면 연결 URL로 바꿀 것).

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.reset_db
    PowerShell: .venv\\Scripts\\python -m scripts.reset_db
"""

import asyncio

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal, engine
from app.models import Base, MapVersion, ProcessMap, VersionEvent
from scripts.seed_reference_demo import main as seed_demo


async def backfill_version_events(session: AsyncSession) -> int:
    """created 이벤트가 없는 버전에 created_at 기준 created 1건을 합성한다 (멱등). 반환=추가 건수."""
    have_created = set(
        (
            await session.scalars(
                select(VersionEvent.version_id).where(
                    VersionEvent.event_type == "created"
                )
            )
        ).all()
    )
    rows = (
        await session.execute(
            select(MapVersion, ProcessMap.owner_id, ProcessMap.created_by).join(
                ProcessMap, ProcessMap.id == MapVersion.map_id
            )
        )
    ).all()
    added = 0
    for version, owner_id, created_by in rows:
        if version.id in have_created:
            continue
        session.add(
            VersionEvent(
                version_id=version.id,
                event_type="created",
                actor=owner_id or created_by or "unknown",
                created_at=version.created_at,
            )
        )
        added += 1
    await session.commit()
    return added

async def main() -> None:
    # 1. 스키마 재생성
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    print("schema  drop_all + create_all 완료")

    # 2. 로컬 직원 5명 시드 — service.seed_local_employees 재사용(org_l* 포함 영문 시드 단일 소스)
    from app.ad.service import LOCAL_USERS, seed_local_employees

    async with SessionLocal() as session:
        await seed_local_employees(session)
    print(f"seed    employees {len(LOCAL_USERS)}명")

    # 3. 참조 데모 맵 시드 (seed_reference_demo.main 재사용)
    await seed_demo()

    # 4. 권한 워크플로 데모 시드 (ADDITIVE — LOCAL_USERS/seed_reference_demo 불변)
    from scripts.seed_permission_demo import seed_permission_demo

    async with SessionLocal() as session:
        summary = await seed_permission_demo(session)
    print(
        "seed    permission demo — "
        f"maps(public={summary['public_map']}, private={summary['private_map']}, "
        f"roles={summary['roles_map']}, version={summary['version_map']}), "
        f"groups(active={summary['active_group']}, pending={summary['pending_group']})"
    )

    # 5. 버전 created 이벤트 백필 (멱등 — 시드가 만든 버전들에 타임라인 시작점 부여)
    async with SessionLocal() as session:
        added = await backfill_version_events(session)
    print(f"backfill version 'created' events: {added}건")

    # 6. 버전 비교 데모 시드 (ADDITIVE — As-Is/To-Be 한 맵, 비교 화면용)
    from scripts.seed_compare_demo import seed_compare_demo

    async with SessionLocal() as session:
        cmp_summary = await seed_compare_demo(session)
    print(
        f"seed    compare demo — map {cmp_summary['map']} "
        f"(As-Is v{cmp_summary['asis']} / To-Be v{cmp_summary['tobe']})"
    )

    # 6. 3중첩 데모 시드 (ADDITIVE — 깊이-3 드릴인 A→B→C 체인, 마스킹 비대칭용 L3=user.choi)
    from scripts.seed_nesting_demo import seed_nesting_demo

    async with SessionLocal() as session:
        nest = await seed_nesting_demo(session)
    print(
        f"seed    nesting demo — L1(map={nest['l1_map']}) → L2(map={nest['l2_map']}) "
        f"→ L3(map={nest['l3_map']})"
    )

    # 8. 버전 라이프사이클 데모 시드 (ADDITIVE — expired/published/draft+체크아웃·이전요청·재게시맵)
    from scripts.seed_version_lifecycle_demo import seed_version_lifecycle_demo

    async with SessionLocal() as session:
        lc = await seed_version_lifecycle_demo(session)
    print(
        f"seed    version-lifecycle demo — "
        f"map1={lc['lifecycle_map']} "
        f"(v1_expired={lc['v1_expired']}, v2_published={lc['v2_published']}, "
        f"v3_draft={lc['v3_draft']}, cr={lc['checkout_request_id']}), "
        f"map2={lc['republish_map']} (r1_expired={lc['r1_expired']})"
    )

    # 9. 워크플로 불변식 정규화 (멱등 — 시드가 남긴 불가능 상태 보정: owner·승인자·submitted_by·승인이력)
    from scripts.seed_invariants import normalize_workflow_invariants

    async with SessionLocal() as session:
        norm = await normalize_workflow_invariants(session)
    print(
        f"normalize invariants — owners={norm['owners_set']}, approvers={norm['approvers_added']}, "
        f"submitters={norm['submitters_set']}, approvals={norm['approvals_added']}"
    )

    # 6. 확인 — 테이블 존재 + 핵심 카운트
    async with SessionLocal() as session:
        emp_count = (await session.execute(text("SELECT count(*) FROM employees"))).scalar()
        perm_count = (await session.execute(text("SELECT count(*) FROM map_permissions"))).scalar()
        ar_count = (await session.execute(text("SELECT count(*) FROM approval_requests"))).scalar()
        grp_count = (await session.execute(text("SELECT count(*) FROM user_groups"))).scalar()
        appr_count = (await session.execute(text("SELECT count(*) FROM map_approvers"))).scalar()
        pending_ver = (
            await session.execute(
                text("SELECT count(*) FROM map_versions WHERE status='pending'")
            )
        ).scalar()
    print(
        f"verify  employees={emp_count}, map_permissions={perm_count}, "
        f"approval_requests={ar_count}, user_groups={grp_count}, "
        f"map_approvers={appr_count}, pending_versions={pending_ver}"
    )

    # 7. 3중첩 링크/소유 확인 — L1→L2→L3 subprocess 링크 + L3 소유자 user.choi
    async with SessionLocal() as session:
        l1_links = (
            await session.execute(
                text(
                    "SELECT linked_map_id FROM nodes WHERE id='n1-sub'"
                )
            )
        ).scalar()
        l2_links = (
            await session.execute(
                text("SELECT linked_map_id FROM nodes WHERE id='n2-sub'")
            )
        ).scalar()
        l3_owner = (
            await session.execute(
                text(
                    "SELECT owner_id FROM process_maps "
                    "WHERE name='Nesting L3 — Leaf'"
                )
            )
        ).scalar()
        l2_map_id = (
            await session.execute(
                text(
                    "SELECT id FROM process_maps WHERE name='Nesting L2 — embeds L3'"
                )
            )
        ).scalar()
        l3_map_id = (
            await session.execute(
                text("SELECT id FROM process_maps WHERE name='Nesting L3 — Leaf'")
            )
        ).scalar()
    print(
        f"verify  nesting — L1.sub→map {l1_links} (==L2 {l2_map_id}: "
        f"{l1_links == l2_map_id}), L2.sub→map {l2_links} (==L3 {l3_map_id}: "
        f"{l2_links == l3_map_id}), L3 owner={l3_owner} (==user.choi: "
        f"{l3_owner == 'user.choi'})"
    )

    # 10. 버전 라이프사이클 상태 확인 — expired/published/draft + 체크아웃 + 이전요청
    async with SessionLocal() as session:
        lc_v1 = (
            await session.execute(
                text(
                    "SELECT status, version_number FROM map_versions "
                    "WHERE id=:vid"
                ),
                {"vid": lc["v1_expired"]},
            )
        ).one()
        lc_v2 = (
            await session.execute(
                text(
                    "SELECT status, version_number FROM map_versions "
                    "WHERE id=:vid"
                ),
                {"vid": lc["v2_published"]},
            )
        ).one()
        lc_v3 = (
            await session.execute(
                text(
                    "SELECT status, version_number, checked_out_by FROM map_versions "
                    "WHERE id=:vid"
                ),
                {"vid": lc["v3_draft"]},
            )
        ).one()
        lc_cr = (
            await session.execute(
                text(
                    "SELECT requested_by, status FROM checkout_requests "
                    "WHERE id=:cid"
                ),
                {"cid": lc["checkout_request_id"]},
            )
        ).one()
        lc_r1 = (
            await session.execute(
                text(
                    "SELECT status, version_number FROM map_versions "
                    "WHERE id=:vid"
                ),
                {"vid": lc["r1_expired"]},
            )
        ).one()
        lc_drafts_m2 = (
            await session.execute(
                text(
                    "SELECT count(*) FROM map_versions "
                    "WHERE map_id=:mid AND status='draft'"
                ),
                {"mid": lc["republish_map"]},
            )
        ).scalar()
    print(
        f"verify  lifecycle — "
        f"v1({lc_v1.status},{lc_v1.version_number})==(expired,1):{lc_v1.status == 'expired' and lc_v1.version_number == 1}, "
        f"v2({lc_v2.status},{lc_v2.version_number})==(published,2):{lc_v2.status == 'published' and lc_v2.version_number == 2}, "
        f"v3({lc_v3.status},{lc_v3.version_number},{lc_v3.checked_out_by})==(draft,None,user.park):"
        f"{lc_v3.status == 'draft' and lc_v3.version_number is None and lc_v3.checked_out_by == 'user.park'}, "
        f"cr({lc_cr.requested_by},{lc_cr.status})==(user.choi,pending):"
        f"{lc_cr.requested_by == 'user.choi' and lc_cr.status == 'pending'}, "
        f"r1({lc_r1.status},{lc_r1.version_number})==(expired,1):{lc_r1.status == 'expired' and lc_r1.version_number == 1}, "
        f"map2_drafts={lc_drafts_m2}(==0:{lc_drafts_m2 == 0})"
    )


if __name__ == "__main__":
    asyncio.run(main())

"""알림·승인 인박스 확인용 더미데이터 — 승인 대기 3종 + 알림.

승인 대기 종류별(요청자를 다른 사용자로 두어 이름 필 표시 확인):
  - version_approval  : 지정 승인자=admin.kim, 제출자=user.lee / user.park
  - checkout_transfer : 점유자=user.park, 이전 요청자=user.choi
  - approval_request  : 가시성 변경 요청자=user.jung

dev 뷰어(admin.kim)는 로컬에서 sysadmin이라 점유권 이전·권한/가시성은 전부,
버전 승인은 지정 승인자인 건만 본다. 요청자 이름은 로컬 시드 직원으로 해석된다
(admin.kim=Junho Kim, user.lee=Minjae Lee, user.park=Soyeon Park, user.choi=Daehyun Choi, user.jung=Hana Jung).

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.seed_inbox_demo
    PowerShell: .venv\\Scripts\\python -m scripts.seed_inbox_demo

멱등: 같은 이름 데모 맵이 있으면 자식 행까지 지우고 다시 만든다.
"""

import asyncio

from sqlalchemy import delete, select

from app import workflow
from app.db import SessionLocal
from app.models import (
    ApprovalRequest,
    CheckoutRequest,
    MapApprover,
    MapPermission,
    MapVersion,
    Notification,
    ProcessMap,
)

VIEWER = "admin.kim"  # dev 뷰어 = 승인자/오너

# 버전 승인 데모 (맵 이름, 제출자)
VERSION_MAPS = [
    ("승인 데모 — 버전 승인 A", "user.lee"),
    ("승인 데모 — 버전 승인 B", "user.park"),
]
CHECKOUT_MAP = "승인 데모 — 점유권 이전"
APPROVAL_MAP = "승인 데모 — 권한·가시성"
DEMO_NAMES = [name for name, _ in VERSION_MAPS] + [CHECKOUT_MAP, APPROVAL_MAP]


async def _purge(session) -> None:
    """기존 데모 맵 + 자식 행 제거(FK cascade 비의존 — 명시 삭제)."""
    maps = (
        await session.scalars(select(ProcessMap).where(ProcessMap.name.in_(DEMO_NAMES)))
    ).all()
    for m in maps:
        version_ids = (
            await session.scalars(select(MapVersion.id).where(MapVersion.map_id == m.id))
        ).all()
        if version_ids:
            await session.execute(
                delete(CheckoutRequest).where(CheckoutRequest.version_id.in_(version_ids))
            )
        await session.execute(delete(Notification).where(Notification.map_id == m.id))
        await session.execute(delete(ApprovalRequest).where(ApprovalRequest.map_id == m.id))
        await session.execute(delete(MapApprover).where(MapApprover.map_id == m.id))
        await session.execute(delete(MapVersion).where(MapVersion.map_id == m.id))
        await session.execute(delete(MapPermission).where(MapPermission.map_id == m.id))
        await session.delete(m)
    await session.flush()


def _owner(map_id: int) -> MapPermission:
    return MapPermission(
        map_id=map_id, principal_type="user", principal_id=VIEWER, role="owner", granted_by="seed"
    )


async def main() -> None:
    async with SessionLocal() as session:
        await _purge(session)

        # 1) 버전 승인 — admin.kim이 지정 승인자, 각기 다른 제출자의 pending 버전
        for name, submitter in VERSION_MAPS:
            m = ProcessMap(name=name, visibility="private")
            v = MapVersion(label="As-Is", status=workflow.PENDING, submitted_by=submitter)
            m.versions.append(v)
            session.add(m)
            await session.flush()
            session.add(_owner(m.id))
            session.add(MapApprover(map_id=m.id, user_id=VIEWER, assigned_by="seed"))
            session.add(
                Notification(
                    recipient=VIEWER,
                    type="review_requested",
                    map_id=m.id,
                    version_id=v.id,
                    message=f"{submitter} 님이 '{v.label}' 승인을 요청했습니다.",
                    read=False,
                )
            )

        # 2) 점유권 이전 — user.park 점유, user.choi가 이전 요청(pending)
        m2 = ProcessMap(name=CHECKOUT_MAP, visibility="private")
        v2 = MapVersion(label="As-Is", status="draft", checked_out_by="user.park")
        m2.versions.append(v2)
        session.add(m2)
        await session.flush()
        session.add(_owner(m2.id))
        session.add(
            CheckoutRequest(version_id=v2.id, requested_by="user.choi", status="pending")
        )

        # 3) 권한·가시성 승인 — user.jung이 가시성 변경 요청(pending)
        m3 = ProcessMap(name=APPROVAL_MAP, visibility="private")
        session.add(m3)
        await session.flush()
        session.add(_owner(m3.id))
        session.add(
            ApprovalRequest(
                map_id=m3.id,
                kind="visibility_change",
                payload={"to_visibility": "public"},
                requested_by="user.jung",
                status="pending",
            )
        )
        # 알림 하나 더 — 공지 유형(아이콘 확인용, 데모 맵에 연결해 멱등)
        session.add(
            Notification(
                recipient=VIEWER,
                type="notice",
                map_id=m3.id,
                message="새 공지: v2.4 승인 워크플로우 개편 안내가 등록되었습니다.",
                read=True,
            )
        )

        await session.commit()

    print("seeded inbox demo:")
    print("  version_approval  x2 (제출자 user.lee / user.park)")
    print("  checkout_transfer x1 (요청자 user.choi)")
    print("  approval_request  x1 (요청자 user.jung)")
    print("  notifications     x3 (review_requested x2, notice x1)")


if __name__ == "__main__":
    asyncio.run(main())

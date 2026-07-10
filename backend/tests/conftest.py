"""Test fixtures — isolated sqlite DB, app client with lifespan (table init)."""

import os
import pathlib

# app/settings import 전에 테스트 DB로 고정 — prod dev.db를 건드리지 않는다.
_TEST_DB = pathlib.Path("test_processmap.db")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///./{_TEST_DB.name}"
if _TEST_DB.exists():
    _TEST_DB.unlink()

# backend/.env(로컬 권한검증 ON)가 테스트에 새지 않도록 baseline 고정 — enforce/auth OFF.
# 권한 강제가 필요한 테스트는 enforce 픽스처가 런타임에 settings를 켠다.
os.environ["DEV_ENFORCE_PERMISSIONS"] = "false"
os.environ["AUTH_ENABLED"] = "false"
os.environ["BPM_SYSADMINS"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    # context manager 진입 시 lifespan 실행 → 테이블 생성
    with TestClient(app) as test_client:
        yield test_client


# 승인자 의미론 변경(2026-07-09): employees 행 없는 승인자는 퇴사자로 간주해 정족수에서 제외.
# 기존 테스트들의 가상 승인자 id를 활성 직원으로 시드해 종전 시나리오를 유지한다.
_TEST_APPROVER_IDS = [
    "a", "b", "a1", "a2", "boss", "lead", "x", "local-dev",
    # notif-* 승인자는 여기서 시드하지 않음 — 전역 선시드하면 공지 브로드캐스트 테스트의
    # 수신자에 포함돼 알림 개수 단언이 오염된다. test_notifications 헬퍼가 자체 시드.
]


@pytest.fixture(scope="session", autouse=True)
def seed_test_approvers(client: TestClient) -> None:
    import asyncio

    from app.db import SessionLocal
    from app.models import Employee

    async def _run() -> None:
        async with SessionLocal() as session:
            for login_id in _TEST_APPROVER_IDS:
                if await session.get(Employee, login_id) is None:
                    session.add(
                        Employee(login_id=login_id, name=login_id, source="local", active=True)
                    )
            # 오우닝 부서 필수화(2026-07-10) — 기존 테스트가 쓸 앵커 부서.
            # 어떤 테스트 액터도 이 org에 속하지 않아 파생 editor가 발동하지 않는다.
            # active=False: 공지 브로드캐스트 수신자 수 단언 오염 방지(known-path 검증은 active 무관).
            if await session.get(Employee, "owning.anchor") is None:
                session.add(
                    Employee(
                        login_id="owning.anchor",
                        name="Owning Anchor",
                        source="local",
                        active=False,
                        org_l1="Owning Anchor Division",
                        department="Owning Anchor Division",
                    )
                )
            await session.commit()

    asyncio.run(_run())

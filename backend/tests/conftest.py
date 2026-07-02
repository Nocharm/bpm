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

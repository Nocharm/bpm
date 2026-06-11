"""Test fixtures — isolated sqlite DB, app client with lifespan (table init)."""

import os
import pathlib

# app/settings import 전에 테스트 DB로 고정 — prod dev.db를 건드리지 않는다.
_TEST_DB = pathlib.Path("test_processmap.db")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///./{_TEST_DB.name}"
if _TEST_DB.exists():
    _TEST_DB.unlink()

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    # context manager 진입 시 lifespan 실행 → 테이블 생성
    with TestClient(app) as test_client:
        yield test_client

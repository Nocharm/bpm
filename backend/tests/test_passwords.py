"""로컬 계정 비밀번호 해싱 — stdlib scrypt."""

import pytest

from app.passwords import hash_password, verify_password


def test_roundtrip_accepts_correct_password():
    stored = hash_password("consultant-pw-1")
    assert verify_password("consultant-pw-1", stored) is True


def test_rejects_wrong_password():
    stored = hash_password("consultant-pw-1")
    assert verify_password("consultant-pw-2", stored) is False


def test_same_password_hashes_differently():
    """salt가 계정마다 달라야 한다 — 같은 해시면 사전 공격에 함께 뚫린다."""
    assert hash_password("same") != hash_password("same")


def test_empty_password_is_refused():
    with pytest.raises(ValueError, match="empty"):
        hash_password("")


def test_malformed_stored_value_is_false_not_crash():
    assert verify_password("anything", "not-a-valid-stored-hash") is False


def test_local_credentials_table_is_created(client):
    """lifespan의 create_all이 신규 테이블을 만드는지 — _ADDED_COLUMNS 없이 도는지 확인."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import LocalCredential

    async def _run() -> int:
        async with SessionLocal() as session:
            rows = (await session.execute(select(LocalCredential))).all()
            return len(rows)

    assert asyncio.run(_run()) == 0

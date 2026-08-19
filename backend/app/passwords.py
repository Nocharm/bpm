"""로컬 계정 비밀번호 해싱 — stdlib scrypt (새 의존성 없이, rules/common/dependencies.md)."""

import hashlib
import hmac
import secrets

# scrypt 파라미터 — n을 올리면 느려지는 만큼 무차별 대입도 느려진다. 대화형 로그인 기준 권장치.
_N = 2**14
_R = 8
_P = 1
_DKLEN = 32
_SALT_BYTES = 16


def hash_password(raw: str) -> str:
    """`<salt_hex>$<hash_hex>`. salt는 계정마다 새로 뽑는다(사전 공격 분리)."""
    if not raw:
        raise ValueError("password must not be empty")
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.scrypt(raw.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(raw: str, stored: str) -> bool:
    """상수 시간 비교. 저장값이 깨져 있어도 예외 대신 False (로그인 경계에서 500 금지)."""
    if not raw or not stored:
        return False
    salt_hex, _, digest_hex = stored.partition("$")
    if not digest_hex:
        return False
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    actual = hashlib.scrypt(raw.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return hmac.compare_digest(actual, expected)

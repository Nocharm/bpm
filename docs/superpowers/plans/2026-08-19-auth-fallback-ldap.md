# LDAP 인증 폴백 + 로컬 계정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keycloak을 쓸 수 없는 배포에서 사내 AD(LDAP)로 인증하고, AD 계정이 없는 외부 컨설턴트는 설정 화면에서 발급한 로컬 계정(ID+비밀번호)으로 접속하게 한다.

**Architecture:** 불리언 `AUTH_ENABLED`를 `AUTH_MODE=keycloak|ldap|dev` 3모드로 교체하고, 백엔드가 `GET /api/auth/mode`로 모드를 공개해 프론트가 런타임에 분기한다. `ldap` 모드에서는 `POST /api/auth/login`이 로컬 계정(scrypt) → AD bind 순으로 검증한 뒤 앱이 직접 HS256 JWT를 발급하고, 이후 요청은 기존 `Authorization: Bearer` 경로를 그대로 탄다. 로컬 계정은 `employees`(`source='local'`) 행 + 비밀번호 전용 `local_credentials` 테이블로 나눠 저장한다.

**Tech Stack:** FastAPI · SQLAlchemy(async) · PyJWT 2.13 · ldap3 2.9.1 · stdlib `hashlib.scrypt` · Next.js(React 19) · vitest · Playwright

**Spec:** [`docs/superpowers/specs/2026-08-19-auth-fallback-ldap-design.md`](../specs/2026-08-19-auth-fallback-ldap-design.md)

## Global Constraints

- **작업 브랜치:** `dev`. 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`. 각 Task 끝에서 커밋한다.
- **새 의존성 추가 금지.** 비밀번호 해싱은 stdlib `hashlib.scrypt`(`rules/common/dependencies.md`).
- **`is_sysadmin(login_id) -> bool` 시그니처를 바꾸지 않는다.** 동기 함수이며 앱 코드 33곳이 세션 없이 호출한다.
- **백엔드는 단일 uvicorn 프로세스 전제**(`backend/Dockerfile:27` — `--workers` 없음). sysadmin 캐시가 이 전제 위에 있다.
- **신규 Environment 계열 Settings 필드는 `.env.example` + `docker-compose.yml`의 backend `environment:` 블록에 함께 등록한다.** backend에는 `env_file:`이 없어 누락 시 서버에서만 조용히 기본값으로 돈다 (`rules/backend/config.md`).
- **줄바꿈 LF 고정**, 주석/설명은 한국어, 식별자·에러 메시지·커밋 문구는 영어 (`rules/guidelines.md` §5).
- **테스트 전체 그린 확인 명령:** `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (backend/ 에서).
- **비밀은 절대 커밋하지 않는다.** `AUTH_JWT_SECRET`은 `.env.example`에 빈 값 + 주석만.
- 프론트 UI 문구는 영어, `data-id`는 `surface-role` kebab-case (`rules/frontend/identifiers.md`).

---

### Task 1: `AUTH_MODE` 설정과 모드 공개 엔드포인트

3모드 스위치를 백엔드에 들이고, 프론트가 런타임에 읽을 수 있게 공개한다. 이 Task 하나로 "모드"라는 개념이 코드에 존재하게 된다.

**Files:**
- Modify: `backend/app/settings.py:13-23` (auth 관련 필드)
- Create: `backend/app/routers/auth.py`
- Modify: `backend/app/main.py` (라우터 등록)
- Modify: `.env.example`, `docker-compose.yml`
- Test: `backend/tests/test_auth_mode.py`

**Interfaces:**
- Consumes: 없음 (첫 Task)
- Produces:
  - `settings.auth_mode: str` — 원시 env 값(`""` 가능)
  - `settings.resolved_auth_mode() -> str` — 항상 `"keycloak" | "ldap" | "dev"` 중 하나를 반환
  - `GET /api/auth/mode` → `{"mode": str, "keycloakIssuer": str, "keycloakClientId": str}`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_auth_mode.py` 생성:

```python
"""AUTH_MODE 해석과 모드 공개 엔드포인트."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


@pytest.fixture
def restore_auth_settings():
    """settings를 런타임에 바꾸는 테스트용 — 원복 보장."""
    saved = (settings.auth_mode, settings.auth_enabled)
    yield
    settings.auth_mode, settings.auth_enabled = saved


def test_resolved_mode_falls_back_to_auth_enabled_true(restore_auth_settings):
    settings.auth_mode = ""
    settings.auth_enabled = True
    assert settings.resolved_auth_mode() == "keycloak"


def test_resolved_mode_falls_back_to_auth_enabled_false(restore_auth_settings):
    settings.auth_mode = ""
    settings.auth_enabled = False
    assert settings.resolved_auth_mode() == "dev"


def test_explicit_mode_wins_over_auth_enabled(restore_auth_settings):
    settings.auth_mode = "ldap"
    settings.auth_enabled = False
    assert settings.resolved_auth_mode() == "ldap"


def test_unknown_mode_is_rejected(restore_auth_settings):
    settings.auth_mode = "bogus"
    with pytest.raises(ValueError, match="unknown AUTH_MODE"):
        settings.resolved_auth_mode()


def test_mode_endpoint_needs_no_auth(client: TestClient, restore_auth_settings):
    settings.auth_mode = "ldap"
    res = client.get("/api/auth/mode")
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "ldap"
    assert "keycloakIssuer" in body and "keycloakClientId" in body
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_auth_mode.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'auth_mode'`

- [ ] **Step 3: Settings에 모드 필드 추가**

`backend/app/settings.py`, `auth_enabled` 선언 바로 아래에 삽입:

```python
    # 인증 모드 — keycloak(운영 OIDC) | ldap(사내 AD 직접 인증) | dev(로컬 우회).
    # 비우면 아래 auth_enabled로 유도한다(기존 .env 무수정 동작).
    auth_mode: str = ""
    # ldap 모드 세션 토큰 서명키 — 유출 시 전 계정 위조 가능. .env 전용, 커밋 금지.
    auth_jwt_secret: str = ""
    # 발급 토큰 수명(시간). 무상태라 만료 전 강제 로그아웃이 불가하므로 짧게 유지한다.
    auth_jwt_ttl_hours: int = 8
```

같은 파일 `ldap_enabled` property 위에 메서드 추가:

```python
    def resolved_auth_mode(self) -> str:
        """항상 keycloak|ldap|dev 중 하나. auth_mode가 비면 구 auth_enabled로 유도."""
        raw = self.auth_mode.strip().lower()
        if not raw:
            return "keycloak" if self.auth_enabled else "dev"
        if raw not in ("keycloak", "ldap", "dev"):
            raise ValueError(f"unknown AUTH_MODE: {self.auth_mode!r}")
        return raw
```

- [ ] **Step 4: 모드 공개 라우터 작성**

`backend/app/routers/auth.py` 생성:

```python
"""인증 모드 공개 · LDAP 모드 로그인 (설계: 2026-08-19-auth-fallback-ldap-design.md)."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.settings import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthModeOut(BaseModel):
    mode: str
    keycloak_issuer: str
    keycloak_client_id: str

    model_config = {"populate_by_name": True, "alias_generator": None}


@router.get("/mode")
async def get_auth_mode() -> dict[str, str]:
    """프론트 부팅용 — 인증 불필요. 시크릿은 절대 넣지 않는다.

    issuer/client_id는 비밀이 아니다(브라우저가 리다이렉트 URL로 이미 노출한다).
    """
    return {
        "mode": settings.resolved_auth_mode(),
        "keycloakIssuer": settings.keycloak_issuer,
        "keycloakClientId": settings.keycloak_client_id,
    }
```

`settings.py`에 `keycloak_client_id` 필드가 없으면 `keycloak_audience` 아래에 추가:

```python
    # 프론트가 OIDC 클라이언트로 쓸 id — 비밀 아님(브라우저 노출값)
    keycloak_client_id: str = ""
```

- [ ] **Step 5: 라우터 등록**

`backend/app/main.py`의 `app.include_router(...)` 블록에서 알파벳 순서에 맞춰 추가한다. import 줄은 기존 라우터 import와 같은 그룹에 넣는다:

```python
from app.routers import auth as auth_router
...
app.include_router(auth_router.router)
```

`app.main`에 이미 `from app.auth import ...`가 있다면 이름 충돌을 피하려고 `auth_router` 별칭을 반드시 쓴다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_auth_mode.py -v`
Expected: PASS (5 passed)

- [ ] **Step 7: 배포 설정 동기화**

`.env.example`의 `AUTH_ENABLED=true` 바로 위에 추가:

```
# 인증 모드 — keycloak | ldap | dev. 비우면 아래 AUTH_ENABLED로 유도(하위호환).
#  · keycloak: 운영 기본(OIDC)
#  · ldap    : 사내 AD 직접 인증 + 설정 화면에서 발급한 로컬 계정
#  · dev     : 로컬 우회(임시 유저)
AUTH_MODE=
# ldap 모드 세션 서명키 — ldap 모드면 필수. 예: openssl rand -hex 32
AUTH_JWT_SECRET=
# 발급 토큰 수명(시간)
AUTH_JWT_TTL_HOURS=8
# 프론트 OIDC 클라이언트 id (keycloak 모드)
KEYCLOAK_CLIENT_ID=bpm-frontend
```

`docker-compose.yml` backend `environment:` 블록의 `AUTH_ENABLED` 옆에 추가:

```yaml
      AUTH_MODE: ${AUTH_MODE:-}
      AUTH_JWT_SECRET: ${AUTH_JWT_SECRET:-}
      AUTH_JWT_TTL_HOURS: ${AUTH_JWT_TTL_HOURS:-8}
      KEYCLOAK_CLIENT_ID: ${KEYCLOAK_CLIENT_ID:-}
```

- [ ] **Step 8: 전체 테스트 + 린트**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS, 린트 clean

- [ ] **Step 9: 커밋**

```bash
git add backend/app/settings.py backend/app/routers/auth.py backend/app/main.py backend/tests/test_auth_mode.py .env.example docker-compose.yml
git commit -m "feat(auth): introduce AUTH_MODE and expose it at runtime — 인증 모드 3종화·런타임 노출"
```

---

### Task 2: 자체 세션 토큰 발급·검증

앱이 직접 서명하는 HS256 토큰을 만든다. 이 Task까지는 아무도 이 토큰을 발급하지 않지만, 발급기와 검증기가 먼저 있어야 다음 Task들이 붙는다.

**Files:**
- Create: `backend/app/tokens.py`
- Modify: `backend/app/auth.py:22-51`
- Test: `backend/tests/test_tokens.py`

**Interfaces:**
- Consumes: `settings.resolved_auth_mode()`, `settings.auth_jwt_secret`, `settings.auth_jwt_ttl_hours` (Task 1)
- Produces:
  - `create_access_token(login_id: str) -> tuple[str, datetime]` — (토큰, 만료시각)
  - `decode_access_token(token: str) -> str` — loginId 반환, 실패 시 `ValueError`
  - `get_current_user`가 `ldap` 모드에서 위 토큰을 검증

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_tokens.py` 생성:

```python
"""자체 HS256 세션 토큰 발급·검증."""

from datetime import timedelta

import jwt
import pytest

from app import tokens
from app.clock import now as now_kst
from app.settings import settings


@pytest.fixture
def signing_secret():
    saved = settings.auth_jwt_secret
    settings.auth_jwt_secret = "test-secret-please-ignore"
    yield
    settings.auth_jwt_secret = saved


def test_roundtrip_returns_login_id(signing_secret):
    token, expires_at = tokens.create_access_token("consultant.a")
    assert tokens.decode_access_token(token) == "consultant.a"
    assert expires_at > now_kst()


def test_tampered_token_is_rejected(signing_secret):
    token, _ = tokens.create_access_token("consultant.a")
    forged = jwt.encode({"sub": "admin.kim"}, "wrong-secret", algorithm="HS256")
    with pytest.raises(ValueError):
        tokens.decode_access_token(forged)
    # 원본은 여전히 유효 — 위조만 걸러진다
    assert tokens.decode_access_token(token) == "consultant.a"


def test_expired_token_is_rejected(signing_secret):
    past = now_kst() - timedelta(hours=1)
    expired = jwt.encode(
        {"sub": "consultant.a", "exp": past}, settings.auth_jwt_secret, algorithm="HS256"
    )
    with pytest.raises(ValueError, match="expired"):
        tokens.decode_access_token(expired)


def test_empty_secret_refuses_to_sign():
    saved = settings.auth_jwt_secret
    settings.auth_jwt_secret = ""
    try:
        with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
            tokens.create_access_token("consultant.a")
    finally:
        settings.auth_jwt_secret = saved
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_tokens.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tokens'`

- [ ] **Step 3: 토큰 모듈 구현**

`backend/app/tokens.py` 생성:

```python
"""ldap 모드 세션 토큰 — 앱이 직접 서명하는 HS256 JWT (설계 §4).

Keycloak 모드는 realm이 발급한 RS256을 검증만 하지만, ldap 모드는 발급자가 없어
앱이 직접 서명한다. 무상태라 만료 전 강제 로그아웃은 불가능하다(설계 §4 한계).
"""

from datetime import datetime, timedelta

import jwt

from app.clock import now as now_kst
from app.settings import settings

_ALGORITHM = "HS256"


def create_access_token(login_id: str) -> tuple[str, datetime]:
    """(토큰, 만료시각). 시크릿이 비면 위조가 자유로워지므로 서명 자체를 거부한다."""
    if not settings.auth_jwt_secret:
        raise RuntimeError("AUTH_JWT_SECRET is empty — refusing to sign a forgeable token")
    expires_at = now_kst() + timedelta(hours=settings.auth_jwt_ttl_hours)
    token = jwt.encode(
        {"sub": login_id, "exp": expires_at}, settings.auth_jwt_secret, algorithm=_ALGORITHM
    )
    return token, expires_at


def decode_access_token(token: str) -> str:
    """loginId 반환. 서명 불일치·만료·subject 부재는 모두 ValueError."""
    if not settings.auth_jwt_secret:
        raise RuntimeError("AUTH_JWT_SECRET is empty — cannot verify tokens")
    try:
        claims = jwt.decode(token, settings.auth_jwt_secret, algorithms=[_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("token expired") from exc
    except jwt.PyJWTError as exc:
        raise ValueError(f"invalid token: {exc}") from exc
    login_id = claims.get("sub")
    if not login_id:
        raise ValueError("token has no subject")
    return login_id
```

- [ ] **Step 4: `get_current_user`를 모드별로 분기**

`backend/app/auth.py`의 `get_current_user` 본문을 교체한다. 기존 Keycloak 검증 로직은 `_decode_keycloak_token`으로 그대로 옮긴다:

```python
def get_current_user(
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None),
) -> str:
    """요청 사용자 loginId. 모드별로 검증기만 다르고 반환 계약은 같다 (설계 §4)."""
    mode = settings.resolved_auth_mode()
    if mode == "dev":
        return x_dev_user or settings.dev_user  # 헤더는 dev 모드에서만 신뢰

    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.removeprefix("Bearer ")

    if mode == "ldap":
        try:
            return tokens.decode_access_token(token)
        except ValueError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
    return _decode_keycloak_token(token)


def _decode_keycloak_token(token: str) -> str:
    """realm JWKS로 RS256 검증 — 기존 동작 그대로."""
    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.keycloak_issuer,
            # 빈 문자열(미설정·compose 기본 ${VAR:-})도 None과 동일하게 aud 검증 생략 — 아니면 토큰이 항상 깨짐
            audience=settings.keycloak_audience or None,
            options={"verify_aud": bool(settings.keycloak_audience)},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"invalid token: {exc}") from exc
    username = claims.get("preferred_username") or claims.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="token has no subject")
    return username
```

파일 상단 import에 `from app import tokens`를 로컬 import 그룹에 추가한다.

- [ ] **Step 5: 모드 분기 테스트 추가**

`backend/tests/test_tokens.py` 끝에 추가:

```python
def test_ldap_mode_accepts_self_issued_token(client, signing_secret):
    from app.settings import settings as s

    saved_mode = s.auth_mode
    s.auth_mode = "ldap"
    try:
        token, _ = tokens.create_access_token("local-dev")
        res = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["loginId"] == "local-dev"

        res_bad = client.get("/api/me", headers={"Authorization": "Bearer nonsense"})
        assert res_bad.status_code == 401
    finally:
        s.auth_mode = saved_mode
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_tokens.py -v`
Expected: PASS (5 passed)

- [ ] **Step 7: 시크릿 없는 ldap 모드는 기동을 막는다**

빈 시크릿으로 뜨면 누구나 토큰을 위조할 수 있으므로 조용히 넘어가면 안 된다(설계 §7). `backend/app/main.py`의 `lifespan` 맨 앞에 추가:

```python
    # ldap 모드인데 서명키가 없으면 위조가 자유로워진다 — 조용히 뜨는 대신 기동을 막는다 (설계 §7)
    if settings.resolved_auth_mode() == "ldap" and not settings.auth_jwt_secret:
        raise RuntimeError("AUTH_MODE=ldap requires AUTH_JWT_SECRET to be set")
```

테스트를 `backend/tests/test_tokens.py`에 추가:

```python
def test_ldap_mode_without_secret_refuses_to_start():
    """기동 게이트 — lifespan이 올라가기 전에 막힌다."""
    from fastapi.testclient import TestClient

    from app.main import app
    from app.settings import settings as s

    saved = (s.auth_mode, s.auth_jwt_secret)
    s.auth_mode = "ldap"
    s.auth_jwt_secret = ""
    try:
        with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
            with TestClient(app):
                pass
    finally:
        s.auth_mode, s.auth_jwt_secret = saved
```

- [ ] **Step 8: 전체 테스트 + 린트**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS

- [ ] **Step 9: 커밋**

```bash
git add backend/app/tokens.py backend/app/auth.py backend/app/main.py backend/tests/test_tokens.py
git commit -m "feat(auth): issue and verify app-signed session tokens for ldap mode — ldap 모드 자체 세션 토큰"
```

---

### Task 3: 로컬 계정 저장 — 모델과 비밀번호 해싱

컨설턴트 계정의 비밀번호를 안전하게 저장할 자리를 만든다.

**Files:**
- Create: `backend/app/passwords.py`
- Modify: `backend/app/models.py` (`LoginRecord` 클래스 아래에 신규 모델)
- Test: `backend/tests/test_passwords.py`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `hash_password(raw: str) -> str` — `"<salt_hex>$<hash_hex>"`
  - `verify_password(raw: str, stored: str) -> bool`
  - `models.LocalCredential` — 컬럼 `login_id`(PK), `password_hash`, `is_sysadmin`, `created_by`, `created_at`, `updated_at`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_passwords.py` 생성:

```python
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_passwords.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.passwords'`

- [ ] **Step 3: 해싱 모듈 구현**

`backend/app/passwords.py` 생성:

```python
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_passwords.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: 모델 추가**

`backend/app/models.py`의 `LoginRecord` 클래스 아래에 삽입:

```python
class LocalCredential(Base):
    """로컬 계정(외부 컨설턴트) 자격증명 — AD 계정이 없는 사용자용 (설계 §3).

    디렉터리 정보는 employees(source='local') 행이 갖고, 여기엔 비밀번호와 sysadmin
    부여만 둔다. employees에 합치면 raw dict로 직렬화하는 엔드포인트를 통해 해시가
    새어나갈 경로가 생긴다.
    """

    __tablename__ = "local_credentials"

    login_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    # 설정 화면에서 부여하는 시스템 관리자 — permissions.logic 캐시에 반영된다 (설계 §3.1)
    is_sysadmin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
```

신규 **테이블**이므로 `db.py`의 `_ADDED_COLUMNS`에는 등록하지 않는다 — `create_all`이 모든 컬럼과 함께 생성한다(`db.py:118-119` 주석과 동일한 이유).

- [ ] **Step 6: 모델 생성 확인 테스트 추가**

`backend/tests/test_passwords.py` 끝에 추가:

```python
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
```

`asyncio.run(...)`은 `conftest.py:70`의 `seed_test_approvers`가 쓰는 방식과 같다 — 이 저장소에서 테스트가 async 코드를 돌리는 표준 패턴이다.

- [ ] **Step 7: 전체 테스트 + 린트**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```bash
git add backend/app/passwords.py backend/app/models.py backend/tests/test_passwords.py
git commit -m "feat(auth): store local account credentials with scrypt hashing — 로컬 계정 자격증명 저장"
```

---

### Task 4: 설정 화면에서 부여하는 sysadmin (판정 캐시)

`is_sysadmin`이 env 외에 DB 부여분도 보게 한다. 시그니처를 지키기 위해 메모리 집합을 쓴다.

**Files:**
- Modify: `backend/app/permissions/logic.py:43-52`
- Modify: `backend/app/main.py` (lifespan에서 캐시 로드)
- Test: `backend/tests/test_sysadmin_grant.py`

**Interfaces:**
- Consumes: `models.LocalCredential` (Task 3)
- Produces:
  - `logic.grant_sysadmin_cache(login_ids: set[str]) -> None` — 캐시 전체 교체
  - `logic.add_granted_sysadmin(login_id: str) -> None`
  - `logic.remove_granted_sysadmin(login_id: str) -> None`
  - `logic.load_granted_sysadmins(session) -> None` — DB에서 읽어 캐시 교체 (async)
  - `is_sysadmin(login_id)` 동작 확장 (시그니처 불변)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_sysadmin_grant.py` 생성:

```python
"""설정 화면 부여 sysadmin — env와 별개 경로, is_sysadmin 시그니처는 불변."""

import pytest

from app.permissions import logic
from app.settings import settings


@pytest.fixture
def enforce_permissions():
    """전원 sysadmin이 되는 로컬 기본 동작을 끄고 실제 판정을 보게 한다."""
    saved = (settings.auth_mode, settings.dev_enforce_permissions, settings.bpm_sysadmins)
    settings.auth_mode = "ldap"
    settings.dev_enforce_permissions = True
    yield
    settings.auth_mode, settings.dev_enforce_permissions, settings.bpm_sysadmins = saved
    logic.grant_sysadmin_cache(set())


def test_granted_login_id_becomes_sysadmin(enforce_permissions):
    assert logic.is_sysadmin("consultant.a") is False
    logic.add_granted_sysadmin("consultant.a")
    assert logic.is_sysadmin("consultant.a") is True


def test_revoking_takes_effect_immediately(enforce_permissions):
    logic.add_granted_sysadmin("consultant.a")
    logic.remove_granted_sysadmin("consultant.a")
    assert logic.is_sysadmin("consultant.a") is False


def test_env_sysadmin_survives_cache_replacement(enforce_permissions):
    """BPM_SYSADMINS는 UI 회수의 사정권 밖 — 캐시를 비워도 유지된다(설계 §3.1 불변식)."""
    settings.bpm_sysadmins = "admin.sys"
    logic.grant_sysadmin_cache(set())
    assert logic.is_sysadmin("admin.sys") is True


def test_cache_replacement_drops_previous_grants(enforce_permissions):
    logic.add_granted_sysadmin("consultant.a")
    logic.grant_sysadmin_cache({"consultant.b"})
    assert logic.is_sysadmin("consultant.a") is False
    assert logic.is_sysadmin("consultant.b") is True
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_sysadmin_grant.py -v`
Expected: FAIL — `AttributeError: module 'app.permissions.logic' has no attribute 'grant_sysadmin_cache'`

- [ ] **Step 3: 캐시와 판정 확장 구현**

`backend/app/permissions/logic.py`의 `is_sysadmin` 정의를 다음으로 교체:

```python
# 설정 화면에서 부여한 sysadmin — local_credentials가 원본, 이건 조회 캐시다 (설계 §3.1).
# is_sysadmin은 동기 함수이고 앱 33곳이 세션 없이 호출하므로 DB를 직접 읽을 수 없다.
# 전제: 백엔드는 단일 uvicorn 프로세스(Dockerfile에 --workers 없음). 워커를 늘리면
# 프로세스별 캐시가 갈라져 부여·회수가 일부 워커에만 반영된다 → 그때는 DB 조회로 전환할 것.
_granted_sysadmins: set[str] = set()


def grant_sysadmin_cache(login_ids: set[str]) -> None:
    """캐시 전체 교체 — 기동 시 DB 로드용."""
    global _granted_sysadmins
    _granted_sysadmins = set(login_ids)


def add_granted_sysadmin(login_id: str) -> None:
    _granted_sysadmins.add(login_id)


def remove_granted_sysadmin(login_id: str) -> None:
    _granted_sysadmins.discard(login_id)


def is_sysadmin(login_id: str) -> bool:
    """BPM 시스템 관리자 판정.

    dev 모드 + dev_enforce_permissions OFF → 전원 True (로컬 잠금 방지, 현행 동작).
    그 외 → BPM_SYSADMINS 목록 또는 설정 화면에서 부여한 로컬 계정.
    """
    if settings.resolved_auth_mode() == "dev" and not settings.dev_enforce_permissions:
        return True
    return login_id in settings.sysadmin_login_ids() or login_id in _granted_sysadmins
```

> 기존 조건은 `not settings.auth_enabled`였다. Task 1에서 모드가 도입됐으므로 `resolved_auth_mode() == "dev"`로 바꾼다 — 의미는 동일하고(`auth_enabled=False` → `dev`), `ldap` 모드에서 전원 sysadmin이 되는 사고를 막는다.

- [ ] **Step 4: 기동 시 DB 로드 추가**

`backend/app/permissions/logic.py` 파일 끝에 async 로더를 둔다. `logic.py`가 모델을 import하지 않는다면 함수 안에서 지연 import한다:

```python
async def load_granted_sysadmins(session) -> None:
    """기동 시 local_credentials에서 부여분을 읽어 캐시를 채운다."""
    from sqlalchemy import select

    from app.models import LocalCredential

    rows = await session.execute(
        select(LocalCredential.login_id).where(LocalCredential.is_sysadmin.is_(True))
    )
    grant_sysadmin_cache({row[0] for row in rows})
```

`backend/app/main.py`의 `lifespan`에서 `init_models()` 다음에 호출:

```python
    # 설정 화면 부여 sysadmin 캐시 로드 — 기동 시 1회 (설계 §3.1)
    async with SessionLocal() as session:
        await logic.load_granted_sysadmins(session)
```

`main.py`에 `from app.permissions import logic` import가 없으면 추가한다(이미 `from app.permissions.logic import is_sysadmin`가 있으므로 모듈 import를 함께 둔다).

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_sysadmin_grant.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: 전체 테스트 + 린트**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS. **`auth_enabled` → `resolved_auth_mode()` 교체로 기존 권한 테스트가 깨지면, 깨진 테스트가 기대하는 모드를 확인하고 fixture에서 `auth_mode`를 명시하도록 고친다.**

- [ ] **Step 7: 커밋**

```bash
git add backend/app/permissions/logic.py backend/app/main.py backend/tests/test_sysadmin_grant.py
git commit -m "feat(auth): let local accounts hold sysadmin via a refreshed cache — 로컬 계정 sysadmin 부여"
```

---

### Task 5: AD 사용자 인증 bind

`ad/client.py`가 지금은 서비스 계정으로만 bind한다. 사용자 자격증명으로 bind하는 함수를 더한다.

**Files:**
- Modify: `backend/app/ad/client.py`
- Test: `backend/tests/test_ad_authenticate.py`

**Interfaces:**
- Consumes: `settings.ldap_enabled`, 기존 `client.py`의 서버·연결 구성
- Produces: `authenticate_user(login_id: str, password: str) -> bool`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ad_authenticate.py` 생성:

```python
"""AD 사용자 bind — 실제 LDAP 서버 없이 ldap3 연결을 대체해 검증."""

import pytest

from app.ad import client
from app.settings import settings


@pytest.fixture
def ldap_configured(monkeypatch):
    monkeypatch.setattr(settings, "ldap_url", "ldap://ad.example.test")
    monkeypatch.setattr(settings, "ldap_bind_dn", "CN=svc,DC=example,DC=test")
    monkeypatch.setattr(settings, "ldap_bind_credentials", "svc-pw")
    monkeypatch.setattr(settings, "ldap_user_search_base", "DC=example,DC=test")


def test_empty_password_is_rejected_without_touching_ldap(ldap_configured, monkeypatch):
    """LDAP unauthenticated bind는 빈 비밀번호에 성공을 돌려준다 — 서버에 닿기 전에 막는다."""

    def _explode(*args, **kwargs):
        raise AssertionError("must not reach LDAP for an empty password")

    monkeypatch.setattr(client, "_find_user_dn", _explode)
    assert client.authenticate_user("consultant.a", "") is False


def test_returns_false_when_user_dn_not_found(ldap_configured, monkeypatch):
    monkeypatch.setattr(client, "_find_user_dn", lambda login_id: None)
    assert client.authenticate_user("ghost", "pw") is False


def test_returns_true_when_user_bind_succeeds(ldap_configured, monkeypatch):
    monkeypatch.setattr(client, "_find_user_dn", lambda login_id: "CN=A,DC=example,DC=test")
    monkeypatch.setattr(client, "_try_bind", lambda user_dn, password: True)
    assert client.authenticate_user("consultant.a", "pw") is True


def test_returns_false_when_user_bind_fails(ldap_configured, monkeypatch):
    monkeypatch.setattr(client, "_find_user_dn", lambda login_id: "CN=A,DC=example,DC=test")
    monkeypatch.setattr(client, "_try_bind", lambda user_dn, password: False)
    assert client.authenticate_user("consultant.a", "wrong") is False


def test_returns_false_when_ldap_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ldap_url", "")
    assert client.authenticate_user("consultant.a", "pw") is False
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ad_authenticate.py -v`
Expected: FAIL — `AttributeError: module 'app.ad.client' has no attribute 'authenticate_user'`

- [ ] **Step 3: 인증 bind 구현**

`backend/app/ad/client.py` 끝에 추가한다. 서버 객체 생성은 기존 코드(`client.py:45-51` 부근)가 쓰는 방식을 그대로 재사용한다 — 새 방식을 만들지 말고 기존 `Server(...)` 구성 코드를 읽고 맞춘다:

```python
def _find_user_dn(login_id: str) -> str | None:
    """서비스 계정으로 sAMAccountName을 검색해 DN을 얻는다. 없으면 None."""
    conn = _open_service_connection()
    try:
        conn.search(
            search_base=settings.ldap_user_search_base,
            search_filter=f"(sAMAccountName={escape_filter_chars(login_id)})",
            attributes=["distinguishedName"],
            size_limit=1,
        )
        if not conn.entries:
            return None
        return str(conn.entries[0].entry_dn)
    finally:
        conn.unbind()


def _try_bind(user_dn: str, password: str) -> bool:
    """사용자 DN으로 bind 시도. 자격증명이 틀리면 ldap3가 실패를 반환한다."""
    server = _build_server()
    conn = Connection(server, user=user_dn, password=password, auto_bind=False)
    try:
        return bool(conn.bind())
    except LDAPException:
        return False
    finally:
        try:
            conn.unbind()
        except LDAPException:
            pass  # 이미 끊긴 연결 — 정리 실패는 인증 결과에 영향 없음


def authenticate_user(login_id: str, password: str) -> bool:
    """사용자 자격증명 검증. 실패 사유는 구분하지 않는다(계정 존재 노출 금지).

    빈 비밀번호는 LDAP unauthenticated bind로 '성공'이 되므로 서버에 닿기 전에 막는다.
    """
    if not password:
        return False
    if not settings.ldap_enabled:
        return False
    user_dn = _find_user_dn(login_id)
    if user_dn is None:
        return False
    return _try_bind(user_dn, password)
```

`_open_service_connection()`·`_build_server()`가 아직 없으면, `client.py:40-51`의 기존 연결 생성 코드를 그 두 헬퍼로 **추출**해 기존 호출부도 함께 쓰게 한다(중복 구성 금지). `escape_filter_chars`는 `ldap3.utils.conv`에서 import한다 — **LDAP 인젝션 방어에 필수다.**

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ad_authenticate.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: 전체 테스트 + 린트**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/ad/client.py backend/tests/test_ad_authenticate.py
git commit -m "feat(ad): authenticate a user by binding with their own credentials — AD 사용자 인증 bind"
```

---

### Task 6: 로그인 엔드포인트 — 로컬 우선, AD 폴백, 시도 제한

**Files:**
- Create: `backend/app/login_throttle.py`
- Modify: `backend/app/routers/auth.py`
- Modify: `backend/app/schemas.py` (요청·응답 모델)
- Test: `backend/tests/test_auth_login.py`

**Interfaces:**
- Consumes: `passwords.verify_password` (Task 3), `tokens.create_access_token` (Task 2), `ad.client.authenticate_user` (Task 5), `models.LocalCredential`·`models.Employee`
- Produces:
  - `POST /api/auth/login` — body `{"loginId": str, "password": str}` → 200 `{"token": str, "expiresAt": str}` / 401 / 404(모드 불일치)
  - `login_throttle.check_and_count(key: str) -> bool` — 허용이면 True
  - `login_throttle.reset(key: str) -> None`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_auth_login.py` 생성:

```python
"""ldap 모드 로그인 — 로컬 계정 우선, AD 폴백, 시도 제한."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import login_throttle
from app.ad import client as ad_client
from app.db import SessionLocal
from app.models import Employee, LocalCredential
from app.passwords import hash_password
from app.settings import settings


@pytest.fixture
def ldap_mode():
    saved = (settings.auth_mode, settings.auth_jwt_secret)
    settings.auth_mode = "ldap"
    settings.auth_jwt_secret = "test-secret-please-ignore"
    login_throttle.clear_all()
    yield
    settings.auth_mode, settings.auth_jwt_secret = saved
    login_throttle.clear_all()


def _seed_local_account(login_id: str, password: str, active: bool = True) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            if await session.get(Employee, login_id) is None:
                session.add(
                    Employee(login_id=login_id, name=login_id, source="local", active=active)
                )
            if await session.get(LocalCredential, login_id) is None:
                session.add(
                    LocalCredential(
                        login_id=login_id,
                        password_hash=hash_password(password),
                        created_by="admin.sys",
                    )
                )
            await session.commit()

    asyncio.run(_run())


def test_local_account_logs_in(client: TestClient, ldap_mode):
    _seed_local_account("consultant.a", "pw-correct")
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.a", "password": "pw-correct"}
    )
    assert res.status_code == 200
    assert res.json()["token"]

    me = client.get("/api/me", headers={"Authorization": f"Bearer {res.json()['token']}"})
    assert me.status_code == 200
    assert me.json()["loginId"] == "consultant.a"


def test_wrong_password_is_401(client: TestClient, ldap_mode):
    _seed_local_account("consultant.b", "pw-correct")
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.b", "password": "pw-wrong"}
    )
    assert res.status_code == 401


def test_local_account_never_reaches_ad(client: TestClient, ldap_mode, monkeypatch):
    """컨설턴트 비밀번호를 사내 AD로 보내지 않는다 (설계 §4)."""
    _seed_local_account("consultant.c", "pw-correct")

    def _explode(*args, **kwargs):
        raise AssertionError("local account must not be sent to AD")

    monkeypatch.setattr(ad_client, "authenticate_user", _explode)
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.c", "password": "pw-correct"}
    )
    assert res.status_code == 200


def test_unknown_login_id_falls_back_to_ad(client: TestClient, ldap_mode, monkeypatch):
    async def _seed_employee() -> None:
        async with SessionLocal() as session:
            if await session.get(Employee, "ad.user") is None:
                session.add(
                    Employee(login_id="ad.user", name="AD User", source="ad", active=True)
                )
                await session.commit()

    asyncio.get_event_loop().run_until_complete(_seed_employee())
    monkeypatch.setattr(ad_client, "authenticate_user", lambda login_id, password: True)
    res = client.post("/api/auth/login", json={"loginId": "ad.user", "password": "pw"})
    assert res.status_code == 200


def test_inactive_employee_is_rejected(client: TestClient, ldap_mode):
    _seed_local_account("consultant.gone", "pw-correct", active=False)
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.gone", "password": "pw-correct"}
    )
    assert res.status_code == 401


def test_empty_password_is_rejected(client: TestClient, ldap_mode):
    _seed_local_account("consultant.d", "pw-correct")
    res = client.post("/api/auth/login", json={"loginId": "consultant.d", "password": ""})
    assert res.status_code == 401


def test_repeated_failures_are_throttled(client: TestClient, ldap_mode):
    _seed_local_account("consultant.e", "pw-correct")
    for _ in range(login_throttle.MAX_ATTEMPTS):
        client.post(
            "/api/auth/login", json={"loginId": "consultant.e", "password": "pw-wrong"}
        )
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.e", "password": "pw-correct"}
    )
    assert res.status_code == 429


def test_login_is_404_outside_ldap_mode(client: TestClient):
    res = client.post("/api/auth/login", json={"loginId": "x", "password": "y"})
    assert res.status_code == 404
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_auth_login.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.login_throttle'`

- [ ] **Step 3: 시도 제한 구현**

`backend/app/login_throttle.py` 생성:

```python
"""로그인 시도 제한 — 앱이 AD에 무제한 bind를 중계해 실계정을 잠그는 것을 막는다 (설계 §4).

프로세스 메모리에만 둔다. 백엔드는 단일 uvicorn 프로세스라 이걸로 충분하다.
"""

from app.clock import now as now_kst

# 임계치를 올리면 무차별 대입 여지가 커지고, 내리면 오타 몇 번에 잠긴다. AD 기본 잠금정책보다 빡빡하게.
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 300

_failures: dict[str, list[float]] = {}


def check_and_count(key: str) -> bool:
    """윈도 내 실패가 임계 미만이면 True. 호출 자체는 카운트하지 않는다."""
    now = now_kst().timestamp()
    recent = [t for t in _failures.get(key, []) if now - t < WINDOW_SECONDS]
    _failures[key] = recent
    return len(recent) < MAX_ATTEMPTS


def record_failure(key: str) -> None:
    _failures.setdefault(key, []).append(now_kst().timestamp())


def reset(key: str) -> None:
    """로그인 성공 시 호출 — 정상 사용자가 이전 오타로 잠기지 않게."""
    _failures.pop(key, None)


def clear_all() -> None:
    """테스트 전용."""
    _failures.clear()
```

- [ ] **Step 4: 스키마 추가**

`backend/app/schemas.py` 끝에 추가:

```python
class LoginIn(BaseModel):
    login_id: str = Field(alias="loginId", min_length=1, max_length=100)
    password: str = Field(max_length=200)

    model_config = ConfigDict(populate_by_name=True)


class LoginOut(BaseModel):
    token: str
    expires_at: datetime = Field(serialization_alias="expiresAt")
```

> `schemas.py`가 이미 쓰는 alias 스타일(camelCase 직렬화 방식)을 파일에서 확인하고 그 컨벤션에 맞춘다. 파일 전역 설정이 있으면 위 `model_config`는 불필요하다.

- [ ] **Step 5: 로그인 엔드포인트 구현**

`backend/app/routers/auth.py`에 추가:

```python
logger = logging.getLogger(__name__)


@router.post("/login", response_model=LoginOut)
async def handle_login(
    body: LoginIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LoginOut:
    """ldap 모드 로그인 — 로컬 계정 우선, 없으면 AD bind (설계 §4).

    실패 사유는 구분하지 않는다 — 계정 존재 여부가 401 메시지로 새면 안 된다.
    """
    if settings.resolved_auth_mode() != "ldap":
        raise HTTPException(status_code=404, detail="not found")

    client_ip = request.client.host if request.client else "unknown"
    throttle_key = f"{body.login_id}|{client_ip}"
    if not login_throttle.check_and_count(throttle_key):
        raise HTTPException(status_code=429, detail="too many attempts, try again later")

    employee = await session.get(Employee, body.login_id)
    credential = await session.get(LocalCredential, body.login_id)

    ok = False
    if employee is not None and employee.active:
        if credential is not None:
            # 로컬 계정은 AD로 보내지 않는다 — 컨설턴트 비밀번호가 사내 AD에 흘러가지 않게.
            ok = verify_password(body.password, credential.password_hash)
        else:
            ok = ad_client.authenticate_user(body.login_id, body.password)

    if not ok:
        login_throttle.record_failure(throttle_key)
        # 실패는 login_records에 남기지 않는다 — 사용 현황 집계가 오염된다(설계 §4).
        logger.warning("login failed login_id=%s ip=%s", body.login_id, client_ip)
        raise HTTPException(status_code=401, detail="invalid credentials")

    login_throttle.reset(throttle_key)
    token, expires_at = create_access_token(body.login_id)
    return LoginOut(token=token, expires_at=expires_at)
```

필요한 import를 파일 상단에 그룹 규칙대로 추가한다:

```python
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app import login_throttle
from app.ad import client as ad_client
from app.db import get_session
from app.models import Employee, LocalCredential
from app.passwords import verify_password
from app.schemas import LoginIn, LoginOut
from app.settings import settings
from app.tokens import create_access_token
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_auth_login.py -v`
Expected: PASS (8 passed)

- [ ] **Step 7: 전체 테스트 + 린트**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```bash
git add backend/app/login_throttle.py backend/app/routers/auth.py backend/app/schemas.py backend/tests/test_auth_login.py
git commit -m "feat(auth): add ldap-mode login with local-first credentials and throttling — 로그인 엔드포인트"
```

---

### Task 7: 로컬 계정 관리 API

**Files:**
- Create: `backend/app/routers/local_accounts.py`
- Modify: `backend/app/main.py` (라우터 등록)
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_local_accounts_api.py`

**Interfaces:**
- Consumes: `require_sysadmin` (`app/auth.py`), `hash_password` (Task 3), `logic.add_granted_sysadmin`·`remove_granted_sysadmin` (Task 4)
- Produces:
  - `GET /api/admin/local-accounts` → `[{loginId, name, department, deptCode, role, isSysadmin, envSysadmin, active, createdBy, updatedAt}]`
  - `POST /api/admin/local-accounts` — `{loginId, name, deptCode, role, password, isSysadmin}` → 201
  - `PATCH /api/admin/local-accounts/{login_id}` — 위 필드 부분 갱신(`password`는 있으면 재설정)
  - `DELETE /api/admin/local-accounts/{login_id}` → 204

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_local_accounts_api.py` 생성:

```python
"""로컬 계정 관리 API — sysadmin 전용, ldap 모드에서만."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee
from app.permissions import logic
from app.settings import settings

HEADERS = {"X-Dev-User": "admin.sys"}


@pytest.fixture
def ldap_admin():
    """ldap 모드지만 dev 헤더로 액터를 정하기 위해 dev 모드를 쓴다 — 모드 게이트는 별도 테스트."""
    saved = settings.auth_mode
    settings.auth_mode = "ldap"
    yield
    settings.auth_mode = saved
    logic.grant_sysadmin_cache(set())


def test_create_then_list(client: TestClient, ldap_admin):
    res = client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "consultant.new",
            "name": "New Consultant",
            "deptCode": None,
            "role": "user",
            "password": "pw-initial",
            "isSysadmin": False,
        },
        headers=HEADERS,
    )
    assert res.status_code == 201

    listed = client.get("/api/admin/local-accounts", headers=HEADERS)
    assert listed.status_code == 200
    ids = [row["loginId"] for row in listed.json()]
    assert "consultant.new" in ids


def test_response_never_exposes_hash(client: TestClient, ldap_admin):
    client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "consultant.hash",
            "name": "H",
            "deptCode": None,
            "role": "user",
            "password": "pw",
            "isSysadmin": False,
        },
        headers=HEADERS,
    )
    body = client.get("/api/admin/local-accounts", headers=HEADERS).text
    assert "password" not in body.lower()


def test_login_id_colliding_with_ad_account_is_rejected(client: TestClient, ldap_admin):
    async def _seed_ad_user() -> None:
        async with SessionLocal() as session:
            if await session.get(Employee, "real.ad") is None:
                session.add(Employee(login_id="real.ad", name="Real", source="ad"))
                await session.commit()

    asyncio.get_event_loop().run_until_complete(_seed_ad_user())
    res = client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "real.ad",
            "name": "Impostor",
            "deptCode": None,
            "role": "user",
            "password": "pw",
            "isSysadmin": False,
        },
        headers=HEADERS,
    )
    assert res.status_code == 409


def test_granting_sysadmin_updates_the_cache(client: TestClient, ldap_admin):
    client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "consultant.boss",
            "name": "Boss",
            "deptCode": None,
            "role": "admin",
            "password": "pw",
            "isSysadmin": True,
        },
        headers=HEADERS,
    )
    assert "consultant.boss" in logic._granted_sysadmins

    client.patch(
        "/api/admin/local-accounts/consultant.boss",
        json={"isSysadmin": False},
        headers=HEADERS,
    )
    assert "consultant.boss" not in logic._granted_sysadmins


def test_delete_removes_from_cache(client: TestClient, ldap_admin):
    client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "consultant.tmp",
            "name": "Tmp",
            "deptCode": None,
            "role": "user",
            "password": "pw",
            "isSysadmin": True,
        },
        headers=HEADERS,
    )
    res = client.delete("/api/admin/local-accounts/consultant.tmp", headers=HEADERS)
    assert res.status_code == 204
    assert "consultant.tmp" not in logic._granted_sysadmins


def test_endpoint_is_404_outside_ldap_mode(client: TestClient):
    res = client.get("/api/admin/local-accounts", headers=HEADERS)
    assert res.status_code == 404
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_local_accounts_api.py -v`
Expected: FAIL — 404 (라우터 없음)

- [ ] **Step 3: 스키마 추가**

`backend/app/schemas.py`에 추가 (파일의 alias 컨벤션을 따를 것):

```python
class LocalAccountIn(BaseModel):
    login_id: str = Field(alias="loginId", min_length=1, max_length=100)
    name: str = Field(max_length=200)
    dept_code: str | None = Field(default=None, alias="deptCode", max_length=100)
    role: str = Field(default="user")
    password: str = Field(min_length=1, max_length=200)
    is_sysadmin: bool = Field(default=False, alias="isSysadmin")

    model_config = ConfigDict(populate_by_name=True)


class LocalAccountPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    dept_code: str | None = Field(default=None, alias="deptCode", max_length=100)
    role: str | None = None
    password: str | None = Field(default=None, min_length=1, max_length=200)
    is_sysadmin: bool | None = Field(default=None, alias="isSysadmin")
    active: bool | None = None

    model_config = ConfigDict(populate_by_name=True)


class LocalAccountOut(BaseModel):
    login_id: str = Field(serialization_alias="loginId")
    name: str
    department: str
    dept_code: str | None = Field(serialization_alias="deptCode")
    role: str
    is_sysadmin: bool = Field(serialization_alias="isSysadmin")
    # BPM_SYSADMINS로 지정된 계정 — UI에서 회수 불가(설계 §3.1 불변식)
    env_sysadmin: bool = Field(serialization_alias="envSysadmin")
    active: bool
    created_by: str = Field(serialization_alias="createdBy")
    updated_at: datetime = Field(serialization_alias="updatedAt")
```

- [ ] **Step 4: 라우터 구현**

`backend/app/routers/local_accounts.py` 생성:

```python
"""로컬 계정(외부 컨설턴트) 관리 — sysadmin 전용, ldap 모드 한정 (설계 §5)."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_sysadmin
from app.db import get_session
from app.models import Employee, LocalCredential
from app.passwords import hash_password
from app.permissions import logic
from app.schemas import LocalAccountIn, LocalAccountOut, LocalAccountPatch
from app.settings import settings

router = APIRouter(prefix="/api/admin/local-accounts", tags=["local-accounts"])


def _ensure_ldap_mode() -> None:
    """UI 숨김만으로 막지 않는다 — 다른 모드에선 엔드포인트 자체가 없다."""
    if settings.resolved_auth_mode() != "ldap":
        raise HTTPException(status_code=404, detail="not found")


def _to_out(employee: Employee, credential: LocalCredential) -> LocalAccountOut:
    return LocalAccountOut(
        login_id=employee.login_id,
        name=employee.name,
        department=employee.department,
        dept_code=employee.dept_code,
        role=employee.role,
        is_sysadmin=credential.is_sysadmin,
        env_sysadmin=employee.login_id in settings.sysadmin_login_ids(),
        active=employee.active,
        created_by=credential.created_by,
        updated_at=credential.updated_at,
    )


@router.get("", response_model=list[LocalAccountOut])
async def list_local_accounts(
    actor: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> list[LocalAccountOut]:
    _ensure_ldap_mode()
    credentials = (await session.execute(select(LocalCredential))).scalars().all()
    out: list[LocalAccountOut] = []
    for credential in credentials:
        employee = await session.get(Employee, credential.login_id)
        if employee is not None:
            out.append(_to_out(employee, credential))
    return out


@router.post("", response_model=LocalAccountOut, status_code=201)
async def create_local_account(
    body: LocalAccountIn,
    actor: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> LocalAccountOut:
    _ensure_ldap_mode()
    existing = await session.get(Employee, body.login_id)
    if existing is not None and existing.source != "local":
        # 실제 AD 계정을 로컬 계정으로 가로채는 것을 막는다 (설계 §5)
        raise HTTPException(
            status_code=409, detail=f"login id {body.login_id} already belongs to a directory user"
        )
    if await session.get(LocalCredential, body.login_id) is not None:
        raise HTTPException(status_code=409, detail=f"local account {body.login_id} already exists")

    employee = existing or Employee(login_id=body.login_id, source="local")
    employee.name = body.name
    employee.role = body.role
    employee.dept_code = body.dept_code
    employee.active = True
    session.add(employee)

    credential = LocalCredential(
        login_id=body.login_id,
        password_hash=hash_password(body.password),
        is_sysadmin=body.is_sysadmin,
        created_by=actor,
    )
    session.add(credential)
    await session.commit()

    if body.is_sysadmin:
        logic.add_granted_sysadmin(body.login_id)
    return _to_out(employee, credential)


@router.patch("/{login_id}", response_model=LocalAccountOut)
async def update_local_account(
    login_id: str,
    body: LocalAccountPatch,
    actor: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> LocalAccountOut:
    _ensure_ldap_mode()
    credential = await session.get(LocalCredential, login_id)
    employee = await session.get(Employee, login_id)
    if credential is None or employee is None:
        raise HTTPException(status_code=404, detail=f"local account {login_id} not found")

    if body.name is not None:
        employee.name = body.name
    if body.role is not None:
        employee.role = body.role
    if body.dept_code is not None:
        employee.dept_code = body.dept_code
    if body.active is not None:
        employee.active = body.active
    if body.password is not None:
        credential.password_hash = hash_password(body.password)
    if body.is_sysadmin is not None:
        credential.is_sysadmin = body.is_sysadmin
    await session.commit()

    if body.is_sysadmin is True:
        logic.add_granted_sysadmin(login_id)
    elif body.is_sysadmin is False:
        logic.remove_granted_sysadmin(login_id)
    return _to_out(employee, credential)


@router.delete("/{login_id}", status_code=204)
async def delete_local_account(
    login_id: str,
    actor: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> Response:
    _ensure_ldap_mode()
    credential = await session.get(LocalCredential, login_id)
    if credential is None:
        raise HTTPException(status_code=404, detail=f"local account {login_id} not found")
    await session.delete(credential)
    employee = await session.get(Employee, login_id)
    if employee is not None and employee.source == "local":
        await session.delete(employee)
    await session.commit()
    logic.remove_granted_sysadmin(login_id)
    return Response(status_code=204)
```

`backend/app/main.py`에 라우터를 등록한다:

```python
from app.routers import local_accounts
...
app.include_router(local_accounts.router)
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_local_accounts_api.py -v`
Expected: PASS (6 passed)

- [ ] **Step 6: 전체 테스트 + 린트**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/app/routers/local_accounts.py backend/app/schemas.py backend/app/main.py backend/tests/test_local_accounts_api.py
git commit -m "feat(auth): manage local consultant accounts from the settings API — 로컬 계정 관리 API"
```

---

### Task 8: 프론트 인증 모드 런타임화

프론트의 빌드타임 인증 상수를 없애고 `GET /api/auth/mode`로 대체한다.

**Files:**
- Create: `frontend/src/lib/auth-mode.ts`
- Create: `frontend/src/lib/auth-mode.test.ts`
- Modify: `frontend/src/components/providers.tsx:26-38,174-186`
- Modify: `frontend/src/lib/api.ts:196-210` (토큰 저장 유지, 변경 없으면 생략)

**Interfaces:**
- Consumes: `GET /api/auth/mode` (Task 1)
- Produces:
  - `type AuthMode = "keycloak" | "ldap" | "dev"`
  - `fetchAuthMode(): Promise<AuthModeInfo>` — `{mode, keycloakIssuer, keycloakClientId}`
  - `useAuthMode(): AuthModeInfo | null` — 미확정이면 `null`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/auth-mode.test.ts` 생성:

```ts
import { describe, expect, it, vi, afterEach } from "vitest";

import { fetchAuthMode } from "./auth-mode";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAuthMode", () => {
  it("returns the mode reported by the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mode: "ldap",
          keycloakIssuer: "http://kc/realms/x",
          keycloakClientId: "bpm-frontend",
        }),
      }),
    );
    const info = await fetchAuthMode();
    expect(info.mode).toBe("ldap");
    expect(info.keycloakClientId).toBe("bpm-frontend");
  });

  it("falls back to keycloak when the endpoint fails", async () => {
    // 모드를 못 읽었다고 인증을 통째로 열면 안 된다 — 가장 엄격한 모드로 떨어진다.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const info = await fetchAuthMode();
    expect(info.mode).toBe("keycloak");
  });

  it("rejects an unknown mode string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: "bogus" }) }),
    );
    const info = await fetchAuthMode();
    expect(info.mode).toBe("keycloak");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd frontend && npx vitest run src/lib/auth-mode.test.ts`
Expected: FAIL — `Cannot find module './auth-mode'`

- [ ] **Step 3: 모듈 구현**

`frontend/src/lib/auth-mode.ts` 생성:

```ts
// 인증 모드는 백엔드가 런타임에 알려준다 — NEXT_PUBLIC_* 빌드 상수를 쓰면 모드를 바꿀 때마다
// 프론트 이미지를 다시 구워야 한다(설계 §2).

export type AuthMode = "keycloak" | "ldap" | "dev";

export interface AuthModeInfo {
  mode: AuthMode;
  keycloakIssuer: string;
  keycloakClientId: string;
}

const MODES: AuthMode[] = ["keycloak", "ldap", "dev"];

// 모드를 못 읽었을 때 인증이 열리면 안 되므로 가장 엄격한 모드로 떨어진다.
const FALLBACK: AuthModeInfo = { mode: "keycloak", keycloakIssuer: "", keycloakClientId: "" };

function isAuthMode(value: unknown): value is AuthMode {
  return typeof value === "string" && MODES.includes(value as AuthMode);
}

export async function fetchAuthMode(): Promise<AuthModeInfo> {
  try {
    const res = await fetch("/api/auth/mode", { cache: "no-store" });
    if (!res.ok) {
      return FALLBACK;
    }
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || !("mode" in body)) {
      return FALLBACK;
    }
    const raw = body as Record<string, unknown>;
    if (!isAuthMode(raw.mode)) {
      return FALLBACK;
    }
    return {
      mode: raw.mode,
      keycloakIssuer: typeof raw.keycloakIssuer === "string" ? raw.keycloakIssuer : "",
      keycloakClientId: typeof raw.keycloakClientId === "string" ? raw.keycloakClientId : "",
    };
  } catch {
    return FALLBACK;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/auth-mode.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: providers.tsx를 런타임 모드로 전환**

`frontend/src/components/providers.tsx`:

1. `const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";` 삭제.
2. `buildOidcConfig()`가 `authority`/`client_id`를 인자로 받게 바꾼다:

```tsx
function buildOidcConfig(info: AuthModeInfo) {
  return {
    authority: info.keycloakIssuer,
    client_id: info.keycloakClientId,
    redirect_uri: window.location.origin,
    // signinRedirect(keycloak-login.ts)와 짝 — 평문 HTTP 접속 위해 PKCE 비활성(crypto.subtle 회피).
    disablePKCE: true,
    onSigninCallback: () => {
      window.history.replaceState({}, document.title, window.location.pathname);
    },
  };
}
```

3. `Providers`를 모드 확정까지 대기하도록 바꾼다:

```tsx
export function Providers({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const [modeInfo, setModeInfo] = useState<AuthModeInfo | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchAuthMode().then((info) => {
      if (alive) setModeInfo(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!mounted || modeInfo === null) {
    // 모드가 정해지기 전에 자식을 그리면 인증 없이 API를 때리는 창이 생긴다.
    return <AuthLoadingScreen />;
  }
  if (modeInfo.mode === "dev") {
    return <DevGate>{children}</DevGate>;
  }
  return (
    <AuthProvider {...buildOidcConfig(modeInfo)}>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}
```

`useState` import와 `fetchAuthMode`·`AuthModeInfo` import를 추가한다. `mounted`가 false일 때 기존 `return null`을 `AuthLoadingScreen`으로 바꾸는 점에 유의 — 첫 페인트가 빈 화면 대신 로딩 화면이 된다.

4. `ldap` 모드는 이 Task에서 `AuthGate` 경로를 그대로 탄다(Keycloak 리다이렉트가 아니라 저장된 토큰으로 동작). Task 9에서 ldap 전용 게이트로 교체한다.

- [ ] **Step 6: 타입·린트·빌드 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 에러 없음. `NEXT_PUBLIC_AUTH_ENABLED`를 아직 참조하는 파일(`login/page.tsx`, `top-nav.tsx`)이 남아 있어도 이 단계에서는 통과한다 — Task 9에서 정리한다.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/lib/auth-mode.ts frontend/src/lib/auth-mode.test.ts frontend/src/components/providers.tsx
git commit -m "feat(auth): resolve the auth mode at runtime instead of build time — 인증 모드 런타임 해석"
```

---

### Task 9: 로그인 화면 — 모드별 CTA와 LDAP 폼

**Files:**
- Create: `frontend/src/components/ldap-login-form.tsx`
- Modify: `frontend/src/app/login/page.tsx`
- Modify: `frontend/src/components/top-nav.tsx:27,184-190`
- Modify: `frontend/src/lib/api.ts` (로그인 호출 함수 추가)
- Modify: `frontend/src/lib/i18n-messages.ts`
- Test: `frontend/src/lib/ldap-session.test.ts`

**Interfaces:**
- Consumes: `POST /api/auth/login` (Task 6), `fetchAuthMode` (Task 8)
- Produces:
  - `postLdapLogin(loginId: string, password: string): Promise<{ token: string; expiresAt: string }>` (`lib/api.ts`)
  - `storeLdapToken(token: string | null): void` / `getStoredLdapToken(): string | null` (`lib/ldap-session.ts`)

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/ldap-session.test.ts` 생성:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { clearLdapToken, getStoredLdapToken, storeLdapToken } from "./ldap-session";

beforeEach(() => {
  window.localStorage.clear();
});

describe("ldap session storage", () => {
  it("returns null before any login", () => {
    expect(getStoredLdapToken()).toBeNull();
  });

  it("round-trips a stored token", () => {
    storeLdapToken("token-abc");
    expect(getStoredLdapToken()).toBe("token-abc");
  });

  it("clears the token on logout", () => {
    storeLdapToken("token-abc");
    clearLdapToken();
    expect(getStoredLdapToken()).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd frontend && npx vitest run src/lib/ldap-session.test.ts`
Expected: FAIL — `Cannot find module './ldap-session'`

- [ ] **Step 3: 세션 저장 모듈 구현**

`frontend/src/lib/ldap-session.ts` 생성:

```ts
// ldap 모드 세션 토큰 — 서버가 평문 HTTP라 Secure 쿠키를 못 쓰므로 localStorage에 둔다(설계 §4).

const KEY = "bpm.ldapToken";

export function getStoredLdapToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(KEY);
}

export function storeLdapToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(KEY, token);
}

export function clearLdapToken(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(KEY);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/ldap-session.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: API 호출 함수 추가**

`frontend/src/lib/api.ts`에 추가 (파일의 기존 fetch 헬퍼 스타일을 따를 것):

공용 `request<T>` 헬퍼(`api.ts:239`)를 쓴다 — 인증 헤더 구성이 이 파일의 단일 경로라 새 fetch를 만들면 갈라진다. `request`는 경로에 `/api`를 붙이고 실패 시 `ApiError`(`.status` 보유)를 던진다.

```ts
export async function postLdapLogin(
  loginId: string,
  password: string,
): Promise<{ token: string; expiresAt: string }> {
  try {
    return await request<{ token: string; expiresAt: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ loginId, password }),
    });
  } catch (e) {
    // 서버가 실패 사유를 구분하지 않으므로(계정 존재 노출 금지) 프론트도 두 갈래만 본다.
    if (e instanceof ApiError && e.status === 429) {
      throw new Error("too-many-attempts");
    }
    throw new Error("invalid-credentials");
  }
}
```

- [ ] **Step 6: 로그인 폼 컴포넌트 작성**

`frontend/src/components/ldap-login-form.tsx` 생성:

```tsx
"use client";

import { Lock } from "lucide-react";
import { useState } from "react";

import { postLdapLogin, setAuthToken } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { storeLdapToken } from "@/lib/ldap-session";

interface LdapLoginFormProps {
  onSuccess: () => void;
}

export function LdapLoginForm({ onSuccess }: LdapLoginFormProps) {
  const { t } = useI18n();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await postLdapLogin(loginId, password);
      storeLdapToken(token);
      setAuthToken(token);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error && e.message === "too-many-attempts"
        ? t("login.tooManyAttempts")
        : t("login.invalidCredentials"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-id="login-ldap-form" onSubmit={(e) => void handleSubmit(e)}>
      <input
        data-id="login-ldap-id"
        className="mb-2 h-10 w-full rounded-sm border border-hairline bg-surface px-3 text-caption text-ink"
        placeholder={t("login.idPlaceholder")}
        value={loginId}
        onChange={(e) => setLoginId(e.target.value)}
        autoComplete="username"
      />
      <input
        data-id="login-ldap-password"
        className="mb-3 h-10 w-full rounded-sm border border-hairline bg-surface px-3 text-caption text-ink"
        type="password"
        placeholder={t("login.passwordPlaceholder")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      {error && (
        <p data-id="login-ldap-error" className="mb-2 text-fine text-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        data-id="login-ldap-submit"
        disabled={busy || !loginId || !password}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-accent text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-50"
      >
        <Lock size={16} strokeWidth={1.7} />
        {t("login.signIn")}
      </button>
    </form>
  );
}
```

- [ ] **Step 7: i18n 키 추가**

`frontend/src/lib/i18n-messages.ts`의 `login.*` 그룹에 추가한다 (파일의 기존 구조를 확인하고 en/ko 양쪽 모두 채울 것):

```
login.signIn: "Sign in"
login.idPlaceholder: "Login ID"
login.passwordPlaceholder: "Password"
login.invalidCredentials: "Invalid login ID or password."
login.tooManyAttempts: "Too many attempts. Try again in a few minutes."
```

- [ ] **Step 8: 로그인 페이지를 모드별로 분기**

`frontend/src/app/login/page.tsx`:

1. `const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";` 삭제하고, 컴포넌트에서 `fetchAuthMode()` 결과를 state로 받는다.
2. `shouldAutoAttempt()`의 `AUTH_ENABLED` 조건을 `mode === "keycloak"`으로 바꾼다 — ldap 모드에서 Keycloak silent 로그인을 시도하면 안 된다.
3. 카드 본문을 모드별 단일 CTA로 교체한다:

```tsx
{mode === "keycloak" && (
  <button type="button" data-id="login-keycloak" /* 기존 버튼 그대로 */ >…</button>
)}
{mode === "ldap" && (
  <LdapLoginForm onSuccess={() => router.replace(consumeReturnTo() ?? "/")} />
)}
{mode === "dev" && (
  <button type="button" data-id="login-dev" onClick={() => setPicking(true)}>…</button>
)}
```

기존 `dev` 분기에 있던 "or + Keycloak(secondary)" 블록은 **삭제**한다 — dev/ldap 모드에서 Keycloak 버튼은 눌러도 동작하지 않는 죽은 버튼이다(설계 §6).

- [ ] **Step 9: 부팅 시 저장된 ldap 토큰 복원**

`frontend/src/components/providers.tsx`의 `Providers`에 `ldap` 분기를 추가한다:

```tsx
  if (modeInfo.mode === "ldap") {
    return <LdapGate>{children}</LdapGate>;
  }
```

같은 파일에 `LdapGate`를 추가한다 — `DevGate`와 같은 골격이되 저장된 토큰을 쓴다:

```tsx
function LdapGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const stored = getStoredLdapToken();

  // 렌더 단계에서 동기 반영 — 자식의 fetch effect가 게이트 effect보다 먼저 도는 레이스 방지
  // (DevGate와 같은 이유. providers.tsx:148-151 주석 참조).
  setAuthToken(stored);

  useEffect(() => {
    if (stored) {
      void publishMe();
    } else {
      setCurrentUser(null);
      if (pathname !== "/login") {
        saveReturnTo(pathname + window.location.search);
        router.replace("/login");
      }
    }
  }, [stored, pathname, router]);

  if (pathname === "/login") {
    return <>{children}</>;
  }
  if (!stored) {
    return null;
  }
  return <>{children}</>;
}
```

- [ ] **Step 10: top-nav 로그아웃 정리**

`frontend/src/components/top-nav.tsx:27`의 `AUTH_ENABLED` 상수를 제거하고, 로그아웃 처리(`:184-190`)를 모드별로 나눈다 — `keycloak`이면 기존 Keycloak signout, `ldap`이면 `clearLdapToken()` + `/login` 이동, `dev`면 기존 dev 로그아웃. 모드는 `fetchAuthMode()`를 한 번 호출해 state에 담거나, `lib/auth-mode.ts`에 모듈 캐시를 두고 재사용한다(같은 값을 두 번 받아올 필요는 없다).

- [ ] **Step 11: 타입·린트·테스트**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run`
Expected: 전부 PASS. `NEXT_PUBLIC_AUTH_ENABLED` 참조가 코드에 남아 있지 않은지 `git grep NEXT_PUBLIC_AUTH_ENABLED frontend/src`로 확인 — 0건이어야 한다.

- [ ] **Step 12: 커밋**

```bash
git add frontend/src/lib/ldap-session.ts frontend/src/lib/ldap-session.test.ts frontend/src/components/ldap-login-form.tsx frontend/src/app/login/page.tsx frontend/src/components/providers.tsx frontend/src/components/top-nav.tsx frontend/src/lib/api.ts frontend/src/lib/i18n-messages.ts
git commit -m "feat(auth): show one CTA per auth mode and add the ldap sign-in form — 모드별 로그인 화면"
```

---

### Task 10: 설정 화면 로컬 계정 탭

**Files:**
- Create: `frontend/src/components/admin/local-account-table.tsx`
- Modify: `frontend/src/app/settings/page.tsx:33-47` (TabId), 조직 카테고리 tabs, 탭 렌더 분기
- Modify: `frontend/src/lib/api.ts` (CRUD 호출)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `/api/admin/local-accounts` (Task 7), `fetchAuthMode` (Task 8)
- Produces: `TabId`에 `"localAccounts"` 추가, `LocalAccountTable` 컴포넌트

- [ ] **Step 1: API 호출 함수 추가**

`frontend/src/lib/api.ts`에 추가. 반환 타입은 백엔드 `LocalAccountOut`과 정확히 맞춘다:

```ts
export interface LocalAccount {
  loginId: string;
  name: string;
  department: string;
  deptCode: string | null;
  role: "admin" | "user";
  isSysadmin: boolean;
  envSysadmin: boolean;
  active: boolean;
  createdBy: string;
  updatedAt: string;
}

export interface LocalAccountInput {
  loginId: string;
  name: string;
  deptCode: string | null;
  role: "admin" | "user";
  password: string;
  isSysadmin: boolean;
}

export type LocalAccountPatch = Partial<Omit<LocalAccountInput, "loginId">> & {
  active?: boolean;
};

export async function listLocalAccounts(): Promise<LocalAccount[]> {
  return request<LocalAccount[]>("/admin/local-accounts");
}

export async function createLocalAccount(input: LocalAccountInput): Promise<LocalAccount> {
  return request<LocalAccount>("/admin/local-accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateLocalAccount(
  loginId: string,
  patch: LocalAccountPatch,
): Promise<LocalAccount> {
  return request<LocalAccount>(`/admin/local-accounts/${encodeURIComponent(loginId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteLocalAccount(loginId: string): Promise<void> {
  await request<void>(`/admin/local-accounts/${encodeURIComponent(loginId)}`, {
    method: "DELETE",
  });
}
```

`request<T>`가 인증 헤더를 붙이는 단일 경로다(`api.ts:239-245`) — 새 fetch 방식을 만들지 않는다. `DELETE`는 204라 본문이 없으므로, `request`가 빈 본문에서 `res.json()`을 시도해 깨지는지 확인하고 그렇다면 `api.ts`의 기존 204 처리 패턴(다른 DELETE 호출부)을 그대로 따른다.

- [ ] **Step 2: 테이블 컴포넌트 작성**

`frontend/src/components/admin/local-account-table.tsx` 생성. **먼저 `frontend/src/components/admin/employee-table.tsx`를 읽고** 로딩·에러·행 렌더·토스트 골격을 그대로 따른다(테이블 클래스와 토스트 prop 시그니처를 새로 만들지 않는다). 아래는 이 컴포넌트에만 있는 로직 — 나머지는 employee-table의 패턴을 복제한다.

```tsx
"use client";

import { useEffect, useState } from "react";

import {
  createLocalAccount,
  deleteLocalAccount,
  listLocalAccounts,
  updateLocalAccount,
  type LocalAccount,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface LocalAccountTableProps {
  showToast: (item: { id: string; message: string }) => void;
}

export function LocalAccountTable({ showToast }: LocalAccountTableProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<LocalAccount[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listLocalAccounts()
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch((e) => {
        if (alive) {
          setRows([]);
          showToast({ id: `local-account-load`, message: humanizeApiError(e) });
        }
      });
    return () => {
      alive = false;
    };
  }, [reloadKey, showToast]);

  // sysadmin 토글 — env로 지정된 계정은 여기서 못 내린다(설계 §3.1 불변식).
  const handleToggleSysadmin = async (row: LocalAccount) => {
    if (row.envSysadmin) {
      return;
    }
    try {
      await updateLocalAccount(row.loginId, { isSysadmin: !row.isSysadmin });
      setReloadKey((k) => k + 1);
    } catch (e) {
      showToast({ id: `local-account-${row.loginId}`, message: humanizeApiError(e) });
    }
  };

  if (rows === null) {
    return <SkeletonRows />; // components/skeleton.tsx — 첫 페인트 자리잡기
  }
  return (
    <div data-id="local-account-table">
      {/* 행 렌더 — employee-table.tsx의 테이블 마크업을 그대로 따른다 */}
      {rows.map((row) => (
        <div key={row.loginId} data-id={`local-account-row-${row.loginId}`}>
          {/* loginId · name · department · role · active · createdBy · updatedAt */}
          <label>
            <input
              type="checkbox"
              data-id={`local-account-sysadmin-${row.loginId}`}
              checked={row.isSysadmin || row.envSysadmin}
              disabled={row.envSysadmin}
              onChange={() => void handleToggleSysadmin(row)}
            />
            {row.envSysadmin ? t("localAccount.setByEnvironment") : t("localAccount.sysadmin")}
          </label>
        </div>
      ))}
      {/* 생성 폼 · 비밀번호 재설정 · 삭제 확인 모달 */}
    </div>
  );
}
```

나머지 필수 요소:

- **생성 폼** — loginId, name, 부서 선택(기존 부서 선택 UI 재사용 — `department-table.tsx`가 쓰는 컴포넌트를 그대로), role 셀렉트, password, sysadmin 토글 → `createLocalAccount`. 409 응답은 `humanizeApiError`로 토스트.
- **비밀번호 재설정** — 입력 후 `updateLocalAccount(loginId, { password })`.
- **삭제** — `window.confirm`을 쓰지 않는다. 공용 `ModalBackdrop` 기반 확인 모달을 쓴다(`pendingDelete` state가 그 자리). 확인 시 `deleteLocalAccount` → `setReloadKey`.
- **`data-id`** — `local-account-table`, `local-account-row-${loginId}`, `local-account-create`, `local-account-sysadmin-${loginId}`, `local-account-delete-${loginId}`, `local-account-reset-pw-${loginId}`.

- [ ] **Step 3: 설정 페이지에 탭 등록**

`frontend/src/app/settings/page.tsx`:

1. `TabId` union에 `| "localAccounts"` 추가.
2. 조직 카테고리 tabs 배열에 `{ id: "localAccounts", labelKey: "localAccount.tab" }` 추가.
3. **`ldap` 모드일 때만 노출** — `CATEGORIES`가 모듈 상수라 모드를 못 읽으므로, 컴포넌트 안에서 `visibleCategories`를 만들 때 걸러낸다:

```tsx
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  useEffect(() => {
    void fetchAuthMode().then((info) => setAuthMode(info.mode));
  }, []);

  const visibleCategories = CATEGORIES.filter((c) => canAccess(c.access)).map((c) => ({
    ...c,
    // 로컬 계정 탭은 ldap 모드 전용 — 다른 모드에선 백엔드도 404를 반환한다(설계 §5)
    tabs: c.tabs.filter((tab) => tab.id !== "localAccounts" || authMode === "ldap"),
  })).filter((c) => c.tabs.length > 0);
```

4. 탭 본문 렌더 분기에 `{current === "localAccounts" && <LocalAccountTable showToast={showToast} />}` 추가 (기존 탭들이 쓰는 prop 형태에 맞출 것).

- [ ] **Step 4: i18n 키 추가**

`login.*`과 같은 방식으로 `localAccount.*` 키를 en/ko 양쪽에 추가한다: `localAccount.tab`, `localAccount.create`, `localAccount.password`, `localAccount.resetPassword`, `localAccount.sysadmin`, `localAccount.setByEnvironment`, `localAccount.deleteConfirm`.

- [ ] **Step 5: 타입·린트·테스트·빌드**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/admin/local-account-table.tsx frontend/src/app/settings/page.tsx frontend/src/lib/api.ts frontend/src/lib/i18n-messages.ts
git commit -m "feat(settings): manage local consultant accounts from a settings tab — 로컬 계정 설정 탭"
```

---

### Task 11: 배포 동기화 · 문서 · 브라우저 스모크

**Files:**
- Modify: `frontend/Dockerfile:14-19`, `docker-compose.yml` (frontend build args)
- Modify: `docs/deploy/deploy.md`
- Modify: `README.md` (환경변수 섹션이 있으면)
- Modify: `backend/app/permissions/logic.py` (워커 전제 주석 — Task 4에서 이미 넣었으면 생략)
- Create: `scripts/pw-smoke-ldap-login.mjs`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 프론트 빌드 ARG 제거**

`frontend/Dockerfile:14-19`의 `NEXT_PUBLIC_AUTH_ENABLED`·`NEXT_PUBLIC_KEYCLOAK_ISSUER`·`NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` ARG/ENV 3쌍을 삭제하고, `docker-compose.yml:27-29`의 대응 build args도 삭제한다. **`git grep NEXT_PUBLIC_KEYCLOAK`로 남은 참조가 0건인지 확인한다.**

- [ ] **Step 2: 배포 문서 갱신**

`docs/deploy/deploy.md`에 "인증 모드" 절을 추가한다. 반드시 포함할 내용:

- `AUTH_MODE` 3값의 의미와 `AUTH_ENABLED` 하위호환 매핑
- `ldap` 모드는 `AUTH_JWT_SECRET` 필수(`openssl rand -hex 32`), 비면 기동 실패
- LDAP 연결 4종(`LDAP_URL`·`LDAP_BIND_DN`·`LDAP_BIND_CREDENTIALS`·`LDAP_USER_SEARCH_BASE`)이 채워져야 AD 인증이 동작
- **컨설턴트 계정 회수 절차** — 시연 종료 시 설정 화면에서 sysadmin 해제 후 계정 삭제 또는 `active=false`
- **토큰은 만료 전 강제 무효화 불가** — 즉시 차단이 필요하면 `AUTH_JWT_SECRET`을 교체하고 재기동하면 전 세션이 끊긴다
- **백엔드 워커를 늘리면 sysadmin 부여 캐시가 프로세스별로 갈라진다** — 늘릴 때는 DB 조회로 전환

- [ ] **Step 3: Playwright 스모크 작성**

`scripts/`의 기존 스모크(`pw-smoke-loading.mjs` 등)를 읽고 같은 골격으로 `scripts/pw-smoke-ldap-login.mjs`를 작성한다. 검증 항목:

1. `AUTH_MODE=ldap`으로 백엔드를 띄운 상태에서 `/login`이 **ID/PW 폼**을 보이고 Keycloak 버튼은 없다
2. 사전 시드한 로컬 계정으로 로그인 → 홈 진입
3. 잘못된 비밀번호 → 에러 문구 노출, 진입 실패
4. 딥링크(`/maps/1`)로 접근 → 로그인 후 그 경로로 복귀
5. 로그아웃 → `/login` 복귀 후 저장된 토큰 소거

- [ ] **Step 4: 스모크 실행**

Run: `node scripts/pw-smoke-ldap-login.mjs`
Expected: 5/5 PASS. 실패하면 코드를 고친다 — 스모크를 느슨하게 바꾸지 않는다.

- [ ] **Step 5: 전체 게이트**

Run:
```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```
Expected: 전부 PASS

- [ ] **Step 6: PROGRESS.md 갱신 후 커밋**

`PROGRESS.md`의 2026-08-19 설계 항목을 구현 완료 내용으로 갱신한다(설계-only 항목을 지우고 결과 중심 1–3줄로 합친다 — `rules/common/git.md`).

```bash
git add frontend/Dockerfile docker-compose.yml docs/deploy/deploy.md scripts/pw-smoke-ldap-login.mjs PROGRESS.md
git commit -m "chore(auth): drop frontend auth build args and document ldap deployment — 배포 동기화·문서"
```

---

## 미검증으로 남는 것

로컬에서 끝나지 않는 항목 — 완료 보고에 반드시 함께 적는다.

- **실제 AD bind** — `ldap3` 연결을 mock으로 대체했다. 사내 AD에 붙는 실검증은 서버에서만 가능하다.
- **평문 HTTP 동작** — `localhost`는 secure context라 서버와 조건이 다르다. 로그인 왕복은 서버 또는 LAN IP(`http://192.168.x.x:3000`)로 재확인해야 한다 (`CLAUDE.md` Operations).
- **compose 배포** — 로컬은 네이티브 실행이라 컨테이너 네트워크·env 주입은 서버 `docker compose up -d --build` 후 확인해야 한다.

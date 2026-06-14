"""Application settings loaded from environment / .env."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Environment — 배포마다 달라지는 값. .env / docker-compose가 소스 오브 트루스.
    # 로컬 네이티브(Docker 없음)는 sqlite 파일로 무설정 실행, 서버 compose는 postgres로 오버라이드.
    database_url: str = "sqlite+aiosqlite:///./dev.db"

    # 인증 — 로컬은 Keycloak 접근 불가하므로 기본 비활성(우회). 서버에서만 True.
    auth_enabled: bool = False
    # 예: http://182.199.63.71:8080/realms/ai-portal (하드코딩 금지 — .env 경유)
    keycloak_issuer: str = ""
    # 토큰 aud 검증값. 비우면 aud 검증 생략 (Keycloak 기본 토큰은 aud=account 등 가변)
    keycloak_audience: str | None = None
    # auth 비활성 시 created_by에 기록할 개발용 사용자명
    dev_user: str = "local-dev"

    # Tuning — 버전 체크아웃 잠금의 무활동 자동 해제 시간(분). spec §7 Phase C
    checkout_ttl_minutes: int = 30

    # 온프레미스 AI (OpenAI 호환 GPU 서버) — 로컬 기본 비활성, 서버 compose만 활성 (design 2026-06-15)
    ai_enabled: bool = False
    ai_base_url: str = ""  # 예: http://<gpu>:8000/v1
    ai_api_token: str = ""  # Bearer 토큰 (시크릿 — .env만, git 금지)
    ai_model: str = ""
    ai_timeout_seconds: int = 60  # 요청 타임아웃(초)


settings = Settings()

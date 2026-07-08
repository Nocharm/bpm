"""Application settings loaded from environment / .env."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Environment — 배포마다 달라지는 값. .env / docker-compose가 소스 오브 트루스.
    # 로컬 네이티브(Docker 없음)는 sqlite 파일로 무설정 실행, 서버 compose는 postgres로 오버라이드.
    database_url: str = "sqlite+aiosqlite:///./dev.db"

    # 인증 — 로컬은 Keycloak 접근 불가하므로 기본 비활성(우회). 서버에서만 True.
    auth_enabled: bool = False
    # dev-only: auth OFF에서도 X-Dev-User의 실제 권한을 계산해 로컬 역할 검증.
    # 기본 False = 현행 동작(전원 sysadmin). True로 설정 시 BPM_SYSADMINS 외엔 실제 역할 적용.
    dev_enforce_permissions: bool = False
    # 예: http://182.199.63.71:8080/realms/ai-portal (하드코딩 금지 — .env 경유)
    keycloak_issuer: str = ""
    # 토큰 aud 검증값. 비우면 aud 검증 생략 (Keycloak 기본 토큰은 aud=account 등 가변)
    keycloak_audience: str | None = None
    # auth 비활성 시 created_by에 기록할 개발용 사용자명
    dev_user: str = "local-dev"

    # Tuning — 버전 체크아웃 잠금의 무활동 자동 해제 시간(분). spec §7 Phase C
    checkout_ttl_minutes: int = 30

    # 편집용 반응형 매뉴얼 사이트 주소 — 비우면 에디터의 매뉴얼 사이트 버튼 숨김 (F9)
    manual_url: str = ""

    # 온프레미스 AI (OpenAI 호환 GPU 서버) — 로컬 기본 비활성, 서버 compose만 활성 (design 2026-06-15)
    ai_enabled: bool = False
    ai_base_url: str = ""  # 예: http://<gpu>:8000/v1
    ai_api_token: str = ""  # Bearer 토큰 (시크릿 — .env만, git 금지)
    ai_model: str = ""
    ai_timeout_seconds: int = 60  # 요청 타임아웃(초)
    # 다중 엔드포인트+모델 — JSON 배열 [{"name","base_url","token","model","models"}]. .env에서 추가/삭제.
    # 비우면 위 단일 설정(AI_BASE_URL 등) 사용. 토큰은 시크릿이라 .env 전용(app_settings 아님).
    ai_endpoints: str = ""

    # 사내 AD(LDAP) 동기화 — 비우면 비활성(로컬). 시크릿은 .env만 (design 2026-06-16)
    ldap_url: str = ""  # 예: ldaps://ad.example.com:636
    ldap_bind_dn: str = ""  # 서비스 계정 DN
    ldap_bind_credentials: str = ""  # 서비스 계정 비밀번호 (시크릿)
    ldap_user_search_base: str = ""  # 사용자 검색 기준 DN
    ldap_start_tls: bool = False  # ldap:// + StartTLS 쓸 때만 True
    ldap_user_filter: str = ""  # 비우면 기본 enumerate 필터
    # admin role을 부여할 loginId(콤마 구분). 비우면 AD 유저는 전부 user
    system_admin_login_ids: str = ""
    # BPM 시스템 관리자 loginId(콤마 구분). auth OFF 시엔 전원 sysadmin 취급(로컬 잠금 방지).
    bpm_sysadmins: str = ""

    @property
    def ldap_enabled(self) -> bool:
        """필수 4종이 모두 채워졌는지 — 로그인/전체 동기화 동작 게이트."""
        return bool(
            self.ldap_url
            and self.ldap_bind_dn
            and self.ldap_bind_credentials
            and self.ldap_user_search_base
        )

    def admin_login_ids(self) -> set[str]:
        return {x.strip() for x in self.system_admin_login_ids.split(",") if x.strip()}

    def sysadmin_login_ids(self) -> set[str]:
        return {x.strip() for x in self.bpm_sysadmins.split(",") if x.strip()}


settings = Settings()

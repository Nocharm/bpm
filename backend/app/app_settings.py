"""앱 런타임 설정 헬퍼 — DB key-value(app_settings) 조회/저장. 재배포 없이 설정 화면에서 변경."""

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting
from app.settings import settings

EXPOSED_POSITIONS_KEY = "exposed_positions"
# 부서장으로 노출할 EDW 직책(FRNM) — 설정 화면에서 교체. 빈 목록 저장 = 전부 비노출(의도 허용).
DEFAULT_EXPOSED_POSITIONS = ["그룹장", "파트장", "팀장", "센터장"]

# 관리 목록(카탈로그) — 역할·시스템 자동완성 옵션. 설정 Catalogs 탭에서 편집 (design 2026-09-11 §3.1)
ASSIGNEE_ROLES_KEY = "assignee_roles"
SYSTEMS_KEY = "systems"
# 시스템 예약 항목 — 목록 밖 자유값은 FE가 Other로 분류하고 원문을 system_fallback에 남긴다
OTHER_SYSTEM = "Other"
MANAGED_LIST_MAX = 500
MANAGED_ITEM_MAX_LEN = 100

AI_CHAT_TIPS_KEY = "ai_chat_tips"
AI_CHAT_MAX_SESSIONS_KEY = "ai_chat_max_sessions_per_map"
AI_CHAT_MAX_MESSAGES_KEY = "ai_chat_max_messages_per_session"
AI_CHAT_RETENTION_DAYS_KEY = "ai_chat_retention_days"
# 관리자 런타임 AI 차단 — GPU 서버 점검 시 재배포 없이 전 AI 표면(me·챗·인터뷰)을 끈다 (2026-07-30)
AI_ACCESS_DISABLED_KEY = "ai_access_disabled"

# 보존 상한 기본값 — 사용자×맵당 세션 수 / 세션당 메시지 수 / 마지막 활동 후 보관 일수
DEFAULT_AI_CHAT_MAX_SESSIONS = 20
DEFAULT_AI_CHAT_MAX_MESSAGES = 200
DEFAULT_AI_CHAT_RETENTION_DAYS = 180

# 기본 기능 팁 — 이전 기록 로딩 중 노출되는 서비스 전반 FAQ. 설정 콘솔에서 교체 가능(비우면 기본 복원).
DEFAULT_AI_CHAT_TIPS = [
    "⌘/Ctrl+Enter로 바로 전송할 수 있습니다.",
    "입력창 위 아이콘 칩으로 분석·요약·워크스루를 한 번에 실행합니다.",
    "그래프 제안은 캔버스에 미리보기로 적용됩니다 - 채팅 카드에서 추가/취소하세요.",
    "대화는 서버에 저장됩니다 - 대화 바의 목록에서 이전 대화를 이어갈 수 있습니다.",
    "분석 결과를 클릭하면 해당 노드가 캔버스에 하이라이트됩니다.",
    "워크스루 자동재생(▶)으로 노드를 순서대로 따라가며 설명을 볼 수 있습니다.",
    "'구매 프로세스를 그려줘'처럼 요청하면 현재 맵 위에 순서도를 제안합니다.",
    "AI는 게시된 사용 매뉴얼을 근거로 사용법 질문에 답합니다.",
    "대화 제목은 첫 질문에서 자동으로 만들어집니다.",
    "창 헤더의 + 버튼으로 언제든 새 대화를 시작할 수 있습니다.",
    "채팅 글자가 작다면 대화 바의 −T+로 크기를 조절하세요.",
    "대화 목록에서 다른 맵의 대화도 열람할 수 있습니다 - 이어서 입력하려면 해당 맵을 여세요.",
    "맵은 버전으로 관리됩니다 - 게시 전 초안에서 자유롭게 편집하세요.",
    "버전 비교 화면에서 As-Is/To-Be 차이를 나란히 볼 수 있습니다.",
    "CSV 임포트로 절차 목록을 순서도로 한 번에 변환할 수 있습니다.",
    "서브프로세스 노드를 펼치면 링크된 맵을 그 자리에서 볼 수 있습니다.",
    "캔버스는 PNG로 내보낼 수 있습니다 - 툴바의 내보내기를 사용하세요.",
    "삭제한 맵은 휴지통에서 복구할 수 있습니다.",
    "노드를 더블클릭하면 이름을 바로 수정할 수 있습니다.",
    "편집이 잠긴 버전에서는 AI가 도움말 답변만 제공합니다.",
]


def normalize_managed_list(values: list[object]) -> list[str]:
    """trim · 빈값 제거 · 대소문자 무시 중복 제거(첫 표기 유지) · 항목 100자 컷. 순서는 입력 순."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in values:
        if not isinstance(raw, str):
            continue
        value = raw.strip()[:MANAGED_ITEM_MAX_LEN]
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


async def get_managed_list(session: AsyncSession, key: str, default: list[str]) -> list[str]:
    """JSON 배열 설정 — 행 부재/파싱 불가/배열 아님이면 default. 저장된 빈 목록은 그대로 존중."""
    row = await session.get(AppSetting, key)
    if row is None:
        return list(default)
    try:
        stored = json.loads(row.value)
    except ValueError:
        return list(default)
    if not isinstance(stored, list):
        return list(default)
    return normalize_managed_list(stored)


async def set_managed_list(session: AsyncSession, key: str, values: list[str], user: str) -> list[str]:
    """정규화 후 upsert(호출자가 commit). 상한 초과분은 잘라낸다."""
    cleaned = normalize_managed_list(list(values))[:MANAGED_LIST_MAX]
    await set_app_setting(session, key, json.dumps(cleaned, ensure_ascii=False), user)
    return cleaned


async def get_exposed_positions(session: AsyncSession) -> list[str]:
    """노출 직책 allowlist — 저장된 빈 목록은 그대로(전부 비노출은 유효한 관리자 의도)."""
    return await get_managed_list(session, EXPOSED_POSITIONS_KEY, DEFAULT_EXPOSED_POSITIONS)


async def get_assignee_roles(session: AsyncSession) -> list[str]:
    return await get_managed_list(session, ASSIGNEE_ROLES_KEY, [])


def ensure_other_first(systems: list[str]) -> list[str]:
    """예약 항목 불변식 — Other는 항상 1개, 맨 앞."""
    rest = [s for s in systems if s.casefold() != OTHER_SYSTEM.casefold()]
    return [OTHER_SYSTEM, *rest]


async def get_systems(session: AsyncSession) -> list[str]:
    return ensure_other_first(await get_managed_list(session, SYSTEMS_KEY, []))


async def get_ai_chat_tips(session: AsyncSession) -> list[str]:
    """AI 챗 기능 팁 목록 — 저장분이 없거나 비었으면 기본 팁."""
    row = await session.get(AppSetting, AI_CHAT_TIPS_KEY)
    if row is None:
        return DEFAULT_AI_CHAT_TIPS
    try:
        stored = json.loads(row.value)
    except ValueError:
        return DEFAULT_AI_CHAT_TIPS
    tips = [tip for tip in stored if isinstance(tip, str) and tip.strip()]
    return tips if tips else DEFAULT_AI_CHAT_TIPS


async def get_ai_access_disabled(session: AsyncSession) -> bool:
    """관리자 AI 차단 플래그 — 행 부재=차단 아님."""
    row = await session.get(AppSetting, AI_ACCESS_DISABLED_KEY)
    return row is not None and row.value == "true"


async def is_ai_access_enabled(session: AsyncSession) -> bool:
    """유효 AI 가용성 — env AI_ENABLED와 관리자 차단 플래그의 AND. 모든 AI 게이트가 이걸 본다."""
    return settings.ai_enabled and not await get_ai_access_disabled(session)


async def set_app_setting(session: AsyncSession, key: str, value: str, user: str) -> AppSetting:
    """설정 upsert — 호출자가 commit한다."""
    row = await session.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=value, updated_by=user)
        session.add(row)
    else:
        row.value = value
        row.updated_by = user
    return row


async def _get_int_setting(session: AsyncSession, key: str, default: int) -> int:
    """양의 정수 설정 — 행이 없거나 파싱 불가·0 이하면 기본값."""
    row = await session.get(AppSetting, key)
    if row is None:
        return default
    try:
        value = int(row.value)
    except ValueError:
        return default
    return value if value > 0 else default


async def get_ai_chat_max_sessions(session: AsyncSession) -> int:
    return await _get_int_setting(session, AI_CHAT_MAX_SESSIONS_KEY, DEFAULT_AI_CHAT_MAX_SESSIONS)


async def get_ai_chat_max_messages(session: AsyncSession) -> int:
    return await _get_int_setting(session, AI_CHAT_MAX_MESSAGES_KEY, DEFAULT_AI_CHAT_MAX_MESSAGES)


async def get_ai_chat_retention_days(session: AsyncSession) -> int:
    return await _get_int_setting(
        session, AI_CHAT_RETENTION_DAYS_KEY, DEFAULT_AI_CHAT_RETENTION_DAYS
    )

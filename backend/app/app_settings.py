"""앱 런타임 설정 헬퍼 — DB key-value(app_settings) 조회/저장. 재배포 없이 설정 화면에서 변경."""

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting

AI_CHAT_LOG_KEY = "ai_chat_log_enabled"
AI_CHAT_TIPS_KEY = "ai_chat_tips"

# 기본 기능 팁 — 이전 기록 로딩 중 노출되는 서비스 전반 FAQ. 설정 콘솔에서 교체 가능(비우면 기본 복원).
DEFAULT_AI_CHAT_TIPS = [
    "⌘/Ctrl+Enter로 바로 전송할 수 있습니다.",
    "입력창 위 아이콘 칩으로 분석·요약·워크스루를 한 번에 실행합니다.",
    "그래프 제안은 캔버스에 미리보기로 적용됩니다 — 채팅 카드에서 추가/취소하세요.",
    "대화는 최대 4개까지 열 수 있고, 대화 바의 목록에서 전환합니다.",
    "분석 결과를 클릭하면 해당 노드가 캔버스에 하이라이트됩니다.",
    "워크스루 자동재생(▶)으로 노드를 순서대로 따라가며 설명을 볼 수 있습니다.",
    "'구매 프로세스를 그려줘'처럼 요청하면 현재 맵 위에 순서도를 제안합니다.",
    "AI는 게시된 사용 매뉴얼을 근거로 사용법 질문에 답합니다.",
    "대화 제목은 첫 질문에서 자동으로 만들어집니다.",
    "창 헤더의 + 버튼으로 언제든 새 대화를 시작할 수 있습니다.",
    "채팅 글자가 작다면 대화 바의 −T+로 크기를 조절하세요.",
    "세션당 최근 40개 메시지만 보관됩니다 — 대화 바 아래 진행바로 사용량을 확인하세요.",
    "맵은 버전으로 관리됩니다 — 게시 전 초안에서 자유롭게 편집하세요.",
    "버전 비교 화면에서 As-Is/To-Be 차이를 나란히 볼 수 있습니다.",
    "CSV 임포트로 절차 목록을 순서도로 한 번에 변환할 수 있습니다.",
    "서브프로세스 노드를 펼치면 링크된 맵을 그 자리에서 볼 수 있습니다.",
    "캔버스는 PNG로 내보낼 수 있습니다 — 툴바의 내보내기를 사용하세요.",
    "삭제한 맵은 휴지통에서 복구할 수 있습니다.",
    "노드를 더블클릭하면 이름을 바로 수정할 수 있습니다.",
    "편집이 잠긴 버전에서는 AI가 도움말 답변만 제공합니다.",
]


async def is_ai_chat_log_enabled(session: AsyncSession) -> bool:
    """AI 챗 질문/답변 DB 적재 여부 — 행이 없으면 기본 off."""
    row = await session.get(AppSetting, AI_CHAT_LOG_KEY)
    return row is not None and row.value == "true"


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

"""업무 체계 규모 시드 — L1 1개 아래 L5 약 2,000개(맵 없음). 홈 드릴다운·칩·요약 카드의 대량 데이터 확인용.

운영 실행 금지(개발 DB 전용). 멱등: 같은 L1 코드(`SCALE_ROOT_CODE`) 서브트리를 지우고 다시 만든다.
분포는 고정 시드 난수로 레벨마다 자식 수를 흔들어(L2 6 · L3 5~7 · L4 5~8 · L5 6~12) 실제 체계처럼 들쭉날쭉하게 두고,
마지막에 L5 총수를 목표(`--l5`, 기본 2000)에 정확히 맞춘다.

실행 (backend/ 에서, 대상 DB는 DATABASE_URL로):
    bash:       .venv/bin/python -m scripts.seed_framework_scale [--l5 2000]
    PowerShell: .venv\\Scripts\\python -m scripts.seed_framework_scale
"""

import argparse
import asyncio
import random

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import ProcessCategory

SCALE_ROOT_CODE = "90"
SCALE_ROOT_NAME = "바이오의약품 제조"

L2_NAMES = ["원료·자재 관리", "업스트림 생산", "다운스트림 정제", "완제 충전·포장", "설비·유틸리티 운영", "품질 지원"]
L3_TOPICS = {
    "원료·자재 관리": ["원료 입고", "자재 검수", "보관·출고", "공급사 관리", "재고 조정", "라벨·포장재", "냉장 물류"],
    "업스트림 생산": ["배지 조제", "세포 해동·계대", "시드 배양", "생산 배양", "하베스트", "배양 모니터링", "공정 편차"],
    "다운스트림 정제": ["원심·심층여과", "친화 크로마토", "바이러스 불활화", "이온교환", "UF/DF 농축", "제형화", "벌크 충전"],
    "완제 충전·포장": ["멸균 준비", "무균 충전", "동결건조", "캡핑·실링", "육안 검사", "라벨링", "2차 포장"],
    "설비·유틸리티 운영": ["정제수 시스템", "WFI·순수증기", "HVAC 운전", "CIP/SIP", "예방 보전", "교정 관리", "고장 정비"],
    "품질 지원": ["배치 기록 검토", "일탈 관리", "변경 관리", "CAPA", "환경 모니터링", "문서 관리", "교육 훈련"],
}
L4_SUFFIXES = ["계획", "준비", "수행", "기록", "검토", "이관", "점검", "보고"]
L5_ACTIONS = ["작업지시 접수", "자재 확인", "설비 상태 점검", "파라미터 설정", "공정 시작", "중간 시료 채취",
              "기록 작성", "편차 확인", "결과 검토", "승인 요청", "이력 등록", "후속 조치"]


def _build_tree(target_l5: int, rng: random.Random) -> list[tuple[str, str, int, str | None]]:
    """(code, name, level, parent_code) 목록 — L1→L5 순서로 부모가 먼저 온다."""
    rows: list[tuple[str, str, int, str | None]] = [(SCALE_ROOT_CODE, SCALE_ROOT_NAME, 1, None)]
    l4_codes: list[tuple[str, str]] = []  # (code, name)
    for i2, l2 in enumerate(L2_NAMES, start=1):
        c2 = f"{SCALE_ROOT_CODE}-{i2:02d}"
        rows.append((c2, l2, 2, SCALE_ROOT_CODE))
        topics = L3_TOPICS[l2][: rng.randint(5, 7)]
        for i3, l3 in enumerate(topics, start=1):
            c3 = f"{c2}-{i3:02d}"
            rows.append((c3, l3, 3, c2))
            for i4, suffix in enumerate(L4_SUFFIXES[: rng.randint(5, 8)], start=1):
                c4 = f"{c3}-{i4:02d}"
                rows.append((c4, f"{l3} {suffix}", 4, c3))
                l4_codes.append((c4, f"{l3} {suffix}"))
    # L5 — L4마다 6~12개를 고르게 뿌린 뒤 목표 총수에 맞춰 마지막 L4들에서 가감
    counts = [rng.randint(6, 12) for _ in l4_codes]
    diff = target_l5 - sum(counts)
    idx = 0
    while diff != 0:
        step = 1 if diff > 0 else -1
        if 1 <= counts[idx % len(counts)] + step <= len(L5_ACTIONS):
            counts[idx % len(counts)] += step
            diff -= step
        idx += 1
    for (c4, l4_name), n in zip(l4_codes, counts, strict=True):
        for i5 in range(1, n + 1):
            rows.append((f"{c4}-{i5:02d}", f"{l4_name} — {L5_ACTIONS[i5 - 1]}", 5, c4))
    return rows


async def seed_framework_scale(target_l5: int = 2000, seed: int = 20260919) -> dict[str, int]:
    rows = _build_tree(target_l5, random.Random(seed))
    async with SessionLocal() as session:
        # 재실행: 이전 규모 시드 서브트리 제거(코드 접두 기준, 깊은 레벨부터 — FK ondelete 무관하게 안전)
        existing = (
            await session.scalars(
                select(ProcessCategory).where(
                    (ProcessCategory.code == SCALE_ROOT_CODE) | ProcessCategory.code.like(f"{SCALE_ROOT_CODE}-%")
                )
            )
        ).all()
        for level in (5, 4, 3, 2, 1):
            ids = [c.id for c in existing if c.level == level]
            if ids:
                await session.execute(delete(ProcessCategory).where(ProcessCategory.id.in_(ids)))
        await session.flush()

        id_by_code: dict[str, int] = {}
        sort_by_parent: dict[str | None, int] = {}
        for code, name, level, parent_code in rows:
            order = sort_by_parent.get(parent_code, 0)
            sort_by_parent[parent_code] = order + 1
            cat = ProcessCategory(
                code=code, name=name, level=level,
                parent_id=id_by_code[parent_code] if parent_code else None, sort_order=order,
            )
            session.add(cat)
            await session.flush()
            id_by_code[code] = cat.id
        await session.commit()
    by_level: dict[str, int] = {}
    for _code, _name, level, _parent in rows:
        by_level[f"L{level}"] = by_level.get(f"L{level}", 0) + 1
    return by_level


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="업무 체계 규모 시드 — L1 1개 아래 L5 약 2,000개(맵 없음)")
    parser.add_argument("--l5", type=int, default=2000, help="L5 목표 개수(기본 2000)")
    args = parser.parse_args()
    print(asyncio.run(seed_framework_scale(args.l5)))

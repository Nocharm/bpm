"""기존 게시본 지식기반 백필 — 서버에서 1회 수동 실행 (design 2026-07-23 §7).

사용: backend/ 에서 `python -m scripts.backfill_kb_maps` (EMBED_URL·AI_ENABLED=true 필요).
게시(published) 상태 버전만 인덱싱 — 이후 게시는 publish 훅이 자동 처리한다.
"""

import asyncio

from sqlalchemy import select

from app import workflow
from app.db import SessionLocal
from app.kb import embed_client, indexing
from app.models import MapVersion, ProcessMap


async def main() -> None:
    if not embed_client.is_embed_enabled():
        print("embedding is disabled — set EMBED_URL and AI_ENABLED=true in .env first")
        return
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(MapVersion.id, ProcessMap.name)
                .join(ProcessMap, MapVersion.map_id == ProcessMap.id)
                .where(
                    MapVersion.status == workflow.PUBLISHED,
                    ProcessMap.deleted_at.is_(None),
                )
            )
        ).all()
    print(f"indexing {len(rows)} published version(s)…")
    for version_id, name in rows:
        await indexing.index_map_version(version_id)
        print(f"  ok: {name} (version {version_id})")
    print("done")


if __name__ == "__main__":
    asyncio.run(main())

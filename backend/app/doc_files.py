"""배포에 함께 실리는 문서 파일 — docs/manual 매뉴얼의 앱 매뉴얼 자동 동기화와 docs/notices 공지 초안 불러오기.

저장소의 md 파일이 원본이다(사용자 결정 2026-11-05). 기동할 때 매뉴얼 파일을 `manual_docs`에 맞추고, 파일에서 온 문서
(`source_file`)는 화면·API로 고치지 못한다. 공지 초안은 관리자가 공지를 쓰거나 고칠 때 본문으로 불러온다.
"""

import asyncio
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.manual import extract_title
from app.models import ManualDoc

logger = logging.getLogger(__name__)

# 저장소 루트의 docs/ — 로컬은 backend/app에서 두 단계 위, 컨테이너는 /app/app에서 두 단계 위인 /docs에
# compose가 ./docs/manual·./docs/notices를 읽기 전용으로 붙인다(docker-compose.yml backend volumes)
DOCS_DIR = Path(__file__).resolve().parents[2] / "docs"
MANUAL_DIR_NAME = "manual"
NOTICE_DIR_NAME = "notices"
# 동기화한 문서의 updated_by — 사람이 아니라 배포 파일이 바꿨다는 표시
SYNC_ACTOR = "file-sync"
# 목록 순서 — 언어 꼬리(-ko/-en)를 뗀 이름 순서라 한/영 짝이 같은 순번이 된다(뷰어가 언어를 바꿔도 같은 문서). 없는 이름은 뒤에 이름순
_MANUAL_ORDER = ("user-manual-general", "user-manual-editing", "admin-manual")
_LANG_SUFFIX = re.compile(r"^(?P<stem>.+)-(?P<lang>ko|en)$")
# 게시 메모처럼 사람에게 보이면 안 되는 주석 — 공지 본문으로 옮길 때 지운다
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)
# 마지막으로 맞춘 매뉴얼 폴더의 파일 서명 — docs만 바뀐 배포(git pull)는 backend가 다시 뜨지 않으므로 목록 조회가 비교해 다시 맞춘다
_synced_signature: tuple | None = None
# 같은 프로세스 안의 동시 조회가 같은 파일 문서를 두 번 만들지 않게(단일 워커 전제, Dockerfile CMD)
_sync_lock = asyncio.Lock()


@dataclass(frozen=True)
class ManualFile:
    name: str
    language: str
    sort_order: int
    title: str
    content: str


@dataclass(frozen=True)
class NoticeDraft:
    file: str
    title: str
    body: str


def list_manual_files(directory: Path) -> list[ManualFile]:
    """매뉴얼 md 파일 — 이름이 `<문서>-ko.md`/`<문서>-en.md`인 것만, 목록 순서대로. 폴더가 없으면 빈 목록."""
    if not directory.is_dir():
        return []
    parsed: list[tuple[str, str, Path]] = []
    for path in directory.glob("*.md"):
        match = _LANG_SUFFIX.match(path.stem)
        if match is None:
            logger.warning("manual sync: skipped %s (name must end with -ko or -en)", path.name)
            continue
        parsed.append((match["stem"], match["lang"], path))
    known = {stem: index for index, stem in enumerate(_MANUAL_ORDER)}
    extra = sorted({stem for stem, _, _ in parsed if stem not in known})
    rank = {**known, **{stem: len(known) + index for index, stem in enumerate(extra)}}
    files = []
    for stem, lang, path in sorted(parsed, key=lambda item: (rank[item[0]], item[1])):
        content = path.read_text(encoding="utf-8")
        files.append(
            ManualFile(
                name=path.name,
                language=lang,
                sort_order=rank[stem],
                title=extract_title("markdown", content),
                content=content,
            )
        )
    return files


def _read_signature(directory: Path) -> tuple:
    if not directory.is_dir():
        return ()
    return tuple(
        sorted((path.name, path.stat().st_mtime_ns, path.stat().st_size) for path in directory.glob("*.md"))
    )


async def sync_manual_files_if_changed(session: AsyncSession, directory: Path) -> None:
    """파일 서명(이름·수정 시각·크기)이 지난 동기화와 다를 때만 맞추고 커밋한다 — 기동과 매뉴얼 목록 조회가 부른다."""
    global _synced_signature
    signature = _read_signature(directory)
    if signature == _synced_signature:
        return
    async with _sync_lock:
        if signature == _synced_signature:
            return
        await sync_manual_files(session, directory)
        await session.commit()
        _synced_signature = signature


async def sync_manual_files(session: AsyncSession, directory: Path) -> None:
    """매뉴얼 파일을 `manual_docs`에 맞춘다 — 없으면 만들고, 바뀐 것만 고치고, 파일이 사라진 문서는 지운다. 커밋은 호출자가 한다.

    처음 동기화할 때는 관리자가 손으로 올려 둔 같은 언어·같은 제목 문서를 그 파일 문서로 넘겨받아 목록에 겹치지 않게 한다.
    파일을 하나도 못 읽으면(마운트 누락 등) 아무것도 지우지 않는다.
    """
    files = list_manual_files(directory)
    if not files:
        logger.warning("manual sync: no manual files in %s, nothing changed", directory)
        return
    rows = list((await session.scalars(select(ManualDoc).order_by(ManualDoc.id))).all())
    by_source = {row.source_file: row for row in rows if row.source_file}
    created = updated = 0
    for file in files:
        row = by_source.pop(file.name, None)
        if row is None:
            row = next(
                (r for r in rows if r.source_file is None and r.language == file.language and r.title == file.title),
                None,
            )
        if row is None:
            row = ManualDoc(source_file=file.name)
            session.add(row)
            created += 1
        elif (row.source_file, row.content, row.title, row.sort_order, row.format) == (
            file.name,
            file.content,
            file.title,
            file.sort_order,
            "markdown",
        ):
            continue
        else:
            updated += 1
        row.source_file = file.name
        row.language = file.language
        row.format = "markdown"
        row.title = file.title
        row.content = file.content
        row.sort_order = file.sort_order
        row.updated_by = SYNC_ACTOR
    for stale in by_source.values():
        await session.delete(stale)
    logger.info(
        "manual sync: %d files, created %d, updated %d, removed %d", len(files), created, updated, len(by_source)
    )


def _list_notice_paths(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    # 파일 이름이 날짜로 시작하므로 이름 역순 = 최신 먼저
    return sorted(directory.glob("*.md"), key=lambda path: path.name, reverse=True)


def parse_notice_draft(file: str, text: str) -> NoticeDraft:
    """공지 초안 md → 제목(첫 `# ` 헤딩) + 본문(그 헤딩과 HTML 주석을 뺀 나머지). 헤딩이 없으면 파일 이름이 제목."""
    lines = _HTML_COMMENT.sub("", text).splitlines()
    title = Path(file).stem
    for index, line in enumerate(lines):
        if line.startswith("# "):
            title = line[2:].strip() or title
            del lines[index]
            break
    return NoticeDraft(file=file, title=title[:200], body="\n".join(lines).strip())


def list_notice_drafts(directory: Path) -> list[NoticeDraft]:
    """공지 초안 목록(최신 먼저) — 목록에는 본문을 싣지 않는다."""
    drafts = []
    for path in _list_notice_paths(directory):
        draft = parse_notice_draft(path.name, path.read_text(encoding="utf-8"))
        drafts.append(NoticeDraft(file=draft.file, title=draft.title, body=""))
    return drafts


def read_notice_draft(directory: Path, file: str) -> NoticeDraft | None:
    """공지 초안 한 편 — 목록에 있는 파일 이름만 받는다(경로 문자는 목록과 맞지 않아 None)."""
    for path in _list_notice_paths(directory):
        if path.name == file:
            return parse_notice_draft(path.name, path.read_text(encoding="utf-8"))
    return None

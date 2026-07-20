# Documentation Rules

`README.md` (and `USAGE.md` when needed) describes **the current project**. Don't leave template placeholders or meta guides in place.

**Do:**
- Root `README.md` covers — one-line summary of what the project does, who uses it, setup, key commands, primary directory layout.
- **로컬에서 실행하는 명령어는 bash(macOS/Linux)와 PowerShell(Windows)을 항상 병기**한다 — 로컬 검증이 Windows PC에서 이뤄지는 운영 파이프라인 때문. 서버(리눅스) 전용 절차(docker compose 등)는 bash만 작성한다.
- If the project warrants a `USAGE.md` (CLI tool, library, app with separate end-user guide), write **that project's** usage — not a meta guide.
- For projects started from a template, replacing the root `README.md` placeholder is one of the first tasks.
- Sync README on request, not on every change — when asked, align sections with code/structure changes (backend/Docker projects: `rules/backend/sync-checklist.md`).

**Don't:**
- Stack `feat:` / `fix:` commits while `_TODO_` or `<project name>` placeholders remain.
- Leave the template's meta README/USAGE (which describes the *template*, not your project) in a downstream project.
- Make the first meaningful commit while the README is still a one-line placeholder.

## docs/ 구조 · 유지관리

문서는 카테고리 폴더로 정리한다. 인덱스는 [`docs/README.md`](../../docs/README.md).

- **루트 유지**: `docs/spec.md`(살아있는 기능 명세 — 코드 다수가 `docs/spec.md §X`로 참조하니 이동 금지), `docs/README.md`(인덱스).
- **카테고리 폴더**: `docs/deploy/`(배포·DB 시드·마이그레이션) · `docs/qa/`(검증·감사) · `docs/design/`(기능별 설계 스냅샷 + 분야별 인덱스) · `docs/manual/` · `docs/lessons/` · `docs/notices/` · `docs/samples/` · `docs/history/`(아카이브).
- **설계 문서 참조 불변식**: `docs/design/*-design.md`는 **소스 코드 주석(`// 설계: docs/design/…`)이 정확한 경로로 참조**한다. 옮기거나 이름을 바꾸면 `git grep "docs/design/"`로 그 참조도 반드시 함께 갱신한다.
- **새 문서**: 위 카테고리 중 하나에 넣고 `docs/README.md` 인덱스(설계 문서면 `docs/design/README.md`도)에 한 줄 추가한다. 문서를 옮기면 `git grep`으로 참조를 전수 갱신하고 끊긴 링크가 없는지 확인한다.
- **PROGRESS 아카이브**: 루트 `PROGRESS.md`는 최근 항목만 유지하고, 오래된 상세 항목은 `docs/history/PROGRESS-archive.md`로 옮긴다(더 오래된 것은 git history).

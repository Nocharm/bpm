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

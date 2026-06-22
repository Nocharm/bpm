# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**BPM (Business Process Management) — 프로세스맵을 그리는 웹 서비스.** 현업이 노드/엣지로 계층형 프로세스 흐름을 시각적으로 작성·편집하고, As-Is/To-Be를 버전으로 관리·비교하는 도구. **기능 명세: `docs/spec.md`** (데이터 모델, UX, 구현 순서).

> 상태(메인 기준): ⑤ Keycloak 인증 · ⑥ docker-compose 배포(3333) · ⑦ **하위프로세스 참조 모델(Call Activity)** — 인라인 계층 편집(`parent_node_id`) 폐기, 평면 노드 + 다른 맵 링크(읽기전용 임베드) · ⑧ **권한 관리(RBAC) 백엔드** 머지 완료(맵 가시성·협업자·승인자·버전 워크플로·유저그룹). 진행 현황은 `PROGRESS.md`, 구현 순서는 `docs/spec.md` §6.
> DB: 로컬 네이티브는 sqlite 파일(무설정), 서버 compose는 postgres. 스키마는 startup `create_all`(마이그레이션 후속). **DB 초기화·데모 시드: `docs/db-seed.md`**(`python -m scripts.reset_db`).
> ⚠️ **캔버스/에디터 작업 전 `docs/lessons/`(시행착오 방지)를 먼저 읽을 것** — 아래 "Lessons" 섹션. (단, 인라인 계층 *편집*은 ⑦에서 제거됨 → 읽기전용 임베드. lessons는 React Flow/좌표/검증 함정 위주로 유효.)

## Commands

실행 명령은 **bash(macOS/Linux)와 PowerShell(Windows)을 병기**한다 — 로컬 검증이 Windows PC에서 이뤄지기 때문 (`rules/common/documentation.md`).

```bash
# === bash (macOS/Linux) ===
# backend (backend/ 에서, 로컬 네이티브)
# 의존성 설치 — uv (빠름) 또는 pip 중 환경에 맞게. 사내 로컬은 uv 불가 → pip 사용.
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
# pip 대안: python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000   # 개발 서버
.venv/bin/python -m pytest tests/ -q                  # 테스트
.venv/bin/ruff check app/ tests/                      # 린트

# frontend (frontend/ 에서, 로컬 네이티브)
npm install
npm run dev    # 개발 서버 :3000 — /api는 BACKEND_URL(기본 localhost:8000)로 프록시
npm run build  # 프로덕션 빌드 (standalone)
npm run lint
```

```powershell
# === PowerShell (Windows) ===
# backend (backend\ 에서, 로컬 네이티브) — 사내 로컬은 uv 불가 → pip 사용
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\uvicorn app.main:app --reload --port 8000   # 개발 서버
.venv\Scripts\python -m pytest tests/ -q                  # 테스트
.venv\Scripts\ruff check app/ tests/                      # 린트

# frontend (frontend\ 에서) — npm 명령은 동일
npm install
npm run dev
npm run build
npm run lint
```

```bash
# 서버 배포 (리눅스 서버, 저장소 루트, .env 필요 — .env.example 참고)
docker compose up -d --build   # 접속: http://<서버>:3333
```

## Architecture

모노레포. 4개 컨테이너를 docker-compose로 묶어 nginx 리버스 프록시 뒤에 둔다.

| 레이어 | 스택 | 역할 |
|--------|------|------|
| **frontend** | Next.js (TypeScript, React) + @xyflow/react | 프로세스맵 에디터 UI — 캔버스/노드/엣지 편집, 계층 오버레이, 버전 비교 |
| **backend** | Python — FastAPI + SQLAlchemy + Pydantic | 맵/버전/노드/엣지 CRUD·검증·영속화 API, Keycloak JWT 검증 |
| **db** | PostgreSQL | 맵·버전·노드·엣지 영속 저장 |
| **proxy** | nginx | 앱 내부 리버스 프록시 — `/` → frontend, `/api` → backend 라우팅. **서버 노출 포트 3333** |

**경계:** 브라우저 → `:3333`(앱 nginx) → (Next.js | FastAPI) → PostgreSQL. frontend↔backend 통신은 nginx 경유 HTTP. 입력 검증은 backend API 경계에서 수행 (`rules/common/security.md`).

**nginx 토폴로지 (확정):** 서버 엣지 nginx(443/80)는 직접 편집 가능한 별도 자산. 앱 compose nginx는 **3333**에 노출하고 우선 포트로 직접 접속, 추후 엣지 nginx에 도메인(g-ai-agent.sbiologics.com) 라우팅 추가.

**인증 (확정):** 같은 서버의 기존 Keycloak(realm `ai-portal`) OIDC 사용. 주소는 하드코딩 금지 — `.env` 경유 (`docs/spec.md` §4).

**디렉터리 구조:**
```
frontend/   # Next.js 앱 (에디터: src/app/maps/[mapId]/page.tsx — ~5000줄 단일 컴포넌트)
backend/    # Python API 서버 + requirements.txt / requirements-dev.txt
nginx/      # 리버스 프록시 설정
docs/       # spec.md, lessons/(시행착오 방지), superpowers/plans·specs/
docker-compose.yml
```

언어 규칙은 backend → `rules/languages/python.md`, frontend → `rules/languages/typescript.md` 적용. 컨테이너/설정 규칙은 `rules/backend/` 참고.

## Lessons — 시행착오 방지

캔버스 에디터(React Flow)에서 실측으로 얻은 교훈. **`frontend/src/app/maps/[mapId]/page.tsx`를 건드리기 전에 해당 카테고리를 먼저 읽을 것** (인덱스: `docs/lessons/README.md`). 인라인 계층 *편집*은 하위프로세스 참조 모델(⑦)에서 제거됨 — 임베드 자식은 읽기전용이라 아래 자식-편집/스코프-저장 항목은 주로 **역사적 기록**이나, React Flow 렌더/좌표/검증 함정은 읽기전용 임베드에도 유효.

- [`docs/lessons/canvas-react-flow.md`](docs/lessons/canvas-react-flow.md) — 자식 노드는 메인 `nodes`에 합치지 말고 별도 `childNodes` state, prop-only 자식의 visibility/이벤트 함정, `getNode`/`getIntersectingNodes` 자식 한계, 펼침 중 인터랙션 게이팅.
- [`docs/lessons/scope-save-and-coordinates.md`](docs/lessons/scope-save-and-coordinates.md) — 자식 스코프 저장 `getGraph→변형→PUT`(그룹 보존), fullGraph 낙관적 갱신, 스코프상대↔표시 좌표(`childOffsets`/`scopeOffsets`), buildScope는 dagre 대신 저장 pos.
- [`docs/lessons/browser-verification.md`](docs/lessons/browser-verification.md) — Playwright+시스템 Chrome 검증, **dev.db 오염/readonly 함정**("0 events"는 코드 아닌 오염일 수 있음), 연결 드롭 flaky, node cwd.
- [`docs/lessons/react-ts-patterns.md`](docs/lessons/react-ts-patterns.md) — useCallback deps TDZ → ref 미러, set-state-in-effect 린트, 큰 상태 모델은 메인 state 오염 금지.

## Operations / Deployment

**파이프라인:** GitHub(Claude Code 수정) → Windows PC로 `git pull` → **로컬에서 Docker 없이 네이티브 실행·확인** → 서버(사내 71번)로 전송(scp 또는 gitlab pull) → **서버에서 docker-compose 배포**.

운영 환경이 코드에 부과하는 제약 — 위반하면 배포가 깨진다:

| 제약 | 이유 | 코드 반영 |
|------|------|-----------|
| **줄바꿈은 LF 고정** | Windows PC 경유 시 CRLF 오염 → Linux/Docker에서 스크립트·빌드 깨짐 | `.gitattributes`로 `* text=auto eol=lf` 강제 (Windows 전용 스크립트만 CRLF) |
| **로컬은 Docker 없음** | Windows PC에 Docker 미설치 | frontend/backend는 네이티브 실행 가능해야 함 (`npm run dev`, Python 직접 실행). DB·서비스 주소는 env로 분리 (`rules/backend/config.md`) — 로컬은 로컬 Postgres/원격, 서버는 compose 네트워크 |
| **앱 nginx는 443/80 미점유** | 서버 엣지 nginx가 이미 443/80 사용 | compose nginx는 **3333** 노출. 우선 포트 직접 접속, 도메인 라우팅은 추후 엣지 nginx에 추가 |
| **서버는 평문 HTTP(원격 IP)** | 브라우저 secure context 아님(HTTPS·localhost만) → `crypto.subtle`/`crypto.randomUUID` 등 Web Crypto 미동작 | id는 `frontend/src/lib/id.ts`의 `genId()` 사용(`crypto.randomUUID` 금지), Keycloak 로그인은 PKCE 비활성(`disablePKCE`). **localhost는 secure context라 재현 안 됨 — 서버/원격 IP로 검증** |
| **로컬↔서버 실행 경로 이원화** | 로컬=네이티브, 서버=Docker | 같은 코드가 양쪽에서 돌도록 환경 의존 값은 하드코딩 금지, 전부 `.env` 경유 |

**검증 단계:** 로컬 네이티브 실행으로 기능 확인 → 서버 docker-compose로 배포 확인. 로컬에서 통과해도 컨테이너 네트워크/포트/줄바꿈 차이로 서버에서 깨질 수 있으니 양쪽 모두 검증한다.

---

## Working Style — 최우선 (모든 룰보다 먼저)

**모든 작업의 행동 기반.** 아래 도메인 룰과 충돌해도 이 가이드의 원칙이 우선한다.

@rules/guidelines.md

---

## Rules — 범용 (유지)

@rules/common/comments.md
@rules/common/naming.md
@rules/common/git.md
@rules/common/security.md
@rules/common/error-handling.md
@rules/common/dependencies.md
@rules/common/documentation.md
@rules/common/testing.md

## Rules — 백엔드/Docker (아니면 이 블록 삭제)

배포/컨테이너 전제 규칙. 라이브러리·CLI·프론트 단독 프로젝트면 이 블록을 통째로 삭제한다.

@rules/backend/config.md
@rules/backend/docker.md
@rules/backend/sync-checklist.md

## Language-Specific Rules

프로젝트에서 사용하는 언어만 남기고 나머지 줄은 삭제한다.

@rules/languages/python.md
@rules/languages/typescript.md
@rules/frontend/design.md

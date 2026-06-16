# BPM — Business Process Management

현업이 **계층형 프로세스맵**을 그리고 **As-Is/To-Be를 버전으로 관리·비교**하는 웹 애플리케이션.

- 노드(단계)·엣지(선후 흐름)로 프로세스를 시각 편집 — React Flow 캔버스
- 노드를 다른 노드 위로 끌어 **앞/뒤(흐름 삽입)·그룹·하위로 넣기** 드롭 영역 (커서 위치 기반, 원형 + 4방향 타일)
- 하위 프로세스맵 진입 (계단식 창 스택 + 브레드크럼, 깊이 무제한) — 비활성 창은 경량 정적 프리뷰
- **업무 그룹**(부서/담당자) 묶음 — 이름·색 지정, 그룹 전체 이동, 멤버 나가기
- 좌측 **아웃라인 트리**(분기 들여쓰기 + 하위 펼치기, 클릭 시 해당 노드로 포커싱)
- 자동 정렬(선후 기준 레이아웃) 및 선택 노드 맞춤/등간격 정렬
- 버전 생성(복제)·라벨링·나란히 비교 · PNG 내보내기

기능 명세: [`docs/spec.md`](docs/spec.md)

## 구조

| 디렉터리 | 스택 | 역할 |
|----------|------|------|
| `frontend/` | Next.js + TypeScript + @xyflow/react | 에디터 UI |
| `backend/` | FastAPI + Python 3.11 | 맵/버전/노드/엣지 API |
| `nginx/` | nginx | 리버스 프록시 — `/` → frontend, `/api` → backend |
| `docker-compose.yml` | + PostgreSQL 16 | 서버 배포 (포트 **3333**) |

## 로컬 개발 (Docker 없이 네이티브)

**bash (macOS/Linux):**

```bash
# backend — http://localhost:8000
cd backend
# uv가 있으면:
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
# uv가 없으면 (사내 로컬 등) pip로:
#   python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# frontend — http://localhost:3000 (/api는 backend로 자동 프록시)
cd frontend
npm install
npm run dev
```

**PowerShell (Windows):**

```powershell
# backend — http://localhost:8000
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\uvicorn app.main:app --reload --port 8000

# frontend — http://localhost:3000 (/api는 backend로 자동 프록시)
cd frontend
npm install
npm run dev
```

테스트/린트 (`backend/`에서 · frontend는 `npm run lint`):

```bash
.venv/bin/python -m pytest tests/ -q
.venv/bin/ruff check app/ tests/
```

```powershell
.venv\Scripts\python -m pytest tests/ -q
.venv\Scripts\ruff check app/ tests/
```

## 서버 배포 (docker-compose)

```bash
cp .env.example .env   # POSTGRES_PASSWORD, KEYCLOAK_* 등 수정
docker compose up -d --build
# 접속: http://<서버>:3333
```

> 전체 절차(Keycloak 클라이언트 등록·헬스체크·롤백)는 **[`docs/deploy.md`](docs/deploy.md)** 참고.
> 서버의 엣지 nginx(443/80)와 충돌하지 않도록 앱은 3333에 노출한다. 줄바꿈은 `.gitattributes`로 LF 고정 — Windows PC를 경유해도 안전. 자세한 운영 제약은 `CLAUDE.md`의 Operations 섹션 참고.

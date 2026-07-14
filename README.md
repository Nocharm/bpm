# BPM — Business Process Management

현업이 **계층형 프로세스맵**을 그리고 **As-Is/To-Be를 버전으로 관리·비교**하는 웹 애플리케이션.

- 노드(단계)·엣지(선후 흐름)로 프로세스를 시각 편집 — React Flow 캔버스
- 노드를 다른 노드 위로 끌어 **앞/뒤(흐름 삽입)·그룹·하위로 넣기** 드롭 영역 (커서 위치 기반, 원형 + 4방향 타일)
- 하위프로세스 노드가 **다른 맵을 참조**(Call Activity) — 읽기전용 인라인 임베드 + 드릴인, 고정 버전 또는 최신 자동추종
- **업무 그룹**(부서/담당자) 묶음 — 이름·색 지정, 그룹 전체 이동, 멤버 나가기
- 노드별 **회당 파라미터** — 소요시간(시.분→`1h30m`)·비용(원/달러 배타)·투입인원·연간 건수·FTE, 그룹·서브프로세스 합계 미리보기
- 좌측 **아웃라인 트리**(분기 들여쓰기 + 하위 펼치기, 클릭 시 해당 노드로 포커싱)
- 자동 정렬(선후 기준 레이아웃) 및 선택 노드 맞춤/등간격 정렬
- **CSV/AI 가져오기**(제목 병합·새 맵 생성) 및 **PNG·Excel·CSV·Word 내보내기**
- 버전 생성(복제)·라벨링·나란히 비교
- **버전 승인 워크플로** — Draft→제출(Pending)→승인(만장일치)→게시(Published), 반려·회수(기록 유지), 게시 시 순차 버전번호(v1,v2…)·직전 게시본 만료(Expired)·만료본 재게시
- **점유권(checkout)** — 드래프트 편집은 보유자 1인만, 지정 인계 전용(직접 이전 / 요청→승인). 요청자 복수·승인 시 나머지 자동거절·요청 철회, 출처(누구에게서·언제) 표시
- **권한(RBAC)** — 맵별 owner/editor/viewer(유저·부서·그룹 grant), 공개/비공개 가시성, 지정 승인자, 유저 그룹 라이프사이클
- **인증** — Keycloak(OIDC) 로그인. 로컬(인증 OFF)은 임시 로그인 피커로 직원 디렉터리를 검색·선택

기능 명세: [`docs/spec.md`](docs/spec.md)

## 구조

| 디렉터리 | 스택 | 역할 |
|----------|------|------|
| `frontend/` | Next.js + TypeScript + @xyflow/react | 에디터 UI |
| `backend/` | FastAPI + Python 3.12 | 맵/버전/노드/엣지·승인 워크플로·권한 API |
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

## 데이터 초기화 / 데모 시드

**로컬·데모 전용** — 운영 서버는 런칭되어 현업 데이터가 있으므로 `reset_db`를 실행하면 안 된다(`drop_all`). 서버 스키마는 배포 시 자동 보강된다(`docs/db-seed.md`). 로컬에서 DB를 비우고 종합 데모 데이터를 채우려면 backend/ 에서:

```bash
.venv/bin/python -m scripts.reset_db        # drop+create + 종합 데모(조직도·직원401·맵12·그룹6)
```
```powershell
.venv\Scripts\python -m scripts.reset_db
```

시드 내용: 센터/담당/팀/파트 조직도 + 직원 ~400명(sysadmin `admin.sys`) + 맵 12개(공개6/비공개6, 버전 v1~v5 승인 워크플로 + 작업본) + 그룹 6. `/login`의 임시 로그인 피커에서 검색해 아무나 접속. 실제 역할(owner/editor/viewer)로 화면을 검증하려면 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys`(또는 `backend/.env`)로 백엔드를 띄운다.

> 시드 상세·부분 시드·권한 강제 검증은 **[`docs/db-seed.md`](docs/db-seed.md)** 참고.

## 서버 배포 (docker-compose)

```bash
cp .env.example .env   # POSTGRES_PASSWORD, KEYCLOAK_* 등 수정
docker compose up -d --build
# 접속: http://<서버>:3333
```

> 전체 절차(Keycloak 클라이언트 등록·헬스체크·롤백)는 **[`docs/deploy.md`](docs/deploy.md)** 참고.
> 서버의 엣지 nginx(443/80)와 충돌하지 않도록 앱은 3333에 노출한다. 줄바꿈은 `.gitattributes`로 LF 고정 — Windows PC를 경유해도 안전. 자세한 운영 제약은 `CLAUDE.md`의 Operations 섹션 참고.

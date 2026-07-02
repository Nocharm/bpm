# DB 초기화 & 데모 시드

로컬/서버 DB를 비우고 데모 데이터를 채우는 방법. 데모·QA·화면 검증용. **서비스 미런칭 상태라 리셋은 자유롭게 가능** — 단 운영 데이터가 생긴 뒤에는 금지(아래 ⚠️).

진입점: **`backend/scripts/reset_db.py`** — 단일 명령으로 전체 리셋 + 종합 데모 시드(`scripts/seed_org_demo.py`).

## 한 줄 리셋

backend/ 에서 가상환경 활성화 후 (의존성 설치는 `CLAUDE.md` Commands 참고):

```bash
# === bash (macOS/Linux) ===
cd backend
.venv/bin/python -m scripts.reset_db
```
```powershell
# === PowerShell (Windows) ===
cd backend
.venv\Scripts\python -m scripts.reset_db
```

성공 시 콘솔에 `schema drop_all+create_all` → `seed org demo — employees=401 …` → `verify …` 요약이 출력된다.

## reset_db가 하는 일

1. **스키마 재생성** — `drop_all` + `create_all`(모든 테이블 삭제 후 재생성). 컬럼 추가 등 스키마 변경을 반영하는 유일한 경로.
2. **종합 데모 시드** — `scripts/seed_org_demo.py`(RNG seed 고정 → 재현성). 조직도 + 직원 ~400 + 그룹 6 + 맵 12(버전 워크플로)를 한 번에 채운다.

> **`create_all`은 기존 테이블 컬럼을 ALTER하지 않는다** — 모델에 컬럼 추가 시 기존 DB엔 미반영. `reset_db`(drop 포함)나 `app/db.py`의 `_add_missing_columns` 스톱갭으로 보강. 마이그레이션(Alembic)은 후속.

## 시드되는 데이터 (`seed_org_demo`)

**조직도** — 센터 2개(+ 관리센터), 각 센터에 담당(Department) 2개, 각 담당에 팀 2~3개, 각 팀에 파트 1~3개. 리프 깊이 혼합: **파트가 리프 / 팀이 리프(파트 없음) / 담당이 리프(팀 없음)** 3종. 직원 **~400명**을 리프에 라운드로빈으로 고루 분포. org 레벨: `org_l1`=센터·`org_l2`=담당·`org_l3`=팀·`org_l4`=파트, `department`=리프명.

**시스템 관리자** — `admin.sys` 1명(`role=admin`). 권한 강제 모드에서 `BPM_SYSADMINS=admin.sys`로 지정하면 전 맵 열람(그 외엔 실제 역할).

**그룹 6** — 유저 구성 2 · 파트 구성 2(파트 org_path를 `department` 멤버로) · 혼합 2(유저+파트).

**맵 12** — 종류·공개범위 다양(공개 6 / 비공개 6). 각 맵: 오너 + 편집자·뷰어 권한(유저·부서·그룹 혼합), 승인자 1~3명. 버전은 **v1~v5 게시**(정상 워크플로: 생성→제출→승인→게시, v1~4 만료·v5 현재 게시) + 최상위 작업본(대부분 draft, 일부 rejected). 일부 버전 이력에 **반려·회수** 케이스 삽입.

**로컬 로그인 피커** — `/login`의 임시 로그인이 백엔드 디렉터리(전 직원)를 조회·검색해 400명 중 아무나 골라 접속(관리자는 `admin` 배지). 인증 OFF에서 dev 유저는 `bpm.devUser`에 저장.

## 부분 시드

`reset_db`가 단일 종합 시드로 통합됐다. 부분만 채우려면 빈 DB(`dev.db` 삭제)에서 `scripts.seed_org_demo`의 개별 함수를 호출한다. (구 `seed_reference_demo`·`seed_permission_demo`·`seed_version_lifecycle_demo` 등은 파일로 남아 있으나 `reset_db`가 더 이상 호출하지 않는다.)

## 대상 DB

`settings.database_url`(env `DATABASE_URL`)을 그대로 쓴다.

- **로컬 네이티브**: 기본 무설정 sqlite 파일 `backend/dev.db` — 바로 실행.
- **로컬 Postgres / 서버**: `.env`의 `DATABASE_URL`을 Postgres로 교체하면 그 DB에 시드된다 (`.env.example` 참고).

> ⚠️ `reset_db`는 1단계 `drop_all`로 대상 DB의 **모든 테이블을 삭제**한다. 운영 데이터가 있는 DB에는 절대 실행하지 말 것 — 데모/QA용 빈 DB에서만.

## 서버(docker-compose)에서 시드

서버는 compose/postgres 환경이고 `DATABASE_URL`이 컨테이너 안에서 자동으로 postgres(`db:5432`)를 가리키므로, **backend 컨테이너 안에서** 같은 스크립트를 돌리면 된다. 시드 스크립트는 backend 이미지에 포함돼 있다(`backend/Dockerfile`의 `COPY scripts/ scripts/`).

저장소 루트(docker-compose.yml 위치)에서:

```bash
git pull                                  # 스크립트 포함 최신 이미지 소스
docker compose up -d --build backend      # scripts/가 포함된 이미지로 재빌드
docker compose exec backend python -m scripts.reset_db
```

성공 시 컨테이너 로그에 `schema drop_all+create_all` → `seed org demo …` → `verify …` 요약이 출력된다.

> ⚠️ 서버에서도 `reset_db`는 postgres의 **모든 테이블을 삭제**한다(`drop_all`). 미런칭 데모 서버라 데이터가 없을 때만 안전.

## 권한 강제 모드로 검증

기본은 전원 sysadmin(잠금 우회). 실제 역할로 권한 화면을 검증하려면 백엔드를 권한 시뮬레이션으로 띄운다:

```bash
# === bash (macOS/Linux) ===
DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys .venv/bin/uvicorn app.main:app --reload --port 8000
```
```powershell
# === PowerShell (Windows) ===
$env:DEV_ENFORCE_PERMISSIONS="true"; $env:BPM_SYSADMINS="admin.sys"
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

- `DEV_ENFORCE_PERMISSIONS=true`: `BPM_SYSADMINS`(=`admin.sys`) 외 사용자는 실제 effective_role 적용.
- dev 유저 전환은 로그인 화면 피커(`bpm.devUser`에 저장) — 400명 검색.

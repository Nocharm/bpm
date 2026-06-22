# DB 초기화 & 데모 시드

로컬/서버 DB를 비우고 데모 데이터를 채우는 방법. 데모·QA·화면 검증용. **서비스 미런칭 상태라 리셋은 자유롭게 가능** — 단 운영 데이터가 생긴 뒤에는 금지(아래 ⚠️).

진입점: **`backend/scripts/reset_db.py`** (단일 명령으로 전체 리셋+시드). 부분 시드는 `seed_reference_demo.py`·`seed_permission_demo.py`.

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

성공 시 콘솔에 `schema drop_all+create_all` → `seed employees 5명` → 참조 데모 맵 → `seed permission demo` → `verify employees=6, map_permissions=…` 요약이 출력된다(employees는 직원5 + 비활성 승인자 데모 1 = 6).

## reset_db가 하는 일 (4단계)

| 단계 | 내용 |
|------|------|
| 1. 스키마 재생성 | `drop_all` + `create_all` — **모든 테이블 삭제 후 재생성**. 컬럼 추가 등 스키마 변경을 반영하는 유일한 경로 |
| 2. 직원 시드 | `seed_local_employees` (LOCAL_USERS 5명: admin.kim / user.lee·park·choi·jung, org_l* 포함 영문) |
| 3. 참조 데모 맵 | `seed_reference_demo` — 하위프로세스 참조(Call Activity) 모델 데모 맵 4개 |
| 4. 권한 데모 | `seed_permission_demo` (ADDITIVE) — RBAC 워크플로 데모 엔터티 (맵마다 노드 흐름 포함) |
| 5. 버전 비교 데모 | `seed_compare_demo` (ADDITIVE) — As-Is/To-Be 2버전 맵 1개 (비교 화면용) |

> **`create_all`은 기존 테이블의 컬럼을 ALTER하지 않는다.** 모델에 컬럼을 추가했으면 기존 DB에는 반영 안 됨 → `reset_db`(drop 포함)로 재생성하거나 dev.db 파일을 지워야 한다. 마이그레이션(Alembic)은 후속.

## 시드되는 데모

### 참조 데모 맵 (`seed_reference_demo`)
하위프로세스 참조 모델 — 평면 노드 + 다른 맵 링크 — 의 검증 픽스처. 한 흐름에서 임베드·읽기전용 드릴인·다중 출구(대표끝/분기끝)·고정 참조·자동추종(`follow_latest`)·버전 업데이트 배지를 모두 보여준다.

| 맵 | 상태 | 역할 |
|----|------|------|
| 주문 처리 | published v1 | 다중 출구(완료=대표끝 / 취소=분기끝) 링크 대상 |
| 배송 | published v1·v2 | 끝 동일한 안전 버전업 (v2 최신) |
| 결제 | published v1 | 자동추종(`follow_latest`) 대상 |
| 주문 이행 | draft (편집) | 위 3맵을 링크 — 고정 v1 + follow-latest + 업데이트 배지 시연 |

### 버전 비교 데모 (`seed_compare_demo`, ADDITIVE)
맵 **"Version Comparison Demo (As-Is / To-Be)"** 1개 — 같은 맵에 `As-Is`(published)·`To-Be`(draft) 두 버전. To-Be 노드의 `source_node_id`를 As-Is 노드에 이어(diff 계보) 비교 화면(`/maps/{id}/compare`)에서 하이라이트가 실제로 표시된다:
- **추가**(초록): 품질 점검 · **삭제**(빨강): 수기 승인 · **변경**(노랑): 신용 검토(담당자), 출고→출고/배송(이름·부서)

public 맵이라 권한 강제 모드에서도 누구나 viewer로 비교를 열 수 있다.

### 권한 데모 (`seed_permission_demo`, ADDITIVE)
LOCAL_USERS/참조데모를 건드리지 않고 RBAC 워크플로만 추가. 데모 전용 비활성 승인자 `user.former` 1명을 여기서 삽입(LOCAL_USERS 아님).

- 가시성 대비 맵 2 (Public / Private)
- "Roles & Principals Demo" — user/department/group 3종 협업자 grant + pending 2건(권한 다운그레이드·가시성 변경) + 활성(`user.jung`)·비활성(`user.former`) 승인자
- 그룹 2 — active "Approved Cross-Team Group"(맵에 grant→상속) + pending "Proposed Review Group"(sysadmin 승인 큐)
- "Version Workflow Demo" — published v1 + pending v2(제출자 `user.lee`). v1↔v2도 계보로 이어져 **비교 화면에서 추가(Test)·변경(Release→Release & Notify)** 표시.

모든 권한 데모 맵은 노드 흐름을 갖는다(빈 맵 아님). 화면으로 따라가는 8단계 투어는 **[`permission-demo-walkthrough.md`](permission-demo-walkthrough.md)** 참고.

## 부분 시드 (선택)

빈 DB에 한 종류만 채울 때. **둘 다 reset 없이 실행하면** 기존 행과 충돌할 수 있으니, 보통 `reset_db`를 쓴다.

```bash
# 참조 데모 맵만 (dev.db를 먼저 지울 것 — create_all은 컬럼을 ALTER하지 않음)
rm -f dev.db && .venv/bin/python -m scripts.seed_reference_demo
```
```powershell
Remove-Item dev.db; .venv\Scripts\python -m scripts.seed_reference_demo
```

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

성공 시 컨테이너 로그에 `schema drop_all+create_all` → `seed employees` → 참조 데모 → `seed permission demo` → `verify …` 요약이 출력된다.

> ⚠️ 서버에서도 `reset_db`는 postgres의 **모든 테이블을 삭제**한다(`drop_all`). 미런칭 데모 서버라 데이터가 없을 때만 안전. 스키마를 두고 데모만 추가하려면 `reset_db` 대신 빈 DB에 `scripts.seed_reference_demo`(+`scripts.seed_permission_demo`)만 돌린다.
>
> 이미지를 재빌드하기 싫으면 호스트 스크립트를 일회용 컨테이너에 마운트해도 된다:
> `docker compose run --rm -v "$(pwd)/backend/scripts:/app/scripts" backend python -m scripts.reset_db`

## 권한 강제 모드로 검증

기본은 전원 sysadmin(잠금 우회). 실제 역할로 권한 화면을 검증하려면 백엔드를 권한 시뮬레이션으로 띄운다:

```bash
DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.kim .venv/bin/uvicorn app.main:app --reload --port 8000
```

- `DEV_ENFORCE_PERMISSIONS=true`: `BPM_SYSADMINS` 외 사용자는 실제 effective_role 적용.
- dev 유저 전환은 로그인 화면 스위처(`bpm.devUser`에 저장). 자세한 시나리오는 walkthrough Step 0~7.

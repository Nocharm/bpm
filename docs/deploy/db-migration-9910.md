# DB 마이그레이션 & 9910 검증 스택 가이드

운영 스택(포트 **9900**)의 DB를 **복사**해서 dev를 포트 **9910**에 별도 스택으로 띄워, 마이그레이션과 기능을 검증하는 절차. 검증이 끝나면 dev→main 머지 후 운영(9900)을 같은 방식으로 승격한다. **운영 스택과 볼륨은 일절 건드리지 않는다**(덤프 읽기만).

회차마다 반복하는 절차다 — §1의 "이번 회차" 표만 갱신해서 재사용한다. 스택을 처음 세울 때만 하는 준비(Keycloak URI 등록·n8n 워크플로·서브넷 분리)는 [`setup-once.md`](setup-once.md)로 분리했다.

> **명령에 alias를 쓰지 않는다.** 예전 판은 `dc910`이라는 alias를 전제했는데, 셸을 새로 열거나 다른 사람이 이어받으면 조용히 깨진다. 아래 명령은 전부 그대로 복사해 쓸 수 있는 완전형이다. 공통 접두는 항상:
>
> ```bash
> docker compose -p bpm-9910 --env-file .env.9910 <명령>
> ```
>
> 매번 타이핑이 길면 alias 대신 **셸 변수**를 쓴다(같은 셸 안에서만 유효한 건 alias와 같지만, 문서의 명령을 변형하지 않아 붙여넣기가 안전하다):
>
> ```bash
> DC910="docker compose -p bpm-9910 --env-file .env.9910"
> $DC910 ps
> ```

---

## 1. 스키마 변경 요약

### 메커니즘 — 별도 DDL 스크립트가 없다

backend 기동 시 `app/db.py::init_models()`가 멱등 실행된다: `create_all`(신규 테이블) → `_add_missing_columns()`(기존 테이블의 신규 컬럼) → `_add_missing_indexes()` → 비치명 부트스트랩 스텝. **덤프를 복원한 DB 위에 새 backend를 1회 기동하는 것이 곧 마이그레이션**이다.

변경은 전부 additive/완화라 구버전 코드도 같은 DB에서 동작한다 — 롤백은 구버전 컨테이너 재기동이면 충분하다.

### 이번 회차 델타 구하기

운영에 배포된 커밋과 검증할 커밋을 알면 델타는 기계적으로 나온다:

```bash
git diff <운영커밋>..<검증커밋> -- backend/app/db.py backend/app/models.py
```

`_ADDED_COLUMNS`에 **추가된 줄이 곧 ALTER 목록**이고, `models.py`에 새로 생긴 클래스가 `create_all`이 만들 신규 테이블이다.

### 이번 회차 (dev `9b22ca6b`, 2026-08-31 기준)

| 구분 | 대상 | 내용 |
|------|------|------|
| 신규 테이블 | `category_permissions` | 카테고리 권한자 행(user·group만, 하향 상속은 판정 시 조상 체인 매치) |
| 신규 컬럼 | `process_categories.linkage_map_id` INTEGER | L5 ↔ 연계 캔버스 맵 1:1 결착 |
| 신규 컬럼 | `map_versions.fw_major` · `fw_minor` INTEGER | framework 캔버스 확정 스냅샷 번호 |
| 신규 컬럼 | `nodes.placeholder_category_id` INTEGER | 미등록 SP의 출처 L5 |
| 신규 컬럼 | `nodes.width` INTEGER | SP 노드 폭 조절 영속 |
| 신규 컬럼 | `process_maps.retired_to_map_id` INTEGER | 이양 후계자 맵 |

- 레거시 DB에서는 `linkage_map_id`가 **FK 없이** 추가된다(ALTER의 한계) — 정합은 앱 계층이 보장한다. 정상이다.
- 운영이 이보다 더 오래된 커밋이면 이전 회차 항목(`employees.dept_code`·`position`, `departments`·`process_categories` 테이블, `employees.email` NOT NULL 완화 등)도 같이 적용된다. 전부 같은 기동 1회로 처리된다.

### 데이터 의미 변화 (DDL 아님 — 검증 시 체감 포인트)

- **employees 단일 소스가 AD LDAP → HR 웹훅**: sync 시 `source='ad'`가 `'hr'`로 전환, HR 피드에 없는 구 계정은 삭제(20% 상한 가드), 퇴직자는 `active=false`로 잔류하되 피커·디렉터리에서 제외. title은 계속 AD에서 후속 패스로.
- **한글 부서명 소스가 dept_info → departments.name_ko**: HR 미러에서 자동. 수동 JSON 임포트 2종은 API째 삭제(호출 시 404).
- **승인자 피커 Manager 태그**: 내 부서 체인(리프→루트)의 노출 직책(EDW FRNM) 보유자.
- **부서 권한 판정 경로**: 저장된 principal(경로 문자열)은 그대로, 직원의 소속 경로 해석만 departments 부모 체인 기준으로 바뀐다. 고아 경로는 dept-remap 콘솔에서 이관.

---

## 2. 사전 준비

**최초 1회 항목은 [`setup-once.md`](setup-once.md)에 있다** — Keycloak `:9910` redirect URI/Web origins 등록(A2) · n8n 웹훅 2종(A4) · 서브넷 분리(A7). 특히 **A2를 안 하면 로그인 자체가 안 된다.**

회차마다 하는 것:

- [ ] 서버에 dev 코드 체크아웃 — 운영 코드와 **다른 디렉터리**(기존 `~/bpm-dev` 재사용):
  ```bash
  cd ~/bpm-dev && git fetch && git checkout origin/dev
  git log --oneline -3
  ```
- [ ] `.env.9910` 작성 — 운영 `.env` 복사 + 포트 변경 + 이번 회차 신규 env:
  ```bash
  cp /path/to/운영/.env .env.9910
  # 수정: APP_PORT=9910
  # 검증 중에는 HR_SYNC_INTERVAL_HOURS=0 (스케줄러 OFF, 수동 sync로만 진행)
  ```
  ⚠️ compose backend에는 `env_file:`이 없다 — 신규 키는 `docker-compose.yml`의 `environment:` 블록에 매핑돼 있어야 컨테이너에 닿는다.
- [ ] 잔재 네트워크 정리:
  ```bash
  docker network rm bpm-9910_default 2>/dev/null
  ```

---

## 3. DB 복사 (운영 9900 → 검증 9910)

### 3-1. 운영 DB 덤프 (무중단, 읽기 전용)

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | grep postgres   # 운영 db 컨테이너 확인
PROD_DB=business-process-mgmt-db-1   # 실측값 — 위 명령으로 재확인

# 커스텀 포맷 덤프(-Fc). ⚠️ docker exec에 -t(TTY) 금지 — 바이너리 덤프에 CR이 섞여 아카이브가 깨진다.
docker exec "$PROD_DB" pg_dump -U processmap -d processmap -Fc > bpm-9900-$(date +%Y%m%d-%H%M).dump
ls -lh bpm-9900-*.dump   # 0바이트 아님 확인
docker run --rm -i postgres:16-alpine pg_restore --list < bpm-9900-*.dump | head -15   # 아카이브 검증
```

### 3-2. 검증 스택의 db만 먼저 기동

**순서 중요** — backend가 빈 DB에 먼저 붙으면 최신 스키마로 테이블을 만들어 버려 복원이 충돌한다. 반드시 **db 기동 → 복원 → backend 기동**.

```bash
cd ~/bpm-dev
docker compose -p bpm-9910 --env-file .env.9910 up -d db
docker compose -p bpm-9910 --env-file .env.9910 ps        # healthy 대기
```

### 3-3. 덤프 복원

```bash
DEV_DB=$(docker compose -p bpm-9910 --env-file .env.9910 ps -q db)
cat bpm-9900-*.dump | docker exec -i "$DEV_DB" pg_restore -U processmap -d processmap \
  --no-owner --clean --if-exists
docker exec -i "$DEV_DB" psql -U processmap -d processmap -c "SELECT count(*) FROM process_maps;"
```

### 3-4. 전체 스택 기동 = 마이그레이션 실행

```bash
docker compose -p bpm-9910 --env-file .env.9910 up -d --build     # 최초 수 분
docker compose -p bpm-9910 --env-file .env.9910 logs backend | head -80
curl -s http://localhost:9910/api/health                          # {"status":"ok"}
```

**⚠️ 여기가 첫 관문이다 — backend가 실제로 떴는지부터 본다.**

```bash
docker compose -p bpm-9910 --env-file .env.9910 ps        # backend가 restarting/exited면 아래 §9
```

로그에서 확인할 것(각 1회, 멱등이라 재기동 시엔 안 나옴):
- [ ] `ALTER TABLE` × §1 표의 신규 컬럼 수
- [ ] 비치명 부트스트랩 스텝(email NOT NULL 완화 등) 통과 — 실패해도 기동은 계속되므로 로그를 직접 볼 것

---

## 4. 마이그레이션 결과 검증

### 4-1. 스키마

```bash
docker exec -i "$DEV_DB" psql -U processmap -d processmap -c "\d process_categories" | grep linkage_map_id
docker exec -i "$DEV_DB" psql -U processmap -d processmap -c "\d map_versions" | grep -E "fw_major|fw_minor"
docker exec -i "$DEV_DB" psql -U processmap -d processmap -c "\d nodes" | grep -E "placeholder_category_id|width"
docker exec -i "$DEV_DB" psql -U processmap -d processmap -c "\dt" | grep category_permissions
# 이전 회차분도 함께 확인(운영이 오래된 경우)
docker exec -i "$DEV_DB" psql -U processmap -d processmap -c "\d employees" | grep -E "dept_code|position|email"
# 기대: dept_code·position 존재, email에 NOT NULL 표기 없음(nullable)
```

`dept_info` 테이블은 코드가 더 이상 쓰지 않지만 **남아 있는 게 정상**이다(롤백 대비, 드랍하지 않음).

### 4-2. 데이터 보존 — 운영과 행수 비교

```bash
Q="SELECT (SELECT count(*) FROM process_maps)  AS maps,
          (SELECT count(*) FROM map_versions)  AS versions,
          (SELECT count(*) FROM nodes)         AS nodes,
          (SELECT count(*) FROM edges)         AS edges,
          (SELECT count(*) FROM notifications) AS notifications,
          (SELECT count(*) FROM employees)     AS employees;"
docker exec -i "$PROD_DB" psql -U processmap -d processmap -c "$Q"
docker exec -i "$DEV_DB"  psql -U processmap -d processmap -c "$Q"
```

이 시점(첫 sync 전)의 employees 수를 적어둘 것 — §6 sync 후 비교 기준.

---

## 5. 로그인 확인

스모크에 들어가기 전에 로그인부터 뚫는다. 실패 양상이 헷갈리기로 유명한 구간이다.

```bash
curl -s http://localhost:9910/api/auth/mode; echo
```

기대: `{"mode":"keycloak","keycloakIssuer":"http://.../realms/ai-portal","keycloakClientId":"bpm-frontend"}`

| 응답 | 원인 |
|---|---|
| 연결 실패 / 502 | backend가 안 떴다 → §9 |
| `keycloakClientId`가 빈 문자열 | `.env.9910`에 `KEYCLOAK_CLIENT_ID` 누락. compose 기본값이 빈 문자열이라 **에러 없이 조용히** 빈 값이 들어간다 |
| 정상 JSON인데 브라우저에서 리다이렉트 실패 | Keycloak에 `:9910` origin 미등록 → [`setup-once.md`](setup-once.md) A2 |
| `"mode":"ldap"` | ID/PW 폼이 뜬다. `employees` 행이 없는 계정은 AD 비번이 맞아도 401 |

> **"로그인 버튼이 무반응"은 인증 설정 문제가 아닐 수 있다.** 프론트의 인증 모드 조회는 fail-closed라, backend가 죽어 `/api/auth/mode`가 무응답이면 에러를 띄우지 않고 빈 issuer/client_id의 Keycloak 카드를 그린다 — 버튼이 죽은 것처럼 보인다. **인증을 뒤지기 전에 컨테이너 상태부터 확인**할 것(2026-08-31 실사고).

---

## 6. HR 웹훅 이행 리허설

9910은 운영 DB 복사본이라 **실 HR sync를 돌려도 운영 무영향** — 이행 절차를 여기서 그대로 리허설하는 것이 이 검증의 핵심이다. sysadmin 계정으로 `http://<서버IP>:9910` 로그인 후 진행. 스케줄러는 `.env.9910`에서 `HR_SYNC_INTERVAL_HOURS=0`으로 꺼져 있어야 한다.

### 6-1. 드라이런 (DB 무변경)

설정 → Employees 탭 → **sync-preview** 버튼(curl로 하려면 세션 토큰이 필요해 화면 사용을 권장).

판정 기준 — 전부 기록해둘 것, 운영 승격 때 같은 값이어야 한다:

- [ ] `case_mismatches` == **0** — 아니면 **여기서 중단**. HR loginId 표기가 기존과 다르면 실 sync가 신규행 생성 + 구행 삭제로 권한·승인자 참조를 고아로 만든다. n8n/HR 측 표기 협의 후 재시도.
- [ ] `would_delete`·`delete_login_ids` 샘플이 "AD 전용 시스템 계정·퇴사자"로 설명되는지. 뜻밖의 재직자가 있으면 중단.
- [ ] `scanned` ≈ 6000(전수), `skipped` 소수.
- [ ] `org_mismatches`·`truncated_levels` 규모 — 동작엔 무해, 실데이터 품질 기록.
- [ ] `korean_overwrites` — 수동 임포트 한글명이 HR nameKo로 덮이는 행 수(의도된 동작).
- [ ] `orphan_dept_paths` — 이행 후 고아가 될 부서 principal 경로(§6-4 이관 대상).

### 6-2. 첫 수동 sync

설정 → Employees 탭 → **Sync**. 503이면 `.env.9910`의 URL/토큰 확인.

| 필드 | 기대 |
|---|---|
| `scanned` / `upserted` | 프리뷰와 동일 규모 |
| `deleted` | 프리뷰 `would_delete`와 일치. 20% 상한 초과 시 `aborted_reason`으로 전체 중단(DB 무변경) |
| `deactivated` | 활성→비활성 전환 수(reconcile 수행됨) |
| `departments_upserted` | HR 조직도 미러 행 수 — **0이면 경로 해석·한글명이 전부 폴백**이니 원인 확인 |
| `title_refreshed` | AD title 패스 갱신 수(LDAP 정상 연결 증거) |
| `position_refreshed` / `position_unmatched` | §7에서 해석 |
| `aborted_reason` | null이어야 함 |

### 6-3. 결과 확인

```bash
docker exec -i "$DEV_DB" psql -U processmap -d processmap -c \
  "SELECT source, active, count(*) FROM employees GROUP BY 1,2 ORDER BY 1,2;"
# 기대: source='hr'가 대부분, inactive 행 잔류(삭제 아님), 'ad' 잔존 0
docker exec -i "$DEV_DB" psql -U processmap -d processmap -c "SELECT count(*) FROM departments;"
```

- [ ] 화면: 피커·디렉터리에 **퇴직자(inactive)가 안 보이는지**, 부서 한글명이 `departments.name_ko`로 나오는지.
- [ ] `/api/me` 정상(본인 이름·부서·org_path).

### 6-4. 고아 부서 경로 이관

설정 → Departments 탭 — **소멸 부서 재지정 섹션이 테이블 위**에 뜬다. §6-1의 `orphan_dept_paths`에 있던 경로가 보이면 새 조직 경로로 재지정(맵 권한·그룹 멤버 일괄 이동). 고아가 없으면 섹션 자체가 안 뜨는 게 정상.

---

## 7. EDW 직책 검증

### 7-1. sync 요약의 position 필드

- [ ] `position_refreshed` > 0 — EDW 목록이 `employees.position`에 반영됨.
- [ ] `position_unmatched`가 크면(목록 대비 수십% 이상) **사번 표기 불일치부터 의심**: EDW `empId`의 zero-padding(`00100`)과 AD `employeeNumber`(`100`)가 다르면 전량 미매칭이다. 코드 정규화가 필요하니 값 샘플과 함께 보고할 것.

```bash
docker exec -i "$DEV_DB" psql -U processmap -d processmap -c \
  "SELECT position, count(*) FROM employees WHERE position IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;"
```

### 7-2. 노출 직책 카드

설정 → Employees 탭 상단 **Exposed positions**:
- [ ] 수집된 직책 목록(available)이 뜨고 기본 4종(그룹장·파트장·팀장·센터장)이 체크 상태.
- [ ] 실데이터의 다른 부서장급 직책(실장·담당 등)이 보이면 노출 여부 판단 후 체크 → Save.
- [ ] 저장 후 새로고침해도 유지.

### 7-3. Manager 태그·직책 병기

- [ ] 일반 직원 계정으로 맵 설정 → 승인자 피커 브라우즈: **내 부서 체인의 부서장들이 최상단 + Manager 배지**.
- [ ] 멤버 카드(호버)·맵 상세 멤버 행에서 부서장 title 옆에 직책 병기(`Principal · 팀장`).
- [ ] 부서장이 아닌 일반 직원에겐 병기 없음(백엔드 allowlist 필터).

---

## 8. 화면 검증 — 묶음별 스모크

기본 스모크(맵 목록·에디터 로드·저장·버전 비교) + 이번 회차 추가분. 상세 항목 원본: [`docs/qa/dev-vs-main-checklist.md`](../qa/dev-vs-main-checklist.md) — 통과한 체크박스는 그 문서에서 소거.

- [ ] **운영 데이터 보존**: §4-2 행수와 화면(맵·버전·알림) 대조. 검증 중 만든 데이터는 복사본에만 남는다.
- [ ] **L5 연계 캔버스**(이번 회차): 홈 Framework 트리의 L5 행에서 연계 캔버스 진입 → 소속 L6 잠금·분기/끝 노드 허용·확정 게이트 → 확정 시 `fw_major`/`fw_minor` 채번, 메이저 승급 시 프룬 모달. 플레이스홀더 SP(미등록 링크)에 출처 L5 배지가 뜨는지. 카테고리 권한자 관리 모달(sysadmin)에서 부여한 권한이 하위 카테고리로 상속되는지.
- [ ] **컨설턴트 체계 임포트**: 설정 → Framework 탭 → Interview import(sysadmin) — L5 단위 JSON 다중 선택 → Dry-run(파일별 error/warning/unknown key 리포트) → Apply. 같은 파일 재실행 시 전부 `unchanged`(멱등). 합성 샘플은 `docs/samples/consultant-interview-sample/`. owner/department가 null이면 실행자 폴백 + 오우닝 NULL(pending).
- [ ] **필드 승격 백필**: 기존 임포트 맵은 같은 파일 재임포트 1회로 승격 필드가 채워진다 → [`setup-once.md`](setup-once.md) B3. **⚠️ FE/BE 동시 배포 필수** — 구 FE의 graph PUT이 승격 필드를 소거한다.
- [ ] **기존 SP 링크·권한**: 기존 맵의 부서 권한이 그대로 동작(경로 문자열 principal 무변경 — 판정만 체인 해석), SP 임베드 정상.
- [ ] **묶음 삭제**(Postgres 전용 회귀): 카테고리 3레벨 묶음 삭제가 500 없이 통과. sqlite는 FK를 강제하지 않아 로컬에선 재현되지 않는 구간이다.

---

## 9. 트러블슈팅 — backend가 안 뜰 때

`docker compose -p bpm-9910 --env-file .env.9910 logs backend | head -80`을 먼저 본다.

| 로그 | 원인 |
|---|---|
| `SyntaxError` (import 단계) | **로컬 파이썬이 배포 런타임보다 높아 상위 문법이 섞여 들어간 경우.** 배포 이미지는 `python:3.11-slim`이다 — 로컬 3.12+에서 짠 PEP 695 제네릭(`def f[T]()`) 등이 여기서 죽는다. `backend/ruff.toml`의 `target-version = "py311"`이 린트에서 잡도록 걸어뒀으니, 재발 시 로컬에서 `ruff check app/ tests/` 먼저. (2026-08-31 실사고 — [`setup-once.md`](setup-once.md) 참조) |
| `AUTH_MODE=ldap requires AUTH_JWT_SECRET to be set` | `.env.9910`에 서명키 누락. `openssl rand -hex 32` |
| `column ... does not exist` | 신규 컬럼이 `db.py`의 `_ADDED_COLUMNS`에 등록되지 않았다 — 코드 수정 필요 |
| `Pool overlaps with other one` | 서브넷 충돌 → [`setup-once.md`](setup-once.md) A7 |
| db 연결 실패 | `docker compose -p bpm-9910 --env-file .env.9910 logs db`, healthcheck 통과 여부 |

---

## 10. 정리·롤백

- **9910 스택 폐기**(복사본이므로 운영 무영향):
  ```bash
  docker compose -p bpm-9910 --env-file .env.9910 down -v      # -v: 복제 DB 볼륨까지 삭제
  ```
- **복원부터 재시도**: 위 `down -v` 후 §3-2부터.
- n8n `hr-position` 워크플로는 남겨둔다(운영 승격 때 그대로 사용). 비활성화만 원하면 Activate 토글 OFF.
- 운영(9900)은 이 절차 동안 아무 변경이 없다.

---

## 11. 운영(9900) 승격 — 9910 검증 통과 + main 머지 후

**dev를 직접 운영에 올리지 않는다** — 9910 검증 통과 → dev→main 머지·푸시 → 운영은 main으로. 직전 백업 덤프가 유일한 롤백 수단이니 반드시 먼저 뜬다.

```bash
# 운영 디렉터리에서
PROD_DB=business-process-mgmt-db-1
docker exec "$PROD_DB" pg_dump -U processmap -d processmap -Fc \
  > bpm-9900-before-upgrade-$(date +%Y%m%d).dump   # -t 금지

# 운영 .env에 이번 회차 신규 키 추가(9910에서 확정한 값 그대로)
git fetch && git checkout <9910에서 검증한 dev와 동일 내용의 main 커밋>
docker compose up -d --build
docker compose logs backend | head -80
curl -s http://localhost:9900/api/health
curl -s http://localhost:9900/api/auth/mode; echo
```

- §4 스키마 확인 → **§6 이행 절차를 운영에서 재수행**(드라이런으로 case 불일치 0 재확인 → 첫 수동 sync → §6-4 dept-remap 이관 → §7-2 노출 직책 확정) → `.env`의 `HR_SYNC_INTERVAL_HOURS=24` + backend 재기동으로 스케줄러 ON.
- **롤백**: additive+완화 스키마라 코드만 되돌리면 된다(`git checkout <직전 main> && docker compose up -d --build`). 데이터까지 되돌릴 일이 생기면 백업 덤프로 §3-3 방식 복원.
- 승격 후: 공지·매뉴얼 갱신 여부 판단(설정 → 콘텐츠).

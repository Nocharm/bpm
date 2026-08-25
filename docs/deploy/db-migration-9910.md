# DB 마이그레이션 & 9910 검증 스택 가이드 (8월 업데이트 — HR 웹훅·EDW 직책 포함)

운영 스택(포트 **9900**, main 계열 커밋 시점)의 DB를 **복사**해서, **dev**(`60ba560` 조직 기준 전환 머지, 문서 커밋 `c9108cd`)를 포트 **9910**에 별도 스택으로 띄워 마이그레이션·기능을 검증하는 절차. 검증이 끝나면 dev→main 머지 후 운영(9900)을 같은 방식으로 승격한다. **운영 스택과 볼륨은 일절 건드리지 않는다**(덤프 읽기만).

이번 회차 특이점: 코드 변경 외에 **외부 연동 2종(n8n HR 웹훅·EDW 직책 웹훅)의 이행 리허설**이 포함된다. 9910은 운영 DB 복사본이므로 **실 HR sync를 돌려도 운영 무영향** — HR 설계 §9 이행 절차와 조직 기준 전환 §7을 여기서 그대로 리허설하는 것이 이 검증의 핵심이다. 묶음별 확인 항목 원본: [`docs/qa/dev-vs-main-checklist.md`](../qa/dev-vs-main-checklist.md).

전례: 컨테이너명·compose 병합 함정 등 서버 실측값은 1·2차 때 확인값 그대로(상세는 git history `db-migration-9800.md`).

---

## 1. 스키마 변경 요약 — 운영(main) → dev `60ba560`

| 구분 | 대상 | 내용 | 적용 방식 |
|------|------|------|-----------|
| 신규 테이블 | `process_categories` | 컨설턴트 L1~L5 카테고리 트리 (design 2026-08-08) | 기동 시 `create_all` |
| 신규 테이블 | `departments` | HR 조직도 미러 — dept_code 계층·영문/한글명 (design 2026-08-10 §3) | 기동 시 `create_all` |
| 신규 컬럼 | `process_maps.category_id` INTEGER · `consultant_code` VARCHAR(200) · `sp_input` TEXT · `sp_output` TEXT | 컨설턴트 체계 연결·SP I/O | 자동 ALTER (`_ADDED_COLUMNS`) |
| 신규 컬럼 | `employees.dept_code` VARCHAR(100) | HR deptCode (design 2026-08-10) | 자동 ALTER |
| 신규 컬럼 | `employees.position` VARCHAR(100) | EDW 부서장 직책(FRNM) — AD employeeNumber 매핑 (설계 2026-08-11 §4) | 자동 ALTER |
| **완화** | `employees.email` **NOT NULL → NULL 허용** | email 모델 제거 후속 — 완화 없이는 신규 INSERT 즉사 | 비치명 부트스트랩 `_relax_employees_email_not_null` (postgres 전용, 멱등) |
| 잔류 | `dept_info` 테이블 | **코드에서 소비 0이 됐지만 물리 드랍하지 않는다**(롤백 대비) | 무변경 |
| 값 추가 | `employees.source` = `'hr'` · `app_settings` 키 `exposed_positions` | HR 관리 행 표시·노출 직책 allowlist | DDL 없음 |

### 마이그레이션 메커니즘 — 별도 DDL 스크립트 불필요 (기존 문서와 동일)

backend 기동 시 `app/db.py::init_models()`가 멱등 실행: `create_all`(신규 테이블 2) → `_add_missing_columns()`(컬럼 6) → `_add_missing_indexes()` → 부트스트랩 스텝(이번엔 email NOT NULL 완화 포함). **덤프를 복원한 DB 위에 dev backend를 1회 기동하는 것이 곧 마이그레이션**이다. 전부 additive/완화라 구버전 코드도 같은 DB에서 동작 — 롤백은 구버전 컨테이너 재기동이면 충분.

### 데이터 의미 변화 (DDL 아님 — 검증 시 체감 포인트)

- **employees 단일 소스가 AD LDAP → HR 웹훅**: sync 실행 시 기존 `source='ad'` 행이 `'hr'`로 전환되고, HR 피드에 없는 구 계정은 삭제(20% 상한 가드), 퇴직자는 `active=false`로 잔류하되 **피커·디렉터리에서 제외**. title은 계속 AD에서 후속 패스로.
- **한글 부서명 소스가 dept_info → departments.name_ko**: 수동 임포트 없이 HR 미러에서 자동. **JSON 임포트 2종(직원 한글명·부서정보)은 API째 삭제**(호출 시 404) — 설정 화면의 임포트 버튼도 없다.
- **승인자 피커 Manager 태그 의미**: dept_info 부서장 체인 → **내 부서 체인(리프→루트)의 노출 직책(EDW FRNM) 보유자**. 노출 직책은 설정 Employees 탭에서 sysadmin이 선택(기본: 그룹장·파트장·팀장·센터장).
- **부서 권한 판정 경로**: 저장된 principal(경로 문자열)은 그대로 두고, 직원의 소속 경로 해석이 departments 부모 체인 기준으로 바뀐다(HR 미러가 빈 동안은 기존 org 컬럼 폴백 = 현행 동일). 조직 표기 차이로 생기는 고아 경로는 dept-remap 콘솔(부서관리 탭 상단으로 이동됨)에서 이관.

---

## 2. 사전 준비

- [ ] 서버에 dev 코드 체크아웃 — 운영 코드와 **다른 디렉터리**(기존 `~/bpm-dev` 재사용):
  ```bash
  cd ~/bpm-dev && git fetch && git checkout origin/dev
  git log --oneline -3    # 60ba560(조직 기준 전환 머지)·c9108cd가 보여야 한다
  ```
- [ ] `.env.9910` 작성 — 운영 `.env` 복사 + 포트 변경 + **이번 회차 신규 env 5종 추가**:
  ```bash
  cp /path/to/운영/.env .env.9910
  # 수정 1줄:
  #   APP_PORT=9910
  # 추가 5줄 (§3에서 실URL 확정 후 기입):
  #   N8N_HR_URL=http://182.199.63.71:5678/webhook/hr-dept     # §3-1에서 철자(webhook/webhoop) 실측 확정
  #   N8N_HR_TOKEN=<X-API-Key 시크릿>                           # 커밋 금지
  #   N8N_POSITION_URL=http://182.199.63.71:5678/webhook/hr-position
  #   HR_SYNC_INTERVAL_HOURS=0                                 # ⚠️ 검증 중 스케줄러 OFF — 수동 sync로만 진행
  #   HR_SYNC_DELETE_CAP_PCT=20
  # 나머지(POSTGRES_*, KEYCLOAK_*, LDAP_* …)는 운영과 동일.
  ```
  ⚠️ compose backend에는 `env_file:`이 없다 — 위 5종은 `docker-compose.yml` `environment:` 블록에 이미 매핑돼 있으니(60ba560 반영) `.env` 키 이름만 정확하면 된다.
- [ ] **Keycloak 리다이렉트 허용** — realm `ai-portal` 클라이언트에 9910 origin이 없으면 로그인 불가: Valid redirect URIs `http://<서버IP>:9910/*`, Web origins `http://<서버IP>:9910` (이미 있으면 생략, 화면 위치는 `deploy.md` §1).
- [ ] **서브넷 분리** — 사내 71번 compose는 오버라이드 병합 누적(실측) → dev 클론 `docker-compose.yml` 맨 아래 서브넷을 운영(172.36)·과거 스택과 안 겹치게 `172.43.0.0/16` / `172.43.0.1`로 수정.
- [ ] alias:
  ```bash
  alias dc910='docker compose -p bpm-9910 --env-file .env.9910'
  docker network rm bpm-9910_default 2>/dev/null   # 잔재 정리
  ```
- [ ] 디스크 여유 확인(덤프+복제 볼륨).

---

## 3. n8n 준비 (이번 회차 신설 — DB 복사 전에 끝내둔다)

### 3-1. 기존 hr-dept 워크플로 확인 + URL 철자 확정

이미 연결 확인된 워크플로. 백엔드가 쓸 **정확한 URL 철자**(계약서 표기가 `webhoop`였음 — 오타 여부)를 실측으로 확정한다:

```bash
TOKEN='<X-API-Key 값>'
# 후보 URL로 직접 호출 — 200 + {"kind":"employees","count":...} 나오는 쪽이 정답
curl -s -X POST http://182.199.63.71:5678/webhook/hr-dept \
  -H "X-API-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"employees","loginId":"<본인 loginId>"}' | head -c 300
```

확정된 URL을 `.env.9910`의 `N8N_HR_URL`에 기입. (단건 조회라 부하 없음. 전수 `status:all`은 §6에서 백엔드 경유로.)

### 3-2. hr-position 워크플로 임포트 (EDW 부서장 목록)

워크플로 정의 파일이 저장소에 있다: [`docs/deploy/n8n/hr-position-workflow.json`](n8n/hr-position-workflow.json)

1. n8n UI → **Workflows → ⋯ → Import from File** → 위 JSON 선택 → 새 워크플로 "HR Position (EDW dept leaders)" 생성.
2. 노드별 지정(딱 2곳):
   - **Webhook 노드** → Credential: 기존 hr-dept 워크플로가 쓰는 **X-API-Key 헤더 자격증명과 동일한 것** 선택 (토큰 공용 — 백엔드도 `N8N_HR_TOKEN` 하나로 두 웹훅을 호출한다).
   - **EDW Leaders(MSSQL) 노드** → Credential: EDW MSSQL 커넥션 선택.
3. 쿼리 확인 — 뷰명은 `dbo.VW_HR_EMP_CENTER_MAPPING`으로 이미 반영돼 있다. 쿼리 계약:
   - `DT = (SELECT MAX(DT) ... WHERE DT <= 오늘 YYYYMMDD)` — 스냅샷 지연 시 자동으로 직전 일자분.
   - `FRNM` 트림 후 `'프로'`·빈값 제외 → **응답 rows는 이미 부서장 후보만**.
4. 노드 테스트: MSSQL 노드 단독 실행(Execute step) → 행이 나오는지, `DT`/`DEPTCD`/`EMPID`/`FRNM` 컬럼이 맞는지 확인(부서코드 컬럼은 **DEPTCD**, `NAME`은 n8n 마스킹으로 무의미해 쿼리 제외 — 9910 실측 확정). 제외 직책 필터: `프로·담당과장·계약직사원·담당임원`. 컬럼명이 다르면 여기서 멈추고 쿼리 수정(저장소 JSON에도 반영 요청).
5. **Activate** 토글 ON (프로덕션 webhook URL 활성 — `/webhook/hr-position`).
6. 스모크:
   ```bash
   curl -s -X POST http://182.199.63.71:5678/webhook/hr-position \
     -H "X-API-Key: $TOKEN" -H "Content-Type: application/json" -d '{}' | head -c 400
   # 기대: {"kind":"positions","dt":"20260811","count":N,"rows":[{"empId":"...","deptCode":"...","name":"...","position":"팀장"},...]}
   ```
   - [ ] `count`가 그럴듯한 규모(부서 수 안팎)인지
   - [ ] `position` 값들에 '프로'가 없는지, 그룹장/팀장/센터장류가 보이는지
   - [ ] `empId`가 사번 형태(예: 20150555)인지 — **zero-padding 여부 기록**(§7-3에서 대조)
7. 확정 URL을 `.env.9910`의 `N8N_POSITION_URL`에 기입.

---

## 4. DB 복사 (운영 9900 → 검증 9910)

### 4-1. 운영 DB 덤프 (무중단, 읽기 전용)

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | grep postgres   # 운영 db 컨테이너 확인
PROD_DB=business-process-mgmt-db-1   # 실측값 — 위 명령으로 재확인

# 커스텀 포맷 덤프(-Fc). ⚠️ docker exec에 -t(TTY) 금지 — 바이너리 덤프에 CR이 섞여 아카이브가 깨진다.
docker exec "$PROD_DB" pg_dump -U processmap -d processmap -Fc > bpm-9900-$(date +%Y%m%d-%H%M).dump
ls -lh bpm-9900-*.dump   # 0바이트 아님 확인
docker run --rm -i postgres:16-alpine pg_restore --list < bpm-9900-*.dump | head -15   # 아카이브 검증
```

### 4-2. 검증 스택의 db만 먼저 기동

**순서 중요** — backend가 빈 DB에 먼저 붙으면 최신 스키마로 테이블을 만들어 버린다. 반드시 **db 기동 → 복원 → backend 기동**.

```bash
cd ~/bpm-dev
dc910 up -d db
dc910 ps            # healthy 대기
```

### 4-3. 덤프 복원

```bash
DEV_DB=$(dc910 ps -q db)
cat bpm-9900-*.dump | docker exec -i "$DEV_DB" pg_restore -U processmap -d processmap --no-owner --clean --if-exists
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "SELECT count(*) FROM process_maps;"
```

### 4-4. 전체 스택 기동 = 마이그레이션 실행

```bash
dc910 up -d --build             # 최초 수 분
dc910 logs backend | head -80
curl -s http://localhost:9910/api/health   # {"status":"ok"}
```

로그에서 확인할 것(각 1회, 멱등이라 재기동 시엔 안 나옴):
- [ ] `ALTER TABLE` × 6 — process_maps 4컬럼(category_id·consultant_code·sp_input·sp_output) + employees 2컬럼(dept_code·position)
- [ ] **email NOT NULL 완화** 스텝 통과(에러 없이) — 실패했으면 §5-1 psql로 nullable 직접 확인

---

## 5. 마이그레이션 결과 검증

### 5-1. 스키마

```bash
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "\d employees" | grep -E "dept_code|position|email"
# 기대: dept_code·position 존재, email이 NOT NULL 표기 없음(nullable)
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "\d process_maps" | grep -E "category_id|consultant_code|sp_input|sp_output"
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "\dt" | grep -E "departments|process_categories|dept_info"
# 기대: departments·process_categories 신규 존재, dept_info도 여전히 존재(잔류가 정상)
```

### 5-2. 데이터 보존 — 운영과 행수 비교

```bash
Q="SELECT (SELECT count(*) FROM process_maps)  AS maps,
          (SELECT count(*) FROM map_versions)  AS versions,
          (SELECT count(*) FROM nodes)         AS nodes,
          (SELECT count(*) FROM edges)         AS edges,
          (SELECT count(*) FROM notifications) AS notifications,
          (SELECT count(*) FROM employees)     AS employees;"
docker exec -it "$PROD_DB" psql -U processmap -d processmap -c "$Q"
docker exec -it "$DEV_DB"  psql -U processmap -d processmap -c "$Q"
```

이 시점(첫 sync 전)의 employees 수를 적어둘 것 — §6-3 sync 후 비교 기준.

---

## 6. HR 웹훅 이행 리허설 (HR 설계 §9 절차를 복사본에서 그대로)

전 단계는 sysadmin 계정으로 http://<서버IP>:9910 로그인 후 진행. 스케줄러는 `.env.9910`에서 0으로 꺼져 있어야 한다.

### 6-1. 드라이런 (DB 무변경)

```bash
# 브라우저 대신 curl로 할 경우 세션 토큰 필요 — 설정 화면의 sync-preview 버튼 사용을 권장.
curl -s -X POST http://localhost:9910/api/employees/sync-preview -H "Authorization: Bearer <token>" | python3 -m json.tool
```

판정 기준(전부 기록해둘 것 — 운영 승격 때 같은 값이어야 한다):
- [ ] `case_mismatches` == **0** — 아니면 **여기서 중단**. HR loginId 표기가 기존과 달라 실 sync 시 신규행 생성+구행 삭제로 권한·승인자 참조가 고아가 된다. n8n/HR 측 표기 협의 후 재시도.
- [ ] `would_delete`·`delete_login_ids` 샘플 — 삭제 대상이 "AD 전용 시스템 계정·퇴사자"로 설명되는지. 뜻밖의 재직자가 있으면 중단·원인 파악.
- [ ] `scanned` ≈ 6000(전수), `skipped` 소수인지.
- [ ] `org_mismatches`(department≠org 리프)·`truncated_levels`(6레벨 초과) 규모 — 동작엔 무해, 실데이터 품질 기록.
- [ ] `korean_overwrites` — 수동 임포트해둔 한글명과 HR nameKo가 다른 행 수(HR 값으로 덮이는 게 의도).
- [ ] `orphan_dept_paths` — 이행 후 고아가 될 부서 principal 경로 목록(§6-4에서 dept-remap으로 이관할 대상).

### 6-2. 첫 수동 sync

설정 → Employees 탭 → **Sync** 버튼 (또는 `POST /api/employees/sync`). 실패(503)면 `.env.9910`의 URL/토큰 확인.

요약 필드 해석:

| 필드 | 기대 |
|---|---|
| `scanned` / `upserted` | 프리뷰와 동일 규모 |
| `deleted` | 프리뷰 `would_delete`와 일치. 20% 상한 초과 시 `aborted_reason`으로 전체 중단(DB 무변경)됨 |
| `deactivated` | 활성→비활성 전환 수 (reconcile 수행됨) |
| `departments_upserted` | HR 조직도 미러 행 수 — **0이면 §7의 경로 해석·한글명이 전부 폴백으로 동작**하니 원인 확인 |
| `title_refreshed` | AD title 패스 갱신 수(LDAP 정상 연결 증거) |
| `position_refreshed` / `position_unmatched` | §7에서 해석 |
| `aborted_reason` | null이어야 함 |

### 6-3. 결과 확인

```bash
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c \
  "SELECT source, active, count(*) FROM employees GROUP BY 1,2 ORDER BY 1,2;"
# 기대: source='hr'가 대부분, inactive 행 잔류(삭제 아님), 'ad' 잔존 0
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c \
  "SELECT count(*) FROM departments;"
```

- [ ] 화면: 피커·디렉터리에 **퇴직자(inactive)가 안 보이는지**, 부서 한글명이 departments.name_ko로 나오는지(수동 임포트 없이).
- [ ] `/api/me` 정상(본인 이름·부서·org_path).

### 6-4. 고아 부서 경로 이관

설정 → Departments 탭 — **소멸 부서 재지정 섹션이 테이블 위**에 뜬다(이번 리디자인). §6-1의 `orphan_dept_paths`에 있던 경로들이 여기 보이면 새 조직 경로로 재지정(맵 권한·그룹 멤버 일괄 이동). 고아가 없으면 섹션 자체가 안 뜨는 게 정상.

---

## 7. EDW 직책 검증 (조직 기준 전환 §7)

### 7-1. sync 요약의 position 필드

§6-2 요약에서:
- [ ] `position_refreshed` > 0 — EDW 목록이 employees.position에 반영됨.
- [ ] `position_unmatched` — **크면(목록 대비 수십% 이상) 사번 표기 불일치부터 의심**: §3-2-6에서 기록한 EDW `empId`의 zero-padding(예: `00100`)과 AD `employeeNumber`(예: `100`)가 다르면 전량 미매칭이 된다. 이 경우 코드 정규화(`lstrip("0")` 후보)가 필요하니 값 샘플과 함께 보고.
  ```bash
  docker exec -it "$DEV_DB" psql -U processmap -d processmap -c \
    "SELECT position, count(*) FROM employees WHERE position IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;"
  ```

### 7-2. 노출 직책 설정 카드

설정 → Employees 탭 상단 **Exposed positions 카드**:
- [ ] 수집된 직책 목록(available)이 뜨고 기본 4종(그룹장·파트장·팀장·센터장)이 체크 상태.
- [ ] 실데이터에 있는 다른 부서장급 직책(실장·담당 등)이 목록에 보이면 노출 여부 판단 후 체크 → Save.
- [ ] 저장 후 새로고침해도 유지.

### 7-3. Manager 태그·직책 병기

- [ ] 일반 직원 계정(또는 devUser 전환)으로 맵 설정 → 승인자 피커 브라우즈: **내 부서 체인의 부서장들이 최상단 + Manager 배지**.
- [ ] 멤버 카드(호버)·맵 상세 멤버 행에서 부서장의 title 옆에 직책 병기(`Principal · 팀장` 형태).
- [ ] 부서장이 아닌 일반 직원에겐 병기 없음(백엔드가 allowlist 필터).

---

## 8. 화면 검증 — 묶음별 스모크

기본 스모크(맵 목록·에디터 로드·저장·버전 비교) + 이번 회차 추가분. 상세 항목 원본: [`docs/qa/dev-vs-main-checklist.md`](../qa/dev-vs-main-checklist.md) — 통과한 체크박스는 그 문서에서 소거.

- [ ] **운영 데이터 보존**: §5-2 행수와 화면(맵·버전·알림) 대조. 검증 중 만든 데이터는 복사본에만 남는다.
- [ ] **부서관리 재배치**: Departments 탭 — Manager 열 없음, 테이블 자체 스크롤(60vh), 인원수 호버 툴팁이 하단 행에서도 잘리지 않음(포털 픽스).
- [ ] **임포트 버튼 부재**: Employees 탭 한글명 임포트·Departments 탭 부서정보 추가 버튼이 없어야 함(API도 404).
- [ ] **컨설턴트 체계**: 임포트를 먼저 해야 Framework 표면에 데이터가 보인다. **경로는 인터뷰 임포트 단일 — 설정 → Framework 탭 → Interview import**(sysadmin): L5 단위 인터뷰 JSON 다중 선택 → Dry-run(파일별 키 검증 리포트: error/warning/unknown key) → Apply. 합성 샘플은 `docs/samples/consultant-interview-sample/`. owner/department가 null이면 실행자 폴백+오우닝 NULL(pending — 추후 실오너 전달 시 자동 갱신). 이후 같은 탭에서 카테고리 관리(생성·개명·이동·삭제), 홈 Framework 토글 → 트리 lazy 로드, 상세 카드 경로 pill·I/O·Notes(예외/VOC), 같은 파일 Dry-run 재실행 시 전부 `unchanged`(멱등) 확인. (구 canonical 웹 임포트·CLI는 2026-08-18 제거 — 설계: [`2026-08-18-interview-import-design.md`](../design/2026-08-18-interview-import-design.md).) **필드 승격 릴리스(2026-08-20) 이후 배포라면**: 신규 컬럼 16개(nodes 7·process_maps 9)는 자동 ALTER, 기존 임포트 맵은 **같은 파일 재임포트 1회**로 승격 필드가 백필된다(새 버전 게시 — [Interview] 축소·노드 KV 축소·exception rose 색 포함). GMP 분류는 맵 설정 → 상세 → 조건 · GMP 카드에서 선정(재전달에도 유지). ⚠️ backend만 새 버전으로 배포하고 frontend를 구버전으로 두면 에디터 저장이 승격 필드를 소거한다 — 반드시 FE/BE 동시 배포.
- [ ] **기존 SP 링크·권한**: 기존 맵의 부서 권한이 그대로 동작(경로 문자열 principal 무변경 — 판정만 체인 해석), SP 임베드 정상.

---

## 9. 정리·롤백

- **9910 스택 폐기**(복사본이므로 운영 무영향):
  ```bash
  dc910 down -v      # -v: 복제 DB 볼륨까지 삭제
  ```
- **복원부터 재시도**: `dc910 down -v` 후 §4-2부터.
- n8n hr-position 워크플로는 남겨둔다(운영 승격 때 그대로 사용). 비활성화만 원하면 Activate 토글 OFF.
- 운영(9900)은 이 절차 동안 아무 변경이 없다.

## 10. 운영(9900) 승격 — 9910 검증 통과 + main 머지 후

**dev를 직접 운영에 올리지 않는다** — 9910 검증 통과 → dev→main 머지·푸시 → 운영은 main으로. 직전 백업 덤프가 유일한 롤백 수단이니 반드시 먼저.

```bash
# 운영 디렉터리에서
PROD_DB=business-process-mgmt-db-1
docker exec "$PROD_DB" pg_dump -U processmap -d processmap -Fc > bpm-9900-before-upgrade-$(date +%Y%m%d).dump   # -t 금지

# 운영 .env에 §2의 신규 5종 추가 — N8N_HR_URL/N8N_HR_TOKEN/N8N_POSITION_URL은 9910에서 확정한 값 그대로,
# HR_SYNC_INTERVAL_HOURS=0 (스케줄러는 이행 절차 후 24로)
git fetch && git checkout <9910에서 검증한 dev와 동일 내용의 main 커밋>
docker compose up -d --build
docker compose logs backend | head -80 && curl -s http://localhost:9900/api/health
```

- §5 스키마 확인(ALTER 6·email 완화) → **§6 이행 절차를 운영에서 재수행**: 드라이런(case 불일치 0 재확인) → 첫 수동 sync → §6-4 dept-remap 이관 → §7-2 노출 직책 확정 → `.env` `HR_SYNC_INTERVAL_HOURS=24` + backend 재기동(스케줄러 ON).
- **롤백**: additive+완화 스키마라 코드만 되돌리면 된다(`git checkout <직전 main> && docker compose up -d --build`). email 완화는 되돌릴 필요 없음(구코드는 email 값을 항상 넣으므로 nullable이어도 무해). 데이터까지 되돌릴 일이 생기면 백업 덤프로 §4-3 방식 복원.
- 승격 후: 공지/매뉴얼 갱신 여부 판단(설정 → 콘텐츠).

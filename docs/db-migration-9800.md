# DB 마이그레이션 & 9800 검증 스택 가이드

운영 스택(포트 **9900**, 커밋 `406c375b` 시점 스키마)의 DB를 **복사**해서, **최신 origin/main**
(이 문서 기준 2026-07-06 — 매뉴얼 다중 문서·MANUAL_URL·서브프로세스 지정 포함) 코드를
포트 **9800**에 별도 스택으로 띄워 마이그레이션·기능을 검증하는 절차. 검증이 끝나면 운영(9900)을
같은 방식으로 승격한다. **운영 스택과 볼륨은 일절 건드리지 않는다**(덤프 읽기만).

관련 문서: 배포 런북 `docs/deploy.md` · 서브프로세스 지정 기능 `SUBPROCESS-DESIGNATION.md`

---

## 1. 스키마 변경 요약 — `406c375b` → 최신 `origin/main`

| 구분 | 대상 | 내용 | 적용 방식 |
|------|------|------|-----------|
| 신규 테이블 | `feedback` | 사용자 피드백(유형·본문·상태·답글) | `create_all` 자동 생성 |
| 신규 테이블 | `notices` | 공지사항(마크다운·중요도·게시기간) | `create_all` 자동 생성 |
| 신규 테이블 | `manual_docs` | 사용 매뉴얼 게시본(단일 행 upsert) | `create_all` 자동 생성 |
| 신규 테이블 | `checkout_requests` | 점유권 이전 요청/승인 플로 | `create_all` 자동 생성 |
| 신규 컬럼 | `map_versions.version_number` INTEGER | 게시 순번 — publish 시 채번, 기존 행 NULL | 기동 시 자동 ALTER |
| 신규 컬럼 | `map_versions.checked_out_from` VARCHAR(100) | 점유 이전 출처 | 기동 시 자동 ALTER |
| 신규 컬럼 | `manual_docs.title` VARCHAR(200) | 매뉴얼 다중 문서(F10) — 목록 제목(저장 시 자동 추출) | 기동 시 자동 ALTER |
| 신규 컬럼 | `manual_docs.language` VARCHAR(5) | 문서 언어(ko/en) — 레거시 행은 기본 ko로 흡수 | 기동 시 자동 ALTER |
| 신규 컬럼 | `manual_docs.sort_order` INTEGER | 목록 정렬(업로드순) | 기동 시 자동 ALTER |
| 신규 컬럼 | `process_maps.sp_designated_at` TIMESTAMP | 서브프로세스 지정 시각(NULL=미지정) | 기동 시 자동 ALTER |
| 신규 컬럼 | `process_maps.sp_department` VARCHAR(100) | 지정 어트리뷰트(부서, 지정 시 필수) | 기동 시 자동 ALTER |
| 신규 컬럼 | `process_maps.sp_assignee` VARCHAR(100) | 지정 어트리뷰트(담당자) | 기동 시 자동 ALTER |
| 신규 컬럼 | `process_maps.sp_system` VARCHAR(100) | 지정 어트리뷰트(시스템) | 기동 시 자동 ALTER |
| 신규 컬럼 | `process_maps.sp_duration` VARCHAR(50) | 지정 어트리뷰트(소요시간) | 기동 시 자동 ALTER |
| 신규 컬럼 | `process_maps.sp_changed_by` VARCHAR(100) | 최근 지정 변경자 | 기동 시 자동 ALTER |
| 신규 컬럼 | `process_maps.sp_changed_at` TIMESTAMP | 최근 지정 변경 시각 | 기동 시 자동 ALTER |
| 상태값 추가 | `map_versions.status` = `expired` | 게시 시 직전 게시본이 expired로 전이(최종 상태) | DDL 없음(값만 추가) |

### 마이그레이션 메커니즘 — 별도 DDL 스크립트가 필요 없다

Alembic은 아직 없다. backend가 기동할 때 `app/db.py::init_models()`가 멱등으로 실행된다:

1. `Base.metadata.create_all` — 없는 **테이블**을 생성 (위 신규 테이블 4종).
2. `_add_missing_columns()` — `_ADDED_COLUMNS` 목록의 **컬럼**이 기존 테이블에 없으면
   `ALTER TABLE … ADD COLUMN` (nullable 또는 DEFAULT, 기존 행 생존). 위 신규 컬럼 12개 모두 등록돼 있다.
   매뉴얼 레거시 단일 게시본 행은 language 기본값 ko로 흡수되고 제목은 읽기 시 자동 추출 — 별도 작업 불요.

즉 **덤프를 복원한 DB 위에 최신 backend를 1회 기동하는 것이 곧 마이그레이션**이다.
모든 변경이 추가(additive)라서 파괴적 DDL이 없고, 구버전 코드도 같은 DB에서 동작한다
(신규 테이블·컬럼을 모를 뿐) — 롤백은 구버전 컨테이너 재기동이면 충분하다.

### 데이터 의미 변화 2건 (DDL은 아니지만 운영에 영향)

- **`version_number`**: 기존 게시본은 NULL로 남는다. UI는 번호 없으면 라벨만 표시하고,
  다음 publish부터 맵별 `max+1`(첫 채번은 1)로 붙는다. 원하면 §6의 선택 백필 SQL로 소급 부여.
- **서브프로세스 지정**: 이제 **지정(designated)된 맵만** 라이브러리 피커에 노출되고,
  기존 링크 노드 중 **미지정 맵을 가리키는 노드는 경고 + 잠금** 표시된다. 마이그레이션 직후엔
  모든 맵이 미지정 상태이므로, 링크로 쓰이던 맵들은 오너가 **설정 → Subprocess designation**에서
  지정해야 한다(§5 검증 항목·`SUBPROCESS-DESIGNATION.md` 참고). 스키마 문제가 아니라 운영 작업이다.

---

## 2. 사전 준비

- [ ] 서버에 최신 main 코드 체크아웃 — 운영 코드와 **다른 디렉터리** 권장(예: `~/bpm-dev`).
  ```bash
  git clone <repo-url> ~/bpm-dev && cd ~/bpm-dev   # 또는 기존 clone에서 git fetch && git checkout origin/main
  ```
- [ ] `.env.dev` 작성 — 운영 `.env`를 복사해 포트만 변경(`.gitignore`의 `.env.*`에 걸려 커밋되지 않음):
  ```bash
  cp /path/to/운영/.env .env.dev
  # .env.dev에서 딱 한 줄 수정:
  #   APP_PORT=9800
  # 나머지(POSTGRES_*, KEYCLOAK_*, LDAP_*, BPM_SYSADMINS …)는 운영과 동일하게 둔다.
  # (선택) MANUAL_URL=<편집용 매뉴얼 사이트 주소> — 설정 시 에디터 툴바에 버튼 노출, 비우면 숨김
  ```
- [ ] **Keycloak 리다이렉트 허용** — realm `ai-portal`의 클라이언트에 9800 origin이 없으면 로그인 불가:
  Valid redirect URIs에 `http://<서버IP>:9800/*`, Web origins에 `http://<서버IP>:9800` 추가.
  (이미 와일드카드면 생략. 자세한 화면 위치는 `docs/deploy.md` §1.)
- [ ] 디스크 여유 확인 — DB 덤프 + 복제 볼륨 분량.

파일 구성(이 저장소에 포함):

| 파일 | 역할 |
|------|------|
| `docker-compose.yml` | 공통 스택 정의(proxy 80←`APP_PORT`, frontend, backend, db). 운영·검증 공용 |
| `docker-compose.dev.yml` | 9800 검증 스택 **오버라이드** — 브리지 서브넷만 172.37.0.0/16으로 분리(운영 172.36과 충돌 회피). 포트는 `.env.dev`의 `APP_PORT`로 주입 |
| `.env.dev` | 서버에서 생성(§위) — 커밋 금지 대상 |

검증 스택의 모든 compose 명령은 아래 형태를 쓴다(`-p bpm-dev`가 컨테이너·볼륨·이미지·네트워크
이름을 운영과 분리해 준다):

```bash
alias dcdev='docker compose -p bpm-dev -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.dev'
```

---

## 3. DB 복사 (운영 9900 → 검증 9800)

### 3-1. 운영 DB 컨테이너 확인 및 덤프 (무중단, 읽기 전용)

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | grep postgres   # 운영 db 컨테이너 이름 확인
PROD_DB=<위에서 확인한 이름>   # 예: bpm-db-1

# 커스텀 포맷 덤프(-Fc) — 압축 + pg_restore 선택 복원 가능
docker exec -t "$PROD_DB" pg_dump -U processmap -d processmap -Fc > bpm-9900-$(date +%Y%m%d-%H%M).dump
ls -lh bpm-9900-*.dump   # 0바이트가 아닌지 확인
```

`-U`/`-d`는 운영 `.env`의 `POSTGRES_USER`/`POSTGRES_DB`가 기본값(processmap)과 다르면 그 값으로.

### 3-2. 검증 스택의 db만 먼저 기동

**순서가 중요하다** — backend가 빈 DB에 먼저 붙으면 최신 스키마로 테이블을 만들어 버리고,
그 위에 구스키마 덤프를 복원하면 뒤섞인다. 반드시 **db 기동 → 복원 → backend 기동** 순서.

```bash
cd ~/bpm-dev
dcdev up -d db
dcdev ps            # db가 healthy 될 때까지 대기
```

### 3-3. 덤프 복원

```bash
DEV_DB=$(dcdev ps -q db)
cat bpm-9900-*.dump | docker exec -i "$DEV_DB" pg_restore -U processmap -d processmap --no-owner --clean --if-exists
# 재시도할 때(--clean이 기존 객체 제거 후 재생성)도 같은 명령 그대로.
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "SELECT count(*) FROM process_maps;"   # 복원 확인
```

### 3-4. 전체 스택 기동 = 마이그레이션 실행

```bash
dcdev up -d --build          # frontend/backend 이미지 빌드 포함(최초 수 분)
dcdev logs backend | head -50   # 기동 로그 — DDL 오류 없이 Uvicorn started 확인
curl -s http://localhost:9800/api/health   # {"status":"ok"}
```

backend 기동 시점에 §1의 자동 보강이 적용된다. 이후 재기동해도 멱등(이미 있으면 건너뜀).

---

## 4. 마이그레이션 결과 검증 (스키마·데이터)

### 4-1. 스키마 — 신규 테이블·컬럼 존재

```bash
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "\dt" | grep -E "feedback|notices|manual_docs|checkout_requests"
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "\d map_versions" | grep -E "version_number|checked_out_from"
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "\d process_maps"  | grep -E "sp_"
```

세 명령 모두 해당 행이 출력되어야 한다(테이블 4·컬럼 2·컬럼 7).

### 4-2. 데이터 보존 — 운영과 행수 비교

같은 쿼리를 운영(`$PROD_DB`)과 검증(`$DEV_DB`)에서 실행해 수치가 일치하는지 확인:

```bash
Q="SELECT (SELECT count(*) FROM process_maps)  AS maps,
          (SELECT count(*) FROM map_versions)  AS versions,
          (SELECT count(*) FROM nodes)         AS nodes,
          (SELECT count(*) FROM edges)         AS edges,
          (SELECT count(*) FROM employees)     AS employees;"
docker exec -it "$PROD_DB" psql -U processmap -d processmap -c "$Q"
docker exec -it "$DEV_DB"  psql -U processmap -d processmap -c "$Q"
```

---

## 5. 기능 검증 체크리스트 (http://<서버IP>:9800)

- [ ] Keycloak 로그인 → 홈 맵 목록 표시(운영과 같은 맵들)
- [ ] 기존 맵 에디터 열기 — 노드/엣지 그대로, 저장·자동저장 동작
- [ ] 버전 워크플로 — 기존 버전 상태 표시 정상, 새 버전 승인 요청→승인→게시 1사이클
  (게시 시 직전 게시본이 `expired`로 바뀌는지, 새 게시본에 `version_number` 붙는지)
- [ ] 신규 화면 4종 — 공지사항 / 알림·승인(Inbox) / 피드백 / 사용 매뉴얼(`/manual` — 제목 드롭다운·한/영 문서 목록, 문서 0건이면 번들 fallback)
- [ ] 점유권 — 다른 계정으로 체크아웃 요청→승인
- [ ] 관리자(sysadmin 계정) — 설정의 Employees·공지 작성·매뉴얼 게시 탭
- [ ] **서브프로세스 지정** — 링크 노드가 있는 맵: 미지정 경고+잠금 표시 확인 →
      대상 맵 오너로 설정 → Subprocess designation에서 지정 → 라이브러리 피커 노출·노드 정상화
- [ ] PNG 내보내기(에디터 `Ctrl+Shift+E`·비교 Export) — 엣지 검은 실선 출력
- [ ] 브라우저 콘솔에 에러 없는지

## 6. (선택) `version_number` 소급 백필

기존 게시본에도 번호를 붙이고 싶을 때만. 맵별 게시 시점(created_at) 순으로 채번:

```bash
docker exec -it "$DEV_DB" psql -U processmap -d processmap <<'SQL'
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY map_id ORDER BY created_at, id) AS rn
  FROM map_versions
  WHERE status IN ('published', 'expired')
)
UPDATE map_versions v
SET version_number = r.rn
FROM ranked r
WHERE v.id = r.id AND v.version_number IS NULL;
SQL
```

미적용해도 무방(신규 게시부터 1번 채번). 적용했다면 §5 워크플로 항목을 다시 확인.

---

## 7. 정리·롤백

- **9800 스택 폐기** (복사본이므로 운영 무영향):
  ```bash
  dcdev down -v      # -v: 복제 DB 볼륨까지 삭제
  ```
- **복원부터 재시도**: `dcdev down -v` 후 §3-2부터 다시.
- 운영(9900)은 이 절차 동안 아무 변경이 없다.

## 8. 운영(9900) 승격 — 검증 통과 후

검증 스택과 동일한 메커니즘이므로 절차가 짧다. **직전 백업 덤프가 유일한 롤백 수단이니 반드시 먼저.**

```bash
# 운영 디렉터리에서
docker exec -t "$PROD_DB" pg_dump -U processmap -d processmap -Fc > bpm-9900-before-upgrade-$(date +%Y%m%d).dump
git fetch && git checkout <9800에서 검증한 커밋>   # 반드시 검증 스택과 같은 커밋으로
docker compose up -d --build               # backend 기동 = 자동 보강 적용
docker compose logs backend | head -30 && curl -s http://localhost:9900/api/health
```

- §4-1 스키마 확인 → §5 스모크(핵심 3~4개)만 재확인.
- **롤백**: 스키마가 additive라 코드만 되돌리면 된다 —
  `git checkout 406c375b && docker compose up -d --build`. (신규 테이블·컬럼은 구코드가 무시)
  데이터까지 되돌릴 일이 생기면 위 백업 덤프로 §3-3과 같은 방식 복원.
- 승격 후 운영 작업: 서브프로세스로 쓰이는 맵들 지정(§1 데이터 의미 변화), 필요 시 매뉴얼 게시
  (설정 → 콘텐츠 → 매뉴얼, `docs/manual/` 4종 참고).

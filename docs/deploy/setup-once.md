# 초기 1회 셋업 모음

배포 문서 전반에 흩어져 있던 **한 번만 하면 되는 작업**을 모은 문서. 매 배포마다 반복하는 절차는 각 런북에 있고([`deploy.md`](deploy.md) · [`db-migration-9910.md`](db-migration-9910.md) · [`backup.md`](backup.md) · [`kb-embedding.md`](kb-embedding.md) · [`db-seed.md`](db-seed.md)), 여기엔 **최초 1회**만 온다.

1회성은 두 종류이고 성격이 다르다 — 섞으면 사고가 난다.

| 구분 | 언제 | 재실행하면 |
|---|---|---|
| **A. 스택 구축 1회** | 새 서버·새 포트 스택을 처음 세울 때 | 대체로 무해(멱등) |
| **B. 릴리스 이후 1회** | 특정 기능이 배포된 뒤 데이터·스키마를 한 번 보정 | **항목마다 다름 — 각 항목의 재실행 안전성 표기를 볼 것** |

> 매 배포에 반복하는 것(코드 pull → `docker compose up -d --build` → 헬스체크)은 1회성이 아니다. [`deploy.md`](deploy.md) §3~§4.

---

## A. 스택 구축 1회

### A1. 서버 전제 — Docker / Compose

```bash
docker --version && docker compose version   # Compose v2
df -h .                                      # 덤프+볼륨 여유 확인
```

앱 nginx는 **443/80을 쓰지 않는다** — 서버 엣지 nginx가 이미 점유 중이라 앱은 `APP_PORT`로만 노출한다(운영 9900 · 검증 9910 · `.env.example` 기본 3333).

### A2. Keycloak public 클라이언트 (realm당 1회)

realm `ai-portal`에 frontend용 **public(PKCE) 클라이언트** 생성:

| 항목 | 값 |
|------|-----|
| Client ID | `bpm-frontend` (= `KEYCLOAK_CLIENT_ID`) |
| Client authentication | **Off** (public) |
| Standard flow | On (Authorization Code) |
| Valid redirect URIs | `http://<서버호스트>:<APP_PORT>/*` |
| Valid post logout redirect URIs | 위와 동일 |
| Web origins | `http://<서버호스트>:<APP_PORT>` |

- **⚠️ 클라이언트 자체는 realm당 1회지만, URI 등록은 포트·도메인이 늘어날 때마다 추가해야 한다.** 9910 검증 스택을 새로 열었는데 로그인이 안 되면 십중팔구 여기다 — `redirect_uri`는 코드가 `window.location.origin`으로 만들기 때문에 포트가 다르면 다른 origin이다.
- **Web origins를 빼먹으면 로그인 왕복은 되는데 토큰 교환이 CORS로 죽는다**(`failed to fetch` / `No matching state found`). redirect URI와 별개 항목이다.
- **post logout redirect URI는 실제로 쓰인다** — `/login`의 "Sign out of all sessions" 패널이 Keycloak `end_session`을 `post_logout_redirect_uri=<origin>/login`으로 호출한다. 미등록이면 Keycloak 확인 화면에서 멈춘다.
- **Mappers**: 토큰 `preferred_username`이 AD `sAMAccountName`(= loginId)을 담아야 한다 — 백엔드가 이 값으로 `employees`를 매칭한다. Keycloak LDAP federation 기본 매핑이면 OK.

### A3. AD / LDAP 인프라 (인프라 담당과 1회 합의)

Keycloak federation(로그인·토큰 발급)과 백엔드 LDAP 동기화(employees 채우기)는 **같은 AD를 보되 접속 경로가 다른 별개 설정**이다. 백엔드용으로 받아둘 것:

| 항목 | 내용 |
|------|------|
| LDAP 서비스 계정 | AD 읽기 권한 bind 계정(DN + 비밀번호) — 동기화 전용, 읽기 전용 최소 권한 |
| LDAP 접속 | 주소/포트. LDAPS(636) 권장, StartTLS면 `LDAP_START_TLS=true` |
| 검색 기준 DN | 사용자 enumerate 기준 OU/DN (`LDAP_USER_SEARCH_BASE`) |
| 초기 관리자 | admin 권한을 줄 loginId 목록 (`SYSTEM_ADMIN_LOGIN_IDS`) — **최소 1명. 비우면 아무도 관리자 화면에 못 들어간다** |

### A4. n8n HR 웹훅 2종 (1회, 이후 스택 간 공유)

**A4-1. `hr-dept` URL 철자 확정** — 계약서 표기가 `webhoop`였던 전례가 있어 실측으로 확정한다. 200 + `{"kind":"employees","count":...}`가 나오는 쪽이 정답:

```bash
TOKEN='<X-API-Key 값>'
curl -s -X POST http://182.199.63.71:5678/webhook/hr-dept \
  -H "X-API-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"employees","loginId":"<본인 loginId>"}' | head -c 300
```

**A4-2. `hr-position` 워크플로 임포트** — EDW 부서장 목록(직책 FRNM). 저장소의 [`n8n/hr-position-workflow.json`](n8n/hr-position-workflow.json)을 n8n에 임포트 → 자격증명 연결 → Activate. 확정한 두 URL과 토큰은 A5의 `.env`에 넣는다.

> EDW 뷰 스캔이 느려 백엔드 타임아웃은 180초로 잡혀 있다(30초는 부족 — 실측). `backend/app/hr/client.py`

### A5. `.env` 작성 + 시크릿 발급 (스택당 1회)

```bash
cp .env.example .env          # 검증 스택이면 .env.9910 등 스택별 파일명
```

채울 값은 [`deploy.md`](deploy.md) §2의 블록 그대로. 최초 1회만 하는 것:

```bash
openssl rand -hex 32          # AUTH_JWT_SECRET — AUTH_MODE=ldap이면 필수(비면 backend 기동 실패)
```

- **`.env`는 git 금지**(시크릿 포함). 서버 재구축에 필수 자산이니 **git 밖 안전한 위치에 사본을 따로 보관**한다 — 백업 사이드카는 DB만 덤프한다([`backup.md`](backup.md) §1).
- **⚠️ compose backend에는 `env_file:`이 없다** — `.env`의 키가 컨테이너에 닿으려면 `docker-compose.yml`의 backend `environment:` 블록에 명시 매핑돼 있어야 한다. 신규 env를 추가할 땐 `.env.example` + `settings.py` + compose 셋이 함께 움직여야 한다(`rules/backend/config.md`).

### A6. 백업 디렉터리 (스택당 1회)

`.env`의 `BACKUP_DIR`(기본 `./backups`, 저장소 루트 기준)·`BACKUP_RETENTION_DAYS`(기본 14)만 정하면 사이드카가 알아서 만든다. 첫 기동 직후 오늘자 덤프가 없으면 즉시 1회 덤프하므로, 배포 후 한 번 확인:

```bash
docker compose logs --tail 5 db-backup   # "[db-backup] ... ok bpm-....dump (크기)"
```

### A7. 같은 서버에 스택을 하나 더 (검증 스택 1회)

운영과 나란히 띄우려면 **세 가지가 전부 달라야 한다** — 프로젝트명 · 포트 · 브리지 서브넷.

| 항목 | 방법 |
|---|---|
| 프로젝트명 | 모든 compose 명령에 `-p bpm-9910` |
| env 파일 | `--env-file .env.9910` (그 안에서 `APP_PORT=9910`) |
| 서브넷 | `docker-compose.yml` 맨 아래 `ipam.config`를 미점유 대역으로 직접 수정 |

**⚠️ 서브넷은 오버라이드 파일로 못 바꾼다** — 사내 71번 서버의 compose는 `docker-compose.yml`과 `docker-compose.dev.yml`의 `ipam.config`를 교체가 아니라 **누적 병합**해서 `Pool overlaps with other one`으로 실패한다(실측). 검증 스택 클론의 `docker-compose.yml`을 직접 고치는 게 확실하다. 운영이 172.36을 점유 중이고 172.37~40·172.42는 과거 실패·점유 이력이 있다 — **172.43 / 172.44**를 쓴다.

```bash
docker network ls | grep bpm                 # 잔재 확인
docker network rm bpm-9910_default 2>/dev/null   # 잔재 정리
```

### A8. 신규·빈 DB 한정 — 데모 시드

**운영 DB에는 절대 실행 금지**(`reset_db`는 `drop_all`이다). 데모·스테이징 빈 DB에서만:

```bash
docker compose exec backend python -m scripts.reset_db
```

상세·부분 시드는 [`db-seed.md`](db-seed.md). 운영 DB 복사본으로 세우는 검증 스택은 시드하지 않는다 — 복원이 곧 데이터다.

---

## B. 릴리스 이후 1회

이미 지난 릴리스라면 건너뛴다. **각 항목의 재실행 안전성이 다르다.**

### B1. `ai_chat_logs` 드랍 — 2026-07-09(AI 챗 서버 저장) 이후 1회

코드가 더 이상 쓰지 않지만 `create_all`은 테이블을 드랍하지 않아 남는다. *재실행 안전(멱등).*

```bash
docker compose exec db psql -U ${POSTGRES_USER:-processmap} -d ${POSTGRES_DB:-processmap} \
  -c 'DROP TABLE IF EXISTS ai_chat_logs;'
```

### B2. KB 게시본 백필 — `EMBED_URL`을 처음 설정한 뒤 1회

publish 훅 도입 이전 게시본은 인덱스가 없다. *재실행 안전(맵 단위 교체·멱등).*

```bash
docker compose exec backend python -m scripts.backfill_kb_maps
docker compose restart backend   # ⚠️ 필수 — 백필은 별도 프로세스라 러닝 백엔드의 검색 캐시가 새 청크를 모른다
```

상세는 [`kb-embedding.md`](kb-embedding.md) §3.

### B3. 인터뷰 임포트 맵 재임포트 — 필드 승격(2026-08-20) 이후 1회

신규 컬럼 16개(nodes 7·process_maps 9)는 자동 ALTER로 생기지만 **값은 비어 있다.** 설정 → Framework 탭 → Interview import에서 **같은 파일을 다시 Dry-run → Apply**하면 승격 필드가 백필된다(새 버전 게시). *재실행 안전(멱등 — 같은 파일이면 `unchanged`).*

> **⚠️ FE/BE 동시 배포 필수.** backend만 올리고 frontend를 구버전으로 두면 에디터의 graph PUT이 승격 필드를 도로 소거한다.

### B4. HR 첫 수동 sync + 고아 부서 경로 이관 — HR 웹훅 도입 이후 1회

**재실행이 위험한 유일한 항목** — 순서를 지킨다. 상세·판정 기준은 [`db-migration-9910.md`](db-migration-9910.md) §6.

1. **드라이런 먼저**(설정 → Employees → sync-preview). `case_mismatches == 0`이 아니면 **중단** — loginId 표기가 다르면 실 sync가 신규행 생성 + 구행 삭제로 권한·승인자 참조를 고아로 만든다.
2. 첫 수동 sync. `aborted_reason`이 null이고 `deleted`가 프리뷰의 `would_delete`와 일치하는지 확인(20% 상한 초과 시 전체 중단·DB 무변경).
3. 설정 → Departments 탭 상단 **소멸 부서 재지정** 섹션에서 고아 경로를 새 조직 경로로 이관(맵 권한·그룹 멤버 일괄 이동). 고아가 없으면 섹션이 안 뜨는 게 정상.
4. 끝난 뒤 `.env`의 `HR_SYNC_INTERVAL_HOURS=24` + backend 재기동으로 스케줄러를 켠다(이행 중에는 `0`으로 꺼둔다).

### B5. 노출 직책 확정 — EDW 직책 첫 sync 이후 1회

설정 → Employees 탭 상단 **Exposed positions** 카드에서 수집된 직책 중 노출할 것을 고르고 Save(기본 4종: 그룹장·파트장·팀장·센터장). 이 allowlist가 승인자 피커의 Manager 태그와 직책 병기를 결정한다. *재실행 안전.*

---

## C. 절대 하지 말 것

- **운영 DB에 `reset_db`** — `drop_all`이라 현업 데이터가 전부 사라진다. 서버 스키마 변경은 배포(앱 기동)만으로 반영된다([`db-seed.md`](db-seed.md)).
- **`docker compose down -v`를 운영에서** — `pgdata` 볼륨이 삭제된다. 롤백은 코드만 되돌리면 된다([`deploy.md`](deploy.md) §8).
- **`docker exec -t`로 덤프** — TTY가 붙으면 바이너리 덤프에 CR이 섞여 아카이브가 깨진다. `-i`만 쓴다.

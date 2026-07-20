# DB 마이그레이션 & 9910 검증 스택 가이드 (7월 2차 업데이트)

운영 스택(포트 **9900**, 커밋 `ed15440` 시점)의 DB를 **복사**해서, **dev**(worktree-sp-placeholder
머지 후 — 서브프로세스 플레이스홀더 포함) 코드를 포트 **9910**에 별도 스택으로 띄워
마이그레이션·기능을 검증하는 절차. 검증이 끝나면 dev→main 머지 후 운영(9900)을 같은 방식으로
승격한다. **운영 스택과 볼륨은 일절 건드리지 않는다**(덤프 읽기만).

전례: 1차 업데이트(운영 9900 → 검증 9800)와 같은 메커니즘 —
서버 실측값(컨테이너명·compose 병합 함정)은 1차 때 확인된 값을 그대로 쓴다(상세는 git history `db-migration-9800.md`).

---

## 1. 스키마 변경 요약 — 운영 `ed15440` → dev(플레이스홀더 포함)

| 구분 | 대상 | 내용 | 적용 방식 |
|------|------|------|-----------|
| 신규 컬럼 | `process_maps.sp_description` TEXT | SP 지정 설명(자유 텍스트) | 기동 시 자동 ALTER (`_ADDED_COLUMNS` 등록) |
| 신규 인덱스 | `notifications` (recipient, read) / (recipient, created_at) | 알림 목록·미읽음 폴링 성능 | 기동 시 자동 `CREATE INDEX IF NOT EXISTS` (`_ADDED_INDEXES`) |
| 값 추가 | `approval_requests.kind` = `'map_rename'`, `'sp_designation'` | 이름변경·SP 등록 요청 워크플로 | DDL 없음(값만 추가) |
| 값 추가 | 알림 `type` 다수(`rename_*`, `sp_designation_*`, checkout/permission 6종 등) | 신규 알림 | DDL 없음 |

**신규 테이블 없음.** 운영 시점(ed15440)에 이미 전체 테이블이 존재한다.

### 마이그레이션 메커니즘 — 별도 DDL 스크립트 불필요 (9800 문서 §1과 동일)

backend 기동 시 `app/db.py::init_models()`가 멱등 실행:
`create_all`(신규 테이블 — 이번엔 없음) → `_add_missing_columns()`(sp_description 1개)
→ `_add_missing_indexes()`(알림 인덱스 2개). **덤프를 복원한 DB 위에 dev backend를 1회
기동하는 것이 곧 마이그레이션**이다. 전부 additive라 구버전 코드도 같은 DB에서 동작 —
롤백은 구버전 컨테이너 재기동이면 충분하다.

### 데이터 의미 변화 (DDL 아님, 운영 영향)

- **follow_latest 기본 ON**: 새로 만드는 SP 링크 노드의 기본이 "최신 게시본 추종"으로 바뀐다.
  **기존 노드 값은 변하지 않는다**(생성 경로 기본값만).
- **미등록 맵 링크 허용(플레이스홀더)**: 피커 토글을 켜면 미지정 맵도 링크할 수 있고, 그 링크는
  지정 전까지 경고+잠금으로 표시된다. 기존 데이터엔 영향 없음 — 새 UX 진입점이 늘어난 것.
- **SP 등록 요청**: 미지정 맵을 링크한 사용자가 등록 요청을 보내면 대상 맵 오너 Inbox에
  수락 카드가 뜨고, **지정 모달 저장(= `PUT /subprocess-designation`)이 곧 수락**이다.
  지정은 게시본 필수(409) — 게시본 없는 맵은 수락 불가 안내가 뜬다.

---

## 2. 사전 준비

- [ ] 서버에 dev 코드 체크아웃 — 운영 코드와 **다른 디렉터리**(1차 때의 `~/bpm-dev` 재사용 가능):
  ```bash
  cd ~/bpm-dev && git fetch && git checkout origin/dev   # sp-placeholder 머지 후의 dev인지 로그로 확인
  git log --oneline -3    # 플레이스홀더 머지 커밋이 보여야 한다
  ```
- [ ] `.env.9910` 작성 — 운영 `.env`를 복사해 포트만 변경:
  ```bash
  cp /path/to/운영/.env .env.9910
  # .env.9910에서 딱 한 줄 수정:
  #   APP_PORT=9910
  # 나머지(POSTGRES_*, KEYCLOAK_*, LDAP_*, BPM_SYSADMINS …)는 운영과 동일하게 둔다.
  ```
- [ ] **Keycloak 리다이렉트 허용** — realm `ai-portal` 클라이언트에 9910 origin이 없으면 로그인 불가:
  Valid redirect URIs에 `http://<서버IP>:9910/*`, Web origins에 `http://<서버IP>:9910` 추가.
  (이미 와일드카드거나 1차 때 포트별로 넣었다면 9910만 추가. 화면 위치는 `deploy.md` §1.)
- [ ] **서브넷 분리** — 사내 71번 서버 compose는 오버라이드 병합이 누적이라(1차 실측, git history `db-migration-9800.md` §2)
  dev 클론의 `docker-compose.yml` 맨 아래 서브넷을 운영(172.36)·과거 9800 스택(172.42)과 겹치지
  않는 값으로 직접 수정: `172.43.0.0/16` / `172.43.0.1`.
  (과거 9800 스택을 `down -v`로 정리했다면 172.42 재사용도 가능 — 겹침 에러 나면 이 항목부터 확인.)
- [ ] alias 정의(프로젝트명 `-p bpm-9910`이 컨테이너·볼륨·네트워크를 운영·9800과 분리):
  ```bash
  alias dc910='docker compose -p bpm-9910 --env-file .env.9910'
  docker network rm bpm-9910_default 2>/dev/null   # 이전 시도 잔재 정리
  ```
- [ ] 디스크 여유 확인 — DB 덤프 + 복제 볼륨 분량.

---

## 3. DB 복사 (운영 9900 → 검증 9910)

### 3-1. 운영 DB 덤프 (무중단, 읽기 전용)

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | grep postgres   # 운영 db 컨테이너 확인
PROD_DB=business-process-mgmt-db-1   # 사내 71번 운영 db 컨테이너 실이름(9800 검증 때 확인값 — 위 명령으로 재확인)

# 커스텀 포맷 덤프(-Fc). ⚠️ docker exec에 -t(TTY) 금지 — 바이너리 덤프에 CR이 섞여 아카이브가 깨진다.
docker exec "$PROD_DB" pg_dump -U processmap -d processmap -Fc > bpm-9900-$(date +%Y%m%d-%H%M).dump
ls -lh bpm-9900-*.dump   # 0바이트가 아닌지 확인

# 아카이브 검증 — 정상이면 테이블/시퀀스 목록
docker run --rm -i postgres:16-alpine pg_restore --list < bpm-9900-*.dump | head -15
```

### 3-2. 검증 스택의 db만 먼저 기동

**순서가 중요하다** — backend가 빈 DB에 먼저 붙으면 최신 스키마로 테이블을 만들어 버린다.
반드시 **db 기동 → 복원 → backend 기동** 순서.

```bash
cd ~/bpm-dev
dc910 up -d db
dc910 ps            # db가 healthy 될 때까지 대기
```

### 3-3. 덤프 복원

```bash
DEV_DB=$(dc910 ps -q db)
cat bpm-9900-*.dump | docker exec -i "$DEV_DB" pg_restore -U processmap -d processmap --no-owner --clean --if-exists
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "SELECT count(*) FROM process_maps;"   # 복원 확인
```

### 3-4. 전체 스택 기동 = 마이그레이션 실행

```bash
dc910 up -d --build             # frontend/backend 이미지 빌드 포함(최초 수 분)
dc910 logs backend | head -50   # ALTER TABLE process_maps ADD COLUMN sp_description 1회 실행 확인
curl -s http://localhost:9910/api/health   # {"status":"ok"}
```

---

## 4. 마이그레이션 결과 검증

### 4-1. 스키마 — 신규 컬럼·인덱스 존재

```bash
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "\d process_maps"   | grep sp_description
docker exec -it "$DEV_DB" psql -U processmap -d processmap -c "\di" | grep ix_notifications_recipient
```

첫 명령 1행, 둘째 명령 2행(read/created_at)이 나와야 한다.

### 4-2. 데이터 보존 — 운영과 행수 비교

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

---

## 5. 기능 검증 (http://<서버IP>:9910)

**스모크**(맵 목록·에디터 로드·저장)로 기본 기능을 확인한다.
DB 복사본 특성상 추가로 확인할 것:

- [ ] 운영과 같은 맵·버전·알림이 그대로 보이는지 (4-2 행수와 화면 대조)
- [ ] 기존 SP 링크 노드 정상(지정 맵은 임베드, 혹시 남은 미지정 링크는 경고+잠금)
- [ ] 검증 중 만든 데이터(테스트 맵·요청·공지)는 **복사본에만 남는다** — 운영 무영향

## 6. 정리·롤백

- **9910 스택 폐기** (복사본이므로 운영 무영향):
  ```bash
  dc910 down -v      # -v: 복제 DB 볼륨까지 삭제
  ```
- **복원부터 재시도**: `dc910 down -v` 후 §3-2부터 다시.
- 운영(9900)은 이 절차 동안 아무 변경이 없다.

## 7. 운영(9900) 승격 — 9910 검증 통과 + main 머지 후

**dev를 직접 운영에 올리지 않는다** — 9910 검증 통과 → dev→main 머지·푸시 → 운영은 main으로.
직전 백업 덤프가 유일한 롤백 수단이니 반드시 먼저.

```bash
# 운영 디렉터리에서
PROD_DB=business-process-mgmt-db-1
docker exec "$PROD_DB" pg_dump -U processmap -d processmap -Fc > bpm-9900-before-upgrade-$(date +%Y%m%d).dump   # -t 금지
git fetch && git checkout <9910에서 검증한 dev와 동일 내용의 main 커밋>
docker compose up -d --build               # backend 기동 = 자동 보강 적용
docker compose logs backend | head -30 && curl -s http://localhost:9900/api/health
```

- §4-1 스키마 확인 → 앱 스모크(맵 목록·에디터 로드) 재확인.
- **롤백**: additive 스키마라 코드만 되돌리면 된다 — `git checkout ed15440 && docker compose up -d --build`.
  데이터까지 되돌릴 일이 생기면 위 백업 덤프로 §3-3 방식 복원.
- 승격 후 운영 작업: ① 매뉴얼 게시(설정 → 콘텐츠 → 매뉴얼, `docs/manual/` 6종 최신본 붙여넣기)
  ② 공지 게시(`docs/notices/2026-07-release-2.md` 초안 → 설정 → 공지 작성, 전체 알림 체크)

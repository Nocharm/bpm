# 서버 배포 런북 (사내 71번)

로컬에서 검증한 코드를 서버로 옮겨 docker-compose로 올리는 절차. 파이프라인 전체는 `CLAUDE.md`의 Operations 참고.

## 0. 전제조건

- 서버에 Docker / Docker Compose v2 설치됨
- 코드 전송 완료 (scp 또는 gitlab pull) — **줄바꿈은 `.gitattributes`로 LF 고정**되어 Windows 경유해도 안전
- Keycloak public 클라이언트 등록 (아래 1)

## 1. Keycloak 클라이언트 등록 (최초 1회)

realm `ai-portal` 에 frontend용 **public(PKCE)** 클라이언트 생성:

| 항목 | 값 |
|------|-----|
| Client ID | `bpm-frontend` (= `KEYCLOAK_CLIENT_ID`) |
| Client authentication | **Off** (public) |
| Standard flow | On (Authorization Code + PKCE) |
| Valid redirect URIs | `http://<서버호스트>:3333/*` (도메인 추가 시 `https://g-ai-agent.sbiologics.com/*` 도 등록) |
| Valid post logout redirect URIs | 위와 동일 |
| Web origins | `http://<서버호스트>:3333` (+ 도메인) |

> redirect_uri는 앱 origin이다. 포트 직접 접속 단계에서는 `:3333`, 엣지 nginx에 도메인 붙이면 그 도메인도 추가.

## 2. .env 작성

```bash
cp .env.example .env
```

서버용으로 채울 값:

```
APP_PORT=3333
POSTGRES_USER=processmap
POSTGRES_PASSWORD=<강한 비밀번호>
POSTGRES_DB=processmap

AUTH_ENABLED=true
KEYCLOAK_ISSUER=http://182.199.63.71:8080/realms/ai-portal
KEYCLOAK_AUDIENCE=
KEYCLOAK_CLIENT_ID=bpm-frontend
```

> `NEXT_PUBLIC_*` 는 compose가 `AUTH_ENABLED`/`KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID` 로부터 build args로 자동 주입한다 (docker-compose.yml). 별도 설정 불필요.

## 3. 배포

```bash
docker compose up -d --build
```

- `NEXT_PUBLIC_*` 는 **빌드 타임에 번들로 인라인**된다 → 인증/issuer 값을 바꾸면 frontend를 **재빌드**해야 한다 (`--build`).
- DB 스키마는 backend 起動 시 `create_all` 로 생성 (마이그레이션은 후속).

## 4. 헬스체크

```bash
docker compose ps                                  # 4개 서비스 Up, db healthy
curl -s http://localhost:3333/api/health           # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3333/   # 200
```

브라우저에서 `http://<서버호스트>:3333` → Keycloak 로그인 화면으로 리디렉트되면 인증 연동 정상.

## 5. 트러블슈팅

| 증상 | 확인 |
|------|------|
| 로그인 후 redirect 오류 | Keycloak Valid redirect URIs에 `:3333/*` 등록됐는지 |
| `/api/*` 401 | 토큰 만료 / `KEYCLOAK_ISSUER` 가 realm URL과 일치하는지 (`/realms/ai-portal` 까지) |
| frontend가 인증 안 함 | `NEXT_PUBLIC_AUTH_ENABLED=true` 로 **빌드됐는지** — 값 변경 시 `--build` 재실행 |
| db 연결 실패 | `docker compose logs db`, healthcheck 통과 여부 |

로그: `docker compose logs -f backend` / `frontend` / `proxy`

## 6. 롤백

```bash
git checkout <이전-커밋>
docker compose up -d --build
```

데이터는 `pgdata` 볼륨에 유지된다. 완전 초기화는 `docker compose down -v` (볼륨 삭제 — 주의).

---

> **샌드박스 한계:** 본 저장소 CI 환경은 Docker Hub 무인증 풀 제한으로 `compose build` 를 끝까지 검증하지 못한다. `docker compose config` 정적 검증은 통과했으며, 실제 이미지 빌드/기동은 서버에서 확인한다.

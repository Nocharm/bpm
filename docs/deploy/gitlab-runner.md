# GitLab Runner 배포 파이프라인

BPM은 **사내 GitLab 파이프라인으로 배포한다.** 서버에 SSH로 들어가 `git pull`·`docker compose up -d --build`를 손으로 치지 않는다. 이 문서는 러너·파이프라인·두 환경(운영·개발)·손으로 띄운 스택에서 넘어오는 절차를 다루는 단일 문서다. 매 배포 확인 항목과 앱 트러블슈팅은 [`deploy.md`](deploy.md), 서버 최초 셋업은 [`setup-once.md`](setup-once.md), 백업·복구는 [`backup.md`](backup.md).

> 서버 명령은 bash(리눅스) 기준이다. 실 IP·사내 호스트명·사람 계정은 쓰지 않는다. `<gitlab-url>`, `<server-ip>`, `<계정>`을 실제 값으로 바꿔 읽는다. 같은 서버의 sop-archivist가 같은 방식으로 먼저 붙었다(그 저장소 `docs/deploy/gitlab-runner.md`).

**한눈에 보기**

```
GitHub Nocharm/bpm (개발 원본)
   │  Windows PC: git pull → git push gitlab dev / git push gitlab main (+ 태그)
   ▼
사내 GitLab 프로젝트 (CE, Private)
   │  dev  파이프라인: test 3개 → deploy-dev 자동
   │  main 파이프라인: test 3개 → deploy-production ▶ (수동)
   ▼
서버 러너 컨테이너 gitlab-runner-bpm
   ├─ bpm-test   : 테스트 Job (도커 소켓 없음)
   └─ bpm-deploy : 배포 Job (Protected, 도커 소켓 + 배포 폴더 두 개)
                     │ ci/deploy.sh
                     ▼
     /data/deployments/bpm      (.env, backups/)  ──compose -p business-process-mgmt──▶ 운영 :9900
     /data/deployments/bpm-dev  (.env)            ──compose -p bpm-9910──────────────▶ 개발 :9901
```

| | 운영 | 개발 |
|---|---|---|
| 포트 | 9900 | **9901**(예전 9910) |
| 브랜치·트리거 | `main` 파이프라인에서 `deploy-production` ▶ | `dev` push마다 `deploy-dev` 자동 |
| 배포 폴더 | `/data/deployments/bpm` | `/data/deployments/bpm-dev` |
| compose 프로젝트 | `business-process-mgmt` | `bpm-9910` |
| DB 볼륨 | `business-process-mgmt_pgdata` | `bpm-9910_pgdata` |
| dbv-shared db 별칭 | `bpm-db` | `bpm9910-db` |
| 로그인 | Keycloak(`AUTH_MODE=keycloak`만 통과) | 지금은 임시 로그인(`AUTH_MODE=dev` + `DEV_ENFORCE_PERMISSIONS=true`). keycloak·ldap도 통과 |
| 백업 사이드카 | 켬(compose profile `backup`) | 없음 |
| GitLab environment · resource_group | `production` · `bpm-production` | `dev` · `bpm-dev` |

- **개발 프로젝트 이름은 `bpm-9910` 그대로다.** 포트는 9901로 옮기지만 프로젝트 이름을 바꾸면 compose가 새 빈 볼륨을 만든다. 이름은 볼륨을 이어 쓰기 위한 것이라 포트와 어긋나도 둔다. 같은 이유로 db 별칭 `bpm9910-db`도 그대로다(db-viewer 등록을 다시 하지 않는다).
- **파이프라인으로 옮긴 것은 배포뿐이다.** 운영·진단·비상 절차(`logs`·`ps`·`exec db psql`, 백업 복구, 서브넷 확인)는 서버의 배포 폴더에서 사람이 손으로 한다. 손으로 칠 때도 `-p <프로젝트>`를 붙인다(9절).
- **이미지 레지스트리·DinD를 쓰지 않는다.** 서버는 Docker Hub가 막혀 DinD가 베이스 이미지를 못 받는다. 배포 Job이 서버 Docker 소켓으로 서버 데몬에서 `docker compose up -d --build`를 돌린다(베이스 이미지는 tar로 반입해 둔 것, [`deploy.md`](deploy.md) §0).
- **배포 Job 안의 compose는 호스트 compose가 아니다.** `docker:27-cli` 이미지 안의 compose·buildx 플러그인을 쓰고, 공유하는 것은 서버 데몬뿐이다. 비상 수동 경로(9절)는 호스트 compose로 돌아 버전이 다르다.
- **배포할 수 있는 사람 = `main`이나 `dev`에 push·merge할 수 있는 사람이다.** 배포 러너는 도커 소켓을 쓰므로 서버 root와 같고, CE에는 protected environments가 없다. `dev`는 push만으로 배포되니 `main`과 똑같이 막는다(1절).

파일:

| 파일 | 역할 |
|---|---|
| `.gitlab-ci.yml` | `workflow`(MR·`main`/`dev` push·웹 실행만), test 3개(`backend-test`·`frontend-test`·`deploy-script-test`), `deploy-dev`(`dev`에서 자동)·`deploy-production`(`main`에서 ▶). 어느 스택인지는 Job 변수 `BPM_DEPLOY_ENV`·`BPM_DEPLOY_DIR`·`BPM_COMPOSE_PROJECT`가 정한다 |
| `ci/deploy.sh` | 배포 Job 본체(POSIX sh, busybox). 가드 → 사전 점검 → 동기화 → `compose up -d --build` → proxy 재시작(운영은 db-backup 재생성) → 헬스체크 → 내부 대역 대조 |
| `ci/test-deploy.sh` | 가짜 `docker`로 `ci/deploy.sh`를 두 스택 모두 검증(`deploy-script-test` Job, 로컬에서도 `sh ci/test-deploy.sh`) |

**결정: 배포 러너는 하나, `dev`도 Protected 브랜치로 둔다.** 배포 러너는 Protected라 보호된 브랜치의 Job만 잡는다. 개발용 러너를 따로 두는 대신 `dev`를 Protected branches에 넣었다. 개발 러너를 따로 둬도 도커 소켓을 쓰는 한 서버 root와 같아서, 보호를 빼면 `dev`에 push할 수 있는 누구나 서버를 쥔다. 러너 하나가 두 배포 폴더를 모두 마운트하고 `--limit 1`이라 운영·개발 배포는 한 번에 하나씩 돈다.

---

## 1. GitLab 프로젝트 설정

1. **Settings → Repository → Protected branches**: `main`과 `dev` 둘 다 — Allowed to merge **Maintainers**, Allowed to push and merge **Maintainers**, 강제 푸시 끔. `dev`를 빼면 `deploy-dev`가 `pending`에서 멈춘다(배포 러너가 Protected).
2. **Settings → General → Visibility**: 프로젝트 **Private**. **Settings → CI/CD → General pipelines**: **Public pipelines 끔**.
3. **Auto DevOps가 켜져 있으면 끈다**(Settings → CI/CD → Auto DevOps).
4. **Settings → CI/CD → General pipelines**에서 둘 다 켠다:
   - **Prevent outdated deployment jobs** — 더 새 배포가 끝난 뒤 옛 배포 Job이 늦게 돌아 덮어쓰지 않게.
   - **Allow job retries for rollback deployments** — 옛 파이프라인의 배포 Job Retry로 되돌리기(8절).
5. **CI/CD 변수는 두지 않는다.** 배포 폴더·프로젝트 이름은 `.gitlab-ci.yml`의 Job 변수에 있다. 같은 이름을 프로젝트 CI 변수로 만들면 두 Job에 똑같이 덮여 한쪽이 다른 스택으로 향한다(배포 스크립트의 가드가 막지만 처음부터 두지 않는다). 비밀값은 `.env`에만 둔다. 다른 CI 변수(`AUTH_MODE`·`POSTGRES_*`·`COMPOSE_*`·`DOCKER_HOST` 등)는 compose에 닿지 않는다. 배포 스크립트가 모든 `docker` 호출을 빈 환경(`env -i`)에서 한다.
   - 예외: 진짜 새 스택을 처음 띄울 때만 **Run pipeline** 화면에서 실행 변수 `BPM_ALLOW_NEW_DB=1`을 준다(3절 가드).
6. **Settings → CI/CD → Runners → New project runner**를 두 번 만든다. `glrt-`로 시작하는 토큰은 한 번만 보이니 바로 2절 등록에 쓴다.

   | 항목 | 테스트 러너 | 배포 러너 |
   |---|---|---|
   | Tags | `bpm-test` | `bpm-deploy` |
   | Run untagged jobs | 끔 | 끔 |
   | Protected | 끔 | **켬**(보호된 `main`·`dev`에서만 돈다) |
   | Description | `bpm test` | `bpm deploy` |

## 2. 서버 1회 — 러너 컨테이너와 등록

BPM 전용 러너 컨테이너를 새로 띄운다. **다른 팀·sop-archivist의 러너 컨테이너는 건드리지 않는다**(설정을 읽기만 한다).

### 2-1. 기존 러너에서 네트워크·TLS 설정 읽기

GitLab이 같은 서버에서 돈다. `external_url`이 브리지 네트워크 컨테이너에서 안 풀리거나 사설 CA를 쓰면 모든 Job이 clone 단계에서 죽는다. 이미 동작하는 러너(sop-archivist 것이면 그대로 따라 하면 된다)가 어떻게 풀었는지 **키 이름으로만** 읽는다(`config.toml`을 통째로 출력하지 않는다, 토큰이 있다).

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i runner      # 기존 러너 이름 확인
docker exec <기존 러너> grep -E '^\s*(clone_url|network_mode|extra_hosts|dns|tls-ca-file|helper_image|pull_policy)\s*=' /etc/gitlab-runner/config.toml
docker inspect <기존 러너> --format 'net={{.HostConfig.NetworkMode}} hosts={{.HostConfig.ExtraHosts}} dns={{.HostConfig.Dns}}'
docker inspect <기존 러너> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'   # CA 인증서 폴더 마운트 여부
```

`network_mode`·`extra_hosts`·`dns`·`clone_url`·`tls-ca-file`은 Job 컨테이너 설정(등록 플래그), `docker inspect`의 net·hosts·dns·CA 마운트는 러너 컨테이너 자신의 설정(`docker run` 옵션)이다.

### 2-2. 러너 이미지

기존 러너와 같은 gitlab-runner 이미지를 쓴다. **helper 이미지 버전과 러너 버전이 같아야 한다.**

```bash
docker run --rm --entrypoint gitlab-runner <러너 이미지> --version     # 예: Version: 19.0.0
docker image inspect gitlab/gitlab-runner-helper:x86_64-v19.0.0 docker:27-cli python:3.11-slim node:24.22.1-alpine --format '{{.RepoTags}}'
```

넷 중 없는 것은 tar로 반입한다([`deploy.md`](deploy.md) §0). 아래 helper 태그는 러너 버전에 맞춘다.

### 2-3. 러너 컨테이너

```bash
sudo mkdir -p /data/gitlab-runners/bpm     # sudo가 없으면 홈 아래 폴더
docker run -d --name gitlab-runner-bpm --restart unless-stopped \
  -v /data/gitlab-runners/bpm:/etc/gitlab-runner \
  -v /var/run/docker.sock:/var/run/docker.sock \
  <러너 이미지>
# 2-1에서 기존 러너 컨테이너가 --network host·--add-host·--dns·CA 마운트를 썼다면 같은 옵션을 위에 더한다.
```

### 2-4. 러너 두 개 등록

토큰은 `read -rs`로 받아 화면·셸 기록에 남기지 않고, 환경 변수로 넘겨 프로세스 목록에도 남기지 않는다(`docker exec -e 이름`은 값 없이 호스트 환경에서 가져온다).

```bash
GITLAB_URL='<gitlab-url>'
PROD_DIR=/data/deployments/bpm          # 바꾸면 .gitlab-ci.yml deploy-production의 BPM_DEPLOY_DIR도
DEV_DIR=/data/deployments/bpm-dev       # 바꾸면 .gitlab-ci.yml deploy-dev의 BPM_DEPLOY_DIR도
COMMON="--non-interactive --url $GITLAB_URL --executor docker \
  --docker-pull-policy never \
  --docker-helper-image gitlab/gitlab-runner-helper:x86_64-v19.0.0 \
  --limit 1"
# 2-1에서 값이 나온 키만 더한다. 예:
# COMMON="$COMMON --clone-url <값> --docker-network-mode <값> --docker-extra-hosts <host:ip> --docker-dns <값> --tls-ca-file <값>"
```

테스트 러너(`bpm-test` 토큰):

```bash
read -rs CI_SERVER_TOKEN && export CI_SERVER_TOKEN
docker exec -e CI_SERVER_TOKEN gitlab-runner-bpm gitlab-runner register $COMMON \
  --name bpm-test --docker-image python:3.11-slim
unset CI_SERVER_TOKEN
```

배포 러너(`bpm-deploy` 토큰) — 도커 소켓과 **배포 폴더 두 개를 양쪽 같은 경로로** 마운트한다:

```bash
read -rs CI_SERVER_TOKEN && export CI_SERVER_TOKEN
docker exec -e CI_SERVER_TOKEN gitlab-runner-bpm gitlab-runner register $COMMON \
  --name bpm-deploy --docker-image docker:27-cli \
  --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
  --docker-volumes "$PROD_DIR:$PROD_DIR:rw" \
  --docker-volumes "$DEV_DIR:$DEV_DIR:rw"
unset CI_SERVER_TOKEN
```

- `$COMMON`은 일부러 따옴표 없이 쓴다(여러 플래그로 나뉘어야 한다).
- `CI_SERVER_TOKEN` 환경 변수를 이 버전이 읽지 못해 등록이 토큰을 물으며 실패하면, 그때만 `--token "$CI_SERVER_TOKEN"`을 더한다(값이 잠깐 프로세스 목록에 보인다).
- **`pull_policy = never`인 이유**: 서버에 있는 이미지만 쓴다. `if-not-present`는 없는 이미지를 막힌 Docker Hub에서 받으려다 느린 타임아웃으로 죽어 원인이 흐려진다.
- **배포 폴더 마운트가 `같은경로:같은경로`여야 하는 이유**: compose의 상대 bind 경로(`./nginx/default.conf`, `./scripts/db-backup.sh`, `./backups`, `./docs/manual`)는 배포 폴더 기준 절대 경로로 바뀌어 **호스트 데몬이** 찾는다. 경로가 다르면 데몬이 없는 호스트 경로를 빈 root 폴더로 만들어 nginx가 "not a directory"로 죽는다. 배포 스크립트가 새 컨테이너로 호스트 쪽 경로를 확인해 막는다.
- 배포 폴더는 마운트 전에 있어야 한다(3절). 없는 폴더를 마운트하면 데몬이 빈 root 폴더를 만든다.

### 2-5. 동시 실행 수와 확인

```bash
docker exec gitlab-runner-bpm sed -i 's/^concurrent = .*/concurrent = 2/' /etc/gitlab-runner/config.toml
docker exec gitlab-runner-bpm grep -E '^concurrent' /etc/gitlab-runner/config.toml   # concurrent = 2
docker exec gitlab-runner-bpm gitlab-runner verify
```

GitLab 화면(Settings → CI/CD → Runners)에서 두 러너가 **Online**인지 본다.

## 3. 배포 폴더 두 개

배포 Job이 checkout을 복사해 넣고 compose를 돌리는 곳이다. **사람이 두는 것은 `.env` 하나**이고, 운영의 `backups/`는 백업 사이드카가 쓴다. **그 밖의 파일은 배포 때마다 지워진다** — 덤프·tar 보관 같은 다른 용도로 쓰지 않는다.

```bash
sudo mkdir -p /data/deployments/bpm /data/deployments/bpm-dev
sudo chown "$USER": /data/deployments/bpm /data/deployments/bpm-dev
chmod 750 /data/deployments/bpm /data/deployments/bpm-dev
```

`.env`는 지금 쓰는 파일을 옮긴다(6절). 새로 만들 때는 `.env.example`을 복사해 채운다([`deploy.md`](deploy.md) §2). 파일 권한은 `chmod 600`.

- `.env`는 git·CI 변수에 넣지 않는다. 배포 Job은 읽기만 하고 값을 출력하지 않는다(가드는 키 이름과 판정만 쓴다).
- 배포 Job은 컨테이너 root로 돌아 **복사된 파일은 root 소유가 된다**(정상). `.env`는 건드리지 않는다.
- 배포 폴더에 `.git`은 없다. 무엇이 배포됐는지는 `cat <배포 폴더>/.deployed`(스택·프로젝트·커밋·브랜치·파이프라인·Job·버전·시각, 비밀 없음).
- 상대 bind 경로는 배포 폴더 기준이다. `BACKUP_DIR=./backups`면 `/data/deployments/bpm/backups`다.

배포 스크립트가 거절하는 것(가드가 걸리면 아무것도 지우지 않고 compose에도 가지 않는다):

| 대상 | 운영 | 개발 |
|---|---|---|
| 인증 | `AUTH_MODE`(비면 `AUTH_ENABLED`로 유도)가 keycloak이 아니면 거절 | keycloak·ldap·dev 통과. dev면 `DEV_ENFORCE_PERMISSIONS=true` 필수(없으면 전원 sysadmin), ldap이면 `AUTH_JWT_SECRET` 필수 |
| `APP_PORT` | 비었거나 9900만 | 9900이 아닌 값 필수(9901) |
| `DBV_DB_ALIAS` | 공유 네트워크에서 다른 프로젝트가 쓰는 별칭이면 거절 | 같은 검사 + 비었거나 `bpm-db`(운영 것)면 거절 |
| 공통 | `POSTGRES_PASSWORD`가 비었거나 `change-me` · `COMPOSE_PROJECT_NAME`이 Job의 프로젝트와 다름 · `COMPOSE_FILE`/`COMPOSE_PROFILES`를 적음 · `BACKUP_DIR`이 `./backups`가 아닌 배포 폴더 안 경로 | 같음 |

`.env` 밖에서 확인하는 것: 배포 폴더 경로(절대 경로·두 단계 이상·checkout과 겹치지 않음), 새 컨테이너로 본 호스트 경로, 공유 네트워크 `dbv-shared`, 베이스 이미지(Dockerfile FROM과 compose `image:`), **이 프로젝트의 컨테이너가 다른 폴더에서 떠 있지 않은지**(손으로 띄운 옛 스택, 또는 프로젝트 이름이 다른 스택을 가리킴), **DB 볼륨 `<프로젝트>_pgdata`가 있는지**(프로젝트 이름을 잘못 쓰면 빈 DB가 옆에 새로 뜬다).

## 4. 평소 흐름

1. Windows PC에서 GitHub를 받고 사내 GitLab으로 올린다:

   ```bash
   git pull
   git push gitlab dev          # 개발 9901: 테스트 통과 뒤 자동 배포
   git push gitlab main         # 운영 9900: 테스트 통과 뒤 ▶ 대기
   git push gitlab vX.Y.Z       # 이번 버전 태그(CHANGELOG.md). 태그 push는 파이프라인을 만들지 않는다
   ```

2. GitLab **Build → Pipelines**에서 test 3개가 통과하는지 본다. `dev`는 그대로 `deploy-dev`가 돈다. `main`은 파이프라인이 **blocked**(▶ 대기)로 보인다 — 정상.
3. 운영은 `CHANGELOG.md`의 그 버전 배포 메모를 읽고 `deploy-production`의 **▶**를 누른다.
4. Job 로그 끝에서 `[deploy] health: /api/health ok, auth mode <모드>, / 200`, 내부 대역 줄, `docker compose ps`, `[deploy] done`을 본다. `WARNING: .env FORWARDED_ALLOW_IPS ...`가 있으면 5절.
5. 브라우저 확인 — [`deploy.md`](deploy.md) §4(로그인, **상단 바 버전이 배포한 버전과 같은지**).
6. 운영이면 `CHANGELOG.md` 그 버전 항목에 배포일을 적는다(GitHub에서 커밋, 다음 push 때 GitLab에도 간다).

## 5. `.env`만 바꿀 때 · 내부 대역 → `FORWARDED_ALLOW_IPS`

1. 서버 배포 폴더의 `.env`를 고친다.
2. GitLab **Build → Pipelines → Run pipeline**, 브랜치 `dev`(개발) 또는 `main`(운영) → 개발은 자동 배포, 운영은 test 뒤 ▶.

손으로 `docker compose up`을 치지 않는다. 코드가 같아 이미지는 캐시로 빌드되고, compose가 env가 바뀐 backend만 다시 만들며, 스크립트가 proxy를 재시작한다(nginx는 upstream 이름을 시작할 때 한 번만 풀어서, backend만 바뀌면 옛 주소로 `/api`가 502).

**내부 대역.** compose default 네트워크 대역은 Docker가 자동으로 정한다(서버 데몬의 `default-address-pools`). backend(uvicorn)가 `X-Forwarded-For`를 믿을 대역이 이 서브넷이어야 로그인 기록·스로틀이 실제 클라이언트 주소를 본다. 비어 있으면 앱은 돌지만 주소가 nginx 것으로 찍힌다. 배포 Job은 매번 실제 서브넷과 `.env`를 대조해 어긋나면 `WARNING`을 남긴다(값은 출력하지 않고 서브넷만 보여 준다). 스택마다 따로 한다:

```bash
docker network inspect business-process-mgmt_default -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # 운영
docker network inspect bpm-9910_default -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'                # 개발
```

나온 값을 그 스택의 `.env`에 적고(`FORWARDED_ALLOW_IPS=<서브넷>`) 위 1·2를 한다. Job 로그에 `FORWARDED_ALLOW_IPS covers the compose network ...`가 나오면 끝이다.

- 자동 할당 대역은 그 네트워크가 지워졌다 다시 생길 때(`down` 뒤 `up`) 바뀔 수 있다. 배포 Job은 `down`을 하지 않으므로 평소에는 그대로다. 바뀌면 이 절을 다시 한다.
- 서브넷은 오버라이드 파일로 바꾸지 못한다 — compose가 `ipam.config`를 교체하지 않고 누적 병합해 `Pool overlaps with other one`으로 실패한다(BPM 실측). 고정 대역이 다시 필요하면 `docker-compose.yml`의 `networks.default`를 직접 고친다.

## 6. 손으로 띄운 스택에서 넘어가기 (1회, 데이터 보존이 최우선)

지금 운영(9900)과 개발(9910)은 사람이 서버 폴더에서 `docker compose`로 띄웠고, compose 네트워크는 고정 대역(운영 172.36, 개발 172.44)이다. 파이프라인으로 넘어가면서 대역도 자동 할당으로 바뀐다. **이미 있는 네트워크의 대역은 compose가 바꾸지 않으므로** 스택마다 한 번만 사람이 `down`을 한다. 파이프라인은 `down`을 하지 않는다.

**개발을 먼저 넘겨 리허설하고, 운영은 사용이 적은 시간에 한다.** 운영은 6-3의 `down`부터 첫 배포 헬스체크까지 멈춘다(빌드 포함 수 분~수십 분).

> **절대 `down -v` 금지.** `-v`는 DB 볼륨을 지운다. `docker system prune`·`image prune -a`도 하지 않는다(빌드 전용 베이스 이미지가 지워지면 다시 받을 수 없다).

### 6-0. 전제 확인

```bash
grep -A6 default-address-pools /etc/docker/daemon.json     # 사내망과 겹치지 않는 풀이 있어야 한다
docker network inspect $(docker network ls -q) -f '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'   # 지금 쓰는 대역들
docker network inspect dbv-shared -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # 있어야 한다(건드리지 않는다)
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'node:24.22.1-alpine|python:3.11-slim|nginx:1.27-alpine|postgres:16-alpine|docker:27-cli'
```

- 예전 172.36 고정은 기본 풀이 사내망과 겹쳐서 넣었다(커밋 `f85a2864`). 데몬 풀이 설정돼 있지 않으면 자동 할당이 그 충돌을 되살리니, 풀부터 잡는다(데몬 재시작이 필요해 서버의 모든 컨테이너가 영향을 받는다 — 인프라 담당과 정한다).
- 1·2절(GitLab 설정, 러너 등록)과 3절의 폴더 만들기를 먼저 끝낸다.

### 6-1. 지금 이름과 위치 확인

추측하지 말고 서버에서 읽는다. 프로젝트 이름이 `.gitlab-ci.yml`의 `BPM_COMPOSE_PROJECT`와 같아야 볼륨을 이어 쓴다.

```bash
docker ps -a --format '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Names}}' | grep -E 'bpm|business-process' | sort -u
docker volume ls | grep -E 'bpm|business-process'
# 기대: business-process-mgmt  <운영 폴더>   …   /  bpm-9910  <개발 폴더(~/bpm-dev 등)>  …
#       business-process-mgmt_pgdata, bpm-9910_pgdata
```

이름이 다르면 **여기서 멈추고** `.gitlab-ci.yml`의 `BPM_COMPOSE_PROJECT`를 실제 이름으로 고쳐 push한 뒤 이어 간다. 개발의 옛 env 파일이 `.env.9910`인지 `.env`인지도 확인한다(옛 명령이 `--env-file .env.9910`이었다).

### 6-2. 덤프

`-t`를 붙이지 않는다(TTY가 바이너리 덤프를 깨뜨린다). 덤프는 배포 폴더 **밖**에 둔다(배포 폴더는 매번 지워진다).

```bash
mkdir -p ~/bpm-switch-dumps && cd ~/bpm-switch-dumps
docker exec -i business-process-mgmt-db-1 pg_dump -U processmap -d processmap -Fc > bpm-prod-$(date +%Y%m%d-%H%M).dump
docker exec -i bpm-9910-db-1 pg_dump -U processmap -d processmap -Fc > bpm-dev-$(date +%Y%m%d-%H%M).dump
ls -lh *.dump                                                                       # 0바이트 아님
docker run --rm -i postgres:16-alpine pg_restore --list < bpm-prod-*.dump | head -5   # 아카이브가 읽히는지
```

컨테이너 이름·`POSTGRES_USER`/`POSTGRES_DB`가 다르면 6-1 결과와 각 `.env`에 맞춘다. 운영은 `backups/`의 최신 일간 덤프도 함께 있다([`backup.md`](backup.md)).

### 6-3. 옛 스택 내리기 (`-v` 없이)

옛 폴더에서, 옛 스택을 띄울 때와 같은 프로젝트 이름·env 파일로 내린다. 컨테이너와 default 네트워크만 지워지고 볼륨은 남는다.

```bash
cd <개발 옛 폴더>        && docker compose -p bpm-9910 --env-file .env.9910 down     # 개발 (env 파일 이름은 6-1 결과대로)
cd <운영 옛 폴더>        && docker compose -p business-process-mgmt down             # 운영 (리허설이 끝난 뒤)
docker volume ls | grep -E 'bpm|business-process'      # 볼륨이 그대로 있는지 — 없으면 멈추고 6-2 덤프로 복구
docker network ls | grep -E 'bpm-9910_default|business-process-mgmt_default'   # 비어 있어야 한다
```

개발의 db-backup 컨테이너도 이때 사라지고, 이후 개발은 백업하지 않는다.

### 6-4. 배포 폴더 채우기

```bash
cp <운영 옛 폴더>/.env /data/deployments/bpm/.env
cp <개발 옛 폴더>/.env.9910 /data/deployments/bpm-dev/.env      # 옛 개발 env 파일
chmod 600 /data/deployments/bpm/.env /data/deployments/bpm-dev/.env
```

두 `.env`를 연다(`vi`). 화면에 띄우지 말고 편집기로만 본다.

- 공통: `FORWARDED_ALLOW_IPS` 줄은 비우거나 지운다(옛 172.36·172.44는 더 이상 맞지 않는다, 6-6에서 채운다). `COMPOSE_PROJECT_NAME`이 있으면 Job의 프로젝트 이름과 같아야 하고, `COMPOSE_FILE`·`COMPOSE_PROFILES`는 지운다.
- 운영: `AUTH_MODE=keycloak`(비어 있으면 그렇게 적는다), `APP_PORT`는 9900 또는 비움, `DBV_DB_ALIAS`는 `bpm-db` 또는 비움.
- 개발: `APP_PORT=9901`, `DBV_DB_ALIAS=bpm9910-db`, 임시 로그인이면 `AUTH_MODE=dev`·`DEV_ENFORCE_PERMISSIONS=true`·`BPM_SYSADMINS=<관리자로 쓸 임시 아이디>`가 있는지.
- `BACKUP_DIR`: 운영이 `./backups`면 옛 폴더의 백업을 옮긴다. 배포 폴더 밖 절대 경로면 그대로 둔다(옮기지 않는다). 개발 백업은 옮기지 않는다(보관할지는 사람이 정한다).

```bash
sudo mv <운영 옛 폴더>/backups /data/deployments/bpm/backups    # 운영, BACKUP_DIR=./backups일 때만 (root 0700이라 sudo)
```

- 개발이 Keycloak 로그인으로 바뀌면 Keycloak 클라이언트에 `:9901` redirect URI·Web origins를 더한다([`setup-once.md`](setup-once.md) A2). 지금 같은 임시 로그인이면 필요 없다.
- 9910으로 접속하던 사람에게 9901로 바뀐다고 알린다.

### 6-5. 첫 파이프라인

```bash
git push gitlab dev       # PC에서 — deploy-dev가 자동으로 돈다
```

`main`은 **Run pipeline**(브랜치 `main`) 또는 push 뒤 `deploy-production` ▶. 첫 배포에서는 가드가 볼륨을 확인한다(`db volume: <프로젝트>_pgdata (existing data is kept)`). `does not exist`로 멈추면 프로젝트 이름이 틀린 것이다. `BPM_ALLOW_NEW_DB=1`로 우회하지 말고 6-1로 돌아간다. `has containers started from <옛 폴더>`로 멈추면 6-3을 빠뜨린 것이다.

### 6-6. 대역 확인 → `.env` 기입 → 재실행

Job 로그의 `WARNING: .env FORWARDED_ALLOW_IPS is empty; the compose network is <서브넷>`에서, 또는 5절 명령으로 서브넷을 확인한다. 그 스택 `.env`에 `FORWARDED_ALLOW_IPS=<서브넷>`을 적고 5절대로 파이프라인을 다시 돌린다.

### 6-7. 확인과 정리

```bash
cd /data/deployments/bpm-dev && docker compose -p bpm-9910 ps           # 4개 서비스 Up (db-backup 없음)
cd /data/deployments/bpm && docker compose -p business-process-mgmt --profile backup ps   # 5개 서비스 Up
docker compose -p business-process-mgmt --profile backup logs --tail 3 db-backup      # 첫 덤프
docker compose -p business-process-mgmt exec -T db psql -U processmap -d processmap -c 'SELECT count(*) FROM process_maps;'   # 6-2 전과 같은지
```

브라우저로 두 포트에 로그인해 맵 목록·상단 바 버전을 본다. 옛 폴더와 6-2 덤프는 **한동안 지우지 않는다**. 운영이 몇 번의 배포를 문제없이 지난 뒤 정리한다.

## 7. 트러블슈팅

| 증상 | 확인 |
|---|---|
| Job이 `pending`에서 멈춤 | 러너가 **Online**인지(Paused 아님), Job 태그와 러너 태그 철자(`bpm-test`·`bpm-deploy`). 배포 Job은 **Protected 러너**라 보호된 브랜치에서만 잡힌다 — `main`·`dev`가 둘 다 Protected branches에 있는지(1절). 러너 로그: `docker logs --tail 50 gitlab-runner-bpm` |
| clone 단계 실패(`Could not resolve host`, `SSL certificate problem`) | 2-1의 `clone_url`·`network_mode`·`extra_hosts`·`dns`·`tls-ca-file`을 기존 러너와 맞춘다. 고친 뒤 `docker exec gitlab-runner-bpm gitlab-runner verify` |
| `image ... not present locally` / `pull_policy ([never])` | 서버에 없는 이미지는 받지 않는다. amd64 tar로 반입한다([`deploy.md`](deploy.md) §0). helper 이미지도 같다(러너 버전과 같은 태그) |
| `frontend-test`가 `JavaScript heap out of memory`로 죽음 | eslint가 node 기본 힙(컨테이너에서 약 2.2GB)을 넘는다. Job의 `NODE_OPTIONS=--max-old-space-size=4096`이 빠졌거나 서버 메모리가 모자란다(lint 한 번에 수 GB) |
| `backend-test`의 pip, `frontend-test`의 npm 접속 실패 | 테스트 Job 컨테이너가 PyPI·npm 레지스트리에 닿지 않는다. 같은 서버에서 이미지 빌드(`pip install`·`npm ci`)가 되는지와 2-1의 네트워크 설정을 본다 |
| `BPM_DEPLOY_ENV must be ...` / `BPM_COMPOSE_PROJECT ...` / `BPM_DEPLOY_DIR is empty` | `.gitlab-ci.yml`의 Job 변수가 없거나 잘못됐다. 같은 이름의 CI 변수를 만들었으면 지운다(1절 5) |
| `deploy folder does not exist inside the job` | 배포 러너에 그 폴더의 `--docker-volumes`가 빠졌거나 경로가 `BPM_DEPLOY_DIR`과 다르다(2-4) |
| `... must be an absolute path` / `is '/'` / `two levels deep` / `must not contain` | `BPM_DEPLOY_DIR` 값이 잘못됐다 |
| `... is the job checkout or inside it` / `job checkout is inside the deploy folder` | `BPM_DEPLOY_DIR`이 `/builds` 쪽을 가리킨다 |
| `no .env in the deploy folder` | 3절·6-4대로 `.env`를 넣는다 |
| `POSTGRES_PASSWORD is empty or the .env.example placeholder` | `.env`의 DB 비밀번호. 옛 스택에서 옮긴 값이어야 볼륨의 DB에 붙는다 |
| `production must be keycloak` / `not a value the backend accepts` | 운영 `.env`에 `AUTH_MODE=keycloak`. 개발 `.env`를 운영 폴더에 넣지 않았는지 |
| `without DEV_ENFORCE_PERMISSIONS=true` | 개발 `.env`가 임시 로그인인데 권한 분리가 꺼졌다. `DEV_ENFORCE_PERMISSIONS=true`와 `BPM_SYSADMINS` |
| `without AUTH_JWT_SECRET` | ldap 로그인에는 서명키가 필요하다(`openssl rand -hex 32`) |
| `APP_PORT is not 9900` / `the dev stack needs its own port` | 두 스택의 `.env`가 뒤바뀌었거나 포트를 안 적었다 |
| `COMPOSE_PROJECT_NAME differs` / `.env sets COMPOSE_FILE`·`COMPOSE_PROFILES` | 다른 스택의 `.env`이거나 옛 설정이 남았다. 지우거나 맞춘다(6-4) |
| `DBV_DB_ALIAS is empty or 'bpm-db'` / `db alias '...' is already used` | 공유 네트워크의 db 별칭이 겹친다. 겹치면 db-viewer 연결 테스트가 초록인데 엉뚱한 DB에 붙는다. 개발은 `bpm9910-db`, sop-archivist는 `sop-archivist-db` |
| `BACKUP_DIR points inside ...` / `is a relative path other than ./backups` | `BACKUP_DIR`을 비우거나 `./backups`, 또는 배포 폴더 밖 절대 경로로 |
| `the host does not see the deploy folder at the same path` | 배포 러너 마운트가 `다른경로:배포폴더`다. 양쪽 같은 경로로(2-4, `config.toml`의 `volumes` 줄을 고쳐도 된다) |
| `cannot reach the Docker daemon` | 배포 러너에 `/var/run/docker.sock` 마운트가 없다 |
| `shared network '...' (DBV_NETWORK) does not exist` | [`setup-once.md`](setup-once.md) A9대로 만든다. 배포 Job은 네트워크를 만들지 않는다 |
| `base image(s) missing on the server: ...` | 찍힌 이미지를 tar로 반입한다. 프룬 뒤에 흔하다 |
| `project ... has containers started from <폴더>` | 손으로 띄운 옛 스택이 아직 있다(6-3), 또는 `BPM_COMPOSE_PROJECT`가 다른 스택 이름이다. 파이프라인은 그 컨테이너를 건드리지 않고 멈췄다 |
| `db volume <프로젝트>_pgdata does not exist` | 프로젝트 이름이 실제와 다르다(`docker volume ls`, 6-1). 진짜 새 스택일 때만 Run pipeline 변수 `BPM_ALLOW_NEW_DB=1` |
| `docker compose config rejected the deploy folder` | `.env` 문법이나 필수 값 문제. 출력은 비밀값이 펼쳐져 숨겼다 — 배포 폴더에서 `docker compose -p <프로젝트> config --quiet`로 오류 줄만 본다(`--quiet` 없이 돌리지 않는다) |
| `docker compose up failed` | 바로 위 로그가 빌드·기동 오류다. [`deploy.md`](deploy.md) §5 표 |
| `the app did not become healthy in time` / `/api/auth/mode reports a mode other than ...` | Job 로그 끝의 `ps`와 backend·proxy 로그 80줄. 더 보려면 배포 폴더에서 `docker compose -p <프로젝트> logs --tail 200 backend`. 큰 DB의 첫 기동이 5분을 넘기면 다시 돌린다(이미 뜬 것은 이어진다) |
| `WARNING: .env FORWARDED_ALLOW_IPS ...` | 5절. 배포는 성공한 상태다 |
| 로컬에서 `sh ci/test-deploy.sh` 실패 | 배포 스크립트를 고쳤다면 테스트의 기대 문구도 같이 본다. busybox(`docker:27-cli`)·GNU·macOS 모두에서 돌아야 한다 |

## 8. 되돌리기(롤백)

평소에는 revert 커밋을 올려 **앞으로 고친다**(GitHub → GitLab push → 배포).

급하면 **이전 파이프라인의 배포 Job을 Retry한다**(운영은 `main`의 `deploy-production`, 개발은 `dev`의 `deploy-dev`). 그 Job은 그때의 커밋을 checkout해 같은 절차로 배포한다. 1절 4의 두 설정이 켜져 있어야 한다.

- **파이프라인이 생기기 전 버전으로는 Retry로 못 돌아간다**(그 버전에는 `.gitlab-ci.yml`·`ci/`가 없다). 그때는 9절.
- **DB 스키마는 앱 기동이 덧붙이는 방식이라 옛 코드도 대체로 같은 DB에서 돈다**([`deploy.md`](deploy.md) §3). 컬럼 삭제·개명이 든 버전이면 `CHANGELOG.md`의 배포 메모를 보고, 필요하면 배포 직전 덤프로 복구한 뒤 Retry한다([`backup.md`](backup.md) §3). DB 복구는 자동화하지 않았다.
- 배포 폴더에는 `.git`이 없어 `git checkout <tag>`가 통하지 않는다.

## 9. 비상 수동 경로 · 손으로 치는 compose

**러너가 죽어 고칠 수 없을 때만** 배포를 손으로 한다. 파이프라인 밖 배포는 기록이 남지 않고 가드도 돌지 않는다. 진단 명령(`ps`·`logs`·`exec`)은 평소에도 손으로 친다. **어느 경우든 배포 폴더에서 `-p`를 붙인다** — 빠뜨리면 폴더 이름(`bpm`, `bpm-dev`)이 프로젝트가 되어 엉뚱한 빈 스택이 뜬다. 운영은 `--profile backup`도 붙인다(빼면 db-backup이 목록에 없고 `up`이 사이드카를 만들지 않는다).

```bash
# 운영
cd /data/deployments/bpm
docker compose -p business-process-mgmt --profile backup up -d --build
docker compose -p business-process-mgmt --profile backup restart proxy
docker compose -p business-process-mgmt --profile backup up -d --force-recreate db-backup   # scripts/db-backup.sh가 바뀐 경우만
curl -s http://localhost:9900/api/health

# 개발
cd /data/deployments/bpm-dev
docker compose -p bpm-9910 up -d --build
docker compose -p bpm-9910 restart proxy
curl -s http://localhost:9901/api/health
```

새 코드를 넣어야 하면 PC에서 `git archive --format=tar.gz -o bpm.tar.gz vX.Y.Z`로 묶어 scp한 뒤, 배포 폴더에서 `.env`·`backups/`를 남기고 풀어 위 명령을 친다. 러너를 고친 뒤 다음 배포는 파이프라인으로 해서 배포 폴더를 파이프라인 상태(`.deployed`)로 되돌린다.

## 확인 범위

- 로컬에서 확인한 것: `ci/test-deploy.sh`(두 스택 케이스, busybox `docker:27-cli`·GNU(Debian)·macOS sh·dash), 핵심 가드를 하나씩 빼 본 변이 시험(모두 테스트가 잡음), `.gitlab-ci.yml` YAML 파싱, `docker compose config`(profile 유무에 따른 서비스 목록), CI의 테스트 명령을 Job과 같은 이미지에서(backend `python:3.11-slim` root 실행 — root에서는 성립하지 않는 권한 테스트 1건을 건너뛰게 고침, frontend `node:24.22.1-alpine` — lint가 기본 힙에서 죽어 `NODE_OPTIONS`를 넣음).
- **GitLab·서버에서만 확인되는 것(미검증)**: 러너 등록과 `CI_SERVER_TOKEN` 전달, 실제 파이프라인 실행과 `dev` Protected 브랜치에서 배포 러너가 잡히는지, helper 이미지에 `pull_policy = never`가 적용되는지, Prevent outdated·rollback Retry, 서버 데몬에서의 동기화·빌드·헬스체크, `docker inspect`의 `Aliases`/`DNSNames`로 본 별칭 검사(Docker 26), compose `working_dir` 라벨이 배포 폴더 경로로 찍히는지, 자동 할당 대역이 사내망과 겹치지 않는지, 6절 전환 전체, Windows Git Bash에서의 `sh ci/test-deploy.sh`. 첫 배포에서 이 문서의 절차를 고치면 함께 갱신한다.

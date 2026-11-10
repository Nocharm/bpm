# BPM 파이프라인 전환 런북

2026-11-10 · 1회용 체크리스트(전환이 끝나면 `gitlab-runner.md`만 남긴다)

손으로 띄운 운영(9900)·개발(9910) 스택을 사내 GitLab 파이프라인 배포로 옮긴다. 개발을 먼저 넘겨 리허설하고, 운영은 사용이 적은 시간에 넘긴다. 자세한 근거는 [`gitlab-runner.md`](gitlab-runner.md).

## 한눈에

위에서부터 한 줄씩 끝내고 넘어간다. 서비스가 멈추는 구간은 3-3~3-5(개발)와 4-3~4-5(운영)뿐이다.

| 단계 | 어디서 | 하는 사람 | 서비스 중단 |
| --- | --- | --- | --- |
| 0. 코드 준비 | GitHub → PC → GitLab | Claude(머지) + 나(GitLab push) | 없음 |
| 1. GitLab 설정 | GitLab 화면 | 나 | 없음 |
| 2. 서버 1회 준비 | 서버 SSH | 나 | 없음 |
| 3. 개발 전환 | 서버 SSH + GitLab | 나 | 개발 수 분~수십 분 |
| 4. 운영 전환 | 서버 SSH + GitLab | 나 | 운영 수 분~수십 분 |

- 절대 하지 않는 것: `docker compose down -v`(DB 볼륨 삭제), `docker system prune`·`image prune -a`(빌드 전용 베이스 이미지 삭제).
- 아래 `<gitlab-url>`·`<server-ip>`·`<계정>`·`<옛 폴더>`는 실제 값으로 바꿔 친다.

## 0단계 코드 준비

파이프라인 파일(`.gitlab-ci.yml`, `ci/`)이 GitLab의 `dev`·`main`에 있어야 파이프라인이 돈다.

1. `ci/gitlab-runner`를 GitHub `dev`·`main`에 올렸다(2026-11-10). 버전은 배포 전이던 **v1.7.0**에 합쳐 태그를 다시 달았다(Run 소개 말풍선이 이번 첫 파이프라인 배포에 함께 나간다).
2. Windows PC에서 받고 태그만 먼저 GitLab에 올린다. `dev`·`main` 브랜치 push는 3·4단계에서 한다(push하는 순간 파이프라인이 돈다. `main`은 ▶을 눌러야 배포되지만 `dev`는 바로 배포된다).

```bash
git fetch origin --tags --force        # v1.7.0 태그가 옮겨졌으니 --force
git checkout main && git pull
git checkout dev && git pull
git push gitlab v1.7.0 --force         # GitLab에 옛 v1.7.0 태그가 있으면 덮는다. 태그 push는 파이프라인을 만들지 않는다
```

- GitLab 리모트 이름이 `gitlab`이 아니면 `git remote -v`로 확인해 바꿔 친다.
- 1·2단계(러너 등록) 전에 `dev`를 push하면 테스트 Job이 `pending`으로 남는다. 장애는 아니고, 러너가 생기면 돈다.

## 1단계 GitLab 프로젝트 설정 (1회)

배포 러너는 서버 root와 같아서, `main`과 `dev`에 push할 수 있는 사람이 곧 배포할 수 있는 사람이다.

- [ ] **Settings → Repository → Protected branches**: `main`, `dev` 둘 다 추가. Allowed to merge = Maintainers, Allowed to push and merge = Maintainers, 강제 푸시 끔. `dev`가 빠지면 `deploy-dev`가 `pending`에서 멈춘다.
- [ ] **Settings → General → Visibility**: Private. **Settings → CI/CD → General pipelines**: Public pipelines 끔.
- [ ] **Settings → CI/CD → Auto DevOps**: 켜져 있으면 끔.
- [ ] **Settings → CI/CD → General pipelines**: Prevent outdated deployment jobs 켬, Allow job retries for rollback deployments 켬.
- [ ] **Settings → CI/CD → Variables**: `BPM_DEPLOY_ROOT` = `/data/home_<계정>/deployments` **하나만** 만든다(sop-archivist의 `SOP_DEPLOY_DIR`과 같은 관례, 사람 계정이 든 경로라 저장소에 안 적는다). Visibility Visible, **Protect variable 켬**. 배포 폴더는 이 값 + `/bpm`·`/bpm-dev`다.
- [ ] 그 밖의 CI/CD 변수는 만들지 않는다. 특히 `BPM_DEPLOY_DIR`·`BPM_COMPOSE_PROJECT`·`BPM_DEPLOY_ENV`를 만들면 두 배포 Job에 같은 값이 덮인다. 비밀값은 서버 `.env`에만 둔다.
- [ ] **Settings → CI/CD → Runners → New project runner**를 두 번 만든다. 토큰(`glrt-…`)은 한 번만 보이니 2단계 등록에 바로 쓴다.

| 항목 | 테스트 러너 | 배포 러너 |
| --- | --- | --- |
| Tags | `bpm-test` | `bpm-deploy` |
| Run untagged jobs | 끔 | 끔 |
| Protected | 끔 | **켬** |
| Description | `bpm test` | `bpm deploy` |

## 2단계 서버 1회 준비

서비스는 멈추지 않는다. sop-archivist 러너 컨테이너는 건드리지 않는다. BPM 러너는 실측한 sop-archivist 러너 설정을 따른다(2026-11-10): 전용 네트워크, `clone_url`·`dns`·`tls-ca-file` 없음, 러너 19.0.0.

### 2-1. 전제 확인

```bash
grep -A6 default-address-pools /etc/docker/daemon.json      # 사내망과 안 겹치는 풀이 있어야 한다
docker network inspect dbv-shared -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # 있어야 한다(건드리지 않음)
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'node:24.22.1-alpine|python:3.11-slim|nginx:1.27-alpine|postgres:16-alpine|docker:27-cli|gitlab-runner'
```

베이스 이미지 중 없는 것은 연결된 PC에서 amd64 tar로 반입한다([`deploy.md`](deploy.md) §0). 러너 이미지는 `gitlab/gitlab-runner:alpine-v19.0.0`, helper는 `gitlab/gitlab-runner-helper:x86_64-v19.0.0`이 보여야 한다(러너 이름이 다르면 sop-archivist 러너가 쓰는 이미지 이름으로 바꿔 친다).

### 2-2. 배포 폴더 두 개

sop-archivist 배포 폴더(`/data/home_<계정>/deployments/sop-archivist`) 옆에 만든다. 러너 등록 전에 만든다(없는 폴더를 마운트하면 데몬이 빈 root 폴더를 만든다). 본인 홈이라 sudo가 필요 없다.

```bash
mkdir -p /data/home_<계정>/deployments/bpm /data/home_<계정>/deployments/bpm-dev
chmod 750 /data/home_<계정>/deployments/bpm /data/home_<계정>/deployments/bpm-dev
```

### 2-3. 전용 네트워크 `bpm-ci-network`

러너 컨테이너와 Job 컨테이너가 함께 쓴다. 대역은 데몬 풀이 자동으로 준다(`--subnet` 없이).

```bash
docker network create bpm-ci-network
docker network inspect bpm-ci-network -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # 사내망과 안 겹치는지
```

### 2-4. 러너 컨테이너와 등록

```bash
sudo mkdir -p /data/gitlab-runners/bpm
docker run -d --name gitlab-runner-bpm --restart unless-stopped \
  --network bpm-ci-network \
  -v /data/gitlab-runners/bpm:/etc/gitlab-runner \
  -v /var/run/docker.sock:/var/run/docker.sock \
  gitlab/gitlab-runner:alpine-v19.0.0

GITLAB_URL='<gitlab-url>'
DEPLOY_ROOT=/data/home_<계정>/deployments      # 1단계 CI 변수 BPM_DEPLOY_ROOT와 같은 값
COMMON="--non-interactive --url $GITLAB_URL --executor docker \
  --docker-network-mode bpm-ci-network \
  --docker-pull-policy never \
  --docker-helper-image gitlab/gitlab-runner-helper:x86_64-v19.0.0 \
  --limit 1"

# 테스트 러너 (bpm-test 토큰을 붙여넣고 Enter, 화면에 안 보인다)
read -rs CI_SERVER_TOKEN && export CI_SERVER_TOKEN
docker exec -e CI_SERVER_TOKEN gitlab-runner-bpm gitlab-runner register $COMMON \
  --name bpm-test --docker-image python:3.11-slim
unset CI_SERVER_TOKEN

# 배포 러너 (bpm-deploy 토큰) — 소켓 + BPM 배포 폴더 두 개만, 양쪽 같은 경로로(루트 전체를 마운트하지 않는다)
read -rs CI_SERVER_TOKEN && export CI_SERVER_TOKEN
docker exec -e CI_SERVER_TOKEN gitlab-runner-bpm gitlab-runner register $COMMON \
  --name bpm-deploy --docker-image docker:27-cli \
  --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
  --docker-volumes "$DEPLOY_ROOT/bpm:$DEPLOY_ROOT/bpm:rw" \
  --docker-volumes "$DEPLOY_ROOT/bpm-dev:$DEPLOY_ROOT/bpm-dev:rw"
unset CI_SERVER_TOKEN

docker exec gitlab-runner-bpm sed -i 's/^concurrent = .*/concurrent = 2/' /etc/gitlab-runner/config.toml
docker exec gitlab-runner-bpm grep -E '^\s*(concurrent|network_mode|pull_policy|helper_image)\s*=' /etc/gitlab-runner/config.toml
docker exec gitlab-runner-bpm gitlab-runner verify
```

- [ ] `grep` 결과: `concurrent = 2`, 러너마다 `network_mode = "bpm-ci-network"`·`pull_policy = ["never"]`·`helper_image`.
- [ ] GitLab Settings → CI/CD → Runners에서 두 러너가 **Online**.
- 등록이 토큰을 물으며 실패하면 그때만 `--token "$CI_SERVER_TOKEN"`을 더한다.
- clone 단계가 `Could not resolve host`·`SSL certificate problem`으로 죽으면 sop-archivist 러너의 `extra_hosts`를 확인한다([`gitlab-runner.md`](gitlab-runner.md) 2-1).

## 3단계 개발(9901) 전환

개발은 프로젝트 이름 `bpm-9910`을 그대로 쓴다(볼륨 `bpm-9910_pgdata`를 이어 쓰려고). 포트만 9901로 바뀐다.

### 3-1. 지금 이름·위치 확인

```bash
docker ps -a --format '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Names}}' | grep -E 'bpm|business-process' | sort -u
docker volume ls | grep -E 'bpm|business-process'
```

- [ ] 프로젝트 `bpm-9910`, 볼륨 `bpm-9910_pgdata`가 보인다. 이름이 다르면 **멈추고** Claude에게 알려 `.gitlab-ci.yml`을 고친 뒤 이어 간다.
- [ ] 옛 개발 폴더(working_dir)와 env 파일 이름(`.env.9910`인지)을 적어 둔다.

### 3-2. 덤프

`-t`를 붙이지 않는다. 덤프는 배포 폴더 밖에 둔다.

```bash
mkdir -p ~/bpm-switch-dumps && cd ~/bpm-switch-dumps
docker exec -i bpm-9910-db-1 pg_dump -U processmap -d processmap -Fc > bpm-dev-$(date +%Y%m%d-%H%M).dump
ls -lh bpm-dev-*.dump                                                             # 0바이트 아님
docker run --rm -i postgres:16-alpine pg_restore --list < bpm-dev-*.dump | head -5   # 읽히는지
```

### 3-3. 옛 스택 내리기 (`-v` 없이)

```bash
cd <옛 개발 폴더>
docker compose -p bpm-9910 --env-file .env.9910 down
docker volume ls | grep bpm-9910_pgdata          # 그대로 있어야 한다
docker network ls | grep bpm-9910_default        # 비어 있어야 한다
```

개발의 db-backup 컨테이너도 이때 사라지고, 이후 개발은 백업하지 않는다.

### 3-4. `.env` 옮기기

```bash
cp <옛 개발 폴더>/.env.9910 /data/home_<계정>/deployments/bpm-dev/.env
chmod 600 /data/home_<계정>/deployments/bpm-dev/.env
vi /data/home_<계정>/deployments/bpm-dev/.env
```

편집기에서 고칠 것(화면에 `cat`으로 띄우지 않는다):

- [ ] `APP_PORT=9901`
- [ ] `DBV_DB_ALIAS=bpm9910-db`
- [ ] 임시 로그인이면 `AUTH_MODE=dev`, `DEV_ENFORCE_PERMISSIONS=true`, `BPM_SYSADMINS=<관리자로 쓸 임시 아이디>`
- [ ] `FORWARDED_ALLOW_IPS` 줄은 비우거나 지운다(옛 172.44는 더 이상 맞지 않는다)
- [ ] `COMPOSE_FILE`·`COMPOSE_PROFILES` 줄이 있으면 지운다. `COMPOSE_PROJECT_NAME`이 있으면 `bpm-9910`이어야 한다
- 9910으로 접속하던 사람에게 9901로 바뀐다고 알린다. 개발이 임시 로그인이면 Keycloak 등록은 필요 없다.

### 3-5. 첫 파이프라인

Windows PC에서:

```bash
git push gitlab dev
```

GitLab Build → Pipelines에서 test 3개 뒤 `deploy-dev`가 자동으로 돈다. Job 로그에서 볼 줄:

- `db volume: bpm-9910_pgdata (existing data is kept)` — 볼륨을 이어 쓴다는 뜻
- `health: /api/health ok, auth mode dev, / 200`
- `WARNING: .env FORWARDED_ALLOW_IPS is empty; the compose network is <서브넷>` — 지금은 정상, 3-6에서 채운다
- `[deploy] done`

### 3-6. 대역 기입 → 재실행

```bash
docker network inspect bpm-9910_default -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
vi /data/home_<계정>/deployments/bpm-dev/.env       # FORWARDED_ALLOW_IPS=<위 서브넷>
```

GitLab **Run pipeline**(브랜치 `dev`) → `deploy-dev`가 다시 돈다. 로그에 `FORWARDED_ALLOW_IPS covers the compose network …`가 나오면 개발 전환 끝.

## 4단계 운영(9900) 전환

개발이 문제없이 끝난 뒤, 사용이 적은 시간에 한다. 4-3의 `down`부터 4-5의 헬스체크까지 운영이 멈춘다. 운영은 프로젝트 `business-process-mgmt`, 볼륨 `business-process-mgmt_pgdata`.

### 4-1. 이름 확인

- [ ] 3-1의 출력에서 프로젝트 `business-process-mgmt`, 볼륨 `business-process-mgmt_pgdata`를 확인하고 옛 운영 폴더를 적어 둔다.
- [ ] 운영 `.env`의 `BACKUP_DIR`을 확인한다(`grep -c '^BACKUP_DIR=./backups' <옛 운영 폴더>/.env`가 1이면 기본 경로).

### 4-2. 덤프

```bash
cd ~/bpm-switch-dumps
docker exec -i business-process-mgmt-db-1 pg_dump -U processmap -d processmap -Fc > bpm-prod-$(date +%Y%m%d-%H%M).dump
ls -lh bpm-prod-*.dump
docker run --rm -i postgres:16-alpine pg_restore --list < bpm-prod-*.dump | head -5
docker exec -i business-process-mgmt-db-1 psql -U processmap -d processmap -tc 'SELECT count(*) FROM process_maps;'   # 전환 뒤 비교용으로 적어 둔다
```

### 4-3. 옛 스택 내리기 (`-v` 없이) — 여기서부터 운영 중단

```bash
cd <옛 운영 폴더>
docker compose -p business-process-mgmt down
docker volume ls | grep business-process-mgmt_pgdata     # 그대로 있어야 한다
```

### 4-4. `.env`와 백업 옮기기

```bash
cp <옛 운영 폴더>/.env /data/home_<계정>/deployments/bpm/.env
chmod 600 /data/home_<계정>/deployments/bpm/.env
sudo mv <옛 운영 폴더>/backups /data/home_<계정>/deployments/bpm/backups   # BACKUP_DIR=./backups일 때만. 절대 경로면 옮기지 않는다
vi /data/home_<계정>/deployments/bpm/.env
```

- [ ] `AUTH_MODE=keycloak`(비어 있으면 적는다)
- [ ] `APP_PORT`는 9900 또는 비움, `DBV_DB_ALIAS`는 `bpm-db` 또는 비움
- [ ] `FORWARDED_ALLOW_IPS` 줄은 비우거나 지운다(옛 172.36)
- [ ] `COMPOSE_FILE`·`COMPOSE_PROFILES`는 지우고, `COMPOSE_PROJECT_NAME`이 있으면 `business-process-mgmt`
- Keycloak 장애 대비: `AUTH_JWT_SECRET`이 비어 있으면 지금 만들어 둔다(`openssl rand -hex 32`). AD 전환 때 바로 쓸 수 있다.

### 4-5. 첫 파이프라인

GitLab Build → Pipelines → **Run pipeline**(브랜치 `main`), 또는 PC에서 `git push gitlab main` → test 3개가 끝나면 `deploy-production` **▶**. Job 로그에서 볼 줄:

- `db volume: business-process-mgmt_pgdata (existing data is kept)`
- `db-backup.sh changed or first deploy: recreating db-backup`
- `health: /api/health ok, auth mode keycloak, / 200`
- `WARNING: .env FORWARDED_ALLOW_IPS is empty; the compose network is <서브넷>`

### 4-6. 대역 기입 → 재실행

```bash
docker network inspect business-process-mgmt_default -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
vi /data/home_<계정>/deployments/bpm/.env           # FORWARDED_ALLOW_IPS=<위 서브넷>
```

Run pipeline(`main`) → `deploy-production` ▶. `FORWARDED_ALLOW_IPS covers the compose network …`가 나오면 끝. 이 값이 맞아야 나중에 Keycloak 장애로 AD 로그인(`AUTH_MODE=ldap`)으로 돌릴 때 배포가 막히지 않는다([`gitlab-runner.md`](gitlab-runner.md) 5-1).

## 확인 체크리스트

아래가 모두 맞으면 전환 끝이다. 서버 명령은 항상 배포 폴더에서 `-p`를 붙인다.

```bash
cd /data/home_<계정>/deployments/bpm-dev && docker compose -p bpm-9910 ps                          # 4개 Up(db-backup 없음)
cd /data/home_<계정>/deployments/bpm && docker compose -p business-process-mgmt --profile backup ps   # 5개 Up
docker compose -p business-process-mgmt --profile backup logs --tail 3 db-backup         # "ok bpm-….dump"
docker compose -p business-process-mgmt exec -T db psql -U processmap -d processmap -tc 'SELECT count(*) FROM process_maps;'   # 4-2 값과 같음
cat /data/home_<계정>/deployments/bpm/.deployed                                                      # 배포된 커밋·버전
```

- [ ] 개발 `http://<server-ip>:9901` 로그인, 맵 목록이 전과 같다
- [ ] 운영 `http://<server-ip>:9900` Keycloak 로그인, 맵 목록이 전과 같다
- [ ] 두 곳 상단 바 버전이 배포한 버전과 같다
- [ ] 두 배포 Job 로그에 `FORWARDED_ALLOW_IPS covers the compose network`
- [ ] db-viewer에서 `BPM (운영)`·개발 소스 연결 테스트가 초록이고 `database`가 맞다(별칭은 안 바뀐다)
- [ ] 운영 `CHANGELOG.md` 그 버전 항목에 배포일을 적는다
- 옛 폴더와 `~/bpm-switch-dumps`는 몇 번의 배포를 문제없이 지날 때까지 지우지 않는다.

## 문제가 생기면

배포 스크립트의 가드가 멈추면 아무것도 바뀌지 않은 상태다. 메시지를 보고 고친 뒤 파이프라인을 다시 돌리면 된다. 전체 표는 [`gitlab-runner.md`](gitlab-runner.md) 7절.

| Job 로그 | 뜻과 조치 |
| --- | --- |
| Job이 `pending`에서 멈춤 | 러너 Online·태그 철자 확인. 배포 Job이면 `main`·`dev`가 Protected branches에 있는지 |
| `two levels deep ... BPM_DEPLOY_ROOT set?` / `unexpanded variable` | 1단계 CI 변수 `BPM_DEPLOY_ROOT`가 없거나 이름이 틀렸다 |
| `has containers started from <폴더>` | 옛 스택이 아직 떠 있다. 3-3/4-3의 `down`(-v 없이)을 한다 |
| `db volume …_pgdata does not exist` | 프로젝트 이름이 실제와 다르다. `BPM_ALLOW_NEW_DB=1`로 우회하지 말고 3-1로 돌아간다 |
| `POSTGRES_PASSWORD is empty or … placeholder` | `.env`를 옛 폴더에서 그대로 옮겨야 볼륨의 DB에 붙는다 |
| `APP_PORT …` / `COMPOSE_PROJECT_NAME differs` | 두 스택의 `.env`가 뒤바뀌었거나 포트를 안 적었다 |
| `without DEV_ENFORCE_PERMISSIONS=true` | 개발 `.env`에 `DEV_ENFORCE_PERMISSIONS=true` |
| `db alias '…' is already used` | 개발 별칭은 `bpm9910-db` |
| `base image(s) missing` | 찍힌 이미지를 tar로 반입 |
| `the host does not see the deploy folder` | 배포 러너 마운트가 `같은경로:같은경로`가 아니다(2-4) |
| `the app did not become healthy in time` | Job 로그 끝의 backend 로그를 본다. 큰 DB의 첫 기동이 5분을 넘기면 다시 돌린다 |
| `frontend-test` heap out of memory | 서버 메모리 부족. lint가 수 GB를 쓴다 |

**배포가 계속 안 되고 서비스를 당장 살려야 하면** 옛 폴더에서 옛 방식으로 다시 띄운다. 옛 폴더의 compose는 고정 대역 그대로라 그냥 뜬다. 볼륨이 같아 데이터도 그대로다.

```bash
cd <옛 운영 폴더> && docker compose -p business-process-mgmt up -d      # 운영
cd <옛 개발 폴더> && docker compose -p bpm-9910 --env-file .env.9910 up -d  # 개발(포트 9910)
```

단, 운영 `backups/`를 4-4에서 옮겼다면 옛 폴더로 돌려놓고 띄운다. 다시 파이프라인으로 넘어갈 때는 3-3/4-3부터 다시 한다. DB가 잘못됐을 때만 `~/bpm-switch-dumps`의 덤프로 복구한다([`backup.md`](backup.md) §3).

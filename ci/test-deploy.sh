#!/bin/sh
# Tests ci/deploy.sh (production and dev stacks) with a fake `docker` first on PATH and temporary folders.
# POSIX sh: runs in docker:27-cli (busybox, the CI job) and in GNU/macOS shells. No timing assertions:
# GitLab runners are slower than a laptop.
# Usage: sh ci/test-deploy.sh   (TEST_SH=dash sh ci/test-deploy.sh runs deploy.sh under another shell)
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_SH="$ROOT/ci/deploy.sh"
TEST_SH="${TEST_SH:-sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

passed=0
failed=0
case_no=0

# The fake docker cannot see the test's environment (deploy.sh calls it through `env -i`),
# so its control folder path is written into the script itself.
write_fake_docker() {
  {
    echo '#!/bin/sh'
    echo "CTL='$CTL'"
    cat << 'FAKE'
printf '%s\n' "$*" >> "$CTL/calls.log"
{ printf '%s %s\n' '---' "$*"; env | sort; } >> "$CTL/env.log"
last=""
for arg in "$@"; do last="$arg"; done
case "$1" in
  version)
    if [ -f "$CTL/daemon-down" ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi
    echo "26.1.3-fake"; exit 0 ;;
  network)
    name="$3"
    case "$*" in
      *IPAM*)
        if [ -f "$CTL/subnet-fail" ]; then echo "Error: No such network: $name" >&2; exit 1; fi
        if [ -f "$CTL/subnet" ]; then cat "$CTL/subnet"; else echo "172.18.0.0/16 "; fi
        exit 0 ;;
    esac
    [ -f "$CTL/net-$name" ] || { echo "Error response from daemon: network $name not found" >&2; exit 1; }
    case "$*" in *Containers*) cat "$CTL/net-$name" ;; esac
    exit 0 ;;
  inspect)
    if [ -f "$CTL/container-$last" ]; then cat "$CTL/container-$last"; exit 0; fi
    echo "Error: No such object: $last" >&2; exit 1 ;;
  ps)
    if [ -f "$CTL/project-dirs" ]; then cat "$CTL/project-dirs"; fi
    exit 0 ;;
  volume)
    if [ -f "$CTL/no-volume" ]; then echo "Error response from daemon: get $3: no such volume" >&2; exit 1; fi
    exit 0 ;;
  image)
    if [ -f "$CTL/missing-images" ] && grep -qxF "$3" "$CTL/missing-images"; then
      echo "Error response from daemon: No such image: $3" >&2; exit 1
    fi
    exit 0 ;;
  run)
    if [ -f "$CTL/probe-fail" ]; then echo "invalid mount config: bind source path does not exist" >&2; exit 125; fi
    src=""
    for arg in "$@"; do
      case "$arg" in type=bind,src=*) src="${arg#type=bind,src=}"; src="${src%%,dst=*}" ;; esac
    done
    [ -f "$src/${last#/probe/}" ]; exit $? ;;
  compose)
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -p | -f | --profile | --project-directory | --env-file) shift 2 ;;
        *) break ;;
      esac
    done
    case "$1" in
      version) echo "2.99.0-fake"; exit 0 ;;
      config | restart) exit 0 ;;
      up) if [ -f "$CTL/up-fail" ]; then echo "build failed" >&2; exit 1; fi; exit 0 ;;
      ps) echo "NAME STATUS (fake ps)"; exit 0 ;;
      logs) echo "fake backend logs"; exit 0 ;;
      exec)
        count=0
        if [ -f "$CTL/exec-count" ]; then count="$(cat "$CTL/exec-count")"; fi
        count=$((count + 1))
        echo "$count" > "$CTL/exec-count"
        limit=0
        if [ -f "$CTL/restarting-calls" ]; then limit="$(cat "$CTL/restarting-calls")"; fi
        if [ "$count" -le "$limit" ] || [ -f "$CTL/health-never" ]; then
          echo "Error response from daemon: Container 0123 is restarting, wait until the container is running" >&2
          exit 1
        fi
        mode=keycloak
        if [ -f "$CTL/mode" ]; then mode="$(cat "$CTL/mode")"; fi
        case "$last" in
          */api/health) echo '{"status":"ok"}' ;;
          */api/auth/mode) echo "{\"mode\":\"$mode\",\"keycloakIssuer\":\"http://SECRET-ISSUER-HOST:8080/realms/x\",\"keycloakClientId\":\"SECRET-CLIENT-ID\"}" ;;
          *) echo '<html>ok</html>' ;;
        esac
        exit 0 ;;
    esac ;;
esac
echo "fake docker: unexpected call: $*" >&2
exit 99
FAKE
  } > "$BIN/docker"
  chmod +x "$BIN/docker"
}

# A fresh fake server for one stack ("production" or "dev"): checkout, deploy folder with
# .env/backups and an old deployment, and a shared network where other stacks' dbs live.
setup_case() {
  case_no=$((case_no + 1))
  STACK="${1:-production}"
  CASE="$WORK/case$case_no"
  CTL="$CASE/ctl"
  BIN="$CASE/bin"
  SRC="$CASE/builds/group/bpm"
  OUT="$CASE/out.log"
  if [ "$STACK" = "production" ]; then
    DEPLOY="$CASE/data/deployments/bpm"
    PROJECT_ARG="business-process-mgmt"
  else
    DEPLOY="$CASE/data/deployments/bpm-dev"
    PROJECT_ARG="bpm-9910"
  fi
  ENV_ARG="$STACK"
  DEPLOY_ARG="$DEPLOY"
  mkdir -p "$CTL" "$BIN" "$SRC/.git" "$SRC/frontend" "$SRC/backend" "$SRC/scripts" "$DEPLOY/backups" "$DEPLOY/scripts"
  : > "$CTL/calls.log"
  : > "$CTL/env.log"
  # Shared network with sop-archivist's db and the other bpm stack's db already on it.
  echo "c-sop c-prod c-dev" > "$CTL/net-dbv-test"
  echo "sop-archivist|sop-archivist-db,db,sop-archivist-db-1," > "$CTL/container-c-sop"
  echo "business-process-mgmt|bpm-db,db," > "$CTL/container-c-prod"
  echo "bpm-9910|bpm9910-db,db," > "$CTL/container-c-dev"
  write_fake_docker

  echo "ref: refs/heads/main" > "$SRC/.git/HEAD"
  printf '{\n  "name": "frontend",\n  "version": "9.8.7",\n  "private": true\n}\n' > "$SRC/frontend/package.json"
  cat > "$SRC/frontend/Dockerfile" << 'EOF'
# FROM comment:0 is not an image
FROM node:24.22.1-alpine AS deps
RUN echo from the deps stage
FROM deps AS builder
from node:24.22.1-alpine as runner
EOF
  echo "FROM --platform=linux/amd64 python:3.11-slim" > "$SRC/backend/Dockerfile"
  cat > "$SRC/docker-compose.yml" << 'EOF'
services:
  proxy:
    image: nginx:1.27-alpine
  db:
    image: "postgres:16-alpine"  # same image as the backup sidecar
  db-backup:
    image: postgres:16-alpine
EOF
  echo "echo backup v2" > "$SRC/scripts/db-backup.sh"
  echo "new" > "$SRC/new-file.txt"
  echo "stages: [test]" > "$SRC/.gitlab-ci.yml"

  if [ "$STACK" = "production" ]; then
    write_env "AUTH_MODE=keycloak"
  else
    write_env "AUTH_MODE=dev" "DEV_ENFORCE_PERMISSIONS=true" "APP_PORT=9901" "DBV_DB_ALIAS=bpm9910-db"
  fi
  echo "dump" > "$DEPLOY/backups/old.dump"
  echo "stale" > "$DEPLOY/stale-file.txt"
  echo "old hidden" > "$DEPLOY/.old-hidden"
  echo "echo backup v2" > "$DEPLOY/scripts/db-backup.sh"
  echo "commit=old" > "$DEPLOY/.deployed"
}

# .env with the given lines after a common block; secrets there must never reach the output.
write_env() {
  {
    echo "# server .env (test)"
    echo "POSTGRES_PASSWORD=SECRET-PG-VALUE"
    echo "AUTH_JWT_SECRET=SECRET-JWT-VALUE"
    echo "BACKUP_DIR=./backups"
    echo "DBV_NETWORK=dbv-test"
    for line in "$@"; do printf '%s\n' "$line"; done
  } > "$DEPLOY/.env"
}

# Extra VAR=value arguments become the job environment.
run_deploy() {
  if (cd "$CASE" && env CI_PROJECT_DIR="$SRC" BPM_DEPLOY_ENV="$ENV_ARG" BPM_DEPLOY_DIR="$DEPLOY_ARG" \
      BPM_COMPOSE_PROJECT="$PROJECT_ARG" BPM_HEALTH_TRIES=4 BPM_HEALTH_INTERVAL=0 \
      CI_COMMIT_SHA=abc123 CI_COMMIT_BRANCH=main CI_PIPELINE_ID=42 CI_JOB_ID=7 PATH="$BIN:$PATH" \
      "$@" "$TEST_SH" "$DEPLOY_SH") > "$OUT" 2>&1; then
    rc=0
  else
    rc=$?
  fi
}

snapshot_deploy() {
  (cd "$DEPLOY" && find . -type f -exec cksum {} \; | sort; find . | sort)
}

report() {
  if [ "$2" = 0 ]; then
    passed=$((passed + 1))
    printf 'ok    %s\n' "$1"
  else
    failed=$((failed + 1))
    printf 'FAIL  %s\n' "$1"
    sed 's/^/      | /' "$OUT"
  fi
}

# check "name" command...: the command's success is the assertion.
check() {
  name="$1"
  shift
  if "$@"; then report "$name" 0; else report "$name" 1; fi
}

has_call() { grep -qF -- "$1" "$CTL/calls.log"; }
has_no_call() { ! grep -qF -- "$1" "$CTL/calls.log"; }
has_output() { grep -qF -- "$1" "$OUT"; }
succeeded() { [ "$rc" = 0 ]; }
failed_run() { [ "$rc" != 0 ]; }
has_no_secrets() {
  ! grep -qF -e SECRET-PG-VALUE -e SECRET-JWT-VALUE -e SECRET-ISSUER-HOST -e SECRET-CLIENT-ID -e 10.250.0.0 "$OUT"
}
did_not_deploy() { has_no_call "up -d"; }
compose_calls_named() {
  # Every compose call names the project and the file; none relies on .env for them.
  ! grep '^compose ' "$CTL/calls.log" | grep -v '^compose version' | grep -vqF "compose -p $1 -f docker-compose.yml"
}

# A guard must fail with its own message, delete nothing and never reach compose.
expect_guard_failure() {
  name="$1"
  message="$2"
  shift 2
  before="$(snapshot_deploy)"
  run_deploy "$@"
  after="$(snapshot_deploy)"
  if failed_run && has_output "$message" && did_not_deploy && [ "$before" = "$after" ] && has_no_secrets; then
    report "guard ($STACK): $name" 0
  else
    report "guard ($STACK): $name (rc=$rc)" 1
  fi
}

# --- production happy path, with hostile job variables ----------------------
setup_case production
env_before="$(cksum < "$DEPLOY/.env")"
run_deploy AUTH_MODE=dev COMPOSE_PROJECT_NAME=evil COMPOSE_FILE=evil.yml COMPOSE_PROFILES=evil \
  DOCKER_HOST=tcp://docker:2375 POSTGRES_PASSWORD=evil BACKUP_DIR=/evil APP_PORT=1 DBV_DB_ALIAS=evil
check "production: exits 0" succeeded
check "production: sync keeps .env unchanged" test "$env_before" = "$(cksum < "$DEPLOY/.env")"
check "production: sync keeps backups/" test -f "$DEPLOY/backups/old.dump"
check "production: sync removes stale files" test ! -e "$DEPLOY/stale-file.txt" -a ! -e "$DEPLOY/.old-hidden"
check "production: sync lays new files (dotfiles too)" test -f "$DEPLOY/new-file.txt" -a -f "$DEPLOY/.gitlab-ci.yml"
check "production: sync skips .git" test ! -e "$DEPLOY/.git"
check "production: marker records version" grep -qx "version=9.8.7" "$DEPLOY/.deployed"
check "production: marker records commit" grep -qx "commit=abc123" "$DEPLOY/.deployed"
check "production: marker records stack" sh -c "grep -qx 'environment=production' '$DEPLOY/.deployed' && grep -qx 'project=business-process-mgmt' '$DEPLOY/.deployed'"
check "production: probe file cleaned up" test -z "$(find "$DEPLOY" -name '.deploy-probe.*')"
check "production: compose up with project and backup profile" \
  has_call "compose -p business-process-mgmt -f docker-compose.yml --profile backup up -d --build"
check "production: every compose call names project and file" compose_calls_named business-process-mgmt
check "production: proxy restarted" has_call "--profile backup restart proxy"
check "production: db-backup not recreated when unchanged" has_no_call "--force-recreate"
check "production: health line names keycloak" has_output "health: /api/health ok, auth mode keycloak, / 200"
expected_images="$(printf '%s\n' "image inspect nginx:1.27-alpine" "image inspect node:24.22.1-alpine" \
  "image inspect postgres:16-alpine" "image inspect python:3.11-slim")"
check "production: base images read from Dockerfiles and compose" \
  test "$(grep '^image inspect' "$CTL/calls.log" | sort)" = "$expected_images"
check "production: db volume checked by project name" has_call "volume inspect business-process-mgmt_pgdata"
check "production: job AUTH_MODE not passed to docker" sh -c "! grep -q '^AUTH_MODE=' '$CTL/env.log'"
check "production: job COMPOSE_* not passed to docker" sh -c "! grep -q '^COMPOSE_' '$CTL/env.log'"
check "production: job POSTGRES_PASSWORD/BACKUP_DIR/APP_PORT/BPM_* not passed" \
  sh -c "! grep -qE '^(POSTGRES_PASSWORD|BACKUP_DIR|APP_PORT|DBV_DB_ALIAS|BPM_[A-Z_]*)=' '$CTL/env.log'"
check "production: DOCKER_HOST forced to the socket" \
  test "$(grep '^DOCKER_HOST=' "$CTL/env.log" | sort -u)" = "DOCKER_HOST=unix:///var/run/docker.sock"
check "production: empty FORWARDED_ALLOW_IPS warns with the subnet" \
  has_output "WARNING: .env FORWARDED_ALLOW_IPS is empty; the compose network is 172.18.0.0/16."
check "production: output has no secrets" has_no_secrets

# --- dev happy path ------------------------------------------------------------
setup_case dev
echo dev > "$CTL/mode"
run_deploy CI_COMMIT_BRANCH=dev
check "dev: exits 0" succeeded
check "dev: compose up with project, no backup profile" has_call "compose -p bpm-9910 -f docker-compose.yml up -d --build"
check "dev: no compose call uses the backup profile" has_no_call "--profile backup"
check "dev: every compose call names project and file" compose_calls_named bpm-9910
check "dev: proxy restarted" has_call "compose -p bpm-9910 -f docker-compose.yml restart proxy"
check "dev: health expects the .env auth mode (dev)" has_output "auth mode dev, / 200"
check "dev: db volume checked by project name" has_call "volume inspect bpm-9910_pgdata"
check "dev: marker records stack" sh -c "grep -qx 'environment=dev' '$DEPLOY/.deployed' && grep -qx 'branch=dev' '$DEPLOY/.deployed'"
check "dev: sync keeps backups/" test -f "$DEPLOY/backups/old.dump"
check "dev: output has no secrets" has_no_secrets

setup_case dev
rm "$DEPLOY/.deployed"
echo "echo backup v1" > "$DEPLOY/scripts/db-backup.sh"
echo dev > "$CTL/mode"
run_deploy
check "dev: first deploy never touches db-backup" sh -c "[ $rc = 0 ] && ! grep -qF 'db-backup' '$CTL/calls.log'"

setup_case dev
write_env "APP_PORT=9901" "DBV_DB_ALIAS=bpm9910-db" "AUTH_MODE=keycloak"
run_deploy
check "dev: keycloak login is accepted" succeeded

setup_case dev
write_env "APP_PORT=9901" "DBV_DB_ALIAS=bpm9910-db" "AUTH_MODE=ldap"
echo ldap > "$CTL/mode"
run_deploy
check "dev: ldap login with AUTH_JWT_SECRET is accepted" succeeded

# --- db-backup recreate only in production, when the script changed or on first deploy ---
setup_case production
echo "echo backup v1" > "$DEPLOY/scripts/db-backup.sh"
run_deploy
check "production: changed db-backup.sh is recreated" \
  sh -c "[ $rc = 0 ] && grep -qF 'compose -p business-process-mgmt -f docker-compose.yml --profile backup up -d --force-recreate db-backup' '$CTL/calls.log'"

setup_case production
rm "$DEPLOY/.deployed"
run_deploy
check "production: first deploy recreates db-backup" sh -c "[ $rc = 0 ] && grep -qF 'up -d --force-recreate db-backup' '$CTL/calls.log'"
check "production: first deploy writes the marker" test -f "$DEPLOY/.deployed"

# --- accepted .env variants ------------------------------------------------------
for backup_line in "BACKUP_DIR=" "BACKUP_DIR=backups" "BACKUP_DIR=OUTSIDE"; do
  setup_case production
  outside="$CASE/elsewhere/backups"
  write_env "AUTH_MODE=keycloak" "$(echo "$backup_line" | sed "s|OUTSIDE|$outside|")"
  run_deploy
  check "production: accepts $backup_line" succeeded
done

setup_case production
write_env "AUTH_MODE=dev" "export AUTH_MODE = \"Keycloak\"  # last one wins" "DBV_NETWORK='dbv-test'"
printf 'APP_PORT=9900\r\n' >> "$DEPLOY/.env"
run_deploy
check "production: accepts quoted/exported/commented/CRLF values" succeeded

for auth_lines in "AUTH_MODE=" "AUTH_ENABLED=true" "AUTH_ENABLED=Yes"; do
  setup_case production
  write_env "$auth_lines"
  run_deploy
  check "production: empty AUTH_MODE resolves to keycloak ($auth_lines)" succeeded
done

setup_case production
write_env "AUTH_MODE=keycloak" "COMPOSE_PROJECT_NAME=business-process-mgmt" "DBV_DB_ALIAS=bpm-db" "APP_PORT=9900"
run_deploy
check "production: matching COMPOSE_PROJECT_NAME and explicit defaults are accepted" succeeded

setup_case production
grep -v '^DBV_NETWORK' "$DEPLOY/.env" > "$CASE/env.tmp" && mv "$CASE/env.tmp" "$DEPLOY/.env"
mv "$CTL/net-dbv-test" "$CTL/net-dbv-shared"
run_deploy
check "production: DBV_NETWORK defaults to dbv-shared" sh -c "[ $rc = 0 ] && grep -qx 'network inspect dbv-shared' '$CTL/calls.log'"

setup_case production
echo "$DEPLOY" > "$CTL/project-dirs"
run_deploy
check "production: containers from the deploy folder itself are fine" succeeded

setup_case production
touch "$CTL/no-volume"
run_deploy BPM_ALLOW_NEW_DB=1
check "production: BPM_ALLOW_NEW_DB=1 allows a new db volume" sh -c "[ $rc = 0 ] && grep -qF 'compose creates an empty one' '$OUT'"

# --- FORWARDED_ALLOW_IPS check (warning only) ----------------------------------------
setup_case production
write_env "AUTH_MODE=keycloak" "FORWARDED_ALLOW_IPS=172.18.0.0/16"
run_deploy
check "forwarded: matching subnet is reported" sh -c "[ $rc = 0 ] && grep -qF 'FORWARDED_ALLOW_IPS covers the compose network 172.18.0.0/16' '$OUT' && ! grep -qF WARNING '$OUT'"

setup_case production
write_env "AUTH_MODE=keycloak" "FORWARDED_ALLOW_IPS=127.0.0.1, 172.18.0.0/16"
run_deploy
check "forwarded: subnet inside a list is accepted" sh -c "[ $rc = 0 ] && grep -qF 'covers the compose network' '$OUT'"

setup_case production
write_env "AUTH_MODE=keycloak" "FORWARDED_ALLOW_IPS=10.250.0.0/16"
run_deploy
check "forwarded: mismatch warns but the deploy succeeds" sh -c "[ $rc = 0 ] && grep -qF 'does not include the compose network 172.18.0.0/16' '$OUT'"
check "forwarded: the .env value is not printed" has_no_secrets

setup_case production
touch "$CTL/subnet-fail"
run_deploy
check "forwarded: unreadable subnet warns but the deploy succeeds" sh -c "[ $rc = 0 ] && grep -qF 'could not read the subnet' '$OUT'"

# --- guards: fail, delete nothing, never reach compose ------------------------------
setup_case production
rm "$DEPLOY/.env"
expect_guard_failure "no .env" "no .env in the deploy folder"

setup_case production
ENV_ARG=""
expect_guard_failure "BPM_DEPLOY_ENV missing" "BPM_DEPLOY_ENV must be"

setup_case production
ENV_ARG="staging"
expect_guard_failure "BPM_DEPLOY_ENV unknown" "BPM_DEPLOY_ENV must be"

setup_case production
PROJECT_ARG=""
expect_guard_failure "BPM_COMPOSE_PROJECT missing" "BPM_COMPOSE_PROJECT is empty"

setup_case production
PROJECT_ARG="Business Process"
expect_guard_failure "BPM_COMPOSE_PROJECT invalid" "BPM_COMPOSE_PROJECT must be lowercase"

setup_case production
DEPLOY_ARG=""
expect_guard_failure "BPM_DEPLOY_DIR missing" "BPM_DEPLOY_DIR is empty"

setup_case production
write_env "AUTH_MODE=keycloak"
sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=change-me/' "$DEPLOY/.env" > "$CASE/env.tmp" && mv "$CASE/env.tmp" "$DEPLOY/.env"
expect_guard_failure "POSTGRES_PASSWORD placeholder" "POSTGRES_PASSWORD is empty or the .env.example placeholder"

setup_case production
write_env "AUTH_MODE=dev" "DEV_ENFORCE_PERMISSIONS=true"
expect_guard_failure "AUTH_MODE=dev" "production must be keycloak"

setup_case production
write_env "AUTH_MODE=ldap"
expect_guard_failure "AUTH_MODE=ldap" "production must be keycloak"

setup_case production
write_env "AUTH_ENABLED=false"
expect_guard_failure "AUTH_ENABLED=false resolves to dev" "auth mode 'dev'; production must be keycloak"

setup_case production
write_env "AUTH_MODE=oidc"
expect_guard_failure "unknown AUTH_MODE" "not a value the backend accepts"

setup_case production
write_env "AUTH_ENABLED=maybe"
expect_guard_failure "unparsable AUTH_ENABLED" "not a value the backend accepts"

setup_case production
write_env "AUTH_MODE=keycloak" "APP_PORT=9901"
expect_guard_failure "dev port in production .env" "APP_PORT is not 9900"

setup_case production
write_env "AUTH_MODE=keycloak" "COMPOSE_PROJECT_NAME=bpm-9910"
expect_guard_failure "COMPOSE_PROJECT_NAME of the other stack" "COMPOSE_PROJECT_NAME differs from BPM_COMPOSE_PROJECT"

for key in COMPOSE_FILE COMPOSE_PROFILES; do
  setup_case production
  write_env "AUTH_MODE=keycloak" "$key=x"
  expect_guard_failure "$key in .env" ".env sets $key"
done

setup_case production
write_env "AUTH_MODE=keycloak" "DBV_DB_ALIAS=sop-archivist-db"
expect_guard_failure "alias taken by another stack" "db alias 'sop-archivist-db' (DBV_DB_ALIAS) is already used"

setup_case production
write_env "AUTH_MODE=keycloak" "DBV_DB_ALIAS=bpm db"
expect_guard_failure "alias with a space" "DBV_DB_ALIAS must be"

setup_case dev
write_env "AUTH_MODE=dev" "APP_PORT=9901" "DBV_DB_ALIAS=bpm9910-db"
expect_guard_failure "dev login without DEV_ENFORCE_PERMISSIONS" "without DEV_ENFORCE_PERMISSIONS=true"

setup_case dev
write_env "AUTH_MODE=dev" "DEV_ENFORCE_PERMISSIONS=false" "APP_PORT=9901" "DBV_DB_ALIAS=bpm9910-db"
expect_guard_failure "dev login with DEV_ENFORCE_PERMISSIONS=false" "without DEV_ENFORCE_PERMISSIONS=true"

setup_case dev
write_env "AUTH_MODE=ldap" "APP_PORT=9901" "DBV_DB_ALIAS=bpm9910-db"
sed '/^AUTH_JWT_SECRET=/d' "$DEPLOY/.env" > "$CASE/env.tmp" && mv "$CASE/env.tmp" "$DEPLOY/.env"
expect_guard_failure "ldap without AUTH_JWT_SECRET" "without AUTH_JWT_SECRET"

for port_line in "APP_PORT=" "APP_PORT=9900"; do
  setup_case dev
  write_env "AUTH_MODE=keycloak" "$port_line" "DBV_DB_ALIAS=bpm9910-db"
  expect_guard_failure "dev with $port_line" "the dev stack needs its own port"
done

for alias_line in "DBV_DB_ALIAS=" "DBV_DB_ALIAS=bpm-db"; do
  setup_case dev
  write_env "AUTH_MODE=keycloak" "APP_PORT=9901" "$alias_line"
  expect_guard_failure "dev with $alias_line" "Give the dev db its own alias"
done

setup_case dev
write_env "AUTH_MODE=keycloak" "APP_PORT=9901" "DBV_DB_ALIAS=sop-archivist-db"
expect_guard_failure "dev alias taken by sop-archivist" "is already used on 'dbv-test'"

setup_case production
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=./data"
expect_guard_failure "relative BACKUP_DIR other than ./backups" "BACKUP_DIR is a relative path"

setup_case production
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=$DEPLOY/dumps"
expect_guard_failure "absolute BACKUP_DIR inside the deploy folder" "BACKUP_DIR points inside"

setup_case production
DEPLOY_ARG="data/deployments/bpm"
expect_guard_failure "relative deploy folder" "must be an absolute path"

setup_case production
DEPLOY_ARG="$CASE/data/deployments/missing"
expect_guard_failure "missing deploy folder" "deploy folder does not exist"

setup_case production
DEPLOY_ARG="$CASE/data/deployments/../deployments/bpm"
expect_guard_failure "deploy folder with .." "must not contain"

setup_case production
touch "$CTL/daemon-down"
expect_guard_failure "Docker daemon unreachable" "cannot reach the Docker daemon"

setup_case production
touch "$CTL/probe-fail"
expect_guard_failure "host does not see the same path" "does not see the deploy folder"

setup_case production
echo "nginx:1.27-alpine" > "$CTL/missing-images"
expect_guard_failure "base image missing" "base image(s) missing"
check "guard (production): missing image is named" has_output "nginx:1.27-alpine. Bring"

setup_case production
write_env "AUTH_MODE=keycloak" "DBV_NETWORK=dbv-missing"
expect_guard_failure "shared network missing" "shared network 'dbv-missing'"

setup_case production
printf '%s\n' "$DEPLOY" "/home/someone/business-process-mgmt" > "$CTL/project-dirs"
expect_guard_failure "hand-run containers from the old folder" "has containers started from /home/someone/business-process-mgmt"

setup_case dev
printf '%s\n' "$CASE/data/deployments/bpm" > "$CTL/project-dirs"
expect_guard_failure "project name of the other stack" "or fix BPM_COMPOSE_PROJECT"

setup_case production
touch "$CTL/no-volume"
expect_guard_failure "db volume missing" "db volume business-process-mgmt_pgdata does not exist"

for bad_dir in "/" "/usr"; do
  setup_case production
  DEPLOY_ARG="$bad_dir"
  run_deploy
  check "guard: deploy folder $bad_dir" sh -c "[ $rc != 0 ] && grep -qE \"is '/'|two levels\" '$OUT' && ! grep -qF 'up -d' '$CTL/calls.log'"
done

setup_case production
cp "$DEPLOY/.env" "$SRC/.env"
DEPLOY_ARG="$SRC"
run_deploy
check "guard: deploy folder is the checkout" sh -c "[ $rc != 0 ] && grep -qF 'inside it' '$OUT' && [ -d '$SRC/.git' ] && ! grep -qF 'up -d' '$CTL/calls.log'"

setup_case production
DEPLOY_ARG="$CASE/builds"
cp "$DEPLOY/.env" "$CASE/builds/.env"
run_deploy
check "guard: checkout inside the deploy folder" sh -c "[ $rc != 0 ] && grep -qF 'checkout is inside' '$OUT' && [ -d '$SRC/.git' ] && ! grep -qF 'up -d' '$CTL/calls.log'"

# --- health check ------------------------------------------------------------------
setup_case production
echo 3 > "$CTL/restarting-calls"
run_deploy
check "health waits through 'restarting' then passes" sh -c "[ $rc = 0 ] && grep -qF 'not ready yet (3/4)' '$OUT'"
check "health output has no secrets" has_no_secrets

setup_case production
touch "$CTL/health-never"
run_deploy
check "health that never passes fails the job" failed_run
check "failed health shows logs" has_output "fake backend logs"
check "failed health output has no secrets" has_no_secrets

setup_case production
echo dev > "$CTL/mode"
run_deploy
check "production: running auth mode other than keycloak fails the job" sh -c "[ $rc != 0 ] && grep -qF 'mode other than keycloak' '$OUT'"
check "auth mode body is not printed" has_no_secrets

setup_case dev
run_deploy
check "dev: running auth mode that differs from .env fails the job" sh -c "[ $rc != 0 ] && grep -qF 'mode other than dev' '$OUT'"

setup_case production
touch "$CTL/up-fail"
run_deploy
check "compose up failure fails the job with logs" sh -c "[ $rc != 0 ] && grep -qF 'fake backend logs' '$OUT'"

echo
echo "passed: $passed, failed: $failed"
[ "$failed" = 0 ]

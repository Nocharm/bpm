#!/bin/sh
# Deploy BPM from a GitLab deploy job onto the server's Docker daemon (production :9900 or dev :9901).
# Runs inside docker:27-cli (busybox sh) on the bpm-deploy runner, which mounts the host Docker
# socket and both deploy folders at the SAME path on both sides. The job sets BPM_DEPLOY_ENV,
# BPM_DEPLOY_DIR and BPM_COMPOSE_PROJECT. Setup and every guard message: docs/deploy/gitlab-runner.md.
#
# Never add `set -x`, print .env or `docker compose config` output, or run down/prune/
# --remove-orphans here: values are secrets, and prune deletes build-only base images
# that cannot be pulled again (the server has no Docker Hub).
set -eu

DEPLOY_ENV="${BPM_DEPLOY_ENV:-}"
DEPLOY_DIR="${BPM_DEPLOY_DIR:-}"
PROJECT="${BPM_COMPOSE_PROJECT:-}"
SRC_DIR="${CI_PROJECT_DIR:-$(pwd)}"
# Health wait: first boot of a big DB runs create_all and column reconciliation. Defaults = 5 min.
HEALTH_TRIES="${BPM_HEALTH_TRIES:-60}"
HEALTH_INTERVAL="${BPM_HEALTH_INTERVAL:-5}"
# 1 only for a genuinely new stack: lets compose create an empty <project>_pgdata volume.
ALLOW_NEW_DB="${BPM_ALLOW_NEW_DB:-}"
# Probe container for the host-path check. Same image as the job, already on the server.
PROBE_IMAGE="docker:27-cli"
DOCKER_SOCKET="unix:///var/run/docker.sock"
# Production's port and db alias (docker-compose.yml defaults). The dev stack must use neither.
PRODUCTION_PORT="9900"
PRODUCTION_DB_ALIAS="bpm-db"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] FAILED: %s\n' "$*" >&2
  exit 1
}

# Every docker call runs with an empty environment. Compose prefers process env over .env
# when filling ${VAR}, and GitLab exports all CI variables into the job; COMPOSE_* and a
# group-level DOCKER_HOST would also redirect compose itself. Compose reads .env on its own.
run_docker() {
  env -i PATH="$PATH" HOME="${HOME:-/root}" DOCKER_HOST="$DOCKER_SOCKET" docker "$@"
}

# The project name is always explicit so a stray COMPOSE_PROJECT_NAME can never pick the stack.
# Only production runs the db-backup sidecar (profile "backup"); dev has no backups.
run_compose() {
  if [ "$DEPLOY_ENV" = "production" ]; then
    run_docker compose -p "$PROJECT" -f docker-compose.yml --profile backup "$@"
  else
    run_docker compose -p "$PROJECT" -f docker-compose.yml "$@"
  fi
}

# Read KEY's value from the deploy folder's .env the way a plain dotenv line is written:
# last assignment wins, surrounding spaces, quotes, CR and a trailing " # comment" are dropped.
# The value is only compared by callers, never printed.
read_env_value() {
  sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}$1[[:space:]]*=//p" "$DEPLOY_DIR/.env" \
    | tail -n 1 \
    | tr -d '\r' \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/"
}

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# Same spellings pydantic accepts for a bool setting (backend/app/settings.py).
is_truthy() {
  case "$(to_lower "$1")" in
    1 | on | t | true | y | yes) return 0 ;;
  esac
  return 1
}

is_falsy() {
  case "$(to_lower "$1")" in
    0 | off | f | false | n | no) return 0 ;;
  esac
  return 1
}

# Mirror of Settings.resolved_auth_mode() plus compose's `AUTH_ENABLED: ${AUTH_ENABLED:-true}`.
# Prints keycloak | ldap | dev, or "invalid" when the backend would refuse to start.
resolve_auth_mode() {
  raw="$(to_lower "$(read_env_value AUTH_MODE)")"
  case "$raw" in
    keycloak | ldap | dev) echo "$raw"; return 0 ;;
    "") ;;
    *) echo "invalid"; return 0 ;;
  esac
  enabled="$(read_env_value AUTH_ENABLED)"
  [ -n "$enabled" ] || enabled="true"
  if is_truthy "$enabled"; then
    echo "keycloak"
  elif is_falsy "$enabled"; then
    echo "dev"
  else
    echo "invalid"
  fi
}

# Resolve an existing directory to its physical path (symlinks and .. removed).
resolve_dir() {
  (cd -P "$1" && pwd)
}

is_same_or_inside() {
  case "$1" in
    "$2" | "$2"/*) return 0 ;;
  esac
  return 1
}

check_job_variables() {
  case "$DEPLOY_ENV" in
    production | dev) ;;
    *) fail "BPM_DEPLOY_ENV must be 'production' or 'dev' (set per job in .gitlab-ci.yml)." ;;
  esac
  [ -n "$PROJECT" ] || fail "BPM_COMPOSE_PROJECT is empty (set per job in .gitlab-ci.yml)."
  case "$PROJECT" in
    [!a-z0-9]* | *[!a-z0-9_-]*) fail "BPM_COMPOSE_PROJECT must be lowercase letters, digits, '-' or '_', starting with a letter or digit." ;;
  esac
  [ -n "$DEPLOY_DIR" ] || fail "BPM_DEPLOY_DIR is empty (set per job in .gitlab-ci.yml)."
  log "environment: $DEPLOY_ENV, compose project: $PROJECT"
}

check_deploy_dir() {
  # Strip trailing slashes so "/data/x/" and "/data/x" compare the same.
  while [ "${DEPLOY_DIR%/}" != "$DEPLOY_DIR" ] && [ "$DEPLOY_DIR" != "/" ]; do
    DEPLOY_DIR="${DEPLOY_DIR%/}"
  done
  case "$DEPLOY_DIR" in
    *'$'*) fail "BPM_DEPLOY_DIR holds an unexpanded variable. Set the CI/CD variable BPM_DEPLOY_ROOT (gitlab-runner.md 1)." ;;
  esac
  case "$DEPLOY_DIR" in
    /) fail "deploy folder is '/'. Set BPM_DEPLOY_DIR to a dedicated folder such as /data/deployments/bpm." ;;
    /*) ;;
    *) fail "deploy folder must be an absolute path (BPM_DEPLOY_DIR is relative)." ;;
  esac
  case "$DEPLOY_DIR" in
    *//* | */./* | */../* | */. | */..) fail "deploy folder path must not contain '//', '.' or '..' parts." ;;
  esac
  case "${DEPLOY_DIR#/}" in
    */*) ;;
    *) fail "deploy folder must be at least two levels deep (for example /data/deployments/bpm). Is the CI/CD variable BPM_DEPLOY_ROOT set?" ;;
  esac
  [ -d "$DEPLOY_DIR" ] || fail "deploy folder does not exist inside the job. Check the runner's --docker-volumes mount (gitlab-runner.md 2)."

  deploy_real="$(resolve_dir "$DEPLOY_DIR")"
  src_real="$(resolve_dir "$SRC_DIR")"
  if is_same_or_inside "$deploy_real" "$src_real"; then
    fail "deploy folder is the job checkout or inside it. Point BPM_DEPLOY_DIR at the mounted deploy folder."
  fi
  if is_same_or_inside "$src_real" "$deploy_real"; then
    fail "job checkout is inside the deploy folder. Syncing would delete it."
  fi
  log "deploy folder: $DEPLOY_DIR"
}

check_auth_settings() {
  AUTH_MODE_EXPECTED="$(resolve_auth_mode)"
  [ "$AUTH_MODE_EXPECTED" != "invalid" ] \
    || fail ".env AUTH_MODE/AUTH_ENABLED is not a value the backend accepts (AUTH_MODE: keycloak, ldap or dev)."
  # ldap is production's fallback when Keycloak is down (AD login + local accounts); dev never.
  if [ "$DEPLOY_ENV" = "production" ] && [ "$AUTH_MODE_EXPECTED" = "dev" ]; then
    fail ".env resolves to auth mode 'dev'; production must be keycloak or ldap (AUTH_MODE=keycloak)."
  fi
  if [ "$AUTH_MODE_EXPECTED" = "dev" ] && ! is_truthy "$(read_env_value DEV_ENFORCE_PERMISSIONS)"; then
    fail ".env uses the dev login without DEV_ENFORCE_PERMISSIONS=true, which makes every user a sysadmin. Set it (and BPM_SYSADMINS)."
  fi
  if [ "$AUTH_MODE_EXPECTED" = "ldap" ] && [ -z "$(read_env_value AUTH_JWT_SECRET)" ]; then
    fail ".env uses ldap login without AUTH_JWT_SECRET; the backend would not start (openssl rand -hex 32)."
  fi
  log ".env auth mode: $AUTH_MODE_EXPECTED"
}

# Port and db alias tell the two .env files apart: a swapped .env must stop here.
check_stack_identity() {
  port="$(read_env_value APP_PORT)"
  if [ "$DEPLOY_ENV" = "production" ]; then
    case "$port" in
      "" | "$PRODUCTION_PORT") ;;
      *) fail ".env APP_PORT is not $PRODUCTION_PORT. Is this the dev stack's .env?" ;;
    esac
    port="$PRODUCTION_PORT"
  elif [ -z "$port" ] || [ "$port" = "$PRODUCTION_PORT" ]; then
    fail ".env APP_PORT is empty or $PRODUCTION_PORT; the dev stack needs its own port (9901). Is this production's .env?"
  fi
  log ".env APP_PORT: $port"

  DB_ALIAS="$(read_env_value DBV_DB_ALIAS)"
  [ -n "$DB_ALIAS" ] || DB_ALIAS="$PRODUCTION_DB_ALIAS"
  case "$DB_ALIAS" in
    [!A-Za-z0-9]* | *[!A-Za-z0-9_.-]*) fail ".env DBV_DB_ALIAS must be letters, digits, '.', '-' or '_'." ;;
  esac
  if [ "$DEPLOY_ENV" = "dev" ] && [ "$DB_ALIAS" = "$PRODUCTION_DB_ALIAS" ]; then
    fail ".env DBV_DB_ALIAS is empty or '$PRODUCTION_DB_ALIAS' (production's). Give the dev db its own alias, e.g. bpm9910-db."
  fi
  log ".env DBV_DB_ALIAS: $DB_ALIAS"

  compose_project="$(read_env_value COMPOSE_PROJECT_NAME)"
  if [ -n "$compose_project" ] && [ "$compose_project" != "$PROJECT" ]; then
    fail ".env COMPOSE_PROJECT_NAME differs from BPM_COMPOSE_PROJECT ($PROJECT). Is this the other stack's .env?"
  fi
  for key in COMPOSE_FILE COMPOSE_PROFILES; do
    [ -z "$(read_env_value "$key")" ] \
      || fail ".env sets $key. Remove it: the deploy script picks the compose file and the backup profile."
  done
}

check_env_file() {
  [ -f "$DEPLOY_DIR/.env" ] || fail "no .env in the deploy folder. Copy it there once by hand (gitlab-runner.md 3)."

  password="$(read_env_value POSTGRES_PASSWORD)"
  if [ -z "$password" ] || [ "$password" = "change-me" ]; then
    fail ".env POSTGRES_PASSWORD is empty or the .env.example placeholder."
  fi

  check_auth_settings
  check_stack_identity

  backup_dir="$(read_env_value BACKUP_DIR)"
  case "$backup_dir" in
    "" | "./backups" | "./backups/" | "backups" | "backups/") log ".env BACKUP_DIR: default (./backups)" ;;
    /*)
      backup_trimmed="${backup_dir%/}"
      if [ -z "$backup_trimmed" ] || is_same_or_inside "$backup_trimmed" "$DEPLOY_DIR"; then
        fail ".env BACKUP_DIR points inside the deploy folder; the sync would delete it. Use ./backups or a path outside."
      fi
      log ".env BACKUP_DIR: absolute path outside the deploy folder"
      ;;
    *) fail ".env BACKUP_DIR is a relative path other than ./backups; the sync would delete it. Use ./backups or an absolute path outside." ;;
  esac
}

# "The folder exists in the job" does not prove the host has the same folder at the same path.
# Compose hands absolute bind paths to the host daemon, which silently creates missing ones as
# empty root dirs. A fresh container with --mount (fails on a missing path, never creates it)
# looks for a marker file written from inside the job.
check_host_path() {
  probe_name=".deploy-probe.${CI_JOB_ID:-$$}"
  : > "$DEPLOY_DIR/$probe_name"
  if run_docker run --rm --pull never --network none \
      --mount "type=bind,src=$DEPLOY_DIR,dst=/probe,readonly" \
      --entrypoint test "$PROBE_IMAGE" -f "/probe/$probe_name"; then
    probe_ok=1
  else
    probe_ok=0
  fi
  rm -f "$DEPLOY_DIR/$probe_name"
  [ "$probe_ok" = 1 ] \
    || fail "the host does not see the deploy folder at the same path. Mount it as <path>:<path> in the runner (gitlab-runner.md 2)."
  log "host path check: same folder on host and job"
}

# Base images named by Dockerfile FROM lines (minus build-stage aliases) and compose image: lines.
list_base_images() {
  for dockerfile in "$SRC_DIR"/*/Dockerfile; do
    [ -f "$dockerfile" ] || continue
    awk '
      toupper($1) == "FROM" {
        i = 2
        while (i <= NF && $i ~ /^--/) i++
        ref = $i
        if (!(ref in stage)) print ref
        for (j = i + 1; j < NF; j++) if (toupper($j) == "AS") stage[$(j + 1)] = 1
      }
    ' "$dockerfile"
  done
  sed -n 's/^[[:space:]]*image:[[:space:]]*//p' "$SRC_DIR/docker-compose.yml" \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/"
}

check_docker_daemon() {
  server_version="$(run_docker version --format '{{.Server.Version}}')" \
    || fail "cannot reach the Docker daemon through $DOCKER_SOCKET. Check the runner's docker.sock mount."
  log "docker daemon: $server_version"
  log "compose (job image): $(run_docker compose version --short)"
}

# On the shared network the alias is the only thing that tells the db containers apart
# (db-viewer connects by alias). A duplicate makes its connection test pass against the wrong DB.
check_db_alias_unique() {
  container_ids="$(run_docker network inspect "$SHARED_NETWORK" -f '{{range $id, $c := .Containers}}{{$id}} {{end}}')" \
    || fail "cannot list containers on '$SHARED_NETWORK'."
  for container_id in $container_ids; do
    # A container that stopped between the two calls has nothing to collide with.
    info="$(run_docker inspect -f "{{index .Config.Labels \"com.docker.compose.project\"}}|{{with index .NetworkSettings.Networks \"$SHARED_NETWORK\"}}{{range .Aliases}}{{.}},{{end}}{{range .DNSNames}}{{.}},{{end}}{{end}}" "$container_id" 2> /dev/null)" \
      || continue
    owner="${info%%|*}"
    [ "$owner" = "$PROJECT" ] && continue
    case ",${info#*|}" in
      *",$DB_ALIAS,"*) fail "db alias '$DB_ALIAS' (DBV_DB_ALIAS) is already used on '$SHARED_NETWORK' by a container outside project $PROJECT. Pick another alias." ;;
    esac
  done
  log "db alias is unique on $SHARED_NETWORK"
}

# Containers of this project started from another folder are the hand-run stack from before the
# pipeline, or BPM_COMPOSE_PROJECT names the other environment. Either way compose must not touch them.
check_project_owner() {
  working_dirs="$(run_docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Label "com.docker.compose.project.working_dir"}}')" \
    || fail "cannot list containers of project $PROJECT."
  other_dir="$(printf '%s\n' "$working_dirs" | grep -vxF -e "$DEPLOY_DIR" -e "$deploy_real" -e '' | head -n 1)"
  [ -z "$other_dir" ] \
    || fail "project $PROJECT has containers started from $other_dir, not the deploy folder. Do the one-time switch (gitlab-runner.md 6) or fix BPM_COMPOSE_PROJECT."
  log "project $PROJECT: no containers from another folder"
}

# A wrong project name would quietly start an empty database next to the real one.
check_db_volume() {
  volume="${PROJECT}_pgdata"
  if run_docker volume inspect "$volume" > /dev/null 2>&1; then
    log "db volume: $volume (existing data is kept)"
  elif [ "$ALLOW_NEW_DB" = "1" ]; then
    log "db volume $volume does not exist; BPM_ALLOW_NEW_DB=1, compose creates an empty one"
  else
    fail "db volume $volume does not exist. Check BPM_COMPOSE_PROJECT against 'docker volume ls'; for a genuinely new stack run the pipeline with BPM_ALLOW_NEW_DB=1."
  fi
}

check_prerequisites() {
  SHARED_NETWORK="$(read_env_value DBV_NETWORK)"
  [ -n "$SHARED_NETWORK" ] || SHARED_NETWORK="dbv-shared"
  case "$SHARED_NETWORK" in
    [!A-Za-z0-9]* | *[!A-Za-z0-9_.-]*) fail ".env DBV_NETWORK must be letters, digits, '.', '-' or '_'." ;;
  esac
  run_docker network inspect "$SHARED_NETWORK" > /dev/null 2>&1 \
    || fail "shared network '$SHARED_NETWORK' (DBV_NETWORK) does not exist. Create it as in setup-once.md A9; this job never creates networks."
  log "shared network: $SHARED_NETWORK"
  check_db_alias_unique

  missing=""
  for image in $(list_base_images | sort -u); do
    if run_docker image inspect "$image" > /dev/null 2>&1; then
      log "base image present: $image"
    else
      missing="$missing $image"
    fi
  done
  [ -z "$missing" ] \
    || fail "base image(s) missing on the server:$missing. Bring them in as amd64 tars (deploy.md 0)."

  check_project_owner
  check_db_volume
}

checksum_of() {
  if [ -f "$1" ]; then cksum < "$1"; else echo "absent"; fi
}

# Replace everything in the deploy folder except .env and backups/ with the checkout (no .git).
sync_deploy_dir() {
  for entry in "$DEPLOY_DIR"/* "$DEPLOY_DIR"/.[!.]* "$DEPLOY_DIR"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    case "${entry##*/}" in
      .env | backups) continue ;;
    esac
    rm -rf "$entry"
  done

  set --
  for entry in "$SRC_DIR"/* "$SRC_DIR"/.[!.]* "$SRC_DIR"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    case "${entry##*/}" in
      .git | .env | backups) continue ;;
    esac
    set -- "$@" "${entry##*/}"
  done
  [ "$#" -gt 0 ] || fail "job checkout is empty."
  (cd "$SRC_DIR" && tar -cf - "$@") | (cd "$DEPLOY_DIR" && tar -xf -)
}

read_app_version() {
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC_DIR/frontend/package.json" | head -n 1
}

write_deploy_marker() {
  {
    echo "environment=$DEPLOY_ENV"
    echo "project=$PROJECT"
    echo "commit=${CI_COMMIT_SHA:-unknown}"
    echo "branch=${CI_COMMIT_BRANCH:-unknown}"
    echo "pipeline=${CI_PIPELINE_ID:-unknown}"
    echo "job=${CI_JOB_ID:-unknown}"
    echo "version=$(read_app_version)"
    echo "deployed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } > "$DEPLOY_DIR/.deployed"
}

show_failure_and_exit() {
  printf '[deploy] FAILED: %s\n' "$1" >&2
  # Best-effort diagnostics: a failing ps must not hide the logs, and the job fails anyway.
  run_compose ps || true
  run_compose logs --tail 80 backend proxy || true
  exit 1
}

# One HTTP GET through the proxy container (the job's localhost is not the server).
# While backend/proxy restart, exec itself fails; callers treat that as "not ready yet".
fetch_via_proxy() {
  run_compose exec -T proxy wget -q -T 10 -O - "http://127.0.0.1$1" 2> /dev/null
}

wait_until_healthy() {
  attempt=1
  while [ "$attempt" -le "$HEALTH_TRIES" ]; do
    health="$(fetch_via_proxy /api/health || true)"
    if printf '%s' "$health" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      # The body also carries the Keycloak issuer and client ID from .env: judge, never print.
      mode_body="$(fetch_via_proxy /api/auth/mode || true)"
      if printf '%s' "$mode_body" | grep -q "\"mode\"[[:space:]]*:[[:space:]]*\"$AUTH_MODE_EXPECTED\""; then
        mode_ok=1
      elif printf '%s' "$mode_body" | grep -q '"mode"'; then
        show_failure_and_exit "/api/auth/mode reports a mode other than $AUTH_MODE_EXPECTED (the .env setting)."
      else
        mode_ok=0
      fi
      if [ "$mode_ok" = 1 ] && fetch_via_proxy / > /dev/null; then
        log "health: /api/health ok, auth mode $AUTH_MODE_EXPECTED, / 200"
        return 0
      fi
    fi
    log "not ready yet ($attempt/$HEALTH_TRIES)"
    attempt=$((attempt + 1))
    sleep "$HEALTH_INTERVAL"
  done
  show_failure_and_exit "the app did not become healthy in time."
}

# Subnet(s) of this stack's compose network, or nothing when it does not exist yet (first deploy).
read_stack_subnet() {
  subnet="$(run_docker network inspect "${PROJECT}_default" -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2> /dev/null)" \
    || return 1
  printf '%s' "${subnet% }"
}

# Is SUBNET listed in .env FORWARDED_ALLOW_IPS (comma-separated, spaces ignored)?
is_subnet_forwarded() {
  allowed="$(read_env_value FORWARDED_ALLOW_IPS | tr -d ' ')"
  case ",$allowed," in
    *",$1,"*) return 0 ;;
  esac
  return 1
}

# ldap login throttles per (login id, client IP). With FORWARDED_ALLOW_IPS wrong every client is
# nginx's address, so anyone can lock any account out. Under ldap that stops the deploy before
# compose; the network from the previous deploy tells the subnet. Other modes only warn (after up).
check_forwarded_ips_before() {
  [ "$AUTH_MODE_EXPECTED" = "ldap" ] || return 0
  if ! subnet="$(read_stack_subnet)"; then
    log "${PROJECT}_default does not exist yet (first deploy); FORWARDED_ALLOW_IPS is checked after up"
    return 0
  fi
  is_subnet_forwarded "$subnet" \
    || fail "ldap login needs .env FORWARDED_ALLOW_IPS to include the compose network $subnet (login throttling is per client IP). Set it and run again (gitlab-runner.md 5)."
  log "FORWARDED_ALLOW_IPS covers the compose network $subnet"
}

# The compose network's subnet is assigned by Docker, so FORWARDED_ALLOW_IPS can only be filled
# in after the first deploy. Under keycloak/dev a mismatch is a warning: client IPs log as nginx's.
# Under ldap it fails the job (the app is already up) so the value gets fixed before anyone relies on it.
check_forwarded_ips_after() {
  if ! subnet="$(read_stack_subnet)"; then
    report_forwarded_problem "could not read the subnet of ${PROJECT}_default; check FORWARDED_ALLOW_IPS by hand (gitlab-runner.md 5)."
    return 0
  fi
  if is_subnet_forwarded "$subnet"; then
    log "FORWARDED_ALLOW_IPS covers the compose network $subnet"
  elif [ -z "$(read_env_value FORWARDED_ALLOW_IPS)" ]; then
    report_forwarded_problem ".env FORWARDED_ALLOW_IPS is empty; the compose network is $subnet. Write it to .env and run the pipeline again (gitlab-runner.md 5)."
  else
    report_forwarded_problem ".env FORWARDED_ALLOW_IPS does not include the compose network $subnet. Fix .env and run the pipeline again (gitlab-runner.md 5)."
  fi
}

report_forwarded_problem() {
  if [ "$AUTH_MODE_EXPECTED" = "ldap" ]; then
    fail "deployed, but ldap login is unsafe until fixed: $1"
  fi
  log "WARNING: $1"
}

main() {
  check_job_variables
  check_deploy_dir
  check_env_file
  check_docker_daemon
  check_host_path
  check_prerequisites
  check_forwarded_ips_before

  if [ -f "$DEPLOY_DIR/.deployed" ]; then is_first_deploy=0; else is_first_deploy=1; fi
  backup_script_before="$(checksum_of "$DEPLOY_DIR/scripts/db-backup.sh")"

  sync_deploy_dir
  write_deploy_marker
  log "synced commit ${CI_COMMIT_SHA:-unknown} (version $(read_app_version))"

  cd "$DEPLOY_DIR"
  run_compose config --quiet || fail "docker compose config rejected the deploy folder (output hidden: it expands secrets)."
  run_compose up -d --build || show_failure_and_exit "docker compose up failed."

  # nginx resolves the backend name only at start; a recreated backend gets a new address.
  run_compose restart proxy || show_failure_and_exit "proxy restart failed."
  if [ "$DEPLOY_ENV" = "production" ] \
      && { [ "$is_first_deploy" = 1 ] || [ "$backup_script_before" != "$(checksum_of scripts/db-backup.sh)" ]; }; then
    # The script is a bind mount, so `up` keeps the old loop running unless recreated.
    log "db-backup.sh changed or first deploy: recreating db-backup"
    run_compose up -d --force-recreate db-backup || show_failure_and_exit "db-backup recreate failed."
  fi

  wait_until_healthy
  check_forwarded_ips_after
  run_compose ps
  log "done"
}

main "$@"

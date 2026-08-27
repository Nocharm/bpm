#!/bin/sh
# 일간 pg_dump 백업 루프 (compose db-backup 사이드카 전용) — 정책·복구 절차: docs/deploy/backup.md
# 매일 BACKUP_TIME(KST) 이후 하루 1회 덤프. 기동 직후에도 오늘자 덤프가 없으면 즉시 1회(배포 베이스라인).
# 검증(pg_restore --list) 통과 시에만 .dump로 확정 — 깨진 덤프가 정상 파일로 남지 않게.
# 접속 정보는 표준 PG* 환경변수(PGHOST/PGUSER/PGPASSWORD/PGDATABASE) — compose가 주입.

BACKUP_DIR=/backups
BACKUP_TIME="${BACKUP_TIME:-04:00}"            # KST HH:MM — 이 시각 이후 하루 1회
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"  # 보존 일수 — 초과분은 백업 성공 시마다 삭제
# alpine(musl)엔 zoneinfo가 없어 TZ=Asia/Seoul이 조용히 UTC로 폴백 → POSIX 오프셋 표기 사용(KST는 DST 없음)
KST="KST-9"

log() { echo "[db-backup] $(TZ=$KST date '+%Y-%m-%d %H:%M:%S KST') $*"; }

has_dump_today() {
  today=$(TZ=$KST date +%Y%m%d)
  ls "$BACKUP_DIR/bpm-$today-"*.dump >/dev/null 2>&1
}

# 실행 기록(batch_job_runs) — 설정 Batch jobs 탭 소스. backend 모델(models.BatchJobRun)과 스키마 계약:
# 변경 시 양쪽 함께 갱신. CREATE IF NOT EXISTS는 backend 최초 create_all 전 첫 백업 대비.
# 기록 실패(예: db 재기동 중)는 백업 흐름을 막지 않는다 — 로그만 남긴다.
record_status() {
  psql -q \
    -c "CREATE TABLE IF NOT EXISTS batch_job_runs (job VARCHAR(40) NOT NULL, outcome VARCHAR(10) NOT NULL, ran_at TIMESTAMPTZ NOT NULL, detail TEXT, PRIMARY KEY (job, outcome))" \
    -c "INSERT INTO batch_job_runs (job, outcome, ran_at, detail) VALUES ('db_backup', '$1', now(), '$2') ON CONFLICT (job, outcome) DO UPDATE SET ran_at = EXCLUDED.ran_at, detail = EXCLUDED.detail" \
    >/dev/null || log "status write failed ($1)"
}

run_backup() {
  ts=$(TZ=$KST date +%Y%m%d-%H%M%S)
  tmp="$BACKUP_DIR/bpm-$ts.dump.tmp"
  if pg_dump -Fc -f "$tmp" && pg_restore --list "$tmp" >/dev/null; then
    mv "$tmp" "$BACKUP_DIR/bpm-$ts.dump"
    size=$(du -h "$BACKUP_DIR/bpm-$ts.dump" | cut -f1)
    log "ok bpm-$ts.dump ($size)"
    record_status success "bpm-$ts.dump ($size)"
    find "$BACKUP_DIR" -name 'bpm-*.dump' -mtime +"$RETENTION_DAYS" -delete
  else
    rm -f "$tmp"
    log "FAIL - dump or verify failed, retry in 60s"
    record_status failure "pg_dump or verify failed"
    return 1
  fi
}

mkdir -p "$BACKUP_DIR"
log "started (daily at $BACKUP_TIME KST, retention ${RETENTION_DAYS}d)"
has_dump_today || run_backup

while :; do
  sleep 60
  # HH:MM → HHMM 숫자 비교(문자열 > 는 POSIX test 미보장). 실패 시 오늘자 덤프가 없어 다음 분에 재시도.
  now=$(TZ=$KST date +%H%M)
  if ! has_dump_today && [ "$now" -ge "$(echo "$BACKUP_TIME" | tr -d ':')" ]; then
    run_backup
  fi
done

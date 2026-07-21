# BPM 문서 인덱스

프로젝트 문서를 카테고리별로 모아둔 목차. 저장소 개요는 루트 [`README.md`](../README.md), Claude 작업 지침은 [`CLAUDE.md`](../CLAUDE.md), 진행 로그는 [`PROGRESS.md`](../PROGRESS.md).

## 핵심 참조
- [`spec.md`](spec.md) — 기능 명세(데이터 모델·UX·구현 순서). **살아있는 명세**.

## 배포 · DB ([`deploy/`](deploy/))
- [`deploy/deploy.md`](deploy/deploy.md) — 서버 docker-compose 배포 절차(포트 3333·nginx 토폴로지·Keycloak·AD 동기화).
- [`deploy/db-seed.md`](deploy/db-seed.md) — DB 초기화·데모 시드(`python -m scripts.reset_db`).
- [`deploy/db-migration-9910.md`](deploy/db-migration-9910.md) — 운영 DB 복사 → 검증 스택(9910) 마이그레이션 절차.

## QA · 검증 ([`qa/`](qa/))
- [`qa/alarm-audit.md`](qa/alarm-audit.md) — 알림 기능 전수 조사·감사.
- [`qa/ai-connectivity-test.md`](qa/ai-connectivity-test.md) — AI(LLM) 연결성 점검 절차.
- [`qa/ai-real-model-smoke.md`](qa/ai-real-model-smoke.md) — AI 실모델 스모크 테스트.

## 매뉴얼 ([`manual/`](manual/))
- 사용자 매뉴얼 — 일반([EN](manual/user-manual-general-en.md)·[KO](manual/user-manual-general-ko.md)) / 편집([EN](manual/user-manual-editing-en.md)·[KO](manual/user-manual-editing-ko.md))
- 관리자 매뉴얼 — [EN](manual/admin-manual-en.md)·[KO](manual/admin-manual-ko.md)

## 교훈 ([`lessons/`](lessons/README.md))
캔버스 에디터(React Flow) 시행착오 방지 — 좌표·렌더·검증 함정. 에디터(`page.tsx`) 수정 전 필독.

## 설계 기록 ([`design/`](design/README.md))
기능별 설계 스냅샷(날짜별). 분야별 목록은 design 인덱스 참고. 버전 수명주기 요약([`design/version-lifecycle-summary.md`](design/version-lifecycle-summary.md))도 여기.

## 릴리스 공지 ([`notices/`](notices/))
- [2026-07-06](notices/2026-07-06-release.md) · [2026-07-13](notices/2026-07-13-release.md) · [2026-07 2차](notices/2026-07-release-2.md)

## 샘플 데이터 ([`samples/`](samples/))
CSV 임포트 샘플 3종(procurement·recruitment·incident-change).

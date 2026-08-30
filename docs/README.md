# BPM 문서 인덱스

프로젝트 문서를 카테고리별로 모아둔 목차. 저장소 개요는 루트 [`README.md`](../README.md), Claude 작업 지침은 [`CLAUDE.md`](../CLAUDE.md), 진행 로그는 [`PROGRESS.md`](../PROGRESS.md).

## 핵심 참조
- [`spec.md`](spec.md) — 기능 명세(데이터 모델·UX·구현 순서). **살아있는 명세**.

## 배포 · DB ([`deploy/`](deploy/))
- [`deploy/deploy.md`](deploy/deploy.md) — 서버 docker-compose 배포 절차(포트 3333·nginx 토폴로지·Keycloak·AD 동기화).
- [`deploy/backup.md`](deploy/backup.md) — DB 자동 백업 정책(db-backup 사이드카, 일간 04:00 KST·14일 보존)·복구 런북.
- [`deploy/db-seed.md`](deploy/db-seed.md) — DB 초기화·데모 시드(`python -m scripts.reset_db`).
- [`deploy/db-migration-9910.md`](deploy/db-migration-9910.md) — 운영 DB 복사 → 검증 스택(9910) 마이그레이션 절차.
- [`deploy/kb-embedding.md`](deploy/kb-embedding.md) — 지식기반(P2) 임베딩 설정(`EMBED_*`)·게시본 백필 절차.

## QA · 검증 ([`qa/`](qa/))
- [`qa/node-spacing-qa.md`](qa/node-spacing-qa.md) — height-shift(노드 간격 자동 재조정) 브라우저 QA T라운드 8항목(워스트 겹침·트윈·그룹/PNG·무오염·인라인 배제).
- [`qa/2026-08-20-field-promotion-qa.md`](qa/2026-08-20-field-promotion-qa.md) — 인터뷰 필드 승격 실브라우저 QA 29항목(스모크 `pw-smoke-field-promotion.mjs` 주도).
- [`qa/governance-ux-checklist.md`](qa/governance-ux-checklist.md) — 거버넌스 UX 4페이즈(P0 라이프사이클·C 승인 탭·B 카드 멤버·A 게시 동봉) 사용자 실검증 체크리스트.
- [`qa/dev-vs-main-checklist.md`](qa/dev-vs-main-checklist.md) — dev↔main 미반영 3묶음(컨설턴트 체계·HR 웹훅·조직 기준 전환)의 배포 순서·서버 확인 항목·백로그 12건.
- [`qa/alarm-audit.md`](qa/alarm-audit.md) — 알림 기능 전수 조사·감사.

## 매뉴얼 ([`manual/`](manual/))
- 사용자 매뉴얼 — 일반([EN](manual/user-manual-general-en.md)·[KO](manual/user-manual-general-ko.md)) / 편집([EN](manual/user-manual-editing-en.md)·[KO](manual/user-manual-editing-ko.md))
- 관리자 매뉴얼 — [EN](manual/admin-manual-en.md)·[KO](manual/admin-manual-ko.md)
- 슬라이드 매뉴얼([`manual/slides/`](manual/slides/)) — 실화면 스크린샷이 담긴 PPT형 스탠드얼론 HTML(←/→ 이동)+PDF. 사용자([KO](manual/slides/bpm-manual-user-ko.html)·[EN](manual/slides/bpm-manual-user-en.html)) / 관리자([KO](manual/slides/bpm-manual-admin-ko.html)·[EN](manual/slides/bpm-manual-admin-en.html)) — md 매뉴얼이 원본이며 갱신 시 함께 재생성한다.

## 교훈 ([`lessons/`](lessons/README.md))
캔버스 에디터(React Flow) 시행착오 방지 — 좌표·렌더·검증 함정. 에디터(`page.tsx`) 수정 전 필독.

## 설계 기록 ([`design/`](design/README.md))
아직 소비될 설계 문서만 유지(컨설턴트 계약·인터뷰 임포트 어댑터·거버넌스 UX·핸드오프). **main 머지된 기능의 스냅샷은 폐기** — git history에서 조회(`rules/common/documentation.md`).

## 릴리스 공지 ([`notices/`](notices/))
- [2026-07-06](notices/2026-07-06-release.md) · [2026-07-13](notices/2026-07-13-release.md) · [2026-07 2차](notices/2026-07-release-2.md) · [2026-08-14](notices/2026-08-14-release.md) · [2026-08-19](notices/2026-08-19-release.md) · [2026-08-25](notices/2026-08-25-release.md)
- [`notices/2026-08-09-consultant-delivery-interface-mail.md`](notices/2026-08-09-consultant-delivery-interface-mail.md) — 컨설팅사 발송용 메일 초안(수용 방향 + 전달 데이터 인터페이스(안)).

## 샘플 데이터 ([`samples/`](samples/))
CSV 임포트 샘플 3종(procurement·recruitment·incident-change).
[`samples/consultant-interview-sample/`](samples/consultant-interview-sample/) — 인터뷰 결과 JSON 합성 샘플 2파일(설정 > Framework > Interview import 입력, 실전달물 아님). canonical 전달물 샘플은 인터뷰 JSON 단일화(2026-08-18)로 제거.

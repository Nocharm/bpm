# Changelog

서비스 버전 기록. 버전 값은 `frontend/package.json` `version` 하나이고, 빌드 때 상단 바 서비스 이름 옆에 `vX.Y.Z`로 보인다.
**main 머지마다 버전을 올리고 `vX.Y.Z` 태그를 단다**(규칙: [`rules/common/git.md`](rules/common/git.md) "On Main Merge — 서비스 버전").
상세 작업 로그는 [`PROGRESS.md`](PROGRESS.md), 사용자 공지는 [`docs/notices/`](docs/notices/).

## v1.1.0 — 2026-10-21 (main, 미배포)

- 범위: v1.0.0 이후 main 머지 2회(10-16~17 6차, 10-21 7차)와 그 뒤 main 커밋.
- 출력: PNG 옵션 창(화면 그대로 / Word 문서용, 인쇄 크기 패널, 나눠 싣기 ZIP, 정렬 유지)·A4 가이드, Excel 인쇄용 문서(소요시간 `[h]:mm`)·CSV 수식 가드와 왕복 개선, 비교 PNG 옵션 창, 파일 이름 KST.
- 시스템 리뷰 수정 1~7단계: 그래프·SP 링크 보안 경계, 결재 정족수·행 잠금, 임포트 계보 매칭, 운영 PG 컬럼 형 보정·HR 동기화 이력, 편집 이탈 확인창, 확정 요청 중 점유, 끝 ≥2면 대표 끝 직접 선택.
- 캔버스 60fps 회복·축소 드래그 성능, 입출력 상자 사선 2:1, 상단 바 서비스 버전 표시.
- 배포 메모: `docker compose up -d --force-recreate db-backup`(사이드카 스크립트 변경, `docs/deploy/deploy.md` §3). 기동 로그의 중복 행 경고는 데이터를 바꾸지 않는다.
- 공지: [`docs/notices/2026-10-21-release.md`](docs/notices/2026-10-21-release.md) — 앱 공지가 08-25 이후 밀려 있어 v1.0.0 이전 변경까지 담은 통합본.

## v1.0.0 — 2026-10-14 (`a7d6cd99`, 운영 배포됨)

- 버전 관리 기준점: 2026-10-14 main 머지(5차, 노드 조건·IO 가시성·비교 상태 색)까지. 운영 서버가 이 커밋으로 배포돼 있던 시점에 버전 관리를 시작했다(2026-10-21). 이 빌드는 상단 바에 버전을 표시하지 않는다.
- 이전 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)와 git history.

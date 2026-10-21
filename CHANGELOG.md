# Changelog

서비스 버전 기록. 버전 값은 `frontend/package.json` `version` 하나이고, 빌드 때 상단 바 서비스 이름 옆에 `vX.Y.Z`로 보인다.
**main 머지마다 버전을 올리고 `vX.Y.Z` 태그를 단다**(규칙: [`rules/common/git.md`](rules/common/git.md) "On Main Merge — 서비스 버전").
상세 작업 로그는 [`PROGRESS.md`](PROGRESS.md), 사용자 공지는 [`docs/notices/`](docs/notices/).

## v1.1.1 — 2026-10-21 (`224b3daa`, 운영 배포됨 2026-10-21: 서버 `e4fde97b`)

- 사내 AI 모델 교체 GLM-5.2 → **GLM-5.3**(`glm-5.3-nvfp4`, SGLang) 대응: 5.3엔 `enable_thinking`이 없어 사고량을 `chat_template_kwargs`의 `reasoning_effort`(low/high, 최대는 생략)로 보내고 `clear_thinking: true`를 함께 보낸다(사내 공지 권장). 사고를 끄던 호출(첨부 추출·L6 행 초안·빈 응답 재시도)은 `low`.
- 배포 메모: 서버 `.env`의 `AI_MODEL=glm-5.3-nvfp4`(`AI_ENDPOINTS`를 쓰면 그 안의 model·models도). 코드와 모델은 같이 바꾼다 — 5.2 서버는 `low`를 최대 사고로 처리했고(종전 실측), 5.3 서버에 옛 코드를 붙이면 없어진 `enable_thinking`이 무시돼 사고를 끄던 호출까지 최대 사고로 돌 수 있다(추정).
- v1.1.0 배포 메모(`db-backup` 재생성)도 그대로 적용된다(v1.1.0은 배포하지 않고 v1.1.1로 이어짐).
- v1.1.1 태그 뒤 main(앱 빌드 무관): proxy 메모리 상한 128M → 96M(서버에서 직접 줄여 둔 값을 저장소에 맞춤). 서버 `docker-compose.yml`에 로컬 수정이 있으면 `git pull` 전에 `git checkout -- docker-compose.yml`.
- 배포: 서버는 `e4fde97b`(v1.1.1 태그 + 모델 id 문서 정정 + proxy 96M)라 상단 바는 v1.1.1. 그 뒤 main `13635c57`(공개 저장소 주소 가림)은 문서·주석만이라 재배포 불필요.

## v1.1.0 — 2026-10-21 (`24b25834`, 단독 배포 없음: v1.1.1로 배포)

- 범위: v1.0.0 이후 main 머지 2회(10-16~17 6차, 10-21 7차)와 그 뒤 main 커밋.
- 출력: PNG 옵션 창(화면 그대로 / Word 문서용, 인쇄 크기 패널, 나눠 싣기 ZIP, 정렬 유지)·A4 가이드, Excel 인쇄용 문서(소요시간 `[h]:mm`)·CSV 수식 가드와 왕복 개선, 비교 PNG 옵션 창, 파일 이름 KST.
- 시스템 리뷰 수정 1~7단계: 그래프·SP 링크 보안 경계, 결재 정족수·행 잠금, 임포트 계보 매칭, 운영 PG 컬럼 형 보정·HR 동기화 이력, 편집 이탈 확인창, 확정 요청 중 점유, 끝 ≥2면 대표 끝 직접 선택.
- 캔버스 60fps 회복·축소 드래그 성능, 입출력 상자 사선 2:1, 상단 바 서비스 버전 표시.
- 배포 메모: `docker compose up -d --force-recreate db-backup`(사이드카 스크립트 변경, `docs/deploy/deploy.md` §3). 기동 로그의 중복 행 경고는 데이터를 바꾸지 않는다.
- 공지: [`docs/notices/2026-10-21-release.md`](docs/notices/2026-10-21-release.md) — 앱 공지가 08-25 이후 밀려 있어 v1.0.0 이전 변경까지 담은 통합본.

## v1.0.0 — 2026-10-14 (`a7d6cd99`, 운영 배포됨)

- 버전 관리 기준점: 2026-10-14 main 머지(5차, 노드 조건·IO 가시성·비교 상태 색)까지. 운영 서버가 이 커밋으로 배포돼 있던 시점에 버전 관리를 시작했다(2026-10-21). 이 빌드는 상단 바에 버전을 표시하지 않는다.
- 이전 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)와 git history.

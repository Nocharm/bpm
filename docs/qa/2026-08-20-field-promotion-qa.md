# 필드 승격 QA 체크리스트 (2026-08-20)

설계 `docs/design/2026-08-19-field-promotion-design.md` · 플랜 Phase V. 실브라우저 검증은 QA 문서 주도(사용자 지시 2026-08-20) — 자동 항목은 `frontend/scripts/pw-smoke-field-promotion.mjs`가 체크하고, 이 표에 결과를 기록한다.

**환경**: 격리 sqlite DB(`reset_db` 시드) + backend 8000(`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false`) + frontend 3000 네이티브, 시스템 Chrome(playwright-core), devUser=admin.sys. 임포트는 설정 > Framework > Interview import(웹 단일 경로)로 샘플 2파일.

| # | 표면 | 항목 | 방식 | 결과 |
|---|---|---|---|---|
| 1 | 임포트 | dry-run: 파일 2건 OK · Created 4 · Notes 8(예외2+사이드3+open_item1+task_note1+유틸1) | 스모크 | ✅ 25/25 스모크 |
| 2 | 임포트 | apply → 재dry-run Unchanged 4(멱등 — 신규 필드가 시그니처를 흔들지 않음) | 스모크 | ✅ |
| 3 | 임포트 착지 | 노드 a01: input/output/data_form/system(+폴백) 고유 필드 착지 — 인스펙터 Details로 확인 | 스모크 | ✅ (+맵 필드 착지 [landing] 체크 동반) |
| 4 | 임포트 착지 | 노드 설명 KV 축소 — `Quote:`만 잔류, `Input:`/`Output:`/`System:`/`Data form:` 없음 | 스모크 | ✅ |
| 5 | 임포트 착지 | 맵 설명 `[Interview]` = `Owner role:`만 | 스모크 | ✅ |
| 6 | 상세 카드 | IO 블록 확장 — Start/End condition·Touch time(1h) 행 렌더(값 있을 때만) | 스모크 | ✅ |
| 7 | Notes | task_note 맵 행 렌더 — 교정 준비 4행. open_item은 L5 스코프 DB 적재(어댑터 테스트 커버 — L5 노트 표시 표면은 기존에도 없음, 백로그) | 스모크 | ✅ 4행 |
| 8 | 인스펙터 | Details 카드 — 임포트 IO 값·data_form 배지 표시(published 읽기 모드) | 스모크 | ✅ |
| 9 | 인스펙터 | system 폴백 힌트 아이콘 → 팝오버 원문(EAM) 표시 | 스모크 | ✅ |
| 10 | 인스펙터 | Parameters 7행 — Touch time 행 노출 | 스모크 | ✅ |
| 11 | 에디터(편집) | IO 리스트 add → blur 저장 → 서버 개행 join 확인(GET /graph) | 스모크 | ✅ |
| 12 | 에디터(편집) | IO 항목 remove → 서버 반영 | 스모크 | ✅ |
| 13 | 에디터(편집) | start/end 조건·data_form 입력 저장 | 스모크 | ✅ |
| 14 | 에디터(편집) | touch_time 입력 `1.75` → H.MM 정규화 `2.15` 에코 | 스모크 | ✅ 2.15 |
| 15 | 에디터(편집) | system 폴백 힌트 Apply → system에 원문 반영 | 스모크 | ✅ |
| 16 | SP 노드 | Details read-only 상속(링크 맵 sp_* 렌더)·파라미터 5필드 read-only·`attrsFromOwner` 문구 | 스모크 | ✅ (시드 SP는 draft 버전 — 딥링크 진입) |
| 17 | 설정 | Conditions & GMP 카드 렌더(오너) — 임포트 값 프리필 | 스모크 | ✅ |
| 18 | 설정 | GMP 셀렉트 `GMP Direct` 저장 → 상세 카드 배지 렌더 | 스모크 | ✅ |
| 19 | 설정 | GMP 폴백 힌트 팝오버 원문 표시 | 스모크 | ✅ |
| 20 | 거버넌스 | GMP 선정 후 재dry-run **Unchanged**(엔진이 sp_gmp 비교·갱신 제외 — 검토값 보존) | 스모크 | ✅ |
| 21 | 거버넌스 | 폴백 수정 후 재dry-run **Updated**(전달분이 진실 — 폴백은 재전달이 덮음) | 스모크 | ✅ Updated 1 |
| 22 | 콘솔 | 위 전 과정 page error 0건 | 스모크 | ✅ |
| 23 | CSV | 20컬럼 왕복·IO 개행 셀·SP 텍스트 드롭 경고·구 14컬럼 하위호환 | vitest(csv-import/export.test) | ✅ vitest 659 |
| 24 | Excel | 1안/2안 Touch time (h) 컬럼·numFmt | vitest(excel-*.test) | ✅ |
| 25 | Σ·AI | touch_time Σ duration 미러·resolveAiParamPatch 정규화/SP 드롭 | vitest(params/param-sum.test) | ✅ |
| 26 | 회귀 | `pw-smoke-interview-import.mjs`(승격 반영 단언 갱신) | 스모크 | ✅ 15/15 |
| 27 | 회귀 | `pw-smoke-framework-admin.mjs` | 스모크 | ✅ 7/7 |
| 28 | 회귀 | `pw-smoke-framework.mjs` | 스모크 | ✅ 25/25 |
| 29 | 게이트 | BE pytest·ruff / FE vitest·tsc·lint·build 최종 그린 | 명령 | ✅ BE 1141·ruff 0 / FE 659·tsc 0·build OK(잔여 lint 경고는 기존 pw-smoke-task8) |

**육안/보류 항목**
- 일괄편집 모달 touch_time 탭 — `MODE_META`가 `PARAM_FIELDS` 파생이라 로직상 자동 노출(단위테스트 커버), 실브라우저 스팟은 서버 배포 후 확인.
- 서버(평문 HTTP·postgres) 재검증 — A+B+C 동일 릴리스 배포 후 실파일 재임포트로 백필 확인(`docs/deploy/db-migration-9910.md`).

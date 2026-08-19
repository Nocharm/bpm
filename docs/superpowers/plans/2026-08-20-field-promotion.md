# 인터뷰 필드 승격 구현 플랜 (2026-08-20)

**Spec:** `docs/design/2026-08-19-field-promotion-design.md` (매핑 표·컬럼 정의·값 계약은 스펙이 진실 — 이 플랜은 실행 순서/검증만 다룬다)
**Goal:** 노드/SP 필드 대칭 확장(7번째 파라미터 touch_time 포함) + 폴백 컬럼 + 어댑터 착지 이동 + FallbackHint UI, 실브라우저 검증까지.
**Branch:** `feat/field-promotion` (워크트리 `.claude/worktrees/field-promotion`, base dev 18efd38)
**게이트 명령:** BE `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `ruff check app/ tests/ scripts/` · FE `npx vitest run` · `npx tsc --noEmit` · `npm run lint` · `npm run build`

⚠️ 불변식: A+B 같은 릴리스(FE 미지 필드 = graph PUT 소거) · 신규 컬럼 전부 `_ADDED_COLUMNS` · touch_time은 duration 미러(정규화 함수 재사용, 신규 구현 금지) · 폴백 컬럼은 CSV/Excel/AI 표면 제외, clone·시그니처 포함.

## Phase A — BE 스키마·어댑터

- [ ] **A1. 컬럼+마이그레이션**: `models.py` Node 7컬럼·ProcessMap 9컬럼(스펙 §1.1/§1.2), `db.py` `_ADDED_COLUMNS` 16행. 검증: 스키마 테스트(기존 consultant 컬럼 테스트 패턴) 추가 후 pytest.
- [ ] **A2. 경계 스키마**: `schemas.py` — NodeIn(신규 7필드, touch_time은 duration과 동일 소거 정규화, 길이 방어), NodeOut/graph 에코, SP 지정 In/Out(sp_ 9필드, gmp 3값 validator, sp_touch_time 소거), MapOut 계열 에코. 검증: 경계 테스트(무효 touch_time `""` 소거, gmp 422).
- [ ] **A3. 영속 경로**: `graph.py` upsert · `versions.py` clone_graph · SP 지정 라우터 저장/에코. 검증: 그래프 PUT 왕복 + clone 보존 테스트.
- [ ] **A4. IR+어댑터+엔진**: `consultant_canonical.py` 확장 → `consultant_interview.py` 착지 이동(스펙 §4.1 표: 설명 KV 축소·[Interview]=Owner role만·touch_time_min→H.MM·openItems/tasks.note→map_notes) → `import_consultant.py` build_graph_rows·`_graph_signature`·`fields_changed`·SP 반영 확장. 샘플 JSON에 touch_time_min·openItems 값 추가. 검증: 어댑터 매핑 테스트·재임포트 백필(시그니처 감지)·no-op 불변식·기존 기대값(설명 KV) 전수 수정.
- [ ] **A-gate**: BE 전체 그린 + ruff. → 커밋(작업 단위별).

## Phase B — FE 전 표면

- [ ] **B1. 파라미터 원장**: `params.ts` PARAM_FIELDS 7필드·SP_PARAM_FIELDS 5필드·라벨, `duration.ts` 재사용 확인, `api.ts`/그래프 타입(GraphNode·MapOut·SP 타입) 확장. 검증: vitest·tsc.
- [ ] **B2. CSV 왕복**: `csv-import.ts` NODE_DEFAULTS·mergeNode pick·행 변환(IO는 셀 내 개행)·`dropUneditableParams`(상속 5필드+IO/조건/data_form), CSV export 컬럼. 검증: vitest 왕복 테스트.
- [ ] **B3. AI 변환**: `buildGraphFromAiProposal`·page.tsx `aiNodeToGraphNode`·`resolveAiParamPatch`. 검증: vitest.
- [ ] **B4. 노드 인스펙터/에디터**: IO 리스트(add/remove, 개행 join)·data_form 배지·start/end 조건 필드·Parameters 7필드·일괄편집 모달 7필드·SP 노드 read-only 상속 게이트·Σ touch_time 미러. 검증: tsc·vitest·육안(Phase V).
- [ ] **B5. 맵 표면**: SP 패널/설정/인스펙터 맵 탭 — sp_start/end_condition·gmp 셀렉트(4상태)·sp_touch_time, 값 있을 때만 렌더. Excel export touch_time 컬럼. 검증: tsc·build.
- [ ] **B-gate**: vitest·tsc·lint·build 전체 그린. → 커밋(작업 단위별).

## Phase C — FallbackHint

- [ ] **C1. 공용 컴포넌트**: 아이콘(폴백 존재 시)+클릭 팝오버(원문·수정·대표값 적용), body portal·fixed(기존 컨벤션). 배선: 노드 system·맵 gmp/duration/touch_time/sp_system·SP 노드 annual_count(링크 맵 frequency 폴백 힌트). 폴백 수정은 graph PUT/SP PATCH 동승. 검증: vitest(로직)·실브라우저(Phase V).

## Phase V — 실브라우저 검증 (QA 문서 주도 — 사용자 지시 2026-08-20)

- [ ] **V0. QA 문서 작성**: `docs/qa/2026-08-20-field-promotion-qa.md` — 표면별 체크 항목(임포트 착지·노드 인스펙터 IO/조건/배지·touch_time 정규화/Σ/일괄편집·SP 상속 read-only·맵 gmp/조건·FallbackHint 수정/적용·재임포트 멱등·CSV/Excel 왕복) + 항목별 결과 열. 구현 완료 후 작성, 검증하며 체크.
- [ ] **V1. 실브라우저 체크**: 격리 DB 시드(reset_db+인터뷰 샘플 웹 임포트) 후 QA 문서 항목을 실브라우저(Playwright+시스템 Chrome)로 전수 체크 — 자동화 가능한 항목은 `frontend/scripts/pw-smoke-field-promotion.mjs`로 스크립트화(재실행 가능하게), 나머지는 스크린샷 육안.
- [ ] **V2. 기존 스모크 회귀**: `pw-smoke-interview-import.mjs`(설명 KV 축소로 단언 갱신) · `pw-smoke-framework-admin.mjs` · `pw-smoke-framework.mjs`.
- [ ] **V-gate**: QA 문서 전 항목 체크 + BE/FE 최종 전체 그린 → 문서(`docs/deploy/db-migration-9910.md`·매뉴얼 해당 절) 갱신 → 최종 커밋.

## 이후 (이 플랜 밖)

dev 머지 → A+B+C 동일 릴리스로 서버 배포 → 실파일 재임포트(백필: 승격 필드+rose 색) → 검토 작업(GMP 선정·frequency→annual_count 입력). 시스템 라이브러리 트랙 별도.

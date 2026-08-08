# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-08-08 — 컨설턴트 전사 프로세스 체계(7단계) 수용 설계
- 브레인스토밍 확정 — 설계서 2건 신설: [`docs/design/2026-08-08-consultant-hierarchy-design.md`](docs/design/2026-08-08-consultant-hierarchy-design.md)(L1~L5 카테고리 트리·L6=맵·연계=subprocess 변환·SP 지정 확장 I/O·canonical JSON 계약·멱등 임포트 스크립트 — "임포트=부트스트랩, 수명주기=BPM 거버넌스" 이양 모델) + [`docs/design/2026-08-08-governance-ux-design.md`](docs/design/2026-08-08-governance-ux-design.md)(게시 모달 가시성 동봉·맵 카드 권한 목록 편집·승인 탭 비버전 승인 통합+red dot).
- 재임포트는 CSV 임포트식 무충돌 모델 — 현업 편집이 있어도 안 막히고(스킵/차단 없음) 새 버전 적재+게시로 이력 보존, 변경점은 dry-run 리포트+버전 비교 화면으로 확인.
- 스케일 전제 반영(§8): 컨설턴트 추산 L5 ~3,000·L6 맵 ~20,000 — canonical을 `maps.jsonl` 스트리밍으로 전환(어댑터 자동 생성, 수기 아님), 벌크 임포트+청크 커밋, dry-run CSV 출력, Phase 2 선행 조건으로 맵 목록 API 서버 필터/페이지네이션·카테고리 트리 lazy-load·SP 피커 검색 재설계 명시.
- 설계서 2건 사용자 승인 → Phase 1 구현 플랜 작성: [`docs/superpowers/plans/2026-08-08-consultant-import-phase1.md`](docs/superpowers/plans/2026-08-08-consultant-import-phase1.md) — 7태스크 TDD(스키마→canonical 파서→결정적 id 그래프 빌더→카테고리/오우닝부서→업서트 엔진(버전 게시·SP 지정·변경 감지)→dry-run CLI/CSV/청크 커밋→전체 게이트). 결정적 노드 id(코드 sha1 파생)로 재임포트 버전 비교 매칭 성립, 거버넌스 필드는 생성 시에만·재임포트는 콘텐츠만 갱신.
- **Phase 1 Task 1 완료**: ProcessCategory 신규 테이블(L1~L5 트리 저장, code 기준 유니크) + ProcessMap에 4컬럼(category_id/consultant_code/sp_input/sp_output) 추가. db.py _ADDED_COLUMNS 등록 완료, 스키마 스모크 테스트 그린.
- **Phase 1 Task 2 완료**: canonical 파서 모듈(카테고리/맵 Pydantic 모델 + 로더 함수) 구현 완료. load_categories 구조 검증(중복코드/parent 존재/level 체인), load_maps 줄단위 오류 수집(벌크 임포트 계약) — pytest 5/5 통과.
- **Phase 1 Task 3 완료**: 결정적 그래프 빌더 구현 — make_node_id/make_edge_id(컨설턴트 코드 sha1 파생), build_graph_rows(Start/End 자동 시드, 연계 노드 subprocess 변환·SP 파라미터 상속, 위상 정렬 레이아웃). pytest 3/3 통과(체인·연계·경고), 린트 OK.
- **Phase 1 Task 4 완료**: 카테고리/오우닝부서 해석 모듈 구현 — upsert_categories 멱등 업서트(code 기준·parent 2-pass), build_known_departments 직원 org 전 prefix, resolve_owning_department dept/owner 폴백 규약. pytest 2/2 통과, 린트 OK.
- **Phase 1 Task 5 완료**: 맵 업서트 엔진 `import_delivery` 구현 — 2-pass(맵 껍데기+link_targets → 그래프/버전/SP 지정), 게시는 routers/versions.publish_version 규칙 재현(채번·기존 게시본 expired·이벤트, 승인·알림 우회), 거버넌스 필드는 생성 시에만 세팅. 변경 감지 시그니처 비교 시 미영속 Node/Edge의 컬럼 default 미적용(None) vs DB 로드본("") 불일치로 오탐되던 버그 수정. pytest 16/16(신규 5 포함) + 백엔드 전체 900/900 통과, 린트 OK.
- **Phase 1 Task 5 fix round 1**: 리뷰에서 이전 버전 그래프 삭제가 스펙("재임포트는 새 버전 적재로 이력 보존")과 버전비교 화면 요구를 위반한다고 지적 — 근본 원인은 Task 3의 결정적 id를 Node/Edge.id(테이블 전역 PK)로 쓴 설계 결함. clone_graph의 계보 규약(id=uuid4, source_node_id=계보 루트, `frontend/src/lib/diff.ts` getLineageKey가 이 규약으로 버전 비교 매칭)을 그대로 따르도록 개정: build_graph_rows는 이제 Node/Edge마다 uuid4 id를 새로 발급하고 결정적 값은 `source_node_id`(make_node_id 계보 루트)로만 기록, make_edge_id는 불필요해져 제거. 엔진의 이전 버전 삭제 로직 완전 제거(만료 버전도 그래프 그대로 보존, append-only). 변경 감지 시그니처도 id 대신 source_node_id 계보로 노드·엣지를 비교하도록 갱신. Task 3 테스트 3건을 계보 계약으로 개정(id 대신 source_node_id 단언). pytest 16/16 + 백엔드 전체 900/900 통과, 린트 OK. 수동 검증: 재임포트 후 만료 버전의 노드 3건이 그대로 조회됨을 확인.

## 2026-08-04 — 맵 카드 최근열람 표시 정정
- 기본 상태에서 시계 칩 전체가 accent-tint 배경이라 그 줄이 "최근 수정"이 아닌 다른 값처럼 읽혔다 — 칩 스타일을 빼고 **시계 아이콘에만** 최근 열람을 표시(아이콘 색 + 배경 하이라이트, 텍스트는 다른 카드와 동일하게 `updated_at`).
- 호버 전환: 들어올 땐 **0.5초 지연 후 0.5초 페이드**(스쳐 지나는 커서에 반응하지 않게), 나갈 땐 지연 없이 **0.5초 페이드로 복귀**.
- 스모크 갱신: 아이콘 색·배경 하이라이트·칩 배경 투명 동시 검사, 지연 구간 중간(250ms) 미전환 검사, 언호버 150ms 중간값 검사(즉시 스냅이면 걸림)와 페이드 완료 검사.

## 2026-08-04 — 홈 부서 목록 재조정 설계 (개정)
- 문서 정합: 픽스 웨이브로 R4가 테두리 없는 틴트 박스 + 상수 인셋(≈389px)으로 바뀐 뒤 남아 있던 낡은 수치·도해 정리 — §3 ASCII 도해를 틴트 박스로 다시 그리고, §4 중첩 금지 랜드마인의 폭 체인과 R6의 어긋남 수치를 실제 값으로 교체.
- 사용자 평가 "오히려 난잡" — 원인 4건 확정: sticky 행이 들여쓰기를 버려 좌변이 지그재그 · breadcrumb이 바로 윗줄 부모를 재기재 · 한 행에 `…`/`/`/`›` 세 구분자 · 부서 행과 카드가 뒤섞여 목록만 훑을 수 없음. 앞 3건은 필 체인+sticky+breadcrumb 장치 자체에서 나와 그 장치를 폐기.
- 설계 확정 — `docs/design/2026-08-04-home-dept-list-revision-design.md`(앞 설계 §2 대체, §3·§4는 유지). main 들여쓰기 트리 회귀 + 카운트 태그화 · 펼친 부서는 태그 숨김·회색 톤다운 · 맵 보유 부서와 그 카드를 **컬럼 풀폭 그룹 박스**로 묶음(박스 헤더=트리 행, 자식은 박스 밖, 중첩 금지 → 카드 399px 고정) · 미지정/내 부서 섹션도 같은 박스.
- 구현: 조직도 아코디언을 main 들여쓰기 트리로 되돌리고 카운트 태그(`CountTag`)·펼친 행 태그 숨김/톤다운·맵 보유 부서 풀폭 그룹 박스(`DeptGroupBox`, 자식은 박스 밖) 적용. 사용처 사라진 `collectPillChain`+테스트 제거.
- 구현: 내 부서 섹션에도 같은 태그·그룹 박스 적용 — 좌측 컬럼 카드 폭을 조직도와 동일(399px)하게 정렬.
- 검증: 스모크를 박스·태그·톤다운·좁은폭 클리핑 검사로 갱신해 20/20 통과 + 전체 게이트(lint·tsc·vitest 593·build·pytest 884). 픽스: 톤다운 검사가 `expandAll` 이후(닫힌 행이 하나도 안 남는 시점) 닫힌 행 색을 찾던 버그 — 전부 펼치기 전에 닫힌 색을 미리 캡처하도록 수정.
- 머지 전 수정 웨이브(리뷰+육안 확인, 원인 1개로 수렴하는 결함 5건 + 승인된 디자인 변경 1건): `DeptGroupBox` 테두리 제거(카드 자체 테두리와 9px 간격 이중 테두리로 겹쳐 보임) + `p-2`→`py-2`(좌우 패딩 폐지), 카드 리스트(`renderMapList`·내 부서 `<ul>`)에 `pl-5 pr-2` 고정 인셋 추가(depth 무관 상수 — 헤더 `paddingLeft`와 별개라 박스형/비박스형 헤더가 같은 depth에서 같은 x로 정렬됨, 카드 폭 ≈389px로 전 구간 동일). 헤더 hover를 `bg-surface-alt`(#f5f5f7, 박스 배경·카운트 태그 배경과 동색이라 무효)에서 `bg-divider`(#f0f0f0, `git grep`으로 실사용 확인된 생성 유틸리티)로 3곳(부서 노드·미지정·내 부서) 모두 교체 — 박스 안/밖 어디서나 보이고 카운트 태그 호버 용해도 해소. 트리 `<li>`/`<ul>` 간격 `gap-1`→`gap-2`로 인접 틴트 영역 분리. `MyDeptFavorites` 헤더에 `data-id="my-dept-toggle"`+`aria-expanded`(트리 토글과 다른 id — 트리는 첫 진입 접힘·내 부서는 기본 펼침이라 같은 id면 "조직도 접힘" 검사가 깨짐). 스모크: 카운트 태그 검사가 `expandAll` 이후(닫힌 행 0개) 실행돼 절반이 공집합만 걸러 항상 통과하던 버그 — 톤다운 검사처럼 펼치기 전에 닫힌 행 증거를 선캡처하도록 교정, 태그·톤다운 검사 모두 `my-dept-toggle` 포함하도록 확장. 설계문서 DOM 계약에 누락돼 있던 `org-node-name`·`my-dept-toggle` 추가, R4 박스 스타일 서술을 신규 무테두리/`py-2`/고정 인셋 처리로 갱신. 게이트·브라우저 스모크 재검증 완료(상세는 커밋 로그).

## 2026-08-04 — 홈 부서 가시성·시인성 개선 설계
- 좌측 조직도 문제 2건 실측 확정: ①`depth*12+16` 들여쓰기로 맵 카드 폭이 depth별 401~365px로 제각각(콘텐츠 333px에서 제목 말줄임) ②My dept 섹션과 조직도가 첫 진입 시 동시 펼침 상태로 **동일 카드를 중복 렌더**(시선 분산의 진짜 원인).
- 설계 확정 — `docs/design/2026-08-04-home-dept-visibility-design.md`. 부서명 고정폭 필(단일자식 구간 한 행 병합)·카드 풀폭 417px 통일·맵 보유 부서만 sticky 경로 헤더·최근접속 표시 호버 반전(기본은 accent 시계 칩)·내 부서 맵 있으면 조직도 접힘 시작 + 접힘 상태 localStorage 영속.
- 구현: `collectPillChain` 순수 함수(통과 노드 병합·맵 보유 시 중단) + 단위 테스트 3종.
- 구현: 조직도 아코디언 재구성 — 부서명 고정폭 필 체인(단일자식 병합)·맵 카드 들여쓰기 제거(전 depth 동일 폭)·맵 보유 행만 sticky 경로 헤더(조상 breadcrumb 동반)·자기 맵을 자식보다 먼저 렌더.
- 구현: 맵 카드 최근접속 표시 반전 — 기본은 오너/수정시각(시계 칩 accent+tint)·호버 시 `Recent · N ago` 필로 교체(겹침 그리드 유지로 폭 점프 없음).
- 구현: 첫 진입 포커스 — 내 부서 맵이 있으면 조직도 시드 생략(me·maps 도착 후 1회 판단으로 경합 차단), 접힘 상태는 `bpm.home.tree`(localStorage)로 분리해 새로고침에도 유지(저장은 StrictMode 사고 회피 위해 토글 핸들러에서).
- 검증: 브라우저 스모크 `pw-smoke-home-dept.mjs` 15/15 통과(진입 접힘·카드 폭 통일·sticky 고정·새로고침 유지·호버 반전) + 전체 게이트(lint·tsc·vitest 596·build·pytest 884).
- 최종 리뷰 픽스 3건: sticky 행 breadcrumb을 바로 위 부모 1개(+"…" 압축)로 줄이고 그 폭을 터미널 필에 양보(형제 부서 식별 가능, `DeptPill` `grow` prop) · My부서 카드 리스트 `pl-1` 제거(아코디언과 동일 417px) · 트리 시드 래치를 `touched` 필드로 분리(조직도 자체 조작만 래치, My부서/Word/미지정 토글은 이어받기만 해 내 부서 맵 없는 유저의 시드가 계속 재계산되게).
- 회귀 픽스: 980-1280px 구간에서 breadcrumb 없는 체인 필(2-3개) 행이 `(N)` 카운트를 클리핑(overflow-x-hidden이 무음 절단, 1000px에서 71px 잘림 실측) — `DeptPill` `shrink-0`→`min-w-0`(w-24는 floor 아닌 basis) + 체인 필 wrapper span도 `min-w-0 shrink`로 전환해 필이 줄어들며 truncate, 카운트는 고정 유지. 1000/1100/1280/1440px 재측정 결과 0 clipped, 1440px 96px 정렬 유지 확인.

## 2026-08-04 — AI 프롬프트 관리(sysadmin) 설계 (feat/ai-prompts-admin)
- 프롬프트 7종(AI 챗 지침·인터뷰어/드래프터 계약·Word 애드덤 2종·추출 계약·반복 넛지)을 sysadmin이 설정 탭에서 열람·수정·기본값 복원하는 기능 설계 확정 — `docs/design/2026-08-04-ai-prompts-admin-design.md`. 신규 `ai_prompts` 테이블(오버라이드만 행 저장, 없으면 코드 기본값), 매뉴얼 관리 패널 편집 패턴 재사용.
- 구현 플랜 작성 — `docs/superpowers/plans/2026-08-04-ai-prompts-admin.md` (태스크 5개: 모델+레지스트리 → API → 빌더 스레딩 → 설정 탭 → 브라우저 스모크).
- 구현: AiPrompt 오버라이드 모델 + prompt_registry(기본값 매핑·오버라이드 조회).
- 구현: /api/admin/ai-prompts GET/PUT/DELETE(sysadmin 전용, 404/422/멱등 복원).
- 구현: 프롬프트 빌더 7표면에 overrides 스레딩(None=기존 상수 폴백, 기존 테스트 무변경 그린).
- 구현: 설정 Content > AI prompts 탭(7종 목록·편집/프리뷰·기본값 복원, MarkdownView 재사용).
- 픽스: 저장/복원 비행 중 프롬프트 전환 경합 차단(리뷰 지적).
- 검증: pw 스모크 10체크 그린(편집·저장·프리뷰·지속성·복원) + 전체 게이트(pytest·ruff·lint·vitest·build).
- 픽스: 스모크 스크립트 실패경로(중간 throw)에서도 finally에서 오버라이드 DELETE 클린업 항상 시도(리뷰 지적 — 이전엔 try/finally라 throw 시 dev.db에 오버라이드 잔존 가능).
- 최종 리뷰 반영: 저장 비행 중 textarea 잠금·스모크 reset 단언 강화.

## 2026-08-03 — 컨테이너 메모리 예약 최적화 (docker-compose)
- 공용 서버(71번) 과예약 방지 — 4개 서비스에 `deploy.resources` 메모리 reservations/limits 명시(예약 합계 ~800M, 상한 합계 ~2.9G: proxy 32M/128M · frontend 256M/768M · backend 256M/1G · db 256M/1G).
- backend에 `MALLOC_ARENA_MAX=2`(glibc arena 증식으로 인한 RSS 팽창 방지), frontend(Next.js standalone)에 `NODE_OPTIONS=--max-old-space-size=512`(V8 힙 상한) 추가. `docker compose config`로 해석 결과 검증.

## 2026-07-30 — 브랜치 최종 리뷰 픽스 배치 (worktree-ai-consultant)
3방향 병렬 리뷰(백엔드 코어·프론트 표면·최근 픽스 회귀) 적발분 중 확정 항목 일괄 수정:
- **[블로커] `InterviewMessage.kind` VARCHAR(12)→(20)**: `sp_suggestion`(13자)이 운영 Postgres에서 extras 커밋을 터뜨려 SP 제안이 무음 유실(sqlite는 길이 미강제라 로컬 그린). `db.py` 부트스트랩에 postgres 전용 ALTER 스텝 추가(배포 시 자동), 선언 폭 회귀 테스트 동반.
- apply-params·sp-accept가 `pending_choices` 미무효화 → 스테일 카드 수락이 방금 반영한 파라미터/SP 치환을 되돌리던 구멍 봉합. 스테일 choice는 502→**409**(TurnError status_code 파라미터화).
- 첨부 추출 AI 콜이 관리자 런타임 차단(app_settings)을 우회 → `is_ai_access_enabled` 게이트.
- FE: fastTrack awaiting이 review 도달 후에도 "이대로 그리기" 클릭을 fast-forward로 인터셉트(백엔드 400 루프) → review에선 일반 턴 폴백+상태 해제. Start over가 fastTrack/readingIds/attachError/canRetry 미리셋 → 전체 리셋. 에러 배너 Retry가 재생 불가 실패(fast-forward·params)에도 노출돼 no-op/무관 턴 재전송 → `canRetry` 게이트. params 표 무변경 blur가 dirty 게이트 뚫던 것 수정 + **SP 행 필드 게이팅**(`getEditableParamFields` — CLAUDE.md 3표면 불변식의 4번째 표면). 체크포인트 revert 실패 무음 → 액션 바 에러 표면화. fast-forward 낙관 문구를 서버 기록과 동일화. 고아 주석·스테일 테스트 주석 정리.
- 백로그(추적만): FE Apply의 잔여 422 입구(end 제목 되돌림 충돌·keep-current 무교정)·에디터 AI 챗 start/end sanitize 대칭·세션 생성 레이스(부분 유니크 인덱스)·모달 뒤 키보드 턴·타이머 정리·같은 스테이지 칩 중복 표현.

## 2026-07-30 — 미리보기 포커스 엣지 하이라이트 (worktree-ai-consultant)
- 노드 클릭 포커스(선택 링+줌) 시 입출 엣지를 액센트로 강조 — 공용 `highlightConnectedEdges`(lib/interview) 신설, 메인 미리보기(키 기준)·복수 안 창(제목 싱크 기준) 양쪽 적용. 빈 키셋은 원본 배열 반환(메모 재사용).

## 2026-07-30 — 시작/끝 중복 안 결정적 교정 — Apply 422 벽돌·전멸 필터 갇힘 해소 (worktree-ai-consultant)
- **갇힘 체인**: AI 안이 시작 2개·같은 제목 끝 2개를 포함해도 가드가 없어 수락됨 → Apply가 `validate_process`(시작 정확히 1개·끝 제목 유니크) 422로 거부 → "시작 1개로 고쳐줘" 재드로는 드래프터 에코가 전멸 필터("같은 안뿐")에 걸려 탈출 불가.
- 수정: `_sanitize_start_end`(orchestrator) — 제안 파이프라인 마지막 단계에서 중복 시작·같은 제목 끝을 **병합**(참조 엣지 생존 노드로 재배선, 병합 유래 자기루프·중복 페어만 정리), 생존자는 이전 작업본 키 우선. 시작 0개는 이전 작업본 시작 복원. 병합 방식이라 고장난 세션에서도 에코 안이 sanitize로 달라져 필터를 통과 → 수락으로 자가 복구 가능. 프롬프트 문구만으론 안 막힌다 계보.

## 2026-07-30 — 수락 시 분기 저장(체크포인트) 누락 픽스 (worktree-ai-consultant)
- **좌상단 분기 저장이 늘 초기 상태**: 그리기가 턴에서 분리(speed redesign)된 뒤 체크포인트는 스테이지 완료(전이) 시점에만 생성 — 수락은 전이 이후라 **전이 없는 수락(패스트트랙 review·리뷰 중 재드로 수락)의 맵이 어떤 체크포인트에도 저장되지 않았다**. 패스트트랙은 일괄 체크포인트가 전부 시드 상태.
- 수정: choice 턴에서 전이 체크포인트가 안 생겼으면 현재 스테이지로 수락본 체크포인트 생성('그대로 유지' 수락은 맵 불변이라 제외). 같은 스테이지 복수 체크포인트는 revert가 최신부터 한 겹씩 벗기는 히스토리로 동작(기존 규칙 그대로).

## 2026-07-30 — 제안 diff 태그를 현재맵 대비로 전환 + 구조 중복 안 제거 (worktree-ai-consultant)
- **동일해 보이는 안 2개 문제**: 내용 포함 서명 도입(설명 병기 통과) 때 안끼리 중복 제거에도 적용된 부작용 — 워딩만 다른 구조 동일안이 둘 다 생존. **안끼리 중복은 구조 서명으로 복원**(현재맵 대비 판정만 내용 포함 유지).
- **변경/추가 태그 미작동**: 안끼리 차이(distinctiveNodeKeys — 안들이 비슷하면 무표시) 폐기 → **현재 작업본 대비 diff**(`diffFromCurrentKeys`: 새 제목=added·같은 제목 설명/attributes 변경=changed, layoutWorkingGraph changed 지원 추가, 비교화면 diff색 뱃지 재사용). keep-current 안은 정의상 무태그.

## 2026-07-30 — 도형 밀착 선택 링 + 복수 안 싱크 포커스 (worktree-ai-consultant)
- 선택 링을 래퍼 outline(추정 높이 박스 — 긴 라벨 노드와 어긋남)에서 **실제 도형(`bpm-node-emph`)의 box-shadow 이중 링**으로 — 알약/카드/마름모(회전 포함) 실측 크기를 그대로 감쌈. z-3 상승 유지.
- 복수 안 미리보기 **싱크 포커스**: 노드 클릭 시 제목 기준으로(안마다 키가 달라서) 모든 창이 동시에 선택 링 + 자기 매칭 노드로 카메라 센터(1.1 줌, centeredForRef 중복 방지). 빈 캔버스 클릭=전 창 해제.

## 2026-07-30 — 온보딩 플래그 맵별 키로 전환 (worktree-ai-consultant)
- 새 맵 온보딩이 안 뜨던 원인 = `bpm.consultOnboardSeen`이 **전역·영구 키** — 컨설턴트를 한 번이라도 쓰면(Start/Dismiss/AI 메뉴 진입) 이후 모든 새 맵에서 비노출. `bpm.consultOnboardSeen.<mapId>` 맵별 키로 전환 — 새 맵마다 안내, 맵당 1회.

## 2026-07-30 — Draw map 서머리 확인 + 백그라운드 선그리기 (worktree-ai-consultant)
- 수동 Draw map 클릭 → **수집 정보 마크다운 서머리 확인 다이얼로그**(`draw-confirm-dialog`, MarkdownView 렌더·`buildDrawSummary`) + 동시에 **백그라운드 선그리기(prefetch)** 시작. 승인 시 이미 완성이면 즉시 제안 모달, 미완성이면 기존 그리기 오버레이로 대기(isDone 플래그로 오버레이 플리커 방지). Not now=응답 무시(draw Cancel과 동일 시맨틱). 자동 draw(draw_due·fast-forward·Retry)는 확인 없이 종전 경로. 스모크 시나리오 추가.

## 2026-07-30 — 선택 링 z 상승 + 프리뷰 노드 호버 글로우 (worktree-ai-consultant)
- 선택 링이 이웃 노드에 가려지던 문제(긴 라벨로 실측 폭>추정 폭 → 겹침, 프리뷰 전 노드 z-2 고정) → `.selected` z-3 상승. 프리뷰·선택지 캔버스에 에디터와 동일한 `bpm-node-emph` 호버 글로우 + 클릭 가능 노드 pointer 커서.

## 2026-07-30 — 포커스 링 실체화 + params 표 전면 개편 3종 (worktree-ai-consultant)
- **선택 노드 링 실체화**: 에디터 선택 효과는 페이지 오버레이 담당이라 selected 주입만으론 무표시였음 → 프리뷰·선택지 캔버스 공용 CSS(`.selected` outline accent 2px) — 클릭 노드=인스펙터 대상이 시각적으로 연결됨.
- **params 표 전 활동 나열**: `deriveParamsEditorRows` — 수집분만이 아니라 작업본의 모든 활동(+맵에 없는 수집 고아 항목 뒤에 유지)을 행으로 — 어느 노드든 채팅 없이 값 입력 가능. "노드 많은데 일부만 보임" 해소.
- **무한 스크롤 + 행 일괄 삭제 + dirty 게이트**: 30행 청크 렌더(하단 근접 시 추가 로드, ParamInput 대량 마운트 방지) · 행 호버 시 Trash 버튼(전 필드 클리어 — **수동 표에서 비운 필드는 서버가 맵 속성도 제거**, AI 경로 빈 값은 종전대로 무시) · Apply to map은 변경 있을 때만 활성.

## 2026-07-30 — 관리자 런타임 AI 차단 토글 (worktree-ai-consultant)
- **AI access 토글(설정, sysadmin)**: app_settings `ai_access_disabled` — GPU 서버 다운 시 재배포 없이 전 AI 표면 차단. 유효 가용성 = env AI_ENABLED AND NOT 플래그(`is_ai_access_enabled`), 게이트 3면 배선: `/api/me` ai_enabled(전 화면 즉시 반영) · 인터뷰 `_require_ai_enabled`(async화, 5개 엔드포인트) · AI 챗/모델 목록 503. FE 설정 AI 챗 패널 상단 스위치 카드(Power 아이콘·차단 중 경고 문구). KB 임베딩은 별도 서버라 미차단(의도).

## 2026-07-30 — params 표 직접 편집 + 제안 미리보기 노드 포커싱 (worktree-ai-consultant)
- **params 수동 편집**: Params 모달 셀을 공용 `ParamInput`으로 편집 가능(Cost는 값+₩/$ 행별 토글 — 반대 통화는 ""로 전송해 facts 잔존값 정리). `POST /apply-params` body `params_table` 수용 — 서버가 **facts 딥머지 → 맵 반영** 순서로 처리해 수동 변경도 AI 컨텍스트(인터뷰어/드래프터·아웃라인)에 남고 기존 반영 노티스가 대화에 기록됨. 무효 필드 소거, 빈 값은 facts만 비우고 맵 속성 유지(클리어는 에디터에서).
- **제안 미리보기 포커싱**: ChoiceCanvas에도 노드 클릭 선택 링+센터 줌(창별 독립, fitView는 그래프 변경 시 1회만 — 클릭 줌 안 되돌림), 빈 캔버스 클릭 해제.

## 2026-07-30 — 프리뷰 노드 클릭 포커싱+줌 (worktree-ai-consultant)
- 컨설턴트 프리뷰에서 노드 클릭 시 선택 링(ProcessNode selected 재사용 — elementsSelectable=false라 selected 직접 주입) + 카메라 센터/줌(축소 상태면 1.1까지, 확대 상태 유지, 400ms). 빈 캔버스 클릭=포커스·인스펙터 해제. 카메라 게이팅(서명)과 독립이라 텍스트 턴 시점 강탈 없음.

## 2026-07-30 — 전멸 필터 내용 포함 서명(설명 병기 통과) + 온보딩 메뉴 경유 seen (worktree-ai-consultant)
- **설명만 바뀐 안 통과**: `_graph_signature(include_content=True)` — 전멸 필터 판정에 설명·attributes 포함. "설명 한/영 병기" 요청이 구조 동일이라 "같은 맵" 노티스로 거부되던 문제 해소. 에코 노드는 델타 복원이 이전 내용을 그대로 살리므로 진짜 무변화 안은 여전히 필터됨(노이즈 재발 없음). FE 카메라 게이팅은 구조 서명 유지(설명 변경 시 시점 안 뺏음).
- **온보딩 seen 보강(6d0e84d)**: AI 메뉴 경유 컨설턴트 진입도 seen 처리 — 말풍선 재노출 틈 봉합.

## 2026-07-30 — 수락=구조 확정 스탬프(재확인·재드로 루프 종결) + 컴포저 busy 잠금 (worktree-ai-consultant)
- **채팅-맵 싱크 이탈 패턴 종결**: 수락 턴 draw 억제(어제)만으론 한 턴 뒤 재발 — 인터뷰어가 스테이지를 완료 처리하지 않고 "이대로 확정할까요?" 재질문 → "네" 답변 턴의 전이가 choice 스테이지발 multi 재드로 유발. **수락 시 choice 스테이지 필수 facts를 수락안에서 서버가 결정적 스탬프**(activities=수락안 활동 제목 배열·branches=디시전 제목/“분기 없음” 폴백) → 같은 턴 전이+체크포인트(수락 턴은 draw 억제) → 인터뷰어는 다음 주제로. 수락 지시문도 "반영 완료·재확인 금지" 명시.
- **컴포저 busy 잠금**: 턴/draw 진행 중 컴포저 위에 스피너+"Waiting for the consultant…" 오버레이(bg-surface/75, cursor-not-allowed) — 흐림만으론 티가 안 나 오버레이로 강화.

## 2026-07-30 — 엣지 연결면 인스펙터 이식 + 현재맵 안 하이라이트 픽스 (worktree-ai-consultant)
- **연결면 편집 인스펙터 추가**: 엣지 우클릭 메뉴의 `EdgeSidesPad`(자립형 200px)를 export해 엣지 속성 폼에 재사용 — 편집 모드에서만 노출, SP 끝점 잠금·`setEdgeSide` 배선은 메뉴와 동일.
- **'현재 맵 유지' 안 오표시**: `distinctiveNodeKeys` 비교 모수에 현재맵 안이 포함돼 무변경 노드가 '추가' 하이라이트되고 다른 안 판정도 오염 → 계산·렌더 모두 same_as_current 제외(NO_HIGHLIGHT 상수 — new Set() 재레이아웃 함정 회피). 현재맵 카드에 "Current map" 대각 워터마크 추가(배지와 이중 표기), 스모크 어설션 포함.

## 2026-07-30 — 핫픽스 2종: 챗 텍스트 복사 가로채기 + AI 버튼 통합 (worktree-ai-consultant)
- **AI 챗 복사 실패**: 캔버스 노드가 선택된 채 챗 본문을 드래그 복사하면 에디터 Ctrl+C(노드 복사)가 preventDefault로 가로채 토스트만 뜨고 클립보드는 불변 — **텍스트 선택(getSelection 비접힘)이 있으면 네이티브 복사로 패스스루**.
- **AI 버튼 통합**: 상단바 컨설턴트(Headset)·AI(Sparkles) 2버튼 → AI 드롭다운 메뉴 하나(AI Chat/AI Consultant). 컨설턴트 항목은 편집 불가 시 비활성 + **래퍼 title로 사유 툴팁**(뷰어 권한/타인 점유/비편집 버전 구분 — disabled 버튼은 마우스 이벤트가 죽어 래퍼에 부착). 온보딩 말풍선은 통합 버튼으로 이식(메뉴 열림 중엔 숨김).

## 2026-07-30 — 컨설턴트 UX 폴리시 16종 (P0~P2, worktree-ai-consultant)
- **P0**: ① 체크포인트 스택 3개 초과 "+N older" 접기 + 코너 소유권 규칙 주석(fast-forward 5개 일괄 생성과 좌하 아웃라인 충돌 방지) ② 채팅 autoscroll 예의 — 바닥 근처만 자동, 위에서 읽는 중엔 스크롤다운 버튼 점 뱃지(stickBottomRef, 본인 전송은 항상 바닥) ③ 첨부 "Reading…" — 업로드 후 추출 9~22초 가시화(칩/플라이아웃/배지, 추출 노티스 파일명 매칭+25s 타임아웃 해제) ④ PDF 아이콘 error→changed(상태색 전용) ⑤ 패스트트랙 armed 칩(iv-fasttrack-chip, Cancel 포함) — invisible 모드 해소.
- **P1**: ⑥ 플로팅 진입 모션 통일(iv-pop 150ms — 오버레이·인스펙터·아웃라인·SP카드·draw카드·재열기칩·params모달, reduced-motion 가드) ⑦ 헤더 진행바 옆 현재 스테이지 라벨 ⑧ 빈 캔버스 고스트 노드+패스트트랙 CTA·워터마크 노드 아래(z-1)로+축소(72px/7%) ⑨ 액션바 재배치(baseline 좌측 그룹 소속·에러 좌측 고정+해제 X·ml-auto 이중 제거) ⑩ 인스펙터 값 있는 행만+빈 상태 문구+설명 스크롤 ⑪ params 표 Cost 열 합침(₩/$ 기호 병기, 배타 계약 표면화)·정식 라벨+title·Escape/백드롭 닫힘.
- **P2**: ⑫ 아이콘 12/16 2단 수렴(칩·플라이아웃·마이크로=12, 기본=16) ⑬ 첨부 안내 모달 버튼 우측 정렬(컨벤션 통일) ⑭ 픽커 ARIA(presentation 래퍼·aria-activedescendant·Escape→컴포저) ⑮ 디바이더 그립 도트·더블클릭 리셋·키보드 리사이즈·pointercancel 정리 ⑯ 카피(placeholder 공백·멘션 [Node:] 언어화·린트 메시지 en 지원) + 종료 컴포저를 "Session finished — Start over/Open in editor" 바로 교체.

## 2026-07-30 — 보기 픽커 노티스 내성 + 질문별 포커스 리셋 (worktree-ai-consultant)
- quickReplies 파생을 "마지막 **비-notice** 메시지" 기준으로 — 첨부 추출 노티스가 질문 뒤에 도착하면 보기가 통째로 사라지던 구멍(패스트트랙 범위 제안 ~9초 뒤 거의 항상 발생) 봉합.
- `QuestionOptions`를 질문 메시지 id로 key — 질문마다 리마운트되어 자동 포커스·선택 인덱스 리셋(마운트 1회 effect 한계 해소, 노출 즉시 ↑↓ 사용 가능). 스모크에 포커스·화살표 이동·노티스 내성 어설션 추가(hover 간섭은 '이동 여부' 판정으로 회피).

## 2026-07-29 — 인터뷰 패스트트랙 + 세분도 표준 10±3 (worktree-ai-consultant)
- **패스트트랙**: 인사 보기 "문서로 바로 그리기" → 첨부 → 자동 범위 제안 턴(AI 1콜, 첨부 본문 컨텍스트) → "이대로 그리기" FE 인터셉트 → `POST /fast-forward`(AI 0콜 — skip 시맨틱 일괄 전진·체크포인트·review 점프) → 자동 multi draw(힌트는 fast_forward 감지로 activities 고정). 문구 단일 소스 FE `FAST_TRACK_*` 상수(BE 인사·룰 15와 글자 동일). 스모크 `pw-smoke-consult-fast.mjs` 신설. 설계 `docs/design/2026-07-29-interview-fast-track-design.md`.
- **어체 간결화(룰 14)**: 인사치레·과격식 금지. **세분도 표준 10±3**: 계약·활동 힌트(표준 10내외/세밀 13~18/간결 6~8)·엔진 goal·린트(7~13) 동기(f735220).

## 2026-07-29 — 새 맵 모달 결재자 하이라이트 배경 반짝으로 교체 (worktree-ai-consultant)
- 오우닝 부서 선택 후 결재자 피커 accent 링(box-shadow 3px)이 모달 인접 요소·클리핑과 겹쳐 깨져 보임 → `picker-flash` 키프레임을 배경색(accent-tint) 1회 반짝으로 교체. 마크업·트리거(flashApprovers)·클래스명 불변, CSS만.

## 2026-07-29 — 하드닝 Phase 4: 제품 (worktree-ai-consultant) — **플랜 전 Phase 완결**
- **T19 톤 결정적 린트**: `app/interview/lint.py`(AI 0콜 — '~하기' 접미·존댓말/서술 어미·활동 수 6±3 이탈 정규식) → draw 옵션 payload `lint`(normal 모드만 — word는 문서 제목이라 비적용) → 카드 헤더 "Tone check N" warn 칩(iv-choice-lint, 툴팁=경고 목록). 자동 수정 없음(표시만) — 앵커·SP·params 사니타이저와 동일 계보의 톤 보증 장치.
- **T20 Apply 멘탈 모델**: 버튼 `Apply & finish` 개명 + 확인 모달에 "세션 종료" 명시 — 상시 노출 전환 후 무심코 눌러 세션을 잃는 불일치 해소. "적용하고 계속"은 백로그. 게이트: BE 856·ruff 0 / vitest 578·tsc 0·lint 0에러·build·스모크 2종. **하드닝 플랜 Phase 0~4 전체 완료 — 다음: GPU 실서버 재검증 → 워드 머지 → main 머지 판단.**

## 2026-07-29 — 하드닝 Phase 3: KB 운영 (worktree-ai-consultant)
- **T16 삭제 맵 청크 수명**: 소프트삭제·영구삭제(퍼지) 시 map 청크 즉시 제거+캐시 무효화(`_delete_map_kb_chunks` — get_effective_role이 삭제 맵을 구분 안 해 검색 필터만으론 계속 주입됨), 복구 시 게시본 백그라운드 재인덱싱, 기동 시 고아 청크 스윕(`db._sweep_orphan_kb_chunks`, 멱등).
- **T17 spawn 강참조 + 쿼리 타임아웃 분리**: `indexing._tasks` set 보관(asyncio 약참조 GC 소실 방지, done 시 discard — 테스트는 잔여 태스크 오염 대비 델타 판정) · `embed_texts(timeout=)` 파라미터화, 검색 쿼리 경로 5s 전용 상한(`retrieval.QUERY_TIMEOUT_SECONDS`) — embed 서버 행 시 턴 60s 블로킹 컷.
- **T18 문서**: kb-embedding.md에 백필 후 러닝 서버 캐시 무효화(재시작) 절차·삭제/복구 청크 수명·재시도 리컨실 백로그 명시. 게이트: BE 851·ruff 0.

## 2026-07-29 — 하드닝 Phase 2: 프론트 UX (worktree-ai-consultant)
- **T12 카메라 게이팅**: `getGraphSignature`(BE `_graph_signature` 동형 — 설명·attributes 무시) 신설, 프리뷰 fitView를 서명 변경 시에만 — 맵이 안 변한 텍스트 턴마다 팬/줌 시점을 뺏던 문제 제거. vitest 2종.
- **T13 draw 탈출구**: 오버레이 Cancel 버튼(iv-draw-cancel) + draw 취소 토큰(늦게 온 응답 무시) — 행 걸림 시 새로고침 없이 채팅 복귀(서버 작업은 계속, 결과는 다음 동기화 때 choices로 표시 가능).
- **T14 숫자 키 2단계**: 보기 픽커 숫자 키=하이라이트만·Enter=확정 — "3일 걸립니다" 오제출(낙관 렌더라 회수 불가) 방지, 푸터 힌트 갱신.
- **T15 소형 3건**: 새 메시지·낙관 수락 시 체크포인트 프리뷰 자동 해제(옛 스냅샷이 최신 캔버스 가림 방지) · 첨부 실패를 `attachError`(iv-attach-error, Retry 없음)로 분리 — 턴 Retry가 무관한 옛 턴 재전송하던 혼선 제거 · ChoiceOverlay `role="dialog"`+Escape 접기+재열기 칩(iv-choice-reopen, focus trap은 백로그). 게이트: vitest 578·tsc 0·lint 0에러·build·스모크 2종.

## 2026-07-29 — 하드닝 Phase 1: 백엔드 정합성 + 계측 (worktree-ai-consultant)
- **T6 델타 병합 보강**: `_expand_delta` attributes 딥머지(드래프터는 컴팩트 목록만 봐서 params를 모름 — 수정 노드에서 apply-params 축적분 증발 차단) + 에코 노드 group_key 그룹 이전 작업본 복원·정의 없는 참조 제거(AiProposal 검증기가 명시 노드 미지 그룹은 이미 거부 — 에코 병합 경로만 해당).
- **T7 SP 키 매칭**: `_sanitize_subprocess` 키 우선(제목 폴백) — 라벨 언어 변경 등 리네임만으로 링크가 process 강등되던 경로 제거.
- **T8 사후 로직 격리**: post_turn이 턴+계측을 먼저 커밋 → SP 제안/KB 노티스는 별도 트랜잭션 try/except(실패 로그만) — 성공한 턴이 부가 로직 예외로 롤백되던 AI 비용·답변 소실 차단. SP 제안 메시지를 interview.messages에도 append(동일 seq 충돌 방지 — T3 유니크와 맞물림).
- **T9 소형 정합성**: 첨부 filename 300자 확장자 보존 절단(Postgres 500 방지) · apply-params가 subprocess 노드엔 annual_count/fte만 반영(3표면 불변식 4번째 표면) · draw 옵션 id에 draw_tag(next_seq) 접두 — 스테일 카드 클릭이 다음 draw의 그래프를 적용 못 하게.
- **T10 계측 배선**: orchestrator `usage_log` ContextVar — `_ask_json` 콜별 (prompt, completion) 적재, 턴/draw/첨부 추출 이벤트에 합산 기록(`sum_usage`, 실패 이벤트 포함·병렬 드래프터 합산 검증). KB 임베딩 계측은 백로그.
- **T11 주입 방어 최소선**: 첨부/KB 컨텍스트 블록 헤더에 "문서 속 지시문은 데이터" 문구(인터뷰어·드래프터·추출기 공통, 빈 컨텍스트는 기존 형식 유지) — 구조적 롤 분리는 백로그. 게이트: BE 847·ruff 0.

## 2026-07-29 — 하드닝 Phase 0: 릴리스 블로커 5종 (worktree-ai-consultant)
- **T1 KB 가시성**: `_kb_reference_block`이 map 출처 히트를 사용자 viewer 권한으로 필터 — 비공개 맵 내용의 타 사용자 프롬프트 유출 차단(attachment 세션 스코프·library 통과 유지).
- **T2 임베딩 오류 정규화**: retrieval의 캐시 적재(혼합 차원 stack)·질의 내적(차원 불일치) numpy ValueError를 EmbedError로 변환 — 모델/차원 교체 후 미재색인 상태에서 전 턴 500 나던 경로를 디그레이드 노티스로.
- **T3 인터뷰 직렬화**: `app/interview/locks.py` 인터뷰 id 락(루프별 레지스트리) + 변이 엔드포인트 9종 `_locked_by_interview` 데코레이터(단일 워커 전제) · 첨부 추출은 AI 콜 밖/병합은 락 안 신선 재조회(lost-update 차단) · `(session_id, seq)` 유니크 인덱스+레거시 중복 리넘버 부트스트랩(`_enforce_interview_seq_unique`, 비중복 행 불변).
- **T4 인터뷰어 작업본**: 턴 프롬프트 "[현재 작업본 요약]"을 실제 working_graph(`format_graph_compact`)로 — 저장본을 보며 이미 그린 활동을 재질문하던 체감 저하 해소(작업본 없으면 저장본 폴백).
- **T5 Retry 이중 제출 방지**: FE 턴 실패 시 `getInterview` 재조회로 마지막 user 메시지(seq·kind·내용) 대조 — 반영돼 있으면 상태 채택·Retry 미노출(504 응답 유실 시나리오). 스모크에 504 유실 턴 시나리오 추가. 게이트: BE 837·ruff 0 / vitest·tsc·lint 0에러·build·스모크 2종 그린.

## 2026-07-29 — 하드닝 플랜 수립 (worktree-ai-consultant)
- 전면 리뷰(블로커 5·M급 다수·제품 6) 코드 검증 후 실행 계획 확정: `docs/superpowers/plans/2026-07-29-ai-consultant-hardening.md` — Phase 0 블로커(KB 가시성 유출·임베딩 차원 500·인터뷰 직렬화·인터뷰어 스테일 그래프·Retry 이중 제출) → Phase 1 정합성+계측 → Phase 2 FE UX → Phase 3 KB 운영 → Phase 4 제품(톤 린트·Apply 명시). **P0+P1 전 main 머지 금지.**

## 2026-07-29 — GPU 실검증 2차 피드백 7종 (worktree-ai-consultant)
- **수락 재드로 루프 차단**: choice 턴은 draw_due multi/single 신호를 억제(params 표 신호만 통과) — Use this option 직후 전이/redraw 신호가 방금 고른 안을 곧바로 다시 그려 제안 모달이 반복되던 회귀 종결.
- **드래프터 최근 대화 동봉**: `build_drafter_messages`에 `[최근 대화]` 블록(6발화·발화당 400자) — facts에 안 잡힌 수정 요청(예: "라벨 전부 영문으로")이 draw에 전달되지 않아 동일안만 나와 전멸 필터("새로 제시할 게 없습니다")에 걸리던 원인 해소.
- **'현재 맵 유지' 안 상시 제공**: draw 결과에 사용자 콘텐츠가 있는 현재 작업본을 `opt-current`(`same_as_current`)로 마지막에 추가 — 카드 좌상단 "Same as current" 배지, 수락=무변경 확정으로 루프 탈출구 겸용(시드뿐인 백지는 생략).
- **담당자/부서 수집 개편**: 담당자(assignee)는 인터뷰에서 수집 금지(에디터 피커 안내만, 인터뷰어 규칙 13+roles goal 개정). 부서는 eligible-assignees와 동일 모수의 `[부서 후보 목록]`을 턴 프롬프트에 주입(상한 80) — 관련 후보 2~4개를 quick reply로 제시+건너뛰기, 목록 밖 부서명 기록 금지.
- **세션 초기화 버튼**: consult 헤더 "Start over"(iv-restart) → 확인 모달 → abandon+새 세션 재개(맵·facts·대화 초기화, draft 불변).
- **Apply to draft 상시 노출**: review 도달 전이라도 맵이 그려진 시점(start/end 외 노드 존재)부터 액션바에 노출 — 언제든 반영·세션 종료 가능.
- **제안 모달 폭 확대**: ChoiceOverlay 1안 92%·2안 48%씩·3안 전폭(max-w-5xl 제거) — 뒤 캔버스는 안 보는 영역이라 가림 허용. **온보딩 z-인덱스 픽스**: 말풍선 z-40 → z-[1100](RF 선택 노드 1000·연결선 1001이 덮던 문제). 게이트: BE 831·ruff 0 / vitest 576·tsc 0·lint 0에러·build·consult/word 스모크 그린.

## 2026-07-28 — 인터뷰 간소화 3종: params 단계 폐지·첨부 추출·첨부 배지·온보딩 (worktree-ai-consultant)
- **params 고정 스테이지 폐지(7→6단계)**: engine STAGES에서 제외(레거시 세션은 get_stage/next_stage_key 폴백으로 review 탈출) — 파라미터는 어느 스테이지에서든 언급 시 `params_table`로 수집(`_merge_facts_namespace`가 스테이지 무관 'params' 네임스페이스로 라우팅), review 진입 시 표 확정 신호(draw_due="params")·Params 버튼 안내는 review goal에 통합. FE INTERVIEW_STAGES 동기(6단계).
- **첨부 시점 정보 추출**: 업로드 파싱 성공 시 백그라운드 AI 1콜 `extract_attachment_facts`(스테이지별 facts+params_table 추출·허용 네임스페이스만 병합·노티스) — 인터뷰 진행 전에 문서에서 최대한 수집. 프론트는 9s/22s 지연 재조회(seq 가드로 구상태 덮음 방지).
- **첨부 칩 잔류 정리**: 컴포저 칩은 "이번 메시지에 보낼" 최근 첨부만(전송·퀵리플라이 시 워터마크로 봉인, 재개 세션은 즉시 접힘) → 툴바 배지(Files 아이콘+개수)·클릭 시 플라이아웃(파일별 아이콘·상태·삭제, 바깥클릭/Esc 닫힘). data-id: iv-attach-badge/iv-attach-flyout(-row/-delete).
- **새 맵 온보딩**: 에디터가 시드 상태(Start/End 2노드 이하·편집 가능)면 컨설턴트 버튼에 accent 링 + "Try the AI consultant" 말풍선(Start=이동, Dismiss, localStorage `bpm.consultOnboardSeen` 1회). 게이트: BE 821·ruff 0 / vitest 576·tsc 0·lint 0에러·build·스모크 3종.

## 2026-07-27 — 인터뷰 속도 재설계 구현 (worktree-ai-consultant, dev 미머지 — AI 독립 라인)
- **Task 1 턴 경량화**: run_turn/skip = 인터뷰어 1콜(재드래프트·선택지·톤 검수 제거), `TurnResult.draw_due`("multi"=구조 스테이지 완료/"single"=review 진입·redraw) 신호 반환 → 라우터가 `InterviewStateOut.draw_due`(비영속)로 전달. 톤 검수 계약·`ToneReviewOut`·`build_tone_messages` 삭제(명명 표준은 드래프터 규칙 2에 통합), `_HISTORY_TAIL` 12→8. 오케스트레이터 테스트 전면 개정(1콜 단언 포함 17종).

- **Task 2 draw 이벤트**: `POST /interviews/{id}/draw`(variants multi/single) — `generate_proposals`(최근 완료 구조 스테이지 힌트·word draft 힌트 신설·무변화 필터 전멸 시 노티스·KB 참조 주입·word 강등 노티스). 작업본은 수락 전 불변, 실패 롤백. API 테스트 5종.
- **Task 3 델타 드래프팅**: `AiNode.title` 필수 해제(키 에코 `{"key":k}` 허용) + `_expand_delta`(exclude_unset 병합 복원·미지 키 무제목 드롭·빠진 키=삭제) + 드래프터 규칙 6(델타 출력)·[현재 작업본] 컴팩트 목록(`format_graph_compact`). 단위 테스트 5종.
- **Task 4 SP 훅 이동**: 유사 SP 제안을 매 턴 스테이지 훅 → 수락(choice) 턴 직후(작업본 갱신 유일 시점)로 이동. kb_pipeline 테스트 choice 시나리오로 갱신.
- **Task 5 프론트 draw 배선**: `drawProposals` API·`draw_due` 자동 트리거(턴 응답)·수동 Draw map 버튼(액션바) · 진행 오버레이(스켈레톤+경과초 `DrawTimer`, 실패 시 Close/Retry) · draw 중 채팅 잠금(busy OR). data-id: iv-draw/iv-draw-overlay/iv-draw-retry.
- **Task 6 아웃라인·배지**: `InterviewStateOut.facts` 노출 + `deriveOutline`/`deriveSequencePreview`(스테이지 순서 평탄화·배열/구분자 시퀀스 추출, vitest 6종) + 좌하단 접기 패널 `interview-outline.tsx`(iv-outline) + 액션바 맵 기준 배지(iv-map-baseline — not drawn/existing draft/up to date/N turns ago).
- **Task 7 스모크·게이트**: pw-smoke-consult 재작성(턴→draw_due 자동 draw→지연 오버레이 검증→3안 모달→수락→아웃라인·배지·SP·체크포인트) + word 스모크 draw 흐름 갱신. 최종 게이트: BE 809·ruff 0 / vitest 574·tsc 0·lint 0에러·build·스모크 3종 그린. **속도 재설계 Tasks 1~7 전체 완료 — dev 미머지(AI 독립 라인 유지)**.
- **후속: 수락 낙관적 반영** — Use this option 클릭이 인터뷰어 1콜(다음 질문)까지 기다려 모달이 얼던 문제: 클릭 즉시 모달 닫고 선택 안을 캔버스에 표시(`optimisticChoice`→`optimisticGraph`), 서버 턴은 typing 상태로 백그라운드 대기·실패 시 모달 자동 복귀. 스모크에 지연 턴(600ms) 목으로 응답 전 렌더 검증.
- **후속: 워드 기능 프론트 가리기** — `lib/features.ts` `WORD_FEATURES_ENABLED=false`(AI 독립 라인 혼선 방지, dev 워드 후속 머지 시 true 복원). 홈 WordDocsSection 미렌더, word-home 스모크는 플래그 인지형(OFF면 섹션 부재 검증 후 종료).
- **후속: 파라미터 표 확정 흐름(AI 0콜 반영)** — params 스테이지는 그리지 않고 `params_table` 구조로 수집(인터뷰어 규칙 9 확장·`_merge_stage_facts` 활동별 딥머지) → 완료 전이 시 `draw_due="params"` → 표 확정 모달(`params-table-dialog`, 액션바 Params 버튼 재오픈) → `POST /apply-params`가 제목 매칭으로 attributes에 즉시 반영(미정/무매칭 스킵·노티스). review 진입 자동 draw 제거(표 반영으로 대체). BE 테스트 6종·vitest 2종.
- **후속: 500 방어** — `_expand_delta`의 노드 검증 예외(예: 이전 작업본 두 통화 공존)가 draw를 500으로 죽이던 경로 차단(병합 실패→원본 복원→드롭, 안 단위 격리) + apply-params 통화 배타 강제(행에 둘 다면 krw 우선·기존 반대 통화 제거). 테스트 2종.

## 2026-07-27 — 인터뷰 속도·타이밍 재설계 설계 확정 (worktree-ai-consultant)
- GPU 실검증 피드백(턴 1~4분·진행 표시 부재·채팅-맵 어긋남) 브레인스토밍 → 설계 확정: **일반 턴=인터뷰어 1콜**(재드래프트·톤 검수 폐지·프롬프트 다이어트) · **그리기=`POST /draw` 이벤트**(구조 스테이지 완료/review 진입/수동 버튼, 동기+진행 오버레이, 맵은 수락 시점에만 변경) · **델타 드래프팅**(기존 노드 키 에코·exclude_unset 복원) · **facts 아웃라인 패널**(AI 0콜)+맵 기준 배지. `docs/design/2026-07-27-interview-speed-redesign-design.md`.

## 2026-07-27 — P2 지식기반 Tasks 7~9 완료: 유사 SP 제안·프론트·문서 (worktree-ai-consultant)
- **Task 7 유사 SP 제안(백엔드)**: `kb/sp_suggest.py` — 분기 없는 연속 process 체인(3+) 추출 → map 코퍼스 top-1(임계 0.65, 자기 맵·기링크 맵·비가시 맵 제외) → activities/review 턴에 `sp_suggestion` 메시지(맵당 1회). 수락은 `POST /interviews/{id}/sp-accept`가 결정적 치환(subprocess 링크 노드+엣지 재배선+노티스, 제안 메시지 superseded).
- **AI 계약 확장**: AI_NODE_TYPES에 subprocess 추가 + orchestrator `_sanitize_subprocess`(이전 작업본에 실존하는 링크만 제목 매칭 유지, 환각은 process 강등 — word 앵커 사니타이즈와 동형). 세션 시드도 링크 있는 subprocess 유지.
- **Task 8 프론트**: AiNode.linked_map_id 스레딩(AI 변환 2곳 — buildGraphFromAiProposal candidate/mergeNode·page aiNodeToGraphNode: 링크 있는 subprocess만 실제 Call Activity로, 무링크는 기존 강등 유지) · 캔버스 SP 제안 카드(iv-sp-card, Replace/Dismiss/새 탭 링크) · 설정 Knowledge base 탭(`kb-manage-panel` — 업로드/목록/Indexed 뱃지/삭제, sysadmin) + i18n 2키.
- **Task 9**: `docs/deploy/kb-embedding.md`(EMBED_* 설정·백필·그레이스풀) + docs 인덱스. 게이트: BE 805·ruff 0 / vitest 566·tsc 0·lint 0에러·build·스모크 3종(consult SP 카드 단언 포함) 그린. **P2 전체 Tasks 1~9 완료 — 실서버 검증 시나리오는 플랜 문서 하단.**

## 2026-07-27 — P2 지식기반 Tasks 4~6: 인덱싱 워커·라이브러리 API·검색 주입 (worktree-ai-consultant)
- **Task 4 인덱싱**: `kb/indexing.py` — 루프별 Semaphore(1) 직렬 워커 + `spawn()`(fire-and-forget), 소스별 인덱서 3종(library 문서·map 게시본 직렬화(이름/설명/활동/흐름, 맵 단위 교체)·attachment 세션 스코프), publish 훅(versions.py 커밋 후)·첨부 업로드 훅·첨부 삭제 시 청크 동반 삭제, `scripts/backfill_kb_maps.py`(기존 게시본 1회 백필).
- **Task 5 라이브러리 API**: `routers/kb.py` — sysadmin 전용 GET/POST/DELETE `/api/kb/documents`(인터뷰 파싱 계약 재사용·chunk_count 동봉·삭제 시 청크+캐시 정리), `KbDocumentOut` 스키마, main 등록.
- **Task 6 검색 주입**: post_turn에서 맵 이름+스테이지 목표+사용자 입력으로 top-k 검색 → `[지식기반 참조]` 블록(출처 표기·4000자 예산·날조 금지 헤더)을 컨텍스트에 추가. 임베딩 실패는 검색만 스킵+세션당 1회 디그레이드 노티스(인터뷰 계속). 비활성 시 완전 no-op(P1 회귀 가드 테스트).
- 테스트 10종 신규(`test_kb_pipeline.py`). 함정: 노드/엣지 id는 전역 PK — 테스트 픽스처 id에 접두 필수(kbm-*). 게이트: BE 801·ruff 0. 남은 Tasks 7~9(유사 SP 제안·프론트 UI·문서). **dev 머지는 사용자 확인 후 진행 예정(미머지)**.

## 2026-07-27 — 인터뷰 시작 시 기존 맵 데이터 파악 오프닝 (worktree-ai-consultant)
- **매번 같은 백지 인사 개선**: 세션 생성 시 draft 그래프를 작업본으로 시드(`_seed_working_graph` — note 제외·AI 계약 밖 타입 process 강등·엣지/그룹/attributes 동반) → 프리뷰가 처음부터 현재 맵을 표시, 드래프터도 기존 구조 위에서 시작.
- start/end 자동 시드 외 실제 내용이 있으면 **데이터 인지형 오프닝**: 파악한 활동 요약(마크다운, 6개 캡) + "기존 맵 보완/처음부터 재정리" quick reply 2개(question payload — 프론트 픽커 자동 렌더). word 모드는 기존 인사에 노드 파악 한 줄 추가.
- 에이전트 계약 보강: 인터뷰어 룰12(기존 맵 우선 — 백지 질문 금지)·드래프터 룰5(기존 작업본 보존 — 백지 재생성 금지, word 애든덤 6~9 재번호). 테스트 2종 추가, BE 791·ruff 0.

## 2026-07-27 — 임베딩 env를 사내 표준 변수명으로 정렬 (worktree-ai-consultant)
- `AI_EMBED_*` 4종 → **`EMBED_URL`/`EMBED_MODEL`/`EMBED_DIM`/`EMBED_TIMEOUT_SECONDS`** 개명(사내 타 임베딩 사용 서비스와 동일 — 그쪽 .env 값 그대로 복사 가능). 인증 없음 확인 → 토큰 필드·Bearer 헤더 제거.
- `EMBED_URL`은 /v1 루트·/embeddings 전체 경로 모두 수용(끝이 /embeddings면 그대로, 아니면 부착). `EMBED_DIM` 설정화(기본 1024). Settings+.env.example+compose 3곳 동시 갱신. BE 789·ruff 0.

## 2026-07-27 — AI 컨설턴트 P2 지식기반 착수: 플랜 + KB 코어 Tasks 1~3 (worktree-ai-consultant)
- 플랜 신설 `docs/superpowers/plans/2026-07-27-ai-consultant-p2-kb.md`(Tasks 1~9, 설계 §7 구체화).
- Task 1: `AI_EMBED_*` 설정 4종(Settings+.env.example+compose environment 3곳 동시) + `app/kb/embed_client.py`(OpenAI 호환 /embeddings, 배치 ≤32, 재시도 1회, EmbedError 정규화).
- Task 2: `kb_documents`/`kb_chunks` 테이블(create_all 자동) + `kb/chunking.py`(500자/오버랩 80/문단 경계 우선).
- Task 3: `kb/retrieval.py` — float32 패킹, numpy 코사인 top-5+임계 0.5, attachment는 세션 스코프, 인메모리 캐시+무효화. numpy==2.3.1 프로덕션 의존성 추가.
- 테스트 12종 신규(`test_kb_core.py`, 임베딩·httpx2 모킹). 게이트: BE 788·ruff 0. 남은 작업 Tasks 4~9(인덱싱 워커·라이브러리 API·검색 주입·유사 SP·프론트).

## 2026-07-27 — 인터뷰 GPU 실검증 2차 피드백 4종 (worktree-ai-consultant)
- **체크포인트 클릭 = 맵 프리뷰 먼저**: 좌상단 체크포인트를 누르면 즉시 revert하지 않고 캔버스만 스냅샷으로 되돌려 보여줌(신규 하이라이트 억제·인스펙터도 스냅샷 기준) + 상단 프리뷰 바(Keep current/Go back here)로 확정 시에만 실제 revert. `InterviewCheckpointOut.working_graph` 노출 추가(백엔드).
- **언어 미러링**: 세션 언어가 영어라도 사용자가 한글로 답하면 한글로 응답하도록 `_LANG_LINE` 계약 확장(ko/en 대칭).
- **선택지 무변화·중복 필터**: `_graph_signature`(제목 기준 구조 정규화 — 임시키·설명·attributes 무시)로 현재 작업본과 동일한 안·서로 중복인 안 제거, 전부 걸러지면 선택지 없이 일반 턴 폴백(TurnError 아님). 테스트 2종 추가.
- **선택지 레이아웃 재설계**: 3안=좌측 큰 창 1+우측 작은 창 2(탭·작은 창 헤더 클릭으로 큰 창 교체), 2안=1:1, 1안=큰 창 하나 — `ChoiceOverlay` 신설(`iv-choice-tab`·`data-focused`). 드래프터 summary는 "이 안만의 차별점 한 줄"로 유도(공통 설명 금지).
- 게이트: BE 776(+2)·ruff 0 / vitest 562·tsc 0·lint 0에러·build·pw-smoke-consult(+word) 그린.

## 2026-07-27 — 개발(dev) 스택 브리지 서브넷 172.42→172.44 (worktree-ai-consultant)
- 서버 지정값 반영: `docker-compose.dev.yml` subnet/gateway를 172.44.0.0/16·172.44.0.1로 변경(172.42는 기존 스택 점유).

## 2026-07-27 — 인터뷰 턴 504 픽스: nginx 프록시 타임아웃·업로드 한도 (worktree-ai-consultant)
- **GPU 실검증 1차 피드백**: 서버 경유(:3333) 인터뷰 턴이 자주 504 — 턴 1회가 순차 AI 호출 3~4회(인터뷰어→선택지→드래프터→톤 검수)로 nginx 기본 `proxy_read_timeout` 60s를 초과, 프록시가 먼저 끊음(백엔드는 계속 처리해 턴은 커밋됨 — 새로고침 시 답변 존재).
- `nginx/default.conf` `/api/`에 `proxy_read_timeout/send_timeout 600s` + `client_max_body_size 25m`(첨부 20MB — 기본 1MB면 413 잠복) 추가. `.env.example`에 느린 GPU는 `AI_TIMEOUT_SECONDS` 120~180 권장 주석.

## 2026-07-27 — Word 임포트 번호 픽스 3차: typedDoc 문서군은 번호 발명 금지 (dev)
- 2차 후 잔여(실물 3차 리포트): 헤딩 스타일의 무번호 **"Note"**가 카운터를 소모해 이후 하위 번호가 밀림. 근본 해법 — **텍스트 번호 문서군(typedDoc: 텍스트 리터럴 번호 제목 2건 이상)에선 문서가 안 보여주는 번호를 파서가 발명하지 않는다**: 무번호 헤딩(Note 등)=무번호 유지+카운터/스택 불변(실문서와 정합), 언어 짝 상속은 유지. 텍스트 번호 권위도 typedDoc에서만 발동 — 자동넘버 문서의 우발적 숫자 선두 제목("3 Way Handshake") 1건이 오발동하지 않게 보호(카운터·제목 분리 모두 미발동). collectHeadings를 2-pass(후보 수집→typedDoc 판정→넘버링)로 재구성. 무번호 섹션 UI는 기존 처리 재사용(패널 "—"·드롭 라벨 filter(Boolean)). word-import 19/19·vitest 570/570·tsc0·lint0.

## 2026-07-27 — Word 임포트 번호 픽스 2차: 짝 상속 기준을 "명시적 번호 헤더"로 일반화 (dev)
- 1차 픽스 후에도 실물에서 한글 짝이 카운터를 밀던 잔여 케이스(목적=2, 1.1→2.1): 영어 제목이 번호를 **텍스트가 아닌 TOC 권위**로 받아 fromText 가드에 걸림. 사용자 제안대로 기준을 일반화 — **명시적 번호(텍스트 리터럴 or TOC)를 가진 헤더가 기준점**, 그 직후 같은 레벨 무번호 제목은 번호 상속(카운터 불변). 인접성도 "바로 다음 문단"→"사이에 빈 문단만 허용(본문 텍스트 끼면 새 섹션)"으로 완화. 카운터로 추측된 번호는 여전히 기준점 아님(자동넘버 연속 형제 1.1.1→1.1.2 보존). word-import 17/17·vitest 566/566·tsc0·lint0.

## 2026-07-27 — Word 임포트 섹션 번호 불일치 픽스 (dev, 실물 문서 이슈)
- 실물 SOP 임포트에서 번호가 문서와 어긋나는 버그(사용자 진단 정확): 번호가 자동넘버가 아니라 **본문 제목 텍스트에 직접 타이핑**된 문서 + 영어/한글 짝이 **Enter(별도 문단)**로 이어지는 구조 — 한글 줄이 같은 레벨 제목으로 집계돼 카운터를 +1씩 밀어 이후 번호 전부 드리프트(3.2→4.2). Shift+Enter 쌍은 한 문단이라 무영향.
- 픽스 2종(`word-import.ts` collectHeadings): ① **텍스트 리터럴 번호 최우선 권위** — 제목 선두 `^(\d+(\.\d+)*)[.)]?\s+` 매치 시 그 번호 채택·제목에서 분리(라벨 "번호 제목" 중복 방지)·카운터 동기화(제목마다 자가 교정 → 드리프트 누적 불가) ② **무번호 언어 짝 번호 상속** — 텍스트 번호 제목 **바로 다음 문단**의 같은 레벨 무번호 제목은 같은 섹션의 언어 짝으로 보고 번호 상속+카운터 불변. 상속은 직전이 텍스트 번호일 때만(fromText 가드) — 자동넘버 문서의 무번호 연속 형제(1.1.1→1.1.2)는 기존 카운터 유지(기존 테스트가 회귀로 적발해 가드 추가). word-import 15/15·vitest 564/564·tsc0·lint0.
- 기존 임포트된 맵은 **재임포트**하면 번호가 교정됨(카탈로그 전체 교체 + 앵커 불변이라 노드 링크 유지).

## 2026-07-26 — Word 맵 AI 컨설턴트 변환 모드 설계 (dev)
- 브레인스토밍 확정·설계 문서: word 맵의 컨설턴트 = **문서→순서도 변환 컨설턴트**(제안 우선) — word 전용 3스테이지(scope/draft/review, 기존 엔진 재사용)·드래프터 섹션 계약(카탈로그 앵커만 허용·무효 강등 노티스·라벨 서버 재구성)·카탈로그 기본+원본 업로드 권장·AI 변환 2곳 section_anchor 스레딩·기존 섹션 노드 보존. `docs/design/2026-07-26-word-map-ai-consultant-design.md`.
- 구현: word 전용 3스테이지 엔진(WORD_STAGES·mode 파라미터) (Task 1). 761개 테스트 통과, ruff 0.
- 구현: 세션 mode 컬럼 + 생성 분기 + state 노출 + skip 가드 mode 인자 (Task 2). 763개 테스트 통과, ruff 0.
- 구현: 에이전트 word 계약·카탈로그 주입 + AiNodeAttributes.section_anchor (Task 3). format_section_catalog·word 애든덤·mode/section_catalog 파라미터 추가 + 4개 신규 테스트. 767개 테스트 통과, ruff 0.
- 수정(Task 3): AI_NODE_TYPES에 section 추가(word 드래프터 파싱 게이트) — AI_NODE_TYPES 검증 + 회귀 테스트 추가. 768개 테스트 통과, ruff 0.
- 구현: 오케스트레이터 word 앵커 검증(`_sanitize_word_graph` — 무효 앵커 강등·카탈로그 라벨 재구성) + 강등 노티스 + `doc_sections` 라우터→턴 파이프라인 스레딩(`_redraft`/`_generate_choices`/`run_turn`/`_run_skip_turn`, engine 호출 전부 mode 인자) (Task 4). 3개 신규 테스트, 771개 테스트 통과, ruff 0.
- 수정(Task 4): skip-turn 재드래프트 강등 노티스(`_run_skip_turn`·`_redraft` 반환 unpacking) + 정합 로킹 테스트 3개(`test_sanitize_promotes_valid_anchor_on_plain_node`, `test_skip_turn_word_redraft_demote_notice`, `test_stage_complete_with_word_redraft_demote_notice`). 774개 테스트 통과, ruff 0.
- 구현: FE `mode` 노출 + word 3단계 칩(`WORD_INTERVIEW_STAGES`·`stagesForMode`·`stageIndex(key, mode?)`) — consult 페이지 진행 닷·인터뷰 패널 스테이지 칩/디바이더 라벨·프리뷰 체크포인트 라벨 전부 mode 인지(Task 5). `InterviewState.mode` 노출(api.ts). 560개 vitest 통과, tsc 0, lint 0.
- 수정: FE `aiNodeToGraphNode` `section_anchor` 스레딩(Task 6 — AI 변환 2곳 대칭 완성: csv-import buildGraphFromAiProposal 기존·page.tsx aiNodeToGraphNode 신규). 회귀 테스트 추가(buildGraphFromAiProposal 기존 코드로 통과), 561개 vitest·tsc 0·lint 0.
- 검증: word 모드 pw 스모크(`pw-smoke-consult-word.mjs` — 3단계 닷/칩·섹션 노드 프리뷰 렌더) + 원본 `pw-smoke-consult.mjs` 회귀 둘 다 통과, 전체 게이트 실행(Task 7 — 최종). backend pytest 774 passed·ruff 0. frontend vitest 561 passed·tsc 0·lint 0(무관 기존 경고 1)·build OK.
- 리뷰 픽스(최종): `mergeNode`(csv-import.ts)가 제목 매칭된 section 노드를 AI가 process로 에코해도 병합 후 section_anchor가 살아있으면 node_type을 section으로 승격(서버 `_sanitize_word_graph` 규칙의 FE 미러) — 안 그러면 word-export.ts의 "section && anchor" 조건이 깨져 문서 링크가 조용히 사라짐. `agents.py` 카탈로그 삽입이 없앤 일반 모드 프롬프트 개행 1줄 복원 + 개행 스펙 고정 테스트 추가. frontend vitest 562 passed·tsc 0. backend pytest 774 passed·ruff 0.

## 2026-07-26 — 첨부 칩 접기 + 복수/폴더 첨부 리뷰·업로드 진행 (worktree-ai-consultant)
- **칩 목록 접기**: 첨부 칩 5개(약 두 줄)까지만 노출, 초과분은 `+N more` 토글로 펼침/접힘.
- **복수/폴더 선택**: 안내 모달을 Cancel·Choose folder·Choose files 3버튼으로 재구성(폴더는 webkitdirectory — @types/react 미타이핑이라 ref 콜백 부여), 숨김 파일(.DS_Store 등) 자동 제외.
- **리뷰 모달**: 선택 파일을 가능/불가 섹션으로 나눠 표시(확장자 아이콘·크기·불가 사유 뱃지, 섹션당 8행 초과분 +N 요약) — 컨펌 후 순차 업로드. 판정 기준은 백엔드 계약 미러(5종 확장자·20MB).
- **업로드 진행 애니메이션**: 모달 행별 스피너→체크(Done)/실패(Failed) + 버튼 `Uploading n/m…`, 전부 성공 시 자동 닫힘·실패 시 실패 행 유지. 유효 단일 파일은 모달 생략 즉시 업로드(칩 줄 인라인 Uploading 스피너). onAttach는 성공 여부 반환으로 변경(page handleAttach).

## 2026-07-26 — 첨부 칩 확장자 아이콘 (worktree-ai-consultant)
- **파일타입 아이콘**: 첨부 칩에 확장자별 Lucide 아이콘+토큰색 — 시트(xlsx/xlsm/xls/csv)=FileSpreadsheet·added, 프레젠테이션(ppt/pptx)=FileChartPie·changed, 문서(doc/docx)=FileText·accent, pdf=FileType·error, md=FileCode, txt=FileText(뮤트), 그 외 File 폴백. 파싱 실패 칩은 아이콘도 error로 통일. 현재 업로드 포맷(5종) 외 확장자는 표시용 선매핑(백엔드 무변경).

## 2026-07-26 — 채팅 글자 크기 Aa 팝오버 (worktree-ai-consultant)
- **A−/A+ 트리오 → Aa 팝오버**: 액션 줄엔 Aa 버튼 하나만, 클릭 시 플로팅 팝오버(shadow-lg)에서 실크기 A 글리프 4단계(12/13/14/16px)를 직접 선택 — 현재 단계 accent 하이라이트, 바깥 클릭(capture)·Escape 닫힘, 선택 후 입력창 재포커스. 스모크는 팝오버 열기→선택→닫힘 플로우로 갱신(iv-font/iv-font-pop/iv-font-opt-*).

## 2026-07-26 — 인터뷰 채팅 패널 리디자인 7종 (worktree-ai-consultant)
- **컴포저 카드 통합**: 흩어져 있던 툴바·첨부 칩·입력·카운터를 rounded-lg + shadow-md 카드 하나로 — textarea는 borderless, 포커스는 카드 focus-within 테두리, 액션(첨부·A±·Skip·카운터·Send)은 카드 하단 줄.
- **메시지 그룹핑 + 스테이지 디바이더**: 연속 컨설턴트 런의 첫 메시지에만 "Consultant" 헤더(아바타 반복 제거), `message.stage` 전환 지점에 중앙 헤어라인 디바이더 삽입(기존 데이터만 사용, 백엔드 0줄).
- **sticky 스테이지 칩**: 채팅 상단에 현재 스테이지 라벨 + `Stage n of 7`(비활성 시 status) 고정 표시.
- **typing dots**: 스피너+문구 → 점 3개 바운스(기존 `lp-dot` keyframe 재사용), 팁은 ink-muted 캡션으로 톤 다운.
- **보기 픽커 핀 고정**: QuestionOptions를 스크롤 영역 밖 컴포저 바로 위로 이동 — 긴 대화에서도 항상 노출, 키보드 내비·autofocus 유지.
- **스크롤 다운 버튼**: 바닥에서 160px 이상 올라가면 중앙 하단 플로팅 ↓ 버튼(shadow-lg).
- 기존 data-id 전부 유지(pw-smoke-consult 무수정 통과) + 스모크에 iv-stage-chip/iv-composer 단언 추가. lint 0에러·vitest 518·build·스모크 그린, 목업 스크린샷 육안 확인.

## 2026-07-24 — Word 맵 라이프사이클 설계 (dev)
- 브레인스토밍 확정·설계 문서: word 맵=문서 부속 산출물 정체성 → 홈 Maps 탭 내 섹션 분리(조직도·집계 제외)·생성 진입 이동+자동값 축소·워크플로 UI 간소화(셀프 게시)·개정 타임스탬프 2종+stale 배지(N2)·일반 맵 승격 복사(copy 확장, 섹션→process 일괄 변환). `docs/design/2026-07-24-word-map-lifecycle-design.md`.
- 구현: 개정 타임스탬프 2종(doc_imported_at/doc_generated_at) 컬럼·재임포트 스탐프 (Task 1). pytest 24/24 그린.
- 구현: 완결문서 생성시각 기록 엔드포인트 POST /word-doc/generated (Task 2). pytest 703/703 그린.
- 구현: copy convert_to_normal 승격 복사(mode/doc 소거·섹션 노드→process 일괄 변환) (Task 3). pytest 704/704 그린.
- 구현: api 필드/copyMap opts/markWordDocGenerated + word-map-home 파생 헬퍼·vitest (Task 4). vitest 548/548 그린.
- 구현: 홈 분리 — `WordDocsSection`(조직도 밖 문서 평면 목록) + 조직도/즐겨찾기/대시보드는 processMaps만(검색은 word 맵 포함 유지) + 생성 진입은 섹션 "New" 버튼으로 이동, create 드롭다운 Word 항목 삭제. `mode`/`doc_name`/`doc_sections`를 MapDetail 전용에서 MapSummary로 이동(목록 응답 MapOut에 이미 포함 — 홈 분리에 필요) (Task 5). vitest 549/549·tsc0·lint0 그린.
- 구현: `WordQuickCreateDialog` — org_path 보유 유저는 이름만 확인하는 빠른 생성(오우닝 부서=내 org_path·승인자=본인 자동), org_path 없는 유저는 기존 CreateMapDialog 폴백 (Task 6). vitest 549/549·tsc0·lint0 그린.
- 구현: 홈 재임포트 액션 — WordDocsSection onReimport 핸들러 배선 + setWordDoc + 재임포트 모달 (Task 7). vitest 549/549·tsc0·lint0 그린.
- 구현: `MapDetailCard`에 word 맵 문서 메타 블록(문서명·섹션 수·타임스탬프 2종·재생성 힌트)+승격 진입 버튼("Convert to process map", `onPromote` prop) 추가. `latest_version_status` 배지는 이 카드에 애초 없어 숨김 작업 불필요(§4 계약은 카드 밖 대시보드/리스트에서 이미 processMaps만 소비). page.tsx `onPromote` 배선은 Task 9로 이연(다이얼로그 상태 미존재) (Task 8). vitest 549/549·tsc0·lint0 그린.
- 구현: 승격 관문 — `CreateMapDialog`에 `promote` 모드 추가(생성 호출을 `copyMap(mapId, name, {convertToNormal, owningDepartment})`로 교체, visibility 섹션 숨김, 제목 전환) + `page.tsx` `promoteTarget` 상태로 `MapDetailCard`(양쪽 사이트)·`WordDocsSection` `onPromote` 배선 (Task 9). vitest 549/549·tsc0·lint0 그린.
- 구현: 에디터 완결문서 생성 성공 시 `markWordDocGenerated(mapId)` 스탐프(다운로드 비차단, console.warn만) + 재임포트로 사라진 앵커 참조 섹션 노드에 stale 배지(`NodeData.staleAnchor`·`process-node` AlertTriangle) + 섹션 패널 헤더 경고(`staleCount`) — `staleAnchorIds` memo가 `getStaleSectionNodeIds`로 파생, `displayNodes`에 주입 (Task 10). vitest 549/549·tsc0·lint0 그린.
- 검증: 홈 분리 Playwright 스모크(`frontend/scripts/pw-smoke-word-home.mjs`) — 행 노출·생성 진입·조직도 미노출 + 상세카드 단언(`word-doc-meta`·`map-detail-promote` "Convert to process map") 추가. 스모크가 실버그 적발: `WordDocsSection` 행 `onClick`에 `stopPropagation` 누락 → 페이지 배경 클릭 핸들러로 버블링돼 선택이 즉시 해제됨(`map-card.tsx`와 동일 패턴으로 수정) (Task 11, 전체 계획 마지막). 전체 게이트 그린: 백엔드 pytest 704/704·ruff 0 / 프론트 vitest 549/549·tsc 0·lint 0(무관 파일 pre-existing warning 1)·build 성공.
- 전체 브랜치 최종 리뷰 픽스: `copy_map` `owning_department` override가 `create_map`/`set_owning_department`와 달리 `_assert_known_department` 검증을 우회하던 버그 수정(422 가드 추가 + 회귀 테스트) + 홈 재임포트 후 열린 상세카드가 갱신 안 되던 문제를 `detailReloadKey`로 강제 리마운트해 수정. pytest 27/27(test_maps.py)·ruff 0 / vitest 549/549·tsc 0·lint 0(무관 pre-existing warning 1) 그린.
- 홈 좌측 UX 후속(사용자 피드백): ① Word documents 섹션을 조직도 **위**(즐겨찾기 아래)로 이동 — 트리 아래에선 스크롤 밖으로 묻혀 생성 진입을 못 찾음 ② 좌측 접힘 상태(조직도·즐겨찾기·Word·미지정)를 `bpm.home.filters`에 실어 SPA 복귀 시 복원(새로고침은 초기화, 기존 정책 동일 — 복원 시 내 부서 시드 스킵) ③ 조직도 수동 펼침 시 하위 부서가 1개뿐인 구간 연쇄 자동 펼침(`collectSingleChildChain`, org-tree vitest 3종). vitest 552/552·tsc 0·lint 0·pw-smoke-word-home pass.

## 2026-07-24 — 인터뷰 채팅 UX 5종 (worktree-ai-consultant, 실사용 5차 피드백)
- **입력 포커스 유지 + `/` 단축키**: 전송/보기 선택 후 busy 해제 시 입력창 자동 재포커스(보기 픽커가 떠 있으면 픽커 키보드 포커스 양보), `/` 키로 어디서든 입력창 포커스(플레이스홀더에 표기).
- **입력창 반응형**: 1행 min~128px max 자동 확장, maxLength 4000(백엔드 계약 동일) + 3600자부터 카운터 노출. 보내기 버튼은 빈 입력/busy 시 비활성(기존 유지).
- **대기 팁**: 답변 대기 스피너 아래 기능 팁 표시 — AI 챗과 동일 소스(getAiTips 서버 팁, 미설정 시 i18n 폴백) 턴 수 기반 로테이션.
- **첨부 안내 모달**: 첨부 버튼 클릭 시 ConfirmDialog로 제한조건(포맷 5종·20MB) 안내 후 파일 선택.
- **채팅 글자 크기 조절**: A−/A+ 4단계(12/13/14/16px, 기본 13 — 기존 14보다 축소), localStorage(`bpm.consultChatFont`) 브라우저별 저장. `.md` 폰트는 패널 스코프에서 상속 개방.

## 2026-07-24 — 인터뷰 반복 루프 탈출구 (worktree-ai-consultant, 실사용 4차 피드백)
- **결정적 스테이지 스킵**: 미확정 필수 facts를 '미정'으로 채우고 체크포인트 후 다음 단계로 전진하는 skip 턴 구현(기존 스키마의 미사용 "skip" 타입 활용) + 패널 "Skip to next stage" 버튼(review 이전 스테이지 노출) — 모델이 미정 항목을 놓지 못해 같은 질문을 무한 반복하는 루프의 탈출구. review 스테이지 skip은 400.
- **반복 교정 재질의**: 인터뷰어 응답이 직전 컨설턴트 메시지와 거의 동일(유사도≥0.9)하면 1회 교정 재질의 — 실패 시 원 응답 유지(턴 비파괴). 프롬프트에도 "미정도 확정"·"요약 재출력 금지" 룰 추가.
- **redraw 플래그**: 사용자가 "맵 그려줘/갱신해줘"를 요청하면 facts 변화가 없어도 드래프터 실행(InterviewerOut.redraw) — "그림 그리라고 그림" 회귀 대응. 연속 드래프트 블록은 `_redraft` 헬퍼로 통합.

## 2026-07-23 — AI 컨설턴트 인터뷰 모드 설계 + P1 구현 (worktree-ai-consultant)
- **설계 문서**: 전문 컨설턴트가 인터뷰하며 맵을 그려주는 풀스크린 모드 — 고정 7스테이지+적응 스킵·역할 3에이전트(인터뷰어/드래프터/톤 검수자)·선택지 병렬 생성·세션 작업본+체크포인트·bge-m3 지식기반(P2)·RAG 축적(P3)·부하 가드(전역 세마포어 등). `docs/design/2026-07-23-ai-consultant-interview-design.md`.
- **P1 구현 계획**: 백엔드 7태스크(세마포어·모델·엔진·파싱·에이전트·오케스트레이터·API) + 프론트 5태스크(API 클라이언트·consult 라우트·프리뷰/선택지·진입 버튼·pw 스모크) — 태스크별 TDD 코드 포함. `docs/superpowers/plans/2026-07-23-ai-consultant-interview-p1.md`.
- **Task 1 구현**: 전역 `asyncio.Semaphore`로 `call_ai` 동시 호출 상한 강제(ai_max_concurrency, 기본 4) + 설정 3종(interview_choice_count, interview_context_budget) 추가 + .env.example 갱신 + TDD 테스트(동시성 제한 peak≤2 검증) + 기존 49개 테스트 통과.
- **Task 1 수정**: 루프별 세마포어 캐시로 변경(세마포어는 첫 경합 루프에 바인딩되므로 test asyncio.run() 반복 시 런타임 에러 방지).
- **Task 2 구현**: InterviewSession/Message/Checkpoint/Attachment 모델 4종(KST 타임스탐프·FK 무결성·관계 캐스케이드) + InterviewCreateIn/TurnIn/RevertIn/MessageOut/CheckpointOut/AttachmentOut/StateOut 스키마 7종 + TDD 테스트 4개 모두 통과 + 기존 702개 테스트 통과.
- **Task 3 구현**: 스테이지 엔진 — StageDef 데이터클래스 + 고정 7스테이지(scope/io/activities/branches/roles/params/review) + 전이 함수 5종(get_stage, next_stage_key, stage_index, is_stage_complete, first_incomplete_stage) + TDD 테스트 6개 모두 통과 + lint 통과.
- **Task 4 구현**: 첨부 파싱 + 예산 클리핑 — `app.interview.parsing` 신규(PDF/DOCX/XLSX/TXT/MD + cp949 인코딩 폴백) · `clip_to_budget()` 예산 초과 시 섹션별 균등 절단 · 의존성 3종(pypdf·python-docx·openpyxl) 추가 · 테스트 8/8 그린.
- **Task 5 구현**: 에이전트 프롬프트 빌더 + 출력 계약 — `app.interview.agents` 신규(extract_json·InterviewerOut/ToneReviewOut 모델·build_interviewer/drafter/tone_messages 3종 + CHOICE_VARIANT_HINTS) · vLLM 프리픽스 캐시 최적화(고정 프리픽스→문서→facts→히스토리) · TDD 테스트 8/8 그린 + lint 통과.
- **Task 6 구현**: 오케스트레이터 턴 파이프라인 — `app.interview.orchestrator` 신규(run_turn 함수·TurnError·병렬 선택지·스테이지 체크포인트·톤 검수) · 드래프터 병렬 생성(asyncio.gather) · facts 병합·체크포인트·stage 전이 · TDD 테스트 6/6 그린 + lint 통과 + 기존 724개 테스트 통과(총 730개).
- **Task 7 구현**: 인터뷰 API 라우터 — `app/routers/interviews.py` 신규(8 엔드포인트: create/resume·get·turn·attachment·revert·complete·delete + get_active_interview) · 편집자 권한 검증 · AI 활성화 체크(503) · 소유자만 접근(IDOR 404) · 턴 AI 실패 원자성(롤백 + 502) · TDD 테스트 8/8(+ 스키마 4) 그린 + main.py import 등록 + python-multipart 의존성 추가 + lint 통과 + 기존 738개 테스트 통과(총 738개).
- **Task 7 리뷰 픽스**: rollback 후 만료 접근 회귀 — map_id/version_id 선캡처 + 로깅 추가 + 실패 계량 테스트 확장 + python-multipart CVE-2024-53981 핀 상향(0.0.7→0.0.20) + 전체 테스트 738개 그린.
- **Task 8 구현**: 프론트 API 클라이언트 + 순수 헬퍼 — `interview.ts` 신규(INTERVIEW_STAGES 고정 7단계·stageIndex·choiceOptionsOf·addedNodeKeys·layoutWorkingGraph 함수 5종) · `api.ts`에 인터뷰 인터페이스 9종(WorkingGraph/ChoiceOption/InterviewMessage 등) + API 함수 8종(createOrResumeInterview/getInterview 등) 추가 · TDD 테스트 4/4 그린 + npm test 516/516 + tsc 0 에러(interview 범위).
- **Task 9 구현**: 컨설트 라우트 + 인터뷰 패널 — `frontend/src/app/maps/[mapId]/consult/page.tsx` 신규(부트스트랩 효과·상태관리·세션 진입) · `interview-panel.tsx` 신규(메시지 스트림·입력 필드·첨부·스크롤) · `interview-preview.tsx`/`choice-card.tsx` 스텁(Task 10에서 구현 예정) · tsc 0 신규 에러 + npm test 516/516 + npm run lint 통과.
- **Task 9 리뷰 픽스**: 중첩 버튼 + 첨부 stale closure — choice-card 외부 `<button>`을 `<div>`로(내부 버튼 유지·disabled 전파) · handleAttach 스프레드를 함수형 업데이트로(진행 중 턴 응답 낙관적 갱신 방지) · tsc 4 기존 에러만 유지 + npm test 516/516 + npm run lint 0 에러.
- **Task 10 구현**: 우측 읽기전용 프리뷰 + 선택지 미니 프리뷰 — `interview-preview.tsx` 실구현(ReactFlow read-only 캔버스·EDGE_DEFAULTS로 화살표 스타일 적용·체크포인트 되돌리기+적용 바+충돌 경고) · `choice-card.tsx` 실구현(dagre 좌표 정적 SVG 미니 프리뷰) · 브리프 드래프트 3건 수정(`n.data.title`→`n.data.label`, `outcome.errors.join`→`.map(e=>e.message).join`, ref-in-useMemo를 렌더중 상태조정 패턴으로 대체해 `react-hooks/refs` lint 에러 해소) · tsc 4 기존 에러만 유지 + npm test 516/516 + npm run lint 0 에러(스텁 경고 3건 해소) + npm run build 통과.
- **Task 11 구현**: 에디터 진입 버튼 — `page.tsx` 헤더 undo 버튼 앞에 `Headset` 아이콘 버튼 삽입(`data-id="open-consultant"`, `readOnly`일 때 비활성, 클릭 시 `/maps/${mapId}/consult?version=${versionId}` 이동) · lucide-react import에 `Headset` 추가 · tsc 4 기존 에러만 유지 + npm test 516/516 + npm run lint 0 에러(기존 경고 1건만 잔존).
- **Task 12 구현(최종)**: `pw-smoke-consult.mjs` 신규(인사→답변→선택지 2안→선택→체크포인트+프리뷰 3노드, `page.route` 전 API 모킹) 그린 · 전체 게이트 그린(백엔드 pytest 738 · npm test 516 · lint 0 에러 · tsc 기존 4건만 · build 성공) · 설계 문서 P1 단순화 3건 반영(§5 `/apply` 삭제 표기→프론트 `buildGraphFromAiProposal`+graph PUT 재사용·`/complete`는 상태 전이만, §6 `ring-added`→`diffStatus("added")`/`--color-added` 실메커니즘, 확인 카드는 P1 질문 문구 대체 명시).
- **Task 12 리뷰 픽스**: NotificationBell 폴링 ECONNREFUSED 소음 제거 — `pw-smoke-consult.mjs`에 `GET /api/notifications` 모킹 추가(`page.route(**/api/notifications*, r => r.fulfill({ json: [] }))`), 스모크 그린 + eslint 통과.
- **최종 리뷰 픽스 5건**: graph PUT이 `version.updated_at`을 갱신해 인터뷰 충돌 경고 신호 정상화(C1) · consult 페이지 인터뷰 언어를 `useI18n().lang`으로 연동(I1) · docker-compose backend env에 `AI_MAX_CONCURRENCY`/`INTERVIEW_CHOICE_COUNT`/`INTERVIEW_CONTEXT_BUDGET` 3종 추가(I2) · `_get_owned_interview`에서 매 접근마다 `assert_map_role(editor)` 재검증(I3, 권한 회수 시 차단) · Retry가 이미 성공한 턴을 재전송하지 않도록 `lastTurnRef` 성공 시 초기화(M1). 회귀 테스트 2건 추가(pytest 740개 그린 + npm test 516개 + ruff/tsc/lint 통과).

- **실사용 피드백 반영(대화 UX)**: 채팅 마크다운 렌더(공용 MarkdownView 재사용)+테마 정비(아바타·버블·노티스) · 인터뷰어 계약을 행동 원칙 중심으로 재작성(제안 우선·되물음 즉답·문서 요청 수행·반복 금지) · review 스테이지 체크포인트/톤 검수 스팸 차단(전이 시에만 실행) · 톤 노티스에 적용 개명 명시("A → B") · 선택 턴 이력에 옵션 id 대신 제목 저장 · 첨부 업로드 시 읽음 확인 노티스. 백엔드 741·vitest 516·스모크 그린.
- **실사용 피드백 2차(레이아웃·인터랙션)**: 채팅 우측 이동+드래그 폭 조절(320~640, localStorage) · 선택지를 채팅 밖 캔버스 플로팅 창 복수개로(안마다 팬/줌 ReactFlow, 선택 시 일괄 닫힘) · 명확화 질문 보기(quick-reply 칩, InterviewerOut.options) · 첨부 삭제 API+칩 × · 캔버스 워터마크+핸들 숨김(비교화면 패턴) · 체크포인트 좌상단 스택(최근 위, max-height 진입 애니) · 노드 호버 "Ask about this" 멘션 버튼(CustomEvent→입력창). 백엔드 743·vitest 516·스모크 그린.
- **질문 툴박스**: 보기(quick reply)를 클로드코드식 선택 UI로 — 화살표 ↑↓ 이동·Enter 선택·숫자 1~9 즉선택·클릭·일반 문자 입력 시 자유답변 입력창 자동 포커스(`question-options.tsx`). 프롬프트에 "보기는 options 배열에만, message 본문 중복 나열 금지" 규칙 추가. 전 게이트 그린.
- **질문 툴박스 Other 행**: 픽커 마지막에 "Other — type my own answer" 명시 행 추가(화살표·Enter·클릭으로 자유답변 입력창 포커스) — 주관식 답변 경로를 가시화.
- **대화 반응성·프리뷰 미세조정**: 보낸 메시지 낙관적 즉시 표시(실패 시 유지→Retry 대상 가시화) · 점 격자 제거(프리뷰+선택지 창 민무늬 캔버스) · 복수 제안 간 차이 노드 하이라이트(`distinctiveNodeKeys` — 전 안 공통 아닌 제목만 diff 표시, vitest 2건). vitest 518·스모크 그린.
- **연속 드래프팅 + 파라미터 컨설팅**: facts 갱신 턴마다 드래프터가 작업본 재생성(맵 라이브 갱신 — 선택지 시점에만 그리던 회귀 해소, 실패는 턴 비파괴) · 톤 검수는 그래프가 실제 바뀐 턴만 + '~하기' 개악 금지(플립플롭 차단) · params 스테이지를 체계 설명+활동별 확인 방식으로 강화, 드래프터 attributes 임의 추정 금지 · 프리뷰 노드 클릭 인스펙터(담당·시스템·6파라미터 카드). 백엔드 745·vitest 518·스모크 그린.
## 2026-07-22 — Word 맵 섹션 링크 (구현 완료, worktree-word-map-sections)
- Word(.docx) 맵 전용 모드: 순서도 도형이 문서 내부 앵커(`w:anchor`)로 링크 — 산출물 복사→원본 SOP 붙여넣기 시 섹션 점프 활성. 설계 `docs/design/2026-07-18-word-map-section-linking-design.md`.
- 백엔드: 노드 `section_anchor` 컬럼·맵 `mode`/`doc_name`/`doc_sections`+생성/복사·`PUT /maps/{id}/word-doc` 재임포트.
- 파서(`word-import.ts`, read-only): TOC 하이퍼링크 활성앵커+번호(1~2단계 권위) + `styles.xml` `outlineLvl` 본문 제목 워크 + 3단계+는 TOC 부모 씨앗·로컬카운터로 번호 재구성. 실물 SOP 구조 반영(커스텀 제목 스타일·자동 다단계 넘버·`_Toc` 잔재 중복·5단계+). 문서 0 수정.
- 프론트: `section` 노드타입·섹션 패널(라이브러리 미러)·5개 접근포인트 word맵 게이팅·섹션 드롭 노드생성(`section_anchor` 그래프 라운드트립 저장)·홈 "Word 문서로 만들기" 진입·재임포트.
- 내보내기: 섹션 노드 도형 두 링크 공존 — 1행 라벨 첫 공백토큰만 `w:anchor` 내부링크(+나머지 plain), 2행 url 라벨 외부링크. 도형 1.5cm×3cm 통일(튜닝 상수). Word 버튼은 word맵 전용 노출.
- 게이트 그린: 백엔드 701 pytest·ruff / 프론트 527 vitest·tsc0·lint0·build.
- **미검증(배포 전 수동 필수)**: ① Windows Word 실물 — 산출물 열기→그룹 복사→원본 SOP 붙여넣기→섹션 도형 클릭 시 해당 섹션 점프 + url 라벨 클릭 시 외부 링크. ② **실물 .docx 임포트 파싱 육안 검증**(literal XML 미확보 — 픽스처는 표준 Word TOC 구조 기준). ③ 도형 1.5×3cm·엣지 라우팅 시각 튜닝(design §7). 맵 탭 표현은 다음 세션 보류.
- 후속(dev): 섹션 드롭 노드 라벨을 `번호 제목`으로(제목 텍스트 기본 포함) — 내보내기 첫토큰 분할과 호환(번호만 앵커 링크).
- 후속(dev): **실물 진단** — 문서 제목 스타일(SBL_Text N_Kor/Eng)이 `outlineLvl` 감지 실패(level=0) + 제목 문단에 책갈피 없음(withBookmark=0). 그래서 현재 파서는 TOC 책갈피 달린 소수만 잡아 3단계+ 누락. → ① **스타일 이름 숫자로 레벨 감지**(levelFromStyleName, "SBLText3Kor"→3) ② **책갈피 없는 제목도 합성 앵커(`_bpmsec<n>`)로 노출**. 이제 전 레벨이 목록에 뜸(링크 성립은 다음: 출력 시 사본에 그 앵커명으로 책갈피 주입 = 완결 문서 생성). word-import 8/8.
- 후속(dev): 실물 눈검증 픽스 3종 — ① **빈 제목 문단(블랭크) 제외**(유령 항목·번호 오염) ② **TOC 제목 매칭**으로 책갈피 없는 1~2단계 제목이 권위 번호를 받아 언어별 카운터 리셋(번호 9→14 초과 해소) ③ **어펜딕스 무번호**. word-import 11/11. 다음: 완결 문서 생성(책갈피 주입+그래프 페이지).
- 후속(dev): **언어 필터** — 이중언어 SOP(영문/국문 두 트리)에서 스타일명 접미사(Kor/Eng)로 각 섹션에 `language`(ko/en) 태그(SectionEntry·SectionEntryIn), 섹션 패널에 All/KO/EN 토글(2개 이상일 때만). 영문 쪽 빈 제목은 이미 blank-skip으로 제거돼 국문 트리가 정확. word-import 12/12·백엔드 그린.
- 후속(dev): **완결 문서 생성기**(`word-doc-generator.ts`) — 원본 SOP 사본에 합성 앵커(`_bpmsecN`) 책갈피 주입(제목 걷기 `collectHeadings` 공유로 순번 동일 보장) + 순서도 새 페이지 append(마지막 sectPr 앞, 네임스페이스 보강·docPr/relId 충돌 재부여·rels 병합). opus 리뷰 READY(4대 불변식·리팩터 바이트동일 확인). vitest 541·tsc0·lint0·build 그린.
- 후속(dev): 완결문서 생성 **UI 배선** — 인스펙터 "Generate complete document" 버튼(원본 .docx 선택 → `generateCompleteWordDoc` → 다운로드, word맵 전용) + Word 내보내기와 export 모델 헬퍼 공유. 임시 진단 로그 제거. **미검증(수동)**: Windows Word에서 생성된 .docx 열어 도형 클릭 시 섹션 점프 실물 확인.
- 후속(dev): 내보내기 미세조정 3종 — ① **도형 정확히 1.5×3cm**(word맵은 `computeLayout` fit-to-page 끔=scale1, 상수도 1,080,000/540,000 EMU 정확값; 스프레드 시 페이지 초과 가능) ② **엣지가 도형 변 중점에 붙게** — 커넥터 `stCxn/endCxn`(미검증 프리셋 idx) 제거, off/ext(getSideAnchor)가 선 끝점 직결 ③ **도형 텍스트 8pt 통일**(FONT_HALF_PT 22→16). word-export 21/21·전체 그린. **실물 육안 튜닝 필요**.
- 후속(dev): 실물 임포트 픽스 — ① **섹션 필드 클램프**(파서가 title 500·anchor 200·number 50자로, 백엔드 SectionEntryIn 한도 초과 시 422 방지; 과도 title은 대개 오검지) ② **도형 텍스트 볼드 제거**(사용자 요청). word-import/export 42/42.
- 후속(dev): ① **캔버스 1페이지 경계**(word맵 전용, ViewportPortal flow좌표 점선 박스 ~565×894px = A4 가용−패딩) — 크기 감각·1페이지 안착 가이드 ② **엣지 커넥터 straightConnector1**(bentConnector3가 정렬 노드서 폭0 박스로 붕괴해 화살표가 노드에 안 붙던 문제 → 직선, 끝점이 변 중점에 확실). word-export 21/21.
- 후속(dev): 엣지 커넥터 재설계 — ① **stCxn/endCxn 복원**(도형에 실제 연결 → Word에서 노드 이동 시 선 따라옴; 이전 제거로 "화살표만 덩그러니" 남던 문제 해결) ② **cxn idx 정정** left0/top1/right2/bottom3(ECMA flowChartProcess cxnLst 순서; 기존 top0/left1/… 뒤바뀜) ③ **정렬이면 straightConnector1, 어긋나면 bentConnector3**(접점 정렬 여부로). word-export 22/22. **실물 검증 필요**(idx가 특정 프리셋서 다르면 매핑만 조정).
- 후속(dev): 한글 기본 폰트 바탕체 → **돋움**(word-export rFonts w:eastAsia).
- 후속(dev): **엣지 연결 변을 노드 상대 위치로 유도**(word맵) — 캔버스 핸들이 폴백(right/left)으로 어긋나 출력이 실제 연결과 안 맞던 문제(예: Start 위→아래인데 출력 right→left). 노드 중심 dx/dy로 위/아래·좌/우 변 결정 → 레이아웃 일치. 일반맵은 기존 핸들 유지.
- 후속(dev): 엣지 커넥터 — 여러 차례 실물 반복 끝에 **cxn 최우선**으로 확정: ① stCxn/endCxn 복원(도형 연결 → 노드 이동 시 선 따라옴) ② 변은 **노드 위치로 유도**(폴백 right/left 문제 해소 — 이전 "우측→아래"의 근본 원인이 폴백 변) ③ idx=SIDE_TO_CXN_IDX(left0/top1/right2/bottom3, flowChartProcess 기준) ④ 정렬=직선/어긋남=꺾은선. 잔여: 디시전/터미네이터 cxnLst 순서가 다르면 그 타입만 idx 조정 필요(실물 확인). word-export 22/22.

## 2026-07-20 — 문서 카테고리 폴더 재구성 + CLAUDE/rules 점검 + PROGRESS 아카이브 (main)
- **폴더 재구성(git mv, 이력 보존)**: docs/ 최상위 loose 문서를 카테고리 폴더로 이동 — `docs/deploy/`(deploy·db-seed·db-migration-9910) · `docs/qa/`(alarm-audit·ai-connectivity-test·ai-real-model-smoke) · `docs/design/`(구 `superpowers/specs` 25개 + version-lifecycle-summary). `spec.md`는 코드 15+곳이 참조해 루트 유지.
- **배포 문서 통합**: 과거 1차 `db-migration-9800` 삭제, `9910`을 `docs/deploy/`로. 내부 참조(9800·deploy.md 상대경로) 정리.
- **참조 전수 갱신**: 코드 주석 13파일(`docs/superpowers/specs/`→`docs/design/`, 서브에이전트)·문서/설정 ~20곳. stale 경로·broken 링크 0 검증. `docs/README.md`·`docs/design/README.md` 인덱스 갱신.
- **CLAUDE.md·rules 점검**: `page.tsx` 줄수 6700→9400 갱신(CLAUDE·frontend/AGENTS). `rules/common/documentation.md`에 docs 구조·유지관리 룰 추가(카테고리·설계 문서 경로 참조 불변식·PROGRESS 아카이브 관례).
- **PROGRESS 아카이브**: 전체 이력을 `docs/history/PROGRESS-archive.md`로 스냅샷 보존, 루트는 요약으로 축소.

## 2026-07-20 이전 (요약)
아래 항목들의 상세는 아카이브 참고 — 이번 세션(2026-07-20) 주요 작업:
- **홈/새맵 UX**: 빈 부서 숨김(내 부서 유지)·문서 상태 도넛 재디자인(호버 경계 잘림 방지)·최근맵 삽입 시 전체 밀림 애니·뒤로가기 선택해제·부서미지정 접기·오우닝 선택 시 승인자 피커 반짝·인스펙터 Subprocess 탭 맨끝 이동.
- **서브프로세스 노드 이름 라이브화**: 링크맵 개명이 참조 노드 라벨에 즉시 반영(`SubprocessRefOut.name` 추가, injectSubEnds/outline 라이브 렌더).
- **일괄편집 모달 폭**: 속성 3열 버튼 라벨 오버플로 해소(`w-96`→`w-[29rem]`).
- **완료 기능 문서 정리**: `docs/superpowers/plans/`·`DEV-SERVER-TEST-PLAN.md` 삭제(specs 유지).

> 2026-07-19 이하 및 위 항목의 커밋 단위 상세: [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md) · git history.

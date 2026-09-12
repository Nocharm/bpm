# 역할(assignee_role)·카탈로그 트랙 — 다음 세션 핸드오프 (2026-09-12)

> 다음 세션 시작 프롬프트로 그대로 붙여 쓴다. 상태: `dev`=`origin/dev` 반영, `main` 미머지.
> 설계 원본: `2026-09-11-assignee-role-catalog-design.md`, `2026-09-12-catalog-alias-node-swap-design.md`.

## 프롬프트

```
BPM 저장소 dev 브랜치. 노드/서브프로세스에 역할(assignee_role, sp_assignee_role) 단일값 칸과
관리 목록 자동완성(역할·시스템 카탈로그, /catalogs + SuggestInput, 시스템 자유값→Other+system_fallback)이
UI 전 표면에 들어가 있다(docs/design/2026-09-12-assignee-role-next-session.md 참고).
이번 세션 타깃은 데이터 계약 3종의 최신화다. 먼저 현황 조사 후 결정 사항을 물어보고 구현할 것.
1) AI 계약 — 챗/컨설턴트 인터뷰 프롬프트·AiNodeAttributes·set_attr 경로에 assignee_role 노출,
   시스템 값의 카탈로그 정규화(commitSystem과 대칭).
2) CSV 임포트/내보내기 — Role 열 왕복, 시스템 값 카탈로그 정규화(별칭→정식 표기, 미일치→Other+원문),
   AI·CSV 경로 정규화 대칭(CLAUDE.md 노드 속성 체크리스트).
3) 컨설턴트 임포트(인터뷰 JSON 0.5) 최신화 — 역할 수집·시스템 정규화·샘플/드라이런 리포트 반영.
```

## 이번 라운드에서 바뀐 것 (2026-09-11 ~ 09-12, dev 44커밋)

- **데이터**: `nodes.assignee_role`(String 100, `""`), `process_maps.sp_assignee_role`(nullable) — `_ADDED_COLUMNS` 등록, 그래프 upsert·버전 복제·지정 PUT·참조 빌드·확정 시그니처·비교/변경 요약 3곳 반영.
- **카탈로그 엔진**: `app_settings` 키 `assignee_roles`/`systems` = `[{value, aliases[]}]`, `GET /catalogs`(전원)·`PUT /admin/app-settings`(sysadmin). 불변식 "별칭 하나→값 하나, 값 우선"은 BE `normalize_managed_entries` ↔ FE `normalizeAliases` 이중 구현. `Other`는 예약(삭제 불가·별칭 가능·항상 0번).
- **입력 엔진 `SuggestInput`**: 값+별칭 검색, 정확 일치·별칭→정식 표기 치환, 타이핑 중 접두 일치 첫 제안 자동 하이라이트(Enter/Tab 완성), row(인스펙터)/field(팝오버·폼) 모드. `SystemSuggestInput`은 미일치→`Other`+원문 메모, 기존 메모와 다르면 교체/추가/취소.
- **표면**: 인스펙터 Role 행 · 노드 편집/SP 지정 모달(담당자·역할 2:1 한 행, 역할 타일=값 있으면 칩만/비면 대시) · 캔버스(휴식=역할 텍스트, 호버/선택 1초 뒤 담당자 흑백 칩 페이드, 시스템 줄은 Other면 원문 메모 1줄 말줄임) · 라이브러리 행/피크 · 지정 패널 읽기 행 · 홈 상세 SP 섹션 · 그룹 일괄 편집 `assignee_role` 모드(append 없음) · Excel Role 열 · diff/compare.
- **설정 > 카탈로그 탭**: 역할|시스템 탭, 좌측 목록(필터·추가·사용 중 값 후보·CSV 2열 `value,aliases` 임포트·저장) / 우측 별칭 편집. 탭 개수는 미저장 초안 기준.
- **검증 자산**: `frontend/scripts/pw-smoke-assignee-role.mjs` 19/19(시드는 `owning_department: "Growth Center"`, 자동저장 2600ms·호버 1300ms 대기). 백엔드 pytest 1476, vitest 983.

## 다음 세션에서 결정할 것 (이번엔 미룸)

- AI 계약에 역할을 **필수/선택** 중 어느 쪽으로 노출할지, 인터뷰 에이전트가 역할을 **질문**할지 추론할지.
- CSV 시스템 값 미일치 시 **Other 강제 vs 원문 유지** — 에디터 `commitSystem`과 같은 규칙(Other+메모)을 기본 제안.
- CSV `Role` 열 헤더명(영/한)과 별칭 입력 허용 여부(정식 표기 치환을 CSV에도 적용할지).
- 컨설턴트 임포트 샘플(0.5) 갱신 범위 — 역할 필드 추가만 할지, 시스템 정규화 리포트 행까지 넣을지.

## 알아둘 함정

- 노드 속성은 열거 지점이 많다 — CLAUDE.md "노드 속성 추가 체크리스트"(비교/확정 시그니처 3곳 포함) 그대로 따를 것.
- CSV·AI 값 정규화는 **양쪽 대칭** 필수 — 한쪽만 하면 무효 에코가 pick을 통과해 백엔드 소거로 기존값이 유실된다.
- `useCatalogs()`는 클라이언트 훅 — CSV 파서(`csv-import.ts`)·AI 변환(`buildGraphFromAiProposal`·`aiNodeToGraphNode`)은 순수 함수라 카탈로그를 **인자로** 넘겨야 한다(`normalizeToCatalog`/`commitSystem` 재사용).
- 로컬 검증 서버는 자기 PID로만 내릴 것(광범위 `pkill -f "next dev"` 금지 — 옆 체크아웃 사고 이력).

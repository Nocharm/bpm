# AI graph 제안의 CSV 병합 파이프라인 통합 + 담당자/부서 기본 금지 — 설계

날짜: 2026-07-11 · 브랜치(예정): ai-graph-merge (워크트리) · 사용자 결정 2건 반영

## 목적

1. **AI graph(전체 재생성) 제안이 캔버스를 전량 새 id로 교체**해 비교모드가 무의미해지고(전부 추가/삭제로 표시), **기존 서브프로세스 노드가 일반 노드로 변환되며 링크(linked_map_id)가 파괴**되는 문제를 CSV 임포트가 이미 확립한 "제목 매칭 id 재사용 + 프리뷰 승인" 파이프라인 공유로 해결한다.
   - 사용자가 관찰한 "AI 폴리싱이 서브프로세스 색을 바꿈"의 근본 원인이 이것 — 렌더 색 고정(`process-node.tsx:402-405` 바이올렛 강제)은 정상이나, AI 재생성이 노드 타입 자체를 process로 바꿔 고정이 풀린 것.
2. **AI가 담당자/부서를 기본적으로 지정하지 않게** 하고, 조직 디렉터리를 프롬프트에서 제거한다. 사용자가 지시문에서 명시적으로 요구할 때만 설정 허용.

## 확정된 사용자 결정

| 갈림길 | 결정 |
|--------|------|
| 통합 깊이 | CSV 프리뷰 파이프라인 **완전 공유** — 캔버스 diff + Import 탭 + 소멸 노드 토글 + Apply/Cancel. 채팅 graph 커밋 카드는 안내로 전환 |
| 담당자/부서 | 기본 입력 금지(디렉터리 리스트 제거), **사용자 명시 요청 시에만 허용** — 적용단은 병합의 "빈값=기존 유지" 시맨틱이 방어 |
| 병합 모드의 AI groups | base 비어있지 않으면 무시(매칭 노드는 기존 그룹 유지, 신규는 무그룹). 빈 캔버스면 기존처럼 AI 그룹 생성 |
| graph 커밋 UI | Import 탭으로 일원화 — 지난 백로그 "미리보기 카드 이중 표시"가 graph kind에서 자연 소멸 |

## ① 공용 병합 로직 추출 (frontend)

`frontend/src/lib/csv-import.ts`의 `buildGraphFromCsv`(:236) 내부 병합 코어를 CSV·AI 공용으로 추출:

- **매칭 규칙(현행 그대로)**: start/end는 타입 우선 매칭(:376-388, `reservedIds`), 나머지는 제목 완전일치(:389-393, base 중복 제목은 `sort_order` 최소 승리). 매칭 시 기존 id 재사용, 미매칭 제안 노드는 `genId()` 신규.
- **보존 규칙(`mergeNode`, :420-435 현행 그대로)**: 매칭 노드는 id·좌표·색·group_ids·linked_map_id/follow_latest/linked_version_id/is_primary_end 보존, **linked_map_id 있으면 node_type도 보존**(서브프로세스 방어). description/assignee/department/system/duration/url은 제안이 비면 기존값 유지(`pick`).
- **소멸 산출**: base에 있으나 제안에 없는 노드 → `removedNodes`(프리뷰 토글), `lostEdges` 동일.
- **배치**: 매칭 노드 좌표 불변, 신규만 `layoutAddedOnly`(:223-233) 부분 dagre. base 비면 전체 dagre.
- 추출 형태: csv-import.ts 안에 공용 함수로 두고(파일 이동 없음 — CSV vitest가 무변경 보증), AI 진입점 `buildGraphFromAiProposal(proposal, context)`를 추가. `AiProposal.nodes`(key/title/node_type/description/attributes) → 후보 노드 변환 후 같은 병합 호출. AI edges는 제안의 key/기존 id 혼합 참조를 병합 결과 id로 재매핑.
- **AI groups**: `context.base`의 노드가 1개 이상이면 제안 groups 무시. base 빈 경우에만 기존 `applyAiProposal`의 그룹 생성 로직(임시키→id 매핑) 사용.

## ② AI graph 제안 UX 전환 (frontend, page.tsx + 챗 패널)

- `onGraphProposal`(graph kind 도착) → `buildGraphFromAiProposal` → 기존 `enterCsvPreview`(:1486-1529) 경로 재사용(소스 태그만 "ai"로 구분, `previewRef`/`previewSource` 단일 슬롯 상호배타는 현행 유지) → 캔버스 diff(추가=초록/소멸=빨강 점선) + 인스펙터 **Import 탭**(`importSlot` 슬롯, inspector-panel.tsx:104·177) 강제 오픈.
- `CsvImportTab`을 소스 라벨(CSV/AI)만 일반화해 재사용 — 요약·경고·소멸 노드 유지/삭제 토글·Apply(`saveGraph` PUT)/Cancel 동일.
- **기존 `applyAiProposal`의 전량 교체 경로(page.tsx:1612-1671)와 graph용 `aiPreviewActive` 커밋 카드 폐기** — 채팅의 graph 카드(`ProposalSummaryCard`)는 읽기전용 요약 + "우측 Import 탭에서 검토·적용" 안내 문구로 전환(i18n 신규 키). **`ops`는 현행 유지**(applyAiOps + 채팅 커밋 카드).
- CSV/AI 프리뷰 중 다른 프리뷰 진입 차단은 기존 단일 슬롯 로직 그대로.
- 히스토리(payload 재현) graph 카드는 계속 읽기전용 — 변화 없음.

## ③ 담당자/부서 기본 금지 (backend)

- `ai.py`: `_load_directory`(:98-108)와 핸들러 호출(:178) 제거, `_DIRECTORY_LIMIT` 상수 제거.
- `ai_prompt.py`:
  - `build_system_prompt`/`build_messages`의 `directory` 파라미터·`[조직 디렉터리]` 블록(:235, :242) 제거.
  - 규칙 ②(:51) 교체: "assignee/department는 사용자 지시가 명시적으로 요구할 때만 설정하고, 그 외에는 넣지 마세요(지어내지 말 것)."
  - `_structure_hints`의 담당자·부서 미입력 힌트 제거(:205-212 루프에서 duration만 유지).
  - 스키마 예시의 `"assignee":"홍길동"`(:30) 등 담당자 예시를 중립 필드(duration/system)로 교체. graph 예시의 "(각 노드 담당자 매칭)"(:20) 문구 제거.
  - `_serialize_node`의 `담당=/부서=` 노출(:61-64)은 **유지** — 기존값 인지·에코 보존용.
- 테스트 갱신: `test_build_system_prompt_includes_directory`(test_ai.py:515-525) 제거/교체, 매칭 예시 단언(:317 등)·힌트 단언(:722) 갱신. `_serialize_node` 노출 단언(:422)은 유지.
- `AiNodeAttributes` 스키마의 assignee/department 필드는 **유지**(명시 요청 경로용) — 백엔드 강제 스트립 없음.

## ④ 서브프로세스 보조 가드 (frontend)

- 주 방어는 ①의 병합(매칭 서브프로세스의 타입·링크·색 보존 + AI 스키마상 신규 subprocess 불가).
- `applyAiOps`의 `set_attr`(page.tsx:1762): 대상 노드가 subprocess면 **color 변경 무시**(렌더는 이미 고정이나 데이터 오염 방지). 다른 속성(설명 등)은 규칙 ④(프롬프트, 유지)에 맡김.
- 백엔드 검증 추가 없음(YAGNI — 병합·가드·렌더 고정 3중. 필요 시 후속).

## 검증

- vitest: csv-import 기존 스위트 무변경 통과(추출 리팩터 보증) + `buildGraphFromAiProposal` 신규 케이스(제목 매칭 id 재사용·서브프로세스 타입/링크/색 보존·소멸 산출·groups 무시·edges 재매핑·빈 캔버스 전체 생성).
- backend pytest: 프롬프트 변경 반영(디렉터리 부재·규칙 문구·힌트), 기존 스위트 통과.
- 브라우저 검증 스크립트: 시드 맵에서 AI graph 제안 목킹 → Import 탭 노출 → Apply → 저장 그래프의 기존 노드 id 불변 확인 + 서브프로세스 노드 타입/링크 보존 확인. 챗 graph 카드가 안내 문구인지.
- 게이트: pytest + ruff + vitest + tsc --noEmit + lint + build.

## 비범위

- ops 증분 편집 UX 변경(현행 유지), CSV 임포트 동작 변경(무변경), 백엔드 subprocess 불변식 검증, 그룹 병합 고도화(병합 모드 groups 무시의 개선), B1 토큰 계측·B2 컨텍스트 선별(별도 트랙).

## 함정 메모 (구현 시)

- `frontend/src/app/maps/[mapId]/page.tsx`는 브래킷 경로 — 검색은 `git grep`.
- previewSource "ai"|"csv" 단일 슬롯 — aa87766이 AI/CSV 프리뷰 중첩 자동저장 버그를 잡은 이력. 새 소스 태그 도입 시 이 상호배타를 깨지 말 것.
- React Compiler lint(set-state-in-effect·preserve-manual-memoization) — page.tsx 수정 시 주의.
- 챗 패널 graph 커밋 카드 제거 시 `aiPreviewActive` prop 계약은 ops용으로 잔존 — 파기하지 말 것.

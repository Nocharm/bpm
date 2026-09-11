# 카탈로그 별칭(alias) + 노드 표시 전환(휴식=역할 / 활성=담당자) 설계 — 2026-09-12

2026-09-11 역할·카탈로그 트랙(`2026-09-11-assignee-role-catalog-design.md`)의 후속. ① 카탈로그 항목에 **별칭**을 붙여 검색·입력을 정식 표기로 모으고, ② 캔버스 노드의 담당자 줄이 **휴식 상태엔 역할, 호버/선택 1초 뒤엔 담당자**로 페이드 전환하며, ③ 노드 안 역할 칩은 흑백 톤으로 바꾼다.

사용자 결정(2026-09-12): 별칭은 검색 보조를 넘어 **정식 표기로 치환** · 시스템은 칩 없이 지금처럼 일반 톤, `Other`면 원문 메모를 보여줌 · 전환 지연은 **1초, 나중에 미세 조정할 단일 상수** · 담당자/시스템 전환 모두 같은 지연 · 인스펙터·타일의 칩 톤은 그대로(노드 내부만 흑백).

## 1. 별칭 데이터 모델

| 위치 | 전 | 후 |
|---|---|---|
| `app_settings.assignee_roles` / `systems` | `["Reviewer", ...]` | `[{"value": "Reviewer", "aliases": ["검토자", "리뷰어"]}, ...]` |
| `GET /catalogs`·`AppSettingsOut` | `list[str]` | `list[CatalogEntryOut]` (`value`, `aliases`) |
| `PUT /admin/app-settings` | `list[str]` | `list[CatalogEntryIn \| str]` — 문자열은 별칭 없는 항목으로 승격(구 클라이언트·스크립트 호환) |

- 정규화(`app/app_settings.py normalize_managed_entries`): 값·별칭 모두 trim·100자·casefold 중복 제거. **별칭 하나 → 정식 표기 하나** 불변식: 별칭이 어떤 항목의 값(자기 자신 포함)이나 앞선 별칭과 겹치면 그 별칭을 버린다(값이 별칭보다 우선). 항목당 별칭 20개, 목록 500개.
- `exposed_positions`는 문자열 목록 유지(기존 헬퍼 그대로).
- `Other`: 값은 잠금이지만 **별칭은 허용**(예: 기타·etc). 쓰기 시 Other 항목이 있으면 별칭을 보존해 저장, 읽기 시 Other가 없으면 맨 앞에 보강·있으면 맨 앞으로 이동.
- 저장된 레거시 문자열 배열은 읽을 때 `aliases: []`로 승격 — 마이그레이션 없음.

## 2. 프론트 매칭·입력

- `api.ts`: `CatalogEntry { value: string; aliases: string[] }`, `Catalogs`·`AppSettings`·`putAppSettings` 패치가 엔트리 배열.
- `lib/catalogs.ts`: `normalizeToCatalog(value, entries)`가 값·별칭 모두 casefold 일치 → `entry.value`. `commitSystem`도 엔트리 배열을 받아 별칭 일치면 정식 시스템명(Other 아님). `EMPTY.systems = [{ value: "Other", aliases: [] }]`.
- `SuggestInput.options: readonly SuggestOption[]`(`{ value, aliases? }`): 검색 필드 = 값 + 별칭(`filterByQuery` 필드 여러 개), 드롭다운 항목에 별칭을 보조 텍스트로, Enter/blur 정확 일치는 값 또는 별칭 → **값으로 커밋**. 소비자 3곳(`BpmAttributePicker`·`RoleTile`·`SystemSuggestInput`)은 `useCatalogs()` 엔트리를 그대로 넘긴다.
- `lib/catalog-csv.ts`: `parseCatalogCsv → CatalogEntry[]` — 1열 `value`, 2열 `aliases`(`|` 구분), 헤더(`value[,aliases]`) 선택. `mergeCatalogEntries(current, incoming) → { next, added, duplicates, aliasesAdded }` — 같은 값(casefold)이면 별칭 합집합, 새 별칭은 전역 값·별칭과 겹치지 않을 때만.

## 3. Catalogs 탭

- 칩에 별칭 수 배지(`+n`). 칩 클릭 → 그 카드 아래에 별칭 편집 줄(콤마 구분 입력, 현재 별칭 프리필, `Apply`) — `data-id` `${card}-alias-editor` / `-alias-input` / `-alias-apply`. `Other`는 값 잠금·별칭 편집 가능. 적용 시 클라이언트에서도 같은 불변식(값·별칭 전역 중복 제거)으로 정리.
- CSV 임포트 안내 문구에 2열 형식 명시. 임포트 결과 문구에 별칭 병합 건수 포함.

## 4. 노드 표시 전환 (`process-node.tsx NodeFields`)

- **활성** = 노드 호버(루트 `onMouseEnter/Leave`) 또는 React Flow `selected`(노드 클릭·아웃라인 선택). `NodeFields`에 `active` prop을 넘긴다(3 렌더 사이트: subprocess·decision·일반).
- 지연 상수 **`NODE_ALT_DELAY_MS = 1000`**(`frontend/src/lib/canvas.ts`, 단일 소스 — 미세 조정은 여기서만). 활성 시작 후 지연이 지나면 `alt`, 비활성 즉시 복귀(render-time state adjust + setTimeout).
- 담당자 줄: 휴식 = 역할 칩(있으면) 아니면 담당자 이름 / 활성 = 담당자 이름(있으면). 역할이 없거나 담당자가 없으면 전환 없음(단일 렌더). subprocess는 `spAssigneeRole`·`spAssignee`.
- 시스템 줄: 칩 없이 텍스트. 휴식 = 정식 시스템명, `Other`면 원문 메모(없으면 "기타" 라벨) / 활성 = 원문 메모가 있고 휴식 표기와 다르면 메모. subprocess는 `spSystem`(원문 메모 없음 → 전환 없음).
- 전환 연출: 두 표기를 같은 grid 칸에 겹쳐 두고 `transition-opacity duration-350 ease-smooth motion-reduce:transition-none`으로 교차 페이드(높이는 둘 중 큰 값, 레이아웃 흔들림 없음). 숨은 쪽은 `pointer-events-none aria-hidden`.
- 노드 내 역할 칩 톤: `RoleChip tone="mono"`(`border-hairline bg-surface-alt text-ink-secondary`) — 캔버스만. 인스펙터·타일·홈은 기존 accent.
- `data-id="node-assignee-line" data-alt="true|false"` — Playwright 판정용.

## 5. 검증

- BE: 엔트리 왕복·문자열 승격·별칭 충돌 정리(값 우선, 20개 상한)·Other 별칭 보존/맨 앞·`/catalogs` 엔트리 형태.
- FE vitest: `normalizeToCatalog`/`commitSystem` 별칭 경로 · `parseCatalogCsv` 2열·헤더 · `mergeCatalogEntries` 합집합/충돌 · (기존 테스트 엔트리형으로 갱신).
- Playwright(`pw-smoke-assignee-role.mjs` 확장): "검토자" 입력 → `Reviewer` 저장 · 노드 호버 1.3초 → 담당자 표시(`data-alt=true`)·이탈 → 역할 복귀 · Catalogs 탭 별칭 편집→저장→`/catalogs` 반영.

## 6. 범위 밖
- 별칭을 CSV 임포트(맵 노드 CSV)·AI 계약에서 해석하는 것(패리티 트랙과 함께).
- 부서·담당자 필의 별칭.

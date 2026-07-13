# 노드 파라미터 재정의 — 회당 단가 모델 + 비용 통화 2필드 (design)

작성 2026-07-13. 대상: 노드 숫자 파라미터 5종의 의미·이름·순서 재정의, 비용의 원/달러 분리,
서브프로세스 지정 파라미터 축소(3종), Σ 합산 규칙 변경 및 미리보기, CSV/Excel/AI 계약 반영.

선행 설계: `2026-07-11-numeric-params-excel-csv-export-design.md`, `2026-07-11-sp-params-sum-duration-format-design.md`
(이 문서가 두 설계의 필드 정의·Σ 규칙을 **대체**한다).

## 1. 배경 · 문제

현재 노드는 숫자 파라미터 5종(`duration`, `headcount`, `etf`, `cost`, `extra`)을 갖는다. 이름이
의미를 담지 못해(`etf`, `extra`) 현업이 무엇을 넣어야 하는지 알 수 없고, 비용은 단일 필드라
원화/달러를 구분할 수 없다. 또 "소요시간·비용·인원"이 회당 값인지 연간 총량인지 정의되지
않아 서브프로세스 합산값의 의미도 모호하다.

운영 배포 전(로컬·사내 서버 시연 단계)이므로 기존 데이터 보존 제약은 없다.

## 2. 데이터 모델

### 2.1 노드 파라미터 (6필드, 표시 순서와 동일)

| 순서 | 키 (DB 컬럼 = API 키 = CSV 헤더) | 라벨 EN | 라벨 KO | 형식 |
|---|---|---|---|---|
| 1 | `duration` | Duration / run (h) | 회당 소요시간 | H.MM (소수부 = 분, 기존 규칙 유지) |
| 2 | `cost_krw` | Cost / run (KRW) | 회당 추가비용(원) | 숫자, 표시 `1,250,000` |
| 3 | `cost_usd` | Cost / run (USD) | 회당 추가비용($) | 숫자, 표시 `1,200.50` |
| 4 | `headcount` | Headcount / run | 회당 투입인원 | 숫자 |
| 5 | `annual_count` | Annual volume | 연간 건수 | 숫자 |
| 6 | `fte` | FTE | FTE | 숫자 |

- 비용은 **인건비 제외** 추가비용이다(라벨·헬프 문구에 반영).
- 개명: `etf` → `fte`, `extra` → `annual_count`, `cost` → `cost_krw` + `cost_usd`.
- 저장은 기존과 동일하게 `String(50)` 숫자 문자열. 무효값은 API 경계에서 `""` 소거(기존 계약 유지).
- **비용 배타 규칙**: `cost_krw`와 `cost_usd`는 동시에 값을 가질 수 없다. 둘 다 비어 있는 것은 정상.

### 2.2 서브프로세스 지정값 (`process_maps.sp_*`)

하위 맵이 자신을 대표해 노출하는 파라미터는 **3종(비용은 통화 2필드)**:

- `sp_duration` — 회당 소요시간
- `sp_cost_krw`, `sp_cost_usd` — 회당 추가비용 (배타)
- `sp_headcount` — 회당 투입인원

`sp_etf`, `sp_extra` 컬럼은 **제거**한다. 연간 건수·FTE는 하위 맵의 성질이 아니라 그 하위
프로세스를 어디에 쓰느냐(부모 맥락)에 따라 달라지는 값이기 때문이다.

### 2.3 마이그레이션

컬럼 개명·삭제는 `create_all`과 `db.py` `_ADDED_COLUMNS`(additive 전용)로 따라갈 수 없다.
운영 미배포이므로 **DB 재생성**을 전제한다.

- 로컬: `python -m scripts.reset_db` (bash) / `.venv\Scripts\python -m scripts.reset_db` (PowerShell)
- 서버: compose DB 볼륨 초기화 후 시드 재실행
- 기존 `cost` 값은 이관하지 않고 버린다(빈 값에서 시작).
- `docs/db-seed.md`에 재생성 필요를 명시한다.

## 3. 파라미터 UI

### 3.1 노드 타입별 편집 가능 필드

현재 `canvas.ts`의 `hasBpmAttributes(nodeType)`는 "속성 있음/없음" 이분법이라 서브프로세스가
전부 읽기전용이다. 이를 **노드 타입 → 편집 가능 파라미터 집합** 함수로 대체한다.

| 노드 타입 | 편집 가능 | 표시(읽기전용) |
|---|---|---|
| process / decision 등 일반 | 6필드 전부 | — |
| subprocess | `annual_count`, `fte` | `duration`, `cost_krw`, `cost_usd`, `headcount` ← 링크 맵의 `sp_*` 라이브 참조 |
| start / end | 없음 | 없음 |

서브프로세스 노드는 부모 맵마다 다른 연간 건수·FTE를 가지므로 그 두 값은 **노드 행에 저장**된다
(`nodes.annual_count`, `nodes.fte`). 링크가 끊기거나 지정 해제된 경우 읽기전용 3종은 지금처럼
경고+잠금 렌더.

### 3.2 입력 서식 (`ParamInput`)

기존 duration의 "포커스 중 원문 ↔ 그 외 표시형(`1h30m`)" 스왑 패턴을 그대로 확장한다.

- `cost_krw` / `cost_usd`: 포커스 중에는 콤마 없는 원문, 포커스 아웃 시 천단위 콤마(`1,250,000`).
  타이핑 필터는 숫자·점만 허용(콤마는 사용자가 못 침).
- **배타 강제**: 한쪽 비용에 값이 있으면 반대쪽 입력칸은 `disabled`. 값을 지우면 즉시 재활성.
- 캔버스 노드 칩: 비용은 통화 기호 + 콤마(`₩1,250,000`, `$1,200.50`), duration은 기존 `1h30m`,
  나머지는 원문 숫자. 값이 있는 파라미터만 칩으로 노출(현행 규칙 유지).

### 3.3 백엔드 검증

- `cost_krw`·`cost_usd` 둘 다 비어 있지 않으면 **422**로 거절한다(조용한 소거는 데이터 유실).
  노드(`NodeIn`)·SP 지정(`SubprocessDesignationIn`) 양쪽 경계에 동일 규칙.
- 개별 필드의 숫자 검증·무효값 `""` 소거는 기존 계약 그대로.

## 4. Σ 합산 (SP 지정 화면)

Σ 버튼은 **4개**: 소요시간, 비용(KRW), 비용(USD), 인원. 소스는 그 맵의 최신 게시본 그래프
(게시본이 없으면 버튼 비활성 — 현행 유지).

| 필드 | 규칙 | SP 노드 처리 |
|---|---|---|
| `duration` | 전 노드 합 (분 이월: 90분 → `1.30`) | 링크 맵의 `sp_duration` 값을 합에 포함 |
| `cost_krw` | 독립 합 | 링크 맵의 `sp_cost_krw` 포함 |
| `cost_usd` | 독립 합 | 링크 맵의 `sp_cost_usd` 포함 |
| `headcount` | **평균** = 값이 있는 노드의 합 ÷ 개수, 소수점 2자리 반올림 | **제외** (분자·분모 모두) |

- 기여값이 0개면 결과는 `""` — "0"과 "비어 있음"을 구분한다(현행 규칙 유지).
- 부동소수 오차 차단을 위해 정수 스케일 합산(현행 `param-sum.ts` 방식) 유지. 평균은 합산 후 나눗셈,
  `toFixed(2)` 후 불필요한 `.00`은 유지(예 `1.58`, `2.00`).

### 4.1 Σ 결과 미리보기 (placeholder)

SP 지정 화면 진입 시 4개 Σ 값을 미리 계산해, 각 입력칸의 **placeholder**로 노출한다.

- 스타일: 회색 이탤릭(`text-ink-tertiary italic`).
- 값이 이미 입력돼 있으면 placeholder는 자연히 보이지 않는다(HTML 기본 동작).
- 게시본이 없으면 placeholder도 없다.
- 비용 placeholder는 콤마 서식(`1,630,000`), duration placeholder는 `1h30m` 표시형.
- placeholder는 **표시일 뿐 저장되지 않는다** — 값을 채우려면 Σ 버튼을 눌러야 한다.

## 5. CSV / Excel

### 5.1 CSV (14컬럼)

```
Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next
```

- 익스포트: 콤마 없는 raw 숫자(왕복 보장).
- 임포트: `1,250,000` 같은 콤마 표기도 허용(제거 후 파싱). 구 헤더(`ETF`/`Cost`/`Extra`)는
  미지원 헤더로 명확히 에러. 비용 두 칸이 모두 채워진 행은 검증 에러(행 번호 + 메시지).
- 샘플 CSV(`docs/samples/`) 갱신.

### 5.2 Excel

컬럼 순서는 CSV와 동일(기존 `No`/`Type`/`Groups` 등 부가 컬럼은 유지). 숫자 셀 + 서식:

| 컬럼 | numFmt |
|---|---|
| Duration (h) | `0.00` (H.MM 표기 보존) |
| Cost (KRW) | `#,##0` |
| Cost (USD) | `#,##0.00` |
| Headcount | `0.00` |
| Annual volume | `#,##0` |
| FTE | `0.00` |

## 6. AI 계약

- `AiNodeAttr` + 프롬프트 스키마에 `cost_krw`, `cost_usd`, `headcount`, `annual_count`, `fte` 추가.
  AI는 6필드를 **읽고(맥락 직렬화) 쓸 수 있다**.
- 프롬프트에 명시할 규칙:
  - 비용은 `cost_krw`·`cost_usd` 중 **하나만** 채운다(둘 다 채우면 거절).
  - 각 값의 의미(회당 단가 vs 연간 건수)와 단위.
  - **서브프로세스 노드는 `annual_count`·`fte`만 수정 가능** — 소요시간·비용·인원은 하위 맵의
    지정값이라 수정 불가.
- 프롬프트만 믿지 않는다. **변환단에서도 강제**: `buildGraphFromAiProposal`(csv-import.ts)과
  에디터의 `aiNodeToGraphNode`(page.tsx) 두 곳에서 SP 노드의 금지 필드를 드롭하고, 드롭 사실을
  프리뷰 경고로 표시한다. 비용 배타 위반도 동일하게 처리(거절 + 경고).
- 값 정규화는 CSV 경로와 **대칭**이어야 한다(한쪽만 정규화하면 무효 에코가 pick을 통과해 기존값이
  소거된다 — CLAUDE.md 노드 속성 체크리스트).

## 7. 영향 범위 (열거 지점)

**백엔드**: `models.py`(컬럼) · `schemas.py`(NodeIn/NodeOut/SubprocessDesignationIn/SubprocessRefOut/
AiNodeAttr + 배타 검증기) · `routers/graph.py`(upsert) · `routers/versions.py`(clone_graph) ·
`routers/maps.py`(SP 지정) · `routers/library.py`(raw dict 직렬화 — 응답 validator 우회 경로) ·
`subprocess.py`(get_subprocess_refs) · `ai_prompt.py`(스키마·직렬화·힌트) · `db.py` · `scripts/seed_org_demo.py`

**프론트엔드**: `lib/params.ts`(필드·라벨 키·순서) · `lib/param-sum.ts`(합산/평균) · `lib/duration.ts`
(숫자 정규화·콤마 서식) · `lib/api.ts`(타입) · `lib/csv-import.ts`(헤더·NODE_DEFAULTS·mergeNode pick·
행 변환·AI 변환) · `lib/csv-export.ts` · `lib/excel-export.ts` · `lib/diff.ts`(비교) · `lib/canvas.ts`
(편집 가능 필드 집합) · `lib/i18n-messages.ts`(EN/KO 라벨) · `components/param-input.tsx` ·
`components/process-node.tsx`(칩) · `components/node-summary-modal.tsx` · `components/group-bulk-modal.tsx` ·
`components/subprocess-inspector-card.tsx` · `components/permissions/subprocess-designation-{modal,panel}.tsx` ·
`app/maps/[mapId]/page.tsx`(에디터·AI 변환) · `app/maps/[mapId]/compare/page.tsx`

## 8. 검증

**백엔드 (pytest)**
- 개명된 6필드 저장·조회 왕복, 무효값 `""` 소거 유지
- 비용 배타: 둘 다 채우면 422 (노드·SP 지정 양쪽)
- SP 지정은 3종(+통화 2필드)만 수용, 제거된 `sp_etf`/`sp_extra`는 존재하지 않음
- SP 노드가 `annual_count`/`fte`를 자체 값으로 저장·조회
- AI 계약: `AiNodeAttr`가 새 필드를 파싱, SP 노드 금지 필드는 거절

**프론트엔드 (vitest)**
- Σ: duration 분 이월 합, 비용 KRW/USD 독립 합, 인원 평균(값 있는 일반 노드만, SP 제외, 2자리)
- 기여값 0개 → `""`
- placeholder: 게시본 있으면 Σ 값 노출, 없으면 없음, 값 입력 시 가려짐
- 콤마 서식: 포커스 중 원문 ↔ 아웃 시 `1,250,000`
- 비용 배타: 한쪽 값 있으면 반대쪽 disabled
- CSV 14컬럼 왕복, 콤마 표기 임포트 허용, 구 헤더·양쪽 비용 입력 에러
- Excel numFmt 6종
- AI 변환: SP 노드 금지 필드 드롭 + 경고, 비용 배타 위반 거절

**게이트**: `pytest` · `ruff` · `vitest` · `tsc --noEmit` · `eslint` · `next build`
**수동 확인**: `python -m scripts.reset_db` 후 에디터에서 6필드 입력·비용 배타·SP 지정 Σ/placeholder·
CSV 왕복·Excel 열기.

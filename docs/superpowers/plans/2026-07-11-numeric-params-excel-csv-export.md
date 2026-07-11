# 숫자 파라미터 5종 + Excel/CSV 내보내기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** duration 자유텍스트를 숫자 파라미터 5종(duration H.MM·headcount·etf·cost·extra)으로 세분화하고, CSV 임포트 갱신 + 왕복용 CSV 내보내기 + 서브프로세스 재귀 인라인 Excel(.xlsx) 내보내기를 추가한다.

**Architecture:** 스키마는 기존 `nodes.duration` 컬럼 재사용 + String(50) 4컬럼 추가(값은 숫자 문자열, API 경계 정규화). 내보내기는 전부 클라이언트 — CSV는 임포트 포맷 미러, Excel은 exceljs dynamic import + `getResolvedGraph` 재귀(조상 검사·행 상한 2,000·locked 마스킹). 설계: `docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md`

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic / Next.js + TypeScript + @xyflow/react / exceljs(신규, frontend dependencies) / vitest + pytest

## Global Constraints

- **duration 표기는 H.MM**: 소수부 2자리=분(`0.30`=30분, `0.3`→`0.30` 패딩), 소수부 60 이상은 시간 이월(`0.75`→`1.15`, `0.60`→`1.00`=`"1"`). 정규형: 분이 0이면 정수만(`"2"`), 아니면 `H.MM`(`"1.05"`).
- 나머지 4개 파라미터는 일반 십진수 `^\d+(\.\d+)?$`, 빈값 허용, 음수 불가.
- 기존 duration 자유텍스트는 **전부 버림** — 백엔드 validator가 무효값을 `""`로 소거(레거시 DB 행 포함).
- id 생성은 `genId()`(`@/lib/id`) — `crypto.randomUUID()` 금지 (평문 HTTP).
- UI 문구는 영어, i18n 키는 en/ko 양쪽 모두 추가 (`frontend/src/lib/i18n-messages.ts`).
- 색상 토큰만 사용(컴포넌트) — 단 Excel 출력물 셀 스타일은 raw hex 허용(design.md §1 예외, `export.ts`와 동일 논리).
- 모든 커밋에 `PROGRESS.md` 한 줄 갱신 포함 (`rules/common/git.md`). 커밋 메시지: `type(scope): English — 한국어`.
- 게이트: `npx tsc --noEmit`(vitest·build가 못 잡는 테스트 타입 에러), `npm run lint`, `npm run test`, 백엔드 `pytest` + `ruff check app/ tests/`.
- frontend `grep`은 ugrep이라 `[mapId]` 브래킷 디렉터리를 건너뛴다 — page.tsx 검색은 경로를 직접 지정하거나 `find`+per-file grep.
- 백엔드 테스트에서 맵 생성 시 owning_department 앵커 부서("Owning Anchor Division") 필수 — 기존 conftest 헬퍼 재사용.
- 프론트/백 동시 배포 전제(스키마 연동) — 태스크 순서는 백엔드 먼저.

**실행 명령 (bash, macOS 로컬):**
```bash
# backend (backend/ 에서)
.venv/bin/python -m pytest tests/ -q
.venv/bin/ruff check app/ tests/
# frontend (frontend/ 에서)
npm run test -- --run
npx tsc --noEmit
npm run lint
npm run build
```

---

### Task 1: duration 정규화 유틸 (frontend + backend 동치 구현)

**Files:**
- Create: `frontend/src/lib/duration.ts`
- Create: `frontend/src/lib/duration.test.ts`
- Create: `backend/app/duration.py`
- Create: `backend/tests/test_duration.py`

**Interfaces:**
- Produces (frontend): `normalizeDuration(raw: string): string | null` — 유효→정규형(`""` 포함), 무효→`null`. `normalizeNumericParam(raw: string): string | null` — 십진수 검증(트림 원문 반환). `DURATION_PATTERN`, `NUMERIC_PATTERN` 정규식 export.
- Produces (backend): `normalize_duration(raw: str) -> str | None`, `NUMERIC_RE: re.Pattern[str]` — 프론트와 케이스 동치.

- [ ] **Step 1: 프론트 실패 테스트 작성** — `frontend/src/lib/duration.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { normalizeDuration, normalizeNumericParam } from "./duration";

describe("normalizeDuration", () => {
  it("빈값은 빈값", () => expect(normalizeDuration("")).toBe(""));
  it("공백 트림", () => expect(normalizeDuration(" 2 ")).toBe("2"));
  it("정수 그대로", () => expect(normalizeDuration("2")).toBe("2"));
  it("2자리 분 유지", () => expect(normalizeDuration("1.15")).toBe("1.15"));
  it("1자리는 10분 단위 패딩", () => expect(normalizeDuration("0.3")).toBe("0.30"));
  it("3분", () => expect(normalizeDuration("0.03")).toBe("0.03"));
  it("60분 이월", () => expect(normalizeDuration("0.60")).toBe("1"));
  it("75분 이월", () => expect(normalizeDuration("0.75")).toBe("1.15"));
  it("2.99 → 3.39", () => expect(normalizeDuration("2.99")).toBe("3.39"));
  it("소수부 0은 정수로", () => expect(normalizeDuration("2.00")).toBe("2"));
  it("자유텍스트 무효", () => expect(normalizeDuration("2일")).toBeNull());
  it("음수 무효", () => expect(normalizeDuration("-1")).toBeNull());
  it("소수부 3자리 무효", () => expect(normalizeDuration("1.234")).toBeNull());
  it("점만 무효", () => expect(normalizeDuration(".")).toBeNull());
});

describe("normalizeNumericParam", () => {
  it("빈값", () => expect(normalizeNumericParam("")).toBe(""));
  it("정수", () => expect(normalizeNumericParam("3")).toBe("3"));
  it("소수", () => expect(normalizeNumericParam("2.25")).toBe("2.25"));
  it("텍스트 무효", () => expect(normalizeNumericParam("2명")).toBeNull());
  it("음수 무효", () => expect(normalizeNumericParam("-2")).toBeNull());
});
```

- [ ] **Step 2: 실패 확인** — `cd frontend && npm run test -- --run src/lib/duration.test.ts` → FAIL (모듈 없음)

- [ ] **Step 3: 프론트 구현** — `frontend/src/lib/duration.ts`

```ts
// duration H.MM 표기 정규화 — 소수부 2자리는 "분"(십진수 아님). 설계 2026-07-11 §2.2.
// 백엔드 app/duration.py와 케이스 동치를 유지할 것(경계 이중 방어).

export const DURATION_PATTERN = /^\d+(\.\d{1,2})?$/;
export const NUMERIC_PATTERN = /^\d+(\.\d+)?$/;

/** H.MM 정규화 — 유효하면 정규형("2"·"1.15"), 무효면 null. 빈 문자열은 "". */
export function normalizeDuration(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "";
  if (!DURATION_PATTERN.test(text)) return null;
  const [intPart, fracPart = ""] = text.split(".");
  let hours = Number.parseInt(intPart, 10);
  // 1자리 소수부는 10분 단위 — "0.3" = 30분
  let minutes = fracPart === "" ? 0 : Number.parseInt(fracPart.padEnd(2, "0"), 10);
  hours += Math.floor(minutes / 60);
  minutes %= 60;
  return minutes === 0 ? String(hours) : `${hours}.${String(minutes).padStart(2, "0")}`;
}

/** 일반 십진 파라미터(headcount·etf·cost·extra) — 유효하면 트림 원문, 무효면 null. */
export function normalizeNumericParam(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "";
  return NUMERIC_PATTERN.test(text) ? text : null;
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS

- [ ] **Step 5: 백엔드 실패 테스트** — `backend/tests/test_duration.py`

```python
"""duration H.MM 정규화 — 프론트 lib/duration.ts와 케이스 동치."""
import pytest

from app.duration import normalize_duration


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("", ""), (" 2 ", "2"), ("2", "2"), ("1.15", "1.15"),
        ("0.3", "0.30"), ("0.03", "0.03"), ("0.60", "1"), ("0.75", "1.15"),
        ("2.99", "3.39"), ("2.00", "2"),
    ],
)
def test_normalize_valid(raw: str, expected: str) -> None:
    assert normalize_duration(raw) == expected


@pytest.mark.parametrize("raw", ["2일", "-1", "1.234", ".", "1.2.3"])
def test_normalize_invalid(raw: str) -> None:
    assert normalize_duration(raw) is None
```

- [ ] **Step 6: 실패 확인** — `cd backend && .venv/bin/python -m pytest tests/test_duration.py -q` → FAIL (모듈 없음)

- [ ] **Step 7: 백엔드 구현** — `backend/app/duration.py`

```python
"""duration H.MM 표기 정규화 — 프론트 lib/duration.ts와 동치 (설계 2026-07-11 §2.2)."""
import re

DURATION_RE = re.compile(r"^\d+(\.\d{1,2})?$")
NUMERIC_RE = re.compile(r"^\d+(\.\d+)?$")


def normalize_duration(raw: str) -> str | None:
    """유효하면 정규형("2"·"1.15"), 무효면 None. 빈 문자열은 ""."""
    text = raw.strip()
    if text == "":
        return ""
    if not DURATION_RE.fullmatch(text):
        return None
    int_part, _, frac_part = text.partition(".")
    hours = int(int_part)
    # 1자리 소수부는 10분 단위 — "0.3" = 30분
    minutes = int(frac_part.ljust(2, "0")) if frac_part else 0
    hours += minutes // 60
    minutes %= 60
    return str(hours) if minutes == 0 else f"{hours}.{minutes:02d}"
```

- [ ] **Step 8: 통과 확인** — 같은 명령 → PASS. `ruff check app/ tests/` 클린.

- [ ] **Step 9: 커밋** — PROGRESS.md 한 줄 추가 후:

```bash
git add frontend/src/lib/duration.ts frontend/src/lib/duration.test.ts backend/app/duration.py backend/tests/test_duration.py PROGRESS.md
git commit -m "feat(params): H.MM duration normalizer, FE/BE equivalent — duration H.MM 정규화 유틸(프론트/백 동치)"
```

---

### Task 2: 백엔드 — 숫자 파라미터 4컬럼 + NodeIn/AI 경계 정규화 + AI 프롬프트 규칙

**Files:**
- Modify: `backend/app/models.py` (Node — duration 아래 4컬럼)
- Modify: `backend/app/db.py` (`_ADDED_COLUMNS` 4항목)
- Modify: `backend/app/schemas.py` (NodeIn ~line 그대로 `duration: str` 아래 + validators, `AiNodeAttributes`(line 902) duration validator)
- Modify: `backend/app/ai_prompt.py` (line 17 예시·line 30 set_attr 예시 `"2일"`→`"1.30"`·규칙 줄 추가)
- Modify: `backend/scripts/seed_org_demo.py` (duration 시드값을 숫자로)
- Test: `backend/tests/test_numeric_params.py` (신규)

**Interfaces:**
- Consumes: `app.duration.normalize_duration`, `NUMERIC_RE` (Task 1)
- Produces: `NodeIn`/`Node`/graph 응답에 `headcount`·`etf`·`cost`·`extra: str = ""` 필드. 무효 숫자값은 경계에서 `""` 소거(422 아님 — 아래 이유).

**핵심 결정 — 무효값은 422가 아니라 `""` 소거:** `NodeIn.model_config`가 `from_attributes=True`로 ORM 행 직렬화(응답 경로)에도 쓰인다. 레거시 DB의 `"2일"`이 응답 검증에서 422/500을 내면 GET graph가 깨진다. validator가 무효값을 `""`로 치우면 ① 레거시 행 조회 시 화면에서 즉시 사라지고 ② 다음 저장 때 물리적으로도 비워져 "기존 데이터 전부 버림" 결정(설계 §2.3)을 경계에서 집행한다.

- [ ] **Step 1: 실패 테스트** — `backend/tests/test_numeric_params.py`. 기존 그래프 테스트 파일에서 맵/버전 생성 헬퍼(conftest 픽스처, owning_department 앵커 부서 포함)를 찾아 같은 방식으로 작성:

```python
"""숫자 파라미터 4필드 — 저장/응답 왕복 + 무효값 경계 소거."""
# conftest의 기존 클라이언트/맵 생성 픽스처를 재사용한다 (tests/test_graph*.py 참고).


def _node(node_id: str, **overrides):
    base = {
        "id": node_id, "title": node_id, "node_type": "process",
        "pos_x": 0, "pos_y": 0, "sort_order": 0,
    }
    base.update(overrides)
    return base


def test_numeric_params_round_trip(client, version_id):
    graph = {
        "nodes": [
            _node("s1", node_type="start"),
            _node("p1", duration="0.75", headcount="2", etf="1.5", cost="300", extra="7"),
            _node("e1", node_type="end", is_primary_end=True),
        ],
        "edges": [
            {"id": "ed1", "source_node_id": "s1", "target_node_id": "p1", "label": ""},
            {"id": "ed2", "source_node_id": "p1", "target_node_id": "e1", "label": ""},
        ],
        "groups": [],
    }
    resp = client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert resp.status_code == 200
    node = next(n for n in client.get(f"/api/versions/{version_id}/graph").json()["nodes"] if n["id"] == "p1")
    assert node["duration"] == "1.15"  # 0.75 → 60분 이월
    assert (node["headcount"], node["etf"], node["cost"], node["extra"]) == ("2", "1.5", "300", "7")


def test_invalid_numeric_cleared_at_boundary(client, version_id):
    graph = {
        "nodes": [
            _node("s1", node_type="start"),
            _node("p1", duration="2일", headcount="두명", etf="", cost="1.2.3", extra="x"),
            _node("e1", node_type="end", is_primary_end=True),
        ],
        "edges": [
            {"id": "ed1", "source_node_id": "s1", "target_node_id": "p1", "label": ""},
            {"id": "ed2", "source_node_id": "p1", "target_node_id": "e1", "label": ""},
        ],
        "groups": [],
    }
    assert client.put(f"/api/versions/{version_id}/graph", json=graph).status_code == 200
    node = next(n for n in client.get(f"/api/versions/{version_id}/graph").json()["nodes"] if n["id"] == "p1")
    assert node["duration"] == ""
    assert (node["headcount"], node["etf"], node["cost"], node["extra"]) == ("", "", "", "")
```

(픽스처 이름은 conftest 실물에 맞춰 조정 — 스타일만 유지.)

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_numeric_params.py -q` → FAIL (unknown field/컬럼 없음)

- [ ] **Step 3: 모델·DDL** — `models.py` Node의 `duration` 줄 아래:

```python
    # 숫자 파라미터 — duration(H.MM 시간)과 함께 5종, 값은 숫자 문자열(경계 검증) (design 2026-07-11)
    headcount: Mapped[str] = mapped_column(String(50), default="")
    etf: Mapped[str] = mapped_column(String(50), default="")
    cost: Mapped[str] = mapped_column(String(50), default="")
    extra: Mapped[str] = mapped_column(String(50), default="")
```

`db.py` `_ADDED_COLUMNS` 끝에(기존 행 NULL이면 NodeIn(str) 검증이 깨지므로 DEFAULT '' — manual_docs.title 패턴):

```python
    # 숫자 파라미터 4종 — duration 세분화 (design 2026-07-11)
    ("nodes", "headcount", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "etf", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "cost", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "extra", "VARCHAR(50) DEFAULT ''"),
```

- [ ] **Step 4: NodeIn 필드+validator** — `schemas.py` NodeIn의 `duration` 줄 아래 4필드 추가:

```python
    headcount: str = Field(default="", max_length=50)
    etf: str = Field(default="", max_length=50)
    cost: str = Field(default="", max_length=50)
    extra: str = Field(default="", max_length=50)
```

기존 validator들 옆에 추가 (파일 상단 `from app.duration import NUMERIC_RE, normalize_duration` — 기존 임포트 순서 준수):

```python
    @field_validator("duration", mode="after")
    @classmethod
    def _normalize_duration(cls, value: str) -> str:
        # 무효(레거시 자유텍스트 포함)는 "" — from_attributes 응답 경로가 레거시 행에서 깨지지 않게,
        # "기존 duration 전부 버림"(design 2026-07-11 §2.3)을 경계에서 집행
        normalized = normalize_duration(value)
        return "" if normalized is None else normalized

    @field_validator("headcount", "etf", "cost", "extra", mode="after")
    @classmethod
    def _normalize_numeric_params(cls, value: str) -> str:
        text = value.strip()
        return text if text == "" or NUMERIC_RE.fullmatch(text) else ""
```

`AiNodeAttributes.duration`(line 912)에도 같은 소거(None은 유지 — 부분 갱신 시맨틱):

```python
    @field_validator("duration", mode="after")
    @classmethod
    def _normalize_duration(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = normalize_duration(value)
        return "" if normalized is None else normalized
```

- [ ] **Step 5: 필드 열거 지점 미러** — `grep -n "duration" app/subprocess.py app/routers/graph.py app/routers/versions.py app/routers/maps.py app/routers/library.py` 로 노드 필드를 명시 열거하는 모든 지점(예: resolved 그래프 조립, 복제 로직)에 4필드를 나란히 추가. `sp_duration`(ProcessMap)은 건드리지 않는다.

- [ ] **Step 6: AI 프롬프트 규칙** — `ai_prompt.py`: line 30 예시를 `{"action":"set_attr","node_id":<기존id>,"attributes":{"duration":"1.30"}}`로 교체하고, attributes 설명 부근에 규칙 한 줄 추가:

```
- duration은 시간 단위 숫자 H.MM 표기만 허용 — 소수부 2자리는 분(0.30=30분, 1.30=1시간 30분). "2일" 같은 텍스트 금지, 모르면 비워두세요.
```

- [ ] **Step 7: 시드 정리** — `grep -n "duration" scripts/seed_org_demo.py` — 자유텍스트 duration 시드가 있으면 H.MM 숫자로 교체(예: `"2일"`→`"16"`, `"30분"`→`"0.30"`), 시연용으로 일부 노드에 headcount 등도 채운다.

- [ ] **Step 8: 통과 확인** — `pytest tests/test_numeric_params.py -q` PASS → 전체 `pytest tests/ -q` PASS → `ruff check app/ tests/` 클린.

- [ ] **Step 9: 커밋**

```bash
git add app/models.py app/db.py app/schemas.py app/ai_prompt.py app/duration.py scripts/seed_org_demo.py tests/test_numeric_params.py ../PROGRESS.md
git commit -m "feat(params): 4 numeric param columns + boundary normalization — 숫자 파라미터 4컬럼·경계 정규화·AI 규칙"
```

---

### Task 3: 프론트 — 타입·인스펙터 입력·노드 카드 칩·diff·AI apply

**Files:**
- Create: `frontend/src/lib/params.ts`
- Modify: `frontend/src/lib/api.ts` (GraphNode), `frontend/src/lib/canvas.ts` (NodeData), `frontend/src/lib/node-actions.ts` (NodeDisplayField에서 duration 제거), `frontend/src/lib/diff.ts` (ChangedField+FIELDS), `frontend/src/lib/i18n-messages.ts` (en/ko 키)
- Modify: `frontend/src/components/process-node.tsx` (파라미터 칩), `frontend/src/components/node-summary-modal.tsx` (ATTR_FIELDS)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` — 노드 data 매핑(~505), buildGraph(~604), AI apply(~1744), 신규 노드 기본값(3021·3632·3678), 인스펙터 입력(~7481), 표시 토글(~7717)

**Interfaces:**
- Produces: `PARAM_FIELDS: readonly ["duration","headcount","etf","cost","extra"]`, `type ParamField`, `PARAM_LABEL_KEY: Record<ParamField, MessageKey>` (`lib/params.ts`). `GraphNode`·`NodeData`에 `headcount?/etf?/cost?/extra?: string`(옵셔널 — 기존 리터럴 파급 최소화, url 패턴과 동일).
- Consumes: `normalizeDuration`, `normalizeNumericParam` (Task 1)

- [ ] **Step 1: `lib/params.ts` 작성**

```ts
// 숫자 파라미터 5종 메타 — 라벨은 추후 교체 예정이라 키를 1곳에 모음 (design 2026-07-11 §2.1)
import type { MessageKey } from "./i18n-messages";

export const PARAM_FIELDS = ["duration", "headcount", "etf", "cost", "extra"] as const;
export type ParamField = (typeof PARAM_FIELDS)[number];

export const PARAM_LABEL_KEY: Record<ParamField, MessageKey> = {
  duration: "field.duration",
  headcount: "field.headcount",
  etf: "field.etf",
  cost: "field.cost",
  extra: "field.extra",
};
```

- [ ] **Step 2: 타입 확장** — `api.ts` GraphNode의 `duration: string;` 아래 `headcount?: string; etf?: string; cost?: string; extra?: string;` (주석: 숫자 파라미터 — design 2026-07-11). `canvas.ts` NodeData도 동일하게 4개 옵셔널 추가.

- [ ] **Step 3: i18n 키 추가** — en 블록(line ~216 근처)과 ko 블록(line ~1530 근처) 양쪽:

```ts
  // en
  "field.duration": "Duration (h)",      // 기존 "Duration" 교체
  "field.headcount": "Headcount",
  "field.etf": "ETF",
  "field.cost": "Cost",
  "field.extra": "Extra",
  "inspector.parameters": "Parameters",
  // ko
  "field.duration": "소요시간(h)",        // 기존 "소요시간" 교체
  "field.headcount": "투입인력",
  "field.etf": "ETF",
  "field.cost": "비용",
  "field.extra": "예비",
  "inspector.parameters": "파라미터",
```

- [ ] **Step 4: page.tsx 데이터 왕복 배선** — 4곳:
  - 노드→data 매핑(~505): `duration: node.duration,` 아래 `headcount: node.headcount ?? "", etf: node.etf ?? "", cost: node.cost ?? "", extra: node.extra ?? "",`
  - `buildGraph`(~604): `duration: node.data.duration,` 아래 `headcount: node.data.headcount ?? "", etf: node.data.etf ?? "", cost: node.data.cost ?? "", extra: node.data.extra ?? "",`
  - 신규 노드 기본값(3021·3632·3678의 `duration: ""` 옆): `headcount: "", etf: "", cost: "", extra: "",`
  - AI apply(~1744): `...(attr.duration != null ? { duration: attr.duration } : {})` 를 정규화 경유로 교체:

```ts
    ...(attr.duration != null
      ? { duration: normalizeDuration(attr.duration) ?? "" }
      : {}),
```

- [ ] **Step 5: 인스펙터 Parameters 그룹** — page.tsx ~7481의 `([["system","field.system"],["duration","field.duration"]] as const)` 리스트에서 duration을 빼고 system만 남긴 뒤, 그 아래 Parameters 블록 추가(기존 행 스타일 재사용):

```tsx
<div className="mt-2 border-t border-divider pt-1">
  <div className="mb-0.5 text-fine font-semibold text-ink">{t("inspector.parameters")}</div>
  {PARAM_FIELDS.map((key) => (
    <div key={key} className="flex items-center justify-between gap-2 py-1">
      <span className="shrink-0 text-caption text-ink-secondary">{t(PARAM_LABEL_KEY[key])}</span>
      <input
        data-id={`inspector-param-${key}`}
        inputMode="decimal"
        className="min-w-0 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-right text-caption text-ink hover:bg-surface-alt focus:bg-surface-alt focus:outline-none disabled:hover:bg-transparent"
        value={selectedNode.data[key] ?? ""}
        disabled={readOnly}
        onChange={(e) => {
          // 숫자·소수점 1개만 타이핑 허용 — 정규화는 blur에서
          if (/^\d*\.?\d*$/.test(e.target.value)) updateSelectedData({ [key]: e.target.value }, true);
        }}
        onBlur={(e) => {
          const raw = e.target.value.replace(/\.$/, "");
          const normalized = key === "duration" ? normalizeDuration(raw) : normalizeNumericParam(raw);
          updateSelectedData({ [key]: normalized ?? "" }, true);
        }}
      />
    </div>
  ))}
</div>
```

(기존 duration 입력의 `updateSelectedData` 시그니처를 그대로 따른다 — 실제 핸들러명이 다르면 그 지점의 기존 코드를 미러.) 서브프로세스 읽기전용 sp 속성 블록(~7543)은 **무변경**.

- [ ] **Step 6: 노드 카드 파라미터 칩** — `process-node.tsx`:
  - `node-actions.ts`: `NodeDisplayField`에서 `"duration"` 제거, `NODE_DISPLAY_FIELDS`도 4개(assignee·department·system·url)로. displayFields를 소비/저장하는 지점(page.tsx ~7717 토글 리스트, 저장된 설정 로드)에서 `"duration"` 잔재를 필터: `saved.filter((f): f is NodeDisplayField => (NODE_DISPLAY_FIELDS as readonly string[]).includes(f))`.
  - `FIELD_ICON`에서 duration 항목 제거, `NodeFields`의 spValues에서 duration 항목 제거(빌드 에러 나는 지점 전부 타입 따라 정리).
  - 파라미터 칩 컴포넌트 추가(NodeFields 아래에 렌더):

```tsx
const PARAM_ICON: Record<ParamField, LucideIcon> = {
  duration: Clock, headcount: Users, etf: Target, cost: Coins, extra: Tag,
};

// 파라미터 칩 — 값이 작성된 파라미터 전부, 라벨 없이 아이콘+숫자 (design 2026-07-11 §2.4)
// subprocess는 지정 어트리뷰트의 sp_duration(자유텍스트, 무변경)만 Clock으로 표시.
function NodeParams({ data }: { data: AppNode["data"] }) {
  const isSubprocess = data.nodeType === "subprocess";
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  const values: Partial<Record<ParamField, string | null | undefined>> = isSubprocess
    ? { duration: data.spDuration }
    : { duration: data.duration, headcount: data.headcount, etf: data.etf, cost: data.cost, extra: data.extra };
  const filled = PARAM_FIELDS.filter((f) => values[f]);
  if (filled.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-tertiary">
      {filled.map((f) => {
        const Icon = PARAM_ICON[f];
        return (
          <span key={f} className="inline-flex items-center gap-1">
            <Icon size={12} strokeWidth={1.5} />
            {values[f]}
          </span>
        );
      })}
    </div>
  );
}
```

  - lucide 임포트에 `Coins, Tag, Target, Users` 추가(기존 Clock 유지). `NodeFields`를 렌더하는 각 노드 셸에서 `<NodeFields …/>` 바로 다음에 `<NodeParams data={data} />` 삽입(프로세스·디시전·서브프로세스 셸 전부 — `NodeFields` 사용처를 파일 내 검색).

- [ ] **Step 7: node-summary-modal 확장** — `ATTR_FIELDS`(line 53)를 system만 남기고, 파라미터 5종은 별도 배열로 폼에 추가. 폼 state(line 162)·초기화(167)·저장 payload(177·226)·변경 감지(209)에 4필드 추가. 입력은 Step 5와 같은 필터/blur 정규화.

- [ ] **Step 8: diff 확장** — `diff.ts`: `ChangedField` 유니언에 `"headcount" | "etf" | "cost" | "extra"` 추가, FIELDS 배열(line 48-52)에 `["headcount","headcount"],["etf","etf"],["cost","cost"],["extra","extra"]` 추가. `grep -rn "changedFields" frontend/src --include=*.tsx`로 라벨 렌더 지점을 찾아 새 필드 라벨이 i18n `field.*` 키로 해결되는지 확인(안 되면 그 지점의 라벨 맵에 4키 추가).

- [ ] **Step 9: 게이트** — `npm run test -- --run` PASS, `npx tsc --noEmit` 클린(NodeDisplayField 축소 파급이 여기서 전부 드러남 — 에러 지점을 타입 따라 정리), `npm run lint` 클린(React Compiler 메모 규칙 주의 — 트리비얼 핸들러는 플레인 함수로), `npm run build` 성공.

- [ ] **Step 10: 커밋**

```bash
git add frontend/src ../PROGRESS.md
git commit -m "feat(params): param inputs, node card chips, diff fields — 파라미터 입력·노드 칩(아이콘+값)·diff 확장"
```

---

### Task 4: CSV 임포트 확장 (5 숫자 컬럼)

**Files:**
- Modify: `frontend/src/lib/csv-import.ts`
- Test: `frontend/src/lib/csv-import.test.ts` (기존 확장)

**Interfaces:**
- Consumes: `normalizeDuration`, `normalizeNumericParam` (Task 1)
- Produces: `HEADER_COLUMNS`에 `headcount, etf, cost, extra`(duration 뒤). `buildTemplateCsv()`/`buildAiPromptText()` 갱신. 임포트 결과 노드에 4필드 포함.

- [ ] **Step 1: 실패 테스트 추가** — `csv-import.test.ts`에:

```ts
it("숫자 파라미터 컬럼을 파싱·정규화한다", () => {
  const csv = [
    "Name,Duration,Headcount,ETF,Cost,Extra,Next",
    "A,0.75,2,1.5,300,7,B",
    "B,,,,,,",
  ].join("\r\n");
  const outcome = buildGraphFromCsv(csv);
  const a = outcome.graph?.nodes.find((n) => n.title === "A");
  expect(a?.duration).toBe("1.15"); // 60분 이월
  expect([a?.headcount, a?.etf, a?.cost, a?.extra]).toEqual(["2", "1.5", "300", "7"]);
});

it("비숫자 파라미터는 행 번호와 함께 에러", () => {
  const csv = ["Name,Duration,Headcount", "A,2일,두명"].join("\r\n");
  const outcome = buildGraphFromCsv(csv);
  expect(outcome.graph).toBeNull();
  expect(outcome.errors).toEqual([
    { line: 2, message: expect.stringContaining("Duration") },
    { line: 2, message: expect.stringContaining("Headcount") },
  ]);
});
```

기존 테스트 중 헤더 상수·컬럼 수에 기대는 것들이 깨질 수 있음 — 새 헤더 기준으로 함께 갱신.

- [ ] **Step 2: 실패 확인** — `npm run test -- --run src/lib/csv-import.test.ts` → FAIL (`Unknown column "Headcount"`)

- [ ] **Step 3: 구현** — `csv-import.ts`:
  - `HEADER_COLUMNS`: `"duration"` 뒤에 `"headcount", "etf", "cost", "extra"` 삽입.
  - `MAX_LEN`에 `headcount: 50, etf: 50, cost: 50, extra: 50` 추가.
  - `NODE_DEFAULTS`에 `headcount: "", etf: "", cost: "", extra: ""` 추가.
  - `mergeNode`에 `headcount: pick(next.headcount ?? "", existing.headcount ?? ""),` 등 4줄 추가(duration 줄 옆).
  - rows 매핑에 `headcount: cellOf(r, "headcount"),` 등 4개 추가.
  - 행 검증 루프의 길이 검사 대상 컬럼 배열에 4컬럼 추가하고, 그 아래 숫자 검증 추가:

```ts
    const durationNorm = normalizeDuration(row.duration);
    if (durationNorm === null) {
      errors.push({ line: row.line, message: `Duration must be a number in H.MM hours — "${row.duration}"` });
    }
    for (const col of ["headcount", "etf", "cost", "extra"] as const) {
      if (normalizeNumericParam(row[col]) === null) {
        errors.push({ line: row.line, message: `${col === "headcount" ? "Headcount" : col === "etf" ? "ETF" : col === "cost" ? "Cost" : "Extra"} must be a number — "${row[col]}"` });
      }
    }
```

  - 노드 생성부(~445)에서 `duration: row.duration` → `duration: normalizeDuration(row.duration) ?? ""`, 그리고 `headcount: normalizeNumericParam(row.headcount) ?? "",` 등 4줄 추가.
  - `buildTemplateCsv()` 교체(13컬럼 정합 주의):

```ts
export function buildTemplateCsv(): string {
  return [
    "Name,Description,Assignee,Department,System,Duration,Headcount,ETF,Cost,Extra,URL,URL_Label,Next",
    "Review request,Check the request against the purchasing policy,hong.gd,Quality Part 1,SAP ERP,16,1,,,,,,Approval decision",
    'Approval decision,,"hong.gd, kim.cs",Quality Part 1,,0.30,2,,,,,,Sign contract:approved;Notify rejection:rejected',
    "Sign contract,,lee.yh,Finance Part,,24,1,,,,https://example.com/contract,Contract,",
    "Notify rejection,,,,,8,,,,,,,",
  ].join("\r\n");
}
```

  - `buildAiPromptText()` 컬럼 규칙의 Duration 줄 교체 + 4줄 추가:

```
- Duration: 선택, 소요 시간(시간 단위 숫자, H.MM 표기 — 소수부 2자리는 분: 0.30=30분, 1.30=1시간 30분. "2일" 같은 텍스트 금지).
- Headcount: 선택, 투입 인력(숫자만). 모르면 비워두세요.
- ETF: 선택, 숫자만. 모르면 비워두세요.
- Cost: 선택, 비용(숫자만). 모르면 비워두세요.
- Extra: 선택, 예비 숫자 필드. 일반적으로 비워두세요.
```

- [ ] **Step 4: 통과 확인** — csv-import 전체 테스트 PASS. `npx tsc --noEmit` 클린.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/csv-import.ts frontend/src/lib/csv-import.test.ts ../PROGRESS.md
git commit -m "feat(csv): numeric param columns in import — CSV 임포트 숫자 파라미터 5컬럼·검증·템플릿·AI 프롬프트"
```

---

### Task 5: CSV 내보내기 (왕복)

**Files:**
- Create: `frontend/src/lib/csv-export.ts`
- Create: `frontend/src/lib/csv-export.test.ts`

**Interfaces:**
- Produces: `buildCsvFromGraph(graph: Graph): { csv: string; warnings: string[] }` — 임포트와 동일 포맷(CRLF, BOM은 다운로드 시 접두). `orderNodesByFlow(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[]` — Excel(Task 6)도 재사용.
- Consumes: `Graph`/`GraphNode`/`GraphEdge` (api.ts)

**표현 불가 → warnings 규칙(포맷 한계의 명시적 처리):**
- start/end 노드는 행으로 쓰지 않는다(임포트가 자동 생성·타입 매칭). 대표 끝 이외의 **추가 end 노드**는 스킵 + warning.
- **End로 가는 엣지**: 그 노드의 유일한 outgoing이고 라벨이 비면 생략(임포트가 재생성). 라벨이 있거나 다른 next와 병존하면 생략 + warning(재임포트 시 lostEdges로 표시됨).
- **제목 중복 노드**: 그대로 내보내되 warning(재임포트가 Duplicate name 에러를 냄).
- **outgoing 1개 이하의 decision 노드**: 재임포트 시 process로 추론됨 — warning.
- start의 outgoing 대상이 "진입 엣지 없는 노드 집합(roots)"과 다르면 warning(재임포트가 start 연결을 재계산).

- [ ] **Step 1: 실패 테스트** — `csv-export.test.ts`. 핵심은 **왕복 불변**:

```ts
import { describe, expect, it } from "vitest";

import { buildGraphFromCsv } from "./csv-import";
import { buildCsvFromGraph, orderNodesByFlow } from "./csv-export";

// 템플릿급 그래프를 임포트로 만들고 → 내보내고 → 그 결과를 base 머지로 재임포트하면 변경 0
it("round-trip: export → re-import produces no changes", () => {
  const csv = [
    "Name,Description,Assignee,Department,System,Duration,Headcount,ETF,Cost,Extra,URL,URL_Label,Next",
    "A,first step,홍길동,Quality Part 1,SAP,16,1,,,,,,B",
    'B,,,,,0.30,2,,,,,,C:yes;D:no',
    "C,,,,,,,,,,https://example.com/x,Doc,",
    "D,,,,,,,,,,,,",
  ].join("\r\n");
  const first = buildGraphFromCsv(csv);
  expect(first.errors).toEqual([]);
  const graph = first.graph!;
  const { csv: exported, warnings } = buildCsvFromGraph(graph);
  expect(warnings).toEqual([]);
  const second = buildGraphFromCsv(exported, { base: graph });
  expect(second.errors).toEqual([]);
  expect(second.merge.addedNodeIds).toEqual([]);
  expect(second.merge.removedNodes).toEqual([]);
  expect(second.merge.lostEdges).toEqual([]);
});

it("따옴표·쉼표·줄바꿈 셀 이스케이프", () => {
  // description에 쉼표/따옴표를 넣은 그래프 → export → re-import에서 원문 보존 확인
});

it("추가 end 노드는 스킵하고 경고", () => {
  // end 2개짜리 그래프 → warnings에 secondary end 항목, 행 수는 그만큼 감소
});

it("라벨 있는 End행 엣지는 경고와 함께 생략", () => {
  // decision → End(label "reject") 구조 → warnings 포함
});

it("orderNodesByFlow는 start부터 흐름 순, 미도달은 sort_order 순", () => {
  // start→A→B, 고아 C(sort_order 5) → [start, A, B, C(끝에)]
});
```

(주석 자리도 실제 arrange 코드로 채워 작성 — 그래프 리터럴은 Task 2의 `_node` 스타일 헬퍼로 GraphNode를 조립하면 된다. CSV 헤더는 13컬럼.)

- [ ] **Step 2: 실패 확인** — FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `csv-export.ts`:

```ts
// CSV 내보내기 — csv-import 포맷 미러(왕복). 표현 불가 구조는 warnings로 명시.
// 설계: docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md §3
import type { Graph, GraphEdge, GraphNode } from "./api";

const HEADER = "Name,Description,Assignee,Department,System,Duration,Headcount,ETF,Cost,Extra,URL,URL_Label,Next";

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** start부터 outgoing(sort_order 순) BFS — 흐름 순. 미도달 노드는 sort_order 순으로 뒤에. */
export function orderNodesByFlow(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    (outgoing.get(e.source_node_id) ?? outgoing.set(e.source_node_id, []).get(e.source_node_id)!).push(e);
  }
  const bySort = (a: GraphNode, b: GraphNode) => a.sort_order - b.sort_order;
  const start = nodes.filter((n) => n.node_type === "start").sort(bySort)[0];
  const visited = new Set<string>();
  const ordered: GraphNode[] = [];
  const queue: string[] = start ? [start.id] : [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (node) ordered.push(node);
    const targets = (outgoing.get(id) ?? [])
      .map((e) => byId.get(e.target_node_id))
      .filter((n): n is GraphNode => n !== undefined)
      .sort(bySort);
    for (const t of targets) queue.push(t.id);
  }
  for (const node of [...nodes].sort(bySort)) {
    if (!visited.has(node.id)) ordered.push(node);
  }
  return ordered;
}

export function buildCsvFromGraph(graph: Graph): { csv: string; warnings: string[] } {
  const warnings: string[] = [];
  const nodes = orderNodesByFlow(graph.nodes, graph.edges);
  const start = nodes.find((n) => n.node_type === "start") ?? null;
  const ends = nodes.filter((n) => n.node_type === "end");
  const primaryEnd = ends.find((n) => n.is_primary_end) ?? [...ends].sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
  for (const extraEnd of ends.filter((n) => n !== primaryEnd)) {
    warnings.push(`Secondary end node "${extraEnd.title}" is not expressible in CSV — skipped`);
  }
  const rows = nodes.filter((n) => n.node_type !== "start" && n.node_type !== "end");
  const titles = new Map<string, number>();
  for (const n of rows) titles.set(n.title, (titles.get(n.title) ?? 0) + 1);
  for (const [title, count] of titles) {
    if (count > 1) warnings.push(`Duplicate title "${title}" — re-import will fail on this file`);
  }
  const rowIds = new Set(rows.map((n) => n.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const line = (node: GraphNode): string => {
    const outs = graph.edges.filter((e) => e.source_node_id === node.id);
    const parts: string[] = [];
    for (const e of outs) {
      if (primaryEnd && e.target_node_id === primaryEnd.id) {
        if (e.label !== "" || outs.length > 1) {
          warnings.push(`Edge "${node.title}" → End ${e.label ? `(label "${e.label}") ` : ""}is not expressible in CSV — dropped`);
        }
        continue; // 유일·무라벨이면 임포트가 재생성
      }
      const target = byId.get(e.target_node_id);
      if (!target || !rowIds.has(target.id)) continue;
      parts.push(e.label === "" ? target.title : `${target.title}:${e.label}`);
    }
    if (node.node_type === "decision" && parts.length < 2) {
      warnings.push(`Decision "${node.title}" has fewer than 2 branches — re-import will infer process`);
    }
    return [
      node.title, node.description, node.assignee, node.department, node.system,
      node.duration, node.headcount ?? "", node.etf ?? "", node.cost ?? "", node.extra ?? "",
      node.url ?? "", node.url_label ?? "", parts.join(";"),
    ].map(escapeCell).join(",");
  };
  if (start) {
    const startTargets = new Set(
      graph.edges.filter((e) => e.source_node_id === start.id).map((e) => e.target_node_id),
    );
    const incoming = new Set(
      graph.edges.filter((e) => e.source_node_id !== start.id).map((e) => e.target_node_id),
    );
    const roots = new Set(rows.filter((n) => !incoming.has(n.id)).map((n) => n.id));
    const same = startTargets.size === roots.size && [...startTargets].every((id) => roots.has(id));
    if (!same) warnings.push("Start connections differ from computed roots — re-import will recompute them");
  }
  return { csv: [HEADER, ...rows.map(line)].join("\r\n"), warnings };
}
```

- [ ] **Step 4: 통과 확인** — csv-export 테스트 PASS + `npx tsc --noEmit`.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/csv-export.ts frontend/src/lib/csv-export.test.ts ../PROGRESS.md
git commit -m "feat(csv): graph→CSV export mirroring import format — CSV 내보내기(왕복 보장·표현 불가 경고)"
```

---

### Task 6: Excel 모델 빌더 (순수 로직 — 재귀·순환·상한·locked)

**Files:**
- Create: `frontend/src/lib/excel-export.ts`
- Create: `frontend/src/lib/excel-export.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ExcelNodeRow {
  kind: "node";
  depth: number;                    // 0=현재 맵, 서브프로세스 인라인마다 +1
  title: string; type: string; description: string;
  assignee: string; department: string; system: string;
  duration: string; headcount: string; etf: string; cost: string; extra: string;
  url: string; urlLabel: string; groups: string;   // 그룹 라벨 ", " 조인
  next: string;                     // "대상" | "대상:라벨" ";" 조인 — End 포함(읽기용)
}
export interface ExcelNoteRow {
  kind: "circular" | "denied" | "rowLimit";
  depth: number;
  title: string;                    // 표기 문구 조립용(맵 이름 등)
}
export type ExcelRow = ExcelNodeRow | ExcelNoteRow;
export interface ExcelModel {
  mapName: string; versionLabel: string; exportedAt: string;
  rows: ExcelRow[]; truncated: boolean;
}
export const EXCEL_MAX_ROWS = 2000;
export async function buildExcelModel(args: {
  graph: Graph; mapName: string; versionLabel: string; exportedAt: string;
  fetchResolved: (mapId: number, followLatest: boolean, pinned: number | null) => Promise<Graph>;
  maxRows?: number;
}): Promise<ExcelModel>
```

- Consumes: `orderNodesByFlow` (Task 5), `Graph` 타입, `getResolvedGraph` 시그니처(api.ts:327 — `(mapId, followLatest, pinned)`)와 fetcher 형태 일치.

- [ ] **Step 1: 실패 테스트** — `excel-export.test.ts`. fetcher를 인메모리 맵으로 목킹(내부 로직 목킹 아님 — 외부 API 경계만):

```ts
import { describe, expect, it } from "vitest";

import type { Graph } from "./api";
import { buildExcelModel } from "./excel-export";

// 헬퍼: 12필드 GraphNode 리터럴 + subprocess 노드(linked_map_id) 조립
// fetchResolved: Record<number, Graph> 조회, locked 맵은 { nodes: [], edges: [], groups: [], locked: true }

it("서브프로세스를 재귀 인라인하고 depth를 매긴다", async () => {
  // 맵1: start→sub(linked 2)→end / 맵2: start→P→end
  // 기대 rows: [start,sub(depth0), start,P,end(depth1), end(depth0)] — sub 행 바로 아래 인라인
});

it("순환 참조는 재펼침 없이 circular 1행", async () => {
  // 맵1 sub→맵2, 맵2 sub→맵1 — 맵1 export 시 맵2 안의 맵1 참조는 kind:"circular"
});

it("같은 맵 2회 참조는 각각 인라인(다이아몬드), fetch는 1회(메모이즈)", async () => {
  // fetch 호출 횟수 스파이로 검증
});

it("locked 맵은 denied 1행", async () => {});

it("행 상한 초과 시 rowLimit 행과 truncated=true", async () => {
  // maxRows: 5 로 작게 줘서 검증
});

it("start/end 포함 전체 노드가 행으로 나오고 next에 End도 표기", async () => {});
```

(각 it 본문은 실제 그래프 리터럴로 채워 작성한다 — Task 5 테스트의 노드 헬퍼 스타일 재사용.)

- [ ] **Step 2: 실패 확인** — FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `excel-export.ts` (모델 파트):

```ts
// Excel 내보내기 모델 — 서브프로세스 전체 재귀 인라인(조상 검사·행 상한·locked) 순수 로직.
// exceljs 기록(다운로드)은 아래 downloadExcel — 모델과 분리해 vitest로 검증한다.
import type { Graph, GraphNode } from "./api";
import { orderNodesByFlow } from "./csv-export";

export const EXCEL_MAX_ROWS = 2000;

export async function buildExcelModel({ graph, mapName, versionLabel, exportedAt, fetchResolved, maxRows = EXCEL_MAX_ROWS }: { /* 위 인터페이스 */ }): Promise<ExcelModel> {
  const rows: ExcelRow[] = [];
  let truncated = false;
  const cache = new Map<string, Promise<Graph>>(); // key: `${mapId}:${followLatest}:${pinned}`
  const fetchMemo = (mapId: number, followLatest: boolean, pinned: number | null): Promise<Graph> => {
    const key = `${mapId}:${followLatest}:${pinned}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const p = fetchResolved(mapId, followLatest, pinned);
    cache.set(key, p);
    return p;
  };

  const emit = async (g: Graph, depth: number, ancestry: ReadonlySet<number>): Promise<void> => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const groupLabel = new Map(g.groups.map((gr) => [gr.id, gr.label]));
    for (const node of orderNodesByFlow(g.nodes, g.edges)) {
      if (rows.length >= maxRows) {
        if (!truncated) rows.push({ kind: "rowLimit", depth, title: "" });
        truncated = true;
        return;
      }
      const next = g.edges
        .filter((e) => e.source_node_id === node.id)
        .map((e) => {
          const target = byId.get(e.target_node_id);
          if (!target) return null;
          return e.label === "" ? target.title : `${target.title}:${e.label}`;
        })
        .filter((s): s is string => s !== null)
        .join(";");
      rows.push({
        kind: "node", depth,
        title: node.title, type: node.node_type, description: node.description,
        assignee: node.assignee, department: node.department, system: node.system,
        duration: node.duration, headcount: node.headcount ?? "", etf: node.etf ?? "",
        cost: node.cost ?? "", extra: node.extra ?? "",
        url: node.url ?? "", urlLabel: node.url_label ?? "",
        groups: node.group_ids.map((id) => groupLabel.get(id) ?? "").filter(Boolean).join(", "),
        next,
      });
      if (node.node_type === "subprocess" && node.linked_map_id !== null && !truncated) {
        if (ancestry.has(node.linked_map_id)) {
          rows.push({ kind: "circular", depth: depth + 1, title: node.title });
          continue;
        }
        let resolved: Graph;
        try {
          resolved = await fetchMemo(node.linked_map_id, node.follow_latest, node.linked_version_id);
        } catch {
          rows.push({ kind: "denied", depth: depth + 1, title: node.title });
          continue;
        }
        if (resolved.locked) {
          rows.push({ kind: "denied", depth: depth + 1, title: node.title });
          continue;
        }
        await emit(resolved, depth + 1, new Set([...ancestry, node.linked_map_id]));
      }
    }
  };

  await emit(graph, 0, new Set());
  return { mapName, versionLabel, exportedAt, rows, truncated };
}
```

(주의: 서브프로세스 인라인은 "sub 노드 행 바로 아래" — 위 루프 구조가 이를 보장한다. 403 등 fetch 실패도 denied로 수렴 — 내보내기 전체를 죽이지 않는다.)

- [ ] **Step 4: 통과 확인** — excel-export 테스트 PASS + `npx tsc --noEmit`.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/excel-export.ts frontend/src/lib/excel-export.test.ts ../PROGRESS.md
git commit -m "feat(excel): recursive export model with cycle guard and row cap — Excel 모델(재귀 인라인·순환·상한·locked)"
```

---

### Task 7: exceljs 기록 + 다운로드 3버튼 (PNG / Excel / CSV)

**Files:**
- Modify: `frontend/package.json` (+`exceljs` — dependencies, 정확 버전 고정은 lock 파일)
- Modify: `frontend/src/lib/excel-export.ts` (`downloadExcel` 추가)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (핸들러 2개 + 버튼, ~7784)
- Modify: `frontend/src/lib/i18n-messages.ts` (버튼·에러 키)

**Interfaces:**
- Consumes: `buildExcelModel`(Task 6), `buildCsvFromGraph`(Task 5), `getResolvedGraph`(api.ts), `buildGraph`(page.tsx 내부 — 저장 경로와 동일 소스), `formatKst`(lib/datetime)
- Produces: `downloadExcel(model: ExcelModel, fileName: string): Promise<void>`

- [ ] **Step 1: 의존성** — `cd frontend && npm install exceljs` (dependencies에 추가되는지 확인, lock 파일 커밋). 사유 주석은 계획·PROGRESS에: xlsx 셀 스타일·행 outline·수식 없는 안전 기록 지원(MIT).

- [ ] **Step 2: `downloadExcel` 구현** — `excel-export.ts`에 추가 (exceljs는 dynamic import — 에디터 번들에서 분리):

```ts
// 셀 색은 출력물이라 raw hex 허용 (design.md §1 예외 — export.ts와 동일 논리)
const HEADER_FILL = "FFF3F0FA"; // 연보라 헤더 (ARGB)
const NOTE_TEXT: Record<ExcelNoteRow["kind"], string> = {
  circular: "(circular reference)",
  denied: "(access denied)",
  rowLimit: `(row limit ${EXCEL_MAX_ROWS} reached — output truncated)`,
};
const COLUMNS = [
  { header: "No", width: 6 }, { header: "Name", width: 32 }, { header: "Type", width: 12 },
  { header: "Description", width: 44 }, { header: "Assignee", width: 16 }, { header: "Department", width: 18 },
  { header: "System", width: 14 }, { header: "Duration (h)", width: 12 }, { header: "Headcount", width: 11 },
  { header: "ETF", width: 9 }, { header: "Cost", width: 11 }, { header: "Extra", width: 9 },
  { header: "URL", width: 24 }, { header: "Groups", width: 18 }, { header: "Next", width: 32 },
];

export async function downloadExcel(model: ExcelModel, fileName: string): Promise<void> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Process Map", {
    views: [{ state: "frozen", ySplit: 4 }],
    properties: { outlineLevelRow: 1, defaultRowHeight: 16 } as never, // outline 기본
  });
  sheet.addRow([model.mapName]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([`Version: ${model.versionLabel}    Exported: ${model.exportedAt}${model.truncated ? "    (truncated)" : ""}`]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: "thin" } };
  });
  COLUMNS.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });

  let no = 0;
  for (const row of model.rows) {
    if (row.kind !== "node") {
      const r = sheet.addRow(["", NOTE_TEXT[row.kind]]);
      r.getCell(2).font = { italic: true };
      r.getCell(2).alignment = { indent: row.depth * 2 };
      r.outlineLevel = Math.min(row.depth, 7);
      continue;
    }
    no += 1;
    const num = (v: string) => (v === "" ? "" : Number(v));
    const r = sheet.addRow([
      no, row.title, row.type, row.description, row.assignee, row.department, row.system,
      num(row.duration), num(row.headcount), num(row.etf), num(row.cost), num(row.extra),
      "", row.groups, row.next,
    ]);
    r.getCell(2).alignment = { indent: row.depth * 2 };
    r.getCell(8).numFmt = "0.00"; // H.MM 표기 보존 — "1.30"이 1.3으로 뭉개지지 않게
    if (row.url) {
      r.getCell(13).value = { text: row.urlLabel || row.url, hyperlink: row.url };
      r.getCell(13).font = { color: { argb: "FF6A41FF" }, underline: true };
    }
    r.outlineLevel = Math.min(row.depth, 7); // Excel outline 한계 7
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
```

(`properties as never` 같은 어거지 캐스팅은 금지 — exceljs 실제 타입에 맞춰 옵션을 확인하고, outline 기본이 안 되면 시트 프로퍼티 없이 row.outlineLevel만으로 충분하다.)

- [ ] **Step 3: page.tsx 핸들러** — `handleExportPng`(4270) 옆에 추가. 파일명은 PNG와 동일 규칙(sanitize+stamp) 재사용 — 공용 헬퍼로 뽑아 셋이 공유:

```ts
  const buildExportFileName = useCallback((ext: string) => {
    const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
    const sanitize = (text: string) => text.replace(/[^\w가-힣.-]+/g, "-");
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    return `${sanitize(mapName)}_${sanitize(versionLabel)}_${stamp}.${ext}`;
  }, [versions, versionId, mapName]);

  const handleExportCsv = useCallback(() => {
    const graph = buildGraph(nodesRef.current, edgesRef.current, groupsRef.current); // 저장 경로와 동일 인자 — 실제 ref 이름은 기존 저장 코드에서 미러
    const { csv, warnings } = buildCsvFromGraph(graph);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildExportFileName("csv");
    anchor.click();
    URL.revokeObjectURL(url);
    if (warnings.length > 0) showToast(t("export.csvWarnings", { count: warnings.length }));
  }, [buildExportFileName, showToast, t]);

  const handleExportExcel = useCallback(async () => {
    try {
      const graph = buildGraph(nodesRef.current, edgesRef.current, groupsRef.current);
      const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
      const model = await buildExcelModel({
        graph, mapName, versionLabel,
        exportedAt: formatKst(new Date().toISOString()),
        fetchResolved: (id, follow, pinned) => getResolvedGraph(id, follow, pinned),
      });
      await downloadExcel(model, buildExportFileName("xlsx"));
      if (model.truncated) showToast(t("export.excelTruncated"));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("err.exportExcel"));
    }
  }, [versions, versionId, mapName, buildExportFileName, showToast, t]);
```

(i18n 파라미터 지원 여부는 `t` 구현을 확인 — 미지원이면 `"Exported with warnings"` 고정 문구로. ref 이름·`buildGraph` 시그니처는 기존 저장 경로 코드를 그대로 미러. React Compiler 메모 규칙 주의.)

- [ ] **Step 4: 버튼 3개** — page.tsx ~7784의 기존 PNG 버튼을 같은 스타일 3버튼 나열로 교체(설계 §5의 "드롭다운"은 인스펙터 밀도에 맞춰 나란한 3버튼으로 구현 — 클릭 1회 절약, 기존 버튼 스타일 재사용):

```tsx
<div className="flex gap-1.5">
  <button type="button" data-id="export-png" className={/* 기존 PNG 버튼 클래스 그대로 */} onClick={() => void handleExportPng()}>
    <ImageDown size={14} strokeWidth={1.5} />{t("inspector.exportPng")}
  </button>
  <button type="button" data-id="export-excel" className={/* 동일 */} onClick={() => void handleExportExcel()}>
    <FileSpreadsheet size={14} strokeWidth={1.5} />{t("inspector.exportExcel")}
  </button>
  <button type="button" data-id="export-csv" className={/* 동일 */} onClick={handleExportCsv}>
    <FileDown size={14} strokeWidth={1.5} />{t("inspector.exportCsv")}
  </button>
</div>
```

기존 PNG 버튼의 실제 클래스·아이콘을 유지하고(리팩터 시 부수 동작 보존), 라벨은 짧게: `inspector.exportPng`는 기존 키 유지, 신규 키:

```ts
  // en
  "inspector.exportExcel": "Excel",
  "inspector.exportCsv": "CSV",
  "err.exportExcel": "Failed to export Excel",
  "export.csvWarnings": "Exported with warnings — some structures are not expressible in CSV",
  "export.excelTruncated": "Row limit reached — output truncated",
  // ko
  "inspector.exportExcel": "Excel",
  "inspector.exportCsv": "CSV",
  "err.exportExcel": "Excel 내보내기에 실패했습니다",
  "export.csvWarnings": "일부 구조는 CSV로 표현되지 않아 경고와 함께 내보냈습니다",
  "export.excelTruncated": "행 상한 도달 — 출력이 잘렸습니다",
```

(PNG 버튼 라벨이 "Download PNG"였다면 3버튼 정렬을 위해 "PNG"로 줄이는 것 허용 — en/ko 동시 수정.)

- [ ] **Step 5: 게이트** — `npm run test -- --run` · `npx tsc --noEmit` · `npm run lint` · `npm run build` 전부 클린. exceljs가 번들 사이즈 경고를 내면 dynamic import가 유지되는지 확인(정적 import 금지).

- [ ] **Step 6: 커밋**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src ../PROGRESS.md
git commit -m "feat(export): xlsx writer + PNG/Excel/CSV buttons — exceljs 기록·다운로드 3버튼"
```

---

### Task 8: 통합 검증 (브라우저 실기동) + 배포 노트

**Files:**
- Create: `frontend/scripts/pw-verify-export.mjs` (Playwright + 시스템 Chrome — `docs/lessons/browser-verification.md` 선행 필독)
- Modify: `PROGRESS.md`(배포 노트), 트래커 문서 있으면 갱신

**검증 시나리오(스크립트 + 수동 확인 혼합):**
1. `python -m scripts.reset_db` 후 backend(:8000)·frontend(:3000) 네이티브 기동 (좀비 next dev 전수 pkill — lessons).
2. 에디터에서 노드 선택 → Parameters 5입력에 `0.75`/`2`/`1.5`/`300`/`7` 입력 → blur → duration이 `1.15`로 정규화되는지, 노드 카드에 아이콘+값 칩 5개가 뜨는지.
3. 새로고침 후 값 유지(저장 왕복) 확인.
4. CSV 다운로드 → 파일 열어 13컬럼 헤더·숫자값 확인 → 같은 맵에 재임포트 → 머지 프리뷰 변경 0.
5. Excel 다운로드(서브프로세스 있는 데모 맵 — 맵 2, devUser admin.sys) → 파일 열어 인라인 depth 들여쓰기·행 접기·하이퍼링크·숫자 셀 확인. (스크립트에서는 다운로드 이벤트로 파일 저장 후 `exceljs`로 다시 읽어 행 수·outlineLevel 단언 가능.)
6. 콘솔 에러 0.

- [ ] **Step 1: pw 스크립트 작성·실행** — 기존 `frontend/scripts/pw-verify-*.mjs` 스타일 미러(다운로드는 `page.waitForEvent("download")`). 실행: `node scripts/pw-verify-export.mjs` → 전 항목 PASS 출력 확인.
- [ ] **Step 2: 전체 게이트 재실행** — backend `pytest -q`+`ruff`, frontend `vitest`+`tsc --noEmit`+`lint`+`build` 전부 클린.
- [ ] **Step 3: 배포 노트** — PROGRESS.md에: 프론트/백 **동시 배포 필수**, 서버 1회 정리 SQL(선택 — validator가 경계 소거하므로 방치해도 무해):

```sql
UPDATE nodes SET duration = '' WHERE duration !~ '^[0-9]+(\.[0-9]{1,2})?$';
```

- [ ] **Step 4: 커밋**

```bash
git add frontend/scripts/pw-verify-export.mjs PROGRESS.md
git commit -m "test(export): browser verification for params + Excel/CSV export — 브라우저 실기동 검증·배포 노트"
```

---

## Self-Review 결과 반영 사항

- 스펙 §5 "드롭다운"은 인스펙터 밀도 기준 3버튼 나열로 구현(Task 7 Step 4에 사유 명시) — 스펙 문서도 머지 전 한 줄 보정할 것.
- `NodeDisplayField`에서 duration 제거(Task 3)는 저장된 사용자 설정에 잔재가 남을 수 있어 로드 시 필터를 명시했다.
- 백엔드 무효값 422 대신 `""` 소거는 from_attributes 응답 경로·레거시 폐기 결정과의 정합 때문 — Task 2 서두에 근거 기록.
- Word(.docx)는 이 계획 범위 밖(다음 세션).

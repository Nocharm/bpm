# SP 숫자 파라미터 + Σ 합산 + duration 표시형(1h30m) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SP(서브프로세스 지정) 속성을 숫자 파라미터 5종으로 확장하고, 지정 모달에 Σ(노드 합산) 버튼을 붙이고, duration의 화면 표시형을 `1h30m`으로 통일한다.

**Architecture:** 백엔드는 `process_maps`에 sp 4컬럼 추가 + 지정 페이로드/응답 경계에서 노드와 동일한 정규화·소거. 프론트는 `formatDurationHm`·`sumParamField` 순수 유틸 + 공용 `ParamInput` 컴포넌트(포커스 중 raw·블러 시 1h30m 스왑)로 3개 편집 표면(인스펙터·요약모달·지정모달)을 통일, Parameters 그룹은 접기(기본 접힘·localStorage 퍼시스트). 스펙: `docs/superpowers/specs/2026-07-11-sp-params-sum-duration-format-design.md`

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic / Next.js + TypeScript / vitest + pytest / Playwright(시스템 Chrome)

## Global Constraints

- duration 저장·편집값은 항상 H.MM(`1.30`) — **표시만** `1h30m`. 편집 중(포커스)에는 raw. **CSV는 `1.30` 고정(왕복 계약), Excel은 숫자 셀 유지** — 파일 산출물 무변경.
- `formatDurationHm`: `"1.30"`→`"1h30m"`, `"2"`→`"2h"`, `"0.30"`→`"30m"`, `"1.05"`→`"1h5m"`(분 제로패딩 없음), `"0"`→`"0h"`, 빈값/무효→`""`. 한/영 무관 고정 표기.
- Σ 합산: **게시본 그래프 직합** — subprocess 노드는 `subprocess_refs[linked_map_id]`의 sp값 사용. duration은 분 환산 합 후 H.MM 복원, etf/cost/extra는 스케일 정수 합산(최대 소수 자릿수 n, 10^n 정수 합). 빈값·무효 스킵, 기여값 0개면 `""`. headcount는 Σ 없음(입력만).
- 레거시 sp 자유텍스트는 경계 소거 — 입력(SubprocessDesignationIn)은 `""`, 응답(MapOut·SubprocessRefOut, nullable)은 `None`.
- 기존 규칙 계승: 커밋마다 PROGRESS.md 한 줄 동봉, 커밋 메시지 `type(scope): English — 한국어`, i18n en/ko 양쪽, raw hex 금지(토큰), genId()(crypto 금지), LF, `tsc --noEmit` 상시 게이트, grep은 `[mapId]` 브래킷 디렉터리 스킵(경로 직접 지정).
- 백엔드 테스트 맵 생성은 conftest 픽스처 재사용(owning_department 앵커 부서 필수). React Compiler 메모 규칙(트리비얼 핸들러는 플레인 함수).
- 프론트/백 **동시 배포 필수**(sp 4컬럼 연동).

**실행 명령 (bash, macOS 로컬):**
```bash
# backend (backend/ 에서)
.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
# frontend (frontend/ 에서)
npm run test -- --run && npx tsc --noEmit && npm run lint && npm run build
```

---

### Task 1: `formatDurationHm` + `sumParamField` 순수 유틸

**Files:**
- Modify: `frontend/src/lib/duration.ts` (formatDurationHm 추가)
- Modify: `frontend/src/lib/duration.test.ts` (케이스 추가)
- Create: `frontend/src/lib/param-sum.ts`
- Create: `frontend/src/lib/param-sum.test.ts`

**Interfaces:**
- Consumes: `normalizeDuration`(기존), `Graph`/`GraphNode`/`SubprocessRef`(api.ts — **이 태스크에서 SubprocessRef에 4필드 추가**), `ParamField`(lib/params.ts)
- Produces: `formatDurationHm(raw: string): string` / `sumParamField(graph: Graph, field: "duration" | "etf" | "cost" | "extra"): string` / api.ts `SubprocessRef`에 `headcount/etf/cost/extra: string | null` 4필드, `MapSummary`에 `sp_headcount?/sp_etf?/sp_cost?/sp_extra?: string | null`, `SubprocessDesignationBody`에 `headcount?/etf?/cost?/extra?: string`

- [ ] **Step 1: 실패 테스트 — formatDurationHm** (`duration.test.ts`에 추가)

```ts
import { formatDurationHm, normalizeDuration, normalizeNumericParam } from "./duration";

describe("formatDurationHm", () => {
  it("시+분", () => expect(formatDurationHm("1.30")).toBe("1h30m"));
  it("정수 시간", () => expect(formatDurationHm("2")).toBe("2h"));
  it("분만", () => expect(formatDurationHm("0.30")).toBe("30m"));
  it("분 제로패딩 없음", () => expect(formatDurationHm("1.05")).toBe("1h5m"));
  it("0은 0h", () => expect(formatDurationHm("0")).toBe("0h"));
  it("빈값", () => expect(formatDurationHm("")).toBe(""));
  it("무효(레거시)", () => expect(formatDurationHm("2일")).toBe(""));
  it("비정규 입력도 정규화 후 포맷", () => expect(formatDurationHm("0.75")).toBe("1h15m"));
});
```

- [ ] **Step 2: 실패 확인** — `cd frontend && npm run test -- --run src/lib/duration.test.ts` → FAIL (formatDurationHm not exported)

- [ ] **Step 3: 구현** — `duration.ts` 끝에 추가:

```ts
/** H.MM → "1h30m" 표시형(한/영 무관). 편집 중이 아닌 모든 화면 표시에 사용. 무효/빈값 → "". */
export function formatDurationHm(raw: string): string {
  const normalized = normalizeDuration(raw);
  if (normalized === null || normalized === "") return "";
  const [intPart, fracPart = ""] = normalized.split(".");
  const hours = Number.parseInt(intPart, 10);
  const minutes = fracPart === "" ? 0 : Number.parseInt(fracPart, 10);
  if (minutes === 0) return `${hours}h`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h${minutes}m`;
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS

- [ ] **Step 5: api.ts 타입 확장** — `SubprocessRef`(api.ts:127)에 `duration` 아래 4필드, `MapSummary`의 `sp_duration` 아래 4필드, `SubprocessDesignationBody`의 `duration?` 아래 4필드:

```ts
  // 숫자 파라미터 — sp 확장 (design 2026-07-11 SP)
  headcount: string | null;
  etf: string | null;
  cost: string | null;
  extra: string | null;
```
```ts
  sp_headcount?: string | null;
  sp_etf?: string | null;
  sp_cost?: string | null;
  sp_extra?: string | null;
```
```ts
  headcount?: string;
  etf?: string;
  cost?: string;
  extra?: string;
```

- [ ] **Step 6: 실패 테스트 — sumParamField** (`param-sum.test.ts` 신규)

```ts
import { describe, expect, it } from "vitest";

import type { Graph, GraphNode } from "./api";
import { sumParamField } from "./param-sum";

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id, title: id, description: "", node_type: "process", color: "",
  assignee: "", department: "", system: "", duration: "",
  pos_x: 0, pos_y: 0, sort_order: 0, group_ids: [],
  linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
  ...over,
});
const graph = (nodes: GraphNode[], refs: Graph["subprocess_refs"] = undefined): Graph =>
  ({ nodes, edges: [], groups: [], subprocess_refs: refs });

describe("sumParamField", () => {
  it("duration은 분 환산 캐리 합", () => {
    const g = graph([node("a", { duration: "0.45" }), node("b", { duration: "0.30" })]);
    expect(sumParamField(g, "duration")).toBe("1.15");
  });
  it("subprocess 노드는 subprocess_refs의 sp값 사용", () => {
    const g = graph(
      [node("a", { duration: "1" }), node("s", { node_type: "subprocess", linked_map_id: 7 })],
      { 7: { designated: true, department: null, assignee: null, system: null, duration: "0.30", url: null, url_label: null, headcount: null, etf: null, cost: null, extra: null } },
    );
    expect(sumParamField(g, "duration")).toBe("1.30");
  });
  it("십진수는 스케일 정수 합산 — 부동소수 오차 없음", () => {
    const g = graph([node("a", { cost: "0.1" }), node("b", { cost: "0.2" })]);
    expect(sumParamField(g, "cost")).toBe("0.3");
  });
  it("빈값·무효는 스킵", () => {
    const g = graph([node("a", { etf: "" }), node("b", { etf: "abc" }), node("c", { etf: "2.5" })]);
    expect(sumParamField(g, "etf")).toBe("2.5");
  });
  it("기여값 0개면 빈 문자열", () => {
    expect(sumParamField(graph([node("a")]), "extra")).toBe("");
  });
  it("ref 없는 subprocess 노드는 스킵", () => {
    const g = graph([node("s", { node_type: "subprocess", linked_map_id: 9 })]);
    expect(sumParamField(g, "duration")).toBe("");
  });
});
```

- [ ] **Step 7: 실패 확인** — FAIL (모듈 없음)

- [ ] **Step 8: 구현** — `param-sum.ts`:

```ts
// Σ 합산 — 게시본 그래프의 파라미터 직합. subprocess 노드는 링크 맵의 sp값(subprocess_refs).
// duration은 분 환산 캐리, 나머지는 스케일 정수 합산(부동소수 오차 차단). design 2026-07-11 SP §3.
import type { Graph } from "./api";
import { DURATION_PATTERN, NUMERIC_PATTERN, normalizeDuration } from "./duration";

export type SummableField = "duration" | "etf" | "cost" | "extra";

function collectValues(graph: Graph, field: SummableField): string[] {
  const values: string[] = [];
  for (const node of graph.nodes) {
    const raw =
      node.node_type === "subprocess" && node.linked_map_id !== null
        ? graph.subprocess_refs?.[node.linked_map_id]?.[field] ?? ""
        : (node[field] ?? "");
    if (raw !== "") values.push(raw);
  }
  return values;
}

/** 유효 기여값 합. 기여값 0개면 "" — 입력을 비워두는 것과 0을 구분한다. */
export function sumParamField(graph: Graph, field: SummableField): string {
  if (field === "duration") {
    let totalMinutes = 0;
    let contributed = 0;
    for (const raw of collectValues(graph, field)) {
      const normalized = normalizeDuration(raw);
      if (normalized === null || normalized === "" || !DURATION_PATTERN.test(normalized)) continue;
      const [h, mm = ""] = normalized.split(".");
      totalMinutes += Number.parseInt(h, 10) * 60 + (mm === "" ? 0 : Number.parseInt(mm, 10));
      contributed += 1;
    }
    if (contributed === 0) return "";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? String(hours) : `${hours}.${String(minutes).padStart(2, "0")}`;
  }
  const valid = collectValues(graph, field).filter((v) => NUMERIC_PATTERN.test(v));
  if (valid.length === 0) return "";
  const maxDecimals = valid.reduce((max, v) => Math.max(max, v.split(".")[1]?.length ?? 0), 0);
  const scale = 10 ** maxDecimals;
  const total = valid.reduce((sum, v) => sum + Math.round(Number(v) * scale), 0);
  const result = total / scale;
  return String(result);
}
```

- [ ] **Step 9: 통과 확인** — param-sum 테스트 PASS + 전체 vitest + `npx tsc --noEmit` 클린.

- [ ] **Step 10: 커밋**

```bash
git add frontend/src/lib/duration.ts frontend/src/lib/duration.test.ts frontend/src/lib/param-sum.ts frontend/src/lib/param-sum.test.ts frontend/src/lib/api.ts PROGRESS.md
git commit -m "feat(params): formatDurationHm + sumParamField utils — 1h30m 표시형·Σ 합산 유틸"
```

---

### Task 2: 백엔드 — sp 4컬럼 + 지정 경계 정규화 + 응답 레거시 소거

**Files:**
- Modify: `backend/app/models.py` (ProcessMap — `sp_duration` 아래 4컬럼)
- Modify: `backend/app/db.py` (`_ADDED_COLUMNS` 4항목)
- Modify: `backend/app/schemas.py` (`SubprocessDesignationIn`(line 42) 4필드+validators, `SubprocessRefOut` 4필드+duration 소거 validator, `MapOut`의 sp 4필드+sp_duration 소거 validator)
- Modify: `backend/app/routers/maps.py` (`designate_subprocess` ~559-563에 4필드 대입)
- Modify: `backend/app/subprocess.py` (`get_subprocess_refs` select 컬럼 + SubprocessRefOut 인자 4개)
- Test: `backend/tests/test_sp_params.py` (신규)

**Interfaces:**
- Consumes: `app.duration.normalize_duration`, `NUMERIC_RE` (기존)
- Produces: PUT `/maps/{id}/subprocess-designation` 페이로드에 `headcount/etf/cost/extra: str = ""` — duration 포함 5필드 경계 정규화(무효→`""`), MapOut에 `sp_headcount/sp_etf/sp_cost/sp_extra: str | None`, SubprocessRefOut에 `headcount/etf/cost/extra: str | None`, **응답 경로에서 무효 duration은 None 소거**

- [ ] **Step 1: 실패 테스트** — `test_sp_params.py`. 기존 SP 지정 테스트 파일(grep `subprocess-designation` in tests/)의 픽스처·게시 헬퍼를 미러:

```python
"""SP 숫자 파라미터 — 지정 경계 정규화·응답 레거시 소거·refs 확장."""
# conftest의 맵 생성(owning_department 앵커)·게시 헬퍼를 기존 SP 테스트와 동일하게 재사용.


def test_designation_normalizes_numeric_params(client, published_map_id):
    resp = client.put(
        f"/api/maps/{published_map_id}/subprocess-designation",
        json={"department": "Owning Anchor Division", "duration": "0.75",
              "headcount": "2", "etf": "1.5", "cost": "300", "extra": "7"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["sp_duration"] == "1.15"  # 60분 이월
    assert (body["sp_headcount"], body["sp_etf"], body["sp_cost"], body["sp_extra"]) == ("2", "1.5", "300", "7")


def test_designation_clears_invalid_values(client, published_map_id):
    resp = client.put(
        f"/api/maps/{published_map_id}/subprocess-designation",
        json={"department": "Owning Anchor Division", "duration": "2일", "headcount": "두명"},
    )
    assert resp.status_code == 200
    assert resp.json()["sp_duration"] == ""
    assert resp.json()["sp_headcount"] == ""


def test_legacy_free_text_sp_duration_cleared_in_responses(client, session, published_map_id):
    # DB에 레거시 자유텍스트를 직접 심고 응답 경계 소거 확인 (MapOut + subprocess_refs)
    # session 픽스처로 ProcessMap.sp_duration = "3일" 저장 후:
    #  - GET /api/maps/{id} → sp_duration is None
    #  - 이 맵을 링크하는 subprocess 노드가 있는 그래프 GET → subprocess_refs[id]["duration"] is None
    ...
```

(마지막 테스트의 arrange는 실제 conftest 픽스처에 맞춰 완성 — DB 직삽입은 기존 테스트에서 session 픽스처 쓰는 방식을 미러. `...` 금지, 전부 실코드로.)

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sp_params.py -q` → FAIL (unknown field)

- [ ] **Step 3: 모델·DDL** — `models.py` ProcessMap `sp_duration` 아래(기존 sp 필드와 동일하게 nullable):

```python
    # 숫자 파라미터 — sp 확장, 값은 H.MM/십진수 문자열 (design 2026-07-11 SP)
    sp_headcount: Mapped[str | None] = mapped_column(String(50), default=None)
    sp_etf: Mapped[str | None] = mapped_column(String(50), default=None)
    sp_cost: Mapped[str | None] = mapped_column(String(50), default=None)
    sp_extra: Mapped[str | None] = mapped_column(String(50), default=None)
```

`db.py` `_ADDED_COLUMNS` 끝에(nullable이라 DEFAULT 불요):

```python
    # SP 숫자 파라미터 4종 (design 2026-07-11 SP)
    ("process_maps", "sp_headcount", "VARCHAR(50)"),
    ("process_maps", "sp_etf", "VARCHAR(50)"),
    ("process_maps", "sp_cost", "VARCHAR(50)"),
    ("process_maps", "sp_extra", "VARCHAR(50)"),
```

- [ ] **Step 4: 스키마** — `SubprocessDesignationIn`에 4필드 + validators(NodeIn의 `_normalize_duration`/`_normalize_numeric_params`와 동일 소거 시맨틱):

```python
    headcount: str = Field(default="", max_length=50)
    etf: str = Field(default="", max_length=50)
    cost: str = Field(default="", max_length=50)
    extra: str = Field(default="", max_length=50)

    @field_validator("duration", mode="after")
    @classmethod
    def _normalize_duration(cls, value: str) -> str:
        # 무효(레거시 자유텍스트 포함)는 "" — 노드 duration과 동일 결정 (design 2026-07-11 SP §2)
        normalized = normalize_duration(value)
        return "" if normalized is None else normalized

    @field_validator("headcount", "etf", "cost", "extra", mode="after")
    @classmethod
    def _normalize_numeric_params(cls, value: str) -> str:
        text = value.strip()
        return text if text == "" or NUMERIC_RE.fullmatch(text) else ""
```

`SubprocessRefOut`에 4필드(`headcount: str | None = None` 등) + duration 소거 validator(nullable):

```python
    @field_validator("duration", mode="after")
    @classmethod
    def _clear_invalid_duration(cls, value: str | None) -> str | None:
        # 레거시 자유텍스트("2일")가 칩/합산을 깨지 않게 응답 경계에서 소거
        if value is None or value == "":
            return value
        return normalize_duration(value)  # 무효면 None
```

`MapOut`(sp 필드를 가진 응답 스키마 — `sp_duration` 위치를 grep으로 확인)에 `sp_headcount/sp_etf/sp_cost/sp_extra: str | None = None` 4필드 + 같은 `_clear_invalid_duration`을 `sp_duration`에.

- [ ] **Step 5: 라우터·refs** — `maps.py` `designate_subprocess`의 `found_map.sp_duration = payload.duration` 아래:

```python
    found_map.sp_headcount = payload.headcount
    found_map.sp_etf = payload.etf
    found_map.sp_cost = payload.cost
    found_map.sp_extra = payload.extra
```

`subprocess.py` `get_subprocess_refs`의 select에 `ProcessMap.sp_headcount, ProcessMap.sp_etf, ProcessMap.sp_cost, ProcessMap.sp_extra` 추가 + 행 언패킹·`SubprocessRefOut(...)` 인자에 `headcount=…, etf=…, cost=…, extra=…` 추가(기존 언패킹 스타일 미러).

- [ ] **Step 6: 통과 확인** — `pytest tests/test_sp_params.py -q` PASS → 전체 `pytest tests/ -q` PASS → `ruff check app/ tests/` 클린.

- [ ] **Step 7: 커밋**

```bash
git add backend/app backend/tests/test_sp_params.py PROGRESS.md
git commit -m "feat(sp): 4 numeric param columns + boundary normalization for designation — SP 숫자 파라미터·경계 정규화·레거시 소거"
```

---

### Task 3: 공용 `ParamInput` + 인스펙터/요약모달 리팩터 + Parameters 접기

**Files:**
- Create: `frontend/src/components/param-input.tsx`
- Modify: `frontend/src/lib/params.ts` (접기 localStorage 헬퍼)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (~7576 Parameters 블록 — ParamInput 사용 + 접기)
- Modify: `frontend/src/components/node-summary-modal.tsx` (~541 Parameters 블록 — 동일)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `normalizeDuration`/`normalizeNumericParam`/`formatDurationHm`(Task 1), `PARAM_FIELDS`/`PARAM_LABEL_KEY`/`ParamField`(기존)
- Produces:

```tsx
// param-input.tsx
export function ParamInput({ field, value, disabled, dataId, className, onCommit }: {
  field: ParamField;
  value: string;              // 항상 raw(H.MM/십진수)
  disabled?: boolean;
  dataId?: string;
  className?: string;         // 기존 지점의 input 클래스 그대로 전달
  onCommit: (next: string) => void;  // onChange(타이핑 필터 통과 시)와 blur(정규화 후) 모두 이 콜백
}): JSX.Element
```

```ts
// params.ts 추가
export const PARAMS_COLLAPSED_KEY = "bpm.paramsCollapsed";
export function readParamsCollapsed(): boolean;   // 저장값 없으면 true(기본 접힘). SSR 가드(typeof window)
export function writeParamsCollapsed(collapsed: boolean): void;
```

- [ ] **Step 1: ParamInput 구현** — 핵심: 단일 input의 focus/blur 표시 스왑. duration만 비포커스 시 `formatDurationHm(value)`, 나머지는 항상 raw:

```tsx
"use client";

// 숫자 파라미터 공용 입력 — 타이핑 필터(숫자·점) + blur 정규화 + duration 표시 스왑(포커스 중 raw, 아니면 1h30m).
// 인스펙터·노드 요약 모달·SP 지정 모달이 공유한다 (design 2026-07-11 SP §4).
import { useState } from "react";

import { formatDurationHm, normalizeDuration, normalizeNumericParam } from "@/lib/duration";
import type { ParamField } from "@/lib/params";

export function ParamInput({ field, value, disabled, dataId, className, onCommit }: {
  field: ParamField;
  value: string;
  disabled?: boolean;
  dataId?: string;
  className?: string;
  onCommit: (next: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const display = !focused && field === "duration" ? formatDurationHm(value) : value;
  return (
    <input
      data-id={dataId}
      inputMode="decimal"
      className={className}
      value={display}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        if (/^\d*\.?\d*$/.test(e.target.value)) onCommit(e.target.value);
      }}
      onBlur={(e) => {
        const raw = e.target.value.replace(/\.$/, "");
        const normalized = field === "duration" ? normalizeDuration(raw) : normalizeNumericParam(raw);
        onCommit(normalized ?? "");
        setFocused(false);
      }}
    />
  );
}
```

(주의: 비포커스 표시가 `1h30m`이어도 onFocus 직후 value(raw)로 바뀌므로 onChange 필터와 충돌 없음. blur 시 setFocused(false)는 onCommit 뒤 — 표시가 정규화된 값 기준 포맷으로 갱신된다.)

- [ ] **Step 2: 접기 헬퍼** — `params.ts`에:

```ts
export const PARAMS_COLLAPSED_KEY = "bpm.paramsCollapsed";

/** 저장값 없으면 기본 접힘(true). 직전 토글 상태는 세션 간 유지 (design 2026-07-11 SP §5). */
export function readParamsCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  const saved = window.localStorage.getItem(PARAMS_COLLAPSED_KEY);
  return saved === null ? true : saved === "1";
}

export function writeParamsCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PARAMS_COLLAPSED_KEY, collapsed ? "1" : "0");
}
```

- [ ] **Step 3: 인스펙터 블록 교체** — page.tsx ~7576의 Parameters 블록을 접기 헤더 + 인덴트 + ParamInput으로. 상태는 컴포넌트 로컬 `useState(readParamsCollapsed)` + 토글 시 `writeParamsCollapsed`:

```tsx
<div className="mt-2 border-t border-divider pt-1">
  <button
    type="button"
    data-id="inspector-params-toggle"
    aria-expanded={!paramsCollapsed}
    className="flex w-full items-center gap-1 text-fine font-semibold text-ink"
    onClick={() => {
      const next = !paramsCollapsed;
      setParamsCollapsed(next);
      writeParamsCollapsed(next);
    }}
  >
    <ChevronRight size={12} strokeWidth={1.5} className={`transition-transform duration-150 ${paramsCollapsed ? "" : "rotate-90"}`} />
    {t("inspector.parameters")}
    {filledParamCount > 0 && <span className="font-normal text-ink-tertiary">({filledParamCount})</span>}
  </button>
  {!paramsCollapsed && (
    <div className="ml-2 border-l border-divider pl-2">
      {PARAM_FIELDS.map((key) => (
        <div key={key} className="flex items-center justify-between gap-2 py-1">
          <span className="shrink-0 text-caption text-ink-secondary">{t(PARAM_LABEL_KEY[key])}</span>
          <ParamInput
            field={key}
            dataId={`inspector-param-${key}`}
            className="min-w-0 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-right text-caption text-ink hover:bg-surface-alt focus:bg-surface-alt focus:outline-none disabled:hover:bg-transparent"
            value={selectedNode.data[key] ?? ""}
            disabled={readOnly}
            onCommit={(next) => updateSelectedData({ [key]: next }, true)}
          />
        </div>
      ))}
    </div>
  )}
</div>
```

`filledParamCount = PARAM_FIELDS.filter((f) => selectedNode.data[f]).length` (렌더 시 파생 — useMemo 불요). `paramsCollapsed` state는 인스펙터 섹션 컴포넌트에 `useState(readParamsCollapsed)` — lazy initializer라 SSR 안전. 기존 인라인 입력(타이핑 필터·blur 정규화)은 ParamInput으로 대체되므로 중복 로직 제거.

- [ ] **Step 4: 요약 모달 동일 적용** — node-summary-modal.tsx ~541 블록을 같은 패턴(접기 + ParamInput)으로. 같은 `PARAMS_COLLAPSED_KEY` 공유(인스펙터와 토글 상태 연동). form state 커밋은 기존 `setForm` 경로 유지.

- [ ] **Step 5: i18n** — 신규 키 없음 확인(`inspector.parameters` 재사용, 개수는 문자열 조합). ChevronRight lucide 임포트.

- [ ] **Step 6: 게이트** — `npm run test -- --run`·`npx tsc --noEmit`·`npm run lint`·`npm run build` 클린. React Compiler: 토글 핸들러는 인라인 플레인 함수(useCallback 금지).

- [ ] **Step 7: 커밋**

```bash
git add frontend/src ../PROGRESS.md
git commit -m "feat(params): shared ParamInput + collapsible Parameters group — 공용 파라미터 입력·접기(기본 접힘·localStorage)"
```

---

### Task 4: SP 지정 모달 — 숫자 5종 입력 + Σ 합산 버튼

**Files:**
- Modify: `frontend/src/components/permissions/subprocess-designation-modal.tsx` (duration 자유입력 → 5종 + Σ)
- Modify: `frontend/src/lib/i18n-messages.ts` (Σ 키)

**Interfaces:**
- Consumes: `ParamInput`(Task 3), `sumParamField`/`SummableField`(Task 1), `getGraph`(api.ts:374), `DesignationForm`·`putSubprocessDesignation`(기존 — body에 4필드는 Task 1에서 타입 확장됨)
- Produces: `DesignationForm`에 `headcount/etf/cost/extra: string` 4필드 — **호출측 3곳(subprocess-inspector-card.tsx:34·67, subprocess-designation-panel.tsx:33·92)의 initial 조립에 4필드 추가 필요(Task 5에서 수행)** — 이 태스크에서는 modal 내부와 DesignationForm 타입만. tsc가 호출측 누락을 드러내므로 이 태스크에서 initial 조립도 함께 고친다(4필드 `detail.sp_headcount ?? ""` 식).

- [ ] **Step 1: DesignationForm 확장 + duration 입력 교체** — 모달의 기존 duration `<input>`(line 98-107)을 제거하고 5종 블록으로:

```tsx
{PARAM_FIELDS.map((key) => (
  <div key={key} className="flex items-center justify-between gap-2 border-t border-divider py-1">
    <span className="shrink-0 text-caption text-ink-secondary">{t(PARAM_LABEL_KEY[key])}</span>
    <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
      <ParamInput
        field={key}
        dataId={`subprocess-designation-${key}`}
        className={`${INPUT_CLASS} min-w-0 flex-1 text-right`}
        value={form[key]}
        onCommit={(next) => setForm((prev) => ({ ...prev, [key]: next }))}
      />
      {key !== "headcount" && (
        <button
          type="button"
          data-id={`subprocess-designation-sum-${key}`}
          title={publishedVersionId === null ? t("sp.sumNeedsPublished") : t("sp.sumAllNodes")}
          aria-label={t("sp.sumAllNodes")}
          disabled={publishedVersionId === null || summing}
          className="shrink-0 rounded-sm border border-hairline px-1.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
          onClick={() => void handleSum(key as SummableField)}
        >
          <Sigma size={14} strokeWidth={1.5} />
        </button>
      )}
    </div>
  </div>
))}
```

- [ ] **Step 2: Σ 핸들러** — 게시본 그래프는 1회 fetch 후 재사용(모달 수명 캐시):

```tsx
const graphRef = useRef<Graph | null>(null);
const [summing, setSumming] = useState(false);

async function handleSum(field: SummableField) {
  if (publishedVersionId === null) return;
  setSumming(true);
  setError(null);
  try {
    if (graphRef.current === null) graphRef.current = await getGraph(publishedVersionId);
    const total = sumParamField(graphRef.current, field);
    setForm((prev) => ({ ...prev, [field]: total }));
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setSumming(false);
  }
}
```

`handleSave`의 body에 4필드 추가(`headcount: form.headcount` 등). `DesignationForm`에 4필드 추가 + 호출측 2파일의 initial 조립(`duration: detail.sp_duration ?? ""` 옆에 4개 미러 — subprocess-inspector-card.tsx:34-38·67-75, subprocess-designation-panel.tsx:33-37·92)도 이 태스크에서 함께(tsc 강제).

- [ ] **Step 3: i18n 키** — en/ko:

```ts
  // en
  "sp.sumAllNodes": "Sum all nodes (published version)",
  "sp.sumNeedsPublished": "Requires a published version",
  // ko
  "sp.sumAllNodes": "전체 노드 합산(게시본 기준)",
  "sp.sumNeedsPublished": "게시본이 필요합니다",
```

lucide `Sigma` 임포트.

- [ ] **Step 4: 게이트** — vitest 전체·tsc·lint·build 클린.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src ../PROGRESS.md
git commit -m "feat(sp): numeric param inputs + sigma sum button in designation modal — 지정 모달 숫자 5종·Σ 합산"
```

---

### Task 5: SP 표시 전면 — 칩 5종·1h30m 적용·읽기 표면

**Files:**
- Modify: `frontend/src/lib/canvas.ts` (NodeData에 `spHeadcount?/spEtf?/spCost?/spExtra?: string | null`)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (~1167 `spDuration: ref.duration` 옆 4필드 매핑, ~7636 sp 읽기 블록에 파라미터 4행 추가 + duration 포맷)
- Modify: `frontend/src/components/process-node.tsx` (NodeParams — subprocess 분기 5종 + duration 칩 `formatDurationHm`)
- Modify: `frontend/src/components/subprocess-inspector-card.tsx` (표시 리스트 duration 포맷 + 4행)
- Modify: `frontend/src/components/permissions/subprocess-designation-panel.tsx` (표시 리스트 동일)
- Modify: `frontend/src/app/maps/[mapId]/compare/page.tsx` (fieldsOf(472-479)·목록(624-632)·사이드패널(1163-1171)의 duration 값 포맷)

**Interfaces:**
- Consumes: `formatDurationHm`(Task 1), `SubprocessRef` 4필드(Task 1), NodeParams 기존 구조
- Produces: 없음(표시 전용 — 후속 태스크 의존 없음)

- [ ] **Step 1: NodeData·매핑** — canvas.ts NodeData의 `spUrlLabel` 근처에 4필드 추가. page.tsx ~1167(`spDuration: ref.duration,`) 옆에:

```ts
          spHeadcount: ref.headcount,
          spEtf: ref.etf,
          spCost: ref.cost,
          spExtra: ref.extra,
```

- [ ] **Step 2: NodeParams 확장** — process-node.tsx의 subprocess 분기와 duration 포맷(주석도 갱신 — "sp_duration 자유텍스트 무변경" 문구 제거):

```tsx
  const values: Partial<Record<ParamField, string | null | undefined>> = isSubprocess
    ? { duration: data.spDuration, headcount: data.spHeadcount, etf: data.spEtf, cost: data.spCost, extra: data.spExtra }
    : { duration: data.duration, headcount: data.headcount, etf: data.etf, cost: data.cost, extra: data.extra };
```

칩 렌더에서 duration만 포맷: `{f === "duration" ? formatDurationHm(values[f] ?? "") : values[f]}` — formatDurationHm이 무효를 ""로 만들므로 filled 판정도 duration은 포맷 결과 기준으로(레거시 텍스트 칩 방지, 단 백엔드 소거로 실제로는 도달 않음 — 방어).

- [ ] **Step 3: 읽기 표면들** — 아래 각 지점에서 duration 표시를 `formatDurationHm(...)`로, 파라미터 4행 추가(값 있는 것만 표시하는 기존 스타일 유지):
  - subprocess-inspector-card.tsx:96 `{ label: t("field.duration"), value: detail.sp_duration }` → `value: formatDurationHm(detail.sp_duration ?? "")` + 그 아래 4항목(`field.headcount` 등, `detail.sp_headcount` 등).
  - subprocess-designation-panel.tsx:118 동일 패턴.
  - page.tsx ~7636 `inspector-subprocess-attrs` 블록: 기존 `["department","assignee","system","duration"]` 리스트에 4키 추가 + duration 값만 포맷(이 블록은 sp값 표시 — `selectedSpRef` 소스 확인 후 duration에 `formatDurationHm` 적용).
- [ ] **Step 4: 비교 화면 포맷** — compare/page.tsx 3곳에서 duration 필드 값 포맷. 공통 헬퍼를 파일 상단에:

```ts
const displayFieldValue = (field: ChangedField, value: string): string =>
  field === "duration" ? formatDurationHm(value) || value : value;
```

`fc.before || t("summary.none")` → `displayFieldValue(fc.field, fc.before) || t("summary.none")` (3곳 동일). 사이드패널의 `current`(1164)도 duration 키일 때 포맷. (`|| value` 폴백: 만에 하나 무효 레거시 값이면 원문 노출 — 빈 표시보다 진단 가능.)

- [ ] **Step 5: 게이트** — vitest 전체·tsc·lint·build 클린.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src ../PROGRESS.md
git commit -m "feat(sp): 5-param chips + 1h30m rendering across read surfaces — SP 칩 5종·1h30m 표시 전면 적용"
```

---

### Task 6: 브라우저 실기동 검증 + 배포 노트

**Files:**
- Create: `frontend/scripts/pw-verify-sp-params.mjs` (기존 `pw-verify-export.mjs` 부트스트랩 미러 — devUser admin.sys·api 헬퍼·rid()·frontend/에서 실행)
- Modify: `PROGRESS.md` (검증 결과 + 배포 노트)

**검증 시나리오(스크립트):**
1. reset_db + 서버 기동(:8000/:3000, 좀비 pkill — `docs/lessons/browser-verification.md` 필독).
2. 스크래치 맵 A 생성(노드 duration 0.45/0.30, cost 0.1/0.2) → 게시(기존 pw 스크립트의 게시 절차 미러 — 없으면 API로 submit/approve/publish 체인, 기존 테스트·스크립트에서 절차 확인) → 맵 설정에서 SP 지정 모달 열기.
3. 모달: 5입력 존재 + Σ 버튼 4개(headcount 없음) 확인 → Σ(duration) 클릭 → 입력값 `1.15` 채워짐 → Σ(cost) → `0.3` → 저장 → 200.
4. 미게시 스크래치 맵 B에서 모달 열면 Σ disabled 확인.
5. 맵 C에 맵 A를 링크(subprocess 노드) → 노드 칩에 sp 5종 중 값 있는 것 표시 + duration이 `1h15m` 표기 확인.
6. 에디터 인스펙터: Parameters 그룹 기본 접힘(`inspector-params-toggle` aria-expanded=false) → 펼침 → duration `1.30` 입력 후 blur → 표시 `1h30m` → 포커스 → `1.30` 복원 확인 → 새로고침 후 펼침 상태 유지(localStorage).
7. 콘솔 에러 0.

- [ ] **Step 1: 스크립트 작성·실행** — `node scripts/pw-verify-sp-params.mjs` 전 항목 PASS(실패 항목은 원인 포함 보고). 다운로드 없음이라 acceptDownloads 불요.
- [ ] **Step 2: 전체 게이트 재실행** — backend pytest+ruff, frontend vitest+tsc+lint+build 수치 보고.
- [ ] **Step 3: 배포 노트** — PROGRESS.md: 프론트/백 동시 배포 필수(sp 4컬럼), 컬럼 자동 보강, 레거시 sp 자유텍스트는 응답 경계 소거(물리 정리 SQL 선택: `UPDATE process_maps SET sp_duration = NULL WHERE sp_duration IS NOT NULL AND sp_duration !~ '^[0-9]+(\.[0-9]{1,2})?$';`).
- [ ] **Step 4: 커밋**

```bash
git add frontend/scripts/pw-verify-sp-params.mjs PROGRESS.md
git commit -m "test(sp): browser verification for SP params + sum + 1h30m — SP 파라미터·Σ·표시형 실기동 검증"
```

---

## Self-Review 반영

- 스펙 §3 "Σ는 값을 채울 뿐 저장은 Save" — Task 4 Step 2가 setForm만 수행 ✓. 게시본 fetch는 모달 수명 1회 캐시.
- 스펙 §5 localStorage 퍼시스트 — Task 3 Step 2 헬퍼 + 요약모달과 키 공유 ✓. SP 모달은 접기 없음(Task 4에 접기 미적용) ✓.
- 스펙 §4 파일 산출물 예외 — CSV/Excel 로직 무변경(어느 태스크도 csv-export/excel-export 미수정) ✓.
- Task 4의 DesignationForm 확장이 호출측 2파일을 깨뜨리는 파급은 같은 태스크에서 처리(tsc 강제) — Task 5와 중복 수정 없음(5는 표시 리스트만).
- Word 미머지 브랜치와의 표현형 정합은 머지 시점 확인 사항으로 스펙 §6에 이미 기록 — 이 계획 범위 밖.

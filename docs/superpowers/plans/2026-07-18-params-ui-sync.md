# Params UI Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6필드 파라미터 모델(0494f57)에 미반영으로 남은 세 표면을 동기화한다 — ① 그룹 일괄 편집에 파라미터 6필드 전부(+SP는 annual_count·fte 허용), ② 캔버스 파라미터 칩을 맵 탭 "노드 표시 정보"의 통합 토글 1개("Parameters", 기본 ON)로 제어, ③ 구 필드(etf/cost/extra)를 쓰는 stale 검증 스크립트 2개 갱신.

**Architecture:** 순수 로직(모드별 대상 판정·비용 배타 패치·토글 이관)은 lib에 추출해 vitest로 TDD. UI는 기존 컴포넌트(group-bulk-modal.tsx, process-node.tsx, page.tsx)를 최소 수정. 표시 토글은 localStorage 키를 v2로 올려 레거시 저장값을 "params ON"으로 이관(레거시 배열엔 params가 없어 기존 사용자 칩이 꺼져버리는 문제 방지).

**Tech Stack:** Next.js/TS + vitest, Playwright(playwright-core + 시스템 Chrome) 검증 스크립트.

## Global Constraints

- 작업 경로: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/params-ui-sync` (브랜치 `worktree-params-ui-sync`, dev 기준). **git checkout/branch 전환 금지.** 모든 명령 전 `pwd` 확인.
- 워크트리에 `frontend/node_modules` 없음 → 최초 1회 APFS 클론: `cp -Rc /Users/hyeonjin/Documents/bpm/frontend/node_modules /Users/hyeonjin/Documents/bpm/.claude/worktrees/params-ui-sync/frontend/node_modules` (심링크는 turbopack이 거부 — 선례).
- 파라미터 단일 소스는 `frontend/src/lib/params.ts`(`PARAM_FIELDS`·`getEditableParamFields`·`formatParamValue`·`PARAM_LABEL_KEY`) — 필드명·순서·라벨을 재정의하지 않는다.
- 비용 배타 불변식: 한 노드에 `cost_krw`·`cost_usd` 동시 존재 금지(백엔드 422). 새 병합/패치 경로는 반드시 반대 통화 소거 규칙을 태운다.
- React Compiler 린트: `useCallback`/`useMemo` deps 불일치 = 빌드 실패. effect 내 동기 setState는 기존 패턴대로 `// eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration` 주석.
- UI 영어 기본, Lucide size 12~16/strokeWidth 1.5, raw hex 금지(토큰만), 컴팩트 밀도.
- 게이트: `npm run lint` · `npx tsc --noEmit` · `npm run test` · `npm run build` (vitest·build는 테스트 파일 타입 에러를 못 잡음 — tsc 필수).
- 커밋: `type(scope): English summary — 한국어 요약`, **PROGRESS.md 갱신을 같은 커밋에 포함.**
- `grep`은 ugrep이라 브래킷 디렉터리(`[mapId]`) 재귀를 조용히 건너뜀 — page.tsx 검색은 파일 직접 지정.

---

### Task 1: lib/bulk-params.ts — 일괄 편집 파라미터 규칙 (TDD)

**Files:**
- Create: `frontend/src/lib/bulk-params.ts`
- Test: `frontend/src/lib/bulk-params.test.ts`

**Interfaces:**
- Produces: `isBulkParamField(field): field is ParamField`, `canBulkEditField(nodeType, field): boolean`, `buildBulkAttrPatch(field, value): Record<string, string>` — Task 4에서 modal·page.tsx가 소비.

- [ ] **Step 1: 실패하는 테스트 작성** — `frontend/src/lib/bulk-params.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { buildBulkAttrPatch, canBulkEditField, isBulkParamField } from "./bulk-params";

describe("canBulkEditField", () => {
  it("people/system은 process·decision만", () => {
    expect(canBulkEditField("process", "people")).toBe(true);
    expect(canBulkEditField("decision", "system")).toBe(true);
    expect(canBulkEditField("subprocess", "people")).toBe(false);
    expect(canBulkEditField("start", "system")).toBe(false);
  });
  it("subprocess는 annual_count·fte만 파라미터 일괄 대상", () => {
    expect(canBulkEditField("subprocess", "annual_count")).toBe(true);
    expect(canBulkEditField("subprocess", "fte")).toBe(true);
    expect(canBulkEditField("subprocess", "duration")).toBe(false);
    expect(canBulkEditField("subprocess", "cost_krw")).toBe(false);
  });
  it("process는 6필드 전부, start/end는 없음", () => {
    expect(canBulkEditField("process", "cost_usd")).toBe(true);
    expect(canBulkEditField("end", "fte")).toBe(false);
  });
});

describe("buildBulkAttrPatch", () => {
  it("비용 설정은 반대 통화를 명시적으로 비운다", () => {
    expect(buildBulkAttrPatch("cost_krw", "5000")).toEqual({ cost_krw: "5000", cost_usd: "" });
    expect(buildBulkAttrPatch("cost_usd", "10")).toEqual({ cost_usd: "10", cost_krw: "" });
  });
  it("비용 비우기는 양쪽 통화를 함께 비운다", () => {
    expect(buildBulkAttrPatch("cost_krw", "")).toEqual({ cost_krw: "", cost_usd: "" });
    expect(buildBulkAttrPatch("cost_usd", "")).toEqual({ cost_krw: "", cost_usd: "" });
  });
  it("비용 외 필드는 단일 필드 패치", () => {
    expect(buildBulkAttrPatch("system", "SAP")).toEqual({ system: "SAP" });
    expect(buildBulkAttrPatch("duration", "1.15")).toEqual({ duration: "1.15" });
  });
});

describe("isBulkParamField", () => {
  it("system만 false", () => {
    expect(isBulkParamField("system")).toBe(false);
    expect(isBulkParamField("duration")).toBe(true);
    expect(isBulkParamField("fte")).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd frontend && npx vitest run src/lib/bulk-params.test.ts` → FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `frontend/src/lib/bulk-params.ts`

```ts
// 그룹 일괄 편집의 파라미터 규칙 — 모드별 대상 노드 판정·비용 배타 패치 (group-bulk-modal 전용)
import { hasBpmAttributes } from "./canvas";
import { getEditableParamFields, PARAM_FIELDS, type ParamField } from "./params";

export function isBulkParamField(field: "system" | ParamField): field is ParamField {
  return (PARAM_FIELDS as readonly string[]).includes(field);
}

/** 모드별 일괄 편집 대상 — people/system은 BPM 속성 노드만, 파라미터는 노드 타입별 편집 가능 집합(SP는 annual_count·fte). */
export function canBulkEditField(
  nodeType: string,
  field: "people" | "system" | ParamField,
): boolean {
  if (field === "people" || field === "system") return hasBpmAttributes(nodeType);
  return (getEditableParamFields(nodeType) as readonly string[]).includes(field);
}

/** 비용 배타 — 설정 시 반대 통화 명시적 소거, 비우기는 양쪽 소거(노드의 비용은 하나라는 불변식 유지). */
export function buildBulkAttrPatch(
  field: "system" | ParamField,
  value: string,
): Record<string, string> {
  if (field === "cost_krw" || field === "cost_usd") {
    if (value === "") return { cost_krw: "", cost_usd: "" };
    return field === "cost_krw"
      ? { cost_krw: value, cost_usd: "" }
      : { cost_usd: value, cost_krw: "" };
  }
  return { [field]: value };
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/bulk-params.test.ts` → PASS
- [ ] **Step 5: 커밋** — PROGRESS.md 한 줄 추가 후 `git add frontend/src/lib/bulk-params.ts frontend/src/lib/bulk-params.test.ts PROGRESS.md && git commit -m "feat(bulk): add param eligibility and cost-exclusive patch rules — 일괄 편집 파라미터 규칙 lib 추출"`

### Task 2: node-actions.ts — params 토글 타입 + 저장값 이관 (TDD)

**Files:**
- Modify: `frontend/src/lib/node-actions.ts`
- Test: `frontend/src/lib/node-actions.test.ts` (신규)

**Interfaces:**
- Produces: `type NodeDisplayToggle = NodeDisplayField | "params"`, `NODE_DISPLAY_TOGGLES`, `parseDisplayToggles(v2, legacy): NodeDisplayToggle[] | null`. `NodeActions.displayFields`가 `NodeDisplayToggle[]`로 넓어짐(Task 3·4가 소비).

- [ ] **Step 1: 실패하는 테스트** — `frontend/src/lib/node-actions.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { NODE_DISPLAY_TOGGLES, parseDisplayToggles } from "./node-actions";

describe("parseDisplayToggles", () => {
  it("v2 저장값이 있으면 그대로(유효 필드만)", () => {
    expect(parseDisplayToggles('["assignee","params"]', null)).toEqual(["assignee", "params"]);
    expect(parseDisplayToggles('["assignee","bogus"]', '["system"]')).toEqual(["assignee"]);
  });
  it("v2에서 params를 끈 상태를 존중한다", () => {
    expect(parseDisplayToggles('["assignee"]', null)).toEqual(["assignee"]);
  });
  it("레거시 저장값만 있으면 params를 켜서 이관(칩은 항상 표시였음)", () => {
    expect(parseDisplayToggles(null, '["assignee","url"]')).toEqual(["assignee", "url", "params"]);
    expect(parseDisplayToggles(null, '["duration"]')).toEqual(["params"]); // 폐기 필드 필터
  });
  it("둘 다 없거나 파싱 불가면 null(기본값 유지)", () => {
    expect(parseDisplayToggles(null, null)).toBeNull();
    expect(parseDisplayToggles("not json", null)).toBeNull();
  });
});

it("NODE_DISPLAY_TOGGLES는 4속성 + params", () => {
  expect(NODE_DISPLAY_TOGGLES).toEqual(["assignee", "department", "system", "url", "params"]);
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/node-actions.test.ts` → FAIL
- [ ] **Step 3: 구현** — `node-actions.ts`에 추가/수정:

```ts
// 토글 대상 = BPM 속성 4종 + 파라미터 칩 일괄 스위치("params" — 6필드 칩을 한 번에 켬/끔)
export type NodeDisplayToggle = NodeDisplayField | "params";

export const NODE_DISPLAY_TOGGLES: NodeDisplayToggle[] = [...NODE_DISPLAY_FIELDS, "params"];

/** 저장 토글 파싱 — v2 키 우선, 레거시 키(파라미터 토글 도입 전)는 params ON으로 이관. 저장값 없으면 null. */
export function parseDisplayToggles(
  v2: string | null,
  legacy: string | null,
): NodeDisplayToggle[] | null {
  const parse = (raw: string | null): string[] | null => {
    if (!raw) return null;
    try {
      const arr: unknown = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((f): f is string => typeof f === "string") : null;
    } catch {
      return null;
    }
  };
  const valid = (arr: string[]): NodeDisplayToggle[] =>
    arr.filter((f): f is NodeDisplayToggle =>
      (NODE_DISPLAY_TOGGLES as readonly string[]).includes(f),
    );
  const fromV2 = parse(v2);
  if (fromV2 !== null) return valid(fromV2);
  const fromLegacy = parse(legacy);
  if (fromLegacy !== null) return Array.from(new Set([...valid(fromLegacy), "params"]));
  return null;
}
```

그리고 `NodeActions.displayFields: NodeDisplayField[]` → `NodeDisplayToggle[]`, `defaultActions.displayFields: ["assignee"]` → `["assignee", "params"]` (Provider 없는 임베드·링크 프리뷰에서 칩 항상 표시였던 기존 동작 보존).

- [ ] **Step 4: 통과 + 전체 영향 확인** — `npx vitest run src/lib/node-actions.test.ts` PASS, `npx tsc --noEmit`은 Task 3 완료 전까지 실패할 수 있음(다음 태스크에서 해소).
- [ ] **Step 5: 커밋은 Task 3과 함께** (타입 넓힘이 소비처 수정과 한 컴파일 단위).

### Task 3: process-node.tsx 칩 게이팅 + provider 기본값 스윕

**Files:**
- Modify: `frontend/src/components/process-node.tsx` (NodeFields :54-89, NodeParams :98-138)
- Modify: `frontend/src/app/maps/[mapId]/compare/page.tsx:150-159` (`COMPARE_NODE_ACTIONS`)
- Sweep: `displayFields:`를 주입하는 다른 NodeActions 생성처 전부 (`grep -rn "displayFields" frontend/src --include='*.tsx' --include='*.ts'` + page.tsx는 파일 직접 grep)

**Interfaces:**
- Consumes: `NodeDisplayToggle` (Task 2).

- [ ] **Step 1: NodeFields — params 토글을 속성 줄 루프에서 제외**

```tsx
{displayFields
  .filter((f): f is NodeDisplayField => f !== "params")
  .map((field) => {
    ...기존 본문 유지...
  })}
```

- [ ] **Step 2: NodeParams — 토글 OFF면 렌더 안 함** (훅은 무조건 최상단)

```tsx
function NodeParams({ data, className }: { data: AppNode["data"]; className?: string }) {
  const { displayFields } = useNodeActions();
  const isSubprocess = data.nodeType === "subprocess";
  if (!displayFields.includes("params")) return null;
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  ...이하 기존 유지...
```

- [ ] **Step 3: compare 뷰 칩 보존** — `COMPARE_NODE_ACTIONS.displayFields: []` → `["params"]` (비교뷰는 BPM 줄만 숨기고 칩은 기존처럼 표시 — 회귀 방지). 주석도 한 줄 갱신.
- [ ] **Step 4: 스윕** — 그 외 `displayFields:` 리터럴 주입처가 있으면 동일 원칙(칩 기존 동작 보존)으로 조정. Provider 미사용 표면(링크 프리뷰 등)은 defaultActions가 params 포함이라 무변경.
- [ ] **Step 5: 게이트** — `npx tsc --noEmit` 0 에러 (page.tsx의 `NodeDisplayField[]` state는 `NodeDisplayToggle[]`에 대입 가능이라 통과 예상), `npx vitest run` 그린.
- [ ] **Step 6: 커밋** — Task 2+3 함께, PROGRESS.md 포함: `feat(canvas): gate param chips behind unified display toggle — 파라미터 칩 통합 토글 게이팅(+저장값 v2 이관)`

### Task 4: page.tsx — 토글 state v2 + 맵 탭 스위치 행 + i18n

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:6061-6082` (state·hydration·persist), `:6096-6100`(toggleDisplayField 타입), `:8452-8486`(맵 탭 스위치 루프)
- Modify: `frontend/src/lib/i18n-messages.ts` — EN/KO 양쪽에 `"field.params"` 추가 (`"field.url"` 정의 인접)

- [ ] **Step 1: state 타입·기본값** — `useState<NodeDisplayToggle[]>(["assignee", "params"])` (import를 `NODE_DISPLAY_TOGGLES`·`NodeDisplayToggle`·`parseDisplayToggles`로 갱신, `NODE_DISPLAY_FIELDS` import는 사용처가 없어지면 제거)
- [ ] **Step 2: hydration을 v2+이관으로 교체** (기존 :6063-6078 대체)

```ts
useEffect(() => {
  const saved = parseDisplayToggles(
    window.localStorage.getItem("bpm.nodeDisplayFields.v2"),
    window.localStorage.getItem("bpm.nodeDisplayFields"),
  );
  if (saved !== null) {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration
    setDisplayFields(saved);
  }
}, []);
```

영속(:6080-6082)은 키만 `"bpm.nodeDisplayFields.v2"`로. 레거시 키는 그대로 둔다(삭제 안 함).
- [ ] **Step 3: toggleDisplayField 파라미터 타입** — `(field: NodeDisplayToggle)`.
- [ ] **Step 4: 맵 탭 스위치 루프** — `NODE_DISPLAY_TOGGLES.map(...)`, labelKey 체인에 `: field === "url" ? "field.url" : "field.params"` 분기 추가.
- [ ] **Step 5: i18n** — EN `"field.params": "Parameters"`, KO `"field.params": "파라미터"`.
- [ ] **Step 6: 게이트** — `npm run lint` + `npx tsc --noEmit` 0 에러.
- [ ] **Step 7: 커밋** — `feat(editor): add Parameters switch to node display card — 맵 탭 노드 표시 정보에 파라미터 토글(기본 ON·레거시 이관)` + PROGRESS.md.

### Task 5: group-bulk-modal 6필드 모드 + page.tsx 배선

**Files:**
- Modify: `frontend/src/components/group-bulk-modal.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:3728-3746`(applyGroupAttribute), `:7882-7892`(BulkMember 매핑)

**Interfaces:**
- Consumes: Task 1의 `isBulkParamField`·`canBulkEditField`·`buildBulkAttrPatch`, params.ts의 `PARAM_FIELDS`·`PARAM_LABEL_KEY`·`formatParamValue`.
- Produces: `BulkAttrField = "system" | ParamField` (page.tsx가 import).

- [ ] **Step 1: 타입·모드 메타 확장** (group-bulk-modal.tsx :35-49 대체)

```ts
// "people" = 부서+담당자 결합 모드; 나머지는 단일 필드 모드(system + 파라미터 6종)
export type BulkAttrField = "system" | ParamField;
export type BulkMode = "people" | BulkAttrField;
```

```ts
// 캔버스 칩(process-node PARAM_ICON)과 동일한 아이콘 매핑 — 탭에서 같은 시각 언어 유지
const PARAM_MODE_ICON: Record<ParamField, LucideIcon> = {
  duration: Clock, cost_krw: Coins, cost_usd: Coins, headcount: Users, annual_count: Tag, fte: Target,
};
const MODE_META: { key: BulkMode; icon: LucideIcon; labelKey: MessageKey }[] = [
  { key: "people", icon: Users, labelKey: "bulk.modePeople" },
  { key: "system", icon: Server, labelKey: "field.system" },
  ...PARAM_FIELDS.map((f) => ({ key: f, icon: PARAM_MODE_ICON[f], labelKey: PARAM_LABEL_KEY[f] })),
];
```

import 추가: `Coins, Tag, Target` (lucide), `PARAM_FIELDS, PARAM_LABEL_KEY, formatParamValue, type ParamField` (`@/lib/params`), `buildBulkAttrPatch 제외한 isBulkParamField, canBulkEditField` (`@/lib/bulk-params`). `formatDurationHm`·`hasBpmAttributes` import는 대체 후 미사용이면 제거.

- [ ] **Step 2: BulkMember 6필드 + 모드별 멤버십** — `BulkMember`에 `cost_krw/cost_usd/headcount/annual_count/fte: string` 추가. `:105-108`의 고정 필터를 모드 의존으로 교체(attrField 선언을 위로 이동):

```ts
const attrField = mode !== "people" ? (mode as BulkAttrField) : null;
// 모드별 대상 — people/system은 BPM 속성 노드, 파라미터는 타입별 편집 가능 집합(SP는 annual_count·fte 포함)
const members = allMembers.filter((m) =>
  canBulkEditField(m.nodeType, attrField ?? "people"),
);
const excludedMembers = allMembers.filter((m) => !canBulkEditField(m.nodeType, attrField ?? "people"));
```

- [ ] **Step 3: 표시·기존값·충돌 규칙** — `displayAttrValue`(:64-66)를 파라미터 일반형으로:

```ts
// 파라미터는 표시형(1h30m·통화기호), system은 원문. 무효 레거시 값은 원문 폴백.
const displayAttrValue = (field: BulkAttrField, raw: string): string =>
  isBulkParamField(field) ? formatParamValue(field, raw) || raw : raw;
// 비용 모드는 어느 통화든 기존 값으로 취급(배타 불변식상 노드의 비용은 하나) — 통화 전환도 충돌로 노출
const existingRaw = (m: BulkMember, field: BulkAttrField): string =>
  field === "cost_krw" || field === "cost_usd"
    ? (m.cost_krw.trim() !== "" ? m.cost_krw : m.cost_usd)
    : m[field];
const existingDisplay = (m: BulkMember, field: BulkAttrField): string => {
  if (field === "cost_krw" || field === "cost_usd") {
    const holder = m.cost_krw.trim() !== "" ? "cost_krw" : "cost_usd";
    return formatParamValue(holder, m[holder]) || m[holder];
  }
  return displayAttrValue(field, m[field]);
};
```

충돌 판정(:195-197): `m[attrField]` 직접 참조를 `existingRaw`로:

```ts
const attrConflicts = attrField
  ? members.filter(
      (m) => existingRaw(m, attrField).trim() !== "" && m[attrField].trim() !== value.trim(),
    )
  : [];
```

- [ ] **Step 4: append 정책 봉인(파라미터 전 필드)** — 숫자에 콤마 append는 무효값 → 백엔드 소거로 데이터 유실(기존 duration append의 잠복 버그도 함께 해소):

```ts
const availablePolicies: Set<BulkPolicy> = new Set<BulkPolicy>(
  mode === "people" && !hasAssignees
    ? ["replace", "individual", "skip"]
    : attrField !== null && isBulkParamField(attrField)
      ? ["replace", "individual", "skip"]
      : ["replace", "append", "skip", "individual"],
);
```

`apply()`의 flatMap append 분기(:390)와 `resolveStep`의 append(:401-402)는 system 전용으로 남음(파라미터 모드에선 policy가 append가 될 수 없음). 개별 마법사 UI(:654-661)의 Append 버튼은 `attrField !== null && isBulkParamField(attrField)`일 때 렌더하지 않는다. `apply()`·`finish()`·마법사의 기존값 표시(:357, :640, :878)는 `displayAttrValue(attrField, m[attrField])` → cost 대응 위해 `existingDisplay(m, attrField)`로 교체. `apply()` 내부 `m[attrField].trim()` 기반 분기(:380, :386-388)도 `existingRaw` 기준으로 통일(빈값 판정·동일값 자동 스킵).

- [ ] **Step 5: 값 입력 — 파라미터 모드는 ParamInput** (:833-850 대체)

```tsx
{mode !== "people" && action === "set" &&
  (attrField !== null && isBulkParamField(attrField) ? (
    <ParamInput
      field={attrField}
      className="rounded-sm border border-hairline px-2 py-1 text-caption"
      placeholder={t("bulk.value")}
      ariaLabel={t("bulk.value")}
      value={value}
      onCommit={setValue}
    />
  ) : (
    <input ...기존 system 자유텍스트 유지... />
  ))}
```

모드 탭 그리드(:744)는 8버튼 — `grid-cols-3` 유지(3행). 라벨이 길면 `whitespace-nowrap` 기존 클래스로 충분한지 실화면 확인.

- [ ] **Step 6: page.tsx 배선** — `:7884-7892` members 매핑에 `cost_krw: n.data.cost_krw, cost_usd: n.data.cost_usd, headcount: n.data.headcount, annual_count: n.data.annual_count, fte: n.data.fte` 추가. `applyGroupAttribute`(:3728-3746)는 패치 빌더 경유(비용 배타):

```ts
const applyGroupAttribute = useCallback(
  (field: BulkAttrField, updates: { id: string; value: string }[]) => {
    if (updates.length === 0) {
      return;
    }
    pushHistory();
    const valueById = new Map(updates.map((u) => [u.id, u.value]));
    setNodes((current) =>
      current.map((node) =>
        valueById.has(node.id)
          ? { ...node, data: { ...node.data, ...buildBulkAttrPatch(field, valueById.get(node.id) ?? "") } }
          : node,
      ),
    );
    scheduleAutoSave();
    showToast(t("bulk.applied"));
  },
  [pushHistory, setNodes, scheduleAutoSave, showToast, t],
);
```

(import `buildBulkAttrPatch` from `@/lib/bulk-params` — page.tsx는 브래킷 디렉터리라 grep 확인 시 파일 직접 지정.)

- [ ] **Step 7: 게이트** — `npm run lint` · `npx tsc --noEmit` · `npx vitest run` 전부 그린.
- [ ] **Step 8: 커밋** — `feat(bulk): extend group bulk edit to all six params — 그룹 일괄 편집 6필드 확장(SP annual_count·fte 허용, 비용 배타, append 봉인)` + PROGRESS.md.

### Task 6: stale 검증 스크립트 2개 — 6필드 모델로 갱신

**Files:**
- Modify: `frontend/scripts/pw-verify-export.mjs` (구 5필드·ETF/Cost/Extra 헤더)
- Modify: `frontend/scripts/pw-verify-sp-params.mjs` (구 etf/cost/extra·sp_cost)

**진실 소스(코드가 정답, 스크립트를 코드에 맞춘다):**
- CSV 헤더: `csv-export.ts:5` = `Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next`
- Excel 컬럼: `excel-export.ts:257-262` = `Duration (h)` · `Cost (KRW)` · `Cost (USD)` · `Headcount` · `Annual volume` · `FTE` (전체 순서는 파일에서 재확인)
- 인스펙터 data-id: `inspector-param-<field>` (page.tsx에서 실제 값 확인), SP 지정 모달: `subprocess-designation-<field>` / `subprocess-designation-sum-<field>` (subprocess-designation-modal.tsx에서 확인)
- API 필드: `MapDetailOut`의 `sp_duration`/`sp_cost_krw`/`sp_cost_usd`/`sp_headcount` (schemas.py:558-562)

- [ ] **Step 1: pw-verify-export.mjs 갱신** — ① 파라미터 입력을 6필드로: duration `0.75→1.15`(기존 유지) + `cost_krw 300` + `headcount 2` + `annual_count 7` + `fte 1.5` (**통화는 노드당 1개만** — 배타 불변식). etf/cost/extra 입력·assert(:173-175, :246-248, :274-275) 제거·치환. CSV 헤더 기대값(:231-232)·colIdx·재임포트 assert를 위 진실 소스로. 두 번째 데이터셋(:286)은 `cost_usd`를 써서 USD 경로도 커버. Excel 헤더(:309-310)·숫자 셀 assert(:322)를 6필드로.
- [ ] **Step 2: pw-verify-sp-params.mjs 갱신** — 시드 노드 `cost:` → `cost_krw:`(:155-156). 지정 PUT 바디(:182-186)를 4필드(duration/cost_krw/cost_usd/headcount)로. `PARAM_KEYS`(:204)·루프(:302)를 4필드로. Σ assert는 현행 설계(Σ 버튼 4개, headcount는 평균) 기준으로 수정. API assert(:263-265) `sp_cost` → `sp_cost_krw`. 칩 표기 assert(:354)는 `formatParamValue` 결과(`₩0.3`)로. 파일 전체를 `grep -n 'etf\|extra\|sp_cost[^_]\|"cost"'`로 훑어 잔존 0건까지.
- [ ] **Step 3: 실행 검증** — `docs/lessons/browser-verification.md` 선독(좀비 next 전수 pkill, dev.db 오염 함정). 워크트리에서 백엔드(메인 체크아웃의 venv 재사용: `cd backend && /Users/hyeonjin/Documents/bpm/backend/.venv/bin/python -m uvicorn app.main:app --port <빈포트>`)와 프론트(`BACKEND_URL=http://localhost:<포트> npm run dev -- -p <빈포트>`) 기동 후 두 스크립트 실행 → 전 체크 green 출력 확보. 포트·베이스 URL은 스크립트 상단 상수/env 방식을 따른다.
- [ ] **Step 4: 커밋** — `test(scripts): migrate export/sp-params verifiers to six-field model — stale 검증 스크립트 6필드 이행` + PROGRESS.md.

### Task 7: 신규 기능 브라우저 검증 + 전체 게이트

**Files:**
- Create: `frontend/scripts/pw-verify-params-ui-sync.mjs` (기존 pw-verify-*.mjs 하네스 패턴 복제 — localStorage dev 로그인 선주입, check() 헬퍼)

- [ ] **Step 1: 시나리오 스크립트 작성** — API로 시드(그룹 1개: process 3 + subprocess 1(링크·지정 완료), 그중 1개는 `cost_usd` 보유):
  1. 그룹 일괄 편집 진입 → `cost_krw` 모드 `500` 적용(충돌 시 replace) → GET /graph로 3개 process의 `cost_krw === "500"` **그리고 기존 cost_usd 노드의 `cost_usd === ""`**(배타) assert. SP 노드는 대상 제외 assert.
  2. `fte` 모드 `0.5` 적용 → **SP 노드 포함** 전 멤버 `fte === "0.5"` assert.
  3. 캔버스 칩에 `₩500` 표기 확인.
  4. 맵 탭 Parameters 토글 OFF → 칩 미표시, 새로고침 후에도 OFF 유지(v2 키), ON 복귀 → 칩 재표시.
  5. 레거시 이관: localStorage `bpm.nodeDisplayFields=["assignee"]`만 심고 v2 삭제 → 새로고침 → 칩 표시(=params ON 이관) assert.
- [ ] **Step 2: 실행** — Task 6과 같은 스택에서 green 확보.
- [ ] **Step 3: 전체 게이트** — `npm run lint` · `npx tsc --noEmit` · `npm run test` · `npm run build` 전부 그린. 백엔드는 무변경이므로 pytest 생략 가능(단, Task 6에서 backend를 띄웠다면 스모크로 충분).
- [ ] **Step 4: 커밋** — `test(scripts): add params-ui-sync browser verification — 일괄 편집·토글 브라우저 검증` + PROGRESS.md.

## Self-Review 결과

- 스펙 커버리지: 사용자 확정 3항목(일괄 6필드+SP 허용 / 통합 토글 기본 ON+이관 / stale 스크립트) ↔ Task 5 / Task 2·3·4 / Task 6. 검증은 Task 1·2(vitest)+Task 6·7(브라우저)+게이트.
- 타입 일관성: `BulkAttrField` 넓힘(모달 정의·page import 동일 심볼), `NodeDisplayToggle`(node-actions 정의, process-node·page·compare 소비) 확인.
- 회귀 가드: compare 칩(`["params"]` 주입), 링크 프리뷰(defaultActions에 params), 레거시 localStorage(파라미터 OFF 오작동 방지 v2 이관), duration append 잠복 버그 봉인 명시.

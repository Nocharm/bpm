// 비교뷰 입출력 diff 요약 — 개행 구분 목록(before/after)을 항목 단위 +/−로 접어 노드엔 건수만, 호버 툴팁엔
// 항목별 표식을 준다 (사용자 요청 2026-09-18). 같은 문구 중복은 다중집합으로 센다.

export type IoDiffStatus = "added" | "removed" | "unchanged";

export interface IoDiffItem {
  text: string;
  status: IoDiffStatus;
}

export interface IoDiffSummary {
  input: IoDiffItem[];
  output: IoDiffItem[];
  added: number;
  removed: number;
}

function splitIoLines(joined: string | null | undefined): string[] {
  return (joined ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** 한 변(입력 또는 출력)의 항목 diff — after 순서로 유지/추가, 남은 before 항목은 삭제로 뒤에 붙인다. */
export function buildIoDiffSide(before: string | null | undefined, after: string | null | undefined): IoDiffItem[] {
  const remaining = new Map<string, number>();
  for (const line of splitIoLines(before)) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const items: IoDiffItem[] = [];
  for (const line of splitIoLines(after)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
      items.push({ text: line, status: "unchanged" });
    } else {
      items.push({ text: line, status: "added" });
    }
  }
  for (const [line, count] of remaining) {
    for (let i = 0; i < count; i++) items.push({ text: line, status: "removed" });
  }
  return items;
}

/** 입력·출력 통합 요약 — 추가/삭제가 하나도 없으면 null(노드에서 생략). */
export function buildIoDiff(sides: {
  input: { before: string | null | undefined; after: string | null | undefined };
  output: { before: string | null | undefined; after: string | null | undefined };
}): IoDiffSummary | null {
  const input = buildIoDiffSide(sides.input.before, sides.input.after);
  const output = buildIoDiffSide(sides.output.before, sides.output.after);
  const all = [...input, ...output];
  const added = all.filter((item) => item.status === "added").length;
  const removed = all.filter((item) => item.status === "removed").length;
  if (added === 0 && removed === 0) return null;
  return { input, output, added, removed };
}

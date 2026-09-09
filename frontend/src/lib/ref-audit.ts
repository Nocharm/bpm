// 고아 참조 패널 순수 로직 — 체크 가능 판정·토글 대상·알림 대상·소스 라벨 키. 컴포넌트는 렌더만 한다.
import type { RefGroup, RefLine, RefSource } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";

export type RemapMode = "replace" | "remove";

// remove가 허용되지 않는 소스 — 서버 REMOVE_BLOCKED와 동일 집합
export const REMOVE_BLOCKED: ReadonlySet<RefSource> = new Set<RefSource>(["map_owner", "owning_dept", "sp_dept"]);

export function isLineCheckable(line: RefLine, mode: RemapMode): boolean {
  if (!line.fixable) return false;
  return !(mode === "remove" && REMOVE_BLOCKED.has(line.source));
}

export function checkableTargets(group: RefGroup, mode: RemapMode): string[] {
  return group.lines.filter((ln) => isLineCheckable(ln, mode)).map((ln) => ln.target_id);
}

// 알림 대상 = 관리자가 고칠 수 없는 라인(노드 필드) — 서버 OWNER_ACTIONABLE의 부분집합
export function notifyTargets(group: RefGroup): string[] {
  return group.lines.filter((ln) => !ln.fixable).map((ln) => ln.target_id);
}

export function countNotifyOwners(group: RefGroup): number {
  return new Set(group.lines.filter((ln) => !ln.fixable && ln.owner_id).map((ln) => ln.owner_id)).size;
}

// 소스별 count 합 — 등장 순서 유지(그룹 헤더 요약)
export function summarizeSources(group: RefGroup): [RefSource, number][] {
  const acc = new Map<RefSource, number>();
  for (const ln of group.lines) acc.set(ln.source, (acc.get(ln.source) ?? 0) + ln.count);
  return [...acc.entries()];
}

export const SOURCE_LABEL_KEY: Record<RefSource, MessageKey> = {
  map_grant: "refAudit.source.map_grant",
  group_member: "refAudit.source.group_member",
  owning_dept: "refAudit.source.owning_dept",
  sp_dept: "refAudit.source.sp_dept",
  node_dept: "refAudit.source.node_dept",
  map_owner: "refAudit.source.map_owner",
  map_collab: "refAudit.source.map_collab",
  map_approver: "refAudit.source.map_approver",
  group_user: "refAudit.source.group_user",
  category_perm: "refAudit.source.category_perm",
  sp_assignee: "refAudit.source.sp_assignee",
  node_assignee: "refAudit.source.node_assignee",
};

export const VALUE_KIND_LABEL_KEY: Record<RefGroup["value_kind"], MessageKey> = {
  path: "refAudit.kind.path",
  leaf: "refAudit.kind.leaf",
  login: "refAudit.kind.login",
  name: "refAudit.kind.name",
};

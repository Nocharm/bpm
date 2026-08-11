"use client";

// 부서 선택 모달 — 현행 조직도를 트리로 띄워 대상 경로를 고른다(소멸 부서 재지정 등).
// 드롭다운은 경로가 길고 목록이 커서 안 보이던 문제의 대체 UI (2026-08 9910 검증).

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

import { useI18n } from "@/lib/i18n";

export interface DeptPathOption {
  id: string; // 전체 경로 ("A/B/C") — 세그먼트 내 "/"는 백엔드가 전각 슬래시로 새니타이즈
  name: string; // 리프 세그먼트
  korean_name?: string;
}

interface TreeNode {
  path: string;
  name: string;
  koreanName: string;
  depth: number;
  children: TreeNode[];
}

/** 경로 목록 → 중첩 트리(루트→리프). 목록에 없는 중간 경로도 노드로 채운다. */
export function buildDeptPathTree(options: DeptPathOption[]): TreeNode[] {
  const koreanByPath = new Map(options.map((o) => [o.id, o.korean_name ?? ""]));
  const byPath = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const ensure = (path: string): TreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const segments = path.split("/");
    const node: TreeNode = {
      path,
      name: segments[segments.length - 1],
      koreanName: koreanByPath.get(path) ?? "",
      depth: segments.length - 1,
      children: [],
    };
    byPath.set(path, node);
    if (segments.length === 1) {
      roots.push(node);
    } else {
      ensure(segments.slice(0, -1).join("/")).children.push(node);
    }
    return node;
  };
  for (const o of [...options].sort((a, b) => a.id.localeCompare(b.id))) ensure(o.id);
  return roots;
}

/** 검색 매치 경로 집합 — 매치 노드의 조상까지 포함(트리에서 보이도록). */
function collectMatches(roots: TreeNode[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const visible = new Set<string>();
  const walk = (node: TreeNode, ancestors: string[]): void => {
    const hit =
      node.name.toLowerCase().includes(q) || node.koreanName.toLowerCase().includes(q);
    if (hit) {
      for (const a of ancestors) visible.add(a);
      const markAll = (n: TreeNode): void => {
        visible.add(n.path);
        n.children.forEach(markAll);
      };
      markAll(node);
    }
    node.children.forEach((c) => walk(c, [...ancestors, node.path]));
  };
  roots.forEach((r) => walk(r, []));
  return visible;
}

export function DeptTreePicker({
  title,
  departments,
  onPick,
  onClose,
}: {
  title: string;
  departments: DeptPathOption[];
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const roots = useMemo(() => buildDeptPathTree(departments), [departments]);
  const visible = useMemo(() => collectMatches(roots, query), [roots, query]);

  const rows: TreeNode[] = [];
  const flatten = (node: TreeNode): void => {
    if (visible && !visible.has(node.path)) return;
    rows.push(node);
    // 검색 중엔 접힘 무시(매치 문맥 보이기) / collapse only applies while browsing.
    if (visible || !collapsed.has(node.path)) node.children.forEach(flatten);
  };
  roots.forEach(flatten);

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
      data-id="dept-tree-picker"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[72vh] w-[30rem] flex-col gap-3 rounded-md border border-hairline bg-surface p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <p className="text-caption-strong text-ink">{title}</p>
          <button
            type="button"
            data-id="dept-tree-picker-close"
            className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            onClick={onClose}
            aria-label={t("common.cancel")}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("field.searchPlaceholder")}
          className="rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-caption text-ink outline-none focus:border-accent"
        />
        <div className="min-h-0 flex-1 overflow-y-auto" data-id="dept-tree-picker-list">
          {rows.length === 0 ? (
            <p className="px-1 py-2 text-caption text-ink-tertiary">{t("home.empty")}</p>
          ) : (
            rows.map((node) => (
              <div
                key={node.path}
                className="flex items-center gap-1"
                style={{ paddingLeft: `${node.depth * 16}px` }}
              >
                {node.children.length > 0 ? (
                  <button
                    type="button"
                    className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt"
                    aria-label={collapsed.has(node.path) ? "expand" : "collapse"}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(node.path)) next.delete(node.path);
                        else next.add(node.path);
                        return next;
                      })
                    }
                  >
                    {collapsed.has(node.path) ? (
                      <ChevronRight size={13} strokeWidth={1.5} />
                    ) : (
                      <ChevronDown size={13} strokeWidth={1.5} />
                    )}
                  </button>
                ) : (
                  <span className="w-[18px]" />
                )}
                <button
                  type="button"
                  data-id="dept-tree-picker-row"
                  className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded-sm px-1.5 py-1 text-left hover:bg-accent-tint"
                  onClick={() => onPick(node.path)}
                  title={node.path}
                >
                  <span className="truncate text-caption text-ink">{node.name}</span>
                  {node.koreanName && (
                    <span className="shrink-0 text-fine text-ink-tertiary">{node.koreanName}</span>
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

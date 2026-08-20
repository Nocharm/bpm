// 개행 구분 복수 값 편집 — 인터뷰 승격 input/output 공용. 저장값은 개행 join 단일 문자열
// (Node.input/output Text 계약, design 2026-08-19 §1.1). 노드 전환 시 부모가 key로 리마운트한다.
"use client";

import { Plus, X, type LucideIcon } from "lucide-react";
import { useState } from "react";

interface MultiValueInputProps {
  label: string;
  // 라벨 앞 소형 아이콘(12px) — 행 스캔 가시성 (사용자 결정 2026-08-20)
  icon?: LucideIcon;
  // 저장된 개행 join 원문 — 빈 문자열이면 항목 0개
  value: string;
  readOnly: boolean;
  dataId: string;
  placeholder?: string;
  // 항목 편집/추가/삭제 확정 시 개행 join 문자열로 콜백(빈 항목은 제거)
  onCommit: (joined: string) => void;
}

function splitValues(value: string): string[] {
  return value.split("\n").map((v) => v.trim()).filter((v) => v !== "");
}

export function MultiValueInput({ label, icon: Icon, value, readOnly, dataId, placeholder, onCommit }: MultiValueInputProps) {
  // 편집 중 행 버퍼 — 저장 원문에서 시작, blur/삭제 시 join 커밋. 노드 전환은 key 리마운트가 리셋.
  const [rows, setRows] = useState<string[]>(() => splitValues(value));

  const commit = (next: string[]) => {
    setRows(next);
    const joined = next.map((v) => v.trim()).filter((v) => v !== "").join("\n");
    if (joined !== value) onCommit(joined);
  };

  if (readOnly) {
    return (
      <div className="flex items-start justify-between gap-2 py-1" data-id={dataId}>
        <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
          {Icon && <Icon size={12} strokeWidth={1.5} className="text-ink-muted" />}
          {label}
        </span>
        <span className="min-w-0 whitespace-pre-wrap text-right text-caption text-ink">
          {splitValues(value).join("\n") || "—"}
        </span>
      </div>
    );
  }

  return (
    <div className="py-1" data-id={dataId}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
          {Icon && <Icon size={12} strokeWidth={1.5} className="text-ink-muted" />}
          {label}
        </span>
        <button
          type="button"
          data-id={`${dataId}-add`}
          className="flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-fine text-ink-tertiary hover:bg-surface-alt"
          onClick={() => setRows((prev) => [...prev, ""])}
        >
          <Plus size={12} strokeWidth={1.5} />
          Add
        </button>
      </div>
      {rows.map((row, i) => (
        // 항목은 위치 기반 편집 — 값 key는 중복 항목에서 충돌하므로 인덱스 사용(항목 재정렬 없음)
        <div key={i} className="mt-0.5 flex items-center gap-1">
          <input
            data-id={`${dataId}-row-${i}`}
            className="min-w-0 flex-1 rounded-sm bg-surface-alt px-1.5 py-0.5 text-caption text-ink focus:outline-none"
            value={row}
            placeholder={placeholder}
            onChange={(e) => setRows((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            onBlur={() => commit(rows)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <button
            type="button"
            data-id={`${dataId}-remove-${i}`}
            aria-label={`Remove ${label} ${i + 1}`}
            className="shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={() => commit(rows.filter((_, j) => j !== i))}
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      ))}
      {rows.length === 0 && <div className="mt-0.5 text-right text-caption text-ink-tertiary">—</div>}
    </div>
  );
}

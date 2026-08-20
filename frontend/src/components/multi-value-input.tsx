// 개행 구분 복수 값 편집 — 인터뷰 승격 input/output 공용. 저장값은 개행 join 단일 문자열
// (Node.input/output Text 계약, design 2026-08-19 §1.1). 노드 전환 시 부모가 key로 리마운트한다.
// formsValue를 주면 항목별 데이터 폼 열이 붙는다 — 줄 단위 1:1 정렬(빈 줄=미지정) (2026-08-20).
"use client";

import { Plus, X, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { DataFormPicker } from "@/components/data-form-picker";

interface MultiValueInputProps {
  label: string;
  // 라벨 앞 소형 아이콘(12px) — 행 스캔 가시성 (사용자 결정 2026-08-20)
  icon?: LucideIcon;
  // 저장된 개행 join 원문 — 빈 문자열이면 항목 0개
  value: string;
  // 항목별 데이터 폼(개행 join, value 줄과 1:1 정렬) — undefined면 폼 열 미노출
  formsValue?: string;
  readOnly: boolean;
  dataId: string;
  placeholder?: string;
  // 항목 편집/추가/삭제 확정 시 개행 join 문자열로 콜백(빈 항목은 제거).
  // formsValue를 준 호출부는 두 번째 인자로 정렬된 폼 join을 받는다(후행 빈 줄 소거).
  onCommit: (joined: string, formsJoined?: string) => void;
}

interface ItemRow {
  text: string;
  form: string;
}

// 저장 원문 → 행 버퍼. 빈 항목 줄은 제거하되 폼은 같은 인덱스로 따라간다(정렬 계약상 빈 줄 없음).
function splitRows(value: string, formsValue: string | undefined): ItemRow[] {
  const forms = (formsValue ?? "").split("\n");
  return value
    .split("\n")
    .map((v, i) => ({ text: v.trim(), form: (forms[i] ?? "").trim() }))
    .filter((r) => r.text !== "");
}

function joinForms(rows: ItemRow[]): string {
  // 항목 수만큼 정렬 join 후 후행 빈 줄 소거 — 짧은 forms는 이후 줄 미지정으로 해석(서버 계약 동일)
  return rows.map((r) => r.form).join("\n").replace(/\s+$/, "");
}

export function MultiValueInput({
  label, icon: Icon, value, formsValue, readOnly, dataId, placeholder, onCommit,
}: MultiValueInputProps) {
  const withForms = formsValue !== undefined;
  // 편집 중 행 버퍼 — 저장 원문에서 시작, blur/삭제 시 join 커밋. 노드 전환은 key 리마운트가 리셋.
  const [rows, setRows] = useState<ItemRow[]>(() => splitRows(value, formsValue));
  // 외부 변경 동기화(편집 모달 저장 → 인스펙터 등) — 렌더 중 상태 조정. 자기 커밋 에코(현재 행과
  // 동일한 join)는 리셋하지 않아 입력 중 빈 행이 날아가지 않는다 (사용자 결정 2026-08-20)
  const [prevProps, setPrevProps] = useState({ value, formsValue });
  if (prevProps.value !== value || prevProps.formsValue !== formsValue) {
    setPrevProps({ value, formsValue });
    const kept = rows.map((r) => ({ text: r.text.trim(), form: r.form.trim() })).filter((r) => r.text !== "");
    const joined = kept.map((r) => r.text).join("\n");
    if (value !== joined || (withForms && (formsValue ?? "") !== joinForms(kept))) {
      setRows(splitRows(value, formsValue));
    }
  }

  const commit = (next: ItemRow[]) => {
    setRows(next);
    const kept = next.map((r) => ({ text: r.text.trim(), form: r.form.trim() })).filter((r) => r.text !== "");
    const joined = kept.map((r) => r.text).join("\n");
    const formsJoined = joinForms(kept);
    if (joined !== value || (withForms && formsJoined !== (formsValue ?? ""))) {
      onCommit(joined, withForms ? formsJoined : undefined);
    }
  };

  if (readOnly) {
    const items = splitRows(value, formsValue);
    return (
      <div className="flex items-start justify-between gap-2 py-1" data-id={dataId}>
        <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
          {Icon && <Icon size={12} strokeWidth={1.5} className="text-ink-muted" />}
          {label}
        </span>
        <span className="min-w-0 text-right text-caption text-ink">
          {items.length === 0
            ? "-"
            : items.map((r, i) => (
                <span key={i} className="block">
                  {r.text}
                  {r.form !== "" && <span className="text-fine text-ink-tertiary"> · {r.form}</span>}
                </span>
              ))}
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
          onClick={() => setRows((prev) => [...prev, { text: "", form: "" }])}
        >
          <Plus size={12} strokeWidth={1.5} />
          Add
        </button>
      </div>
      {rows.map((row, i) => (
        // 항목은 위치 기반 편집 — 값 key는 중복 항목에서 충돌하므로 인덱스 사용(항목 재정렬 없음).
        // group/mvrow — 폼 미지정 행의 지정 아이콘이 행 호버 시에만 나타난다(DataFormPicker)
        <div key={i} className="group/mvrow mt-0.5 flex items-center gap-1">
          <input
            data-id={`${dataId}-row-${i}`}
            className="min-w-0 flex-1 rounded-sm border border-transparent bg-surface-alt px-1.5 py-0.5 text-caption text-ink focus:border-accent focus:outline-none"
            value={row.text}
            placeholder={placeholder}
            onChange={(e) =>
              setRows((prev) => prev.map((v, j) => (j === i ? { ...v, text: e.target.value } : v)))
            }
            onBlur={() => commit(rows)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          {withForms && (
            <DataFormPicker
              dataId={`${dataId}-form-${i}`}
              value={row.form}
              onCommit={(next) => commit(rows.map((v, j) => (j === i ? { ...v, form: next } : v)))}
            />
          )}
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
      {rows.length === 0 && <div className="mt-0.5 text-right text-caption text-ink-tertiary">-</div>}
    </div>
  );
}

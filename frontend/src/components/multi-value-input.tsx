// 개행 구분 복수 값 편집 — 인터뷰 승격 input/output 공용. 저장값은 개행 join 단일 문자열
// (Node.input/output Text 계약, design 2026-08-19 §1.1). 노드 전환 시 부모가 key로 리마운트한다.
// formsValue를 주면 항목별 데이터 폼 열이 붙는다 — 줄 단위 1:1 정렬(빈 줄=미지정) (2026-08-20).
// idsValue/linksValue/flagsValue를 주면 IO 연결(불러오기) — 미러 행 잠금·+ 메뉴(불러오기)·해제·
// 필수/선택 플래그가 붙는다. 전부 optional이라 기존 호출부(node-details-fields·SP 지정 모달)는
// 무변경 호환 (io-linking design 2026-08-21 §4).
"use client";

import { Link2, Link2Off, Plus, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DataFormPicker } from "@/components/data-form-picker";
import { useI18n } from "@/lib/i18n";

interface MultiValueInputProps {
  label: string;
  // 라벨 앞 소형 아이콘(12px) — 행 스캔 가시성 (사용자 결정 2026-08-20)
  icon?: LucideIcon;
  // 저장된 개행 join 원문 — 빈 문자열이면 항목 0개
  value: string;
  // 항목별 데이터 폼(개행 join, value 줄과 1:1 정렬) — undefined면 폼 열 미노출
  formsValue?: string;
  // 아웃풋 쪽 원본 id 줄(개행 join, value와 1:1) — 미러가 있는 원본 행 표시·커밋 정렬용
  idsValue?: string;
  // 미러 링크 줄(개행 join, value와 1:1) — 있으면 해당 행이 잠긴 미러(원본 참조)
  linksValue?: string;
  // 인풋 필수/선택 줄(개행 join, value와 1:1, ""=required) — 주면 플래그 필 열 노출
  flagsValue?: string;
  // 미러가 1개 이상 있는 원본 행의 인덱스 — 배지 대신 링크 아이콘 표시용
  originGroupIndexes?: ReadonlySet<number>;
  // 끊긴 흐름 경고 행(인풋 미러 한정 — 원본→소비 경로 부재) — 경고 아이콘 표시용 (io-linking 백로그 2026-08-21)
  warnRowIndexes?: ReadonlySet<number>;
  // 주면 + 버튼이 Add new/Import from node… 2항목 메뉴로 바뀐다
  onImport?: (at: { x: number; y: number }) => void;
  // 있으면 메뉴의 "Import from node…" 항목을 비활성화 + 툴팁으로 사유 표시(예: dirty 카드)
  importDisabledReason?: string;
  onUnlink?: (index: number, at: { x: number; y: number }) => void;
  onNavigateLinked?: (index: number) => void;
  // 행 단위 호버(원본·미러 공통) — 인스펙터/모달 하이라이트 공유용
  onHoverLinked?: (side: "row", index: number | null) => void;
  // 읽기전용에서 링크 항목 클릭 → 연결 노드 드롭다운(#2). 편집 모드에선 미사용
  onPeersMenu?: (index: number, at: { x: number; y: number }) => void;
  readOnly: boolean;
  dataId: string;
  placeholder?: string;
  // 항목 편집/추가/삭제 확정 시 개행 join 문자열로 콜백(빈 항목은 제거).
  // formsValue를 준 호출부는 두 번째 인자로 정렬된 폼 join을 받는다(후행 빈 줄 소거).
  // idsValue/linksValue/flagsValue 중 하나라도 준 호출부는 세 번째 인자로 그 세 열의 join을 받는다
  // (비제공 호출부는 undefined — 무영향).
  onCommit: (joined: string, formsJoined?: string, extras?: { ids: string; links: string; flags: string }) => void;
}

interface ItemRow {
  text: string;
  form: string;
  id: string;
  link: string;
  flag: string;
}

// 저장 원문 → 행 버퍼. 빈 텍스트 행은 5열 동반 드롭(정렬 자동 유지) — 폼·id·링크·플래그는 같은
// 인덱스로 따라간다(정렬 계약상 빈 줄 없음).
function splitRows(
  value: string,
  formsValue: string | undefined,
  idsValue: string | undefined,
  linksValue: string | undefined,
  flagsValue: string | undefined,
): ItemRow[] {
  const forms = (formsValue ?? "").split("\n");
  const ids = (idsValue ?? "").split("\n");
  const links = (linksValue ?? "").split("\n");
  const flags = (flagsValue ?? "").split("\n");
  return value
    .split("\n")
    .map((v, i) => ({
      text: v.trim(),
      form: (forms[i] ?? "").trim(),
      id: (ids[i] ?? "").trim(),
      link: (links[i] ?? "").trim(),
      flag: (flags[i] ?? "").trim(),
    }))
    .filter((r) => r.text !== "");
}

// 항목 수만큼 정렬 join 후 후행 공백 소거 — 짧은 열은 이후 줄 미지정으로 해석(서버 계약과 동일,
// lib io-items.ts setIoLine 계약과 동치)
function joinColumn(rows: ItemRow[], key: keyof ItemRow): string {
  return rows.map((r) => r[key]).join("\n").replace(/\s+$/, "");
}

export function MultiValueInput({
  label,
  icon: Icon,
  value,
  formsValue,
  idsValue,
  linksValue,
  flagsValue,
  originGroupIndexes,
  warnRowIndexes,
  onImport,
  importDisabledReason,
  onUnlink,
  onNavigateLinked,
  onHoverLinked,
  onPeersMenu,
  readOnly,
  dataId,
  placeholder,
  onCommit,
}: MultiValueInputProps) {
  const { t } = useI18n();
  const withForms = formsValue !== undefined;
  // 신규 3열(ids/links/flags) 중 하나라도 제공된 호출부만 extras를 커밋에 실어보낸다 — 미제공
  // 호출부(기존 두 곳)는 항상 undefined라 완전 무영향
  const withExtras = idsValue !== undefined || linksValue !== undefined || flagsValue !== undefined;
  // 편집 중 행 버퍼 — 저장 원문에서 시작, blur/삭제 시 join 커밋. 노드 전환은 key 리마운트가 리셋.
  const [rows, setRows] = useState<ItemRow[]>(() => splitRows(value, formsValue, idsValue, linksValue, flagsValue));
  // 외부 변경 동기화(편집 모달 저장 → 인스펙터 등) — 렌더 중 상태 조정. 자기 커밋 에코(현재 행과
  // 동일한 join)는 리셋하지 않아 입력 중 빈 행이 날아가지 않는다 (사용자 결정 2026-08-20)
  const [prevProps, setPrevProps] = useState({ value, formsValue, idsValue, linksValue, flagsValue });
  if (
    prevProps.value !== value ||
    prevProps.formsValue !== formsValue ||
    prevProps.idsValue !== idsValue ||
    prevProps.linksValue !== linksValue ||
    prevProps.flagsValue !== flagsValue
  ) {
    setPrevProps({ value, formsValue, idsValue, linksValue, flagsValue });
    const kept = rows
      .map((r) => ({ text: r.text.trim(), form: r.form.trim(), id: r.id.trim(), link: r.link.trim(), flag: r.flag.trim() }))
      .filter((r) => r.text !== "");
    const joined = kept.map((r) => r.text).join("\n");
    const stale =
      value !== joined ||
      (withForms && (formsValue ?? "") !== joinColumn(kept, "form")) ||
      (withExtras &&
        ((idsValue ?? "") !== joinColumn(kept, "id") ||
          (linksValue ?? "") !== joinColumn(kept, "link") ||
          (flagsValue ?? "") !== joinColumn(kept, "flag")));
    if (stale) {
      setRows(splitRows(value, formsValue, idsValue, linksValue, flagsValue));
    }
  }

  const commit = (next: ItemRow[]) => {
    setRows(next);
    const kept = next
      .map((r) => ({ text: r.text.trim(), form: r.form.trim(), id: r.id.trim(), link: r.link.trim(), flag: r.flag.trim() }))
      .filter((r) => r.text !== "");
    const joined = kept.map((r) => r.text).join("\n");
    const formsJoined = joinColumn(kept, "form");
    const idsJoined = joinColumn(kept, "id");
    const linksJoined = joinColumn(kept, "link");
    const flagsJoined = joinColumn(kept, "flag");
    const changed =
      joined !== value ||
      (withForms && formsJoined !== (formsValue ?? "")) ||
      (withExtras &&
        (idsJoined !== (idsValue ?? "") || linksJoined !== (linksValue ?? "") || flagsJoined !== (flagsValue ?? "")));
    if (changed) {
      onCommit(
        joined,
        withForms ? formsJoined : undefined,
        withExtras ? { ids: idsJoined, links: linksJoined, flags: flagsJoined } : undefined,
      );
    }
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  // 행 선택(#1·#15) — 클릭한 행에 포커스 링 + 인박스 컨트롤 노출. 다른 행 클릭 시 이동
  const [activeRow, setActiveRow] = useState<number | null>(null);
  // 플래그 토글 직후 풀 라벨 플래시(#15) — R/O 이니셜의 의미 전달, 0.9s 후 다시 축소
  const [flagFlashRow, setFlagFlashRow] = useState<number | null>(null);
  const flagFlashTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (flagFlashTimer.current !== null) window.clearTimeout(flagFlashTimer.current);
    },
    [],
  );
  const flashFlag = (index: number) => {
    if (flagFlashTimer.current !== null) window.clearTimeout(flagFlashTimer.current);
    setFlagFlashRow(index);
    flagFlashTimer.current = window.setTimeout(() => setFlagFlashRow(null), 900);
  };

  // 바깥 mousedown/Esc = 닫힘 — add-node-menu.tsx와 동일 컨벤션(document 레벨, capture)
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [menuOpen]);

  if (readOnly) {
    const items = splitRows(value, formsValue, idsValue, linksValue, flagsValue);
    return (
      <div className="flex items-start justify-between gap-2 py-1" data-id={dataId}>
        <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
          {Icon && <Icon size={12} strokeWidth={1.5} className="text-ink-muted" />}
          {label}
        </span>
        <span className="min-w-0 text-right text-caption text-ink">
          {items.length === 0
            ? "-"
            : items.map((r, i) => {
                const linked = r.link !== "" || (originGroupIndexes?.has(i) ?? false);
                return (
                  <span
                    key={i}
                    // 읽기전용 링크 항목 클릭 → 연결 노드 드롭다운(#2 — 호버 하이라이트와 병행)
                    className={`block ${linked && onPeersMenu ? "cursor-pointer rounded-sm hover:bg-surface-alt" : ""}`}
                    onMouseEnter={linked ? () => onHoverLinked?.("row", i) : undefined}
                    onMouseLeave={linked ? () => onHoverLinked?.("row", null) : undefined}
                    onClick={
                      linked && onPeersMenu
                        ? (e) => onPeersMenu(i, { x: e.clientX, y: e.clientY })
                        : undefined
                    }
                  >
                    {linked && <Link2 size={12} strokeWidth={1.5} className="mr-0.5 inline text-accent" />}
                    {warnRowIndexes?.has(i) && (
                      <span title={t("io.brokenFlow")} className="mr-0.5 inline-flex align-middle text-error">
                        <TriangleAlert size={12} strokeWidth={1.5} />
                      </span>
                    )}
                    {/* 항목 번호 — 회색톤 (사용자 결정 2026-08-20) */}
                    <span className="text-fine tabular-nums text-ink-muted">{i + 1}. </span>
                    {r.text}
                    {r.form !== "" && <span className="text-fine text-ink-tertiary"> · {r.form}</span>}
                    {/* 기본값(required)은 노이즈라 표시 생략 — optional만 접미 */}
                    {r.flag === "optional" && (
                      <span className="text-fine text-ink-tertiary"> · {t("io.flagOptional")}</span>
                    )}
                  </span>
                );
              })}
        </span>
      </div>
    );
  }

  return (
    <div className="group/iosec py-1" data-id={dataId}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
          {Icon && <Icon size={12} strokeWidth={1.5} className="text-ink-muted" />}
          {label}
        </span>
        <div className="relative" ref={menuContainerRef}>
          <button
            type="button"
            data-id={`${dataId}-add`}
            aria-label={`${label} add`}
            className="flex items-center rounded-sm p-0.5 text-ink-tertiary opacity-0 transition-opacity duration-150 hover:bg-surface-alt focus-visible:opacity-100 group-hover/iosec:opacity-100"
            onClick={() => {
              if (onImport) {
                setMenuOpen((v) => !v);
              } else {
                setRows((prev) => [...prev, { text: "", form: "", id: "", link: "", flag: "" }]);
              }
            }}
          >
            <Plus size={12} strokeWidth={1.5} />
          </button>
          {menuOpen && onImport && (
            <div
              data-id={`${dataId}-add-menu`}
              className="absolute right-0 top-full z-10 mt-1 w-max rounded-md border border-hairline bg-surface p-1 shadow-md"
            >
              <button
                type="button"
                data-id={`${dataId}-add-new`}
                className="block w-full whitespace-nowrap rounded-sm px-2 py-1 text-left text-fine text-ink hover:bg-surface-alt"
                onClick={() => {
                  setMenuOpen(false);
                  setRows((prev) => [...prev, { text: "", form: "", id: "", link: "", flag: "" }]);
                }}
              >
                {t("io.addNew")}
              </button>
              {/* disabled 버튼은 마우스 이벤트를 못 받아 title 툴팁이 안 뜰 수 있다 — 래퍼 span이 툴팁 담당 */}
              <span title={importDisabledReason} className="block">
                <button
                  type="button"
                  data-id={`${dataId}-add-import`}
                  disabled={importDisabledReason !== undefined}
                  className="block w-full whitespace-nowrap rounded-sm px-2 py-1 text-left text-fine text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-ink-tertiary disabled:hover:bg-transparent"
                  onClick={(e) => {
                    setMenuOpen(false);
                    onImport({ x: e.clientX, y: e.clientY });
                  }}
                >
                  {t("io.importFromNode")}
                </button>
              </span>
            </div>
          )}
        </div>
      </div>
      {rows.map((row, i) => {
        const isMirror = row.link !== "";
        const isOrigin = !isMirror && row.id !== "" && (originGroupIndexes?.has(i) ?? false);
        const linked = isMirror || isOrigin;
        const optionalFlag = row.flag === "optional";
        const flagExpanded = flagFlashRow === i;
        const flagFull = optionalFlag ? t("io.flagOptional") : t("io.flagRequired");
        return (
          // 항목은 위치 기반 편집 — 값 key는 중복 항목에서 충돌하므로 인덱스 사용(항목 재정렬 없음).
          // group/mvrow — 폼 미지정 행의 지정 아이콘(DataFormPicker)·미러 행의 Unlink 스왑이 행 호버에 반응
          <div
            key={i}
            className="group/mvrow mt-0.5 flex items-center gap-1"
            onMouseEnter={linked ? () => onHoverLinked?.("row", i) : undefined}
            onMouseLeave={linked ? () => onHoverLinked?.("row", null) : undefined}
          >
            {isMirror && onUnlink === undefined ? (
              // 해제 핸들러가 없는 표면(노드 편집 모달 등) — 죽은 어포던스 대신 정적 Link2만
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-accent">
                <Link2 size={12} strokeWidth={1.5} />
              </span>
            ) : isMirror ? (
              // 미러 행 — 번호 배지 대신 Unlink 아이콘 버튼(호버 시 Link2→Link2Off 겹쳐 스왑)
              <button
                type="button"
                data-id={`${dataId}-link-${i}`}
                title={t("io.unlinkTooltip")}
                aria-label={t("io.unlinkTooltip")}
                className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center text-accent hover:text-error"
                onClick={(e) => onUnlink?.(i, { x: e.clientX, y: e.clientY })}
              >
                <Link2
                  size={12}
                  strokeWidth={1.5}
                  className="absolute opacity-100 transition-opacity duration-150 group-hover/mvrow:opacity-0"
                />
                <Link2Off
                  size={12}
                  strokeWidth={1.5}
                  className="absolute opacity-0 transition-opacity duration-150 group-hover/mvrow:opacity-100"
                />
              </button>
            ) : isOrigin ? (
              // 원본 행(미러 1개 이상 보유) — 번호 배지 대신 비버튼 Link2, 편집은 평소대로 가능
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-accent">
                <Link2 size={12} strokeWidth={1.5} />
              </span>
            ) : (
              // 항목 번호 — 회색톤 (사용자 결정 2026-08-20)
              <span className="w-4 shrink-0 text-right text-fine tabular-nums text-ink-muted">{i + 1}.</span>
            )}
            {isMirror && warnRowIndexes?.has(i) && (
              // 끊긴 흐름 경고 — 원본→소비 경로 부재(인풋 미러 한정). 표시 전용, 링크·전파 불변
              <span title={t("io.brokenFlow")} className="inline-flex shrink-0 items-center text-error">
                <TriangleAlert size={12} strokeWidth={1.5} />
              </span>
            )}
            {/* 입력 박스 + 인박스 컨트롤(#15) — 태그·형식·삭제는 행 호버/선택 시에만 우측 오버레이로 */}
            <div className={`relative min-w-0 flex-1 rounded-sm ${activeRow === i ? "ring-1 ring-accent" : ""}`}>
              <input
                data-id={`${dataId}-row-${i}`}
                readOnly={isMirror}
                title={isMirror ? t("io.linkedTooltip") : undefined}
                // 미러 텍스트는 원본으로 이동하는 더블클릭 대상 — 네비 핸들러가 없는 표면에선 포인터 커서도 빼 오해 방지
                className={`w-full rounded-sm border border-transparent px-1.5 py-0.5 text-caption focus:outline-none ${
                  isMirror
                    ? `bg-surface-pearl text-ink-secondary ${onNavigateLinked ? "cursor-pointer" : ""}`
                    : "bg-surface-alt text-ink focus:border-accent"
                }`}
                value={row.text}
                placeholder={placeholder}
                onFocus={() => setActiveRow(i)}
                onChange={
                  isMirror
                    ? undefined
                    : (e) => setRows((prev) => prev.map((v, j) => (j === i ? { ...v, text: e.target.value } : v)))
                }
                onBlur={isMirror ? undefined : () => commit(rows)}
                onKeyDown={
                  isMirror
                    ? undefined
                    : (e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }
                }
                // 1클릭 = 행 포커스 효과만, 더블클릭 = 원본으로 이동 (#1)
                onClick={isMirror ? () => setActiveRow(i) : undefined}
                onDoubleClick={isMirror ? () => onNavigateLinked?.(i) : undefined}
              />
              <div
                className={`absolute inset-y-0.5 right-0.5 flex items-center gap-0.5 rounded-sm pl-1 transition-opacity duration-150 ${
                  activeRow === i
                    ? "opacity-100"
                    : "pointer-events-none opacity-0 group-hover/mvrow:pointer-events-auto group-hover/mvrow:opacity-100"
                } ${isMirror ? "bg-surface-pearl/95" : "bg-surface-alt/95"}`}
              >
                {flagsValue !== undefined && (
                  // 플래그는 소비 노드 로컬(io-linking §1-9). 평소 R/O 이니셜, 토글 직후 풀 라벨 플래시(#15)
                  <button
                    type="button"
                    data-id={`${dataId}-flag-${i}`}
                    title={flagFull}
                    className={`shrink-0 overflow-hidden whitespace-nowrap rounded-full border px-1.5 py-0.5 text-fine ${
                      optionalFlag
                        ? "border-hairline text-ink-tertiary"
                        : "border-transparent bg-accent-tint text-accent"
                    }`}
                    onClick={() => {
                      flashFlag(i);
                      commit(rows.map((v, j) => (j === i ? { ...v, flag: v.flag === "optional" ? "" : "optional" } : v)));
                    }}
                  >
                    <span
                      className={`inline-block overflow-hidden align-middle transition-[max-width] duration-350 ease-smooth ${
                        flagExpanded ? "max-w-16" : "max-w-3"
                      }`}
                    >
                      {flagExpanded ? flagFull : optionalFlag ? "O" : "R"}
                    </span>
                  </button>
                )}
                {withForms &&
                  (isMirror ? (
                    // 미러는 폼 편집 불가 — 정적 텍스트로만 표시(원본에서만 수정)
                    <span className="max-w-20 shrink-0 truncate text-fine text-ink-tertiary">{row.form}</span>
                  ) : (
                    <DataFormPicker
                      dataId={`${dataId}-form-${i}`}
                      value={row.form}
                      onCommit={(next) => commit(rows.map((v, j) => (j === i ? { ...v, form: next } : v)))}
                    />
                  ))}
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
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <div className="mt-0.5 text-right text-caption text-ink-tertiary">-</div>}
    </div>
  );
}

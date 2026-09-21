// 카테고리 관리 부서 지정 모달 — 설정 > Categories 트리 행의 Building2 버튼이 연다(사용자 결정 2026-09-21, B안).
// 관리 부서는 권한(user|group)과 별개인 속성으로 비어 있으면 상위에서 상속되고, L5의 연계 캔버스는 이 값을
// owning_department로 물려받아 부서 뷰 조직도에 자리를 얻는다. 피커는 홈 상세 오우닝 지정과 같은
// PrincipalPicker(부서 전용·조직도 트리 브라우즈). 저장은 Confirm 1회(PATCH /categories/{id}).
"use client";

import { Building2, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { getDirectory, updateCategory, type CategoryNode, type DirectoryDept, type DirectoryUser } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { deriveDeptKoreanKeywords } from "@/lib/korean-dept";
import { DeptPill } from "@/components/dept-pill";
// DeptPill은 리프명 원문을 받는다(경로를 주면 고아 판정) — 관리 부서는 조직 경로로 저장되므로 리프만 넘긴다
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";

interface CategoryDeptModalProps {
  node: CategoryNode;
  onClose: () => void;
  // 저장 후 — 호출부가 트리를 다시 읽는다
  onSaved: () => void;
  onToast: (message: string) => void;
}

export function CategoryDeptModal({ node, onClose, onSaved, onToast }: CategoryDeptModalProps) {
  const { t } = useI18n();
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);
  // 버퍼 — 자기 값(상속값은 편집 대상이 아니다). undefined=미변경, null=해제
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getDirectory()
      .then((dir) => {
        if (!active) return;
        setDirUsers(dir.users);
        setDirDepts(dir.departments);
      })
      .catch(() => {
        /* 디렉터리 실패 — 피커가 비어 보인다 */
      });
    return () => {
      active = false;
    };
  }, []);

  const own = choice === undefined ? (node.admin_department ?? null) : choice;
  const inherited = own === null ? (node.effective_admin_department ?? null) : null;
  const isDirty = choice !== undefined && choice !== (node.admin_department ?? null);

  function confirmSave() {
    if (!isDirty || saving) return;
    setSaving(true);
    setError(null);
    void updateCategory(node.id, { admin_department: own })
      .then(() => {
        onSaved();
        onClose();
        onToast(t("framework.adminDeptSaved"));
      })
      .catch((err) => setError(humanizeApiError(err, t)))
      .finally(() => setSaving(false));
  }

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      // z 1200(모달 단) — PrincipalPicker 드롭다운은 body 포털 z 1250이라 호스트 모달이 1300이면 목록이 블러 뒤에 묻힌다
      // (오버레이 z 사다리, 권한자 모달과 동일)
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="framework-dept-modal"
        className="flex w-full max-w-md flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
              <Building2 size={18} strokeWidth={1.5} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-body-strong text-ink">{t("framework.adminDeptTitle")}</h2>
              <p className="truncate text-fine text-ink-tertiary">{node.name}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("summary.close")}
            title={t("summary.close")}
            className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <p className="text-fine text-ink-tertiary">{t("framework.adminDeptHint")}</p>

        {/* 현재 값 — 자기 값이면 필+해제, 없으면 상속값(톤다운) 또는 미지정 */}
        <div data-id="framework-dept-current" className="flex min-h-[30px] items-center gap-2">
          {own ? (
            <>
              <DeptPill department={deptLeaf(own)} dataId="framework-dept-own" />
              <button
                type="button"
                data-id="framework-dept-clear"
                className="rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
                onClick={() => setChoice(null)}
              >
                {t("framework.adminDeptClear")}
              </button>
            </>
          ) : inherited ? (
            <span className="flex items-center gap-1.5 text-fine text-ink-tertiary">
              <DeptPill department={deptLeaf(inherited)} dataId="framework-dept-inherited" />
              {t("framework.adminDeptInherited")}
            </span>
          ) : (
            <span className="inline-flex rounded-full border border-dashed border-hairline px-2.5 py-1 text-fine text-ink-muted">
              {t("framework.adminDeptNone")}
            </span>
          )}
        </div>

        <PrincipalPicker
          users={[]}
          departments={dirDepts.map((d) => ({
            id: d.id,
            code: "",
            name: d.name,
            orgLevels: [],
            parentId: null,
            rawDn: "",
            korean_name: d.korean_name,
          }))}
          groups={[]}
          excludeIds={new Set<string>()}
          deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
          deptTreeBrowse
          onSelect={(opt: PrincipalOption) => {
            if (opt.principalType !== "department") return;
            setError(null);
            setChoice(opt.principalId);
          }}
        />
        {error && <p className="text-caption text-error">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-hairline pt-3">
          <button
            type="button"
            data-id="framework-dept-cancel"
            className="rounded-sm px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-id="framework-dept-confirm"
            className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent disabled:opacity-40"
            disabled={!isDirty || saving}
            onClick={confirmSave}
          >
            {saving && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}

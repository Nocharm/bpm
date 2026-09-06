"use client";

// 플레이스홀더 후차 연결 다이얼로그 (design 2026-08-28 §10.1) — 트리로 후보 맵을 고르고 미리보기
// 피크(서브프로세스 피커와 동일 컴포넌트)로 확인한 뒤 연결한다 (사용자 요구 2026-09-06).
// 안내된 출처 L5(origin)는 이양 후계자 추천·안내 밖 L5 확인 게이트·피크의 "외부 L6" 배지 기준(원본
// FrameworkTreePicker는 linkageCategoryId만 봐서 게이트와 배지 기준이 어긋났다 — 리뷰 라운드1 #1)에
// 쓰이고, 트리 자체(펼침·"내 위치" 강조)는 캔버스의 결착 L5(linkageCategoryId) 기준을 그대로 쓴다.
// 다이얼로그는 좌상단에 도킹(items-start justify-start)되고 트리는 max-w-lg 안에서 flex-1로 남는
// 높이를 채운다 — 가운데 넓은 다이얼로그는 피크 플라이아웃이 열릴 오른쪽 공간을 먹어 겹쳤다(리뷰 라운드1 #2).
import { CornerUpRight, Link2, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FrameworkTreePicker } from "@/components/framework-tree-picker";
import { ModalBackdrop } from "@/components/modal-backdrop";
import type { PeekAddPayload } from "@/components/subprocess-preview-peek";
import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { NodeDisplayToggle } from "@/lib/node-actions";

interface Scope {
  id: number;
  path: string;
}

// 확인 게이트 대기 중인 선택 — 트리 피크에서 넘어온 페이로드를 onConnect 계약 형태로 정리해 둔다
interface PendingPick {
  map: Pick<MapSummary, "id" | "name">;
  meta: { categoryId: number; categoryPath: string | null; designated: boolean };
}

export interface FrameworkConnectDialogProps {
  nodeTitle: string;
  originCategoryId: number | null;
  originPath: string | null;
  // 이양 후계자 — 스테일 링크 교체 플로우에서 최우선 추천으로 고정 노출 (2026-08-30)
  successor?: { id: number; name: string } | null;
  linkedMapIds: Set<number>;
  currentMapId: number;
  // 임베드된 트리 피커에 그대로 전달 — 라이브러리 패널·체계 피커와 동일 값(page.tsx 동일 state)
  nodeDisplayFields: NodeDisplayToggle[];
  linkageCategoryId: number | null;
  // 적용에 필요한 건 id·이름뿐 — 후계자 추천(전체 MapSummary 없음)도 같은 경로를 쓴다.
  // origin은 낙관 참조용 스코프 정보(트리 픽만 제공) — 즉시 외부 L6 스타일 렌더 (#4)
  onConnect: (
    map: Pick<MapSummary, "id" | "name">,
    origin?: { categoryId: number; categoryPath: string | null; designated: boolean },
  ) => void;
  // 트리에서 "이미 캔버스에 있는" 행 클릭 — 다이얼로그를 닫고 그 노드로 포커스(라이브러리 패널과 동일 콜백 재사용)
  onFocusLinkedNode: (linkedMapId: number) => void;
  // 트리 피크의 "해당 맵으로 이동" — 에디터 이탈 확인 게이트로 연결(다른 두 마운트 지점과 동일 배선)
  onOpenMap: (mapId: number, name: string) => void;
  onClose: () => void;
}

export function FrameworkConnectDialog({
  nodeTitle,
  originCategoryId,
  originPath,
  successor = null,
  linkedMapIds,
  currentMapId,
  nodeDisplayFields,
  linkageCategoryId,
  onConnect,
  onFocusLinkedNode,
  onOpenMap,
  onClose,
}: FrameworkConnectDialogProps) {
  const { t } = useI18n();
  const origin: Scope | null =
    originCategoryId !== null ? { id: originCategoryId, path: originPath ?? "" } : null;
  const [pendingConfirm, setPendingConfirm] = useState<PendingPick | null>(null);

  const lastSeg = (path: string) => path.split("/").slice(-2).join("/") || path;

  // 트리 피크의 "Connect" → 안내와 같은 L5(또는 안내 자체가 없음)면 직결, 그 외는 확인 게이트
  // (사용자 요구 2026-08-29 — 트리 도입 후에도 동일 정책 유지)
  function pick(payload: PeekAddPayload) {
    const map: Pick<MapSummary, "id" | "name"> = { id: payload.linkedMapId, name: payload.name };
    const meta =
      payload.categoryId !== undefined
        ? {
            categoryId: payload.categoryId,
            categoryPath: payload.categoryPath ?? null,
            designated: !payload.unregistered,
          }
        : undefined;
    if (origin === null || meta === undefined || meta.categoryId === origin.id) {
      onConnect(map, meta);
      return;
    }
    setPendingConfirm({ map, meta });
  }

  return (
    <>
      <ModalBackdrop
        onClose={onClose}
        className="fixed inset-0 z-[1200] flex items-start justify-start bg-ink/20 p-6 backdrop-blur-sm"
      >
        <div
          data-id="framework-connect-dialog"
          className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-md border border-hairline bg-surface shadow-lg"
        >
          {/* 헤더 */}
          <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
              <Link2 size={15} strokeWidth={1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-caption-strong font-semibold">{t("framework.connectTitle")}</div>
              <div className="truncate text-fine text-ink-tertiary">{nodeTitle}</div>
            </div>
            <button
              type="button"
              data-id="framework-connect-close"
              onClick={onClose}
              className="rounded-xs p-1 text-ink-tertiary hover:bg-surface-alt"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>

          {/* 안내 문구 — 트리는 결착 L5 기준으로 펼쳐진다(안내된 출처는 추천·확인 게이트에서만 별도 표시) */}
          <div className="border-b border-hairline px-4 py-2 text-fine text-ink-tertiary">
            {t("framework.connectTreeHint")}
          </div>

          {/* 이양 후계자 추천 — 시스템이 아는 대체 맵을 고정 노출(직결·게이트 없음) */}
          {successor !== null && (
            <div className="border-b border-hairline p-2">
              <button
                type="button"
                data-id="framework-connect-successor"
                disabled={linkedMapIds.has(successor.id)}
                onClick={() => onConnect({ id: successor.id, name: successor.name })}
                className={`flex w-full items-center gap-2 rounded-sm border border-accent-tint-border bg-accent-tint px-3 py-2 text-left text-caption ${
                  linkedMapIds.has(successor.id) ? "opacity-45" : "hover:border-accent"
                }`}
              >
                <CornerUpRight size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate font-semibold">{successor.name}</span>
                <span className="shrink-0 rounded-full border border-accent-tint-border bg-surface px-2 py-0.5 text-fine text-accent">
                  {linkedMapIds.has(successor.id)
                    ? t("framework.connectOnCanvas")
                    : t("framework.successorPill")}
                </span>
              </button>
            </div>
          )}

          {/* 트리 + 미리보기 피크 — 서브프로세스 피커와 동일 컴포넌트 재사용 (사용자 요구 2026-09-06).
              hideHeader로 내부 "Framework L6" 타이틀바·닫기 버튼을 죽여 다이얼로그 자체 헤더와
              중복되지 않게 한다(리뷰 라운드1 #3). 트리 영역은 flex-1+min-h-0로 다이얼로그의
              max-h-[85vh] 안에서 남는 높이만큼만 차지하고 내부에서 스크롤한다(리뷰 라운드1 #2) */}
          <FrameworkTreePicker
            currentMapId={currentMapId}
            linkedMapIds={linkedMapIds}
            readOnly={false}
            nodeDisplayFields={nodeDisplayFields}
            linkageCategoryId={linkageCategoryId}
            originCategoryId={originCategoryId}
            hideHeader
            ctaLabelKey="framework.connectCta"
            className="flex min-h-0 min-w-[20rem] flex-1 flex-col bg-surface"
            onClose={onClose}
            onPeekAdd={pick}
            onPeekOpenMap={onOpenMap}
            onFocusLinkedNode={(linkedMapId) => {
              onClose();
              onFocusLinkedNode(linkedMapId);
            }}
          />
        </div>
      </ModalBackdrop>

      {/* 안내 밖 L5 확인 게이트 — 경로 비교 배너로 시인성 확보 (사용자 요구 2026-08-29) */}
      {pendingConfirm !== null && origin !== null && (
        <ConfirmDialog
          dialogId="framework-connect-confirm"
          title={t("framework.connectConfirmTitle")}
          icon={<TriangleAlert size={20} strokeWidth={1.5} className="text-changed" />}
          banner={
            <div className="flex flex-col gap-1.5 text-caption">
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 whitespace-nowrap text-fine text-ink-tertiary">
                  {t("framework.connectConfirmGuided")}
                </span>
                <span
                  title={origin.path}
                  className="truncate rounded-full border border-accent-tint-border bg-accent-tint px-2 py-0.5 text-fine text-accent"
                >
                  {lastSeg(origin.path)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 whitespace-nowrap text-fine text-ink-tertiary">
                  {t("framework.connectConfirmChosen")}
                </span>
                <span
                  title={`${pendingConfirm.meta.categoryPath ?? ""}/${pendingConfirm.map.name}`}
                  className="truncate rounded-full border border-changed/40 bg-changed/10 px-2 py-0.5 text-fine text-changed"
                >
                  {lastSeg(pendingConfirm.meta.categoryPath ?? "")} · {pendingConfirm.map.name}
                </span>
              </div>
            </div>
          }
          message={t("framework.connectConfirmLine")}
          confirmLabel={t("framework.connectAnyway")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const { map, meta } = pendingConfirm;
            setPendingConfirm(null);
            onConnect(map, meta);
          }}
          onClose={() => setPendingConfirm(null)}
        />
      )}
    </>
  );
}

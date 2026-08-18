"use client";

// NEW 인스펙터 맵 탭(좁은 폭) — 가시성 · 멤버(허용 인원) · 설명. 목업 inspector-map-tab 순서.
// 멤버 카드는 MapDetailCard(only="members")로 OLD '허용 인원' 디자인을 그대로 재사용(아코디언). 가시성/설명은 getMap.
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Globe, Lock } from "lucide-react";

import {
  getDirectory,
  getMap,
  getPendingVisibilityRequest,
  listApprovers,
  requestVisibilityChange,
  updateMap,
  type ApprovalRequest,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { MapDetailCard } from "@/components/maps/map-detail-card";
import { MapNotesSection } from "@/components/maps/map-notes-section";
import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n";

interface MapInspectorTabProps {
  mapId: number;
  readOnly: boolean;
}

const VISIBILITY_ICON = { public: Globe, private: Lock } as const;
const visibilityLabelKey = (v: "public" | "private") =>
  v === "public" ? ("perm.visibilityPublic" as const) : ("perm.visibilityPrivate" as const);

export function MapInspectorTab({ mapId, readOnly }: MapInspectorTabProps) {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [myRole, setMyRole] = useState<"viewer" | "editor" | "owner" | null>(null);
  const [description, setDescription] = useState("");
  const loadedFor = useRef<number | null>(null);

  // pending 가시성 변경 요청 — 오너 비현재 버튼 disabled + pill 게이팅 (R2: 서버 진실, 낙관적 적용 금지)
  const [pendingReq, setPendingReq] = useState<ApprovalRequest | null>(null);

  // 워크플로 시작 모달 — target=전환 대상 가시성, null이면 닫힘
  const [modalTarget, setModalTarget] = useState<"public" | "private" | null>(null);
  const [approverNames, setApproverNames] = useState<string[]>([]);
  const [approversLoading, setApproversLoading] = useState(false);
  // 승인자 조회 실패(네트워크 등) — "승인자 0명" 경고와 구분해서 표시(오탐지 방지, 리뷰 픽스)
  const [approversError, setApproversError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loadedFor.current === mapId) return;
    // mapId 전환(서브프로세스 링크맵 열기·브라우저 뒤로/앞으로) 시 모달을 강제 리셋 —
    // 열린 채로 넘어오면 stale modalTarget이 새 맵에 confirm을 쏘는 사고 방지.
    setModalTarget(null);
    setApproverNames([]);
    setApproversLoading(false);
    setApproversError(null);
    setModalError(null);
    setSubmitting(false);
    let active = true;
    void Promise.all([getMap(mapId), getPendingVisibilityRequest(mapId)])
      .then(([detail, pending]) => {
        if (!active) return;
        setVisibility(detail.visibility);
        setMyRole(detail.my_role);
        setDescription(detail.description);
        setPendingReq(pending);
        loadedFor.current = mapId;
      })
      .catch(() => {
        // 조회 실패는 섹션만 비표시 — pending 복원 실패는 요청 시 서버 409가 재차 방어
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  // 비현재 아이콘 클릭 — 모달 오픈 + 승인자 목록(id→이름) 조회
  function handleOpenVisibilityModal(target: "public" | "private") {
    setModalTarget(target);
    setModalError(null);
    setApproverNames([]);
    setApproversError(null);
    setApproversLoading(true);
    void Promise.all([listApprovers(mapId), getDirectory()])
      .then(([ids, dir]) => {
        setApproverNames(ids.map((id) => dir.users.find((u) => u.id === id)?.name ?? id));
      })
      .catch((err) => {
        // 조회 실패는 "승인자 0명"과 다른 원인(일시적 장애) — 별도 에러로 표시, confirm은 동일하게 비활성 유지
        setApproversError(humanizeApiError(err, t));
      })
      .finally(() => setApproversLoading(false));
  }

  async function handleConfirmVisibilityChange() {
    if (!modalTarget) return;
    setSubmitting(true);
    setModalError(null);
    try {
      const req = await requestVisibilityChange(mapId, modalTarget);
      setPendingReq(req);
      setModalTarget(null);
    } catch (err) {
      // 막다른 상태 금지(R2) — 에러 문구 표시 + pending 재조회로 UI를 서버 진실에 동기화
      setModalError(humanizeApiError(err, t));
      void getPendingVisibilityRequest(mapId)
        .then(setPendingReq)
        .catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  }

  const isOwner = myRole === "owner";
  const other: "public" | "private" = visibility === "public" ? "private" : "public";
  const CurrentIcon = VISIBILITY_ICON[visibility];
  const OtherIcon = VISIBILITY_ICON[other];

  return (
    <div className="flex flex-col gap-4">
      {/* 가시성 — 3:1(현재/전환) 레이아웃은 전원 공통, 전환 인터랙션(버튼+모달)만 오너 전용 */}
      <section>
        <div className="mb-1 flex items-center justify-between text-fine text-ink-tertiary">
          <span>{t("inspector.visibility")}</span>
          {isOwner && pendingReq && (
            <span className="rounded-full border border-changed px-1.5 py-0.5 text-fine text-changed">
              {t("perm.pending.tag")}
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <div className="col-span-3 flex items-center justify-center gap-1.5 rounded-sm border border-accent bg-accent-tint px-2 py-1.5 text-caption font-medium text-accent">
            <CurrentIcon size={14} strokeWidth={1.5} />
            {t(visibilityLabelKey(visibility))}
          </div>
          {isOwner ? (
            <button
              type="button"
              data-id="inspector-visibility-switch"
              title={t(visibilityLabelKey(other))}
              disabled={!!pendingReq}
              className="col-span-1 flex items-center justify-center rounded-sm border border-hairline px-2 py-1.5 text-ink-tertiary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => handleOpenVisibilityModal(other)}
            >
              <OtherIcon size={14} strokeWidth={1.5} />
            </button>
          ) : (
            <div
              title={t(visibilityLabelKey(other))}
              className="col-span-1 flex items-center justify-center rounded-sm border border-hairline px-2 py-1.5 text-ink-tertiary"
            >
              <OtherIcon size={14} strokeWidth={1.5} />
            </div>
          )}
        </div>
      </section>

      {/* 멤버(허용 인원) — 코멘트 영역처럼 테두리 박스로 감싸 분리. 카드 디자인은 OLD MapDetailCard 재사용(클릭 펼침·역할 배지).
          기본 펼침 (R2 QA 피드백) */}
      <details open className="group rounded-md border border-hairline px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-fine font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight size={12} strokeWidth={1.5} className="transition-transform group-open:rotate-90" />
          {t("inspector.collaborators")}
        </summary>
        <div className="mt-2">
          <MapDetailCard mapId={mapId} only="members" showFooter={false} />
        </div>
      </details>

      {/* 설명 */}
      <section>
        <div className="mb-1 text-fine text-ink-tertiary">{t("field.description")}</div>
        <textarea
          className="h-20 w-full resize-none rounded-sm border border-hairline px-2 py-1.5 text-caption"
          value={description}
          disabled={readOnly}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => void updateMap(mapId, { description })}
        />
      </section>

      {/* 인터뷰 노트(예외 규칙·VOC) — 노트 없으면 자체 숨김 */}
      <MapNotesSection mapId={mapId} />

      {modalTarget && (
        <ConfirmDialog
          dialogId="inspector-visibility-dialog"
          icon={<OtherIcon size={28} strokeWidth={1.5} />}
          title={t("inspector.visibilityChangeTitle")}
          sections={[
            [
              { icon: <CurrentIcon size={14} strokeWidth={1.5} />, text: t(visibilityLabelKey(visibility)), tone: "muted" },
              { icon: <OtherIcon size={14} strokeWidth={1.5} />, text: t(visibilityLabelKey(modalTarget)), tone: "accent", highlight: true },
            ] satisfies ConfirmLine[],
          ]}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          confirmDisabled={approversLoading || approverNames.length === 0 || !!approversError || submitting}
          onConfirm={() => void handleConfirmVisibilityChange()}
          onClose={() => setModalTarget(null)}
        >
          <div className="flex w-full flex-col items-center gap-1.5">
            <p className="text-fine text-ink-tertiary">{t("inspector.visibilityApprovers")}</p>
            {approverNames.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-1">
                {approverNames.map((name, i) => (
                  <span key={i} className="rounded-full bg-surface-alt px-2 py-0.5 text-fine text-ink">
                    {name}
                  </span>
                ))}
              </div>
            ) : approversError ? (
              <p className="text-fine text-error">{approversError}</p>
            ) : (
              !approversLoading && <p className="text-fine text-error">{t("inspector.visibilityNoApprovers")}</p>
            )}
            {approverNames.length > 0 && (
              <p className="text-fine text-ink-tertiary">{t("inspector.visibilityApprovalNote")}</p>
            )}
            {modalError && <p className="text-fine text-error">{modalError}</p>}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

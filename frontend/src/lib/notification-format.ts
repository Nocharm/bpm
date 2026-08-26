// 알림 렌더 포맷 — type+payload를 언어 토글에 맞는 {label(유형 칩)·title(제목)·body(상세)}로.
// payload 없는 레거시 행은 영어 message 원문 폴백 (design 2026-08-26).

import {
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  CircleAlert,
  CircleCheck,
  CircleX,
  Copy,
  FileCheck,
  Megaphone,
  MessageSquareReply,
  Network,
  PencilLine,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import type { NotificationItem, NotificationPayload } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";

export interface NotificationView {
  /** 유형 칩 라벨 (언어별) */
  label: string;
  /** 제목 — 맵 이름(맵 알림) 또는 공지 제목/유형 라벨 */
  title: string;
  /** 상세 문장 (언어별). 레거시 행은 영어 message 원문 */
  body: string;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

// notifLabel.*·notifBody.* 키가 존재하는 유형 — 미지 유형은 unknown 라벨+원문 폴백
const KNOWN_TYPES = new Set([
  "published", "approved", "rejected", "review_requested", "approval_cancelled",
  "checkout_requested", "checkout_approved", "checkout_rejected",
  "map_renamed", "rename_requested", "rename_approved", "rename_rejected", "rename_superseded",
  "sp_designation_requested", "sp_designation_approved", "sp_designation_rejected",
  "subprocess_registered",
  "permission_requested", "permission_approved", "permission_rejected", "permission_superseded",
  "map_copied", "map_retired", "feedback_reply", "feedback_status", "notice",
]);

// 기계 코드 사유(bundled/direct/auto)는 번역, 자유 텍스트(거절 사유)는 원문 유지
const REASON_CODES = new Set(["bundled", "direct", "auto"]);

// 사유를 말미에 덧붙이는 유형 — 결정/대체 계열
const REASON_SUFFIX_TYPES = new Set([
  "rejected", "rename_approved", "rename_rejected",
  "sp_designation_approved", "sp_designation_rejected",
  "permission_approved", "permission_rejected", "permission_superseded",
  "checkout_rejected",
]);

function formatVersion(p: NotificationPayload): string {
  if (!p.version_label) return "";
  const num = p.version_number ? ` (v${p.version_number})` : "";
  return `'${p.version_label}'${num}`;
}

export function getNotificationIcon(type: string): LucideIcon {
  if (type === "published") return BadgeCheck;
  if (type === "approved") return CircleCheck;
  if (type === "rejected") return CircleX;
  if (type === "review_requested") return FileCheck;
  if (type === "approval_cancelled") return CircleAlert;
  if (type.startsWith("checkout_")) return ArrowLeftRight;
  if (type === "map_renamed" || type.startsWith("rename_")) return PencilLine;
  if (type.startsWith("permission_")) return ShieldCheck;
  if (type.startsWith("sp_designation") || type === "subprocess_registered") return Network;
  if (type === "map_copied") return Copy;
  if (type === "map_retired") return Trash2;
  if (type.startsWith("feedback_")) return MessageSquareReply;
  if (type === "notice") return Megaphone;
  return Bell;
}

// 리치 렌더로 치환 가능한 변수 — 파츠 분할 시 센티널로 대체된다
type RichVar = "actor" | "version" | "from" | "to" | "copy" | "snippet";

function buildBody(
  item: NotificationItem,
  t: Translate,
  overrides: Partial<Record<RichVar, string>> = {},
): string {
  const p = item.payload as NotificationPayload;
  const vars: Record<string, string | number> = {
    map: p.map_name ?? "",
    version: overrides.version ?? formatVersion(p),
    actor: overrides.actor ?? p.actor_name ?? p.actor ?? "",
    from: overrides.from ?? p.from_name ?? "",
    to: overrides.to ?? p.to_name ?? "",
    copy: overrides.copy ?? p.copy_name ?? "",
    snippet: overrides.snippet ?? p.snippet ?? "",
    status: p.status_label ?? "",
  };
  // permission_requested는 kind(visibility_change)별 문구 분기
  const bodyKey =
    item.type === "permission_requested" && p.kind === "visibility_change"
      ? "notifBody.permission_requested_visibility"
      : `notifBody.${item.type}`;
  let body = t(bodyKey as MessageKey, vars);
  if (p.reason && REASON_SUFFIX_TYPES.has(item.type)) {
    const reasonText = REASON_CODES.has(p.reason)
      ? t(`notifReason.${p.reason}` as MessageKey)
      : p.reason;
    body = `${body} — ${reasonText}`;
  }
  return body;
}

export function formatNotification(item: NotificationItem, t: Translate): NotificationView {
  const known = KNOWN_TYPES.has(item.type);
  const label = t((known ? `notifLabel.${item.type}` : "notifLabel.unknown") as MessageKey);
  const p = item.payload;
  if (!p || !known) {
    // 레거시 행·미지 유형 — 저장된 영어 message 원문 폴백
    return { label, title: label, body: item.message };
  }

  if (item.type === "notice") {
    return { label, title: p.title ?? item.message, body: "" };
  }

  const body = buildBody(item, t);
  const title = item.type.startsWith("feedback_") ? label : p.map_name || label;
  return { label, title, body };
}

/** 상세 문장의 리치 렌더 파츠 — {actor}는 유저 필, {version}은 버전 칩,
 *  따옴표로 감싸던 나머지({from}/{to}/{copy}/{snippet})는 텍스트 칩 자리로 분할.
 *  치환 대상이 없으면(레거시·공지) 전체 문장 1파츠. 감싸던 따옴표는 칩이 대신하므로 제거. */
export type NotificationBodyPart =
  | string
  | { actorLogin: string; actorName?: string }
  | { versionLabel: string; versionNumber?: number | null }
  | { chip: string };

// 번역 문구에 등장할 수 없는 구분자들 — RichVar별 1:1
const SENTINELS: Record<RichVar, string> = {
  actor: "⟬actor⟭",
  version: "⟬version⟭",
  from: "⟬from⟭",
  to: "⟬to⟭",
  copy: "⟬copy⟭",
  snippet: "⟬snippet⟭",
};
const SENTINEL_SPLIT = /(⟬actor⟭|⟬version⟭|⟬from⟭|⟬to⟭|⟬copy⟭|⟬snippet⟭)/;

export function formatNotificationBodyParts(
  item: NotificationItem,
  t: Translate,
): NotificationBodyPart[] {
  const p = item.payload;
  const richValues: Partial<Record<RichVar, string>> = p
    ? {
        actor: p.actor ?? undefined,
        version: p.version_label ?? undefined,
        from: p.from_name ?? undefined,
        to: p.to_name ?? undefined,
        copy: p.copy_name ?? undefined,
        snippet: p.snippet ?? undefined,
      }
    : {};
  const hasRich = Object.values(richValues).some(Boolean);
  if (!p || !KNOWN_TYPES.has(item.type) || item.type === "notice" || !hasRich) {
    const { body } = formatNotification(item, t);
    return body ? [body] : [];
  }
  const overrides: Partial<Record<RichVar, string>> = {};
  for (const key of Object.keys(SENTINELS) as RichVar[]) {
    if (richValues[key]) overrides[key] = SENTINELS[key];
  }
  let withSentinels = buildBody(item, t, overrides);
  // 템플릿이 감싸던 따옴표('…'/"…")는 칩이 구분을 대신하므로 제거
  for (const sentinel of Object.values(SENTINELS)) {
    withSentinels = withSentinels
      .replaceAll(`'${sentinel}'`, sentinel)
      .replaceAll(`"${sentinel}"`, sentinel);
  }
  return withSentinels
    .split(SENTINEL_SPLIT)
    .filter((seg) => seg !== "")
    .map((seg): NotificationBodyPart => {
      if (seg === SENTINELS.actor && p.actor) {
        return { actorLogin: p.actor, actorName: p.actor_name };
      }
      if (seg === SENTINELS.version && p.version_label) {
        return { versionLabel: p.version_label, versionNumber: p.version_number };
      }
      if (seg === SENTINELS.from && p.from_name) return { chip: p.from_name };
      if (seg === SENTINELS.to && p.to_name) return { chip: p.to_name };
      if (seg === SENTINELS.copy && p.copy_name) return { chip: p.copy_name };
      if (seg === SENTINELS.snippet && p.snippet) return { chip: p.snippet };
      return seg;
    });
}

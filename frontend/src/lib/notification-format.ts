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

  const vars: Record<string, string | number> = {
    map: p.map_name ?? "",
    version: formatVersion(p),
    actor: p.actor_name || p.actor || "",
    from: p.from_name ?? "",
    to: p.to_name ?? "",
    copy: p.copy_name ?? "",
    snippet: p.snippet ?? "",
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

  const title = item.type.startsWith("feedback_") ? label : p.map_name || label;
  return { label, title, body };
}

// 알림 type → 카테고리 매핑 — 인박스 필 필터 공용 (design 2026-07-16)

export type NotificationCategory = "version" | "checkout" | "permission" | "subprocess" | "notice";

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "version",
  "checkout",
  "permission",
  "subprocess",
  "notice",
];

const VERSION_TYPES = new Set([
  "review_requested",
  "approved",
  "rejected",
  "published",
  "approval_cancelled",
]);

export function getNotificationCategory(type: string): NotificationCategory | null {
  if (VERSION_TYPES.has(type)) return "version";
  if (type.startsWith("checkout_")) return "checkout";
  if (type.startsWith("permission_")) return "permission";
  if (type.startsWith("rename_") || type === "map_renamed") return "permission";
  if (type === "subprocess_registered") return "subprocess";
  if (type === "notice") return "notice";
  return null; // 미지 type — All에서만 노출
}

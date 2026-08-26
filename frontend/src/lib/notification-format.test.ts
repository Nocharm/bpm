// 알림 렌더 포맷 — 언어 토글 렌더·레거시 폴백·사유 처리 계약 (design 2026-08-26)
import { describe, expect, it } from "vitest";

import type { NotificationItem } from "@/lib/api";
import { messages, type Lang, type MessageKey } from "@/lib/i18n-messages";
import { formatNotification, formatNotificationBodyParts } from "@/lib/notification-format";

const makeT = (lang: Lang) => (key: MessageKey, vars?: Record<string, string | number>) => {
  let str: string = messages[lang][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
};

const base: Omit<NotificationItem, "type" | "message" | "payload"> = {
  id: 1, map_id: 10, version_id: 20, read: false, created_at: "2026-08-26T10:00:00+09:00",
};

describe("formatNotification", () => {
  it("published — 제목=맵 이름, 본문에 버전(v번호)·행위자, 언어 토글 반영", () => {
    const item: NotificationItem = {
      ...base, type: "published", message: "'Release 5' was published",
      payload: { map_name: "Vendor Management", version_label: "Release 5",
                 version_number: 5, actor: "kim.a", actor_name: "Kim A" },
    };
    const en = formatNotification(item, makeT("en"));
    expect(en.title).toBe("Vendor Management");
    expect(en.body).toBe("Kim A published 'Release 5' (v5)");
    const ko = formatNotification(item, makeT("ko"));
    expect(ko.label).toBe("게시됨");
    expect(ko.body).toBe("Kim A님이 'Release 5' (v5)을 게시했습니다");
  });

  it("rejected — 자유 텍스트 사유는 원문으로 말미 동봉", () => {
    const item: NotificationItem = {
      ...base, type: "rejected", message: "x",
      payload: { map_name: "M", version_label: "As-Is", version_number: null,
                 actor_name: "Lee B", reason: "숫자 파라미터 누락" },
    };
    const ko = formatNotification(item, makeT("ko"));
    expect(ko.body).toBe("Lee B님이 'As-Is'을 반려했습니다 — 숫자 파라미터 누락");
  });

  it("permission_superseded — 기계 코드 사유는 번역", () => {
    const item: NotificationItem = {
      ...base, type: "permission_superseded", message: "x",
      payload: { map_name: "M", reason: "bundled" },
    };
    expect(formatNotification(item, makeT("en")).body).toBe(
      "Your permission request was superseded — bundled with a version submission",
    );
  });

  it("permission_requested — kind=visibility_change 문구 분기", () => {
    const item: NotificationItem = {
      ...base, type: "permission_requested", message: "x",
      payload: { map_name: "M", actor_name: "Kim A", kind: "visibility_change" },
    };
    expect(formatNotification(item, makeT("en")).body).toBe("Kim A requested a visibility change");
  });

  it("notice — 제목=공지 제목 원문(비표준 텍스트는 번역하지 않음)", () => {
    const item: NotificationItem = {
      ...base, type: "notice", message: "8월 정기 점검 안내",
      payload: { title: "8월 정기 점검 안내" },
    };
    const view = formatNotification(item, makeT("en"));
    expect(view.title).toBe("8월 정기 점검 안내");
    expect(view.body).toBe("");
  });

  it("레거시 행(payload 없음) — message 원문 폴백", () => {
    const item: NotificationItem = {
      ...base, type: "published", message: "'Release 5' was published", payload: null,
    };
    const view = formatNotification(item, makeT("ko"));
    expect(view.label).toBe("게시됨");
    expect(view.body).toBe("'Release 5' was published");
  });

  it("미지 유형 — unknown 라벨 + message 원문", () => {
    const item: NotificationItem = {
      ...base, type: "future_type", message: "raw text", payload: { map_name: "M" },
    };
    const view = formatNotification(item, makeT("en"));
    expect(view.label).toBe("Notification");
    expect(view.body).toBe("raw text");
  });
});

describe("formatNotificationBodyParts", () => {
  it("행위자 자리를 파츠로 분할 — [앞, {actorLogin}, 뒤]", () => {
    const item: NotificationItem = {
      ...base, type: "published", message: "x",
      payload: { map_name: "M", version_label: "R5", version_number: 5,
                 actor: "kim.a", actor_name: "Kim A" },
    };
    const parts = formatNotificationBodyParts(item, makeT("ko"));
    expect(parts).toEqual([
      { actorLogin: "kim.a", actorName: "Kim A" },
      "님이 ",
      { versionLabel: "R5", versionNumber: 5 },
      "을 게시했습니다",
    ]);
    const en = formatNotificationBodyParts(item, makeT("en"));
    expect(en).toEqual([
      { actorLogin: "kim.a", actorName: "Kim A" },
      " published ",
      { versionLabel: "R5", versionNumber: 5 },
    ]);
  });

  it("행위자 없는 유형은 버전 칩만, 레거시는 전체 문장 1파츠", () => {
    const noActor: NotificationItem = {
      ...base, type: "approved", message: "x",
      payload: { map_name: "M", version_label: "R5", version_number: null },
    };
    expect(formatNotificationBodyParts(noActor, makeT("en"))).toEqual([
      { versionLabel: "R5", versionNumber: null },
      " is fully approved — ready to publish",
    ]);
    const legacy: NotificationItem = { ...base, type: "published", message: "raw", payload: null };
    expect(formatNotificationBodyParts(legacy, makeT("en"))).toEqual(["raw"]);
  });

  it("이름 변경 — from/to가 텍스트 칩으로, 감싸던 따옴표는 제거", () => {
    const item: NotificationItem = {
      ...base, type: "map_renamed", message: "x",
      payload: { map_name: "New", from_name: "Old", to_name: "New",
                 actor: "kim.a", actor_name: "Kim A" },
    };
    expect(formatNotificationBodyParts(item, makeT("en"))).toEqual([
      { actorLogin: "kim.a", actorName: "Kim A" },
      " renamed ",
      { chip: "Old", kind: "name" },
      " to ",
      { chip: "New", kind: "name" },
    ]);
  });

  it("피드백 인용 — snippet 칩, 큰따옴표 제거", () => {
    const item: NotificationItem = {
      ...base, type: "feedback_reply", message: "x",
      payload: { snippet: "빠른 답변 감사합니다", kind: "reply" },
    };
    expect(formatNotificationBodyParts(item, makeT("ko"))).toEqual([
      "피드백에 답글이 달렸습니다 — ",
      { chip: "빠른 답변 감사합니다", kind: "quote" },
    ]);
  });
});

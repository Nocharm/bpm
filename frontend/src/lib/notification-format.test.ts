// 알림 렌더 포맷 — 언어 토글 렌더·레거시 폴백·사유 처리 계약 (design 2026-08-26)
import { describe, expect, it } from "vitest";

import { AlertTriangle, Bell, ClipboardList, ListChecks } from "lucide-react";

import type { NotificationItem, NotificationMapEntry, NotificationPayload } from "@/lib/api";
import { messages, type Lang, type MessageKey } from "@/lib/i18n-messages";
import {
  formatNotification,
  formatNotificationBodyParts,
  getNotificationIcon,
  getRunNotificationHref,
  sumRefFixCounts,
} from "@/lib/notification-format";

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
  it("fw_external_linked - 제목=캔버스 이름, 본문에 행위자·전달 L5·연결 L6·개수, 칩 분할", () => {
    const item: NotificationItem = {
      ...base, type: "fw_external_linked", version_id: null,
      message: "Kim A delivered 'QA deviation' - 2 placeholder(s) on 'Change control linkage' now link to 'Deviation closure'",
      payload: { map_name: "공정 변경관리 실행 연계", actor: "kim.a", actor_name: "Kim A",
                 from_name: "시험 일탈·OOS 관리", to_name: "일탈 종결 및 효과성 평가", count: 2 },
    };
    const en = formatNotification(item, makeT("en"));
    expect(en.label).toBe("External L6 linked");
    expect(en.title).toBe("공정 변경관리 실행 연계");
    expect(en.body).toBe("Kim A delivered '시험 일탈·OOS 관리' - 2 placeholder(s) on this canvas now link to '일탈 종결 및 효과성 평가'");
    const ko = formatNotification(item, makeT("ko"));
    expect(ko.body).toBe("Kim A님이 '시험 일탈·OOS 관리'을(를) 전달해 이 캔버스의 자리표 2개가 '일탈 종결 및 효과성 평가'에 연결되었습니다");
    const parts = formatNotificationBodyParts(item, makeT("en"));
    expect(parts).toContainEqual({ actorLogin: "kim.a", actorName: "Kim A" });
    expect(parts).toContainEqual({ chip: "시험 일탈·OOS 관리", kind: "name" });
    expect(parts).toContainEqual({ chip: "일탈 종결 및 효과성 평가", kind: "name" });
  });

  it("published - 제목=맵 이름, 본문에 버전(v번호)·행위자, 언어 토글 반영", () => {
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

  it("rejected - 자유 텍스트 사유는 원문으로 말미 동봉", () => {
    const item: NotificationItem = {
      ...base, type: "rejected", message: "x",
      payload: { map_name: "M", version_label: "As-Is", version_number: null,
                 actor_name: "Lee B", reason: "숫자 파라미터 누락" },
    };
    const ko = formatNotification(item, makeT("ko"));
    expect(ko.body).toBe("Lee B님이 'As-Is'을 거절했습니다 - 숫자 파라미터 누락");
  });

  it("permission_superseded - 기계 코드 사유는 번역", () => {
    const item: NotificationItem = {
      ...base, type: "permission_superseded", message: "x",
      payload: { map_name: "M", reason: "bundled" },
    };
    expect(formatNotification(item, makeT("en")).body).toBe(
      "Your permission request was superseded - bundled with a version submission",
    );
  });

  it("permission_requested - kind=visibility_change 문구 분기", () => {
    const item: NotificationItem = {
      ...base, type: "permission_requested", message: "x",
      payload: { map_name: "M", actor_name: "Kim A", kind: "visibility_change" },
    };
    expect(formatNotification(item, makeT("en")).body).toBe("Kim A requested a visibility change");
  });

  it("notice - 제목=공지 제목 원문(비표준 텍스트는 번역하지 않음)", () => {
    const item: NotificationItem = {
      ...base, type: "notice", message: "8월 정기 점검 안내",
      payload: { title: "8월 정기 점검 안내" },
    };
    const view = formatNotification(item, makeT("en"));
    expect(view.title).toBe("8월 정기 점검 안내");
    expect(view.body).toBe("");
  });

  it("레거시 행(payload 없음) - message 원문 폴백", () => {
    const item: NotificationItem = {
      ...base, type: "published", message: "'Release 5' was published", payload: null,
    };
    const view = formatNotification(item, makeT("ko"));
    expect(view.label).toBe("게시됨");
    expect(view.body).toBe("'Release 5' was published");
  });

  it("미지 유형 - unknown 라벨 + message 원문", () => {
    const item: NotificationItem = {
      ...base, type: "future_type", message: "raw text", payload: { map_name: "M" },
    };
    const view = formatNotification(item, makeT("en"));
    expect(view.label).toBe("Notification");
    expect(view.body).toBe("raw text");
  });

  it("fw_confirm_requested - 상위 관리자가 직속 L5 관리자에게 확정 요청", () => {
    const item: NotificationItem = {
      ...base, type: "fw_confirm_requested", message: "x",
      payload: { map_name: "Framework A", actor: "kim.a", actor_name: "Kim A" },
    };
    const en = formatNotification(item, makeT("en"));
    expect(en.label).toBe("Confirm request");
    expect(en.body).toBe("Kim A requested to confirm this map");
    const ko = formatNotification(item, makeT("ko"));
    expect(ko.body).toBe("Kim A님이 이 맵의 확정을 요청했습니다");
  });

  it("fw_confirm_done - 사유 없음(승인)", () => {
    const item: NotificationItem = {
      ...base, type: "fw_confirm_done", message: "x",
      payload: { map_name: "Framework A", actor: "lee.b", actor_name: "Lee B",
                 outcome: "approved", reason: null },
    };
    expect(formatNotification(item, makeT("en")).body).toBe("Your confirm request was approved");
  });

  it("fw_confirm_rejected - 거절 사유는 말미에 동봉", () => {
    const item: NotificationItem = {
      ...base, type: "fw_confirm_rejected", message: "x",
      payload: { map_name: "Framework A", actor: "lee.b", actor_name: "Lee B",
                 outcome: "rejected", reason: "카테고리 재검토 필요" },
    };
    expect(formatNotification(item, makeT("en")).body).toBe(
      "Your confirm request was rejected - 카테고리 재검토 필요",
    );
  });
});

describe("formatNotificationBodyParts", () => {
  it("행위자 자리를 파츠로 분할 - [앞, {actorLogin}, 뒤]", () => {
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
      " is fully approved - ready to publish",
    ]);
    const legacy: NotificationItem = { ...base, type: "published", message: "raw", payload: null };
    expect(formatNotificationBodyParts(legacy, makeT("en"))).toEqual(["raw"]);
  });

  it("이름 변경 - from/to가 텍스트 칩으로, 감싸던 따옴표는 제거", () => {
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

  it("피드백 인용 - snippet 칩, 큰따옴표 제거", () => {
    const item: NotificationItem = {
      ...base, type: "feedback_reply", message: "x",
      payload: { snippet: "빠른 답변 감사합니다", kind: "reply" },
    };
    expect(formatNotificationBodyParts(item, makeT("ko"))).toEqual([
      "피드백에 답글이 달렸습니다 - ",
      { chip: "빠른 답변 감사합니다", kind: "quote" },
    ]);
  });

  it("ref_fix_requested - 라벨·본문에 행위자·맵 수, 제목은 라벨(복수 맵)", () => {
    const item: NotificationItem = {
      ...base, type: "ref_fix_requested", map_id: null, version_id: null,
      message: "Junho Kim asked you to fix stale department/assignee references in 2 map(s)",
      payload: { actor: "admin.kim", actor_name: "Junho Kim", count: 2, as: "owner",
                 maps: [{ id: 1, name: "Order intake", node_dept: 3, node_assignee: 0, sp_dept: 0, sp_assignee: 1 },
                        { id: 2, name: "Refund", node_dept: 0, node_assignee: 2, sp_dept: 0, sp_assignee: 0 }] },
    };
    const en = formatNotification(item, makeT("en"));
    expect(en.label).toBe("Stale references");
    expect(en.title).toBe("Stale references");
    expect(en.body).toBe("Junho Kim asked you to fix department or assignee references that no longer match the current org in 2 map(s)");
    expect(formatNotificationBodyParts(item, makeT("en"))).toContainEqual({ actorLogin: "admin.kim", actorName: "Junho Kim" });
  });

  it("owner_assigned - 제목=맵 이름, 본문에 행위자·이전 오너 칩", () => {
    const item: NotificationItem = {
      ...base, type: "owner_assigned", version_id: null,
      message: "Junho Kim made you the owner of 'Refund' (previous owner Gone Person has left)",
      payload: { map_name: "Refund", actor: "admin.kim", actor_name: "Junho Kim", from_name: "Gone Person" },
    };
    const en = formatNotification(item, makeT("en"));
    expect(en.title).toBe("Refund");
    expect(en.body).toBe("Junho Kim made you the owner of this map - previous owner 'Gone Person' has left");
    expect(formatNotificationBodyParts(item, makeT("en"))).toContainEqual({ chip: "Gone Person", kind: "name" });
  });
});

describe("sumRefFixCounts", () => {
  it("맵 항목의 곳 수 키 8종을 모두 더한다", () => {
    const entry: NotificationMapEntry = {
      id: 1, name: "Order intake",
      node_dept: 1, node_assignee: 2, sp_dept: 3, sp_assignee: 4,
      owning_dept: 5, map_approver: 6, map_grant: 7, map_collab: 8,
    };
    expect(sumRefFixCounts(entry)).toBe(36);
  });
  it("옛 알림(키 4개)은 빠진 키를 0으로 센다", () => {
    expect(sumRefFixCounts({ id: 2, name: "Refund", node_dept: 3, node_assignee: 0, sp_dept: 0, sp_assignee: 1 })).toBe(4);
  });
});

// 실행 체크(Run) 알림 — 유형 7종 렌더·숨은 노드 변형·딥링크 (design 2026-11-04 §4.5)
describe("run notifications", () => {
  const runBase: Omit<NotificationItem, "type" | "message" | "payload"> = {
    id: 5, map_id: 3, version_id: 9, read: false, created_at: "2026-11-04T10:00:00+09:00",
  };
  const makeRun = (type: string, payload: NotificationPayload): NotificationItem => ({
    ...runBase, type, message: "fallback", payload: {
      map_name: "시험 일탈 관리", run_id: 21, run_name: "11월 점검", actor: "park.s", actor_name: "박서연", ...payload,
    },
  });
  const ko = makeT("ko");
  const en = makeT("en");

  it("라벨 - 7종 모두 언어별 라벨이 있고 미지 라벨로 떨어지지 않는다", () => {
    const labels = {
      run_invited: "실행 초대", run_steps_done: "실행 단계 완료", run_problem: "실행 문제",
      run_resolved: "문제 해결", run_finished: "실행 완료", run_stopped: "실행 중단", run_idle_warning: "자동 중단 예정",
    };
    for (const [type, label] of Object.entries(labels)) {
      expect(formatNotification(makeRun(type, {}), ko).label).toBe(label);
      expect(formatNotification(makeRun(type, {}), en).label).not.toBe("Notification");
    }
  });

  it("run_invited - 제목=맵 이름, 본문에 행위자·실행 이름", () => {
    const view = formatNotification(makeRun("run_invited", {}), ko);
    expect(view.title).toBe("시험 일탈 관리");
    expect(view.body).toBe("박서연 님이 '11월 점검' 실행에 초대했어요");
  });

  it("run_steps_done - 1명이면 단일 문구, 2명 이상이면 외 N명 문구", () => {
    const one = makeRun("run_steps_done", { count: 3, actors: ["park.s"], node_title: "시료 채취" });
    expect(formatNotification(one, ko).body).toBe("박서연 님이 단계 3개를 완료했어요 · 최근: 시료 채취");
    const many = makeRun("run_steps_done", { count: 3, actors: ["lee.j", "kim.a", "park.s"], node_title: "시료 채취" });
    expect(formatNotification(many, ko).body).toBe("박서연 님 외 2명이 단계 3개를 완료했어요 · 최근: 시료 채취");
    expect(formatNotification(many, en).body).toBe("박서연 and 2 other(s) completed 3 step(s) · Latest: 시료 채취");
  });

  it("run_steps_done - node_title이 없으면(숨은 범위) 최근 구절 없는 변형", () => {
    const one = makeRun("run_steps_done", { count: 2, actors: ["park.s"] });
    expect(formatNotification(one, ko).body).toBe("박서연 님이 단계 2개를 완료했어요");
    const many = makeRun("run_steps_done", { count: 4, actors: ["lee.j", "park.s"] });
    expect(formatNotification(many, ko).body).toBe("박서연 님 외 1명이 단계 4개를 완료했어요");
    expect(formatNotification(many, ko).body).not.toContain("최근");
  });

  it("run_problem - 노드가 보이면 노드 이름, 안 보이면 노드 없는 문구", () => {
    const seen = makeRun("run_problem", { node_title: "시료 채취" });
    expect(formatNotification(seen, ko).body).toBe("박서연 님이 '시료 채취'에 문제를 표시했어요");
    const hidden = makeRun("run_problem", {});
    expect(formatNotification(hidden, ko).body).toBe("박서연 님이 문제를 표시했어요");
  });

  it("run_problem - snippet은 말미에 붙고 파츠로는 인용 칩이 된다", () => {
    const item = makeRun("run_problem", { node_title: "시료 채취", snippet: "시약이 모자라요" });
    expect(formatNotification(item, ko).body).toBe("박서연 님이 '시료 채취'에 문제를 표시했어요 · \"시약이 모자라요\"");
    const parts = formatNotificationBodyParts(item, ko);
    expect(parts).toContainEqual({ chip: "시약이 모자라요", kind: "quote" });
    expect(parts).toContainEqual({ chip: "시료 채취", kind: "name" });
    expect(parts).toContainEqual({ actorLogin: "park.s", actorName: "박서연" });
    expect(parts.some((part) => typeof part === "string" && part.includes("'"))).toBe(false);
  });

  it("run_resolved - 노드 유무 두 문구", () => {
    expect(formatNotification(makeRun("run_resolved", { node_title: "시료 채취" }), ko).body)
      .toBe("박서연 님이 '시료 채취' 문제를 해결했어요");
    expect(formatNotification(makeRun("run_resolved", {}), ko).body).toBe("박서연 님이 문제를 해결했어요");
  });

  it("run_finished·run_stopped·run_idle_warning - 실행 이름·자동 중단·남은 일수", () => {
    expect(formatNotification(makeRun("run_finished", {}), ko).body).toBe("'11월 점검' 실행이 모두 완료됐어요");
    expect(formatNotification(makeRun("run_stopped", { auto: false }), ko).body).toBe("박서연 님이 '11월 점검' 실행을 중단했어요");
    const auto = makeRun("run_stopped", { auto: true, days: 40, actor: undefined, actor_name: "" });
    expect(formatNotification(auto, ko).body).toBe("'11월 점검' 실행이 오래 그대로라 자동으로 중단됐어요");
    const idle = makeRun("run_idle_warning", { days: 10, actor: undefined, actor_name: "" });
    expect(formatNotification(idle, ko).body).toBe("'11월 점검' 실행을 10일 안에 손대지 않으면 자동으로 중단돼요");
  });

  it("실행 이름은 리치 파츠에서 이름 칩으로 분할된다(행위자 없는 알림 포함)", () => {
    const idle = makeRun("run_idle_warning", { days: 10, actor: undefined, actor_name: "" });
    expect(formatNotificationBodyParts(idle, ko)).toContainEqual({ chip: "11월 점검", kind: "name" });
  });

  it("아이콘 - 문제=경고, 단계 완료·실행 완료=체크 목록, 나머지 run_*=클립보드", () => {
    expect(getNotificationIcon("run_problem")).toBe(AlertTriangle);
    expect(getNotificationIcon("run_steps_done")).toBe(ListChecks);
    expect(getNotificationIcon("run_finished")).toBe(ListChecks);
    for (const type of ["run_invited", "run_resolved", "run_stopped", "run_idle_warning"]) {
      expect(getNotificationIcon(type)).toBe(ClipboardList);
    }
    expect(getNotificationIcon("mystery")).toBe(Bell);
  });
});

describe("getRunNotificationHref", () => {
  const item = (over: Partial<NotificationItem>): NotificationItem => ({
    id: 1, type: "run_problem", map_id: 3, version_id: 9, message: "x", read: false,
    created_at: "2026-11-04T10:00:00+09:00", payload: { run_id: 21 }, ...over,
  });

  it("run 유형이고 맵·버전·실행 id가 있으면 실행 화면 주소", () => {
    expect(getRunNotificationHref(item({}))).toBe("/maps/3?version=9&run=21");
  });
  it("run 아닌 유형은 null", () => {
    expect(getRunNotificationHref(item({ type: "published" }))).toBeNull();
  });
  it("맵·버전·실행 id 중 하나라도 없으면 null", () => {
    expect(getRunNotificationHref(item({ map_id: null }))).toBeNull();
    expect(getRunNotificationHref(item({ version_id: null }))).toBeNull();
    expect(getRunNotificationHref(item({ payload: {} }))).toBeNull();
    expect(getRunNotificationHref(item({ payload: null }))).toBeNull();
  });
});

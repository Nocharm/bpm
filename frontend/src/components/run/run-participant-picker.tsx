"use client";

// 실행 참여자 고르기 — 그 맵을 볼 수 있는 사람(승인자 후보와 같은 집합, BE get_eligible_users)만 PrincipalPicker 후보로 싣는다.
// 새 실행 창·실행 바의 참여자 편집·나만 → 공유 전환이 함께 쓴다(approvers-panel과 같은 연결: 열 때 후보를 다시 읽는다).

import { useEffect, useState } from "react";

import { listEligibleApprovers, type DirectoryUser } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { PrincipalPicker } from "@/components/permissions/principal-picker";

interface RunParticipantPickerProps {
  mapId: number;
  // 이미 고른 사람·시작한 사람 — 후보에서 뺀다
  excludeIds: ReadonlySet<string>;
  onPick: (loginId: string) => void;
}

export function RunParticipantPicker({ mapId, excludeIds, onPick }: RunParticipantPickerProps) {
  const { t } = useI18n();
  const [eligible, setEligible] = useState<DirectoryUser[]>([]);

  useEffect(() => {
    let active = true;
    listEligibleApprovers(mapId)
      .then((users) => {
        if (active) setEligible(users);
      })
      .catch((err: unknown) => {
        // 후보를 못 읽으면 빈 목록(emptyLabel)으로 남는다 — 열 때 다시 읽는다
        console.warn("run participant candidates failed", { mapId, err });
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  const refreshEligible = () => {
    listEligibleApprovers(mapId)
      .then(setEligible)
      .catch((err: unknown) => {
        console.warn("run participant candidates refresh failed", { mapId, err });
      });
  };

  const pickerUsers = eligible.map((user) => ({
    id: user.id,
    name: user.name,
    email: "",
    departmentId: "",
    status: "active" as const,
    isSysadmin: false,
    korean_name: user.korean_name ?? "",
  }));
  const userDepartments = Object.fromEntries(eligible.map((user) => [user.id, user.department]));

  return (
    <PrincipalPicker
      users={pickerUsers}
      departments={[]}
      groups={[]}
      excludeIds={new Set(excludeIds)}
      userDepartments={userDepartments}
      onOpen={refreshEligible}
      emptyLabel={t("run.start.pickerEmpty")}
      onSelect={(option) => {
        if (option.principalType === "user") onPick(option.principalId);
      }}
    />
  );
}

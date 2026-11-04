"use client";

// 실행 주소 동기화 — 맵 화면이 `?run=`을 따라 실행 모드에 들어가고 나온다(R25). 같은 맵 안의 주소 변경(router.push·replace,
// 뒤로/앞으로, 알림 링크)은 화면을 다시 마운트하지 않아서 처음 읽은 값만으로는 모자라다.
// 구독 방식은 하나로 정한다: Next의 useSearchParams. 앱 안 이동은 경로가 같아도 모두 이 값을 갱신한다(popstate만으로는
// history.pushState를 쓰는 router.push를 못 잡는다). 첫 마운트 때도 한 번 알려서 딥링크 진입도 같은 길로 들어온다.
// useSearchParams는 프리렌더 때 가장 가까운 Suspense까지 클라이언트 렌더로 미루므로 호출부는 이 컴포넌트만 <Suspense>로 감싼다.
// 실행을 닫는 쪽은 주소를 바꾸기 전에 상태를 먼저 비워도 된다 — 곧 같은 값(null)이 여기서 다시 온다.
// `?run=`이 바뀔 때 그 순간 주소의 `?version=`도 함께 알린다 — 뒤로 가기로 실행을 나올 때 화면을 그 버전에 맞추게(호출부 몫).

import { useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

import { readRunIdParam, readVersionIdParam } from "@/lib/run-links";

interface RunUrlSyncProps {
  // versionId: 같은 주소의 `?version=`(양의 정수가 아니면 null)
  onRunIdChange: (runId: number | null, versionId: number | null) => void;
}

export function RunUrlSync({ onRunIdChange }: RunUrlSyncProps) {
  const searchParams = useSearchParams();
  const runId = readRunIdParam(searchParams.toString());
  // 버전은 run이 바뀐 순간의 값만 읽는다 — 실행 밖에서 주소의 버전만 바뀌는 경우는 이 구독의 일이 아니다
  const reportRunId = useEffectEvent((next: number | null) =>
    onRunIdChange(next, readVersionIdParam(searchParams.toString())),
  );
  useEffect(() => {
    reportRunId(runId);
  }, [runId]);
  return null;
}

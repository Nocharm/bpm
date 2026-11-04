"use client";

// 실행 주소 동기화 — 맵 화면이 `?run=`을 따라 실행 모드에 들어가고 나온다(R25). 같은 맵 안의 주소 변경(router.push·replace,
// 뒤로/앞으로, 알림 링크)은 화면을 다시 마운트하지 않아서 처음 읽은 값만으로는 모자라다.
// 구독 방식은 하나로 정한다: Next의 useSearchParams. 앱 안 이동은 경로가 같아도 모두 이 값을 갱신한다(popstate만으로는
// history.pushState를 쓰는 router.push를 못 잡는다). 첫 마운트 때도 한 번 알려서 딥링크 진입도 같은 길로 들어온다.
// useSearchParams는 프리렌더 때 가장 가까운 Suspense까지 클라이언트 렌더로 미루므로 호출부는 이 컴포넌트만 <Suspense>로 감싼다.
// 실행을 닫는 쪽은 주소를 바꾸기 전에 상태를 먼저 비워도 된다 — 곧 같은 값(null)이 여기서 다시 온다.

import { useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

import { readRunIdParam } from "@/lib/run-links";

interface RunUrlSyncProps {
  onRunIdChange: (runId: number | null) => void;
}

export function RunUrlSync({ onRunIdChange }: RunUrlSyncProps) {
  const searchParams = useSearchParams();
  const runId = readRunIdParam(searchParams.toString());
  const reportRunId = useEffectEvent((next: number | null) => onRunIdChange(next));
  useEffect(() => {
    reportRunId(runId);
  }, [runId]);
  return null;
}

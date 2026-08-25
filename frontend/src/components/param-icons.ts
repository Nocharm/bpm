// 수행 지표(Metrics) 아이콘 단일 소스 — 캔버스 칩·일괄 편집 탭·인스펙터/편집 모달 행이 공유
// (동일 시각 언어 유지, 2026-08-20 3번째 사용처에서 추출). duration=시계, touch_time=스톱워치로 구분.
import { Clock, Coins, Tag, Target, Timer, Users, type LucideIcon } from "lucide-react";

import type { ParamField } from "@/lib/params";

export const PARAM_ICON: Record<ParamField, LucideIcon> = {
  duration: Clock,
  touch_time: Timer,
  cost_krw: Coins,
  cost_usd: Coins,
  headcount: Users,
  annual_count: Tag,
  fte: Target,
};

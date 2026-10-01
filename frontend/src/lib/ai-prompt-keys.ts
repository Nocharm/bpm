// AI 프롬프트 key 목록과 설정 패널 라벨 — 백엔드 backend/app/prompt_registry.py PROMPT_KEYS의 미러.
// 백엔드는 key만 내려주고 표시명·설명은 프론트가 소유하므로, key를 추가하면 여기·i18n en/ko를 같이 옮긴다
// (ai-prompt-keys.test.ts가 백엔드 튜플과 집합·순서를 대조한다).

import type { MessageKey } from "@/lib/i18n-messages";

export const AI_PROMPT_KEYS = [
  "ai_chat_instructions",
  "interviewer_contract",
  "drafter_contract",
  "extract_contract",
  "anti_repeat_nudge",
  "compare_summary_contract",
  "submit_note_contract",
  "l5_plan_contract",
  "l6_questionnaire_contract",
  "l6_row_drafter_contract",
  "l5_relations_contract",
  "l5_canvas_feedback_contract",
  "l6_row_feedback_contract",
] as const;

export type AiPromptKey = (typeof AI_PROMPT_KEYS)[number];

export interface AiPromptLabel {
  name: MessageKey;
  hint: MessageKey;
}

// Record<AiPromptKey, …>라 key를 목록에 추가하고 라벨을 빠뜨리면 타입 검사가 막는다
export const AI_PROMPT_LABELS: Record<AiPromptKey, AiPromptLabel> = {
  ai_chat_instructions: {
    name: "aiPrompts.name.ai_chat_instructions",
    hint: "aiPrompts.hint.ai_chat_instructions",
  },
  interviewer_contract: {
    name: "aiPrompts.name.interviewer_contract",
    hint: "aiPrompts.hint.interviewer_contract",
  },
  drafter_contract: {
    name: "aiPrompts.name.drafter_contract",
    hint: "aiPrompts.hint.drafter_contract",
  },
  extract_contract: {
    name: "aiPrompts.name.extract_contract",
    hint: "aiPrompts.hint.extract_contract",
  },
  anti_repeat_nudge: {
    name: "aiPrompts.name.anti_repeat_nudge",
    hint: "aiPrompts.hint.anti_repeat_nudge",
  },
  compare_summary_contract: {
    name: "aiPrompts.name.compare_summary_contract",
    hint: "aiPrompts.hint.compare_summary_contract",
  },
  submit_note_contract: {
    name: "aiPrompts.name.submit_note_contract",
    hint: "aiPrompts.hint.submit_note_contract",
  },
  l5_plan_contract: {
    name: "aiPrompts.name.l5_plan_contract",
    hint: "aiPrompts.hint.l5_plan_contract",
  },
  l6_questionnaire_contract: {
    name: "aiPrompts.name.l6_questionnaire_contract",
    hint: "aiPrompts.hint.l6_questionnaire_contract",
  },
  l6_row_drafter_contract: {
    name: "aiPrompts.name.l6_row_drafter_contract",
    hint: "aiPrompts.hint.l6_row_drafter_contract",
  },
  l5_relations_contract: {
    name: "aiPrompts.name.l5_relations_contract",
    hint: "aiPrompts.hint.l5_relations_contract",
  },
  l5_canvas_feedback_contract: {
    name: "aiPrompts.name.l5_canvas_feedback_contract",
    hint: "aiPrompts.hint.l5_canvas_feedback_contract",
  },
  l6_row_feedback_contract: {
    name: "aiPrompts.name.l6_row_feedback_contract",
    hint: "aiPrompts.hint.l6_row_feedback_contract",
  },
};

export function isAiPromptKey(key: string): key is AiPromptKey {
  return (AI_PROMPT_KEYS as readonly string[]).includes(key);
}

/** 서버가 준 key의 라벨 — 모르는 key(백엔드만 먼저 배포된 경우)는 undefined로 패널이 일반 제목에 폴백한다. */
export function getAiPromptLabel(key: string): AiPromptLabel | undefined {
  return isAiPromptKey(key) ? AI_PROMPT_LABELS[key] : undefined;
}

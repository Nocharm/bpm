# 온프레미스 AI 채팅 — 순서도 생성·편집 + 매뉴얼 안내 설계 문서

**작성일:** 2026-06-15
**상태:** 승인됨 (구현 대기)
**관련:** `docs/spec.md`(데이터 모델·캔버스), 버전 승인 워크플로우(`docs/superpowers/specs/2026-06-14-version-approval-workflow-design.md`)

## 1. 목적

사내 GPU 서버의 온프레미스 AI를 이용해, 사용자가 **채팅으로 프로세스맵(순서도)을 생성·편집**하고 **기본 사용법을 안내**받는 기능. 자연어 지시 → AI가 논리적 그래프(단계+흐름)를 제안 → 미리보기 후 적용. 같은 채팅에서 사용법 질문도 응답.

## 2. 범위 결정 (브레인스토밍 확정)

| 결정 | 선택 | 비고 |
|------|------|------|
| AI 서빙 형태 | **OpenAI 호환** 가정 | base URL + Bearer 토큰 + 모델명. 어댑터 경계로 교체 가능 |
| 백엔드 연동 | **백엔드 프록시** | 토큰 서버측 보관, AI 출력 검증, 권한 가드 |
| v1 범위 | **채팅→생성/편집 중심** | 레이아웃은 기존 dagre 재사용. 단일 캔버스 스코프만 |
| AI 출력 계약 | **A안: 논리 그래프(좌표 없음)** | 클라이언트가 dagre로 배치 + 실제 id 발급 |
| 적용 방식 | **미리보기 후 적용** | 수락/거절. 할루시네이션 방지 |
| 채팅 | **멀티턴(세션 한정), 비영속** | 최근 N턴 context. 그래프만 영속 |
| 매뉴얼 안내 | **AI 채팅에 통합** | 판별 타입(graph/answer). 매뉴얼 마크다운 파일 |
| 활성화 | **AI_ENABLED 플래그** | 로컬 기본 false, 서버만 true |

## 3. 아키텍처 · 데이터 흐름

```
[에디터 AI 채팅 패널]
   │ POST /api/versions/{id}/ai/chat  { parent, instruction, history[] }
   ▼
[backend AI 라우터 ai.py]  ── 현재 스코프 그래프 DB 로드 (version, parent)
   │  시스템 프롬프트(노드 유형·그래프 스키마 + 매뉴얼 마크다운 + 현재 그래프) + history + 지시
   ▼
[ai_client.py 어댑터] ── OpenAI 호환 POST {AI_BASE_URL}/chat/completions (JSON 응답 강제)
   │  Authorization: Bearer {AI_API_TOKEN}, model={AI_MODEL}, timeout={AI_TIMEOUT_SECONDS}
   ▼
[검증] Pydantic으로 AI JSON 파싱·검증 → 실패 시 1회 재프롬프트 → 그래도 실패면 오류
   ▼
응답: { kind:"graph", message, nodes[], edges[] }  또는  { kind:"answer", message }
   ▼
[클라이언트] kind=graph → dagre 배치 → 미리보기 오버레이 → 수락 시 saveGraph(스코프 교체) / 거절 폐기
              kind=answer → 채팅에 텍스트만 표시
```

**경계 단위 (각 1책임):**
- `backend/app/ai_client.py` — OpenAI 호환 호출 어댑터(교체 가능 경계). 비OpenAI 서버면 이 파일만 수정.
- `backend/app/ai_prompt.py` — 시스템 프롬프트 구성(스키마 설명 + 매뉴얼 + 현재 그래프 직렬화). 순수 함수, 테스트 용이.
- `backend/app/routers/ai.py` — 엔드포인트 + 권한·상태 가드 + 검증/재시도 오케스트레이션.
- `backend/app/manual.md` — 사용법 매뉴얼 마크다운. 앱 시작 시 1회 로드. **본문은 마지막 단계에 작성**.
- `backend/app/schemas.py` — `AiChatRequest`, `AiGraphProposal`(논리 노드/엣지), `AiChatResponse`(판별).
- frontend `src/components/ai-chat-panel.tsx` — 채팅 UI + 미리보기 적용/거절.
- frontend `src/lib/api.ts` — `aiChat()` 클라이언트 함수.

## 4. AI 출력 계약

판별 타입 — AI는 의도를 분류해 둘 중 하나로 응답:

```jsonc
// 그리기/편집 의도
{
  "kind": "graph",
  "message": "발주 흐름 6단계를 그렸어요",
  "nodes": [
    { "key": "n1", "title": "발주 요청", "node_type": "start", "description": "" }
    // node_type: start | process | decision | end
  ],
  "edges": [
    { "source": "n1", "target": "n2", "label": "" }   // nodes의 key 참조
  ]
}

// 사용법/도움말 의도
{ "kind": "answer", "message": "버전을 승인하려면 …" }
```

**검증 규칙 (Pydantic + 추가 검사, API 경계):**
- `kind` ∈ {graph, answer}. answer면 message만 필수.
- graph: 각 node `key` 고유·비어있지 않음, `title` 비어있지 않음, `node_type` 화이트리스트.
- 각 edge의 `source`/`target`가 nodes의 `key`에 존재(고아 엣지 거부).
- 검증 실패 → 백엔드가 "유효한 JSON만" 지침으로 **1회 재프롬프트** → 재실패면 사용자 오류.

**클라이언트 적용 (kind=graph):**
- AI의 임시 `key` → 실제 노드 id 발급(기존 id 생성 방식), 엣지 source/target 재매핑.
- 좌표는 `layoutWithDagre`로 배치. 현재 스코프(version, parent) **전체 교체** = 기존 `saveGraph` 경로.
- 편집도 동일: 백엔드가 현재 그래프를 프롬프트에 포함 → AI가 전체 새 그래프 반환.
- v1은 단일 캔버스 스코프만. 하위 계층 생성은 후속.

## 5. 채팅 UX

- 에디터에 **토글되는 AI 채팅 패널**(Lucide 아이콘 버튼). UI 영어 기본, 동적/주석 한글.
- **멀티턴(세션 한정)** — 최근 N턴(예: 6)을 history로 전송해 "그 노드 뒤에 추가" 등 지시 해소. 대화는 **영속 안 함**(새로고침 초기화), 그래프만 저장.
- 전송 → 로딩 → 응답:
  - `graph`: 미리보기 오버레이(제안 결과를 dagre 배치로 현재 캔버스 위에 표시) + `Apply`/`Discard`. Apply 시 스코프 교체 커밋, Discard 시 폐기.
  - `answer`: 채팅에 텍스트만.
- AI의 `message`(무엇을 했는지/답변)를 항상 함께 표시.

## 6. 권한 · 상태 가드

- AI 그래프 편집은 **편집 가능 상태(draft/rejected) + 체크아웃 보유자**만 — 그래프 저장과 동일 규칙. 그 외엔 패널은 보이되 전송 비활성 + 안내(도움말 `answer`만 허용할지 여부: v1은 비편집 상태에서도 도움말 질의는 허용, 그래프 적용만 차단).
- 백엔드 엔드포인트도 동일 가드(클라이언트 신뢰 안 함). 인증된 사용자만(`get_current_user`).
- 미리보기는 클라이언트 표시일 뿐, **실제 변경은 기존 saveGraph 가드(상태·체크아웃)를 그대로 통과**해야 커밋됨.

## 7. 설정 (`.env` / Settings)

```
AI_ENABLED=false           # 로컬 기본 비활성(GPU 접근 불가), 서버 compose만 true
AI_BASE_URL=               # 예: http://<gpu서버>:8000/v1
AI_API_TOKEN=              # Bearer 토큰 (시크릿 — git 커밋 금지, .env만)
AI_MODEL=                  # 모델명
AI_TIMEOUT_SECONDS=60      # 요청 타임아웃(business/tuning)
```
- `AI_ENABLED=false`면 엔드포인트 503, 프론트 채팅 패널 토글 숨김.
- `httpx`를 **프로덕션 requirements.txt**로 승격(현재 dev 전용). Dockerfile/compose/.env.example 반영(sync 시).

## 8. 오류 처리

- AI 서버 타임아웃/연결 실패/5xx → (해당 시 1회 재시도 후) 사용자에게 명확한 오류, 캔버스 변경 없음.
- JSON 파싱·검증 실패 → 1회 재프롬프트 → 재실패면 오류 메시지.
- 토큰·주소는 로그 비노출(구조화 로깅, 시크릿 마스킹). `error-handling.md` 준수.

## 9. 테스트

**백엔드 (pytest, AI 서버는 mock — 실제 GPU 미호출):**
- 정상 graph 응답 → 검증 통과, 제안 반환.
- answer 응답 → 텍스트 반환.
- 고아 엣지 / 잘못된 node_type → 검증 실패(재프롬프트 후 최종 오류 경로).
- `AI_ENABLED=false` → 503.
- 비편집 상태(pending/approved/published) 또는 타인 체크아웃 → 403/409(그래프 적용 차단).
- 타임아웃 → 오류 응답, 캔버스 미변경.
- `ai_prompt.py` 순수 함수 단위 테스트(현재 그래프 직렬화, 매뉴얼 주입).

**프론트 (JS 테스트 하네스 없음):** eslint + next build + 수동(미리보기 적용/거절, 도움말 응답, AI_ENABLED=false 시 패널 숨김).

## 10. 구현 순서 (제안)

1. 설정·의존성: Settings 필드 + `.env.example`, httpx 프로덕션 승격.
2. `ai_client.py`(어댑터) + `ai_prompt.py`(프롬프트) + 스키마.
3. `routers/ai.py` 엔드포인트(가드·검증·재시도) + pytest(mock).
4. 프론트 `aiChat()` + `ai-chat-panel.tsx`(채팅·미리보기·적용) + 권한 가드.
5. 미리보기 오버레이 + dagre 배치 + 스코프 교체 적용.
6. `manual.md` 본문 작성(핵심 사용법) — **마지막 단계**.
7. sync(Dockerfile/compose/.env.example/README) + 검증.

각 단계 종료 시 pytest/ruff/eslint/build 통과 후 커밋.

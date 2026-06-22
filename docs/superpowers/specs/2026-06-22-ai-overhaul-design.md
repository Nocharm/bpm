# AI 채팅 패널 전면 개편 — 설계 (Phase 1 산출물)

> 상태: **결정 확정(2026-06-22) — Phase 2 착수 대기(§7).** 브랜치 `feat/ai-enhancements`(base `c2a8501`).
> 목적: 현재 "한 줄 → 단일 스코프 통째 교체 + 매뉴얼 Q&A" 수준의 AI를 4개 핵심 기능
> (① 자연어→맵 생성 ② 워크스루 ③ 매뉴얼 안내 ④ 분석·개선점)으로 확장.
> 이 문서는 코드 조사(2026-06-22) 결과에 근거한다. 모든 인용은 `file:line`.

---

## 1. 현재 상태 (코드 근거)

### 1.1 데이터 모델은 이미 풍부 — AI 스키마만 빈약
**핵심 결론: 백엔드/프론트 그래프 모델엔 비즈니스 메타가 전부 있다. 병목은 AI 입출력 계약과 apply 경로다.**

**Node** (`backend/app/models.py:81-117`): `title, description, node_type, color, assignee, department, system, duration, pos_x, pos_y, sort_order, group_id`(legacy)`, group_ids`(JSON)`, linked_map_id, follow_latest, linked_version_id, is_primary_end`.
**Edge** (`models.py:119-137`): `source_node_id, target_node_id, label, source_side, target_side, source_handle, target_handle`.
**Group** (`models.py:157-172`): `id, version_id, parent_group_id, label, color`. 노드는 `group_ids[]`로 그룹 참조.
**Subprocess 참조** (Node 필드): `linked_map_id` + `follow_latest` + `linked_version_id` (참조 모델: 루트 편집, 임베드 자식 read-only).

**AI 스키마** (`backend/app/schemas.py:387-438`) — 빈약:
- `AiNode`: `key, title, node_type, description` (**4개뿐**, 405-408)
- `AiEdge`: `source, target, label` (**3개뿐**, 412-414)
- `AiProposal`: `kind: Literal["graph","answer"]`, `message`, `nodes`, `edges` (419-422). 검증: node_type ∈ {start,process,decision,end}, key 유일, edge 양끝 존재(424-438).
- **groups 없음. attributes 없음.**

### 1.2 직렬화도 빈약
`_serialize_graph` (`backend/app/ai_prompt.py:16-22`)는 `- {id} [{node_type}] {title}` + `{source} -> {target}`만 출력. **assignee/department/system/duration/color/group/subprocess 전부 누락.** 좌표는 의도적 제외(자동 배치). `_INSTRUCTIONS`(6-14)는 kind 2종(graph/answer)만 지시. manual.md(49줄) 전문이 시스템 프롬프트에 주입(`ai_prompt.py:44`).

### 1.3 메타 소실 지점 (정확히 적시)
`applyAiProposal` (`frontend/src/app/maps/[mapId]/page.tsx:1092-1145`):
- 노드 빌드(1099-1120): `title/description/node_type`만 proposal에서, 나머지 **하드코딩** — `color:"", assignee:"", department:"", system:"", duration:"", group_ids:[], linked_map_id:null, follow_latest:false, linked_version_id:null, is_primary_end:false, pos 0`(dagre 재배치).
- 엣지 빌드(1121-1141): `source/target/label`만, `source_side:"right", target_side:"left", handles:null` 하드코딩.
- 그룹: `groups:[]` 하드코딩(1143) — proposal에 groups 필드 자체가 없음.
- 저장: applyAiProposal → 미리보기(메인 `nodes` state 교체, undo 백업) → `commitAiPreview`(1148) → `saveCurrentScope`(893) → `buildGraph`(440) → `saveGraph` PUT 전체 그래프(503). **buildGraph는 전체 메타를 그대로 직렬화하므로, AI가 메타를 주기만 하면 저장은 자동으로 보존됨.**

프론트 AI 타입(`frontend/src/lib/api.ts:~567-581`)은 백엔드와 동일하게 4/3 필드.

### 1.4 권한 가드
`POST /api/versions/{version_id}/ai/chat` (`backend/app/routers/ai.py:56`). 가드:
- `settings.ai_enabled` 아니면 503 (58).
- 버전 없으면 404 (59-61).
- `can_edit = is_editable_status(status) and is_checkout_active(version) and checked_out_by == user` (63-68).
- **다운그레이드**: `proposal.kind=="graph" and not can_edit` → `AiProposal(kind="answer", message=_NOT_EDITABLE_MSG)` (78-81). 즉 비편집 상태에선 분석/답변은 가능, 그래프 적용만 차단. 최종 적용 가드는 saveGraph가 enforce.

**⚠️ 보안 갭**: 라우터는 `dependencies=[Depends(get_current_user)]`만(20). **RBAC `effective_role`/`require_*_role` 미연동.** 맵 접근권 없는 사용자도 version_id만 알면 호출 가능(현재는 answer로만). Phase 4(분석)·Phase 7(하드닝)에서 최소 viewer 가시성 검증을 추가해야 함.

프론트 게이팅(`page.tsx:644`): `readOnly = (checkout && !checkout.mine) || statusLocksEditing`; 패널엔 `canEdit={!readOnly && checkout?.mine}` 전달(5426). 패널은 `aiEnabled`/`canEdit`로 입력 비활성·사유 표시(`ai-chat-panel.tsx:109-139`).

### 1.5 캔버스 포커스/하이라이트 (워크스루·분석용 토대)
- `useReactFlow()` (`page.tsx:652`). 포커스 패턴: `reactFlow.fitView({ nodes:[{id}], padding:0.4, duration, maxZoom })` (1432, 2923, 4342). `setCenter`(4267)도 가능.
- 선택/하이라이트: `selectedId` state(552) + React Flow `node.selected` 플래그 동기화(1419-1437). 스코프 전환 후 포커스 큐: `focusNodeIdRef`.
- **글로벌 스토어 없음** (`window-store.ts`는 패널 위치 geometry 전용). 컴포넌트 간 채널은 prop 콜백(`onGraphProposal`, 5427). → AI 패널→캔버스 포커스는 **`onHighlightNode?(nodeId)` 콜백 prop 신설**이 가장 자연스러움.
- 미리보기 오버레이: `aiPreviewActive`+`aiPreviewRef`로 메인 nodes 교체(undo 백업). 워크스루/분석 하이라이트는 선택과 충돌 피하려 **별도 `highlightedNodeId` state + 전용 CSS**(점선/글로우) 권장.

### 1.6 공급자 JSON 강제
`ai_client.py:23` `response_format={"type":"json_object"}` 하드코딩, 토글 없음. `_extract_json`(`routers/ai.py:27-32`)이 펜스/앞뒤 텍스트 제거(첫 `{`~마지막 `}`), 실패 시 1회 재프롬프트 후 502.

---

## 2. 목표 기능 4종 → 코드 매핑

| # | 기능 | 신규 kind | 백엔드 | 프론트 |
|---|------|-----------|--------|--------|
| 1 | 자연어→맵 생성(그룹·어트리뷰트 포함) | `graph`(확장) | 직렬화/지시 확장, attributes·groups 출력 | applyAiProposal 메타 매핑 |
| 2 | 워크스루(노드별 이동·설명) | `walkthrough` | steps[{order,node_id,narration}] | 스텝퍼 + fitView 포커스 |
| 3 | 매뉴얼 안내 | `answer`(보강) | manual.md 보강 + 근거 표기 | (기존 답변 렌더) |
| 4 | 분석·개선점(read-only) | `analysis` | findings[] + 구조 사전점검 | 결과 패널 + 클릭→하이라이트 |

---

## 3. 아키텍처 결정 (D1~D5) — 옵션·트레이드오프·추천

### D1. 편집 모델
- **(a) 전체 교체 유지** — 단순. 단 "편집" 의도에도 기존 좌표/색/어트리뷰트/그룹 전부 소실(현행 그대로의 한계).
- **(b) 증분 op** (`add/remove/connect/relabel/set_attr`, 기존 node id 매칭) — 메타·레이아웃 보존. 단 키 매칭 규칙·검증·프론트 patch 로직 복잡.
- **(c) 하이브리드 [추천]** — 신규 생성("그려줘")은 교체, 기존 맵 "편집"("X를 Y로 바꿔/추가")은 증분 op. 의도 분기는 AI가 kind/op로 신호.
- **근거**: 현재 apply는 (a)라 편집 시 메타 파괴(1.3). 생성은 교체로 충분, 편집은 증분이 필수. **추천 (c)**. (a 대비 증분 경로 추가 비용은 Phase 2에서 op 스키마로 흡수.)

### D2. 어트리뷰트(담당자/부서) 출처
- **AI 직접 추론** — 로컬/무AD 환경에서 동작하나 부정확(가짜 이름).
- **AD/seed 매칭 우선 + 미매칭/로컬은 AI 추론 폴백 [추천]** — `backend/app/ad`(LDAP) + seed employees와 매칭, 없으면 추론 또는 빈값.
- **근거**: assignee/department 필드 존재, AD 모듈 존재. 로컬은 AD 없음 → 우아한 폴백 필요. **추천: 매칭 우선 + 폴백.**

### D3. 채팅 영속화
- **1차 비영속 유지, Phase 7에서 옵션화 [추천]** — 현재 history는 클라이언트가 전달(max 20턴), DB 없음. 범위 관리상 1차 비영속. **추천 채택.**

### D4. 개선점 제안(기능 #4)
- **1차 "설명 + 캔버스 하이라이트" [추천]**, "적용 가능한 graph 제안 변환"은 후속. findings의 node_ids 클릭→fitView 포커스. **추천 채택** ("제안 적용" 버튼은 1차 생략).

### D5. 워크스루(기능 #2)
- **사용자 스텝(이전/다음) + 자동재생 토글 [추천]** — steps 순서대로 fitView+하이라이트+narration. **추천 채택.**

### 진행 모드 (선택)
- 결정 확정 후 Phase 2~6을 **연속 진행(각 Phase 끝 보고만)** vs **매 Phase STOP 유지**. (사용자 선택)

---

## 4. 출력 계약 확장안 (Phase 2 미리보기 — 확정은 D 결정 후)

```jsonc
// AiProposalNode 확장
{ "key": "...", "title": "...", "node_type": "start|process|decision|end",
  "description": "",
  "attributes": { "assignee":"", "department":"", "system":"", "duration":"", "color":"" }, // 선택
  "group_key": "g1" }   // 또는 group_id
// AiProposal.groups[] 추가
{ "key":"g1", "label":"구매팀", "color":"", "parent_key": null }
// D1=c 증분 op (편집 의도)
{ "kind":"ops", "ops":[ {"action":"set_attr","node_id":"<기존id>","attributes":{...}},
                         {"action":"add","node":{...}}, {"action":"connect","source":"...","target":"..."},
                         {"action":"relabel","node_id":"...","title":"..."}, {"action":"remove","node_id":"..."} ] }
// walkthrough
{ "kind":"walkthrough", "message":"...", "steps":[ {"order":1,"node_id":"...","narration":"..."} ] }
// analysis
{ "kind":"analysis", "message":"...", "findings":[ {"severity":"high|med|low","category":"bottleneck|orphan|cycle|naming|missing","node_ids":["..."],"message":"...","suggestion":"..."} ] }
```
> 그룹/op는 key↔기존 node id 매칭 규칙 필요. 생성(graph)은 key 신규, 편집(ops)은 기존 id 직접 참조.

---

## 5. 리스크 / 선결

1. **RBAC 갭(1.4)** — AI 라우트 맵 접근권 미검증. Phase 4(분석 read-only)는 최소 viewer 가시성을 요구해야 안전. `effective_role`/`require_version_map_role(viewer)` 도입 검토 → Phase 4 또는 7.
2. **공급자 JSON 호환(1.6)** — `walkthrough`/`analysis`/`answer`는 json 강제 유지. 미지원 공급자용 `AI_FORCE_JSON` 토글은 Phase 7(또는 필요 시) 옵션. 기본 동작 불변.
3. **page.tsx ~5000줄 단일 컴포넌트** — applyAiProposal/포커스/하이라이트 추가 시 기존 상태(aiPreviewActive, selectedId, focusNodeIdRef)와 충돌 주의. 캔버스/React Flow 함정은 `docs/lessons/` 준수.
4. **참조 모델 인지** — AI는 서브프로세스 참조(루트만 편집, 자식 read-only)를 **인지만**, 변경 금지(비범위).

---

## 6. Phase 시퀀스 (계획)
- **Phase 2** 출력 계약 확장(스키마+직렬화+프론트 타입) — 모든 기능 공통 토대.
- **Phase 3** 기능#1 생성(그룹·어트리뷰트).
- **Phase 4** 기능#4 분석(read-only, 하이라이트) — RBAC 갭 처리.
- **Phase 5** 기능#2 워크스루(read-only, 스텝퍼+포커스).
- **Phase 6** 기능#3 매뉴얼 보강.
- **Phase 7** 통합/하드닝(스트리밍·영속·공급자·권한/에러).

---

## 7. 결정 확정 (2026-06-22)
- **D1 = 하이브리드** — 생성('그려줘')=전체 교체, 편집('X를 바꿔/추가')=증분 op(`kind:"ops"`). 기존 좌표·색·어트리뷰트 보존.
- **D2 = AD/seed 매칭 우선 + AI 폴백** — 담당자/부서는 `app/ad`·seed employees 매칭 후 미매칭/로컬은 AI 추론/빈값.
- **D3 = 비영속** — 1차 클라이언트 history만, Phase 7에서 옵션화.
- **D4 = 설명 + 하이라이트만** — finding 클릭→포커스. '제안 적용' 버튼은 후속.
- **D5 = 스텝퍼(이전/다음) + 자동재생 토글**.
- **진행 모드 = Phase 2까지 STOP, 이후 연속**(각 Phase 끝 보고만).

→ Phase 2(출력 계약 확장: 스키마+직렬화+프론트 타입) 착수.

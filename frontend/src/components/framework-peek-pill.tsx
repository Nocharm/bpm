"use client";

// 업무체계 드릴인 피크 — 우상단 칩(FrameworkChip) 디자인을 노드 안 트리거에서 재활용하는 팝오버.
// 트리거는 범용(FrameworkPeekTrigger): 클릭 즉시 오픈 + (옵션) 지연 호버 오픈. 포털 고정
// 좌표라 캔버스 줌 스케일의 영향을 받지 않는다 (2026-08-30, 출처 배지 재사용을 위해 분리).
import { FolderTree } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { FrameworkBrowseModal } from "@/components/framework-browse-modal";
import { FrameworkChip } from "@/components/framework-chip";

const HOVER_DELAY_MS = 3000; // 스침 오픈 방지 — 클릭은 즉시 오픈
// 패널 이탈 후 닫힘 유예 — 칩→플라이아웃(right-full, 6px 갭) 이동처럼 잠깐 패널 밖을 지나는
// 경로에서 즉시 닫히지 않게. 패널/트리거 재진입 시 취소 (사용자 요청 2026-08-30)
const CLOSE_GRACE_MS = 400;
// 커서와 패널 좌상단 사이 간격 — 붙여두면 패널이 커서를 가린다
const POINTER_OFFSET = 6;
const VIEWPORT_MARGIN = 8;

export function FrameworkPeekTrigger({
  categoryId,
  linkedMapId,
  title,
  dataId,
  className,
  style,
  hoverDelayMs = null,
  onOpenChange,
  children,
}: {
  categoryId: number;
  linkedMapId: number;
  title: string;
  dataId: string;
  className: string;
  style?: CSSProperties;
  // null=클릭 전용, 숫자면 해당 ms 호버로도 오픈
  hoverDelayMs?: number | null;
  // 플라이아웃(+탐색 모달) 개폐 알림 — 호스트가 자기 자동 닫힘을 억제할 수 있게 (SP 피크 헤더용)
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [peek, setPeek] = useState<{ x: number; y: number } | null>(null);
  // 형제 브랜치 탐색 모달 — 피크는 유지한 채 위에 추가 창으로 띄운다 (사용자 정정 2026-08-30)
  const [browse, setBrowse] = useState(false);
  const timerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // 마지막 커서 위치 — 패널을 트리거 오른쪽이 아니라 커서 기준으로 띄운다. 트리거가 화면
  // 오른쪽 끝에 있으면 오른쪽 배치는 뷰포트 밖으로 나가 찾기 어렵다 (사용자 요청 2026-08-31)
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }
  function cancelClose() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }
  function scheduleClose() {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setPeek(null);
    }, CLOSE_GRACE_MS);
  }
  useEffect(
    () => () => {
      clearTimer();
      cancelClose();
    },
    [],
  );

  // 바깥 클릭 닫기 — FrameworkChip 플라이아웃과 동일 캡처 패턴.
  // 탐색 모달이 위에 떠 있는 동안엔 억제 — 피크를 유지한 채 추가 창으로 연다 (사용자 정정 2026-08-30)
  useEffect(() => {
    if (peek === null || browse) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        !panelRef.current?.contains(event.target) &&
        !rootRef.current?.contains(event.target)
      ) {
        setPeek(null);
      }
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => window.removeEventListener("mousedown", handleMouseDown, true);
  }, [peek, browse]);

  // 개폐를 호스트에 알린다 — 플라이아웃·탐색 모달은 body 포털이라 호스트(SP 피크)의
  // 바깥 클릭·이탈 닫힘에 그대로 걸린다. 열려 있는 동안 호스트가 자기 닫힘을 멈추게 한다.
  useEffect(() => {
    onOpenChange?.(peek !== null);
  }, [peek, onOpenChange]);

  // 커서를 좌상단 기준으로 — 커서를 못 잡았으면(키보드 등) 트리거 아래로 폴백.
  // 뷰포트 밖으로 나가는 보정은 렌더 후 실측으로 처리한다(아래 useLayoutEffect).
  function openPeek() {
    clearTimer();
    cancelClose();
    const pointer = pointerRef.current;
    if (pointer) {
      setPeek({ x: pointer.x + POINTER_OFFSET, y: pointer.y + POINTER_OFFSET });
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) setPeek({ x: rect.left, y: rect.bottom + POINTER_OFFSET });
  }

  // 뷰포트 클램프 — 패널 크기는 체인 로드 후에야 확정되므로 ResizeObserver로 재보정한다.
  // state 대신 DOM style을 직접 써서 set-state-in-effect 루프를 만들지 않는다.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (peek === null || el === null) return;
    const clamp = () => {
      const rect = el.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - VIEWPORT_MARGIN;
      const maxY = window.innerHeight - rect.height - VIEWPORT_MARGIN;
      el.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(peek.x, maxX))}px`;
      el.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(peek.y, maxY))}px`;
    };
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(el);
    return () => observer.disconnect();
  }, [peek]);

  return (
    <span
      ref={rootRef}
      data-id={dataId}
      title={title}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        // 포털 자식(피크 패널·탐색 모달)의 클릭도 React 트리로 여기까지 버블된다 —
        // DOM 포함 여부로 걸러 토글 오작동(모달 안 클릭 = 피크 닫힘)을 막는다
        if (event.target instanceof Element && !event.currentTarget.contains(event.target)) return;
        pointerRef.current = { x: event.clientX, y: event.clientY };
        if (peek !== null) setPeek(null);
        else openPeek();
      }}
      // 노드 더블클릭은 편집 모달을 연다 — 아이콘 위 더블클릭이 거기까지 새지 않게 (사용자 요청 2026-08-31)
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseEnter={(event) => {
        pointerRef.current = { x: event.clientX, y: event.clientY };
        cancelClose(); // 패널→트리거 복귀도 닫힘 취소
        if (hoverDelayMs === null || peek !== null) return;
        clearTimer();
        timerRef.current = window.setTimeout(openPeek, hoverDelayMs);
      }}
      onMouseMove={(event) => {
        // 호버 오픈은 진입 후 3초 뒤라 그동안 커서가 움직인다 — 최신 위치로 갱신
        if (peek === null) pointerRef.current = { x: event.clientX, y: event.clientY };
      }}
      onMouseLeave={clearTimer}
      className={className}
    >
      {children}
      {peek !== null &&
        createPortal(
          <div
            ref={panelRef}
            data-id="node-framework-peek"
            style={{ left: peek.x, top: peek.y }}
            className="fixed z-[1250]"
            onMouseEnter={cancelClose}
            onMouseLeave={() => {
              // 즉시 닫지 않고 유예 — 플라이아웃(패널 밖 6px 갭 너머)으로 가는 경로에서 꺼지지 않게.
              // 플라이아웃도 패널 DOM 자손이라 재진입 시 mouseenter로 취소된다.
              if (!browse) scheduleClose();
            }}
          >
            {/* 링크맵 기준 체인 — mapId=링크맵이라 플라이아웃에서 해당 맵이 현재로 하이라이트된다 */}
            <FrameworkChip
              mapId={linkedMapId}
              categoryId={categoryId}
              defaultOpen
              floating={false}
              onBrowse={() => setBrowse(true)} // 피크는 유지 — 추가 창으로 (사용자 정정 2026-08-30)
            />
          </div>,
          document.body,
        )}
      {browse && (
        <FrameworkBrowseModal
          chainCategoryId={categoryId}
          currentMapId={linkedMapId}
          onClose={() => setBrowse(false)}
        />
      )}
    </span>
  );
}

// SP 노드 업무체계 필 — 일반 맵에서 링크맵이 프레임워크 소속이면 이름 첫 줄 옆 아이콘.
// 배경 없는 아이콘, 호버 시에만 배경·3초 호버 또는 클릭으로 피크 (사용자 요청 2026-08-30)
export function FrameworkPeekPill({
  categoryId,
  linkedMapId,
  path,
}: {
  categoryId: number;
  linkedMapId: number;
  path: string;
}) {
  return (
    <FrameworkPeekTrigger
      dataId="node-framework-pill"
      categoryId={categoryId}
      linkedMapId={linkedMapId}
      title={path}
      hoverDelayMs={HOVER_DELAY_MS}
      className="nodrag nopan mt-0.5 shrink-0 cursor-pointer self-start rounded-xs p-0.5 text-ink-tertiary transition-colors duration-150 hover:bg-surface-alt hover:text-accent"
    >
      <FolderTree size={12} strokeWidth={1.5} />
    </FrameworkPeekTrigger>
  );
}

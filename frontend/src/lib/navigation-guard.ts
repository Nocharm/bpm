// 앱 안 이동 가드 — 미저장 편집을 든 화면(에디터)이 이동을 붙잡아 확인창을 띄운다 (리뷰 2026-10-19 W-1).
// 링크(<a>, next/link) 클릭은 setNavigationGuard가 window 캡처 단계에서 가로채고, 버튼의 router.push는 호출측이
// runGuardedNavigation으로 감싼다. 브라우저 뒤로 가기처럼 붙잡을 수 없는 이동은 등록한 화면이 언마운트에서 처리한다.

// proceed = 원래 이동. true를 돌려주면 가드가 이동을 맡았다(확인창 뒤 proceed 호출 또는 머무름).
export type NavigationGuard = (proceed: () => void) => boolean;

// 한 번에 한 화면만 — 마지막 등록이 이긴다(에디터는 한 탭에 하나뿐).
let activeGuard: NavigationGuard | null = null;

export function runGuardedNavigation(proceed: () => void): void {
  if (activeGuard?.(proceed)) return;
  proceed();
}

// 같은 탭에서 앱의 다른 화면으로 가는 일반 링크 클릭이면 그 링크와 경로(path+search+hash), 아니면 null.
// 새 탭(수정 키·가운데 버튼·target)·다운로드·외부 주소·같은 화면 안 해시 이동은 잃을 편집이 없어 통과시킨다.
export function findInAppLink(
  event: MouseEvent,
  current: Location,
): { anchor: HTMLAnchorElement; href: string } | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if ((anchor.target !== "" && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  const url = new URL(anchor.href, current.href);
  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;
  return { anchor, href: url.pathname + url.search + url.hash };
}

// 가드 등록 + 링크 클릭 가로채기. navigate는 붙잡은 링크가 그새 사라졌을 때 쓰는 이동(router.push). 해제 함수를 돌려준다.
export function setNavigationGuard(guard: NavigationGuard, navigate: (href: string) => void): () => void {
  activeGuard = guard;
  let isReplaying = false;
  // window 캡처 — React 루트(document)의 리스너보다 먼저 돌아, 막으면 next/link onClick까지 가지 않는다
  const handleClick = (event: MouseEvent) => {
    if (isReplaying) return;
    const link = findInAppLink(event, window.location);
    if (link === null) return;
    // 이동을 고르면 링크 자신의 동작(next/link 이동, 로고의 전체 새로고침 등)을 그대로 다시 태운다
    const proceed = () => {
      if (!link.anchor.isConnected) {
        navigate(link.href);
        return;
      }
      isReplaying = true;
      try {
        link.anchor.click();
      } finally {
        isReplaying = false;
      }
    };
    if (!guard(proceed)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", handleClick, true);
  return () => {
    window.removeEventListener("click", handleClick, true);
    if (activeGuard === guard) activeGuard = null;
  };
}

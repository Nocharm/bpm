// 로컬(인증 OFF) 임시 로그인 — fixture 5명 + 선택값 localStorage 영속. 백엔드 LOCAL_USERS와 loginId 일치.

export interface LocalUser {
  loginId: string;
  name: string;
  department: string;
  role: "admin" | "user";
}

export const LOCAL_USERS: LocalUser[] = [
  { loginId: "admin.kim", name: "김관리", department: "프로세스혁신팀", role: "admin" },
  { loginId: "user.lee", name: "이업무", department: "구매팀", role: "user" },
  { loginId: "user.park", name: "박담당", department: "인사팀", role: "user" },
  { loginId: "user.choi", name: "최실무", department: "생산관리팀", role: "user" },
  { loginId: "user.jung", name: "정사용", department: "품질팀", role: "user" },
];

const KEY = "bpm.devUser";

export function getStoredDevUser(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(KEY);
}

export function storeDevUser(loginId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (loginId) {
    window.localStorage.setItem(KEY, loginId);
  } else {
    window.localStorage.removeItem(KEY);
  }
}

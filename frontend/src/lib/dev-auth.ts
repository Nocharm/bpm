// 로컬(인증 OFF) 임시 로그인 — fixture 5명 + 선택값 localStorage 영속. 백엔드 LOCAL_USERS와 loginId 일치.

export interface LocalUser {
  loginId: string;
  name: string;
  department: string;
  role: "admin" | "user";
}

// 표시명·부서는 백엔드 영문 시드(app/ad/service.LOCAL_USERS)와 정렬 — /api/me와 일치 /
// Display name/department aligned to the backend English seed so the switcher matches /api/me.
export const LOCAL_USERS: LocalUser[] = [
  { loginId: "admin.kim", name: "Junho Kim", department: "Process Innovation Team", role: "admin" },
  { loginId: "user.lee", name: "Minjae Lee", department: "Sourcing Team 1", role: "user" },
  { loginId: "user.park", name: "Soyeon Park", department: "Sourcing Team 1", role: "user" },
  { loginId: "user.choi", name: "Daehyun Choi", department: "Sourcing Team 2", role: "user" },
  { loginId: "user.jung", name: "Hana Jung", department: "Procurement Office", role: "user" },
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

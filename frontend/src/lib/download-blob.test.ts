// 내려받기 헬퍼 단위 테스트 — 파일 이름·객체 URL 해제 시점(클릭 뒤 다음 틱)
import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadBlob } from "./download-blob";

describe("downloadBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clicks a download link and revokes the URL only after a tick", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:mock");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });

    downloadBlob(new Blob(["x"]), "a_20261016-1000.csv");

    expect(clicked).toEqual([{ href: "blob:mock", download: "a_20261016-1000.csv" }]);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:mock");
  });
});

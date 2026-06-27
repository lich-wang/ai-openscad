import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createRenderMcp } from "./lib/render";

vi.mock("./lib/render", () => ({
  createRenderMcp: vi.fn()
}));

describe("App render prewarm", () => {
  const prewarm = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    prewarm.mockClear();
    vi.mocked(createRenderMcp).mockReturnValue({
      provider: "web",
      compile: vi.fn(),
      render: vi.fn(),
      prewarm
    });
  });

  it("prewarms the browser render worker on workbench load", async () => {
    render(React.createElement(App));

    await waitFor(() => expect(prewarm).toHaveBeenCalledTimes(1));
  });
});

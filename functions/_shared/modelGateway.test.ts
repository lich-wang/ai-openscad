import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyModelRequest } from "./modelGateway";

describe("proxyModelRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not remap MiMo multimodal vision requests to the pro text model", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"summary\":\"ok\"}" } }]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await proxyModelRequest(
      new Request("https://example.com/api/vision", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-user",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: "mimo",
          model: "mimo-v2.5",
          messages: [
            { role: "system", content: "return JSON" },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: "data:image/png;base64,front" }
                },
                { type: "text", text: "review this" }
              ]
            }
          ]
        })
      })
    );

    const upstreamBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { model: string };
    expect(upstreamBody.model).toBe("mimo-v2.5");
  });
});

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

  it("proxies streaming chat completions as event streams", async () => {
    const upstreamStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"cube"}}]}\n\n'
          )
        );
        controller.close();
      }
    });
    const fetchMock = vi.fn(async () => {
      return new Response(upstreamStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyModelRequest(
      new Request("https://example.com/api/llm", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-user",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: "mimo",
          model: "mimo-v2.5-pro",
          stream: true,
          messages: [{ role: "user", content: "make cube" }]
        })
      })
    );

    const upstreamBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { stream: boolean };
    expect(upstreamBody.stream).toBe(true);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await response.text()).toContain("cube");
  });

  it("uses the server MiMo key when a MiMo request has no user bearer token", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "cube(10);" } }]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyModelRequest(
      new Request("https://example.com/api/llm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: "mimo",
          model: "mimo-v2.5-pro",
          messages: [{ role: "user", content: "make cube" }]
        })
      }),
      { MiMo_KEY: "sk-server-mimo" }
    );

    expect(response.status).toBe(200);
    const upstreamHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(upstreamHeaders.Authorization).toBe("Bearer sk-server-mimo");
    expect(upstreamHeaders["api-key"]).toBe("sk-server-mimo");
  });

  it("still rejects DeepSeek requests without a user bearer token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyModelRequest(
      new Request("https://example.com/api/llm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: "deepseek",
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "make cube" }]
        })
      }),
      { MiMo_KEY: "sk-server-mimo" }
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: "Missing Authorization bearer token."
    });
  });
});

const allowedOrigins = new Set([
  "https://ai.openscad.tech",
  "http://localhost:5173",
  "http://localhost:8788",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8788"
]);

const allowedPreviewSuffix = ".ai-openscad.pages.dev";

export function resolveAllowedOrigin(request: Request): string {
  const origin = request.headers.get("Origin") ?? refererOrigin(request);
  if (!origin) {
    return "";
  }
  if (allowedOrigins.has(origin)) {
    return origin;
  }
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && url.hostname.endsWith(allowedPreviewSuffix)) {
      return origin;
    }
  } catch {
    return "";
  }
  return "";
}

function refererOrigin(request: Request): string {
  const referer = request.headers.get("Referer");
  if (!referer) {
    return "";
  }
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

export function corsHeadersFor(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "https://ai.openscad.tech",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin"
  };
}

export function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeadersFor(resolveAllowedOrigin(request))
  });
}

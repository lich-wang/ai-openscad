import { corsHeaders, handleOptions } from "../_shared/cors";
import { proxyModelRequest } from "../_shared/modelGateway";

type PagesRequestContext = {
  request: Request;
  env: Record<string, string | undefined>;
};

export const onRequest = async ({ request, env }: PagesRequestContext) => {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders
    });
  }

  const response = await proxyModelRequest(request, env);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers
  });
};

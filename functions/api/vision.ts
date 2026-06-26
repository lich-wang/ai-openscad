import { corsHeaders, handleOptions } from "../_shared/cors";
import { proxyModelRequest } from "../_shared/modelGateway";

type PagesRequestContext = {
  request: Request;
};

export const onRequest = async ({ request }: PagesRequestContext) => {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders
    });
  }

  const response = await proxyModelRequest(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers
  });
};

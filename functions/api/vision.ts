import {
  corsHeadersFor,
  handleOptions,
  resolveAllowedOrigin
} from "../_shared/cors";
import { proxyModelRequest } from "../_shared/modelGateway";

type PagesRequestContext = {
  request: Request;
  env: Record<string, string | undefined>;
};

export const onRequest = async ({ request, env }: PagesRequestContext) => {
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }
  const cors = corsHeadersFor(resolveAllowedOrigin(request));
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: cors
    });
  }

  const response = await proxyModelRequest(request, env);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers
  });
};

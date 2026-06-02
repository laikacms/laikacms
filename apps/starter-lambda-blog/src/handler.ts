/**
 * AWS Lambda handler for LaikaCMS — supports both:
 *   - Application Load Balancer (ALB) events
 *   - API Gateway HTTP API v2 (payload format 2.0)
 *
 * Both event shapes are very similar; the key differences are:
 *   - ALB:         event.httpMethod, event.path, event.headers, event.body
 *   - HTTP API v2: event.requestContext.http.method, event.rawPath, event.headers, event.body
 *
 * The adapter converts Lambda events → Web API Request, then the result back.
 *
 * Doc gap: unlike frameworks with native Web API bindings (Hono, Astro, etc.),
 * Lambda requires this manual event → Request → event bridge.
 */
import type {
  ALBEvent,
  ALBHandler,
  ALBResult,
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

import { handleRequest } from './app.js';

// ── Lambda event → Web API Request ───────────────────────────────────────────

function eventToRequest(event: ALBEvent | APIGatewayProxyEventV2): Request {
  const isAlb = 'httpMethod' in event;

  const method = isAlb
    ? (event as ALBEvent).httpMethod
    : (event as APIGatewayProxyEventV2).requestContext.http.method;

  const path = isAlb
    ? (event as ALBEvent).path
    : (event as APIGatewayProxyEventV2).rawPath;

  const rawQuery = isAlb
    ? (event as ALBEvent).queryStringParameters
    : (event as APIGatewayProxyEventV2).rawQueryString;

  const headers = event.headers ?? {};

  const host = headers['host'] ?? headers['Host'] ?? 'localhost';
  const qs = typeof rawQuery === 'string'
    ? rawQuery
    : rawQuery
    ? new URLSearchParams(rawQuery as Record<string, string>).toString()
    : '';
  const url = `https://${host}${path}${qs ? `?${qs}` : ''}`;

  // Body: Lambda delivers binary payloads as base64-encoded strings.
  let body: ArrayBuffer | undefined;
  if (event.body && method !== 'GET' && method !== 'HEAD') {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'utf8');
    // Slice to plain ArrayBuffer — TS6 BodyInit no longer accepts Buffer/Uint8Array<ArrayBufferLike>.
    const u8 = new Uint8Array(raw);
    body = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  }

  return new Request(url, {
    method,
    headers: headers as Record<string, string>,
    body,
  });
}

// ── Web API Response → Lambda result ─────────────────────────────────────────

async function responseToResult(response: Response): Promise<ALBResult | APIGatewayProxyResultV2> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') headers[name] = value;
  });
  const body = Buffer.from(await response.arrayBuffer()).toString('base64');
  return { statusCode: response.status, headers, body, isBase64Encoded: true };
}

// ── Lambda exports ────────────────────────────────────────────────────────────

export const albHandler: ALBHandler = async event => {
  const response = await handleRequest(eventToRequest(event));
  return responseToResult(response) as Promise<ALBResult>;
};

export const handler: APIGatewayProxyHandlerV2 = async event => {
  const response = await handleRequest(eventToRequest(event as unknown as ALBEvent | APIGatewayProxyEventV2));
  return responseToResult(response) as Promise<APIGatewayProxyResultV2>;
};

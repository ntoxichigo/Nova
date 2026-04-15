import { NextRequest, NextResponse } from 'next/server';

/**
 * Local-first alpha gate.
 *
 * Default behavior:
 * - Localhost requests can use the full app without extra auth.
 * - Remote UI access is blocked unless NOVA_ALLOW_REMOTE_UI=true (or legacy NTOX_ALLOW_REMOTE_UI=true).
 * - Remote API access requires NOVA_API_SECRET (or legacy NTOX_API_SECRET).
 *
 * When NOVA_API_SECRET is set, remote callers must include one of:
 *   Authorization: Bearer <secret>
 *   X-API-Key: <secret>
 *   ?api_key=<secret> (query param, useful for webhooks)
 *
 * Webhook routes (/api/telegram/webhook, /api/discord/webhook) have their
 * own per-service authentication and are excluded from this gate.
 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const WEBHOOK_PATHS = ['/api/telegram/webhook', '/api/discord/webhook'];

function getRequestHostname(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host || request.nextUrl.hostname;
  return host.split(':')[0].trim().toLowerCase();
}

function isLocalhostRequest(request: NextRequest): boolean {
  return LOCAL_HOSTNAMES.has(getRequestHostname(request));
}

function isAllowedRemoteUiRequest(): boolean {
  const mode = (process.env.NOVA_ALLOW_REMOTE_UI || process.env.NTOX_ALLOW_REMOTE_UI || '').trim().toLowerCase();
  return mode === '1' || mode === 'true' || mode === 'yes';
}

function isWebhookPath(pathname: string): boolean {
  return WEBHOOK_PATHS.some((path) => pathname.startsWith(path));
}

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const localRequest = isLocalhostRequest(request);
  const allowRemoteUi = isAllowedRemoteUiRequest();
  const secret = (process.env.NOVA_API_SECRET || process.env.NTOX_API_SECRET || '').trim();

  if (!pathname.startsWith('/api/')) {
    if (localRequest || allowRemoteUi) {
      return NextResponse.next();
    }
    return new NextResponse(
      'Remote UI is disabled for this local-first alpha. Set NOVA_ALLOW_REMOTE_UI=true to expose the interface beyond localhost.',
      { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  if (isWebhookPath(pathname) || localRequest) {
    return NextResponse.next();
  }

  if (!secret) {
    return new NextResponse(
      JSON.stringify({
        error: 'Remote API access is disabled. Set NOVA_API_SECRET for remote API calls, or use localhost for the local-first alpha.',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const apiKeyHeader = request.headers.get('x-api-key') ?? '';
  const queryKey = searchParams.get('api_key') ?? '';

  const provided =
    (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '') ||
    apiKeyHeader ||
    queryKey;

  if (provided !== secret) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized. Set Authorization: Bearer <NOVA_API_SECRET>.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};

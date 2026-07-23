const DEFAULT_UPSTREAM = "http://127.0.0.1:8765/";

type RouteContext = {
  params:
    | Promise<{ path?: string[] }>
    | { path?: string[] };
};

function jsonError(message: string, status: number) {
  return Response.json(
    {
      schema: "segm.realtime-gim.v1",
      status: "offline",
      message,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

async function proxyRealtime(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const segments = params.path ?? [];
    if (!segments.length || segments.some((item) => item.includes(".."))) {
      return jsonError("Invalid real-time endpoint.", 400);
    }

    const incoming = new URL(request.url);
    const base = process.env.REALTIME_GIM_UPSTREAM ?? DEFAULT_UPSTREAM;
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    const upstream = new URL(
      segments.map((item) => encodeURIComponent(item)).join("/"),
      normalizedBase,
    );
    upstream.search = incoming.search;

    const response = await fetch(upstream, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
        "User-Agent": "SEGM-Web-Realtime-Proxy/1.0",
      },
    });

    const headers = new Headers();
    headers.set(
      "Content-Type",
      response.headers.get("Content-Type") ??
        "application/json; charset=utf-8",
    );
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("X-SEGM-Realtime-Upstream", response.ok ? "online" : "error");

    return new Response(
      request.method === "HEAD" ? null : response.body,
      {
        status: response.status,
        headers,
      },
    );
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "unknown upstream error";
    return jsonError(`Real-time bridge unavailable: ${reason}`, 503);
  }
}

export const dynamic = "force-dynamic";
export const GET = proxyRealtime;
export const HEAD = proxyRealtime;

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, HEAD, OPTIONS",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

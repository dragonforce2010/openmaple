import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { prototypeResponse } from "./prototype";

const hostname = process.env.HOST || "127.0.0.1";
const port = Number(process.env.MAPLE_WEB_PORT || process.env.PORT || 8080);
const apiProxyTarget = process.env.MAPLE_API_PROXY_TARGET || process.env.E2E_API_BASE || "http://127.0.0.1:27951";
const staticDir = process.env.MAPLE_WEB_STATIC_DIR ? resolve(process.env.MAPLE_WEB_STATIC_DIR) : null;
const prototypeHtmlPath = resolve(process.env.MAPLE_PROTOTYPE_UI || "ui-design/MaplePrototype.html");

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function shouldProxy(pathname: string) {
  return pathname === "/health" || pathname === "/v1" || pathname.startsWith("/v1/");
}

async function proxyApi(request: Request) {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, apiProxyTarget);
  const started = Date.now();
  const headers = new Headers(request.headers);
  for (const header of hopByHopHeaders) headers.delete(header);
  if (isDevLoginRequest(incomingUrl, request.headers.get("referer") || "")) {
    headers.set("x-maple-api-key", process.env.MAPLE_DEV_API_KEY || "maple_dev_key");
  }
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual"
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  try {
    const response = await fetch(targetUrl, init);
    const duration = Date.now() - started;
    console.log(`[web] ${request.method} ${incomingUrl.pathname}${incomingUrl.search} -> ${response.status} ${duration}ms`);
    return response;
  } catch (error) {
    const duration = Date.now() - started;
    console.error(`[web] ${request.method} ${incomingUrl.pathname}${incomingUrl.search} -> failed ${duration}ms`, error);
    throw error;
  }
}

function isDevLoginRequest(url: URL, referer: string) {
  if (url.searchParams.get("dev_login") === "1") return true;
  if (!referer) return false;
  try {
    return new URL(referer).searchParams.get("dev_login") === "1";
  } catch {
    return false;
  }
}

function safeStaticPath(pathname: string) {
  if (!staticDir) return null;
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  const candidate = resolve(staticDir, relativePath || "index.html");
  if (candidate !== staticDir && !candidate.startsWith(staticDir + sep)) return null;
  return candidate;
}

async function serveStatic(pathname: string) {
  const filePath = safeStaticPath(pathname);
  if (!filePath) return null;
  if (!existsSync(filePath)) return null;
  return new Response(Bun.file(filePath), {
    headers: { "cache-control": "no-store" }
  });
}

async function spaFallback(staticRoot: string) {
  const indexPath = join(staticRoot, "index.html");
  if (!existsSync(indexPath)) return new Response("Build output is missing dist/index.html", { status: 503 });
  return new Response(Bun.file(indexPath), {
    headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" }
  });
}

const servePrototype = () => prototypeResponse(prototypeHtmlPath);

const server = staticDir
  ? Bun.serve({
      hostname,
      port,
      idleTimeout: 120,
      routes: {
        "/v1": proxyApi,
        "/v1/*": proxyApi,
        "/health": proxyApi
      },
      async fetch(request: Request) {
        const { pathname } = new URL(request.url);
        if (shouldProxy(pathname)) return proxyApi(request);
        const staticResponse = await serveStatic(pathname);
        if (staticResponse) return staticResponse;
        return spaFallback(staticDir);
      }
    })
  : Bun.serve({
      hostname,
      port,
      idleTimeout: 120,
      routes: {
        "/v1": proxyApi,
        "/v1/*": proxyApi,
        "/health": proxyApi,
        "/": servePrototype,
        "/*": servePrototype
      }
    });

console.log(`web server listening on ${server.url}`);

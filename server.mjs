import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bridge from "./api/bridge.js";

const ROOT = fileURLToPath(new URL("./dist/", import.meta.url)).replace(/\/$/, "");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4188);
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml"
};

function sendNotFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end("页面不存在。");
}

async function serveStatic(response, pathname) {
  let requested;
  try { requested = decodeURIComponent(pathname); } catch { return sendNotFound(response); }
  if (requested.includes("\\") || requested.includes("\0")) return sendNotFound(response);
  const file = join(ROOT, requested === "/" ? "index.html" : requested.slice(1));
  if (!file.startsWith(`${ROOT}/`)) return sendNotFound(response);
  try {
    if (!(await stat(file)).isFile()) return sendNotFound(response);
    const data = await readFile(file);
    response.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
    });
    response.end(data);
  } catch { sendNotFound(response); }
}

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    if (url.pathname === "/api/bridge") return await bridge(request, response);
    if (request.method !== "GET" && request.method !== "HEAD") return sendNotFound(response);
    return await serveStatic(response, url.pathname);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("服务发生错误。");
  }
}).listen(PORT, HOST, () => console.log(`EtsyShipping Mac Web: http://${HOST}:${PORT}`));

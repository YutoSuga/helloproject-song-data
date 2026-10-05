import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "../site");
const port = Number(process.env.PORT ?? 4173);
const types = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const candidate = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden"); return;
  }
  try {
    const info = await stat(candidate);
    const file = info.isDirectory() ? resolve(candidate, "index.html") : candidate;
    response.writeHead(200, { "Content-Type": `${types[extname(file)] ?? "application/octet-stream"}; charset=utf-8` });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`Preview: http://localhost:${port}`));

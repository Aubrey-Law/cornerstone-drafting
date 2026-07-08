import express from "express";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const SECRET = process.env.CONVERT_WORKER_SECRET?.trim() || "";
const IS_PROD = process.env.NODE_ENV === "production";

if (!SECRET) {
  if (IS_PROD) {
    console.error(
      "[docx-pdf-worker] CONVERT_WORKER_SECRET is unset in production — denying all /convert requests.",
    );
  } else {
    console.warn(
      "[docx-pdf-worker] CONVERT_WORKER_SECRET is unset — /convert is open (local only).",
    );
  }
}

/** @type {string | null} */
let cachedSoffice = null;

async function which(cmd) {
  return new Promise((resolve) => {
    const child = spawn("which", [cmd], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("close", (code) => {
      resolve(code === 0 ? out.trim().split("\n")[0] || null : null);
    });
    child.on("error", () => resolve(null));
  });
}

async function resolveSoffice() {
  if (cachedSoffice) return cachedSoffice;

  const fromEnv = process.env.SOFFICE_BINARY_PATH?.trim();
  if (fromEnv) {
    try {
      await fs.access(fromEnv);
      cachedSoffice = fromEnv;
      return cachedSoffice;
    } catch {
      throw new Error(`SOFFICE_BINARY_PATH not found: ${fromEnv}`);
    }
  }

  for (const name of ["soffice", "libreoffice"]) {
    const found = await which(name);
    if (found) {
      cachedSoffice = found;
      return cachedSoffice;
    }
  }

  throw new Error(
    "LibreOffice not found. Install it or set SOFFICE_BINARY_PATH.",
  );
}

function requireAuth(req, res, next) {
  if (!SECRET) {
    if (IS_PROD) {
      return res.status(503).json({
        error: "CONVERT_WORKER_SECRET is not configured",
      });
    }
    return next();
  }

  const header = req.get("authorization") || "";
  if (header !== `Bearer ${SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

/**
 * Parse multipart body for a single `file` field without extra deps.
 * @param {import('express').Request} req
 */
async function readMultipartFile(req) {
  const contentType = req.get("content-type") || "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    throw Object.assign(new Error("Missing multipart boundary"), { status: 400 });
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw Object.assign(new Error("Empty body"), { status: 400 });
  }

  const delim = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delim, 0);
  if (start < 0) {
    throw Object.assign(new Error("Invalid multipart body"), { status: 400 });
  }

  while (start >= 0) {
    const afterDelim = start + delim.length;
    // End marker: --boundary--
    if (body[afterDelim] === 0x2d && body[afterDelim + 1] === 0x2d) break;

    let headersStart = afterDelim;
    if (body[headersStart] === 0x0d && body[headersStart + 1] === 0x0a) {
      headersStart += 2;
    }

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headersStart);
    if (headerEnd < 0) break;

    const headers = body.subarray(headersStart, headerEnd).toString("utf8");
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(delim, dataStart);
    if (nextBoundary < 0) break;

    let dataEnd = nextBoundary;
    if (dataEnd >= 2 && body[dataEnd - 2] === 0x0d && body[dataEnd - 1] === 0x0a) {
      dataEnd -= 2;
    }

    if (/name="file"/i.test(headers)) {
      const filenameMatch = /filename="([^"]*)"/i.exec(headers);
      return {
        buffer: body.subarray(dataStart, dataEnd),
        filename: filenameMatch?.[1] || "document.docx",
      };
    }

    start = nextBoundary;
  }

  throw Object.assign(new Error('multipart field "file" not found'), {
    status: 400,
  });
}

async function convertDocxToPdf(inputPath, outDir) {
  const soffice = await resolveSoffice();
  const args = [
    "--headless",
    "--norestore",
    "--nolockcheck",
    "--nodefault",
    "--nofirststartwizard",
    "--convert-to",
    "pdf",
    "--outdir",
    outDir,
    inputPath,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(soffice, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: outDir },
    });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.stdout.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `soffice exited ${code}: ${stderr.trim() || "no stderr"}`,
          ),
        );
    });
  });

  const base = basename(inputPath).replace(/\.docx$/i, "");
  const pdfPath = join(outDir, `${base}.pdf`);
  try {
    await fs.access(pdfPath);
    return pdfPath;
  } catch {
    const files = await fs.readdir(outDir);
    const pdf = files.find((f) => f.toLowerCase().endsWith(".pdf"));
    if (!pdf) throw new Error("Conversion produced no PDF");
    return join(outDir, pdf);
  }
}

const app = express();
app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post(
  "/convert",
  requireAuth,
  express.raw({
    type: () => true,
    limit: MAX_BODY_BYTES,
  }),
  async (req, res) => {
    const workDir = join(tmpdir(), `docx-pdf-${randomUUID()}`);
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    };

    try {
      await fs.mkdir(workDir, { recursive: true });

      const contentType = (req.get("content-type") || "").toLowerCase();
      /** @type {Buffer} */
      let buffer;
      let filename = "document.docx";

      if (contentType.includes("multipart/form-data")) {
        const part = await readMultipartFile(req);
        buffer = part.buffer;
        filename = part.filename || filename;
      } else if (
        contentType.includes(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ) ||
        contentType.includes("application/octet-stream") ||
        contentType === "" ||
        contentType.includes("application/docx")
      ) {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          return res.status(400).json({ error: "Empty body" });
        }
        buffer = req.body;
        const cd = req.get("content-disposition");
        const m = cd && /filename="?([^";]+)"?/i.exec(cd);
        if (m) filename = m[1];
      } else {
        return res.status(415).json({
          error:
            "Expected multipart/form-data with field 'file', or raw DOCX / octet-stream body",
        });
      }

      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: "Empty file" });
      }
      if (buffer.length > MAX_BODY_BYTES) {
        return res.status(413).json({ error: "File too large (max 50MB)" });
      }

      const safeBase =
        basename(filename)
          .replace(/[^\w.\-()+ ]+/g, "_")
          .replace(/\.+$/, "") || "document";
      const inputName = /\.docx$/i.test(safeBase)
        ? safeBase
        : `${safeBase}.docx`;
      const inputPath = join(workDir, inputName);
      await fs.writeFile(inputPath, buffer);

      const pdfPath = await convertDocxToPdf(inputPath, workDir);
      const pdf = await fs.readFile(pdfPath);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${inputName.replace(/\.docx$/i, ".pdf")}"`,
      );
      res.setHeader("Content-Length", String(pdf.length));
      res.send(pdf);
    } catch (err) {
      const status = err?.status || 500;
      const message = err?.message || "Conversion failed";
      console.error("[docx-pdf-worker] convert error:", message);
      if (!res.headersSent) {
        res.status(status).json({ error: message });
      }
    } finally {
      await cleanup();
    }
  },
);

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "File too large (max 50MB)" });
  }
  console.error("[docx-pdf-worker] unhandled:", err);
  res.status(500).json({ error: "Internal error" });
});

app.listen(PORT, () => {
  console.log(`[docx-pdf-worker] listening on :${PORT}`);
});

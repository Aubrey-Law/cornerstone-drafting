# DOCX → PDF convert worker

Minimal Node 22 ESM service that converts Word documents to PDF with headless LibreOffice. Intended as a scale-to-zero sidecar for Cornerstone (Fly.io or Railway).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | `{ "ok": true }` |
| `POST` | `/convert` | DOCX in → PDF bytes out |

`POST /convert` accepts:

- `multipart/form-data` with field `file`, or
- raw body with `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` or `application/octet-stream`

Max body size: **50MB**. Response: `application/pdf`.

## Auth

When `CONVERT_WORKER_SECRET` is set, require:

```http
Authorization: Bearer <CONVERT_WORKER_SECRET>
```

| Environment | Secret unset |
|-------------|--------------|
| Local / `NODE_ENV` ≠ `production` | Allowed, with a console warning |
| Production (`NODE_ENV=production`) | `/convert` returns **503** |

## Local run

1. Install [LibreOffice](https://www.libreoffice.org/) (macOS: `brew install --cask libreoffice`).
2. From this directory:

```bash
npm install
npm run dev          # or: npm start
```

Health check:

```bash
curl -s http://localhost:8080/health
```

Convert (multipart):

```bash
curl -s -X POST http://localhost:8080/convert \
  -H "Authorization: Bearer $CONVERT_WORKER_SECRET" \
  -F "file=@./example.docx" \
  -o out.pdf
```

Convert (raw body):

```bash
curl -s -X POST http://localhost:8080/convert \
  -H "Authorization: Bearer $CONVERT_WORKER_SECRET" \
  -H "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  --data-binary @./example.docx \
  -o out.pdf
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CONVERT_WORKER_SECRET` | (empty) | Bearer token for `/convert` |
| `PORT` | `8080` | Listen port |
| `SOFFICE_BINARY_PATH` | (PATH lookup) | Absolute path to `soffice` / `libreoffice` |
| `NODE_ENV` | — | Set to `production` on Fly/Railway |

If `SOFFICE_BINARY_PATH` is unset, the worker tries `soffice` then `libreoffice` on `PATH`.

## Fly.io deploy

Scale-to-zero: `auto_stop_machines` + `min_machines_running = 0` so idle cost is ≈ **$0**. Cold start includes LibreOffice process spin-up (a few seconds).

```bash
cd tools/docx-pdf-worker
fly apps create cornerstone-docx-pdf   # once
fly secrets set CONVERT_WORKER_SECRET="$(openssl rand -hex 32)"
fly deploy
```

App name / region are in `fly.toml` (`cornerstone-docx-pdf`, primary region `iad`). VM memory is **1GB** so LibreOffice has room to convert.

## Railway (alternate)

This folder includes `nixpacks.toml` which installs LibreOffice via apt. Deploy this directory as a Railway service, set secrets:

- `CONVERT_WORKER_SECRET`
- optionally `SOFFICE_BINARY_PATH=/usr/bin/soffice`

Give the service enough RAM (≥1GB).

## How Cornerstone calls it

Set on the Cornerstone backend:

| Backend env | Purpose |
|-------------|---------|
| `DOCX_PDF_CONVERT_URL` | Worker base URL, e.g. `https://cornerstone-docx-pdf.fly.dev` |
| `DOCX_PDF_CONVERT_SECRET` | Same value as the worker’s `CONVERT_WORKER_SECRET` |

Example request from the app:

```http
POST {DOCX_PDF_CONVERT_URL}/convert
Authorization: Bearer {DOCX_PDF_CONVERT_SECRET}
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document

<docx bytes>
```

Or multipart with field `file`. The worker returns PDF bytes.

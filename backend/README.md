# ShaktiFlow image analysis API

Image-first FastAPI service. It runs the pretrained `yolov8n.pt` model with COCO's `person` class only. Requests are decoded and inferred in memory; uploaded image bytes are not written to disk or retained after the request. The model weights are cached by Ultralytics separately from uploaded data.

## Install and run

From the repository root on Python 3.9 or newer:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --reload --env-file .env
```

The first startup downloads `yolov8n.pt` from Ultralytics if it is not already in the Ultralytics model cache. A network connection is needed only for that first download. No image sample or separate dataset download is required. Inference is configured for CPU and uses the small nano model.

Install Ollama from [ollama.com](https://ollama.com/download), start the Ollama app **or** run `ollama serve` (only one server should own port 11434), then download Gemma once:

```bash
ollama pull gemma4:e2b
```

If Gemma is missing or Ollama is offline, `/recommend` returns a clearly marked deterministic local fallback.

## Optional n8n automation

Set `N8N_WEBHOOK_URL` in the local `backend/.env` to the n8n production webhook URL. Leave it blank to keep the integration offline. A critical real image analysis requests its recommendation first, then POSTs metrics and that recommendation to n8n with a short timeout. A non-2xx response, timeout, or connection error is returned as `status: "offline"`; the YOLO result and recommendation remain available. The demo scenario never dispatches a workflow. See [`automation/n8n-workflow.md`](../automation/n8n-workflow.md).

The `/automation/dispatch` response is separate from the analysis and recommendation responses:

```json
{"status":"dispatched","dispatchedAt":"2026-10-01T12:42:08+05:30","detail":null}
```

Possible dispatch statuses are `dispatched`, `offline`, and `not_triggered`. `GET /automation/status` reports `offline` when the URL is unset and `standby` when configured; it never claims reachability before a dispatch. `dispatched` means n8n returned a successful HTTP status; it does not verify what downstream notification nodes do.

If Uvicorn prints `Address already in use` on port 8000, another backend is already listening. Check it with `lsof -nP -iTCP:8000 -sTCP:LISTEN`; reuse that server or stop its owning terminal with Ctrl+C before starting another one.

Health check: `http://localhost:8000/health`. Interactive API docs: `http://localhost:8000/docs`.

## Analyze an image

```bash
curl -X POST 'http://localhost:8000/analyze?normalized=true' \
  -F 'file=@crowd.jpg;type=image/jpeg'
```

Only `.jpg`, `.jpeg`, and `.png` uploads are accepted. The upload size defaults to 10 MB; decoded images are limited to 20 megapixels. Use `normalized=false` (the default) for pixel coordinates or `normalized=true` for coordinates in the 0–1 range relative to image width and height. `coordinatesNormalized` in the response identifies the selected form.

## Local operational recommendation

`POST /recommend` accepts only the YOLO summary metrics and a zone name. It sends no image or detection boxes to Ollama:

```bash
curl -X POST 'http://localhost:8000/recommend' \
  -H 'Content-Type: application/json' \
  -d '{"peopleCount":42,"riskLevel":"CRITICAL","riskScore":100,"occupancyPercent":86,"zoneName":"Gate A"}'
```

With Ollama available, the response uses `model: "gemma4:e2b"` and `localInference: true`. If the local model is unavailable, times out, or returns an unsupported recommendation, a deterministic rule response is returned with `model: "rule-based-fallback"` and `fallback: true`. Both paths return one recommendation of at most two sentences.

Response shape:

```json
{
  "peopleCount": 23,
  "riskLevel": "HIGH",
  "riskScore": 66,
  "occupancyPercent": 46,
  "confidence": 0.91,
  "processingMs": 142,
  "coordinatesNormalized": true,
  "detections": [
    { "x1": 0.12, "y1": 0.08, "x2": 0.3, "y2": 0.6, "confidence": 0.92 }
  ]
}
```

## Prototype calculations and limits

Risk labels use person-count thresholds in `settings.py`: 0–10 LOW, 11–20 MODERATE, 21–35 HIGH, and above 35 CRITICAL. `riskScore` is the count divided by the HIGH threshold and capped at 100. `occupancyPercent` is a count divided by a configurable prototype reference value (default 50), also capped at 100. Neither value is a mathematically accurate physical crowd density or a safety certification. Production deployments must calibrate capacity, camera geometry, occlusion, and operating thresholds for each physical zone using on-site validation.

The API does not identify or recognize people, analyze faces, or persist images or biometric data. It performs person-object detection only. CORS allows the local Next.js origins by default; adjust `SHAKTIFLOW_CORS_ORIGINS` for another development origin.

## Smoke test

```bash
cd backend
source .venv/bin/activate
python test_backend.py
```

The smoke test substitutes a tiny fake model so it checks both routes and normalized coordinates without downloading YOLO weights. The running service uses the real model.

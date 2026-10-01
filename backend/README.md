# ShaktiFlow image analysis API

Image-first FastAPI service. It runs the pretrained `yolov8n.pt` model with COCO's `person` class only. Requests are decoded and inferred in memory; uploaded image bytes are not written to disk or retained after the request. The model weights are cached by Ultralytics separately from uploaded data. Defaults use `imgsz=960`, confidence `0.25`, model and global IoU `0.45`, and optional overlapping 1280px tiles for large frames with small or distant people. A whole-image pass runs first; clear ordinary groups skip tiles. Global NMS and conservative containment suppression merge whole-image and tile boxes before any count or scene metric is calculated. Images are aspect-preservingly reduced to a 2560px long side; normalized detections still refer to the original uploaded frame.

## Install and run

From the repository root on Python 3.9 or newer:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --reload
```

From the `shaktiflow/` directory, use `backend/.venv/bin/uvicorn --app-dir backend app:app --reload`. The same `backend/.env` is loaded in either case.

The first startup downloads `yolov8n.pt` from Ultralytics if it is not already in the Ultralytics model cache. A network connection is needed only for that first download. No image sample or separate dataset download is required. CPU inference uses the small nano model. Confidence, IoU, containment, minimum area, image size, tile size/overlap, slicing threshold, and analysis resolution are configurable in `.env`. Set `DETECTION_DEBUG=true` to log candidate and final counts while investigating an image.

Install Ollama from [ollama.com](https://ollama.com/download), start the Ollama app **or** run `ollama serve` (only one server should own port 11434), then download Gemma once:

```bash
ollama pull gemma4:e2b
```

If Gemma is missing or Ollama is offline, `/recommend` returns a clearly marked deterministic local fallback.

## Optional n8n automation

Set `N8N_WEBHOOK_URL` in the local `backend/.env` to the n8n production webhook URL. The backend loads that file relative to `settings.py`, including when Uvicorn is launched without `--env-file`; explicitly exported environment variables take precedence. Restart Uvicorn after changing `.env`. Leave the URL blank to keep the integration offline. A critical real image analysis requests its recommendation first, then POSTs metrics and that recommendation to n8n with a short timeout. A non-2xx response, timeout, or connection error is returned as `status: "offline"`; the YOLO result and recommendation remain available. The demo scenario never dispatches a workflow. See [`automation/n8n-workflow.md`](../automation/n8n-workflow.md).

The `/automation/dispatch` response is separate from the analysis and recommendation responses:

```json
{"status":"dispatched","configured":true,"webhookConfigured":true,"lastDispatchStatus":"success","lastDispatchAt":"2026-10-01T12:42:08+05:30","dispatchedAt":"2026-10-01T12:42:08+05:30","detail":null}
```

Possible dispatch response statuses remain `dispatched`, `offline`, and `not_triggered`. `GET /automation/status` reports `OFFLINE` when unconfigured, `READY` when configured but not yet dispatched, `CONNECTED` after a successful dispatch, and `ERROR` after a failed dispatch. It includes `configured`, `webhookConfigured`, `lastDispatchStatus`, and `lastDispatchAt`. It never probes the POST-only webhook with GET. `CONNECTED` means n8n returned a successful HTTP status; it does not verify what downstream notification nodes do. The last dispatch state is held in memory and resets on backend restart.

If Uvicorn prints `Address already in use` on port 8000, another backend is already listening. Check it with `lsof -nP -iTCP:8000 -sTCP:LISTEN`; reuse that server or stop its owning terminal with Ctrl+C before starting another one.

Health check: `http://localhost:8000/health`. Interactive API docs: `http://localhost:8000/docs`.

## Analyze an image

```bash
curl -X POST 'http://localhost:8000/analyze?normalized=true' \
  -F 'file=@crowd.jpg;type=image/jpeg'
```

Only `.jpg`, `.jpeg`, and `.png` uploads are accepted. The upload size defaults to 25 MB; decoded images up to the configurable safe 80-megapixel limit are resized before inference. Use `normalized=false` (the default) for original-image pixel coordinates or `normalized=true` for coordinates in the 0–1 range relative to the original image width and height. `coordinatesNormalized` in the response identifies the selected form. Pass `dense=true` to force tiled inference for a dense scene.

## Local operational recommendation

`POST /recommend` accepts only the YOLO summary metrics and a zone name. It sends no image or detection boxes to Ollama:

```bash
curl -X POST 'http://localhost:8000/recommend' \
  -H 'Content-Type: application/json' \
  -d '{"peopleCount":43,"riskLevel":"CRITICAL","riskScore":86,"occupancyPercent":86,"zoneName":"Gate A"}'
```

With Ollama available, the response uses `model: "gemma4:e2b"` and `localInference: true`. If the local model is unavailable, times out, or returns an unsupported recommendation, a deterministic rule response is returned with `model: "rule-based-fallback"` and `fallback: true`. Both paths return one recommendation of at most two sentences.

Response shape:

```json
{
  "peopleCount": 23,
  "riskLevel": "MODERATE",
  "riskScore": 46,
  "occupancyPercent": 46,
  "confidence": 0.91,
  "processingMs": 142,
  "coordinatesNormalized": true,
  "crowdPresence": "MODERATE",
  "configuredCapacity": 50,
  "frameBoxOccupancyPercent": 8.2,
  "detections": [
    { "x1": 0.12, "y1": 0.08, "x2": 0.3, "y2": 0.6, "confidence": 0.92 }
  ]
}
```

## Prototype calculations and limits

`occupancyPercent` is visible detections divided by the configurable zone capacity (default 50), capped at 100. `riskScore` is this capacity proxy. Risk thresholds are configured centrally: LOW below 30%, MODERATE from 30%, HIGH from 60%, and CRITICAL from 85%. `crowdPresence` is derived from the final unique count and `settings.py`: NONE at zero detections; LIGHT at one to five detections; DENSE at 25+ visible detections or 50% capacity, or at 10+ detections whose boxes cover at least 25% of the frame; MODERATE at 10+ detections or 30% capacity, or at 6+ detections whose boxes cover at least 12% of the frame; otherwise LIGHT. The dashboard presents NONE as NO PEOPLE and LIGHT with up to five people as SMALL GROUP. Frame-box occupancy sums detected box areas and caps at 100%; overlapping box area may be counted more than once. These are conservative prototype categories, not physical density, and do not estimate hidden people. Production deployments must calibrate venue capacity, camera geometry, occlusion, and thresholds per physical zone through on-site validation. The response represents visible detections; dense or occluded scenes may contain additional people.

The API does not identify or recognize people, analyze faces, or persist images or biometric data. It performs person-object detection only. CORS allows the local Next.js origins by default; adjust `SHAKTIFLOW_CORS_ORIGINS` for another development origin.

## Smoke test

```bash
cd backend
source .venv/bin/activate
python test_backend.py
```

The smoke test substitutes a tiny fake model so it checks both routes and normalized coordinates without downloading YOLO weights. The running service uses the real model.

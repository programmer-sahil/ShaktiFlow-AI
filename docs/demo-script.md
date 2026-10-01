# ShaktiFlow — 90-second demo

**0:00–0:15 · Problem**

At a busy event, control-room teams need a clear view of where crowd levels may need attention. A camera can show a scene, but operators still need a concise signal they can act on.

**0:15–0:30 · Product**

This is ShaktiFlow, a privacy-preserving crowd-operations command center. I’ll choose **Load Demo Scenario**. These values are explicitly simulated and bundled locally, so this demo works without internet or model services.

**0:30–0:50 · Show the decision view**

The dashboard shows a critical sample count, occupancy proxy, confidence, detection boxes, zone status, and incident timeline. The risk bands are transparent prototype thresholds; they are not physical crowd-density measurements.

**0:50–1:05 · AI and privacy**

For a real JPG or PNG upload, FastAPI runs person-only YOLO detection. Gemma 4 can produce one short operations recommendation through local Ollama using metrics only. ShaktiFlow does not use facial recognition, retain uploaded images, or send imagery to a commercial LLM API.

**1:05–1:20 · Automation**

For a real critical result, an optional n8n webhook can create an incident workflow and notify a response team. This demo does not send a webhook; the status shown reflects actual configuration and dispatch responses.

**1:20–1:30 · Close**

ShaktiFlow is decision support for operators, not a guarantee of safety. Before real use, each venue needs capacity and camera-geometry calibration plus field validation.

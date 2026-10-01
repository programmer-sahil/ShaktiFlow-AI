# ShaktiFlow — judge Q&A

### What problem are you solving?

We give event operators a concise, image-based crowd summary and a suggested next step when a zone may need attention.

### Why use AI?

Person detection automates a basic count from an image, and a local language model turns the supplied metrics into concise operational wording. Rules remain visible and provide a fallback.

### What is open-source AI here?

We use the Ultralytics YOLO software/model and Gemma 4 open weights. Their licenses are separate from the application; model files are not included in this repository.

### Why Gemma?

Gemma 4 E2B can run locally through Ollama, so this prototype can generate recommendations without sending crowd imagery or metrics to a commercial LLM API.

### Why not facial recognition?

The operational need is an anonymous count, not identity. The MVP detects only the person class and does not match identities or analyze faces.

### How is privacy protected?

Uploaded images are processed in memory and are not retained by the MVP. The language model receives metrics only; n8n receives metrics and the recommendation, never the image.

### What does n8n do?

On a real critical image result, an optional webhook can pass the event to an incident workflow and optional notification node. ShaktiFlow reports offline on request failure and does not claim delivery beyond webhook HTTP acceptance.

### What happens without internet?

The bundled demo scenario uses local simulated values and works without the backend or model downloads. Real YOLO analysis needs its weights available locally; Gemma needs Ollama and its model locally. If Ollama is unavailable, recommendations fall back to deterministic rules.

### How would this scale?

First calibrate and validate each venue's zone capacity and camera geometry. A larger deployment could run inference near cameras, isolate zones, and use managed queues and monitored workflow delivery; those parts are not implemented in this MVP.

### What are the limitations?

Risk thresholds are prototype heuristics, not physical density measurements. The MVP handles single images, not live streams or motion over time, and detections can be affected by occlusion, angle, and image quality. Recommendations require operator review.

### What did you build during the hackathon?

A Next.js operations dashboard, FastAPI image-analysis API with person-only YOLO detection, local Gemma recommendation path with deterministic fallback, optional n8n webhook workflow, offline demo scenario, and setup and judging documentation.

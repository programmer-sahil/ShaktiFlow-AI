"""Prototype operating settings. Calibrate these per physical zone before deployment."""

from __future__ import annotations

import os

# Person-count bands used for the transparent demo risk label.
RISK_THRESHOLDS = {
    "LOW_MAX": 10,
    "MODERATE_MAX": 20,
    "HIGH_MAX": 35,
}

MODEL_NAME = os.getenv("SHAKTIFLOW_MODEL", "yolov8n.pt")
MODEL_CONFIDENCE = float(os.getenv("SHAKTIFLOW_MODEL_CONFIDENCE", "0.25"))
OLLAMA_BASE_URL = os.getenv("SHAKTIFLOW_OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("SHAKTIFLOW_OLLAMA_MODEL", "gemma4:e2b")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("SHAKTIFLOW_OLLAMA_TIMEOUT_SECONDS", "45"))
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL", "").strip()
N8N_TIMEOUT_SECONDS = float(os.getenv("N8N_TIMEOUT_SECONDS", "3"))
MAX_UPLOAD_BYTES = int(os.getenv("SHAKTIFLOW_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("SHAKTIFLOW_MAX_IMAGE_PIXELS", "20000000"))

# A demo denominator for a count-based occupancy proxy, not real capacity.
PROTOTYPE_ZONE_CAPACITY = int(os.getenv("SHAKTIFLOW_PROTOTYPE_ZONE_CAPACITY", "50"))

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "SHAKTIFLOW_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

"""Privacy-preserving, image-first crowd counting API for the ShaktiFlow MVP."""

from __future__ import annotations

import logging
import platform
import re
import time
from datetime import datetime
from io import BytesIO
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Literal, Optional

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from settings import (
    CORS_ORIGINS,
    MAX_IMAGE_PIXELS,
    MAX_UPLOAD_BYTES,
    MODEL_CONFIDENCE,
    MODEL_NAME,
    N8N_TIMEOUT_SECONDS,
    N8N_WEBHOOK_URL,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT_SECONDS,
    PROTOTYPE_ZONE_CAPACITY,
    RISK_THRESHOLDS,
)

logger = logging.getLogger("shaktiflow")
API_VERSION = "1.0.0"
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
UNSUPPORTED_RECOMMENDATION_RE = re.compile(
    r"\b(staff|personnel|police|ambulance|emergency|evacuat\w*|injur\w*|fire|"
    r"stampede|panic|collapse|medical|hazard|redirect\w*|divert\w*|security team)\b",
    re.IGNORECASE,
)


class Detection(BaseModel):
    x1: float = Field(description="Pixel or normalized horizontal coordinate")
    y1: float = Field(description="Pixel or normalized vertical coordinate")
    x2: float = Field(description="Pixel or normalized horizontal coordinate")
    y2: float = Field(description="Pixel or normalized vertical coordinate")
    confidence: float = Field(ge=0, le=1)


class AnalysisResponse(BaseModel):
    peopleCount: int
    riskLevel: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    riskScore: int = Field(ge=0, le=100)
    occupancyPercent: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    processingMs: int = Field(ge=0)
    coordinatesNormalized: bool
    detections: list[Detection]


class RecommendationRequest(BaseModel):
    peopleCount: int = Field(ge=0, le=100000)
    riskLevel: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    riskScore: int = Field(ge=0, le=100)
    occupancyPercent: int = Field(ge=0, le=100)
    zoneName: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$")


class RecommendationResponse(BaseModel):
    recommendation: str
    model: str
    localInference: bool
    fallback: bool = False


class AutomationStatus(BaseModel):
    status: Literal["dispatched", "offline", "not_triggered", "standby"]
    dispatchedAt: Optional[str] = None
    detail: Optional[str] = None


class AutomationRequest(RecommendationRequest):
    recommendation: str = Field(min_length=1, max_length=500)


def load_yolo_model() -> Any:
    """Load the small pretrained model once when the application starts."""
    from ultralytics import YOLO

    return YOLO(MODEL_NAME)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.model = None
    app.state.model_error = None
    try:
        app.state.model = load_yolo_model()
        logger.info("Loaded YOLO model %s", MODEL_NAME)
    except Exception as exc:  # Keep health available so the startup problem is diagnosable.
        app.state.model_error = str(exc)
        logger.exception("Could not load YOLO model %s", MODEL_NAME)
    yield


app = FastAPI(
    title="ShaktiFlow Crowd Analysis API",
    description="Image-only person detection for a crowd-safety prototype.",
    version=API_VERSION,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def _package_version(package: str) -> str | None:
    try:
        return version(package)
    except PackageNotFoundError:
        return None


def _number(value: Any) -> float:
    """Convert Python, NumPy, or Torch scalar values to a float."""
    if hasattr(value, "item"):
        value = value.item()
    return float(value)


def _values(value: Any) -> list[float]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    return [float(part) for part in value]


def _risk_level(people_count: int) -> str:
    if people_count <= RISK_THRESHOLDS["LOW_MAX"]:
        return "LOW"
    if people_count <= RISK_THRESHOLDS["MODERATE_MAX"]:
        return "MODERATE"
    if people_count <= RISK_THRESHOLDS["HIGH_MAX"]:
        return "HIGH"
    return "CRITICAL"


def _fallback_recommendation(metrics: RecommendationRequest) -> str:
    zone = metrics.zoneName.strip()
    if metrics.riskLevel == "CRITICAL":
        return f"Pause new entry into {zone} and reassess when its reported occupancy is below 70%."
    if metrics.riskLevel == "HIGH":
        return f"Meter new entry into {zone} while occupancy remains elevated. Reassess when reported occupancy falls below 70%."
    if metrics.riskLevel == "MODERATE":
        return f"Manage arrivals to {zone} at a controlled pace and monitor the reported risk score."
    return f"Continue monitoring {zone} and maintain normal flow while the supplied metrics remain low."


def _limit_sentences(text: str) -> str:
    cleaned = " ".join(text.strip().strip('"\'`').split())
    if cleaned.startswith(("- ", "* ", "• ")):
        cleaned = cleaned[2:].strip()
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    return " ".join(sentences[:2]).strip()


async def _ollama_recommendation(metrics: RecommendationRequest) -> str:
    system_prompt = (
        "You are a concise operations decision-support assistant for crowd management. "
        "Use only the supplied zone name and numeric crowd metrics. Do not invent or imply "
        "injuries, emergencies, hazards, routes, staffing, observations, or other facts. "
        "Recommend only monitoring, controlled entry, metering entry, or temporarily pausing entry "
        "at the named zone; do not mention another gate or destination. "
        "Return exactly one practical operational recommendation in plain text, in no more "
        "than two concise sentences. Do not claim that any action has already been taken."
    )
    user_prompt = (
        f"Zone: {metrics.zoneName.strip()}\n"
        f"People count: {metrics.peopleCount}\n"
        f"Risk level: {metrics.riskLevel}\n"
        f"Risk score: {metrics.riskScore}/100\n"
        f"Occupancy proxy: {metrics.occupancyPercent}%\n"
        "Provide one operational recommendation based only on these values."
    )
    timeout = httpx.Timeout(OLLAMA_TIMEOUT_SECONDS, connect=min(5.0, OLLAMA_TIMEOUT_SECONDS))
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "think": False,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "options": {"temperature": 0.2, "num_predict": 100},
            },
        )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Ollama response was not a JSON object")
    message = payload.get("message")
    if not isinstance(message, dict):
        raise ValueError("Ollama response did not include a message")
    content = message.get("content", "")
    recommendation = _limit_sentences(content) if isinstance(content, str) else ""
    if not recommendation:
        raise ValueError("Ollama returned an empty recommendation")
    return recommendation


async def _dispatch_critical_automation(
    metrics: RecommendationRequest,
    recommendation: str,
) -> AutomationStatus:
    if metrics.riskLevel != "CRITICAL":
        return AutomationStatus(status="not_triggered")
    if not N8N_WEBHOOK_URL:
        return AutomationStatus(status="offline", detail="Webhook URL is not configured")

    timestamp = datetime.now().astimezone().isoformat(timespec="seconds")
    payload = {
        "event": "crowd_risk_detected",
        "severity": "CRITICAL",
        "zone": metrics.zoneName,
        "peopleCount": metrics.peopleCount,
        "occupancyPercent": metrics.occupancyPercent,
        "riskScore": metrics.riskScore,
        "recommendation": recommendation,
        "timestamp": timestamp,
    }
    try:
        timeout = httpx.Timeout(N8N_TIMEOUT_SECONDS, connect=min(1.5, N8N_TIMEOUT_SECONDS))
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(N8N_WEBHOOK_URL, json=payload)
            response.raise_for_status()
        return AutomationStatus(status="dispatched", dispatchedAt=timestamp)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("n8n webhook dispatch failed; monitoring remains available: %s", exc)
        return AutomationStatus(status="offline", detail="Webhook request failed")


def _validate_image(file: UploadFile, content: bytes) -> np.ndarray:
    filename = (file.filename or "").lower()
    extension = filename[filename.rfind(".") :] if "." in filename else ""
    if file.content_type not in ALLOWED_CONTENT_TYPES or extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Upload a JPG or PNG image.")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")

    try:
        with Image.open(BytesIO(content)) as inspected:
            if inspected.format not in {"JPEG", "PNG"}:
                raise HTTPException(status_code=415, detail="Upload a JPG or PNG image.")
            width, height = inspected.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=400, detail="The upload is not a valid JPG or PNG image.") from exc
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(
            status_code=413,
            detail=f"Image dimensions exceed the {MAX_IMAGE_PIXELS:,}-pixel limit.",
        )

    image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="The upload is not a valid JPG or PNG image.")
    return image


@app.get("/health")
async def health(request: Request) -> dict[str, Any]:
    model = getattr(request.app.state, "model", None)
    return {
        "status": "ok" if model is not None else "degraded",
        "model": {
            "name": MODEL_NAME,
            "loaded": model is not None,
            "error": getattr(request.app.state, "model_error", None),
        },
        "versions": {
            "api": API_VERSION,
            "python": platform.python_version(),
            "fastapi": _package_version("fastapi"),
            "ultralytics": _package_version("ultralytics"),
            "opencv": cv2.__version__,
        },
    }


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze(
    request: Request,
    file: UploadFile = File(..., description="JPG or PNG crowd image"),
    normalized: bool = Query(
        default=False,
        description="Return box coordinates in the 0..1 image-relative range instead of pixels.",
    ),
) -> AnalysisResponse:
    model = getattr(request.app.state, "model", None)
    if model is None:
        raise HTTPException(status_code=503, detail="The detection model is not available.")

    started = time.perf_counter()
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Image exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.",
            )
        image = _validate_image(file, content)
    finally:
        await file.close()

    try:
        result = model.predict(
            source=image,
            classes=[0],  # COCO person class only; no face or identity processing.
            conf=MODEL_CONFIDENCE,
            imgsz=640,
            device="cpu",
            verbose=False,
        )[0]
    except Exception as exc:
        logger.exception("YOLO inference failed")
        raise HTTPException(status_code=500, detail="Image analysis failed.") from exc
    height, width = image.shape[:2]
    detections: list[Detection] = []
    boxes = getattr(result, "boxes", None)
    if boxes is not None:
        for coordinates, confidence, class_id in zip(boxes.xyxy, boxes.conf, boxes.cls):
            if int(_number(class_id)) != 0:
                continue
            x1, y1, x2, y2 = _values(coordinates)
            x1, x2 = min(width, max(0.0, x1)), min(width, max(0.0, x2))
            y1, y2 = min(height, max(0.0, y1)), min(height, max(0.0, y2))
            score = min(1.0, max(0.0, _number(confidence)))
            if normalized:
                x1, x2 = x1 / width, x2 / width
                y1, y2 = y1 / height, y2 / height
                x1, y1, x2, y2 = (round(value, 6) for value in (x1, y1, x2, y2))
            detections.append(
                Detection(x1=x1, y1=y1, x2=x2, y2=y2, confidence=round(score, 4))
            )

    count = len(detections)
    # These are transparent prototype indices, not calibrated physical crowd density.
    risk_score = min(100, round(count / max(1, RISK_THRESHOLDS["HIGH_MAX"]) * 100))
    occupancy_percent = min(100, round(count / max(1, PROTOTYPE_ZONE_CAPACITY) * 100))
    mean_confidence = round(sum(item.confidence for item in detections) / count, 4) if count else 0.0
    processing_ms = round((time.perf_counter() - started) * 1000)

    return AnalysisResponse(
        peopleCount=count,
        riskLevel=_risk_level(count),
        riskScore=risk_score,
        occupancyPercent=occupancy_percent,
        confidence=mean_confidence,
        processingMs=processing_ms,
        coordinatesNormalized=normalized,
        detections=detections,
    )


@app.post("/recommend", response_model=RecommendationResponse)
async def recommend(metrics: RecommendationRequest) -> RecommendationResponse:
    try:
        text = _limit_sentences(await _ollama_recommendation(metrics))
        if not text:
            raise ValueError("Recommendation was empty after formatting")
        if UNSUPPORTED_RECOMMENDATION_RE.search(text):
            raise ValueError("Ollama recommended unsupported facts or controls")
        return RecommendationResponse(
            recommendation=text,
            model=OLLAMA_MODEL,
            localInference=True,
            fallback=False,
        )
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        logger.warning("Ollama recommendation unavailable; using local rules: %s", exc)
        fallback_text = _fallback_recommendation(metrics)
        return RecommendationResponse(
            recommendation=fallback_text,
            model="rule-based-fallback",
            localInference=True,
            fallback=True,
        )


@app.post("/automation/dispatch", response_model=AutomationStatus)
async def dispatch_automation(metrics: AutomationRequest) -> AutomationStatus:
    """Optionally dispatch a critical analysis; webhook errors never affect monitoring."""
    return await _dispatch_critical_automation(metrics, metrics.recommendation)


@app.get("/automation/status", response_model=AutomationStatus)
async def automation_status() -> AutomationStatus:
    """Report configuration without claiming the remote webhook is reachable."""
    if not N8N_WEBHOOK_URL:
        return AutomationStatus(status="offline", detail="Webhook URL is not configured")
    return AutomationStatus(status="standby", detail="Configured; reachability is confirmed on dispatch")

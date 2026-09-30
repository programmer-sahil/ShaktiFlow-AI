import type { AutomationStatus, CrowdAnalysisResult, RecommendationResult } from "./types";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

/** Submit one image for person-only detection and normalized bounding boxes. */
export async function analyzeCrowd(file: File): Promise<CrowdAnalysisResult> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_BASE_URL}/analyze?normalized=true`, { method: "POST", body });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(error?.detail ?? `Analysis request failed (${response.status})`);
  }
  return response.json() as Promise<CrowdAnalysisResult>;
}

export async function recommendCrowd(
  result: CrowdAnalysisResult,
  zoneName: string,
): Promise<RecommendationResult> {
  const response = await fetch(`${API_BASE_URL}/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      peopleCount: result.peopleCount,
      riskLevel: result.riskLevel,
      riskScore: result.riskScore,
      occupancyPercent: result.occupancyPercent,
      zoneName,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(error?.detail ?? `Recommendation request failed (${response.status})`);
  }
  return response.json() as Promise<RecommendationResult>;
}

export async function dispatchCriticalAutomation(
  result: CrowdAnalysisResult,
  zoneName: string,
  recommendation: string,
): Promise<AutomationStatus> {
  const response = await fetch(`${API_BASE_URL}/automation/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      peopleCount: result.peopleCount,
      riskLevel: result.riskLevel,
      riskScore: result.riskScore,
      occupancyPercent: result.occupancyPercent,
      zoneName,
      recommendation,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(error?.detail ?? `Automation request failed (${response.status})`);
  }
  return response.json() as Promise<AutomationStatus>;
}

export async function getAutomationStatus(): Promise<AutomationStatus> {
  const response = await fetch(`${API_BASE_URL}/automation/status`);
  if (!response.ok) throw new Error(`Automation status request failed (${response.status})`);
  return response.json() as Promise<AutomationStatus>;
}

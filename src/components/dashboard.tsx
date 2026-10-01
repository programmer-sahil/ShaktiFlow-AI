"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";
import {
  AlertTriangle, Camera, CheckCircle2, Clock3, LockKeyhole,
  ChevronDown, MapPin, MoreHorizontal, Shield, Trash2, Upload, Users,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { analyzeCrowd, dispatchCriticalAutomation, getAutomationStatus, recommendCrowd } from "@/lib/api";
import { demoCrowdAnalysis } from "@/lib/demo-data";
import type { AutomationStatus, CrowdAnalysisResult, PersonDetection, RecommendationResult, SessionAnalysis } from "@/lib/types";

const navigation = [
  { label: "Monitor", id: "monitor" },
  { label: "Incidents", id: "incidents" },
  { label: "Analytics", id: "analytics" },
  { label: "Automation", id: "automation" },
  { label: "System", id: "system" },
];

function Sidebar({ workspaceStatus }: { workspaceStatus: string }) {
  const [selected, setSelected] = useState("monitor");
  return <header className="sidebar">
    <a className="brand" href="#command-center" aria-label="ShaktiFlow command center">
      <span>SHAKTI<span className="brand-light">FLOW</span></span>
      <small>CROWD INTELLIGENCE</small>
    </a>
    <nav className="nav-list" aria-label="Command navigation">{navigation.map(item =>
      <a key={item.id} href={`#${item.id}`} onClick={() => setSelected(item.id)} className={`nav-item ${selected === item.id ? "selected" : ""}`}>{item.label}</a>,
    )}</nav>
    <div className="header-status"><i />{workspaceStatus}</div>
  </header>;
}

function Topbar({ onLoadDemo, workspaceStatus }: { onLoadDemo: () => void; workspaceStatus: string }) {
  const [now, setNow] = useState("14:32:08");
  useEffect(() => {
    const tick = () => setNow(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()));
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, []);
  return <div className="topbar"><div className="topbar-title"><MapPin size={12} /><span>KOLKATA</span><span className="crumb-divider">/</span><span>COMMAND CENTER</span><span className="crumb-divider">/</span><b>{workspaceStatus}</b></div>
    <div className="topbar-actions"><div className="clock"><Clock3 size={13} /><span>{now}</span><span className="clock-zone">IST</span></div><button className="demo-button" onClick={onLoadDemo}>LOAD DEMO</button><button className="new-analysis" onClick={() => document.getElementById("file-upload")?.click()}>NEW ANALYSIS <span>↗</span></button></div>
  </div>;
}

function Metric({ title, value, unit, tone, note }: { title: string; value: string; unit?: string; tone?: string; note: string }) {
  return <article className={`metric ${tone ?? ""}`}><div className="metric-label">{title}</div><div className="metric-value">{value}{unit && <small>{unit}</small>}</div><div className="metric-foot">{note}</div></article>;
}

type AnalysisState = "idle" | "analyzing" | "complete" | "demo" | "error";
const SESSION_HISTORY_KEY = "shaktiflow.analysis-history.v1";

function VideoFeed({
  result,
  status,
  error,
  demoVersion,
  onAnalysisStart,
  onAnalysisResult,
  onAnalysisError,
}: {
  result: CrowdAnalysisResult | null;
  status: AnalysisState;
  error: string | null;
  demoVersion: number;
  onAnalysisStart: () => number;
  onAnalysisResult: (result: CrowdAnalysisResult, requestId: number) => void;
  onAnalysisError: (message: string, requestId: number) => void;
}) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [feedSize, setFeedSize] = useState({ width: 0, height: 0 });
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const lastDemoVersion = useRef(0);

  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  }, [fileUrl]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const observer = new ResizeObserver(([entry]) => {
      setFeedSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(feed);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (demoVersion === 0 || demoVersion === lastDemoVersion.current) return;
    lastDemoVersion.current = demoVersion;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(null);
    setFileName("");
    setSourceSize({ width: 0, height: 0 });
  }, [demoVersion, fileUrl]);

  const onFile = async (file?: File) => {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png"]).has(file.type)) {
      onAnalysisError("Choose a JPG or PNG image to run person detection.", onAnalysisStart());
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      onAnalysisError("Image is over the 25 MB upload limit.", onAnalysisStart());
      return;
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileName(file.name);
    setFileUrl(URL.createObjectURL(file));
    setSourceSize({ width: 0, height: 0 });
    const requestId = onAnalysisStart();
    try {
      const analysisResult = await analyzeCrowd(file);
      onAnalysisResult(analysisResult, requestId);
    } catch (cause) {
      onAnalysisError(cause instanceof Error ? cause.message : "Image analysis failed.", requestId);
    }
  };

  const boxStyle = (detection: PersonDetection): CSSProperties | undefined => {
    const { width, height } = feedSize;
    if (!width || !height) return undefined;
    let displayWidth = width;
    let displayHeight = height;
    let offsetX = 0;
    let offsetY = 0;
    if (fileUrl && sourceSize.width && sourceSize.height) {
      const scale = Math.max(width / sourceSize.width, height / sourceSize.height);
      displayWidth = sourceSize.width * scale;
      displayHeight = sourceSize.height * scale;
      offsetX = (width - displayWidth) / 2;
      offsetY = (height - displayHeight) / 2;
    }
    const left = offsetX + detection.x1 * displayWidth;
    const top = offsetY + detection.y1 * displayHeight;
    const right = offsetX + detection.x2 * displayWidth;
    const bottom = offsetY + detection.y2 * displayHeight;
    return {
      left: `${(left / width) * 100}%`,
      top: `${(top / height) * 100}%`,
      width: `${((right - left) / width) * 100}%`,
      height: `${((bottom - top) / height) * 100}%`,
    };
  };

  const showDemo = status === "demo";
  const showUpload = !fileUrl && !result && (status === "idle" || status === "error");
  return <section className="panel intelligence-panel">
    <div className="panel-heading"><div><div className="eyebrow">IMAGE MONITOR <span className="heading-separator">/</span> ZONE A</div><h2>Live Crowd Intelligence</h2></div><button className="subtle-button"><span className="green-led" /> {showDemo ? "LOCAL DEMO" : fileUrl ? "IMAGE INPUT" : "SAMPLE FEED"} <ChevronDown size={13} /></button></div>
    <div ref={feedRef} className={`feed ${dragging ? "dragging" : ""} ${status === "analyzing" ? "analyzing" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void onFile(e.dataTransfer.files[0]); }} onClick={() => !fileUrl && status !== "analyzing" && inputRef.current?.click()}>
      <input ref={inputRef} id="file-upload" type="file" accept="image/jpeg,image/png" hidden onChange={e => { void onFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
      {fileUrl ? <Image className="uploaded-media" src={fileUrl} alt="Uploaded crowd image" fill unoptimized sizes="(max-width: 800px) 100vw, 70vw" onLoad={event => setSourceSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> : <div className="feed-scene" aria-hidden="true"><div className="scene-ceiling" /><div className="scene-backwall" /><div className="scene-gate"><div className="gate-sign">GATE A <span>ENTRY</span></div><div className="gate-opening" /><div className="gate-post" /></div><div className="scene-lights"><i /><i /><i /><i /></div><div className="scene-crowd">{Array.from({ length: 35 }, (_, i) => <i key={i} className={`person p${i + 1}`}><b /></i>)}</div><div className="scene-floor" /><div className="scan-line" /><div className="tracking-box box-a"><i /><i /><i /><i /><span>PERSON · 98%</span></div><div className="tracking-box box-b"><i /><i /><i /><i /><span>PERSON · 94%</span></div><div className="tracking-box box-c"><i /><i /><i /><i /><span>PERSON · 91%</span></div><div className="scene-vignette" /></div>}
      {(result?.detections ?? []).map((detection, index) => {
        const style = boxStyle(detection);
        return <div className="detection-box" style={style} key={`${index}-${detection.x1}`} aria-label={`Visible person detection · ${Math.round(detection.confidence * 100)}% confidence`}>{result && result.detections.length <= 20 && <span>PERSON · {Math.round(detection.confidence * 100)}%</span>}</div>;
      })}
      <div className="feed-top-overlay"><span className="camera-tag"><Camera size={12} /> CAMERA 01</span><span className={`live-tag ${showDemo ? "demo" : fileUrl ? "image" : "sample"}`}><i /> {showDemo ? "DEMO" : fileUrl ? "IMAGE" : "SAMPLE"}</span></div>
      <div className="feed-bottom-overlay"><div className="feed-caption"><span>GATE A · NORTH ENTRANCE</span><small>{showDemo ? "BUNDLED DEMO SCENARIO" : fileUrl ? `${fileName} · UPLOADED IMAGE` : "SAMPLE PREVIEW · NO LIVE CAMERA CONNECTION"}</small></div><div className="privacy-tag"><LockKeyhole size={11} /> PRIVACY-SAFE MONITORING</div></div>
      {status === "analyzing" && <div className="analysis-activity" role="status"><span className="activity-spinner" /><span>YOLO PERSON DETECTION</span><small>Analyzing image locally</small></div>}
      {showDemo && <div className="demo-scene-tag">LOCAL DEMO · MOCK METRICS</div>}
      {showUpload && <button className="feed-upload" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}><Upload size={14} /><span>Drop an image or <b>browse files</b></span><small>JPG, PNG · up to 25 MB</small></button>}
    </div>
    {status === "error" && error && <div className="analysis-error" role="alert">{error}<span>Try again or load the local demo scenario.</span></div>}
    <div className="feed-footer"><div className="feed-stat"><span className="feed-stat-icon"><Users size={14} /></span><div><b>{result ? `${result.peopleCount} visible people detected` : status === "analyzing" ? "Analyzing crowd image…" : "Awaiting image analysis"}</b><small>{result ? `YOLO · ${result.detections.length} person boxes returned` : status === "demo" ? "Simulated demo values · no network required" : "Upload a JPG or PNG to begin"}</small></div></div><div className="feed-footer-right"><span className="detect-state"><i /> {status === "analyzing" ? "Detection in progress" : result ? "Person detection complete" : "Person detection ready"}</span><button className="square-button" aria-label="Feed options"><MoreHorizontal size={16} /></button></div></div>
  </section>;
}

function RiskAssessment({ result, demo, currentDispatchStatus, automationLoading }: { result: CrowdAnalysisResult | null; demo: boolean; currentDispatchStatus: "success" | "failed" | null; automationLoading: boolean }) {
  const level = result?.riskLevel ?? "—";
  const isCritical = level === "CRITICAL";
  const confidence = result ? `${Math.round(result.confidence * 100)}%` : "—";
  const presence = result?.crowdPresence === "NONE" ? "NO PEOPLE"
    : result?.crowdPresence === "LIGHT" && result.peopleCount <= 5 ? "SMALL GROUP"
    : result?.crowdPresence ?? (demo ? "DENSE" : "Awaiting analysis");
  return <section className="panel risk-panel"><div className="panel-heading compact"><div><div className="eyebrow">{demo ? "LOCAL DEMO · SIMULATED VALUES" : "LIVE INTELLIGENCE"} <span className="heading-separator">/</span> ZONE A</div><h2>Current state</h2></div></div>
    <div className="risk-metric-grid">
      <div><strong>{result?.peopleCount ?? (demo ? demoCrowdAnalysis.peopleCount : "—")}</strong><span>VISIBLE PEOPLE</span></div>
      <div><strong>{result?.occupancyPercent ?? (demo ? demoCrowdAnalysis.occupancyPercent : "—")}%</strong><span>OCCUPANCY</span></div>
      <div><strong>{result?.riskScore ?? (demo ? demoCrowdAnalysis.riskScore : "—")}</strong><span>RISK SCORE</span></div>
      <div><strong>{result ? confidence : demo ? "94%" : "—"}</strong><span>CONFIDENCE</span></div>
    </div>
    <div className={`risk-level ${level === "—" ? "empty" : level.toLowerCase()}`}><div><div className="risk-overline">CROWD PRESENCE</div><div className="risk-word">{presence}</div></div><span className="risk-status">{level === "—" ? "NO ANALYSIS" : level}</span></div>
    <div className="capacity-note">Configured capacity: {result?.configuredCapacity ?? 50} · Prototype heuristic</div>
    {isCritical && <div className={`automation-triggered ${demo ? "demo-trigger" : ""}`}><AlertTriangle size={12} /> {demo ? "DEMO · NO WEBHOOK DISPATCHED" : automationLoading ? "DISPATCHING CRITICAL EVENT" : currentDispatchStatus === "success" ? "AUTOMATION TRIGGERED" : currentDispatchStatus === "failed" ? "AUTOMATION ERROR" : "CRITICAL · DISPATCH PENDING"}<small>{demo ? "Simulated values" : currentDispatchStatus === "success" ? "n8n acknowledged request" : currentDispatchStatus === "failed" ? "Core analysis remains available" : "Awaiting recommendation"}</small></div>}
    <div className="risk-foot"><span><Shield size={13} /> Visible detections; dense/occluded scenes may contain additional people.</span><span>{result ? `YOLO · ${result.processingMs} ms` : "Upload image"}</span></div>
  </section>;
}

function Recommendation({ value, loading }: { value: RecommendationResult | null; loading: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = value?.recommendation ?? "Upload an image to generate a local, metrics-based operational recommendation.";
  const isDemo = value?.model === "demo-scenario";
  return <section className="panel recommendation-panel"><div className="panel-heading compact"><div className="recommend-title"><div><div className="eyebrow">GEMMA 4 <span className="heading-separator">·</span> LOCAL INTELLIGENCE</div><h2>Recommended action</h2></div></div><span className={`generated-badge ${value?.fallback ? "fallback" : ""}`}>{isDemo ? "DEMO VALUES" : value?.fallback ? "RULE-BASED FALLBACK" : value ? "MODEL" : "AWAITING ANALYSIS"}</span></div>
    <div className="recommendation-body">{loading ? <div className="recommendation-skeleton" role="status" aria-label="Generating local recommendation"><span /><span /><span /></div> : <p className="recommendation-text">{text}</p>}</div>
    <div className="recommendation-footer"><span className="recommendation-source"><span className={`green-led ${value?.fallback ? "fallback-led" : ""}`} /> {isDemo ? "BUNDLED LOCAL DEMO" : "LOCAL INFERENCE · NO COMMERCIAL LLM API"} {value?.fallback && <small>· deterministic fallback</small>}</span><button className="copy-action" disabled={!value || loading} onClick={() => { if (!value) return; void navigator.clipboard?.writeText(value.recommendation); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy action"}</button></div>
    <div className="privacy-note"><LockKeyhole size={11} /> No crowd imagery is sent to a commercial LLM API.</div>
  </section>;
}

function AutomationCard({ status, loading }: { status: AutomationStatus | null; loading: boolean }) {
  const dispatched = status?.status === "CONNECTED";
  const offline = status?.status === "OFFLINE";
  const failed = status?.status === "ERROR";
  const unavailable = status?.status === "UNAVAILABLE";
  const label = status?.status ?? "CHECKING";
  const dispatchedTime = status?.lastDispatchAt
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(status.lastDispatchAt))
    : null;
  return <section className={`panel automation-panel ${dispatched ? "dispatched" : ""} ${offline ? "offline" : ""}`} aria-live="polite">
    <div className="automation-head"><div><div className="eyebrow">AUTOMATION <span className="heading-separator">/</span> N8N</div><h2>Operational workflow</h2></div><span className={`automation-status ${dispatched ? "connected" : offline || failed || unavailable ? "offline" : ""}`}><i />{loading ? "DISPATCHING" : label}</span></div>
    {!offline && <div className="workflow-steps"><span className={dispatched ? "done" : "active"}>DETECTION</span><b aria-hidden="true">↓</b><span className={dispatched ? "done" : ""}>INCIDENT</span><b aria-hidden="true">↓</b><span className={dispatched ? "done" : ""}>RESPONSE</span></div>}
    <div className={`automation-message ${offline ? "offline-copy" : ""}`}>
      {loading ? <><span className="activity-spinner" /> Sending critical event to configured webhook…</> : dispatched ? <><CheckCircle2 size={13} /> Automation dispatched <time>• {dispatchedTime} IST</time></> : failed ? "Last webhook dispatch failed · Core analysis remains available." : offline ? "OFFLINE · Core crowd analysis remains available." : unavailable ? "Backend status unavailable." : status?.status === "READY" ? "Webhook configured · reachability confirmed on dispatch." : "Checking automation configuration."}
    </div>
  </section>;
}

const unavailableAutomationStatus: AutomationStatus = {
  status: "UNAVAILABLE", configured: false, webhookConfigured: false,
  lastDispatchStatus: null, lastDispatchAt: null, dispatchedAt: null,
  detail: "Backend status unavailable",
};

function ZoneTable({ result, demo }: { result: CrowdAnalysisResult | null; demo: boolean }) {
  const visibleResult = result ?? (demo ? demoCrowdAnalysis : null);
  return <section className="panel zone-panel"><div className="panel-heading compact"><div><div className="eyebrow">ZONE INTELLIGENCE</div><h2>Analyzed locations</h2></div></div>
    {visibleResult ? <div className="zone-table"><div className="zone-row zone-header"><span>ZONE</span><span>LOCATION</span><span>VISIBLE PEOPLE</span><span>OCCUPANCY</span><span>STATUS</span></div><div className="zone-row"><span className="zone-name"><b>Zone A</b></span><span className="zone-checkpoint">Gate A</span><span>{visibleResult.peopleCount}</span><span className="zone-occupancy"><span className="mini-bar"><i style={{ width: `${visibleResult.occupancyPercent}%` }} /></span><b>{visibleResult.occupancyPercent}%</b></span><span><span className={`status-pill ${visibleResult.riskLevel.toLowerCase()}`}><i />{visibleResult.riskLevel}</span></span></div></div> : <div className="empty-state">No analyzed locations yet. Upload an image to add Zone A.</div>}
    {demo && <div className="demo-data-note">SIMULATED DEMO VALUES</div>}
  </section>;
}

function SessionAnalytics({ history, onClear }: { history: SessionAnalysis[]; onClear: () => void }) {
  const average = (selector: (item: SessionAnalysis) => number) => history.length ? history.reduce((total, item) => total + selector(item), 0) / history.length : null;
  const peakPeople = history.length ? Math.max(...history.map(item => item.peopleCount)) : null;
  const peakOccupancy = history.length ? Math.max(...history.map(item => item.occupancyPercent)) : null;
  const riskRank = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
  const highestRisk = history.length ? history.reduce((highest, item) => riskRank.indexOf(item.riskLevel) > riskRank.indexOf(highest) ? item.riskLevel : highest, "LOW" as SessionAnalysis["riskLevel"]) : null;
  const chartData = history.map(item => ({ ...item, time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(item.timestamp)) }));
  const shared = { margin: { top: 8, right: 10, bottom: 0, left: -18 } };
  const axis = { fill: "#777", fontSize: 9, fontFamily: "monospace" };
  const tooltip = { contentStyle: { background: "#090909", border: "1px solid #333", borderRadius: 2, color: "#eee", fontSize: 10 }, labelStyle: { color: "#999" } };
  return <section className="session-analytics" id="analytics">
    <div className="analytics-heading"><div><div className="eyebrow">SESSION ANALYTICS <span className="heading-separator">/</span> REAL IMAGE ANALYSES</div><h2>Analysis history</h2></div><button className="clear-history" onClick={onClear} disabled={!history.length}><Trash2 size={12} /> Clear session history</button></div>
    <div className="analytics-metrics">
      <Metric title="Peak visible people" value={peakPeople === null ? "—" : String(peakPeople)} note="Current session" />
      <Metric title="Peak occupancy" value={peakOccupancy === null ? "—" : `${peakOccupancy}%`} note="Configured capacity" />
      <Metric title="Average confidence" value={average(item => item.confidence) === null ? "—" : `${Math.round(average(item => item.confidence)! * 100)}%`} note="Mean model confidence" />
      <Metric title="Avg. processing" value={average(item => item.processingMs) === null ? "—" : `${Math.round(average(item => item.processingMs)!)} ms`} note="Inference latency" />
      <Metric title="Highest risk" value={highestRisk ?? "—"} note="Observed this session" />
      <Metric title="Analyses" value={String(history.length)} note="Most recent 12 retained" />
    </div>
    {history.length ? <div className="analytics-charts">
      <section className="panel analytics-chart"><div className="eyebrow">VISIBLE PEOPLE</div><h3>Crowd load</h3><ResponsiveContainer width="100%" height={158}><LineChart data={chartData} {...shared}><CartesianGrid stroke="#252525" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="time" tick={axis} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} width={30} /><Tooltip {...tooltip} /><Line type="monotone" dataKey="peopleCount" name="Visible people" stroke="#d8d8d8" strokeWidth={1.7} dot={{ r: 2, fill: "#d8d8d8" }} activeDot={{ r: 4 }} /></LineChart></ResponsiveContainer></section>
      <section className="panel analytics-chart"><div className="eyebrow">CAPACITY PROXY</div><h3>Occupancy trend</h3><ResponsiveContainer width="100%" height={158}><AreaChart data={chartData} {...shared}><CartesianGrid stroke="#252525" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="time" tick={axis} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} width={30} unit="%" /><Tooltip {...tooltip} /><Area type="monotone" dataKey="occupancyPercent" name="Occupancy %" stroke="#85ae91" fill="#85ae9118" strokeWidth={1.7} dot={{ r: 2 }} /></AreaChart></ResponsiveContainer></section>
      <section className="panel analytics-chart"><div className="eyebrow">PROTOTYPE RISK SCORE</div><h3>Risk trend</h3><ResponsiveContainer width="100%" height={158}><LineChart data={chartData} {...shared}><CartesianGrid stroke="#252525" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="time" tick={axis} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tick={axis} axisLine={false} tickLine={false} width={30} /><Tooltip {...tooltip} /><Line type="stepAfter" dataKey="riskScore" name="Risk score" stroke="#bdb08a" strokeWidth={1.7} dot={{ r: 2, fill: "#bdb08a" }} /></LineChart></ResponsiveContainer></section>
    </div> : <div className="empty-state analytics-empty">Analytics will appear after the first real image analysis. Demo scenario values are excluded.</div>}
  </section>;
}

function IncidentTimeline({ history }: { history: SessionAnalysis[] }) {
  const events = history.slice().reverse().flatMap(item => {
    const stamp = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(item.timestamp));
    const details = `${item.peopleCount} visible people · ${item.occupancyPercent}% occupancy · ${item.processingMs} ms`;
    return [
      ...(item.riskLevel === "HIGH" || item.riskLevel === "CRITICAL" ? [{ key: `${item.id}-risk`, stamp, event: "risk.threshold", state: item.riskLevel, details }] : []),
      ...(item.recommendationState ? [{ key: `${item.id}-gemma`, stamp, event: "gemma.recommend", state: item.recommendationState, details }] : []),
      ...(item.automationState && item.automationState !== "not_triggered" ? [{ key: `${item.id}-n8n`, stamp, event: "automation.webhook", state: item.automationState.toUpperCase(), details }] : []),
      { key: `${item.id}-analysis`, stamp, event: "analysis.complete", state: item.riskLevel, details },
    ];
  });
  return <section className="panel incident-panel" id="incidents"><div className="panel-heading compact"><div><div className="eyebrow">INCIDENT HISTORY <span className="heading-separator">/</span> REAL ANALYSES</div><h2>Activity</h2></div></div>
    {events.length ? <div className="timeline">{events.map(event => <div className="timeline-item" key={event.key}><time>{event.stamp}</time><code>{event.event}</code><b className="timeline-state">{event.state}</b><small>{event.details}</small></div>)}</div> : <div className="empty-state">No analysis events recorded in this session.</div>}
  </section>;
}

export default function Dashboard() {
  const [result, setResult] = useState<CrowdAnalysisResult | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisState>("idle");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [recommendationResult, setRecommendationResult] = useState<RecommendationResult | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [currentDispatchStatus, setCurrentDispatchStatus] = useState<"success" | "failed" | null>(null);
  const [demoVersion, setDemoVersion] = useState(0);
  const [history, setHistory] = useState<SessionAnalysis[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const requestVersion = useRef(0);
  const automationFetchVersion = useRef(0);
  const historyIds = useRef<Record<number, string>>({});

  useEffect(() => {
    const restore = () => {
      try {
        const stored = window.localStorage.getItem(SESSION_HISTORY_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as SessionAnalysis[];
          if (Array.isArray(parsed)) setHistory(parsed.filter(item => item && typeof item.timestamp === "string").slice(-12));
        }
      } catch {
        window.localStorage.removeItem(SESSION_HISTORY_KEY);
      } finally {
        setHistoryReady(true);
      }
    };
    const frame = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    try { window.localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history.slice(-12))); } catch { /* Keep session analytics in memory when storage is unavailable. */ }
  }, [history, historyReady]);

  const updateHistory = (id: string, values: Partial<SessionAnalysis>) => {
    setHistory(items => items.map(item => item.id === id ? { ...item, ...values } : item));
  };

  const refreshAutomationStatus = useCallback(async (requestId?: number) => {
    const fetchVersion = ++automationFetchVersion.current;
    const status = await getAutomationStatus().catch(() => unavailableAutomationStatus);
    if (fetchVersion === automationFetchVersion.current &&
        (requestId === undefined || requestId === requestVersion.current)) setAutomationStatus(status);
    return status;
  }, []);

  useEffect(() => { void refreshAutomationStatus(); }, [refreshAutomationStatus]);

  const beginAnalysis = () => {
    const requestId = ++requestVersion.current;
    automationFetchVersion.current += 1;
    setResult(null);
    setRecommendationResult(null);
    setRecommendationLoading(false);
    setAutomationLoading(false);
    setCurrentDispatchStatus(null);
    setAnalysisError(null);
    setAnalysisStatus("analyzing");
    return requestId;
  };

  const loadRecommendation = async (analysisResult: CrowdAnalysisResult, requestId: number) => {
    if (requestId !== requestVersion.current) return;
    setRecommendationLoading(true);
    try {
      const value = await recommendCrowd(analysisResult, "Gate A");
      if (requestId === requestVersion.current) {
        setRecommendationResult(value);
        const historyId = historyIds.current[requestId];
        if (historyId) updateHistory(historyId, { recommendationState: value.fallback ? "RULE-BASED FALLBACK" : "MODEL" });
        if (analysisResult.riskLevel === "CRITICAL") {
          setAutomationLoading(true);
          try {
            const automation = await dispatchCriticalAutomation(analysisResult, "Gate A", value.recommendation);
            await refreshAutomationStatus(requestId);
            if (requestId === requestVersion.current) {
              setCurrentDispatchStatus(automation.status === "dispatched" ? "success" : "failed");
              if (historyId) updateHistory(historyId, { automationState: automation.status });
            }
          } catch {
            if (requestId === requestVersion.current) {
              await refreshAutomationStatus(requestId);
              if (requestId === requestVersion.current) {
                setCurrentDispatchStatus("failed");
                if (historyId) updateHistory(historyId, { automationState: "offline" });
              }
            }
          } finally {
            if (requestId === requestVersion.current) setAutomationLoading(false);
          }
        }
      }
    } catch {
      if (requestId !== requestVersion.current) return;
      const recommendation = analysisResult.riskLevel === "CRITICAL"
        ? "Pause new entry into Gate A and reassess when its reported occupancy is below 70%."
        : analysisResult.riskLevel === "HIGH"
          ? "Meter new entry into Gate A while occupancy remains elevated. Reassess when reported occupancy falls below 70%."
          : analysisResult.riskLevel === "MODERATE"
            ? "Manage arrivals to Gate A at a controlled pace and monitor the reported risk score."
            : "Continue monitoring Gate A and maintain normal flow while the supplied metrics remain low.";
      setRecommendationResult({ recommendation, model: "rule-based-fallback", localInference: true, fallback: true });
      const historyId = historyIds.current[requestId];
      if (historyId) updateHistory(historyId, { recommendationState: "RULE-BASED FALLBACK" });
      if (analysisResult.riskLevel === "CRITICAL") {
        setAutomationLoading(true);
        try {
          const automation = await dispatchCriticalAutomation(analysisResult, "Gate A", recommendation);
          await refreshAutomationStatus(requestId);
          if (requestId === requestVersion.current) {
            setCurrentDispatchStatus(automation.status === "dispatched" ? "success" : "failed");
            if (historyId) updateHistory(historyId, { automationState: automation.status });
          }
        } catch {
          if (requestId === requestVersion.current) {
            await refreshAutomationStatus(requestId);
            if (requestId === requestVersion.current) {
              setCurrentDispatchStatus("failed");
              if (historyId) updateHistory(historyId, { automationState: "offline" });
            }
          }
        } finally {
          if (requestId === requestVersion.current) setAutomationLoading(false);
        }
      }
    } finally {
      if (requestId === requestVersion.current) setRecommendationLoading(false);
    }
  };

  const handleAnalysisResult = (analysisResult: CrowdAnalysisResult, requestId: number) => {
    if (requestId !== requestVersion.current) return;
    setResult(analysisResult);
    setAnalysisStatus("complete");
    void refreshAutomationStatus(requestId);
    const id = `analysis-${Date.now()}-${requestId}`;
    historyIds.current[requestId] = id;
    setHistory(items => [...items, {
      id,
      timestamp: new Date().toISOString(),
      peopleCount: analysisResult.peopleCount,
      occupancyPercent: analysisResult.occupancyPercent,
      riskScore: analysisResult.riskScore,
      confidence: analysisResult.confidence,
      processingMs: analysisResult.processingMs,
      riskLevel: analysisResult.riskLevel,
    }].slice(-12));
    void loadRecommendation(analysisResult, requestId);
  };

  const handleAnalysisError = (message: string, requestId: number) => {
    if (requestId !== requestVersion.current) return;
    setResult(null);
    setRecommendationResult(null);
    setRecommendationLoading(false);
    setCurrentDispatchStatus(null);
    setAnalysisError(message);
    setAnalysisStatus("error");
  };

  const handleLoadDemo = () => {
    requestVersion.current += 1;
    setDemoVersion(value => value + 1);
    setResult(demoCrowdAnalysis);
    setAnalysisError(null);
    setAnalysisStatus("demo");
    setRecommendationResult(null);
    setRecommendationResult({
      recommendation: "Pause new entry into Gate A and reassess when its reported occupancy is below 70%.",
      model: "demo-scenario",
      localInference: true,
      fallback: false,
    });
    setRecommendationLoading(false);
  };

  const peopleCount = result?.peopleCount ?? (analysisStatus === "demo" ? demoCrowdAnalysis.peopleCount : "—");
  const riskLevel = result?.riskLevel ?? "—";
  const riskTone = riskLevel === "CRITICAL" ? "coral" : riskLevel === "HIGH" || riskLevel === "MODERATE" ? "amber" : "";
  const workspaceStatus = analysisStatus === "demo" ? "LOCAL DEMO · SIMULATED" : analysisStatus === "analyzing" ? "ANALYZING IMAGE" : analysisStatus === "complete" ? "IMAGE ANALYZED" : analysisStatus === "error" ? "ANALYSIS ERROR" : "SYSTEM READY";

  return <div className="app-shell" id="command-center"><Sidebar workspaceStatus={workspaceStatus} /><main className="main-area"><Topbar onLoadDemo={handleLoadDemo} workspaceStatus={workspaceStatus} /><div className="dashboard-content">
    <section className="page-intro" id="monitor"><div className="hero-copy"><div className="date-kicker">KOLKATA <span>/</span> COMMAND CENTER <span>/</span> {analysisStatus === "demo" ? "LOCAL DEMO · SIMULATED" : result ? "IMAGE ANALYSIS" : "SYSTEM READY"}</div><h1>Crowd intelligence,<br />in real time.</h1><p>{analysisStatus === "demo" ? "Bundled scenario for the demo; no camera or external service is used." : "Anonymous person detection with local, capacity-based prototype risk indicators."}</p></div><div className="hero-side-note"><span>MONITORING ZONE</span><strong>Kalighat Puja</strong><small>Kolkata, West Bengal · India</small></div></section>
    <section className="metrics-grid" aria-label="Operational summary"><Metric title="Visible people detected" value={String(peopleCount)} note={analysisStatus === "demo" ? "SIMULATED DEMO VALUES" : result ? "ZONE A · CURRENT IMAGE" : "Waiting for image analysis"} /><Metric title="Active zones" value="1" note="Zone A · configured capacity" /><Metric title="Risk level" value={result ? result.riskLevel : "—"} tone={riskTone} note={analysisStatus === "demo" ? "SIMULATED DEMO VALUES" : result ? `Score ${result.riskScore} / 100` : "Awaiting image analysis"} /><Metric title="Active incidents" value={result && (result.riskLevel === "HIGH" || result.riskLevel === "CRITICAL") ? "1" : "0"} tone={result?.riskLevel === "CRITICAL" ? "coral" : ""} note={analysisStatus === "demo" ? "SIMULATED DEMO EVENT" : result?.riskLevel === "HIGH" || result?.riskLevel === "CRITICAL" ? "Current risk threshold" : "No current risk event"} /></section>
    <section className="primary-grid"><VideoFeed result={result} status={analysisStatus} error={analysisError} demoVersion={demoVersion} onAnalysisStart={beginAnalysis} onAnalysisResult={handleAnalysisResult} onAnalysisError={handleAnalysisError} /><RiskAssessment result={result} demo={analysisStatus === "demo"} currentDispatchStatus={currentDispatchStatus} automationLoading={automationLoading || recommendationLoading} /></section>
    <section className="guidance-grid" id="automation"><Recommendation value={recommendationResult} loading={recommendationLoading} /><AutomationCard status={automationStatus} loading={automationLoading} /></section>
    <div className="lower-grid"><ZoneTable result={result} demo={analysisStatus === "demo"} /><IncidentTimeline history={history} /></div>
    <SessionAnalytics history={history} onClear={() => setHistory([])} />
    <footer className="dashboard-footer" id="system"><span>SHAKTIFLOW <span>·</span> CROWD INTELLIGENCE</span><span><LockKeyhole size={11} /> NO FACE RECOGNITION · NO IDENTITY STORAGE</span><span>{analysisStatus === "complete" ? `YOLO · ${result?.processingMs} MS` : analysisStatus === "demo" ? "SIMULATED DEMO VALUES" : "SYSTEM READY"}</span></footer>
  </div></main></div>;
}

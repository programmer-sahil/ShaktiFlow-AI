# ShaktiFlow → n8n crowd risk workflow

This optional workflow receives critical events from the local FastAPI backend. It does not receive images. Create a workflow manually in about five minutes:

1. Add a **Webhook** trigger. Set method to `POST`, path to `shaktiflow-crowd-risk`, and response mode to **Using Respond to Webhook node**.
2. Add an **IF** node. Compare `{{$json.body.severity}}` with `CRITICAL` using **is equal to**.
3. On the true branch, add **Edit Fields (Set)** and map `event`, `severity`, `zone`, `peopleCount`, `occupancyPercent`, `riskScore`, `recommendation`, and `timestamp` from `{{$json.body.<field>}}`. This step is useful for shaping the incident record sent downstream.
4. Optionally connect a Discord, Telegram, or Email node after Edit Fields. Keep credentials in n8n's credential store; never put them in ShaktiFlow or the exported workflow.
5. Add **Respond to Webhook** after the true branch, returning the accepted incident data. Add a second Respond to Webhook on the false branch with an ignored response. Activate the workflow and copy its **Production URL** into `N8N_WEBHOOK_URL` in `backend/.env`.

The starter workflow [`shaktiflow-critical-crowd.json`](./shaktiflow-critical-crowd.json) can be imported from **Workflows → Import from File**. After import, optionally add a notification node, then activate it and use its production webhook URL. The JSON contains no webhook URL, credentials, or secrets.

## Sample request

```json
{
  "event": "crowd_risk_detected",
  "severity": "CRITICAL",
  "zone": "Gate A",
  "peopleCount": 43,
  "occupancyPercent": 91,
  "riskScore": 94,
  "recommendation": "Pause new entry into Gate A and reassess when its reported occupancy is below 70%.",
  "timestamp": "2026-10-01T12:42:08+05:30"
}
```

ShaktiFlow only sends this payload after a real uploaded image is classified CRITICAL and its recommendation is available. The local demo does not send webhooks. The HTTP call has a short timeout; failure is surfaced in the Automation card and does not fail analysis.

## Expected webhook response

Respond to Webhook with HTTP 200 and JSON such as:

```json
{
  "received": true,
  "event": "crowd_risk_detected",
  "severity": "CRITICAL"
}
```

ShaktiFlow treats any 2xx response as dispatched. The response body is not used to claim that an optional downstream notification was delivered.

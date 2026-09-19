# Vapi Setup — Energy Journey Recovery Agent

End-to-end wiring for the CIMET / Econnex Energy dropout-recovery voice agent.
Work through it in order; section 4 is the step people miss.

---

## 1. Create the assistant

Vapi Dashboard → **Assistants** → New.

| Setting | Value | Why |
| :-- | :-- | :-- |
| Transcriber | Deepgram Nova-2, `en-AU` | AU accents, addresses and retailer names |
| Model | Claude Sonnet 4.5 (or GPT-4o) | Needs reliable multi-tool calling |
| Voice | Any natural AU-English voice | Matches the reference recording's register |
| First message | See [vapi-prompt-options.md](vapi-prompt-options.md) | Consent disclosed up front |
| System prompt | See [vapi-prompt-options.md](vapi-prompt-options.md) | Energy field list + guardrails |
| Max duration | 600s | Recovery calls run 3–6 min |
| End call phrases | leave empty | Disposition is driven by tools, not phrases |

**Silence timeout:** 20s. Shorter and the agent talks over customers who are
fetching a bill.

---

## 2. Dynamic variables

The frontend injects these per call via `assistantOverrides.variableValues`:

```javascript
{
  vertical:    "Energy (Electricity & Gas)",
  customerName: lead.name,
  leadId:       lead.id,
  leadPhone:    lead.phone,
  leadAddress:  lead.address
}
```

Reference them in the prompt as `{{customerName}}`, `{{leadId}}`, `{{leadAddress}}`.
Seeding `{{leadAddress}}` matters: the agent asks the customer to *confirm* an
address rather than recite it, which is both faster and far less error-prone.

---

## 3. Tool schemas

Create four tools under **Tools**. Every one points at the same Apps Script
`/exec` URL — the backend dispatches on function name.

> **This is the section that was wrong in the first build.** The schema declared
> Broadband property names (`serviceAddress`, `currentIsp`, `speedTier`) and marked
> them required, while the Energy prompt sent `supplyAddress`, `currentRetailer`,
> `fuelType`. Those properties were not in the schema, so every Energy submission
> would have failed validation or written blanks. Use the schemas below.

### Tool 1 — `submitJourney`

**Description:** `Submit the completed Energy journey once all eight fields are captured and verified.`

```json
{
  "type": "object",
  "properties": {
    "leadId":            { "type": "string", "description": "Lead ID from {{leadId}}" },
    "customerName":      { "type": "string", "description": "Full name as per the energy bill" },
    "supplyAddress":     { "type": "string", "description": "Address where electricity/gas is connected" },
    "currentRetailer":   { "type": "string", "description": "Current energy retailer, e.g. AGL, Origin, EnergyAustralia" },
    "fuelType":          { "type": "string", "enum": ["Electricity", "Gas", "Dual Fuel"] },
    "solarPanels":       { "type": "string", "description": "Rooftop solar status, e.g. 'No solar' or 'Yes, 5kW'" },
    "email":             { "type": "string" },
    "phone":             { "type": "string" },
    "concessionOrDob":   { "type": "string", "description": "Concession card held, or year of birth if none" },
    "fieldsAutoCaptured":{ "type": "number", "description": "How many fields the voice agent captured unaided" }
  },
  "required": [
    "leadId", "customerName", "supplyAddress", "currentRetailer",
    "fuelType", "solarPanels", "email", "phone", "concessionOrDob"
  ]
}
```

The backend re-validates and returns `{"status":"incomplete","missingFields":[...]}`
rather than writing a partial row. Tell the model in the prompt to act on that
response — it turns a silent data-quality failure into a self-correcting loop.

### Tool 2 — `endHandoff`

**Description:** `Escalate to a human specialist and pass all captured context. Call this the moment an escalation signal appears.`

```json
{
  "type": "object",
  "properties": {
    "leadId": { "type": "string" },
    "customerName": { "type": "string" },
    "reason": {
      "description": "Specific reason, quoting what the customer said",
      "type": "string"
    },
    "trigger": {
      "type": "string",
      "enum": ["ANGER", "CONFUSION", "OFFSCRIPT", "SENSITIVE", "ASKS", "LOWCONF"]
    },
    "fieldsCollected": {
      "type": "object",
      "description": "Every field captured so far. Include ONLY fields the customer actually confirmed — omit the rest. This is what the human agent sees, so the customer never repeats themselves.",
      "properties": {
        "supplyAddress":   { "type": "string" },
        "currentRetailer": { "type": "string" },
        "fuelType":        { "type": "string" },
        "solarPanels":     { "type": "string" },
        "customerName":    { "type": "string" },
        "email":           { "type": "string" },
        "phone":           { "type": "string" },
        "concessionOrDob": { "type": "string" }
      }
    }
  },
  "required": ["leadId", "customerName", "reason", "trigger"]
}
```

The `trigger` enum is what makes the handoff auditable — CIMET can then count
which signal class drives escalations and tune from there. Declaring the named
properties inside `fieldsCollected` ensures the model actually fills them, so
Aarav's console receives the pre-captured context rather than an empty object.

### Tool 3 — `logDecline`

**Description:** `Log that the customer declined. Call this after thanking them and before ending. Never call it while still persuading.`

```json
{
  "type": "object",
  "properties": {
    "leadId":       { "type": "string" },
    "customerName": { "type": "string" },
    "reason":       { "type": "string", "description": "How the decline was expressed" }
  },
  "required": ["leadId"]
}
```

### Tool 4 — `checkDnc`

**Description:** `Check a number against the ACMA Do Not Call Register and permitted calling hours.`

```json
{
  "type": "object",
  "properties": {
    "leadId": { "type": "string" },
    "phone":  { "type": "string" }
  },
  "required": ["phone"]
}
```

In the demo the gate runs **client-side before dialling** (see `checkDncLocal()` in
[energy-recovery-demo.html](energy-recovery-demo.html)) — a compliance gate that runs
after the phone rings is not a gate. This tool exists so a server-side dialler
(ViciDial cron) can hit the same logic, and so the check is logged centrally.

---

## 4. Attach the tools to the assistant

Creating a tool does **not** connect it. This is the single most common reason a
tool "never fires".

1. Assistants → your assistant → **Tools** tab (inside the assistant, not the
   sidebar Tools page).
2. Add all four: `submitJourney`, `endHandoff`, `logDecline`, `checkDnc`.
3. Save, then hard-refresh the dashboard and confirm they persisted.

---

## 5. Deploy the Apps Script backend

1. Open the target Google Sheet → **Extensions → Apps Script**.
2. Paste [energy-agent-backend.gs](energy-agent-backend.gs). Save.
3. **Leave `SPREADSHEET_ID` as the placeholder.** Opening the script from inside the
   Sheet binds it to that Sheet, and the script resolves it automatically. Only set
   an ID for a standalone script project — and note that `openById()` fails with
   "Access is denied" when the Sheet belongs to a different Google account than the
   one running the script, which is the usual cause of that error.
4. Run `setupSheetHeaders()`. Authorise when prompted.
   - On a **fresh** Sheet: creates all five tabs and seeds three synthetic leads.
   - On an **existing** Sheet with older tabs: reports `MISMATCH` and writes nothing.
     Run `migrateLegacySheets()` to archive them as `<name>_legacy_<stamp>` (data
     preserved), then run `setupSheetHeaders()` again.
5. Deploy → New deployment → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (not "Anyone with Google account")
6. Copy the `/exec` URL into the **Server URL** of all four tools.
7. Sanity check: open the `/exec` URL in a browser. You should see
   `{"configured":true,"spreadsheet":"<name>","resolvedVia":"bound spreadsheet",...}`.
   A Google sign-in page instead means the access setting is wrong.

After editing the script, publish with *Deploy → Manage deployments → pencil → New
version*. **New deployment** mints a different `/exec` URL and leaves your tools
pointing at stale code — a silent failure that looks like a working endpoint.

---

## 6. Verify before the demo

Run these in the Apps Script editor:

| Function | Expected |
| :-- | :-- |
| `testSubmitEnergyJourney()` | `{"status":"submitted"}`, one row in `CompletedJourneys` |
| `testSubmitIncompleteJourney()` | `{"status":"incomplete","missingFields":[...]}`, **no row written** |
| `testEndHandoff()` | `{"status":"handoff_logged","contextPassed":"2 fields"}` |
| `testCheckDnc()` | first CLEARED, second BLOCKED |
| `testLogDecline()` | one row in `Declines` |

The second test is the one to show a judge — it proves the system refuses to
record a journey it did not actually complete.

---

## 7. Connecting the journey-completion sandbox

CIMET supplies a sandbox with an expected payload shape on the day. Set
`JOURNEY_SANDBOX_URL` in the backend and every completed journey is mirrored to it
in the canonical shape built by `buildJourneyPayload()`.

If their schema differs, **map it in `buildJourneyPayload()` and nowhere else** —
that function is the single adapter seam, deliberately. The Sheet write, the field
validation and the voice prompt all stay untouched.

---

## 8. Troubleshooting

| Symptom | Cause |
| :-- | :-- |
| `SPREADSHEET_ID is not configured` | Step 5.4 skipped — this is the intended loud failure |
| `SyntaxError: "[object Object]" is not valid JSON` | Response not in Vapi's `{"results":[{"toolCallId":..,"result":..}]}` envelope |
| `401` / `302` on tool call | Deployment access is not "Anyone", or execute-as is not "Me" |
| `404` on tool call | Server URL points at an older deployment — re-copy the `/exec` URL |
| Tool never fires | Created but not attached to the assistant (section 4) |
| `Missing tab "CompletedJourneys"` | `setupSheetHeaders()` never run |
| Energy fields arrive empty | Broadband-era tool schema still in place — replace with section 3 |
| Agent drifts off the Energy script | Assistant is carrying more than one field list — give each vertical its own assistant |

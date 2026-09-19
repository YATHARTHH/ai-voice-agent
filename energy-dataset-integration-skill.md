---
name: energy-dataset-integration
description: Use when CIMET supplies the synthetic Energy leads dataset or the journey-completion sandbox spec for the Journey Recovery voice agent, or when the user says "here's the dataset", "got the leads file", "integrate this data", or shares a CSV/spreadsheet of dropped-off leads. Wires a newly-received dataset into the existing Vapi + Apps Script Energy recovery agent (lead pipeline, Leads sheet, tool schemas, payload adapter). Trigger proactively whenever a tabular file of leads appears for this project.
---

# Energy Journey Recovery — Dataset Integration

This project has a working Energy recovery agent already built:

| File | Role |
| :-- | :-- |
| [energy-agent-backend.gs](energy-agent-backend.gs) | Apps Script webhook, validation, canonical payload, DNC gate |
| [energy-recovery-demo.html](energy-recovery-demo.html) | Mission Control UI, live extraction, escalation, efficiency ledger |
| [vapi-prompt-options.md](vapi-prompt-options.md) | Per-field Energy scripts and guardrails |
| [vapi-agent-setup-guide.md](vapi-agent-setup-guide.md) | Tool schemas and deployment |

The job is to slot real data into that pipeline — not to rebuild it.

---

## What the system currently assumes

**Leads sheet columns**

```
LeadID | CustomerName | Phone | Email | SupplyAddress | LastCompletedStep | DncStatus | DncCheckedAt
```

**The eight Energy fields the agent collects**

| # | Field | Notes |
| :-: | :-- | :-- |
| 1 | `supplyAddress` | Seeded from the lead; the agent asks to *confirm*, not recite |
| 2 | `currentRetailer` | AGL, Origin, EnergyAustralia, Red Energy, Alinta… |
| 3 | `fuelType` | Electricity / Gas / Dual Fuel |
| 4 | `solarPanels` | Drives feed-in tariff eligibility |
| 5 | `customerName` | As per the energy bill |
| 6 | `email` | Plan disclosure + fact sheet |
| 7 | `phone` | Transfer status SMS |
| 8 | `concessionOrDob` | Concession card, else year of birth |

**Frontend lead shape** (`VERTICAL_DATA.energy.leads`)

```javascript
{ id, name, phone, detail, step, active }
```

---

## Step 1 — Read the dataset before touching anything

Inspect the file fully. Establish:

- Actual column names and row count
- How `last completed step` is expressed — step number, field name, or page name
- Whether test phone numbers fall in a reserved fictional range
- **Whether a journey-completion payload spec ships with it.** The brief promises
  "a journey-completion sandbox or mock, with the expected payload shape." If that
  spec is present it is **authoritative** and overrides the canonical shape below.

## Step 2 — Map columns to the Leads sheet

Rename and reorder to the eight columns above. If the dataset lacks `DncStatus`,
add the column and populate it by running `checkDnc()` per row — do not leave it
blank, because the UI gate reads it.

If a column has no home (campaign ID, affiliate source, bill upload URL), **add it
to the Leads sheet rather than discarding it**. Affiliate source in particular
changes the opening line and is worth surfacing on the lead card.

## Step 3 — Point the frontend at the real leads

Replace the hardcoded `VERTICAL_DATA.energy.leads` array with the real rows.
Keep exactly three on screen — the pipeline panel is sized for three, and more
makes the demo harder to narrate, not more impressive.

Choose the three deliberately:

1. One clean lead that completes end-to-end (the 30% criterion)
2. One that escalates (the 20% criterion)
3. **One with a DNC-registered number**, so the gate visibly blocks a real row

Add any DNC-listed numbers from the dataset to `DNC_REGISTERED_NUMBERS` in both
[energy-recovery-demo.html](energy-recovery-demo.html) and
[energy-agent-backend.gs](energy-agent-backend.gs) — the two lists must agree or
the UI and the server will disagree about who may be called.

## Step 4 — Reconcile the field list

If the dataset implies fields the agent does not collect (e.g. `meterNumber`,
`nmi`, `concessionCardNumber`), then for each one:

1. Add it to `VERTICAL_DATA.energy.fields` with a label, icon and keywords
2. Add an `ASK_PATTERNS` entry so the question-intent matcher routes the answer
3. Add it to the `submitJourney` tool schema **and** its `required` array
4. Add it to `REQUIRED_ENERGY_FIELDS` and `buildJourneyPayload()` in the backend
5. Write its script line in [vapi-prompt-options.md](vapi-prompt-options.md)

All five, or the field breaks somewhere. Step 2 is the one most often missed: skip
it and the answer is captured by keyword fallback or not at all.

> **Never collect an NMI or meter number by reading digits aloud if the customer
> has to find it on a bill mid-call.** It is a reliable source of mishears, and two
> failed attempts on the same field is itself an escalation trigger (CONFUSION).
> Prefer confirming it from the abandoned-cart data.

## Step 5 — Adapt the payload, in one place only

If CIMET supplied a payload spec, map to it inside `buildJourneyPayload()` in
[energy-agent-backend.gs](energy-agent-backend.gs) and **nowhere else**. That
function is the deliberate adapter seam. The Sheet write, the field validation,
the UI and the voice prompt all stay untouched.

Then set `JOURNEY_SANDBOX_URL` so completed journeys post to the real sandbox in
addition to the Sheet.

The current canonical shape:

```json
{
  "leadId": "LEAD-EN-101",
  "vertical": "energy",
  "source": "ai_voice_recovery",
  "submittedAt": "2026-09-19T08:29:20.410Z",
  "customer":    { "fullName": "", "email": "", "phone": "", "concessionOrDob": "" },
  "supplyPoint": { "address": "", "fuelType": "", "hasSolar": false },
  "currentPlan": { "retailer": "" },
  "compliance":  { "recordingConsentDisclosed": true, "cardDataCapturedByVoice": false, "dncChecked": true },
  "provenance":  { "fieldsAutoCaptured": 8, "fieldsTotal": 8, "manualKeystrokes": 0 }
}
```

## Step 6 — Verify before demoing

```
testSubmitEnergyJourney()      -> {"status":"submitted"}     + row written
testSubmitIncompleteJourney()  -> {"status":"incomplete"}    + NO row written
testCheckDnc()                 -> CLEARED then BLOCKED
```

Then load the page and confirm: the DNC-listed lead shows a red badge, selecting
it disables the call button, and the other two show green.

---

## Guardrails that apply to the data itself

- **Test data only.** Reject any file that appears to contain real customer PII or
  live phone numbers, and say so rather than loading it. If real numbers are present,
  substitute the reserved fictional range (`+61 491 570 xxx` in Australia) before use.
- **Do not widen the field list to whatever the dataset happens to contain.** Collect
  what the journey needs. Every extra field is another turn on the call, another
  chance to mishear, and another escalation risk.
- **If the dataset contains payment or bank fields, they stay out of the voice path
  entirely** — no prompt line, no tool parameter, no HUD card. The boundary is the
  point.

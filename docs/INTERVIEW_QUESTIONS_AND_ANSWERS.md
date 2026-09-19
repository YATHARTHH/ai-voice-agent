# Interview & Hackathon Defense Guide (Q&A)

Key architectural trade-offs, technical decisions, and interview Q&A for defending the **Econnex Autonomous Energy Voice Recovery Platform**.

---

## ❓ Frequently Asked Questions & Defenses

### Q1: Why use WebRTC instead of standard SIP / PSTN telephony?
**Answer**:
WebRTC allows low-latency (<800ms) full-duplex audio streams directly between the browser client and Vapi's ingestion server without needing expensive PSTN trunks or SIP gateways for demo purposes. It also enables instant real-time visualization of field extraction on the Mission Control HUD as the customer speaks.

---

### Q2: How do you prevent the AI voice agent from hallucinating customer data?
**Answer**:
We enforce a **dual-layer verification system**:
1. **Tool Schema Validation**: The `submitJourney` tool requires all 8 Energy fields (`supplyAddress`, `currentRetailer`, `fuelType`, `solarPanels`, `customerName`, `email`, `phone`, `concessionOrDob`) as non-empty strings.
2. **Backend Contract Enforcement**: If the LLM passes an empty string or partial payload, the Apps Script backend returns `status: incomplete` and explicitly lists missing fields. This forces the model into a self-correcting loop to ask the customer for the missing information.

---

### Q3: How does the system handle warm handoffs without making the customer repeat themselves?
**Answer**:
When an escalation signal occurs (`ANGER`, `ASKS`, `SENSITIVE`, `CONFUSION`, `OFFSCRIPT`), the agent triggers `endHandoff`. The `endHandoff` tool schema includes an explicit `fieldsCollected` object.
The model serializes every field captured up to that second into `fieldsCollected`. When Mode A (human agent Aarav's console) opens, it pre-populates these fields directly into Aarav's screen—ensuring zero repeated questions.

---

### Q4: How do you handle ACMA Do Not Call (DNC) compliance?
**Answer**:
We run a **pre-dial compliance gate**:
Before any WebRTC call is initiated, `refreshGateStrip()` checks the lead's phone number against `DNC_REGISTERED_NUMBERS` and evaluates the Sydney/AEST calling window (9am–8pm weekdays, 9am–5pm Saturdays). If registered, dialling is blocked **before** the phone rings, and an audit entry is written to `DncLog`.

---

### Q5: What happens if the customer refuses the transfer or says "Not Interested"?
**Answer**:
The platform enforces a strict **Zero-Pressure Exit Protocol**:
A single statement of disinterest triggers `logDecline`. The agent thanks the customer politely, hangs up, and logs the exit in `Declines`. The lead is suppressed from all future campaign retries to comply with Australian telemarketing standards.

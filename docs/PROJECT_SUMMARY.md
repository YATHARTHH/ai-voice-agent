# Project Summary: Econnex Autonomous Voice Recovery Platform

An AI-powered autonomous voice agent and warm escalation platform built for CIMET/Econnex abandoned comparison journey recovery.

---

## 🎯 Why This Project Was Built

In comparison marketplaces (energy, broadband, insurance), a significant percentage of potential customers drop off mid-funnel after filling out initial lead details (Name, Address, Phone) but before finalizing transfer submission.

Traditionally, recovering these dropped-off leads relied on human call center agents:
1. **High Operational Cost**: Manually dialing abandoned leads costs ~$7 per lead in human labor.
2. **Repetitive Friction**: Human agents read rigid field-by-field scripts and type answers into an iframe on the customer's behalf.
3. **Frustration on Escalation**: When calls escalate to senior specialists, customers are forced to repeat their address, retailer, and details from scratch.
4. **Regulatory Risk**: Call centers risk severe ACMA fines if they dial numbers registered on Australia's Do Not Call (DNC) Register or violate calling window hours.

### The Solution: Autonomous Voice Agent + Mode A Warm Handoff
This platform automates dropped-journey recovery while protecting customer experience:
- **Mode B (Autonomous Voice Agent Alex)**: Connects via low-latency WebRTC (Vapi), handles objections naturally, extracts 8 required Energy transfer fields, and executes live backend submissions via `submitJourney`.
- **Mode A (Modernized Agent Console Aarav)**: When sentiment drops or complex requests arise, the system triggers `endHandoff`, passing 100% of pre-captured context directly to the human specialist's console—ensuring zero repeated questions.
- **ACMA Compliance & DNC Gate**: Pre-dial verification blocks calls to DNC-registered numbers automatically before WebRTC connection.
- **Zero-Pressure Exit Protocol**: On customer decline, the agent immediately signs off politely (`logDecline`), suppressing future retries.

---

## 🏗️ High-Level System Architecture

```
                                  +------------------------------------+
                                  |   Mission Control Dashboard (HTML) |
                                  |   - WebRTC Voice Client            |
                                  |   - Real-Time Field Extraction HUD |
                                  |   - Live Sentiment Tracker         |
                                  +-----------------+------------------+
                                                    |
                                       WebRTC Stream / Vapi SDK
                                                    |
                                                    v
                                  +------------------------------------+
                                  |        Vapi Voice Pipeline         |
                                  |   - Deepgram STT (Australian Accent)|
                                  |   - GPT-4o Real-Time LLM           |
                                  |   - Cartesia TTS (Natural Voice)   |
                                  +-----------------+------------------+
                                                    |
                                         HTTPS Webhook (JSON)
                                                    |
                                                    v
                                  +------------------------------------+
                                  |   Google Apps Script Webhook Engine|
                                  |   - Field Validation Engine        |
                                  |   - ACMA DNC Gate Check            |
                                  |   - Sandbox Payload Adapter        |
                                  +-----------------+------------------+
                                                    |
                                          Appends Rows to Tabs
                                                    |
                                                    v
                                  +------------------------------------+
                                  |   Google Sheets Database (Sink)    |
                                  |   - CompletedJourneys              |
                                  |   - Handoffs                       |
                                  |   - Declines                       |
                                  |   - DncLog                         |
                                  +------------------------------------+
```

---

## 🛠️ The Tech Stack & Rationale

| Technology | Purpose | Rationale |
| :--- | :--- | :--- |
| **Vapi WebRTC SDK** | Low-Latency Telephony & Voice Stream | Provides ultra-low latency (<800ms) full-duplex voice communication with native function/tool calling support. |
| **Deepgram STT** | Speech-to-Text | Fine-tuned for Australian accents (`en-AU`) and local address formatting. |
| **GPT-4o** | Conversational Reasoning Engine | Handles complex objection handling, unstructured answers, and tool calling precision. |
| **Cartesia TTS** | Text-to-Speech Synthesis | Delivers warm, human-like voice tone with emotion awareness. |
| **Google Apps Script** | Serverless Webhook Engine | Zero-infrastructure backend deployed directly alongside Google Sheets CRM. |
| **Google Sheets API** | Structured Persistence Layer | Audit-ready tabbed database for completed journeys, handoffs, declines, and DNC logs. |
| **HTML5 / CSS3 Glassmorphism** | Mission Control Dashboard | High-impact UI featuring real-time HUD field extraction, sentiment meters, and mode switching. |

---

## 🌟 Key Technical Highlights

1. **Deterministic 8-Field Energy Schema**:
   - `supplyAddress`, `currentRetailer`, `fuelType`, `solarPanels`, `customerName`, `email`, `phone`, `concessionOrDob`.
2. **Backend Validation Seam**:
   - Webhook refuses partial submissions with `status: incomplete`, returning missing fields to force model self-correction.
3. **Causal Sentiment Escalation**:
   - Uses weighted signal classification (`ANGER`, `ASKS`, `SENSITIVE`, `CONFUSION`, `OFFSCRIPT`) to drive proactive handoffs.
4. **Instant 3-Scenario Simulation Engine**:
   - Enables instant, zero-failure presentations and judge testing without needing microphone input.

# Technical Deep Dive & System Architecture

A detailed architectural breakdown of the **Econnex Autonomous Energy Voice Recovery Platform**.

---

## 1. WebRTC & Voice Processing Pipeline

The system uses a full-duplex, low-latency audio processing pipeline connected directly to Vapi's WebRTC network.

```
[ User Microphone ] ──(WebRTC Audio Stream)──> [ Vapi Audio Ingestion ]
                                                         │
                                             Deepgram STT (en-AU)
                                                         │
                                                         v
                                              [ Text Transcript ]
                                                         │
                                               GPT-4o LLM Core
                                                         │
                                      ┌──────────────────┴──────────────────┐
                                      │                                     │
                             [ Conversational Speech ]               [ Tool Call (JSON) ]
                                      │                                     │
                               Cartesia TTS (Voice)               HTTPS POST Webhook
                                      │                                     │
 [ User Speaker ] <──(WebRTC Stream)──┘                           Apps Script Engine
```

---

## 2. Vapi Tool Contract Specifications

The voice agent interacts with the backend using **4 declared Vapi Tool Contracts**:

### 1. `submitJourney`
* **Trigger**: Called when all 8 Energy transfer fields have been verified with the customer.
* **Payload Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "leadId": { "type": "string" },
      "customerName": { "type": "string" },
      "supplyAddress": { "type": "string" },
      "currentRetailer": { "type": "string" },
      "fuelType": { "type": "string" },
      "solarPanels": { "type": "string" },
      "email": { "type": "string" },
      "phone": { "type": "string" },
      "concessionOrDob": { "type": "string" }
    },
    "required": ["leadId", "customerName", "supplyAddress", "currentRetailer", "fuelType", "solarPanels", "email", "phone", "concessionOrDob"]
  }
  ```

### 2. `endHandoff`
* **Trigger**: Called immediately when customer expresses frustration, asks for a supervisor, or requests sensitive topics.
* **Payload Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "leadId": { "type": "string" },
      "customerName": { "type": "string" },
      "reason": { "type": "string" },
      "trigger": { "type": "string", "enum": ["ANGER", "CONFUSION", "OFFSCRIPT", "SENSITIVE", "ASKS", "LOWCONF"] },
      "fieldsCollected": {
        "type": "object",
        "properties": {
          "supplyAddress": { "type": "string" },
          "currentRetailer": { "type": "string" },
          "fuelType": { "type": "string" },
          "solarPanels": { "type": "string" },
          "customerName": { "type": "string" },
          "email": { "type": "string" },
          "phone": { "type": "string" },
          "concessionOrDob": { "type": "string" }
        }
      }
    },
    "required": ["leadId", "customerName", "reason", "trigger"]
  }
  ```

---

## 3. Backend State Machine & Envelope Normalization

Vapi sends webhook requests wrapped inside a standard `toolCalls` envelope. The Google Apps Script backend (`energy-agent-backend.gs`) normalizes the payload:

```javascript
// Webhook Normalizer (energy-agent-backend.gs)
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var calls = data.message ? (data.message.toolCalls || [data.message.toolCall]) : [data];
  
  var results = calls.map(function(tc) {
    var fnName = tc.function ? tc.function.name : tc.name;
    var args = typeof tc.function.arguments === 'string' 
      ? JSON.parse(tc.function.arguments) 
      : tc.function.arguments;
      
    return executeTool(fnName, args, tc.id);
  });
  
  return ContentService.createTextOutput(JSON.stringify({ results: results }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 4. Field Verification & Self-Correcting Loop

When `submitJourney` is invoked, the backend executes strict non-empty checks:

```javascript
function handleSubmitJourney(args) {
  var REQUIRED_FIELDS = ['supplyAddress', 'currentRetailer', 'fuelType', 'solarPanels', 'customerName', 'email', 'phone', 'concessionOrDob'];
  var missing = [];
  
  REQUIRED_FIELDS.forEach(function(f) {
    if (!args[f] || String(args[f]).trim() === '') missing.push(f);
  });
  
  if (missing.length > 0) {
    return {
      status: "incomplete",
      missingFields: missing,
      message: "Cannot submit yet. Still need: " + missing.join(", ")
    };
  }
  
  // Appends clean row to CompletedJourneys sheet
  appendCompletedJourneyRow(args);
  return { status: "submitted", leadId: args.leadId };
}
```

If fields are missing, the backend returns `status: incomplete`, instructing the voice LLM to ask the customer specifically for the missing field before retrying.

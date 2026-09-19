# Regulatory Compliance & Security Architecture

Compliance protocols, regulatory guardrails, and security boundaries implemented in the **Econnex Autonomous Energy Voice Recovery Platform**.

---

## 🛡️ 1. ACMA Telemarketing Regulations & DNC Gating

The platform operates in strict compliance with the **Australian Telecommunications (Do Not Call Register) Act 2006** and the **Telemarketing and Research Calls Industry Standard 2017**.

### Pre-Dial Gate Architecture
- **Location**: Executes client-side before WebRTC initialization and server-side before outbound dialer triggers.
- **Rule Enforcement**:
  1. Checks target phone number against the ACMA Do Not Call (DNC) Register database (`DNC_REGISTERED_NUMBERS`).
  2. Evaluates Australian Eastern Standard Time (AEST) calling windows:
     - Weekdays: 9:00 AM – 8:00 PM
     - Saturdays: 9:00 AM – 5:00 PM
     - Sundays & National Holidays: Strictly Prohibited
- **Audit Enforcement**: Blocked numbers trigger an immediate `DNC_SUPPRESSED` log write to the `DncLog` sheet tab.

---

## 🔒 2. PCI-DSS Payment Data Boundary

Voice AI agents should never accept or store credit card numbers, CVVs, or bank account details over open phone channels.

### Security Implementation
- **Strict Boundary Guardrail**: System prompts explicitly forbid collecting payment card details or BSB/account numbers.
- **Keyword Boundary Detection**: Any user mention of `"card"`, `"credit card"`, `"bank account"`, or `"payment details"` triggers a classified `SENSITIVE` signal.
- **Hand-off Protocol**: The voice agent halts data collection and routes the customer to a secure SMS/email web checkout link or escalates to human agent Aarav.

---

## 🎙️ 3. Two-Party Recording Disclosure

Under Australian privacy law, call recording requires explicit disclosure at the beginning of the interaction.

### Implementation
- **Second 0 Disclosure**: The voice assistant's mandatory initial greeting includes:
  > *"Hi [Customer Name], this is Alex from Econnex on a recorded line..."*
- **Explicit Consent Verification**: Logged in transcript feeds and preserved across system handoffs.

---

## 🛑 4. Zero-Pressure Exit Protocol (Respect "No")

Telemarketing regulations mandate that customer requests to cease communication must be respected immediately without aggressive badgering loops.

### Protocol Flow
1. **Signal Recognition**: Detects statements like *"not interested"*, *"stop calling"*, *"remove my number"*.
2. **Immediate Tool Execution**: The agent calls `logDecline(leadId, customerName, reason)`.
3. **Polite Sign-off**: Delivers a concise sign-off (*"Thank you for your time, have a great day!"*) and disconnects.
4. **Permanent Lead Suppression**: Lead status is set to `DECLINED` in database, preventing future automated retry campaigns.

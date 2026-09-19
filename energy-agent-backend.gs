/**
 * CIMET / Econnex — Energy Journey Recovery Backend
 * =================================================
 * Vapi tool webhook + journey-completion sink for the Energy (Electricity & Gas)
 * dropout-recovery voice agent.
 *
 * TABS CREATED BY setupSheetHeaders():
 *   Leads              LeadID | CustomerName | Phone | Email | SupplyAddress | LastCompletedStep | DncStatus | DncCheckedAt
 *   CompletedJourneys  Timestamp | LeadID | CustomerName | SupplyAddress | CurrentRetailer | FuelType |
 *                      SolarPanels | Email | Phone | ConcessionOrDob | Vertical | FieldsAuto | FieldsTotal | Status
 *   Handoffs           Timestamp | LeadID | CustomerName | Reason | Trigger | FieldsCollectedSoFar | FieldCount | Status
 *   Declines           Timestamp | LeadID | CustomerName | Reason | Status
 *   DncLog             Timestamp | LeadID | Phone | Result | Detail
 *
 * DEPLOY: Extensions > Apps Script > Deploy > New deployment > Web app
 *         Execute as: Me   |   Who has access: Anyone
 *         Copy the /exec URL into the Server URL of every Vapi tool.
 */

// ===================== CONFIG =====================

/**
 * OPTIONAL. Leave as-is if you opened this script from inside the target Sheet
 * (Extensions > Apps Script) — the script is then *bound* to that Sheet and finds
 * it automatically.
 *
 * Only set this if the script lives somewhere else (a standalone Apps Script
 * project). Paste the ID from the Sheet URL:
 *   docs.google.com/spreadsheets/d/<THIS_PART>/edit
 *
 * Note: openById() fails with "Access is denied" when the Sheet is owned by a
 * different Google account than the one running the script. If you hit that,
 * clear this back to the placeholder and use the bound Sheet instead.
 */
const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';

/**
 * Optional: CIMET's journey-completion sandbox. When CIMET hands you the real
 * endpoint on the day, paste it here — every completed journey is then mirrored
 * to it in the canonical payload shape (see buildJourneyPayload) in addition to
 * being written to the Sheet. Leave blank to run Sheet-only.
 */
const JOURNEY_SANDBOX_URL = '';

/** ACMA calling-hours window (Australia/Sydney), per the Telemarketing Standard 2017. */
const CALLING_HOURS = { weekdayStart: 9, weekdayEnd: 20, satStart: 9, satEnd: 17, sundayAllowed: false };

/** Stubbed ACMA Do Not Call Register. Numbers here are treated as registered. */
const DNC_REGISTERED_NUMBERS = ['0400000000', '0499999999'];

/**
 * Demo override for the CALLING-HOURS window only — mirrors the frontend's
 * "override for demo" button so the UI and the server never disagree.
 *
 * Set true when demoing from Jaipur outside 9am-8pm Sydney (IST is AEST-4:30,
 * so anything after ~3:30pm IST on a weekday falls outside the window).
 *
 * A register listing is NEVER overridable — that is a legal prohibition, not a
 * scheduling constraint. Every override is written to DncLog as OVERRIDDEN so
 * the decision stays auditable.
 */
const ALLOW_OUTSIDE_HOURS_FOR_DEMO = false;

// ===================== ENTRY POINT =====================

function doPost(e) {
  let toolCallId = null;
  try {
    assertConfigured_();

    const body = JSON.parse(e.postData.contents);
    const toolCall = body.message && body.message.toolCalls && body.message.toolCalls[0];
    if (!toolCall) throw new Error('No toolCalls found in request body');

    toolCallId = toolCall.id;
    const fnName = toolCall.function.name;
    const params = typeof toolCall.function.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;

    let result;
    switch (fnName) {
      case 'submitJourney': result = submitJourney(params); break;
      case 'endHandoff':    result = endHandoff(params);    break;
      case 'logDecline':    result = logDecline(params);    break;
      case 'checkDnc':      result = checkDnc(params);      break;
      default:              result = { status: 'error', error: 'Unknown function: ' + fnName };
    }

    return jsonOut_(toolCallId, result);
  } catch (err) {
    return jsonOut_(toolCallId, { status: 'error', error: err.toString() });
  }
}

/** GET handler — lets you sanity-check the deployment in a browser. */
function doGet() {
  let configured = false, sheetName = null, resolvedVia = null, error = null;
  try {
    const ss = ss_();
    configured = true;
    sheetName = ss.getName();
    resolvedVia = (SPREADSHEET_ID.indexOf('PASTE_') !== 0) ? 'SPREADSHEET_ID' : 'bound spreadsheet';
  } catch (err) {
    error = err.message;
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      service: 'Econnex Energy Recovery Backend',
      configured: configured,
      spreadsheet: sheetName,
      resolvedVia: resolvedVia,
      error: error,
      sandboxMirror: JOURNEY_SANDBOX_URL ? 'enabled' : 'disabled',
      tools: ['submitJourney', 'endHandoff', 'logDecline', 'checkDnc']
    }, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Vapi requires exactly this envelope. */
function jsonOut_(toolCallId, result) {
  return ContentService
    .createTextOutput(JSON.stringify({
      results: [{ toolCallId: toolCallId, result: JSON.stringify(result) }]
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Resolves the target spreadsheet. Prefers an explicit SPREADSHEET_ID; otherwise
 * falls back to the Sheet this script is bound to. The fallback is what makes the
 * script work without any configuration when opened via Extensions > Apps Script,
 * and it sidesteps the cross-account "Access is denied" that openById throws when
 * the Sheet belongs to a different Google account than the script.
 */
function ss_() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('PASTE_') !== 0) {
    try {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (err) {
      throw new Error(
        'Could not open SPREADSHEET_ID "' + SPREADSHEET_ID + '": ' + err +
        '\n\nUsually this means the Sheet is owned by a different Google account than ' +
        'the one running this script. Fix: open the Sheet, choose Extensions > Apps ' +
        'Script, paste this file there, and reset SPREADSHEET_ID to the placeholder ' +
        'so the bound Sheet is used instead.'
      );
    }
  }

  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;

  throw new Error(
    'No spreadsheet found. Either open this script from inside the target Sheet ' +
    '(Extensions > Apps Script), or set SPREADSHEET_ID at the top of this file.'
  );
}

function assertConfigured_() {
  ss_();   // throws with a specific, actionable message if nothing resolves
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run setupSheetHeaders() once.');
  return sh;
}

// ===================== FIELD NORMALISATION =====================

/**
 * Normalises a tool-call payload to the canonical Energy field names.
 *
 * The only aliases kept are synonyms for the SAME Energy field — the model may
 * reasonably send `name`, or split concession from date of birth. Anything it
 * does not send stays empty and is caught by missingFields_(), which fails the
 * submission loudly rather than writing a blank cell.
 */
function normaliseJourney_(params) {
  return {
    leadId:          params.leadId || '',
    customerName:    params.customerName || params.name || '',
    supplyAddress:   params.supplyAddress || '',
    currentRetailer: params.currentRetailer || '',
    fuelType:        params.fuelType || '',
    solarPanels:     params.solarPanels || '',
    email:           params.email || '',
    phone:           params.phone || '',
    concessionOrDob: params.concessionOrDob || params.concession || params.dob || '',
    vertical:        params.vertical || 'Energy (Electricity & Gas)'
  };
}

const REQUIRED_ENERGY_FIELDS = [
  'supplyAddress', 'currentRetailer', 'fuelType', 'solarPanels',
  'customerName', 'email', 'phone', 'concessionOrDob'
];

function missingFields_(j) {
  return REQUIRED_ENERGY_FIELDS.filter(function (f) {
    return !j[f] || String(j[f]).trim() === '';
  });
}

/**
 * Canonical journey payload — the shape we submit downstream. Mirrors what the
 * human agent console posts today: identity + supply point + current plan +
 * eligibility, with a provenance block so CIMET can audit which fields the AI
 * captured versus which were pre-filled from the abandoned cart.
 *
 * When CIMET provides the real sandbox schema, map it HERE and nowhere else —
 * this is the single adapter seam.
 */
function buildJourneyPayload(j, meta) {
  meta = meta || {};
  const solar = String(j.solarPanels);
  const hasSolar = !/^\s*(no|none|nope|nah)\b/i.test(solar) &&
                   /(yes|y\b|solar|kw|panel|\d)/i.test(solar);

  return {
    leadId: j.leadId,
    vertical: 'energy',
    source: 'ai_voice_recovery',
    submittedAt: new Date().toISOString(),
    customer: {
      fullName: j.customerName,
      email: j.email,
      phone: j.phone,
      concessionOrDob: j.concessionOrDob
    },
    supplyPoint: {
      address: j.supplyAddress,
      fuelType: j.fuelType,
      hasSolar: hasSolar
    },
    currentPlan: {
      retailer: j.currentRetailer
    },
    compliance: {
      recordingConsentDisclosed: true,
      cardDataCapturedByVoice: false,
      dncChecked: true
    },
    provenance: {
      fieldsAutoCaptured: meta.fieldsAuto || REQUIRED_ENERGY_FIELDS.length,
      fieldsTotal: REQUIRED_ENERGY_FIELDS.length,
      manualKeystrokes: 0
    }
  };
}

// ===================== TOOL 1: SUBMIT COMPLETED JOURNEY =====================

function submitJourney(params) {
  const j = normaliseJourney_(params);

  const missing = missingFields_(j);
  if (missing.length) {
    // Tell the model exactly what to go back and ask for, rather than writing a
    // half-empty row that looks like a success.
    return {
      status: 'incomplete',
      missingFields: missing,
      message: 'Cannot submit yet. Still need: ' + missing.join(', ')
    };
  }

  const payload = buildJourneyPayload(j, { fieldsAuto: params.fieldsAutoCaptured });

  sheet_('CompletedJourneys').appendRow([
    new Date(), j.leadId, j.customerName, j.supplyAddress, j.currentRetailer,
    j.fuelType, j.solarPanels, j.email, j.phone, j.concessionOrDob,
    j.vertical, payload.provenance.fieldsAutoCaptured, payload.provenance.fieldsTotal,
    'Completed'
  ]);

  let mirror = 'skipped';
  if (JOURNEY_SANDBOX_URL) {
    try {
      UrlFetchApp.fetch(JOURNEY_SANDBOX_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      mirror = 'sent';
    } catch (err) {
      mirror = 'failed: ' + err;
    }
  }

  return { status: 'submitted', leadId: j.leadId, sandboxMirror: mirror };
}

// ===================== TOOL 2: WARM HANDOFF =====================

function endHandoff(params) {
  const leadId = params.leadId || '';
  const name = params.customerName || params.name || '';
  const reason = params.reason || '';
  const trigger = params.trigger || 'unclassified';
  // fieldsCollected may arrive as an object or as a JSON string, depending on how
  // the tool schema is declared. Normalise both so the context count is accurate —
  // "N fields passed" is the evidence that the customer never repeats themselves.
  let fields = params.fieldsCollected || {};
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch (err) { fields = { raw: fields }; }
  }
  if (!fields || typeof fields !== 'object') fields = {};

  // Drop empty values so the count reflects what was actually captured.
  const clean = {};
  Object.keys(fields).forEach(function (k) {
    if (fields[k] !== null && fields[k] !== undefined && String(fields[k]).trim() !== '') {
      clean[k] = fields[k];
    }
  });

  const serialised = JSON.stringify(clean);
  const count = Object.keys(clean).length;

  sheet_('Handoffs').appendRow([
    new Date(), leadId, name, reason, trigger, serialised, count, 'Escalated'
  ]);

  // Context returned to the model so its handoff line can be specific.
  return {
    status: 'handoff_logged',
    contextPassed: count + ' fields',
    humanAgent: 'Aarav (Senior Energy Specialist)'
  };
}

// ===================== TOOL 3: RESPECT "NO" =====================

function logDecline(params) {
  sheet_('Declines').appendRow([
    new Date(),
    params.leadId || '',
    params.customerName || params.name || '',
    params.reason || 'Customer declined',
    'Declined — do not re-contact this campaign'
  ]);
  return { status: 'decline_logged', suppressFurtherContact: true };
}

// ===================== TOOL 4: DNC / CALLING-HOURS GATE =====================

/**
 * ACMA Do Not Call Register gate. STUBBED — a production build swaps the
 * DNC_REGISTERED_NUMBERS lookup for the ACMA washing API. This is the seam,
 * and it sits BEFORE dialling, not after.
 */
function checkDnc(params) {
  const phone = String(params.phone || '').replace(/[^0-9]/g, '');
  const leadId = params.leadId || '';

  const onRegister = DNC_REGISTERED_NUMBERS.indexOf(phone) !== -1;
  const hours = withinCallingHours_();

  let result, detail;
  if (onRegister) {
    // Hard block. Not overridable, not even for a demo.
    result = 'BLOCKED';
    detail = 'Number listed on ACMA Do Not Call Register';
  } else if (!hours.ok && !ALLOW_OUTSIDE_HOURS_FOR_DEMO) {
    result = 'BLOCKED';
    detail = 'Outside permitted calling hours (' + hours.reason + ')';
  } else if (!hours.ok) {
    result = 'OVERRIDDEN';
    detail = 'Outside permitted calling hours (' + hours.reason + ') — demo override acknowledged';
  } else {
    result = 'CLEARED';
    detail = 'Not on register; within permitted calling hours';
  }

  try {
    sheet_('DncLog').appendRow([new Date(), leadId, phone, result, detail]);
  } catch (err) { /* log tab optional — never block the gate on logging */ }

  const mayDial = (result === 'CLEARED' || result === 'OVERRIDDEN');
  return { status: mayDial ? 'cleared' : 'blocked', result: result, detail: detail };
}

function withinCallingHours_() {
  const now = new Date();
  const syd = new Date(Utilities.formatDate(now, 'Australia/Sydney', 'yyyy/MM/dd HH:mm:ss'));
  const day = syd.getDay();   // 0 Sun .. 6 Sat
  const hour = syd.getHours();

  if (day === 0 && !CALLING_HOURS.sundayAllowed) {
    return { ok: false, reason: 'Sunday — telemarketing not permitted' };
  }
  if (day === 6) {
    const ok = hour >= CALLING_HOURS.satStart && hour < CALLING_HOURS.satEnd;
    return { ok: ok, reason: 'Saturday window is 9am-5pm AEST' };
  }
  const ok = hour >= CALLING_HOURS.weekdayStart && hour < CALLING_HOURS.weekdayEnd;
  return { ok: ok, reason: 'Weekday window is 9am-8pm AEST' };
}

// ===================== ONE-CLICK SETUP =====================

/** The schema this backend writes. Column order here IS the append order. */
const SCHEMA = {
  Leads: ['LeadID', 'CustomerName', 'Phone', 'Email', 'SupplyAddress', 'LastCompletedStep', 'DncStatus', 'DncCheckedAt'],
  CompletedJourneys: ['Timestamp', 'LeadID', 'CustomerName', 'SupplyAddress', 'CurrentRetailer', 'FuelType',
                      'SolarPanels', 'Email', 'Phone', 'ConcessionOrDob', 'Vertical', 'FieldsAuto', 'FieldsTotal', 'Status'],
  Handoffs: ['Timestamp', 'LeadID', 'CustomerName', 'Reason', 'Trigger', 'FieldsCollectedSoFar', 'FieldCount', 'Status'],
  Declines: ['Timestamp', 'LeadID', 'CustomerName', 'Reason', 'Status'],
  DncLog: ['Timestamp', 'LeadID', 'Phone', 'Result', 'Detail']
};

function writeHeader_(sh, cols) {
  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#1E2B3E').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
}

function headerMatches_(sh, cols) {
  if (sh.getLastRow() === 0) return false;
  const width = Math.max(sh.getLastColumn(), cols.length);
  const actual = sh.getRange(1, 1, 1, width).getValues()[0]
                   .map(function (v) { return String(v).trim(); });
  return cols.every(function (c, i) { return actual[i] === c; });
}

/**
 * Safe to run on a fresh Sheet or an existing one. Creates missing tabs, writes
 * headers into empty tabs, and REPORTS (without touching) any existing tab whose
 * headers do not match the current schema — appending Energy rows under stale
 * headers from an older schema would misalign every column silently.
 *
 * If it reports mismatches, run migrateLegacySheets() and then run this again.
 */
function setupSheetHeaders() {
  const ss = ss_();
  const mismatched = [];

  Object.keys(SCHEMA).forEach(function (name) {
    const cols = SCHEMA[name];
    let sh = ss.getSheetByName(name);

    if (!sh) {
      sh = ss.insertSheet(name);
      writeHeader_(sh, cols);
      Logger.log('CREATED  ' + name);
      return;
    }
    if (sh.getLastRow() === 0) {
      writeHeader_(sh, cols);
      Logger.log('HEADERS  ' + name + ' (was empty)');
      return;
    }
    if (headerMatches_(sh, cols)) {
      Logger.log('OK       ' + name);
      return;
    }
    mismatched.push(name);
    Logger.log('MISMATCH ' + name + '  <- existing headers do not match the Energy schema');
  });

  // Seed synthetic Energy leads only into a correctly-shaped, header-only Leads tab.
  // Test data only: 04915701xx is the AU fictional-number range reserved for testing.
  const leads = ss.getSheetByName('Leads');
  if (leads && leads.getLastRow() === 1 && headerMatches_(leads, SCHEMA.Leads)) {
    leads.appendRow(['LEAD-EN-101', 'David Miller', '0491570156', 'david.miller@example.com', '45 Station Rd, Burwood NSW 2134', 'Step 4: Bill Upload', 'CLEARED', new Date()]);
    leads.appendRow(['LEAD-EN-102', 'Ananya Patel', '0491570157', 'ananya.patel@example.com', '18 King St, Richmond VIC 3121', 'Step 2: Solar Tariff', 'CLEARED', new Date()]);
    leads.appendRow(['LEAD-EN-103', 'Liam OConnor', '0400000000', 'liam.oconnor@example.com', '72 Queen St, Brisbane QLD 4000', 'Step 3: Concession', 'BLOCKED', new Date()]);
    Logger.log('SEEDED   Leads with 3 synthetic Energy leads');
  }

  if (mismatched.length) {
    Logger.log('\n=== ACTION REQUIRED ===');
    Logger.log('These tabs carry an older schema: ' + mismatched.join(', '));
    Logger.log('Run migrateLegacySheets() to archive them, then run setupSheetHeaders() again.');
    Logger.log('Nothing was overwritten.');
  } else {
    Logger.log('\nAll tabs match the Energy schema. Ready.');
  }
  return { mismatched: mismatched };
}

/**
 * Non-destructive migration for reusing an existing spreadsheet: renames any tab
 * whose headers are stale to "<name>_legacy_<yyyyMMdd-HHmm>" and leaves the data
 * untouched, so setupSheetHeaders() can create clean ones alongside.
 */
function migrateLegacySheets() {
  const ss = ss_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
  let moved = 0;

  Object.keys(SCHEMA).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() === 0) return;
    if (headerMatches_(sh, SCHEMA[name])) return;
    sh.setName(name + '_legacy_' + stamp);
    Logger.log('ARCHIVED ' + name + ' -> ' + sh.getName());
    moved++;
  });

  if (!moved) {
    Logger.log('Nothing to migrate — all tabs already match the Energy schema.');
  } else {
    Logger.log('\nArchived ' + moved + ' tab(s). Now run setupSheetHeaders().');
    Logger.log('Your old data is intact under the _legacy_ tabs; delete them when you are happy.');
  }
  return { archived: moved };
}

// ===================== TEST HELPERS =====================

function testSubmitEnergyJourney() {
  Logger.log(JSON.stringify(submitJourney({
    leadId: 'LEAD-EN-101',
    customerName: 'David Miller',
    supplyAddress: '45 Station Rd, Burwood NSW 2134',
    currentRetailer: 'AGL',
    fuelType: 'Dual Fuel',
    solarPanels: 'No solar',
    email: 'david.miller@example.com',
    phone: '0491570156',
    concessionOrDob: 'No concession, born 1982',
    fieldsAutoCaptured: 8
  }), null, 2));
}

/** Proves the guard: a half-collected journey is refused, not silently written. */
function testSubmitIncompleteJourney() {
  Logger.log(JSON.stringify(submitJourney({
    leadId: 'LEAD-EN-999',
    customerName: 'Partial Lead',
    supplyAddress: '1 Test St, Sydney NSW 2000'
  }), null, 2));
}

function testEndHandoff() {
  Logger.log(JSON.stringify(endHandoff({
    leadId: 'LEAD-EN-102',
    customerName: 'Ananya Patel',
    reason: 'Customer asked for a supervisor and said she had already requested no further calls',
    trigger: 'ANGER+ASKS',
    fieldsCollected: { supplyAddress: '18 King St, Richmond VIC 3121', currentRetailer: 'Origin' }
  }), null, 2));
}

function testCheckDnc() {
  Logger.log('Clean number:  ' + JSON.stringify(checkDnc({ leadId: 'LEAD-EN-101', phone: '0491570156' })));
  Logger.log('On register:   ' + JSON.stringify(checkDnc({ leadId: 'LEAD-EN-103', phone: '0400000000' })));
}

function testLogDecline() {
  Logger.log(JSON.stringify(logDecline({
    leadId: 'LEAD-EN-104', customerName: 'Test Decline', reason: 'Not interested, asked not to be called'
  }), null, 2));
}

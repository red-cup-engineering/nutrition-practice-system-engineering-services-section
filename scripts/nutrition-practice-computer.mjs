/**
 * Pure, deterministic conformance for caller-supplied nutrition ledger records.
 *
 * This module never reads, writes, imports, clocks, searches, or calculates.
 * Its only job is to make admissibility and cross-record meaning inspectable.
 */

import { isObjectRecord } from "@red-cup-engineering/json-services-section";

export const RECORD_TYPES = Object.freeze({
  intakeCandidate: "nutrition-intake-candidate",
  foodAssertionSnapshot: "nutrition-food-assertion-snapshot",
  intakeEvent: "nutrition-intake-event",
});

export const SCHEMA_IDS = Object.freeze({
  [RECORD_TYPES.intakeCandidate]: "urn:red-cup-science:nutrition:intake-candidate:1.0.0",
  [RECORD_TYPES.foodAssertionSnapshot]: "urn:red-cup-science:nutrition:food-assertion-snapshot:1.0.0",
  [RECORD_TYPES.intakeEvent]: "urn:red-cup-science:nutrition:intake-event:1.0.0",
});

const REQUIRED_MEDIA_RETENTION = Object.freeze({
  containsRawPhoto: false,
  containsReceiptImage: false,
  containsRawAudio: false,
  containsAppearanceEmbedding: false,
  containsRawWearablePayload: false,
});

const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const RAW_PAYLOAD_FIELDS = new Set([
  "photo", "photos", "rawphoto", "rawphotos", "image", "images", "rawimage", "rawimages",
  "receipt", "receipts", "receiptimage", "receiptimages", "rawreceiptimage", "rawreceiptimages",
  "audio", "audios", "rawaudio", "rawaudios", "voice", "rawvoice",
  "embedding", "embeddings", "appearanceembedding", "appearanceembeddings",
  "rawappearanceembedding", "rawappearanceembeddings", "wearablepayload",
  "rawwearablepayload", "rawdevicepayload",
]);

/**
 * Validates a parsed bundle supplied by an adapter. Records are envelopes:
 * `{ path, type, value }`. `path` is a portable relative POSIX identifier, not
 * a filesystem capability.
 */
export function validateNutritionLedger(input) {
  const diagnostics = [];
  if (!isPlainObject(input)) return result([issue("INPUT_NOT_OBJECT", "error", "$", "Input must be an object.")]);
  if (!Array.isArray(input.records)) diagnostics.push(issue("RECORDS_NOT_ARRAY", "error", "$.records", "Records must be a caller-supplied array."));
  if (!isPlainObject(input.schemaValidator) || typeof input.schemaValidator.validate !== "function") diagnostics.push(issue("SCHEMA_VALIDATOR_PORT_REQUIRED", "error", "$.schemaValidator", "A schemaValidator.validate port is required; this computer neither chooses nor loads a validator."));
  if (diagnostics.length > 0) return result(diagnostics);

  const byPath = new Map();
  const candidateIds = new Set();
  const intakeEventIds = new Set();
  const snapshotsByPath = new Map();
  for (let index = 0; index < input.records.length; index += 1) {
    const record = input.records[index];
    const location = `$.records[${index}]`;
    if (!isPlainObject(record)) { diagnostics.push(issue("RECORD_NOT_OBJECT", "error", location, "Each record must be an object.")); continue; }
    if (!isRelativePosixPath(record.path)) { diagnostics.push(issue("RECORD_PATH_INVALID", "error", `${location}.path`, "Record path must be a non-empty relative POSIX path.")); continue; }
    if (!Object.values(RECORD_TYPES).includes(record.type)) { diagnostics.push(issue("RECORD_TYPE_UNKNOWN", "error", `${location}.type`, "Record type is not admitted by this ledger slice.", { type: record.type })); continue; }
    if (byPath.has(record.path)) { diagnostics.push(issue("RECORD_PATH_DUPLICATE", "error", `${location}.path`, "Each bundle path must identify one record.", { path: record.path })); continue; }
    byPath.set(record.path, record);
    validateViaPort(input.schemaValidator, input.schemaCorpus, record, location, diagnostics);
    validateMediaRetention(record, location, diagnostics);
    rejectRawPayload(record.value, `${location}.value`, record.path, diagnostics);
    if (record.type === RECORD_TYPES.intakeCandidate) validateCandidate(record, location, candidateIds, diagnostics);
    if (record.type === RECORD_TYPES.foodAssertionSnapshot) validateSnapshot(record, location, snapshotsByPath, diagnostics);
  }
  for (let index = 0; index < input.records.length; index += 1) {
    const record = input.records[index];
    if (isPlainObject(record) && record.type === RECORD_TYPES.intakeEvent) validateIntakeEvent(record, `$.records[${index}]`, byPath, snapshotsByPath, candidateIds, intakeEventIds, diagnostics);
  }
  return result(diagnostics);
}

function validateViaPort(schemaValidator, schemaCorpus, record, location, diagnostics) {
  let response;
  try {
    response = schemaValidator.validate({ schemaId: SCHEMA_IDS[record.type], instance: record.value, schemaCorpus });
  } catch (error) {
    diagnostics.push(issue("SCHEMA_VALIDATOR_PORT_FAILED", "error", `${location}.value`, "The supplied schema validator threw while validating this record.", { recordPath: record.path, reason: String(error?.message ?? error) }));
    return;
  }
  if (!isPlainObject(response) || typeof response.valid !== "boolean") {
    diagnostics.push(issue("SCHEMA_VALIDATOR_PORT_PROTOCOL_INVALID", "error", `${location}.value`, "Schema validator must return { valid: boolean, diagnostics?: Array }.", { recordPath: record.path }));
    return;
  }
  if (!response.valid) for (const schemaDiagnostic of Array.isArray(response.diagnostics) && response.diagnostics.length > 0 ? response.diagnostics : [{}]) {
    diagnostics.push(issue("SCHEMA_INVALID", "error", `${location}.value`, "Record does not conform to its declared science schema.", { recordPath: record.path, schemaId: SCHEMA_IDS[record.type], schemaDiagnostic }));
  }
}

function validateMediaRetention(record, location, diagnostics) {
  const retention = record.value?.mediaRetention;
  if (!isPlainObject(retention)) {
    diagnostics.push(issue("MEDIA_RETENTION_UNDECLARED", "error", `${location}.value.mediaRetention`, "Every canonical nutrition record must declare its media-retention affirmations."));
    return;
  }
  for (const [field, expected] of Object.entries(REQUIRED_MEDIA_RETENTION)) if (retention[field] !== expected) {
    diagnostics.push(issue("RAW_MEDIA_AFFIRMATION_MISSING_OR_FALSE", "error", `${location}.value.mediaRetention.${field}`, "Every raw-media retention affirmation must explicitly be false.", { expected, actual: retention[field] }));
  }
}

function validateCandidate(record, location, candidateIds, diagnostics) {
  const value = record.value;
  if (!isPlainObject(value)) { diagnostics.push(issue("CANDIDATE_NOT_OBJECT", "error", `${location}.value`, "An intake candidate must be an object.")); return; }
  requireId(value.candidateId, `${location}.value.candidateId`, "CANDIDATE_ID_INVALID", diagnostics);
  if (candidateIds.has(value.candidateId)) diagnostics.push(issue("CANDIDATE_ID_DUPLICATE", "error", `${location}.value.candidateId`, "Candidate identifiers must be unique.", { candidateId: value.candidateId }));
  if (typeof value.candidateId === "string") candidateIds.add(value.candidateId);
  if (!isPlainObject(value.origin) || !["manual", "text", "barcode", "receipt", "image", "voice", "import"].includes(value.origin.kind)) diagnostics.push(issue("CANDIDATE_ORIGIN_INVALID", "error", `${location}.value.origin`, "A candidate must name its non-authoritative origin kind."));
  if (!Array.isArray(value.foodCandidates) || value.foodCandidates.length === 0) diagnostics.push(issue("CANDIDATE_OPTIONS_MISSING", "error", `${location}.value.foodCandidates`, "A candidate record must contain one or more possible food selections."));
}

function validateSnapshot(record, location, snapshotsByPath, diagnostics) {
  const value = record.value;
  if (!isPlainObject(value)) { diagnostics.push(issue("SNAPSHOT_NOT_OBJECT", "error", `${location}.value`, "A food-assertion snapshot must be an object.")); return; }
  requireId(value.assertionId, `${location}.value.assertionId`, "ASSERTION_ID_INVALID", diagnostics);
  if (!isPlainObject(value.source) || !nonEmpty(value.source.id) || !nonEmpty(value.source.release)) diagnostics.push(issue("SNAPSHOT_SOURCE_VERSION_MISSING", "error", `${location}.value.source`, "A snapshot must preserve a source identifier and exact release/version."));
  if (!Array.isArray(value.nutrientAssertions) || value.nutrientAssertions.length === 0) diagnostics.push(issue("NUTRIENT_ASSERTIONS_MISSING", "error", `${location}.value.nutrientAssertions`, "A snapshot must contain its selected versioned nutrient assertions."));
  const nutrientIds = new Set();
  for (const [index, assertion] of (value.nutrientAssertions ?? []).entries()) {
    const point = `${location}.value.nutrientAssertions[${index}]`;
    if (!isPlainObject(assertion)) { diagnostics.push(issue("NUTRIENT_ASSERTION_NOT_OBJECT", "error", point, "A nutrient assertion must be an object.")); continue; }
    requireId(assertion.id, `${point}.id`, "NUTRIENT_ASSERTION_ID_INVALID", diagnostics);
    if (nutrientIds.has(assertion.id)) diagnostics.push(issue("NUTRIENT_ASSERTION_ID_DUPLICATE", "error", `${point}.id`, "Nutrient assertion identifiers must be unique within a snapshot."));
    if (typeof assertion.id === "string") nutrientIds.add(assertion.id);
    if (!nonEmpty(assertion.nutrientId)) diagnostics.push(issue("NUTRIENT_IDENTIFIER_MISSING", "error", `${point}.nutrientId`, "A nutrient assertion must name a nutrient identifier."));
    validateQuantity(assertion.quantity, `${point}.quantity`, diagnostics);
    if (!isPlainObject(assertion.source) || assertion.source.id !== value.source?.id || assertion.source.release !== value.source?.release) diagnostics.push(issue("NUTRIENT_SOURCE_SNAPSHOT_MISMATCH", "error", `${point}.source`, "Every nutrient assertion must carry the snapshot's exact source identifier and release."));
  }
  snapshotsByPath.set(record.path, value);
}

function validateIntakeEvent(record, location, byPath, snapshotsByPath, candidateIds, intakeEventIds, diagnostics) {
  const value = record.value;
  if (!isPlainObject(value)) { diagnostics.push(issue("INTAKE_EVENT_NOT_OBJECT", "error", `${location}.value`, "An intake event must be an object.")); return; }
  requireId(value.eventId, `${location}.value.eventId`, "INTAKE_EVENT_ID_INVALID", diagnostics);
  if (intakeEventIds.has(value.eventId)) diagnostics.push(issue("INTAKE_EVENT_ID_DUPLICATE", "error", `${location}.value.eventId`, "Intake-event identifiers must be unique so distinct records cannot ambiguously claim one historical event.", { eventId: value.eventId }));
  if (typeof value.eventId === "string") intakeEventIds.add(value.eventId);
  if (!isPlainObject(value.affirmation) || value.affirmation.kind !== "human-affirmed" || !nonEmpty(value.affirmation.affirmedBy)) diagnostics.push(issue("HUMAN_AFFIRMATION_REQUIRED", "error", `${location}.value.affirmation`, "Only an explicitly human-affirmed selection may enter the intake ledger."));
  validateQuantity(value.amount, `${location}.value.amount`, diagnostics);
  const snapshotPath = value.foodAssertionSnapshot?.path;
  const target = byPath.get(snapshotPath);
  if (!isRelativePosixPath(snapshotPath)) diagnostics.push(issue("SNAPSHOT_REFERENCE_INVALID", "error", `${location}.value.foodAssertionSnapshot.path`, "An intake event must name its selected snapshot's bundle path."));
  else if (!target || target.type !== RECORD_TYPES.foodAssertionSnapshot) diagnostics.push(issue("SNAPSHOT_REFERENCE_UNRESOLVED", "error", `${location}.value.foodAssertionSnapshot.path`, "An intake event must reference an admitted food-assertion snapshot.", { snapshotPath }));
  const snapshot = snapshotsByPath.get(snapshotPath);
  if (snapshot && value.foodAssertionSnapshot?.assertionId !== snapshot.assertionId) diagnostics.push(issue("SNAPSHOT_ASSERTION_ID_MISMATCH", "error", `${location}.value.foodAssertionSnapshot.assertionId`, "The referenced assertion ID must equal the immutable snapshot's assertion ID."));
  if (snapshot && (value.foodAssertionSnapshot?.source?.id !== snapshot.source?.id || value.foodAssertionSnapshot?.source?.release !== snapshot.source?.release)) diagnostics.push(issue("SNAPSHOT_SOURCE_VERSION_MISMATCH", "error", `${location}.value.foodAssertionSnapshot.source`, "The intake event must preserve the selected snapshot's source identifier and exact release."));
  const selected = value.foodAssertionSnapshot?.nutrientAssertionReferences;
  if (!Array.isArray(selected) || selected.length === 0) diagnostics.push(issue("SELECTED_NUTRIENT_ASSERTIONS_REQUIRED", "error", `${location}.value.foodAssertionSnapshot.nutrientAssertionReferences`, "An intake event must preserve the exact nutrient assertions selected from its snapshot."));
  else for (const [index, reference] of selected.entries()) {
    const point = `${location}.value.foodAssertionSnapshot.nutrientAssertionReferences[${index}]`;
    const found = snapshot?.nutrientAssertions?.find((assertion) => assertion.id === reference?.id);
    if (!found) diagnostics.push(issue("SELECTED_NUTRIENT_ASSERTION_UNRESOLVED", "error", point, "Selected nutrient assertion must exist in the referenced snapshot.", { assertionId: reference?.id }));
    else if (reference.nutrientId !== found.nutrientId || reference.source?.id !== found.source?.id || reference.source?.release !== found.source?.release) diagnostics.push(issue("SELECTED_NUTRIENT_ASSERTION_VERSION_MISMATCH", "error", point, "Selected nutrient assertion reference must preserve nutrient ID, source ID, and exact source release."));
  }
  if (value.candidateReference !== undefined && !candidateIds.has(value.candidateReference)) diagnostics.push(issue("CANDIDATE_REFERENCE_UNRESOLVED", "error", `${location}.value.candidateReference`, "A cited intake candidate must occur in this supplied bundle.", { candidateId: value.candidateReference }));
}

function validateQuantity(value, location, diagnostics) {
  if (!isPlainObject(value) || typeof value.value !== "string" || !DECIMAL.test(value.value) || !nonEmpty(value.unit) || !nonEmpty(value.basis)) diagnostics.push(issue("DECIMAL_QUANTITY_INVALID", "error", location, "Canonical quantities require a non-negative decimal string plus declared unit and basis; binary numbers are not admitted."));
}

function rejectRawPayload(value, location, recordPath, diagnostics) {
  if (Array.isArray(value)) value.forEach((item, index) => rejectRawPayload(item, `${location}[${index}]`, recordPath, diagnostics));
  else if (isPlainObject(value)) for (const [key, member] of Object.entries(value)) {
    if (RAW_PAYLOAD_FIELDS.has(key.replace(/[-_ ]/g, "").toLowerCase())) diagnostics.push(issue("RAW_PERSONAL_PAYLOAD_REFUSED", "error", `${location}.${key}`, "Canonical nutrition records may not retain raw photos, receipt images, audio, embeddings, or wearable payloads.", { recordPath, field: key }));
    rejectRawPayload(member, `${location}.${key}`, recordPath, diagnostics);
  }
}

function requireId(value, path, code, diagnostics) { if (!nonEmpty(value)) diagnostics.push(issue(code, "error", path, "Identifier must be a non-empty string.")); }
function nonEmpty(value) { return typeof value === "string" && value.length > 0; }
const isPlainObject = isObjectRecord;
function isRelativePosixPath(value) { return nonEmpty(value) && !value.startsWith("/") && !value.includes("\\") && value.split("/").every((part) => part !== "" && part !== "." && part !== ".."); }
function issue(code, severity, path, message, detail = {}) { return { code, severity, path, message, ...detail }; }
function result(diagnostics) { const ordered = diagnostics.sort((a, b) => `${a.path}\u0000${a.code}`.localeCompare(`${b.path}\u0000${b.code}`)); return Object.freeze({ conformant: ordered.every((item) => item.severity !== "error"), diagnostics: Object.freeze(ordered.map(Object.freeze)) }); }

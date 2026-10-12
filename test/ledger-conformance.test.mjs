import test from "node:test";
import assert from "node:assert/strict";
import { RECORD_TYPES, SCHEMA_IDS, validateNutritionLedger } from "../scripts/nutrition-practice-computer.mjs";

const source = { id: "synthetic-reference-table", release: "2026-08-19" };
const mediaRetention = {
  containsRawPhoto: false,
  containsReceiptImage: false,
  containsRawAudio: false,
  containsAppearanceEmbedding: false,
  containsRawWearablePayload: false,
};
const snapshot = {
  recordType: RECORD_TYPES.foodAssertionSnapshot,
  schemaVersion: "1.0.0",
  assertionId: "food-snapshot-apple-001",
  source,
  nutrientAssertions: [
    { id: "nutrient-energy-001", nutrientId: "energy", quantity: { value: "52", unit: "kcal", basis: "100 g" }, source },
    { id: "nutrient-fibre-001", nutrientId: "fibre", quantity: { value: "2.4", unit: "g", basis: "100 g" }, source },
  ],
  mediaRetention,
};
const candidate = {
  recordType: RECORD_TYPES.intakeCandidate,
  schemaVersion: "1.0.0",
  candidateId: "candidate-apple-001",
  origin: { kind: "image" },
  foodCandidates: [{ label: "synthetic apple" }],
  mediaRetention,
};
const event = {
  recordType: RECORD_TYPES.intakeEvent,
  schemaVersion: "1.0.0",
  eventId: "intake-001",
  affirmation: { kind: "human-affirmed", affirmedBy: "practitioner" },
  candidateReference: candidate.candidateId,
  amount: { value: "182", unit: "g", basis: "consumed mass" },
  foodAssertionSnapshot: {
    path: "state/food-snapshot.json", assertionId: snapshot.assertionId, source,
    nutrientAssertionReferences: [
      { id: "nutrient-energy-001", nutrientId: "energy", source },
      { id: "nutrient-fibre-001", nutrientId: "fibre", source },
    ],
  },
  mediaRetention,
};
function validator(overrides = {}) {
  const calls = [];
  return { calls, port: { validate(request) { calls.push(request); return { valid: true }; }, ...overrides } };
}
function ledger(overrides = {}) { const schema = validator(); return { records: [
  { path: "candidates/candidate.json", type: RECORD_TYPES.intakeCandidate, value: candidate },
  { path: "state/food-snapshot.json", type: RECORD_TYPES.foodAssertionSnapshot, value: snapshot },
  { path: "state/intake-event.json", type: RECORD_TYPES.intakeEvent, value: event },
], schemaValidator: schema.port, schemaCorpus: "opaque-science-corpus", ...overrides }; }

test("accepts a human-affirmed synthetic intake with exact nutrient versions", () => {
  const outcome = validateNutritionLedger(ledger());
  assert.equal(outcome.conformant, true);
  assert.deepEqual(outcome.diagnostics, []);
});

test("calls the schema port once per value with exact science URNs and the supplied corpus", () => {
  const schema = validator();
  const input = ledger({ schemaValidator: schema.port, schemaCorpus: "exact-corpus-capability" });
  assert.equal(validateNutritionLedger(input).conformant, true);
  assert.deepEqual(schema.calls, input.records.map((record) => ({ schemaId: SCHEMA_IDS[record.type], instance: record.value, schemaCorpus: "exact-corpus-capability" })));
});

test("refuses validation when the schema-validator port is absent", () => {
  const { schemaValidator: _schemaValidator, ...input } = ledger();
  const outcome = validateNutritionLedger(input);
  assert.equal(outcome.conformant, false);
  assert.match(codes(outcome), /SCHEMA_VALIDATOR_PORT_REQUIRED/);
});

test("surfaces schema failure through deterministic application diagnostics", () => {
  const schema = validator({ validate() { return { valid: false, diagnostics: [{ keyword: "const" }] }; } });
  const outcome = validateNutritionLedger(ledger({ schemaValidator: schema.port }));
  assert.equal(outcome.diagnostics.filter((item) => item.code === "SCHEMA_INVALID").length, 3);
});

test("refuses a candidate presented as an intake without human affirmation", () => {
  const records = ledger().records;
  records[2] = { ...records[2], value: { ...event, affirmation: { kind: "candidate" } } };
  assert.match(codes(validateNutritionLedger(ledger({ records }))), /HUMAN_AFFIRMATION_REQUIRED/);
});

test("refuses historical source-release drift and unpinned nutrient assertions", () => {
  const records = ledger().records;
  records[2] = { ...records[2], value: { ...event, foodAssertionSnapshot: { ...event.foodAssertionSnapshot, source: { ...source, release: "later-release" }, nutrientAssertionReferences: [{ id: "nutrient-energy-001", nutrientId: "energy", source: { ...source, release: "later-release" } }] } } };
  const outcome = validateNutritionLedger(ledger({ records }));
  assert.match(codes(outcome), /SNAPSHOT_SOURCE_VERSION_MISMATCH/);
  assert.match(codes(outcome), /SELECTED_NUTRIENT_ASSERTION_VERSION_MISMATCH/);
});

test("refuses two records that ambiguously claim the same historical intake event", () => {
  const records = ledger().records;
  records.push({ path: "state/intake-event-duplicate.json", type: RECORD_TYPES.intakeEvent, value: { ...event } });
  assert.match(codes(validateNutritionLedger(ledger({ records }))), /INTAKE_EVENT_ID_DUPLICATE/);
});

test("refuses numbers without decimal strings and declaration of unit and basis", () => {
  const records = ledger().records;
  records[2] = { ...records[2], value: { ...event, amount: { value: 182, unit: "g" } } };
  assert.match(codes(validateNutritionLedger(ledger({ records }))), /DECIMAL_QUANTITY_INVALID/);
});

test("refuses canonical raw image, receipt, audio, embedding, and wearable fields", () => {
  const records = ledger().records;
  records[0] = { ...records[0], value: { ...candidate, rawPhoto: "bytes", receiptImage: "bytes", rawAudio: "bytes", appearanceEmbedding: [0], rawWearablePayload: {} } };
  const outcome = validateNutritionLedger(ledger({ records }));
  assert.equal(outcome.diagnostics.filter((item) => item.code === "RAW_PERSONAL_PAYLOAD_REFUSED").length, 5);
});

test("returns deterministically ordered structured diagnostics", () => {
  const records = ledger().records;
  records[2] = { ...records[2], value: { ...event, affirmation: { kind: "candidate" }, amount: { value: "1e2", unit: "g", basis: "x" } } };
  const first = validateNutritionLedger(ledger({ records }));
  const second = validateNutritionLedger(ledger({ records }));
  assert.deepEqual(first, second);
  assert.deepEqual(first.diagnostics.map(({ code, path }) => [code, path]), [...first.diagnostics].sort((a, b) => `${a.path}\u0000${a.code}`.localeCompare(`${b.path}\u0000${b.code}`)).map(({ code, path }) => [code, path]));
});

function codes(outcome) { return outcome.diagnostics.map((item) => item.code).join(" "); }

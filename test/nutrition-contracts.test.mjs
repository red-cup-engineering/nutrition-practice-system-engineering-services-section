import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { admitSchema } from "@red-cup-engineering/json-schema-services-section/admit-schema";
import { inspectSchemaCorpus } from "@red-cup-engineering/json-schema-services-section/inspect-schema-corpus";
import { validateSchemaInstance } from "@red-cup-engineering/json-schema-services-section/validate-schema-instance";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const schemas = await Promise.all([readJson("lib/schemas/nutrition-intake-candidate-v1.schema.json"), readJson("lib/schemas/nutrition-food-assertion-snapshot-v1.schema.json"), readJson("lib/schemas/nutrition-intake-event-v1.schema.json"), readJson("lib/schemas/nutrition-biometric-observation-v1.schema.json"), readJson("../../../../lib/schemas/biometric-observation-v1.schema.json")]);
const byId = new Map(schemas.map((schema) => [schema.$id, schema]));
const validate = (value, id) => validateSchemaInstance({ instance: value, schema: byId.get(id), schemas });
const retention = { containsRawPhoto: false, containsReceiptImage: false, containsRawAudio: false, containsAppearanceEmbedding: false, containsRawWearablePayload: false };
const source = { id: "synthetic-reference-table", release: "2026-08-19" };
const candidate = { recordType: "nutrition-intake-candidate", schemaVersion: "1.0.0", candidateId: "candidate-apple-001", origin: { kind: "image" }, foodCandidates: [{ label: "synthetic apple" }], mediaRetention: retention };
const snapshot = { recordType: "nutrition-food-assertion-snapshot", schemaVersion: "1.0.0", assertionId: "food-snapshot-apple-001", source, nutrientAssertions: [{ id: "nutrient-energy-001", nutrientId: "energy", quantity: { value: "52", unit: "kcal", basis: "100 g" }, source }], mediaRetention: retention };
const event = { recordType: "nutrition-intake-event", schemaVersion: "1.0.0", eventId: "intake-001", candidateReference: candidate.candidateId, affirmation: { kind: "human-affirmed", affirmedBy: "synthetic-practitioner" }, amount: { value: "182", unit: "g", basis: "consumed mass" }, foodAssertionSnapshot: { path: "state/synthetic-snapshot.json", assertionId: snapshot.assertionId, source, nutrientAssertionReferences: [{ id: "nutrient-energy-001", nutrientId: "energy", source }] }, mediaRetention: retention };
const observation = { recordType: "nutrition-biometric-observation", schemaVersion: "1.0.0", observationId: "observation-rhr-001", metric: "resting-heart-rate", measuredAt: "2026-08-19T07:15:00Z", source: { kind: "device", deviceId: "synthetic-wearable-001", deviceModel: "synthetic-band-3" }, measurement: { value: "58", unit: "{beats}/min", precision: "1" }, missingness: { status: "observed" }, consentScope: { kind: "self-only" }, mediaRetention: retention };

test("schema corpus is admitted by the canonical Draft 2020-12 service", () => {
  for (const schema of schemas) assert.doesNotThrow(() => admitSchema({ schema }));
  assert.deepEqual(inspectSchemaCorpus({ schemas }), { ok: true, checked: schemas.length, errors: [] });
});

test("accepts synthetic candidate, source-pinned assertion snapshot, human-affirmed intake event, and device-sourced biometric observation", () => {
  assert.equal(validate(candidate, schemas[0].$id).ok, true);
  assert.equal(validate(snapshot, schemas[1].$id).ok, true);
  assert.equal(validate(event, schemas[2].$id).ok, true);
  assert.equal(validate(observation, schemas[3].$id).ok, true);
});

test("file-backed synthetic exchange fixtures satisfy their versioned schemas", async () => {
  assert.equal(validate(await readJson("test/nutrition-contract-fixtures/positive/intake-candidate.json"), schemas[0].$id).ok, true);
  assert.equal(validate(await readJson("test/nutrition-contract-fixtures/positive/food-assertion-snapshot.json"), schemas[1].$id).ok, true);
  assert.equal(validate(await readJson("test/nutrition-contract-fixtures/positive/intake-event.json"), schemas[2].$id).ok, true);
  assert.equal(validate(await readJson("test/nutrition-contract-fixtures/positive/biometric-observation.json"), schemas[3].$id).ok, true);
});

test("accepts an explicitly missing biometric observation without a fabricated measurement", () => {
  const { measurement, ...missing } = observation;
  assert.equal(validate({ ...missing, missingness: { status: "missing", reason: "synthetic-device-not-worn" } }, schemas[3].$id).ok, true);
});

test("refuses a biometric observation without measuredAt or enteredAt, without consentScope, or with a fabricated measurement on a missing reading", () => {
  const { measuredAt, ...noTimestamp } = observation;
  assert.equal(validate(noTimestamp, schemas[3].$id).ok, false);
  const { consentScope, ...noConsent } = observation;
  assert.equal(validate(noConsent, schemas[3].$id).ok, false);
  assert.equal(validate({ ...observation, missingness: { status: "missing" } }, schemas[3].$id).ok, false);
  assert.equal(validate({ ...observation, metric: "Resting Heart Rate" }, schemas[3].$id).ok, false);
});

test("refuses non-human intake, decimal-number quantities, and missing source release", () => {
  assert.equal(validate({ ...event, affirmation: { kind: "candidate", affirmedBy: "synthetic-practitioner" } }, schemas[2].$id).ok, false);
  assert.equal(validate({ ...event, amount: { value: 182, unit: "g", basis: "consumed mass" } }, schemas[2].$id).ok, false);
  assert.equal(validate({ ...snapshot, source: { id: source.id } }, schemas[1].$id).ok, false);
});

test("refuses retained raw photo, receipt image, audio, embedding, and wearable payload declarations", () => {
  for (const key of Object.keys(retention)) assert.equal(validate({ ...candidate, mediaRetention: { ...retention, [key]: true } }, schemas[0].$id).ok, false, key);
  assert.equal(validate({ ...candidate, photo: "raw bytes" }, schemas[0].$id).ok, false);
});

// routes/apiV1OpenApi.js
//
// Hand-curated OpenAPI 3.1 document for /api/v1. Auto-served at
// /api/v1/openapi.json. Importable by Postman / Insomnia /
// Hoppscotch / openapi-generator / etc.
//
// Kept hand-curated rather than auto-generated from Mongoose schemas
// because the REST surface is intentionally narrower than the schemas
// — Mongoose models leak fields like _id, __v, internal nested shapes,
// and Slice-1 trims those at the boundary.

const SECURITY = [{ BearerAuth: ["read", "write"] }];

function _basicCRUD(tag, item, idParam = "id") {
  const ItemSchema = { $ref: `#/components/schemas/${item}` };
  const ListResp = {
    type: "object",
    properties: {
      [item.toLowerCase() + "s"]: { type: "array", items: ItemSchema },
      nextCursor: { type: "string", nullable: true },
      total: { type: "integer" },
    },
  };
  const created = { type: "object", properties: { [item.toLowerCase()]: ItemSchema } };
  return {
    [`/${item.toLowerCase()}s`]: {
      get: {
        tags: [tag], summary: `List ${item.toLowerCase()}s`,
        parameters: [
          { name: "gridId", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 500 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" }, description: "Substring search on label/name" },
        ],
        security: SECURITY,
        responses: { 200: { description: "OK", content: { "application/json": { schema: ListResp } } } },
      },
      post: {
        tags: [tag], summary: `Create ${item.toLowerCase()}`,
        security: SECURITY,
        requestBody: { required: true, content: { "application/json": { schema: ItemSchema } } },
        responses: { 201: { description: "Created", content: { "application/json": { schema: created } } } },
      },
    },
    [`/${item.toLowerCase()}s/{${idParam}}`]: {
      patch: {
        tags: [tag], summary: `Update ${item.toLowerCase()}`,
        security: SECURITY,
        parameters: [{ name: idParam, in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        responses: { 200: { description: "OK", content: { "application/json": { schema: created } } } },
      },
      delete: {
        tags: [tag], summary: `Delete ${item.toLowerCase()}`,
        security: SECURITY,
        parameters: [{ name: idParam, in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } },
      },
    },
  };
}

export function buildOpenApiDoc() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Moduli API",
      version: "1.0.0",
      description: "REST surface for Moduli. See docs/api-plan.md for the spec and docs/api-testing.md for a tutorial.",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "moduli_<tokenId>_<secret>",
          description: "Per-user API token minted via server/scripts/createApiToken.js. Scopes are checked per-route.",
        },
      },
      schemas: {
        Grid: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, createdAt: { type: "string", format: "date-time" } } },
        Module: { type: "object", properties: {
          id: { type: "string" }, gridId: { type: "string" }, label: { type: "string" },
          role: { type: "string", enum: ["panel", "container", "instance", "page", "artifact", "textblock"] },
          kind: { type: "string" }, fieldBindings: { type: "array" },
        }, required: ["gridId"] },
        Occurrence: { type: "object", properties: {
          id: { type: "string" }, gridId: { type: "string" }, moduleId: { type: "string" },
          parentId: { type: "string", nullable: true },
          fields: { type: "object", additionalProperties: { type: "object", properties: { value: {}, flow: { type: "string" } } } },
          occurrences: { type: "array", items: { type: "string" } },
          meta: { type: "object" },
        }, required: ["gridId", "moduleId"] },
        Field: { type: "object", properties: {
          id: { type: "string" }, gridId: { type: "string" }, name: { type: "string" },
          type: { type: "string", enum: ["number", "text", "boolean", "select", "date", "duration", "rating", "occurrence"] },
          unit: { type: "string" }, meta: { type: "object" },
        }, required: ["gridId", "name"] },
        Operation: { type: "object", properties: {
          id: { type: "string" }, gridId: { type: "string" }, name: { type: "string" },
          enabled: { type: "boolean" }, triggerType: { type: "string" },
          triggerTypes: { type: "array", items: { type: "string" } },
          priority: { type: "integer" },
          pipeline: { type: "object", properties: { sources: { type: "array" }, steps: { type: "array" } } },
        }, required: ["gridId", "name"] },
        Error: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
      },
    },
    paths: {
      "/grids": {
        get: {
          tags: ["Grids"], summary: "List grids", security: SECURITY,
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { grids: { type: "array", items: { $ref: "#/components/schemas/Grid" } } } } } } } },
        },
      },
      "/grids/{id}/state": {
        get: {
          tags: ["Grids"], summary: "Full grid state snapshot",
          security: SECURITY,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "OK" }, 404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
        },
      },
      ..._basicCRUD("Modules", "Module"),
      ..._basicCRUD("Occurrences", "Occurrence"),
      ..._basicCRUD("Fields", "Field"),
      ..._basicCRUD("Operations", "Operation"),
      "/occurrences/{id}/fields/{fieldId}": {
        put: {
          tags: ["Occurrences"], summary: "Write a single field value on an occurrence",
          security: SECURITY,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "fieldId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { value: {}, flow: { type: "string" } } } } } },
          responses: { 200: { description: "OK" } },
        },
      },
      "/occurrences/{id}/fields": {
        patch: {
          tags: ["Occurrences"], summary: "Bulk write multiple fields on one occurrence",
          security: SECURITY,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object",
            properties: { fields: { type: "object", additionalProperties: { type: "object", properties: { value: {}, flow: { type: "string" } } } } },
          } } } },
          responses: { 200: { description: "OK" } },
        },
      },
      "/fields/bulk": {
        post: {
          tags: ["Fields"], summary: "Bulk write field values across many occurrences",
          security: SECURITY,
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object",
            properties: { writes: { type: "array", items: { type: "object", required: ["occurrenceId", "fieldId"], properties: { occurrenceId: { type: "string" }, fieldId: { type: "string" }, value: {}, flow: { type: "string" } } } } },
          } } } },
          responses: { 200: { description: "OK" } },
        },
      },
      "/operations/{id}/run": {
        post: {
          tags: ["Operations"], summary: "Invoke an operation synchronously",
          description: "Server-side executor handles CALL_API / INIT_VAR / SHOW_VALUE / IF / LOOP. More complex ops require a connected client (executor:'client' or 'auto').",
          security: SECURITY,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: false, content: { "application/json": { schema: {
            type: "object",
            properties: {
              vars: { type: "object", additionalProperties: true, description: "Pipeline vars; both '$foo' and 'foo' key forms accepted." },
              wait: { type: "boolean", default: true },
              timeoutMs: { type: "integer", default: 30000, maximum: 60000 },
              dryRun: { type: "boolean", default: false },
              executor: { type: "string", enum: ["auto", "server", "client"], default: "auto" },
            },
          } } } },
          responses: {
            200: { description: "OK" },
            202: { description: "Queued (wait:false)" },
            503: { description: "No executor available" },
            504: { description: "Timeout" },
          },
        },
      },
      "/batch": {
        post: {
          tags: ["Batch"], summary: "Pack multiple sub-requests into one round-trip",
          security: SECURITY,
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object",
            properties: { operations: { type: "array", items: { type: "object", required: ["method", "path"], properties: { method: { type: "string" }, path: { type: "string" }, body: { type: "object" } } } } },
          } } } },
          responses: { 200: { description: "OK" } },
        },
      },
      "/ingest": {
        post: {
          tags: ["Ingest"],
          summary: "Idempotent external-data intake (single record or batch)",
          description:
            "The endpoint external producers should call. Deduplicates on (source, externalId), "
            + "links the new occurrence into its parent's occurrences[] so it actually renders, "
            + "mirrors into the warm cache so it is visible on the next load, and find-or-mints the "
            + "type module by label. Writes server-side — unlike /api/webhooks/{operationId}, it does "
            + "NOT need a connected browser tab.",
          security: SECURITY,
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object",
            required: ["gridId", "source"],
            properties: {
              gridId: { type: "string" },
              source: { type: "string", description: "Producer name, e.g. \"raindrop\", \"plex\". Namespaces externalId." },
              externalId: { type: "string", description: "Single-record form. Unique within source." },
              records: {
                type: "array",
                description: "Batch form (max 200). Each record may override any body-level default.",
                items: {
                  type: "object",
                  required: ["externalId"],
                  properties: {
                    externalId: { type: "string" },
                    label: { type: "string" },
                    fields: { type: "object", description: "{ [fieldId]: { value, flow? } }" },
                    meta: { type: "object" },
                    index: { type: "integer", description: "Position within the parent's occurrences[]" },
                  },
                },
              },
              moduleId: { type: "string", description: "The type. Mutually exclusive with moduleLabel." },
              moduleLabel: { type: "string", description: "Find-or-mint the type module by label." },
              moduleRole: { type: "string", default: "instance" },
              moduleKind: { type: "string" },
              parentId: { type: "string", description: "Where rows land. Validated — an unknown id fails the record rather than creating an orphan." },
              onExisting: { type: "string", enum: ["skip", "update", "replace"], default: "skip" },
            },
          } } } },
          responses: {
            200: { description: "Per-record outcomes: { ok, source, summary: {created,updated,skipped,error}, results[] }" },
            400: { description: "Missing gridId/source, or batch over the 200-record cap" },
          },
        },
      },
      "/secrets": {
        get: { tags: ["Secrets"], summary: "List secret keys (values never returned)", security: SECURITY, responses: { 200: { description: "OK" } } },
        post: {
          tags: ["Secrets"], summary: "Create/update a secret",
          security: SECURITY,
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["key", "value"], properties: { key: { type: "string" }, value: { type: "string" } } } } } },
          responses: { 201: { description: "Created" }, 503: { description: "SECRETS_KEY not configured on server" } },
        },
      },
      "/secrets/{key}": {
        delete: { tags: ["Secrets"], summary: "Delete a secret", security: SECURITY, parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "OK" } } },
      },
    },
  };
}

/**
 * Pure migration helper for legacy field options shapes.
 * Converts meta.options and pool sourceType to the new meta.optionsSource schema.
 */

export function needsMigration(field) {
  if (field?.type !== "select") return false;
  if (field.meta?.optionsSource) return false;
  return true;
}

export function migrateFieldOptionsSource(field) {
  if (!needsMigration(field)) return field;

  const next = { ...field, meta: { ...field.meta } };

  const poolIds = Array.isArray(field.meta?.poolContainerIds)
    ? field.meta.poolContainerIds
    : field.meta?.poolContainerId
    ? [field.meta.poolContainerId]
    : null;

  if (field.meta?.sourceType === "pool" && poolIds?.length) {
    // Multiple pool container IDs: generate OR'd HAS_ANCESTOR rules
    // Each rule checks if _ancestors contains one of the pool IDs
    next.meta.optionsSource = {
      mode: "find",
      over: "$allInstances",
      predicate: {
        operator: "OR",
        rules: poolIds.map((containerId) => ({
          left: "_ancestors",
          comparator: "HAS_ANCESTOR",
          right: containerId,
        })),
      },
      valuePath: "id",
      labelPath: "label",
    };
  } else {
    // No pool or legacy meta.options: use manual mode
    next.meta.optionsSource = {
      mode: "manual",
      values: Array.isArray(field.meta?.options) ? field.meta.options : [],
    };
  }

  // Clean up legacy fields
  delete next.meta.options;
  delete next.meta.sourceType;
  delete next.meta.poolContainerId;
  delete next.meta.poolContainerIds;

  return next;
}

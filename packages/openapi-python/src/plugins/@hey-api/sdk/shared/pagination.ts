import type { Symbol } from '@hey-api/codegen-core';
import type { IR } from '@hey-api/shared';
import { operationPagination, operationResponsesMap } from '@hey-api/shared';

import type { HeyApiSdkPlugin } from '../types';

export type OperationPagination = {
  /** The response field reporting whether another page exists. */
  hasMore: string;
  /** The item type, so the page is typed as `Page[Item]`. */
  itemSymbol: Symbol;
  /** The response field holding the items of the page. */
  items: string;
  /** The response field holding the value that requests the next page. */
  nextCursor: string;
  /** The request parameter that carries that value back. */
  parameter: string;
};

/** Is the parameter that continues the list optional, so a first call needs no cursor? */
function isOptional({
  location,
  name,
  operation,
}: {
  location: keyof IR.ParametersObject;
  name: string;
  operation: IR.OperationObject;
}): boolean {
  const parameters = operation.parameters?.[location];
  for (const key in parameters) {
    if (parameters[key]!.name === name) {
      return !parameters[key]!.required;
    }
  }
  return false;
}

function property({
  field,
  plugin,
  schema,
}: {
  field: string;
  plugin: HeyApiSdkPlugin['Instance'];
  schema: IR.SchemaObject;
}): IR.SchemaObject | undefined {
  const resolved = schema.$ref ? plugin.context.resolveIrRef<IR.SchemaObject>(schema.$ref) : schema;
  return resolved.properties?.[field];
}

/**
 * How this operation pages, or nothing when it does not page in a way the
 * generator can express.
 *
 * The request parameter comes from the parser, which already marks a
 * pagination parameter. The response side is named in the plugin config,
 * since nothing in the spec identifies which field holds the items.
 */
export function operationPaginationInfo({
  operation,
  plugin,
}: {
  operation: IR.OperationObject;
  plugin: HeyApiSdkPlugin['Instance'];
}): OperationPagination | undefined {
  const config = plugin.config.pagination;
  if (!config) return;

  const pagination = operationPagination({ context: plugin.context, operation });
  if (!pagination || pagination.in === 'body') return;
  const location: keyof IR.ParametersObject = pagination.in;

  // A required continuation parameter would leave the method without a default
  // for it, so the first page could not be asked for.
  if (!isOptional({ location, name: pagination.name, operation })) return;

  const { response } = operationResponsesMap(operation);
  if (!response) return;

  const items = property({ field: config.items, plugin, schema: response });
  if (items?.type !== 'array') return;

  const item = items.items?.[0];
  if (!item?.$ref) return;

  // Reading a field the model does not declare would raise at the call, so an
  // operation missing either field pages the way it did before.
  for (const field of [config.hasMore, config.nextCursor]) {
    if (!property({ field, plugin, schema: response })) return;
  }

  return {
    hasMore: config.hasMore,
    itemSymbol: plugin.referenceSymbol({ category: 'schema', resourceId: item.$ref }),
    items: config.items,
    nextCursor: config.nextCursor,
    parameter: pagination.name,
  };
}

import { create, fromJson, toJson, type DescField, type DescMessage, type DescOneof, type Message } from "@bufbuild/protobuf";
import { ScalarType } from "@bufbuild/protobuf";

export function messageJsonSchema(message: DescMessage, title: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of message.fields) {
    properties[fieldJsonName(field)] = fieldJsonSchema(field);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title,
    type: "object",
    properties,
    additionalProperties: false,
  };
}

export function protobufMessageToProtoJson(value: unknown, message: DescMessage): unknown {
  const typed: Message = isMessage(value) ? value : messageFromRuntimeValue(message, value);
  return toJson(message, typed);
}

/**
 * Returns a view of a decoded request that also answers to the field names its
 * .proto declares.
 *
 * protobuf-es names a field's property after its localName, so `project_id`
 * arrives as `projectId`. OctoBus advertises the declared names in the MCP tool
 * schema, and service packages are written against the .proto they ship, so a
 * handler reading `req.project_id` got undefined. The wire carries field numbers,
 * not names, so every transport is affected alike.
 *
 * The view is a Proxy, and the message itself is never modified. A property the
 * message already has always wins, so an alias can never hide a field, a oneof
 * group, or anything inherited from Object.prototype; only a name the message
 * does not resolve is looked up in the descriptor. Nested messages, including the
 * elements of repeated and map fields, are wrapped when they are read, so the cost
 * follows what the handler reads rather than the size of the body. Aliases are not
 * own properties: they stay out of Object.keys, JSON.stringify and spreads, and
 * serialization is unchanged because protobuf-es reads the fields by localName.
 */
export function withProtoNameAliases<T>(value: T, schema: DescMessage): T {
  if (!isMessage(value) || VIEWS.has(value)) {
    return value;
  }
  const plan = aliasPlan(schema);
  if (plan.aliases.size === 0 && plan.nested.size === 0 && plan.groups.size === 0) {
    return value;
  }
  return cachedView(value, () => messageView(value, plan)) as T;
}

/**
 * Builds a handler-facing request from JSON, with the same aliases as one decoded
 * from the wire, so a handler reads the same names under the CLI and the daemon.
 */
export function decodeRequestJson(value: unknown, schema: DescMessage): Message {
  return withProtoNameAliases(fromJson(schema, value as never), schema);
}

interface AliasPlan {
  /** Declared name or json_name -> field, for names protobuf-es does not use. */
  readonly aliases: ReadonlyMap<string, DescField>;
  /** localName -> field, for fields whose value can hold a message. */
  readonly nested: ReadonlyMap<string, DescField>;
  /** oneof localName -> oneof, for groups with a message member. */
  readonly groups: ReadonlyMap<string, DescOneof>;
}

const PLANS = new WeakMap<DescMessage, AliasPlan>();
/** Target object -> its view, so a value keeps its identity across reads. */
const VIEW_OF = new WeakMap<object, object>();
const VIEWS = new WeakSet<object>();

function aliasPlan(schema: DescMessage): AliasPlan {
  const cached = PLANS.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  // Names the message answers to itself. A message field that is unset is not an
  // own property, so the view's own-property check alone would let another field's
  // json_name stand in for it; these are excluded up front instead.
  const taken = new Set<string>(["$typeName", "$unknown"]);
  for (const field of schema.fields) {
    taken.add(field.localName);
  }
  for (const oneof of schema.oneofs) {
    taken.add(oneof.localName);
  }
  // protoc only keeps computed json names unique, so one field's json_name can be
  // another's declared name. Such a name is left unresolved rather than answered
  // with whichever field was declared last.
  const claims = new Map<string, DescField[]>();
  for (const field of schema.fields) {
    for (const name of new Set([field.name, field.jsonName])) {
      if (!taken.has(name) && !(name in Object.prototype)) {
        claims.set(name, [...(claims.get(name) ?? []), field]);
      }
    }
  }
  const aliases = new Map<string, DescField>();
  for (const [name, fields] of claims) {
    if (fields.length === 1) {
      aliases.set(name, fields[0]!);
    }
  }
  const nested = new Map<string, DescField>();
  const groups = new Map<string, DescOneof>();
  for (const field of schema.fields) {
    if (fieldMessage(field) === undefined) {
      continue;
    }
    if (field.oneof === undefined) {
      nested.set(field.localName, field);
    } else {
      groups.set(field.oneof.localName, field.oneof);
    }
  }
  const plan: AliasPlan = { aliases, nested, groups };
  PLANS.set(schema, plan);
  return plan;
}

function messageView(message: object, plan: AliasPlan): object {
  return new Proxy(message, {
    get(target, prop) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop);
      }
      const alias = Reflect.has(target, prop) ? undefined : plan.aliases.get(prop);
      if (alias !== undefined) {
        return viewOfField(readField(target, alias), alias);
      }
      const value = Reflect.get(target, prop);
      const field = plan.nested.get(prop);
      if (field !== undefined) {
        return viewOfField(value, field);
      }
      const oneof = plan.groups.get(prop);
      return oneof !== undefined ? groupView(value, oneof) : value;
    },
    set(target, prop, next) {
      const alias = typeof prop === "string" && !Reflect.has(target, prop) ? plan.aliases.get(prop) : undefined;
      if (alias === undefined) {
        return Reflect.set(target, prop, next);
      }
      writeField(target, alias, next);
      return true;
    },
    has(target, prop) {
      return Reflect.has(target, prop) || (typeof prop === "string" && plan.aliases.has(prop));
    },
  });
}

/** Wraps what a field holds: a message, or the elements of a list or map of them. */
function viewOfField(value: unknown, field: DescField): unknown {
  const nested = fieldMessage(field);
  if (nested === undefined || value === null || typeof value !== "object") {
    return value;
  }
  if (field.fieldKind === "list" || field.fieldKind === "map") {
    return cachedView(value, () => elementsView(value, nested));
  }
  return withProtoNameAliases(value, nested);
}

/** A list or map whose message elements are wrapped on read; writes reach the original. */
function elementsView(container: object, schema: DescMessage): object {
  return new Proxy(container, {
    get(target, prop) {
      return withProtoNameAliases(Reflect.get(target, prop), schema);
    },
  });
}

/** A oneof group whose message value is wrapped on read. */
function groupView(group: unknown, oneof: DescOneof): unknown {
  if (group === null || typeof group !== "object") {
    return group;
  }
  return cachedView(group, () => new Proxy(group, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop !== "value") {
        return value;
      }
      const member = oneof.fields.find((field) => field.localName === Reflect.get(target, "case"));
      return member === undefined ? value : viewOfField(value, member);
    },
  }));
}

function cachedView(target: object, build: () => object): object {
  let view = VIEW_OF.get(target);
  if (view === undefined) {
    view = build();
    VIEW_OF.set(target, view);
    VIEWS.add(view);
  }
  return view;
}

/** Reads a field's value, through its group when it is a oneof member. */
function readField(target: object, field: DescField): unknown {
  const message = target as Record<string, unknown>;
  if (field.oneof === undefined) {
    return message[field.localName];
  }
  const group = message[field.oneof.localName] as { case?: string; value?: unknown } | undefined;
  return group?.case === field.localName ? group.value : undefined;
}

function writeField(target: object, field: DescField, next: unknown): void {
  const message = target as Record<string, unknown>;
  if (field.oneof === undefined) {
    message[field.localName] = next;
    return;
  }
  const group = message[field.oneof.localName] as { case?: string } | undefined;
  if (next !== undefined) {
    message[field.oneof.localName] = { case: field.localName, value: next };
  } else if (group?.case === field.localName) {
    // Clearing a member that is not the current case must leave the group alone,
    // or it would drop the member the caller did send.
    message[field.oneof.localName] = { case: undefined };
  }
}

function fieldMessage(field: DescField): DescMessage | undefined {
  return (field as { message?: DescMessage }).message;
}

export function fieldJsonName(field: DescField): string {
  return field.jsonName;
}

export function normalizeTypeName(value: string | undefined): string {
  return value?.replace(/^\./, "") ?? "";
}

function fieldJsonSchema(field: DescField): Record<string, unknown> {
  if (field.fieldKind === "map") {
    return {
      type: "object",
      additionalProperties: mapValueJsonSchema(field),
    };
  }
  const schema = singleFieldJsonSchema(field);
  if (field.fieldKind === "list") {
    return { type: "array", items: schema };
  }
  return schema;
}

function mapValueJsonSchema(field: DescField): Record<string, unknown> {
  if (field.fieldKind !== "map") {
    return {};
  }
  switch (field.mapKind) {
    case "scalar":
      return scalarJsonSchema(field.scalar);
    case "enum":
      return { type: "string" };
    case "message":
      return wellKnownTypeJsonSchema(field.message.typeName) ?? { type: "object" };
  }
}

function singleFieldJsonSchema(field: DescField): Record<string, unknown> {
  switch (field.fieldKind) {
    case "scalar":
      return scalarJsonSchema(field.scalar);
    case "enum":
      return { type: "string" };
    case "message":
      return wellKnownTypeJsonSchema(field.message.typeName) ?? { type: "object" };
    case "list":
      switch (field.listKind) {
        case "scalar":
          return scalarJsonSchema(field.scalar);
        case "enum":
          return { type: "string" };
        case "message":
          return wellKnownTypeJsonSchema(field.message.typeName) ?? { type: "object" };
      }
    case "map":
      return mapValueJsonSchema(field);
  }
}

function scalarJsonSchema(type: ScalarType): Record<string, unknown> {
  switch (type) {
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return { type: "number" };
    case ScalarType.INT64:
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return { oneOf: [{ type: "integer" }, { type: "string" }] };
    case ScalarType.INT32:
    case ScalarType.UINT32:
    case ScalarType.FIXED32:
    case ScalarType.SFIXED32:
    case ScalarType.SINT32:
      return { type: "integer" };
    case ScalarType.BOOL:
      return { type: "boolean" };
    case ScalarType.STRING:
      return { type: "string" };
    case ScalarType.BYTES:
      return { type: "string", contentEncoding: "base64" };
  }
}

function wellKnownTypeJsonSchema(typeName: string | undefined): Record<string, unknown> | undefined {
  switch (normalizeTypeName(typeName)) {
    case "google.protobuf.Timestamp":
      return { type: "string", format: "date-time" };
    case "google.protobuf.Duration":
    case "google.protobuf.FieldMask":
      return { type: "string" };
    case "google.protobuf.DoubleValue":
    case "google.protobuf.FloatValue":
      return { type: "number" };
    case "google.protobuf.Int64Value":
    case "google.protobuf.UInt64Value":
      return { type: "string" };
    case "google.protobuf.Int32Value":
    case "google.protobuf.UInt32Value":
      return { type: "integer" };
    case "google.protobuf.BoolValue":
      return { type: "boolean" };
    case "google.protobuf.StringValue":
      return { type: "string" };
    case "google.protobuf.BytesValue":
      return { type: "string", contentEncoding: "base64" };
    case "google.protobuf.Value":
      return { description: "Arbitrary JSON value" };
    case "google.protobuf.Struct":
      return {
        type: "object",
        description: "Arbitrary JSON object",
        additionalProperties: true,
      };
    case "google.protobuf.ListValue":
      return {
        type: "array",
        description: "Arbitrary JSON array",
      };
    default:
      return undefined;
  }
}

function messageFromRuntimeValue(message: DescMessage, value: unknown): Message {
  if (!isPlainObject(value)) {
    return create(message);
  }
  try {
    return fromJson(message, value as never);
  } catch {
    return create(message, value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is Message {
  return value !== null
    && typeof value === "object"
    && "$typeName" in value
    && typeof (value as { $typeName?: unknown }).$typeName === "string";
}

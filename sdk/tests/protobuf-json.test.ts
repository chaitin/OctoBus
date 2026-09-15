import path from "node:path";
import { fileURLToPath } from "node:url";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { loadServicePackage } from "../src/proto-loader.js";
import { protobufMessageToProtoJson, withProtoNameAliases } from "../src/protobuf-json.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Reads a possibly-aliased property without fighting the descriptor types. */
function read(value: unknown, name: string): unknown {
  return (value as Record<string, unknown>)[name];
}

describe("protobufMessageToProtoJson", () => {
  it("prints well-known types, maps, repeated messages, bytes, enums, and custom json_name as ProtoJSON", () => {
    const type = requiredMessage("calculator.v1.JsonShapeResponse");

    expect(protobufMessageToProtoJson({
      createdAt: { seconds: 1_704_067_200, nanos: 123_000_000 },
      elapsed: { seconds: 5, nanos: 250_000_000 },
      mask: { paths: ["custom_field", "created_at"] },
      label: "ready",
      total: "9007199254740993",
      raw: Buffer.from("ok"),
      status: 1,
      tags: { source: "unit" },
      children: [{ childName: "first" }],
      childMap: { a: { childName: "mapped" } },
      customField: "custom",
    }, type)).toEqual({
      createdAt: "2024-01-01T00:00:00.123Z",
      elapsed: "5.250s",
      mask: "customField,createdAt",
      label: "ready",
      total: "9007199254740993",
      raw: "b2s=",
      status: "JSON_SHAPE_STATUS_READY",
      tags: { source: "unit" },
      children: [{ childName: "first" }],
      childMapAlias: { a: { childName: "mapped" } },
      customAlias: "custom",
    });
  });

  it("prints Value, Struct, and ListValue as plain JSON", () => {
    const type = requiredMessage("calculator.v1.ContractResponse");

    expect(protobufMessageToProtoJson({
      httpStatusCode: 200,
      httpResponse: {
        kind: {
          case: "structValue",
          value: {
            fields: {
              success: { kind: { case: "boolValue", value: true } },
              data: {
                kind: {
                  case: "structValue",
                  value: {
                    fields: {
                      total: { kind: { case: "numberValue", value: 1 } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      object: { state: "ready" },
      list: {
        values: [
          { kind: { case: "numberValue", value: 1 } },
          { kind: { case: "stringValue", value: "x" } },
        ],
      },
    }, type)).toEqual({
      httpStatusCode: 200,
      httpResponse: {
        success: true,
        data: { total: 1 },
      },
      object: { state: "ready" },
      list: [1, "x"],
    });
  });
});

function requiredMessage(typeName: string) {
  const message = loadServicePackage(fixturesDir).registry.getMessage(typeName);
  if (!message) {
    throw new Error(`missing fixture message ${typeName}`);
  }
  return message;
}

describe("withProtoNameAliases", () => {
  it("makes a field readable by the name its .proto declares, not only the camelCase property", () => {
    const type = requiredMessage("calculator.v1.JsonShapeRequest");
    const request = withProtoNameAliases(create(type, { requestId: "r-1" }), type);

    // The name a handler reads, because it is the name in the .proto and the name
    // OctoBus advertises in the tool schema.
    expect(read(request, "request_id")).toBe("r-1");
    // protobuf-es's own property keeps working.
    expect(read(request, "requestId")).toBe("r-1");
  });

  it("covers a declared json_name, which is a third name when it is set", () => {
    const type = requiredMessage("calculator.v1.JsonShapeResponse");
    const response = withProtoNameAliases(create(type, { customField: "custom" }), type);

    // `custom_field [json_name = "customAlias"]`: protobuf-es calls it
    // customField, the .proto calls it custom_field, the wire calls it customAlias.
    // Before aliasing, two of the three read as undefined.
    expect(read(response, "custom_field")).toBe("custom");
    expect(read(response, "customAlias")).toBe("custom");
    expect(read(response, "customField")).toBe("custom");
  });

  it("reaches a nested message through the proto-name alias", () => {
    const type = requiredMessage("calculator.v1.JsonShapeRequest");
    const request = withProtoNameAliases(
      create(type, { requestId: "r-1", nested: { childName: "child" } }),
      type,
    );

    expect(read(read(request, "nested"), "child_name")).toBe("child");
  });

  it("aliases the elements of repeated and map fields, and writes reach the original", () => {
    const type = requiredMessage("calculator.v1.JsonShapeResponse");
    const original = create(type, {
      children: [{ childName: "first" }],
      childMap: { a: { childName: "mapped" } },
    });
    const response = withProtoNameAliases(original, type) as Record<string, unknown>;

    const children = read(response, "children") as unknown[];
    const childMap = read(response, "child_map") as Record<string, unknown>;
    // A handler written against its .proto reads an element's fields by their declared
    // names too; stopping at the collection would reproduce the bug one level down.
    expect(read(children[0], "child_name")).toBe("first");
    expect(read(childMap.a, "child_name")).toBe("mapped");
    expect(children[0]).toBe(children[0]);
    expect(read(response, "children")).toBe(children);

    // The collection is a view of the message's own array, so a push is not lost.
    children.push(create(requiredMessage("calculator.v1.NestedShape"), { childName: "second" }));
    expect(original.children.map((child) => child.childName)).toEqual(["first", "second"]);
  });

  it("aliases a bytes field and an enum field like any other", () => {
    const type = requiredMessage("calculator.v1.JsonShapeResponse");
    const response = withProtoNameAliases(
      create(type, { rawPayload: new Uint8Array([1, 2]), reviewStatus: 1 }),
      type,
    ) as Record<string, unknown>;

    // Nothing about these representations is special to the alias: the value sits at
    // the field's own property like a string's does, so the declared name resolves and
    // serializes. They are here because a representation that is never exercised is a
    // representation an assumption can hide in.
    expect(read(response, "raw_payload")).toEqual(new Uint8Array([1, 2]));
    expect(read(response, "review_status")).toBe(1);
    const roundTripped = withProtoNameAliases(
      fromBinary(type, toBinary(type, response)),
      type,
    ) as Record<string, unknown>;
    expect(read(roundTripped, "raw_payload")).toEqual(new Uint8Array([1, 2]));
    expect(read(roundTripped, "review_status")).toBe(1);
  });

  it("defines nothing on the message, however large the body", () => {
    const type = requiredMessage("calculator.v1.JsonShapeResponse");
    const message = create(type, { children: Array.from({ length: 500 }, (_, i) => ({ childName: `c${i}` })) });
    const before = Object.getOwnPropertyNames(message);

    const view = withProtoNameAliases(message, type) as Record<string, unknown>;

    // Aliases resolve on read, so wrapping costs the same for 500 elements as for
    // none, and neither the message nor its elements gain properties.
    expect(Object.getOwnPropertyNames(message)).toEqual(before);
    expect(read((read(view, "children") as unknown[])[499], "child_name")).toBe("c499");
    expect(Object.getOwnPropertyNames(message.children[499])).not.toContain("child_name");
  });

  it("does not shadow a name the message already inherits", () => {
    const type = requiredMessage("calculator.v1.ProtoMemberNames");
    const message = withProtoNameAliases(
      create(type, { toString$: "t", valueOf$: "v" }),
      type,
    ) as Record<string, unknown>;

    // protobuf-es renames these local names to `toString$` and `valueOf$` to avoid
    // shadowing Object.prototype, and an alias must not put them back. A shadowed
    // toString is not cosmetic: stringifying the message — in a log, a test diff, or
    // an error message — would call the alias instead, and an object-valued field
    // would make that throw.
    expect(Object.getOwnPropertyDescriptor(message, "toString")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(message, "valueOf")).toBeUndefined();
    expect(String(message)).toBe("[object Object]");
    // The declared names still resolve, so the fields remain reachable.
    expect(read(message, "to_string")).toBe("t");
    expect(read(message, "value_of")).toBe("v");
    const roundTripped = fromBinary(type, toBinary(type, message)) as Record<string, unknown>;
    expect(roundTripped.toString$).toBe("t");
    expect(roundTripped.valueOf$).toBe("v");
  });

  it("keeps a proto3 optional field readable, writable and clearable through its alias", () => {
    const type = requiredMessage("calculator.v1.OptionalFields");
    const message = withProtoNameAliases(
      create(type, { maybeValue: "v", maybeNested: { childName: "c" } }),
      type,
    ) as Record<string, unknown>;

    // protobuf-es ignores the synthetic oneof protoc gives an `optional` field, so its
    // value sits at the field's own property and the alias reads it directly. Three
    // branches of the alias code assume that, and this message is the only place the
    // assumption is exercised: were it wrong, the alias would read a group that does
    // not exist — the original bug — and the write below would be dropped instead of
    // serialized, which is what the round trip is here to catch.
    expect(read(message, "maybe_value")).toBe("v");
    expect(read(read(message, "maybe_nested"), "child_name")).toBe("c");

    message.maybe_value = "w";
    const roundTripped = withProtoNameAliases(
      fromBinary(type, toBinary(type, message)),
      type,
    ) as Record<string, unknown>;
    expect(read(roundTripped, "maybe_value")).toBe("w");
    expect(read(read(roundTripped, "maybe_nested"), "child_name")).toBe("c");

    // Cleared the way it clears natively: protobuf-es reads an assignment of undefined
    // to an optional field as removing it.
    roundTripped.maybe_value = undefined;
    const cleared = withProtoNameAliases(
      fromBinary(type, toBinary(type, roundTripped)),
      type,
    ) as Record<string, unknown>;
    expect(read(cleared, "maybe_value")).toBeUndefined();
    expect(read(read(cleared, "maybe_nested"), "child_name")).toBe("c");
  });

  it("reads and writes a oneof member through its group", () => {
    const type = requiredMessage("calculator.v1.ChoiceRequest");
    const message = withProtoNameAliases(
      create(type, { selector: { case: "byName", value: "n" } }),
      type,
    ) as Record<string, unknown>;

    // protobuf-es keeps a oneof member's value in the group object, so an alias
    // that read the member's own name would answer undefined for a value the
    // request carries.
    expect(read(message, "by_name")).toBe("n");
    // A member that is not the case reads as unset rather than as the other one.
    expect(read(message, "by_id")).toBeUndefined();

    // A message member is read out of the group too, and what it carries is aliased
    // in turn, so a nested field is reachable by its own .proto name. A member that
    // is not the case reads as unset rather than as the other one.
    const nested = withProtoNameAliases(
      create(type, { selector: { case: "byNested", value: { childName: "c" } } }),
      type,
    ) as Record<string, unknown>;
    expect(read(read(nested, "by_nested"), "child_name")).toBe("c");
    expect(read(nested, "by_name")).toBeUndefined();

    message.by_name = "z";
    // Aliases belong to the message they were defined on, so the decoded copy is
    // aliased before reading it by the .proto name.
    const roundTripped = withProtoNameAliases(
      fromBinary(type, toBinary(type, message)),
      type,
    ) as Record<string, unknown>;
    expect(read(roundTripped, "by_name")).toBe("z");
    expect(read(roundTripped, "selector")).toEqual({ case: "byName", value: "z" });
  });

  it("treats an undefined assignment to a oneof member as clearing it", () => {
    const type = requiredMessage("calculator.v1.ChoiceRequest");
    const message = withProtoNameAliases(
      create(type, { selector: { case: "byName", value: "n" } }),
      type,
    ) as Record<string, unknown>;

    message.by_name = undefined;

    // A set case means present to protobuf-es, and its serialiser writes what the
    // case points at, so keeping the case would put a member the caller never sent on
    // the wire — as an explicit empty string for a scalar member. Its own convention
    // for clearing is a case of undefined.
    expect(read(message, "selector")).toEqual({ case: undefined });
    expect(read(message, "by_name")).toBeUndefined();
    expect(Buffer.from(toBinary(type, message)).length).toBe(0);
  });

  it("leaves the set member alone when another member is assigned undefined", () => {
    const type = requiredMessage("calculator.v1.ChoiceRequest");
    const message = withProtoNameAliases(
      create(type, { selector: { case: "byName", value: "n" } }),
      type,
    ) as Record<string, unknown>;

    // A handler that normalises every field, `req.by_id = req.by_id ?? undefined`,
    // must not drop the member the caller did send.
    message.by_id = undefined;

    expect(read(message, "by_name")).toBe("n");
    const roundTripped = fromBinary(type, toBinary(type, message)) as Record<string, unknown>;
    expect(read(roundTripped, "selector")).toEqual({ case: "byName", value: "n" });
  });

  it("aliases a message held in a oneof group read by the group's own name", () => {
    const type = requiredMessage("calculator.v1.ChoiceRequest");
    const message = withProtoNameAliases(
      create(type, { selector: { case: "byNested", value: { childName: "c" } } }),
      type,
    ) as Record<string, unknown>;

    const group = read(message, "selector") as { case: string; value: unknown };
    expect(group.case).toBe("byNested");
    expect(read(group.value, "child_name")).toBe("c");
  });

  it("aliases a message in a oneof when nothing else in the message needs a name", () => {
    const type = requiredMessage("calculator.v1.GroupOnly");
    const message = withProtoNameAliases(
      create(type, { body: { case: "shape", value: { childName: "c" } } }),
      type,
    ) as Record<string, unknown>;

    const group = read(message, "body") as { value: unknown };
    expect(read(group.value, "child_name")).toBe("c");
  });

  it("does not let a json_name stand in for a message field that is unset", () => {
    const type = requiredMessage("calculator.v1.UnsetMessageCollision");
    const message = withProtoNameAliases(create(type, { x: "x-val" }), type) as Record<string, unknown>;

    // An unset message field is not an own property, so only the plan keeps field x's
    // json_name from answering for it.
    expect(read(message, "nestedShape")).toBeUndefined();
    expect(read(message, "x")).toBe("x-val");
    const withShape = withProtoNameAliases(
      create(type, { x: "x-val", nestedShape: { childName: "c" } }),
      type,
    ) as Record<string, unknown>;
    expect(read(read(withShape, "nested_shape"), "child_name")).toBe("c");
  });
  it("does not alias a name a oneof group already uses", () => {
    const type = requiredMessage("calculator.v1.GroupNameCollision");
    const message = withProtoNameAliases(
      create(type, { selector: { case: "byName", value: "n" }, x: "x-val" }),
      type,
    ) as Record<string, unknown>;

    // The group property is where the oneof's value lives, so an alias named after it
    // would replace that value rather than add a name. Field x's json_name spells it,
    // and the alias is skipped — the group keeps the oneof.
    expect(read(message, "selector")).toEqual({ case: "byName", value: "n" });
    expect(read(message, "x")).toBe("x-val");
    const roundTripped = withProtoNameAliases(
      fromBinary(type, toBinary(type, message)),
      type,
    ) as Record<string, unknown>;
    expect(read(roundTripped, "selector")).toEqual({ case: "byName", value: "n" });
    expect(read(roundTripped, "x")).toBe("x-val");
  });

  it("leaves a name two fields both claim undefined", () => {
    const type = requiredMessage("calculator.v1.CollidingAlias");
    const message = withProtoNameAliases(
      create(type, { fooBar: "a", x: "b" }),
      type,
    ) as Record<string, unknown>;

    // `foo_bar` is field foo_bar's declared name and field x's declared json_name,
    // so both fields want it. Answering with the later declaration would return the
    // wrong field, so the shared name is left undefined instead.
    expect(read(message, "foo_bar")).toBeUndefined();
    // Each field is still reached by its own name, and nothing is lost on the wire.
    expect(read(message, "fooBar")).toBe("a");
    expect(read(message, "x")).toBe("b");
    const roundTripped = fromBinary(type, toBinary(type, message)) as Record<string, unknown>;
    expect(read(roundTripped, "fooBar")).toBe("a");
    expect(read(roundTripped, "x")).toBe("b");
  });

  it("never lets an alias replace another field's value", () => {
    const type = requiredMessage("calculator.v1.CollidingNames");
    const message = withProtoNameAliases(
      create(type, { x: "x-value", foo: "foo-value" }),
      type,
    ) as Record<string, unknown>;

    // Field `x` declares json_name "foo", which is field `foo`'s own property. The
    // alias is skipped rather than defined: had it been defined, `foo` would read
    // x's value, and toBinary — which reads msg["foo"] for field foo's number —
    // would put x's value on the wire under field foo.
    expect(message.foo).toBe("foo-value");
    expect(message.x).toBe("x-value");
    const roundTripped = fromBinary(type, toBinary(type, message)) as Record<string, unknown>;
    expect(roundTripped.foo).toBe("foo-value");
    expect(roundTripped.x).toBe("x-value");
  });

  it("does not add a field the request did not carry", () => {
    const type = requiredMessage("calculator.v1.JsonShapeResponse");
    const encoded = toBinary(type, create(type, { raw: new Uint8Array([1]) }));
    const response = withProtoNameAliases(fromBinary(type, encoded), type);

    // child_map carries an alias, so this read goes through one. protobuf-es hands
    // back an empty map for any read of an absent map field, whichever name is
    // used, and an empty map is not emitted — so the bytes must be untouched. Had
    // aliasing walked the descriptor instead of the values present, it would have
    // materialised every absent message field, and those are emitted.
    expect(read(response, "child_map")).toEqual({});
    expect(Buffer.from(toBinary(type, response))).toEqual(Buffer.from(encoded));
  });

  it("keeps aliases out of enumeration, JSON, and equality checks", () => {
    const type = requiredMessage("calculator.v1.JsonShapeRequest");
    const request = withProtoNameAliases(create(type, { requestId: "r-1" }), type);

    // An alias that showed up here would leak into logs, caches and any
    // JSON.stringify of a request.
    expect(Object.keys(request)).not.toContain("request_id");
    expect(JSON.stringify(request)).not.toContain("request_id");
  });

  it("writes through an alias, so a handler may normalise in place", () => {
    const type = requiredMessage("calculator.v1.JsonShapeRequest");
    const request = withProtoNameAliases(create(type, { requestId: "  r-1  " }), type);

    // Assigning to a getter with no setter throws in strict mode, which an ESM
    // service package always is.
    (request as Record<string, unknown>).request_id = "r-1";

    expect(read(request, "requestId")).toBe("r-1");
    const roundTripped = fromBinary(type, toBinary(type, request));
    expect(read(roundTripped, "requestId")).toBe("r-1");
  });

  it("resolves each name a field has without adding own properties", () => {
    const type = requiredMessage("calculator.v1.ContractRequest");
    const request = withProtoNameAliases(create(type, { bigCount: 7n, extraFields: { a: 1 }, count: 3 }), type);

    // big_count becomes bigCount; extra_fields declares json_name extraFields, the
    // name protobuf-es already uses; count is one word and has one name.
    expect(read(request, "big_count")).toBe(7n);
    expect(read(request, "extra_fields")).toEqual({ a: 1 });
    expect(read(request, "extraFields")).toEqual({ a: 1 });
    expect(read(request, "count")).toBe(3);
    expect("big_count" in (request as object)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(request, "big_count")).toBeUndefined();
  });

  it("is idempotent and leaves the message it wraps untouched", () => {
    const type = requiredMessage("calculator.v1.JsonShapeRequest");
    const request = create(type, { requestId: "r-1", nested: { childName: "child" } });
    const before = Object.keys(request);

    const aliased = withProtoNameAliases(request, type);

    // The message itself gains nothing; the aliases belong to the view.
    expect(read(request, "request_id")).toBeUndefined();
    expect(Object.keys(aliased)).toEqual(before);
    // Wrapping the view, or the message again, gives back the same view, and a nested
    // value keeps its identity across reads.
    expect(withProtoNameAliases(aliased, type)).toBe(aliased);
    expect(withProtoNameAliases(request, type)).toBe(aliased);
    expect(read(aliased, "nested")).toBe(read(aliased, "nested"));
  });

  it("returns a value that is not a message unchanged", () => {
    const type = requiredMessage("calculator.v1.JsonShapeRequest");
    const plain = { requestId: "r-1" };

    expect(withProtoNameAliases(plain, type)).toBe(plain);
    expect(read(plain, "request_id")).toBeUndefined();
  });
});

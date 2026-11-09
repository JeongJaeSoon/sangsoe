// The shape every file in tools/ and resources/ default-exports. cli/contract.ts mirrors
// Refusal and Outcome; test/boundaries/contract.test.ts fails if the two drift apart.

export type Refusal = {
  /** Stable snake_case id a caller can branch on, e.g. "decision_closed". */
  code: string;
  /** One sentence: why nothing was done. */
  reason: string;
  /** The call or command that would succeed instead. */
  fix: string;
};

export type Outcome<T = unknown> = { ok: true; value: T } | { ok: false; refusal: Refusal };

export type JsonSchema = {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  description?: string;
  enum?: readonly unknown[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
};

export type ToolDef = {
  /** Equals the file's base name: tools/decision_open.ts declares "decision_open". */
  name: string;
  /** One or two sentences; the model reads only this. */
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  handler(input: Record<string, unknown>): Outcome | Promise<Outcome>;
};

export type ResourceDef = {
  /** Equals the file's base name. */
  name: string;
  uri: string;
  description: string;
  mimeType: string;
  read(): string | Promise<string>;
};

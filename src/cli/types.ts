// Handed to every command; the command word is peeled off in src/cli.ts and each command
// parses its own argv via shared.ts's `parse`.
export interface Ctx {
  /** binary name, for usage strings */
  name: string;
  /** argv after the command word */
  rest: string[];
  /** print the message and exit 2 — every malformed-invocation path.
   * Readonly property (not method) syntax: TS only applies never-return control-flow analysis to readonly property-typed function members. */
  readonly usageError: (message: string) => never;
}

export type Command = (ctx: Ctx) => Promise<void> | void;

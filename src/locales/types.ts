import type { Strings } from "./en";

/** Recursive partial — lets scaffold locales translate only what they cover.
 *  Arrays are replaced wholesale (provide the full array or omit it). */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? U[]
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

export type LocaleDict = DeepPartial<Strings>;
export type { Strings };

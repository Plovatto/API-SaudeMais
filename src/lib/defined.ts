export type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

export function definedFields<T extends object>(input: T): Defined<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Defined<T>;
}

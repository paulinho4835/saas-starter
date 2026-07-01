// PostgREST treats `,` `.` `(` `)` as syntactically meaningful inside an
// .or() filter expression (predicate separator, path separator, and group
// delimiters respectively). Backslash-escape them before interpolating
// user-supplied search input so it can't inject additional filter clauses.
export function escapePostgrestFilterValue(value: string): string {
  return value.replace(/[,.()\\]/g, (c) => `\\${c}`);
}

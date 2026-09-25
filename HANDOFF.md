# CSM C88C SQL Visualizer Handoff

## Project Goal

Build an educational SQL logical execution visualizer for CSM C88C. The design principle is to explain what SQL does in logical order, not how a database optimizer physically executes a query.

## Supported SQL Subset

- `SELECT` columns, `SELECT *`, and aggregate expressions: `COUNT(*)`, `COUNT(column)`, `SUM`, `AVG`, `MIN`, `MAX`
- Arithmetic expressions with `+`, `-`, `*`, and `/`, including parentheses to control evaluation order
- Required `FROM table`, with optional `AS alias` or bare alias
- Optional single inner `JOIN table AS alias ON condition` with simple comparisons joined by `AND`, or comma join `FROM table_a, table_b` / `FROM table AS alias, table AS alias`
- Optional `WHERE` with simple comparisons joined by `AND`
- Optional `GROUP BY`
- Optional `HAVING`
- Aggregates can't be used in `WHERE`, explicit `JOIN ... ON`, or `GROUP BY` — `WHERE`/`ON` fail with a friendly error pointing to `HAVING` (e.g. "`<expr>` can't be used in WHERE because aggregates need groups. Use HAVING."), and `GROUP BY` fails asking you to group by a column instead ("`<expr>` can't be used in GROUP BY. Group by a column instead.")
- Optional `ORDER BY` with `ASC` or `DESC`, by column, by expression, by a SELECT alias, or by column position (`ORDER BY 1`)
- Optional `LIMIT`
- `IN`, `BETWEEN`, `LIKE`, `NOT` (outside `IS NOT NULL`), and `OFFSET` are each rejected by name with "`<KEYWORD>` is not supported in this visualizer."; `OR` is rejected the same way but with "OR is not supported in this visualizer. Combine comparisons with AND." instead
- Qualified and unqualified columns, single- or double-quoted string literals, number literals, null literals, `IS NULL` / `IS NOT NULL`, and comparison operators `=`, `!=`, `<>`, `>`, `<`, `>=`, `<=`
- Numeric comparisons for numeric values and lexicographic comparisons for non-numeric values, comparing by code unit like SQLite's default `BINARY` collation (uppercase sorts before lowercase); a comparison against `NULL` (other than `IS`/`IS NOT`) evaluates to false, matching SQL's three-valued logic
- SELECT aliases can be referenced from `GROUP BY`, `HAVING`, and `ORDER BY`
- Table names, column names, and aliases are matched case-insensitively
- Clause order is enforced (`SELECT FROM JOIN/ON WHERE GROUP BY HAVING ORDER BY LIMIT`); a clause repeated or out of order fails with a friendly error
- `MIN`/`MAX` follow SQLite's bare-column rule: when a group's other selected columns aren't aggregated, they come from the same row that produced the `MIN`/`MAX` value, not an arbitrary row
- Aggregates over zero rows or all-`NULL` input return `NULL` (`COUNT` returns `0`); `COUNT(column)` counts only non-`NULL` values
- Integer division truncates like SQLite (`7 / 2` is `3`; use `7 / 2.0` for `3.5`) and division by zero yields `NULL`. Unknown columns are reported before any row is read, so a typo fails even when no rows reach its clause. Without `ORDER BY`, groups appear in first-seen order, while sqlite3 happens to sort them by key. In `GROUP BY` and `HAVING` the engine resolves a SELECT alias before a same-named source column (SQLite prefers the column), which only matters when an alias shadows a different real column.

Aliases are optional for `FROM`; when omitted, the table name is used as the alias. Comma-joined tables can use implicit table-name aliases when unique. Aliases are required for explicit `JOIN`, but `AS` is optional. Explicit non-goals are full SQL compatibility, optimizer visualization, subqueries, CTEs, outer joins, `DISTINCT`, `UNION`, window functions, and nested joins.

## Architecture Overview

The app is a single page. There is no router: `src/App.tsx` owns all state (tables, table SQL, the query, the traced SQL, the current step index, the share modal) and wires it to the components. It renders a top app bar, the `QueryEditor`, the collapsible `TablesPanel`, and the trace section (`PinnedQuery`, `Timeline`, `StepPanel`). Share links still load through `?share=`: `App` reads `window.location.search` on mount via `readShareSnapshot`, and a shared link opens as a sandboxed copy that does not overwrite the viewer's saved workspace.

Reusable UI lives in `src/ui/` (`QueryEditor`, `TablesPanel`, `ShareModal`, `highlightSql`) and `src/ui/trace/` (`PinnedQuery`, `findClauseRange`, `Timeline`, `StepPanel`, `TableView`, `GroupCards`, `SourcesView`, `highlightSets`). `PinnedQuery` uses `findClauseRange` to locate and highlight the active step's clause text inside the full query string. `StepPanel` picks how to render Before/After per step kind (plain table, grouped cards, or the JOIN sources view) and `highlightSets` turns a step's `Highlight[]` into row/column/group id sets the table and card views can check quickly.

Parser responsibilities live in `src/domain/parser.ts`. The parser normalizes whitespace, rejects unsupported clauses early (including `OFFSET`, `OR`, `DISTINCT`, and others, each by name), enforces clause order and rejects a clause used twice, accepts `FROM table`, `FROM table alias`, or `FROM table AS alias`, accepts one comma-joined source in `FROM`, allows unique implicit aliases for comma joins, requires explicit aliases for explicit `JOIN` sources, accepts explicit `JOIN ... ON` comparisons chained with `AND`, parses `IS NULL` / `IS NOT NULL` and parenthesized arithmetic, and builds a `QueryAST` whose `clauses` field keeps each clause's raw (whitespace-normalized) source text for the pinned-query highlight. All string-literal-aware scanning goes through `src/domain/sqlText.ts` (see "Shared helpers" below).

Execution engine responsibilities live in `src/domain/engine.ts`. The engine evaluates the AST against in-memory tables in logical order and produces a flat list of `ExecutionStep`s (see "Logical Execution Order" below) with SQLite-flavored semantics: three-valued `NULL` comparisons, `COUNT(column)` counting non-`NULL` values, `NULL`/empty-input aggregates, the SQLite bare-column rule for `MIN`/`MAX`, `ORDER BY` by position or by a SELECT alias, and case-insensitive table/column/alias matching. It preserves stable row provenance through aliasing, joins, grouping, filtering, sorting, projection, and limiting, and each step carries a concrete `summary` sentence plus highlight metadata for the UI.

Starter data and starter query ownership live in `src/domain/samples.ts`. Keep starter tables small enough to inspect manually, but do not present them as a fixed sample-table viewer or require a demo-query dropdown. Users can define their own tables through Table SQL.

Table SQL helpers live in `src/domain/tableSql.ts`. They parse and serialize the small table-definition subset: `CREATE TABLE name (columns...)` and `INSERT INTO name VALUES (...)`, matching table names case-insensitively and rejecting duplicate tables or duplicate columns.

Share snapshot helpers live in `src/domain/shareSnapshot.ts`. Share links compress a versioned snapshot of `tableSql`, `sql`, and optional `stepIndex` into the `share` query parameter on the app's root URL (`/`). They intentionally avoid a backend slug store; shared links are immutable because the URL is the source of truth, and shared sessions do not overwrite the viewer's saved local workspace on load.

## Shared helpers

`src/domain/sqlText.ts` is the only place in the codebase that knows how to skip over string literals while scanning SQL text (masking quoted content, matching/splitting/replacing outside strings, splitting on top-level commas while respecting parentheses, and unquoting literals). The parser, `sqlFormatter.ts`, `tableSql.ts`, and the editor's `highlightSql.tsx` all build on it rather than re-implementing string-aware scanning, so quoting edge cases (escaped `''`, double-quoted strings, keywords or separators inside a string) only need to be handled once.

## Data Model Reference

- `Table`: named in-memory table with columns and row records.
- `Row`: plain record of SQL column values.
- `AliasedTable`: table plus alias metadata.
- `AliasedRow`: internal visual row with a stable `id`, qualified `values`, and optional `columns` (ordered result columns, set on projected rows so column order matches what was written).
- `JoinedRow`: alias of `AliasedRow` after join merging.
- `Group`: group bucket with `id`, `key`, member `rows`, and optional `conditions` (each tested HAVING condition's label, result, computed value, and left-expression label).
- `QueryAST`: parsed query object consumed by the engine; `clauses` (`QueryClauses`) holds each clause's raw, whitespace-normalized source text (keyword included) for the pinned-query highlight.
- `Condition`: binary comparison between expressions, or an `IS`/`IS NOT` null check.
- `Expression`: column, literal, wildcard, binary arithmetic, or aggregate expression.
- `ExecutionStep`: one logical execution step, with `summary` (a concrete sentence describing what happened), an optional `clause` (the raw text to highlight in the pinned query), optional `before` and required `after` (rows or groups), optional `sources` (JOIN/FROM source tables for the sources view), optional `details` (JOIN-only match lines, e.g. `"u1 ↔ l1, l2"`), `highlights` (`Highlight[]`), and optional `sortSummaries` (`ORDER BY` only).
- `Highlight`: `kind` of `'removed' | 'selected' | 'matched' | 'unmatched'` plus the `rowIds`, `columnKeys`, or `groupIds` it applies to.
- `SortSummary`: per-row before/after rank and the sort keys used, for the `ORDER BY` step's rank badges.

## Logical Execution Order

The engine produces a flat list of steps, one call to `steps.push(...)` per step (no separate "Result" step — the last step's After panel is the final result):

1. `FROM`: alias every source row. For comma joins, the step shows both source tables side by side (and the summary names both) before they are paired.
2. `JOIN`: pair left and right aliased rows that satisfy every `ON` condition, or pair every row for comma joins before `WHERE` filtering. One step total regardless of how many `ON` conditions there are.
3. `WHERE`: filter rows before grouping. Conditions chained with `AND` are visualized as one `WHERE` step per condition, each starting from the rows kept by the previous condition.
4. `GROUP BY`: create group buckets, or one implicit group when `GROUP BY` is absent but aggregates (in `SELECT`, `HAVING`, or `ORDER BY`) are present. Skipped entirely when the query has no `GROUP BY`, no `HAVING`, and no aggregates.
5. `HAVING`: filter groups after aggregate values are available, one step covering every `AND`-ed `HAVING` condition together (each condition's computed value and KEEP/REJECT verdict is shown per group).
6. `SELECT`: project requested columns, wildcard columns, and aggregate outputs. Ungrouped queries get one `SELECT` step. Grouped queries get one `selectGroup` step per surviving group (each shows that group collapsing into its one result row), or a single `SELECT` step saying the result is empty when no groups remain.
7. `ORDER BY`: sort the projected rows; the step records each row's before/after rank and the sort key values for badges.
8. `LIMIT`: keep the first `n` projected rows. Trimmed rows are highlighted as removed in the before view and dropped from the after view, matching `WHERE` behavior.

## Visual Conventions

- Green accent (not teal): primary actions, the active timeline step pill, alias badges, and selected columns.
- The pinned query (`PinnedQuery`) shows the full traced SQL with the active step's clause text highlighted inline.
- Before/After panels sit side by side (`StepPanel`'s `two-up` layout) whenever a step has a "before"; steps without one (e.g. `FROM`) show only the after/loaded-rows panel, and the last step's after panel is labeled "Final result".
- Red/faded rows: removed (`WHERE`, `LIMIT`) or unmatched (`JOIN`) rows are shown faded rather than deleted, so students can see what was dropped and why.
- Green selected columns: the column(s) a clause reads from are highlighted in the table header and cells.
- Purple badges: rank-change badges (`was #N`) after `ORDER BY` and off-table sort/join key badges use the purple secondary color; group card verdicts (`KEEP`/`REJECT`) use green/red.
- Alias badges: every row shows its stable alias-derived id (e.g. `u1`, `u1+l1`, left source then right) for visible row identity and provenance across joins.
- Self-joins: duplicate table instances are treated as distinct aliases with separate qualified columns.
- `TableView` renders every row when there are 12 or fewer; larger tables show the first 8 with a "Show all N rows" / "Show fewer rows" toggle.

## Known Limitations

- No full SQL engine.
- No optimizer visualization.
- No subqueries, CTEs, outer joins, `DISTINCT`, `UNION`, window functions, or nested joins.
- Parser is regex/token-assisted and intentionally scoped.
- Aggregate evaluation is designed for education on small in-memory table data.

## Test Strategy

`src/domain/sqlText.test.ts` covers the shared string-aware scanning helpers directly: masking string contents, matching/splitting/replacing outside strings, delimiters between adjacent literals, splitting top-level commas outside parentheses and strings, and unquoting/unescaping literals.

Parser tests (`parser.test.ts`) cover required query shapes, wildcard selects, implicit `FROM` aliases, aggregates, arithmetic (including around aggregates), comma and explicit joins, `IS NULL`/`IS NOT NULL`, double-quoted strings, doubled-quote unescaping, raw clause text capture, clause-order enforcement, missing join aliases, and unsupported clauses.

Engine tests (`engine.test.ts`) cover aliasing, joins (explicit and comma, including self joins), row filtering, numeric and string comparisons, grouping, `HAVING` (including the computed value shown per condition), wildcard and column-highlight projection, `MIN`/`MAX` over strings, `LIMIT` trimming and its highlight behavior, ordering grouped results by an aggregate before `LIMIT`, `ORDER BY` rank/sort-key summaries (positional keys labelled with the result column), SQLite-style integer division and division by zero, and up-front unknown-column errors even when no rows reach a clause.

Table SQL tests (`tableSql.test.ts`) cover `CREATE TABLE`/`INSERT INTO` parsing (including multi-row inserts and typed columns), serialization round trips, quote unescaping and double-quoted values, case-insensitive table-name matching, and friendly rejection of unsupported statements, duplicate tables, and duplicate columns.

`sqlFormatter.test.ts` covers formatting a `SELECT` query and table-definition statements into style-guide blocks, and preserving/ignoring keywords and separators inside string literals.

`src/domain/shareSnapshot.test.ts` covers compressed-payload round trips, rejection of malformed share payloads, and that `createShareUrl` builds links on the app's root path (`/`).

`src/ui/trace/TableView.test.tsx` covers rendering every row at 12 or fewer, the 8-row preview plus "Show all"/"Show fewer" toggle above that, column ordering and row/column highlighting, rank badges and off-table sort keys, and the empty-rows message.

`src/ui/trace/StepPanel.test.tsx` covers the side-by-side Before/After layout with faded removed rows for `WHERE`, the "Final result" label on the last step, the JOIN sources/key-columns/match-list view, group cards with HAVING verdicts and one card per `selectGroup` step, the "No groups remain." Before state of an empty grouped SELECT, selected-column highlights in the SELECT result, and `findClauseRange`'s whitespace/case tolerance. `src/ui/trace/Timeline.test.tsx` checks that changing step never scrolls the page (the timeline only scrolls its own pill row).

`src/ui/highlightSql.test.tsx` covers coloring keywords outside strings and marking string literals in the editor's syntax highlighter.

`src/ui/QueryEditor.test.tsx` covers running the query on Cmd/Ctrl+Enter without inserting a newline.

`src/App.test.tsx` covers the single page end to end: the starter query tracing on first load with the pinned query and active clause shown, moving through the timeline with the Back/Next buttons, step pills, and arrow keys (and not doing so from inside an editor or while the share dialog is open), Before/After for `WHERE`, running a new query and resetting to step 1, friendly error rendering, walking a grouped query one group per step with HAVING verdicts, the "Show all" link for a large cross join, the Tables section staying collapsed until a table error opens it, re-tracing the current query with formatted SQL after Apply Tables, persisting and restoring the workspace, opening a share link as a sandbox without touching the saved workspace, a share link whose query fails, and generating and copying a share link.

`src/domain/c88c.test.ts` runs the canonical Berkeley dogs/parents/sizes dataset through the question shapes the course actually asks: wildcard selects, string and numeric filters, `ORDER BY`/`LIMIT`, comma joins with unqualified columns, sibling and grandparent self joins, inequality joins against size ranges, explicit `JOIN ... ON`, aggregates, `GROUP BY`, `HAVING`, and ordering by aggregate aliases. It also pins down that unsupported course patterns (`OR`, `DISTINCT`, subqueries, outer joins, `SELECT` without `FROM`) fail with friendly parse errors rather than silently wrong results.

Commands:

```bash
npm test
npm run build
npm run lint
```

## Future Feature Checklist

Before implementing a new feature:

1. Read this `HANDOFF.md` first.
2. Confirm whether the feature changes parser, engine, visualization, samples, tests, or docs.
3. Keep parser errors friendly and scoped to the supported subset.
4. Preserve stable row provenance for every new operation.
5. Add or update parser, engine, and UI tests according to blast radius.
6. Update this `HANDOFF.md` whenever architecture, supported SQL, behavior, visual conventions, known limitations, or test strategy changes.

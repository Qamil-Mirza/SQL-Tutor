# CSM C88C SQL Visualizer Handoff

## Project Goal

Build an educational SQL logical execution visualizer for CSM C88C. The design principle is to explain what SQL does in logical order, not how a database optimizer physically executes a query.

## Supported SQL Subset

- `SELECT` columns, `SELECT *`, and aggregate expressions: `COUNT(*)`, `SUM`, `AVG`, `MIN`, `MAX`
- Arithmetic expressions with `+`, `-`, `*`, and `/`
- Required `FROM table`, with optional `AS alias` or bare alias
- Optional single inner `JOIN table AS alias ON condition` or comma join `FROM table_a, table_b` / `FROM table AS alias, table AS alias`
- Optional `WHERE` with simple comparisons joined by `AND` (`OR` is rejected with a friendly error instead of being silently misparsed)
- Optional `GROUP BY`
- Optional `HAVING`
- Optional `ORDER BY` with `ASC` or `DESC`
- Optional `LIMIT`
- Qualified and unqualified columns, single- or double-quoted string literals, number literals, null literals, and comparison operators `=`, `!=`, `<>`, `>`, `<`, `>=`, `<=`
- Numeric comparisons for numeric values and lexicographic comparisons for non-numeric values

Aliases are optional for `FROM`; when omitted, the table name is used as the alias. Comma-joined tables can use implicit table-name aliases when unique. Aliases are required for explicit `JOIN`, but `AS` is optional. Explicit non-goals are full SQL compatibility, optimizer visualization, subqueries, CTEs, outer joins, `DISTINCT`, `UNION`, window functions, and nested joins.

## Architecture Overview

Parser responsibilities live in `src/domain/parser.ts`. The parser normalizes whitespace, rejects unsupported clauses early, accepts `FROM table`, `FROM table alias`, or `FROM table AS alias`, accepts one comma-joined source in `FROM`, allows unique implicit aliases for comma joins, requires explicit aliases for explicit `JOIN` sources, and builds a `QueryAST` from the supported subset.

Execution engine responsibilities live in `src/domain/engine.ts`. The engine evaluates the AST against in-memory tables in logical order: `FROM`, `JOIN`, `WHERE`, `GROUP BY`, `HAVING`, `SELECT`, `ORDER BY`, `LIMIT`, `Result`. It preserves stable row provenance through aliasing, joins, grouping, filtering, sorting, projection, and limiting.

Visualization and component responsibilities live in `src/App.tsx` and `src/App.css`. The UI uses a focused split workspace: a top app bar with CSM C88C branding and starter-query status, a compact left Build pane for Table SQL definitions and query iteration, and a larger right Trace pane for step navigation and execution visualization. The theme is a warm classroom-neutral palette with teal primary actions, restrained borders, a dark SQL editor surface, and table views optimized for horizontal inspection.

Starter data and starter query ownership live in `src/domain/samples.ts`. Keep starter tables small enough to inspect manually, but do not present them as a fixed sample-table viewer or require a demo-query dropdown. Users can define their own tables through Table SQL.

Table SQL helpers live in `src/domain/tableSql.ts`. They parse and serialize the small table-definition subset: `CREATE TABLE name (columns...)` and `INSERT INTO name VALUES (...)`.

Share snapshot helpers live in `src/domain/shareSnapshot.ts`. Share links compress a versioned snapshot of `tableSql`, `sql`, and optional `stepIndex` into the `share` query parameter. They intentionally avoid a backend slug store; shared links are immutable because the URL is the source of truth, and shared sessions do not overwrite the viewer's saved local workspace on load.

## Data Model Reference

- `Table`: named in-memory table with columns and row records.
- `Row`: plain record of SQL column values.
- `AliasedTable`: table plus alias metadata.
- `AliasedRow`: internal visual row with stable `id`, `provenance`, and qualified `values`.
- `JoinedRow`: alias of `AliasedRow` after join merging.
- `Group`: group bucket with id, key, member rows, and display values.
- `ExecutionStep`: one logical execution step with title, explanation, before/after data, details, and highlights.
- `Highlight`: visual hint for kept, removed, selected, grouped, or matched data.
- `QueryAST`: parsed query object consumed by the engine.
- `Condition`: binary comparison between expressions.
- `Expression`: column, literal, wildcard, or aggregate expression.

## Logical Execution Order

Step generation follows:

1. `FROM`: alias every source row. For comma joins, the explanation names both source aliases even though the displayed rows are still the first source before pairing.
2. `JOIN`: pair left and right aliased rows that satisfy `ON`, or pair every row for comma joins before `WHERE` filtering.
3. `WHERE`: filter rows before grouping. Conditions chained with `AND` are visualized as separate sequential `WHERE` steps, each starting from the rows kept by the previous condition.
4. `GROUP BY`: create group buckets, or one implicit group when aggregates are selected.
5. `HAVING`: filter groups after aggregate values are available.
6. `SELECT`: project requested columns, wildcard columns, and aggregate outputs.
7. `LIMIT`: keep the first `n` projected rows. Trimmed rows are highlighted as removed in the before view and dropped from the after view, matching `WHERE` behavior.
8. `Result`: show the final output only.

## Visual Conventions

- Teal: primary actions, active trace step, and kept-row/alias emphasis.
- Red/faded: removed rows or groups.
- Blue: selected columns.
- Purple: group buckets.
- Alias badges: visible row identity and alias provenance.
- Self-joins: duplicate table instances are treated as distinct aliases with separate qualified columns.

The current CSS implements teal active-step and alias badges, red/faded removed rows, blue selected-column headers, purple group buckets, and horizontally scrollable table containers. Highlight metadata is present for richer future rendering.

## Known Limitations

- No full SQL engine.
- No optimizer visualization.
- No subqueries, CTEs, outer joins, `DISTINCT`, `UNION`, window functions, or nested joins.
- Parser is regex/token-assisted and intentionally scoped.
- Aggregate evaluation is designed for education on small in-memory table data.

## Test Strategy

Parser tests cover required query shapes, wildcard selects, implicit `FROM` aliases, aggregates, `LIMIT`, missing join aliases, and unsupported clauses.

Engine tests cover aliasing, joins, self-joins, row filtering, numeric and string comparisons, grouping, `HAVING`, wildcard projection, aggregate projection, and `LIMIT` trimming.

Table SQL tests cover `CREATE TABLE`, `INSERT INTO`, serialization, and friendly rejection of unsupported table statements.

UI tests cover starter query execution, step navigation, self-join visualization, user-defined table SQL execution, table creation mode switching, direct cell editing, and friendly error rendering.

Share snapshot tests cover compressed payload round trips and malformed payload rejection. UI tests cover direct shared-link entry, immutable reload behavior after local edits, and visible share-link generation.

C88C curriculum tests in `src/domain/c88c.test.ts` run the canonical Berkeley dogs/parents/sizes dataset through the question shapes the course actually asks: wildcard selects, string and numeric filters, `ORDER BY`/`LIMIT`, comma joins with unqualified columns, sibling and grandparent self joins, inequality joins against size ranges, explicit `JOIN ... ON`, aggregates, `GROUP BY`, `HAVING`, and ordering by aggregate aliases. They also pin down that unsupported course patterns (`OR`, `DISTINCT`, subqueries, outer joins, `SELECT` without `FROM`) fail with friendly parse errors rather than silently wrong results.

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

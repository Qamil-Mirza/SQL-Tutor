# CSM C88C SQL Visualizer

An educational Vite + React + TypeScript app that shows how a small SQL query is evaluated in logical execution order. It is intentionally not a database. It parses a focused SQL subset, runs it against user-defined in-memory tables, and presents each transformation step with before and after tables.

The app is a single page: a query editor at the top, a collapsible Tables section for defining your own data, and a trace below with the full query pinned (its active clause highlighted) and a Step N of M timeline you can move through with Back/Next, the step pills, or the arrow keys.

## Defining Tables

Users define tables with Table SQL: `CREATE TABLE table_name (col_a, col_b);` and `INSERT INTO table_name VALUES (...);`.

The app starts with starter data and one starter query so the visualizer is useful immediately, but the visible workflow is centered on user-owned table definitions.

## Sharing Workspaces

Users can generate read-only share links from the single page. Share links encode a compressed snapshot of the table SQL and query in the URL, so no server-side database, slug cleanup, or expiration job is required. Opening a shared link loads that snapshot as a sandbox copy: viewers can edit and experiment locally, but reopening the original link restores the creator's original table and query state.

## Supported SQL

- `SELECT` columns, `SELECT *`, and aggregate expressions: `COUNT(*)`, `COUNT(column)`, `SUM`, `AVG`, `MIN`, `MAX`
- Arithmetic expressions with `+`, `-`, `*`, and `/`, including parentheses to control evaluation order
- `FROM table`, `FROM table AS alias`, or `FROM table alias`
- One optional inner `JOIN table AS alias ON condition` or comma join such as `FROM table_a, table_b` or `FROM table_a AS a, table_b AS b`
- Optional `WHERE` comparisons joined with `AND`
- Optional `GROUP BY`
- Optional `HAVING`
- Aggregates can't be used in `WHERE`, explicit `JOIN ... ON`, or `GROUP BY` — `WHERE`/`ON` fail with a friendly error pointing to `HAVING`, and `GROUP BY` fails asking you to group by a column instead
- Optional `ORDER BY` with `ASC` or `DESC`, by column, by expression, by a SELECT alias, or by column position (`ORDER BY 1`)
- Optional `LIMIT`
- `IN`, `BETWEEN`, `LIKE`, `NOT` (outside `IS NOT NULL`), and `OFFSET` are each rejected by name with "`<KEYWORD>` is not supported in this visualizer."; `OR` is rejected the same way but with "OR is not supported in this visualizer. Combine comparisons with AND." instead
- Qualified and unqualified columns, single- or double-quoted string literals, number/null literals, `IS NULL` / `IS NOT NULL`, and comparison operators `=`, `!=`, `<>`, `>`, `<`, `>=`, `<=`
- Numeric comparisons for numeric values and lexicographic comparisons for non-numeric values, comparing by code unit like SQLite's default `BINARY` collation (uppercase sorts before lowercase); a comparison against `NULL` (other than `IS`/`IS NOT`) evaluates to false
- SELECT aliases can be referenced from `GROUP BY`, `HAVING`, and `ORDER BY`
- Table names, column names, and aliases are matched case-insensitively
- Clause order is enforced; a clause repeated or out of order fails with a friendly error
- `MIN`/`MAX` follow SQLite's bare-column rule: a group's non-aggregated columns come from the same row that produced the `MIN`/`MAX` value, not an arbitrary row
- Integer division truncates like SQLite (`7 / 2` is `3`; use `7 / 2.0` for `3.5`) and division by zero yields `NULL`. Unknown columns are reported before any row is read, so a typo fails even when no rows reach its clause. Without `ORDER BY`, groups appear in first-seen order, while sqlite3 happens to sort them by key. In `GROUP BY` and `HAVING` the engine resolves a SELECT alias before a same-named source column (SQLite prefers the column), which only matters when an alias shadows a different real column.

Aliases are optional in `FROM`; when omitted, the table name is used as the alias. Comma-joined tables can also use their table names as aliases when those names are unique. Explicit `JOIN` sources still need aliases so the visualizer can preserve row provenance clearly, but the `AS` keyword is optional.

## Non-goals

This project does not implement a full SQL engine, optimizer behavior, server-side persistence, auth, backend services, database connectivity, subqueries, CTEs, outer joins, `DISTINCT`, `UNION`, window functions, or nested joins.

## Starter Query

```sql
SELECT u.name, u.tier FROM users AS u WHERE u.tier = 'pro' LIMIT 2
```

## Local Setup

```bash
npm install
npm run dev
```

## Verification

```bash
npm test
npm run build
npm run lint
```

## Deployment

The app is a fully static Vite build deployed on Vercel; `vercel.json` pins the framework, build command, and output directory, and rewrites all paths to `index.html`. Share links are encoded entirely in the URL query string, so no backend or server-side configuration is required. To deploy, import the GitHub repository at [vercel.com/new](https://vercel.com/new) (or run `npx vercel`) and use the defaults; pushes to `main` will then deploy automatically.

Read `HANDOFF.md` before changing parser, engine, visualization, starter data, or tests.

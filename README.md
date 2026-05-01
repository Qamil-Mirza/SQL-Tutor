# CSM C88C SQL Visualizer

An educational Vite + React + TypeScript app that shows how a small SQL query is evaluated in logical execution order. It is intentionally not a database. It parses a focused SQL subset, runs it against user-defined in-memory tables, and presents each transformation step with before and after tables.

## Defining Tables

Users can define tables in two ways:

- Table SQL: `CREATE TABLE table_name (col_a, col_b);` and `INSERT INTO table_name VALUES (...);`
- Direct editing: choose a table, then edit cells in the grid or add rows/columns.

The table builder has a `Table creation method` dropdown for switching between those two modes.

The app starts with editable starter data and one starter query so the visualizer is useful immediately, but the visible workflow is centered on user-owned table definitions.

## Supported SQL

- `SELECT` columns, `SELECT *`, and aggregate expressions: `COUNT(*)`, `SUM`, `AVG`, `MIN`, `MAX`
- `FROM table` or `FROM table AS alias`
- One optional inner `JOIN table AS alias ON condition` or comma join `FROM table AS alias, table AS alias`
- Optional `WHERE` comparisons joined with `AND`
- Optional `GROUP BY`
- Optional `HAVING`
- Optional `LIMIT`
- Qualified and unqualified columns, single- or double-quoted string literals, number/null literals, and comparison operators `=`, `!=`, `<>`, `>`, `<`, `>=`, `<=`
- Numeric comparisons for numeric values and lexicographic comparisons for non-numeric values

Aliases are optional in `FROM`; when omitted, the table name is used as the alias. Aliases are still required in `JOIN` so the visualizer can preserve row provenance clearly.

## Non-goals

This project does not implement a full SQL engine, optimizer behavior, persistence, auth, backend services, database connectivity, subqueries, CTEs, outer joins, `ORDER BY`, `DISTINCT`, `UNION`, window functions, or nested joins.

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

Read `HANDOFF.md` before changing parser, engine, visualization, starter data, or tests.

# Flat timeline, single page, and engine correctness

Date: 2026-09-24
Status: Approved in conversation; awaiting written review

## Goal

Make the visualizer read like Python Tutor for a student meeting SQL for the first
time: the whole query is always visible with the active clause marked, there is one
flat timeline of steps, each step shows its input and output together with a concrete
sentence about what happened, and the engine never returns a silently wrong answer for
a query a beginner would type.

## Non-goals

- Changing the starter dataset (users / listening / employees stays).
- Replacing Table SQL as the way to define tables.
- Supporting SQL outside the current subset except where listed under "Engine and
  parser fixes" (IS NULL, ORDER BY position, parentheses, aliases in GROUP BY / HAVING).
- Any change to the share-link encoding format.

## 1. Page structure

One route. The router, route tabs, guarded navigation, history push/replace, popstate
handling and the landing page are removed. The page is a single scrolling column:

1. **Header**: brand lockup and one intro sentence
   ("See how SQL builds a result, one clause at a time.").
2. **Query section**: SQL editor with keyword highlighting, Run / Format / Share
   buttons, error box.
3. **Tables section**: a collapsible disclosure whose summary line lists the defined
   tables and row counts (for example "Tables: users (4), listening (5), employees (4)").
   It contains the Table SQL editor, Apply / Format buttons, the table error box and the
   table previews. It is collapsed when the tables parse cleanly and expanded when there
   is a table error or no valid tables.
4. **Trace section**: pinned query, timeline, step panel (section 2).

Behaviour that stays:

- `localStorage` workspace persistence (tables, tableSql, sql), except in a shared
  session.
- Share links: `?share=` is read on load, loads the snapshot as a sandbox, and never
  overwrites the viewer's saved workspace. The Share button opens the same modal
  without the artificial one-second spinner: the URL is shown immediately and copied to
  the clipboard.
- Run formats the query, executes it, resets to step 1, and scrolls the trace section
  into view. On error the trace keeps its previous steps and the error box shows above.
- Applying table SQL revalidates the current query silently (no navigation).

State in `App`: `tables`, `tableSql`, `tableError`, `sql`, `error`, `steps`,
`stepIndex`, `tablesOpen`, `shareModal`. `path` and `traceView` are gone.

## 2. Trace section

**Pinned query.** The formatted SQL is always visible above the timeline with the
active step's clause highlighted. Clause matching is whitespace- and case-tolerant, as
today. A step without a real clause (the implicit group step, see 3) highlights nothing.

**Timeline.** Controls: Back, "Step 3 of 7", Next, and a row of numbered step pills. The
active pill is scrolled into view when it changes. Left and right arrow keys move
between steps when focus is not in an editor. Clicking a pill jumps to that step.

**Step panel.** Title, one concrete sentence, then Before and After panels rendered side
by side at widths of 960px and up and stacked below that. Each panel has a label. The
last step's After panel is labelled "Final result". Steps without a Before (FROM) show
only After. The Before / After toggle, the "Current clause / Full query" toggle and the
separate Result step are removed.

## 3. Step contents

Every step's sentence uses real numbers and names from the data. Examples:

| Step | Sentence pattern |
|---|---|
| FROM | "Start with all 4 rows of users (as u)." |
| JOIN (explicit) | "Paired 5 of the 4 × 5 possible combinations where u.id = l.user_id. u2 had no match." |
| JOIN (comma) | "Paired every row of a with every row of b: 7 × 7 = 49 pairs." |
| WHERE | "Kept 2 of 4 rows where u.tier = 'pro'." |
| GROUP BY | "Split 4 rows into 2 groups by u.region." |
| GROUP BY (implicit) | "No GROUP BY, so all 4 rows form one group for the aggregates." |
| HAVING | "Kept 1 of 2 groups where SUM(l.minutes) > 60." |
| SELECT (rows) | "Kept only the columns you asked for: name, tier." |
| SELECT (group i of n) | "Collapsed group u.region = west (3 rows) into one result row (1 of 2)." |
| ORDER BY | "Sorted 3 rows by total, highest first." |
| LIMIT | "Kept the first 2 of 3 rows." or "Nothing trimmed: only 2 rows, limit is 5." |

Per-step panels:

- **FROM**: After shows the source table. For a comma join both sources are shown.
- **JOIN**: Before shows both source tables with the ON key columns highlighted and
  rows that pair with nothing faded. Under the sources a compact match list is rendered
  from the engine's details ("u1 ↔ l1, l2 · u3 ↔ l4 · u4 ↔ l5"). After shows the joined
  rows with the key columns highlighted. Cross joins show no match list.
- **WHERE**: Before highlights the columns used in the condition and fades rows that
  fail it. After shows the surviving rows. One step per AND-ed condition, as today.
- **GROUP BY**: Before highlights the grouping columns. After shows one card per group
  (the `GroupTablesView` from the current branch).
- **HAVING**: Before shows every group card with the computed aggregate value
  ("SUM(l.minutes) = 115") and a KEEP or REJECT badge; rejected cards are faded.
  After shows only the kept cards.
- **SELECT without groups**: Before highlights the selected columns. After shows the
  projected table.
- **SELECT with groups**: the engine emits one step per surviving group. Before shows
  that group's card with the aggregated and grouped columns highlighted. After shows
  the result table so far, with the newly added row highlighted. The in-panel group
  stepper is removed.
- **ORDER BY**: Before shows the rows in their previous order with the sort key columns
  highlighted and each row's current rank. After shows the sorted rows with a
  "was #3" badge on every row that moved, from the existing sort summaries. When the
  sort key is not a selected column, the key value is shown in the badge
  ("height 52, was #2").
- **LIMIT**: Before fades trimmed rows. After shows the kept rows.

## 4. Naming and labels

- Columns are qualified (`u.name`) only when the query has two sources. Single-source
  queries show `name`, whether or not an alias was written.
- Row badges: alias plus index for source rows (`u1`, `dogs3`, `u1+l2` after a join).
  Projected rows are numbered `#1`, `#2`, and keep that number through ORDER BY and
  LIMIT.
- Result column headers follow SQLite: the alias if given, else the bare column name
  for column expressions, else the expression text. If two result columns would get the
  same header the qualified form is kept for both.
- Result column order is the order written in SELECT (see fix 13).

## 5. Tables

No Previous / Next controls on any table, in previews or in the trace. Tables of 12
rows or fewer render in full. Larger tables render the first 8 rows and a single
"Show all N rows" link that expands the table in place; "Show fewer" collapses it.
Faded (removed) rows count toward the visible rows so a WHERE step never hides the
rows it dropped behind the link unless the table is large.

## 6. Engine and parser fixes

Each item gets a test in `engine.test.ts`, `parser.test.ts` or `tableSql.test.ts`
before the fix. Expected behaviour is SQLite's, since that is what the course uses.

1. Aggregates without GROUP BY over zero rows produce one group with no rows:
   COUNT is 0, SUM / AVG / MIN / MAX are NULL. With GROUP BY over zero rows there are
   zero groups.
2. `COUNT(column)` ignores NULL; `COUNT(*)` counts rows.
3. Any comparison whose side is NULL is false. `IS NULL` and `IS NOT NULL` are added
   as conditions.
4. When a SELECT has exactly one aggregate and it is MIN or MAX, bare columns take
   their values from the row holding that extreme. Otherwise bare columns come from
   the group's first row.
5. An aggregate inside WHERE, or an aggregate nested inside another aggregate, raises
   a `QueryExecutionError` naming the expression and suggesting HAVING.
6. An integer literal in ORDER BY sorts by that result column position; out-of-range
   positions raise an error.
7. Clause order is enforced: SELECT, FROM, JOIN, ON, WHERE, GROUP BY, HAVING, ORDER BY,
   LIMIT. A clause out of order raises a `QueryParseError` such as
   "ORDER BY must come before LIMIT."
8. Keywords, AND, and comparison operators inside string literals are ignored by the
   parser.
9. Equality and ordering use the same coercion: both sides numeric or numeric strings
   compare as numbers; otherwise as strings.
10. Column and table names are case-insensitive in queries and in Table SQL. Display
    keeps the name as written in CREATE TABLE.
11. A SELECT alias can be used in GROUP BY, HAVING and ORDER BY.
12. Parentheses group arithmetic. `LIMIT n OFFSET m` raises "OFFSET is not supported."
13. Projected rows carry an ordered `columns` list so result column order is the order
    written, regardless of column names.
14. Table SQL: `''` inside a single-quoted value is unescaped to `'`; double-quoted
    values are accepted; a second CREATE TABLE with an existing name and duplicate
    column names in one CREATE TABLE raise `TableDefinitionError`.

## 7. Engine step shape

`ExecutionStep` changes:

- `kind` gains `'selectGroup'`; the old `'result'` kind is removed.
- New optional `summary: string` (the concrete sentence). `explanation` is removed.
- `details` stays for JOIN match text; other steps no longer fill it.
- `highlights` gains `unmatched` (source rows with no join partner) alongside `removed`,
  `selected`, `matched`. `kept` and `grouped` are removed.
- `sortSummaries` stays. `display` labels stay for the FROM step.
- `Group.aggregates` and `Group.keyParts` are removed; `Group.conditions` stays for
  HAVING. `AliasedRow.provenance` is removed. `JoinClause.condition` is removed in favour
  of `conditions`.
- `AliasedRow` gains optional `columns: string[]` for projected rows.

## 8. Shared SQL tokens

`src/domain/sqlText.ts` provides the string-aware helpers used by the parser, the
formatter and the editor highlighter: `maskStrings`, `splitOutsideStrings`,
`replaceOutsideStrings`, and the keyword list. The editor highlighter stops colouring
keywords inside quotes.

## 9. Component layout

`App.tsx` is split into `src/ui/`:

- `QueryEditor.tsx`, `TablesPanel.tsx` (disclosure, Table SQL editor, previews),
  `ShareModal.tsx`
- `trace/PinnedQuery.tsx`, `trace/Timeline.tsx`, `trace/StepPanel.tsx`,
  `trace/TableView.tsx` (with show-all), `trace/GroupCards.tsx`,
  `trace/SourcesView.tsx`, `trace/stepCopy.ts` (sentence builders if not in engine)

`App.tsx` keeps state and wiring only.

## 10. Testing

- Engine / parser / table SQL tests for every item in section 6.
- Engine tests for step shape: one `selectGroup` step per group, no `result` step,
  `summary` text for each kind, `unmatched` highlight on JOIN.
- App tests (React Testing Library) rewritten for the single page: starter query is
  traced on first load; Run updates the timeline and scrolls; Back / Next / pills /
  arrow keys move steps; the pinned query highlights the active clause; JOIN, WHERE,
  GROUP BY, HAVING, grouped SELECT, ORDER BY and LIMIT panels show the expected rows,
  badges and sentences; tables over 12 rows show the "Show all" link; Table SQL errors
  expand the Tables section; share link loads as a sandbox.
- `c88c.test.ts` keeps passing with the final-step lookup updated.
- `npm test`, `npm run build`, `npm run lint` all pass before the work is committed.
  All work on this branch is committed together at the end, per the owner's request.

## 11. Docs

HANDOFF.md and README.md are updated for the single page, the timeline, the new step
kinds, the removed metadata, the shared token helper, the green palette, and the
expanded SQL subset.

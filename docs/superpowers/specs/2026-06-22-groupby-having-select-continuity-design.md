# GROUP BY → HAVING → SELECT continuity redesign

Date: 2026-06-22
Status: Approved

## Problem

The trace visualizer's grouping flow confuses learners on three points:

1. Aggregate functions (MIN, AVG, SUM, ...) are computed and shown at the **GROUP BY**
   step, even though only the GROUP BY clause is highlighted. GROUP BY logically only
   partitions rows; aggregates are evaluated where they are referenced.
2. The grouped-result cells repeat the label (`COUNT(*) = 3`) inside every cell.
3. The **HAVING** step abandons the grouped-result table built at GROUP BY and switches
   to a different "bucket cards + chips" layout, breaking continuity between successive
   table transformations.

## Mental model (target)

Follow SQL's logical processing order:

- **GROUP BY** = partition only. No aggregates computed or displayed.
- **HAVING** = compute the aggregate(s) **referenced in the HAVING condition** per group,
  then judge KEEP/DROP. Shown all at once (not stepped).
- **SELECT** = compute the output aggregates and collapse each group's band into one
  result row, stepping one group at a time.

## Components

### `BandedRowsView` (new, unified)
Renders a set of groups as their **member rows clustered into labeled bands** (band
header = group key, e.g. `region = west`). One component used wherever a grouped state
appears, which is what creates the continuity:

- **GROUP BY → After**: WHERE-output rows clustered into bands; group-key column
  highlighted. Before = the same rows ungrouped, so the Before/After toggle shows the
  grouping happen.
- **HAVING → Before/After**: same bands, each with a one-line summary
  `SUM(minutes) = 115 → KEEP (> 60)`. After-view dims/removes dropped bands.
- **SELECT → Before**: the surviving bands, handed off to the collapse walkthrough.

Replaces `GroupByWalkthrough`, `GroupBuildTable`, and `GroupedTableView`.

### SELECT collapse walkthrough (new)
A small stepper inside SELECT's After view. Step *i* computes group *i*'s selected
columns and collapses its band into one result row; groups not yet reached remain as
bands. Final step = full result table. Aggregate names are **column headers**; cells hold
plain values (no `label = value`).

## Engine / types changes

- `attachConditionEvaluations` (engine.ts): also attach the **computed left-hand value**
  of each HAVING condition, so the UI can render `SUM(minutes) = 115`. Extend the
  `Group.conditions` element type with that value.
- Remove the now-unused `aggregateAfter` field from `ExecutionStep` (types.ts) and the
  GROUP BY step (engine.ts). GROUP BY's After renders member rows from `groups`;
  HAVING/SELECT already carry aggregates on their groups.
- No change to query results — only step metadata/highlights.

## Testing

- **Engine**: HAVING condition evaluations expose the computed value; GROUP BY step no
  longer carries aggregate-fill data.
- **App (RTL)**: GROUP BY After shows bands with no aggregate values; HAVING shows
  per-band `<expr> = <value> → KEEP/DROP`; SELECT collapse reveals one group per step and
  ends on the full result table; no `COUNT(*) = 3`-style cells remain.

## Out of scope

- Extracting trace components out of `App.tsx` (kept in place to match the codebase).
- Any change to non-grouping steps (FROM, JOIN, WHERE, ORDER BY, LIMIT).

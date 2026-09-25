export type Scalar = string | number | boolean | null

export type Row = Record<string, Scalar>

export type Table = {
  name: string
  columns: string[]
  rows: Row[]
}

export type AliasedRow = {
  id: string
  values: Record<string, Scalar>
  /** Ordered result columns; set on projected rows so column order is the order written. */
  columns?: string[]
}

export type AggregateName = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
export type ArithmeticOperator = '+' | '-' | '*' | '/'

export type Expression =
  | { type: 'column'; tableAlias?: string; column: string; label: string }
  | { type: 'literal'; value: Scalar; label: string }
  | { type: 'aggregate'; fn: AggregateName; column?: Expression; label: string }
  | { type: 'binary'; operator: ArithmeticOperator; left: Expression; right: Expression; label: string }
  | { type: 'wildcard'; label: '*' }

export type ComparisonOperator = '=' | '!=' | '<>' | '>' | '<' | '>=' | '<=' | 'IS' | 'IS NOT'

export type Condition = {
  left: Expression
  operator: ComparisonOperator
  right: Expression
  label: string
}

export type SelectItem = {
  expression: Expression
  alias?: string
  label: string
}

export type OrderItem = {
  expression: Expression
  direction: 'ASC' | 'DESC'
  label: string
}

export type JoinClause = {
  tableName: string
  alias: string
  conditions: Condition[]
  syntax: 'explicit' | 'comma'
}

/** Raw clause text as the student wrote it (whitespace-normalised), keyword included. */
export type QueryClauses = {
  select: string
  from: string
  join?: string
  where?: string
  groupBy?: string
  having?: string
  orderBy?: string
  limit?: string
}

export type QueryAST = {
  select: SelectItem[]
  from: { tableName: string; alias: string }
  join?: JoinClause
  where: Condition[]
  groupBy: Expression[]
  having: Condition[]
  orderBy: OrderItem[]
  limit?: number
  clauses: QueryClauses
}

export type Group = {
  id: string
  key: string
  rows: AliasedRow[]
  conditions?: Array<{ label: string; result: boolean; value: Scalar; leftLabel: string }>
}

export type SortSummary = {
  rowId: string
  beforeRank: number
  afterRank: number
  keys: Array<{ label: string; value: Scalar; direction: 'ASC' | 'DESC' }>
}

export type Highlight = {
  rowIds?: string[]
  columnKeys?: string[]
  groupIds?: string[]
  kind: 'removed' | 'selected' | 'matched' | 'unmatched'
}

export type StepKind =
  | 'from'
  | 'join'
  | 'where'
  | 'groupBy'
  | 'having'
  | 'select'
  | 'selectGroup'
  | 'orderBy'
  | 'limit'

export type ExecutionStep = {
  id: string
  kind: StepKind
  title: string
  /** One concrete sentence about what this step did, e.g. "Kept 2 of 4 rows where u.tier = 'pro'." */
  summary: string
  /** Text to highlight inside the pinned query. Undefined for the implicit group step. */
  clause?: string
  before?: AliasedRow[] | Group[]
  after: AliasedRow[] | Group[]
  sources?: Array<{ label: string; rows: AliasedRow[] }>
  highlights: Highlight[]
  sortSummaries?: SortSummary[]
}

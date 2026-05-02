export type Scalar = string | number | boolean | null

export type Row = Record<string, Scalar>

export type Table = {
  name: string
  columns: string[]
  rows: Row[]
}

export type AliasedTable = {
  table: Table
  alias: string
}

export type AliasedRow = {
  id: string
  provenance: string[]
  values: Record<string, Scalar>
}

export type JoinedRow = AliasedRow

export type AggregateName = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
export type ArithmeticOperator = '+' | '-' | '*' | '/'

export type Expression =
  | { type: 'column'; tableAlias?: string; column: string; label: string }
  | { type: 'literal'; value: Scalar; label: string }
  | { type: 'aggregate'; fn: AggregateName; column?: Expression; label: string }
  | { type: 'binary'; operator: ArithmeticOperator; left: Expression; right: Expression; label: string }
  | { type: 'wildcard'; label: '*' }

export type ComparisonOperator = '=' | '!=' | '<>' | '>' | '<' | '>=' | '<='

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
  condition?: Condition
  syntax?: 'explicit' | 'comma'
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
}

export type Group = {
  id: string
  key: string
  rows: AliasedRow[]
  values: Record<string, Scalar>
}

export type Highlight = {
  rowIds?: string[]
  columnKeys?: string[]
  groupIds?: string[]
  kind: 'kept' | 'removed' | 'selected' | 'grouped' | 'matched'
}

export type StepKind =
  | 'from'
  | 'join'
  | 'where'
  | 'groupBy'
  | 'having'
  | 'select'
  | 'orderBy'
  | 'limit'
  | 'result'

export type ExecutionStep = {
  id: string
  kind: StepKind
  title: string
  explanation: string
  before?: AliasedRow[] | Group[]
  after: AliasedRow[] | Group[]
  details?: string[]
  highlights: Highlight[]
}

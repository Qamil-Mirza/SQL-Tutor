import { useEffect, useMemo, useState, type ReactNode } from 'react'
import './App.css'
import { executeQuery } from './domain/engine'
import { parseQuery } from './domain/parser'
import { initialTables, starterQuery } from './domain/samples'
import { parseTableSql, serializeTables } from './domain/tableSql'
import type { AliasedRow, ExecutionStep, Group, Highlight, Scalar, Table } from './domain/types'

const workspaceStorageKey = 'c88c-sql-tutor-workspace'
const previewPageSize = 5

type WorkspaceSnapshot = {
  tables: Table[]
  tableSql: string
  sql: string
}

type AppRoute = '/tables' | '/query' | '/visualization'

function App() {
  const savedWorkspace = useMemo(() => loadWorkspace(), [])
  const [path, setPath] = useState<AppRoute>(() => normalizeRoute(window.location.pathname))
  const [tables, setTables] = useState<Table[]>(savedWorkspace.tables)
  const [tableSql, setTableSql] = useState(savedWorkspace.tableSql)
  const [sql, setSql] = useState(savedWorkspace.sql)
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState<string>()
  const [tableError, setTableError] = useState<string>()
  const [steps, setSteps] = useState<ExecutionStep[]>(() => run(savedWorkspace.sql, savedWorkspace.tables).steps)
  const activeStep = steps[stepIndex]

  useEffect(() => {
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify({ tables, tableSql, sql }))
  }, [tables, tableSql, sql])

  useEffect(() => {
    function handlePopState() {
      setPath(normalizeRoute(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigate(nextPath: AppRoute) {
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
  }

  function handleRun(nextSql = sql, nextTables = tables) {
    const result = run(nextSql, nextTables)
    setSql(nextSql)
    setError(result.error)
    setSteps(result.steps)
    setStepIndex(0)
    if (!result.error) navigate('/visualization')
  }

  function applyTableSql() {
    try {
      const nextTables = parseTableSql(tableSql)
      setTables(nextTables)
      setTableError(undefined)
      return nextTables
    } catch (error) {
      setTableError(error instanceof Error ? error.message : 'The table SQL could not be applied.')
      return undefined
    }
  }

  function handleApplyTableSql() {
    applyTableSql()
  }

  function handleContinueToQuery() {
    const nextTables = applyTableSql()
    if (nextTables) navigate('/query')
  }

  function handleShellNavigate(nextPath: AppRoute) {
    if (nextPath === '/query' && path === '/tables') {
      handleContinueToQuery()
      return
    }
    navigate(nextPath)
  }

  if (path === '/visualization') {
    return (
      <AppShell path={path} onNavigate={handleShellNavigate}>
        <section className="trace-pane visualization-route" aria-labelledby="trace-heading">
          <div className="trace-card trace-nav-card">
            <div>
              <h1 id="trace-heading">Trace</h1>
            </div>
            <button className="secondary-button back-button" type="button" onClick={() => navigate('/query')}>
              Back to query
            </button>
            <StepNavigator
              steps={steps}
              stepIndex={stepIndex}
              onPrevious={() => setStepIndex((value) => Math.max(0, value - 1))}
              onNext={() => setStepIndex((value) => Math.min(steps.length - 1, value + 1))}
              onReset={() => setStepIndex(0)}
            />
          </div>
          <section className="trace-card visualization-panel" aria-label="Execution visualization">
            {activeStep ? <VisualizationPanel step={activeStep} /> : <EmptyState />}
          </section>
        </section>
      </AppShell>
    )
  }

  if (path === '/query') {
    return (
      <AppShell path={path} onNavigate={handleShellNavigate}>
        <section className="workflow-page query-route" aria-label="Query page">
          <div className="pane-heading compact-heading">
            <h1>Query</h1>
            <button className="secondary-button back-button" type="button" onClick={() => navigate('/tables')}>
              Back to tables
            </button>
          </div>
          <div className="query-page-grid">
            <QueryEditor
              sql={sql}
              error={error}
              onSqlChange={setSql}
              onRun={() => handleRun()}
            />
            <TableContext tables={tables} />
          </div>
        </section>
      </AppShell>
    )
  }

  return (
    <AppShell path={path} onNavigate={handleShellNavigate}>
      <section className="workflow-page tables-route" aria-label="Table creation page">
        <div className="pane-heading compact-heading">
          <h1>Tables</h1>
        </div>
        <TableBuilder
          tables={tables}
          tableSql={tableSql}
          tableError={tableError}
          onTableSqlChange={setTableSql}
          onApplyTableSql={handleApplyTableSql}
          onContinue={handleContinueToQuery}
        />
      </section>
    </AppShell>
  )
}

function normalizeRoute(pathname: string): AppRoute {
  if (pathname === '/query' || pathname === '/visualization' || pathname === '/tables') return pathname
  window.history.replaceState({}, '', '/tables')
  return '/tables'
}

function AppShell({
  children,
  path,
  onNavigate,
}: {
  children: ReactNode
  path: AppRoute
  onNavigate: (path: AppRoute) => void
}) {
  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand-lockup" aria-label="CSM C88C SQL Visualizer">
          <span className="brand-mark" aria-hidden="true">SQL</span>
          <div>
            <p className="brand-title">CSM C88C SQL Visualizer</p>
            <p className="brand-subtitle">Logical execution tutor</p>
          </div>
        </div>
        <nav className="route-tabs" aria-label="Workflow">
          <button type="button" className={path === '/tables' ? 'active' : ''} onClick={() => onNavigate('/tables')} aria-current={path === '/tables' ? 'page' : undefined}>
            Tables
          </button>
          <button type="button" className={path === '/query' ? 'active' : ''} onClick={() => onNavigate('/query')} aria-current={path === '/query' ? 'page' : undefined}>
            Query
          </button>
          <button type="button" className={path === '/visualization' ? 'active' : ''} onClick={() => onNavigate('/visualization')} aria-current={path === '/visualization' ? 'page' : undefined}>
            Trace
          </button>
        </nav>
      </header>
      {children}
    </main>
  )
}

function loadWorkspace(): WorkspaceSnapshot {
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey)
    if (!raw) throw new Error('No saved workspace')
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>
    if (!Array.isArray(parsed.tables) || typeof parsed.tableSql !== 'string' || typeof parsed.sql !== 'string') {
      throw new Error('Invalid saved workspace')
    }
    return { tables: parsed.tables, tableSql: parsed.tableSql, sql: parsed.sql }
  } catch {
    return { tables: initialTables, tableSql: serializeTables(initialTables), sql: starterQuery }
  }
}

function run(sql: string, tables: Table[]) {
  try {
    const ast = parseQuery(sql)
    return { steps: executeQuery(ast, tables), error: undefined }
  } catch (error) {
    return {
      steps: [],
      error: error instanceof Error ? error.message : 'The query could not be visualized.',
    }
  }
}

function StepNavigator({
  steps,
  stepIndex,
  onPrevious,
  onNext,
  onReset,
}: {
  steps: ExecutionStep[]
  stepIndex: number
  onPrevious: () => void
  onNext: () => void
  onReset: () => void
}) {
  return (
    <>
      <div className="step-controls" aria-label="Step controls">
        <button className="icon-button" type="button" onClick={onPrevious} disabled={stepIndex === 0 || steps.length === 0} aria-label="Previous step">
          <span aria-hidden="true">←</span>
        </button>
        <button className="reset-button" type="button" onClick={onReset} disabled={stepIndex === 0 || steps.length === 0}>
          Reset
        </button>
        <button className="icon-button" type="button" onClick={onNext} disabled={stepIndex >= steps.length - 1} aria-label="Next step">
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <ol className="step-list">
        {steps.map((step, index) => (
          <li key={step.id} className={index === stepIndex ? 'active' : ''} aria-current={index === stepIndex ? 'step' : undefined}>
            <span>{index + 1}</span>
            {step.title}
          </li>
        ))}
      </ol>
    </>
  )
}

function QueryEditor({
  sql,
  error,
  onSqlChange,
  onRun,
}: {
  sql: string
  error?: string
  onSqlChange: (value: string) => void
  onRun: () => void
}) {
  const editorRows = rowsForQuery(sql)
  return (
    <section className="query-card" aria-label="SQL query">
      <p className="eyebrow">SQL query</p>
      <h2>Run a query</h2>
      <label className="field-label" htmlFor="sql-editor">
        SQL query editor
      </label>
      <div className="sql-editor-shell">
        <pre className="sql-highlight" aria-hidden="true">{highlightSql(sql)}</pre>
        <textarea
          id="sql-editor"
          rows={editorRows}
          value={sql}
          onChange={(event) => onSqlChange(event.target.value)}
          spellCheck={false}
        />
      </div>
      <button className="primary-button" type="button" onClick={onRun}>
        Run Query
      </button>
      {error ? <div className="error-box" role="alert">{error}</div> : null}
    </section>
  )
}

function rowsForQuery(sql: string) {
  const visualRows = sql.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 72)), 0)
  return Math.min(18, Math.max(6, visualRows + 1))
}

function VisualizationPanel({ step }: { step: ExecutionStep }) {
  return (
    <article>
      <p className="eyebrow">Current step</p>
      <h2>{step.title}</h2>
      <p className="explanation">{step.explanation}</p>
      {step.details?.length ? (
        <ul className="detail-list">
          {step.details.slice(0, 6).map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {step.sortSummaries?.length ? <SortSummaryPanel summaries={step.sortSummaries} /> : null}
      {step.before ? (
        <>
          <h3>Before</h3>
          <DataView data={step.before} highlights={step.highlights} />
        </>
      ) : null}
      <h3>After</h3>
      <DataView data={step.after} highlights={step.highlights} />
    </article>
  )
}

function SortSummaryPanel({ summaries }: { summaries: NonNullable<ExecutionStep['sortSummaries']> }) {
  return (
    <div className="sort-summary-panel" aria-label="ORDER BY sort keys">
      {summaries.map((summary) => (
        <div className="sort-summary-row" key={summary.rowId}>
          <span className="rank-chip">{summary.beforeRank} -&gt; {summary.afterRank}</span>
          <span className="alias-badge">{summary.rowId}</span>
          <div className="sort-key-list">
            {summary.keys.map((key) => (
              <span className="sort-key-chip" key={`${summary.rowId}-${key.label}`}>
                {key.label} {key.direction} = {formatCell(key.value)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DataView({ data, highlights = [] }: { data: AliasedRow[] | Group[]; highlights?: Highlight[] }) {
  if (!data.length) return <p className="empty">No rows remain.</p>
  if ('rows' in data[0]) return <GroupedTableView groups={data as Group[]} highlights={highlights} />
  return <TableView rows={data as AliasedRow[]} highlights={highlights} />
}

function TableView({ rows, highlights = [] }: { rows: AliasedRow[]; highlights?: Highlight[] }) {
  const columns = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row.values)))], [rows])
  const removedRows = useMemo(() => new Set(highlights.filter((highlight) => highlight.kind === 'removed').flatMap((highlight) => highlight.rowIds ?? [])), [highlights])
  const selectedColumns = useMemo(() => new Set(highlights.filter((highlight) => highlight.kind === 'selected').flatMap((highlight) => highlight.columnKeys ?? [])), [highlights])
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>row</th>
            {columns.map((column) => (
              <th key={column} className={isSelectedColumn(column, selectedColumns) ? 'selected-column' : ''}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={isRemovedRow(row.id, removedRows) ? 'removed-row' : ''}>
              <td><span className="alias-badge">{row.id.replace('__removed', '')}</span></td>
              {columns.map((column) => (
                <td key={column} className={isSelectedColumn(column, selectedColumns) ? 'selected-column' : ''}>{formatCell(row.values[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupedTableView({ groups, highlights = [] }: { groups: Group[]; highlights?: Highlight[] }) {
  const removedGroups = new Set(highlights.filter((highlight) => highlight.kind === 'removed').flatMap((highlight) => highlight.groupIds ?? []))
  return (
    <div className="group-grid">
      {groups.map((group) => (
        <div className={removedGroups.has(group.id) ? 'group-bucket removed-group' : 'group-bucket'} key={group.id} aria-label={`Group ${group.key}`}>
          <div className="group-title">{group.key}</div>
          {group.aggregates?.length ? (
            <div className="aggregate-chip-list" aria-label={`Aggregate values for ${group.key}`}>
              {group.aggregates.map((aggregate) => (
                <span className="aggregate-chip" key={aggregate.label}>{aggregate.label} = {formatCell(aggregate.value)}</span>
              ))}
            </div>
          ) : null}
          {group.conditions?.length ? (
            <div className="condition-chip-list" aria-label={`HAVING checks for ${group.key}`}>
              {group.conditions.map((condition) => (
                <span className={condition.result ? 'condition-chip kept-condition' : 'condition-chip removed-condition'} key={condition.label}>
                  {condition.label} -&gt; {String(condition.result)}
                </span>
              ))}
            </div>
          ) : null}
          <TableView rows={group.rows} highlights={highlights} />
        </div>
      ))}
    </div>
  )
}

function TableBuilder({
  tables,
  tableSql,
  tableError,
  onTableSqlChange,
  onApplyTableSql,
  onContinue,
}: {
  tables: Table[]
  tableSql: string
  tableError?: string
  onTableSqlChange: (value: string) => void
  onApplyTableSql: () => void
  onContinue: () => void
}) {
  return (
    <section className="table-builder" aria-label="Create table">
      <div className="section-heading-row">
        <div>
          <h2>Create table</h2>
        </div>
      </div>
      <div className="table-mode-panel">
        <label className="field-label" htmlFor="table-sql">
          Table SQL
        </label>
        <textarea
          className="table-sql-editor"
          id="table-sql"
          value={tableSql}
          onChange={(event) => onTableSqlChange(event.target.value)}
          spellCheck={false}
        />
        <button className="secondary-button" type="button" onClick={onApplyTableSql}>
          Create Tables
        </button>
        <button className="primary-button" type="button" onClick={onContinue}>
          Continue to Query
        </button>
        {tableError ? <div className="error-box" role="alert">{tableError}</div> : null}
      </div>
      <div className="table-preview-list" aria-label="Created table previews">
        {tables.map((table) => <TablePreview table={table} key={table.name} />)}
      </div>
    </section>
  )
}

function TableContext({ tables }: { tables: Table[] }) {
  return (
    <aside className="table-context" aria-label="Query page table context">
      <h2>Tables</h2>
      <div className="table-preview-list compact-preview-list">
        {tables.map((table) => <TablePreview table={table} key={table.name} />)}
      </div>
    </aside>
  )
}

function TablePreview({ table }: { table: Table }) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(table.rows.length / previewPageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageStart = currentPage * previewPageSize
  const visibleRows = table.rows.slice(pageStart, pageStart + previewPageSize)
  const rangeStart = table.rows.length ? pageStart + 1 : 0
  const rangeEnd = Math.min(table.rows.length, pageStart + visibleRows.length)

  return (
    <section className="table-preview table-overflow-boundary" aria-label={`${table.name} preview`}>
      <div className="preview-header">
        <div>
          <p className="eyebrow">Preview</p>
          <h3>{table.name}</h3>
        </div>
        <p className="preview-count">Rows {rangeStart}-{rangeEnd} of {table.rows.length}</p>
      </div>
      <RawTableView columns={table.columns} rows={visibleRows} />
      <div className="pagination-controls">
        <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0} aria-label={`Previous page for ${table.name}`}>
          Previous
        </button>
        <button type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage >= pageCount - 1} aria-label={`Next page for ${table.name}`}>
          Next
        </button>
      </div>
    </section>
  )
}

function RawTableView({ columns, rows }: { columns: string[]; rows: Record<string, Scalar>[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function isRemovedRow(rowId: string, removedRows: Set<string>) {
  const cleanId = rowId.replace('__removed', '')
  return rowId.includes('__removed') || removedRows.has(cleanId) || removedRows.has(rowId)
}

function isSelectedColumn(column: string, selectedColumns: Set<string>) {
  const unqualified = column.split('.').at(-1) ?? column
  return selectedColumns.has(column) || selectedColumns.has(unqualified)
}

function formatCell(value: Scalar | undefined) {
  return value === null || value === undefined ? '' : String(value)
}

function highlightSql(sql: string) {
  const parts = sql.split(/(\bGROUP\s+BY\b|\bORDER\s+BY\b|\bSELECT\b|\bFROM\b|\bWHERE\b|\bJOIN\b|\bHAVING\b|\bLIMIT\b|\bAS\b|\bON\b|\bAND\b)/gi)
  return parts.map((part, index) => {
    const normalized = part.toUpperCase().replace(/\s+/g, ' ')
    const className = keywordClassName(normalized)
    return className ? <span className={className} key={index}>{part}</span> : <span key={index}>{part}</span>
  })
}

function keywordClassName(keyword: string) {
  if (keyword === 'SELECT') return 'sql-keyword sql-keyword-select'
  if (keyword === 'WHERE' || keyword === 'HAVING') return 'sql-keyword sql-keyword-filter'
  if (keyword === 'FROM' || keyword === 'JOIN' || keyword === 'ON') return 'sql-keyword sql-keyword-source'
  if (keyword === 'GROUP BY' || keyword === 'ORDER BY' || keyword === 'LIMIT') return 'sql-keyword sql-keyword-shape'
  if (keyword === 'AS' || keyword === 'AND') return 'sql-keyword sql-keyword-logic'
}

function EmptyState() {
  return <p className="empty">Run a supported query to see the execution steps.</p>
}

export default App

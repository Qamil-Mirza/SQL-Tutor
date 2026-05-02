import { useMemo, useState } from 'react'
import './App.css'
import { executeQuery } from './domain/engine'
import { parseQuery } from './domain/parser'
import { initialTables, starterQuery } from './domain/samples'
import { parseTableSql, serializeTables } from './domain/tableSql'
import type { AliasedRow, ExecutionStep, Group, Table } from './domain/types'

function App() {
  const [tables, setTables] = useState<Table[]>(initialTables)
  const [tableSql, setTableSql] = useState(() => serializeTables(initialTables))
  const [sql, setSql] = useState(starterQuery)
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState<string>()
  const [tableError, setTableError] = useState<string>()
  const [steps, setSteps] = useState<ExecutionStep[]>(() => run(starterQuery, initialTables).steps)
  const activeStep = steps[stepIndex]

  function handleRun(nextSql = sql, nextTables = tables) {
    const result = run(nextSql, nextTables)
    setSql(nextSql)
    setError(result.error)
    setSteps(result.steps)
    setStepIndex(0)
  }

  function handleApplyTableSql() {
    try {
      const nextTables = parseTableSql(tableSql)
      setTables(nextTables)
      setTableError(undefined)
    } catch (error) {
      setTableError(error instanceof Error ? error.message : 'The table SQL could not be applied.')
    }
  }

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
      </header>

      <div className="workspace-grid">
        <section className="build-pane" aria-label="Build workspace">
          <div className="pane-heading">
            <p className="eyebrow">Build</p>
            <h1>Tables and query</h1>
            <p className="pane-copy">Edit the input data, adjust the SQL, then run again without leaving the workspace.</p>
          </div>

          <TableBuilder
            tableSql={tableSql}
            tableError={tableError}
            onTableSqlChange={setTableSql}
            onApplyTableSql={handleApplyTableSql}
          />

          <QueryEditor
            sql={sql}
            error={error}
            onSqlChange={setSql}
            onRun={() => handleRun()}
          />
        </section>

        <section className="trace-pane" aria-labelledby="trace-heading">
          <div className="trace-card trace-nav-card">
            <div>
              <p className="eyebrow">Trace</p>
              <h2 id="trace-heading">Trace</h2>
              <p className="pane-copy">Walk through each logical SQL operation and compare what changed.</p>
            </div>
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
      </div>
    </main>
  )
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
  return (
    <section className="query-card" aria-label="SQL query">
      <p className="eyebrow">SQL query</p>
      <h2>Run a query</h2>
      <label className="field-label" htmlFor="sql-editor">
        SQL query editor
      </label>
      <textarea
        id="sql-editor"
        value={sql}
        onChange={(event) => onSqlChange(event.target.value)}
        spellCheck={false}
      />
      <button className="primary-button" type="button" onClick={onRun}>
        Run Query
      </button>
      {error ? <div className="error-box" role="alert">{error}</div> : null}
    </section>
  )
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
      {step.before ? (
        <>
          <h3>Before</h3>
          <DataView data={step.before} />
        </>
      ) : null}
      <h3>After</h3>
      <DataView data={step.after} />
    </article>
  )
}

function DataView({ data }: { data: AliasedRow[] | Group[] }) {
  if (!data.length) return <p className="empty">No rows remain.</p>
  if ('rows' in data[0]) return <GroupedTableView groups={data as Group[]} />
  return <TableView rows={data as AliasedRow[]} />
}

function TableView({ rows }: { rows: AliasedRow[] }) {
  const columns = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row.values)))], [rows])
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>row</th>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.id.includes('__removed') ? 'removed-row' : ''}>
              <td><span className="alias-badge">{row.id.replace('__removed', '')}</span></td>
              {columns.map((column) => (
                <td key={column}>{String(row.values[column] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupedTableView({ groups }: { groups: Group[] }) {
  return (
    <div className="group-grid">
      {groups.map((group) => (
        <div className="group-bucket" key={group.id}>
          <div className="group-title">{group.key}</div>
          <TableView rows={group.rows} />
        </div>
      ))}
    </div>
  )
}

function TableBuilder({
  tableSql,
  tableError,
  onTableSqlChange,
  onApplyTableSql,
}: {
  tableSql: string
  tableError?: string
  onTableSqlChange: (value: string) => void
  onApplyTableSql: () => void
}) {
  return (
    <section className="table-builder" aria-label="Create table">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Tables</p>
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
          Apply Table SQL
        </button>
        {tableError ? <div className="error-box" role="alert">{tableError}</div> : null}
      </div>
    </section>
  )
}

function EmptyState() {
  return <p className="empty">Run a supported query to see the execution steps.</p>
}

export default App

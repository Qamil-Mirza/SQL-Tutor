import type { Table } from '../domain/types'
import { TableView } from './trace/TableView'

export function TablesPanel({
  tables,
  tableSql,
  tableError,
  open,
  onToggle,
  onTableSqlChange,
  onFormat,
  onApply,
}: {
  tables: Table[]
  tableSql: string
  tableError?: string
  open: boolean
  onToggle: (open: boolean) => void
  onTableSqlChange: (value: string) => void
  onFormat: () => void
  onApply: () => void
}) {
  const summary = tables.length
    ? `Tables: ${tables.map((table) => `${table.name} (${table.rows.length})`).join(', ')}`
    : 'Tables: none defined yet'
  return (
    <details className="tables-panel" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
      <summary>{summary}</summary>
      <section className="tables-body" aria-label="Table definitions">
        <label className="field-label" htmlFor="table-sql">Table SQL</label>
        <textarea className="table-sql-editor" id="table-sql" value={tableSql} onChange={(event) => onTableSqlChange(event.target.value)} spellCheck={false} />
        <div className="editor-actions">
          <button className="secondary-button" type="button" onClick={onApply}>Apply Tables</button>
          <button className="secondary-button" type="button" onClick={onFormat} aria-label="Format table SQL">Format</button>
        </div>
        {tableError ? <div className="error-box" role="alert">{tableError}</div> : null}
        <div className="table-preview-list" aria-label="Table previews">
          {tables.map((table) => (
            <section className="table-preview" key={table.name} aria-label={`${table.name} preview`}>
              <h3>{table.name} <span className="preview-count">{table.rows.length} rows</span></h3>
              <TableView
                rows={table.rows.map((row, index) => ({ id: String(index + 1), values: row, columns: table.columns }))}
                showBadges={false}
                emptyMessage="No rows inserted."
              />
            </section>
          ))}
        </div>
      </section>
    </details>
  )
}

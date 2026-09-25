import { highlightSql } from './highlightSql'

export function QueryEditor({
  sql,
  error,
  onSqlChange,
  onFormat,
  onRun,
  onShare,
}: {
  sql: string
  error?: string
  onSqlChange: (value: string) => void
  onFormat: () => void
  onRun: () => void
  onShare: () => void
}) {
  return (
    <section className="query-card" aria-label="SQL query">
      <label className="field-label" htmlFor="sql-editor">SQL query</label>
      <div className="sql-editor-shell">
        <pre className="sql-highlight" aria-hidden="true">{highlightSql(sql)}</pre>
        <textarea
          id="sql-editor"
          rows={rowsForQuery(sql)}
          value={sql}
          onChange={(event) => onSqlChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              onRun()
            }
          }}
          spellCheck={false}
        />
      </div>
      <div className="editor-actions">
        <button className="primary-button" type="button" onClick={onRun}>Run Query</button>
        <button className="secondary-button" type="button" onClick={onFormat} aria-label="Format query SQL">Format</button>
        <button className="secondary-button" type="button" onClick={onShare}>Share</button>
      </div>
      {error ? <div className="error-box" role="alert">{error}</div> : null}
    </section>
  )
}

function rowsForQuery(sql: string) {
  const visualRows = sql.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 72)), 0)
  return Math.min(18, Math.max(4, visualRows + 1))
}

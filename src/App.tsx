// src/App.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { executeQuery } from './domain/engine'
import { parseQuery } from './domain/parser'
import { initialTables, starterQuery } from './domain/samples'
import { createShareUrl, readShareSnapshot } from './domain/shareSnapshot'
import { formatSql } from './domain/sqlFormatter'
import { parseTableSql, serializeTables } from './domain/tableSql'
import type { ExecutionStep, Table } from './domain/types'
import { QueryEditor } from './ui/QueryEditor'
import { ShareModal } from './ui/ShareModal'
import { TablesPanel } from './ui/TablesPanel'
import { PinnedQuery } from './ui/trace/PinnedQuery'
import { StepPanel } from './ui/trace/StepPanel'
import { Timeline } from './ui/trace/Timeline'

const workspaceStorageKey = 'c88c-sql-tutor-workspace'

type Workspace = { tables: Table[]; tableSql: string; sql: string }

type InitialState = Workspace & { tableError?: string; isSharedSession: boolean }

function App() {
  const initial = useMemo(() => initializeState(), [])
  // Format before the first run so the pinned query and the saved workspace match what Run would produce.
  const initialSql = useMemo(() => formatSql(initial.sql), [initial.sql])
  const initialRun = useMemo(() => run(initialSql, initial.tables), [initialSql, initial.tables])
  const [tables, setTables] = useState(initial.tables)
  const [tableSql, setTableSql] = useState(initial.tableSql)
  const [tableError, setTableError] = useState(initial.tableError)
  const [sql, setSql] = useState(initialSql)
  const [tracedSql, setTracedSql] = useState(initialSql)
  const [error, setError] = useState(initialRun.error)
  const [steps, setSteps] = useState<ExecutionStep[]>(initialRun.steps)
  const [stepIndex, setStepIndex] = useState(0)
  const [tablesOpen, setTablesOpen] = useState(Boolean(initial.tableError) || initial.tables.length === 0)
  const [shareModal, setShareModal] = useState({ isOpen: false, shareUrl: '', copied: false })
  const [isSharedSession] = useState(initial.isSharedSession)
  const traceRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (isSharedSession) return
    try {
      window.localStorage.setItem(workspaceStorageKey, JSON.stringify({ tables, tableSql, sql }))
    } catch {
      // Storage unavailable (private mode, quota); the session still works without saving.
    }
  }, [tables, tableSql, sql, isSharedSession])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (steps.length === 0 || shareModal.isOpen) return
      if (event.altKey || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'ArrowRight') setStepIndex((value) => Math.min(steps.length - 1, value + 1))
      if (event.key === 'ArrowLeft') setStepIndex((value) => Math.max(0, value - 1))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [steps.length, shareModal.isOpen])

  function handleRun(nextSql = sql, nextTables = tables) {
    const formatted = formatSql(nextSql)
    const result = run(formatted, nextTables)
    setSql(formatted)
    setError(result.error)
    if (!result.error) {
      setSteps(result.steps)
      setTracedSql(formatted)
      setStepIndex(0)
      traceRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }
  }

  function handleApplyTables() {
    const formattedTableSql = formatSql(tableSql)
    setTableSql(formattedTableSql)
    try {
      const nextTables = parseTableSql(formattedTableSql)
      setTables(nextTables)
      setTableError(undefined)
      const formatted = formatSql(sql)
      const result = run(formatted, nextTables)
      setError(result.error)
      if (result.error) {
        setTablesOpen(true)
      } else {
        setSql(formatted)
        setTracedSql(formatted)
        setSteps(result.steps)
        setStepIndex(0)
        setTablesOpen(false)
      }
    } catch (caught) {
      setTableError(caught instanceof Error ? caught.message : 'The table SQL could not be applied.')
      setTablesOpen(true)
    }
  }

  function handleShare() {
    const shareUrl = createShareUrl({ origin: window.location.origin, snapshot: { version: 1, tableSql, sql } })
    void window.navigator.clipboard?.writeText(shareUrl)
    setShareModal({ isOpen: true, shareUrl, copied: false })
  }

  function handleCopy() {
    void window.navigator.clipboard?.writeText(shareModal.shareUrl)
    setShareModal((current) => ({ ...current, copied: true }))
  }

  const activeStep = steps[stepIndex]

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">SQL</span>
          <span className="brand-copy">
            <span className="brand-title">CSM C88C SQL Visualizer</span>
            <span className="brand-subtitle">See how SQL builds a result, one clause at a time.</span>
          </span>
        </div>
      </header>

      <QueryEditor sql={sql} error={error} onSqlChange={setSql} onFormat={() => setSql(formatSql(sql))} onRun={() => handleRun()} onShare={handleShare} />

      <TablesPanel
        tables={tables}
        tableSql={tableSql}
        tableError={tableError}
        open={tablesOpen}
        onToggle={setTablesOpen}
        onTableSqlChange={setTableSql}
        onFormat={() => setTableSql(formatSql(tableSql))}
        onApply={handleApplyTables}
      />

      <section className="trace" ref={traceRef} aria-labelledby="trace-heading">
        <h1 id="trace-heading" className="visually-hidden">Trace</h1>
        {steps.length ? (
          <>
            <PinnedQuery sql={tracedSql} clause={activeStep?.clause} />
            <Timeline steps={steps} stepIndex={stepIndex} onChange={(index) => setStepIndex(Math.max(0, Math.min(steps.length - 1, index)))} />
            {activeStep ? <StepPanel key={activeStep.id} step={activeStep} isLast={stepIndex === steps.length - 1} /> : null}
          </>
        ) : (
          <p className="empty">Run a supported query to see the execution steps.</p>
        )}
      </section>

      <ShareModal
        isOpen={shareModal.isOpen}
        shareUrl={shareModal.shareUrl}
        copied={shareModal.copied}
        onClose={() => setShareModal((current) => ({ ...current, isOpen: false, copied: false }))}
        onCopy={handleCopy}
      />
    </main>
  )
}

function initializeState(): InitialState {
  try {
    const shared = readShareSnapshot(window.location.search)
    if (shared) {
      return { tables: parseTableSql(shared.tableSql), tableSql: shared.tableSql, sql: shared.sql, isSharedSession: true }
    }
  } catch (caught) {
    return { ...loadWorkspace(), tableError: caught instanceof Error ? caught.message : 'The shared link is invalid.', isSharedSession: false }
  }
  const workspace = loadWorkspace()
  try {
    return { ...workspace, tables: parseTableSql(workspace.tableSql), isSharedSession: false }
  } catch (caught) {
    return { ...workspace, tableError: caught instanceof Error ? caught.message : 'The table SQL could not be applied.', isSharedSession: false }
  }
}

function loadWorkspace(): Workspace {
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey)
    if (!raw) throw new Error('No saved workspace')
    const parsed = JSON.parse(raw) as Partial<Workspace>
    if (!Array.isArray(parsed.tables) || typeof parsed.tableSql !== 'string' || typeof parsed.sql !== 'string') throw new Error('Invalid saved workspace')
    return { tables: parsed.tables, tableSql: parsed.tableSql, sql: parsed.sql }
  } catch {
    return { tables: initialTables, tableSql: serializeTables(initialTables), sql: starterQuery }
  }
}

function run(sql: string, tables: Table[]) {
  try {
    return { steps: executeQuery(parseQuery(sql), tables), error: undefined as string | undefined }
  } catch (caught) {
    return { steps: [] as ExecutionStep[], error: caught instanceof Error ? caught.message : 'The query could not be visualized.' }
  }
}

export default App

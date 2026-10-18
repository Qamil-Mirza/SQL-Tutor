import { useEffect, useState, type MouseEvent } from 'react'
import './Landing.css'

// Set to a form or mailto URL to show the Feedback button.
const feedbackUrl: string | undefined = undefined

const columns = ['id', 'name', 'tier', 'region']
const rows = [
  { id: 1, name: 'Ada', tier: 'pro', region: 'west' },
  { id: 2, name: 'Ben', tier: 'free', region: 'east' },
  { id: 3, name: 'Chen', tier: 'pro', region: 'east' },
  { id: 4, name: 'Dina', tier: 'free', region: 'west' },
]

// Clauses in the order they are written; `order` is the order SQL evaluates them.
const clauses = [
  { text: 'SELECT name, tier', order: 3, caption: 'Keep only the columns you asked for.' },
  { text: 'FROM users', order: 1, caption: 'Start with every row in users.' },
  { text: "WHERE tier = 'pro'", order: 2, caption: "Keep only rows where tier is 'pro'." },
]

const stageCount = clauses.length
const autoplayDelayMs = 2800

function prefersReducedMotion() {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type LandingProps = {
  explorePath: string
  onExplore: () => void
}

export function Landing({ explorePath, onExplore }: LandingProps) {
  return (
    <div className="landing">
      <main className="landing-main">
        <section className="landing-intro">
          <h1 className="landing-title">
            SQL <em>Visualizer</em>
          </h1>
          <p className="landing-lede">
            Built to help students in Berkeley&rsquo;s DATA C88C class understand how SQL manipulates tables and transforms them, one clause at a time.
          </p>
          <p className="landing-byline">
            By <a href="https://qamil-mirza.com">Qamil Mirza</a>
          </p>
          <div className="landing-actions">
            <a className="landing-explore" href={explorePath} onClick={(event) => handleNavigate(event, onExplore)}>
              Explore
              <span className="landing-explore-arrow" aria-hidden="true">→</span>
            </a>
            {feedbackUrl ? (
              <a className="landing-feedback" href={feedbackUrl} target="_blank" rel="noreferrer">
                Feedback
              </a>
            ) : null}
          </div>
        </section>

        <QueryDemo />
      </main>

      <footer className="landing-disclaimer">
        <p>
          <strong>Not affiliated with UC Berkeley or DATA C88C.</strong> This is an independent study aid and is not endorsed by the university or the course staff.
        </p>
      </footer>
    </div>
  )
}

function handleNavigate(event: MouseEvent<HTMLAnchorElement>, navigate: () => void) {
  // Let the browser handle new-tab and new-window clicks.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate()
}

function QueryDemo() {
  // `stage` is the number of clauses applied so far, counted in evaluation order (1 = FROM).
  const [stage, setStage] = useState(1)
  const [autoplay, setAutoplay] = useState(() => !prefersReducedMotion())

  useEffect(() => {
    if (!autoplay) return
    const timer = window.setInterval(() => setStage((current) => (current % stageCount) + 1), autoplayDelayMs)
    return () => window.clearInterval(timer)
  }, [autoplay])

  const active = clauses.find((clause) => clause.order === stage)!
  const rowIsOut = (row: (typeof rows)[number]) => stage >= 2 && row.tier !== 'pro'
  const columnIsOut = (column: string) => stage >= 3 && column !== 'name' && column !== 'tier'

  return (
    <figure className="landing-demo" aria-labelledby="landing-demo-label">
      <span id="landing-demo-label" className="visually-hidden">How a query runs</span>
      <p className="demo-legend">Written top to bottom. Runs in the numbered order.</p>
      <ol className="demo-query" aria-label="Query clauses, numbered in the order SQL runs them">
        {clauses.map((clause) => (
          <li key={clause.order}>
            <button
              type="button"
              className="demo-clause"
              aria-pressed={clause.order === stage}
              onClick={() => {
                setAutoplay(false)
                setStage(clause.order)
              }}
            >
              <code>{clause.text}</code>
              <span className="demo-order" aria-label={`runs ${ordinal(clause.order)}`}>
                {clause.order}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="demo-table-wrap">
        <table className="demo-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className={columnIsOut(column) ? 'is-out' : undefined}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={rowIsOut(row) ? 'is-out' : undefined}>
                {columns.map((column) => (
                  <td key={column} className={columnIsOut(column) ? 'is-out' : undefined}>
                    {row[column as keyof typeof row]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="demo-caption">
        <span className="demo-caption-step">
          Step {stage} of {stageCount}
        </span>
        {active.caption}
      </figcaption>
    </figure>
  )
}

function ordinal(order: number) {
  return ['first', 'second', 'third'][order - 1]
}

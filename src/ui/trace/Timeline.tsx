import { useEffect, useRef } from 'react'
import type { ExecutionStep } from '../../domain/types'

export function Timeline({
  steps,
  stepIndex,
  onChange,
}: {
  steps: ExecutionStep[]
  stepIndex: number
  onChange: (index: number) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  // Centre the active pill by scrolling the pill row only; scrollIntoView would also scroll the page.
  useEffect(() => {
    const list = listRef.current
    const pill = activeRef.current
    if (!list || !pill) return
    list.scrollLeft = Math.max(0, pill.offsetLeft - (list.clientWidth - pill.offsetWidth) / 2)
  }, [stepIndex])

  if (!steps.length) return null
  return (
    <nav className="timeline" aria-label="Execution timeline">
      <div className="timeline-controls">
        <button className="secondary-button" type="button" onClick={() => onChange(stepIndex - 1)} disabled={stepIndex === 0}>
          ← Back
        </button>
        <span className="timeline-position" aria-live="polite">Step {stepIndex + 1} of {steps.length}</span>
        <button className="secondary-button" type="button" onClick={() => onChange(stepIndex + 1)} disabled={stepIndex >= steps.length - 1}>
          Next →
        </button>
      </div>
      <ol className="step-list" ref={listRef}>
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              ref={index === stepIndex ? activeRef : undefined}
              className={index === stepIndex ? 'step-pill active' : 'step-pill'}
              aria-current={index === stepIndex ? 'step' : undefined}
              onClick={() => onChange(index)}
            >
              <span>{index + 1}</span>{' '}{step.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

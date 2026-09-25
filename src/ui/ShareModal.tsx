import { useEffect } from 'react'

export function ShareModal({
  isOpen,
  shareUrl,
  copied,
  onClose,
  onCopy,
}: {
  isOpen: boolean
  shareUrl: string
  copied: boolean
  onClose: () => void
  onCopy: () => void
}) {
  useEffect(() => {
    if (!isOpen) return undefined
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
        <button className="modal-close-button" type="button" aria-label="Close share dialog" onClick={onClose}>×</button>
        <h2 id="share-modal-title">Share link</h2>
        <label className="field-label" htmlFor="share-link">Share link</label>
        <input id="share-link" readOnly value={shareUrl} />
        <button className="secondary-button" type="button" onClick={onCopy}>Copy link</button>
        {copied ? <p className="copy-status" role="status">Copied</p> : null}
      </section>
    </div>
  )
}

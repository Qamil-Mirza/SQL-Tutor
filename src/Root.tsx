import { useEffect, useState } from 'react'
import App from './App'
import { hasShareSnapshot } from './domain/shareSnapshot'
import { Landing } from './ui/Landing'

const explorePath = '/explore'

// Share links predate the landing page and point at the root path, so they open the visualizer directly.
function showsLanding({ pathname, search }: Pick<Location, 'pathname' | 'search'>) {
  return pathname === '/' && !hasShareSnapshot(search)
}

function Root() {
  const [onLanding, setOnLanding] = useState(() => showsLanding(window.location))

  useEffect(() => {
    const sync = () => setOnLanding(showsLanding(window.location))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  function handleExplore() {
    window.history.pushState({}, '', explorePath)
    setOnLanding(false)
    window.scrollTo?.(0, 0)
  }

  return onLanding ? <Landing explorePath={explorePath} onExplore={handleExplore} /> : <App />
}

export default Root

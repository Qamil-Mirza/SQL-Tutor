import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

export type ShareSnapshot = {
  version: 1
  tableSql: string
  sql: string
  stepIndex?: number
}

const shareParamName = 'share'
const invalidShareMessage = 'The shared link is invalid.'

export function encodeShareSnapshot(snapshot: ShareSnapshot) {
  return compressToEncodedURIComponent(JSON.stringify(snapshot))
}

export function decodeShareSnapshot(payload: string): ShareSnapshot {
  try {
    const json = decompressFromEncodedURIComponent(payload)
    if (!json) throw new Error(invalidShareMessage)
    const parsed: unknown = JSON.parse(json)
    if (!isShareSnapshot(parsed)) throw new Error(invalidShareMessage)
    return parsed
  } catch {
    throw new Error(invalidShareMessage)
  }
}

export function createShareUrl({
  origin,
  snapshot,
}: {
  origin: string
  snapshot: ShareSnapshot
}) {
  const url = new URL('/query', origin)
  url.searchParams.set(shareParamName, encodeShareSnapshot(snapshot))
  return url.toString()
}

export function readShareSnapshot(search: string) {
  const payload = new URLSearchParams(search).get(shareParamName)
  if (!payload) return undefined
  return decodeShareSnapshot(payload)
}

function isShareSnapshot(value: unknown): value is ShareSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<ShareSnapshot>
  return (
    snapshot.version === 1 &&
    typeof snapshot.tableSql === 'string' &&
    typeof snapshot.sql === 'string' &&
    (snapshot.stepIndex === undefined || Number.isInteger(snapshot.stepIndex))
  )
}

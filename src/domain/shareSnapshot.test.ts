import { describe, expect, it } from 'vitest'
import { createShareUrl, decodeShareSnapshot, encodeShareSnapshot, type ShareSnapshot } from './shareSnapshot'

describe('shareSnapshot', () => {
  it('builds share links on the root path', () => {
    const url = new URL(createShareUrl({ origin: 'https://example.com', snapshot: { version: 1, tableSql: '', sql: 'SELECT 1' } }))

    expect(url.pathname).toBe('/')
  })

  it('round-trips a shared workspace snapshot', () => {
    const snapshot: ShareSnapshot = {
      version: 1,
      tableSql: "CREATE TABLE pets (id, name);\nINSERT INTO pets VALUES (1, 'Miso');",
      sql: 'SELECT p.name FROM pets AS p',
      stepIndex: 2,
    }

    const encoded = encodeShareSnapshot(snapshot)

    expect(encoded).not.toContain(snapshot.tableSql)
    expect(decodeShareSnapshot(encoded)).toEqual(snapshot)
  })

  it('rejects malformed share payloads', () => {
    expect(() => decodeShareSnapshot('not-a-valid-snapshot')).toThrow('The shared link is invalid.')
  })
})

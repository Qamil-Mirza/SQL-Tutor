import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import { initialTables, starterQuery } from './samples'
import { createShareUrl, decodeShareSnapshot, encodeShareSnapshot, type ShareSnapshot } from './shareSnapshot'
import { serializeTables } from './tableSql'

describe('shareSnapshot', () => {
  it('builds share links on the root path', () => {
    const url = new URL(createShareUrl({ origin: 'https://example.com', snapshot: { tableSql: '', sql: 'SELECT 1' } }))

    expect(url.pathname).toBe('/')
  })

  it('round-trips a shared workspace snapshot', () => {
    const snapshot: ShareSnapshot = {
      tableSql: "CREATE TABLE pets (id, name);\nINSERT INTO pets VALUES (1, 'Miso');",
      sql: 'SELECT p.name FROM pets AS p',
      stepIndex: 2,
    }

    const encoded = encodeShareSnapshot(snapshot)

    expect(encoded).not.toContain(snapshot.tableSql)
    expect(decodeShareSnapshot(encoded)).toEqual(snapshot)
  })

  it('round-trips text outside ASCII', () => {
    const snapshot: ShareSnapshot = {
      tableSql: "CREATE TABLE cafés (name);\nINSERT INTO cafés VALUES ('Zoë ☕');",
      sql: 'SELECT name FROM cafés',
    }

    expect(decodeShareSnapshot(encodeShareSnapshot(snapshot))).toEqual(snapshot)
  })

  it('keeps links short when the starter tables are shared', () => {
    const tableSql = serializeTables(initialTables)
    const groupedQuery = 'SELECT department, COUNT(*) AS n FROM employees GROUP BY department HAVING COUNT(*) > 1 ORDER BY n DESC'

    expect(encodeShareSnapshot({ tableSql, sql: starterQuery }).length).toBeLessThan(40)
    expect(encodeShareSnapshot({ tableSql, sql: groupedQuery }).length).toBeLessThan(120)
  })

  it('produces only characters that need no escaping in a URL', () => {
    const encoded = encodeShareSnapshot({ tableSql: serializeTables(initialTables), sql: "SELECT * FROM users WHERE name = 'Ada?&=#'" })

    expect(encoded).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('still opens links made with the original lz-string format', () => {
    const tableSql = 'CREATE TABLE t (a);\nINSERT INTO t VALUES (1);'
    const legacy = compressToEncodedURIComponent(JSON.stringify({ version: 1, tableSql, sql: 'SELECT a FROM t', stepIndex: 1 }))

    expect(decodeShareSnapshot(legacy)).toEqual({ tableSql, sql: 'SELECT a FROM t', stepIndex: 1 })
  })

  it('decodes a pinned version 2 payload, so the compression dictionary cannot change silently', () => {
    expect(decodeShareSnapshot('2.Q8vRBaklSMGP7kSwLHLI-mYW5wMzBMItIF0QF4DVQuwGCwJtBqtWigUA')).toEqual({
      tableSql: "CREATE TABLE pets (id, name);\nINSERT INTO pets VALUES (1, 'Miso');",
      sql: "SELECT name FROM pets WHERE name = 'Miso'",
    })
  })

  it('rejects malformed share payloads', () => {
    expect(() => decodeShareSnapshot('not-a-valid-snapshot')).toThrow('The shared link is invalid.')
    expect(() => decodeShareSnapshot('2.not-deflate')).toThrow('The shared link is invalid.')
    expect(() => decodeShareSnapshot('2.')).toThrow('The shared link is invalid.')
  })
})

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { decompressFromEncodedURIComponent } from 'lz-string'

export type ShareSnapshot = {
  tableSql: string
  sql: string
  stepIndex?: number
}

const shareParamName = 'share'
const invalidShareMessage = 'The shared link is invalid.'

// Version 2 payloads are "2." + base64url(raw DEFLATE of JSON [tableSql, sql, stepIndex?]).
// Payloads without the prefix are version 1 links, which lz-string compressed a JSON object.
const version2Prefix = '2.'

// DEFLATE primed with this text can point back into it, so the starter tables and common
// SQL cost a few bytes instead of hundreds. Every version 2 link depends on these exact
// bytes: never edit them. If the dictionary has to change, add a version 3 prefix instead.
const version2StarterTableSql = `CREATE TABLE users (id, name, tier, region);
INSERT INTO users VALUES (1, 'Ada', 'pro', 'west');
INSERT INTO users VALUES (2, 'Ben', 'free', 'east');
INSERT INTO users VALUES (3, 'Chen', 'pro', 'east');
INSERT INTO users VALUES (4, 'Dina', 'free', 'west');

CREATE TABLE listening (id, user_id, artist, minutes);
INSERT INTO listening VALUES (1, 1, 'Nina Simone', 55);
INSERT INTO listening VALUES (2, 1, 'Talking Heads', 35);
INSERT INTO listening VALUES (3, 2, 'Sade', 20);
INSERT INTO listening VALUES (4, 3, 'Bowie', 75);
INSERT INTO listening VALUES (5, 4, 'Bjork', 25);

CREATE TABLE employees (id, name, manager_id, department, salary);
INSERT INTO employees VALUES (1, 'Priya', NULL, 'ops', 150000);
INSERT INTO employees VALUES (2, 'Mateo', 1, 'ops', 98000);
INSERT INTO employees VALUES (3, 'Iris', 1, 'data', 112000);
INSERT INTO employees VALUES (4, 'Noor', 3, 'data', 91000);`
const version2StarterQuery = "SELECT u.name, u.tier FROM users AS u WHERE u.tier = 'pro' LIMIT 2"
const version2Vocabulary =
  ' ORDER BY DESC, ASC LIMIT HAVING COUNT(*) > MAX(MIN(SUM(AVG( IS NOT NULL AND GROUP BY WHERE JOIN ON = FROM SELECT * AS '
const version2Dictionary = strToU8(version2Vocabulary + JSON.stringify([version2StarterTableSql, version2StarterQuery]))

export function encodeShareSnapshot({ tableSql, sql, stepIndex }: ShareSnapshot) {
  const fields = stepIndex === undefined ? [tableSql, sql] : [tableSql, sql, stepIndex]
  const compressed = deflateSync(strToU8(JSON.stringify(fields)), { level: 9, dictionary: version2Dictionary })
  return version2Prefix + toBase64Url(compressed)
}

export function decodeShareSnapshot(payload: string): ShareSnapshot {
  try {
    const snapshot = payload.startsWith(version2Prefix)
      ? decodeVersion2(payload.slice(version2Prefix.length))
      : decodeVersion1(payload)
    if (!snapshot) throw new Error(invalidShareMessage)
    return snapshot
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
  const url = new URL('/', origin)
  url.searchParams.set(shareParamName, encodeShareSnapshot(snapshot))
  return url.toString()
}

export function hasShareSnapshot(search: string) {
  return new URLSearchParams(search).has(shareParamName)
}

export function readShareSnapshot(search: string) {
  const payload = new URLSearchParams(search).get(shareParamName)
  if (!payload) return undefined
  return decodeShareSnapshot(payload)
}

function decodeVersion2(encoded: string): ShareSnapshot | undefined {
  const json = strFromU8(inflateSync(fromBase64Url(encoded), { dictionary: version2Dictionary }))
  const fields: unknown = JSON.parse(json)
  if (!Array.isArray(fields) || fields.length < 2 || fields.length > 3) return undefined
  const [tableSql, sql, stepIndex] = fields as unknown[]
  return toShareSnapshot({ tableSql, sql, stepIndex })
}

function decodeVersion1(encoded: string): ShareSnapshot | undefined {
  const json = decompressFromEncodedURIComponent(encoded)
  if (!json) return undefined
  const parsed: unknown = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object') return undefined
  const { version, ...fields } = parsed as Record<string, unknown>
  return version === 1 ? toShareSnapshot(fields) : undefined
}

function toShareSnapshot({ tableSql, sql, stepIndex }: Record<string, unknown>): ShareSnapshot | undefined {
  if (typeof tableSql !== 'string' || typeof sql !== 'string') return undefined
  if (stepIndex === undefined) return { tableSql, sql }
  return Number.isInteger(stepIndex) ? { tableSql, sql, stepIndex: stepIndex as number } : undefined
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string) {
  if (!encoded) throw new Error(invalidShareMessage)
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

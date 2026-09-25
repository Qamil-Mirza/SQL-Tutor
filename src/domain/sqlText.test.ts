import { describe, expect, it } from 'vitest'
import {
  isQuotedString,
  maskStrings,
  matchOutsideStrings,
  replaceOutsideStrings,
  splitOutsideStrings,
  splitTopLevel,
  unquoteString,
} from './sqlText'

describe('sqlText', () => {
  it('masks string contents but keeps length and quote characters', () => {
    expect(maskStrings("a = 'FROM' AND b = \"x y\"")).toBe("a = '    ' AND b = \"   \"")
    expect(maskStrings("'it''s'")).toBe("'  '' '")
  })

  it('finds the first match outside strings', () => {
    const match = matchOutsideStrings("fur = 'a = b' AND x >= 2", /(>=|<=|=)/)
    expect(match).toEqual({ index: 4, text: '=', groups: ['='] })
    expect(matchOutsideStrings("name = 'x AS y'", /\s+AS\s+([a-z_]\w*)$/i)).toBeUndefined()
  })

  it('splits outside strings', () => {
    expect(splitOutsideStrings("fur = 'a AND b' AND height > 3", /\s+AND\s+/i)).toEqual(["fur = 'a AND b'", 'height > 3'])
    expect(splitOutsideStrings("SELECT 'x;y'; SELECT 1;", /;/)).toEqual(["SELECT 'x;y'", ' SELECT 1', ''])
  })

  it('replaces outside strings only', () => {
    expect(replaceOutsideStrings("select   'a  b'  from t", /\s+/g, () => ' ')).toBe("select 'a  b' from t")
    expect(replaceOutsideStrings("select 'from' from t", /\bfrom\b/gi, (word) => word.toUpperCase())).toBe("select 'from' FROM t")
  })

  it('handles delimiters between adjacent string literals', () => {
    expect(splitOutsideStrings("'a','b','c'", /,/)).toEqual(["'a'", "'b'", "'c'"])
    expect(matchOutsideStrings("'x' AND 'y'", /\s+AND\s+/i)).toEqual({ index: 3, text: ' AND ', groups: [] })
    expect(replaceOutsideStrings("'a','b'", /,/g, () => ' | ')).toBe("'a' | 'b'")
    expect(replaceOutsideStrings("x = 'a  b'", /\s+/g, () => ' ')).toBe("x = 'a  b'")
  })

  it('splits top-level commas outside parentheses and strings', () => {
    expect(splitTopLevel("a, MAX(b, c), 'd, e', (f + g) * 2")).toEqual(['a', 'MAX(b, c)', "'d, e'", '(f + g) * 2'])
    expect(splitTopLevel('a, b,')).toEqual(['a', 'b'])
  })

  it('unquotes literals and unescapes doubled single quotes', () => {
    expect(unquoteString("'it''s'")).toBe("it's")
    expect(unquoteString('"long"')).toBe('long')
    expect(isQuotedString("'x'")).toBe(true)
    expect(isQuotedString("'a' OR b = 'c'")).toBe(false)
  })
})

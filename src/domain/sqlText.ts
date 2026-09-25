export function maskStrings(text: string): string {
  let result = ''
  let quote: string | undefined
  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = undefined
        result += char
      } else {
        result += ' '
      }
      continue
    }
    if (char === "'" || char === '"') quote = char
    result += char
  }
  return result
}

function maskForMatching(text: string): string {
  let result = ''
  let quote: string | undefined
  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = undefined
        result += char
      } else {
        result += '\u0001'
      }
      continue
    }
    if (char === "'" || char === '"') quote = char
    result += char
  }
  return result
}

function globalize(pattern: RegExp) {
  return pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, `${pattern.flags}g`)
}

export function matchOutsideStrings(text: string, pattern: RegExp) {
  const match = maskForMatching(text).match(new RegExp(pattern.source, pattern.flags.replace('g', '')))
  if (!match || match.index === undefined) return undefined
  return { index: match.index, text: text.slice(match.index, match.index + match[0].length), groups: match.slice(1) }
}

export function splitOutsideStrings(text: string, separator: RegExp): string[] {
  const parts: string[] = []
  let last = 0
  for (const match of maskForMatching(text).matchAll(globalize(separator))) {
    parts.push(text.slice(last, match.index))
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return parts
}

export function replaceOutsideStrings(text: string, pattern: RegExp, replacer: (match: string) => string): string {
  let result = ''
  let last = 0
  for (const match of maskForMatching(text).matchAll(globalize(pattern))) {
    result += text.slice(last, match.index) + replacer(text.slice(match.index, match.index + match[0].length))
    last = match.index + match[0].length
  }
  return result + text.slice(last)
}

export function splitTopLevel(text: string, separator = ','): string[] {
  const masked = maskStrings(text)
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index]
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === separator && depth === 0) {
      parts.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  const tail = text.slice(start).trim()
  if (tail) parts.push(tail)
  return parts
}

export function isQuotedString(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 2) return false
  const quote = trimmed[0]
  if (quote !== "'" && quote !== '"') return false
  if (trimmed.at(-1) !== quote) return false
  // Masked, a single literal is a quote, then spaces (or doubled single quotes), then a quote.
  const masked = maskStrings(trimmed)
  return quote === "'" ? /^'(?: |'')*'$/.test(masked) : /^" *"$/.test(masked)
}

export function unquoteString(literal: string): string {
  const trimmed = literal.trim()
  const quote = trimmed[0]
  const inner = trimmed.slice(1, -1)
  return quote === "'" ? inner.replaceAll("''", "'") : inner
}

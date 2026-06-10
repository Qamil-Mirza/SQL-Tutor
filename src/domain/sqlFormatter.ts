const keywordPattern = /\b(CREATE|TABLE|INSERT|INTO|VALUES|SELECT|FROM|JOIN|ON|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|AS|AND|ASC|DESC|TRUE|FALSE|NULL)\b/gi
const clausePattern = /\b(FROM|JOIN|ON|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT)\b/gi

export function formatSql(input: string) {
  const statements = splitStatements(input)
  if (!statements.length) return ''

  const formatted = statements.map((statement) => formatStatement(statement.text, shouldTerminate(statement.text, statements.length, statement.hadTerminator)))
  return formatted.join('\n')
}

function shouldTerminate(statement: string, statementCount: number, hadTerminator: boolean) {
  if (statementCount > 1 || hadTerminator) return true
  return /^(CREATE|INSERT)\b/i.test(statement.trim())
}

function formatStatement(statement: string, terminate: boolean) {
  const normalized = uppercaseKeywords(normalizeWhitespace(statement))
  const formatted = /^SELECT\b/i.test(normalized) ? breakSelectClauses(normalized) : normalized
  return terminate ? `${formatted};` : formatted
}

function normalizeWhitespace(text: string) {
  return mapUnquoted(text.trim(), (part) => part.replace(/\s+/g, ' '))
}

function uppercaseKeywords(text: string) {
  return mapUnquoted(text, (part) => part.replace(keywordPattern, (keyword) => keyword.toUpperCase().replace(/\s+/g, ' ')))
}

function breakSelectClauses(text: string) {
  return mapUnquoted(text, (part) => part.replace(clausePattern, (keyword) => `\n${keyword.toUpperCase().replace(/\s+/g, ' ')}`))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function splitStatements(text: string) {
  const statements: Array<{ text: string; hadTerminator: boolean }> = []
  let current = ''
  let quote: string | undefined

  for (const char of text) {
    if (quote) {
      current += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === ';') {
      if (current.trim()) statements.push({ text: current.trim(), hadTerminator: true })
      current = ''
      continue
    }
    current += char
  }

  if (current.trim()) statements.push({ text: current.trim(), hadTerminator: false })
  return statements
}

function mapUnquoted(text: string, transform: (part: string) => string) {
  let result = ''
  let current = ''
  let quote: string | undefined

  for (const char of text) {
    if (quote) {
      current += char
      if (char === quote) {
        result += current
        current = ''
        quote = undefined
      }
      continue
    }
    if (char === "'" || char === '"') {
      result += transform(current)
      current = char
      quote = char
      continue
    }
    current += char
  }

  return result + (quote ? current : transform(current))
}

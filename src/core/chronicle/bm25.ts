export interface HybridCandidate {
  key: string
  score: number
  denseScore?: number
  bm25Score?: number
  rrfScore?: number
}

const BM25_K1 = 1.5
const BM25_B = 0.75

function pushCjkTokens(tokens: string[], segment: string): void {
  for (const char of segment) {
    tokens.push(char)
  }
  for (let i = 0; i < segment.length - 1; i++) {
    tokens.push(segment.slice(i, i + 2))
  }
}

export function tokenizeBm25(text: string): string[] {
  const normalized = String(text || '').toLowerCase()
  const tokens: string[] = []
  const pattern = /[a-z0-9_]+|[㐀-鿿]+/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(normalized)) !== null) {
    const part = match[0]
    if (!part) continue
    if (/^[㐀-鿿]+$/u.test(part)) {
      pushCjkTokens(tokens, part)
    } else {
      tokens.push(part)
    }
  }
  return tokens.filter((t) => t.length > 0)
}

interface Bm25Document {
  key: string
  tokens: string[]
  frequencies: Map<string, number>
}

interface Bm25Corpus {
  documents: Bm25Document[]
  documentFrequency: Map<string, number>
  averageDocumentLength: number
  documentCount: number
}

function buildCorpus(candidates: { key: string; text: string }[]): Bm25Corpus {
  const documentFrequency = new Map<string, number>()
  const documents = candidates.map((c) => {
    const tokens = tokenizeBm25(c.text)
    const frequencies = new Map<string, number>()
    for (const t of tokens) {
      frequencies.set(t, (frequencies.get(t) ?? 0) + 1)
    }
    for (const t of frequencies.keys()) {
      documentFrequency.set(t, (documentFrequency.get(t) ?? 0) + 1)
    }
    return { key: c.key, tokens, frequencies }
  })
  const totalLength = documents.reduce((sum, d) => sum + d.tokens.length, 0)
  return {
    documents,
    documentFrequency,
    averageDocumentLength: documents.length > 0 ? totalLength / documents.length : 0,
    documentCount: documents.length
  }
}

function scoreBm25Document(
  queryTokens: string[],
  doc: Bm25Document,
  corpus: Bm25Corpus
): number {
  if (queryTokens.length === 0 || corpus.documentCount === 0 || doc.tokens.length === 0) {
    return 0
  }
  let score = 0
  for (const token of queryTokens) {
    const tf = doc.frequencies.get(token) ?? 0
    if (tf <= 0) continue
    const df = corpus.documentFrequency.get(token) ?? 0
    const idf = Math.log(1 + (corpus.documentCount - df + 0.5) / (df + 0.5))
    const lengthNorm =
      1 - BM25_B + BM25_B * (doc.tokens.length / Math.max(1, corpus.averageDocumentLength))
    score += (idf * (tf * (BM25_K1 + 1))) / (tf + BM25_K1 * lengthNorm)
  }
  return score
}

export function sparseSearchBm25(
  query: string,
  candidates: { key: string; text: string }[],
  limit: number
): HybridCandidate[] {
  const queryTokens = tokenizeBm25(query)
  const normalizedLimit = Math.max(1, Math.floor(limit) || 1)
  if (queryTokens.length === 0 || candidates.length === 0) return []
  const corpus = buildCorpus(candidates)
  return corpus.documents
    .map((doc) => {
      const bm25Score = scoreBm25Document(queryTokens, doc, corpus)
      return { key: doc.key, score: bm25Score, bm25Score }
    })
    .filter((c) => (c.bm25Score ?? 0) > 0)
    .sort((a, b) => (b.bm25Score ?? 0) - (a.bm25Score ?? 0))
    .slice(0, normalizedLimit)
}

export function reciprocalRankFusion(
  resultLists: HybridCandidate[][],
  rrfK: number,
  limit: number
): HybridCandidate[] {
  const normalizedK = Math.max(1, Math.floor(rrfK) || 60)
  const normalizedLimit = Math.max(1, Math.floor(limit) || 1)
  const byKey = new Map<string, HybridCandidate>()
  for (const results of resultLists) {
    results.forEach((candidate, index) => {
      const prev = byKey.get(candidate.key)
      const rrfScore = 1 / (normalizedK + index + 1)
      byKey.set(candidate.key, {
        key: candidate.key,
        denseScore: prev?.denseScore ?? candidate.denseScore,
        bm25Score: prev?.bm25Score ?? candidate.bm25Score,
        rrfScore: (prev?.rrfScore ?? 0) + rrfScore,
        score: (prev?.rrfScore ?? 0) + rrfScore
      })
    })
  }
  return Array.from(byKey.values())
    .sort((a, b) => (b.rrfScore ?? 0) - (a.rrfScore ?? 0))
    .slice(0, normalizedLimit)
}

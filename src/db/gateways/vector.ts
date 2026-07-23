import type { VectorConfig } from '@shared/types/config'

export interface VectorGateway {
    embed(texts: string[], config: VectorConfig): Promise<number[][]>
    rerank(query: string, documents: string[], config: VectorConfig): Promise<number[]>
}

export default function createVectorGateway(): VectorGateway {
    return {
        async embed(texts, config) {
            if (!config.embeddingEndpoint || !config.embeddingModel) {
                throw new Error('embedding 配置不完整')
            }
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (config.embeddingApiKey) {
                headers.Authorization = `Bearer ${config.embeddingApiKey}`
            }
            const res = await fetch(config.embeddingEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ model: config.embeddingModel, input: texts }),
            })
            if (!res.ok) {
                const detail = await res.text().catch(() => res.statusText)
                throw new Error(`embedding 请求失败 ${res.status}: ${detail}`)
            }
            const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
            if (!Array.isArray(data.data)) {
                throw new Error('embedding 响应格式异常')
            }
            return data.data.map((d) => d.embedding ?? [])
        },

        async rerank(query, documents, config) {
            if (!config.rerankEndpoint || !config.rerankModel) {
                return documents.map((_, i) => i)
            }
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (config.rerankApiKey) {
                headers.Authorization = `Bearer ${config.rerankApiKey}`
            }
            const res = await fetch(config.rerankEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ model: config.rerankModel, query, documents }),
            })
            if (!res.ok) {
                throw new Error(`rerank 请求失败: ${res.status} ${await res.text()}`)
            }
            const data = (await res.json()) as {
                results?: Array<{ index?: number; relevance_score?: number }>
            }
            if (!Array.isArray(data.results)) {
                return documents.map((_, i) => i)
            }
            return data.results
                .map((r) => ({ index: r.index ?? 0, score: r.relevance_score ?? 0 }))
                .sort((a, b) => b.score - a.score)
                .map((r) => r.index)
        },
    }
}

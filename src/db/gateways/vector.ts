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
            const res = await fetch(config.embeddingEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.embeddingApiKey}`,
                },
                body: JSON.stringify({ model: config.embeddingModel, input: texts }),
            })
            if (!res.ok) {
                throw new Error(`embedding 请求失败：${res.status}`)
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
            const res = await fetch(config.rerankEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.rerankApiKey}`,
                },
                body: JSON.stringify({ model: config.rerankModel, query, documents }),
            })
            if (!res.ok) {
                throw new Error(`rerank 请求失败：${res.status}`)
            }
            const data = (await res.json()) as { results?: Array<{ index?: number; relevance_score?: number }> }
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

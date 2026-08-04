import { getRequestHeaders } from './host-context'
import { pushLog } from '@shared/log-buffer'

export interface FileStorageGateway {
  save(name: string, content: string): Promise<void>
  read(name: string): Promise<string | null>
  delete(name: string): Promise<void>
}

export default function createFileStorageGateway(): FileStorageGateway {
  return {
    async save(name, content) {
      const headers = getRequestHeaders()
      headers['Content-Type'] = 'application/json'
      const data = encodeBase64(content)
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, data })
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`文件保存失败 ${res.status}: ${detail}`)
      }
    },

    async read(name) {
      const url = `/user/files/${encodeURIComponent(name)}?t=${Date.now()}`
      const res = await fetch(url)
      if (!res.ok) {
        if (res.status === 404) {
          return null
        }
        throw new Error(`文件读取失败 ${res.status}`)
      }
      return await res.text()
    },

    async delete(name) {
      const headers = getRequestHeaders()
      headers['Content-Type'] = 'application/json'
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name })
      })
      if (!res.ok && res.status !== 404) {
        pushLog('warn', 'file-storage', `文件删除失败 ${res.status}: ${name}`)
      }
    }
  }
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary)
}

import type { ImageErrorCode } from '@renderer/lib/api/types'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'

export interface DrawRunImage {
  id: string
  src: string
  mediaType?: string
}

export interface DrawRunError {
  code: ImageErrorCode
  message: string
}

export interface DrawRun {
  id: string
  prompt: string
  providerName: string
  modelName: string
  createdAt: number
  isGenerating: boolean
  images: DrawRunImage[]
  error: DrawRunError | null
}

interface DrawRunRow {
  id: string
  prompt: string
  provider_name: string
  model_name: string
  created_at: number
  is_generating: number
  images_json: string
  error_json: string | null
}

function safeParseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeRun(run: DrawRun, interruptedMessage: string): DrawRun {
  if (!run.isGenerating) return run

  return {
    ...run,
    isGenerating: false,
    error:
      run.error ??
      (run.images.length === 0
        ? {
            code: 'request_aborted',
            message: interruptedMessage
          }
        : null)
  }
}

function fromRow(row: DrawRunRow, interruptedMessage: string): DrawRun {
  const run: DrawRun = {
    id: row.id,
    prompt: row.prompt,
    providerName: row.provider_name,
    modelName: row.model_name,
    createdAt: row.created_at,
    isGenerating: row.is_generating === 1,
    images: safeParseJson<DrawRunImage[]>(row.images_json, []),
    error: safeParseJson<DrawRunError | null>(row.error_json, null)
  }

  return normalizeRun(run, interruptedMessage)
}

export async function listPersistedDrawRuns(interruptedMessage: string): Promise<DrawRun[]> {
  const rows = (await ipcClient.invoke('db:draw-runs:list')) as DrawRunRow[]
  const runs = rows.map((row) => fromRow(row, interruptedMessage))

  await Promise.all(
    rows.map((row, index) => {
      if (row.is_generating !== 1) return Promise.resolve()
      return savePersistedDrawRun(runs[index]).catch(() => undefined)
    })
  )

  return runs
}

export async function savePersistedDrawRun(run: DrawRun): Promise<void> {
  await ipcClient.invoke('db:draw-runs:save', {
    id: run.id,
    prompt: run.prompt,
    providerName: run.providerName,
    modelName: run.modelName,
    createdAt: run.createdAt,
    isGenerating: run.isGenerating,
    imagesJson: JSON.stringify(run.images),
    errorJson: run.error ? JSON.stringify(run.error) : null,
    updatedAt: Date.now()
  })
}

export async function deletePersistedDrawRun(id: string): Promise<void> {
  await ipcClient.invoke('db:draw-runs:delete', id)
}

export async function clearPersistedDrawRuns(): Promise<void> {
  await ipcClient.invoke('db:draw-runs:clear')
}

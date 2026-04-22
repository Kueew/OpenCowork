import { useEffect, useState } from 'react'

export interface ImageDimensions {
  width: number
  height: number
}

const imageDimensionCache = new Map<string, ImageDimensions>()

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function isDataUrl(value: string): boolean {
  return value.startsWith('data:')
}

export function buildImageDimensionCacheKey(src: string, filePath?: string): string {
  return filePath?.trim() ? `file:${filePath}` : `src:${src}`
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex === -1) throw new Error('Invalid data URL')

  const metadata = dataUrl.slice(5, commaIndex)
  const data = dataUrl.slice(commaIndex + 1)
  const mimeType = metadata.split(';')[0] || 'application/octet-stream'

  if (metadata.includes(';base64')) {
    const binary = window.atob(data)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return new Blob([bytes], { type: mimeType })
  }

  return new Blob([decodeURIComponent(data)], { type: mimeType })
}

export function filePathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const withLeadingSlash =
    /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')
      ? `/${normalized.replace(/^\/+/, '')}`
      : `/${normalized}`
  return encodeURI(`file://${withLeadingSlash}`)
}

export function getCachedImageDimensions(
  src: string,
  filePath?: string,
  displaySrc?: string
): ImageDimensions | null {
  const sourceDimensions = imageDimensionCache.get(buildImageDimensionCacheKey(src, filePath))
  if (sourceDimensions) return sourceDimensions
  return displaySrc ? (imageDimensionCache.get(`display:${displaySrc}`) ?? null) : null
}

export function cacheImageDimensions(
  src: string,
  dimensions: ImageDimensions,
  options?: {
    filePath?: string
    displaySrc?: string
  }
): ImageDimensions {
  imageDimensionCache.set(buildImageDimensionCacheKey(src, options?.filePath), dimensions)
  if (options?.displaySrc) {
    imageDimensionCache.set(`display:${options.displaySrc}`, dimensions)
  }
  return dimensions
}

export function useImageDisplaySrc(src?: string, filePath?: string): string {
  const rawSrc = src ?? ''
  const sourceKey = buildImageDimensionCacheKey(rawSrc, filePath)
  const directSrc = (() => {
    if (filePath) return filePathToFileUrl(filePath)
    if (!rawSrc || isHttpUrl(rawSrc)) return ''
    if (rawSrc.startsWith('blob:') || rawSrc.startsWith('file://') || isDataUrl(rawSrc)) {
      return rawSrc
    }
    if (!isDataUrl(rawSrc) && !isHttpUrl(rawSrc)) return rawSrc
    return ''
  })()
  const fallbackSrc = isHttpUrl(rawSrc) ? rawSrc : ''
  const [displayState, setDisplayState] = useState<{ key: string; src: string }>({
    key: '',
    src: ''
  })
  const displaySrc = displayState.key === sourceKey ? displayState.src : ''

  useEffect(() => {
    let cancelled = false

    const cleanup = (): void => {
      cancelled = true
    }

    if (
      filePath ||
      !rawSrc ||
      rawSrc.startsWith('blob:') ||
      rawSrc.startsWith('file://') ||
      isDataUrl(rawSrc)
    ) {
      return cleanup
    }

    if (!isHttpUrl(rawSrc)) {
      return cleanup
    }

    void window.api
      .fetchImageBase64({ url: rawSrc })
      .then((result) => {
        if (cancelled) return
        if (result.data) {
          setDisplayState({
            key: sourceKey,
            src: `data:${result.mimeType || 'image/png'};base64,${result.data}`
          })
        }
      })
      .catch(() => undefined)

    return cleanup
  }, [filePath, rawSrc, sourceKey])

  return directSrc || displaySrc || fallbackSrc
}

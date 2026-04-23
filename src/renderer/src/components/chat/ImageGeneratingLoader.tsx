import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatDurationMs } from '@renderer/lib/format-duration'
import {
  buildImageDimensionCacheKey,
  cacheImageDimensions,
  getCachedImageDimensions,
  useImageDisplaySrc,
  type ImageDimensions
} from './use-image-display-src'

interface ImageGeneratingLoaderProps {
  previewSrc?: string
  previewFilePath?: string
  startedAt?: number
}

interface PlaceholderBarProps {
  widthClass: string
  delay?: number
}

const GRID_STYLE = {
  backgroundImage:
    'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
  backgroundSize: '24px 24px'
}

const SWEEP_TRANSITION = {
  duration: 2.8,
  repeat: Infinity,
  ease: 'linear' as const
}

const SHIMMER_TRANSITION = {
  duration: 1.9,
  repeat: Infinity,
  ease: 'linear' as const
}

function PlaceholderBar({ widthClass, delay = 0 }: PlaceholderBarProps): React.JSX.Element {
  return (
    <div className={`relative h-2.5 overflow-hidden rounded-full bg-white/10 ${widthClass}`}>
      <motion.div
        className="absolute inset-y-0 left-[-38%] w-[38%] bg-gradient-to-r from-transparent via-white/80 to-transparent"
        animate={{ x: ['0%', '420%'] }}
        transition={{ ...SHIMMER_TRANSITION, delay }}
      />
    </div>
  )
}

export function ImageGeneratingLoader({
  previewSrc,
  previewFilePath,
  startedAt
}: ImageGeneratingLoaderProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const previewDisplaySrc = useImageDisplaySrc(previewSrc, previewFilePath)
  const previewCacheSrc = previewSrc || previewDisplaySrc
  const previewDimensionKey = previewCacheSrc
    ? buildImageDimensionCacheKey(previewCacheSrc, previewFilePath)
    : ''
  const cachedPreviewDimensions = previewCacheSrc
    ? getCachedImageDimensions(previewCacheSrc, previewFilePath, previewDisplaySrc)
    : null
  const [previewDimensionState, setPreviewDimensionState] = useState<{
    key: string
    dimensions: ImageDimensions | null
  }>(() => ({
    key: previewDimensionKey,
    dimensions: cachedPreviewDimensions
  }))
  const previewDimensions =
    previewDimensionState.key === previewDimensionKey
      ? (previewDimensionState.dimensions ?? cachedPreviewDimensions)
      : cachedPreviewDimensions
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return

    const interval = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(interval)
  }, [startedAt])
  const liveElapsedMs = startedAt ? Math.max(0, now - startedAt) : 0

  const elapsedLabel =
    startedAt && liveElapsedMs > 0
      ? t('toolCall.imagePlugin.elapsed', { duration: formatDurationMs(liveElapsedMs) })
      : null

  const handlePreviewLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (!previewCacheSrc) return

      const { naturalWidth, naturalHeight, currentSrc } = event.currentTarget
      if (!naturalWidth || !naturalHeight) return

      const nextDimensions = { width: naturalWidth, height: naturalHeight }
      setPreviewDimensionState((current) => {
        if (
          current.key === previewDimensionKey &&
          current.dimensions?.width === nextDimensions.width &&
          current.dimensions?.height === nextDimensions.height
        ) {
          return current
        }
        return {
          key: previewDimensionKey,
          dimensions: cacheImageDimensions(previewCacheSrc, nextDimensions, {
            filePath: previewFilePath,
            displaySrc: currentSrc
          })
        }
      })
    },
    [previewCacheSrc, previewDimensionKey, previewFilePath]
  )

  return (
    <motion.div
      layout
      role="status"
      aria-live="polite"
      className="w-full max-w-[560px]"
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <div className="relative overflow-hidden rounded-[24px] border border-white/8 bg-[#343434] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.26)] sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0)_30%,rgba(0,0,0,0.12))]" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <motion.p
              className="max-w-[76%] text-base font-semibold text-white/92 sm:text-lg"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
            >
              {t('toolCall.imagePlugin.generating')}
            </motion.p>

            <div className="flex items-center gap-2 text-xs text-white/48">
              <motion.span
                className="h-1.5 w-1.5 rounded-full bg-emerald-200/90"
                animate={{ opacity: [0.38, 1, 0.38], scale: [0.88, 1.18, 0.88] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              />
              <span>{t('thinking.pending')}</span>
              {elapsedLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums text-white/60">{elapsedLabel}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/10 text-white/72">
            <Loader2 className="size-4 animate-spin" />
          </div>
        </div>

        <div className="relative mt-5 overflow-hidden rounded-[20px] border border-white/8 bg-black/18">
          <div
            className="relative min-h-[320px]"
            style={{
              aspectRatio: previewDimensions
                ? `${previewDimensions.width} / ${previewDimensions.height}`
                : '4 / 3'
            }}
          >
            {previewDisplaySrc ? (
              <>
                <img
                  src={previewDisplaySrc}
                  alt="Generating image preview"
                  className="absolute inset-0 h-full w-full scale-[1.03] object-cover opacity-24"
                  onLoad={handlePreviewLoad}
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,15,15,0.12),rgba(15,15,15,0.4)_52%,rgba(15,15,15,0.78))]" />
              </>
            ) : (
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(0,0,0,0.16))]" />
            )}

            <div className="absolute inset-0 opacity-55" style={GRID_STYLE} />

            <motion.div
              className="absolute inset-y-0 left-[-42%] w-[46%] -skew-x-12 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.03)_20%,rgba(255,255,255,0.18)_48%,rgba(255,255,255,0.34)_54%,rgba(255,255,255,0.06)_82%,transparent)] blur-2xl"
              animate={{ x: ['0%', '320%'] }}
              transition={SWEEP_TRANSITION}
            />

            <motion.div
              className="absolute inset-y-6 left-[-8%] w-px bg-white/90 shadow-[0_0_22px_rgba(255,255,255,0.65)]"
              animate={{
                x: ['0%', '620%'],
                opacity: [0, 1, 1, 0]
              }}
              transition={SWEEP_TRANSITION}
            />

            <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0))]" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,rgba(12,12,12,0),rgba(12,12,12,0.82)_72%,rgba(12,12,12,0.94))]" />

            <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
              <div className="space-y-3">
                <PlaceholderBar widthClass="w-[42%]" />
                <PlaceholderBar widthClass="w-[58%]" delay={0.12} />
                <PlaceholderBar widthClass="w-[34%]" delay={0.24} />
              </div>

              <div className="space-y-3">
                <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="absolute inset-y-0 left-0 origin-left rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.34),rgba(255,255,255,0.18),transparent)]"
                    style={{ width: '100%' }}
                    animate={{ scaleX: [0.2, 0.66, 0.4, 0.86, 0.52] }}
                    transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.div
                    className="absolute inset-y-0 left-[-28%] w-[28%] rounded-full bg-gradient-to-r from-transparent via-white/90 to-transparent"
                    animate={{ x: ['0%', '450%'] }}
                    transition={{ duration: 2.25, repeat: Infinity, ease: 'linear' }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-white/35">
                  <span>{t('thinking.pending')}</span>
                  <span>{t('toolCall.imagePlugin.generating')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

import type { APIProvider, ProviderConfig, ProviderType } from './types'

const providers = new Map<ProviderType, () => APIProvider>()
const globalPromptCacheKey =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `opencowork-${crypto.randomUUID()}`
    : `opencowork-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function registerProvider(type: ProviderType, factory: () => APIProvider): void {
  providers.set(type, factory)
}

export function createProvider(config: ProviderConfig): APIProvider {
  const factory = providers.get(config.type)
  if (!factory) {
    throw new Error(`Unknown provider type: ${config.type}`)
  }
  return factory()
}

export function getAvailableProviders(): ProviderType[] {
  return Array.from(providers.keys())
}

export function getGlobalPromptCacheKey(): string {
  return globalPromptCacheKey
}

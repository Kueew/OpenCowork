import type { BuiltinProviderPreset } from './types'

export const googlePreset: BuiltinProviderPreset = {
  builtinId: 'google',
  name: 'Google Gemini',
  type: 'openai-chat',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  homepage: 'https://ai.google.dev',
  apiKeyUrl: 'https://aistudio.google.com/apikey',
  defaultModels: [
    // Gemini 3 (preview)
    {
      id: 'gemini-3-pro-preview',
      name: 'Gemini 3 Pro Preview',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 2,
      outputPrice: 12
    },
    {
      id: 'gemini-3-flash-preview',
      name: 'Gemini 3 Flash Preview',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.5,
      outputPrice: 3
    },
    // Gemini 2.5
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 1.25,
      outputPrice: 10,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.3,
      outputPrice: 2.5,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    {
      id: 'gemini-2.5-flash-lite',
      name: 'Gemini 2.5 Flash-Lite',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.1,
      outputPrice: 0.4,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    // Gemini 2.0
    {
      id: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 8_192,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.1,
      outputPrice: 0.4
    },
    // Gemini image generation
    {
      id: 'gemini-3.1-flash-image-preview',
      name: 'Gemini 3.1 Flash Image Preview',
      icon: 'gemini',
      enabled: true,
      category: 'image',
      type: 'gemini',
      supportsVision: true,
      supportsFunctionCall: false
    },
    {
      id: 'gemini-3-pro-image-preview',
      name: 'Gemini 3 Pro Image Preview',
      icon: 'gemini',
      enabled: true,
      category: 'image',
      type: 'gemini',
      supportsVision: true,
      supportsFunctionCall: false
    }
  ]
}

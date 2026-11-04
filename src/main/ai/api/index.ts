/**
 * The HTTP routes: Sign in with ChatGPT and the OpenAI and Anthropic API keys.
 * All three keep their secrets in the store from src/main/secure/; the
 * ChatGPT route also needs a way to open the system browser.
 */
export { createChatGptProvider, type ChatGptProviderDeps } from '../chatgpt/chatgpt-provider'
export { createOpenAiKeyProvider, type OpenAiKeyProviderDeps } from './openai-key'
export { createAnthropicKeyProvider, type AnthropicKeyProviderDeps } from './anthropic-key'

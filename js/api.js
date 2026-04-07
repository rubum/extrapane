/**
 * api.js
 * Provider factory that determines which AI service to use 
 * based on the selected model name.
 */

import { geminiProvider } from './api/gemini.js';
import { ollamaProvider } from './api/ollama.js';

/**
 * Returns the appropriate AI provider object.
 * @param {string} modelName 
 */
export function getAIProvider(modelName) {
  if (modelName.startsWith('gemini')) {
    return geminiProvider;
  }

  if (modelName.startsWith('ollama')) {
    console.log('Using Ollama provider');
    return ollamaProvider;
  }

  // Default to Gemini for now
  return geminiProvider;
}

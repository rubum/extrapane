/**
 * api.js
 * Provider factory that determines which AI service to use 
 * based on the selected model name.
 */

import { geminiProvider } from './api/gemini.js';

/**
 * Returns the appropriate AI provider object.
 * @param {string} modelName 
 */
export function getAIProvider(modelName) {
  if (modelName.startsWith('gemini')) {
    return geminiProvider;
  }
  
  // Default to Gemini for now
  return geminiProvider;
}

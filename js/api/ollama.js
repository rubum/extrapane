/**
 * ollama.js
 * Implementation of the Ollama AI provider using its 
 * native /api/chat streaming API.
 */

import { state } from '../state.js';

export const ollamaProvider = {
  /**
   * Generates a streaming response from the Ollama API using native fetch.
   * Connects to the user's local Ollama instance (default: http://localhost:11434).
   */
  async *streamGenerateContent(baseUrl, model, history, promptParts, systemInstruction) {
    const url = `${baseUrl || 'http://localhost:11434'}/api/chat`;

    // Convert history and promptParts to Ollama-compatible messages
    const messages = [];

    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }

    history.forEach(msg => {
      messages.push({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.parts.map(p => p.text).join('\n')
      });
    });

    messages.push({
      role: 'user',
      content: promptParts.map(p => p.text || (p.inlineData ? '[Embedded Image]' : '')).join('\n')
    });

    const useModel = (model === 'ollama-default') ? (state.ollamaModel || 'gemma4:latest') : model.replace('ollama-', '');
    console.log(useModel, "useModel --");
    const body = {
      model: useModel,
      messages,
      stream: true,
      think: true
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    console.log(response, "response --");

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error(`Ollama connection blocked (403 Forbidden). Chrome extensions usually require 'OLLAMA_ORIGINS' to be set. Try running 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"' and restart Ollama.`);
      }
      throw new Error(`Ollama API request failed (Status: ${response.status}). Ensure Ollama is running and accessible at ${url}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep the last partial line in the buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          const text = chunk.message?.content;
          const thought = chunk.message?.thought || chunk.thought; // Support both
          const done = chunk.done;

          if (thought) {
            yield { thought };
          }
          if (text) {
            yield { text };
          }

          if (done) {
            // Ollama provides stats in the final chunk
            const usage = {
              promptTokenCount: chunk.prompt_eval_count || 0,
              candidatesTokenCount: chunk.eval_count || 0,
              totalTokenCount: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
            };
            yield { usage };
          }
        } catch (e) {
          console.error('Failed to parse Ollama chunk', e);
        }
      }
    }
  },

  /**
   * Generates a non-streaming summary of text using Ollama.
   */
  async generateSummary(baseUrl, model, textToSummarize) {
    const url = `${baseUrl || 'http://localhost:11434'}/api/chat`;
    const prompt = `Summarize the following conversation history concisely, preserving all key facts, decisions, and context. Do not omit crucial details. The summary should be written so that an AI reading it later will understand the full context of what has happened so far.\n\nConversation History:\n${textToSummarize}`;

    const useModel = (model === 'ollama-default') ? (state.ollamaModel || 'gemma4:latest') : model.replace('ollama-', '');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: useModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error("Failed to generate summary with Ollama");
    }

    const data = await response.json();
    return data.message?.content || "";
  },

  /** Cloud-specific methods (unused for local Ollama) */
  async listFiles() { return []; },
  async deleteFile() { return true; },
  async uploadFile() { throw new Error("File upload is not yet supported for Ollama provider."); },
  async getFileStatus() { throw new Error("File status is not applicable for Ollama."); }
};

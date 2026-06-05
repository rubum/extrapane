/**
 * gemini.js
 * Implementation of the Gemini AI provider using the 
 * Google Generative AI streaming API.
 */

const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

function getMimeType(file) {
  if (file.type) {
    if (file.type === 'audio/mp3') return 'audio/mpeg';
    return file.type;
  }
  
  const ext = file.name.split('.').pop().toLowerCase();
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'm4a': return 'audio/m4a';
    case 'ogg': return 'audio/ogg';
    case 'aac': return 'audio/aac';
    case 'flac': return 'audio/flac';
    case 'webm': return file.name.includes('audio') ? 'audio/webm' : 'video/webm';
    case 'mp4': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'avi': return 'video/x-msvideo';
    default: return 'application/octet-stream';
  }
}

export const geminiProvider = {
  /**
   * What: Generates a streaming response from the Gemini API using native fetch.
   * Why: This bypasses the need for a heavy SDK and allows us to manually parse out 
   *      the stream chunks to drive our UI streaming effect in real-time. It accepts 
   *      an array of parts (text + inlineData for images).
   */
  async *streamGenerateContent(apiKey, model, history, promptParts, systemInstruction) {
    const url = `${baseUrl}/models/${model}:streamGenerateContent?key=${apiKey}`;
    const sanitizedHistory = history.map(msg => ({
      role: msg.role,
      parts: msg.parts
    }));
    const contents = [...sanitizedHistory, { role: "user", parts: promptParts }];

    const body = { contents };
    if (systemInstruction) {
      body.system_instruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let errorMessage = `Gemini API request failed (Status: ${response.status})`;
      try {
        const rawData = await response.json();
        const errorData = Array.isArray(rawData) ? rawData[0]?.error : rawData.error;

        if (errorData) {
          // Specific handling for rate limits (429)
          if (response.status === 429) {
            let retryInfo = errorData.details?.find(d => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
            let delay = retryInfo?.retryDelay || "";
            errorMessage = `Rate limit exceeded. Please try again${delay ? ' in ' + delay : ' in a minute'}.`;
          } else {
            errorMessage = errorData.message || errorMessage;
          }
        }
      } catch (e) {
        console.error('Failed to parse Gemini error response', e);
      }
      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Process stream chunks
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Attempt to find valid JSON blocks in the buffer
      let startBracket = buffer.indexOf('[');
      let endBracket = buffer.lastIndexOf(']');

      if (startBracket !== -1 && endBracket !== -1) {
        const jsonStr = buffer.substring(startBracket, endBracket + 1);
        try {
          const chunks = JSON.parse(jsonStr);
          for (const chunk of chunks) {
            const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
            const usage = chunk.usageMetadata;

            if (text || usage) {
              yield { text, usage };
            }
          }
          buffer = buffer.substring(endBracket + 1);
        } catch (e) {
          // Wait for more data if JSON is incomplete
        }
      }
    }
  },

  /**
   * Performs a resumable file upload to Google's File API.
   * Useful for large videos that exceed inline limits.
   */
  async uploadFile(apiKey, file, onProgress) {
    const startUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
    const mimeType = getMimeType(file);

    // 1. Initial request to get upload URL
    const startResponse = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': file.size,
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: file.name } })
    });

    if (!startResponse.ok) {
      let detail = "";
      try {
        const errJson = await startResponse.json();
        detail = `: ${errJson.error?.message || JSON.stringify(errJson)}`;
      } catch (e) {
        try {
          detail = `: ${await startResponse.text()}`;
        } catch (inner) {}
      }
      throw new Error(`Failed to initialize upload${detail}`);
    }
    const uploadUrl = startResponse.headers.get('x-goog-upload-url');

    // 2. Perform the actual upload
    // We wrap this in a customized fetch-like promise to support progress tracking
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
      xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText).file);
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(file);
    });
  },

  /**
   * Polls the status of an uploaded file until it's ACTIVE or FAILED.
   */
  async getFileStatus(apiKey, fileUri) {
    const fileId = fileUri.split('/').pop();
    const url = `${baseUrl}/files/${fileId}?key=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch file status.");
    return await response.json();
  },

  /**
   * Lists all files uploaded to the Gemini API.
   */
  async listFiles(apiKey) {
    const url = `${baseUrl}/files?key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to list files.");
    const data = await response.json();
    return data.files || [];
  },

  /**
   * Deletes a file from the Gemini API.
   */
  async deleteFile(apiKey, fileUri) {
    const fileId = fileUri.split('/').pop();
    const url = `${baseUrl}/files/${fileId}?key=${apiKey}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error("Failed to delete file.");
    return true;
  },

  /**
   * Generates a non-streaming summary of text.
   * Used for background history compaction.
   */
  async generateSummary(apiKey, model, textToSummarize) {
    const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;
    const prompt = `Summarize the following conversation history concisely, preserving all key facts, decisions, and context. Do not omit crucial details. The summary should be written so that an AI reading it later will understand the full context of what has happened so far.\n\nConversation History:\n${textToSummarize}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "Failed to generate summary");
    }

    const data = await response.json();
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts.length > 0) {
      return data.candidates[0].content.parts[0].text;
    }
    throw new Error("Invalid response format from Gemini API");
  },

  /**
   * Generates an image using Imagen 3 model.
   */
  async generateImage(apiKey, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [
          {
            prompt: prompt
          }
        ],
        parameters: {
          sampleCount: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '1:1'
        }
      })
    });

    if (!response.ok) {
      let errorMessage = `Failed to generate image (Status: ${response.status})`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
      } catch (e) {
        try {
          const errorText = await response.text();
          if (errorText) errorMessage = errorText;
        } catch (inner) {}
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    // Support predictions array (standard for :predict)
    if (data.predictions && data.predictions.length > 0) {
      const firstPrediction = data.predictions[0];
      if (typeof firstPrediction === 'string') {
        return firstPrediction;
      }
      if (firstPrediction.bytesBase64Encoded) {
        return firstPrediction.bytesBase64Encoded;
      }
    }
    
    // Fallback/Legacy support for generatedImages just in case
    if (data.generatedImages && data.generatedImages.length > 0) {
      return data.generatedImages[0].image?.imageBytes || data.generatedImages[0].imageBytes;
    }
    
    throw new Error("No image returned from Gemini API");
  }
};

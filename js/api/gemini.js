/**
 * gemini.js
 * Implementation of the Gemini AI provider using the 
 * Google Generative AI streaming API.
 */

export const geminiProvider = {
  /**
   * What: Generates a streaming response from the Gemini API using native fetch.
   * Why: This bypasses the need for a heavy SDK and allows us to manually parse out 
   *      the stream chunks to drive our UI streaming effect in real-time. It accepts 
   *      an array of parts (text + inlineData for images).
   */
  async *streamGenerateContent(apiKey, model, history, promptParts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
    const sanitizedHistory = history.map(msg => ({
      role: msg.role,
      parts: msg.parts
    }));
    const contents = [...sanitizedHistory, { role: "user", parts: promptParts }];
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
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
    
    // 1. Initial request to get upload URL
    const startResponse = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': file.size,
        'X-Goog-Upload-Header-Content-Type': file.type,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: file.name } })
    });

    if (!startResponse.ok) throw new Error("Failed to initialize upload.");
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
    const url = `https://generativelanguage.googleapis.com/v1beta/files/${fileId}?key=${apiKey}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch file status.");
    return await response.json();
  },

  /**
   * Lists all files uploaded to the Gemini API.
   */
  async listFiles(apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
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
    const url = `https://generativelanguage.googleapis.com/v1beta/files/${fileId}?key=${apiKey}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error("Failed to delete file.");
    return true;
  }
};

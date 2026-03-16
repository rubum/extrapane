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
    const contents = [...history, { role: "user", parts: promptParts }];
    
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
            if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
              yield chunk.candidates[0].content.parts[0].text;
            }
          }
          buffer = buffer.substring(endBracket + 1);
        } catch (e) {
          // Wait for more data if JSON is incomplete
        }
      }
    }
  }
};

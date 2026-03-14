/**
 * gemini.js
 * Implementation of the Gemini AI provider using the 
 * Google Generative AI streaming API.
 */

export const geminiProvider = {
  /**
   * Generates a streaming response from Gemini.
   * Handles JSON chunk parsing and robust error extraction.
   */
  async *streamGenerateContent(apiKey, model, history, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
    const contents = [...history, { role: "user", parts: [{ text: prompt }] }];
    
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

/**
 * prompts.js
 * Centralizes system instructions and logic for building 
 * context-aware prompts for the AI.
 */

export const SYSTEM_INSTRUCTIONS = `
You are Extrapane AI, a helpful and efficient web assistant. 
Your goal is to provide concise, accurate, and insightful information based on the webpage context provided to you.

STRICT FORMATTING RULE: 
1. Use ONLY Markdown for formatting (bold, italics, lists, headers, etc.). 
2. NEVER use raw HTML tags (like <p>, <ul>, <li>, <b>, <strong>, etc.) in your responses.
3. For lists, use standard Markdown hyphens (-) or numbers (1.).
4. Use DOUBLE NEWLINES (\n\n) between all paragraphs, list items, and sections to ensure proper rendering.
`;

export const CHART_INSTRUCTIONS = `
DECISION RULE: Use interactive charts ONLY when there is significant numerical data, trends, or comparisons that would benefit from visual representation. 
Do NOT generate a chart if:
- The user is asking a basic factual question with no data.
- The response is purely descriptive or conversational.
- The data is too simple for a chart (e.g., just one or two values).

To generate a chart, use a code block with language 'chart'. The content MUST be valid JSON for Chart.js v4 (type, data, options).
Example:
\`\`\`chart
{
  "type": "bar",
  "data": {
    "labels": ["A", "B"],
    "datasets": [{"label": "Data", "data": [10, 20]}]
  },
  "options": { "responsive": true }
}
\`\`\`
`;

/**
 * What: Combines system rules, current webpage context, and user question 
 *       into an array of Gemini API Parts.
 * Why: The Gemini API expects an array of "parts" for a multimodal prompt. 
 *      We need to send text, and optionally inline data objects for images 
 *      extracted from the webpage context.
 */
export function buildPrompt(userQuestion, contexts) {
  let contextText = "";
  let parts = [];

  if (contexts && contexts.length > 0) {
    contextText = "CONTEXT FROM WEBPAGE ELEMENTS:\n" +
      contexts.map(c => `[Element]: ${c.text}`).join("\n") + "\n\n";

    // Add image parts for any context that includes base64 strings
    contexts.forEach(c => {
      // Handle the new array format from main.js
      if (c.base64Images && c.base64Images.length > 0) {
        c.base64Images.forEach(img => {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.base64
            }
          });
        });
      }
    });
  }

  const currentDate = new Date().toLocaleString();
  const dynamicSystemInstructions = `${SYSTEM_INSTRUCTIONS}\n\nCurrent Date and Time: ${currentDate}. Keep this in mind for relative time context (e.g. knowing if an event is today, yesterday, or in the future).`;

  const textPrompt = `${dynamicSystemInstructions}\n\n${CHART_INSTRUCTIONS}\n\n${contextText}User Question: ${userQuestion}`;

  // The system rules and text context are added as the first text part.
  parts.unshift({ text: textPrompt });

  return parts;
}

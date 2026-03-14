/**
 * prompts.js
 * Centralizes system instructions and logic for building 
 * context-aware prompts for the AI.
 */

export const SYSTEM_INSTRUCTIONS = `
You are Extrapane AI, a helpful and efficient web assistant. 
Your goal is to provide concise, accurate, and insightful information based on the webpage context provided to you.
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
 * Combines system rules, current webpage context, and user question 
 * into a single unified prompt.
 */
export function buildPrompt(userQuestion, contexts) {
  let contextText = "";
  if (contexts && contexts.length > 0) {
    contextText = "CONTEXT FROM WEBPAGE ELEMENTS:\n" + 
      contexts.map(c => `[Element]: ${c.text}`).join("\n") + "\n\n";
  }
  
  return `${SYSTEM_INSTRUCTIONS}\n\n${CHART_INSTRUCTIONS}\n\n${contextText}User Question: ${userQuestion}`;
}

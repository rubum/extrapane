<div align="center">
  <img src="icon128.png" width="128" height="128" alt="Extrapane AI Logo">
  <h1>Extrapane AI</h1>
  <p><strong>A Modern, Context-Aware Intelligent Web Companion</strong></p>
  <p>
    <img src="https://img.shields.io/badge/Chrome-Extension-blue.svg" alt="Chrome Extension">
    <img src="https://img.shields.io/badge/AI-Powered-orange.svg" alt="AI Powered">
    <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License MIT">
  </p>
</div>

---

**Extrapane AI** is a minimalist, high-performance browser extension designed to bridge the gap between static web content and intelligent analysis. By allowing users to seamlessly extract DOM elements and inject them into a conversational AI context, Extrapane transforms the way you interact with information on the web.

## ✨ Key Features

- 🎯 **Precision DOM Extraction**: Enter "Extract Mode" to hover and click elements. Extrapane intelligently captures text and metadata from the page.
- 💬 **Context-Aware Analytics**: Chat with Google's Gemini models using the captured elements as direct context. No more copy-pasting required.
- 📊 **Dynamic Visualizations**: If the AI detects numerical trends or comparisons, it can automatically render interactive **Chart.js** visualizations directly in the chat.
- 💅 **Premium Interface**: A sleek, glassmorphism-inspired UI with smooth micro-animations, autoscrolling, and full support for Light/Dark themes.
- 🛠️ **Robust Error Handling**: Specific, user-friendly feedback for API issues, including detailed retry logic for rate-limited (429) requests.
- 📝 **Message Persistence**: Your conversation history and context chips are automatically saved to local storage, ensuring you never lose your progress.

## 🚀 Installation

1.  **Clone** this repository to your local machine.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **"Developer mode"** (top right toggle).
4.  Click **"Load unpacked"** and select the `Extrapane` root directory.
5.  Pin the extension for quick access!

## 🛠️ Getting Started

1.  **Configure API**: Open the side panel, click the gear icon (Settings), and enter your **Gemini API Key**.
2.  **Extract Context**: Click the **(+)** icon at the bottom. The webpage will enter selection mode. Hover over any element and click to "chip" it into your context.
3.  **Chat**: Ask questions like *"Summarize this data"* or *"What are the main points here?"*. 
4.  **Visualize**: If you're analyzing data, try asking *"Can you show this as a bar chart?"*.

## 🏗️ Technical Architecture

Extrapane is built with performance and maintainability in mind:

- **Core**: Vanilla JavaScript (ES6+) for maximum speed and zero dependencies in the core logic.
- **Background Layer**: Handles the orchestration between content scripts and the side panel.
- **UI Engine**: Custom CSS with CSS variables for dynamic theming and glassmorphism effects.
- **API Layer**: Robust streaming implementation for Gemini, featuring robust JSON chunk parsing and error recovery.

## 📦 Dependencies

- **[Gemini API](https://ai.google.dev/)**: Powering the core intelligence.
- **[Marked.js](https://marked.js.org/)**: High-performance Markdown rendering.
- **[Chart.js](https://www.chartjs.org/)**: Interactive data visualization.
- **[Highlight.js](https://highlightjs.org/)**: Beautiful syntax highlighting for code snippets.

---

<div align="center">
  <sub>Built for the modern web. Licensed under MIT.</sub>
</div>

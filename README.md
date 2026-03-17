<div align="center">
  <img src="icon128.png" width="128" height="128" alt="Extrapane AI Logo">
  <h1>Extrapane AI</h1>
  <p><strong>The Web's Premier Intelligence Layer for Extraction, Analysis, and Composition</strong></p>
  <p>
    <img src="https://img.shields.io/badge/Chrome-Extension-blue.svg" alt="Chrome Extension">
    <img src="https://img.shields.io/badge/AI-Powered-orange.svg" alt="AI Powered">
    <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License MIT">
  </p>
</div>

---

**Extrapane AI** is an elite browser extension designed to transform the static web into a dynamic workspace. It orchestrates a sophisticated pipeline that moves from **seamless data extraction** to **deep multi-modal analysis**, and finally to **professional-grade composition**. Whether you are synthesising research, auditing financial data, or drafting complex documents, Extrapane bridges the gap between raw web signals and finished intelligence.

## 🌟 The Extrapane Cycle: Extract, Analyze, Compose

Extrapane is built around a powerful three-stage workflow that redefines your relationship with web data:

1. **Precision Extraction** 🎯  
   Move beyond manual copy-pasting. Use **Extract Mode** to point-and-click directly on DOM elements, PDFs, and images. Extrapane captures the underlying structure and metadata, turning any webpage into structured context for the AI.

2. **Deep-Context Analysis** 💬  
   Leverage the power of Gemini AI to query your extracted data. Perform cross-source synthesis, identify trends in massive data tables, and visualize findings with **Elite Charting**. Extrapane doesn't just "chat"—it interrogates the data you feed it.

3. **High-Fidelity Composition** 🎨  
   Transform analysis into action. Use the **Extrapane Canvas** to generate professional articles, resumes, technical diagrams (Mermaid), and interactive mini-apps. Export your creations to PDF or Word, ready for delivery.
- **🔍 Research Consolidation**: "Chip" multiple elements from different articles into your context. Ask the AI to *"Synthesize a summary of all these sources"* or *"Identify conflicting viewpoints between these authors"*.
- **📐 Complex Problem Solving**: Capture math formulas or logic problems and see them rendered beautifully via **LaTeX**.
- **🗺️ Process Mapping**: Describe a workflow or system and have the AI generate a **Mermaid.js** diagram (flowchart, sequence, etc.) instantly.

## ✨ Key Features

- 🎯 **Deep Web PDF Discovery**: Intelligent detection of specialized PDF viewers (like **arXiv**) including support for `original-url` and Shadow DOM extraction.
- 💬 **Context-Aware Analytics**: Chat with Google's Gemini models using captured elements as direct context. No more copy-pasting required.
- 📑 **Multi-Tab Support**: Manage several chat sessions concurrently with independent history and context.
- 📁 **File Upload Support**: Upload **PDFs, Images, and Text files** directly to provide rich context.
- 🎨 **Extrapane Canvas**: A dedicated, full-screen rendering space for high-fidelity document generation.
- 💾 **Unlimited Storage**: Leverages `unlimitedStorage` permissions to handle massive PDF contexts and long histories without 5MB limits.
- 🏗️ **Robust Connectivity**: Professional-grade PING/PONG handshake and background relay ensure content scripts are always injected and ready.
- 📊 **Premium Visualizations**: Automated high-fidelity **Chart.js v4** rendering with sophisticated typography (Inter) and elegant tooltips.
- 🛠️ **Error Recovery**: specific retry logic for rate-limited (429) requests and connectivity issues.

## 🚀 Installation

1.  **Clone** this repository to your local machine.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **"Developer mode"** (top right toggle).
4.  Click **"Load unpacked"** and select the `Extrapane` root directory.
5.  Pin the extension for quick access!

## 🛠️ Getting Started

1.  **Configure API**: Open the side panel, click the gear icon (Settings), and enter your **Gemini API Key**.
2.  **Extract Context**: Click the **(+)** icon to enter element selection mode, or the **📄 Document Icon** to instantly pull in a page PDF.
3.  **Renaming Tabs**: Double-click any tab title in the side rail to give it a custom name for better organization.
4.  **Visualize**: Ask *"Show me a comparison chart"* to see the new elite visualization engine in action.

## 🏗️ Technical Architecture

Extrapane is built with performance and maintainability in mind:

- **Core**: Vanilla JavaScript (ES6+) for maximum speed and zero dependencies in the core logic.
- **Robust Relay**: Background logic ensures the content script environment is prepared before any extraction command is issued.
- **UI Engine**: Custom CSS variables for dynamic theming and glassmorphism effects.
- **Styling**: Locally bundled **Tailwind CSS** engine for high-fidelity, CSP-compliant design.
- **API Layer**: Robust streaming implementation for Gemini, featuring robust JSON chunk parsing and automatic error recovery.

## 📦 Dependencies

- **[Gemini API](https://ai.google.dev/)**: Powering the core intelligence.
- **[Marked.js](https://marked.js.org/)**: High-performance Markdown rendering.
- **[Chart.js v4](https://www.chartjs.org/)**: Premium data visualization.
- **[KaTeX](https://katex.org/)**: Fast math typesetting.
- **[Mermaid.js](https://mermaid.js.org/)**: Diagramming and charting tool.
- **[Highlight.js](https://highlightjs.org/)**: Beautiful syntax highlighting.

## 📂 Project Structure

```text
Extrapane/
├── background.js       # Extension service worker (Injection & Relay)
├── content.js          # DOM extraction & PDF detection
├── manifest.json       # Config & Unlimited Storage permissions
├── sidepanel.html      # Main high-fidelity chat interface
├── sidepanel.css       # Premium glassmorphism styles
├── js/
│   ├── chat.js         # Premium rendering & markdown
│   ├── main.js         # Tab management & extraction flow
│   ├── prompts.js      # Elite visualization instructions
│   ├── state.js        # Unlimited storage management
│   └── ui.js           # UI utilities & element references
├── lib/                # Locally bundled dependencies
│   └── tailwind.min.js
├── icons/              # Brand assets
```

---

<div align="center">
  <sub>Built for the modern web. Licensed under MIT.</sub>
</div>

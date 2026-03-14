# Extrapane AI (Panelat)

Extrapane AI is a minimalist browser extension that allows you to extract and chat with any webpage content using Google's Gemini AI.

## Features

- **Element Selection**: Hover and click to extract text, images, or elements from any website.
- **Context-Aware Chat**: Chat with Gemini about the specific content you've extracted.
- **Smart Visualizations**: Automatically generates charts (bar, line, etc.) if the AI provides data in a specific format.
- **Response Layout**: Immersive "Responding" status indicators that fit naturally into the chat flow.
- **Premium UI**: Modern glassmorphism design with support for both light and dark modes.

## Installation

1. Clone this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable "Developer mode" in the top right.
4. Click "Load unpacked" and select the project directory.

## Getting Started

1. Click the **(+)** icon in the input area to enter Extract Mode.
2. Click on elements you want to analyze.
3. Press **Esc** to finish selecting.
4. Type your query in the chat input and interact with Gemini.

## Tech Stack

- **HTML/CSS**: Vanilla web technologies for the side panel.
- **JavaScript**: Modular background scripts, content scripts, and side panel logic.
- **Marked.js**: For rendering markdown in chat messages.
- **Highlight.js**: For syntax highlighting in code blocks.
- **Chart.js**: For dynamic data visualization.

## License

MIT

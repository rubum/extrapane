import { state } from './state.js';

let isPlaying = false;
let currentText = "";
let currentAudio = null;

/**
 * Cleans the given text to ensure high audio quality playback.
 * Removes URLs, Markdown syntax, HTML tags, bracket tags, and excessive whitespace.
 * 
 * @param {string} text - The raw text to clean.
 * @returns {string} - The cleaned text ready for speech.
 */
export function cleanTextForSpeech(text) {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, " ");

  // 2. Remove HTML tags
  cleaned = cleaned.replace(/<\/?[^>]+(>|$)/g, " ");

  // 3. Remove Markdown image/link syntax like ![alt](url) or [text](url)
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1 ");

  // 4. Remove standalone bracketed tags like [Image], [Video], [Icon]
  cleaned = cleaned.replace(/\[.*?\]/g, " ");

  // 5. Remove Markdown formatting characters (**, __, #, *, _, `)
  cleaned = cleaned.replace(/[*_#`~]+/g, " ");

  // 6. Add slight pauses after sentences and list items
  // Replace standalone punctuation like bullet points with a slight pause
  cleaned = cleaned.replace(/^\s*[-*•]\s+/mg, " ... ");

  // Ensure punctuation is followed by a space for natural pauses
  cleaned = cleaned.replace(/([.!?;:])(?=[^\s])/g, "$1 ");

  // 7. Replace multiple newlines and spaces with a single space or pause phrase
  cleaned = cleaned.replace(/\s+/g, " ");

  // 8. Handle common symbols that might sound robotic
  cleaned = cleaned.replace(/&/g, " and ");
  cleaned = cleaned.replace(/%/g, " percent ");

  // 9. Trim edges
  return cleaned.trim();
}

/**
 * Finds the best available Chrome TTS voice.
 * Priority: Google US English, Google UK English Female, Alex (macOS), Samantha (macOS).
 * 
 * @param {function} callback - Callback with the selected voice name.
 */
function getBestVoice(callback) {
  chrome.tts.getVoices(function (voices) {
    const priority = [
      "Google US English",
      "Google UK English Female",
      "Alex",
      "Samantha",
      "Victoria",
      "Daniel"
    ];

    let selectedVoice = null;

    // Try to find a voice by exact name priority
    for (const name of priority) {
      selectedVoice = voices.find(v => v.voiceName === name);
      if (selectedVoice) break;
    }

    // Fallback: search for any "Google" voice (usually high quality)
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.voiceName.includes("Google") && v.lang.startsWith("en"));
    }

    // Fallback: any English voice
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang.startsWith("en"));
    }

    callback(selectedVoice ? selectedVoice.voiceName : null);
  });
}

/**
 * Synthesizes speech using Google Cloud TTS (Gemini-powered).
 */
async function speakGCTTS(text, stylingPrompt, onStart, onEnd) {
  const region = state.gcloudRegion || 'global';
  const apiEndpoint = region === 'global'
    ? 'texttospeech.googleapis.com'
    : `${region}-texttospeech.googleapis.com`;

  const url = `https://${apiEndpoint}/v1/text:synthesize?key=${state.gcloudApiKey}`;

  // Clean text slightly less aggressively for GCTTS as it handles punctuation better
  const cleaned = text.trim();

  const headers = { 'Content-Type': 'application/json' };
  if (state.gcloudProjectId) {
    headers['x-goog-user-project'] = state.gcloudProjectId;
  }

  const body = {
    input: {
      text: cleaned,
      prompt: stylingPrompt || ""
    },
    voice: {
      languageCode: "en-US",
      name: state.ttsModel.includes('flash') ? "Kore" : "Charon",
      modelName: state.ttsModel
    },
    audioConfig: {
      audioEncoding: "MP3"
    }
  };

  try {
    if (onStart) onStart();

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message || `GCTTS error: ${response.status}`);
    }

    const data = await response.json();
    const audioContent = data.audioContent;

    const audioBlob = b64toBlob(audioContent, 'audio/mp3');
    const audioUrl = URL.createObjectURL(audioBlob);

    if (currentAudio) {
      currentAudio.pause();
    }

    currentAudio = new Audio(audioUrl);
    currentAudio.onended = () => {
      isPlaying = false;
      if (onEnd) onEnd();
      URL.revokeObjectURL(audioUrl);
    };
    currentAudio.onerror = (e) => {
      console.error("Audio playback error", e);
      isPlaying = false;
      if (onEnd) onEnd();
    };

    currentAudio.play();
  } catch (err) {
    console.error("GCTTS synthesis failure, falling back to Chrome TTS", err);
    // Fallback to Chrome TTS if GCTTS fails
    speakChromeTTS(text, null, onEnd);
  }
}

/**
 * Standard Chrome TTS synthesis.
 */
function speakChromeTTS(text, onStart, onEnd) {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) {
    if (onEnd) onEnd();
    return;
  }

  if (onStart) onStart();

  getBestVoice(function (voiceName) {
    chrome.tts.speak(cleaned, {
      voiceName: voiceName,
      rate: 0.9,
      pitch: 1.0,
      onEvent: function (event) {
        if (['end', 'interrupted', 'cancelled', 'error'].includes(event.type)) {
          isPlaying = false;
          if (onEnd) onEnd();
        }
      }
    });
  });
}

/**
 * Starts speaking the provided text.
 * Uses Google Cloud TTS if an API key is provided, otherwise falls back to Chrome TTS.
 * 
 * @param {string} text - The text to speak.
 * @param {string} stylingPrompt - Optional instructions on how to synthesize the content.
 * @param {function} onStart - Optional callback when speaking starts.
 * @param {function} onEnd - Optional callback when speaking ends or is stopped.
 */
export function speakText(text, stylingPrompt, onStart, onEnd) {
  if (isPlaying) {
    stopSpeech();
  }

  if (!text) {
    if (onEnd) onEnd();
    return;
  }

  isPlaying = true;
  currentText = text;
  console.log("TTS state check:", {
    gcloudApiKeyPresent: !!state.gcloudApiKey,
    gcloudApiKeyType: typeof state.gcloudApiKey,
    gcloudRegion: state.gcloudRegion,
    ttsModel: state.ttsModel
  });

  if (state.gcloudApiKey) {
    console.log("Proceeding with Google Cloud TTS");
    speakGCTTS(text, stylingPrompt, onStart, onEnd);
  } else {
    console.log("Fallback to Chrome TTS (missing or empty GCloud API Key)");
    speakChromeTTS(text, onStart, onEnd);
  }
}

/**
 * Stops any ongoing speech.
 */
export function stopSpeech() {
  chrome.tts.stop();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  isPlaying = false;
}

/** Helper to convert base64 to Blob */
function b64toBlob(b64Data, contentType = '', sliceSize = 512) {
  const byteCharacters = atob(b64Data);
  const byteArrays = [];
  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }
  return new Blob(byteArrays, { type: contentType });
}

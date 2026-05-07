import { Platform } from 'obsidian';

// Environment detection
const isMobile = Platform.isMobile;
const isElectron = !isMobile && typeof window !== 'undefined' && (window as any).require;

// Buffer polyfill for mobile environments
let BufferPolyfill: any;
if (typeof Buffer === 'undefined' && typeof window !== 'undefined') {
  BufferPolyfill = {
    from: (data: any) => {
      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
      }
      if (data instanceof Uint8Array) {
        return data;
      }
      if (typeof data === 'string') {
        const encoder = new TextEncoder();
        return encoder.encode(data);
      }
      return new Uint8Array(0);
    },
    concat: (arrays: Uint8Array[]) => {
      const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
      }
      return result;
    }
  };

  (globalThis as any).Buffer = BufferPolyfill;
}

// In Electron, replace the browser WebSocket with a Node.js `ws` adapter
// that sends the custom headers (Origin, Sec-WebSocket-Version, Cookie/MUID)
// which Microsoft's TTS service now requires. The browser WebSocket API
// cannot set these headers, causing silent connection failures.
if (isElectron) {
  try {
    const wsModule = require('ws');
    const WS = wsModule.WebSocket || wsModule.default || wsModule;

    function generateMuid(): string {
      const array = new Uint8Array(16);
      globalThis.crypto.getRandomValues(array);
      return Array.from(array, (byte: number) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    }

    const CHROMIUM_VERSION = "143";
    const WSS_HEADERS = {
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_VERSION}.0.0.0`,
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
      "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Cookie": `muid=${generateMuid()};`
    };

    (globalThis as any).WebSocket = class NodeWSAdapter {
      private _ws: any;
      onopen: (() => void) | null = null;
      onmessage: ((event: any) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((error: any) => void) | null = null;

      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      get readyState(): number {
        return this._ws?.readyState ?? 0;
      }

      constructor(url: string) {
        this._ws = new WS(url, { headers: WSS_HEADERS });

        this._ws.on('open', () => {
          if (this.onopen) this.onopen();
        });

        this._ws.on('message', (data: any, isBinary: boolean) => {
          if (this.onmessage) {
            if (isBinary) {
              // ws delivers binary as Buffer, convert to ArrayBuffer
              const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
              this.onmessage({ data: ab });
            } else {
              this.onmessage({ data: data.toString() });
            }
          }
        });

        this._ws.on('close', () => {
          if (this.onclose) this.onclose();
        });

        this._ws.on('error', (error: any) => {
          if (this.onerror) this.onerror(error);
        });
      }

      send(data: string) {
        this._ws.send(data);
      }

      close() {
        this._ws.close();
      }
    };

    console.log('WebSocket: replaced with Node.js ws adapter (custom headers enabled)');
  } catch (e) {
    console.warn('WebSocket: could not load ws module, using browser WebSocket without headers', e);
  }
}

// Load browser entry point universally — it works in all environments.
// On Electron, the WebSocket override above ensures custom headers are sent.
let TTSPackage: any;
try {
  TTSPackage = require('edge-tts-universal/browser');
  console.log('Loaded edge-tts-universal/browser');
} catch (e) {
  console.warn("Could not load 'edge-tts-universal/browser', trying isomorphic fallback.", e);
  try {
    TTSPackage = require('edge-tts-universal/isomorphic');
    console.log('Loaded edge-tts-universal/isomorphic as fallback');
  } catch (e2) {
    console.warn("Could not load 'edge-tts-universal/isomorphic', falling back to main entry point.", e2);
    try {
      TTSPackage = require('edge-tts-universal');
      console.log('Loaded edge-tts-universal main entry point as final fallback');
    } catch (e3) {
      console.error('Failed to import edge-tts-universal package:', e3);
      TTSPackage = null;
    }
  }
}

// Re-export OUTPUT_FORMAT and other constants from the loaded package if they exist
export const OUTPUT_FORMAT = TTSPackage?.OUTPUT_FORMAT || {
  AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3',
  WEBM_24KHZ_16BIT_MONO_OPUS: 'webm-24khz-16bit-mono-opus',
};

// Helper function to create prosody options in the new format
export function createProsodyOptions(rate?: number): any {
  const prosody: any = {};

  if (rate !== undefined) {
    const percentage = Math.round((rate - 1) * 100);
    if (percentage !== 0) {
      prosody.rate = percentage > 0 ? `+${percentage}%` : `${percentage}%`;
    }
  }

  return prosody;
}

/**
 * Universal TTS Client that provides a consistent API across platforms
 * Adapts the new edge-tts-universal API to match the old edge-tts-client API
 */
export class UniversalTTSClient {
  private CommunicateClass: any;
  private currentVoice?: string;
  private currentFormat?: string;

  constructor() {
    if (!TTSPackage) {
      throw new Error('edge-tts-universal package not available');
    }

    this.CommunicateClass = TTSPackage.Communicate || TTSPackage.IsomorphicCommunicate;

    if (!this.CommunicateClass) {
      throw new Error('No suitable Communicate class found in the loaded edge-tts-universal package. Expected Communicate or IsomorphicCommunicate.');
    }
  }

  async setMetadata(voice: string, format: string): Promise<void> {
    this.currentVoice = voice;
    this.currentFormat = format;
  }

  toStream(text: string, prosodyOptions?: any): any {
    if (!this.CommunicateClass) {
      throw new Error('TTS client not initialized');
    }

    const finalProsodyOptions: any = {};
    if (prosodyOptions && typeof prosodyOptions.rate === 'number') {
      const convertedProsody = createProsodyOptions(prosodyOptions.rate);
      finalProsodyOptions.rate = convertedProsody.rate;
    }

    try {
      const communicateOptions: any = {
        voice: this.currentVoice
      };

      if (finalProsodyOptions.rate) {
        communicateOptions.rate = finalProsodyOptions.rate;
      }
      if (finalProsodyOptions.pitch) {
        communicateOptions.pitch = finalProsodyOptions.pitch;
      }
      if (finalProsodyOptions.volume) {
        communicateOptions.volume = finalProsodyOptions.volume;
      }

      let communicate;
      try {
        communicate = new this.CommunicateClass(text, communicateOptions);
      } catch (error) {
        console.warn('Failed to create Communicate with prosody options, trying with voice only:', error);
        const minimalOptions = { voice: this.currentVoice };
        communicate = new this.CommunicateClass(text, minimalOptions);
      }

      const asyncGenerator = communicate.stream();

      const streamAdapter = {
        listeners: new Map<string, Array<(...args: any[]) => void>>(),

        on(event: string, callback: (...args: any[]) => void) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
          }
          this.listeners.get(event)!.push(callback);

          if (event === 'data' && !this.isConsuming) {
            this.consumeAsyncGenerator();
          }
        },

        emit(event: string, ...args: any[]) {
          const callbacks = this.listeners.get(event) || [];
          callbacks.forEach((callback: (...args: any[]) => void) => callback(...args));
        },

        isConsuming: false,

        async consumeAsyncGenerator() {
          this.isConsuming = true;
          try {
            for await (const chunk of asyncGenerator) {
              if (chunk.type === 'audio' && chunk.data) {
                let audioData: Uint8Array;
                if (chunk.data instanceof Uint8Array) {
                  audioData = chunk.data;
                } else if (chunk.data instanceof ArrayBuffer) {
                  audioData = new Uint8Array(chunk.data);
                } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(chunk.data)) {
                  audioData = new Uint8Array(chunk.data);
                } else if (BufferPolyfill && typeof chunk.data === 'object') {
                  audioData = BufferPolyfill.from(chunk.data);
                } else {
                  console.warn('Unexpected audio data type:', typeof chunk.data, chunk.data);
                  audioData = new Uint8Array(0);
                }
                this.emit('data', audioData);
              } else if (chunk.type === 'WordBoundary') {
                this.emit('wordBoundary', {
                  offset: chunk.offset,
                  duration: chunk.duration,
                  text: chunk.text
                });
              }
            }
            this.emit('end');
          } catch (error) {
            console.error('TTS stream: error consuming generator:', error);
            this.emit('error', error);
          }
        }
      };

      return streamAdapter;
    } catch (error) {
      console.error('Error creating TTS stream:', error);
      throw new Error(`Failed to create TTS stream: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

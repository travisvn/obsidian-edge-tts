import React from 'react';
import ReactDOMClient from 'react-dom/client';
import { FloatingPlayerUI } from '../ui/FloatingPlayerUI';
import type { AudioPlaybackManager } from './audio-playback'; // Using type import

interface FloatingUIManagerOptions {
  audioManager: AudioPlaybackManager; // To access playback state and controls
  savePositionCallback: (position: { x: number; y: number }) => Promise<void>; // Added callback
}

export class FloatingUIManager {
  private hostElement: HTMLElement | null = null;
  private reactRoot: ReactDOMClient.Root | null = null;
  private audioManager: AudioPlaybackManager;
  private lastPosition: { x: number, y: number } | undefined = undefined;
  private isPlayerVisible = false;
  private savePosition: (position: { x: number; y: number }) => Promise<void>; // Store callback
  private currentPlaybackState: { currentTime: number, duration: number, isPlaying: boolean, isLoading: boolean } = {
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    isLoading: false,
  };

  private readonly PLAYER_WIDTH_ESTIMATE = 270; // Approximate width of the player
  private readonly PLAYER_HEIGHT_ESTIMATE = 95; // Approximate height of the player
  private resizeDebounceTimeout: number | null = null;
  private readonly RESIZE_DEBOUNCE_DELAY = 250; // milliseconds

  constructor(options: FloatingUIManagerOptions) {
    this.audioManager = options.audioManager;
    this.savePosition = options.savePositionCallback; // Store callback
    this.handleWindowResize = this.handleWindowResize.bind(this); // Bind for the event listener
    window.addEventListener('resize', this.debouncedWindowResize);
    this.renderComponent();
  }

  private debouncedWindowResize = () => {
    if (this.resizeDebounceTimeout) {
      clearTimeout(this.resizeDebounceTimeout);
    }
    this.resizeDebounceTimeout = window.setTimeout(() => {
      this.handleWindowResize();
    }, this.RESIZE_DEBOUNCE_DELAY);
  }

  private handleWindowResize(): void {
    if (!this.isPlayerVisible || !this.lastPosition) {
      return;
    }

    const { innerWidth, innerHeight } = window;

    // Check if the player is significantly out of viewport
    // True if less than 20px of the player is visible on any side
    const isOutOfBounds =
      this.lastPosition.x > innerWidth - 20 || // Player's left edge is past the right viewport edge (minus 20px buffer)
      this.lastPosition.y > innerHeight - 20 || // Player's top edge is past the bottom viewport edge (minus 20px buffer)
      this.lastPosition.x < -this.PLAYER_WIDTH_ESTIMATE + 20 || // Player's right edge is past the left viewport edge (plus 20px buffer)
      this.lastPosition.y < -this.PLAYER_HEIGHT_ESTIMATE + 20;   // Player's bottom edge is past the top viewport edge (plus 20px buffer)

    if (isOutOfBounds) {
      // console.log("Floating player out of bounds due to window resize, resetting position.");
      this.resetPlayerPosition();
    }
  }

  private createHostElement() {
    if (!this.hostElement) {
      this.hostElement = document.createElement('div');
      this.hostElement.id = 'obsidian-edge-tts-floating-player-host';
      document.body.appendChild(this.hostElement);
      this.reactRoot = ReactDOMClient.createRoot(this.hostElement);
    }
  }

  public showPlayer(initialData?: { currentTime: number, duration: number, isPlaying: boolean, isLoading: boolean }) {
    this.createHostElement();
    this.isPlayerVisible = true;
    if (initialData) {
      this.currentPlaybackState = initialData;
    } else {
      // Ensure a default state if no initial data, including isLoading
      this.currentPlaybackState = {
        currentTime: 0,
        duration: 0,
        isPlaying: false,
        isLoading: this.currentPlaybackState.isLoading, // Preserve current loading state or default to false
      };
    }
    this.renderComponent();
  }

  public hidePlayer() {
    this.isPlayerVisible = false;
    // Persist position when hiding
    if (this.lastPosition) {
      this.savePosition(this.lastPosition).catch(error => {
        console.error("Failed to save player position on hide:", error);
      });
    }
    this.renderComponent(); // Re-render with isVisible = false, which makes the component return null
  }

  public togglePlayerVisibility() {
    if (this.isPlayerVisible) {
      this.hidePlayer();
    } else {
      this.showPlayer();
    }
  }

  // Call this method when audio state changes (e.g., pause/resume)
  // This will now be called by AudioPlaybackManager with new data
  public updatePlayerState(data: { currentTime: number, duration: number, isPlaying: boolean, isLoading: boolean }) {
    this.currentPlaybackState = data;
    if (this.isPlayerVisible) {
      this.renderComponent();
    }
  }

  public getIsPlayerVisible(): boolean {
    return this.isPlayerVisible;
  }

  public resetPlayerPosition(): void {
    const defaultX = typeof window !== 'undefined' ? window.innerWidth - 290 : 50;
    const defaultY = typeof window !== 'undefined' ? window.innerHeight - 135 : 50;
    this.lastPosition = { x: defaultX, y: defaultY };
    this.savePosition(this.lastPosition).catch(error => {
      console.error("Failed to save player position on reset:", error);
    });
    if (this.isPlayerVisible) {
      this.renderComponent(); // Re-render if visible to reflect new position
    }
  }

  private renderComponent() {
    if (this.reactRoot) {
      const defaultX = typeof window !== 'undefined' ? window.innerWidth - 290 : 50;
      const defaultY = typeof window !== 'undefined' ? window.innerHeight - 135 : 50;

      const playerInitialPosition = this.lastPosition ?? { x: defaultX, y: defaultY };

      this.reactRoot.render(
        React.createElement(FloatingPlayerUI, {
          isVisible: this.isPlayerVisible,
          onClose: () => this.hidePlayer(),
          onPause: this.audioManager.isPlaybackPaused() ? undefined : () => this.audioManager.pausePlayback(),
          onResume: this.audioManager.isPlaybackPaused() ? () => this.audioManager.resumePlayback() : undefined,
          onStop: () => this.audioManager.stopPlayback(),
          isPaused: !this.currentPlaybackState.isPlaying, // Use state passed from AudioPlaybackManager
          initialPosition: playerInitialPosition,
          onDragEnd: (position) => {
            this.lastPosition = position;
            this.savePosition(position).catch(error => {
              console.error("Failed to save player position on drag end:", error);
            });
          },
          // Pass new props for progress and seeking
          currentTime: this.currentPlaybackState.currentTime,
          duration: this.currentPlaybackState.duration,
          onSeek: (time: number) => this.audioManager.seekPlayback(time),
          onReplay: () => this.audioManager.replayPlayback(),
          onJumpForward: () => this.audioManager.jumpForward(),
          onJumpBackward: () => this.audioManager.jumpBackward(),
          isLoading: this.currentPlaybackState.isLoading, // Pass isLoading state
        })
      );
    }
  }

  public setInitialSavedPosition(position: { x: number; y: number } | null): void {
    if (position) {
      this.lastPosition = position;
      // If the player is already visible, we might want to re-render it with the new initial position
      // However, typically this is called before the player is first shown.
      if (this.isPlayerVisible) {
        this.renderComponent();
      }
    }
  }

  public getCurrentPosition(): { x: number; y: number } | undefined {
    return this.lastPosition;
  }

  public destroy() {
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
    if (this.hostElement) {
      this.hostElement.remove();
      this.hostElement = null;
    }
    this.isPlayerVisible = false;

    window.removeEventListener('resize', this.debouncedWindowResize);
    if (this.resizeDebounceTimeout) {
      clearTimeout(this.resizeDebounceTimeout);
    }
  }
} 
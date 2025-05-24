import React from 'react';
import ReactDOMClient from 'react-dom/client';
import { QueueManagerUI } from '../ui/QueueManagerUI';
import type { AudioPlaybackManager } from './audio-playback';
import { DIMENSION_ESTIMATES } from './constants';

interface QueueUIManagerOptions {
  audioManager: AudioPlaybackManager;
  savePositionCallback: (position: { x: number; y: number }) => Promise<void>;
}

export class QueueUIManager {
  private hostElement: HTMLElement | null = null;
  private reactRoot: ReactDOMClient.Root | null = null;
  private audioManager: AudioPlaybackManager;
  private lastPosition: { x: number, y: number } | undefined = undefined;
  private isQueueVisible = false;
  private savePosition: (position: { x: number; y: number }) => Promise<void>;

  private resizeDebounceTimeout: number | null = null;
  private readonly RESIZE_DEBOUNCE_DELAY = 250; // milliseconds

  constructor(options: QueueUIManagerOptions) {
    this.audioManager = options.audioManager;
    this.savePosition = options.savePositionCallback;
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
    if (!this.isQueueVisible || !this.hostElement) {
      return;
    }

    // Get the actual queue element bounds
    const queueElement = this.hostElement.querySelector('.queue-manager-ui') as HTMLElement;
    if (!queueElement) {
      return;
    }

    const rect = queueElement.getBoundingClientRect();
    const { innerWidth, innerHeight } = window;
    const buffer = 50; // Minimum visible area required

    // Check if the queue is significantly out of viewport
    const isOutOfBounds =
      rect.right < buffer ||                    // Too far left
      rect.left > innerWidth - buffer ||        // Too far right  
      rect.bottom < buffer ||                   // Too far up
      rect.top > innerHeight - buffer;          // Too far down

    if (isOutOfBounds) {
      console.log("Queue manager is out of bounds, repositioning...");
      this.repositionQueueInBounds();
    }
  }

  private createHostElement() {
    if (!this.hostElement) {
      this.hostElement = document.createElement('div');
      this.hostElement.id = 'obsidian-edge-tts-queue-manager-host';
      document.body.appendChild(this.hostElement);
      this.reactRoot = ReactDOMClient.createRoot(this.hostElement);
    }
  }

  public showQueue() {
    this.createHostElement();
    this.isQueueVisible = true;
    this.renderComponent();
  }

  public hideQueue() {
    this.isQueueVisible = false;
    // Persist position when hiding
    if (this.lastPosition) {
      this.savePosition(this.lastPosition).catch(error => {
        console.error("Failed to save queue position on hide:", error);
      });
    }
    this.renderComponent();
  }

  public toggleQueueVisibility() {
    if (this.isQueueVisible) {
      this.hideQueue();
    } else {
      this.showQueue();
    }
  }

  public getIsQueueVisible(): boolean {
    return this.isQueueVisible;
  }

  public updateQueue() {
    if (this.isQueueVisible) {
      this.renderComponent();
    }
  }

  public resetQueuePosition(): void {
    this.repositionQueueInBounds();
  }

  private repositionQueueInBounds(): void {
    if (!this.hostElement) return;

    const queueElement = this.hostElement.querySelector('.queue-manager-ui') as HTMLElement;
    if (!queueElement) return;

    const rect = queueElement.getBoundingClientRect();
    const { innerWidth, innerHeight } = window;
    const margin = 30;

    // Preferred position: bottom-right corner, above floating player
    // Floating player position: x = innerWidth - 290, y = innerHeight - 135
    const preferredX = innerWidth - rect.width - margin; // Right edge with margin
    const preferredY = innerHeight - rect.height - DIMENSION_ESTIMATES.PLAYER_HEIGHT - margin; // Above floating player area

    // Try to use preferred position if it fits, otherwise constrain to viewport
    let newX = preferredX;
    let newY = preferredY;

    // Ensure it fits within viewport bounds
    if (newX < margin) {
      newX = margin; // Too far left, push right
    }
    if (newY < margin) {
      newY = margin; // Too far up, push down
    }
    if (newX + rect.width > innerWidth - margin) {
      newX = innerWidth - rect.width - margin; // Too far right
    }
    if (newY + rect.height > innerHeight - margin) {
      newY = innerHeight - rect.height - margin; // Too far down
    }

    // Final safety check
    newX = Math.max(margin, Math.min(newX, innerWidth - rect.width - margin));
    newY = Math.max(margin, Math.min(newY, innerHeight - rect.height - margin));

    this.lastPosition = { x: newX, y: newY };
    this.savePosition(this.lastPosition).catch(error => {
      console.error("Failed to save queue position on reposition:", error);
    });

    if (this.isQueueVisible) {
      this.renderComponent();
    }
  }

  private renderComponent() {
    if (this.reactRoot) {
      // Default position: bottom-right corner, above the floating player
      // Floating player is at: x = innerWidth - 290, y = innerHeight - 135
      // Queue width is ~320px, so we position it to the left of where player would be
      const defaultX = typeof window !== 'undefined' ? window.innerWidth - DIMENSION_ESTIMATES.QUEUE_WIDTH : 50; // 20px margin from right edge
      const defaultY = typeof window !== 'undefined' ? window.innerHeight - DIMENSION_ESTIMATES.QUEUE_HEIGHT : 50; // Above floating player with margin

      const queueInitialPosition = this.lastPosition ?? { x: defaultX, y: defaultY };
      const queueStatus = this.audioManager.getQueueStatus();

      this.reactRoot.render(
        React.createElement(QueueManagerUI, {
          isVisible: this.isQueueVisible,
          onClose: () => this.hideQueue(),
          queue: queueStatus.queue,
          currentIndex: queueStatus.currentIndex,
          isPlayingFromQueue: queueStatus.isPlayingFromQueue,
          onPlayItem: (index: number) => this.audioManager.playQueueItem(index),
          onRemoveItem: (index: number) => {
            this.audioManager.removeQueueItem(index);
            this.updateQueue(); // Re-render after removal
          },
          onClearQueue: () => {
            this.audioManager.clearQueue();
            this.updateQueue(); // Re-render after clearing
          },
          onMoveItem: (fromIndex: number, toIndex: number) => {
            this.audioManager.moveQueueItem(fromIndex, toIndex);
            this.updateQueue(); // Re-render after moving
          },
          onPlayQueue: () => this.audioManager.playQueue(),
          loopEnabled: this.audioManager.getLoopEnabled(),
          onToggleLoop: (enabled: boolean) => {
            this.audioManager.setLoopEnabled(enabled);
            this.updateQueue();
          },
          initialPosition: queueInitialPosition,
          onDragEnd: (position) => {
            this.lastPosition = position;
            this.savePosition(position).catch(error => {
              console.error("Failed to save queue position on drag end:", error);
            });
          },
        })
      );
    }
  }

  public setInitialSavedPosition(position: { x: number; y: number } | null): void {
    if (position) {
      this.lastPosition = position;
      if (this.isQueueVisible) {
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
    this.isQueueVisible = false;

    window.removeEventListener('resize', this.debouncedWindowResize);
    if (this.resizeDebounceTimeout) {
      clearTimeout(this.resizeDebounceTimeout);
    }
  }
} 
import React from 'react';
import ReactDOMClient from 'react-dom/client';
import { ChunkedProgressUI, ChunkStatus } from '../ui/ChunkedProgressUI';

interface ChunkInfo {
  id: string;
  status: ChunkStatus;
  progress: number; // 0-100
  error?: string;
}

export interface ChunkedProgressState {
  isVisible: boolean;
  totalChunks: number;
  chunks: ChunkInfo[];
  currentPhase: 'splitting' | 'generating' | 'combining' | 'completed' | 'error';
  overallProgress: number; // 0-100
  errorMessage?: string;
  noteTitle?: string;
}

export class ChunkedProgressManager {
  private hostElement: HTMLElement | null = null;
  private reactRoot: ReactDOMClient.Root | null = null;
  private state: ChunkedProgressState = {
    isVisible: false,
    totalChunks: 0,
    chunks: [],
    currentPhase: 'splitting',
    overallProgress: 0,
  };

  private resizeDebounceTimeout: number | null = null;
  private readonly RESIZE_DEBOUNCE_DELAY = 250; // milliseconds

  constructor() {
    this.handleWindowResize = this.handleWindowResize.bind(this);
    window.addEventListener('resize', this.debouncedWindowResize);
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
    if (!this.state.isVisible || !this.hostElement) {
      return;
    }
    // Update position when window is resized
    this.updatePosition();
  }

  private createHostElement() {
    if (!this.hostElement) {
      this.hostElement = document.createElement('div');
      this.hostElement.id = 'obsidian-edge-tts-chunked-progress-host';
      document.body.appendChild(this.hostElement);
      this.reactRoot = ReactDOMClient.createRoot(this.hostElement);
      this.updatePosition();
    }
  }

  private updatePosition() {
    if (!this.hostElement) return;

    // Position above the status bar in the bottom right corner
    const margin = 20;
    const statusBarHeight = 30; // Approximate height of Obsidian's status bar
    const progressHeight = 200; // Approximate height of our progress indicator

    // Calculate position relative to viewport
    const rightOffset = margin;
    const bottomOffset = statusBarHeight + margin;

    this.hostElement.style.position = 'fixed';
    this.hostElement.style.right = `${rightOffset}px`;
    this.hostElement.style.bottom = `${bottomOffset}px`;
    this.hostElement.style.zIndex = '1000';
    this.hostElement.style.pointerEvents = this.state.isVisible ? 'auto' : 'none';
  }

  public show(initialState: Partial<ChunkedProgressState> = {}) {
    this.createHostElement();
    this.state = {
      ...this.state,
      ...initialState,
      isVisible: true,
    };
    this.renderComponent();
  }

  public hide() {
    this.state.isVisible = false;
    this.renderComponent();
  }

  public updateState(updates: Partial<ChunkedProgressState>) {
    this.state = {
      ...this.state,
      ...updates,
    };
    if (this.state.isVisible) {
      this.renderComponent();
    }
  }

  public updateChunk(chunkId: string, updates: Partial<ChunkInfo>) {
    const chunkIndex = this.state.chunks.findIndex(chunk => chunk.id === chunkId);
    if (chunkIndex !== -1) {
      const updatedChunks = [...this.state.chunks];
      updatedChunks[chunkIndex] = { ...updatedChunks[chunkIndex], ...updates };
      this.updateState({ chunks: updatedChunks });
    }
  }

  public addChunk(chunk: ChunkInfo) {
    this.updateState({
      chunks: [...this.state.chunks, chunk]
    });
  }

  public setChunks(chunks: ChunkInfo[]) {
    this.updateState({ chunks });
  }

  public getState(): ChunkedProgressState {
    return { ...this.state };
  }

  public calculateOverallProgress(): number {
    if (this.state.currentPhase === 'splitting') {
      return 5; // Show some progress for splitting phase
    } else if (this.state.currentPhase === 'generating') {
      if (this.state.chunks.length === 0) return 5;

      const completedChunks = this.state.chunks.filter(c => c.status === ChunkStatus.COMPLETED).length;
      const processingChunks = this.state.chunks.filter(c => c.status === ChunkStatus.PROCESSING);

      // Calculate progress from completed chunks and processing chunks
      let totalProgress = completedChunks * 100;

      // Add progress from chunks currently being processed
      processingChunks.forEach(chunk => {
        totalProgress += Math.max(chunk.progress, 10); // Give processing chunks at least 10% credit
      });

      // Give chunks that are processing but haven't reported progress yet some credit
      const processingWithoutProgress = processingChunks.filter(c => c.progress === 0).length;
      totalProgress += processingWithoutProgress * 5; // 5% credit for started processing

      // Calculate percentage and scale to 5-85% range
      const rawProgress = totalProgress / (this.state.chunks.length * 100);
      const scaledProgress = 5 + (rawProgress * 80);

      // Debug logging (can be removed later)
      if (process.env.NODE_ENV === 'development') {
        console.log('Progress calc:', {
          completedChunks,
          processingChunks: processingChunks.length,
          totalProgress,
          rawProgress,
          scaledProgress,
          totalChunks: this.state.chunks.length
        });
      }

      return Math.min(85, scaledProgress);
    } else if (this.state.currentPhase === 'combining') {
      return 90; // Combining is quick, so we show 90%
    } else if (this.state.currentPhase === 'completed') {
      return 100;
    } else if (this.state.currentPhase === 'error') {
      return this.state.overallProgress; // Keep last known progress
    }
    return 0;
  }

  private renderComponent() {
    if (this.reactRoot) {
      // Always use calculated progress instead of stored overallProgress
      const overallProgress = this.calculateOverallProgress();

      this.reactRoot.render(
        React.createElement(ChunkedProgressUI, {
          isVisible: this.state.isVisible,
          onClose: () => this.hide(),
          totalChunks: this.state.totalChunks,
          chunks: this.state.chunks,
          currentPhase: this.state.currentPhase,
          overallProgress: overallProgress,
          errorMessage: this.state.errorMessage,
          noteTitle: this.state.noteTitle,
        })
      );

      // Update positioning after render
      if (this.state.isVisible) {
        this.updatePosition();
      }
    }
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
    this.state.isVisible = false;

    window.removeEventListener('resize', this.debouncedWindowResize);
    if (this.resizeDebounceTimeout) {
      clearTimeout(this.resizeDebounceTimeout);
    }
  }
} 
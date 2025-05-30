import React, { useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';

interface ObsidianIconProps {
  icon: string;
  className?: string;
  size?: number;
}

const ObsidianIcon: React.FC<ObsidianIconProps> = ({ icon, className, size = 16 }) => {
  const iconRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (iconRef.current) {
      iconRef.current.innerHTML = '';
      setIcon(iconRef.current, icon);
      const svgElement = iconRef.current.querySelector('svg');
      if (svgElement && size) {
        svgElement.style.width = `${size}px`;
        svgElement.style.height = `${size}px`;
      }
    }
  }, [icon, size]);
  return <span ref={iconRef} className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}></span>;
};

export enum ChunkStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

interface ChunkInfo {
  id: string;
  status: ChunkStatus;
  progress: number; // 0-100
  error?: string;
}

interface ChunkedProgressUIProps {
  isVisible: boolean;
  onClose: () => void;
  totalChunks: number;
  chunks: ChunkInfo[];
  currentPhase: 'splitting' | 'generating' | 'combining' | 'completed' | 'error';
  overallProgress: number; // 0-100
  errorMessage?: string;
  noteTitle?: string;
}

export const ChunkedProgressUI: React.FC<ChunkedProgressUIProps> = ({
  isVisible,
  onClose,
  totalChunks,
  chunks,
  currentPhase,
  overallProgress,
  errorMessage,
  noteTitle = 'Unknown Note',
}) => {
  if (!isVisible) {
    return null;
  }

  const getPhaseText = () => {
    switch (currentPhase) {
      case 'splitting':
        return 'Splitting note into chunks...';
      case 'generating':
        return 'Generating audio chunks...';
      case 'combining':
        return 'Combining audio files...';
      case 'completed':
        return 'MP3 generation completed!';
      case 'error':
        return 'Error occurred during generation';
      default:
        return 'Processing...';
    }
  };

  const getPhaseIcon = () => {
    switch (currentPhase) {
      case 'splitting':
        return 'scissors';
      case 'generating':
        return 'cpu';
      case 'combining':
        return 'package';
      case 'completed':
        return 'check-circle';
      case 'error':
        return 'alert-circle';
      default:
        return 'loader-2';
    }
  };

  const getChunkIcon = (status: ChunkStatus) => {
    switch (status) {
      case ChunkStatus.PENDING:
        return 'clock';
      case ChunkStatus.PROCESSING:
        return 'loader-2';
      case ChunkStatus.COMPLETED:
        return 'check';
      case ChunkStatus.FAILED:
        return 'x';
      default:
        return 'circle';
    }
  };

  const getChunkStatusText = (status: ChunkStatus) => {
    switch (status) {
      case ChunkStatus.PENDING:
        return 'Waiting';
      case ChunkStatus.PROCESSING:
        return 'Processing';
      case ChunkStatus.COMPLETED:
        return 'Done';
      case ChunkStatus.FAILED:
        return 'Failed';
      default:
        return 'Unknown';
    }
  };

  const completedChunks = chunks.filter(c => c.status === ChunkStatus.COMPLETED).length;
  const failedChunks = chunks.filter(c => c.status === ChunkStatus.FAILED).length;

  return (
    <div className="chunked-progress-ui">
      <div className="chunked-progress-header">
        <div className="chunked-progress-title-section">
          <ObsidianIcon
            icon={getPhaseIcon()}
            size={18}
            className={currentPhase === 'generating' ? 'spinning' : ''}
          />
          <span className="chunked-progress-title">MP3 Generation</span>
          {(currentPhase === 'completed' || currentPhase === 'error') && (
            <button
              onClick={onClose}
              className="chunked-progress-close-button"
              aria-label="Close"
            >
              <ObsidianIcon icon="x" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="chunked-progress-content">
        <div className="chunked-progress-note-title" title={noteTitle}>
          {noteTitle.length > 30 ? noteTitle.substring(0, 30) + '...' : noteTitle}
        </div>

        <div className="chunked-progress-phase">
          <span className="chunked-progress-phase-text">{getPhaseText()}</span>
          {currentPhase !== 'completed' && currentPhase !== 'error' && (
            <span className="chunked-progress-percentage">
              {Math.round(overallProgress)}%
            </span>
          )}
        </div>

        {currentPhase === 'error' && errorMessage && (
          <div className="chunked-progress-error">
            <ObsidianIcon icon="alert-triangle" size={14} />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="chunked-progress-overall-bar">
          <div
            className={`chunked-progress-overall-fill ${currentPhase === 'error' ? 'error' : ''}`}
            style={{ width: `${overallProgress}%` }}
          />
        </div>

        <div className="chunked-progress-stats">
          <span>Total Chunks: {totalChunks}</span>
          {chunks.length > 0 && (
            <>
              <span>Completed: {completedChunks}</span>
              {failedChunks > 0 && <span className="error-text">Failed: {failedChunks}</span>}
            </>
          )}
        </div>

        {chunks.length > 0 && currentPhase === 'generating' && (
          <div className="chunked-progress-chunks">
            <div className="chunked-progress-chunks-header">
              <span>Chunk Progress:</span>
            </div>
            <div className="chunked-progress-chunks-list">
              {chunks.map((chunk, index) => (
                <div
                  key={chunk.id}
                  className={`chunked-progress-chunk ${chunk.status}`}
                  title={chunk.error || `Chunk ${index + 1}: ${getChunkStatusText(chunk.status)}`}
                >
                  <span className="chunked-progress-chunk-number">{index + 1}</span>
                  <ObsidianIcon
                    icon={getChunkIcon(chunk.status)}
                    size={12}
                    className={chunk.status === ChunkStatus.PROCESSING ? 'spinning' : ''}
                  />
                  {chunk.status === ChunkStatus.PROCESSING && chunk.progress > 0 && (
                    <span className="chunked-progress-chunk-progress">{chunk.progress}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}; 
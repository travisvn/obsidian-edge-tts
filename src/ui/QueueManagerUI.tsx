import React, { useState, useEffect, useRef } from 'react';
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

interface QueueItem {
  text: string;
  title?: string;
}

interface QueueManagerUIProps {
  isVisible: boolean;
  onClose: () => void;
  queue: QueueItem[];
  currentIndex: number;
  isPlayingFromQueue: boolean;
  onPlayItem: (index: number) => void;
  onRemoveItem: (index: number) => void;
  onClearQueue: () => void;
  onMoveItem: (fromIndex: number, toIndex: number) => void;
  onPlayQueue?: () => void;
  loopEnabled: boolean;
  onToggleLoop: (enabled: boolean) => void;
  initialPosition?: { x: number; y: number };
  onDragEnd?: (position: { x: number; y: number }) => void;
}

export const QueueManagerUI: React.FC<QueueManagerUIProps> = ({
  isVisible,
  onClose,
  queue,
  currentIndex,
  isPlayingFromQueue,
  onPlayItem,
  onRemoveItem,
  onClearQueue,
  onMoveItem,
  onPlayQueue,
  loopEnabled,
  onToggleLoop,
  initialPosition = { x: 100, y: 100 },
  onDragEnd,
}) => {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartOffset, setDragStartOffset] = useState({ x: 0, y: 0 });
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const queueRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // Helper function to get coordinates from either mouse or touch event
  const getEventCoordinates = (e: MouseEvent | TouchEvent) => {
    if ('touches' in e) {
      // Touch event
      const touch = e.touches[0] || e.changedTouches[0];
      return { clientX: touch.clientX, clientY: touch.clientY };
    } else {
      // Mouse event
      return { clientX: e.clientX, clientY: e.clientY };
    }
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLDivElement, MouseEvent> | React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Only allow dragging from the header area, but not from buttons or button containers
    if (!target.closest('.queue-header') || target.closest('.queue-header-buttons')) {
      return;
    }

    setIsDragging(true);
    if (queueRef.current) {
      const rect = queueRef.current.getBoundingClientRect();
      const coords = getEventCoordinates(e.nativeEvent);
      setDragStartOffset({
        x: coords.clientX - rect.left,
        y: coords.clientY - rect.top,
      });
    }
    e.preventDefault();
  };

  const handlePointerMove = (e: MouseEvent | TouchEvent) => {
    if (isDragging) {
      const coords = getEventCoordinates(e);
      setPosition({
        x: coords.clientX - dragStartOffset.x,
        y: coords.clientY - dragStartOffset.y,
      });
    }
  };

  const handlePointerUp = () => {
    if (isDragging) {
      setIsDragging(false);
      if (onDragEnd) {
        onDragEnd(position);
      }
    }
  };

  // Auto-scroll to current playing item when enabled
  useEffect(() => {
    if (autoScrollEnabled && isPlayingFromQueue && currentIndex >= 0 && contentAreaRef.current) {
      const playingItem = contentAreaRef.current.querySelector(`.queue-item:nth-child(${currentIndex + 1})`);
      if (playingItem) {
        playingItem.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest'
        });
      }
    }
  }, [autoScrollEnabled, isPlayingFromQueue, currentIndex]);

  useEffect(() => {
    if (isDragging) {
      // Add both mouse and touch event listeners
      document.addEventListener('mousemove', handlePointerMove);
      document.addEventListener('mouseup', handlePointerUp);
      document.addEventListener('touchmove', handlePointerMove, { passive: false });
      document.addEventListener('touchend', handlePointerUp);
    } else {
      // Remove both mouse and touch event listeners
      document.removeEventListener('mousemove', handlePointerMove);
      document.removeEventListener('mouseup', handlePointerUp);
      document.removeEventListener('touchmove', handlePointerMove);
      document.removeEventListener('touchend', handlePointerUp);
    }
    return () => {
      document.removeEventListener('mousemove', handlePointerMove);
      document.removeEventListener('mouseup', handlePointerUp);
      document.removeEventListener('touchmove', handlePointerMove);
      document.removeEventListener('touchend', handlePointerUp);
    };
  }, [isDragging, dragStartOffset]);

  useEffect(() => {
    setPosition(initialPosition);
  }, [initialPosition]);

  const truncateTitle = (title: string, maxLength = 25) => {
    return title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
  };

  const toggleAutoScroll = () => {
    setAutoScrollEnabled(!autoScrollEnabled);
  };

  const toggleLoop = () => {
    onToggleLoop(!loopEnabled);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={queueRef}
      className="queue-manager-ui"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? 'grabbing' : undefined,
        touchAction: 'none', // Prevent default touch actions during drag
      }}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
    >
      {/* Header */}
      <div className="queue-header">
        <div className="queue-header-title-section">
          <ObsidianIcon icon="list-music" size={18} />
          <span className="queue-header-title">Playback Queue</span>
          <span className="queue-header-count">
            {queue.length}
          </span>
        </div>

        {/* Two-row button layout */}
        <div className="queue-header-buttons">
          {/* Top row */}
          <div className="queue-header-buttons-row">
            {queue.length > 0 && (
              <button
                onClick={toggleAutoScroll}
                className={`queue-mini-button ${autoScrollEnabled ? 'active' : ''}`}
                aria-label={autoScrollEnabled ? "Disable auto-scroll" : "Enable auto-scroll"}
                title={autoScrollEnabled ? "Auto-scroll enabled" : "Auto-scroll disabled"}
              >
                <ObsidianIcon icon={autoScrollEnabled ? "scroll-text" : "scroll"} size={12} />
              </button>
            )}
            {queue.length > 0 && (
              <button
                onClick={toggleLoop}
                className={`queue-mini-button ${loopEnabled ? 'active' : ''}`}
                aria-label={loopEnabled ? "Disable loop" : "Enable loop"}
                title={loopEnabled ? "Loop enabled" : "Loop disabled"}
              >
                <ObsidianIcon icon="repeat" size={12} />
              </button>
            )}
            <button
              onClick={onClose}
              className="queue-mini-button"
              aria-label="Close Queue"
            >
              <ObsidianIcon icon="x" size={12} />
            </button>
          </div>

          {/* Bottom row */}
          <div className="queue-header-buttons-row">
            {queue.length > 0 && onPlayQueue && (
              <button
                onClick={onPlayQueue}
                className="queue-mini-button play-button"
                aria-label="Play Queue from Beginning"
              >
                <ObsidianIcon icon="play" size={12} />
              </button>
            )}
            {queue.length > 0 && (
              <button
                onClick={onClearQueue}
                className="queue-mini-button"
                aria-label="Clear Queue"
              >
                <ObsidianIcon icon="trash-2" size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Queue Items */}
      <div
        ref={contentAreaRef}
        className={`queue-content-area ${queue.length === 0 ? 'has-empty-message' : ''}`}
      >
        {queue.length === 0 ? (
          <div className="queue-empty-message">
            <ObsidianIcon icon="list-music" size={48} />
            <div className="queue-empty-title">Queue is empty</div>
            <div className="queue-empty-instructions">
              Add notes to your playback queue by:
            </div>
            <div className="queue-empty-instruction-list">
              <div>• Right-clicking on notes</div>
              <div>• Using "Add to queue" menu items</div>
              <div>• Using keyboard shortcuts</div>
            </div>
          </div>
        ) : (
          queue.map((item, index) => (
            <div
              key={index}
              className={`queue-item ${index === currentIndex && isPlayingFromQueue ? 'is-playing' : ''}`}
              onClick={() => onPlayItem(index)}
            >
              <div className="queue-item-number-status">
                {index === currentIndex && isPlayingFromQueue ? (
                  <ObsidianIcon icon="volume-2" size={14} />
                ) : (
                  index + 1
                )}
              </div>

              <div
                className="queue-item-title"
                title={item.title || 'Untitled'}
              >
                {truncateTitle(item.title || 'Untitled')}
              </div>

              {index === currentIndex && isPlayingFromQueue && (
                <div className="queue-item-playing-indicator"></div>
              )}

              <div className="queue-item-controls">
                {index > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveItem(index, index - 1);
                    }}
                    className="queue-item-control-button"
                    title="Move Up"
                  >
                    <ObsidianIcon icon="chevron-up" size={14} />
                  </button>
                )}

                {index < queue.length - 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveItem(index, index + 1);
                    }}
                    className="queue-item-control-button"
                    title="Move Down"
                  >
                    <ObsidianIcon icon="chevron-down" size={14} />
                  </button>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveItem(index);
                  }}
                  className="queue-item-control-button queue-item-remove-button"
                  title="Remove from Queue"
                >
                  <ObsidianIcon icon="x" size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}; 
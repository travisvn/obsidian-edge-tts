import React, { useState, useEffect, useRef, useCallback } from 'react';
import { setIcon } from 'obsidian'; // Import setIcon for Lucide icons

interface ObsidianIconProps {
  icon: string; // Lucide icon name
  className?: string;
  size?: number;
}

const ObsidianIcon: React.FC<ObsidianIconProps> = ({ icon, className, size = 20 }) => {
  const iconRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (iconRef.current) {
      iconRef.current.innerHTML = ''; // Clear previous icon
      setIcon(iconRef.current, icon); // Use only two arguments
      const svgElement = iconRef.current.querySelector('svg');
      if (svgElement && size) {
        svgElement.style.width = `${size}px`;
        svgElement.style.height = `${size}px`;
      }
    }
  }, [icon, size]);
  return <span ref={iconRef} className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}></span>;
};

interface FloatingPlayerUIProps {
  isVisible: boolean;
  onClose: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop: () => void;
  isPaused: boolean;
  initialPosition?: { x: number; y: number };
  onDragEnd?: (position: { x: number; y: number }) => void;
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
  onReplay?: () => void;
  onJumpForward?: () => void;
  onJumpBackward?: () => void;
  isLoading?: boolean;
  queueInfo?: { currentIndex: number; totalItems: number; currentTitle?: string; isPlayingFromQueue: boolean };
  onToggleQueue?: () => void;
  isQueueVisible?: boolean;
}

export const FloatingPlayerUI: React.FC<FloatingPlayerUIProps> = ({
  isVisible,
  onClose,
  onPause,
  onResume,
  onStop,
  isPaused,
  initialPosition = { x: 50, y: 50 },
  onDragEnd,
  currentTime = 0,
  duration = 0,
  onSeek,
  onReplay,
  onJumpForward,
  onJumpBackward,
  isLoading = false,
  queueInfo,
  onToggleQueue,
  isQueueVisible = false,
}) => {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const playerRef = useRef<HTMLDivElement>(null);

  // Helper function to get coordinates from either mouse or touch event
  const getEventCoordinates = useCallback((e: MouseEvent | TouchEvent) => {
    if ('touches' in e) {
      // Touch event
      const touch = e.touches[0] || e.changedTouches[0];
      return { clientX: touch.clientX, clientY: touch.clientY };
    } else {
      // Mouse event
      return { clientX: e.clientX, clientY: e.clientY };
    }
  }, []);

  const handlePointerDown = useCallback((e: React.MouseEvent<HTMLDivElement, MouseEvent> | React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Prevent dragging if the click is on a button, the slider, or the close button itself
    if (target.closest('button') || target.closest('.seek-slider') || target.classList.contains('floating-player-close-button-icon')) {
      return;
    }

    setIsDragging(true);
    if (playerRef.current) {
      const rect = playerRef.current.getBoundingClientRect();
      const coords = getEventCoordinates(e.nativeEvent);
      dragStartOffset.current = {
        x: coords.clientX - rect.left,
        y: coords.clientY - rect.top,
      };
    }
    e.preventDefault();
  }, [getEventCoordinates]);

  const handlePointerMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (isDragging) {
      const coords = getEventCoordinates(e);
      setPosition({
        x: coords.clientX - dragStartOffset.current.x,
        y: coords.clientY - dragStartOffset.current.y,
      });
    }
  }, [isDragging, getEventCoordinates]);

  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (onDragEnd) {
        onDragEnd(position);
      }
    }
  }, [isDragging, onDragEnd, position]);

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
  }, [isDragging, handlePointerMove, handlePointerUp]);

  useEffect(() => {
    setPosition(initialPosition);
  }, [initialPosition]);

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (onSeek) {
      onSeek(parseFloat(event.target.value));
    }
  };

  const formatTime = (timeInSeconds: number): string => {
    if (timeInSeconds === Infinity) {
      return "∞";
    }
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  if (!isVisible) {
    return null;
  }

  const isEffectivelyPaused = isPaused;
  const isAtEnd = duration > 0 && currentTime >= duration - 0.1;
  const isReplayState = isEffectivelyPaused && isAtEnd && !!onReplay;

  return (
    <div
      ref={playerRef}
      className="floating-player-ui"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? 'grabbing' : 'grab', // Indicate grabbable
        touchAction: 'none', // Prevent default touch actions during drag
      }}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
    >
      <div onClick={onClose} className="floating-player-close-button" aria-label="Close Player">
        <ObsidianIcon icon="x" size={16} className="floating-player-close-button-icon" />
      </div>

      {onToggleQueue && (
        <div
          onClick={onToggleQueue}
          className={`floating-player-queue-button ${
            // Use top position if there's queue info or streaming text that would provide context
            // Otherwise use bottom position to avoid overlapping with progress bar
            (queueInfo && queueInfo.isPlayingFromQueue) || isLoading ? 'top-position' : 'bottom-position'
            }`}
          aria-label={isQueueVisible ? "Hide Queue" : "Show Queue"}
        >
          <ObsidianIcon
            // icon={isQueueVisible ? "x" : "list-music"} 
            icon="list-music"
            size={12}
          />
        </div>
      )}

      {!isLoading && (
        <div onClick={onStop} aria-label="Stop" className="player-control-button player-stop-button">
          <ObsidianIcon icon="square" size={16} className="floating-player-close-button-icon" />
        </div>
      )}

      <div className="player-content">
        {/* Status text can be removed or kept based on preference, for now it's simplified */}
        {/* <p>{isPaused ? (isAtEnd ? "Finished" : "Paused") : "Playing..."}</p> */}

        {/* Queue information */}
        {queueInfo && queueInfo.isPlayingFromQueue && (
          <div className="queue-info" style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textAlign: 'center' }}>
            Queue: {queueInfo.currentIndex + 1}/{queueInfo.totalItems}
            {queueInfo.currentTitle && <div style={{ fontSize: '10px', opacity: 0.8 }}>{queueInfo.currentTitle}</div>}
          </div>
        )}

        {duration > 0 && (
          <div className="player-progress">
            {isLoading ? (
              <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', width: '100%' }}>Streaming...</div>
            ) : (
              <>
                <span>{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min="0"
                  max={duration}
                  value={currentTime}
                  onChange={handleSeek}
                  className="seek-slider"
                  disabled={!onSeek || duration === 0 || isLoading}
                  aria-label="Seek"
                />
                <span>{formatTime(duration)}</span>
              </>
            )}
          </div>
        )}
        <div className="player-controls">
          {isLoading && (
            <div
              className="player-loading-indicator"
              title="Loading..."
              aria-label="Loading..."
            >
              <ObsidianIcon icon="loader-2" size={18} />
            </div>
          )}
          {!isLoading && (
            <>
              {/* Wrap main controls for centering */}
              <div className="player-main-controls">
                {isReplayState && onReplay && (
                  <button onClick={onReplay} aria-label="Replay">
                    <ObsidianIcon icon="rotate-cw" />
                  </button>
                )}
                {!isReplayState && onJumpBackward && (duration != Infinity) && (
                  <div
                    onClick={onJumpBackward}
                    aria-label="Jump Backward 10s"
                    className="player-control-button"
                  >
                    <ObsidianIcon icon="rotate-ccw" />
                  </div>
                )}
                {!isReplayState && isPaused && onResume && (
                  <button onClick={onResume} aria-label="Resume">
                    <ObsidianIcon icon="play" />
                  </button>
                )}
                {!isReplayState && !isPaused && onPause && (
                  <button onClick={onPause} aria-label="Pause">
                    <ObsidianIcon icon="pause" />
                  </button>
                )}
                {!isReplayState && onJumpForward && (duration != Infinity) && (
                  <div
                    onClick={onJumpForward}
                    aria-label="Jump Forward 10s"
                    className="player-control-button"
                  >
                    <ObsidianIcon icon="rotate-cw" />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}; 
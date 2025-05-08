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
}) => {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const playerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const target = e.target as HTMLElement;
    // Prevent dragging if the click is on a button, the slider, or the close button itself
    if (target.closest('button') || target.closest('.seek-slider') || target.classList.contains('floating-player-close-button-icon')) {
      return;
    }

    setIsDragging(true);
    if (playerRef.current) {
      const rect = playerRef.current.getBoundingClientRect();
      dragStartOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStartOffset.current.x,
        y: e.clientY - dragStartOffset.current.y,
      });
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (onDragEnd) {
        onDragEnd(position);
      }
    }
  }, [isDragging, onDragEnd, position]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

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
      }}
      onMouseDown={handleMouseDown}
    >
      <div onClick={onClose} className="floating-player-close-button" aria-label="Close Player">
        <ObsidianIcon icon="x" size={16} className="floating-player-close-button-icon" />
      </div>

      {!isLoading && (
        <div onClick={onStop} aria-label="Stop" className="player-control-button player-stop-button">
          <ObsidianIcon icon="square" size={16} className="floating-player-close-button-icon" />
        </div>
      )}

      <div className="player-content">
        {/* Status text can be removed or kept based on preference, for now it's simplified */}
        {/* <p>{isPaused ? (isAtEnd ? "Finished" : "Paused") : "Playing..."}</p> */}

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
import React, { useState, useEffect, useRef } from 'react';

interface SplitterProps {
  onResize: (delta: number) => void;
  direction?: 'horizontal' | 'vertical';
  className?: string;
}

export const Splitter: React.FC<SplitterProps> = ({
  onResize,
  direction = 'horizontal',
  className = '',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPosRef.current;
      startPosRef.current = currentPos;
      onResize(delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onResize, direction]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`group relative flex items-center justify-center cursor-col-resize select-none transition-colors duration-150 ${
        direction === 'horizontal' ? 'w-1 hover:w-1.5 h-full' : 'h-1 hover:h-1.5 w-full cursor-row-resize'
      } ${isDragging ? 'bg-accent-blue/80' : 'bg-border-subtle hover:bg-accent-blue/50'} ${className}`}
    >
      <div className="opacity-0 group-hover:opacity-100 transition-opacity w-1 h-8 rounded-full bg-accent-blue" />
    </div>
  );
};

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
        direction === 'horizontal' ? 'w-[1px] hover:w-1 h-full' : 'h-[1px] hover:h-1 w-full cursor-row-resize'
      } ${isDragging ? 'bg-[#8AB4F8]/70' : 'bg-[#222226] hover:bg-[#3A3A3F]'} ${className}`}
    >
      <div className="opacity-0 group-hover:opacity-100 transition-opacity w-0.5 h-8 rounded-full bg-[#8AB4F8]/60" />
    </div>
  );
};

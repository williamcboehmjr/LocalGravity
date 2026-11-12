import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'blue' | 'amber' | 'emerald' | 'cyan' | 'neutral' | 'purple';
  size?: 'sm' | 'md';
  className?: string;
  icon?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'sm',
  className = '',
  icon,
}) => {
  const variantStyles = {
    blue: 'bg-blue-950/50 text-blue-400 border-blue-800/50',
    amber: 'bg-amber-950/50 text-amber-400 border-amber-800/50',
    emerald: 'bg-emerald-950/50 text-emerald-400 border-emerald-800/50',
    cyan: 'bg-cyan-950/50 text-cyan-400 border-cyan-800/50',
    purple: 'bg-purple-950/50 text-purple-400 border-purple-800/50',
    neutral: 'bg-surface-muted text-text-secondary border-border-subtle',
  };

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5 rounded-full',
    md: 'text-xs px-2.5 py-1 rounded-md font-medium',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 border font-mono tracking-tight ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  );
};

'use client';

import React from 'react';

export function IslandCard({ children, className = '' }: { children: React.ReactNode; className?: string; noPadding?: boolean }) {
  return (
    <div className={`bg-card ${className}`}>
      {children}
    </div>
  );
}

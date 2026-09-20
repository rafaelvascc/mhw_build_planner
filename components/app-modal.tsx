'use client';

import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type AppModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'default' | 'wide';
  bodyClassName?: string;
};

export function AppModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'default',
  bodyClassName = '',
}: AppModalProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={`app-modal ${size === 'wide' ? 'app-modal-wide' : ''}`}>
      <header className="app-modal-header">
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </header>
      <div className={`app-modal-body ${bodyClassName}`}>{children}</div>
      {footer && <footer className="app-modal-footer">{footer}</footer>}
    </DialogContent>
  </Dialog>;
}

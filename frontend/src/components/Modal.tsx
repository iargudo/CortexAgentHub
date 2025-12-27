import { X } from 'lucide-react';
import { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  maxHeight?: string;
}

export function Modal({ isOpen, onClose, title, children, maxWidth = 'md', maxHeight }: ModalProps) {
  if (!isOpen) return null;

  const widthClasses = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
    '2xl': 'max-w-7xl',
    '4xl': 'max-w-[90vw]',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div
          className={`relative bg-white rounded-lg shadow-xl ${widthClasses[maxWidth]} w-full ${
            maxHeight ? `max-h-[${maxHeight}]` : 'max-h-[90vh]'
          } flex flex-col`}
          style={maxHeight ? { maxHeight } : { maxHeight: '90vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b p-4 flex-shrink-0">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

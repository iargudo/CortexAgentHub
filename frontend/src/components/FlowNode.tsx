import { useEffect, useRef } from 'react';
import { Handle, Position } from 'reactflow';

interface FlowNodeProps {
  data: any;
  selected?: boolean;
}

/**
 * Simple custom node component that applies styles from data.style
 * Includes ReactFlow Handles for connections
 */
export const FlowNode = ({ data, selected }: FlowNodeProps) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  
  // Remove black border from ReactFlow's parent wrapper
  useEffect(() => {
    if (nodeRef.current) {
      const parentNode = nodeRef.current.closest('.react-flow__node');
      if (parentNode) {
        (parentNode as HTMLElement).style.border = 'none';
        (parentNode as HTMLElement).style.outline = 'none';
        (parentNode as HTMLElement).style.boxShadow = 'none';
      }
    }
  }, []);

  // Merge selected state with existing styles
  // Ensure no black border is applied by default, but preserve custom borders from data.style
  const baseStyle = data.style || {};
  
  // Build node style ensuring border is explicitly set
  const nodeStyle: Record<string, any> = {
    outline: 'none',
    ...baseStyle,
    // Explicitly set border - use from baseStyle if exists, otherwise none
    border: baseStyle.border || 'none',
    // Override with selection border if selected (this takes precedence)
    ...(selected ? { 
      border: '3px solid #3B82F6', 
      boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.3)',
      outline: 'none'
    } : {}),
  };

  return (
    <div 
      ref={nodeRef}
      style={nodeStyle}
      className="react-flow__node-default"
    >
      {/* Target handle (top) - for incoming connections */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#555', width: '8px', height: '8px' }}
      />
      
      <div style={{ whiteSpace: 'pre-line', fontSize: data.style?.fontSize || '12px' }}>
        {data.label}
      </div>
      
      {/* Source handle (bottom) - for outgoing connections */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#555', width: '8px', height: '8px' }}
      />
    </div>
  );
};


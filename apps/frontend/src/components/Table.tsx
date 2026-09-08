import React from 'react';
import { Table as TableType, TableStatus, TableShape } from '../types/table.types';

interface TableComponentProps {
  table: TableType;
  isDragging?: boolean;
  draggable?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onClick?: () => void;
}

const TableComponent: React.FC<TableComponentProps> = ({
  table,
  isDragging = false,
  onMouseDown,
  onClick,
}) => {
  const getStatusColor = (status: TableStatus): string => {
    const colors: { [key: string]: string } = {
      'AVAILABLE': '#10b981',
      'OCCUPIED': '#ef4444',
      'RESERVED': '#3b82f6',
      'DIRTY': '#f59e0b',
      'CLEANING': '#8b5cf6',
    };
    return colors[status] || '#6b7280';
  };

  const getShapeStyles = (shape: TableShape, width: number, height: number) => {
    const baseStyles: React.CSSProperties = {
      width: `${width}px`,
      height: `${height}px`,
    };

    switch (shape) {
      case TableShape.CIRCLE:
        return {
          ...baseStyles,
          borderRadius: '50%',
        };
      case TableShape.BOOTH:
        return {
          ...baseStyles,
          borderRadius: '12px',
          border: '3px solid #6b7280',
        };
      case TableShape.RECTANGLE:
      case TableShape.SQUARE:
      default:
        return {
          ...baseStyles,
          borderRadius: '8px',
        };
    }
  };

  const statusColor = getStatusColor(table.status);
  const shapeStyles = getShapeStyles(table.shape, table.width, table.height);

  return (
    <div
      className="table-component"
      style={{
        position: 'absolute',
        left: `${table.x}px`,
        top: `${table.y}px`,
        ...shapeStyles,
        backgroundColor: statusColor,
        opacity: isDragging ? 0.6 : 1,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: isDragging
          ? '0 10px 25px rgba(0,0,0,0.3)'
          : '0 2px 8px rgba(0,0,0,0.15)',
        transition: isDragging ? 'none' : 'box-shadow 0.2s',
        userSelect: 'none',
        border: '2px solid rgba(0,0,0,0.1)',
      }}
      onMouseDown={onMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {/* Table Number */}
      <div
        style={{
          fontSize: '18px',
          fontWeight: 'bold',
          color: 'white',
          textShadow: '0 1px 2px rgba(0,0,0,0.3)',
        }}
      >
        {table.number}
      </div>

      {/* Capacity */}
      <div
        style={{
          fontSize: '12px',
          color: 'rgba(255,255,255,0.9)',
          marginTop: '4px',
        }}
      >
        {table.capacity} seats
      </div>

      {/* Active order indicator */}
      {table.currentOrder && (
        <div
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: 'white',
            border: '2px solid rgba(0,0,0,0.2)',
          }}
        />
      )}
    </div>
  );
};

export default TableComponent;

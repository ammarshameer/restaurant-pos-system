import React, { useState } from 'react';

export interface InventoryItemFormValues {
  name: string;
  sku: string;
  category: string;
  quantity: number;
  unit: string;
  purchaseUnit: string;
  conversionFactor: number;
  reorderPoint: number;
  costPerUnit: number;
}

interface InventoryItemFormModalProps {
  mode: 'add' | 'edit';
  initialValues: InventoryItemFormValues;
  onClose: () => void;
  onSave: (values: InventoryItemFormValues) => void | Promise<void>;
}

const CATEGORIES = ['Meat', 'Dairy', 'Bakery', 'Frozen', 'Grocery', 'Beverage'];
const UNITS = ['g', 'kg', 'ml', 'l', 'each', 'lbs', 'oz', 'cans', 'boxes'];

const optionsWithCurrent = (options: string[], current: string) =>
  current && !options.includes(current) ? [current, ...options] : options;

export const InventoryItemFormModal: React.FC<InventoryItemFormModalProps> = ({
  mode,
  initialValues,
  onClose,
  onSave,
}) => {
  const [values, setValues] = useState<InventoryItemFormValues>(initialValues);
  const isEdit = mode === 'edit';

  const update = <K extends keyof InventoryItemFormValues>(
    key: K,
    value: InventoryItemFormValues[K]
  ) => setValues((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSave(values);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-text">
            <h3 className="modal-title">{isEdit ? '✏️ Edit Inventory Item' : '+ Add New Inventory Item'}</h3>
            <p className="modal-subtitle">
              {isEdit
                ? 'Update the catalog details for this inventory item'
                : 'Track ingredients, beverages, and supplies in the database catalog'}
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close dialog"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="input-label">
                <span>Item Name</span>
                <span className="label-hint">Required</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Premium Angus Beef Patties"
                className="input-field"
                value={values.name}
                onChange={(e) => update('name', e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="form-group">
                <label className="input-label">
                  <span>SKU / Barcode</span>
                  <span className="label-hint">Auto or custom</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. BEEF-001"
                  className="input-field"
                  value={values.sku}
                  onChange={(e) => update('sku', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="input-label">
                  <span>Category</span>
                  <span className="label-hint">Department</span>
                </label>
                <select
                  className="input-field"
                  value={values.category}
                  onChange={(e) => update('category', e.target.value)}
                >
                  {optionsWithCurrent(CATEGORIES, values.category).map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="form-group">
                <label className="input-label">
                  <span>{isEdit ? 'Current Quantity' : 'Initial Quantity'}</span>
                  <span className="label-hint">
                    {isEdit ? 'Use Adjust Stock to change' : 'In stock now'}
                  </span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="input-field"
                  value={values.quantity}
                  readOnly={isEdit}
                  onChange={(e) => update('quantity', Number(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label className="input-label">
                  <span>Sale / Usage Unit</span>
                  <span className="label-hint">Stock is tracked in this unit</span>
                </label>
                <select
                  className="input-field"
                  value={values.unit}
                  onChange={(e) => update('unit', e.target.value)}
                >
                  {optionsWithCurrent(UNITS, values.unit).map((unit) => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="form-group">
                <label className="input-label"><span>Purchase Unit</span><span className="label-hint">Bought in</span></label>
                <select
                  className="input-field"
                  value={values.purchaseUnit}
                  onChange={(e) => update('purchaseUnit', e.target.value)}
                >
                  {optionsWithCurrent(UNITS, values.purchaseUnit).map((unit) => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="input-label">
                  <span>Sale Units per Purchase Unit</span>
                  <span className="label-hint">Used for packs or cases</span>
                </label>
                <input
                  type="number"
                  min="0.0001"
                  step="any"
                  className="input-field"
                  value={values.conversionFactor}
                  onChange={(e) => update('conversionFactor', Number(e.target.value))}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: 0 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="input-label">
                  <span>Reorder Point</span>
                  <span className="label-hint">Low stock alert</span>
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  className="input-field"
                  value={values.reorderPoint}
                  onChange={(e) => update('reorderPoint', Number(e.target.value))}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="input-label">
                  <span>Cost per Purchase Unit (PKR)</span>
                  <span className="label-hint">{values.purchaseUnit}</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  className="input-field"
                  value={values.costPerUnit}
                  onChange={(e) => update('costPerUnit', Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {isEdit ? '✓ Save Changes' : '✓ Save Item to Catalog'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { customerApi, Customer } from '../api/customer.api';
import { formatPKR } from '../utils/format';

export interface CustomerPickerValue {
  name: string;
  phone: string;
  customerId: string | null;
}

interface CustomerPickerProps {
  name: string;
  phone: string;
  selectedCustomerId: string | null;
  onChange: (value: CustomerPickerValue) => void;
  onNotify?: (message: string) => void;
  namePlaceholder?: string;
  phonePlaceholder?: string;
  required?: boolean;
  compact?: boolean;
}

const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');

/**
 * Customer combobox used on the POS screen.
 *
 * Clicking either field opens a list of existing customers. Typing filters the
 * list; if the entered name/phone does not belong to any customer, an "add new
 * customer" option is offered. Selecting an existing customer fills both the
 * name and phone fields and links the customer id to the order.
 */
const CustomerPicker: React.FC<CustomerPickerProps> = ({
  name,
  phone,
  selectedCustomerId,
  onChange,
  onNotify,
  namePlaceholder = 'Customer Name (Optional)...',
  phonePlaceholder = 'Mobile Number (Optional)...',
  required = false,
  compact = false,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  // Load customers whenever the dropdown opens or the search text changes.
  useEffect(() => {
    if (!open) return;
    const query =
      trimmedName.length >= 2 ? trimmedName : trimmedPhone.length >= 2 ? trimmedPhone : '';
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await customerApi.list({ search: query || undefined, limit: 10 });
        if (!cancelled) setCustomers(result.data);
      } catch {
        if (!cancelled) setCustomers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, trimmedName, trimmedPhone]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const exactMatch = useMemo(() => {
    if (trimmedPhone.length >= 4) {
      const byPhone = customers.find(
        (customer) => normalizePhone(customer.phone) === normalizePhone(trimmedPhone)
      );
      if (byPhone) return byPhone;
    }
    if (trimmedName) {
      return (
        customers.find(
          (customer) => customer.name.trim().toLowerCase() === trimmedName.toLowerCase()
        ) || null
      );
    }
    return null;
  }, [customers, trimmedName, trimmedPhone]);

  const canCreate = trimmedName.length > 0 && !exactMatch;
  const showDropdown = open;

  const handleSelect = (customer: Customer) => {
    onChange({
      name: customer.name,
      phone: customer.phone || '',
      customerId: customer.id,
    });
    setOpen(false);
  };

  const handleCreate = async () => {
    if (!canCreate || creating) return;
    // If the backend already knows this name/phone, select instead of duplicating.
    if (exactMatch) {
      handleSelect(exactMatch);
      return;
    }
    setCreating(true);
    try {
      // Re-check against the server so we never create a duplicate while the
      // visible list is still loading or filtered.
      const lookup = await customerApi.list({
        search: trimmedPhone || trimmedName,
        limit: 10,
      });
      const existing =
        (trimmedPhone
          ? lookup.data.find(
              (customer) => normalizePhone(customer.phone) === normalizePhone(trimmedPhone)
            )
          : undefined) ||
        lookup.data.find(
          (customer) => customer.name.trim().toLowerCase() === trimmedName.toLowerCase()
        );
      if (existing) {
        handleSelect(existing);
        onNotify?.(`Existing customer "${existing.name}" selected`);
        return;
      }

      const created = await customerApi.create({
        name: trimmedName,
        phone: trimmedPhone || undefined,
      });
      onChange({ name: created.name, phone: created.phone || '', customerId: created.id });
      setOpen(false);
      onNotify?.(`Customer "${created.name}" added`);
    } catch (error: any) {
      const status = error?.response?.status;
      const message = error?.response?.data?.error || 'Failed to add customer';
      if (status === 409) {
        // Duplicate phone: look the existing customer up and link it instead.
        try {
          const result = await customerApi.list({
            search: trimmedPhone || trimmedName,
            limit: 10,
          });
          const existing =
            result.data.find(
              (customer) => normalizePhone(customer.phone) === normalizePhone(trimmedPhone)
            ) || result.data[0];
          if (existing) {
            handleSelect(existing);
            onNotify?.(`Existing customer "${existing.name}" selected`);
            return;
          }
        } catch {
          // fall through to the notification below
        }
      }
      onNotify?.(message);
    } finally {
      setCreating(false);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (exactMatch) handleSelect(exactMatch);
      else if (canCreate) void handleCreate();
    }
  };

  const inputStyle: React.CSSProperties = compact
    ? { fontSize: '12px', padding: '6px 8px' }
    : { fontSize: '13px', padding: '8px 12px' };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', gridColumn: compact ? undefined : '1 / -1' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: compact ? '8px' : '10px' }}>
        <input
          type="text"
          className="form-input"
          placeholder={namePlaceholder}
          value={name}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            onChange({ name: event.target.value, phone, customerId: null });
            setOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          style={inputStyle}
          autoComplete="off"
        />
        <input
          type="tel"
          className="form-input"
          placeholder={phonePlaceholder}
          value={phone}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            onChange({ name, phone: event.target.value, customerId: null });
            setOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          style={inputStyle}
          autoComplete="off"
        />
      </div>

      {selectedCustomer && !open && (
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
          ✓ Linked: {selectedCustomer.name}
          {selectedCustomer.phone ? ` (${selectedCustomer.phone})` : ''}
        </div>
      )}
      {!selectedCustomer && selectedCustomerId && !open && (
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
          ✓ Linked Customer
        </div>
      )}

      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 60,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            boxShadow: 'var(--shadow-lg, 0 12px 30px rgba(0,0,0,0.35))',
            overflow: 'hidden',
            maxHeight: '300px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            Existing Customers
          </div>

          {loading && (
            <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
              Searching…
            </div>
          )}

          {!loading && customers.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
              {trimmedName || trimmedPhone ? 'No matching customer.' : 'No customers yet.'}
            </div>
          )}

          {!loading &&
            customers.map((customer) => {
              const selected = customer.id === selectedCustomerId;
              const isExact = exactMatch?.id === customer.id;
              return (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => handleSelect(customer)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    textAlign: 'left',
                    padding: '9px 12px',
                    border: 0,
                    borderBottom: '1px solid var(--border-color)',
                    background: selected
                      ? 'var(--primary-tint)'
                      : isExact
                      ? 'rgba(var(--primary-rgb, 224, 169, 63), 0.08)'
                      : 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: '13px' }}>
                      {customer.name}
                      {isExact && !selected ? (
                        <span style={{ marginLeft: 6, fontSize: '10px', color: 'var(--primary)' }}>
                          match
                        </span>
                      ) : null}
                    </span>
                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>
                      {customer.phone || 'No phone'}
                    </span>
                  </span>
                  {customer.balanceDue ? (
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#ef4444',
                        fontWeight: 700,
                        background: 'rgba(239, 68, 68, 0.1)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Udhaar: {formatPKR(customer.balanceDue)}
                    </span>
                  ) : selected ? (
                    <span style={{ color: 'var(--primary)', fontWeight: 800 }}>✓</span>
                  ) : null}
                </button>
              );
            })}

          {canCreate && (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: '8px',
                textAlign: 'left',
                padding: '10px 12px',
                border: 0,
                background: 'rgba(var(--primary-rgb, 224, 169, 63), 0.1)',
                color: 'var(--primary)',
                fontWeight: 700,
                fontSize: '12px',
                cursor: creating ? 'wait' : 'pointer',
              }}
            >
              <span style={{ fontSize: '15px', lineHeight: 1 }}>＋</span>
              <span style={{ minWidth: 0 }}>
                {creating ? 'Adding…' : `Add "${trimmedName}"`}
                {trimmedPhone ? (
                  <span style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)' }}>
                    {trimmedPhone}
                  </span>
                ) : null}
              </span>
            </button>
          )}

          {!canCreate && !trimmedName && !trimmedPhone && (
            <div style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)' }}>
              Start typing a name or mobile number to add a new customer.
            </div>
          )}

          {required && !trimmedName && (
            <div style={{ padding: '8px 12px', fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>
              Customer name is required.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CustomerPicker;

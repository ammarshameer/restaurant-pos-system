import React, { useEffect, useState } from 'react';
import { customerApi, Customer } from '../api/customer.api';
import { formatPKR } from '../utils/format';

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await customerApi.list({ page, limit, search });
      setCustomers(result.data); setTotalCount(result.totalCount); setHasMore(result.hasMore);
    } finally { setLoading(false); }
  };
  useEffect(() => { const timer = window.setTimeout(load, search ? 300 : 0); return () => window.clearTimeout(timer); }, [page, limit, search]);

  const edit = async (customer?: Customer) => {
    const name = window.prompt('Name', customer?.name || '');
    if (!name?.trim()) return;
    const phone = window.prompt('Phone', customer?.phone || '') || undefined;
    const email = window.prompt('Email', customer?.email || '') || undefined;
    try {
      if (customer) await customerApi.update(customer.id, { name, phone, email });
      else await customerApi.create({ name, phone, email });
      load();
    } catch (error: any) { alert(error?.response?.data?.error || 'Failed to save customer'); }
  };

  const remove = async (customer: Customer) => {
    if (!window.confirm(`Delete ${customer.name}?`)) return;
    await customerApi.delete(customer.id);
    load();
  };

  const pageCount = Math.max(1, Math.ceil(totalCount / limit));
  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} placeholder="Search customers..." style={{ padding: 8 }} />
        <button onClick={() => edit()} className="btn btn-primary">Add Customer</button>
      </div>
      {loading ? <div>Loading...</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th>Customer</th><th>Phone</th><th>Email</th><th>Orders</th><th>Total Spent</th><th>Last Order</th><th>Actions</th></tr></thead>
          <tbody>{customers.map(customer => (
            <tr key={customer.id}>
              <td>{customer.name}</td><td>{customer.phone || '-'}</td><td>{customer.email || '-'}</td><td>{customer.totalOrders}</td>
              <td>{formatPKR(customer.totalSpent || 0)}</td><td>{customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString() : '-'}</td>
              <td><button onClick={() => edit(customer)}>Edit</button>{' '}<button onClick={() => remove(customer)}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
        <select value={limit} onChange={(e) => { setPage(1); setLimit(Number(e.target.value)); }}><option>10</option><option>20</option><option>50</option></select>
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} of {pageCount}</span>
        <button disabled={!hasMore} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
};

export default CustomersPage;

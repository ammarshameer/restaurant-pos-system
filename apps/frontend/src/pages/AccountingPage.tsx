import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { accountingApi } from '../api/accounting.api';
import { RootState } from '../store/store';
import { formatPKR } from '../utils/format';

const iso = (date: Date) => date.toISOString().slice(0, 10);

export const AccountingPage: React.FC = () => {
  const now = new Date();
  const [startDate, setStartDate] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [endDate, setEndDate] = useState(iso(now));
  const [summary, setSummary] = useState<any>(null);
  const [transactions, setTransactions] = useState<any>(null);
  const [page, setPage] = useState(1);
  const { user } = useSelector((state: RootState) => state.auth);

  const load = async () => {
    const [summaryResult, transactionResult] = await Promise.all([
      accountingApi.summary(startDate, endDate),
      accountingApi.transactions({ page, limit: 20, startDate, endDate }),
    ]);
    setSummary(summaryResult); setTransactions(transactionResult);
  };
  useEffect(() => { load().catch(() => undefined); }, [startDate, endDate, page]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <input type="date" value={startDate} onChange={e => { setPage(1); setStartDate(e.target.value); }} />
        <input type="date" value={endDate} onChange={e => { setPage(1); setEndDate(e.target.value); }} />
      </div>
      {summary && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 16 }}>
          {[['Gross Sales', summary.grossSales], ['Net Sales', summary.netSales], ['Tax', summary.tax], ['Service Charge', summary.serviceCharge], ['Average Ticket', summary.averageTicket]].map(([label, value]) =>
            <div key={String(label)} style={{ background: '#1e293b', padding: 16, borderRadius: 8 }}><div>{label}</div><strong>{formatPKR(Number(value) || 0)}</strong></div>)}
        </div>
        {(user?.features || []).includes('costing') && summary.cogs !== undefined && (
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <div>COGS: {formatPKR(summary.cogs)}</div><div>Gross Profit: {formatPKR(summary.grossProfit)}</div>
          </div>
        )}
        <h3>Payments by method</h3>
        <table><tbody>{summary.paymentsByMethod?.map((item: any) => <tr key={item.method}><td>{item.method}</td><td>{item.count}</td><td>{formatPKR(item.amount)}</td></tr>)}</tbody></table>
      </>}
      {transactions && <>
        <h3>Transactions</h3>
        <table style={{ width: '100%' }}><tbody>{transactions.data.map((order: any) => <tr key={order.id}><td>{order.orderNumber}</td><td>{order.customerName || '-'}</td><td>{formatPKR(order.total)}</td><td>{order.paymentStatus}</td></tr>)}</tbody></table>
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page}</span>
          <button disabled={!transactions.hasMore} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </>}
    </div>
  );
};

export default AccountingPage;

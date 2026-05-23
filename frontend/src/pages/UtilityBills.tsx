import { useEffect, useState } from 'react';
import { Plus, Droplets, Zap, Flame, Building2 } from 'lucide-react';
import api from '../api/client';
import { Expense, Property } from '../types';

const UTILITY_LABELS: Record<string, string> = { WATER: '水費', ELECTRICITY: '電費', GAS: '瓦斯費' };
const UTILITY_COLORS: Record<string, string> = { WATER: '#60a5fa', ELECTRICITY: '#f59e0b', GAS: '#f97316' };
const UTILITY_ICONS: Record<string, React.ReactNode> = {
  WATER: <Droplets className="w-3.5 h-3.5" />,
  ELECTRICITY: <Zap className="w-3.5 h-3.5" />,
  GAS: <Flame className="w-3.5 h-3.5" />,
};

export default function UtilityBills() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, [year, month]);

  async function fetchData() {
    setLoading(true);
    const [r, p] = await Promise.all([
      api.get(`/expenses?year=${year}&month=${month}`),
      api.get('/properties'),
    ]);
    setExpenses(r.data.filter((e: Expense) => ['WATER', 'ELECTRICITY', 'GAS'].includes(e.category)));
    setProperties(p.data);
    setLoading(false);
  }

  async function deleteExpense(id: string) {
    if (!confirm('確定刪除此帳單？')) return;
    await api.delete(`/expenses/${id}`);
    fetchData();
  }

  const totalByCategory: Record<string, number> = {};
  for (const e of expenses) {
    totalByCategory[e.category] = (totalByCategory[e.category] ?? 0) + Number(e.amount);
  }

  const allUnits = properties.flatMap((p) =>
    p.units.map((u) => ({ ...u, propertyName: p.name, propertyId: p.id }))
  );

  return (
    <div className="px-6 py-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">水電帳單</h1>
          <p className="text-xs text-gray-400 mt-0.5">{year} 年 {month} 月公用費用管理</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="input text-xs py-1.5 px-2 w-20">
            {[now.getFullYear() - 1, now.getFullYear()].map((y) => <option key={y}>{y}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="input text-xs py-1.5 px-2 w-16">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m} 月</option>)}
          </select>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-sm flex items-center gap-1">
            <Plus className="w-4 h-4" />新增帳單
          </button>
        </div>
      </div>

      {/* Category summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {['WATER', 'ELECTRICITY', 'GAS'].map((cat) => (
          <div key={cat} className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span style={{ color: UTILITY_COLORS[cat] }}>{UTILITY_ICONS[cat]}</span>
              <span className="text-xs text-gray-500">{UTILITY_LABELS[cat]}</span>
            </div>
            <div className="text-lg font-bold text-gray-800">NT${(totalByCategory[cat] ?? 0).toLocaleString()}</div>
            <div className="text-xs text-gray-400">{expenses.filter((e) => e.category === cat).length} 筆</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">載入中...</div>
      ) : expenses.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 text-center py-12">
          <div className="text-gray-400 text-sm mb-3">本月無水電帳單</div>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-sm flex items-center gap-1 mx-auto">
            <Plus className="w-4 h-4" />新增帳單
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400">
                <th className="text-left px-4 py-3 font-medium">類別</th>
                <th className="text-left px-4 py-3 font-medium">物業 / 房間</th>
                <th className="text-left px-4 py-3 font-medium">說明</th>
                <th className="text-left px-4 py-3 font-medium">日期</th>
                <th className="text-right px-4 py-3 font-medium">金額</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-warm/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span style={{ color: UTILITY_COLORS[e.category] }}>{UTILITY_ICONS[e.category]}</span>
                      <span className="font-medium text-gray-700">{UTILITY_LABELS[e.category]}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-gray-500 text-xs">
                      <Building2 className="w-3 h-3" />
                      <span>{e.property?.name ?? '—'}</span>
                      {e.unit?.unitNumber && <span className="text-gray-400">/ {e.unit.unitNumber}</span>}
                      {!e.property && !e.unit && <span className="text-gray-300">未指定</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{e.description || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(e.date).toLocaleDateString('zh-TW')}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-700">NT${Number(e.amount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => deleteExpense(e.id)} className="text-xs text-red-400 hover:text-red-600">刪除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddUtilityModal
          properties={properties}
          allUnits={allUnits}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); fetchData(); }}
        />
      )}
    </div>
  );
}

function AddUtilityModal({ properties, allUnits, onClose, onSaved }: {
  properties: Property[];
  allUnits: Array<{ id: string; unitNumber: string; propertyName: string; propertyId: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const now = new Date();
  const [form, setForm] = useState({
    category: 'ELECTRICITY',
    amount: '',
    date: now.toISOString().split('T')[0],
    description: '',
    propertyId: properties[0]?.id ?? '',
    unitId: '',
  });

  const unitsForProperty = allUnits.filter((u) => u.propertyId === form.propertyId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/expenses', {
      category: form.category,
      amount: form.amount,
      date: form.date,
      description: form.description,
      propertyId: form.propertyId || undefined,
      unitId: form.unitId || undefined,
    });
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
        <h3 className="font-bold text-lg mb-4">新增水電帳單</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">類別</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input">
              <option value="ELECTRICITY">電費</option>
              <option value="WATER">水費</option>
              <option value="GAS">瓦斯費</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">物業</label>
            <select
              value={form.propertyId}
              onChange={(e) => setForm({ ...form, propertyId: e.target.value, unitId: '' })}
              className="input"
            >
              <option value="">不指定</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {form.propertyId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">房間（選填，公共區域可不填）</label>
              <select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} className="input">
                <option value="">公共區域</option>
                {unitsForProperty.map((u) => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">金額 <span className="text-red-400">*</span></label>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" required placeholder="NT$" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日期 <span className="text-red-400">*</span></label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">說明</label>
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" placeholder="例：5月份電費、共用區域水費..." />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">取消</button>
            <button type="submit" className="btn-primary flex-1">新增</button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { BellRing, Volume2, BellOff } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import { BellSettings, DueItem, loadBellSettings, saveBellSettings, saveAcked, playBell } from '../lib/rentBell';

interface ScheduleItem {
  contractId: string;
  propertyName: string;
  unitNumber: string;
  tenantName: string;
  amount: number;
  dueDay: number;
  status: string;
}

interface OverdueItem {
  rentRecordId: string;
  propertyName: string;
  unitNumber: string;
  tenantName: string;
  amount: number;
  paidAmount: number;
  year: number;
  month: number;
}

interface Alerts {
  date: string;
  dueToday: DueItem[];
  overdue: OverdueItem[];
  schedule: ScheduleItem[];
}

const STATUS: Record<string, [string, string]> = {
  PAID: ['已繳', 'badge-paid'],
  PENDING: ['待繳', 'badge-pending'],
  PARTIAL: ['部分', 'badge-pending'],
  OVERDUE: ['逾期', 'badge-overdue'],
  NOT_GENERATED: ['未開單', 'badge-pending'],
};

export default function RentBell() {
  const [settings, setSettings] = useState<BellSettings>(loadBellSettings);
  const [data, setData] = useState<Alerts | null>(null);
  const [permission, setPermission] = useState<string>(
    'Notification' in window ? Notification.permission : 'unsupported',
  );

  useEffect(() => {
    api.get('/rent-alerts/today').then((r) => setData(r.data));
  }, []);

  function update(patch: Partial<BellSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveBellSettings(next);
  }

  async function askPermission() {
    if (!('Notification' in window)) return;
    setPermission(await Notification.requestPermission());
  }

  function ringAgainToday() {
    if (!data) return;
    saveAcked(data.date, []);
    window.dispatchEvent(new Event('rentbell:settings'));
  }

  const today = data ? Number(data.date.slice(-2)) : 0;
  const time = `${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')}`;

  return (
    <div className="px-6 py-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">收租鈴聲</h1>
        <p className="text-xs text-gray-400 mt-0.5">每間房的繳租日當天響鈴提醒您收房租</p>
      </div>

      <HowTo module="bell" />

      {/* 設定 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {settings.enabled ? <BellRing className="w-5 h-5 text-brand" /> : <BellOff className="w-5 h-5 text-gray-400" />}
            <span className="text-sm font-semibold text-gray-700">繳租日當天響鈴</span>
          </div>
          <button
            onClick={() => update({ enabled: !settings.enabled })}
            className={`w-11 h-6 rounded-full relative transition-colors ${settings.enabled ? 'bg-brand' : 'bg-gray-200'}`}
            aria-label="切換響鈴"
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${settings.enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">
            當天幾點開始響
            <input
              type="time"
              value={time}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (!Number.isNaN(h)) update({ hour: h, minute: m || 0 });
              }}
              className="input mt-1 w-full"
            />
          </label>
          <label className="text-xs text-gray-500">
            沒按「我知道了」時，重複響鈴間隔
            <select
              value={settings.repeatSeconds}
              onChange={(e) => update({ repeatSeconds: Number(e.target.value) })}
              className="input mt-1 w-full"
            >
              <option value={30}>每 30 秒</option>
              <option value={60}>每 1 分鐘</option>
              <option value={300}>每 5 分鐘</option>
              <option value={900}>每 15 分鐘</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => playBell()} className="flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            <Volume2 className="w-3.5 h-3.5" /> 試聽鈴聲
          </button>
          {permission === 'default' && (
            <button onClick={askPermission} className="text-xs bg-brand text-white rounded-lg px-3 py-1.5 hover:bg-brand-dark">
              允許系統通知
            </button>
          )}
          {permission === 'granted' && <span className="text-xs text-brand px-1 py-1.5">系統通知已開啟</span>}
          {permission === 'denied' && <span className="text-xs text-orange-600 px-1 py-1.5">系統通知被封鎖，請到瀏覽器網站設定中允許</span>}
          <button onClick={ringAgainToday} className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            今天重新提醒
          </button>
        </div>
      </div>

      {!data ? (
        <div className="text-center text-gray-400 py-16 text-sm">載入中...</div>
      ) : (
        <>
          {/* 今日 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5">
            <div className="text-sm font-semibold text-gray-700 mb-3">今天（{data.date}）要收</div>
            {data.dueToday.length === 0 ? (
              <div className="text-sm text-gray-400">今天沒有房間到繳租日</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {data.dueToday.map((i) => (
                  <li key={i.contractId} className="py-2 flex justify-between text-sm">
                    <span className="text-gray-700">{i.propertyName} {i.unitNumber}・{i.tenantName}</span>
                    <span className="font-bold text-gray-800">NT${(i.amount - i.paidAmount).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.overdue.length > 0 && (
            <div className="bg-white rounded-2xl border border-red-100 p-4 mb-5">
              <div className="text-sm font-semibold text-red-600 mb-3">已過繳租日還沒收（{data.overdue.length} 筆）</div>
              <ul className="divide-y divide-gray-50">
                {data.overdue.map((o) => (
                  <li key={o.rentRecordId} className="py-2 flex justify-between text-sm">
                    <span className="text-gray-700">{o.year}/{o.month}・{o.propertyName} {o.unitNumber}・{o.tenantName}</span>
                    <span className="font-bold text-red-500">NT${(o.amount - o.paidAmount).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 各房間繳租日 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">本月各房間繳租日</div>
            {data.schedule.length === 0 ? (
              <div className="text-sm text-gray-400">目前沒有生效中的合約。繳租日在「合約」建立時設定。</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-2 text-left font-medium">繳租日</th>
                      <th className="py-2 text-left font-medium">房間</th>
                      <th className="py-2 text-left font-medium">租客</th>
                      <th className="py-2 text-right font-medium">租金</th>
                      <th className="py-2 text-right font-medium">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.schedule.map((s) => {
                      const [label, cls] = STATUS[s.status] ?? [s.status, ''];
                      const isToday = s.dueDay === today;
                      return (
                        <tr key={s.contractId} className={`border-b border-gray-50 last:border-0 ${isToday ? 'bg-brand/5' : ''}`}>
                          <td className="py-2 whitespace-nowrap font-semibold text-gray-700">
                            每月 {s.dueDay} 號{isToday && <span className="ml-1.5 text-xs text-brand">今天</span>}
                          </td>
                          <td className="py-2 whitespace-nowrap text-gray-700">{s.propertyName} {s.unitNumber}</td>
                          <td className="py-2 whitespace-nowrap text-gray-600">{s.tenantName}</td>
                          <td className="py-2 whitespace-nowrap text-right text-gray-700">NT${s.amount.toLocaleString()}</td>
                          <td className="py-2 text-right"><span className={cls}>{label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

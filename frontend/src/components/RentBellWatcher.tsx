import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, X, Volume2 } from 'lucide-react';
import api from '../api/client';
import {
  DueItem, loadBellSettings, loadAcked, saveAcked, playBell,
  unlockAudioOnGesture, audioBlocked, showSystemNotification,
} from '../lib/rentBell';

const POLL_MS = 5 * 60 * 1000;
const CHECK_MS = 20 * 1000;

/**
 * 掛在 Layout 上，登入後全站常駐。
 * 今天是某間房的繳租日、時間到了、且房東還沒按「我知道了」→ 跳出視窗並響鈴，
 * 沒確認就每隔 repeatSeconds 再響一次。
 */
export default function RentBellWatcher() {
  const navigate = useNavigate();
  const [date, setDate] = useState('');
  const [items, setItems] = useState<DueItem[]>([]);
  const [pending, setPending] = useState<DueItem[]>([]);
  const [blocked, setBlocked] = useState(false);
  const lastRing = useRef(0);
  const notified = useRef('');

  useEffect(() => unlockAudioOnGesture(), []);

  // 抓今日到期清單
  useEffect(() => {
    const load = () =>
      api.get('/rent-alerts/today').then((r) => {
        setDate(r.data.date);
        setItems(r.data.dueToday);
      }).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    window.addEventListener('rentbell:refresh', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('rentbell:refresh', load);
    };
  }, []);

  // 判斷要不要響
  useEffect(() => {
    if (!date) return;
    const check = () => {
      const s = loadBellSettings();
      const now = new Date();
      const timeReached = now.getHours() * 60 + now.getMinutes() >= s.hour * 60 + s.minute;
      const acked = loadAcked(date);
      const list = s.enabled && timeReached ? items.filter((i) => !acked.includes(i.contractId)) : [];
      setPending(list);
      if (list.length === 0) return;

      const key = `${date}:${list.map((i) => i.contractId).join(',')}`;
      if (notified.current !== key) {
        notified.current = key;
        showSystemNotification(
          `今天要收房租（${list.length} 間）`,
          list.map((i) => `${i.propertyName} ${i.unitNumber} ${i.tenantName} NT$${i.amount.toLocaleString()}`).join('\n'),
        );
      }
      if (Date.now() - lastRing.current >= s.repeatSeconds * 1000) {
        lastRing.current = Date.now();
        playBell();
      }
      setBlocked(audioBlocked());
    };
    check();
    const t = setInterval(check, CHECK_MS);
    window.addEventListener('rentbell:settings', check);
    return () => {
      clearInterval(t);
      window.removeEventListener('rentbell:settings', check);
    };
  }, [date, items]);

  function acknowledge() {
    saveAcked(date, [...new Set([...loadAcked(date), ...pending.map((i) => i.contractId)])]);
    setPending([]);
    lastRing.current = 0;
  }

  if (pending.length === 0) return null;

  const total = pending.reduce((s, i) => s + i.amount - i.paidAmount, 0);

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-brand text-white px-5 py-4 flex items-center gap-3">
          <BellRing className="w-6 h-6 animate-bounce" />
          <div className="flex-1">
            <div className="font-bold">今天要收房租</div>
            <div className="text-xs text-white/80">{date}・共 {pending.length} 間・NT${total.toLocaleString()}</div>
          </div>
          <button onClick={acknowledge} className="p-1 rounded-lg hover:bg-white/10" aria-label="關閉">
            <X className="w-5 h-5" />
          </button>
        </div>

        {blocked && (
          <button
            onClick={() => playBell()}
            className="w-full flex items-center gap-2 bg-orange-50 text-orange-700 text-xs px-5 py-2 border-b border-orange-100"
          >
            <Volume2 className="w-4 h-4" /> 瀏覽器擋住了聲音，點這裡開啟鈴聲
          </button>
        )}

        <ul className="max-h-72 overflow-y-auto divide-y divide-gray-50">
          {pending.map((i) => (
            <li key={i.contractId} className="px-5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800 truncate">{i.propertyName} {i.unitNumber}</div>
                <div className="text-xs text-gray-400">
                  {i.tenantName}
                  {i.tenantPhone && <> · <a href={`tel:${i.tenantPhone}`} className="text-brand">{i.tenantPhone}</a></>}
                </div>
              </div>
              <div className="text-sm font-bold text-gray-800">NT${(i.amount - i.paidAmount).toLocaleString()}</div>
            </li>
          ))}
        </ul>

        <div className="flex gap-2 px-5 py-4 border-t border-gray-100">
          <button
            onClick={() => { acknowledge(); navigate('/finance/rent'); }}
            className="flex-1 text-sm border border-brand text-brand rounded-xl py-2 font-medium hover:bg-brand/5"
          >
            去登記收款
          </button>
          <button onClick={acknowledge} className="flex-1 text-sm bg-brand text-white rounded-xl py-2 font-medium hover:bg-brand-dark">
            我知道了，停止響鈴
          </button>
        </div>
      </div>
    </div>
  );
}

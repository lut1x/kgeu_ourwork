import React, { useEffect, useState } from 'react';
import { api } from './Account';

export default function CommunicationStatus({ connected, now }) {
  const [snapshot, setSnapshot] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false, timer, controller;
    setSnapshot(null); setFailed(false);
    if (!connected) return;
    async function poll() {
      controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 8000);
      try {
        const status = await api('/communication-status', { signal: controller.signal });
        if (!disposed) { setSnapshot({ ...status, receivedAt: Date.now() }); setFailed(false); }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        clearTimeout(deadline);
        if (!disposed) timer = setTimeout(poll, 5000);
      }
    }
    poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [connected]);

  let tone = 'offline', label = 'Нет связи с сервером', detail = 'Панель не подключена к серверу SCADA';
  if (connected) {
    if (failed || (snapshot && Number(now) - snapshot.receivedAt > 15000)) {
      tone = 'danger';
      label = 'Статус связи неизвестен'; detail = 'Не удалось проверить доступность плат';
    } else if (!snapshot) {
      tone = 'warn'; label = 'Проверка связи…'; detail = 'Ожидаем состояние плат';
    } else if (snapshot.state === 'empty') {
      tone = 'warn'; label = 'Платы не добавлены'; detail = 'Нет зарегистрированных шлюзов';
    } else if (snapshot.state === 'disabled') {
      label = 'Все шлюзы отключены'; detail = 'Шлюзы выключены вручную и не учитываются в проверке связи';
    } else if (snapshot.state === 'active') {
      tone = 'ok'; label = 'Канал связи активен'; detail = `Все платы на связи: ${snapshot.online}/${snapshot.total}`;
    } else {
      tone = 'danger';
      label = 'Ошибка канала связи';
      detail = `На связи: ${snapshot.online}/${snapshot.total}. Недоступны: ${snapshot.unavailable}. С ошибками: ${snapshot.errors}. Отключены вручную: ${snapshot.disabled}. Потеря связи определяется через ${snapshot.timeout_seconds} с без heartbeat.`;
    }
  }
  return <div className={`signal-label ${tone}`} role="status" aria-live="polite" title={detail}>
    <span className={`signal-dot ${tone}`} aria-hidden="true" />{label}
  </div>;
}

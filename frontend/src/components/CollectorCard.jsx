import React, { useState } from 'react';

export const isCollectorOnline = time => {
  const age = Date.now() - new Date(time).getTime();
  return Boolean(time) && age >= 0 && age < 60000;
};

export default function CollectorCard({ collector: c, devices, busy, onUpdate, onRotate, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const online = isCollectorOnline(c.last_seen);
  const tone = !c.enabled ? 'offline' : !online || c.status_json?.error ? 'danger' : 'ok';
  const label = !c.enabled ? 'Выключен вручную' : !online ? 'Нет связи' : c.status_json?.error ? 'Ошибка шлюза' : 'На связи';
  return <article className={`gateway-card ${!c.enabled ? 'is-disabled' : ''}`}>
    <header className="gateway-card-header"><div><span className="gateway-caption">ШЛЮЗ #{c.id}</span><h3>{c.name}</h3></div><span className={`gateway-badge ${tone}`}><span className={`signal-dot ${tone}`} />{label}</span></header>
    <dl className="gateway-metrics"><div><dt>Последняя связь</dt><dd>{c.last_seen ? new Date(c.last_seen).toLocaleString('ru-RU') : 'Ещё не подключался'}</dd></div><div><dt>Очередь</dt><dd>{c.status_json?.queued ?? '—'}</dd></div><div><dt>Каналов обнаружено</dt><dd>{devices.length}</dd></div><div><dt>Порты</dt><dd>{c.status_json?.ports?.join(', ') || 'Не обнаружены'}</dd></div></dl>
    {!c.enabled && <p className="gateway-note">Отключён администратором. Не влияет на общий статус связи.</p>}
    {c.enabled && c.status_json?.error && <p role="alert" className="account-error">{c.status_json.error}</p>}
    <div className="gateway-controls"><form key={c.baud_rate} onSubmit={e => { e.preventDefault(); onUpdate({enabled:Boolean(c.enabled),baud_rate:Number(new FormData(e.currentTarget).get('baud_rate'))}); }}><label>UART<select name="baud_rate" defaultValue={c.baud_rate} aria-label={`Скорость UART: ${c.name}`}>{[9600,19200,38400,57600,115200].map(n => <option key={n} value={n}>{n}</option>)}</select></label><button disabled={busy}>Сохранить</button></form><button disabled={busy} onClick={() => onUpdate({enabled:!c.enabled,baud_rate:c.baud_rate})}>{c.enabled ? 'Выключить шлюз' : 'Включить шлюз'}</button></div>
    <footer className="gateway-actions"><button disabled={busy} onClick={onRotate}>Заменить ключ</button><button className="gateway-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>Удалить плату</button></footer>
    {confirmDelete && <div className="gateway-delete-confirm" role="group" aria-label={`Удаление платы ${c.name}`}><strong>Удалить «{c.name}»?</strong><p>Ключ перестанет работать, устройства и привязки будут удалены. Датчики SCADA и история измерений сохранятся. Для повторного подключения потребуется новый ключ.</p><div className="row-actions"><button className="gateway-delete" disabled={busy} onClick={onDelete}>Да, удалить</button><button disabled={busy} onClick={() => setConfirmDelete(false)}>Отмена</button></div></div>}
  </article>;
}

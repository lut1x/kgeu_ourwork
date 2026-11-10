import React, { useState } from 'react';
import { api } from './Account';
import CollectorCard, { isCollectorOnline } from './CollectorCard';
import useLiveRefresh from '../useLiveRefresh';

export default function Collectors() {
  const [data,setData] = useState({collectors:[],devices:[]});
  const [catalog,setCatalog] = useState({sensors:[],groups:[]});
  const [error,setError] = useState(''); const [token,setToken] = useState(''); const [busy,setBusy] = useState(false);
  const [gatewayFilter,setGatewayFilter] = useState('all');
  const [selected,setSelected] = useState(null); const [create,setCreate] = useState(false);
  async function load() { const [d,c] = await Promise.all([api('/admin/collectors'),api('/admin/catalog')]); setData(d); setCatalog(c); }
  useLiveRefresh(load, e=>setError(e.message), {paused:busy});
  async function action(fn) { setBusy(true); setError(''); try { await fn(); await load(); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  async function bind(e) {
    e.preventDefault(); const v=Object.fromEntries(new FormData(e.currentTarget));
    await action(async()=>{
      let sensorId=Number(v.sensor_id);
      if (create) {
        const result=await api('/admin/sensors',{method:'POST',body:JSON.stringify({sensor_key:v.sensor_key,name:v.name,group_id:Number(v.group_id),kind:v.kind,unit:v.unit,min_value:Number(v.min_value),max_value:Number(v.max_value),warning_value:null,critical_value:null})});
        sensorId=result.id;
        // Preserve this ID if binding fails, so retry never creates a duplicate sensor.
        setCreate(false); setSelected({...selected,sensor_id:sensorId});
      }
      await api(`/admin/collectors/${selected.collector_id}/channel`,{method:'PUT',body:JSON.stringify({device_id:selected.device_id,channel:selected.channel,sensor_id:sensorId,input_min:Number(v.input_min),input_max:Number(v.input_max)})});
      setSelected(null);
    });
  }
  const online = isCollectorOnline;
  const enabled = data.collectors.filter(c=>c.enabled);
  const live = enabled.filter(c=>online(c.last_seen));
  const filteredDevices = data.devices.filter(d=>gatewayFilter==='all'||String(d.collector_id)===gatewayFilter);
  return <div className="registry-layout gateways-page">
    {error && <p role="alert" className="account-error">{error}</p>}
    <section className="account-card gateway-section"><div className="gateway-page-heading"><div><h2>Шлюзы Raspberry / Rock Pi</h2><div className="gateway-summary"><span>Всего: {data.collectors.length}</span><span>На связи: {live.length}</span><span>Недоступны: {enabled.length-live.length}</span><span>Выключены: {data.collectors.length-enabled.length}</span></div></div><a href="/downloads/scada-raspberry-gateway.tar.gz" download>Скачать шлюз</a></div><p className="gateway-note">Управляйте подключением плат и их каналами. Выключенные вручную шлюзы не влияют на общий статус связи. Данные обновляются автоматически каждые 5 секунд.</p>
      <form className="account-form gateway-create" onSubmit={e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');action(async()=>{const r=await api('/admin/collectors',{method:'POST',body:JSON.stringify({name})});setToken(r.token);});}}><label>Название новой платы<input name="name" required maxLength={100} placeholder="Raspberry — лаборатория" /></label><button disabled={busy}>Добавить шлюз</button></form>
      {token && <div className="connection-instructions"><h3>Ключ шлюза</h3><p>Скопируйте ключ в установщик на Raspberry. Он показывается только сейчас.</p><code style={{overflowWrap:'anywhere'}}>{token}</code><button onClick={()=>setToken('')}>Скрыть</button></div>}
      {!data.collectors.length && <div className="gateway-empty">Платы пока не добавлены. Создайте шлюз и установите программу на Raspberry или Rock Pi.</div>}
      <div className="gateway-grid">{data.collectors.map(c=><CollectorCard key={c.id} collector={c} devices={data.devices.filter(d=>d.collector_id===c.id)} busy={busy} onUpdate={settings=>action(()=>api(`/admin/collectors/${c.id}`,{method:'PATCH',body:JSON.stringify(settings)}))} onRotate={()=>action(async()=>{const r=await api(`/admin/collectors/${c.id}/token`,{method:'POST',body:'{}'});setToken(r.token);})} onDelete={()=>action(async()=>{await api(`/admin/collectors/${c.id}`,{method:'DELETE'});setToken('');if(selected?.collector_id===c.id)setSelected(null);if(gatewayFilter===String(c.id))setGatewayFilter('all');})}/>)}</div>
    </section>
    <section className="account-card sensor-registry"><div className="gateway-page-heading"><h2>Обнаруженные устройства ESP32</h2><label className="gateway-filter">Плата<select value={gatewayFilter} onChange={e=>setGatewayFilter(e.target.value)}><option value="all">Все платы</option>{data.collectors.map(c=><option value={String(c.id)} key={c.id}>{c.name}</option>)}</select></label></div><p>ESP32 должен отправлять сообщения scada-uart-v1. После подключения нового устройства выберите «Добавить в SCADA». Для обычного тока задайте вход 4–20 мА и нужный диапазон измерения.</p>
      {!filteredDevices.length&&<p className="gateway-empty">Устройств пока нет. Они появятся после подключения ESP32 к выбранной плате.</p>}
      <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Устройство / канал</th><th>Плата / порт</th><th>Состояние</th><th>Канал SCADA</th><th /></tr></thead><tbody>{filteredDevices.map(d=><tr key={`${d.collector_id}:${d.device_id}:${d.channel}`}><td>{d.name}<small className="table-hint">{d.device_id} / {d.channel}</small></td><td>{data.collectors.find(c=>c.id===d.collector_id)?.name}<small className="table-hint">{d.port}</small></td><td>{!data.collectors.find(c=>c.id===d.collector_id)?.enabled?'Шлюз выключен':online(d.last_seen)&&online(data.collectors.find(c=>c.id===d.collector_id)?.last_seen)?'Передаёт':'Нет данных'}</td><td>{catalog.sensors.find(s=>s.id===d.sensor_id)?.name||'Не добавлен'}</td><td><button disabled={busy} onClick={()=>{setSelected(d);setCreate(!d.sensor_id);}}> {d.sensor_id?'Настроить':'Добавить в SCADA'}</button></td></tr>)}</tbody></table></div>
      {selected&&<form key={`${selected.collector_id}:${selected.device_id}:${selected.channel}:${selected.sensor_id||0}`} className="account-form sensor-edit" onSubmit={bind}><h3>{selected.name} / {selected.channel}</h3><label><input type="checkbox" checked={create} onChange={e=>setCreate(e.target.checked)} /> Создать новый датчик в SCADA</label>
        {create?<><label>Название<input name="name" required defaultValue={selected.name} maxLength={100}/></label><label>Уникальный ключ<input name="sensor_key" required pattern="[a-zA-Z0-9_-]{2,64}" defaultValue={`${selected.device_id}_${selected.channel}`.slice(0,64)}/></label><label>Группа<select name="group_id" required>{catalog.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>Тип<select name="kind"><option value="custom">Другой</option><option value="temperature">Температура</option><option value="pressure">Давление</option><option value="flow">Расход</option><option value="voltage">Напряжение</option></select></label><label>Единица измерения<input name="unit" required defaultValue="мА" maxLength={20}/></label><label>Нижний предел измерения<input type="number" step="any" name="min_value" defaultValue={4} required/></label><label>Верхний предел измерения<input type="number" step="any" name="max_value" defaultValue={20} required/></label></>:<label>Датчик SCADA<select name="sensor_id" defaultValue={selected.sensor_id||''} required><option value="">Выберите датчик</option>{catalog.sensors.map(s=><option key={s.id} value={s.id}>{s.name} ({s.min_value}–{s.max_value} {s.unit})</option>)}</select></label>}
        <label>Входной минимум ESP32<input type="number" step="any" name="input_min" defaultValue={selected.input_min??4} required/></label><label>Входной максимум ESP32<input type="number" step="any" name="input_max" defaultValue={selected.input_max??20} required/></label><p>Входной диапазон линейно пересчитывается в минимум и максимум датчика SCADA. Значения за пределами диапазона сохраняются без обрезки.</p>
        <div className="row-actions"><button disabled={busy}>Сохранить</button><button type="button" onClick={()=>setSelected(null)}>Закрыть</button>{selected.sensor_id&&<button type="button" disabled={busy} onClick={()=>action(async()=>{await api(`/admin/collectors/${selected.collector_id}/channel`,{method:'DELETE',body:JSON.stringify({device_id:selected.device_id,channel:selected.channel})});setSelected(null);})}>Отвязать</button>}</div>
      </form>}
    </section>
  </div>;
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import ExportButton from './components/ExportButton';
import Collectors from './components/Collectors';
import CommunicationStatus from './components/CommunicationStatus';
import { readPanelState, allowedTab, mergeCatalog, catalogSignature } from './panelState.mjs';
import { api, AuthForm, Profile, Admin, ResetPassword, roleNames } from './components/Account';
import { Icon, SensorAdmin, SensorDashboard, SensorLogs, SensorParameters, SensorTrends } from './components/SensorWorkbench';

export default function App() {
  const [user, setUser] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [tab, setTab] = useState(() => readPanelState(window.location.hash).tab); const [connected, setConnected] = useState(false); const [catalog, setCatalog] = useState({ groups: [], sensors: [] }); const [readings, setReadings] = useState([]);
  const [group, setGroup] = useState(() => readPanelState(window.location.hash).group); const [search, setSearch] = useState(() => readPanelState(window.location.hash).search); const [revision, setRevision] = useState(0); const [now, setNow] = useState(new Date());
  const epoch = useRef(0); const allowedIds = useRef(new Set()); const signature = useRef('');
  const logout = useCallback(() => { epoch.current++; allowedIds.current = new Set(); setUser(null); setCatalog({ groups: [], sensors: [] }); setReadings([]); setTab('dashboard'); setConnected(false); setGroup('all'); }, []);
  const refresh = useCallback(async () => {
    const requestId = ++epoch.current;
    try { const data = await api('/catalog'); if (requestId === epoch.current) {
      const ids = new Set(data.sensors.map(s => s.id)); allowedIds.current = ids;
      setCatalog(previous => mergeCatalog(previous,data)); setReadings(previous=>previous.filter(r=>ids.has(r.sensor_id)));
      const next = catalogSignature(data); if (signature.current !== next) { signature.current = next; setRevision(v => v + 1); }
      setError('');
    } }
    catch (err) { if (requestId === epoch.current) setError(err.message); }
  }, []);
  useEffect(() => {
    if (!user) return;
    const permitted = allowedTab(tab,user.role);
    if (permitted !== tab) { setTab(permitted); return; }
    const params = new URLSearchParams({tab,group,...(search?{q:search}:{})});
    window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}#${params}`);
  }, [user,tab,group,search]);
  useEffect(() => {
    const restore = () => { const saved = readPanelState(window.location.hash); setTab(saved.tab); setGroup(saved.group); setSearch(saved.search); };
    window.addEventListener('hashchange',restore);
    return () => window.removeEventListener('hashchange',restore);
  }, []);
  useEffect(() => { api('/auth/me').then(data => setUser(data.user)).catch(err => { if (err.message !== 'Войдите в учетную запись') setError(err.message); }).finally(() => setLoading(false)); window.addEventListener('session-expired', logout); const timer = setInterval(() => setNow(new Date()), 1000); return () => { window.removeEventListener('session-expired', logout); clearInterval(timer); }; }, [logout]);
  useEffect(() => {
    if (!user) return; refresh();
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'], reconnectionDelay: 1000 });
    socket.on('connect', () => { setConnected(true); refresh(); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => api('/auth/me').catch(err => { if (err.message === 'Войдите в учетную запись') logout(); else setError(err.message); }));
    socket.on('catalog_changed', refresh);
    socket.on('sensor_readings', incoming => {
      const samples = incoming.filter(sample => allowedIds.current.has(sample.sensor_id));
      if (!samples.length) return;
      setReadings(prev => [...samples, ...prev].slice(0, 10000));
      setCatalog(prev => ({ ...prev, sensors: prev.sensors.map(sensor => { const sample = samples.filter(r => r.sensor_id === sensor.id).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0]; return sample && (!sensor.created_at || Date.parse(sample.created_at)>=Date.parse(sensor.created_at)) ? { ...sensor, value: sample.value, created_at: sample.created_at } : sensor; }) }));
    });
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    const resume = () => { if (!document.hidden) refresh(); };
    window.addEventListener('focus',resume); document.addEventListener('visibilitychange',resume);
    return () => { epoch.current++; clearInterval(timer); window.removeEventListener('focus',resume); document.removeEventListener('visibilitychange',resume); socket.disconnect(); };
  }, [user, refresh, logout]);
  const resetId = new URLSearchParams(window.location.search).get('reset');
  if (resetId) return <ResetPassword challengeId={resetId} />;
  if (loading) return <div className="loading-state">Загрузка системы…</div>;
  if (!user) return <AuthForm onUser={value => { setError(''); setUser(value); }} />;
  const privileged = ['technologist', 'administrator'].includes(user.role);
  const tabs = [{ id: 'dashboard', label: 'Обзор системы' }, { id: 'graphs', label: 'Тренды сигналов' }];
  if (privileged) tabs.push({ id: 'logs', label: 'Журнал показаний' }, { id: 'settings', label: 'Параметры' });
  if (user.role === 'administrator') tabs.push({ id: 'sensors', label: 'Датчики и группы' }, { id: 'collectors', label: 'Платы и устройства' }, { id: 'admin', label: 'Учетные записи' });
  tabs.push({ id: 'profile', label: 'Мой профиль' });
  const selectedGroup = catalog.groups.some(g => String(g.id) === group) ? group : 'all';
  const visible = catalog.sensors.filter(sensor => (selectedGroup === 'all' || String(sensor.group_id) === selectedGroup) && `${sensor.name} ${sensor.sensor_key} ${sensor.group_name}`.toLowerCase().includes(search.toLowerCase()));
  const visibleGroups = catalog.groups.filter(g => selectedGroup === 'all' || String(g.id) === selectedGroup);
  return <div className="scada-shell">
    <aside className="scada-sidebar"><div className="sidebar-brand"><span className="brand-mark"><img src="/brand-photo.jpg" alt="Логотип" width="40" height="40" /></span><strong>TECH<span>SCADA</span></strong></div><div className="sidebar-section-label">РАБОЧЕЕ МЕСТО</div><nav className="sidebar-nav">{tabs.map(item => <button key={item.id} id={`tab-${item.id}`} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><Icon name={item.id} /><span>{item.label}</span></button>)}</nav><div className="sidebar-section-label">ДОСТУПНЫЕ ГРУППЫ</div><div className="sidebar-groups">{catalog.groups.map(item => <button key={item.id} className={group === String(item.id) ? 'active' : ''} onClick={() => { setGroup(String(item.id)); setTab('dashboard'); }}><span className="group-bullet" />{item.name}</button>)}{!catalog.groups.length && <p>Группы не назначены</p>}</div><div className="sidebar-bottom"><CommunicationStatus connected={connected} now={now} /><span>TM / WORKSTATION 01</span></div></aside>
    <main className="scada-main"><header className="scada-topbar"><div className="search-box"><Icon name="search" /><input aria-label="Поиск датчиков" placeholder="Поиск датчиков, групп, каналов…" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="topbar-right"><time>{now.toLocaleTimeString('ru-RU')}</time><button className="topbar-profile" onClick={() => setTab('profile')}><span className="user-monogram">{user.first_name[0]}{user.last_name[0]}</span><span>{user.first_name} {user.last_name}<small>{roleNames[user.role]}</small></span></button></div></header>
      <div className="workspace-heading"><div><div className="system-label">ПАНЕЛЬ УПРАВЛЕНИЯ / {roleNames[user.role].toUpperCase()}</div><h1>{tabs.find(item => item.id === tab)?.label}</h1></div><div className="workspace-tools"><select aria-label="Выбор группы" value={selectedGroup} onChange={e => setGroup(e.target.value)}><option value="all">Все доступные группы</option>{catalog.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{privileged && <ExportButton groupId={selectedGroup} />}</div></div>
      {error && <p className="account-error" role="alert">{error}</p>}
      {tab === 'dashboard' && <SensorDashboard sensors={visible} groups={visibleGroups} readings={readings} />}
      {tab === 'graphs' && <SensorTrends sensors={visible} readings={readings} privileged={privileged} />}
      {tab === 'logs' && privileged && <SensorLogs sensors={visible} revision={revision} />}
      {tab === 'settings' && privileged && <SensorParameters sensors={visible} onRefresh={refresh} />}
      {tab === 'sensors' && user.role === 'administrator' && <SensorAdmin onRefresh={refresh} />}
      {tab === 'collectors' && user.role === 'administrator' && <Collectors />}
      {tab === 'admin' && user.role === 'administrator' && <Admin user={user} />}
      {tab === 'profile' && <Profile user={user} onLogout={logout} />}
      <footer className="system-footer"><span>TECH SCADA / СИСТЕМА МОНИТОРИНГА</span><span>Доступ по группам · {catalog.sensors.length} каналов</span></footer>
    </main>
  </div>;
}

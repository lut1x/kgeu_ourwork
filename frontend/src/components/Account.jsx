import React, { useState, useId } from 'react';
import useLiveRefresh from '../useLiveRefresh';
export const roleNames = { operator: 'Оператор', technologist: 'Технолог', administrator: 'Администратор' };
const passwordText = 'Минимум 12 символов: заглавная и строчная буквы, цифра, спецсимвол. Без пробелов.';
const validPassword = value => value.length >= 12 && value.length <= 128 && /\p{Lu}/u.test(value) && /\p{Ll}/u.test(value) && /[0-9]/.test(value) && /[\p{P}\p{S}]/u.test(value) && !/\s/u.test(value);
export async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
}
export function PasswordInput({ label = 'Пароль', name = 'password', ...props }) {
  const [visible, setVisible] = useState(false); const id = useId();
  return <div className="password-field"><label htmlFor={id}>{label}</label><div className="password-control"><input id={id} name={name} type={visible ? 'text' : 'password'} required maxLength={128} {...props} /><button type="button" className="password-toggle" aria-label={`${visible ? 'Скрыть' : 'Показать'} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(v => !v)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" />{visible && <path d="m3 3 18 18" />}</svg></button></div></div>;
}
function PasswordFields() {
  return <><PasswordInput minLength={12} autoComplete="new-password" aria-describedby="password-requirements" /><p className="field-hint" id="password-requirements">{passwordText}</p><PasswordInput label="Повторите пароль" name="password_confirmation" minLength={12} autoComplete="new-password" /></>;
}
function AuthShell({ children, title, subtitle }) {
  return <main className="auth-page"><div className="auth-intro"><div className="system-label">TECH MONITOR / SCADA</div><h1>Контроль процесса.<br />Точный доступ.</h1><p>Рабочее место оператора системы технического мониторинга.</p><div className="auth-spec"><span>01 / Телеметрия</span><span>02 / Технологические параметры</span><span>03 / Управление доступом</span></div><div className="system-caption">ЛОКАЛЬНЫЙ КОНТУР · УЧЕБНЫЙ СТЕНД</div></div><section className="account-card auth-card"><div className="system-label">ДОСТУП К СИСТЕМЕ</div><h2>{title}</h2><p className="account-muted">{subtitle}</p>{children}</section></main>;
}
export function AuthForm({ onUser }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (register && (!validPassword(values.password) || values.password !== values.password_confirmation)) { setError(passwordText + ' Пароли должны совпадать.'); return; }
    setBusy(true);
    try {
      const result = await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(values) });
      onUser(result.user);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <AuthShell title={register ? 'Новая учетная запись' : 'Вход в систему'} subtitle="Используйте свою учетную запись для доступа к рабочему месту.">
    <div className="auth-switch"><button disabled={busy} className={!register ? 'selected' : ''} onClick={() => { setRegister(false); setError(''); }}>Вход</button><button disabled={busy} className={register ? 'selected' : ''} onClick={() => { setRegister(true); setError(''); }}>Регистрация</button></div>
    <form key={String(register)} onSubmit={submit} className="account-form">
        {register && <div className="name-fields"><label>Имя<input name="first_name" required maxLength={100} autoComplete="given-name" /></label><label>Фамилия<input name="last_name" required maxLength={100} autoComplete="family-name" /></label></div>}
        <label>Почта<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        {register ? <PasswordFields /> : <PasswordInput autoComplete="current-password" />}
      {error && <p className="account-error" role="alert">{error}</p>}
      <button className="account-primary" disabled={busy}>{busy ? 'Подождите…' : register ? 'Зарегистрироваться' : 'Войти'}</button>
    </form>
    <p className="field-hint">{register ? 'Роль после регистрации — оператор.' : 'Для сброса пароля обратитесь к администратору.'}</p>
  </AuthShell>;
}
export function ResetPassword({ challengeId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (!validPassword(values.password) || values.password !== values.password_confirmation) { setError(passwordText + ' Пароли должны совпадать.'); return; }
    setBusy(true);
    try { await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ ...values, challenge_id: challengeId }) }); setDone(true); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <AuthShell title={done ? 'Пароль изменен' : 'Установка нового пароля'} subtitle={done ? 'Все предыдущие сессии завершены. Войдите с новым паролем.' : 'Введите шестизначный код из письма и новый пароль.'}>
    {done ? <a className="account-link" href="/">Перейти ко входу</a> : <form className="account-form" onSubmit={submit}><label>Код подтверждения<input name="code" required inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="one-time-code" /></label><PasswordFields />{error && <p role="alert" className="account-error">{error}</p>}<button className="account-primary" disabled={busy}>Изменить пароль</button></form>}
  </AuthShell>;
}
export function Profile({ user, onLogout }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function logout() { setBusy(true); try { await api('/auth/logout', { method: 'POST' }); onLogout(); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <section className="account-card profile-card"><div className="system-label">УЧЕТНАЯ ЗАПИСЬ / {String(user.id).padStart(4, '0')}</div><div className="profile-avatar" aria-label="Условное фото пользователя">{user.first_name[0]}{user.last_name[0]}</div><h2>{user.first_name} {user.last_name}</h2><p className="role-badge">{roleNames[user.role]}</p><dl><dt>Почта</dt><dd>{user.email}</dd><dt>Статус почты</dt><dd>{user.email_verified ? 'Подтверждена' : 'Создана до проверки почты / служебная'}</dd><dt>Имя</dt><dd>{user.first_name}</dd><dt>Фамилия</dt><dd>{user.last_name}</dd></dl>{error && <p role="alert" className="account-error">{error}</p>}<button className="account-primary" disabled={busy} onClick={logout}>Выйти из учетной записи</button></section>;
}
export function Admin({ user }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [resetting, setResetting] = useState(null);
  async function load() { const result = await api('/admin/users'); setUsers(result.users); }
  useLiveRefresh(async()=>{try{await load();}finally{setBusy(false);}}, err=>setError(err.message), {paused:busy||Boolean(deleting)||Boolean(resetting)});
  async function change(id, role) {
    setBusy(true); setError(''); setMessage('');
    try { await api(`/admin/users/${id}`, { method: role ? 'PATCH' : 'DELETE', ...(role ? { body: JSON.stringify({ role }) } : {}) }); await load(); setDeleting(null); setMessage(role ? 'Роль обновлена. Пользователь должен войти снова.' : 'Учетная запись удалена.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function reset(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await api(`/admin/users/${resetting.id}/password-reset`, { method: 'POST', body: JSON.stringify(values) }); setMessage(result.message); setResetting(null); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="account-card"><div className="system-label">АДМИНИСТРИРОВАНИЕ</div><h2>Учетные записи</h2><p className="account-muted">Назначение ролей, подтвержденный сброс паролей и удаление пользователей.</p>{error && <p role="alert" className="account-error">{error}</p>}{message && <p role="status" className="account-success">{message}</p>}<div className="account-table-wrap"><table className="account-table"><thead><tr><th>ID</th><th>Пользователь</th><th>Почта</th><th>Роль</th><th>Действия</th></tr></thead><tbody>{users.map(item => <tr key={item.id}><td>{String(item.id).padStart(4, '0')}</td><td>{item.first_name} {item.last_name}</td><td>{item.email}<span className="table-hint">{item.email_verified ? 'Подтверждена' : 'Не подтверждена'}</span></td><td><select aria-label={`Роль ${item.email}`} value={item.role} disabled={busy || item.id === user.id} onChange={e => change(item.id, e.target.value)}>{Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td><div className="row-actions"><button disabled={busy} onClick={() => { setResetting(item); setDeleting(null); setError(''); }}>Сбросить пароль</button>{item.id === user.id ? <span>Вы</span> : <button className="account-danger" disabled={busy} onClick={() => { setDeleting(item); setResetting(null); }}>Удалить</button>}</div></td></tr>)}</tbody></table></div>{busy && <p role="status">Загрузка…</p>}
    {resetting && <div className="confirm-panel"><h3>Подтверждение сброса</h3><p>Пользователь: {resetting.email}. Письмо с кодом будет отправлено владельцу. Текущий пароль останется действующим до подтверждения.</p><form className="account-form" onSubmit={reset}><label>Введите почту пользователя<input name="confirmation_email" type="email" required autoComplete="off" /></label><label>Ваш пароль администратора<input name="admin_password" type="password" required maxLength={128} autoComplete="current-password" /></label><div className="row-actions"><button className="account-primary" disabled={busy}>Подтвердить и отправить письмо</button><button type="button" disabled={busy} onClick={() => setResetting(null)}>Отмена</button></div></form></div>}
    {deleting && <div className="delete-confirm" role="alert"><p>Удалить учетную запись {deleting.email}?</p><button className="account-danger" disabled={busy} onClick={() => change(deleting.id)}>Подтвердить удаление</button> <button disabled={busy} onClick={() => setDeleting(null)}>Отмена</button></div>}
  </section>;
}
export function Settings({ settings, onSettings }) {
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    const values = Object.fromEntries([...new FormData(e.currentTarget)].map(([k, v]) => [k, Number(v)]));
    try { const result = await api('/settings', { method: 'PUT', body: JSON.stringify(values) }); onSettings(result); setMessage('Параметры сохранены'); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="account-card"><div className="system-label">КОНФИГУРАЦИЯ ПРОЦЕССА</div><h2>Технические параметры</h2><p className="account-muted">Пороги температуры определяют статус на дашборде.</p><form key={`${settings.temp_warning}:${settings.temp_critical}`} className="account-form" onSubmit={submit}><label>Предупреждение, °C<input name="temp_warning" type="number" required min="0" max="150" step="0.1" defaultValue={settings.temp_warning} /></label><label>Критическая температура, °C<input name="temp_critical" type="number" required min="0" max="150" step="0.1" defaultValue={settings.temp_critical} /></label>{error && <p role="alert" className="account-error">{error}</p>}{message && <p role="status" className="account-success">{message}</p>}<button className="account-primary" disabled={busy}>Сохранить параметры</button></form></section>;
}

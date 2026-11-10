const tabs = new Set(['dashboard', 'graphs', 'logs', 'settings', 'sensors', 'collectors', 'admin', 'profile']);
export function readPanelState(hash = '') {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const tab = params.get('tab');
  const group = params.get('group');
  return { tab: tabs.has(tab) ? tab : 'dashboard', group: group === 'all' || /^[1-9]\d*$/.test(group || '') ? group : 'all', search: (params.get('q') || '').slice(0, 200) };
}
export function allowedTab(tab, role) {
  if (['dashboard','graphs','profile'].includes(tab)) return tab;
  if (['logs','settings'].includes(tab) && ['technologist','administrator'].includes(role)) return tab;
  if (['sensors','collectors','admin'].includes(tab) && role === 'administrator') return tab;
  return 'dashboard';
}
export function mergeCatalog(previous, incoming) {
  const prior = new Map(previous.sensors.map(s => [s.id,s]));
  return { ...incoming, sensors: incoming.sensors.map(sensor => {
    const old = prior.get(sensor.id);
    return old && Date.parse(old.created_at) > Date.parse(sensor.created_at || '') ? { ...sensor, value: old.value, created_at: old.created_at } : sensor;
  }) };
}
export function catalogSignature(data) {
  return JSON.stringify({groups:data.groups,sensors:data.sensors.map(({value,created_at,...sensor})=>sensor)});
}

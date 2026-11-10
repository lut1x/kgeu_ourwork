#!/bin/sh
set -eu
scada exec -T backend node <<'JS'
(async()=>{
const base='http://127.0.0.1:3001/api';
const unauth=await fetch(base+'/communication-status');
if(unauth.status!==401)throw Error('Status must require login');
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})});
if(!login.ok)throw Error('Admin login failed');
const cookie=login.headers.get('set-cookie').split(';')[0];
try{
const response=await fetch(base+'/communication-status',{headers:{Cookie:cookie}});
if(!response.ok)throw Error('Status failed');
if(response.headers.get('cache-control')!=='no-store')throw Error('Status cached');
console.log(JSON.stringify(await response.json()));
}finally{await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:cookie}});}
})().catch(e=>{console.error(e.message);process.exit(1)});
JS

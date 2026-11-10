import test from 'node:test';
import assert from 'node:assert/strict';
import {readPanelState,allowedTab,mergeCatalog,catalogSignature} from './src/panelState.mjs';
test('refresh restores section, group and encoded search; invalid state is rejected',()=>{
 const hash='#'+new URLSearchParams({tab:'collectors',group:'12',q:'Давление & расход'});
 assert.deepEqual(readPanelState(hash),{tab:'collectors',group:'12',search:'Давление & расход'});
 assert.equal(readPanelState('#tab=evil&group=NaN').tab,'dashboard');
 assert.equal(readPanelState('#tab=evil&group=NaN').group,'all');
 assert.equal(allowedTab('admin','operator'),'dashboard');
 assert.equal(allowedTab('collectors','administrator'),'collectors');
});
test('background sync preserves newer WebSocket values and removes revoked sensors',()=>{
 const previous={groups:[],sensors:[{id:1,value:20,created_at:'2026-10-16T20:00:02Z'},{id:2,value:30}]};
 const incoming={groups:[{id:3}],sensors:[{id:1,name:'Renamed',value:10,created_at:'2026-10-16T20:00:01Z'}]};
 const merged=mergeCatalog(previous,incoming);
 assert.equal(merged.sensors.length,1);assert.equal(merged.sensors[0].value,20);assert.equal(merged.sensors[0].name,'Renamed');
 assert.deepEqual(mergeCatalog(previous,{groups:[],sensors:[]}).sensors,[]);
 assert.equal(catalogSignature(incoming),catalogSignature({...incoming,sensors:[{...incoming.sensors[0],value:99}]}));
 assert.notEqual(catalogSignature(incoming),catalogSignature({...incoming,sensors:[{...incoming.sensors[0],name:'Changed'}]}));
});

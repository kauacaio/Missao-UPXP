// Deterministic browser backend. No real Supabase calls are made in this suite.
window.mock = {
  calls: [], responses: {}, failures: {}, delay: {}, user: null, listeners: [],
  player: {id:'11111111-1111-4111-8111-111111111111',name:'Participante teste',school:'UNIPAR',score:0,completed_count:0},
  challenge: {challenge_id:'22222222-2222-4222-8222-222222222222',location_name:'Estação',question:'Qual alternativa?',options:['Primeira','Segunda'],points:100,already_answered:false},
};
function query(kind,name,payload) {
  const filters={};let operation=kind;
  const builder={
    select(){return this},order(){return this},range(a,b){filters.range=[a,b];return this},limit(){return this},
    eq(k,v){filters[k]=v;return this},in(){return this},update(v){operation='update';payload=v;return this},insert(v){operation='insert';payload=v;return this},
    single(){return this},maybeSingle(){return this},
    async then(resolve,reject){try{
      const key=operation+':'+name;
      mock.calls.push({key,payload,filters});
      if(mock.delay[key]) await new Promise(r=>setTimeout(r,mock.delay[key]));
      if(mock.failures[key]==='throw') throw Error('offline');
      if(mock.failures[key]) return resolve({data:null,error:{code:mock.failures[key],message:'mock error'}});
      if(Object.hasOwn(mock.responses,key)) return resolve({data:mock.responses[key],error:null});
      let data=null;
      if(name==='register_player') {mock.player.name=payload.participant_name;data={...mock.player};}
      if(name==='leaderboard') data=filters.id?{...mock.player}:[{...mock.player}];
      if(name==='get_challenge_by_code') data=[{...mock.challenge}];
      if(name==='submit_answer') {mock.player.score+=100;mock.player.completed_count++;data=[{is_correct:true,points_earned:100,explanation:'Explicação'}];}
      if(name==='start_bonus_round') data={...mock.challenge,round_id:'33333333-3333-4333-8333-333333333333',server_now:new Date().toISOString(),expires_at:new Date(Date.now()+15000).toISOString()};
      if(name==='submit_bonus_answer') {const timed=payload.selected_index===null; if(!timed)mock.player.score+=100;data={timed_out:timed,is_correct:!timed,points_earned:timed?0:100,player:{...mock.player}};}
      if(name==='is_campaign_admin') data=true;
      if(name==='get_campaign_leads') data=[{id:'lead-1',name:'Contato teste',phone:'44999999999',marketing_consent:true,status:'novo',created_at:'2026-09-01',player:{score:100,completed_count:1},tags:[]}];
      if(name==='campaign_tags') data=operation==='insert'?{id:'tag-new',...payload}:[{id:'tag-1',name:'Interesse',color:'#6f35e8',temperature_points:20}];
      if(name==='campaign_leads') data=operation==='update'?{id:filters.id,...payload}:filters.id?{tags:[],notes:'Nota inicial',updated_at:'v1'}:[{id:'lead-1',tags:[]}];
      return resolve({data,error:null});
    }catch(e){return reject(e);}}
  };return builder;
}
window.supabase={createClient:()=>({
  rpc:(n,p)=>query('rpc',n,p),from:n=>query('from',n),
  channel:()=>({on(){return this},subscribe(){return this}}),
  auth:{
    async getSession(){return {data:{session:mock.user},error:null}},
    async signInWithPassword(){if(mock.failures.login==='throw')throw Error('offline');if(mock.failures.login)return{error:{message:'invalid'}};mock.user={user:{id:'admin'}};return{data:{session:mock.user},error:null}},
    async signOut(){if(mock.failures.logout==='throw')throw Error('offline');mock.user=null;mock.listeners.forEach(f=>f('SIGNED_OUT',null));return{error:null}},
    onAuthStateChange(fn){mock.listeners.push(fn);return{data:{subscription:{unsubscribe(){}}}}}
})};

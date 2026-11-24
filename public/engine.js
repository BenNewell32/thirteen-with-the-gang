// Thirteen rules engine. Loaded by the page in the browser and by server.js on the server.
const E=(()=>{
  const rank=c=>c>>2, suit=c=>c&3;
  const RANKS=['3','4','5','6','7','8','9','10','J','Q','K','A','2'], SUITS=['♠','♣','♦','♥'];
  const cardName=c=>RANKS[rank(c)]+SUITS[suit(c)];
  const clone=o=>JSON.parse(JSON.stringify(o));
  const num=(a,b)=>a-b;
  function classify(cs){
    const a=[...cs].sort(num), n=a.length; if(!n) return null;
    const top=a[n-1], r=a.map(rank);
    if(r.every(x=>x===r[0])) return n<=4?{type:['single','pair','triple','quad'][n-1],len:n,top}:null;
    if(r[n-1]===12) return null;
    if(n>=3){ let ok=true; for(let i=1;i<n;i++) if(r[i]!==r[i-1]+1) ok=false; if(ok) return {type:'run',len:n,top}; }
    if(n>=6&&n%2===0){ let ok=true; for(let i=0;i<n;i+=2){ if(r[i]!==r[i+1]) ok=false; if(i&&r[i]!==r[i-2]+1) ok=false; } if(ok) return {type:'dseq',len:n,top}; }
    return null;
  }
  function beats(a,b){
    if(a.type===b.type&&a.len===b.len) return a.top>b.top;
    const two=rank(b.top)===12;
    if(b.type==='single'&&two) return a.type==='quad'||a.type==='dseq';
    if(b.type==='pair'&&two) return a.type==='dseq'&&a.len>=8;
    if(b.type==='dseq'&&b.len===6) return a.type==='quad'||(a.type==='dseq'&&a.len>=8);
    if(b.type==='quad') return a.type==='dseq'&&a.len>=8;
    return false;
  }
  function describe(c){
    const t={single:'single',pair:'pair',triple:'triple',quad:'four of a kind',run:'run of '+c.len,dseq:(c.len/2)+' pairs in a row'}[c.type];
    return t+' ('+cardName(c.top)+(c.len>1?' high':'')+')';
  }
  function deal(prev,rnd){
    rnd=rnd||Math.random;
    const d=[...Array(52).keys()];
    for(let i=51;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
    const hands={}; for(let s=0;s<4;s++) hands['h'+s]=d.slice(s*13,s*13+13).sort(num);
    const winner=prev&&prev.done&&prev.done.length?prev.done[0]:-1;
    let turn=winner, mustLow=false;
    if(winner<0) turn=Math.floor(rnd()*4);
    return {phase:'play',hands,turn,mustLow,pile:{by:-1,cards:[]},passed:[false,false,false,false],done:[],
      game:((prev&&prev.game)||0)+1,wins:prev&&prev.wins?[...prev.wins]:[0,0,0,0],ev:{kind:'deal',seat:turn,victim:-1}};
  }
  const active=(s,x)=>!s.done.includes(x);
  function nextFrom(s,from,pred){ for(let i=1;i<=4;i++){ const x=(from+i)%4; if(pred(x)) return x; } return -1; }
  function endTrick(s){
    const by=s.pile.by, leader=active(s,by)?by:nextFrom(s,by,x=>active(s,x));
    s.pile={by:-1,cards:[]}; s.passed=[false,false,false,false]; s.turn=leader; s.ev.newTrick=true;
  }
  function check(st,seat,cards){
    if(st.phase!=='play') return {ok:false,why:'The game is not running.'};
    if(st.turn!==seat) return {ok:false,why:'Not your turn yet.'};
    const hand=st.hands['h'+seat];
    if(!cards.length) return {ok:false,why:'Tap some cards first.'};
    if(new Set(cards).size!==cards.length||!cards.every(c=>hand.includes(c))) return {ok:false,why:'Those cards are not in your hand.'};
    const combo=classify(cards);
    if(!combo) return {ok:false,why:'Those cards do not make a combo.'};
    if(st.pile.by<0){
      if(st.mustLow&&!cards.includes(hand[0])) return {ok:false,why:'The first play must include the '+cardName(hand[0])+'.'};
      return {ok:true,combo};
    }
    const pc=classify(st.pile.cards);
    if(!beats(combo,pc)) return {ok:false,why:'That does not beat the '+describe(pc)+'.'};
    return {ok:true,combo};
  }
  function play(st,seat,cards){
    const r=check(st,seat,cards); if(!r.ok) return null;
    const s=clone(st), following=st.pile.by>=0;
    const hand=s.hands['h'+seat]=s.hands['h'+seat].filter(c=>!cards.includes(c));
    let kind=following?'play':'lead';
    if(following&&(r.combo.type==='quad'||r.combo.type==='dseq')) kind='bomb';
    else if(rank(r.combo.top)===12) kind='two';
    s.ev={kind,seat,victim:following?st.pile.by:-1,left:hand.length};
    s.pile={by:seat,cards:[...cards].sort(num)}; s.mustLow=false;
    if(!hand.length){
      s.done.push(seat); s.ev.place=s.done.length;
      if(s.done.length===3){
        s.done.push([0,1,2,3].find(x=>!s.done.includes(x)));
        s.phase='over'; s.wins[s.done[0]]++; s.ev.over=true; s.turn=-1; return s;
      }
    }
    const nx=nextFrom(s,seat,x=>x!==seat&&active(s,x)&&!s.passed[x]);
    if(nx<0) endTrick(s); else s.turn=nx;
    return s;
  }
  function pass(st,seat){
    if(st.phase!=='play'||st.turn!==seat||st.pile.by<0) return null;
    const s=clone(st); s.passed[seat]=true; s.ev={kind:'pass',seat,victim:-1};
    const by=s.pile.by, nx=nextFrom(s,seat,x=>x!==by&&active(s,x)&&!s.passed[x]);
    if(nx<0) endTrick(s); else s.turn=nx;
    return s;
  }
  // Returns the cards a computer player puts down, or null to pass.
  function botMove(st,seat){
    const hand=st.hands['h'+seat], by={};
    hand.forEach(c=>(by[rank(c)]=by[rank(c)]||[]).push(c));
    const ranks=Object.keys(by).map(Number).sort(num);
    const danger=[0,1,2,3].some(x=>x!==seat&&active(st,x)&&st.hands['h'+x].length<=3);
    const free2=hand.length<=4||danger;
    if(st.pile.by<0){
      const r0=rank(hand[0]), g=by[r0], run=[hand[0]];
      for(let r=r0+1;r<12&&by[r];r++) run.push(by[r][0]);
      if(run.length>=3) return run;
      if(g.length===4) return hand.length===4?g:[g[0]];
      if(g.length>=2) return g.slice();
      return [hand[0]];
    }
    const pc=classify(st.pile.cards), pr=rank(pc.top); let cand=null;
    if(pc.type==='single'){ const c=hand.find(x=>x>pc.top); if(c!==undefined) cand=[c]; }
    else if(pc.type==='pair'||pc.type==='triple'||pc.type==='quad'){
      const n=pc.len;
      for(const r of ranks){ const g=by[r]; if(g.length<n||r<pr) continue; let pick=g.slice(0,n); if(pick[n-1]<pc.top) pick=g.slice(-n); if(pick[n-1]>pc.top){ cand=pick; break; } }
    } else if(pc.type==='run'){
      const L=pc.len;
      for(let s=0;s+L<=12&&!cand;s++){
        let ok=true; for(let r=s;r<s+L;r++) if(!by[r]) ok=false; if(!ok) continue;
        const tr=s+L-1, t=by[tr].find(c=>c>pc.top); if(t===undefined) continue;
        const pick=[]; for(let r=s;r<tr;r++) pick.push(by[r][0]); pick.push(t); cand=pick;
      }
    } else if(pc.type==='dseq'){
      const P=pc.len/2;
      for(let s=0;s+P<=12&&!cand;s++){
        let ok=true; for(let r=s;r<s+P;r++) if(!by[r]||by[r].length<2) ok=false; if(!ok) continue;
        const tr=s+P-1, top2=by[tr].slice(-2); if(top2[1]<=pc.top) continue;
        const pick=[]; for(let r=s;r<tr;r++) pick.push(by[r][0],by[r][1]); pick.push(...top2); cand=pick;
      }
    }
    if(cand&&cand.some(c=>rank(c)===12)&&!free2&&pr<11&&pc.type!=='quad') cand=null;
    if(!cand){
      const two=pr===12;
      if((pc.type==='single'&&two)||(pc.type==='dseq'&&pc.len===6)){ const q=ranks.find(r=>by[r].length===4&&r!==12); if(q!==undefined) cand=by[q].slice(); }
      if(!cand&&pc.type==='single'&&two){
        for(let s=0;s+3<=12&&!cand;s++) if([s,s+1,s+2].every(r=>by[r]&&by[r].length>=2)) cand=[s,s+1,s+2].flatMap(r=>by[r].slice(0,2));
      }
    }
    return cand;
  }
  return {rank,suit,RANKS,SUITS,cardName,clone,classify,beats,describe,deal,check,play,pass,botMove};
})();
if(typeof module!=='undefined') module.exports=E;

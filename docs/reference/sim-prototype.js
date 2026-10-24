// Prototipe simulasi ekonomi Depths (baseline GAME_DESIGN §9). Jalankan: node docs/reference/sim-prototype.js
// Port ke packages/game-logic/src/simulate.ts di Phase 1. Model disederhanakan: tanpa cap pool 5%, tanpa DISARM.
const M=[[30,5,10],[40,7,15],[52,9,20],[65,12,30],[80,15,50],[100,19,70],[120,24,90],[145,29,120],[170,34,160],[200,40,200],
[230,45,230],[265,50,265],[304,56,304],[350,63,350],[402,70,402],[463,79,463],[532,88,532],[612,99,612],[704,111,704],[809,124,809]];
const R=()=>Math.random();
const roll=()=>0.8+R()*0.4;
function combat(p,hp,atk,monsterFirst){let ph=p.hp;let mh=hp;let r=0;
 if(monsterFirst){ph-=Math.floor(atk*roll());}
 while(ph>0&&mh>0&&r<50){mh-=Math.floor(p.atk*roll());if(mh<=0)break;ph-=Math.floor(atk*roll());r++;}
 p.hp=Math.max(ph,0);return ph>0;}
function winChance(p,hp,atk,n=200){let w=0;for(let i=0;i<n;i++){const q={...p};if(combat(q,hp,atk,false))w++;}return w/n;}
function run(strat){const p={hp:100,max:100,atk:12,pot:0,sw:0,sh:0};let bag=0;
 for(let f=1;f<=20;f++){const e=R();const [mhp,matk,loot]=M[f-1];
  if(e<0.40){ // monster
   if(p.hp<p.max-40&&p.pot>0){p.pot--;p.hp=Math.min(p.max,p.hp+50);}
   const wc=winChance(p,mhp,matk);
   if(wc<strat.fleeBelow){const fc=Math.max(0.20,0.60-0.04*f);if(R()<fc){}else{if(!combat(p,mhp,matk,true))return {f,pay:0};bag+=loot;}}
   else{if(!combat(p,mhp,matk,false))return {f,pay:0};bag+=loot;}
  } else if(e<0.65){ // treasure
   if(R()<0.05){const[h2,a2]=M[Math.min(f+1,19)];if(p.hp<p.max-40&&p.pot>0){p.pot--;p.hp=Math.min(p.max,p.hp+50);}if(!combat(p,h2,a2,false))return {f,pay:0};bag+=loot*2;}
   else bag+=Math.floor((10+R()*40)*1);
  } else if(e<0.80){ // trap
   if(R()<0.6||bag==0)p.hp=Math.max(1,p.hp-(10+3*f));else bag=Math.floor(bag*0.8);
  } else { // merchant
   while(bag>=20&&p.sw<5&&bag>strat.keep){bag-=20;p.sw++;p.atk+=10;if(bag>=20&&p.sh<p.sw&&p.sh<5&&bag>strat.keep){bag-=20;p.sh++;p.max+=20;p.hp+=20;}}
   while(bag>=10&&p.pot<3&&p.hp<p.max*0.6){bag-=10;p.pot++;}
  }
  if(bag>=strat.cashAt||f>=strat.maxFloor||(p.hp<strat.hpCash&&bag>0))return {f,pay:bag};
 }
 return {f:20,pay:bag};}
const strats={cautious:{fleeBelow:0.7,keep:0,cashAt:60,maxFloor:5,hpCash:40},
 balanced:{fleeBelow:0.6,keep:0,cashAt:120,maxFloor:8,hpCash:30},
 greedy:{fleeBelow:0.5,keep:0,cashAt:300,maxFloor:12,hpCash:15},
 yolo:{fleeBelow:0,keep:0,cashAt:99999,maxFloor:20,hpCash:0}};
for(const[k,s]of Object.entries(strats)){let N=20000,pay=0,dead=0,fl=0,big=0;
 for(let i=0;i<N;i++){const r=run(s);pay+=r.pay;if(r.pay==0)dead++;fl+=r.f;if(r.pay>=100)big++;}
 console.log(k.padEnd(9),'RTP',(pay/N/50*100).toFixed(1)+'%','zero-payout',(dead/N*100).toFixed(1)+'%','avgFloor',(fl/N).toFixed(2),'payout>=0.1',(big/N*100).toFixed(1)+'%');}

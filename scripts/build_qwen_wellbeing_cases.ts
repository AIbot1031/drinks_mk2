// Human-authored intent labels; papers justify constraints, not clinical training targets.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {conversationTurn} from '../worker/conversation';
import {catalogFeatures} from '../worker/catalog-features';
import catalog from '../data/catalog.json';
import type {Filters} from '../worker/types';
const brands=Object.keys(catalog.brands),tea=[...new Set(catalog.drinks.flatMap(d=>d.tea))],toppings=[...new Set(catalog.drinks.flatMap(d=>d.toppings))];
const base=JSON.parse(fs.readFileSync('training/qwen_robust_snapshot.json','utf8'));
const rows:Array<Record<string,any>>=[];
function add(split:string,group:string,message:string,query:string,filters:Filters={},prior={query:'',filters:{} as Filters,guard:''}){
  const turn=conversationTurn({message,state:prior},brands);
  rows.push({split,id:`wellbeing-${split}-${rows.length+1}`,group,prior,
    input:{message,state:turn.state,brands,tea,toppings,catalogFeatures:catalogFeatures(catalog.drinks),history:[],preferenceProfile:{}},
    expected:{action:'recommend',query,filters,assistantMessage:'已保留你的口味與篩選條件。'},queryAliases:[query],
    labelSource:'assistant-authored synthetic intent, not real-user preference or medical outcome',
    preprocessing:{next:turn.next,reset:turn.reset,followUp:turn.followUp??null}});
}
for(const message of ['準備睡覺，想喝清爽的','睡前清爽一點','很累想提神，但準備睡覺，清爽就好','不想失眠，清爽的就好','待會要睡覺，選清爽的','睡前喝清爽的，咖啡因100mg以下'])add('train','sleep',message,'清爽',{maxCaffeine:0});
add('train','sleep','準備睡覺，清爽的，預算70元','清爽',{maxCaffeine:0,maxPrice:70});
for(const message of ['我沒有準備睡覺，想喝清爽的','晚上要工作，清爽的就好','朋友準備睡覺，我想喝清爽的','不是睡前喝，清爽的就好'])add('train','no_invented_caffeine',message,'清爽');
for(const message of ['有點低落，想喝奶香的','難過但只想喝奶香','不開心，找奶香的'])add('train','comfort_no_sugar',message,'奶香');
for(const message of ['今天喝水太少，想喝果香的','很少喝水，口渴，果香的就好'])add('train','hydration',message,'果香');
add('train','focus','想提神，也要清爽','清爽、提神');
add('train','focus','提神但咖啡因0mg，清爽就好','清爽、提神',{maxCaffeine:0});
add('train','release','咖啡因不限','清爽',{maxPrice:70},{query:'清爽',filters:{maxCaffeine:0,maxPrice:70},guard:''});
add('train','retention','預算改成80元','清爽',{maxCaffeine:0,maxPrice:80},{query:'清爽',filters:{maxCaffeine:0,maxPrice:70},guard:''});
// Freeze unseen combinations before any training; never select targets from model outputs.
add('validation','sleep','準備睡覺，果香，預算65元','果香',{maxCaffeine:0,maxPrice:65});
add('validation','sleep','好累想提神但等一下要睡覺，奶香的就好','奶香',{maxCaffeine:0});
add('validation','sleep','不想失眠，回甘，咖啡因50mg以下','回甘',{maxCaffeine:0});
add('validation','sleep','待會要睡覺，果香，不加布丁','果香',{maxCaffeine:0,excludedToppings:['布丁']});
add('validation','no_invented_caffeine','晚上還要工作，想喝果香','果香');
add('validation','no_invented_caffeine','沒有準備睡覺，回甘就好','回甘');
add('validation','no_invented_caffeine','同事準備睡覺，我要奶香','奶香');
add('validation','comfort_no_sugar','心情低落，回甘就好，不要布丁','回甘',{excludedToppings:['布丁']});
add('validation','hydration','沒喝水，有點口渴，想喝回甘的','回甘');
add('validation','focus','要提神，回甘，預算90元','回甘、提神',{maxPrice:90});
add('validation','release','咖啡因不限','果香',{maxPrice:65},{query:'果香',filters:{maxCaffeine:0,maxPrice:65},guard:''});
add('validation','retention','預算改成75元','果香',{maxCaffeine:0,maxPrice:75},{query:'果香',filters:{maxCaffeine:0,maxPrice:65},guard:''});
const snapshot={version:'wellbeing-intent-v1',catalogSha256:createHash('sha256').update(fs.readFileSync('data/catalog.json')).digest('hex'),
  split:'20 new authored training + existing 73 rehearsal; 12 new heldout + unchanged 59 regression cases',
  limitations:['Synthetic labels are not clinical evidence','Only Qwen intent is mood-specific; no simulated consumer interactions','Legacy regression inputs remain frozen from earlier Worker version'],
  train:[...base.train,...rows.filter(r=>r.split==='train')],validation:[...base.validation,...rows.filter(r=>r.split==='validation')]};
const seen=new Set(snapshot.train.map(c=>JSON.stringify(c.input)));
assert(snapshot.validation.every(c=>!seen.has(JSON.stringify(c.input))),'train/validation overlap');
fs.writeFileSync('training/qwen_wellbeing_snapshot.json',JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({train:snapshot.train.length,validation:snapshot.validation.length,newTrain:rows.filter(r=>r.split==='train').length,newValidation:rows.filter(r=>r.split==='validation').length}));

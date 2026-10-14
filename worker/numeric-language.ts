import type {Filters} from './types';
import {toppingTerms} from './drink-language';

export const capFields=['maxPrice','maxCalories','maxCaffeine'] as const;
export type CapField=typeof capFields[number];
export type NumericQuestion={field:CapField;reason:'invalid'|'missing'|'unsupported'|'approximate-zero'};
export const capLabels={maxPrice:'預算',maxCalories:'熱量',maxCaffeine:'咖啡因'};
export const capUnits={maxPrice:'元',maxCalories:'kcal',maxCaffeine:'mg'};
export const exclusiveKeys={maxPrice:'priceExclusive',maxCalories:'caloriesExclusive',maxCaffeine:'caffeineExclusive'} as const;
const digits:Record<string,number>={零:0,〇:0,一:1,二:2,兩:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
const numberText='[+-]?(?:\\d+(?:\\.\\d+)?|負?[零〇一二兩三四五六七八九十百千萬]+(?:點[零〇一二兩三四五六七八九]+)?)';
const changes='(?:改成|改為|改到|調成|調到|設成|提高到|提高至|提升到|降到|降低到|調低到|調高到|等於|為|是|要)?';
const comparison='(?:不超過|不能超過|不要超過|最多|至多|上限(?:為)?|少於|小於|低於|未滿|不到|<=|≤|<|=)?';
const units='(?:元|塊錢|塊|毫克|mg|公克|克|g|大卡|千卡|kcal|卡|kJ|%)?';
const bounds='(?:以下|以內|內|以前)?';
const fields='預算|價格|價錢|價位|熱量|卡路里|咖啡因';
const fieldOf=(label:string):CapField=>/熱量|卡路里/.test(label)?'maxCalories':label==='咖啡因'?'maxCaffeine':'maxPrice';

export function parseNumber(text:string):number {
  text=text.normalize('NFKC');
  if(/^[+-]?\d+(?:\.\d+)?$/.test(text))return Number(text);
  const negative=text.startsWith('負');if(negative)text=text.slice(1);
  const [integer,fraction]=text.split('點');
  if(!integer||!/^[零〇一二兩三四五六七八九十百千萬]+$/.test(integer)||fraction!==undefined&&!/^[零〇一二兩三四五六七八九]+$/.test(fraction))return NaN;
  let value=0;
  if(!/[十百千萬]/.test(integer))value=Number([...integer].map(c=>digits[c]).join(''));
  else {
    if(/[一二兩三四五六七八九]{2}|零[十百千萬]|[百千萬][一二兩三四五六七八九]$/.test(integer))return NaN;
    let section=0,n=0,lastUnit=10000;
    for(const c of integer){
      if(c in digits){n=digits[c];continue;}
      const unit=({十:10,百:100,千:1000,萬:10000} as Record<string,number>)[c];
      if(unit===10000){value+=(section+n)*unit;section=0;n=0;lastUnit=10000;}
      else {if(unit>=lastUnit)return NaN;section+=(n||1)*unit;n=0;lastUnit=unit;}
    }
    value+=section+n;
  }
  if(fraction)value+=Number('0.'+[...fraction].map(c=>digits[c]).join(''));
  return negative?-value:value;
}

export function validateNumericQuestions(value:unknown):NumericQuestion[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>3||value.some(q=>!q||typeof q!=='object'||!capFields.includes(q.field)||!['invalid','missing','unsupported','approximate-zero'].includes(q.reason)))throw new Error('數值追問格式有誤');
  if(new Set(value.map(q=>q.field)).size!==value.length)throw new Error('數值追問不可重複');
  return value.map(q=>({field:q.field,reason:q.reason}));
}

// Consume only explicit, supported bounds; never extract the absolute value of a negative number.
export function numericConditions(raw:string,knownNames:string[]=[]){
  const text=raw.normalize('NFKC');
  const warnings:string[]=[];
  const updates:Partial<Filters>={},resolved=new Set<CapField>(),questions:NumericQuestion[]=[];
  const question=(field:CapField,reason:NumericQuestion['reason'])=>{resolved.delete(field);if(!questions.some(q=>q.field===field))questions.push({field,reason});};
  const release=(_phrase:string,label:string)=>{const field=fieldOf(label);updates[field]=undefined;updates[exclusiveKeys[field]]=undefined;resolved.add(field);return '';};
  let remainder=text.replace(new RegExp(`(?:取消|清除|移除|不限制|不限|沒有|無|不要)\\s*(${fields})\\s*(?:限制|上限)`,'g'),release);
  remainder=remainder.replace(new RegExp(`(${fields})\\s*${changes}\\s*(?:不限|都可以|不限制|取消上限|不用限制|不設上限)`,'g'),release);

  const approximateZero='(?:近乎|幾乎|接近|趨近(?:於)?|近似|大約)\\s*(?:為|是|等於|=)?\\s*(?:零(?!點)|0(?![.\\d]))';
  for(const pattern of [new RegExp(`咖啡因\\s*(?:總)?(?:含量)?\\s*(?:為|是|要)?\\s*${approximateZero}\\s*(?:mg|毫克)?`,'gi'),new RegExp(`${approximateZero}\\s*咖啡因`,'g')]){
    remainder=remainder.replace(pattern,()=>{question('maxCaffeine','approximate-zero');return '';});
  }

  const consume=(label:string,phrase:string,token:string,unit:string,tail:string)=>{
    const field=fieldOf(label),value=parseNumber(token)*(/^(?:公克|克|g)$/i.test(unit)&&field==='maxCaffeine'?1000:1);
    const strict=/(?:少於|小於|低於|未滿|不到|(?<!<)<(?![=]))/.test(phrase);
    if(!Number.isFinite(value)||value<0||value>10000||strict&&value===0)question(field,'invalid');
    else if(/^(?:到|至|~|-|[a-zA-Z%]|\/)/.test(tail)||unit==='%'||/^kJ$/i.test(unit)||field==='maxPrice'&&unit&&!/元|塊/.test(unit)||field==='maxCalories'&&unit&&!/大卡|千卡|kcal|卡/i.test(unit)||field==='maxCaffeine'&&unit&&!/毫克|mg|公克|克|g/i.test(unit))question(field,'unsupported');
    else {updates[field]=value;updates[exclusiveKeys[field]]=strict||undefined;resolved.add(field);}
  };
  remainder=remainder.replace(new RegExp(`(${fields})\\s*(?:含量)?\\s*${changes}\\s*(?:在)?\\s*(${comparison})\\s*(${numberText})\\s*(${units})\\s*${bounds}((?:到|至|~|-)\\s*${numberText}\\s*${units})?`,'gi'),(phrase,label,_comparison,token,unit,range,offset,source)=>{consume(label,phrase,token,unit,range||source.slice(offset+phrase.length));return '';});
  remainder=remainder.replace(new RegExp(`(?:不超過|不能超過|不要超過|最多|至多|少於|小於|低於|未滿|不到|<=|≤|<)?\\s*(${numberText})\\s*(元|塊錢|塊)\\s*${bounds}`,'g'),(phrase,token,unit,offset,source)=>{consume('預算',phrase,token,unit,source.slice(offset+phrase.length));return '';});
  remainder=remainder.replace(/(?:无|無|不含|不要|沒有)咖啡因/g,()=>{updates.maxCaffeine=0;updates.caffeineExclusive=undefined;resolved.add('maxCaffeine');return '';});
  for(const [pattern,field,value,warning] of [
    [/低咖啡因/g,'maxCaffeine',100,'「低咖啡因」先採每杯 100 mg 以下，可再指定上限；這不是睡眠或健康保證。'],
    [/低(?:熱量|卡路里|卡)/g,'maxCalories',200,'「低熱量」先採每杯 200 kcal 以下，可再指定上限。']
  ] as const){
    remainder=remainder.replace(pattern,()=>{
      if(!resolved.has(field)&&!questions.some(q=>q.field===field)){updates[field]=value;updates[exclusiveKeys[field]]=undefined;resolved.add(field);warnings.push(warning);}
      return '';
    });
  }
  for(const match of remainder.matchAll(new RegExp(`(${fields})([^，,。；;\\n]*)`,'g'))){
    const field=fieldOf(match[1]);
    const before=remainder.slice(Math.max(0,match.index!-3),match.index);
    if(/低$/.test(before)&&!/再低$|更低$/.test(before)&&!match[2].trim())continue;
    if(!resolved.has(field))question(field,/至少|大於|高於|超過|>=|≥|>|到|至/.test(match[2])?'unsupported':'missing');
  }
  const expensive=/^(?:這些|這杯|這個|現在|覺得|都)?太貴(?:了)?[。！!？?\s]*$/.test(text);
  if((/便宜(?:一點|點)|貴一點/.test(remainder)||expensive)&&!resolved.has('maxPrice')){question('maxPrice','missing');remainder=remainder.replace(/(?:再|更)?便宜(?:一點|點)|貴一點/g,'');if(expensive)remainder='';}

  // These phrases carry a numeric edit, not a new flavour for vector retrieval.
  const boundary=['清爽','回甘','果香','酸甜','濃郁','奶香','嚼勁','提神','茶香','花香','紅茶','綠茶','青茶','烏龍','純茶','奶茶','奶','咖啡(?!因)','果汁','水果','檸檬','想喝','要喝','不要','不加','不喝','不喜歡','不愛','排除','過敏','花生','堅果','乳糖不耐','麩質','忌口',...toppingTerms,...knownNames.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))].join('|');
  remainder=remainder.replace(new RegExp(`(${fields})[^，,。；;\\n]*?(?=${boundary}|[，,。；;\\n]|$)`,'g'),(phrase,label)=>questions.some(q=>q.field===fieldOf(label))?'':phrase);
  for(const {field} of questions){delete updates[field];delete updates[exclusiveKeys[field]];resolved.delete(field);}
  const onlyConditions=!remainder.replace(/(?:我|請|幫我|可以|想要|改成|改為|改到|再|然後|還有|而且|但是|但|也|就|好了|謝謝|[，,。；;！!？?\s])/g,'');
  return {updates,resolved,questions,warnings,remainder:remainder.trim(),onlyConditions:onlyConditions&&(resolved.size>0||questions.length>0)};
}

export function numericAnswer(raw:string,field:CapField):string|null {
  const text=raw.normalize('NFKC').trim().replace(/^(?:改成|改為|改到|那就|那|就|我要|我想要|要|是)\s*/,'').replace(/[。！!？?]+$/,'').trim();
  if(field!=='maxPrice'&&/(?:元|塊)/.test(text)||field!=='maxCaffeine'&&/(?:mg|毫克|公克|克|g)/i.test(text)||field!=='maxCalories'&&/(?:kcal|大卡|千卡|卡)/i.test(text))return null;
  if(new RegExp(`^${comparison}\\s*${numberText}\\s*${units}\\s*${bounds}(?:就好|好了)?$`,'i').test(text)||/^(?:不限|都可以|不限制)$/.test(text))return `${capLabels[field]}${text.replace(/(?:就好|好了)$/,'')}`;
  return null;
}

export function numericFollowUp(questions:NumericQuestion[]){
  if(!questions.length)return undefined;
  const {field,reason}=questions[0],label=capLabels[field],unit=capUnits[field];
  if(reason==='approximate-zero')return {message:'「近乎為零」還沒有明確上限。你要嚴格 0 mg，還是接受少量咖啡因？如果接受少量，請告訴我每杯最多幾 mg。口味與預算會保留。',choices:[{label:'嚴格 0 mg',message:'咖啡因=0'}]};
  const intro=reason==='invalid'?`這個${label}上限無法套用，請指定有效的非負數字。${field==='maxCaffeine'?'咖啡因不能小於零。':''}`:reason==='unsupported'?`目前${label}支援設定上限，請用「最多」或「以下」指定。`:'';
  return {message:`${intro}你希望${label}最多多少 ${unit}？${field==='maxCaffeine'?'如果想要零咖啡因，可以回覆「零」。':''}其他條件會保留。`,choices:field==='maxCaffeine'?[{label:'零咖啡因',message:'咖啡因0mg'},{label:'50 mg 以下',message:'咖啡因50mg以下'},{label:'咖啡因不限',message:'咖啡因不限'}]:[{label:`${label}不限`,message:`${label}不限`}]};
}

export function numericAcknowledgement(filters:Filters){
  const labels=capFields.filter(f=>filters[f]!==undefined).map(f=>`${capLabels[f]}${filters[exclusiveKeys[f]]?' < ':' ≤ '}${filters[f]} ${capUnits[f]}`);
  return labels.length?`已套用條件：${labels.join('；')}。`:'已更新篩選條件。';
}

// The retrieval text never carries numeric filters, including model-generated text.
// This function does not apply any model-generated number to the verified filters.
export function flavorQuery(raw:string):string {
  return numericConditions(raw).remainder
    .replace(/(?:晚上|睡前)(?:想喝|喝)?/g,'')
    .replace(/(?:低|零|無|不含|不要|沒有)咖啡因|低(?:熱量|卡路里|卡)/g,'')
    .replace(/(^|[，,。；;、])\s*(?:我)?(?:今天|這次)?(?:想要喝|想喝|要喝|想要|幫我找|請幫我找|我要)?\s*(?:的)?/g,'$1')
    .replace(/^[，,。；;、\s的]+|[，,。；;、\s]+$/g,'')
    .replace(/(?:但是|可是|而且|然後|還有|以及|並且|但|和|跟|含|要|在|的)\s*$/,'')
    .replace(/^[，,。；;、\s]+|[，,。；;、\s]+$/g,'').trim();
}

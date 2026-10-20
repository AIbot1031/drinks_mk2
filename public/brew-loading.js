import {selectedToppings} from './topping-selection.js';
const toppings=['珍珠','波霸','布丁','椰果','仙草','芋圓','芋泥','茶凍','果肉','燕麥','奶蓋','冰淇淋'];
export function loadingIngredients(body={}){
 const filters=body.filters||body.state?.filters||body.rankingContext?.input?.filters||{},chosen=selectedToppings(filters),message=typeof body.message==='string'?body.message:'';
 const mentioned=toppings.filter(t=>message.includes(t));
 // Animation hints only, never mutate submitted filters. Ambiguous negative
 // clauses don't animate an ingredient the user may have excluded.
 const values=/不要|不加|排除|取消|去掉|不含/.test(message)?chosen.filter(t=>!mentioned.includes(t)):[...chosen,...mentioned];
 return selectedToppings({toppings:[...new Set(values)],excludedToppings:filters.excludedToppings}).filter(t=>toppings.includes(t)).slice(0,10);
}
const kind=t=>({珍珠:'pearl',波霸:'pearl',布丁:'pudding',椰果:'coconut',仙草:'jelly',芋圓:'taro',芋泥:'mash',茶凍:'tea-jelly',果肉:'fruit',燕麥:'oat',奶蓋:'foam',冰淇淋:'cream'})[t];
export function initBrewLoading(){
 const root=document.createElement('aside');root.id='brew-loading';root.className='brew-loading';root.hidden=true;root.setAttribute('aria-label','推薦進行中');
 const scene=document.createElement('div');scene.className='brew-scene';scene.setAttribute('aria-hidden','true');
 scene.innerHTML='<svg viewBox="0 0 260 270" focusable="false"><defs><clipPath id="brew-cup-mask"><path d="M64 66H196L180 232H80Z"/></clipPath><linearGradient id="brew-tea" x2="0" y2="1"><stop stop-color="var(--brew-light)"/><stop offset="1" stop-color="var(--brew-dark)"/></linearGradient></defs><ellipse cx="130" cy="249" rx="76" ry="10" fill="#184d3520"/><path class="brew-stream" d="M130 0V165" stroke="var(--brew-light)" stroke-width="12" stroke-linecap="round"/><g clip-path="url(#brew-cup-mask)"><g class="brew-liquid"><path d="M50 118Q90 104 130 118T210 118V245H50Z" fill="url(#brew-tea)"/><path class="brew-wave" d="M40 122Q90 102 140 122T240 122" fill="none" stroke="#fff9" stroke-width="7"/><circle class="brew-bubble" cx="105" cy="190" r="5" fill="#fff8"/><circle class="brew-bubble brew-bubble-two" cx="155" cy="205" r="7" fill="#fff6"/></g></g><path d="M61 65H199L182 233Q181 240 172 240H88Q79 240 78 233Z" fill="#fff1" stroke="#335b49" stroke-width="3"/><path d="M57 61Q130 44 203 61V72H57Z" fill="#fff9" stroke="#335b49" stroke-width="3"/><path d="M168 26L155 169" stroke="#b17052" stroke-width="9" stroke-linecap="round"/><path d="M90 88L97 160" stroke="#fffa" stroke-width="5" stroke-linecap="round"/><text x="130" y="151" text-anchor="middle" fill="#fff" font-size="16" letter-spacing="3">SIP</text></svg>';
 const particles=document.createElement('div');particles.className='brew-particles';scene.append(particles);
 const title=document.createElement('strong');title.textContent='為你調一杯靈感';
 const live=document.createElement('p');live.className='brew-live';live.setAttribute('role','status');live.setAttribute('aria-live','polite');
 const note=document.createElement('small');note.textContent='正在比對飲料與你的條件…';
 root.append(scene,title,live,note);document.body.append(root);
 const active=new Map();
 function render(){
  root.hidden=!active.size;if(!active.size){particles.replaceChildren();live.textContent='';return;}
  const body=[...active.values()].at(-1),ingredients=loadingIngredients(body),filters=body.filters||body.state?.filters||body.rankingContext?.input?.filters||{};
  const green=/綠茶|抹茶/.test(filters.tea||'');root.style.setProperty('--brew-light',green?'#b5ce89':'#e0b574');root.style.setProperty('--brew-dark',green?'#719e61':'#ac744a');
  live.textContent=ingredients.length?'靈感配料：'+ingredients.join('、'):'讓茶香慢慢展開';particles.replaceChildren();
  ingredients.forEach((name,index)=>{for(let piece=0;piece<3;piece++){
   const node=document.createElement('i');node.className='brew-piece brew-'+kind(name);node.dataset.ingredient=name;
   node.style.setProperty('--x',`${37+(index*7+piece*9)%29}%`);node.style.setProperty('--delay',`${-(index*.38+piece*.74)}s`);node.style.setProperty('--land',`${174+(index+piece)%4*8}px`);particles.append(node);
  }});
 }
 return {start(body){const token=Symbol('recommendation');active.set(token,body);render();return token;},stop(token){active.delete(token);render();}};
}

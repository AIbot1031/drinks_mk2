// Research supports limited contextual advice, not product-specific medical outcomes.
export const wellbeingVersion = '3.0-wellbeing-v1';
export const wellbeingSources = {
  sleep: {title:'Drake 等（2013）：咖啡因與睡眠',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC3805807/'},
  focus: {title:'De Bruin 等（2011）：紅茶與注意力',url:'https://pubmed.ncbi.nlm.nih.gov/21172396/'},
  hydration: {title:'Pross 等（2014）：飲水與心情',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC3984246/'},
  comfort: {title:'Mantantzis 等（2019）：糖與心情統合分析',url:'https://pubmed.ncbi.nlm.nih.gov/30951762/'},
} as const;
export function wellbeingAdvice(message:string) {
  // Do not interpret quotations, third-person statements or hypothetical examples as current intent.
  const clauses=message.replace(/[「“"『][^」”"』]*[」”"』]/g,'').split(/[，,。；;！!？?\n]/)
    // 「其他飲料」 is a choice, while 「其他人」 refers to somebody else.
    .filter(c=>!/(?:如果|假設|例如|朋友|同事|家人|其他人|別人)/.test(c)&&!/(?:^|[^其])[他她]/.test(c));
  const sleep=clauses.some(c=>!/(?:不|沒有|沒|無)(?:是|想|要|打算|準備|需要)?(?:睡|休息)|不會.{0,4}睡|不是.{0,6}睡前/.test(c)
    && /睡前|準備睡|打算睡|快睡了|要睡覺|想睡覺|等等.{0,3}睡|待會.{0,3}睡|等一下.{0,3}睡|不想失眠|怕失眠/.test(c));
  const focus=!sleep&&clauses.some(c=>!/(?:不|沒)(?:想|要|需要)?提神/.test(c)&&/提神|保持清醒|集中注意力/.test(c));
  const hydration=clauses.some(c=>!/(?:不|沒)(?:覺得)?口渴|沒有.{0,3}缺水/.test(c)&&/口渴|喝水太少|沒.{0,3}喝水|很少喝水|喝水不夠/.test(c));
  const comfort=clauses.some(c=>!/(?:不難過|沒有.{0,3}(?:難過|低落))/.test(c)&&/難過|低落|不開心/.test(c));
  const notes:string[]=[];
  if(sleep)notes.push('你提到準備睡覺或避免失眠，本次只列出資料確認咖啡因為 0 mg、非估算的飲品。這是避免咖啡因干擾的選擇，不代表飲品有助眠療效；400 mg 咖啡因試驗不能推論每杯飲料的效果。若要解除此條件，可說「咖啡因不限」。');
  if(focus)notes.push('紅茶研究支持部分短期注意力與清醒度改善，不能當作改善情緒或每款茶都有效的保證；不會因疲累自行增加咖啡因攝取量，也不覆寫你設定的咖啡因上限。');
  if(hydration)notes.push('如果今天喝水少，可以先喝白開水。補水與部分疲倦感的研究有限，不能延伸成含糖飲料能改善心情，也不是喝越多越好。');
  if(comfort)notes.push('可以依喜歡的口味選擇飲料；目前研究不支持為了改善心情而增加糖量，因此不會因難過自動推薦高糖飲品。');
  const applied=(['sleep','focus','hydration','comfort'] as const).filter(k=>({sleep,focus,hydration,comfort})[k]);
  return {version:wellbeingVersion,sleep,notes,applied,sources:applied.map(k=>wellbeingSources[k])};
}

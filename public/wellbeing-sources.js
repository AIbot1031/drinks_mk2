export function appendWellbeingSources(container,wellbeing){
  if(!wellbeing?.sources?.length)return;
  const section=document.createElement('details');
  const title=document.createElement('summary');title.textContent='推薦的研究依據與限制';section.append(title);
  const note=document.createElement('p');note.textContent='研究結果不代表這杯飲料有治療或助眠效果。';section.append(note);
  for(const source of wellbeing.sources){
    if(!/^https:\/\/(?:pubmed|pmc)\.ncbi\.nlm\.nih\.gov\//.test(source.url))continue;
    const p=document.createElement('p'),a=document.createElement('a');
    a.textContent=source.title;a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);section.append(p);
  }
  container.append(section);
}

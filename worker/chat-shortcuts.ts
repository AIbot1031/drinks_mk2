export type ChatShortcut={label:string;message:string};
export const defaultShortcuts:ChatShortcut[]=[{label:'清爽、60 元內',message:'清爽回甘，預算 60 元'},{label:'不要星巴克',message:'不要星巴克'},{label:'再推薦幾杯',message:'再推薦幾杯'}];
export function validateShortcuts(value:unknown):ChatShortcut[]{
  if(!Array.isArray(value)||value.length>8)throw new Error('快捷標籤最多 8 個');
  return value.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('快捷標籤格式有誤');
    const {label,message}=item;
    if(typeof label!=='string'||!label.trim()||label.length>20||typeof message!=='string'||!message.trim()||message.length>300||/[\u0000-\u001f]/.test(label)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message))throw new Error('標籤名稱須為 1 至 20 字，推薦需求須為 1 至 300 字');
    return {label:label.trim(),message:message.trim()};
  });
}

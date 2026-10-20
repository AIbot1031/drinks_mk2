export function rankingStatus(value){
 const m=value.mode??{};
 if(m.rankingStatus==='not-run'||m.routeA==='not-run')return '沒有符合候選，未執行模型排序。';
 const a=m.routeA==='roberta-wwm'?'語意搜尋：RoBERTa-WWM。':m.routeA==='macbert'?'語意搜尋：MacBERT。':m.routeAFallback?'語意模型暫不可用，使用 TF-IDF 備援。':'文字搜尋：TF-IDF。';
 const reasons={model_not_ready:'模型尚未連線或就緒',catalog_mismatch:'模型索引與目前目錄版本不符',model_busy:'模型服務忙碌',no_valid_response:'模型逾時、斷線或未回傳有效結果',invalid_reply:'模型回傳資料未通過驗證','Mac unavailable, timeout, or index mismatch':'模型未就緒、逾時或目錄版本不符','Mac inference bridge error':'模型連線發生錯誤'};
 const reason=m.routeAFallback?`原因：${reasons[m.routeAFallback]??'模型回應未通過驗證'}。`:'';
 const b=m.routeB==='relgt'?'個人化排序：RelGT，已參考歷史互動。':m.personalized?'已套用最新收藏與不喜歡偏好。':'';
 return [a,reason,b,value.rankingReused?'沿用本輪基礎排名，已即時更新偏好。':'',value.rankingReused&&m.routeAFallback?'重新推薦可重試語意模型。':''].filter(Boolean).join(' ');
}

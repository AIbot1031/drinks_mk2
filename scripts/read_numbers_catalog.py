"""Extract cached typed values from Numbers without modifying the workbook."""
import argparse
import hashlib
import json
from pathlib import Path
from datetime import date,datetime
from numbers_parser import Document

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path)
    p.add_argument('--output',type=Path)
    args=p.parse_args()
    doc=Document(args.source)
    candidates=[]
    for sheet in doc.sheets:
        for table in sheet.tables:
            rows=table.rows(values_only=True)
            headers=rows[0] if rows else []
            print(json.dumps({'sheet':sheet.name,'table':table.name,'rows':len(rows),'columns':len(headers),'headers':headers[:18]},ensure_ascii=False))
            if {'品牌','飲料名稱','杯型','商品_ID'}.issubset(headers):candidates.append((sheet.name,table.name,headers,rows[1:]))
    if not args.output:return
    if len(candidates)!=1:raise ValueError('Expected exactly one drink table')
    sheet,table,headers,rows=candidates[0]
    result={'schema':1,'source':args.source.name,'sourceSha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),
            'sheet':sheet,'table':table,'headers':headers,'rows':rows}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    def encode(value):
        if isinstance(value,(date,datetime)):return value.isoformat()
        raise TypeError('Unsupported Numbers value: '+type(value).__name__)
    args.output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False,default=encode)+'\n')
    print('EXTRACTED='+str(args.output))

if __name__=='__main__':main()

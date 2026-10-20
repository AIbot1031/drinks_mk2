import bytes from '../data/lexical-runtime.bin';
import {gunzipSync} from 'node:zlib';
import type {LexicalIndex} from './lexical';
import {catalogVersion} from './catalog-version';
const index:LexicalIndex&{catalogVersion:string}=JSON.parse(gunzipSync(new Uint8Array(bytes)).toString('utf8'));
if(index.catalogVersion!==catalogVersion)throw Error('文字索引與目錄版本不符');
export default index;

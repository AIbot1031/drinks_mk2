import bytes from '../data/directory-runtime.bin';
import {gunzipSync} from 'node:zlib';
import type shape from '../data/directory-runtime.json';
const packed:typeof shape=JSON.parse(gunzipSync(new Uint8Array(bytes)).toString('utf8'));
const menus=packed.menus.map(ids=>ids.map(id=>packed.names[id]));
const directory={...packed.meta,stores:packed.stores.map(({menuNames,...rest})=>menuNames===null?rest:{...rest,menuNames:menus[menuNames]})};
export default directory;

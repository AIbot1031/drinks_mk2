import policy from '../data/non-beverage-policy.json';
import type {Drink} from './types';
const excluded=new RegExp(policy.information+'|'+policy.merchandise,'i');
export function isCatalogBeverage(d:Pick<Drink,'name'|'sourceMenuCategory'>){
 return !excluded.test((d.name+' '+(d.sourceMenuCategory??'')).normalize('NFKC').replace(/\s/g,''));
}

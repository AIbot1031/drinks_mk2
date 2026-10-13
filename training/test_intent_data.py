import unittest
from training.intent_data import prepare

def catalog():
    return [{'id':f'd{i}','brand':'品牌','name':f'飲料{i}','tea':[],'milk':[],
             'toppings':[],'richness':.2,'noMilk':True,'price':i} for i in range(50)]

def snapshot(events):
    return {'schema':1,'kind':'timestamped-consumer-interactions','cutoff_ms':100000,
            'events':[{'id':str(i),'user_code':'u_'+'a'*64,'drink_id':id,'action':action,'occurred_at':at}
                      for i,(id,action,at) in enumerate(events)]}

class TemporalDataTest(unittest.TestCase):
    def test_simultaneous_and_future_events_never_enter_history(self):
        products,rows,_,counts,_=prepare(snapshot([('d0','like',10),('d1','like',10),('d2','like',20),('d3','like',100001)]),catalog())
        self.assertEqual([len(r['history']) for r in rows],[0,0,2])
        self.assertTrue(all(e['occurred_at']<r['at'] for r in rows for e in r['history']))
        self.assertEqual(counts['after_cutoff'],1)

    def test_cancellations_are_history_not_negative_labels(self):
        _,rows,_,counts,_=prepare(snapshot([('d0','like',10),('d0','unlike',20),('d1','like',30)]),catalog())
        self.assertEqual(len(rows),2);self.assertEqual(counts['dislike_targets'],0)
        self.assertEqual(rows[-1]['history'][-1]['action'],'unlike')

    def test_no_price_dependency_and_duplicate_cup_targets(self):
        drinks=catalog();drinks.append({**drinks[0],'id':'another-cup','price':9999})
        data=snapshot([('d0','like',10),('another-cup','like',10)])
        result=prepare(data,drinks)
        self.assertEqual(len(result[1]),1)
        self.assertEqual(result[3]['duplicate_targets'],1)
        for d in drinks:d['price']=0
        changed=prepare(data,drinks)
        self.assertEqual(result[1:],changed[1:])

    def test_chronological_holdout_keeps_equal_timestamps_together(self):
        _,rows,split,_,method=prepare(snapshot([(f'd{i}','like',i+1) for i in range(40)]),catalog())
        self.assertTrue(all(split.values()))
        self.assertLess(max(rows[i]['at'] for i in split['train']),min(rows[i]['at'] for i in split['validation']))
        self.assertLess(max(rows[i]['at'] for i in split['validation']),min(rows[i]['at'] for i in split['test']))
        self.assertIn('chronological',method)

    def test_one_real_target_is_not_rejected(self):
        _,rows,split,counts,_=prepare(snapshot([('d0','like',10)]),catalog())
        self.assertEqual(counts['samples'],1);self.assertEqual(split['train'],[0]);self.assertEqual(split['validation'],[])
        self.assertEqual(rows[0]['candidates'][0],rows[0]['target'])

if __name__=='__main__':unittest.main()

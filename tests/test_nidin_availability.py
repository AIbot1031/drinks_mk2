import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from nidin_menu_policy import availability_snapshot,product_available
from import_nidin_recommendations import classification

class MenuPolicyTest(unittest.TestCase):
 def test_information_merchandise_and_mixed_bundles(self):
  for category,name in [('原料產地資訊 (請勿下單)','飲品產地資訊一覽'),('【勿 下 單】茶太娃娃','愛荔Sasa'),('新品套餐','【１＋１】奶茶+娃娃'),('飲品','杯套'),('飲品','飲品資訊一覽')]:
   self.assertNotEqual(classification(category,{'name':name,'type':1}),'beverage')
  for category,name in [('限定優惠 ♥','擂擂穀麥奶茶'),('百香系列/聯名活動','百香綠茶'),('飲品','珍珠奶茶')]:
   self.assertEqual(classification(category,{'name':name,'type':1}),'beverage')
 def test_stop_sale_and_schedules_are_branch_specific(self):
  raw={'status':200,'product_list':{'category':{'milk':[{'product_id':3}]}},'schedule_info':{'relation':{'product_list':{'category':{'milk':[{'product_id':4}]}}}},'today_schedule_info':{'category_list':[9]}}
  a=availability_snapshot(raw,'now','public','checksum');m={'availability':a}
  self.assertFalse(product_available(m,{'product_id':'milk'},{'product_id':3}))
  self.assertFalse(product_available(m,{'product_id':'milk'},{'product_id':4}))
  self.assertFalse(product_available(m,{'product_id':9},{'product_id':5}))
  self.assertTrue(product_available(m,{'product_id':'milk'},{'product_id':5}))
  self.assertTrue(product_available(m,{'product_id':'other'},{'product_id':3}))
  self.assertFalse(product_available({}, {'product_id':'milk'},{'product_id':5}))
 def test_unknown_relation_cannot_be_treated_as_available(self):
  with self.assertRaises(ValueError):availability_snapshot({'status':200,'product_list':{'category':[3]}},'now','public','checksum')

if __name__=='__main__':unittest.main()

import unittest
from collections import Counter
from scripts.import_data import convert

class CatalogImportTests(unittest.TestCase):
    def test_numbers_float_capacity_retains_excel_drink_identity(self):
        row={'品牌':'星巴克','商品_ID':'1048','飲料名稱':'冰米香桂花那堤','杯型':'中杯（354 ml）','適用地區／門市':'商品頁未列指定地區／門市','容量_ml':354}
        excel=convert(row,2,Counter());numbers=convert({**row,'容量_ml':354.0},2,Counter())
        self.assertEqual(excel['id'],'d_9fb3007739bf81d8_1')
        self.assertEqual(excel['id'],numbers['id'])

    def test_numeric_representation_noise_and_explicit_toppings(self):
        row={'品牌':'一沐日','飲料名稱':'逮丸奶茶','配料':'草仔粿珍珠','濃郁度_0至1':0.30000000000000004,'熱量_kcal':226.29999999999998,'咖啡因_mg':100.0}
        drink=convert(row,2,Counter())
        self.assertEqual(drink['richness'],0.3);self.assertEqual(drink['calories'],226.3)
        self.assertEqual(drink['caffeineText'],'100');self.assertIn('珍珠',drink['toppings'])

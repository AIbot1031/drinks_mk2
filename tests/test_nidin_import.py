import pathlib
import sys
import unittest

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from import_nidin_recommendations import classification


class NidinImportTest(unittest.TestCase):
    def test_beverage_and_pending(self):
        self.assertEqual(classification('經典茶飲',{'name':'茉莉綠茶','type':1}),'beverage')
        self.assertEqual(classification('新品',{'name':'夏日之夢','type':1}),'classification_pending')

    def test_food_bags_addons_and_bundles_are_not_drinks(self):
        for category,name,kind in [('經典茶飲','塑膠袋',1),('配料','珍珠奶茶',1),('甜點','紅茶蛋糕',1),('套餐','兩杯奶茶',3),('咖啡','咖啡豆',1)]:
            self.assertNotEqual(classification(category,{'name':name,'type':kind}),'beverage')


if __name__=='__main__':
    unittest.main()

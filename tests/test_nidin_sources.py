import pathlib
import runpy
import unittest

BUILD = runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1] / 'scripts/build_nidin_directory.py'))


class NidinSourceTests(unittest.TestCase):
    def test_addresses_do_not_match_similarly_named_districts_or_unknown_regions(self):
        region = BUILD['region']
        self.assertEqual(region('632雲林縣虎尾鎮中正路100號'), ('雲林縣', '虎尾鎮'))
        self.assertEqual(region('台南市東區虎尾寮路100號'), ('臺南市', '東區'))
        self.assertEqual(region('雲林縣虎尾鎭中正路100號'), ('雲林縣', '虎尾鎮'))
        self.assertIsNone(region('虎尾中正路100號'))
        self.assertIsNone(region('不存在縣虎尾鎮100號'))

    def test_hidden_disabled_and_addon_items_cannot_confirm_menu_drinks(self):
        menu = {'categories': [{'product_id':10,'name':'茶飲','is_enable':True,'is_visible':True,'product_list':[1,2]},
                               {'product_id':20,'name':'茶飲','is_enable':True,'is_visible':False,'product_list':[3]}],
                'products':[{'product_id':i,'name':name,'type':1,'is_enable':enabled,'is_visible':True}
                            for i,name,enabled in [(1,'奶茶',True),(2,'停售茶',False),(3,'隱藏茶',True),(4,'珍珠加料',True)]]}
        self.assertEqual(BUILD['listed_names'](menu), set())
        menu['availability']={'status':'verified','excludedCategoryIds':[],'excludedProductIdsByCategory':{}}
        self.assertEqual(BUILD['listed_names'](menu), {'奶茶'})
        menu['availability']['excludedProductIdsByCategory']={'10':['1']}
        self.assertEqual(BUILD['listed_names'](menu), set())

    def test_brand_mapping_keeps_different_comebuy_brands_separate(self):
        aliases = BUILD['ALIASES']
        self.assertEqual(aliases['comebuytea'], 'COMEBUY')
        self.assertNotIn('comebuydream', aliases)
        self.assertNotIn('comebuytea2', aliases)


if __name__ == '__main__':
    unittest.main()

from catalog_products import PRODUCTS, expand, write_flat
import json

if PRODUCTS.exists():
    grouped = json.loads(PRODUCTS.read_text())
    catalog = expand(grouped)
    if grouped.get('productCount') != len(grouped['products']) or grouped.get('variantTotal') != len(catalog['drinks']):
        raise ValueError('Grouped catalog counts do not match its products and variants')
    if catalog.get('total') != len(catalog['drinks']):
        raise ValueError('Expanded catalog total does not match its variants')
    write_flat(catalog)

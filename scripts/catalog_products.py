"""Grouped canonical catalog source with a deterministic flat build adapter."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = ROOT / 'data/catalog-products.json'
FLAT = ROOT / 'data/catalog.json'


def normalize(catalog: dict) -> dict:
    catalog_keys = list(catalog)
    drink_keys = list(dict.fromkeys(key for drink in catalog['drinks'] for key in drink))
    groups: dict[tuple[str, str], list[tuple[int, dict]]] = {}
    for index, drink in enumerate(catalog['drinks']):
        groups.setdefault((drink['brand'], drink['name']), []).append((index, drink))
    products = []
    for (brand, name), rows in groups.items():
        common = set(rows[0][1]) - {'brand', 'name'}
        for _, row in rows[1:]:
            common.intersection_update(key for key, value in row.items()
                                       if key not in {'brand', 'name'} and value == rows[0][1].get(key))
        shared = {key: rows[0][1][key] for key in sorted(common)}
        variants = []
        for index, row in rows:
            variants.append({'order': index, 'keyOrder': list(row), **{key: value for key, value in row.items()
                                               if key not in {'brand', 'name'} and key not in common}})
        products.append({'brand': brand, 'name': name, 'shared': shared, 'variants': variants})
    return {key: value for key, value in catalog.items() if key != 'drinks'} | {
        'schema': 1, 'productCount': len(products), 'variantTotal': len(catalog['drinks']),
        'catalogKeys': catalog_keys, 'drinkKeys': drink_keys, 'products': products
    }


def expand(source: dict) -> dict:
    if source.get('schema') != 1 or not isinstance(source.get('products'), list):
        raise ValueError('Unsupported grouped catalog schema')
    rows = []
    for product in source['products']:
        for variant in product['variants']:
            order = variant.get('order')
            values = {'brand': product['brand'], 'name': product['name'], **product['shared'],
                      **{key: value for key, value in variant.items() if key not in {'order', 'keyOrder'}}}
            row = {key: values[key] for key in variant.get('keyOrder', source.get('drinkKeys', values)) if key in values}
            row.update({key: value for key, value in values.items() if key not in row})
            rows.append((order, row))
    rows.sort(key=lambda item: item[0])
    result = {key: value for key, value in source.items()
              if key not in {'schema', 'productCount', 'variantTotal', 'catalogKeys', 'drinkKeys', 'products'}}
    result['drinks'] = [row for _, row in rows]
    if source.get('catalogKeys'):
        return {key: result[key] for key in source['catalogKeys'] if key in result} | {key: value for key, value in result.items() if key not in source['catalogKeys']}
    return result


def write_grouped(catalog: dict, path: Path = PRODUCTS) -> dict:
    grouped = normalize(catalog)
    path.write_text(json.dumps(grouped, ensure_ascii=False, separators=(',', ':')) + '\n')
    return grouped


def write_flat(catalog: dict, path: Path = FLAT) -> None:
    path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '\n')


def load_flat() -> dict:
    if PRODUCTS.exists():
        return expand(json.loads(PRODUCTS.read_text()))
    # Supports the one-time migration and local manual recovery.
    return json.loads(FLAT.read_text())

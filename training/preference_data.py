"""Validate a pseudonymized snapshot without logging per-user records."""
import hashlib
import re


def prepare(snapshot, catalog, seed=42):
    if snapshot.get('schema') != 1 or snapshot.get('kind') != 'current-preference-snapshot':
        raise ValueError('Unsupported preference snapshot schema')
    lookup = {d['id']: d for d in catalog}
    rows, seen_users = [], set()
    counts = {'users': 0, 'likes': 0, 'dislikes': 0, 'invalid_ids': 0,
              'conflicts_removed': 0, 'duplicates_removed': 0}
    for user in snapshot.get('users', []):
        code = user.get('user_code', '')
        if not isinstance(code, str) or not re.fullmatch(r'u_[a-f0-9]{64}', code):
            raise ValueError('Snapshot must contain HMAC user codes, not login IDs')
        if code in seen_users:
            raise ValueError('Duplicate user in snapshot')
        seen_users.add(code)
        values = []
        for key in ['likedIds', 'dislikedIds']:
            ids = user.get(key, [])
            if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
                raise ValueError('Preference IDs must be string lists')
            counts['duplicates_removed'] += len(ids)-len(set(ids))
            counts['invalid_ids'] += len(set(ids)-lookup.keys())
            values.append(set(ids) & lookup.keys())
        positive, negative = values
        conflict = positive & negative
        counts['conflicts_removed'] += len(conflict)
        positive -= conflict
        negative -= conflict
        if positive or negative:
            counts['users'] += 1
        for label, ids in [(1, positive), (0, negative)]:
            counts['likes' if label else 'dislikes'] += len(ids)
            for drink_id in sorted(ids):
                d = lookup[drink_id]
                # All same-name variants for the same user share a holdout group.
                group = code + '\0' + d['brand'] + '\0' + ''.join(d['name'].split())
                rows.append({'user_code': code, 'drink': d, 'label': label, 'group': group})
    counts['rows'] = len(rows)
    splits = {'train': [], 'validation': [], 'test': []}
    # Small real datasets still train, but do not claim held-out quality.
    if len(rows) < 30 or min(counts['likes'], counts['dislikes']) < 3:
        splits['train'] = list(range(len(rows)))
        method = 'small snapshot: all real labels train; no held-out evaluation'
    else:
        for i, row in enumerate(rows):
            bucket = int(hashlib.sha256((str(seed)+row['group']).encode()).hexdigest()[:8], 16) % 100
            splits['train' if bucket < 80 else 'validation' if bucket < 90 else 'test'].append(i)
        if any(len(v) < 2 for v in splits.values()):
            splits = {'train': list(range(len(rows))), 'validation': [], 'test': []}
            method = 'holdout too small: all real labels train; no held-out evaluation'
        else:
            method = 'seeded user/brand/name group holdout 80/10/10; NOT chronological'
    return rows, splits, counts, method

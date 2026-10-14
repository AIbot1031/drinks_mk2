"""Normalize absent optional numeric caps; preserve all actual constraints."""

def normalize_optional_caps(result):
    filters=result.get('filters')
    if not isinstance(filters,dict):return result
    # The site represents an absent cap by an omitted key. This does not remove
    # a state cap: the Worker merges into the verified state and requires an
    # explicit user release before that cap can disappear.
    return {**result,'filters':{k:v for k,v in filters.items()
        if not (k in {'maxPrice','maxCalories','maxCaffeine'} and v is None)}}

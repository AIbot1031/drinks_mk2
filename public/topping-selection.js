export function selectedToppings(filters = {}) {
  const values = [...(filters.topping ? [filters.topping] : []), ...(filters.toppings || [])];
  const same = (a, b) => a === b || (['珍珠', '波霸'].includes(a) && ['珍珠', '波霸'].includes(b));
  return values.filter((t, i) => !values.slice(0, i).some(other => same(t, other)) && !filters.excludedToppings?.some(other => same(t, other)));
}
export function manualToppings() {
  return [...document.querySelectorAll('#topping-filter input:checked')].map(input => input.value);
}

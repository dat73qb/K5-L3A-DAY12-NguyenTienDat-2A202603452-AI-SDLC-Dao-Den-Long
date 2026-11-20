export const actions = {
  forward: 'Tiến', back: 'Lùi', left: 'Sang trái', right: 'Sang phải', jump: 'Nhảy',
  dash: 'Lướt', interact: 'Nạp đèn', pulse: 'Tỏa sáng', pause: 'Tạm dừng'
};
export const defaultBindings = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyD'], right: ['KeyA'],
  jump: ['Space'], dash: ['ShiftLeft', 'ShiftRight'], interact: ['KeyE'], pulse: ['KeyQ'], pause: ['Escape', 'KeyP']
};
export const reservedKeys = new Set(['Tab', 'Enter']);
export const bindingLabel = code => code.replace(/^Key|^Digit/, '').replace(/^Shift(?:Left|Right)$/, 'Shift')
  .replace('Escape', 'Esc');

export function loadBindings(value) {
  const result = { ...defaultBindings };
  if (!value || typeof value !== 'object') return result;
  for (const action of Object.keys(actions)) {
    if (Array.isArray(value[action]) && value[action].length && value[action].every(code =>
      typeof code === 'string' && code && !reservedKeys.has(code))) result[action] = value[action];
  }
  const codes = Object.values(result).flat();
  return new Set(codes).size === codes.length ? result : { ...defaultBindings };
}

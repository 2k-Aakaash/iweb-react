// Control Center's calculator: a basic, immediate-execution calculator like macOS Calculator's
// Basic mode (2 + 3 × 4 = 20). Pure: calculate(state, action) returns the next state.
//
// Actions: { type: 'digit', digit } · { type: 'dot' } · { type: 'op', op: '+' | '−' | '×' | '÷' }
//          { type: 'equals' } · { type: 'clear' } · { type: 'sign' } · { type: 'percent' }
//          { type: 'backspace' }

export const MAX_DIGITS = 12;

export const initialCalc = Object.freeze({
  display: '0', // what the screen shows
  acc: null, // the left operand, waiting for `op`
  op: null,
  fresh: true, // the next digit starts a new number
  repeat: null, // { op, arg }: pressing = again repeats the last operation
});

const OPS = {
  '+': (a, b) => a + b,
  '−': (a, b) => a - b,
  '×': (a, b) => a * b,
  '÷': (a, b) => (b === 0 ? NaN : a / b),
};

/** A result as the screen shows it: 12 significant digits, exponent form when long. */
export function formatNumber(n) {
  if (!Number.isFinite(n)) return 'Error';
  const rounded = Number(n.toPrecision(MAX_DIGITS));
  const text = String(rounded);
  const digits = text.replace('-', '').replace('.', '').replace(/^0+/, ''); // leading zeros don't count
  return digits.length > MAX_DIGITS || /e/.test(text)
    ? rounded.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', 'e')
    : text;
}

const valueOf = (state) => Number(state.display);

/** The clear key's label: C clears the entry, AC everything. */
export const clearLabel = (state) => (!state.fresh && state.display !== '0' ? 'C' : 'AC');

export function calculate(state, action) {
  const s = state.display === 'Error' && action.type !== 'clear' ? initialCalc : state;
  switch (action.type) {
    case 'digit': {
      const d = String(action.digit);
      if (s.fresh) return { ...s, display: d, fresh: false };
      if (s.display === '0') return { ...s, display: d };
      if (s.display.replace(/[-.]/g, '').length >= MAX_DIGITS) return s;
      return { ...s, display: s.display + d };
    }
    case 'dot':
      if (s.fresh) return { ...s, display: '0.', fresh: false };
      return s.display.includes('.') ? s : { ...s, display: `${s.display}.` };
    case 'op': {
      if (!OPS[action.op]) return s;
      // A second operator in a row only replaces the first.
      if (s.op && s.fresh) return { ...s, op: action.op };
      const acc = s.op ? OPS[s.op](s.acc, valueOf(s)) : valueOf(s);
      return { ...s, display: formatNumber(acc), acc, op: action.op, fresh: true, repeat: null };
    }
    case 'equals': {
      if (s.op) {
        const arg = valueOf(s);
        const result = OPS[s.op](s.acc, arg);
        return { ...initialCalc, display: formatNumber(result), repeat: { op: s.op, arg } };
      }
      if (s.repeat) {
        return { ...s, display: formatNumber(OPS[s.repeat.op](valueOf(s), s.repeat.arg)), fresh: true };
      }
      return { ...s, fresh: true };
    }
    case 'clear':
      return clearLabel(s) === 'C' ? { ...s, display: '0', fresh: true } : initialCalc;
    case 'sign':
      if (s.display === '0') return s;
      return { ...s, display: s.display.startsWith('-') ? s.display.slice(1) : `-${s.display}` };
    case 'percent':
      return { ...s, display: formatNumber(valueOf(s) / 100), fresh: true };
    case 'backspace': {
      if (s.fresh) return s;
      const next = s.display.slice(0, -1);
      return { ...s, display: next === '' || next === '-' ? '0' : next };
    }
    default:
      return s;
  }
}

/** The action for a key on the keyboard, or null. */
export function actionForKey(key) {
  if (/^[0-9]$/.test(key)) return { type: 'digit', digit: key };
  const map = {
    '.': { type: 'dot' }, ',': { type: 'dot' },
    '+': { type: 'op', op: '+' }, '-': { type: 'op', op: '−' },
    '*': { type: 'op', op: '×' }, x: { type: 'op', op: '×' }, '/': { type: 'op', op: '÷' },
    Enter: { type: 'equals' }, '=': { type: 'equals' },
    Delete: { type: 'clear' }, c: { type: 'clear' }, // (Escape goes back in Control Center)
    Backspace: { type: 'backspace' }, '%': { type: 'percent' },
  };
  return map[key] || null;
}

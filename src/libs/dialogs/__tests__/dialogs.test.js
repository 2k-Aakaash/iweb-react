import { beforeEach, describe, expect, it } from 'vitest';
import { _resetDialogs, answer, showAlert, showConfirm } from '../dialogs';

beforeEach(() => _resetDialogs());

describe('macOS alerts', () => {
  it('resolves a confirm with the button pressed', async () => {
    const yes = showConfirm({ title: 'Delete?' });
    answer(true);
    expect(await yes).toBe(true);
    const no = showConfirm({ title: 'Delete?' });
    answer(false);
    expect(await no).toBe(false);
  });

  it('shows them one at a time, in order', async () => {
    const order = [];
    const first = showAlert({ title: 'One' }).then(() => order.push('one'));
    const second = showConfirm({ title: 'Two' }).then((v) => order.push(`two:${v}`));
    answer(true); // the front one: "One"
    await first;
    answer(false); // then "Two"
    await second;
    expect(order).toEqual(['one', 'two:false']);
  });

  it('ignores an answer with nothing showing', () => {
    expect(() => answer(true)).not.toThrow();
  });
});

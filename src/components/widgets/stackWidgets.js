// The widgets a Smart Stack can hold. Each can also sit on the desktop on its own (App.jsx,
// Edit Widgets); the layout keeps every one in exactly one place (src/libs/desktop/layout.js).
import Weather from '../Weather';
import CurrencyWidget from './CurrencyWidget';
import GoldWidget from './GoldWidget';
import MarketsWidget from './MarketsWidget';

export const STACK_WIDGETS = Object.freeze({
  weather: { id: 'weather', label: 'Weather', Component: Weather },
  currency: { id: 'currency', label: 'Currency Converter', Component: CurrencyWidget },
  metals: { id: 'metals', label: 'Gold & Silver', Component: GoldWidget },
  markets: { id: 'markets', label: 'Markets', Component: MarketsWidget },
});

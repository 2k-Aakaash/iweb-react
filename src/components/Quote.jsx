import { useState, useEffect } from 'react';
import { getMotivationalPhrase } from '../libs/quote';

// The motivational line and your name under the clock. A desktop item of its own, so it can
// be moved or removed (Edit Widgets) like the search bar.
export default function Quote({ customName }) {
  const [quote, setQuote] = useState(getMotivationalPhrase);

  useEffect(() => {
    const timer = setInterval(() => {
      // A new phrase at midnight.
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() === 0) {
        setQuote(getMotivationalPhrase());
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <p className="name-intro type-animation animating">
      <span id="quote">{quote}</span>
      <span id="custom-name">{customName || ''}</span>!
    </p>
  );
}

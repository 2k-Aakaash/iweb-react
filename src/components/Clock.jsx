import React, { useState, useEffect } from 'react';
import { getMotivationalPhrase } from '../libs/quote';

export default function Clock({ customName, clockFont }) {
  const [time, setTime] = useState(formatTime(new Date()));
  const [quote, setQuote] = useState('');

  function formatTime(date) {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    let period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    minutes = minutes < 10 ? `0${minutes}` : minutes;
    return `${hours}:${minutes} ${period}`;
  }

  useEffect(() => {
    // Set initial quote
    setQuote(getMotivationalPhrase());

    const timer = setInterval(() => {
      setTime(formatTime(new Date()));
      // Check if it's 12:00 AM to update quote
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() === 0) {
        setQuote(getMotivationalPhrase());
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="center">
      <span 
        id="clock" 
        className="clock-time"
        style={{ fontFamily: clockFont || 'inherit' }}
      >
        {time}
      </span>
      <p className="name-intro type-animation animating">
        <span id="quote">{quote}</span>
        <span id="custom-name">{customName || ''}</span>!
      </p>
    </div>
  );
}

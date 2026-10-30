// Still previews of the desktop items for the widget gallery (Settings → Widgets), drawn at
// full size (the gallery scales them down; the drag ghost doesn't). Sample content only: nothing is fetched here.

function Spark({ up = true }) {
  return (
    <svg className="wgp-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path
        d={up ? 'M0 24 L12 20 L22 22 L34 15 L46 17 L58 10 L70 12 L82 6 L100 4' : 'M0 6 L14 8 L26 7 L38 14 L50 12 L62 18 L76 17 L88 23 L100 25'}
        fill="none"
        stroke={up ? '#34c759' : '#ff453a'}
        strokeWidth="2.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Weather({ size }) {
  return (
    <div className="wgp wgp-weather">
      <div className="wgp-row">
        <div>
          <div className="wgp-place">My Location</div>
          <div className="wgp-temp">24°</div>
        </div>
        {size !== 'small' && <div className="wgp-sun" aria-hidden="true" />}
      </div>
      <div className="wgp-foot">
        <span>Partly Cloudy</span>
        <span>H:29° L:21°</span>
      </div>
      {size !== 'small' && (
        <div className="wgp-forecast">
          {['Now', '1PM', '2PM', '3PM', '4PM'].map((t, i) => (
            <span key={t}><b>{t}</b><i>{25 + (i % 3)}°</i></span>
          ))}
        </div>
      )}
    </div>
  );
}

function Currency({ size }) {
  return (
    <div className="wgp wgp-dark">
      <div className="wgp-label">Currency</div>
      <div className="wgp-big">₹83.12</div>
      <div className="wgp-muted">1 USD = 83.12 INR</div>
      {size !== 'small' && <Spark up />}
    </div>
  );
}

function Metals({ size }) {
  return (
    <div className="wgp wgp-gold">
      <div className="wgp-label">Gold 24K</div>
      <div className="wgp-big">₹7,250<small>/g</small></div>
      <div className="wgp-muted">▲ 0.6% today</div>
      {size !== 'small' && <div className="wgp-muted">Silver ₹92.40/g</div>}
    </div>
  );
}

function Markets({ size }) {
  const rows = size === 'small' ? [['NIFTY 50', '+0.4%', true]] : [['NIFTY 50', '+0.4%', true], ['SENSEX', '−0.2%', false]];
  return (
    <div className="wgp wgp-dark">
      <div className="wgp-label">Markets</div>
      {rows.map(([name, change, up]) => (
        <div key={name} className="wgp-quote">
          <span>{name}</span>
          <span className={up ? 'is-up' : 'is-down'}>{change}</span>
        </div>
      ))}
      <Spark up />
    </div>
  );
}

function News({ size }) {
  const count = size === 'small' ? 1 : size === 'medium' ? 2 : 5;
  return (
    <div className="wgp wgp-news">
      <div className="wgp-news-brand">News</div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="wgp-headline">
          <span className="wgp-source">Publisher</span>
          <span className="wgp-line" />
          <span className="wgp-line wgp-line-short" />
        </div>
      ))}
    </div>
  );
}

function Stack({ size }) {
  return (
    <div className="wgp-stack">
      <span className="wgp-stack-layer" aria-hidden="true" />
      <Weather size={size} />
      <span className="wgp-stack-dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}

function Clock() {
  return (
    <div className="wgp-clock">
      <div className="wgp-clock-time">10:41</div>
    </div>
  );
}

function Quote() {
  return <div className="wgp-quote">Stay curious, friend!</div>;
}

function Search() {
  return (
    <div className="wgp-search">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <span>Search</span>
    </div>
  );
}

const PREVIEWS = { weather: Weather, currency: Currency, metals: Metals, markets: Markets, news: News, stack: Stack, clock: Clock, quote: Quote, search: Search };

export default function WidgetPreview({ id, size }) {
  const Preview = PREVIEWS[id];
  return Preview ? <Preview size={size} /> : null;
}

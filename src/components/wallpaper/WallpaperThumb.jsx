import { useEffect, useRef, useState } from 'react';

// Renders a thumbnail from a Blob (object URL created in an effect and revoked on
// change/unmount) or, when there is no Blob, from a plain URL.
export default function WallpaperThumb({ blob, url, color }) {
  const imgRef = useRef(null);
  const [failedSrc, setFailedSrc] = useState(null);
  const source = blob || url || null;

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !blob) return undefined;
    const objectUrl = URL.createObjectURL(blob);
    img.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  const style = color ? { backgroundColor: color } : undefined;

  if (!source || failedSrc === source) {
    return <span className="wp-card-placeholder" style={style} aria-hidden="true">🖼️</span>;
  }

  return (
    <img
      ref={imgRef}
      className="wp-card-img"
      src={blob ? undefined : url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      style={style}
      onError={() => setFailedSrc(source)}
    />
  );
}

// Unsplash attribution: "Photo by <Name> on <Unsplash>", using the stored utm URLs.
export default function Attribution({ photographer, photoPageUrl }) {
  if (!photographer || !photographer.name) return null;
  return (
    <p className="wp-attribution">
      Photo by{' '}
      {photographer.profileUrl ? (
        <a href={photographer.profileUrl} target="_blank" rel="noopener noreferrer">
          {photographer.name}
        </a>
      ) : (
        <span>{photographer.name}</span>
      )}{' '}
      on{' '}
      {photoPageUrl ? (
        <a href={photoPageUrl} target="_blank" rel="noopener noreferrer">Unsplash</a>
      ) : (
        <span>Unsplash</span>
      )}
    </p>
  );
}

// Control Center's Screenshot: captures this tab and saves it as a PNG. A page can only
// capture with the browser's screen-sharing picker, which asks the user each time (Chrome
// offers "this tab" first thanks to preferCurrentTab).

const fileName = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `iWeb Screenshot ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} at ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}.png`;
};

/** Resolves true once saved, false when the user cancelled or capture isn't available. */
export async function captureScreenshot() {
  if (!navigator.mediaDevices?.getDisplayMedia) return false;
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
    });
  } catch {
    return false; // cancelled
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // Let the picker's dialog leave the screen before taking the frame.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName(new Date());
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

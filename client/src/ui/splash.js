// The loading screen shown while the model loads. Its markup and styles live in index.html so it appears at once, before
// this script has even been downloaded; this module only fills the progress bar and fades the screen out.
export function createSplash() {
  const el = document.getElementById('splash');
  if (!el) return { progress() {}, done() {} };
  const bar = el.querySelector('.splash__bar');
  const fill = el.querySelector('.splash__fill');

  const remove = () => el.remove();
  return {
    // fraction 0..1, or null when the server doesn't tell the file size (the bar keeps sliding)
    progress(fraction) {
      if (fraction === null) return;
      bar.classList.remove('splash__bar--indeterminate');
      fill.style.width = `${Math.round(fraction * 100)}%`;
    },
    // waits two frames so the first render of the model is on screen before the cover goes
    done() {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.classList.add('splash--done');
          el.addEventListener('transitionend', remove, { once: true });
          setTimeout(remove, 800); // in case the transition never fires (reduced motion, background tab)
        }),
      );
    },
  };
}

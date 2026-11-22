// Static pages share only navigation layout behavior; artist selection is fixed.
function positionArtists() {
  if (document.body.classList.contains("page-index")) return;
  const strip = document.querySelector(".body-artists .artist-strip");
  if (!strip) return;
  const selected = strip.querySelector('[aria-pressed="true"]');
  strip.scrollLeft = selected.offsetLeft - strip.offsetLeft - 12;
}
requestAnimationFrame(positionArtists);
window.addEventListener("resize", positionArtists);

// The floating recording controller. It owns no state: the main window tells it the elapsed time
// and whether the take is paused, and every button just posts an action back.
(function () {
  const bar = document.getElementById("bar");
  const time = document.getElementById("time");
  const pause = document.getElementById("pause");
  const mark = document.getElementById("mark");

  document.getElementById("stop").addEventListener("click", () => window.recbar.act("stop"));
  pause.addEventListener("click", () => window.recbar.act("pause"));
  mark.addEventListener("click", () => {
    window.recbar.act("zoom");
    mark.textContent = "Marked";
    setTimeout(() => { mark.textContent = "Zoom"; }, 1100);
  });

  window.recbar.onState((s) => {
    const counting = s.remainingSec != null;
    const sec = Math.max(0, Math.floor(counting ? s.remainingSec : (s.elapsedMs || 0) / 1000));
    time.textContent = (counting ? "−" : "") + `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    bar.classList.toggle("paused", !!s.paused);
    pause.textContent = s.paused ? "Resume" : "Pause";
  });
})();

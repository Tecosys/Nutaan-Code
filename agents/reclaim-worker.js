// The scan and the delete both walk the filesystem synchronously — tens of thousands of stat calls
// on a full disk. Run that on Electron's main thread and the whole window stops painting, which is
// exactly what "Not Responding" in the title bar means. So it runs here instead, on its own thread,
// and the main process only ever receives progress messages and a finished result.
const { parentPort, workerData } = require("node:worker_threads");
const { runScan, runApply } = require("./reclaim-core");

(async () => {
  const post = (msg) => { try { parentPort.postMessage(msg); } catch {} };
  const onProgress = (p) => post({ type: "progress", payload: p });
  try {
    const { op, args } = workerData || {};
    const result = op === "apply"
      ? await runApply(args.items, onProgress)
      : await runScan({ ...args, onProgress });
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", error: err && err.message ? err.message : String(err) });
  }
})();

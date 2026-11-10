// The on-phone object detector: Google's MediaPipe Object Detector with the
// EfficientDet-Lite0 model (Apache-2.0), running in the browser on the CPU.
//
// Loaded only when first used: the runtime is 13.5 MB and the model 7.3 MB,
// fetched by the phone the first time Detect is pressed.
//
// The runtime files come from the CDN copy of the exact npm version
// installed; package.json pins that version so the two cannot drift.
// CPU rather than GPU: the AR session already owns the phone's WebGL, and a
// second GPU context is an unmeasured risk. Speed on the phone is one of the
// things the first run is meant to measure.

const VERSION = '1.1.1';
export const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

// Starting values, not tuned: low enough to see what it finds on a first run.
const SCORE_THRESHOLD = 0.3;
const MAX_RESULTS = 10;

let loading = null;

export function loadDetector() {
  if (!loading) {
    loading = (async () => {
      const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks(WASM_URL);
      return ObjectDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        scoreThreshold: SCORE_THRESHOLD,
        maxResults: MAX_RESULTS,
      });
    })();
    // a failed load (no network, say) must not stick: the next press retries
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/**
 * @param image ImageData of the camera frame
 * @returns {Promise<{ms: number, loadMs: number, items: {label, score, box: {x, y, w, h}}[]}>}
 */
export async function detectObjects(image) {
  const t0 = performance.now();
  const detector = await loadDetector();
  const t1 = performance.now();
  const result = detector.detect(image);
  const t2 = performance.now();
  return {
    loadMs: t1 - t0,
    ms: t2 - t1,
    items: (result.detections ?? []).map((d) => ({
      label: d.categories?.[0]?.categoryName ?? 'unknown',
      score: d.categories?.[0]?.score ?? 0,
      box: {
        x: d.boundingBox?.originX ?? 0,
        y: d.boundingBox?.originY ?? 0,
        w: d.boundingBox?.width ?? 0,
        h: d.boundingBox?.height ?? 0,
      },
    })),
  };
}

// Which WebXR features this phone actually grants.
//
// Asking the browser is the only reliable answer: support differs by phone
// model and Chrome version, and a sample page that "seems to work" does not
// say which optional features were switched on behind it.

export const REQUIRED = ['hit-test'];
export const OPTIONAL = [
  'dom-overlay', 'anchors', 'camera-access', 'depth-sensing',
  'plane-detection', 'light-estimation',
];

// what losing each feature costs this project
const IF_MISSING = {
  'hit-test': 'No-go for the web route. The scan cannot work without it.',
  'dom-overlay': 'Buttons must be drawn inside the 3D scene. Workable, but worse.',
  'anchors': 'Markers may drift slightly on long scans. Not needed for the MVP.',
  'camera-access': 'No camera frames in AR, so door and window auto-detection needs another route. Manual taps still work.',
  'depth-sensing': 'No hiding furniture behind real objects. Not needed for the MVP.',
  'plane-detection': 'No effect: the scan uses hit-test, not detected planes.',
  'light-estimation': 'Furniture lighting will not match the room. Cosmetic only.',
};

/** Checks that need no camera permission and no user gesture. */
export async function basicSupport() {
  const secure = window.isSecureContext === true;
  const hasXr = 'xr' in navigator && !!navigator.xr;
  let arSupported = false;
  let error = null;
  if (hasXr) {
    try {
      arSupported = await navigator.xr.isSessionSupported('immersive-ar');
    } catch (e) {
      error = String(e?.message ?? e);
    }
  }
  return { secure, hasXr, arSupported, error };
}

/**
 * Opens an AR session asking for everything, reads back what was granted, and
 * closes it again. Must be called from a click handler.
 * @returns {Promise<{enabled: string[] | null, error: string | null}>}
 *   enabled is null when the browser does not report the list at all.
 */
export async function probeFeatures(overlayRoot) {
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: REQUIRED,
      optionalFeatures: OPTIONAL,
      domOverlay: { root: overlayRoot },
      depthSensing: {
        usagePreference: ['cpu-optimized', 'gpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
      },
    });
  } catch (e) {
    return { enabled: [], error: String(e?.message ?? e) };
  }
  const enabled = session.enabledFeatures ? Array.from(session.enabledFeatures) : null;
  try {
    await session.end();
  } catch {
    // already ended
  }
  return { enabled, error: null };
}

/** Rows for the report table. `enabled` is the list from probeFeatures. */
export function featureRows(enabled) {
  return [...REQUIRED, ...OPTIONAL].map((name) => {
    const granted = enabled === null ? null : enabled.includes(name);
    return {
      name,
      required: REQUIRED.includes(name),
      granted,
      note: granted === false ? IF_MISSING[name] : '',
    };
  });
}

export function verdict(enabled) {
  if (enabled === null) return 'Browser did not report its feature list. Judge by whether the measure page works.';
  if (!enabled.includes('hit-test')) return 'NO-GO: hit-test was not granted.';
  const missing = OPTIONAL.filter((f) => !enabled.includes(f));
  return missing.length === 0
    ? 'GO: every feature was granted.'
    : `GO: hit-test granted. Not granted: ${missing.join(', ')}.`;
}

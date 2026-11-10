// What the on-phone detector's labels can mean in the app's catalog.
//
// The detector (EfficientDet-Lite0, trained on COCO) knows about 90 everyday
// object classes, of which a handful are furniture. Each maps to the catalog
// types it could be; the first is the default suggestion and the rest are
// offered as alternatives. Labels not listed (person, laptop, book, bottle,
// ...) are not furniture and are ignored.
//
// This covers only a small part of the 86 catalog types. The rest come from
// the user picking a type, and later from Gemini at review time.

export const COCO_TO_CATALOG = {
  bed: ['bed', 'singleBed', 'kidsBed', 'cot', 'bunkBed'],
  couch: ['sofa', 'loveseat', 'sectional'],
  chair: ['armchair', 'diningChair', 'studyChair', 'accentChair', 'recliner'],
  'dining table': ['diningTable', 'roundTable', 'coffeeTable', 'desk', 'sideTable'],
  tv: ['tv', 'tvUnit'],
  refrigerator: ['fridge'],
  toilet: ['toilet'],
  sink: ['basin', 'kitchenSink'],
  oven: ['stove'],
  'potted plant': ['plant', 'planter'],
  bench: ['bench'],
  clock: ['clock'],
};

/** Catalog types a detector label could be, best guess first; [] if not furniture. */
export function catalogTypesFor(label) {
  return COCO_TO_CATALOG[String(label).toLowerCase()] ?? [];
}

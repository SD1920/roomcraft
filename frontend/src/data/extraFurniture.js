// src/data/extraFurniture.js
// Extra furniture types (pure data, no imports). roomPresets.js merges these into
// furnitureDefinitions / FURNITURE_CATEGORIES; 3D models live in FurnitureModel.jsx
// and 2D symbols in FloorPlan2D.jsx.
//
// Sizes are in feet. Wall-mounted pieces hang on a wall and slide along it;
// `elevation` is the height of their bottom edge above the floor.

const def = (name, width, depth, height, extra = {}) => ({ name, width, depth, height, ...extra })
const wall = (name, width, depth, height, elevation) =>
  def(name, width, depth, height, { wallMounted: true, elevation })

// Primary category of each type (items copy this onto themselves, like roomPresets does)
const CATEGORY_OF = {
  Bedroom:  ['dresser', 'dressingTable', 'bench', 'singleBed', 'cot'],
  Living:   ['recliner', 'pouf', 'consoleTable', 'sideboard', 'displayUnit', 'sectional', 'shoeRack', 'shelfUnit', 'acUnit', 'windowAc', 'roundCoffeeTable', 'roundSideTable'],
  Dining:   ['crockeryUnit', 'barStool', 'roundTable'],
  Classroom:['collegeBench', 'collegeBench2', 'teacherDesk', 'podium', 'classBoard', 'noticeBoard'],
  Lab:      ['pcRow', 'pcDesk', 'labChair'],
  Kitchen:  ['stove', 'kitchenSink', 'dishwasher', 'pantry', 'trashBin'],
  Bathroom: ['vanity', 'towelRack', 'bathroomShelf'],
  Study:    ['filingCabinet', 'whiteboard'],
  Kids:     ['kidsBed', 'bunkBed', 'toyBox', 'playTable', 'beanBag'],
  Entrance: ['coatRack'],
  Balcony:  ['outdoorChair', 'outdoorTable', 'planter', 'clothesRack'],
  Utility:  ['dryer'],
  Pooja:    ['poojaUnit'],
  Gym:      ['treadmill', 'weightBench', 'exerciseBike'],
  Decor:    ['plant', 'floorLamp', 'wallShelf', 'clock'],
}

const RAW_FURNITURE = {
  // ── Bedroom ──
  dresser:       def('Dresser',            4,   1.7, 3.2),
  dressingTable: def('Dressing Table',     3.5, 1.6, 5),
  bench:         def('Bench / Ottoman',    4,   1.4, 1.5),
  singleBed:     def('Single Bed',         3.4, 6.4, 3.6),
  cot:           def('Baby Cot',           2.2, 4,   3),

  // ── Living ──
  recliner:      def('Recliner',           3,   3.4, 3.4),
  pouf:          def('Pouf',               1.5, 1.5, 1.2),
  consoleTable:  def('Console Table',      3.5, 1.1, 2.7),
  sideboard:     def('Sideboard',          5,   1.6, 2.8),
  displayUnit:   def('Display Unit',       3,   1.3, 6.2),
  sectional:     def('L-Shaped Sofa',      8.5, 5.5, 3.1),
  shoeRack:      def('Shoe Rack',          2.5, 1,   3.2),
  shelfUnit:     def('Storage Rack',       3,   1.2, 6),

  // ── Dining ──
  crockeryUnit:  def('Crockery Unit',      4,   1.5, 6.5),
  barStool:      def('Bar Stool',          1.2, 1.2, 2.4),

  // ── Kitchen ──
  stove:         def('Stove + Chimney',    2.5, 2.2, 7),
  kitchenSink:   def('Kitchen Sink',       3.5, 2,   3),
  dishwasher:    def('Dishwasher',         2,   2,   3),
  pantry:        def('Pantry Unit',        2.5, 2,   7),
  trashBin:      def('Trash Bin',          1.1, 1.1, 1.8),

  // ── Bathroom ──
  vanity:        def('Vanity Unit',        2.5, 1.8, 3),
  towelRack:     wall('Towel Rack',        2,   0.4, 2.4, 3.5),
  bathroomShelf: wall('Bathroom Cabinet',  2,   0.7, 2.2, 4.8),

  // ── Study ──
  filingCabinet: def('Filing Cabinet',     1.6, 2,   4),
  whiteboard:    wall('Whiteboard',        4,   0.12, 3, 3.5),

  // ── Kids ──
  kidsBed:       def('Kids Bed',           3,   5.5, 2.4),
  toyBox:        def('Toy Box',            2.4, 1.5, 1.5),
  playTable:     def('Play Table',         2.5, 2.5, 1.7),
  beanBag:       def('Bean Bag',           2.2, 2.2, 1.8),

  // ── Entrance ──
  coatRack:      wall('Coat Rack',         3,   0.5, 1.4, 5.3),

  // ── Balcony ──
  outdoorChair:  def('Outdoor Chair',      1.6, 1.6, 3),
  outdoorTable:  def('Outdoor Table',      2.2, 2.2, 2.4),
  planter:       def('Planter',            1.8, 1.8, 3),
  clothesRack:   def('Clothes Drying Rack', 3.2, 1.8, 3.8),

  // ── Utility ──
  dryer:         def('Dryer',              2.2, 2.2, 3),

  // ── Pooja ──
  poojaUnit:     def('Pooja Unit',         3,   1.5, 5.4),

  // ── Gym ──
  treadmill:     def('Treadmill',          2.8, 6,   4.5),
  weightBench:   def('Weight Bench',       2.2, 5.5, 4),
  exerciseBike:  def('Exercise Bike',      1.8, 4,   4),

  // ── Kids ──
  bunkBed:       def('Bunk Bed',           3.5, 6.6, 5.8),

  // ── Climate ──
  windowAc:      wall('Window AC',         2.2, 1.5, 1.3, 3.55),   // sits inside a window (see layout.js)

  // ── Round tables ──
  roundTable:       def('Round Dining Table', 4,   4,   2.5),
  roundCoffeeTable: def('Round Coffee Table', 2.6, 2.6, 1.4),
  roundSideTable:   def('Round Side Table',   1.6, 1.6, 1.9),

  // ── Computer lab ──
  pcRow:         def('PC Workstation Row (4 seats)', 10.4, 2.4, 3.8),
  pcDesk:        def('PC Workstation (1 seat)',      2.6,  2.4, 3.8),
  labChair:      def('Lab Chair',          1.5, 1.5, 3),

  // ── Classroom ──
  collegeBench:  def('College Bench (3 seats)', 6, 2.6, 2.9),
  collegeBench2: def('College Bench (2 seats)', 4, 2.6, 2.9),
  teacherDesk:   def("Professor's Desk",   5,   2.5, 2.6),
  podium:        def('Podium / Lectern',   1.8, 1.5, 3.8),
  classBoard:    wall('Classroom Board',   9,   0.15, 3.6, 3),
  noticeBoard:   wall('Notice Board',      4,   0.1, 3, 3.5),

  // ── Decor ──
  plant:         def('Indoor Plant',       1.4, 1.4, 4),
  floorLamp:     def('Floor Lamp',         1,   1,   5.5),
  wallShelf:     wall('Wall Shelf',        3,   0.8, 0.6, 4.8),
  clock:         wall('Wall Clock',        1.2, 0.15, 1.2, 6.2),
  acUnit:        wall('Air Conditioner',   3.2, 0.8, 1, 6.4),
}

export const EXTRA_CATEGORIES = {
  Bedroom:  ['dresser', 'dressingTable', 'bench', 'singleBed', 'cot', 'bunkBed', 'windowAc', 'roundSideTable'],
  Living:   ['recliner', 'sectional', 'pouf', 'consoleTable', 'sideboard', 'displayUnit', 'shoeRack', 'shelfUnit', 'bench', 'acUnit', 'windowAc', 'roundCoffeeTable', 'roundSideTable'],
  Study:    ['filingCabinet', 'whiteboard', 'shelfUnit', 'windowAc', 'noticeBoard'],
  Dining:   ['crockeryUnit', 'sideboard', 'barStool', 'bench', 'roundTable'],
  Kitchen:  ['stove', 'kitchenSink', 'dishwasher', 'pantry', 'trashBin', 'barStool'],
  Bathroom: ['vanity', 'towelRack', 'bathroomShelf', 'trashBin'],
  Decor:    ['plant', 'floorLamp', 'wallShelf', 'clock'],
  Kids:     ['kidsBed', 'bunkBed', 'cot', 'toyBox', 'playTable', 'beanBag', 'shelfUnit', 'windowAc'],
  Entrance: ['shoeRack', 'coatRack', 'consoleTable', 'bench'],
  Balcony:  ['outdoorChair', 'outdoorTable', 'planter', 'clothesRack'],
  Utility:  ['dryer', 'shelfUnit', 'trashBin'],
  Pooja:    ['poojaUnit', 'shelfUnit', 'bench'],
  Gym:      ['treadmill', 'weightBench', 'exerciseBike'],
  Classroom:['collegeBench', 'collegeBench2', 'teacherDesk', 'podium', 'classBoard', 'whiteboard', 'noticeBoard', 'windowAc', 'acUnit', 'labChair'],
  Lab:      ['pcRow', 'pcDesk', 'labChair', 'teacherDesk', 'whiteboard', 'noticeBoard', 'windowAc', 'acUnit', 'shelfUnit'],
}

/** Every definition with its primary `category` filled in (items copy this on creation) */
export const EXTRA_FURNITURE = Object.fromEntries(
  Object.entries(RAW_FURNITURE).map(([type, d]) => [
    type,
    { ...d, category: Object.keys(CATEGORY_OF).find((c) => CATEGORY_OF[c].includes(type)) || 'Decor' },
  ]),
)

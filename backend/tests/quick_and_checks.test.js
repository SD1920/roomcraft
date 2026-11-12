// Quick mode (no AI) and the server's action checks, against the app's real catalog.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quickIntent } from '../utils/quickIntent.js'
import { cleanActions } from '../controllers/assistantController.js'
import { furnitureDefinitions, stylePresets, floorPresets, ROOM_TYPES, wallPaints } from '../../frontend/src/data/roomPresets.js'

// the same shape as the frontend's assistantCatalog() after readCatalog()
const cat = {
  room_types: ROOM_TYPES.map((r) => ({ id: r.id, name: r.name })),
  styles: Object.entries(stylePresets).map(([id, s]) => ({ id, name: s.name, description: s.description })),
  floors: floorPresets.map((f) => ({ id: f.id, name: f.name })),
  paints: wallPaints.map((p) => ({ name: p.name, color: p.color })),
  furniture: Object.entries(furnitureDefinitions).map(([id, d]) => ({ id, name: d.name, category: d.category, wall_mounted: Boolean(d.wallMounted), sizes: [] })),
}
const room = {
  room_type: 'bedroom', width_ft: 12, length_ft: 14,
  connected_rooms: 0,
  openings: [
    { id: 'door-1', type: 'door', wall: 'front', position: 0, width: 3 },
    { id: 'door-2', type: 'door', wall: 'left', position: 2, width: 3, leads_to_connected_room: true },
    { id: 'window-1', type: 'window', wall: 'back', position: 0, width: 4 },
  ],
  furniture: [
    { id: 'bed-1', type: 'bed', name: 'Bed' },
    { id: 'bookshelf-1', type: 'bookshelf', name: 'Bookshelf' },
    { id: 'desk-1', type: 'desk', name: 'Study Desk' },
  ],
}
const q = (m) => cleanActions(quickIntent(m, cat, room), { cat, room })
const kinds = (m) => q(m).map((a) => a.kind)

// ── quick mode: each phrase -> the expected actions ──────────
const CASES = [
  ['paint the walls sage green', [{ kind: 'set_wall_color', wall: 'all', color: '#a8b5a2' }]],
  ['Paint all walls Dusty Blue', [{ kind: 'set_wall_color', wall: 'all', color: '#8fa6b8' }]],
  ['make the left wall blue', [{ kind: 'set_wall_color', wall: 'left' }]],
  ['paint the back wall terracotta', [{ kind: 'set_wall_color', wall: 'back', color: '#b96f5a' }]],
  ['white walls please, paint them', [{ kind: 'set_wall_color', wall: 'all' }]],
  ['colour the right wall charcoal', [{ kind: 'set_wall_color', wall: 'right', color: '#4b4b4b' }]],
  ['change the floor to marble', [{ kind: 'set_floor', floor_type: 'marble' }]],
  ['I want a carpet floor', [{ kind: 'set_floor', floor_type: 'carpet' }]],
  ['dark wood flooring', [{ kind: 'set_floor', floor_type: 'darkWood' }]],
  ['tiles on the floor', [{ kind: 'set_floor', floor_type: 'tile' }]],
  ['add two chairs', [{ kind: 'add_furniture', piece: { type: 'studyChair', count: 2 } }]],
  ['add a sofa', [{ kind: 'add_furniture', piece: { type: 'sofa', count: 1 } }]],
  ['put a tv on the back wall', [{ kind: 'add_furniture', piece: { type: 'tv', wall: 'back' } }]],
  ['add 3 dining chairs', [{ kind: 'add_furniture', piece: { type: 'diningChair', count: 3 } }]],
  ['I need a wardrobe', [{ kind: 'add_furniture', piece: { type: 'wardrobe' } }]],
  ['add a coffee table in the middle', [{ kind: 'add_furniture', piece: { type: 'coffeeTable', spot: 'center' } }]],
  ['add a floor lamp near the bookshelf', [{ kind: 'add_furniture', piece: { type: 'floorLamp', near: 'bookshelf' } }]],
  ['place a plant in the corner', [{ kind: 'add_furniture', piece: { type: 'plant', spot: 'corner' } }]],
  ['add a bunk bed', [{ kind: 'add_furniture', piece: { type: 'bunkBed' } }]],
  ['add an air conditioner', [{ kind: 'add_furniture', piece: { type: 'acUnit' } }]],
  ['add a couch and a coffee table', [{ kind: 'add_furniture', piece: { type: 'sofa' } }, { kind: 'add_furniture', piece: { type: 'coffeeTable' } }]],
  ['remove the bookshelf', [{ kind: 'remove_furniture', remove_id: 'bookshelf-1' }]],
  ['delete the desk', [{ kind: 'remove_furniture', remove_id: 'desk-1' }]],
  ['get rid of the bed', [{ kind: 'remove_furniture', remove_id: 'bed-1' }]],
  ['remove the sofa', []],   // not in the room
  ['add a window on the left wall', [{ kind: 'add_opening', opening_type: 'window', wall: 'left' }]],
  ['add a door', [{ kind: 'add_opening', opening_type: 'door', wall: 'any' }]],
  ['put a window on the right wall', [{ kind: 'add_opening', opening_type: 'window', wall: 'right' }]],
  ['remove the window', [{ kind: 'remove_opening', opening_id: 'window-1' }]],
  ['remove the door on the left wall', []],   // it leads to a connected room
  ['make the room bigger', [{ kind: 'resize_room', width_ft: 14, length_ft: 16 }]],
  ['make it 2 ft wider', [{ kind: 'resize_room', width_ft: 14, length_ft: 14 }]],
  ['make it 15 by 18', [{ kind: 'resize_room', width_ft: 15, length_ft: 18 }]],
  ['resize to 10x12', [{ kind: 'resize_room', width_ft: 10, length_ft: 12 }]],
  ['make the room smaller', [{ kind: 'resize_room', width_ft: 10, length_ft: 12 }]],
  ['3 feet longer', [{ kind: 'resize_room', width_ft: 12, length_ft: 17 }]],
  ['make it feel bigger', []],   // about colours and light, not the walls
  ['furnish it as a study', [{ kind: 'furnish_room', room_type: 'study' }]],
  ['make it a living room', [{ kind: 'furnish_room', room_type: 'living-room' }]],
  ['turn this into a home office, modern style', [{ kind: 'furnish_room', room_type: 'study', style: 'modern' }]],
  ['make a hostel room for 3 people', [{ kind: 'furnish_room', room_type: 'bedroom' }]],
  ['add a door and a window and make the room bigger', [{ kind: 'add_opening', opening_type: 'door' }, { kind: 'add_opening', opening_type: 'window' }, { kind: 'resize_room' }]],
  ['paint the walls beige and add a desk', [{ kind: 'set_wall_color', color: '#ead8c0' }, { kind: 'add_furniture', piece: { type: 'desk' } }]],
  ['hello, what do you think?', []],
]

for (const [message, expected] of CASES) {
  test(`quick mode: "${message}"`, () => {
    const got = q(message)
    assert.equal(got.length, expected.length, `got ${JSON.stringify(got)}`)
    expected.forEach((want, i) => {
      for (const [k, v] of Object.entries(want)) {
        if (v && typeof v === 'object') for (const [pk, pv] of Object.entries(v)) assert.equal(got[i][k][pk], pv, `${k}.${pk} in ${JSON.stringify(got[i])}`)
        else assert.equal(got[i][k], v, `${k} in ${JSON.stringify(got[i])}`)
      }
      assert.ok(got[i].label, 'has a label')
    })
  })
}

test('quick mode: a hostel room lists a bed, desk and chair per person', () => {
  const [a] = q('make a hostel room for 3 people')
  const by = Object.fromEntries(a.furniture.map((p) => [p.type, p.count]))
  assert.equal(by.singleBed, 3)
  assert.equal(by.desk, 3)
  assert.equal(by.studyChair, 3)
})

test('quick mode: says what it can do when it understands nothing', () => {
  const r = quickIntent('tell me a joke', cat, room)
  assert.equal(r.actions.length, 0)
  assert.match(r.reply, /quick mode/i)
})

test('quick mode: never more than 4 actions', () => {
  assert.ok(q('add a sofa, a desk, a bed, a lamp, a plant and a tv').length <= 4)
})

// ── the server's checks on any model's answer ────────────────
test('checks drop unknown kinds, unknown furniture, bad colours and ids not in the room', () => {
  const got = cleanActions({
    reply: 'x',
    actions: [
      { kind: 'teleport', label: 'x' },
      { kind: 'add_furniture', label: 'Add a hovercraft', piece: { type: 'hovercraft', count: 1, wall: 'any', spot: 'any' } },
      { kind: 'set_wall_color', label: 'Paint it', wall: 'all', color: 'not-a-colour' },
      { kind: 'remove_furniture', label: 'Remove', remove_id: 'sofa-99' },
      { kind: 'remove_opening', label: 'Remove', opening_id: 'window-99' },
      { kind: 'set_floor', label: 'Floor', floor_type: 'lava' },
    ],
  }, { cat, room })
  assert.deepEqual(got, [])
})

test('checks repair a paint given by name, and fill a missing label', () => {
  const [a, b] = cleanActions({ reply: '', actions: [
    { kind: 'set_wall_color', wall: 'left', color: 'Sage Green' },
    { kind: 'add_furniture', piece: { type: 'desk', count: 20, wall: 'nowhere', spot: 'x' } },
  ] }, { cat, room })
  assert.equal(a.color, '#a8b5a2')
  assert.ok(a.label)
  assert.equal(b.piece.count, 8)
  assert.equal(b.piece.wall, 'any')
  assert.equal(b.piece.spot, 'any')
})

test('checks: resize must be 6–60 ft and actually change something', () => {
  const r = (w, l) => cleanActions({ actions: [{ kind: 'resize_room', label: 'Resize', width_ft: w, length_ft: l }] }, { cat, room })
  assert.equal(r(12, 14).length, 0)          // the same size
  assert.equal(r(100, 14).length, 0)         // 100 is out of range, so width stays 12: no change
  assert.deepEqual(r(16, null)[0], { kind: 'resize_room', width_ft: 16, length_ft: 14, label: 'Resize' })
})

test('checks: a door leading to a connected room cannot be removed; openings are typed', () => {
  assert.equal(cleanActions({ actions: [{ kind: 'remove_opening', label: 'x', opening_id: 'door-2' }] }, { cat, room }).length, 0)
  assert.equal(cleanActions({ actions: [{ kind: 'add_opening', label: 'x', opening_type: 'skylight' }] }, { cat, room }).length, 0)
  const [o] = cleanActions({ actions: [{ kind: 'add_opening', label: 'x', opening_type: 'door', wall: 'up', spot: 'top' }] }, { cat, room })
  assert.deepEqual(o, { kind: 'add_opening', opening_type: 'door', wall: 'any', spot: 'center', label: 'x' })
})

test('checks: furnish with no list keeps the room type for the app to furnish', () => {
  const [a] = cleanActions({ actions: [{ kind: 'furnish_room', label: 'x', furniture: [], room_type: 'study', style: 'cozy' }] }, { cat, room })
  assert.deepEqual(a, { kind: 'furnish_room', furniture: [], style: 'cozy', room_type: 'study', label: 'x' })
  const [b] = cleanActions({ actions: [{ kind: 'furnish_room', label: 'x', room_type: 'spaceship' }] }, { cat, room })
  assert.equal(b.room_type, 'bedroom')      // falls back to the room's own type
})

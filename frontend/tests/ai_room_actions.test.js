// The assistant's new room actions, applied with the app's layout rules:
// a door or window in a free place, a resize that never drops or squeezes
// anything, and the room summary the assistant sees.

import { describe, it, expect } from 'vitest'
import { placeOpeningForAi, resizeRoomContents, summariseRoom, OPENING_SIZES } from '../src/utils/promptRoom.js'
import { getItemBox, getKeepOutBoxes, boxesOverlap, isInsideRoom, isOpeningBlocked, getWallLength } from '../src/utils/layout.js'

const room = { width: 12, length: 14 }
const door = { id: 'd1', type: 'door', wall: 'front', position: 0, ...OPENING_SIZES.door }
const bed = { id: 'bed', type: 'bed', name: 'Bed', width: 5, depth: 6.5, height: 2, x: 0, z: 3.2, rotation: 0 }
// in the front-left corner, flush with both walls (wall centre-line + 0.13 ft clearance)
const wardrobe = { id: 'wr', type: 'wardrobe', name: 'Wardrobe', width: 4, depth: 2, height: 7, x: -3.87, z: -5.87, rotation: 0 }

const swingClear = (o, furniture) =>
  !furniture.some((f) => getKeepOutBoxes([o], room, 0).some((k) => boxesOverlap(getItemBox(f, room), k, 0)))

describe('placeOpeningForAi', () => {
  it('puts a window on the asked wall, clear of other openings', () => {
    const r = placeOpeningForAi({ opening_type: 'window', wall: 'left', spot: 'center' }, { room, openings: [door], furniture: [] })
    expect(r.ok).toBe(true)
    expect(r.opening).toMatchObject({ type: 'window', wall: 'left', width: 4, height: 4, offset: 3.5 })
    expect(isOpeningBlocked(r.opening, { openings: [door], furniture: [], room })).toBe(false)
  })

  it('never puts a door where its swing hits furniture', () => {
    // a sofa across the middle of the back wall: the door must move along the wall
    const sofa = { id: 's', type: 'sofa', name: 'Sofa', width: 4, depth: 3, height: 3, x: 0, z: 5.3, rotation: 0 }
    const r = placeOpeningForAi({ opening_type: 'door', wall: 'back', spot: 'center' }, { room, openings: [door], furniture: [sofa] })
    expect(r.ok).toBe(true)
    expect(r.opening.wall).toBe('back')
    expect(swingClear(r.opening, [sofa])).toBe(true)
    expect(Math.abs(r.opening.position)).toBeGreaterThan(3)
  })

  it('refuses, with a message, when the asked wall has no free place', () => {
    const wide = { id: 'long', type: 'sideboard', name: 'Sideboard', width: 11.5, depth: 2, height: 3, x: 0, z: 5.8, rotation: 0 }
    const r = placeOpeningForAi({ opening_type: 'door', wall: 'back', spot: 'center' }, { room, openings: [door], furniture: [wide] })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/back wall/)
  })

  it('"any" wall tries the others', () => {
    const r = placeOpeningForAi({ opening_type: 'door', wall: 'any' }, { room, openings: [door], furniture: [bed, wardrobe] })
    expect(r.ok).toBe(true)
    expect(swingClear(r.opening, [bed, wardrobe])).toBe(true)
  })

  it('a window does not go behind a tall piece', () => {
    // the wardrobe stands at the start of the front wall: the window must move past it
    const r = placeOpeningForAi({ opening_type: 'window', wall: 'front', spot: 'start' }, { room, openings: [], furniture: [wardrobe] })
    expect(r.ok).toBe(true)
    expect(r.opening.position).toBeGreaterThan(0)
    const keep = getKeepOutBoxes([r.opening], room, wardrobe.height)
    expect(keep.some((k) => boxesOverlap(getItemBox(wardrobe, room), k, 0))).toBe(false)
  })

  it('spot "start" and "end" go to the two ends of the wall', () => {
    const s = placeOpeningForAi({ opening_type: 'window', wall: 'back', spot: 'start' }, { room, openings: [], furniture: [] })
    const e = placeOpeningForAi({ opening_type: 'window', wall: 'back', spot: 'end' }, { room, openings: [], furniture: [] })
    expect(s.opening.position).toBeLessThan(-2)
    expect(e.opening.position).toBeGreaterThan(2)
  })

  it('rejects anything but a door or window', () => {
    expect(placeOpeningForAi({ opening_type: 'skylight' }, { room, openings: [], furniture: [] }).ok).toBe(false)
  })
})

describe('resizeRoomContents', () => {
  const tv = { id: 'tv', type: 'tv', name: 'TV', wallMounted: true, wall: 'back', position: 0, width: 4, height: 2.5, elevation: 3.5 }

  it('bigger: pieces against a wall stay against it, everything inside, openings on their walls', () => {
    const r = resizeRoomContents({ width: 16, length: 18 }, { room, furniture: [bed, wardrobe, tv], openings: [door] })
    expect(r.ok).toBe(true)
    const big = { width: 16, length: 18 }
    for (const f of r.furniture.filter((x) => !x.wallMounted)) expect(isInsideRoom(f, big)).toBe(true)
    const wr = r.furniture.find((f) => f.id === 'wr')
    expect(wr.z).toBeCloseTo(-9 + 0.13 + 1, 2)      // still flush with the front wall
    expect(wr.x).toBeCloseTo(-8 + 0.13 + 2, 2)      // and the left wall
    expect(r.furniture.find((f) => f.id === 'tv').wall).toBe('back')
    expect(r.openings[0]).toMatchObject({ id: 'd1', wall: 'front' })
    expect(r.overlaps).toBe(0)
  })

  it('smaller: refuses, naming the piece, when something cannot fit', () => {
    const r = resizeRoomContents({ width: 6, length: 6 }, { room, furniture: [bed], openings: [door] })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Bed/)
  })

  it('counts pieces that would overlap after shrinking (the editor then refuses)', () => {
    const a = { ...bed, id: 'a', x: -3, z: 0, width: 3, depth: 3 }
    const b = { ...bed, id: 'b', x: 3, z: 0, width: 3, depth: 3 }
    const r = resizeRoomContents({ width: 6, length: 14 }, { room, furniture: [a, b], openings: [] })
    expect(r.ok).toBe(true)
    expect(r.overlaps).toBeGreaterThan(0)
  })

  it('refuses sizes outside 6–60 ft and a wall too short for its opening', () => {
    expect(resizeRoomContents({ width: 5, length: 14 }, { room, furniture: [], openings: [] }).ok).toBe(false)
    expect(resizeRoomContents({ width: 61, length: 14 }, { room, furniture: [], openings: [] }).ok).toBe(false)
    const wide = { ...door, width: 7 }
    expect(resizeRoomContents({ width: 6, length: 14 }, { room, furniture: [], openings: [wide] }).ok).toBe(false)
  })

  it('without the old size (connected rooms) pieces are only pulled inside, as before', () => {
    const r = resizeRoomContents({ width: 20, length: 20 }, { furniture: [wardrobe], openings: [] })
    expect(r.furniture[0]).toMatchObject({ x: wardrobe.x, z: wardrobe.z })
  })

  it('openings stay within their wall', () => {
    const o = { ...door, wall: 'left', position: 5 }
    const r = resizeRoomContents({ width: 12, length: 8 }, { room, furniture: [], openings: [o] })
    expect(Math.abs(r.openings[0].position) + o.width / 2).toBeLessThanOrEqual(getWallLength('left', { width: 12, length: 8 }) / 2 + 1e-6)
  })
})

describe('summariseRoom', () => {
  it('gives openings their ids and marks doors that lead to a connected room', () => {
    const s = summariseRoom({
      roomType: 'bedroom', width: 12, length: 14, height: 8, furniture: [bed], openings: [door, { ...door, id: 'd2', wall: 'left' }],
      linkedDoorIds: ['d2'], connectedRooms: 1,
    })
    expect(s.connected_rooms).toBe(1)
    expect(s.openings[0]).toMatchObject({ id: 'd1', type: 'door' })
    expect(s.openings[0].leads_to_connected_room).toBeUndefined()
    expect(s.openings[1].leads_to_connected_room).toBe(true)
  })
})

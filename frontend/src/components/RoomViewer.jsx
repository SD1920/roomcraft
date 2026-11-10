import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

import FurnitureModel from './furniture/FurnitureModel'
import FloorPlan2D from './FloorPlan2D'
import { openingBlockReason, otherRects, resolveRoomMove, sizeOf } from '../utils/roomLayout'
import { Floor, Wall, WindowObject, DoorObject } from './room/RoomElements'
import {
  wallPaints,
  aiWallPalettes,
  stylePresets,
  floorPresets,
  furnitureDefinitions,
} from '../data/roomPresets'
import {
  WALL_HALF,
  isHorizontalWall,
  isWallMounted,
  getItemPose,
  clampAlong,
  clampFloorPosition,
  itemsCollide,
  resolveFloorMove,
  resolveWallMove,
  resolveOpeningMove,
  findFreeWallPosition,
  findFreeOpeningPosition,
  clampOpeningPosition,
  getWallLength,
  getDoorAngle,
  isInsideRoom,
  isWallItemBlocked,
  isOpeningBlocked,
} from '../utils/layout'

// Dropdown <option>s need explicit colours, otherwise the browser draws the
// popup with a white background and the (light) page text colour.
const OPTION_CLASS = 'bg-surface text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'

// ─── Pointer → 3D helpers ────────────────────────────────────────────

const raycaster = new THREE.Raycaster()
const ndc       = new THREE.Vector2()
const FLOOR_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

function intersectPlane(clientX, clientY, camera, gl, plane) {
  const rect = gl.domElement.getBoundingClientRect()
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
  raycaster.setFromCamera(ndc, camera)
  const hit = new THREE.Vector3()
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null
}

/** Vertical plane on a wall (inset = distance in from the wall centre-line) */
function getWallPlane(wall, room, inset = WALL_HALF) {
  switch (wall) {
    case 'front': return new THREE.Plane(new THREE.Vector3(0, 0, 1),  room.length / 2 - inset)
    case 'left':  return new THREE.Plane(new THREE.Vector3(1, 0, 0),  room.width  / 2 - inset)
    case 'right': return new THREE.Plane(new THREE.Vector3(1, 0, 0), -(room.width / 2 - inset))
    default:      return new THREE.Plane(new THREE.Vector3(0, 0, 1), -(room.length / 2 - inset))
  }
}

const ORIGIN0 = { x: 0, z: 0 }
const EMPTY = {}

/** A function whose identity never changes but always calls the latest version (keeps memo()'d children from re-rendering) */
function useStable(fn) {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args) => ref.current(...args), [])
}
/** World hit point → coordinates inside a (possibly offset) room */
const localHit = (hit, origin) => (hit ? { x: hit.x - origin.x, y: hit.y, z: hit.z - origin.z } : null)
/** Move a wall plane along with an offset room */
const shiftPlane = (plane, origin) =>
  (origin.x || origin.z) ? plane.clone().translate(new THREE.Vector3(origin.x, 0, origin.z)) : plane

const alongAxis = (wall) => (isHorizontalWall(wall) ? 'x' : 'z')

/**
 * Start dragging. Listens on `window` so the drag keeps working when the cursor
 * leaves the object, and pauses OrbitControls so the room doesn't rotate.
 * Returns a function that cancels the drag.
 */
function beginDrag({ gl, setOrbit, onMove, onEnd }) {
  setOrbit(false)
  gl.domElement.style.cursor = 'grabbing'

  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', handleUp)
    window.removeEventListener('pointercancel', handleUp)
    gl.domElement.style.cursor = 'default'
    setOrbit(true)
  }
  function handleUp(ev) { stop(); onEnd?.(ev) }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', handleUp)
  window.addEventListener('pointercancel', handleUp)
  return stop
}

/** Make sure OrbitControls never sees the pointer-down of an object drag */
function claimPointer(e) {
  e.stopPropagation()
  e.nativeEvent?.stopImmediatePropagation?.()
}

// ─── Furniture Item ──────────────────────────────────────────────────
// Floor pieces slide anywhere on the floor. Wall-mounted pieces (paintings,
// TV, mirror) behave like windows: they stay on their wall and only slide along it.

function FurnitureItem({
  item, isSelected, onSelect, onUpdate,
  room, allFurniture, openings, tint, setOrbit,
  origin = ORIGIN0,   // where this room's centre sits in the world (connected rooms)
  roomUid = null,     // which room the item belongs to (null = main room)
}) {
  const groupRef   = useRef()
  const cancelRef  = useRef(null)
  const { camera, gl, invalidate } = useThree()

  useEffect(() => () => cancelRef.current?.(), [])

  const pose = getItemPose(item, room)
  const wallMounted = isWallMounted(item)

  const startFloorDrag = (e) => {
    const start = localHit(intersectPlane(e.clientX, e.clientY, camera, gl, FLOOR_PLANE), origin)
    // keep the spot you grabbed under the cursor instead of snapping the centre to it
    const grab = start ? { x: pose.x - start.x, z: pose.z - start.z } : { x: 0, z: 0 }
    const others = allFurniture.filter((o) => o.id !== item.id)
    let current = { x: pose.x, z: pose.z }
    let moved = false

    cancelRef.current = beginDrag({
      gl, setOrbit,
      onMove: (ev) => {
        const p = localHit(intersectPlane(ev.clientX, ev.clientY, camera, gl, FLOOR_PLANE), origin)
        if (!p) return
        current = resolveFloorMove(item, current, { x: p.x + grab.x, z: p.z + grab.z }, others, room)
        moved = true
        groupRef.current?.position.set(current.x, pose.y, current.z)
        invalidate()
      },
      onEnd: () => { if (moved) onUpdate({ ...item, x: current.x, z: current.z }, roomUid) },
    })
  }

  const startWallDrag = (e) => {
    const axis  = alongAxis(item.wall)
    const plane = shiftPlane(getWallPlane(item.wall, room), origin)
    const start = localHit(intersectPlane(e.clientX, e.clientY, camera, gl, plane), origin)
    const grab  = start ? pose[axis] - start[axis] : 0
    const ctx   = { openings, furniture: allFurniture, room }
    let current = clampAlong(item.wall, item.position, item.width, room)
    let moved = false

    cancelRef.current = beginDrag({
      gl, setOrbit,
      onMove: (ev) => {
        const p = localHit(intersectPlane(ev.clientX, ev.clientY, camera, gl, plane), origin)
        if (!p) return
        current = resolveWallMove(item, current, p[axis] + grab, ctx)
        moved = true
        const np = getItemPose({ ...item, position: current }, room)
        groupRef.current?.position.set(np.x, np.y, np.z)
        invalidate()
      },
      onEnd: () => { if (moved) onUpdate({ ...item, position: current }, roomUid) },
    })
  }

  const handlePointerDown = (e) => {
    claimPointer(e)
    onSelect(item.id, roomUid)
    cancelRef.current?.()
    if (wallMounted) startWallDrag(e)
    else startFloorDrag(e)
  }

  const w = Number(item.width)  || 1
  const h = Number(item.height) || 1
  const d = Number(item.depth)  || 1

  return (
    <group
      ref={groupRef}
      position={[pose.x, pose.y, pose.z]}
      rotation={[0, pose.rotation, 0]}
      onPointerDown={handlePointerDown}
    >
      {/* modelScale is set by "Edit dimensions": it stretches the model to the item's width / height / depth */}
      <group scale={Array.isArray(item.modelScale) ? item.modelScale : [1, 1, 1]}>
        <FurnitureModel type={item.type} tint={tint} />
      </group>
      {isSelected && (
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w + 0.12, h + 0.12, d + 0.12]} />
          <meshBasicMaterial color="#f4a261" wireframe />
        </mesh>
      )}
    </group>
  )
}

// ─── Opening Item (door / window) ────────────────────────────────────

function OpeningItem({
  opening, isSelected, onSelect, onUpdate,
  room, openings, furniture, setOrbit,
  origin = ORIGIN0,
  onBlocked,          // (message) => void — tells the user what stopped the drag
  roomUid = null,
}) {
  const cancelRef = useRef(null)
  const { camera, gl } = useThree()

  useEffect(() => () => cancelRef.current?.(), [])

  const handlePointerDown = (e) => {
    claimPointer(e)
    onSelect(opening.id, roomUid)
    cancelRef.current?.()

    const axis  = alongAxis(opening.wall)
    const plane = shiftPlane(getWallPlane(opening.wall, room, 0), origin) // openings sit on the wall centre-line
    const start = localHit(intersectPlane(e.clientX, e.clientY, camera, gl, plane), origin)
    const startPos = clampOpeningPosition(opening, room)
    const grab = start ? startPos - start[axis] : 0
    const ctx = { openings, furniture, room }
    let current = startPos
    let lastWhy = null
    // at most one state update per frame (pointer events can fire several times a frame)
    let raf = 0
    let pending = null
    const flush = () => { raf = 0; if (pending) { const u = pending; pending = null; onUpdate(u, roomUid) } }

    cancelRef.current = beginDrag({
      gl, setOrbit,
      onMove: (ev) => {
        const p = localHit(intersectPlane(ev.clientX, ev.clientY, camera, gl, plane), origin)
        if (!p) return
        const target = p[axis] + grab
        const next = resolveOpeningMove(opening, current, target, ctx)
        if (Math.abs(target - next) > 0.15) {
          const why = openingBlockReason({ ...opening, position: next + Math.sign(target - next) * 0.12 }, ctx)
          if (why !== lastWhy) { lastWhy = why; if (why) onBlocked?.(`Blocked by ${why}`) }
        } else lastWhy = null
        if (next === current) return
        current = next
        pending = { ...opening, position: current }
        if (!raf) raf = requestAnimationFrame(flush)
      },
      onEnd: () => { if (raf) cancelAnimationFrame(raf); flush() },
    })
  }

  const Component = opening.type === 'window' ? WindowObject : DoorObject

  return (
    <Component
      wall={opening.wall}
      width={opening.width}
      height={opening.height}
      position={opening.position}
      offset={opening.offset}
      selected={isSelected}
      roomWidth={room.width}
      roomLength={room.length}
      visible={opening.visible !== false}
      hinge={opening.hinge}
      swing={opening.swing}
      openAngle={getDoorAngle(opening)}
      onPointerDown={handlePointerDown}
    />
  )
}

const FurnitureItemM = memo(FurnitureItem)
const OpeningItemM    = memo(OpeningItem)

// ─── Connected room (an editable copy, rendered next to the main room) ─

const asList = (v) => (Array.isArray(v) ? v : [])

function ConnectedRoom3D({
  cr, active,
  selectedFurnitureId, selectedOpeningId, selectedWall, hiddenWalls,
  onSelectFurniture, onSelectOpening, onWallSelect, onSelectRoom,
  onFurnitureUpdate, onOpeningUpdate, onMoveRoom, resolveMove, setOrbit, onBlocked,
}) {
  const { uid, design, offset, links } = cr
  const room = useMemo(() => {
    const s = sizeOf(design)
    return { width: s.w, length: s.l, height: wallHeightOf(design) }
  }, [design.room_width, design.room_length, design.wall_height]) // eslint-disable-line react-hooks/exhaustive-deps
  const furniture  = asList(design.furniture)
  const openings   = asList(design.openings)
  const wallColors = design.wall_colors || {}
  const tint = stylePresets[design.style]?.furniture

  // The wall cut that lines up with the main room's door (only while the rooms touch)
  const wallOpenings = [...openings, ...(links || [])]

  const groupRef  = useRef()
  const cancelRef = useRef(null)
  const { camera, gl, invalidate } = useThree()
  useEffect(() => () => cancelRef.current?.(), [])

  // Drag the round pad on the floor to slide the whole room anywhere that doesn't overlap another room
  const startMove = (e) => {
    claimPointer(e)
    onSelectRoom?.(uid)
    cancelRef.current?.()
    const start = intersectPlane(e.clientX, e.clientY, camera, gl, FLOOR_PLANE)
    if (!start) return
    let cur = { x: offset.x, z: offset.z }
    let moved = false
    cancelRef.current = beginDrag({
      gl, setOrbit,
      onMove: (ev) => {
        const p = intersectPlane(ev.clientX, ev.clientY, camera, gl, FLOOR_PLANE)
        if (!p) return
        cur = resolveMove(uid, { x: offset.x + (p.x - start.x), z: offset.z + (p.z - start.z) }, cur)
        moved = true
        groupRef.current?.position.set(cur.x, 0, cur.z)
        invalidate()
      },
      onEnd: () => { if (moved) onMoveRoom?.(uid, cur) },
    })
  }

  return (
    <group ref={groupRef} position={[offset.x, 0, offset.z]}>
      <Floor width={room.width} length={room.length} floorType={design.floor_type || 'lightWood'} />

      {['front', 'back', 'left', 'right'].map((wall) => (
        <Wall
          key={wall}
          wall={wall}
          width={room.width}
          length={room.length}
          height={room.height}
          color={wallColors[wall] || '#f5f5f0'}
          openings={wallOpenings}
          onSelect={(w) => onWallSelect(w, uid)}
          visible={!hiddenWalls[wall]}
          selected={active && selectedWall === wall}
        />
      ))}

      {openings.map((o) => (
        <OpeningItemM
          key={o.id}
          opening={o}
          roomUid={uid}
          isSelected={active && selectedOpeningId === o.id}
          onSelect={onSelectOpening}
          onUpdate={onOpeningUpdate}
          room={room}
          openings={openings}
          furniture={furniture}
          setOrbit={setOrbit}
          onBlocked={onBlocked}
          origin={offset}
        />
      ))}

      {furniture.map((item) => (
        <FurnitureItemM
          key={item.id}
          item={item}
          roomUid={uid}
          isSelected={active && selectedFurnitureId === item.id}
          onSelect={onSelectFurniture}
          onUpdate={onFurnitureUpdate}
          room={room}
          allFurniture={furniture}
          openings={openings}
          tint={tint}
          setOrbit={setOrbit}
          origin={offset}
        />
      ))}

      {/* move pad */}
      <mesh
        position={[-room.width / 2 + 1.3, 0.08, -room.length / 2 + 1.3]}
        onPointerDown={startMove}
        onPointerOver={() => { gl.domElement.style.cursor = 'move' }}
        onPointerOut={() => { gl.domElement.style.cursor = 'default' }}
      >
        <cylinderGeometry args={[0.75, 0.75, 0.14, 28]} />
        <meshStandardMaterial color={active ? '#f4a261' : '#ffffff'} emissive="#f4a261" emissiveIntensity={active ? 0.5 : 0.15} />
      </mesh>
    </group>
  )
}

const ConnectedRoom3DM = memo(ConnectedRoom3D)

// ─── Scene ───────────────────────────────────────────────────────────

function Scene({
  room,
  furniture, openings,
  selectedFurnitureId, selectedOpeningId,
  onSelectFurniture, onSelectOpening,
  onFurnitureUpdate, onOpeningUpdate,
  hiddenWalls, floorType, wallColors, furnitureTint,
  onWallSelect, selectedWall,
  cameraLocked,
  connectedRooms = [], activeRoomUid = null, hiddenConnected = {},
  onConnectedFurnitureUpdate, onConnectedOpeningUpdate,
  onSelectRoom, onMoveRoom, resolveMove, mainLinks = [], onBlocked,
}) {
  const { invalidate, camera, size } = useThree()
  useEffect(() => { invalidate() })   // the canvas only redraws on demand: redraw after every change

  // When the view gets narrow (the AI chat opens beside it) step the camera back,
  // and forward again when it widens back. Only narrowness counts: a view wider
  // than about 4:3 is limited by its height, so widening further changes nothing.
  const need = (aspect) => Math.max(1, 1.3 / aspect)   // how far back the width needs the camera
  const prevAspect = useRef(size.width / Math.max(1, size.height))
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const factor = need(aspect) / need(prevAspect.current)
    prevAspect.current = aspect
    const ctl = controlsRef.current
    if (!ctl || Math.abs(factor - 1) < 0.05) return
    const offset = camera.position.clone().sub(ctl.target)
    offset.multiplyScalar(Math.min(2, Math.max(0.5, factor)))
    if (offset.length() > Math.max(55, extent.size * 2.4)) offset.setLength(Math.max(55, extent.size * 2.4))
    camera.position.copy(ctl.target).add(offset)
    ctl.update()
    invalidate()
  }, [size.width, size.height]) // eslint-disable-line react-hooks/exhaustive-deps

  // How big the whole layout is (main room + every connected room) — the camera limits follow it
  const extent = useMemo(() => {
    const rects = otherRects(room, connectedRooms, null)
    const x0 = Math.min(...rects.map((r) => r.x0))
    const x1 = Math.max(...rects.map((r) => r.x1))
    const z0 = Math.min(...rects.map((r) => r.z0))
    const z1 = Math.max(...rects.map((r) => r.z1))
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, size: Math.max(x1 - x0, z1 - z0) }
  }, [room, connectedRooms])
  const maxDist = Math.max(55, extent.size * 2.4)

  // When rooms are added/removed, re-centre the camera on the whole layout
  const prevCount = useRef(connectedRooms.length)
  useEffect(() => {
    if (prevCount.current === connectedRooms.length) return
    prevCount.current = connectedRooms.length
    const ctl = controlsRef.current
    if (!ctl) return
    const dist = Math.max(extent.size * 1.1, 14)
    ctl.target.set(extent.cx, 0, extent.cz)
    camera.position.set(extent.cx + dist * 0.8, Math.max(12, dist * 0.7), extent.cz + dist * 0.8)
    ctl.update()
    invalidate()
  }, [connectedRooms.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const walls = ['front', 'back', 'left', 'right']
  const mainActive = !activeRoomUid   // selection belongs to the main room unless a connected room is active

  const controlsRef = useRef()
  const lockedRef   = useRef(cameraLocked)
  lockedRef.current = cameraLocked

  // Pause / resume orbiting. Resuming respects the "lock camera" button.
  const setOrbit = useCallback((on) => {
    if (controlsRef.current) controlsRef.current.enabled = on && !lockedRef.current
  }, [])

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 20, 10]} intensity={1} />
      <pointLight position={[0, Math.max(7, (room.height || 8) - 1), 0]} intensity={0.35} />

      <Floor width={room.width} length={room.length} floorType={floorType} />

      {walls.map((wall) => (
        <Wall
          key={wall}
          wall={wall}
          width={room.width}
          length={room.length}
          height={room.height}
          color={wallColors[wall] || '#f5f5f0'}
          openings={[...openings, ...mainLinks]}
          onSelect={(w) => onWallSelect(w, null)}
          visible={!hiddenWalls[wall]}
          selected={mainActive && selectedWall === wall}
        />
      ))}

      {openings.map((opening) => (
        <OpeningItemM
          key={opening.id}
          opening={opening}
          isSelected={mainActive && selectedOpeningId === opening.id}
          onSelect={onSelectOpening}
          onUpdate={onOpeningUpdate}
          room={room}
          openings={openings}
          furniture={furniture}
          setOrbit={setOrbit}
          onBlocked={onBlocked}
        />
      ))}

      {furniture.map((item) => (
        <FurnitureItemM
          key={item.id}
          item={item}
          isSelected={mainActive && selectedFurnitureId === item.id}
          onSelect={onSelectFurniture}
          onUpdate={onFurnitureUpdate}
          room={room}
          allFurniture={furniture}
          openings={openings}
          tint={furnitureTint}
          setOrbit={setOrbit}
        />
      ))}

      {connectedRooms.map((cr) => (
        <ConnectedRoom3DM
          key={cr.uid}
          cr={cr}
          active={activeRoomUid === cr.uid}
          selectedFurnitureId={activeRoomUid === cr.uid ? selectedFurnitureId : null}
          selectedOpeningId={activeRoomUid === cr.uid ? selectedOpeningId : null}
          selectedWall={activeRoomUid === cr.uid ? selectedWall : null}
          hiddenWalls={hiddenConnected[cr.uid] || EMPTY}
          onSelectFurniture={onSelectFurniture}
          onSelectOpening={onSelectOpening}
          onWallSelect={onWallSelect}
          onSelectRoom={onSelectRoom}
          onFurnitureUpdate={onConnectedFurnitureUpdate}
          onOpeningUpdate={onConnectedOpeningUpdate}
          onMoveRoom={onMoveRoom}
          resolveMove={resolveMove}
          setOrbit={setOrbit}
        />
      ))}

      <OrbitControls
        ref={controlsRef}
        enabled={!cameraLocked}
        enablePan
        enableZoom
        enableRotate
        minDistance={4}
        maxDistance={maxDist}
      />
    </>
  )
}

// How much further back the 3D camera starts on a portrait screen (1 on landscape)
const PORTRAIT_ZOOM = typeof window !== 'undefined' && window.innerHeight > window.innerWidth
  ? Math.min(2, window.innerHeight / window.innerWidth)
  : 1

// ─── Wall Color Panel (bottom-left, expandable) ──────────────────────

function WallColorPanel({ selectedWall, wallColors, onColorChange }) {
  const [open, setOpen]       = useState(false)
  const [aiIndex, setAiIndex] = useState(0)
  const [notice, setNotice]   = useState('')

  const applyAiPalette = () => {
    const palette = aiWallPalettes[aiIndex % aiWallPalettes.length]
    onColorChange(palette)
    setAiIndex((prev) => prev + 1)
    setNotice(`✨ Applied: ${palette.name}`)
    setTimeout(() => setNotice(''), 2500)
  }

  const applyColor = (hex) => {
    if (!selectedWall) {
      setNotice('👆 Click a wall first')
      setTimeout(() => setNotice(''), 2000)
      return
    }
    onColorChange({ ...wallColors, [selectedWall]: hex })
  }

  return (
    // on a phone the panel stops short of the Floor box and wraps onto more rows
    <div data-tutorial="wall-color" className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-1.5
                    max-w-[calc(100%-10rem)] md:max-w-none">

      {/* Notice bubble */}
      {notice && (
        <div className="text-xs bg-black/70 text-white px-3 py-1.5 rounded-lg">
          {notice}
        </div>
      )}

      {/* Panel */}
      <div
        className={`
          flex flex-wrap md:flex-nowrap items-center gap-2 px-3 py-2.5 rounded-2xl
          bg-surface/95 dark:bg-zinc-800/90 backdrop-blur
          border border-border dark:border-zinc-700/80
          shadow-lg transition-all duration-300
          ${open ? 'gap-3' : ''}
        `}
      >
        {/* Paint brush icon */}
        <span className="text-base shrink-0">🎨</span>

        {/* Collapsed: show first 4 colors only */}
        {!open && (
          <>
            {wallPaints.slice(0, 4).map((paint) => (
              <button
                key={paint.id}
                title={paint.name}
                onClick={() => applyColor(paint.color)}
                className="w-5 h-5 rounded-full border-2 transition hover:scale-125"
                style={{
                  backgroundColor: paint.color,
                  borderColor: wallColors[selectedWall] === paint.color ? '#f4a261' : 'transparent',
                }}
              />
            ))}
            <span className="text-zinc-300 dark:text-zinc-600">|</span>
          </>
        )}

        {/* Expanded: show ALL colors */}
        {open && (
          <>
            {wallPaints.map((paint) => (
              <button
                key={paint.id}
                title={paint.name}
                onClick={() => applyColor(paint.color)}
                className="w-6 h-6 rounded-full border-2 transition hover:scale-125 shrink-0"
                style={{
                  backgroundColor: paint.color,
                  borderColor: wallColors[selectedWall] === paint.color ? '#f4a261' : '#e0e0e0',
                  boxShadow: wallColors[selectedWall] === paint.color ? '0 0 0 2px #f4a261' : 'none',
                }}
              />
            ))}

            {/* Custom color picker */}
            <div className="relative shrink-0" title="Custom color">
              <input
                type="color"
                value={wallColors[selectedWall] || '#f5f5f0'}
                onChange={(e) => applyColor(e.target.value)}
                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
              />
              <div className="w-6 h-6 rounded-full border-2 border-dashed border-zinc-400
                              flex items-center justify-center text-[10px] text-zinc-500 pointer-events-none">
                +
              </div>
            </div>

            <span className="text-zinc-300 dark:text-zinc-600 shrink-0">|</span>

            {/* AI button */}
            <button
              onClick={applyAiPalette}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg
                         bg-accent/10 text-accent text-xs font-medium
                         hover:bg-accent/20 transition whitespace-nowrap"
            >
              ✨ AI Colors
            </button>
          </>
        )}

        {/* Expand / collapse toggle */}
        <button
          onClick={() => setOpen((prev) => !prev)}
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
                     text-sm font-bold transition shrink-0"
        >
          {open ? '‹' : '›'}
        </button>
      </div>

      {/* Selected wall label */}
      {selectedWall && open && (
        <div className="text-[11px] text-white bg-black/50 px-2.5 py-1 rounded-lg">
          Painting: <span className="font-semibold capitalize">{selectedWall} wall</span>
        </div>
      )}
    </div>
  )
}

// ─── Wall picker used by openings and wall-mounted furniture ─────────

function WallSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs px-2 py-1.5 rounded border border-border dark:border-zinc-600
                 bg-surface dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
    >
      <option className={OPTION_CLASS} value="front">Front wall</option>
      <option className={OPTION_CLASS} value="back">Back wall</option>
      <option className={OPTION_CLASS} value="left">Left wall</option>
      <option className={OPTION_CLASS} value="right">Right wall</option>
    </select>
  )
}

// ─── Dimensions dialog ───────────────────────────────────────────────

/** Wall height of a design in ft, always within 8–15 (old designs have none → 8) */
const wallHeightOf = (d) => Math.min(15, Math.max(8, Number(d?.wall_height) || 8))
const FURNITURE_FIELDS = [
  { key: 'width',  label: 'Width',  min: 0.5, max: 20 },
  { key: 'depth',  label: 'Length', min: 0.3, max: 20 },
  { key: 'height', label: 'Height', min: 0.1, max: 15 }   // capped to the room's wall height when the dialog opens,
]
const OPENING_FIELDS = {
  door: [
    { key: 'width',  label: 'Width',  min: 2, max: 6 },
    { key: 'height', label: 'Height', min: 5, max: 7.8 },
  ],
  window: [
    { key: 'width',  label: 'Width',       min: 1, max: 10 },
    { key: 'height', label: 'Height',      min: 1, max: 6 },
    { key: 'offset', label: 'Sill height', min: 0, max: 6 },
  ],
}
const OPENING_DEFAULTS = {
  door:   { width: 3, height: 6.8 },
  window: { width: 4, height: 4, offset: 3.5 },
}

// up to 4 decimals shown, so typed values like 6.375 come back as typed
const fmt = (n) => String(Math.round((Number(n) || 0) * 10000) / 10000)

/** Pops up when something is selected. Edits are typed freely and applied with the Apply button. */
function DimensionsDialog({ title, fields, initial, defaults, onApply, onClose }) {
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map((f) => [f.key, fmt(initial[f.key])])))
  const [error, setError] = useState('')

  const change = (key, value) => { setVals((v) => ({ ...v, [key]: value })); setError('') }

  const submit = (e) => {
    e.preventDefault()
    const parsed = {}
    for (const f of fields) {
      const n = parseFloat(vals[f.key])
      if (!Number.isFinite(n) || n < f.min || n > f.max) {
        setError(`${f.label} must be between ${f.min} and ${f.max} ft`)
        return
      }
      parsed[f.key] = n
    }
    const err = onApply(parsed)
    if (err) setError(err)
    else onClose()
  }

  const inputCls = `w-full text-sm px-2 py-1.5 rounded border border-border dark:border-zinc-600
                    bg-bg dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100
                    focus:outline-none focus:ring-2 focus:ring-accent`

  return (
    <form
      onSubmit={submit}
      className="relative z-20 w-60 max-w-full bg-surface dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100
                 border border-border dark:border-zinc-700 rounded-xl p-3 shadow-xl"
    >
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold leading-tight">📐 Edit dimensions<br />
          <span className="font-normal opacity-60">{title}</span>
        </p>
        <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-sm leading-none">✕</button>
      </div>

      <div className="flex flex-col gap-2">
        {fields.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="opacity-70 w-20 shrink-0">{f.label} (ft)</span>
            <input
              type="number" step="any" inputMode="decimal" min={f.min} max={f.max}
              value={vals[f.key]}
              onChange={(e) => change(f.key, e.target.value)}
              className={inputCls}
            />
          </label>
        ))}
      </div>

      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}

      <div className="flex gap-2 mt-3">
        <button type="submit" className="flex-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90">
          Apply
        </button>
        {defaults && (
          <button
            type="button"
            onClick={() => { setVals(Object.fromEntries(fields.map((f) => [f.key, fmt(defaults[f.key])]))); setError('') }}
            className="px-3 py-1.5 rounded-lg border border-border dark:border-zinc-600 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
            title="Fill in the original size (press Apply to use it)"
          >
            Reset
          </button>
        )}
      </div>
    </form>
  )
}

// ─── RoomViewer (main export) ────────────────────────────────────────

export default function RoomViewer({
  width = 12,
  length = 14,
  height = 8,          // wall height in ft (8–15)
  style = 'minimal',
  designVersion = 0,
  furniture: mainFurniture = [],
  openings: mainOpenings = [],
  onFurnitureUpdate,
  onOpeningsUpdate,
  roomType,
  onAddRoom, // (door) => void — called when a + box outside a door is clicked (2D map)
  connectedRooms = [],        // [{ uid, design, door, offset, doorId }] — editable copies of other rooms
  activeRoomUid = null,       // which room edits/toolbar apply to: null = main room, else a connectedRooms uid
  onActiveRoomChange,         // (uid | null) => void
  mainLinks = [],             // doorways cut into the main room's walls by doors of connected rooms
  onMoveRoom,                 // (uid, { x, z }) => void — a connected room was dragged somewhere new
  onDeleteRoom,               // () => void — delete the selected connected room
  onRotateRoom,               // () => void — turn the selected connected room 90° clockwise
  onAskAi,                    // () => void — open the AI assistant (a toolbar button)
  onConnectedRoomChange,      // (uid, patch) => void — patch is any of { furniture, openings, wall_colors, floor_type }
  onWallColorsChange,         // (wallColors) => void — Editor tracks wall colours for save
  onFloorTypeChange,          // (floorType)  => void — Editor tracks floor type for save
  onDoorConnect,              // (door) => void — "+" click (fallback for onAddRoom)
  initialLook = null,         // { wallColors, floorType } from a loaded design; overrides the style preset
}) {
  const mainRoom = useMemo(() => ({ width, length, height }), [width, length, height])

  const [selectedFurnitureId, setSelectedFurnitureId] = useState(null)
  const [selectedOpeningId,   setSelectedOpeningId]   = useState(null)
  const [selectedWall,        setSelectedWall]        = useState(null)
  const [floorType,           setFloorType]           = useState('lightWood')
  const [cameraLocked,        setCameraLocked]        = useState(false)
  const [viewMode,            setViewMode]            = useState('free') // 'free' | 'top'
  const [toast,               setToast]               = useState('')
  const [dimsOpen,            setDimsOpen]            = useState(false)

  const [wallColors, setWallColors] = useState({
    front: '#f5f5f0',
    back:  '#f5f5f0',
    left:  '#f5f5f0',
    right: '#f5f5f0',
  })

  // Report wall colours / floor type up to the Editor so they can be saved
  useEffect(() => { onWallColorsChange?.(wallColors) }, [wallColors]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onFloorTypeChange?.(floorType) }, [floorType])   // eslint-disable-line react-hooks/exhaustive-deps

  const [hiddenWalls, setHiddenWalls] = useState({
    front: false, back: false, left: false, right: false,
  })

  const [hiddenConnected, setHiddenConnected] = useState({}) // { [uid]: { front: bool, … } }
  const [menuOpen, setMenuOpen] = useState(false)             // the ☰ Tools menu in the top bar

  const stylePreset = stylePresets[style]

  // The chosen style sets walls + floor whenever a room is generated
  useEffect(() => {
    if (initialLook) {
      setWallColors(initialLook.wallColors)
      setFloorType(initialLook.floorType)
      return
    }
    if (!stylePreset) return
    setWallColors({
      front: stylePreset.wall,
      back:  stylePreset.wall,
      left:  stylePreset.wall,
      right: stylePreset.wall,
    })
    setFloorType(stylePreset.floor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, designVersion])

  const flash = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2200)
  }

  // The room that toolbar actions apply to: the main room, or the connected room picked in the Editor.
  // Everything below (`room`, `furniture`, `openings`) always refers to that active room.
  const activeConn = connectedRooms.find((cr) => cr.uid === activeRoomUid) || null
  const activeUid  = activeConn ? activeConn.uid : null
  const room = activeConn
    ? { width: Number(activeConn.design.room_width) || 10, length: Number(activeConn.design.room_length) || 12, height: wallHeightOf(activeConn.design) }
    : mainRoom
  const furniture = activeConn ? (activeConn.design.furniture || []) : mainFurniture
  const openings  = activeConn ? (activeConn.design.openings  || []) : mainOpenings
  const activeWallColors = activeConn
    ? { front: '#f5f5f0', back: '#f5f5f0', left: '#f5f5f0', right: '#f5f5f0', ...(activeConn.design.wall_colors || {}) }
    : wallColors
  const activeFloorType   = activeConn ? (activeConn.design.floor_type || 'lightWood') : floorType
  const activeHiddenWalls = activeConn ? (hiddenConnected[activeUid] || {}) : hiddenWalls

  // Handlers

  const clearSelection = () => {
    setDimsOpen(false)
    setSelectedFurnitureId(null)
    setSelectedOpeningId(null)
    setSelectedWall(null)
  }

  const handleSelectFurniture = (id, uid = null) => {
    if (id !== selectedFurnitureId || uid !== activeUid) setDimsOpen(false)
    onActiveRoomChange?.(uid)
    setSelectedFurnitureId(id)
    setSelectedOpeningId(null)
    setSelectedWall(null)
  }

  const handleSelectOpening = (id, uid = null) => {
    if (id !== selectedOpeningId || uid !== activeUid) setDimsOpen(false)
    onActiveRoomChange?.(uid)
    setSelectedOpeningId(id)
    setSelectedFurnitureId(null)
    setSelectedWall(null)
  }

  const handleWallSelect = (wall, uid = null) => {
    setDimsOpen(false)
    onActiveRoomChange?.(uid)
    setSelectedWall(wall)
    setSelectedFurnitureId(null)
    setSelectedOpeningId(null)
  }

  // Drag results are routed to an explicit room (never "whatever is active"), because a drag
  // starts before the selection change has re-rendered.
  const updateMainFurniture = (updated) =>
    onFurnitureUpdate?.(mainFurniture.map((item) => item.id === updated.id ? updated : item))
  const updateMainOpening = (updated) =>
    onOpeningsUpdate?.(mainOpenings.map((o) => o.id === updated.id ? updated : o))
  const updateConnFurniture = (updated, uid) => {
    const cr = connectedRooms.find((x) => x.uid === uid)
    if (!cr) return
    onConnectedRoomChange?.(uid, { furniture: (cr.design.furniture || []).map((item) => item.id === updated.id ? updated : item) })
  }
  const updateConnOpening = (updated, uid) => {
    const cr = connectedRooms.find((x) => x.uid === uid)
    if (!cr) return
    onConnectedRoomChange?.(uid, { openings: (cr.design.openings || []).map((o) => o.id === updated.id ? updated : o) })
  }

  // Toolbar actions (delete, rotate, resize, door controls…) act on the active room
  const setActiveFurniture = (list) =>
    activeUid ? onConnectedRoomChange?.(activeUid, { furniture: list }) : onFurnitureUpdate?.(list)
  const setActiveOpenings = (list) =>
    activeUid ? onConnectedRoomChange?.(activeUid, { openings: list }) : onOpeningsUpdate?.(list)

  const handleFurnitureUpdate = (updated) =>
    setActiveFurniture(furniture.map((item) => item.id === updated.id ? updated : item))
  const handleOpeningUpdate = (updated) =>
    setActiveOpenings(openings.map((o) => o.id === updated.id ? updated : o))

  const deleteSelected = () => {
    if (selectedFurnitureId) {
      setActiveFurniture(furniture.filter((item) => item.id !== selectedFurnitureId))
      setSelectedFurnitureId(null)
    } else if (selectedOpeningId) {
      setActiveOpenings(openings.filter((o) => o.id !== selectedOpeningId))
      setSelectedOpeningId(null)
    }
    setDimsOpen(false)
  }

  const selectedItem    = furniture.find((f) => f.id === selectedFurnitureId)
  const selectedOpening = openings.find((o) => o.id === selectedOpeningId)
  const selectedIsWallItem = isWallMounted(selectedItem)

  // Free rotation, in whole degrees. Within SNAP_DEG of a quarter turn it
  // snaps to it, so square-to-the-wall is easy to hit. An angle that would
  // hit another piece is refused, and the piece stays where it was.
  const SNAP_DEG = 3
  const degreesOf = (rad) => ((Math.round(((Number(rad) || 0) * 180) / Math.PI) % 360) + 360) % 360
  const rotateTo = (deg) => {
    if (!selectedItem || selectedIsWallItem) return
    let d = ((Math.round(deg) % 360) + 360) % 360
    const quarter = Math.round(d / 90) * 90
    if (Math.abs(d - quarter) <= SNAP_DEG) d = quarter % 360
    const rotation = (d * Math.PI) / 180
    // rotating can push a corner through a wall, so pull it back inside first
    const pos = clampFloorPosition(selectedItem, selectedItem.x, selectedItem.z, rotation, room)
    const next = { ...selectedItem, rotation, x: pos.x, z: pos.z }
    if (furniture.some((o) => itemsCollide(next, o, room))) {
      flash('No space to rotate here')
      return
    }
    handleFurnitureUpdate(next)
  }
  const rotateBy = (deltaDeg) => rotateTo(degreesOf(selectedItem?.rotation) + deltaDeg)

  // Resize the selected piece. Returns an error message, or null when it was applied.
  const applyFurnitureSize = (v) => {
    const item = selectedItem
    const def  = furnitureDefinitions[item.type]
    const base = (k) => Number(def?.[k]) || Number(item[k]) || 1   // the model's built-in size
    const next = {
      ...item,
      width: v.width, depth: v.depth, height: v.height,
      modelScale: [v.width / base('width'), v.height / base('height'), v.depth / base('depth')],
    }
    const others = furniture.filter((f) => f.id !== item.id)

    if (isWallMounted(item)) {
      if (v.width > getWallLength(item.wall, room) - 2 * WALL_HALF) return 'Too wide for this wall'
      if ((Number(item.elevation) || 0) + v.height > (room.height || 8)) return 'Too tall: it would reach past the top of the wall'
      const position = clampAlong(item.wall, item.position, v.width, room)
      if (isWallItemBlocked({ ...next, position }, { openings, furniture: others, room })) {
        return 'No room on the wall: it would overlap a window, door or another piece'
      }
      handleFurnitureUpdate({ ...next, position })
      return null
    }

    const rot = Number(item.rotation) || 0
    const pos = clampFloorPosition(next, item.x, item.z, rot, room) // keep it inside the walls
    const placed = { ...next, x: pos.x, z: pos.z }
    if (!isInsideRoom(placed, room)) return 'Too big for this room'
    const hit = others.find((o) => itemsCollide(placed, o, room))
    if (hit) return `It would overlap the ${hit.name}`
    handleFurnitureUpdate(placed)
    return null
  }

  const applyOpeningSize = (v) => {
    const o = selectedOpening
    const next = { ...o, width: v.width, height: v.height, ...(o.type === 'window' ? { offset: v.offset } : {}) }
    if (v.width > getWallLength(o.wall, room)) return 'Too wide for this wall'
    if (o.type === 'window' && v.offset + v.height > (room.height || 8) - 0.2) return 'The window would reach the ceiling'
    const position = clampOpeningPosition(next, room)
    if (isOpeningBlocked({ ...next, position }, { openings, furniture, room })) {
      return 'No room on the wall: it would overlap another opening or a wall-mounted piece'
    }
    handleOpeningUpdate({ ...next, position })
    return null
  }

  const setDoorAngle  = (deg) => handleOpeningUpdate({ ...selectedOpening, openAngle: deg })
  const flipDoorHinge = () => handleOpeningUpdate({ ...selectedOpening, hinge: selectedOpening.hinge === 'high' ? 'low' : 'high' })
  const flipDoorSwing = () => handleOpeningUpdate({ ...selectedOpening, swing: selectedOpening.swing === 'out' ? 'in' : 'out' })

  const moveWallItemToWall = (wall) => {
    const moved = { ...selectedItem, wall }
    const pos = findFreeWallPosition(wall, moved, { openings, furniture, room }, 0)
    if (pos === null) { flash(`No free space on the ${wall} wall`); return }
    handleFurnitureUpdate({ ...moved, position: pos })
  }

  const moveOpeningToWall = (wall) => {
    const moved = { ...selectedOpening, wall }
    const pos = findFreeOpeningPosition(wall, moved, { openings, furniture, room }, 0)
    if (pos === null) { flash(`No free space on the ${wall} wall`); return }
    handleOpeningUpdate({ ...moved, position: pos })
  }

  const toggleSelectedWall = () => {
    if (!selectedWall) return
    if (activeUid) {
      setHiddenConnected((prev) => ({
        ...prev,
        [activeUid]: { ...(prev[activeUid] || {}), [selectedWall]: !prev[activeUid]?.[selectedWall] },
      }))
    } else {
      setHiddenWalls((prev) => ({ ...prev, [selectedWall]: !prev[selectedWall] }))
    }
  }

  const addOpening = (type) => {
    const base = type === 'window'
      ? { type: 'window', width: 4, height: 4, offset: 3.5 }
      : { type: 'door',   width: 3, height: 6.8, offset: 0 }
    const wallOrder = type === 'window' ? ['back', 'left', 'right', 'front'] : ['front', 'left', 'right', 'back']

    for (const wall of wallOrder) {
      const candidate = { id: `${type}-${Date.now()}`, ...base, wall, position: 0, visible: true }
      const pos = findFreeOpeningPosition(wall, candidate, { openings, furniture, room }, 0)
      if (pos !== null) {
        const created = { ...candidate, position: pos }
        setActiveOpenings([...openings, created])
        handleSelectOpening(created.id, activeUid)
        return
      }
    }
    flash(`No free wall space for a ${type}`)
  }

  const handleAddRoom = (door) => {
    if (onAddRoom) onAddRoom(door)
    else if (onDoorConnect) onDoorConnect(door)
    else flash('Adding connected rooms from your dashboard is coming soon')
  }

  // Stable versions of the handlers handed to the 3D scene, so rooms that didn't change don't re-render
  const sSelectFurniture = useStable(handleSelectFurniture)
  const sSelectOpening   = useStable(handleSelectOpening)
  const sWallSelect      = useStable(handleWallSelect)
  const sUpdateMainFurn  = useStable(updateMainFurniture)
  const sUpdateMainOpen  = useStable(updateMainOpening)
  const sUpdateConnFurn  = useStable(updateConnFurniture)
  const sUpdateConnOpen  = useStable(updateConnOpening)
  const sSelectRoom      = useStable((uid) => onActiveRoomChange?.(uid))
  const sBlocked         = useStable((msg) => flash(msg))
  const sResolveMove     = useStable((uid, to, from) => {
    const cr = connectedRooms.find((x) => x.uid === uid)
    return resolveRoomMove({ size: sizeOf(cr?.design), from, to, others: otherRects(mainRoom, connectedRooms, uid) })
  })

  const hasSelection = selectedFurnitureId || selectedOpeningId

  return (
    <div className="relative w-full h-full">

      {/* ── Canvas ──────────────────────────────────── */}
      <div className={viewMode === 'top' ? 'hidden' : 'w-full h-full'}>
      <Canvas
        frameloop={viewMode === 'top' ? 'never' : 'demand'}
        dpr={[1, 1.5]}
        gl={{ powerPreference: 'high-performance' }}
        // on a tall, narrow phone screen the view is narrow too: start further
        // back so the whole room is in the picture
        camera={{ position: [length * 0.9 * PORTRAIT_ZOOM, 14 * PORTRAIT_ZOOM, length * 0.9 * PORTRAIT_ZOOM], fov: 55 }}
        onPointerMissed={clearSelection}
      >
        <Scene
          room={mainRoom}
          furniture={mainFurniture}
          openings={mainOpenings}
          selectedFurnitureId={selectedFurnitureId}
          selectedOpeningId={selectedOpeningId}
          onSelectFurniture={sSelectFurniture}
          onSelectOpening={sSelectOpening}
          onFurnitureUpdate={sUpdateMainFurn}
          onOpeningUpdate={sUpdateMainOpen}
          hiddenWalls={hiddenWalls}
          floorType={floorType}
          wallColors={wallColors}
          furnitureTint={stylePreset?.furniture}
          onWallSelect={sWallSelect}
          selectedWall={selectedWall}
          cameraLocked={cameraLocked}
          connectedRooms={connectedRooms}
          activeRoomUid={activeUid}
          hiddenConnected={hiddenConnected}
          onConnectedFurnitureUpdate={sUpdateConnFurn}
          onConnectedOpeningUpdate={sUpdateConnOpen}
          onSelectRoom={sSelectRoom}
          onMoveRoom={onMoveRoom}
          mainLinks={mainLinks}
          onBlocked={sBlocked}
          resolveMove={sResolveMove}
        />
      </Canvas>
      </div>

      {/* ── 2D floor plan (top view) ──────────────────── */}
      {viewMode === 'top' && (
        <div className="absolute inset-0 pt-24 bg-[#f7f5f0] dark:bg-zinc-900">
          <FloorPlan2D
            width={width}
            length={length}
            roomType={roomType}
            furniture={mainFurniture}
            openings={mainOpenings}
            wallColors={wallColors}
            selectedWall={selectedWall}
            selectedFurnitureId={selectedFurnitureId}
            selectedOpeningId={selectedOpeningId}
            onSelectFurniture={handleSelectFurniture}
            onSelectOpening={handleSelectOpening}
            onWallSelect={handleWallSelect}
            onClearSelection={clearSelection}
            onFurnitureUpdate={updateMainFurniture}
            onOpeningUpdate={updateMainOpening}
            onAddRoom={handleAddRoom}
            connectedRooms={connectedRooms}
            selectedRoomUid={activeUid}
            onSelectRoom={(uid) => onActiveRoomChange?.(uid)}
            onMoveRoom={onMoveRoom}
            mainLinks={mainLinks}
            onBlocked={flash}
            onConnectedFurnitureUpdate={updateConnFurniture}
            onConnectedOpeningUpdate={updateConnOpening}
            locked={cameraLocked}
          />
        </div>
      )}

      {/* ── TOP-LEFT: one small bar ─────────────────────
          Always: 2D/3D and a Tools menu. When something is selected, its own
          tools appear right beside them (name, size, rotate, delete); the rest
          stays in the menu, so the room stays in view. */}
      <div className="absolute top-3 left-3 right-3 md:top-4 md:left-4 md:right-auto z-10 md:max-w-[70%] flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">

        <button
          onClick={() => setViewMode((v) => (v === 'top' ? 'free' : 'top'))}
          data-tutorial="2d-plan"
          title="Switch between the 3D room and the flat 2D floor plan"
          className="px-3 py-1.5 rounded-lg bg-black/75 text-white text-xs font-medium hover:bg-black/90 transition"
        >
          {viewMode === 'top' ? '🧊 3D' : '🗺 2D'}
        </button>

        <div className="relative">
          <button onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} data-tutorial="tools"
            className={`px-3 py-1.5 rounded-lg text-white text-xs font-medium transition ${menuOpen ? 'bg-accent' : 'bg-black/75 hover:bg-black/90'}`}>
            ☰ Tools {menuOpen ? '▴' : '▾'}
          </button>
          {menuOpen && (
            <>
              {/* a tap anywhere else closes the menu */}
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 mt-2 z-20 w-52 rounded-xl bg-zinc-900/95 backdrop-blur text-white text-sm p-1.5 shadow-2xl flex flex-col">
                {[
                  { label: cameraLocked ? '🔒 Unlock camera' : '🔓 Lock camera', run: () => setCameraLocked((v) => !v) },
                  selectedWall && { label: activeHiddenWalls[selectedWall] ? `👁 Show ${selectedWall} wall` : `🙈 Hide ${selectedWall} wall`, run: toggleSelectedWall },
                  viewMode !== 'top' && { label: '🧱 Show all walls', run: () => { setHiddenWalls({ front: false, back: false, left: false, right: false }); setHiddenConnected({}) } },
                  { label: '🪟 Add window', run: () => addOpening('window') },
                  { label: '🚪 Add door', run: () => addOpening('door') },
                  onRotateRoom && { label: '⟳ Turn room 90°', run: onRotateRoom },
                  activeUid && onDeleteRoom && { label: '🗑 Delete this room', run: onDeleteRoom, danger: true },
                ].filter(Boolean).map((it) => (
                  <button key={it.label} onClick={() => { it.run(); setMenuOpen(false) }}
                    className={`text-left px-3 py-2 rounded-lg hover:bg-white/10 ${it.danger ? 'text-red-400' : ''}`}>
                    {it.label}
                  </button>
                ))}
                <p className="px-3 pt-1.5 pb-1 text-[11px] opacity-50 border-t border-white/10 mt-1">
                  {viewMode === 'top'
                    ? 'Tip: pinch or scroll to zoom, drag empty space to pan, drag a piece to move it'
                    : 'Tip: tap a wall to paint it'}
                </p>
              </div>
            </>
          )}
        </div>

        {onAskAi && (
          <button onClick={onAskAi} data-tutorial="ask-ai" title="Ask the AI for colours, furniture or a whole layout"
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90 transition">
            ✨ Ask AI
          </button>
        )}

        {/* the selected piece's own tools, right beside the menu */}
        {(selectedItem || selectedOpening) && (
          <div className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg bg-black/75 text-white text-xs">
            <span className="max-w-[7rem] truncate font-medium">
              {selectedItem ? selectedItem.name : selectedOpening.type === 'window' ? 'Window' : 'Door'}
            </span>
            <button onClick={() => setDimsOpen((v) => !v)} title="Size"
              className={`w-7 h-7 rounded text-sm ${dimsOpen ? 'bg-accent' : 'hover:bg-white/20'}`}>📐</button>
            {selectedItem && !selectedIsWallItem && (
              <span className="flex items-center gap-0.5" title="Rotate: drag, or 15° steps. Snaps straight near 0/90/180/270°.">
                <button onClick={() => rotateBy(-15)} aria-label="Rotate 15 degrees left" className="w-7 h-7 rounded hover:bg-white/20 text-base leading-none">⟲</button>
                <input type="range" min="0" max="359" step="1"
                  value={degreesOf(selectedItem.rotation)}
                  onChange={(e) => rotateTo(Number(e.target.value))}
                  aria-label="Rotation in degrees"
                  className="w-20 md:w-28 accent-orange-400 cursor-pointer touch-none" />
                <button onClick={() => rotateBy(15)} aria-label="Rotate 15 degrees right" className="w-7 h-7 rounded hover:bg-white/20 text-base leading-none">⟳</button>
                <span className="w-8 text-right tabular-nums">{degreesOf(selectedItem.rotation)}°</span>
              </span>
            )}
            <button onClick={deleteSelected} title="Delete" aria-label="Delete"
              className="w-7 h-7 rounded text-sm hover:bg-red-600">🗑</button>
          </div>
        )}

        {selectedWall && !hasSelection && (
          <span className="px-3 py-1.5 rounded-lg bg-black/60 text-white text-xs capitalize">🧱 {selectedWall} wall</span>
        )}
      </div>

        {/* ── Dimensions dialog: right under the 📐 that opened it, on the left,
            so it never sits over the 2D zoom buttons in the top-right corner ── */}
        {dimsOpen && selectedItem && (
          <DimensionsDialog
            key={selectedItem.id}
            title={selectedItem.name}
            fields={FURNITURE_FIELDS.map((fl) => (fl.key === 'height' ? { ...fl, max: room.height || 8 } : fl))}
            initial={selectedItem}
            defaults={furnitureDefinitions[selectedItem.type]}
            onApply={applyFurnitureSize}
            onClose={() => setDimsOpen(false)}
          />
        )}
        {dimsOpen && selectedOpening && (
          <DimensionsDialog
            key={selectedOpening.id}
            title={selectedOpening.type === 'window' ? 'Window' : 'Door'}
            fields={OPENING_FIELDS[selectedOpening.type === 'window' ? 'window' : 'door']}
            initial={{ offset: 3.5, ...selectedOpening }}
            defaults={OPENING_DEFAULTS[selectedOpening.type === 'window' ? 'window' : 'door']}
            onApply={applyOpeningSize}
            onClose={() => setDimsOpen(false)}
          />
        )}


        {/* ── Opening controls ──────────────────────────── */}
        {selectedOpening && (
          <div className="relative w-56 bg-surface dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100
                          border border-border dark:border-zinc-700 rounded-xl p-3 shadow-lg">
            <p className="text-xs font-semibold mb-1">
              {selectedOpening.type === 'window' ? '🪟 Window' : '🚪 Door'}
            </p>
            <p className="text-xs opacity-60 mb-2">Drag along the wall to move it</p>
            <WallSelect value={selectedOpening.wall} onChange={moveOpeningToWall} />

            {selectedOpening.type === 'door' && (
              <div className="mt-3 pt-3 border-t border-border dark:border-zinc-700">
                <label className="flex items-center justify-between text-xs font-medium mb-1">
                  <span>↻ Rotate door</span>
                  <span className="tabular-nums opacity-70">{Math.round(getDoorAngle(selectedOpening))}° open</span>
                </label>
                <input
                  type="range" min="0" max="120" step="5"
                  value={getDoorAngle(selectedOpening)}
                  onChange={(e) => setDoorAngle(Number(e.target.value))}
                  className="w-full accent-[#f4a261]"
                />
                <div className="flex gap-1.5 mt-2">
                  <button onClick={flipDoorHinge}
                    className="flex-1 text-[11px] px-2 py-1.5 rounded border border-border dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    title="Move the hinge to the other side of the doorway">
                    ⇄ Flip hinge
                  </button>
                  <button onClick={flipDoorSwing}
                    className="flex-1 text-[11px] px-2 py-1.5 rounded border border-border dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    title="Make the door open into the room or out of it">
                    ⇵ Opens {selectedOpening.swing === 'out' ? 'out' : 'in'}
                  </button>
                </div>
                {viewMode === 'top' && (
                  <p className="text-[10px] opacity-50 mt-2">Drag the round handle to swing it.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Wall-mounted furniture controls ───────────── */}
        {selectedItem && selectedIsWallItem && (
          <div className="relative bg-surface dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100
                          border border-border dark:border-zinc-700 rounded-xl p-3 shadow-lg">
            <p className="text-xs font-semibold mb-1">🖼 {selectedItem.name}</p>
            <p className="text-xs opacity-60 mb-2">Drag along the wall to move it</p>
            <WallSelect value={selectedItem.wall} onChange={moveWallItemToWall} />
          </div>
        )}
      </div>

      {/* ── Toast ─────────────────────────────────────── */}
      {toast && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 text-xs
                        bg-black/80 text-white px-3 py-2 rounded-lg pointer-events-none">
          {toast}
        </div>
      )}

      {/* ── BOTTOM-LEFT: Wall color panel ─────────────── */}
      <WallColorPanel
        selectedWall={selectedWall}
        wallColors={activeWallColors}
        onColorChange={(newColors) => activeUid
          ? onConnectedRoomChange?.(activeUid, { wall_colors: { ...activeWallColors, ...newColors } })
          : setWallColors((prev) => ({ ...prev, ...newColors }))}
      />

      {/* ── BOTTOM-RIGHT: Floor selector ─────────────── */}
      <div data-tutorial="floor-select" className="absolute bottom-4 right-4 z-10 bg-surface/95 dark:bg-zinc-800/90
                      backdrop-blur border border-border dark:border-zinc-700
                      rounded-xl px-2 py-1.5 md:px-3 md:py-2.5 shadow-lg w-[8.5rem] md:w-auto">
        <label className="text-xs font-semibold block mb-1 md:mb-1.5 opacity-60 text-zinc-900 dark:text-zinc-100">Floor</label>
        <select
          value={activeFloorType}
          onChange={(e) => activeUid
            ? onConnectedRoomChange?.(activeUid, { floor_type: e.target.value })
            : setFloorType(e.target.value)}
          className="w-full text-sm px-2 py-1.5 rounded border border-border dark:border-zinc-600
                     bg-bg dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          {floorPresets.map((f) => (
            <option key={f.id} value={f.id} className={OPTION_CLASS}>{f.name}</option>
          ))}
        </select>
      </div>

    </div>
  )
}

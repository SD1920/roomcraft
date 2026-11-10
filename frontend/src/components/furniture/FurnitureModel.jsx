import React, { createContext, useContext, useMemo } from 'react'
import * as THREE from 'three'
import { furnitureDefinitions } from '../../data/roomPresets'

// The room style passes a tint colour down to every piece of furniture.
// Large surfaces (bodies, seats, doors) are blended toward it; small details
// (handles, legs, books) keep their own colour.
const TintContext = createContext(null)

// Shared primitive — a single box mesh
function Part({ position, size, color, rotation = [0, 0, 0], opacity = 1 }) {
  const tint = useContext(TintContext)
  const finalColor =
    tint && Math.max(...size) > 1.1
      ? new THREE.Color(color).lerp(new THREE.Color(tint.color), tint.amount)
      : color

  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={finalColor}
        roughness={0.65}
        metalness={0.05}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  )
}

// Shared cylinder primitive (for taps, legs)
function Cylinder({ position, radiusTop = 0.08, radiusBottom = 0.08, height = 0.5, color = '#c0c0c0' }) {
  return (
    <mesh position={position} castShadow>
      <cylinderGeometry args={[radiusTop, radiusBottom, height, 12]} />
      <meshStandardMaterial color={color} roughness={0.3} metalness={0.6} />
    </mesh>
  )
}

/* =====================================================
   BED
===================================================== */
function BedModel() {
  return (
    <group>
      <Part position={[0, 1.05, 0]}    size={[5.2, 0.5, 6.2]}  color="#e8e1d5" />
      <Part position={[0, 0.65, 0]}    size={[5.4, 0.35, 6.4]} color="#5a4030" />
      <Part position={[0, 2.3, -2.9]}  size={[5.5, 2.7, 0.25]} color="#6b4937" />
      <Part position={[-1.45, 1.42, -2.05]} size={[1.8, 0.25, 1]}  color="#f4f0e8" />
      <Part position={[ 1.45, 1.42, -2.05]} size={[1.8, 0.25, 1]}  color="#f4f0e8" />
      <Part position={[0, 1.34, 0.65]} size={[5.0, 0.12, 3.4]} color="#c7d2d8" />
      {[[-2.35,0.35,-2.65],[2.35,0.35,-2.65],[-2.35,0.35,2.65],[2.35,0.35,2.65]].map((p, i) => (
        <Part key={i} position={p} size={[0.3, 0.7, 0.3]} color="#3d2b20" />
      ))}
    </group>
  )
}

/* =====================================================
   DINING CHAIR / STUDY CHAIR / ACCENT CHAIR
===================================================== */
function DiningChairModel() {
  return (
    <group>
      <Part position={[0, 1.55, 0]}    size={[1.45, 0.25, 1.45]} color="#7b5238" />
      <Part position={[0, 1.72, 0]}    size={[1.2,  0.18, 1.2]}  color="#d8c6ae" />
      <Part position={[0, 3.05, -0.58]} size={[1.45, 2.5, 0.22]}  color="#7b5238" />
      <Part position={[0, 3.0,  -0.43]} size={[1.1,  1.35, 0.12]} color="#d8c6ae" />
      {[[-0.52,0.75,-0.52],[0.52,0.75,-0.52],[-0.52,0.75,0.52],[0.52,0.75,0.52]].map((p, i) => (
        <Part key={i} position={p} size={[0.18, 1.5, 0.18]} color="#4b3325" />
      ))}
    </group>
  )
}

function ChairModel({ type }) {
  const def = furnitureDefinitions[type]
  const sx = def ? def.width / 1.5 : 1
  const sz = def ? def.depth / 1.5 : 1
  return (
    <group scale={[sx, 1, sz]}>
      <DiningChairModel />
    </group>
  )
}

/* =====================================================
   ARMCHAIR
===================================================== */
function ArmchairModel() {
  return (
    <group>
      <Part position={[0, 1.2, 0]}     size={[2.4, 0.55, 2.4]}  color="#8b7355" />
      <Part position={[0, 1.52, 0]}    size={[2.0, 0.3,  2.0]}  color="#a09070" />
      <Part position={[0, 2.5, -0.92]} size={[2.4, 2.0,  0.5]}  color="#8b7355" />
      <Part position={[-1.1, 1.65, 0]} size={[0.3, 0.7,  2.4]}  color="#7a6248" />
      <Part position={[ 1.1, 1.65, 0]} size={[0.3, 0.7,  2.4]}  color="#7a6248" />
      {[[-0.9,0.35,-0.9],[0.9,0.35,-0.9],[-0.9,0.35,0.9],[0.9,0.35,0.9]].map((p, i) => (
        <Part key={i} position={p} size={[0.2, 0.7, 0.2]} color="#4a3525" />
      ))}
    </group>
  )
}

/* =====================================================
   LOVESEAT (2-SEATER SOFA)
===================================================== */
function LoveseatModel() {
  return (
    <group>
      <Part position={[0, 1.05, 0]}    size={[4, 1.2, 2.6]}   color="#7d7070" />
      <Part position={[-0.8, 1.75, 0.1]} size={[2.2, 0.55, 2.1]} color="#8e8080" />
      <Part position={[ 0.8, 1.75, 0.1]} size={[2.2, 0.55, 2.1]} color="#8e8080" />
      <Part position={[0, 2.65, -0.9]} size={[3.8, 2.4, 0.55]}  color="#706565" />
      <Part position={[-1.85, 1.9, 0]} size={[0.5, 1.8, 2.7]}   color="#605858" />
      <Part position={[ 1.85, 1.9, 0]} size={[0.5, 1.8, 2.7]}   color="#605858" />
      {[[-1.4,0.35,-0.8],[1.4,0.35,-0.8],[-1.4,0.35,0.8],[1.4,0.35,0.8]].map((p, i) => (
        <Part key={i} position={p} size={[0.3, 0.7, 0.3]} color="#3b3028" />
      ))}
    </group>
  )
}

/* =====================================================
   SOFA (3-SEATER)
===================================================== */
function SofaModel() {
  return (
    <group>
      <Part position={[0, 1.05, 0]}    size={[6, 1.2, 2.6]}   color="#6f7777" />
      <Part position={[-1.5, 1.75, 0.1]} size={[2.6, 0.55, 2.1]} color="#858c8c" />
      <Part position={[ 1.5, 1.75, 0.1]} size={[2.6, 0.55, 2.1]} color="#858c8c" />
      <Part position={[0, 2.65, -0.9]} size={[5.8, 2.4, 0.55]}  color="#606767" />
      <Part position={[-2.85, 1.9, 0]} size={[0.5, 1.8, 2.7]}   color="#555d5d" />
      <Part position={[ 2.85, 1.9, 0]} size={[0.5, 1.8, 2.7]}   color="#555d5d" />
      {[[-2.3,0.35,-0.8],[2.3,0.35,-0.8],[-2.3,0.35,0.8],[2.3,0.35,0.8]].map((p, i) => (
        <Part key={i} position={p} size={[0.3, 0.7, 0.3]} color="#3b3028" />
      ))}
    </group>
  )
}

/* =====================================================
   WARDROBE
===================================================== */
function WardrobeModel() {
  return (
    <group>
      <Part position={[0, 3.25, 0]}      size={[4, 6.5, 1.8]}   color="#8b6a52" />
      <Part position={[-0.95, 3.25, -0.94]} size={[1.75, 5.9, 0.12]} color="#a18469" />
      <Part position={[ 0.95, 3.25, -0.94]} size={[1.75, 5.9, 0.12]} color="#a18469" />
      <Part position={[-0.25, 3.25, -1.04]} size={[0.08, 0.55, 0.08]} color="#c6a15b" />
      <Part position={[ 0.25, 3.25, -1.04]} size={[0.08, 0.55, 0.08]} color="#c6a15b" />
      <Part position={[0, 0.2, 0]}       size={[4.1, 0.3, 1.9]}  color="#654936" />
    </group>
  )
}

/* =====================================================
   DESK
===================================================== */
function DeskModel() {
  return (
    <group>
      <Part position={[0, 2.5, 0]}    size={[4, 0.3, 2]}   color="#795538" />
      <Part position={[-1.35, 1.25, 0]} size={[0.8, 2.2, 1.7]} color="#67472f" />
      {[[-1.75,1.2,-0.7],[1.75,1.2,-0.7],[-1.75,1.2,0.7],[1.75,1.2,0.7]].map((p, i) => (
        <Part key={i} position={p} size={[0.18, 2.2, 0.18]} color="#4b3325" />
      ))}
    </group>
  )
}

/* =====================================================
   CABINET / TV UNIT
===================================================== */
function StorageModel() {
  return (
    <group>
      <Part position={[0, 2, 0]}      size={[4, 4, 1.5]}  color="#76543c" />
      <Part position={[-0.95, 2, -0.8]} size={[1.7, 3.5, 0.12]} color="#987558" />
      <Part position={[ 0.95, 2, -0.8]} size={[1.7, 3.5, 0.12]} color="#987558" />
      <Part position={[-0.2, 2, -0.9]}  size={[0.08, 0.45, 0.08]} color="#c6a15b" />
      <Part position={[ 0.2, 2, -0.9]}  size={[0.08, 0.45, 0.08]} color="#c6a15b" />
      {[[-1.6,0.25,-0.5],[1.6,0.25,-0.5],[-1.6,0.25,0.5],[1.6,0.25,0.5]].map((p, i) => (
        <Part key={i} position={p} size={[0.2, 0.5, 0.2]} color="#4b3325" />
      ))}
    </group>
  )
}

/* =====================================================
   BOOKSHELF
===================================================== */
function BookshelfModel() {
  return (
    <group>
      <Part position={[-1.35, 3, 0]} size={[0.25, 6, 1.2]} color="#704b32" />
      <Part position={[ 1.35, 3, 0]} size={[0.25, 6, 1.2]} color="#704b32" />
      {[0.4, 1.8, 3.2, 4.6, 5.8].map((y, i) => (
        <Part key={i} position={[0, y, 0]} size={[2.7, 0.18, 1.2]} color="#805838" />
      ))}
      <Part position={[-0.7, 1.1, -0.55]} size={[0.35, 1.0, 0.65]} color="#8b4d3b" />
      <Part position={[-0.25,1.1, -0.55]} size={[0.35, 0.8, 0.65]} color="#496477" />
      <Part position={[ 0.3, 2.5, -0.55]} size={[0.35, 1.1, 0.65]} color="#a17c3c" />
      <Part position={[ 0.75,2.5, -0.55]} size={[0.35, 0.9, 0.65]} color="#704b68" />
    </group>
  )
}

/* =====================================================
   SMALL TABLE (coffee, side, bedside)
===================================================== */
function TableModel({ type }) {
  const def = furnitureDefinitions[type] || { width: 1.5, depth: 1.5, height: 2 }
  const { width: w, depth: d, height: h } = def
  const top = 0.25
  const inset = 0.15
  const legH = h - top
  return (
    <group>
      <Part position={[0, h - top / 2, 0]} size={[w, top, d]} color="#765238" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Part
          key={i}
          position={[sx * (w / 2 - inset), legH / 2, sz * (d / 2 - inset)]}
          size={[0.15, legH, 0.15]}
          color="#4b3325"
        />
      ))}
    </group>
  )
}

/* =====================================================
   DINING TABLE
===================================================== */
function DiningTableModel() {
  return (
    <group>
      <Part position={[0, 2.6, 0]}  size={[5, 0.3, 3]}    color="#795538" />
      <Part position={[0, 2.38, 0]} size={[4.8, 0.18, 2.8]} color="#5e402c" />
      {[[-2.15,1.15,-1.15],[2.15,1.15,-1.15],[-2.15,1.15,1.15],[2.15,1.15,1.15]].map((p, i) => (
        <Part key={i} position={p} size={[0.28, 2.3, 0.28]} color="#4b3325" />
      ))}
    </group>
  )
}

/* =====================================================
   TELEVISION
===================================================== */
function TVModel() {
  // Wall-mounted: back face sits on the wall (z = +0.09), screen faces -z
  return (
    <group>
      <Part position={[0, 1.25, 0]}     size={[4, 2.4, 0.18]}    color="#111111" />
      <Part position={[0, 1.25, -0.1]}  size={[3.8, 2.2, 0.04]}  color="#1a3a5c" />
      <Part position={[0, 1.25, -0.12]} size={[3.5, 1.9, 0.02]}  color="#2255aa" />
    </group>
  )
}

/* =====================================================
   TV UNIT (low media console)
===================================================== */
function TvUnitModel() {
  return (
    <group>
      <Part position={[0, 1.0, 0]}      size={[5, 1.7, 1.5]}     color="#76543c" />
      <Part position={[0, 1.93, 0]}     size={[5.1, 0.14, 1.6]}  color="#5e402c" />
      <Part position={[-1.25, 1.0, -0.78]} size={[2.3, 1.4, 0.1]} color="#987558" />
      <Part position={[ 1.25, 1.0, -0.78]} size={[2.3, 1.4, 0.1]} color="#987558" />
      <Part position={[-0.2, 1.0, -0.86]} size={[0.08, 0.45, 0.08]} color="#c6a15b" />
      <Part position={[ 0.2, 1.0, -0.86]} size={[0.08, 0.45, 0.08]} color="#c6a15b" />
      {[[-2.3, -0.6], [2.3, -0.6], [-2.3, 0.6], [2.3, 0.6]].map(([x, z], i) => (
        <Part key={i} position={[x, 0.075, z]} size={[0.2, 0.15, 0.2]} color="#4b3325" />
      ))}
    </group>
  )
}

/* =====================================================
   KITCHEN ISLAND
===================================================== */
function KitchenIslandModel() {
  return (
    <group position={[0, 0, 0.45]}>
      {/* Island body */}
      <Part position={[0, 1.5, 0]}  size={[4, 3, 2]}    color="#d4c5b0" />
      {/* Counter */}
      <Part position={[0, 3.1, 0]}  size={[4.1, 0.2, 2.1]} color="#666666" />
      {/* Cabinet doors */}
      <Part position={[-1.2, 1.5, -1.05]} size={[1.3, 2.5, 0.1]} color="#c5b8a5" />
      <Part position={[ 0.0, 1.5, -1.05]} size={[1.3, 2.5, 0.1]} color="#c5b8a5" />
      <Part position={[ 1.2, 1.5, -1.05]} size={[1.3, 2.5, 0.1]} color="#c5b8a5" />
      {/* Handles */}
      <Part position={[-1.2, 1.5, -1.12]} size={[0.06, 0.4, 0.06]} color="#aaaaaa" />
      <Part position={[ 0.0, 1.5, -1.12]} size={[0.06, 0.4, 0.06]} color="#aaaaaa" />
      <Part position={[ 1.2, 1.5, -1.12]} size={[0.06, 0.4, 0.06]} color="#aaaaaa" />
      {/* Bar stools */}
      <Part position={[-1.2, 2.1, -1.5]} size={[0.8, 0.1, 0.8]} color="#8b7355" />
      <Part position={[ 0.0, 2.1, -1.5]} size={[0.8, 0.1, 0.8]} color="#8b7355" />
      <Part position={[ 1.2, 2.1, -1.5]} size={[0.8, 0.1, 0.8]} color="#8b7355" />
      <Cylinder position={[-1.2, 1.2, -1.5]} height={1.8} radiusTop={0.1} radiusBottom={0.1} color="#5a4030" />
      <Cylinder position={[ 0.0, 1.2, -1.5]} height={1.8} radiusTop={0.1} radiusBottom={0.1} color="#5a4030" />
      <Cylinder position={[ 1.2, 1.2, -1.5]} height={1.8} radiusTop={0.1} radiusBottom={0.1} color="#5a4030" />
    </group>
  )
}

/* =====================================================
   WASH BASIN
===================================================== */
function BasinModel() {
  return (
    <group>
      {/* Pedestal */}
      <Cylinder position={[0, 1.2, 0]} height={2.4} radiusTop={0.28} radiusBottom={0.22} color="#e8e8e8" />
      {/* Basin bowl */}
      <Part position={[0, 2.7, 0]}  size={[2.0, 0.3, 1.5]}  color="#f2f2f2" />
      <Part position={[0, 2.55, 0]} size={[1.7, 0.3, 1.2]}  color="#e0e0e0" />
      {/* Tap */}
      <Cylinder position={[0, 3.1, -0.4]} height={0.55} radiusTop={0.06} radiusBottom={0.06} color="#b8b8b8" />
      <Part position={[0, 3.38, -0.4]} size={[0.5, 0.06, 0.06]} color="#b8b8b8" />
      {/* Handles */}
      <Cylinder position={[-0.3, 3.15, -0.4]} height={0.15} radiusTop={0.05} color="#c8c8c8" />
      <Cylinder position={[ 0.3, 3.15, -0.4]} height={0.15} radiusTop={0.05} color="#c8c8c8" />
    </group>
  )
}

/* =====================================================
   BATHTUB
===================================================== */
function BathtubModel() {
  return (
    <group>
      {/* Outer shell */}
      <Part position={[0, 0.75, 0]}  size={[5, 1.5, 2.5]}   color="#f5f5f5" />
      {/* Inner (water area) */}
      <Part position={[0, 1.1, 0]}   size={[4.4, 0.7, 1.9]}  color="#dcedf5" />
      {/* Rolled rim */}
      <Part position={[0, 1.58, 0]}  size={[5.1, 0.18, 2.6]} color="#eeeeee" />
      {/* Tap */}
      <Cylinder position={[2.1, 1.8, 0]} height={0.6} color="#b8b8b8" />
      <Part position={[2.1, 2.15, 0]} size={[0.45, 0.06, 0.06]} color="#b8b8b8" />
      {/* Handles */}
      <Cylinder position={[2.1, 1.95, -0.25]} height={0.12} radiusTop={0.05} color="#c8c8c8" />
      <Cylinder position={[2.1, 1.95,  0.25]} height={0.12} radiusTop={0.05} color="#c8c8c8" />
      {/* Feet */}
      {[[-2.1,0.18,-0.9],[2.1,0.18,-0.9],[-2.1,0.18,0.9],[2.1,0.18,0.9]].map((p, i) => (
        <Cylinder key={i} position={p} height={0.35} radiusTop={0.12} radiusBottom={0.1} color="#cccccc" />
      ))}
    </group>
  )
}

/* =====================================================
   TOILET
===================================================== */
function ToiletModel() {
  return (
    <group>
      {/* Base / bowl */}
      <Part position={[0, 0.75, 0.2]}  size={[1.8, 1.5, 2.0]}  color="#f0f0f0" />
      {/* Seat */}
      <Part position={[0, 1.52, 0.2]}  size={[1.55, 0.1, 1.6]} color="#e5e5e5" />
      {/* Lid */}
      <Part position={[0, 1.64, 0.2]}  size={[1.55, 0.1, 1.6]} color="#eeeeee" />
      {/* Tank */}
      <Part position={[0, 2.2, -0.85]} size={[1.6, 1.6, 0.6]}  color="#f0f0f0" />
      {/* Tank lid */}
      <Part position={[0, 3.05, -0.85]} size={[1.65, 0.1, 0.65]} color="#e8e8e8" />
      {/* Flush button */}
      <Cylinder position={[0, 3.12, -0.85]} height={0.06} radiusTop={0.12} color="#cccccc" />
    </group>
  )
}

/* =====================================================
   WALL PAINTING
===================================================== */
function PaintingModel() {
  return (
    <group>
      {/* Frame */}
      <Part position={[0, 1.25, 0]}    size={[3.0, 2.5, 0.18]}  color="#3a2a18" />
      {/* Canvas */}
      <Part position={[0, 1.25, -0.1]} size={[2.65, 2.15, 0.06]} color="#f0ead8" />
      {/* Abstract art — blocks of color */}
      <Part position={[-0.5, 1.45, -0.14]} size={[0.9, 0.8, 0.04]}  color="#d9553a" />
      <Part position={[ 0.5, 1.05, -0.14]} size={[0.7, 1.0, 0.04]}  color="#3a6fb0" />
      <Part position={[ 0.0, 1.6, -0.14]}  size={[1.1, 0.45, 0.04]} color="#6faa3a" />
      <Part position={[-0.4, 0.9, -0.14]}  size={[0.5, 0.5, 0.04]}  color="#e8c040" />
      {/* Hanging wire */}
      <Part position={[0, 2.68, -0.05]} size={[0.5, 0.04, 0.04]} color="#888888" />
    </group>
  )
}


/* =====================================================
   REFRIGERATOR
===================================================== */
function FridgeModel() {
  return (
    <group>
      <Part position={[0, 3, 0]}        size={[2.5, 6, 2.4]}   color="#d9dcde" />
      <Part position={[0, 4.2, -1.22]}  size={[2.4, 3.4, 0.06]} color="#c9ced1" />
      <Part position={[0, 1.4, -1.22]}  size={[2.4, 2.6, 0.06]} color="#c9ced1" />
      <Part position={[-0.95, 4.2, -1.3]} size={[0.08, 1.2, 0.08]} color="#888888" />
      <Part position={[-0.95, 1.9, -1.3]} size={[0.08, 0.9, 0.08]} color="#888888" />
    </group>
  )
}

/* =====================================================
   SHOWER CUBICLE
===================================================== */
function ShowerModel() {
  return (
    <group>
      <Part position={[0, 0.1, 0]} size={[3, 0.2, 3]} color="#e6e6e6" />
      {[[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]].map(([x, z], i) => (
        <Part key={i} position={[x, 3.5, z]} size={[0.1, 7, 0.1]} color="#b0b0b0" />
      ))}
      <Part position={[0, 3.5, -1.45]}  size={[2.8, 6.6, 0.04]} color="#bfe3f0" opacity={0.25} />
      <Part position={[-1.45, 3.5, 0]}  size={[0.04, 6.6, 2.8]} color="#bfe3f0" opacity={0.25} />
      <Part position={[ 1.45, 3.5, 0]}  size={[0.04, 6.6, 2.8]} color="#bfe3f0" opacity={0.25} />
      <Part position={[0, 3.8, 1.3]}    size={[0.1, 4.6, 0.1]}  color="#c0c0c0" />
      <Part position={[0, 6.2, 1.0]}    size={[0.7, 0.1, 0.7]}  color="#c0c0c0" />
    </group>
  )
}

/* =====================================================
   WASHING MACHINE
===================================================== */
function WashingMachineModel() {
  return (
    <group>
      <Part position={[0, 1.6, 0]}      size={[2.2, 3.2, 2.2]}  color="#f0f0f0" />
      <Part position={[0, 1.5, -1.12]}  size={[1.5, 1.5, 0.06]} color="#cfcfcf" />
      <Part position={[0, 1.5, -1.16]}  size={[1.2, 1.2, 0.06]} color="#8fb4c4" />
      <Part position={[0, 2.85, -1.12]} size={[2.0, 0.4, 0.06]} color="#dddddd" />
    </group>
  )
}

/* =====================================================
   WALL MIRROR
===================================================== */
function MirrorModel() {
  // Wall-mounted: back face on the wall (z = +0.06), reflective face toward -z
  return (
    <group>
      <Part position={[0, 1.25, 0]}     size={[2, 2.5, 0.12]}  color="#444444" />
      <Part position={[0, 1.25, -0.07]} size={[1.8, 2.3, 0.04]} color="#cfe6ee" />
    </group>
  )
}

/* =====================================================
   EXTRA FURNITURE (see data/extraFurniture.js)
   Every model reads its size from furnitureDefinitions,
   so the "Edit dimensions" scaling stays proportional.
   Floor pieces: back at -z, front at +z.
   Wall pieces:  back at +z, visible face toward -z.
===================================================== */
const dimsOf = (type, fb = { width: 2, depth: 2, height: 2 }) => ({ ...fb, ...(furnitureDefinitions[type] || {}) })

function Cyl({ position, r = 0.5, rt, h = 1, color = '#888', rotation = [0, 0, 0], metal = false }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[rt ?? r, r, h, 24]} />
      <meshStandardMaterial color={color} roughness={metal ? 0.3 : 0.7} metalness={metal ? 0.6 : 0.05} />
    </mesh>
  )
}

function Ball({ position, r = 0.5, color = '#888', sy = 1 }) {
  return (
    <mesh position={position} scale={[1, sy, 1]} castShadow>
      <sphereGeometry args={[r, 20, 16]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  )
}

/** Generic cabinet: plinth, body, top slab, door / drawer seams, handles */
function Cabinet({ w, d, h, color = '#8a6a4a', top = '#6b5038', cols = 2, rows = 1, plinth = 0.2, handle = '#c9b27a' }) {
  const bodyH = h - plinth - 0.1
  return (
    <group>
      <Part position={[0, plinth / 2, 0]} size={[w - 0.2, plinth, d - 0.2]} color="#2c2a28" />
      <Part position={[0, plinth + bodyH / 2, 0]} size={[w, bodyH, d]} color={color} />
      <Part position={[0, h - 0.05, 0]} size={[w + 0.06, 0.1, d + 0.06]} color={top} />
      {Array.from({ length: cols - 1 }, (_, i) => (
        <Part key={`c${i}`} position={[-w / 2 + ((i + 1) * w) / cols, plinth + bodyH / 2, d / 2 + 0.006]}
              size={[0.03, bodyH - 0.1, 0.02]} color="#2b2118" />
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <Part key={`r${i}`} position={[0, plinth + ((i + 1) * bodyH) / rows, d / 2 + 0.006]}
              size={[w - 0.1, 0.03, 0.02]} color="#2b2118" />
      ))}
      {Array.from({ length: cols * rows }, (_, i) => {
        const cx = i % cols
        const ry = Math.floor(i / cols)
        return (
          <Part key={`h${i}`}
            position={[-w / 2 + ((cx + 0.5) * w) / cols, plinth + ((ry + 0.5) * bodyH) / rows, d / 2 + 0.04]}
            size={[Math.min(0.5, (w / cols) * 0.4), 0.07, 0.05]} color={handle} />
        )
      })}
    </group>
  )
}

/** Open shelving: two sides, back and evenly spaced shelves */
function OpenShelf({ w, d, h, shelves = 4, color = '#a3855f' }) {
  return (
    <group>
      <Part position={[-w / 2 + 0.05, h / 2, 0]} size={[0.1, h, d]} color={color} />
      <Part position={[ w / 2 - 0.05, h / 2, 0]} size={[0.1, h, d]} color={color} />
      <Part position={[0, h / 2, -d / 2 + 0.03]} size={[w, h, 0.06]} color="#7d6445" />
      {Array.from({ length: shelves }, (_, i) => (
        <Part key={i} position={[0, 0.1 + (i * (h - 0.2)) / (shelves - 1), 0]} size={[w - 0.1, 0.1, d - 0.05]} color={color} />
      ))}
    </group>
  )
}

const CABINET_STYLES = {
  dresser:       { cols: 2, rows: 3 },
  sideboard:     { cols: 3, rows: 1, color: '#7d5a3c' },
  filingCabinet: { cols: 1, rows: 3, color: '#8d949a', top: '#7a8186', handle: '#444', plinth: 0.1 },
  toyBox:        { cols: 1, rows: 1, color: '#e0854a', top: '#d2693a', plinth: 0.05, handle: '#fff' },
  pantry:        { cols: 2, rows: 2, color: '#cdbfa6', top: '#bfae92' },
  dishwasher:    { cols: 1, rows: 1, color: '#d9dcde', top: '#c9ced1', handle: '#888' },
}

function CabinetModel({ type }) {
  const { width: w, depth: d, height: h } = dimsOf(type)
  return (
    <group>
      <Cabinet w={w} d={d} h={h} {...CABINET_STYLES[type]} />
      {type === 'toyBox' && ['#4fa3e0', '#e8c040', '#6faa3a'].map((c, i) => (
        <Part key={i} position={[-0.6 + i * 0.6, h + 0.2, 0]} size={[0.4, 0.4, 0.4]} color={c} />
      ))}
    </group>
  )
}

function DressingTableModel() {
  const { width: w, depth: d, height: h } = dimsOf('dressingTable')
  return (
    <group>
      <Part position={[0, 2.5, 0]} size={[w, 0.15, d]} color="#8a6a4a" />
      <Part position={[-w / 2 + w * 0.17, 1.35, 0]} size={[w * 0.3, 2.2, d - 0.1]} color="#7d5a3c" />
      {[0.5, 1.2, 1.9].map((y) => (
        <Part key={y} position={[-w / 2 + w * 0.17, y, d / 2 - 0.03]} size={[w * 0.2, 0.05, 0.04]} color="#c9b27a" />
      ))}
      {[[w / 2 - 0.12, 1.2, d / 2 - 0.12], [w / 2 - 0.12, 1.2, -d / 2 + 0.12]].map((p, i) => (
        <Part key={i} position={p} size={[0.15, 2.4, 0.15]} color="#5a4030" />
      ))}
      <Part position={[0, 2.575 + (h - 2.6) / 2, -d / 2 + 0.06]} size={[w * 0.6, h - 2.6, 0.1]} color="#5a4030" />
      <Part position={[0, 2.575 + (h - 2.6) / 2, -d / 2 + 0.12]} size={[w * 0.6 - 0.2, h - 2.8, 0.04]} color="#cfe6ee" />
    </group>
  )
}

function BenchModel() {
  const { width: w, depth: d, height: h } = dimsOf('bench')
  return (
    <group>
      <Part position={[0, h - 0.125, 0]} size={[w, 0.25, d]} color="#7b5238" />
      <Part position={[0, h + 0.02, 0]} size={[w - 0.1, 0.15, d - 0.1]} color="#b8a48a" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Part key={i} position={[sx * (w / 2 - 0.15), (h - 0.25) / 2, sz * (d / 2 - 0.15)]} size={[0.18, h - 0.25, 0.18]} color="#4b3325" />
      ))}
    </group>
  )
}

function ScaledBedModel({ type }) {
  const { width: w, depth: d } = dimsOf(type)
  return (
    <group scale={[w / 5.4, 1, d / 6.4]}>
      <BedModel />
    </group>
  )
}

function CotModel() {
  const { width: w, depth: d, height: h } = dimsOf('cot')
  const bars = Math.round(d / 0.32)
  const barsX = Math.round(w / 0.32)
  return (
    <group>
      <Part position={[0, 0.9, 0]} size={[w - 0.2, 0.12, d - 0.2]} color="#8a6a4a" />
      <Part position={[0, 1.1, 0]} size={[w - 0.3, 0.3, d - 0.3]} color="#f2efe6" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Part key={i} position={[sx * (w / 2 - 0.08), h / 2, sz * (d / 2 - 0.08)]} size={[0.16, h, 0.16]} color="#d9c9ae" />
      ))}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <Part position={[sx * (w / 2 - 0.08), h - 0.1, 0]} size={[0.1, 0.1, d]} color="#d9c9ae" />
          {Array.from({ length: bars }, (_, i) => (
            <Part key={i} position={[sx * (w / 2 - 0.08), 1.9, -d / 2 + 0.3 + (i * (d - 0.6)) / (bars - 1)]} size={[0.05, 1.7, 0.05]} color="#d9c9ae" />
          ))}
        </group>
      ))}
      {[-1, 1].map((sz) => (
        <group key={sz}>
          <Part position={[0, h - 0.1, sz * (d / 2 - 0.08)]} size={[w, 0.1, 0.1]} color="#d9c9ae" />
          {Array.from({ length: barsX }, (_, i) => (
            <Part key={i} position={[-w / 2 + 0.3 + (i * (w - 0.6)) / (barsX - 1), 1.9, sz * (d / 2 - 0.08)]} size={[0.05, 1.7, 0.05]} color="#d9c9ae" />
          ))}
        </group>
      ))}
    </group>
  )
}

function ReclinerModel() {
  const { width: w, depth: d } = dimsOf('recliner')
  return (
    <group>
      <group position={[0, 0, -0.5]} scale={[w / 2.4, 1, (d - 1) / 2.4]}>
        <ArmchairModel />
      </group>
      <Part position={[0, 0.85, d / 2 - 0.55]} size={[w * 0.6, 0.35, 1.0]} color="#6a5a50" />
      <Part position={[0, 0.5, d / 2 - 0.55]} size={[0.3, 0.7, 0.3]} color="#3b3028" />
    </group>
  )
}

function PoufModel() {
  const { width: w, height: h } = dimsOf('pouf')
  return (
    <group>
      <Cyl position={[0, h / 2, 0]} r={w / 2} h={h} color="#b07a5a" />
      <Cyl position={[0, h, 0]} r={w / 2 - 0.08} rt={w / 2 - 0.2} h={0.12} color="#c48a68" />
    </group>
  )
}

function ConsoleTableModel() {
  const { width: w, depth: d, height: h } = dimsOf('consoleTable')
  return (
    <group>
      <Part position={[0, h - 0.075, 0]} size={[w, 0.15, d]} color="#8a6a4a" />
      <Part position={[0, 0.8, 0]} size={[w - 0.3, 0.08, d - 0.2]} color="#7d5a3c" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Part key={i} position={[sx * (w / 2 - 0.15), (h - 0.15) / 2, sz * (d / 2 - 0.12)]} size={[0.12, h - 0.15, 0.12]} color="#4b3325" />
      ))}
    </group>
  )
}

function SectionalModel() {
  const { width: w, depth: d } = dimsOf('sectional')
  const arm = 2.7
  return (
    <group>
      <Part position={[0, 0.85, -d / 2 + arm / 2]} size={[w, 1.1, arm]} color="#6f7a82" />
      <Part position={[w / 2 - arm / 2, 0.85, 0]} size={[arm, 1.1, d]} color="#6f7a82" />
      <Part position={[-arm / 2 - 0.1, 1.55, -d / 2 + arm / 2 + 0.1]} size={[w - arm - 0.5, 0.5, arm - 0.4]} color="#808c94" />
      <Part position={[w / 2 - arm / 2, 1.55, 0.1]} size={[arm - 0.3, 0.5, d - 0.5]} color="#808c94" />
      <Part position={[0, 2.35, -d / 2 + 0.28]} size={[w, 1.9, 0.55]} color="#5f6a72" />
      <Part position={[-w / 2 + 0.25, 1.7, -d / 2 + arm / 2]} size={[0.5, 1.5, arm]} color="#5f6a72" />
      <Part position={[w / 2 - 0.25, 1.7, 0.2]} size={[0.5, 1.5, d - 0.6]} color="#5f6a72" />
    </group>
  )
}

function PlantModel({ type = 'plant' }) {
  const { width: w, height: h } = dimsOf(type)
  const potH = type === 'planter' ? 0.9 : 1.1
  const r = w * 0.34
  return (
    <group>
      {type === 'planter'
        ? <Part position={[0, potH / 2, 0]} size={[w, potH, dimsOf(type).depth]} color="#9a5b3c" />
        : <Cyl position={[0, potH / 2, 0]} r={w * 0.3} rt={w * 0.36} h={potH} color="#9a5b3c" />}
      <Cyl position={[0, potH + (h - potH) / 2 - 0.2, 0]} r={0.05} h={h - potH} color="#4a6a2a" />
      {[[0, h - 0.7, 0, 1], [-0.35, h - 1.4, 0.1, 0.85], [0.35, h - 1.6, -0.1, 0.85], [0.05, h - 2.2, 0.35, 0.75], [-0.1, h - 2.4, -0.35, 0.7]].map(([x, y, z, k], i) => (
        <Ball key={i} position={[x * w * 0.5, Math.max(y, potH + 0.4), z * w * 0.5]} r={r * k} color={i % 2 ? '#3f7a3a' : '#4f8f45'} />
      ))}
    </group>
  )
}

function FloorLampModel() {
  const { height: h } = dimsOf('floorLamp')
  return (
    <group>
      <Cyl position={[0, 0.05, 0]} r={0.35} h={0.1} color="#2b2b2b" metal />
      <Cyl position={[0, h / 2, 0]} r={0.04} h={h - 0.6} color="#bbb" metal />
      <Cyl position={[0, h - 0.5, 0]} r={0.45} rt={0.3} h={0.9} color="#f1e6c8" />
    </group>
  )
}

function ShoeRackModel() {
  const { width: w, depth: d, height: h } = dimsOf('shoeRack')
  return (
    <group>
      <OpenShelf w={w} d={d} h={h} shelves={4} />
      {[-0.7, 0.2, 0.9].map((x, i) => (
        <Part key={i} position={[x * (w / 2.5), 0.75, 0]} size={[0.45, 0.3, 0.8]} color={['#3a4a6a', '#6a3a3a', '#444'][i]} />
      ))}
    </group>
  )
}

function ShelfUnitModel() {
  const { width: w, depth: d, height: h } = dimsOf('shelfUnit')
  return (
    <group>
      <OpenShelf w={w} d={d} h={h} shelves={5} color="#9aa3a8" />
      {[0.1, 1.8, 3.5].map((y, i) => (
        <Part key={i} position={[-0.6 + i * 0.5, y + 0.45, 0]} size={[0.7, 0.7, d - 0.4]} color={['#c9a97a', '#b88a5a', '#d6c19a'][i]} />
      ))}
    </group>
  )
}

function GlassUnitModel({ type }) {
  const { width: w, depth: d, height: h } = dimsOf(type)
  const lowerH = type === 'displayUnit' ? h * 0.3 : h * 0.38
  const upperH = h - lowerH
  const shelfN = 3
  return (
    <group>
      <Cabinet w={w} d={d} h={lowerH} cols={type === 'displayUnit' ? 2 : 3} rows={1} color="#7d5a3c" />
      <Part position={[-w / 2 + 0.05, lowerH + upperH / 2, 0]} size={[0.1, upperH, d - 0.1]} color="#6b5038" />
      <Part position={[ w / 2 - 0.05, lowerH + upperH / 2, 0]} size={[0.1, upperH, d - 0.1]} color="#6b5038" />
      <Part position={[0, lowerH + upperH / 2, -d / 2 + 0.05]} size={[w - 0.1, upperH, 0.08]} color="#5a4030" />
      <Part position={[0, h - 0.05, 0]} size={[w + 0.06, 0.1, d]} color="#6b5038" />
      {Array.from({ length: shelfN }, (_, i) => {
        const y = lowerH + 0.05 + (i * (upperH - 0.2)) / shelfN + 0.3
        return (
          <group key={i}>
            <Part position={[0, y, 0]} size={[w - 0.2, 0.06, d - 0.2]} color="#a68a68" />
            <Part position={[-w * 0.2, y + 0.3, 0]} size={[0.6, 0.5, 0.6]} color={['#e8e2d6', '#c9d9e4', '#e8d5c9'][i % 3]} />
            <Part position={[ w * 0.2, y + 0.25, 0]} size={[0.8, 0.4, 0.5]} color={['#d9c9ae', '#e4d0d0', '#d0dcd0'][i % 3]} />
          </group>
        )
      })}
      <Part position={[0, lowerH + upperH / 2, d / 2 - 0.03]} size={[w - 0.1, upperH - 0.1, 0.04]} color="#cfe6ee" opacity={0.25} />
    </group>
  )
}

function BarStoolModel() {
  const { width: w, height: h } = dimsOf('barStool')
  return (
    <group>
      <Cyl position={[0, h - 0.1, 0]} r={w / 2} h={0.2} color="#3a3a3a" />
      <Cyl position={[0, h - 0.25, 0]} r={w / 2 - 0.05} h={0.1} color="#222" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Part key={i} position={[sx * w * 0.3, (h - 0.3) / 2, sz * w * 0.3]} size={[0.07, h - 0.3, 0.07]} color="#aaa" />
      ))}
      <Cyl position={[0, 0.8, 0]} r={w * 0.35} rt={w * 0.35} h={0.05} color="#aaa" metal />
    </group>
  )
}

function StoveModel() {
  const { width: w, depth: d, height: h } = dimsOf('stove')
  const baseH = 3
  return (
    <group>
      <Cabinet w={w} d={d} h={baseH} cols={2} rows={1} color="#2f3336" top="#1c1e20" handle="#c0c0c0" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <group key={i}>
          <Cyl position={[sx * w * 0.22, baseH + 0.04, sz * d * 0.2]} r={0.3} h={0.06} color="#111" />
          <Cyl position={[sx * w * 0.22, baseH + 0.08, sz * d * 0.2]} r={0.12} h={0.05} color="#444" metal />
        </group>
      ))}
      {[-0.7, -0.25, 0.25, 0.7].map((x) => (
        <Cyl key={x} position={[x * (w / 2) * 0.9, 2.2, d / 2 + 0.05]} r={0.08} h={0.1} rotation={[Math.PI / 2, 0, 0]} color="#bbb" metal />
      ))}
      <group position={[0, 5.35, 0]} scale={[w, 1, d - 0.1]}>
        <mesh rotation={[0, Math.PI / 4, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.7071, 0.9, 4]} />
          <meshStandardMaterial color="#b9bec2" metalness={0.6} roughness={0.3} />
        </mesh>
      </group>
      <Part position={[0, 4.95, 0.05]} size={[w - 0.2, 0.1, d - 0.4]} color="#8d9296" />
      <Part position={[0, 5.75 + (h - 5.75) / 2, -d / 2 + 0.55]} size={[0.9, h - 5.75, 0.9]} color="#a9aeb2" />
    </group>
  )
}

function KitchenSinkModel() {
  const { width: w, depth: d, height: h } = dimsOf('kitchenSink')
  return (
    <group>
      <Cabinet w={w} d={d} h={h} cols={2} rows={1} color="#d8cdb8" top="#bdb7ab" handle="#999" />
      <Part position={[0, h + 0.01, 0.05]} size={[w * 0.55, 0.04, d * 0.6]} color="#aeb6bb" />
      <Part position={[0, h + 0.035, 0.05]} size={[w * 0.5, 0.02, d * 0.52]} color="#8f979c" />
      <Cyl position={[0, h + 0.4, -d / 2 + 0.25]} r={0.045} h={0.8} color="#c0c0c0" metal />
      <Part position={[0, h + 0.78, -d / 2 + 0.45]} size={[0.07, 0.07, 0.45]} color="#c0c0c0" />
    </group>
  )
}

function TrashBinModel() {
  const { width: w, height: h } = dimsOf('trashBin')
  return (
    <group>
      <Cyl position={[0, h / 2, 0]} r={w / 2 - 0.05} rt={w / 2} h={h} color="#9aa3a8" metal />
      <Cyl position={[0, h + 0.04, 0]} r={w / 2 + 0.02} h={0.1} color="#6f777c" metal />
      <Part position={[0, h + 0.14, 0]} size={[0.25, 0.08, 0.08]} color="#444" />
    </group>
  )
}

function VanityModel() {
  const { width: w, depth: d, height: h } = dimsOf('vanity')
  return (
    <group>
      <Cabinet w={w} d={d} h={h} cols={2} rows={1} color="#e9e4da" top="#d6d6d6" handle="#aaa" />
      <Part position={[0, h + 0.07, 0.1]} size={[w * 0.5, 0.14, d * 0.6]} color="#f5f5f5" />
      <Part position={[0, h + 0.15, 0.1]} size={[w * 0.4, 0.02, d * 0.46]} color="#dcedf5" />
      <Cyl position={[0, h + 0.3, -d / 2 + 0.2]} r={0.04} h={0.5} color="#c0c0c0" metal />
      <Part position={[0, h + 0.52, -d / 2 + 0.35]} size={[0.06, 0.06, 0.3]} color="#c0c0c0" />
    </group>
  )
}

function TowelRackModel() {
  const { width: w, depth: d, height: h } = dimsOf('towelRack')
  return (
    <group>
      <Part position={[0, h - 0.3, d / 2 - 0.04]} size={[w, 0.12, 0.08]} color="#b8b8b8" />
      {[-1, 1].map((s) => (
        <Part key={s} position={[s * (w / 2 - 0.1), h - 0.3, 0]} size={[0.06, 0.06, d]} color="#b8b8b8" />
      ))}
      <Part position={[0, h - 0.3, -d / 2 + 0.03]} size={[w, 0.06, 0.06]} color="#c8c8c8" />
      <Part position={[0, (h - 0.3) / 2 + 0.1, -d / 2 + 0.1]} size={[w * 0.8, h - 0.55, 0.08]} color="#7fb2c9" />
      <Part position={[0, (h - 0.3) / 2 + 0.1, -d / 2 + 0.05]} size={[w * 0.8, 0.12, 0.1]} color="#5f93ab" />
    </group>
  )
}

function BathroomShelfModel() {
  const { width: w, depth: d, height: h } = dimsOf('bathroomShelf')
  return (
    <group rotation={[0, Math.PI, 0]}>
      <Cabinet w={w} d={d} h={h} cols={2} rows={1} plinth={0.01} color="#f0f0ee" top="#e0e0e0" handle="#aaa" />
    </group>
  )
}

function WhiteboardModel() {
  const { width: w, depth: d, height: h } = dimsOf('whiteboard')
  return (
    <group>
      <Part position={[0, h / 2, 0]} size={[w, h, d]} color="#8a8f94" />
      <Part position={[0, h / 2, -d / 2 - 0.005]} size={[w - 0.2, h - 0.2, 0.02]} color="#fbfbfb" />
      <Part position={[0, 0.06, -d / 2 - 0.08]} size={[w * 0.5, 0.06, 0.15]} color="#6f757a" />
      <Part position={[-w * 0.15, 0.13, -d / 2 - 0.08]} size={[0.3, 0.05, 0.05]} color="#d9553a" />
      <Part position={[ w * 0.1, 0.13, -d / 2 - 0.08]} size={[0.3, 0.05, 0.05]} color="#3a6fb0" />
    </group>
  )
}

function CoatRackModel() {
  const { width: w, depth: d, height: h } = dimsOf('coatRack')
  const hooks = Math.max(3, Math.round(w / 0.75))
  const xs = Array.from({ length: hooks }, (_, i) => -w / 2 + 0.35 + (i * (w - 0.7)) / (hooks - 1))
  return (
    <group>
      <Part position={[0, h - 0.25, d / 2 - 0.05]} size={[w, 0.5, 0.1]} color="#7b5238" />
      {xs.map((x, i) => (
        <group key={i}>
          <Part position={[x, h - 0.25, d / 2 - 0.25]} size={[0.07, 0.07, 0.3]} color="#c0c0c0" />
          {i % 2 === 0 && (
            <Part position={[x, h - 0.95, d / 2 - 0.3]} size={[0.5, 1.1, 0.14]} color={['#3a4a6a', '#6a3a3a', '#4a6a4a'][i % 3]} />
          )}
        </group>
      ))}
    </group>
  )
}

function ACUnitModel() {
  const { width: w, depth: d, height: h } = dimsOf('acUnit')
  return (
    <group>
      <Part position={[0, h / 2, 0]} size={[w, h, d]} color="#eceff1" />
      <Part position={[0, h * 0.2, -d / 2 - 0.01]} size={[w - 0.3, 0.06, 0.04]} color="#9aa3a8" />
      <Part position={[0, h * 0.8, -d / 2 - 0.01]} size={[w - 0.3, 0.02, 0.02]} color="#cfd4d7" />
      <Part position={[w / 2 - 0.35, h * 0.55, -d / 2 - 0.01]} size={[0.12, 0.06, 0.02]} color="#4fc3f7" />
    </group>
  )
}

function ClockModel() {
  const { width: w } = dimsOf('clock')
  return (
    <group>
      <Cyl position={[0, w / 2, 0]} r={w / 2} h={0.12} color="#333" rotation={[Math.PI / 2, 0, 0]} />
      <Cyl position={[0, w / 2, -0.04]} r={w / 2 - 0.08} h={0.06} color="#f4f4f0" rotation={[Math.PI / 2, 0, 0]} />
      <Part position={[0, w / 2 + w * 0.15, -0.09]} size={[0.05, w * 0.32, 0.02]} color="#222" />
      <Part position={[w * 0.12, w / 2, -0.09]} size={[w * 0.26, 0.04, 0.02]} color="#222" />
    </group>
  )
}

function WallShelfModel() {
  const { width: w, depth: d } = dimsOf('wallShelf')
  return (
    <group>
      <Part position={[0, 0.3, 0]} size={[w, 0.08, d]} color="#8a6a4a" />
      {[-1, 1].map((s) => (
        <Part key={s} position={[s * (w / 2 - 0.3), 0.12, d / 2 - 0.2]} size={[0.06, 0.2, d * 0.5]} color="#444" />
      ))}
      <Part position={[-w * 0.25, 0.55, 0]} size={[0.5, 0.45, 0.4]} color="#d9553a" />
      <Part position={[ w * 0.1,  0.5, 0]}  size={[0.35, 0.35, 0.35]} color="#e8e2d6" />
      <Part position={[ w * 0.3,  0.55, 0]} size={[0.4, 0.45, 0.3]} color="#3a6fb0" />
    </group>
  )
}


function BeanBagModel() {
  const { width: w, height: h } = dimsOf('beanBag')
  return (
    <group>
      <Ball position={[0, h * 0.5, 0]} r={w / 2} sy={h / w} color="#d9553a" />
      <Ball position={[0, h * 0.78, -w * 0.18]} r={w * 0.3} sy={0.9} color="#e0654a" />
    </group>
  )
}

function PlayTableModel() {
  const { width: w, depth: d, height: h } = dimsOf('playTable')
  return (
    <group>
      <Part position={[0, h - 0.075, 0]} size={[w, 0.15, d]} color="#f2c14e" />
      {[[-1, -1, '#d9553a'], [1, -1, '#3a6fb0'], [-1, 1, '#6faa3a'], [1, 1, '#d9553a']].map(([sx, sz, c], i) => (
        <Part key={i} position={[sx * (w / 2 - 0.2), (h - 0.15) / 2, sz * (d / 2 - 0.2)]} size={[0.22, h - 0.15, 0.22]} color={c} />
      ))}
    </group>
  )
}

function OutdoorChairModel() {
  const { width: w, depth: d, height: h } = dimsOf('outdoorChair')
  return (
    <group scale={[w / 1.5, h / 4.3, d / 1.5]}>
      <DiningChairModel />
    </group>
  )
}

function OutdoorTableModel() {
  const { width: w, height: h } = dimsOf('outdoorTable')
  return (
    <group>
      <Cyl position={[0, h - 0.06, 0]} r={w / 2} h={0.12} color="#5b6b4a" />
      <Cyl position={[0, (h - 0.12) / 2, 0]} r={0.1} h={h - 0.12} color="#3d3d3d" metal />
      <Cyl position={[0, 0.04, 0]} r={0.6} h={0.08} color="#3d3d3d" metal />
    </group>
  )
}

function ClothesRackModel() {
  const { width: w, depth: d, height: h } = dimsOf('clothesRack')
  return (
    <group>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Part key={i} position={[sx * (w / 2 - 0.05), h / 2, sz * (d / 2 - 0.05)]} size={[0.08, h, 0.08]} color="#c0c0c0" />
      ))}
      {[-1, 1].map((sz) => (
        <Part key={sz} position={[0, h - 0.05, sz * (d / 2 - 0.05)]} size={[w, 0.07, 0.07]} color="#c0c0c0" />
      ))}
      {[-0.75, -0.25, 0.25, 0.75].map((k) => (
        <Part key={k} position={[k * (w / 2 - 0.2), h - 0.05, 0]} size={[0.05, 0.05, d]} color="#c0c0c0" />
      ))}
      {[[-0.5, '#3a6fb0'], [0, '#e8e2d6'], [0.5, '#d9553a']].map(([k, c]) => (
        <Part key={c} position={[k * (w / 2 - 0.2), h - 1.0, 0]} size={[0.35, 1.8, 0.6]} color={c} />
      ))}
    </group>
  )
}

function DryerModel() {
  const { width: w, depth: d, height: h } = dimsOf('dryer')
  return (
    <group>
      <Part position={[0, h / 2, 0]} size={[w, h, d]} color="#e6e8ea" />
      <Part position={[0, h - 0.3, d / 2 + 0.01]} size={[w - 0.2, 0.5, 0.03]} color="#c9ced1" />
      <Cyl position={[0, h * 0.42, d / 2 + 0.02]} r={w * 0.32} h={0.08} rotation={[Math.PI / 2, 0, 0]} color="#7aa2b8" metal />
      <Cyl position={[0, h * 0.42, d / 2 + 0.06]} r={w * 0.24} h={0.06} rotation={[Math.PI / 2, 0, 0]} color="#bcd7e4" />
      <Cyl position={[w * 0.3, h - 0.3, d / 2 + 0.06]} r={0.12} h={0.08} rotation={[Math.PI / 2, 0, 0]} color="#888" />
    </group>
  )
}

function PoojaUnitModel() {
  const { width: w, depth: d, height: h } = dimsOf('poojaUnit')
  const baseH = 2.6
  const altarH = h - baseH - 0.4
  return (
    <group>
      <Cabinet w={w} d={d} h={baseH} cols={2} rows={1} color="#8a5a32" top="#6b4020" />
      {[-1, 1].map((s) => (
        <Part key={s} position={[s * (w / 2 - 0.1), baseH + altarH / 2, 0]} size={[0.2, altarH, d - 0.2]} color="#a06a3a" />
      ))}
      <Part position={[0, baseH + altarH / 2, -d / 2 + 0.08]} size={[w - 0.2, altarH, 0.1]} color="#7d4a22" />
      <Part position={[0, h - 0.25, 0]} size={[w + 0.2, 0.3, d]} color="#a06a3a" />
      <Part position={[0, h + 0.05, 0]} size={[w * 0.5, 0.3, d * 0.5]} color="#b87a44" />
      <Cyl position={[0, baseH + 0.5, -0.1]} r={0.28} rt={0.06} h={0.85} color="#d4af62" metal />
      <Cyl position={[w * 0.28, baseH + 0.15, 0.3]} r={0.12} h={0.15} color="#d4af62" metal />
      <Ball position={[w * 0.28, baseH + 0.32, 0.3]} r={0.05} color="#ffb347" />
    </group>
  )
}

function TreadmillModel() {
  const { width: w, depth: d } = dimsOf('treadmill')
  return (
    <group>
      <Part position={[0, 0.4, 0.2]} size={[w, 0.4, d - 0.8]} color="#2b2e30" />
      <Part position={[0, 0.63, 0.2]} size={[w - 0.6, 0.06, d - 1.2]} color="#161616" />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Part position={[s * (w / 2 - 0.15), 2.3, -d / 2 + 0.7]} size={[0.12, 3.6, 0.12]} color="#8d949a" />
          <Part position={[s * (w / 2 - 0.15), 3.2, -d / 2 + 1.5]} size={[0.1, 0.1, 1.6]} color="#444" />
        </group>
      ))}
      <Part position={[0, 4.0, -d / 2 + 0.8]} size={[w - 0.5, 0.7, 0.2]} color="#1f2224" />
      <Part position={[0, 4.02, -d / 2 + 0.68]} size={[w - 0.9, 0.45, 0.03]} color="#4fc3f7" />
    </group>
  )
}

function WeightBenchModel() {
  const { width: w, depth: d, height: h } = dimsOf('weightBench')
  return (
    <group>
      <Part position={[0, 1.4, 0.3]} size={[1.0, 0.3, d * 0.62]} color="#2b2e30" />
      <Part position={[0, 1.2, 0.3]} size={[0.3, 0.1, d * 0.6]} color="#8d949a" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Part key={i} position={[sx * 0.4, 0.65, 0.3 + sz * d * 0.25]} size={[0.1, 1.3, 0.1]} color="#8d949a" />
      ))}
      {[-1, 1].map((s) => (
        <Part key={s} position={[s * 0.85, h / 2, -d / 2 + 0.5]} size={[0.1, h, 0.1]} color="#8d949a" />
      ))}
      <Part position={[0, h - 0.5, -d / 2 + 0.5]} size={[w, 0.06, 0.06]} color="#c0c0c0" />
      {[-1, 1].map((s) => (
        <Cyl key={s} position={[s * (w / 2 - 0.12), h - 0.5, -d / 2 + 0.5]} r={0.45} h={0.12} rotation={[0, 0, Math.PI / 2]} color="#222" />
      ))}
    </group>
  )
}

function ExerciseBikeModel() {
  const { width: w, depth: d, height: h } = dimsOf('exerciseBike')
  return (
    <group>
      <Part position={[0, 0.1, 0]} size={[w, 0.2, 0.2]} color="#2b2e30" />
      <Part position={[0, 0.1, -d / 2 + 0.3]} size={[w, 0.2, 0.2]} color="#2b2e30" />
      <Part position={[0, 0.1, d / 2 - 0.3]} size={[w, 0.2, 0.2]} color="#2b2e30" />
      <Part position={[0, 0.2 + (d - 0.6) / 2 * 0, 0]} size={[0.25, 0.2, d - 0.4]} color="#d9553a" />
      <Cyl position={[0, 1.1, -d / 2 + 0.8]} r={0.7} h={0.3} rotation={[0, 0, Math.PI / 2]} color="#444" />
      <Part position={[0, 1.6, -0.2]} size={[0.15, 2.2, 0.15]} color="#8d949a" rotation={[0.25, 0, 0]} />
      <Part position={[0, h - 0.7, d / 2 - 1.1]} size={[0.8, 0.2, 0.8]} color="#222" />
      <Part position={[0, h - 0.1, -d / 2 + 0.8]} size={[w * 0.9, 0.1, 0.1]} color="#444" />
      <Part position={[0, h - 0.7, -d / 2 + 0.8]} size={[0.14, 1.3, 0.14]} color="#8d949a" />
    </group>
  )
}

/* =====================================================
   MORE FURNITURE: bunk bed, window AC, round tables,
   computer lab, classroom
===================================================== */

function BunkBedModel() {
  const { width: w, depth: d, height: h } = dimsOf('bunkBed')
  const wood = '#a47148'
  const lowY = 1.3
  const upY = 3.55
  return (
    <group>
      {/* corner posts */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Part key={i} position={[sx * (w / 2 - 0.1), h / 2, sz * (d / 2 - 0.1)]} size={[0.2, h, 0.2]} color={wood} />
      ))}
      {/* two bunks: frame + mattress + pillow */}
      {[lowY, upY].map((y, i) => (
        <group key={y}>
          <Part position={[0, y, 0]} size={[w - 0.2, 0.2, d - 0.2]} color="#8a5a32" />
          <Part position={[0, y + 0.32, 0.05]} size={[w - 0.4, 0.45, d - 0.5]} color={i ? '#f2c14e' : '#6fa8dc'} />
          <Part position={[0, y + 0.64, -d / 2 + 0.7]} size={[w - 1.1, 0.2, 0.85]} color="#f4f1ea" />
        </group>
      ))}
      {/* headboards */}
      <Part position={[0, lowY + 0.75, -d / 2 + 0.06]} size={[w - 0.2, 1.1, 0.1]} color={wood} />
      <Part position={[0, upY + 0.75, -d / 2 + 0.06]} size={[w - 0.2, 1.1, 0.1]} color={wood} />
      {/* top-bunk guard rails (gap at the ladder end) */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Part position={[s * (w / 2 - 0.05), upY + 0.95, -0.9]} size={[0.08, 0.1, d - 2.3]} color={wood} />
          <Part position={[s * (w / 2 - 0.05), upY + 0.65, -0.9]} size={[0.08, 0.1, d - 2.3]} color={wood} />
        </group>
      ))}
      <Part position={[0, upY + 0.95, d / 2 - 0.1]} size={[w - 0.2, 0.1, 0.08]} color={wood} />
      {/* ladder at the foot end */}
      {[-0.5, 0.5].map((x) => (
        <Part key={x} position={[x, upY / 2 + 0.2, d / 2 + 0.02]} size={[0.1, upY + 0.4, 0.1]} color="#c4925c" />
      ))}
      {[0.6, 1.3, 2.0, 2.7].map((y) => (
        <Part key={y} position={[0, y, d / 2 + 0.02]} size={[1.0, 0.08, 0.1]} color="#c4925c" />
      ))}
    </group>
  )
}

function WindowAcModel() {
  const { width: w, depth: d, height: h } = dimsOf('windowAc')
  return (
    <group>
      {/* indoor body */}
      <Part position={[0, h / 2, d / 2 - (d * 0.6) / 2]} size={[w, h, d * 0.6]} color="#e9ecee" />
      {/* front bezel + grille */}
      <Part position={[0, h / 2, -d / 2 + 0.2]} size={[w + 0.12, h + 0.08, 0.4]} color="#f4f6f7" />
      <Part position={[0, h * 0.62, -d / 2 - 0.01]} size={[w * 0.78, 0.07, 0.04]} color="#8e979c" />
      {[0.34, 0.26, 0.18].map((k) => (
        <Part key={k} position={[0, h * k + 0.08, -d / 2 - 0.01]} size={[w * 0.78, 0.035, 0.03]} color="#b3bbc0" />
      ))}
      <Part position={[w / 2 - 0.4, h * 0.8, -d / 2 - 0.02]} size={[0.28, 0.07, 0.03]} color="#4fc3f7" />
      {/* part of the unit that sticks out through the window */}
      <Part position={[0, h / 2 - 0.05, d / 2 + 0.3]} size={[w - 0.25, h - 0.15, 0.6]} color="#b8bec2" />
    </group>
  )
}

function RoundTableModel({ type }) {
  const { width: w, height: h } = dimsOf(type)
  const style = {
    roundTable:       { top: '#8a6a4a', base: '#5a4030', rb: 0.22 },
    roundCoffeeTable: { top: '#ddd6ca', base: '#2f2f31', rb: 0.2 },
    roundSideTable:   { top: '#3a3a3d', base: '#b9b9bd', rb: 0.28 },
  }[type]
  return (
    <group>
      <Cyl position={[0, h - 0.06, 0]} r={w / 2} h={0.12} color={style.top} />
      <Cyl position={[0, h - 0.14, 0]} r={w / 2 - 0.1} h={0.04} color={style.base} />
      <Cyl position={[0, (h - 0.12) / 2, 0]} r={w * 0.07 + 0.04} h={h - 0.12} color={style.base} metal={type !== 'roundTable'} />
      <Cyl position={[0, 0.05, 0]} r={w * style.rb + 0.2} h={0.1} color={style.base} metal={type !== 'roundTable'} />
    </group>
  )
}

/** Long attached PC desk like in a computer lab: blue frame, white top, monitors, keyboards, CPUs */
function PcRowModel({ type }) {
  const { width: w, depth: d } = dimsOf(type)
  const seats = Math.max(1, Math.round(w / 2.6))
  const sw = w / seats
  const topY = 2.5
  const blue = '#2a62c9'
  const seatX = (i) => -w / 2 + (i + 0.5) * sw
  return (
    <group>
      {/* desk top and back panel */}
      <Part position={[0, topY, 0]} size={[w, 0.12, d]} color="#f1f3f4" />
      <Part position={[0, topY + 0.55, -d / 2 + 0.03]} size={[w, 0.95, 0.05]} color="#e3eaee" />
      {/* side panels / dividers, one at each end and between seats */}
      {Array.from({ length: seats + 1 }, (_, i) => {
        const x = -w / 2 + i * sw
        const inner = Math.min(w / 2 - 0.04, Math.max(-w / 2 + 0.04, x))
        return (
          <group key={i}>
            <Part position={[inner, topY / 2 - 0.05, 0]} size={[0.07, topY - 0.1, d - 0.1]} color={blue} />
            {i > 0 && i < seats && <Part position={[x, topY + 0.45, -d / 4 - 0.1]} size={[0.05, 0.8, d / 2]} color="#e3eaee" />}
          </group>
        )
      })}
      {/* keyboard tray + floor shelf */}
      <Part position={[0, 2.1, 0.1]} size={[w - 0.2, 0.05, d * 0.7]} color={blue} />
      <Part position={[0, 0.35, 0]} size={[w - 0.2, 0.05, d - 0.2]} color={blue} />
      {/* seats */}
      {Array.from({ length: seats }, (_, i) => (
        <group key={i} position={[seatX(i), 0, 0]}>
          {/* monitor */}
          <Part position={[0, topY + 0.08, -0.35]} size={[0.55, 0.04, 0.4]} color="#202326" />
          <Part position={[0, topY + 0.28, -0.4]} size={[0.07, 0.4, 0.07]} color="#202326" />
          <Part position={[0, topY + 0.85, -0.42]} size={[1.5, 0.9, 0.07]} color="#15181b" />
          <Part position={[0, topY + 0.85, -0.375]} size={[1.38, 0.78, 0.02]} color="#3b4a66" />
          {/* keyboard + mouse on the tray */}
          <Part position={[-0.1, 2.15, 0.3]} size={[1.0, 0.04, 0.34]} color="#f6f6f6" />
          <Part position={[0.75, 2.15, 0.3]} size={[0.14, 0.04, 0.22]} color="#2d2f33" />
          {/* CPU tower */}
          <Part position={[sw * 0.28, 1.1, -0.15]} size={[0.62, 1.4, 1.3]} color="#2d2f33" />
          <Part position={[sw * 0.28, 1.5, 0.52]} size={[0.3, 0.04, 0.03]} color="#6fe08a" />
        </group>
      ))}
    </group>
  )
}

function LabChairModel() {
  const { width: w, depth: d } = dimsOf('labChair')
  const c = '#c98a52'
  return (
    <group>
      <Part position={[0, 1.5, 0.05]} size={[w - 0.3, 0.12, d - 0.3]} color={c} />
      <Part position={[0, 2.25, -d / 2 + 0.25]} size={[w - 0.3, 1.2, 0.1]} color={c} rotation={[-0.12, 0, 0]} />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Part key={i} position={[sx * (w / 2 - 0.25), 0.72, sz * (d / 2 - 0.3)]} size={[0.1, 1.45, 0.1]} color="#b07a45" />
      ))}
      <Part position={[0, 0.5, -0.05]} size={[w - 0.4, 0.06, 0.06]} color="#b07a45" />
    </group>
  )
}

/** Desk with an attached bench, like the steel-frame college benches. Students face +z. */
function CollegeBenchModel({ type }) {
  const { width: w, depth: d } = dimsOf(type)
  const blue = '#2f6fd6'
  const frame = '#f1ebe0'
  const deskZ = d / 2 - 0.725   // desk top spans d/2-1.45 .. d/2
  const seatZ = -d / 2 + 0.6
  const legCount = Math.round(w / 2) >= 3 ? 3 : 2
  return (
    <group>
      {/* desk */}
      <Part position={[0, 2.4, deskZ]} size={[w, 0.12, 1.45]} color={blue} />
      <Part position={[0, 1.35, deskZ + 0.05]} size={[w - 0.3, 0.05, 1.1]} color="#d8d2c4" />
      <Part position={[0, 1.55, deskZ - 0.5]} size={[w - 0.3, 0.3, 0.04]} color="#d8d2c4" />
      {/* bench seat + backrest */}
      <Part position={[0, 1.5, seatZ]} size={[w, 0.1, 1.0]} color={blue} />
      <Part position={[0, 2.25, -d / 2 + 0.06]} size={[w, 0.85, 0.07]} color={blue} rotation={[-0.08, 0, 0]} />
      {/* steel frame: legs at both ends (and the middle of long benches) */}
      {Array.from({ length: legCount }, (_, i) => {
        const x = -w / 2 + 0.12 + (i * (w - 0.24)) / (legCount - 1)
        return (
          <group key={i}>
            <Part position={[x, 1.2, d / 2 - 0.15]} size={[0.07, 2.4, 0.07]} color={frame} />
            <Part position={[x, 0.75, seatZ + 0.2]} size={[0.07, 1.5, 0.07]} color={frame} />
            <Part position={[x, 2.1, -d / 2 + 0.1]} size={[0.07, 1.7, 0.07]} color={frame} />
            <Part position={[x, 0.3, 0]} size={[0.06, 0.06, d - 0.3]} color={frame} />
          </group>
        )
      })}
      <Part position={[0, 0.3, d / 2 - 0.15]} size={[w, 0.06, 0.06]} color={frame} />
      <Part position={[0, 0.3, seatZ + 0.2]} size={[w, 0.06, 0.06]} color={frame} />
    </group>
  )
}

/** Professor's desk: drawer pedestals on the teacher's side (-z), modesty panel facing the class (+z) */
function TeacherDeskModel() {
  const { width: w, depth: d } = dimsOf('teacherDesk')
  const wood = '#8a6a4a'
  return (
    <group>
      <Part position={[0, 2.5, 0]} size={[w + 0.1, 0.12, d + 0.1]} color="#6b5038" />
      <Part position={[0, 1.2, d / 2 - 0.1]} size={[w - 0.2, 2.35, 0.06]} color={wood} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Part position={[s * (w / 2 - 0.8), 1.2, -0.05]} size={[1.4, 2.35, d - 0.3]} color={wood} />
          {[0.5, 1.2, 1.9].map((y) => (
            <group key={y}>
              <Part position={[s * (w / 2 - 0.8), y, -d / 2 + 0.17]} size={[1.25, 0.6, 0.03]} color="#7a5a3c" />
              <Part position={[s * (w / 2 - 0.8), y, -d / 2 + 0.12]} size={[0.5, 0.05, 0.05]} color="#c9b27a" />
            </group>
          ))}
        </group>
      ))}
      <Part position={[0, 2.57, 0.3]} size={[1.0, 0.03, 0.7]} color="#2a2a2a" />
    </group>
  )
}

function PodiumModel() {
  const { width: w, depth: d, height: h } = dimsOf('podium')
  return (
    <group>
      <Part position={[0, (h - 0.5) / 2, 0]} size={[w - 0.2, h - 0.5, d - 0.2]} color="#7b5238" />
      <Part position={[0, h - 0.4, -0.05]} size={[w, 0.12, d]} color="#5a4030" rotation={[-0.3, 0, 0]} />
      <Part position={[0, h - 1.2, d / 2 - 0.08]} size={[w * 0.5, 0.8, 0.04]} color="#d4af62" />
      <Part position={[0, 0.1, 0]} size={[w, 0.2, d]} color="#3b2a1e" />
    </group>
  )
}

function ClassBoardModel() {
  const { width: w, depth: d, height: h } = dimsOf('classBoard')
  return (
    <group>
      <Part position={[0, h / 2, 0]} size={[w, h, d]} color="#8a8f94" />
      <Part position={[0, h / 2, -d / 2 - 0.005]} size={[w - 0.2, h - 0.2, 0.02]} color="#fbfbfb" />
      <Part position={[-w * 0.17, h / 2, -d / 2 - 0.012]} size={[0.03, h - 0.2, 0.01]} color="#c9ced1" />
      <Part position={[ w * 0.17, h / 2, -d / 2 - 0.012]} size={[0.03, h - 0.2, 0.01]} color="#c9ced1" />
      <Part position={[0, 0.06, -d / 2 - 0.1]} size={[w - 0.4, 0.07, 0.2]} color="#6f757a" />
      <Part position={[-w * 0.2, 0.14, -d / 2 - 0.1]} size={[0.35, 0.06, 0.06]} color="#d9553a" />
      <Part position={[ w * 0.1, 0.14, -d / 2 - 0.1]} size={[0.35, 0.06, 0.06]} color="#3a6fb0" />
    </group>
  )
}

function NoticeBoardModel() {
  const { width: w, depth: d, height: h } = dimsOf('noticeBoard')
  return (
    <group>
      <Part position={[0, h / 2, 0]} size={[w, h, d]} color="#7b5238" />
      <Part position={[0, h / 2, -d / 2 - 0.005]} size={[w - 0.2, h - 0.2, 0.02]} color="#1e3a8a" />
      {[[-0.28, 0.3, '#f6e05e'], [0.05, 0.12, '#f4f1ea'], [0.3, 0.25, '#f6e05e'], [-0.05, -0.2, '#e8a0b8'], [0.28, -0.22, '#f4f1ea']].map(([x, y, c], i) => (
        <Part key={i} position={[x * w * 0.8, h / 2 + y * h * 0.8, -d / 2 - 0.02]} size={[0.55, 0.45, 0.01]} color={c} />
      ))}
    </group>
  )
}

/** Properly built kitchen unit: base cabinet + counter + backsplash + wall cabinet fixed to the wall.
 *  Front faces -z; the wall is behind it (+z). */
function KitchenCabinetModel() {
  const { width: w, depth: d } = dimsOf('kitchenCabinet', { width: 3, depth: 1.5, height: 5.6 })
  const baseH = 2.95
  const plinthH = 0.34
  const upD = 0.95
  const upBot = 4.0
  const upTop = 5.55
  const body = '#e9e4da'
  const door = '#f3efe7'
  const steel = '#b9bec2'
  const dw = (w - 0.14) / 2 - 0.02  // one door's width
  return (
    <group rotation={[0, Math.PI, 0]}>
      {/* everything below is built front = +z, wall = -z, then the group is turned around */}
      <Part position={[0, plinthH / 2, -0.05]} size={[w - 0.1, plinthH, d - 0.2]} color="#2c2a28" />
      <Part position={[0, plinthH + (baseH - plinthH) / 2, 0]} size={[w, baseH - plinthH, d]} color={body} />
      {/* drawer + two doors */}
      <Part position={[0, 2.65, d / 2 + 0.015]} size={[w - 0.1, 0.55, 0.04]} color={door} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Part position={[s * (dw / 2 + 0.03), 1.35, d / 2 + 0.015]} size={[dw, 1.9, 0.04]} color={door} />
          <Part position={[s * 0.14, 1.95, d / 2 + 0.06]} size={[0.045, 0.5, 0.045]} color={steel} />
        </group>
      ))}
      <Part position={[0, 2.65, d / 2 + 0.07]} size={[0.7, 0.045, 0.045]} color={steel} />
      {/* counter top (front overhang), backsplash */}
      <Part position={[0, baseH + 0.06, 0.04]} size={[w + 0.04, 0.12, d + 0.1]} color="#cfc9bf" />
      <Part position={[0, baseH + 0.62, -d / 2 + 0.03]} size={[w, 1.0, 0.05]} color="#ece8df" />
      {/* countertop props */}
      <Cyl position={[-w * 0.3, baseH + 0.32, -0.3]} r={0.13} h={0.4} color="#c9a97a" />
      <Cyl position={[-w * 0.15, baseH + 0.27, -0.3]} r={0.11} h={0.3} color="#d9d2c4" />
      <Part position={[w * 0.28, baseH + 0.15, 0.1]} size={[0.8, 0.06, 0.55]} color="#a47148" />
      {/* wall cabinet, flush with the wall behind the base unit */}
      <Part position={[0, (upBot + upTop) / 2, -d / 2 + upD / 2]} size={[w, upTop - upBot, upD]} color={body} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Part position={[s * (dw / 2 + 0.03), (upBot + upTop) / 2, -d / 2 + upD + 0.015]} size={[dw, upTop - upBot - 0.1, 0.04]} color={door} />
          <Part position={[s * 0.14, upBot + 0.45, -d / 2 + upD + 0.06]} size={[0.045, 0.4, 0.045]} color={steel} />
        </group>
      ))}
      <Part position={[0, upBot - 0.02, -d / 2 + upD - 0.2]} size={[w - 0.3, 0.03, 0.06]} color="#fff4c9" />
    </group>
  )
}

function renderExtraModel(type) {
  switch (type) {
    case 'dresser': case 'sideboard': case 'filingCabinet':
    case 'toyBox': case 'pantry': case 'dishwasher':
                          return <CabinetModel type={type} />
    case 'dressingTable': return <DressingTableModel />
    case 'bench':         return <BenchModel />
    case 'singleBed':
    case 'kidsBed':       return <ScaledBedModel type={type} />
    case 'cot':           return <CotModel />
    case 'recliner':      return <ReclinerModel />
    case 'pouf':          return <PoufModel />
    case 'consoleTable':  return <ConsoleTableModel />
    case 'sectional':     return <SectionalModel />
    case 'plant':
    case 'planter':       return <PlantModel type={type} />
    case 'floorLamp':     return <FloorLampModel />
    case 'shoeRack':      return <ShoeRackModel />
    case 'shelfUnit':     return <ShelfUnitModel />
    case 'displayUnit':
    case 'crockeryUnit':  return <GlassUnitModel type={type} />
    case 'barStool':      return <BarStoolModel />
    case 'stove':         return <StoveModel />
    case 'kitchenSink':   return <KitchenSinkModel />
    case 'trashBin':      return <TrashBinModel />
    case 'vanity':        return <VanityModel />
    case 'towelRack':     return <TowelRackModel />
    case 'bathroomShelf': return <BathroomShelfModel />
    case 'whiteboard':    return <WhiteboardModel />
    case 'coatRack':      return <CoatRackModel />
    case 'acUnit':        return <ACUnitModel />
    case 'clock':         return <ClockModel />
    case 'wallShelf':     return <WallShelfModel />
    case 'beanBag':       return <BeanBagModel />
    case 'playTable':     return <PlayTableModel />
    case 'outdoorChair':  return <OutdoorChairModel />
    case 'outdoorTable':  return <OutdoorTableModel />
    case 'clothesRack':   return <ClothesRackModel />
    case 'dryer':         return <DryerModel />
    case 'poojaUnit':     return <PoojaUnitModel />
    case 'treadmill':     return <TreadmillModel />
    case 'weightBench':   return <WeightBenchModel />
    case 'exerciseBike':  return <ExerciseBikeModel />
    case 'bunkBed':       return <BunkBedModel />
    case 'windowAc':      return <WindowAcModel />
    case 'roundTable':
    case 'roundCoffeeTable':
    case 'roundSideTable': return <RoundTableModel type={type} />
    case 'pcRow':
    case 'pcDesk':        return <PcRowModel type={type} />
    case 'labChair':      return <LabChairModel />
    case 'collegeBench':
    case 'collegeBench2': return <CollegeBenchModel type={type} />
    case 'teacherDesk':   return <TeacherDeskModel />
    case 'podium':        return <PodiumModel />
    case 'classBoard':    return <ClassBoardModel />
    case 'noticeBoard':   return <NoticeBoardModel />
    default:              return null
  }
}

/* =====================================================
   MAIN SWITCH — maps type → model
===================================================== */
// Pieces that keep their own colours regardless of room style
const NO_TINT = new Set([
  'tv', 'painting', 'mirror', 'basin', 'bathtub', 'toilet', 'shower', 'fridge', 'washingMachine',
  'plant', 'planter', 'dryer', 'dishwasher', 'stove', 'kitchenSink', 'vanity', 'acUnit', 'clock', 'whiteboard',
  'trashBin', 'treadmill', 'weightBench', 'exerciseBike', 'beanBag', 'playTable', 'towelRack', 'floorLamp',
])

function renderModel(type) {
  switch (type) {
    case 'bed':           return <BedModel />
    case 'wardrobe':
    case 'almirah':       return <WardrobeModel />
    case 'bedside':
    case 'coffeeTable':
    case 'sideTable':     return <TableModel type={type} />
    case 'sofa':          return <SofaModel />
    case 'loveseat':      return <LoveseatModel />
    case 'armchair':      return <ArmchairModel />
    case 'accentChair':
    case 'studyChair':
    case 'diningChair':   return <ChairModel type={type} />
    case 'diningTable':   return <DiningTableModel />
    case 'tvUnit':        return <TvUnitModel />
    case 'cabinet':       return <StorageModel />
    case 'tv':            return <TVModel />
    case 'desk':          return <DeskModel />
    case 'bookshelf':     return <BookshelfModel />
    case 'kitchenCabinet':return <KitchenCabinetModel />
    case 'kitchenIsland': return <KitchenIslandModel />
    case 'fridge':        return <FridgeModel />
    case 'basin':         return <BasinModel />
    case 'bathtub':       return <BathtubModel />
    case 'toilet':        return <ToiletModel />
    case 'shower':        return <ShowerModel />
    case 'washingMachine':return <WashingMachineModel />
    case 'painting':      return <PaintingModel />
    case 'mirror':        return <MirrorModel />
    default: {
      const extra = renderExtraModel(type)
      if (extra) return extra
      return (
        <mesh position={[0, 1, 0]} castShadow>
          <boxGeometry args={[2, 2, 2]} />
          <meshStandardMaterial color="#888888" />
        </mesh>
      )
    }
  }
}

export default function FurnitureModel({ type, tint }) {
  const tintValue = useMemo(
    () => (tint && !NO_TINT.has(type) ? { color: tint, amount: 0.55 } : null),
    [tint, type],
  )
  return <TintContext.Provider value={tintValue}>{renderModel(type)}</TintContext.Provider>
}
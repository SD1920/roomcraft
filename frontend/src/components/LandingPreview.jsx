// src/components/LandingPreview.jsx
// Live, read-only 3D sample bedroom for the landing page hero.
// Reuses the same FurnitureModel the editor uses, so the preview is the real thing.

import { Canvas, useFrame } from '@react-three/fiber'
import FurnitureModel from './furniture/FurnitureModel'

const W = 14   // room width  (x)
const L = 12   // room length (z)
const H = 8

const WALL = '#ece6da'
const FLOOR = '#b58a5c'

// Gently swings the camera left/right so the room feels alive without needing any input
function CameraSway() {
  useFrame(({ camera, clock }) => {
    const t = clock.getElapsedTime()
    const angle = Math.PI / 4.2 + Math.sin(t * 0.35) * 0.32
    const r = 19
    camera.position.set(Math.sin(angle) * r, 10.5, Math.cos(angle) * r)
    camera.lookAt(0, 2.2, 0)
  })
  return null
}

function Item({ type, x = 0, z = 0, y = 0, rotation = 0 }) {
  return (
    <group position={[x, y, z]} rotation={[0, rotation, 0]}>
      <FurnitureModel type={type} />
    </group>
  )
}

function Room() {
  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, L]} />
        <meshStandardMaterial color={FLOOR} roughness={0.8} />
      </mesh>

      {/* back wall (-z) */}
      <mesh position={[0, H / 2, -L / 2]} receiveShadow>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color={WALL} />
      </mesh>

      {/* left wall (-x) */}
      <mesh position={[-W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[L, H]} />
        <meshStandardMaterial color="#e3dccd" />
      </mesh>

      {/* skirting along the two walls */}
      <mesh position={[0, 0.22, -L / 2 + 0.05]}>
        <boxGeometry args={[W, 0.44, 0.1]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[-W / 2 + 0.05, 0.22, 0]}>
        <boxGeometry args={[0.1, 0.44, L]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      {/* rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.6]} receiveShadow>
        <planeGeometry args={[8, 6.5]} />
        <meshStandardMaterial color="#c9b79c" />
      </mesh>
    </group>
  )
}

export default function LandingPreview() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [14, 10.5, 14], fov: 42 }}
      style={{ background: 'transparent' }}
    >
      <CameraSway />

      <ambientLight intensity={0.7} />
      <directionalLight
        position={[8, 16, 10]}
        intensity={1.05}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
      <pointLight position={[0, 6.5, 1]} intensity={0.35} />

      <Room />

      {/* bed centred on the back wall (headboard sits at local -z, so no rotation needed) */}
      <Item type="bed" x={0} z={-L / 2 + 3.15} />
      <Item type="bedside" x={-3.75} z={-L / 2 + 1.0} />
      <Item type="bedside" x={3.75} z={-L / 2 + 1.0} />

      {/* painting above the headboard, art facing into the room */}
      <Item type="painting" x={0} y={4.1} z={-L / 2 + 0.2} rotation={Math.PI} />

      {/* wardrobe on the left wall, doors facing into the room */}
      <Item type="wardrobe" x={-W / 2 + 1.0} z={0.2} rotation={-Math.PI / 2} />

      {/* sofa-side seating: armchair + side table by the open corner */}
      <Item type="armchair" x={4.4} z={2.6} rotation={Math.PI * 1.3} />
      <Item type="sideTable" x={5.9} z={0.9} />
    </Canvas>
  )
}

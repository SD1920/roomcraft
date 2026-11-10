import React, { useMemo } from 'react'
import * as THREE from 'three'

/* =====================================================
   FLOOR TEXTURE
===================================================== */

function createFloorTexture(type) {
  const canvas = document.createElement('canvas')

  canvas.width = 512
  canvas.height = 512

  const ctx = canvas.getContext('2d')

  if (type === 'lightWood' || type === 'warmWood' || type === 'darkWood') {
    let baseColor = '#c7a77a'

    if (type === 'warmWood') {
      baseColor = '#9a6b43'
    }

    if (type === 'darkWood') {
      baseColor = '#513728'
    }

    ctx.fillStyle = baseColor
    ctx.fillRect(0, 0, 512, 512)

    // Wooden planks
    for (let y = 0; y < 512; y += 64) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.fillRect(0, y, 512, 3)

      // Small wood grain
      for (let x = 0; x < 512; x += 70) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.lineWidth = 2

        ctx.beginPath()
        ctx.moveTo(x, y + 20)
        ctx.lineTo(x + 35, y + 20)
        ctx.stroke()
      }
    }
  }

  else if (type === 'tile') {
    ctx.fillStyle = '#c8c8c8'
    ctx.fillRect(0, 0, 512, 512)

    ctx.strokeStyle = '#999999'
    ctx.lineWidth = 4

    for (let x = 0; x <= 512; x += 128) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, 512)
      ctx.stroke()
    }

    for (let y = 0; y <= 512; y += 128) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(512, y)
      ctx.stroke()
    }
  }

  else if (type === 'marble') {
    ctx.fillStyle = '#e7e5df'
    ctx.fillRect(0, 0, 512, 512)

    // Marble veins
    for (let i = 0; i < 15; i++) {
      ctx.strokeStyle = 'rgba(90,90,90,0.18)'
      ctx.lineWidth = 3

      ctx.beginPath()

      ctx.moveTo(
        Math.random() * 512,
        0
      )

      for (let y = 0; y <= 512; y += 80) {
        ctx.lineTo(
          Math.random() * 512,
          y
        )
      }

      ctx.stroke()
    }
  }

  else if (type === 'concrete') {
    ctx.fillStyle = '#888888'
    ctx.fillRect(0, 0, 512, 512)

    for (let i = 0; i < 5000; i++) {
      const shade = Math.floor(
        100 + Math.random() * 80
      )

      ctx.fillStyle = `rgba(${shade},${shade},${shade},0.08)`

      ctx.fillRect(
        Math.random() * 512,
        Math.random() * 512,
        2,
        2
      )
    }
  }

  else if (type === 'carpet') {
    ctx.fillStyle = '#77716b'
    ctx.fillRect(0, 0, 512, 512)

    for (let i = 0; i < 10000; i++) {
      const shade = Math.floor(
        80 + Math.random() * 50
      )

      ctx.fillStyle = `rgba(${shade},${shade},${shade},0.18)`

      ctx.fillRect(
        Math.random() * 512,
        Math.random() * 512,
        1,
        1
      )
    }
  }

  const texture = new THREE.CanvasTexture(canvas)

  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping

  texture.repeat.set(4, 4)

  texture.needsUpdate = true

  return texture
}

/* =====================================================
   FLOOR
===================================================== */

export function Floor({
  width,
  length,
  floorType = 'lightWood',
}) {
  const texture = useMemo(
    () => createFloorTexture(floorType),
    [floorType]
  )

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      position={[0, 0, 0]}
    >
      <planeGeometry args={[width, length]} />

      <meshStandardMaterial
        map={texture}
        roughness={0.8}
        metalness={0.05}
      />
    </mesh>
  )
}

/* =====================================================
   WALL SEGMENT
===================================================== */

function WallSegment({
  position,
  size,
  color,
}) {
  return (
    <mesh
      position={position}
      receiveShadow
      castShadow
    >
      <boxGeometry args={size} />

      <meshStandardMaterial
        color={color}
        roughness={0.8}
      />
    </mesh>
  )
}

/* =====================================================
   WALL
===================================================== */

export function Wall({
  wall,
  width,
  length,
  height = 8,
  color = '#f5f5f0',
  openings = [],
  onSelect,
  visible = true,
  selected = false,
}) {
  const wallOpenings = openings.filter(
    (opening) => opening.wall === wall
  )

  const isHorizontal =
    wall === 'front' ||
    wall === 'back'

  const wallLength = isHorizontal
    ? width
    : length

  /*
    Convert opening position into the
    center coordinate of the wall.
  */
  const getOpeningCenter = (opening) => {
    const openingWidth = Number(opening.width) || 3
    const rawPosition = Number(opening.position) || 0

    const min =
      -wallLength / 2 + openingWidth / 2

    const max =
      wallLength / 2 - openingWidth / 2

    return Math.max(
      min,
      Math.min(max, rawPosition)
    )
  }

  /*
    Build wall pieces around doors/windows.

    For horizontal walls:
      X = wall position
      Z = constant

    For vertical walls:
      Z = wall position
      X = constant
  */
  const segments = []

  if (wallOpenings.length === 0) {
    if (isHorizontal) {
      segments.push({
        position:
          wall === 'front'
            ? [0, height / 2, -length / 2]
            : [0, height / 2, length / 2],

        size: [width, height, 0.25],
      })
    } else {
      segments.push({
        position:
          wall === 'left'
            ? [-width / 2, height / 2, 0]
            : [width / 2, height / 2, 0],

        size: [0.25, height, length],
      })
    }
  }

  else {
    const sorted = [...wallOpenings].sort(
      (a, b) =>
        getOpeningCenter(a) -
        getOpeningCenter(b)
    )

    let current = -wallLength / 2

    sorted.forEach((opening) => {
      const center =
        getOpeningCenter(opening)

      const openingWidth =
        Number(opening.width) || 3

      const openingStart =
        center - openingWidth / 2

      const openingEnd =
        center + openingWidth / 2

      /*
        Wall section before opening
      */
      if (openingStart > current) {
        const segmentLength =
          openingStart - current

        const segmentCenter =
          current + segmentLength / 2

        if (isHorizontal) {
          segments.push({
            position:
              wall === 'front'
                ? [
                    segmentCenter,
                    height / 2,
                    -length / 2,
                  ]
                : [
                    segmentCenter,
                    height / 2,
                    length / 2,
                  ],

            size: [
              segmentLength,
              height,
              0.25,
            ],
          })
        } else {
          segments.push({
            position:
              wall === 'left'
                ? [
                    -width / 2,
                    height / 2,
                    segmentCenter,
                  ]
                : [
                    width / 2,
                    height / 2,
                    segmentCenter,
                  ],

            size: [
              0.25,
              height,
              segmentLength,
            ],
          })
        }
      }

      /*
        For a window, we only cut the
        opening from the lower part of wall
        to the top of window.

        For a door, opening reaches floor.
      */

      const openingHeight =
        Number(opening.height) || 4

      /*
        Doors open from floor level.
        Windows open only between their
        sill (offset) and their top.

        The window frame extends slightly
        beyond the glass, so the wall gap
        includes that small frame allowance.
      */
      const frameAllowance =
        opening.type === 'window'
          ? 0.25
          : 0

      const bottom =
        opening.type === 'door'
          ? 0
          : Math.max(
              0,
              (Number(opening.offset) || 3) - 0.06
            )

      const top = Math.min(
        height,
        bottom +
          openingHeight +
          (opening.type === 'window'
            ? 0.12
            : 0)
      )

      /*
        Area BELOW a window.

        This is the important difference from
        a door: the wall must remain solid
        below the window sill.
      */
      if (
        opening.type === 'window' &&
        bottom > 0
      ) {
        if (isHorizontal) {
          segments.push({
            position:
              wall === 'front'
                ? [
                    center,
                    bottom / 2,
                    -length / 2,
                  ]
                : [
                    center,
                    bottom / 2,
                    length / 2,
                  ],

            size: [
              openingWidth +
                frameAllowance,
              bottom,
              0.25,
            ],
          })
        } else {
          segments.push({
            position:
              wall === 'left'
                ? [
                    -width / 2,
                    bottom / 2,
                    center,
                  ]
                : [
                    width / 2,
                    bottom / 2,
                    center,
                  ],

            size: [
              0.25,
              bottom,
              openingWidth +
                frameAllowance,
            ],
          })
        }
      }

      /*
        Area above opening
      */
      if (top < height) {
        const topHeight =
          height - top

        if (isHorizontal) {
          segments.push({
            position:
              wall === 'front'
                ? [
                    center,
                    top + topHeight / 2,
                    -length / 2,
                  ]
                : [
                    center,
                    top + topHeight / 2,
                    length / 2,
                  ],

            size: [
              openingWidth,
              topHeight,
              0.25,
            ],
          })
        } else {
          segments.push({
            position:
              wall === 'left'
                ? [
                    -width / 2,
                    top + topHeight / 2,
                    center,
                  ]
                : [
                    width / 2,
                    top + topHeight / 2,
                    center,
                  ],

            size: [
              0.25,
              topHeight,
              openingWidth,
            ],
          })
        }
      }

      current = openingEnd
    })

    /*
      Wall section after final opening
    */
    if (current < wallLength / 2) {
      const segmentLength =
        wallLength / 2 - current

      const segmentCenter =
        current + segmentLength / 2

      if (isHorizontal) {
        segments.push({
          position:
            wall === 'front'
              ? [
                  segmentCenter,
                  height / 2,
                  -length / 2,
                ]
              : [
                  segmentCenter,
                  height / 2,
                  length / 2,
                ],

          size: [
            segmentLength,
            height,
            0.25,
          ],
        })
      } else {
        segments.push({
          position:
            wall === 'left'
              ? [
                  -width / 2,
                  height / 2,
                  segmentCenter,
                ]
              : [
                  width / 2,
                  height / 2,
                  segmentCenter,
                ],

          size: [
            0.25,
            height,
            segmentLength,
          ],
        })
      }
    }
  }

  return (
    <group
      visible={visible}
      onPointerDown={(event) => {
        event.stopPropagation()
        onSelect?.(wall)
      }}
    >
      {segments.map((segment, index) => (
        <WallSegment
          key={`${wall}-${index}`}
          position={segment.position}
          size={segment.size}
          color={
            selected
              ? '#d99a68'
              : color
          }
        />
      ))}
    </group>
  )
}

/* =====================================================
   OPENING TRANSFORM
===================================================== */

function getOpeningTransform({
  wall,
  position,
  width,
  height,
  roomWidth,
  roomLength,
  offset = 0,
}) {
  const wallLength =
    wall === 'front' || wall === 'back'
      ? roomWidth
      : roomLength

  const openingWidth =
    Number(width) || 3

  const min =
    -wallLength / 2 + openingWidth / 2

  const max =
    wallLength / 2 - openingWidth / 2

  const safePosition = Math.max(
    min,
    Math.min(
      max,
      Number(position) || 0
    )
  )

  const isHorizontal =
    wall === 'front' ||
    wall === 'back'

  if (isHorizontal) {
    return {
      position: [
        safePosition,
        (Number(offset) || 0) +
          Number(height) / 2,
        wall === 'front'
          ? -roomLength / 2
          : roomLength / 2,
      ],
      rotation: [0, 0, 0],
    }
  }

  return {
    position: [
      wall === 'left'
        ? -roomWidth / 2
        : roomWidth / 2,
      (Number(offset) || 0) +
        Number(height) / 2,
      safePosition,
    ],
    rotation: [0, Math.PI / 2, 0],
  }
}

/* =====================================================
   WINDOW
===================================================== */

export function WindowObject({
  wall,
  width = 4,
  height = 4,
  position = 0,
  offset = 3.5,
  selected = false,
  onSelect,
  roomWidth = 12,
  roomLength = 14,
  visible = true,
  onPointerDown,
}) {
  const frameThickness = 0.12

  const transform =
    getOpeningTransform({
      wall,
      position,
      width,
      height,
      roomWidth,
      roomLength,
      offset,
    })

  return (
    <group
      visible={visible}
      position={transform.position}
      rotation={transform.rotation}
      onPointerDown={onPointerDown}
    >
      {/* Glass */}
      <mesh>
        <planeGeometry
          args={[width, height]}
        />

        <meshStandardMaterial
          color="#9dd9ef"
          transparent
          opacity={0.42}
          roughness={0.1}
          metalness={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Outer frame - top */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry
          args={[
            width + 0.25,
            frameThickness,
            0.18,
          ]}
        />

        <meshStandardMaterial
          color={
            selected
              ? '#ff8c00'
              : '#eeeeee'
          }
        />
      </mesh>

      {/* Outer frame - bottom */}
      <mesh position={[0, -height / 2, 0]}>
        <boxGeometry
          args={[
            width + 0.25,
            frameThickness,
            0.18,
          ]}
        />

        <meshStandardMaterial
          color={
            selected
              ? '#ff8c00'
              : '#eeeeee'
          }
        />
      </mesh>

      {/* Outer frame - left */}
      <mesh position={[-width / 2, 0, 0]}>
        <boxGeometry
          args={[
            frameThickness,
            height,
            0.18,
          ]}
        />

        <meshStandardMaterial
          color={
            selected
              ? '#ff8c00'
              : '#eeeeee'
          }
        />
      </mesh>

      {/* Outer frame - right */}
      <mesh position={[width / 2, 0, 0]}>
        <boxGeometry
          args={[
            frameThickness,
            height,
            0.18,
          ]}
        />

        <meshStandardMaterial
          color={
            selected
              ? '#ff8c00'
              : '#eeeeee'
          }
        />
      </mesh>

      {/* Vertical center bar */}
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry
          args={[
            frameThickness,
            height,
            0.12,
          ]}
        />

        <meshStandardMaterial
          color="#eeeeee"
        />
      </mesh>

      {/* Horizontal center bar */}
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry
          args={[
            width,
            frameThickness,
            0.12,
          ]}
        />

        <meshStandardMaterial
          color="#eeeeee"
        />
      </mesh>
    </group>
  )
}

/* =====================================================
   DOOR
===================================================== */

export function DoorObject({
  wall,
  width = 3,
  height = 6.8,
  position = 0,
  selected = false,
  roomWidth = 12,
  roomLength = 14,
  visible = true,
  hinge = 'low',      // 'low' = hinge at the smaller x / z end of the opening, 'high' = the other end
  swing = 'in',       // 'in' = opens into the room, 'out' = opens away from it
  openAngle = 90,     // degrees, 0 = closed
  onPointerDown,
}) {
  const transform = getOpeningTransform({
    wall, position, width, height, roomWidth, roomLength, offset: 0,
  })

  // ── Swing geometry (all in the door group's local frame: x along the wall, z through it) ──
  const horiz = wall === 'front' || wall === 'back'
  const inwardLocal = wall === 'front' || wall === 'left' ? 1 : -1  // which local z side is "into the room"
  const s = swing === 'out' ? -inwardLocal : inwardLocal            // local z side the leaf swings to
  const hingeSign = (hinge === 'high' ? 1 : -1) * (horiz ? 1 : -1)  // local x side of the hinge
  const dirX = -hingeSign                                           // from hinge toward the latch
  const angle = THREE.MathUtils.degToRad(Math.max(0, Math.min(120, Number(openAngle) || 0)))
  const phi = -s * dirX * angle
  const hingeX = hingeSign * (width / 2)
  const floorY = -height / 2 + 0.03

  // translucent floor sector showing the area the door sweeps (only while selected)
  const sector = useMemo(() => {
    if (angle < 0.02) return null
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    const steps = 28
    for (let i = 0; i <= steps; i++) {
      const t = (angle * i) / steps
      shape.lineTo(dirX * width * Math.cos(t), s * width * Math.sin(t))
    }
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [angle, dirX, s, width])

  const leafX = dirX * (width / 2)
  const panelW = width * 0.72

  return (
    <group
      visible={visible}
      position={transform.position}
      rotation={transform.rotation}
      onPointerDown={onPointerDown}
    >
      {/* Invisible hit area so the doorway stays grabbable when the leaf is swung open */}
      <mesh>
        <boxGeometry args={[width, height, 0.3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Door leaf, hinged at one jamb */}
      <group position={[hingeX, 0, 0]} rotation={[0, phi, 0]}>
        <mesh position={[leafX, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, height, 0.18]} />
          <meshStandardMaterial color={selected ? '#b86b32' : '#704b32'} roughness={0.7} />
        </mesh>

        {/* Panels (both faces) */}
        {[0.1, -0.1].map((z) => (
          <group key={z}>
            <mesh position={[leafX, height * 0.22, z]}>
              <boxGeometry args={[panelW, height * 0.29, 0.06]} />
              <meshStandardMaterial color="#8b5d3e" />
            </mesh>
            <mesh position={[leafX, -height * 0.18, z]}>
              <boxGeometry args={[panelW, height * 0.29, 0.06]} />
              <meshStandardMaterial color="#8b5d3e" />
            </mesh>
            <mesh position={[dirX * (width - 0.4), 0, z * 2]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial color="#d4af62" metalness={0.7} roughness={0.25} />
            </mesh>
          </group>
        ))}
      </group>

      {selected && sector && (
        <mesh
          geometry={sector}
          position={[hingeX, floorY, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <meshBasicMaterial color="#f4a261" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

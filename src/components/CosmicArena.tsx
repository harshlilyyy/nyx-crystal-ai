import { Canvas } from "@react-three/fiber";
import { Stars, Float, OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

const AGENT_COLORS = [
  "#D4A5A5", // rose gold
  "#E8D5B5", // champagne
  "#8EC0B5", // teal
  "#C8A2C8", // soft purple
  "#F4B8C4", // pink
  "#A5C8E8", // cyan
];

function AgentOrb({
  position,
  color,
  scale = 0.45,
}: {
  position: [number, number, number];
  color: string;
  scale?: number;
}) {
  return (
    <Float speed={1.2} rotationIntensity={0.4} floatIntensity={1.4}>
      <mesh position={position}>
        <sphereGeometry args={[scale, 48, 48]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.1}
          roughness={0.25}
          metalness={0.35}
        />
        <pointLight color={color} intensity={1.2} distance={6} decay={2} />
      </mesh>
    </Float>
  );
}

function SimulationCore() {
  const geom = useMemo(() => new THREE.OctahedronGeometry(0.85, 0), []);
  return (
    <Float speed={0.8} rotationIntensity={0.6} floatIntensity={0.6}>
      <mesh geometry={geom}>
        <meshStandardMaterial
          color="#FFFFFF"
          emissive="#E8D5B5"
          emissiveIntensity={1.6}
          roughness={0.1}
          metalness={0.7}
          flatShading
        />
      </mesh>
      <pointLight color="#E8D5B5" intensity={2.4} distance={10} decay={2} />
    </Float>
  );
}

export function CosmicArena() {
  const orbs: { position: [number, number, number]; color: string }[] = [
    { position: [-3.2, 0.8, -1], color: AGENT_COLORS[0] },
    { position: [3.0, -0.6, -1.5], color: AGENT_COLORS[1] },
    { position: [-2.0, -1.4, 1.2], color: AGENT_COLORS[2] },
    { position: [2.4, 1.6, 0.8], color: AGENT_COLORS[3] },
    { position: [0.2, 2.4, -2], color: AGENT_COLORS[4] },
    { position: [-0.6, -2.2, 1.6], color: AGENT_COLORS[5] },
  ];

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{ background: "radial-gradient(ellipse at center, #1a0f24 0%, #07050d 70%)" }}
    >
      <Canvas
        camera={{ position: [0, 0, 7], fov: 55 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.35} />
        <Stars
          radius={80}
          depth={50}
          count={4000}
          factor={4}
          saturation={0.2}
          fade
          speed={0.6}
        />
        <SimulationCore />
        {orbs.map((o, i) => (
          <AgentOrb key={i} position={o.position} color={o.color} />
        ))}
        <OrbitControls
          autoRotate
          autoRotateSpeed={0.4}
          enableZoom={false}
          enablePan={false}
          enableRotate={false}
        />
      </Canvas>
    </div>
  );
}

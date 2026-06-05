import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

interface Props {
  count?: number;
  className?: string;
  size?: number;
  spin?: number;
  autoSpin?: boolean;
  speedMult?: number;
}

export function DiamondSwarm({
  count = 6000,
  className,
  size = 60,
  spin = 0.4,
  autoSpin = true,
  speedMult = 1,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let width = mount.clientWidth || window.innerWidth;
    let height = mount.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.01);
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      1.5,
      0.4,
      0.85,
    );
    bloomPass.strength = 1.4;
    bloomPass.radius = 0.4;
    bloomPass.threshold = 0;
    composer.addPass(bloomPass);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const target = new THREE.Vector3();

    const geometry = new THREE.TetrahedronGeometry(0.25);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(instancedMesh);

    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      positions.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 100,
          (Math.random() - 0.5) * 100,
          (Math.random() - 0.5) * 100,
        ),
      );
      instancedMesh.setColorAt(i, color.setHex(0xffffff));
    }

    const clock = new THREE.Clock();
    let raf = 0;
    let autoAngle = 0;

    function animate() {
      raf = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const time = clock.getElapsedTime() * speedMult;
      if (autoSpin) autoAngle += delta * 0.3;

      for (let i = 0; i < count; i++) {
        const u = i / count;
        const facets = 32.0;
        const a = u * facets;
        const f = Math.floor(a);
        const frac = a - f;
        const angle = (f / facets) * Math.PI * 2;
        const v = ((i * 7) % count) / count;
        const y = v * 2 - 1;
        const absY = Math.abs(y);
        let r: number;
        if (absY < 0.15) r = 1.0;
        else if (y > 0) {
          const t = (absY - 0.15) / (1.0 - 0.15);
          r = 1.0 - t * 0.5;
        } else {
          const t = (absY - 0.15) / (1.0 - 0.15);
          r = 1.0 - t * 1.2;
        }
        if (r < 0) r = 0;
        const facetMix = 0.7;
        const rFaceted = r * (1.0 - facetMix + facetMix * frac);
        const x = Math.cos(angle) * rFaceted;
        const z = Math.sin(angle) * rFaceted;
        const t = time * spin + autoAngle;
        const c = Math.cos(t);
        const sT = Math.sin(t);
        const xr = x * c - z * sT;
        const zr = x * sT + z * c;
        target.set(xr * size, y * size * 1.2, zr * size);

        color.setRGB(1, 1, 1);
        positions[i].lerp(target, 0.1);
        dummy.position.copy(positions[i]);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
        instancedMesh.setColorAt(i, color);
      }
      instancedMesh.instanceMatrix.needsUpdate = true;
      if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
      composer.render();
    }
    animate();

    const onResize = () => {
      width = mount.clientWidth || window.innerWidth;
      height = mount.clientHeight || window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [count, size, spin, autoSpin, speedMult]);

  return <div ref={mountRef} className={className} />;
}

export default DiamondSwarm;

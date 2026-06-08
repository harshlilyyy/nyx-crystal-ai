import { useEffect, useRef, useState } from "react";
import flowers from "@/assets/nyx-flowers.jpg.asset.json";
import web from "@/assets/nyx-web.jpg.asset.json";

/**
 * Cinematic layered background: deep purple flowers + spider-web overlay,
 * with multi-layer 3D parallax driven by pointer + slow ambient drift.
 * Sits behind all app content, never blocks interaction.
 */
export function CosmicVideoBackground() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const flowerRef = useRef<HTMLDivElement>(null);
  const webRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      target.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      target.current.x = Math.max(-1, Math.min(1, e.gamma / 30));
      target.current.y = Math.max(-1, Math.min(1, e.beta / 45));
    };

    const start = performance.now();
    const tick = (t: number) => {
      const ease = reduced ? 1 : 0.06;
      current.current.x += (target.current.x - current.current.x) * ease;
      current.current.y += (target.current.y - current.current.y) * ease;
      const time = (t - start) / 1000;
      const driftX = Math.sin(time * 0.12) * 0.35;
      const driftY = Math.cos(time * 0.09) * 0.35;
      const px = current.current.x + driftX;
      const py = current.current.y + driftY;

      if (flowerRef.current) {
        const rx = (-py * 4).toFixed(3);
        const ry = (px * 5).toFixed(3);
        const tx = (px * 28).toFixed(2);
        const ty = (py * 22).toFixed(2);
        flowerRef.current.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.18)`;
      }
      if (webRef.current) {
        const tx = (px * 60).toFixed(2);
        const ty = (py * 48).toFixed(2);
        const rz = (px * 1.2).toFixed(3);
        webRef.current.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${rz}deg) scale(1.35)`;
      }
      if (glowRef.current) {
        const tx = (px * -38).toFixed(2);
        const ty = (py * -30).toFixed(2);
        glowRef.current.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("deviceorientation", onOrient, { passive: true });
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onOrient);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [reduced]);

  return (
    <div
      aria-hidden
      ref={sceneRef}
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ perspective: "1600px", background: "#08060b" }}
    >
      {/* Layer 1 — deep nebula glow */}
      <div
        ref={glowRef}
        className="absolute inset-[-12%] will-change-transform"
        style={{
          background:
            "radial-gradient(60% 50% at 30% 35%, rgba(168,85,166,0.45) 0%, rgba(80,30,90,0.15) 45%, transparent 75%), radial-gradient(45% 40% at 75% 70%, rgba(220,120,180,0.30) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />

      {/* Layer 2 — flower hero (parallax + slow zoom) */}
      <div
        ref={flowerRef}
        className="absolute inset-[-10%] will-change-transform"
        style={{
          backgroundImage: `url(${flowers.url})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          transformStyle: "preserve-3d",
          animation: "nyx-breathe 18s ease-in-out infinite",
          filter: "saturate(1.05) contrast(1.05)",
        }}
      />

      {/* Layer 3 — spider web overlay (multiply for ink lines) */}
      <div
        ref={webRef}
        className="absolute inset-[-20%] will-change-transform opacity-[0.55]"
        style={{
          backgroundImage: `url(${web.url})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          mixBlendMode: "screen",
          maskImage:
            "radial-gradient(120% 100% at 50% 40%, black 0%, black 55%, transparent 90%)",
          WebkitMaskImage:
            "radial-gradient(120% 100% at 50% 40%, black 0%, black 55%, transparent 90%)",
        }}
      />

      {/* Layer 4 — readability vignette + bottom fade for light frosted UI */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 45%, rgba(255,255,255,0) 0%, rgba(255,255,255,0.25) 55%, rgba(255,255,255,0.70) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 25%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.45) 100%)",
        }}
      />

      <style>{`
        @keyframes nyx-breathe {
          0%, 100% { filter: saturate(1.05) contrast(1.05) brightness(1); }
          50% { filter: saturate(1.15) contrast(1.08) brightness(1.06); }
        }
      `}</style>
    </div>
  );
}

export default CosmicVideoBackground;

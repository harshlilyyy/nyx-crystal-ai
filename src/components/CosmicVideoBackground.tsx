import { useEffect, useRef, useState } from "react";
import bgAsset from "@/assets/nyx-bg.mp4.asset.json";

/**
 * Full-screen ambient video background with a subtle 3D parallax tilt
 * driven by pointer movement. Sits behind all app content, never blocks
 * interaction (pointer-events: none), and respects reduced motion.
 */
export function CosmicVideoBackground() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
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
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => v.play().catch(() => {});
    tryPlay();
    const onVis = () => { if (!document.hidden) tryPlay(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      target.current.x = nx;
      target.current.y = ny;
    };
    const tick = () => {
      current.current.x += (target.current.x - current.current.x) * 0.06;
      current.current.y += (target.current.y - current.current.y) * 0.06;
      const el = wrapRef.current;
      if (el) {
        const rx = (-current.current.y * 3).toFixed(3);
        const ry = (current.current.x * 3).toFixed(3);
        const tx = (current.current.x * 12).toFixed(2);
        const ty = (current.current.y * 12).toFixed(2);
        el.style.transform = `perspective(1400px) rotateX(${rx}deg) rotateY(${ry}deg) translate3d(${tx}px, ${ty}px, 0) scale(1.08)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [reduced]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
      style={{ perspective: "1400px" }}
    >
      <div
        ref={wrapRef}
        className="absolute inset-0 will-change-transform"
        style={{ transformStyle: "preserve-3d", transform: "scale(1.08)" }}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={bgAsset.url}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          // @ts-expect-error iOS hint
          disablePictureInPicture
          disableRemotePlayback
        />
      </div>
      {/* Readability + cinematic vignette overlays, tuned for the light frosted UI */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 40%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.45) 55%, rgba(255,255,255,0.78) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.35) 100%)",
        }}
      />
    </div>
  );
}

export default CosmicVideoBackground;

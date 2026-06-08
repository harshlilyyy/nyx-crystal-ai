import { useEffect, useRef, useState } from "react";

/**
 * Cinematic black-hole code-vortex background.
 * Pure canvas — accretion disk + swirling code particles being pulled into
 * a singularity, with subtle 3D parallax tilt and iOS-style glass overlay
 * for legibility of foreground UI.
 */
export function CosmicVideoBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Pointer-driven 3D tilt on the scene wrapper
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      tiltRef.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
      tiltRef.current.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    let raf = 0;
    const tick = () => {
      const t = tiltRef.current;
      t.x += (t.tx - t.x) * 0.06;
      t.y += (t.ty - t.y) * 0.06;
      if (sceneRef.current) {
        const rx = (-t.y * 4).toFixed(2);
        const ry = (t.x * 6).toFixed(2);
        const tx = (t.x * 14).toFixed(2);
        const ty = (t.y * 10).toFixed(2);
        sceneRef.current.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.04)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Canvas: black hole + code vortex
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const CHARS = "01{}[]()<>/=*+;:.,_$#&|".split("");
    let W = 0, H = 0, dpr = 1;
    let cx = 0, cy = 0, rHole = 0;

    type P = {
      a: number;        // angle
      r: number;        // radius
      v: number;        // angular velocity factor
      drift: number;    // inward drift per frame
      ch: string;
      size: number;
      hue: number;      // color shift
      alpha: number;
    };
    let particles: P[] = [];
    let stars: { x: number; y: number; s: number; tw: number }[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W * 0.42;
      cy = H * 0.48;
      rHole = Math.min(W, H) * 0.09;

      const count = Math.min(520, Math.floor((W * H) / 3200));
      particles = new Array(count).fill(0).map(() => spawn());

      const sCount = Math.min(180, Math.floor((W * H) / 9000));
      stars = new Array(sCount).fill(0).map(() => ({
        x: Math.random() * W,
        y: Math.random() * H,
        s: Math.random() * 1.2 + 0.2,
        tw: Math.random() * Math.PI * 2,
      }));
    };

    const spawn = (): P => {
      const r = rHole * (3 + Math.random() * 7);
      return {
        a: Math.random() * Math.PI * 2,
        r,
        v: 0.004 + Math.random() * 0.012,
        drift: 0.15 + Math.random() * 0.55,
        ch: CHARS[(Math.random() * CHARS.length) | 0],
        size: 9 + Math.random() * 6,
        hue: 18 + Math.random() * 24, // amber/orange
        alpha: 0.45 + Math.random() * 0.55,
      };
    };

    let raf = 0;
    let t0 = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(48, now - t0);
      t0 = now;
      const speed = reduced ? 0.25 : 1;

      // background gradient (deep space)
      const bg = ctx.createRadialGradient(cx, cy, rHole * 0.5, cx, cy, Math.max(W, H));
      bg.addColorStop(0, "#020205");
      bg.addColorStop(0.5, "#04030a");
      bg.addColorStop(1, "#000000");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // stars
      ctx.save();
      for (const s of stars) {
        s.tw += 0.02;
        const a = 0.4 + Math.sin(s.tw) * 0.3;
        ctx.fillStyle = `rgba(220,225,255,${a.toFixed(3)})`;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }
      ctx.restore();

      // accretion disk glow (warm)
      const disk = ctx.createRadialGradient(cx, cy, rHole * 0.9, cx, cy, rHole * 6);
      disk.addColorStop(0, "rgba(255,170,90,0.55)");
      disk.addColorStop(0.25, "rgba(255,120,60,0.30)");
      disk.addColorStop(0.6, "rgba(120,60,160,0.18)");
      disk.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = disk;
      ctx.beginPath();
      ctx.arc(cx, cy, rHole * 6, 0, Math.PI * 2);
      ctx.fill();

      // code particles
      ctx.font = "600 12px 'Courier Prime', ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const p of particles) {
        // angular swirl — faster near the hole
        const swirl = (1 + (rHole * 3) / Math.max(p.r, rHole)) * p.v * speed * (dt / 16);
        p.a += swirl;
        p.r -= p.drift * speed * (dt / 16) * (1 + (rHole * 2) / Math.max(p.r, rHole));

        if (p.r < rHole * 1.05) {
          Object.assign(p, spawn());
          p.r = rHole * (8 + Math.random() * 4);
          continue;
        }

        // project with slight ellipse for disk perspective
        const x = cx + Math.cos(p.a) * p.r;
        const y = cy + Math.sin(p.a) * p.r * 0.55;

        // tail line (motion streak)
        const x2 = cx + Math.cos(p.a - swirl * 6) * (p.r + 4);
        const y2 = cy + Math.sin(p.a - swirl * 6) * (p.r + 4) * 0.55;

        const distT = 1 - Math.min(1, (p.r - rHole) / (rHole * 7));
        const a = p.alpha * (0.35 + distT * 0.65);
        const fs = p.size * (0.85 + distT * 0.5);

        ctx.strokeStyle = `hsla(${p.hue}, 95%, 65%, ${(a * 0.5).toFixed(3)})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x, y);
        ctx.stroke();

        ctx.font = `600 ${fs.toFixed(1)}px 'Courier Prime', ui-monospace, monospace`;
        ctx.fillStyle = `hsla(${p.hue}, 100%, ${(60 + distT * 25).toFixed(0)}%, ${a.toFixed(3)})`;
        ctx.shadowColor = `hsla(${p.hue}, 100%, 60%, ${(a * 0.8).toFixed(3)})`;
        ctx.shadowBlur = 6 + distT * 8;
        ctx.fillText(p.ch, x, y);
      }
      ctx.shadowBlur = 0;

      // event horizon — pure black with thin photon ring
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(cx, cy, rHole, 0, Math.PI * 2);
      ctx.fill();

      const ring = ctx.createRadialGradient(cx, cy, rHole * 0.92, cx, cy, rHole * 1.18);
      ring.addColorStop(0, "rgba(0,0,0,0)");
      ring.addColorStop(0.55, "rgba(255,180,110,0.55)");
      ring.addColorStop(0.75, "rgba(255,120,80,0.35)");
      ring.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(cx, cy, rHole * 1.18, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ perspective: "1600px", background: "#000" }}
    >
      <div
        ref={sceneRef}
        className="absolute inset-0 will-change-transform"
        style={{ transformStyle: "preserve-3d" }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>

      {/* Subtle vignette only — keep the cosmic animation fully visible */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)",
        }}
      />
    </div>
  );
}

export default CosmicVideoBackground;


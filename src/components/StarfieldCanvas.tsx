import React, { useEffect, useRef } from 'react';

interface StarfieldCanvasProps {
  enabled: boolean;
  tint?: 'violet' | 'cyan' | 'amber';
}

interface Star {
  x: number;
  y: number;
  radius: number;
  baseAlpha: number;
  twinkleSpeed: number;
  phase: number;
  color: string;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  alpha: number;
  life: number;
  maxLife: number;
  tailColor: string;
}

const STAR_COLORS = [
  '248, 250, 252', // crisp starlight white
  '221, 214, 254', // pale lavender violet
  '186, 230, 253', // soft ice cyan
  '196, 181, 253', // soft amethyst
];

export const StarfieldCanvas: React.FC<StarfieldCanvasProps> = ({
  enabled,
  tint = 'violet',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let stars: Star[] = [];
    let meteors: ShootingStar[] = [];
    let rafId = 0;
    let lastTime = performance.now();
    let meteorCooldown = 1400;

    const createStars = (w: number, h: number) => {
      const count = Math.min(85, Math.max(36, Math.floor((w * h) / 11500)));
      const list: Star[] = [];
      for (let i = 0; i < count; i += 1) {
        list.push({
          x: Math.random() * w,
          y: Math.random() * h,
          radius: Math.random() * 1.35 + 0.45,
          baseAlpha: Math.random() * 0.5 + 0.22,
          twinkleSpeed: Math.random() * 1.4 + 0.5,
          phase: Math.random() * Math.PI * 2,
          color: STAR_COLORS[i % STAR_COLORS.length],
        });
      }
      return list;
    };

    const spawnMeteor = () => {
      if (width <= 0 || height <= 0) return;
      const startX = width * (0.25 + Math.random() * 0.72);
      const startY = height * (Math.random() * 0.35);
      const speed = 340 + Math.random() * 240;
      const angle = (128 + Math.random() * 16) * (Math.PI / 180);
      const tailPalette =
        tint === 'amber'
          ? ['251, 191, 36', '192, 132, 252']
          : tint === 'cyan'
            ? ['56, 189, 248', '192, 132, 252']
            : ['192, 132, 252', '56, 189, 248'];

      meteors.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        length: 75 + Math.random() * 75,
        alpha: 0.9,
        life: 0,
        maxLife: 0.85 + Math.random() * 0.55,
        tailColor: tailPalette[Math.floor(Math.random() * tailPalette.length)],
      });
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = createStars(width, height);
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, width, height);
      for (const star of stars) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${star.color}, ${star.baseAlpha.toFixed(3)})`;
        ctx.fill();
      }
    };

    const renderFrame = (now: number) => {
      if (document.hidden) {
        lastTime = now;
        rafId = window.requestAnimationFrame(renderFrame);
        return;
      }

      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      const t = now / 1000;

      ctx.clearRect(0, 0, width, height);

      // Twinkling stars
      for (const star of stars) {
        const twinkle = 0.55 + 0.45 * Math.sin(t * star.twinkleSpeed + star.phase);
        const alpha = star.baseAlpha * twinkle;

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${star.color}, ${alpha.toFixed(3)})`;
        ctx.fill();

        // Subtle 4-point sparkle cross on brightest stars
        if (star.radius > 1.45 && twinkle > 0.82) {
          const glow = star.radius * 3.1;
          ctx.strokeStyle = `rgba(${star.color}, ${(alpha * 0.45).toFixed(3)})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(star.x - glow, star.y);
          ctx.lineTo(star.x + glow, star.y);
          ctx.moveTo(star.x, star.y - glow);
          ctx.lineTo(star.x, star.y + glow);
          ctx.stroke();
        }
      }

      // Periodic shooting stars (流星)
      meteorCooldown -= dt * 1000;
      if (meteorCooldown <= 0 && meteors.length < 2) {
        spawnMeteor();
        meteorCooldown = 2600 + Math.random() * 3400;
      }

      const nextMeteors: ShootingStar[] = [];
      for (const m of meteors) {
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const progress = m.life / m.maxLife;
        if (progress >= 1) continue;

        const fade =
          progress < 0.18
            ? progress / 0.18
            : Math.max(0, 1 - (progress - 0.18) / 0.82);

        const speedNorm = Math.hypot(m.vx, m.vy) || 1;
        const tailX = m.x - (m.vx / speedNorm) * m.length;
        const tailY = m.y - (m.vy / speedNorm) * m.length;

        const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        grad.addColorStop(0, `rgba(255, 255, 255, ${(0.95 * fade).toFixed(3)})`);
        grad.addColorStop(0.28, `rgba(${m.tailColor}, ${(0.72 * fade).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${m.tailColor}, 0)`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        // Bright meteor head glow
        ctx.beginPath();
        ctx.arc(m.x, m.y, 1.9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.95 * fade).toFixed(3)})`;
        ctx.fill();

        nextMeteors.push(m);
      }
      meteors = nextMeteors;

      rafId = window.requestAnimationFrame(renderFrame);
    };

    resize();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (prefersReducedMotion) drawStatic();
    });
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    if (prefersReducedMotion) {
      drawStatic();
    } else {
      // Spawn one gentle opening shooting star shortly after load
      meteorCooldown = 900;
      rafId = window.requestAnimationFrame(renderFrame);
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [enabled, tint]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="starfield-canvas"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
};

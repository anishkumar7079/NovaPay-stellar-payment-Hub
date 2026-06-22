/**
 * particles.js — Animated starfield canvas background
 * Creates twinkling stars, shooting stars, and constellation-like
 * connections for NovaPay dApp
 */

export function initParticles() {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, stars = [], shootingStars = [];
  let animId;

  // ── Resize Handler ──────────────────────────────────────────
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  // ── Star Factory ─────────────────────────────────────────────
  function createStar() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.6 + 0.2,
      opacity: Math.random(),
      speed: Math.random() * 0.008 + 0.003,
      phase: Math.random() * Math.PI * 2,
      // Color: mostly white/blue, some violet
      hue: Math.random() > 0.85 ? 270 : Math.random() > 0.7 ? 200 : 210,
    };
  }

  function initStars(count = 180) {
    stars = Array.from({ length: count }, createStar);
  }

  // ── Shooting Star Factory ────────────────────────────────────
  function createShootingStar() {
    return {
      x: Math.random() * W * 0.8,
      y: Math.random() * H * 0.4,
      len: Math.random() * 120 + 80,
      speed: Math.random() * 8 + 6,
      opacity: 1,
      angle: Math.PI / 5 + (Math.random() - 0.5) * 0.3,
      life: 1,
      decay: Math.random() * 0.015 + 0.012,
    };
  }

  // ── Draw ─────────────────────────────────────────────────────
  function draw(ts) {
    ctx.clearRect(0, 0, W, H);

    // Draw stars
    const t = ts * 0.001;
    for (const s of stars) {
      const opac = 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.speed * 20 + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, 80%, 90%, ${opac})`;
      ctx.fill();
    }

    // Draw shooting stars
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const ss = shootingStars[i];
      ss.x += Math.cos(ss.angle) * ss.speed;
      ss.y += Math.sin(ss.angle) * ss.speed;
      ss.life -= ss.decay;

      if (ss.life <= 0) { shootingStars.splice(i, 1); continue; }

      const grad = ctx.createLinearGradient(
        ss.x, ss.y,
        ss.x - Math.cos(ss.angle) * ss.len,
        ss.y - Math.sin(ss.angle) * ss.len
      );
      grad.addColorStop(0, `rgba(200, 180, 255, ${ss.life})`);
      grad.addColorStop(0.4, `rgba(167, 139, 250, ${ss.life * 0.5})`);
      grad.addColorStop(1, 'rgba(167, 139, 250, 0)');

      ctx.beginPath();
      ctx.moveTo(ss.x, ss.y);
      ctx.lineTo(
        ss.x - Math.cos(ss.angle) * ss.len,
        ss.y - Math.sin(ss.angle) * ss.len
      );
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5 * ss.life;
      ctx.stroke();
    }

    animId = requestAnimationFrame(draw);
  }

  // ── Spawn Shooting Stars ─────────────────────────────────────
  function spawnShootingStars() {
    const spawn = () => {
      if (shootingStars.length < 3) {
        shootingStars.push(createShootingStar());
      }
      setTimeout(spawn, Math.random() * 4000 + 2500);
    };
    setTimeout(spawn, 1500);
  }

  // ── Init ─────────────────────────────────────────────────────
  resize();
  initStars();
  spawnShootingStars();
  animId = requestAnimationFrame(draw);
  window.addEventListener('resize', () => { resize(); initStars(); });

  return () => { cancelAnimationFrame(animId); };
}

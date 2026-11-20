const circle = (count, radius, { x = 0, y = 0, start = 0, step = 360 / count } = {}) =>
  Array.from({ length: count }, (_, i) => {
    const a = (start + i * step) * Math.PI / 180;
    return [x + radius * Math.cos(a), y, radius * Math.sin(a)];
  });

export const ramps = [30, 150].map(degrees => degrees * Math.PI / 180);
export const maps = {
  1: {
    name: 'Đảo Bến', islands: [{ x: 0, radius: 40 }],
    lanterns: [[0, 0, 25], [23.8, 0, 7.7], [14.7, 0, -20.2], [-14.7, 0, -20.2], [-23.8, 0, 7.7]],
    motes: [...circle(8, 12), ...circle(16, 33)],
    fog: circle(12, 37, { start: 15 }), shadeInterval: 480, shadeMax: 6, pads: [], charms: []
  },
  2: {
    name: 'Đảo Cau', islands: [{ x: 0, radius: 28 }, { x: 70, radius: 28 }],
    lanterns: [[0, 0, 20], [17, 0, -10], [-17, 0, -10], [70, 0, 20], [87, 0, -10], [53, 0, -10]],
    motes: [0, 70].flatMap(x => [...circle(4, 10, { x }), ...circle(8, 22, { x })]),
    fog: [0, 70].flatMap(x => circle(8, 26, { x, start: 22.5 })), shadeInterval: 420, shadeMax: 8,
    pads: [{ pos: [20, 0, 18], target: [70, 0, 0], up: 14, speed: 24 },
      { pos: [50, 0, -18], target: [0, 0, 0], up: 14, speed: 24 }], charms: [[35, 0, 0]]
  },
  3: {
    name: 'Đảo Chuông', islands: [{ x: 0, radius: 45 }],
    lanterns: [[0, 6, 6], [18, 3, 10], [-18, 3, 10], [35, 0, -10], [-35, 0, -10], [20, 0, -35], [-20, 0, -35]],
    motes: [...circle(18, 34), ...circle(8, 18, { y: 3, start: 20, step: 20 }), ...circle(4, 5, { y: 6, start: 45 })],
    fog: circle(16, 43), shadeInterval: 360, shadeMax: 10,
    pads: [{ pos: [0, 3, 13], target: [0, 3, 0], up: 12, speed: 8 }], charms: [[30, 0, 25], [-30, 0, 25]]
  }
};

export function groundAt(night, x, z) {
  const r = Math.hypot(x, z);
  if (night === 3) {
    if (r <= 8) return 6;
    if (r >= 12 && r <= 24 && z > 0) return 3;
    for (const a of ramps) {
      const along = x * Math.cos(a) + z * Math.sin(a);
      const side = z * Math.cos(a) - x * Math.sin(a);
      if (along >= 23.9 && along <= 30 && Math.abs(side) <= 1.5) return Math.min(3, (30 - along) / 2);
    }
  }
  if (night === 2 && x >= 26 && x <= 44 && Math.abs(z) <= 2) return 0;
  return maps[night].islands.some(island => Math.hypot(x - island.x, z) <= island.radius) ? 0 : -Infinity;
}

import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';

export type BuildingId = 'workshop' | 'market' | 'homes' | 'civic' | 'park' | 'bank' | 'business' | 'realEstate' | 'academy' | 'insurance' | 'labor';
type RivalActivity = { playerId: string; displayName: string; style: string; action: string; category: string | null; amountTomans: string; status: string };
type Props = { selected: BuildingId; levels: Partial<Record<BuildingId, number>>; homeTier: number; zoom: number; reducedMotion?: boolean; rivalActions?: RivalActivity[]; onSelect: (id: BuildingId) => void };
type Point = { x: number; y: number };
type Landmark = { id: BuildingId; x: number; y: number; color: number; icon: string; title: string; height: number };

const INK = 0x1e293b;
const WHITE = 0xf8fafc;
const GOLD = 0xf59e0b;
const WIDTH = 1180;
const HEIGHT = 1230;
const landmarks: Landmark[] = [
  { id: 'bank', x: 245, y: 252, color: 0xe7af36, icon: '◆', title: 'بانک شهر', height: 104 },
  { id: 'academy', x: 560, y: 252, color: 0x7588cf, icon: '✦', title: 'دانشکده', height: 116 },
  { id: 'market', x: 885, y: 252, color: 0xed9153, icon: '▤', title: 'بازار بزرگ', height: 82 },
  { id: 'homes', x: 160, y: 520, color: 0x52a4d6, icon: '⌂', title: 'خانه من', height: 105 },
  { id: 'workshop', x: 445, y: 520, color: 0x597ed2, icon: '⚙', title: 'کارگاه', height: 91 },
  { id: 'business', x: 745, y: 520, color: 0x319e9c, icon: '▣', title: 'برج کسب‌وکار', height: 150 },
  { id: 'insurance', x: 1040, y: 520, color: 0x79a99a, icon: '✚', title: 'بیمه', height: 96 },
  { id: 'realEstate', x: 245, y: 790, color: 0xdd8181, icon: '⌂', title: 'مشاور املاک', height: 82 },
  { id: 'civic', x: 560, y: 790, color: 0x4f9e81, icon: '✦', title: 'مرکز شهر', height: 104 },
  { id: 'labor', x: 885, y: 790, color: 0x559cc5, icon: '●', title: 'بازار کار', height: 82 },
  { id: 'park', x: 560, y: 1060, color: 0x4fac75, icon: '✿', title: 'پارک شهر', height: 0 },
];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const diamond = (x: number, y: number, w: number, d: number) => [x, y - d, x + w, y, x, y + d, x - w, y];
const poly = (g: Graphics, points: number[], fill: number, width = 3) => g.poly(points).fill(fill).stroke({ color: INK, width, join: 'round' });
const stroke = (g: Graphics, points: number[], color = INK, width = 3) => g.poly(points).stroke({ color, width, cap: 'round', join: 'round' });
function text(value: string, size = 10, color = INK) {
  const result = new Text({ text: value, style: { fontFamily: 'Vazirmatn, Tahoma, sans-serif', fontSize: size, fontWeight: '900', fill: color, align: 'center' } });
  result.anchor.set(0.5);
  return result;
}
function windowFace(g: Graphics, x: number, y: number) {
  poly(g, [x, y, x + 17, y + 9, x + 17, y + 29, x, y + 20], 0xccecf7, 2);
  stroke(g, [x + 8, y + 4, x + 8, y + 24], INK, 1.3);
}
function makeBuilding(item: Landmark, tier: number) {
  const g = new Graphics();
  const h = item.height;
  if (item.id === 'park') {
    poly(g, diamond(0, 8, 73, 38), 0x91cf91);
    poly(g, diamond(0, 4, 55, 26), 0xc7eaa1, 2);
    for (const [x, y] of [[-32, 2], [4, -11], [34, 8]]) {
      stroke(g, [x, y + 20, x, y]);
      poly(g, [x, y - 24, x + 14, y, x, y + 7, x - 14, y], 0x23a471);
    }
    g.ellipse(0, 22, 20, 6).fill(0x7db8ce);
    return g;
  }
  const front = item.id === 'bank' ? 0xffd36b : item.color;
  const side = item.id === 'bank' ? 0xc99036 : item.id === 'homes' ? 0x2277ad : item.id === 'workshop' ? 0x3263b5 : 0x667fa6;
  poly(g, [-67, -h, 0, 34 - h, 0, 34, -67, 0], front);
  poly(g, [0, 34 - h, 67, -h, 67, 0, 0, 34], side);
  poly(g, [0, -h - 34, 67, -h, 0, 34 - h, -67, -h], item.id === 'bank' ? 0xfff4ca : WHITE);
  if (item.id === 'bank') {
    poly(g, [-77, -h - 3, 0, -h + 35, 77, -h - 3, 0, -h - 43], GOLD);
    for (const x of [-51, -24]) poly(g, [x, -h + 17, x + 11, -h + 22, x + 11, -6, x, -11], 0xfff7dc, 2);
    poly(g, [-1, -h + 41, 11, -h + 47, 11, 31, -1, 25], 0xfff7dc, 2);
    g.circle(0, -h - 7, 7).fill(GOLD).stroke({ color: INK, width: 2 });
  } else if (item.id === 'market') {
    poly(g, [-75, -h - 4, 0, -h + 33, 75, -h - 4, 0, -h - 40], 0xffcb64);
    for (let i = 0; i < 4; i += 1) poly(g, [-65 + i * 31, -h + 8 + i * 8, -34 + i * 31, -h + 24 + i * 8, -34 + i * 31, -h + 42 + i * 8, -65 + i * 31, -h + 26 + i * 8], i % 2 ? WHITE : 0xe85758, 1.5);
    windowFace(g, -52, -h + 50);
    windowFace(g, 22, -h + 53);
  } else if (item.id === 'business' || item.id === 'academy') {
    for (let row = 0; row < (item.id === 'business' ? 4 : 3); row += 1) {
      windowFace(g, -50, -h + 18 + row * 29);
      windowFace(g, -19, -h + 32 + row * 29);
      poly(g, [22, -h + 25 + row * 28, 46, -h + 13 + row * 28, 46, -h + 34 + row * 28, 22, -h + 46 + row * 28], 0xbbe9ed, 2);
    }
    if (item.id === 'academy') {
      poly(g, [-29, -h - 35, 0, -h - 49, 29, -h - 35, 0, -h - 20], 0x3e527e);
      stroke(g, [0, -h - 20, 0, -h - 8], GOLD);
    } else {
      g.circle(0, -h - 5, 12).fill(GOLD).stroke({ color: INK, width: 3 });
      g.circle(0, -h - 5, 5).fill(WHITE).stroke({ color: INK, width: 2 });
    }
  } else if (item.id === 'homes' || item.id === 'realEstate') {
    windowFace(g, -47, -h + 34);
    windowFace(g, 22, -h + 38);
    poly(g, [-15, -h + 57, 5, -h + 67, 5, 31, -15, 21], 0x79533b);
    if (item.id === 'realEstate') {
      poly(g, [-9, -h - 38, 0, -h - 47, 9, -h - 38, 0, -h - 29], GOLD);
      stroke(g, [0, -h - 30, 0, -h - 18], INK, 2);
    } else if (tier > 0) {
      const top = -h - 50 - tier * 13;
      poly(g, [-44, -h - 15, 0, -h + 8, 0, top + 28, -44, top + 7], 0xb8d8eb);
      poly(g, [0, -h + 8, 44, -h - 15, 44, top + 7, 0, top + 28], 0x3f83b6);
      poly(g, [0, top - 15, 44, top + 7, 0, top + 28, -44, top + 7], tier > 2 ? GOLD : WHITE);
      windowFace(g, -28, top + 18);
      if (tier > 1) windowFace(g, 16, top + 22);
    }
  } else if (item.id === 'workshop') {
    poly(g, [-67, -h, -23, -h - 21, 20, -h, 67, -h, 0, 34 - h], 0xd7e5f6);
    for (const x of [-45, -13, 19]) stroke(g, [x, -h + 13, x, -h + 51], INK, 2);
    poly(g, [28, -h - 21, 43, -h - 29, 43, -h + 1, 28, -h + 9], 0x9aabba);
    windowFace(g, -48, -35);
  } else {
    windowFace(g, -48, -h + 43);
    windowFace(g, 23, -h + 38);
    if (item.id === 'insurance') {
      poly(g, [-15, -h - 6, 0, -h + 2, 15, -h - 6, 0, -h - 16], 0x10b981);
      stroke(g, [0, -h - 13, 0, -h + 5], WHITE, 2);
    }
    if (item.id === 'labor') {
      poly(g, [-27, -h + 48, -2, -h + 61, -2, -h + 22, -27, -h + 9], 0xfef3c7);
      stroke(g, [-22, -h + 29, -7, -h + 36], INK, 2);
    }
  }
  return g;
}
function makeGround(world: Container) {
  const g = new Graphics();
  g.rect(0, 0, WIDTH, HEIGHT).fill(0x10b981);
  g.poly([0, 145, 535, 0, WIDTH, 195, WIDTH, HEIGHT, 0, HEIGHT]).fill(0x1fc893);
  g.poly([0, 900, 480, 650, WIDTH, 1000, WIDTH, HEIGHT, 0, HEIGHT]).fill(0x17b78a);
  for (let y = 180; y < 1190; y += 270) {
    poly(g, [-80, y + 75, 1140, y + 75, 1230, y + 130, -80, y + 130], 0x7a8fa4, 4);
    for (let x = 0; x < WIDTH; x += 75) stroke(g, [x, y + 102, x + 34, y + 102], WHITE, 3);
  }
  for (const x of [90, 375, 680, 980]) {
    poly(g, [x - 24, 0, x + 36, 0, x + 115, HEIGHT, x + 55, HEIGHT], 0x8598a9, 4);
    for (let y = 40; y < HEIGHT; y += 75) stroke(g, [x + 6 + y * 0.064, y, x + 10 + y * 0.064, y + 33], WHITE, 3);
  }
  world.addChild(g);
}

export function PixiCity({ selected, levels, homeTier, zoom, reducedMotion = false, rivalActions = [], onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const levelsRef = useRef(levels);
  const tierRef = useRef(homeTier);
  const zoomRef = useRef(zoom);
  const reducedMotionRef = useRef(reducedMotion);
  const setZoomRef = useRef<() => void>(() => {});
  const setLevelsRef = useRef<() => void>(() => {});
  const setHomeRef = useRef<() => void>(() => {});
  const setRivalActionsRef = useRef<(actions: RivalActivity[]) => void>(() => {});
  const rivalActionsRef = useRef(rivalActions);
  selectedRef.current = selected;
  onSelectRef.current = onSelect;
  levelsRef.current = levels;
  tierRef.current = homeTier;
  zoomRef.current = zoom;
  reducedMotionRef.current = reducedMotion;
  rivalActionsRef.current = rivalActions;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const start = async () => {
      const app = new Application();
      await app.init({ resizeTo: host, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true, antialias: true, background: '#10b981', preference: 'webgl' });
      if (disposed) { app.destroy(true, { children: true }); return; }
      host.appendChild(app.canvas);
      const world = new Container();
      app.stage.addChild(world);
      makeGround(world);
      const visuals = new Map<BuildingId, { root: Container; glow: Graphics; badge: Container; face: Graphics; label: Text; art: Graphics; badgeY: number }>();
      let focus: Point | null = null;
      let pulse = 0;
      let suppressTap = false;
      for (const item of landmarks) {
        const root = new Container();
        root.position.set(item.x, item.y);
        root.eventMode = 'static';
        root.cursor = 'pointer';
        const base = new Graphics();
        poly(base, diamond(0, 16, 117, 62), 0x9be2b0);
        poly(base, diamond(0, 6, 91, 46), 0xd2efcc, 2);
        const shadow = new Graphics().ellipse(18, 31, 70, 18).fill({ color: INK, alpha: 0.17 });
        const glow = new Graphics().ellipse(0, 21, 93, 38).fill({ color: GOLD, alpha: 0.27 }).stroke({ color: GOLD, width: 5 });
        glow.alpha = 0;
        const art = makeBuilding(item, tierRef.current);
        const badge = new Container();
        const badgeY = -item.height - 83;
        badge.y = badgeY;
        const face = new Graphics().roundRect(-51, -19, 102, 38, 15).fill(WHITE).stroke({ color: INK, width: 3 });
        face.circle(36, 0, 13).fill(item.color).stroke({ color: INK, width: 2 });
        const label = text(item.title);
        label.position.set(-9, 1);
        const icon = text(item.icon, 15, WHITE);
        icon.position.set(36, 0);
        badge.addChild(face, label, icon);
        root.addChild(base, shadow, glow, art, badge);
        root.on('pointertap', () => {
          if (suppressTap) return;
          selectedRef.current = item.id;
          focus = { x: item.x, y: item.y - 45 };
          pulse = 1;
          onSelectRef.current(item.id);
        });
        world.addChild(root);
        visuals.set(item.id, { root, glow, badge, face, label, art, badgeY });
      }
      const rivalMarkers = new Container();
      rivalMarkers.eventMode = 'none';
      world.addChild(rivalMarkers);
      setRivalActionsRef.current = (actions) => {
        rivalMarkers.removeChildren().forEach((child) => child.destroy({ children: true }));
        const locations: Record<string, Point> = { gold: { x: 245, y: 252 }, currency: { x: 885, y: 252 }, car: { x: 745, y: 520 }, equipment: { x: 445, y: 520 }, materials: { x: 445, y: 520 } };
        const colors: Record<string, number> = { conservative: 0x10b981, entrepreneur: 0x3b82f6, opportunist: 0xf59e0b, analyst: 0x8b5cf6, balanced: 0x14b8a6, consumer: 0xef5959 };
        actions.filter((action) => action.action === 'buy' && action.status !== 'rejected' && action.category).slice(0, 6).forEach((action, index) => {
          const point = locations[action.category!] ?? { x: 560, y: 790 };
          const marker = new Container();
          marker.position.set(point.x + (index % 3 - 1) * 30, point.y + 32 + Math.floor(index / 3) * 23);
          const color = colors[action.style] ?? 0x3b82f6;
          const person = new Graphics();
          person.ellipse(0, 16, 13, 5).fill({ color: INK, alpha: 0.22 });
          person.circle(0, -4, 7).fill(WHITE).stroke({ color: INK, width: 2.5 });
          poly(person, [-8, 4, 8, 4, 11, 17, -11, 17], color, 2.5);
          const tag = new Graphics().roundRect(-33, -35, 66, 19, 8).fill(WHITE).stroke({ color: INK, width: 2 });
          marker.addChild(tag, text(action.displayName.split(' ')[0], 8), person);
          marker.children[1].position.set(0, -26);
          rivalMarkers.addChild(marker);
        });
      };
      setRivalActionsRef.current(rivalActionsRef.current);
      const fixedNpcs = new Container();
      fixedNpcs.eventMode = 'none';
      const npcActors = [
        { id: 'bank', x: 270, y: 305, color: 0x10b981 }, { id: 'academy', x: 585, y: 314, color: 0x8b5cf6 },
        { id: 'market', x: 915, y: 310, color: 0xef5959 }, { id: 'homes', x: 180, y: 580, color: 0x0284c7 }, { id: 'workshop', x: 480, y: 580, color: 0x3b82f6 },
        { id: 'business', x: 780, y: 580, color: 0xf59e0b }, { id: 'insurance', x: 1070, y: 580, color: 0x10b981 },
        { id: 'realEstate', x: 280, y: 852, color: 0xef7777 }, { id: 'civic', x: 590, y: 852, color: 0x10b981 }, { id: 'labor', x: 918, y: 850, color: 0x0284c7 },
        { id: 'park', x: 590, y: 1090, color: 0x10b981 },
      ];
      const npcVisuals = npcActors.map((npc) => {
        const actor = new Container();
        actor.position.set(npc.x, npc.y);
        const body = new Graphics();
        body.ellipse(0, 15, 12, 4).fill({ color: INK, alpha: 0.2 });
        poly(body, [-8, 1, 8, 1, 11, 15, -11, 15], npc.color, 2.5);
        stroke(body, [-3, 15, -5, 22], INK, 2); stroke(body, [3, 15, 5, 22], INK, 2);
        body.circle(0, -7, 7).fill(0xffd5b5).stroke({ color: INK, width: 2.5 });
        body.arc(0, -9, 7, Math.PI, Math.PI * 2).stroke({ color: INK, width: 3 });
        actor.addChild(body); fixedNpcs.addChild(actor);
        return { id: npc.id, actor, y: npc.y };
      });
      world.addChild(fixedNpcs);
      const actors = new Container();
      actors.eventMode = 'none';
      world.addChild(actors);
      const cars = [0xef5959, 0xf4bc46, 0x56a9e3].map((color) => {
        const car = new Graphics();
        poly(car, [0, 7, 15, -3, 34, 7, 19, 17], color, 2.5);
        poly(car, [8, 5, 15, 0, 25, 5, 18, 11], WHITE, 1.5);
        actors.addChild(car);
        return car;
      });
      const people = [0xf59e0b, 0x3b82f6, 0xe96e72, WHITE].map((color) => {
        const person = new Graphics();
        person.ellipse(0, 12, 9, 3).fill({ color: INK, alpha: 0.2 });
        stroke(person, [-2, 2, -4, 11], INK, 2.5);
        stroke(person, [2, 2, 4, 11], INK, 2.5);
        poly(person, [-5, -3, 5, -3, 7, 5, -7, 5], color, 2);
        person.circle(0, -8, 4).fill(WHITE).stroke({ color: INK, width: 2 });
        actors.addChild(person);
        return person;
      });
      const smoke = new Container();
      for (let i = 0; i < 3; i += 1) smoke.addChild(new Graphics().circle(i * 6, -i * 9, 5 + i).fill({ color: WHITE, alpha: 0.5 }));
      smoke.position.set(474, 377);
      actors.addChild(smoke);

      const pointers = new Map<number, Point>();
      const camera = { x: 560, y: 555, scale: 1 };
      let downAt: Point | null = null;
      let pinchDistance = 0;
      let pinchScale = 1;
      const baseScale = () => Math.max(app.screen.width / 730, app.screen.height / 1110);
      const scaleLimits = () => [baseScale() * 0.88, baseScale() * 2.65] as const;
      const constrain = () => {
        const halfX = app.screen.width / (2 * camera.scale);
        const halfY = app.screen.height / (2 * camera.scale);
        camera.x = clamp(camera.x, Math.min(halfX, 245), Math.max(WIDTH - halfX, WIDTH - 245));
        camera.y = clamp(camera.y, Math.min(halfY, 210), Math.max(HEIGHT - halfY, HEIGHT - 210));
      };
      const renderCamera = () => {
        constrain();
        world.pivot.set(camera.x, camera.y);
        world.position.set(app.screen.width / 2, app.screen.height / 2);
        world.scale.set(camera.scale);
      };
      const zoomAt = (scale: number, point: Point) => {
        const [min, max] = scaleLimits();
        const next = clamp(scale, min, max);
        camera.x += (point.x - app.screen.width / 2) * (1 / camera.scale - 1 / next);
        camera.y += (point.y - app.screen.height / 2) * (1 / camera.scale - 1 / next);
        camera.scale = next;
        renderCamera();
      };
      const resize = () => { camera.scale = clamp(baseScale() * zoomRef.current, ...scaleLimits()); renderCamera(); };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      setZoomRef.current = () => zoomAt(baseScale() * zoomRef.current, { x: app.screen.width / 2, y: app.screen.height / 2 });
      setLevelsRef.current = () => {
        for (const item of landmarks) {
          const visual = visuals.get(item.id)!;
          const level = clamp(Math.trunc(levelsRef.current[item.id] ?? 0), 0, 5);
          visual.face.tint = level > 0 ? 0xfff6d6 : WHITE;
          visual.label.text = level > 0 ? `${item.title} · ${new Intl.NumberFormat('fa-IR').format(level)}` : item.title;
        }
      };
      setHomeRef.current = () => {
        const home = visuals.get('homes')!;
        const index = home.root.getChildIndex(home.art);
        home.root.removeChild(home.art);
        home.art.destroy();
        home.art = makeBuilding(landmarks.find((item) => item.id === 'homes')!, tierRef.current);
        home.root.addChildAt(home.art, index);
        home.badgeY = -188 - (tierRef.current > 0 ? 35 + tierRef.current * 13 : 0);
      };
      setLevelsRef.current();
      const local = (event: Point) => { const rect = app.canvas.getBoundingClientRect(); return { x: event.x - rect.left, y: event.y - rect.top }; };
      const pointerDown = (event: PointerEvent) => {
        const point = local(event);
        pointers.set(event.pointerId, point);
        app.canvas.setPointerCapture(event.pointerId);
        focus = null;
        if (pointers.size === 1) { downAt = point; suppressTap = false; }
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
          pinchScale = camera.scale;
          suppressTap = true;
        }
      };
      const pointerMove = (event: PointerEvent) => {
        const previous = pointers.get(event.pointerId);
        if (!previous) return;
        const point = local(event);
        pointers.set(event.pointerId, point);
        if (pointers.size >= 2) {
          const [a, b] = [...pointers.values()];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinchDistance > 0) zoomAt(pinchScale * distance / pinchDistance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          suppressTap = true;
          return;
        }
        if (downAt && Math.hypot(point.x - downAt.x, point.y - downAt.y) > 5) suppressTap = true;
        camera.x -= (point.x - previous.x) / camera.scale;
        camera.y -= (point.y - previous.y) / camera.scale;
        renderCamera();
      };
      const pointerUp = (event: PointerEvent) => {
        pointers.delete(event.pointerId);
        downAt = pointers.size === 1 ? [...pointers.values()][0] : null;
        if (!pointers.size) pinchDistance = 0;
      };
      const wheel = (event: WheelEvent) => { event.preventDefault(); zoomAt(camera.scale * Math.exp(-event.deltaY * 0.001), local(event)); };
      app.canvas.addEventListener('pointerdown', pointerDown);
      app.canvas.addEventListener('pointermove', pointerMove);
      app.canvas.addEventListener('pointerup', pointerUp);
      app.canvas.addEventListener('pointercancel', pointerUp);
      app.canvas.addEventListener('wheel', wheel, { passive: false });
      const systemMotionPreference = matchMedia('(prefers-reduced-motion: reduce)');
      const motionEnabled = () => !reducedMotionRef.current && !systemMotionPreference.matches;
      let elapsed = 0;
      app.ticker.maxFPS = 60;
      app.ticker.add((ticker) => {
        const motion = motionEnabled();
        elapsed += ticker.deltaMS;
        if (focus) {
          const factor = motion ? Math.min(1, ticker.deltaMS * 0.006) : 1;
          camera.x += (focus.x - camera.x) * factor;
          camera.y += (focus.y - camera.y) * factor;
          if (Math.hypot(focus.x - camera.x, focus.y - camera.y) < 0.8) focus = null;
          renderCamera();
        }
        pulse = Math.max(0, pulse - ticker.deltaMS / 360);
        for (const item of landmarks) {
          const visual = visuals.get(item.id)!;
          const active = selectedRef.current === item.id;
          visual.glow.alpha = active ? 0.85 : 0;
          const bounce = active && motion ? Math.sin(pulse * Math.PI) : 0;
          visual.root.scale.set(1 + bounce * 0.09, 1 - bounce * 0.06);
          visual.badge.y = visual.badgeY + (motion ? Math.sin(elapsed * 0.0022 + item.x * 0.01) * 4 : 0);
        }
        if (!motion) return;
        cars.forEach((car, i) => { const t = (elapsed * (0.00013 + i * 0.000025) + i * 0.32) % 1; car.position.set(-20 + t * 1240, 562 + i * 15); });
        people.forEach((person, i) => { const t = (elapsed * 0.00009 + i * 0.24) % 1; person.position.set(100 + t * 965, i % 2 ? 840 : 300 + i * 10 + Math.sin(elapsed * 0.01 + i) * 2); });
        npcVisuals.forEach((npc, i) => { npc.actor.y = npc.y + Math.sin(elapsed * 0.0024 + i * 1.1) * 2; npc.actor.scale.set(selectedRef.current === npc.id ? 1.14 : 1); });
        smoke.alpha = 0.35 + Math.sin(elapsed * 0.002) * 0.15;
        smoke.y = 377 - (elapsed * 0.009) % 18;
      });
      cleanup = () => {
        observer.disconnect();
        app.canvas.removeEventListener('pointerdown', pointerDown);
        app.canvas.removeEventListener('pointermove', pointerMove);
        app.canvas.removeEventListener('pointerup', pointerUp);
        app.canvas.removeEventListener('pointercancel', pointerUp);
        app.canvas.removeEventListener('wheel', wheel);
        app.destroy(true, { children: true });
        setZoomRef.current = () => {};
        setLevelsRef.current = () => {};
        setHomeRef.current = () => {};
        setRivalActionsRef.current = () => {};
      };
      if (disposed) cleanup();
    };
    void start().catch((error) => { console.error('Pixi city failed to load', error); host.dataset.loadError = 'true'; });
    return () => { disposed = true; cleanup?.(); };
  }, []);
  useEffect(() => setZoomRef.current(), [zoom]);
  useEffect(() => setLevelsRef.current(), [levels]);
  useEffect(() => setHomeRef.current(), [homeTier]);
  useEffect(() => setRivalActionsRef.current(rivalActions), [rivalActions]);
  return <div className="pixi-world" ref={hostRef} aria-label="نقشهٔ تعاملی شهر؛ برای جابه‌جایی بکشید و برای بزرگ‌نمایی دو انگشت به کار ببرید" />;
}

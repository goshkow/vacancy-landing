import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// настоящая 3D-модель iPhone, а экран остаётся живым HTML: его углы
// проецируются камерой и превращаются в matrix3d для .phone__screen
export async function mountPhone(host, screen) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0, 0);
  renderer.domElement.className = 'phone__webgl';
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  scene.environment = pmrem.fromScene(environment, .04).texture;
  environment.dispose(); pmrem.dispose();
  const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(-3, 4, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xcbd6ed, .55); fill.position.set(4, 0, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xe2e9f5, 1.1); rim.position.set(3, 2, -2); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 30);
  camera.position.set(0, 0, 6.2);
  const rig = new THREE.Group(); scene.add(rig);

  const gltf = await new GLTFLoader().loadAsync(new URL('../models/iphone-17-pro-max.glb', import.meta.url).href);
  const model = gltf.scene;
  const bodyMaterials = new Set();
  let screenMesh = null;
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map(material => {
      if (material.name === 'screen.001') { screenMesh = mesh; return new THREE.MeshBasicMaterial({ color: 0x000000 }); }
      if (material.name === 'black.002') return new THREE.MeshBasicMaterial({ color: 0x020203 });
      if (material.name === 'glass.002' || material.name === 'lensinglass') { material.roughness = .22; material.metalness = 0; material.opacity = .08; material.transparent = true; material.depthWrite = false; return material; }
      if (/basecolor|metalframe|backpanel|metaL|gray/.test(material.name)) { bodyMaterials.add(material); material.metalness = .78; material.roughness = .32; }
      material.envMapIntensity = .8;
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
  model.rotation.y = Math.PI / 2; model.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(3 / size.y); model.updateMatrixWorld(true);
  model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
  rig.add(model); rig.updateMatrixWorld(true);

  // углы экрана на передней грани, в системе rig
  const box = new THREE.Box3().setFromObject(screenMesh);
  const inset = Number(host.dataset.inset || 0);
  const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
  const x0 = box.min.x + w * inset, x1 = box.max.x - w * inset;
  const y0 = box.min.y + h * inset, y1 = box.max.y - h * inset;
  const z = box.max.z;
  const corners = [[x0, y1], [x1, y1], [x1, y0], [x0, y0]].map(([x, y]) => new THREE.Vector3(x, y, z));
  host.style.setProperty('--screen-ratio', String((x1 - x0) / (y1 - y0)));
  host.dataset.screenRatio = String((x1 - x0) / (y1 - y0));

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false, frame = 0, last = 0, clock = 0;
  const point = new THREE.Vector3();

  // квадрат -> четырёхугольник (Heckbert), потом в matrix3d
  const place = () => {
    const W = screen.offsetWidth, H = screen.offsetHeight, width = host.clientWidth, height = host.clientHeight;
    if (!W || !H) return;
    const p = corners.map(c => { point.copy(c); rig.localToWorld(point); point.project(camera); return [(point.x + 1) / 2 * width, (1 - point.y) / 2 * height]; });
    const [[ax, ay], [bx, by], [cx, cy], [dx, dy]] = p;
    const dx1 = bx - cx, dx2 = dx - cx, dx3 = ax - bx + cx - dx;
    const dy1 = by - cy, dy2 = dy - cy, dy3 = ay - by + cy - dy;
    const det = dx1 * dy2 - dy1 * dx2;
    const g = (dx3 * dy2 - dy3 * dx2) / det, k = (dx1 * dy3 - dy1 * dx3) / det;
    const a = bx - ax + g * bx, b = dx - ax + k * dx, d = by - ay + g * by, e = dy - ay + k * dy;
    screen.style.transform = `matrix3d(${a / W},${d / W},0,${g / W},${b / H},${e / H},0,${k / H},0,0,1,0,${ax},${ay},0,1)`;
  };
  const paint = () => {
    rig.rotation.set(.03 + Math.sin(clock * .3) * .02, Math.sin(clock * .26) * .2 - .1, 0);
    rig.updateMatrixWorld(true);
    renderer.render(scene, camera);
    place();
  };
  const resize = () => {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // модель высотой 3 целиком помещается в блок и по высоте, и по ширине
    const half = Math.tan(Math.PI / 12);
    camera.position.z = Math.max(3.45 / (2 * half), 1.85 / (2 * camera.aspect * half));
    bodyMaterials.forEach(material => { material.color.set(0x3b3e43); material.envMapIntensity = .7; });
    camera.updateProjectionMatrix(); paint();
  };
  const animate = now => {
    frame = 0;
    if (!visible || document.hidden || motion.matches) return;
    if (now - last >= 1000 / 40) { clock += Math.min((now - last) / 1000, .05); last = now; paint(); }
    frame = requestAnimationFrame(animate);
  };
  const sync = () => {
    cancelAnimationFrame(frame); frame = 0; last = performance.now();
    if (visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(animate); else paint();
  };

  host.prepend(renderer.domElement);
  resize();
  host.classList.add('has-webgl');
  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, { threshold: .1 }).observe(host);
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); host.classList.remove('has-webgl'); screen.style.transform = ''; cancelAnimationFrame(frame); });
}

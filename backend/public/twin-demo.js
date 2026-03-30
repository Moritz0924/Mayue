import * as THREE from "https://esm.sh/three@0.183.1";
import { OrbitControls } from "https://esm.sh/three@0.183.1/examples/jsm/controls/OrbitControls.js";

const MESSAGE_SOURCE = "mayue-twin";
const DASHBOARD_SOURCE = "mayue-dashboard";

const query = new URLSearchParams(window.location.search);
const modelId = query.get("model_id") || "demo_tower";

const viewport = document.getElementById("viewport");
const selection = document.getElementById("selection");

if (!viewport) {
  throw new Error("Missing #viewport container.");
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);

const camera = new THREE.PerspectiveCamera(
  45,
  viewport.clientWidth / viewport.clientHeight,
  0.1,
  500
);
camera.position.set(42, 38, 56);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 28, 0);

const ambient = new THREE.AmbientLight(0xffffff, 1.4);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(24, 42, 30);
scene.add(dirLight);

const grid = new THREE.GridHelper(120, 24, 0x334155, 0x1e293b);
scene.add(grid);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const meshes = new Map();
let selectedElementId = "";

function toneOf(status) {
  if (status === "HIGH") return "high";
  if (status === "MEDIUM") return "medium";
  return "normal";
}

function colorOf(status) {
  if (status === "HIGH") return 0xe53935;
  if (status === "MEDIUM") return 0xfb8c00;
  return 0x4caf50;
}

function geometryFor(element) {
  const [sx, sy, sz] = element.size;
  if (element.shape === "cylinder") {
    return new THREE.CylinderGeometry(sx, sz || sx, sy, 24);
  }
  return new THREE.BoxGeometry(sx, sy, sz);
}

function materialFor(status, selected = false) {
  const emissiveIntensity = selected
    ? 0.34
    : status === "HIGH"
      ? 0.22
      : status === "MEDIUM"
        ? 0.12
        : 0.04;
  return new THREE.MeshStandardMaterial({
    color: colorOf(status),
    metalness: 0.15,
    roughness: 0.65,
    emissive: colorOf(status),
    emissiveIntensity,
  });
}

function applyMaterial(mesh, status, selected = false) {
  if (mesh.material) {
    mesh.material.dispose();
  }
  mesh.material = materialFor(status, selected);
}

function renderSelectionPanel(item) {
  if (!selection) return;
  const recentAlert =
    Array.isArray(item.alerts) && item.alerts.length > 0
      ? item.alerts[item.alerts.length - 1]
      : null;
  const level = toneOf(recentAlert?.level === "L2" ? "HIGH" : recentAlert ? "MEDIUM" : "NORMAL");
  const levelText = level === "high" ? "高风险" : level === "medium" ? "中风险" : "正常";
  selection.innerHTML = `
    <h3 style="margin:0 0 8px">${item.name}</h3>
    <div class="pill ${level}">${levelText}</div>
    <div class="muted" style="margin-top:8px">element_id: ${item.element_id}</div>
    <ul>
      <li>位移 disp: ${item.latest_metrics?.disp ?? "-"}</li>
      <li>振动 vib: ${item.latest_metrics?.vib ?? "-"}</li>
      <li>温度 temp: ${item.latest_metrics?.temp ?? "-"}</li>
      <li>风速 wind: ${item.latest_metrics?.wind ?? "-"}</li>
    </ul>
    <div class="muted" style="margin-top:10px">最近告警数: ${item.alerts?.length ?? 0}</div>
  `;
}

function postToParent(message) {
  if (window.parent === window) return;
  window.parent.postMessage(
    {
      source: MESSAGE_SOURCE,
      ...message,
      model_id: modelId,
    },
    window.location.origin
  );
}

function refreshSelectionHighlight() {
  for (const [elementId, mesh] of meshes.entries()) {
    const status = mesh.userData?.status || "NORMAL";
    applyMaterial(mesh, status, elementId === selectedElementId);
  }
}

async function selectElement(elementId, notifyParent = true) {
  if (!elementId || !meshes.has(elementId)) return;
  selectedElementId = elementId;
  refreshSelectionHighlight();

  try {
    const response = await fetch(`/api/twin/elements/${elementId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const item = await response.json();
    renderSelectionPanel(item);
  } catch {
    if (selection) {
      selection.innerHTML = `
        <h3 style="margin:0 0 8px">${elementId}</h3>
        <div class="muted">构件详情拉取失败，已保留孪生高亮。</div>
      `;
    }
  }

  if (notifyParent) {
    postToParent({ type: "twin:selected", element_id: elementId });
  }
}

async function loadScene() {
  const response = await fetch(`/api/twin/scene?model_id=${encodeURIComponent(modelId)}`);
  if (!response.ok) throw new Error(`Failed to load scene: ${response.status}`);
  const payload = await response.json();

  const incomingIds = new Set(payload.elements.map((element) => element.element_id));

  for (const [elementId, mesh] of meshes.entries()) {
    if (!incomingIds.has(elementId)) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      meshes.delete(elementId);
    }
  }

  for (const element of payload.elements) {
    let mesh = meshes.get(element.element_id);
    if (!mesh) {
      mesh = new THREE.Mesh(geometryFor(element), materialFor(element.status));
      mesh.position.set(...element.position);
      scene.add(mesh);
      meshes.set(element.element_id, mesh);
    }
    mesh.userData = {
      element_id: element.element_id,
      status: element.status,
    };
    applyMaterial(mesh, element.status, element.element_id === selectedElementId);
  }

  if (!selectedElementId && payload.elements.length > 0) {
    await selectElement(payload.elements[0].element_id, false);
  }
}

renderer.domElement.addEventListener("pointerdown", async (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(Array.from(meshes.values()));
  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    await selectElement(mesh.userData.element_id, true);
  }
});

window.addEventListener("message", async (event) => {
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.source !== DASHBOARD_SOURCE) return;

  if (data.type === "dashboard:select" && typeof data.element_id === "string") {
    await selectElement(data.element_id, false);
    return;
  }

  if (data.type === "dashboard:refresh") {
    await loadScene();
  }
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

async function bootstrap() {
  try {
    await loadScene();
    postToParent({ type: "twin:ready" });
  } catch {
    if (selection) {
      selection.innerHTML = `
        <h3 style="margin-top:0">数字孪生加载失败</h3>
        <div class="muted">请确认后端服务已启动，并可访问 /api/twin/scene</div>
      `;
    }
  }
  setInterval(() => {
    void loadScene();
  }, 8000);
}

void bootstrap();
animate();

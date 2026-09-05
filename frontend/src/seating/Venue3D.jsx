import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { center, seatPositions } from './geometry.js';

// Blender asset contains architecture only. Live layout remains the source of furniture.
export default function Venue3D({ layout, route, focus, onFocus, onFallback }) {
  const host = useRef(null);
  const [status, setStatus] = useState('loading');
  const [interior, setInterior] = useState(false);
  const mode = useRef(null);
  const updates=useRef(null);
  const focusRef = useRef(onFocus); focusRef.current = onFocus;
  useEffect(() => {
    const el = host.current;
    let renderer, alive = true, controls, model;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#eee7de');
    const camera = new THREE.PerspectiveCamera(48, 1, .1, 200);
    const disposable = new Set();
    const disposeTree = root => root.traverse(o => {
      o.geometry?.dispose();
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose();
      }
    });
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' }); }
    catch { setStatus('error'); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '可拖曳旋轉的宴會廳，使用平面圖可查看完整座位文字');
    scene.add(new THREE.HemisphereLight(0xfff3dc, 0x746556, 2.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(8,25,15); scene.add(sun);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false; controls.minDistance = 2; controls.maxDistance = 65;
    controls.maxPolarAngle = Math.PI / 2 - .04;
    const render = () => { if (alive) renderer.render(scene, camera); };
    controls.addEventListener('change', render);
    const applyMode = inside => {
      if (model) model.traverse(o => {
        const layer = o.userData.venue_layer || o.name;
        if (/^Ceiling|^Chandeliers/.test(layer)) o.visible = inside;
        if (/^Wall_Entry/.test(layer)) o.visible = inside;
      });
      if (inside) { camera.position.set(16,3.2,8); controls.target.set(-3,2.5,-2); }
      else { camera.position.set(23,32,32); controls.target.set(0,0,0); }
      controls.update(); render();
    };
    mode.current = applyMode; applyMode(false);
    const cw = layout?.canvas?.w || 1600, ch = layout?.canvas?.h || 1000;
    const mapScale=new THREE.Matrix4().makeScale(38/cw,1,20/ch);
    const point = (x,y,z=.05) => new THREE.Vector3(x/cw*38-19,z,y/ch*20-10);
    const meshes = [];
    const mat = (color) => { const m = new THREE.MeshStandardMaterial({ color, roughness:.65 }); disposable.add(m); return m; };
    const tableMat = mat('#cfb798'), mineMat = mat('#a55565'), chairMat = mat('#b09270'), blockMat = mat('#a39a8a');
    function add(geometry, material, position, data, rotation=0) {
      disposable.add(geometry);
      const mesh = new THREE.Mesh(geometry,material); mesh.position.copy(position); mesh.rotation.y=-rotation*Math.PI/180;
      scene.add(mesh); if(data) { mesh.userData=data; meshes.push(mesh); } return mesh;
    }
    for (const o of layout?.objects || []) {
      if (['label','entrance'].includes(o.kind) || (o.kind==='zone' && !o.meta?.blocked)) continue;
      const c=center(o);
      const height=o.kind==='wall'?2.5:o.kind==='column'?7:o.kind==='stage'?.5:o.kind==='zone'?.15:o.kind==='chair'?.43:.75;
      const material=focus?.oid===o.id?mineMat:['round','rect','chair'].includes(o.kind)?tableMat:blockMat;
      const geometry=['round','column'].includes(o.kind)?new THREE.CylinderGeometry(c.w/2,c.w/2,height,32):new THREE.BoxGeometry(c.w,height,c.h);
      geometry.applyMatrix4(mapScale.clone().multiply(new THREE.Matrix4().makeRotationY(-(o.rotation||0)*Math.PI/180)));
      add(geometry,material,point(c.cx,c.cy,height/2),{oid:o.id});
      for(const [idx,p] of seatPositions(o).entries()) if(o.kind!=='chair') {
        add(new THREE.CylinderGeometry(11,11,.43,12).applyMatrix4(mapScale),focus?.oid===o.id&&focus?.idx===idx?mineMat:chairMat,point(p.x,p.y,.22),{oid:o.id,idx});
      }
      if(o.label) {
        const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=64;
        const ctx=canvas.getContext('2d'); ctx.fillStyle='rgba(255,250,242,.95)';ctx.fillRect(0,0,256,64);
        ctx.fillStyle='#4f3529';ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.fillText(o.label,128,43,242);
        const texture=new THREE.CanvasTexture(canvas);disposable.add(texture);
        const sm=new THREE.SpriteMaterial({map:texture,depthTest:false});disposable.add(sm);
        const sprite=new THREE.Sprite(sm);sprite.position.copy(point(c.cx,c.cy,height+.6));sprite.scale.set(2.9,.73,1);scene.add(sprite);
      }
    }
    const routeGroup=new THREE.Group();scene.add(routeGroup);
    updates.current=(nextRoute,nextFocus)=>{
      for(const mesh of meshes) {
        mesh.material=nextFocus?.oid===mesh.userData.oid&&(mesh.userData.idx===undefined||nextFocus.idx===mesh.userData.idx)?mineMat:mesh.userData.idx!==undefined?chairMat:['round','rect','chair'].includes(layout.objects.find(o=>o.id===mesh.userData.oid)?.kind)?tableMat:blockMat;
      }
      disposeTree(routeGroup);routeGroup.clear();
      if(!nextRoute?.points?.length){render();return;}
      const lineMat=new THREE.MeshBasicMaterial({color:'#9a435f'});
      const pts=nextRoute.points.map(p=>point(p.x,p.y,.1));
      const routeMesh=(geo,p)=>{const mesh=new THREE.Mesh(geo,lineMat);mesh.position.copy(p);routeGroup.add(mesh);return mesh;};
      for(let i=1;i<pts.length;i++) {
        const a=pts[i-1],b=pts[i];
        const geo=new THREE.CylinderGeometry(.07,.07,a.distanceTo(b),8);
        const mesh=routeMesh(geo,a.clone().add(b).multiplyScalar(.5));
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());
      }
      for (const p of [pts[0],pts.at(-1)]) routeMesh(new THREE.SphereGeometry(.18,12,8),p);
      render();
    };
    updates.current(route,focus);
    const loader=new GLTFLoader();
    setStatus('loading'); setInterior(false);
    loader.load('/models/grand-mayfull-2f.glb', gltf => {
      if(!alive) { disposeTree(gltf.scene); return; }
      model=gltf.scene; scene.add(model); applyMode(false); setStatus('ready');
    },undefined,()=>{if(alive)setStatus('error');});
    let down;
    const onDown=e=>{down={x:e.clientX,y:e.clientY};};
    const onUp=e=>{
      if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>8)return;
      const rect=el.getBoundingClientRect();const ray=new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
      const hit=ray.intersectObjects(meshes)[0];if(hit)focusRef.current?.(hit.object.userData);
    };
    const lost=e=>{e.preventDefault();setStatus('error');};
    renderer.domElement.addEventListener('pointerdown',onDown);renderer.domElement.addEventListener('pointerup',onUp);
    renderer.domElement.addEventListener('webglcontextlost',lost);
    const resize=new ResizeObserver(()=>{const {width,height}=el.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();render();});
    resize.observe(el);
    return()=>{
      alive=false;mode.current=null;updates.current=null;resize.disconnect();controls.dispose();
      renderer.domElement.removeEventListener('pointerdown',onDown);renderer.domElement.removeEventListener('pointerup',onUp);renderer.domElement.removeEventListener('webglcontextlost',lost);
      disposeTree(scene);disposable.forEach(x=>x.dispose());renderer.dispose();renderer.domElement.remove();
    };
  },[layout]);
  useEffect(()=>{updates.current?.(route,focus);},[route,focus]);
  return <div className="venue3d"><div className="venue3d-canvas" ref={host}/>
    {status==='loading'&&<div className="map-status" role="status">正在展開宴會廳…</div>}
    {status==='error'&&<div className="map-status" role="alert">3D 場地暫時無法顯示<button type="button" onClick={onFallback}>使用平面圖帶路</button></div>}
    {status==='ready'&&<button className="venue3d-mode" type="button" onClick={()=>{mode.current?.(!interior);setInterior(!interior);}}>{interior?'俯視座位':'進入宴會廳'}</button>}
  </div>;
}

"""Run through Blender MCP. Only creates/replaces the named project scene.

Set WEDDING_PROJECT_ROOT in the MCP code wrapper to the repository path.
Dimensions: Grand Mayfull official ballroom plan, 38 × 20 × 7.5 m.
Decorative placement is reconstructed from the supplied panoramas, not a survey.
No tables, chairs, portable staging or guest data belong in this asset.
"""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

root = Path(WEDDING_PROJECT_ROOT)
out = root / 'frontend/public/models'
out.mkdir(parents=True, exist_ok=True)
source = root / 'assets/venue'
source.mkdir(parents=True, exist_ok=True)
scene_name = 'Wedding_GrandMayfull_2F'
previous = bpy.context.window.scene
old = bpy.data.scenes.get(scene_name)
if old:
    # This collection is wholly owned by this script; other scenes stay intact.
    for obj in list(old.objects):
        if obj.users_scene == (old,):
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = bpy.data.scenes.new(scene_name)
bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene['reference'] = 'Grand Mayfull 2F ballroom; official 38 x 20 x 7.5 m; panorama-based decorative reconstruction'
scene['contains_furniture'] = False

def material(name, color, metallic=0, rough=.65, emission=0):
    m = bpy.data.materials.new('Wedding_' + name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if p is None:
        p = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        output = m.node_tree.nodes.new('ShaderNodeOutputMaterial')
        m.node_tree.links.new(p.outputs['BSDF'], output.inputs['Surface'])
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m

ivory = material('Ivory_panels', (.72,.65,.52))
gold = material('Brushed_brass', (.48,.32,.12), .7, .28)
carpet = material('Oatmeal_carpet', (.49,.45,.38), 0, 1)
plum = material('Plum_petals', (.16,.095,.16), 0, 1)
rust = material('Rust_petals', (.33,.11,.085), 0, 1)
ochre = material('Ochre_petals', (.4,.29,.1), 0, 1)
mirror = material('Mirror_panels', (.49,.53,.48), .85, .12)
curtain = material('Champagne_curtains', (.54,.47,.34), .05, .88)
screen = material('LED_idle', (.055,.03,.045), .05, .3)
glow = material('Warm_crystal', (1,.77,.42), .12, .25, .65)
white = material('Ceiling_cream', (.82,.77,.65))
dark = material('Track_lighting', (.3,.28,.23), .4, .4)
exit_green = material('Exit_green', (.025,.4,.24), 0, .4, .5)

# Batch by architectural layer and material: a small number of web draw calls.
batches = {}
def mesh_add(layer, mat, vertices, faces):
    key = (layer, mat.name)
    vs, fs = batches.setdefault(key, ([], []))
    offset = len(vs)
    vs.extend(vertices)
    fs.extend(tuple(offset+i for i in f) for f in faces)

def box(layer, mat, x,y,z, w,d,h):
    vs = [(x+a*w/2,y+b*d/2,z+c*h/2) for a,b,c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    mesh_add(layer,mat,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])

def cylinder(layer, mat, x,y,z, r,h, sides=12):
    vs = [(x+r*math.cos(i*math.tau/sides),y+r*math.sin(i*math.tau/sides),z+level*h/2) for level in (-1,1) for i in range(sides)]
    fs = [tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
    fs += [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
    mesh_add(layer,mat,vs,fs)

def ring_on_wall(layer,x,y,z,r):
    n=32
    vs=[(x+rr*math.cos(i*math.tau/n),y,z+rr*math.sin(i*math.tau/n)) for rr in (r-.025,r+.025) for i in range(n)]
    mesh_add(layer,gold,vs,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])

box('Floor',carpet,0,0,-.12,38,20,.24)
# Floral carpet motifs, flat geometry rather than downloaded photograph textures.
rng = random.Random(20270313)
for xx in range(-16,19,6):
    for yy in (-7,-1,5):
        cx,cy=xx+rng.uniform(-.65,.65),yy+rng.uniform(-.65,.65)
        mat=plum if rng.random()<.62 else rust
        for radius,count,length in ((.6,9,.48),(1.18,14,.65)):
            for i in range(count):
                a=i*math.tau/count
                px,py=cx+radius*math.cos(a),cy+radius*math.sin(a)
                verts=[]
                for j in range(12):
                    t=j*math.tau/12
                    u,v=length*math.cos(t),.21*math.sin(t)
                    verts.append((px+u*math.cos(a)-v*math.sin(a),py+u*math.sin(a)+v*math.cos(a),.008+radius*.004+i*.00001))
                if all(abs(p[0])<19 and abs(p[1])<10 for p in verts):
                    mesh_add('Floor',mat,verts,[tuple(range(12))])
        cylinder('Floor',ochre,cx,cy,.008,.2,.004)
# Fine striations soften the plain carpet.
for i in range(180):
    x=rng.uniform(-18.9,18.9); y=rng.uniform(-9.5,9.5)
    box('Floor',ivory,x,y,.002,.01,rng.uniform(.2,1.5),.003)

# Long walls: north = LED, south = foyer entrances. Front is hidden in map cutaway.
for side in (-1,1):
    layer='Wall_LED' if side==1 else 'Wall_Entry'
    y=side*10.12
    box(layer,ivory,0,y,3.6,38,.24,7.2)
    for z in (.18,1.15,2.35,3.55,5.1,6.25):
        box(layer,gold,0,side*9.98,z,38,.035,.022)
    for z,width in ((6.8,.3),(7.05,.55),(7.3,.8)):
        box(layer,white,0,side*(10-width/2),z,38,width,.22)
    for x in (-17,-11,-5,5,11,17):
        box(layer,mirror,x,side*9.94,3.25,1.0,.04,5.8)
        for dx in (-.5,-.27,.27,.5):
            box(layer,gold,x+dx,side*9.89,3.25,.025,.035,5.8)
        for z in (.35,1.1,2.3,3.5,4.7,5.8,6.15):
            box(layer,gold,x,side*9.89,z,1,.035,.023)
        box(layer,gold,x+1.1,side*9.82,3.25,.1,.13,.9)
        box(layer,glow,x+1.1,side*9.77,3.25,.12,.12,1.4)
    if side==-1:
        for x in (-14,-7,0,7,14):
            box(layer,gold,x,-9.92,2.9,3.9,.12,5.8)
            box(layer,curtain,x,-9.83,2,3.55,.09,4)
            box(layer,gold,x,-9.76,2,.035,.03,4)
            for dx in (-1.65,1.65):
                box(layer,gold,x+dx,-9.75,2,.025,.035,3.75)
            ring_on_wall(layer,x,-9.7,1.4,.34)
            box(layer,mirror,x,-9.82,4.9,3.55,.08,1.6)
            for dx in (-1.75,-.88,0,.88,1.75):
                box(layer,gold,x+dx,-9.75,4.9,.025,.035,1.6)
            box(layer,gold,x,-9.74,4.9,3.55,.03,.03)
            box(layer,exit_green,x,-9.7,4.14,.38,.08,.16)
    else:
        # Wide screen on long wall, curtains either side.
        box(layer,gold,0,9.75,3.05,10.4,.22,5.4)
        box(layer,screen,0,9.6,3.05,10.05,.08,5.05)
        for sign in (-1,1):
            for i in range(42):
                x=sign*(5.4+i*.21)
                cylinder(layer,curtain,x,9.65,3,.13,5.8,8)
            box(layer,gold,sign*9.5,9.5,6,8.4,.22,.2)

for side in (-1,1):
    layer='Wall_End_'+('East' if side==1 else 'West')
    box(layer,ivory,side*19.12,0,3.6,.24,20,7.2)
    for yy in (-5,5):
        box(layer,gold,side*18.96,yy,3,.08,8.5,6)
        box(layer,ivory,side*18.9,yy,2.05,.06,8.2,4.1)
        box(layer,mirror,side*18.9,yy,5.05,.06,8.2,1.65)
        for dy in (-4,-2,0,2,4):
            box(layer,gold,side*18.85,yy+dy,3,.035,.035,6)
        for z in (.2,3.95,4.3,5.05,5.85):
            box(layer,gold,side*18.84,yy,z,.035,8.2,.03)
    for z,width in ((6.8,.3),(7.05,.55),(7.3,.8)):
        box(layer,white,side*(19-width/2),0,z,width,20,.22)

box('Ceiling',white,0,0,7.58,38,20,.16)
for x in (-18,-12,-6,0,6,12,18):
    box('Ceiling',gold,x,0,7.46,.05,19,.035)
    box('Ceiling',white,x+.15,0,7.43,.1,19,.09)
for y in (-8,-4,0,4,8):
    box('Ceiling',gold,0,y,7.46,37,.05,.035)
for x in (-12,0,12):
    box('Ceiling',dark,x,0,6.75,.07,18,.08)
    for y in range(-8,9,2):
        cylinder('Ceiling',white,x,y,6.56,.12,.28,10)

# Paired cloud-shaped crystal fixtures. Modest mesh budget, warm emissive material.
for x in (-12,0,12):
    for y in (-4.5,4.5):
        cylinder('Chandeliers',gold,x,y,7.0,.03,.8,8)
        for i in range(9):
            a=i*math.tau/9; r=0 if i==0 else 1.0
            xx,yy=x+r*math.cos(a),y+r*math.sin(a)
            zz=5.95+(i%3)*.18
            cylinder('Chandeliers',gold,xx,yy,zz+.35,.38,.13)
            cylinder('Chandeliers',glow,xx,yy,zz,.35,.65)
            for j in range(12):
                b=j*math.tau/12
                cylinder('Chandeliers',glow,xx+.32*math.cos(b),yy+.32*math.sin(b),zz-.42,.019,.28+(j%3)*.07,5)

for (layer,mat_name),(vertices,faces) in batches.items():
    mesh=bpy.data.meshes.new('Wedding_'+layer)
    mesh.from_pydata(vertices,[],faces); mesh.update()
    obj=bpy.data.objects.new(layer+'__'+mat_name,mesh)
    scene.collection.objects.link(obj)
    mesh.materials.append(bpy.data.materials[mat_name])
    obj['venue_layer']=layer

world=bpy.data.worlds.new('Wedding_Warm_world'); world.use_nodes=True
background=next((n for n in world.node_tree.nodes if n.type=='BACKGROUND'),None)
if background is None:
    background=world.node_tree.nodes.new('ShaderNodeBackground')
    output=world.node_tree.nodes.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(background.outputs[0],output.inputs['Surface'])
background.inputs[0].default_value=(.72,.67,.56,1)
background.inputs[1].default_value=.65
scene.world=world
for x in (-12,0,12):
    light=bpy.data.lights.new('Wedding_Area','AREA'); light.energy=1400; light.shape='DISK'; light.size=8
    ob=bpy.data.objects.new(light.name,light); scene.collection.objects.link(ob); ob.location=(x,0,7.15)
camera=bpy.data.cameras.new('Wedding_Camera'); camera.lens=23
cam=bpy.data.objects.new(camera.name,camera); scene.collection.objects.link(cam)
cam.location=(16,-8,3.3); cam.rotation_euler=(Vector((-4,3,3))-cam.location).to_track_quat('-Z','Y').to_euler()
scene.camera=cam
scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True
scene.render.resolution_x=1440; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(source/'ballroom-preview.png')
try:
    bpy.ops.export_scene.gltf(filepath=str(out/'grand-mayfull-2f.glb'),export_format='GLB',use_active_scene=True,export_extras=True,export_cameras=False,export_lights=False)
    bpy.data.libraries.write(str(source/'grand-mayfull-2f.blend'),{scene},compress=True)
    bpy.ops.render.render(write_still=True)
    print({'scene':scene.name,'meshes':sum(o.type=='MESH' for o in scene.objects),'glb_bytes':(out/'grand-mayfull-2f.glb').stat().st_size,'preview':scene.render.filepath,'tables':0,'chairs':0})
finally:
    bpy.context.window.scene=previous if previous!=old else scene

"""Blender 4.4+/5.x, standard bpy only. Portable to SkyRig.
blender -b --python generate_assets.py -- --out PATH --manifest PATH [--preview]
All fixture origins are at floor centre. Blender metres, Z up; glTF Y up.
Product/style detail is illustrative; placement is exclusively the CAD manifest.
"""
import bpy, math, random, argparse, sys, json
from pathlib import Path
from mathutils import Vector

args=argparse.ArgumentParser()
args.add_argument('--out',required=True);args.add_argument('--manifest',required=True);args.add_argument('--preview',action='store_true')
opt=args.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(opt.out);out.mkdir(parents=True,exist_ok=True)
manifest=json.loads(Path(opt.manifest).read_text());random.seed(421)
# This script is run in a separate background process, never in an open user's scene.
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1

def mat(name,color,rough=.55,metal=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return m

M={
 'steel':mat('Powder-coated graphite',(.055,.069,.072),.45,.55),
 'wood':mat('Oiled warm oak',(.29,.17,.083),.8),
 'endgrain':mat('Crate end grain',(.42,.28,.14),.75),
 'black':mat('Crate liner',(.027,.037,.027),.95),
 'label':mat('Ivory shelf label',(.81,.79,.68),.9),
 'apple':mat('Russet red apples',(.42,.055,.031),.38),
 'pear':mat('Conference green',(.28,.39,.075),.6),
 'citrus':mat('Citrus ochre',(.72,.25,.018),.64),
 'lemon':mat('Lemon yellow',(.67,.53,.037),.62),
 'leaf':mat('Leaf green',(.06,.17,.033),.82),
 'aubergine':mat('Aubergine',(.10,.025,.12),.27),
 'silver':mat('Brushed stainless',(.39,.46,.47),.35,.75),
 'white':mat('Refrigerator enamel',(.63,.69,.67),.32,.1),
 'glass':mat('Smoked glass approximation',(.18,.30,.32),.16,.3),
 'pack':mat('Dairy cartons',(.72,.78,.69),.65),
 'blue':mat('Pack blue',(.075,.19,.24),.6),
 'meat':mat('Butchery tray product',(.36,.11,.092),.64),
 'fish':mat('Fish silvery skin',(.32,.43,.44),.32,.45),
}
em=mat('Cabinet LED',(.65,.86,.87),.3)
p=next(n for n in em.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
p.inputs['Emission Color'].default_value=(.5,.8,.85,1);p.inputs['Emission Strength'].default_value=.7
M['led']=em
objects=[]

def cube(name,loc,scale,material,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(M[material]);objects.append(o)
    if bevel:
        mod=o.modifiers.new('Small manufactured edge','BEVEL');mod.width=bevel;mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def fruit(name,loc,size,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10,ring_count=6,radius=1,location=loc)
    o=bpy.context.object;o.name='detail_'+name;o.scale=size;o.data.materials.append(M[material]);objects.append(o)
    for p in o.data.polygons:p.use_smooth=True
    return o

def base():
    cube('Recessed plinth',(0,0,.10),(1.50,2.40,.20),'steel',.025)
    cube('Counter carcass',(0,0,.47),(1.63,2.53,.56),'wood',.022)
    cube('Shadow reveal',(0,0,.73),(1.66,2.56,.045),'steel')
    cube('Display deck',(0,0,.78),(1.70,2.60,.08),'endgrain',.018)

def produce():
    base()
    for x in [-.72,.72]:
        for y in [-1.13,1.13]:cube('Tubular leg',(x,y,.40),(.07,.07,.68),'steel',.01)
    assort=['apple','pear','citrus','lemon','pear','aubergine','apple','citrus']
    for row in range(4):
        for col in range(2):
            x=(col-.5)*.80;y=(row-1.5)*.625;c=assort[row*2+col]
            cube('Crate bottom',(x,y,.835),(.75,.58,.05),'black')
            for z in [.89,.97,1.05]:
                for sy in [-1,1]:cube('Open crate slat',(x,y+sy*.287,z),(.75,.027,.052),'wood')
                for sx in [-1,1]:cube('Open crate end',(x+sx*.366,y,z),(.027,.58,.052),'endgrain')
            for sx in [-1,1]:
                for sy in [-1,1]:cube('Crate corner',(x+sx*.35,y+sy*.27,.95),(.035,.035,.24),'wood')
            cube('Shelf ticket',(x,y-.305,1.055),(.22,.009,.078),'label')
            cube('Ticket rule',(x,y-.311,1.06),(.13,.006,.009),'steel')
            for i in range(5):
                for j in range(4):
                    px=x+(i-2)*.132+random.uniform(-.012,.012);py=y+(j-1.5)*.128+random.uniform(-.012,.012)
                    r=random.uniform(.063,.077);pz=.94+random.uniform(0,.018)
                    sz=(r,r,r*.90) if c not in ['pear','aubergine','lemon'] else (r*.73,r*.81,r*1.3)
                    o=fruit(c,(px,py,pz),sz,c);o.rotation_euler=(random.uniform(-.2,.2),random.uniform(-.2,.2),random.random()*6)
                    if c in ['apple','pear']:
                        cube('detail_stem',(px,py,pz+sz[2]),(.009,.009,.030),'wood')
                    if (i+j)%3==0:
                        fruit('leaf',(px+.03,py,pz+sz[2]),(.036,.015,.008),'leaf')

def dairy():
    cube('Refrigerated plinth',(0,0,.1),(1.65,2.55,.2),'steel',.025)
    cube('Cabinet back',(0,.0,1.05),(.12,2.60,1.9),'white',.015)
    for x in [-.79,.79]:
        for z in [.25,.68,1.11,1.54]:
            cube('Cold shelf',(x/2,0,z),(.78,2.58,.06),'silver',.01)
            cube('Lighted frontage',(x,0,z+.03),(.015,2.50,.018),'led')
            for j in range(12):
                cube('detail_carton',(x*.57,(j-5.5)*.20,z+.15),(.22,.15,.24),'pack',.012)
                cube('detail_brand',(x*.57,(j-5.5)*.20,z+.26),(.225,.155,.035),'blue')
    for y in [-1.26,1.26]:cube('Cabinet end',(0,y,1.02),(1.65,.08,1.85),'white',.02)
    cube('Cabinet canopy',(0,0,2.0),(1.7,2.6,.10),'steel',.02)

def cold(kind):
    cube('Chilled cabinet',(0,0,.45),(1.7,2.6,.90),'white',.035)
    cube('Recessed toe',(0,0,.07),(1.5,2.4,.14),'steel',.02)
    cube('Tray well',(0,0,.92),(1.54,2.44,.06),'silver',.015)
    for x in [-.81,.81]:cube('Rim',(x,0,1.04),(.075,2.6,.13),'silver',.015)
    for y in [-1.26,1.26]:cube('Rim',(0,y,1.04),(1.65,.075,.13),'silver',.015)
    for j in range(6):
        for i in range(3):
            x=(i-1)*.45;y=(j-2.5)*.37
            cube('detail_product_tray',(x,y,.976),(.4,.33,.035),'black',.015)
            if kind=='freezer':cube('detail_frozen_pack',(x,y,1.01),(.34,.28,.06),'blue' if j%2 else 'pack',.012)
            elif kind=='fish':fruit('whole_fish',(x,y,1.026),(.17,.067,.036),'fish')
            else:fruit('cut',(x,y,1.026),(.16,.11,.037),'meat')
    if kind=='freezer':
        for y in [-.65,.65]:cube('Sliding glass lid',(0,y,1.12),(1.53,1.23,.024),'glass',.008)
        for y in [-.10,.10]:cube('Lid handle',(0,y,1.15),(.32,.04,.045),'silver',.01)
    else:
        for x in [-.78,.78]:cube('Counter glazing',(x,0,1.26),(.02,2.54,.34),'glass',.006)
        cube('Countertop trim',(0,0,1.45),(1.7,2.6,.04),'glass',.012)

def checkout():
    cube('Checkout body',(0,0,.48),(1.65,2.55,.96),'white',.03)
    cube('Conveyor',(0,-.37,1.0),(1.35,1.65,.045),'steel',.018)
    cube('Scanner',(0,.57,1.02),(.55,.42,.075),'glass',.01)
    cube('POS stand',(.55,.89,1.22),(.06,.06,.42),'steel')
    cube('POS display',(.55,.89,1.48),(.40,.09,.27),'steel',.01)
    cube('POS screen',(.55,.835,1.48),(.34,.008,.21),'blue')

builders={'produce':produce,'dairy':dairy,'freezer':lambda:cold('freezer'),'meat':lambda:cold('meat'),'fish':lambda:cold('fish'),'checkout':checkout}
modules={}
for name,build in builders.items():
    objects=[];build()
    # Batch by material and detail level. Shared meshes across placed modules.
    groups={}
    for o in objects:groups.setdefault((o.data.materials[0].name,o.name.startswith('detail_')),[]).append(o)
    result=[]
    for (material,detail),obs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:o.select_set(True)
        bpy.context.view_layer.objects.active=obs[0]
        if len(obs)>1:bpy.ops.object.join()
        o=bpy.context.object;o.name=f'{name}_{"detail" if detail else "fixture"}_{material}'
        bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
        scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');result.append(o)
    modules[name]=result
    for o in result:o.hide_render=True;o.hide_set(True)

# Preview scene: exact three mapped Frutta island positions, two modules per long fixture.
preview=bpy.data.collections.new('FRUTTA_CAD_PREVIEW');scene.collection.children.link(preview)
for f in manifest['fixtures']:
    if f['category']!='Frutta':continue
    n=max(1,round(f['length']/2.6));length=f['length']/n
    for j in range(n):
        off=(j-(n-1)/2)*length
        for proto in modules['produce']:
            o=proto.copy();o.data=proto.data;preview.objects.link(o);o.hide_render=False;o.hide_set(False)
            o.location=(f['x']+math.sin(f['yaw'])*off,-f['z']-math.cos(f['yaw'])*off,0)
            o.rotation_euler.z=f['yaw'];o.scale=(f['width']/1.7,length/2.6,1)
            o['cadIndex']=f['cadIndex'];o['shelfId']=f['shelfId']

# Render-only stage and lighting; never included in GLBs.
objects=[]
floor=cube('Preview floor',(10.7,-46.7,-.13),(12,30,.22),'steel',.1)
floor.data.materials.clear();floor.data.materials.append(mat('Preview limestone',(.22,.25,.26),.92))
def area(name,loc,power,size,target):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Soft key',(4,-44,15),2400,10,(11,-46,0));area('Cool fill',(20,-51,9),1600,8,(11,-46,0));area('North rim',(9,-32,10),1700,6,(11,-43,0))
cam=bpy.data.cameras.new('Frutta camera');co=bpy.data.objects.new('Frutta camera',cam);scene.collection.objects.link(co)
co.location=(24,-64,19);co.rotation_euler=(Vector((10.8,-46.8,.5))-co.location).to_track_quat('-Z','Y').to_euler();cam.type='ORTHO';cam.ortho_scale=29;scene.camera=co
scene.world=bpy.data.worlds.new('Studio world');scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.12,.16,.20,1);bg.inputs['Strength'].default_value=.45
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1400;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(out/'frutta-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(out/'retail-library.blend'))
if opt.preview:bpy.ops.render.render(write_still=True)

stats={}
for name,obs in modules.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=obs[0]
    bpy.ops.export_scene.gltf(filepath=str(out/f'{name}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True)
    stats[name]={'bytes':(out/f'{name}.glb').stat().st_size,'meshes':len(obs),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in obs)}
    for o in obs:o.hide_set(True)
(out/'asset-stats.json').write_text(json.dumps({'blender':bpy.app.version_string,'assets':stats},indent=2))
print('RETAIL_ASSETS_COMPLETE',json.dumps(stats))

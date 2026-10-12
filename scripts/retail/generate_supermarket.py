"""SkyRig supermarket library. Original generate_assets.py and Frutta source stay untouched.
blender -b --python generate_supermarket.py -- --out PATH --manifest PATH --previews
"""
import bpy, sys, json, math, random, argparse
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);ap.add_argument('--manifest',required=True);ap.add_argument('--previews',action='store_true')
opt=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(opt.out);out.mkdir(parents=True,exist_ok=True)
manifest=json.loads(Path(opt.manifest).read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
import asset_library as L
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
cube,fruit,mat=L.cube,L.fruit,L.mat;M=L.M
for k,c in {'tomato':(.48,.075,.036),'pepper':(.59,.34,.035),'potato':(.39,.27,.14),'onion':(.47,.33,.17),'carrot':(.66,.24,.035),'bread':(.48,.28,.095),'crust':(.27,.12,.035),'flour':(.69,.59,.39),'cheese':(.65,.48,.19),'poultry':(.65,.44,.33),'ice':(.58,.70,.73),'can':(.36,.44,.42),'paper':(.63,.64,.57),'greenpack':(.14,.28,.15),'redpack':(.37,.12,.08)}.items():M[k]=mat(k,c,.58)
# Cheap transparent covers: no transmission/refraction pass or environment textures.
M['glass'].diffuse_color=(.32,.46,.48,.13)
p=next(n for n in M['glass'].node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Alpha'].default_value=.13;p.inputs['Metallic'].default_value=.05
if hasattr(M['glass'],'surface_render_method'):M['glass'].surface_render_method='DITHERED'
M['warmled']=mat('Warm bakery strip',(.72,.57,.32),.5)
p=next(n for n in M['warmled'].node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Emission Color'].default_value=(.55,.36,.12,1);p.inputs['Emission Strength'].default_value=.5

def cyl(name,loc,r,depth,material,vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=loc)
    o=bpy.context.object;o.name=name;o.data.materials.append(M[material]);L.objects.append(o);return o
def rail(x,z,w=1.65):
    cube('Price rail',(x,0,z),(w,2.59,.025),'steel')
    for y in [-.95,-.32,.32,.95]:cube('micro_Price label',(x,y,z+.025),(.015,.18,.055),'label')
def shelves(kind='grocery'):
    cold=kind in ['dairy','chilled','freezer-wall'];wood=kind=='bakery'
    body='wood'if wood else 'white'
    cube('Plinth',(0,0,.10),(1.7,2.6,.20),'steel',.02)
    cube('Central back',(0,0,1.03),(.10,2.59,1.85),body,.012)
    for y in [-1.26,1.26]:cube('End upright',(0,y,1.02),(1.62,.07,1.84),body,.015)
    cube('Canopy',(0,0,2.02),(1.7,2.6,.10),body,.015)
    for side in [-1,1]:
        for level in range(4):
            z=.26+level*.43;x=side*.43
            cube('Shelf deck',(x,0,z),(.80,2.56,.045),'wood'if wood else 'silver',.008)
            cube('Front price rail',(side*.82,0,z+.035),(.027,2.56,.07),'steel')
            if cold or wood:cube('Merchandising light',(side*.80,0,z+.08),(.012,2.45,.015),'warmled'if wood else 'led')
            for j in range(8):
                y=(j-3.5)*.29
                if kind=='bakery':bread(x,y,z+.12,j+level)
                elif kind in ['dairy','chilled']:dairy_product(x,y,z+.04,(j+level)%5,side)
                elif kind=='beverages':bottle(x,y,z+.06,j%3)
                else:package(x,y,z+.05,j+level*3,kind)
            for j in range(4):cube('micro_Ticket',(side*.842,(j-1.5)*.58,z+.04),(.009,.17,.043),'label')
        if kind=='freezer-wall':
            for j in range(3):
                cube('Transparent freezer door',(side*.837,(j-1)*.84,1.12),(.015,.80,1.72),'glass')
                cube('Door handle',(side*.847,(j-1)*.84+.28,1.03),(.025,.035,.36),'silver')

def bottle(x,y,z,kind=0):
    color=['blue','greenpack','citrus'][kind%3]
    cyl('detail_Bottle',(x,y,z+.13),.076,.26,color)
    cyl('detail_Bottle neck',(x,y,z+.28),.036,.08,color)
    cyl('micro_Cap',(x,y,z+.324),.04,.014,'white')
    cyl('micro_Bottle label',(x,y,z+.14),.077,.07,'paper')
def package(x,y,z,n,kind='grocery'):
    palettes=['pack','blue','redpack','greenpack','cheese']
    c=palettes[n%len(palettes)]
    if kind=='breakfast':cube('detail_Cereal box',(x,y,z+.14),(.28,.19,.28),c,.008)
    elif n%4==0:
        cyl('detail_Tin',(x,y,z+.09),.09,.18,'can');cyl('micro_Tin band',(x,y,z+.09),.091,.09,c)
    elif n%4==1:
        cube('detail_Dry goods',(x,y,z+.14),(.24,.19,.28),c,.012)
        cube('micro_Pack label',(x+.123,y,z+.14),(.005,.11,.10),'paper')
    elif n%4==2:
        fruit('Pouch',(x,y,z+.12),(.15,.11,.12),c)
    else:bottle(x,y,z,n)
def dairy_product(x,y,z,n,side):
    if n==0:
        cube('detail_Milk carton',(x,y,z+.145),(.25,.19,.29),'pack',.008)
        cube('micro_Carton stripe',(x,y,z+.23),(.254,.194,.04),'blue')
    elif n==1:
        cyl('detail_Yogurt cup',(x,y,z+.065),.105,.13,'white');cyl('micro_Yogurt foil',(x,y,z+.133),.11,.008,'blue')
    elif n==2:bottle(x,y,z,0)
    else:
        cube('detail_Cheese butter pack',(x,y,z+.08),(.31,.22,.16),'cheese'if n==3 else 'pack',.015)
        cube('micro_Pack band',(x,y,z+.165),(.10,.22,.012),'paper')
def bread(x,y,z,n):
    if n%4==0:
        o=fruit('Baguette',(x,y,z+.025),(.27,.07,.065),'bread');o.rotation_euler.z=.20
        for k in range(3):fruit('Crust score',(x+(k-1)*.12,y,z+.079),(.035,.055,.008),'flour').name='micro_Bread scoring'
    elif n%4==1:
        cube('detail_Focaccia',(x,y,z),(.39,.22,.065),'bread',.025)
        for j in [-1,0,1]:fruit('Olive',(x+j*.1,y,z+.04),(.018,.02,.012),'leaf').name='micro_Olive'
    elif n%4==2:fruit('Round rustic loaf',(x,y,z),(.19,.12,.09),'crust')
    else:fruit('Ciabatta',(x,y,z),(.23,.105,.065),'bread')
def vegetables():
    L.base()
    for row in range(4):
        for col in range(2):
            x=(col-.5)*.8;y=(row-1.5)*.625;kind=(row*2+col)
            cube('Crate liner',(x,y,.835),(.75,.58,.05),'black')
            for z in [.89,.98,1.06]:
                for sy in [-1,1]:cube('Crate slat',(x,y+sy*.28,z),(.75,.025,.045),'wood')
                for sx in [-1,1]:cube('Crate end',(x+sx*.36,y,z),(.025,.58,.045),'endgrain')
            cube('Price holder',(x,y-.30,1.04),(.19,.015,.07),'label')
            for a in range(4):
                for b in range(3):
                    xx=x+(a-1.5)*.16;yy=y+(b-1)*.17;zz=.97
                    if kind==0:
                        fruit('Tomato',(xx,yy,zz),(.073,.073,.065),'tomato');fruit('Tomato calyx',(xx,yy,zz+.055),(.037,.035,.012),'leaf').name='micro_Tomato calyx'
                    elif kind==1:
                        for k in [-1,1]:fruit('Pepper lobe',(xx+k*.027,yy,zz),(.05,.06,.075),'pepper')
                    elif kind in [2,3]:
                        fruit('Zucchini'if kind==2 else 'Aubergine',(xx,yy,zz),(.047,.095,.044),'leaf'if kind==2 else 'aubergine')
                    elif kind==4:
                        o=cyl('detail_Carrot',(xx,yy,zz),.036,.18,'carrot',8);o.rotation_euler.x=math.pi/2
                    elif kind==5:fruit('Potato',(xx,yy,zz),(.069,.077,.056),'potato')
                    elif kind==6:fruit('Onion',(xx,yy,zz),(.069,.069,.075),'onion')
                    else:
                        for k in range(3):fruit('Broccoli / leafy crown',(xx+(k-1)*.037,yy,zz+.02),(.043,.065,.055),'leaf')

def counter(kind):
    cube('Cold carcass',(0,0,.46),(1.7,2.6,.92),'white',.035)
    cube('Recessed toe',(0,0,.07),(1.5,2.4,.14),'steel',.02)
    cube('Display well',(0,0,.94),(1.56,2.47,.04),'silver')
    for x in [-.81,.81]:cube('Edge trim',(x,0,1.01),(.07,2.6,.1),'silver',.01)
    for y in [-1.26,1.26]:cube('End glazing',(0,y,1.23),(1.58,.025,.40),'glass')
    # Clear canopy exposes the merchandise in both top-down and oblique views.
    for x in [-.8,.8]:cube('Glass face',(x,0,1.22),(.015,2.5,.40),'glass')
    cube('Protection canopy',(0,0,1.43),(1.64,2.54,.025),'glass')
    cube('Counter illumination',(-.76,0,1.37),(.016,2.45,.016),'led')
    for j in range(6):
        for i in range(2):
            x=(i-.5)*.74;y=(j-2.5)*.39
            cube('Display tray',(x,y,.97),(.66,.34,.035),'silver',.012)
            if kind=='fish':
                cube('detail_Crushed ice bed',(x,y,1.0),(.64,.32,.045),'ice',.015)
                f=fruit('Silver fish',(x,y,1.055),(.23,.065,.045),'fish')
                tail=fruit('Fish tail',(x-.23,y,1.055),(.07,.09,.012),'fish');tail.rotation_euler.y=.2
                fruit('Eye',(x+.18,y-.036,1.075),(.012,.009,.01),'black').name='micro_Fish eye'
                if j%3==0:
                    for k in range(3):fruit('Shellfish',(x+(k-1)*.14,y+.075,1.055),(.055,.035,.025),'onion')
            elif kind=='meat':
                for k in [-1,1]:fruit('Poultry portion'if j%3==0 else 'Steak',(x+k*.16,y,1.035),(.14,.125,.042),'poultry'if j%3==0 else 'meat')
                cube('micro_Tray label',(x,y-.14,1.017),(.12,.045,.008),'label')
            elif kind=='deli':
                if j%2==0:cyl('detail_Cheese wheel',(x,y,1.07),.145,.16,'cheese',14)
                else:
                    o=cyl('detail_Cured meat',(x,y,1.06),.07,.45,'meat');o.rotation_euler.y=math.pi/2
                    for k in [-1,0,1]:cyl('micro_Sliced meat',(x+k*.12,y+.08,1.02),.06,.009,'meat')
            else:
                for k in range(5):fruit('Prepared serving',(x+(k%3-1)*.15,y+(k//3-.5)*.11,1.045),(.08,.065,.045),['cheese','leaf','tomato'][j%3])
def freezer():
    cube('Freezer plinth',(0,0,.09),(1.7,2.6,.18),'steel',.02)
    cube('Freezer cabinet',(0,0,.51),(1.66,2.56,.85),'white',.035)
    cube('Interior basket',(0,0,.97),(1.51,2.40,.05),'silver')
    for i in range(3):
        for j in range(6):
            x=(i-1)*.47;y=(j-2.5)*.38
            cube('detail_Frozen box',(x,y,1.02),(.41,.32,.08),['blue','greenpack','pack'][j%3],.015)
            if j%2:cyl('micro_Ice cream tub',(x,y,1.105),.12,.09,'pack')
    for y in [-.64,.64]:cube('Sliding transparent lid',(0,y,1.19),(1.54,1.23,.025),'glass')
    for y in [-.07,.07]:cube('Lid handle',(0,y,1.22),(.32,.035,.04),'silver')
    for x in [-.8,.8]:cube('Freezer rim',(x,0,1.15),(.08,2.6,.12),'silver',.01)
    for y in [-1.26,1.26]:cube('End rim',(0,y,1.15),(1.6,.08,.12),'silver',.01)
def bar():
    L.base();cube('Stone countertop',(0,0,.94),(1.7,2.6,.12),'silver',.018)
    cube('Coffee machine',(-.15,.52,1.18),(.78,.72,.40),'steel',.025)
    cube('Machine fascia',(.25,.52,1.22),(.015,.68,.21),'silver')
    for y in [.30,.58,.80]:cyl('micro_Coffee cup',(.46,y,1.06),.045,.08,'white')
    cube('Pastry tray',(.05,-.62,1.035),(1.10,.85,.06),'wood',.012)
    for y in [-.86,-.50]:
        for x in [-.28,.10,.43]:bread(x,y,1.11,3)
    cube('Pastry glass canopy',(.05,-.62,1.42),(1.13,.89,.02),'glass')
def checkout(selfservice=False):
    cube('Checkout body',(0,0,.47),(1.7,2.6,.94),'white',.025)
    cube('Conveyor',(0,-.55,.97),(1.45,1.32,.04),'steel',.012)
    for y in [-1.12,-.80,-.48,-.16]:cube('Belt seam',(0,y,.993),(1.42,.014,.005),'black')
    cube('Scanner glass',(0,.36,1.0),(.65,.50,.055),'glass')
    cube('Bagging well',(0,.94,1.0),(1.43,.55,.075),'silver',.015)
    cube('Payment pedestal',(.55,.40,1.20),(.10,.13,.42),'steel')
    cube('Payment terminal',(.55,.40,1.43),(.33,.15,.25),'steel',.018)
    cube('Terminal screen',(.55,.31,1.44),(.27,.018,.18),'blue')
    if selfservice:
        cube('Self checkout screen support',(-.37,.34,1.35),(.12,.17,.67),'silver')
        cube('Self checkout touchscreen',(-.37,.34,1.75),(.67,.19,.55),'steel',.015)
        cube('Touch display',(-.37,.229,1.75),(.58,.018,.45),'blue')
    else:
        cube('Operator display support',(-.5,.5,1.23),(.08,.08,.46),'steel')
        cube('Operator display',(-.5,.5,1.48),(.42,.12,.28),'steel',.01)
    cube('Lane sign post',(-.72,1.15,1.57),(.045,.045,1.25),'silver')
    cube('Lane sign plate',(-.60,1.15,2.22),(.42,.06,.25),'steel')
def news():
    cube('Display base',(0,0,.1),(1.7,2.6,.2),'steel')
    for side in [-1,1]:
        for k in range(3):
            x=side*(.62-k*.15);z=.32+k*.4
            cube('Magazine shelf',(x,0,z),(.43,2.59,.05),'wood')
            for j in range(6):
                cube('detail_Magazine',(x,(j-2.5)*.39,z+.18),(.06,.33,.34),'paper')
                cube('micro_Cover block',(x+side*.036,(j-2.5)*.39,z+.23),(.009,.26,.14),'blue'if j%2 else 'redpack')
def table():
    cube('Table top',(0,0,.76),(1.7,2.6,.08),'wood',.025)
    for x in [-.68,.68]:
        for y in [-1.08,1.08]:cube('Table leg',(x,y,.36),(.075,.075,.72),'steel',.01)
def entrance():
    for y in [-1.18,1.18]:cube('Entrance frame',(0,y,1.05),(1.7,.24,2.10),'silver')
    cube('Threshold',(0,0,.018),(1.7,2.6,.036),'steel')
def display():
    cube('Screen footing',(0,0,.025),(1.7,2.6,.05),'steel')
    cube('Display upright',(0,0,1.08),(.22,.24,2.11),'silver')
    cube('Digital display',(0,0,1.47),(.24,2.30,1.32),'steel',.025)
    for x in [-.125,.125]:cube('Screen surface',(x,0,1.47),(.008,2.20,1.22),'blue')

builders={'produce':L.produce,'vegetables':vegetables,'bakery':lambda:shelves('bakery'),'breakfast':lambda:shelves('breakfast'),'dairy':lambda:shelves('dairy'),'chilled':lambda:shelves('chilled'),'grocery':lambda:shelves('grocery'),'beverages':lambda:shelves('beverages'),'freezer-wall':lambda:shelves('freezer-wall'),'freezer':freezer,'meat':lambda:counter('meat'),'fish':lambda:counter('fish'),'deli':lambda:counter('deli'),'prepared':lambda:counter('prepared'),'bar':bar,'checkout':checkout,'self-checkout':lambda:checkout(True),'news':news,'table':table,'entrance':entrance,'display':display}
modules={};stats={}
def stocking(name):
    if name in ['bakery','breakfast','dairy','chilled','grocery','beverages','freezer-wall','news']:
        for z in [.37,.80,1.23,1.66]:
            for x in [-.43,.43]:
                for j in [-1,0,1]:cube('overview merchandise',(x,j*.73,z),(.50,.56,.17),'bread'if name=='bakery'else 'blue'if name=='beverages'else 'pack')
    else:
        tone='leaf'if name=='vegetables'else 'citrus'if name=='produce'else 'ice'if name=='fish'else 'meat'if name=='meat'else 'cheese'if name in ['deli','prepared']else 'pack'
        for j in [-1,0,1]:cube('overview merchandise',(0,j*.73,.99),(.95,.56,.10),tone)
def batch(name,obs,l0=False):
    groups={}
    for o in obs:
        detail=o.name.startswith('detail_');micro=o.name.startswith('micro_')
        if l0:
            if detail or micro:continue
            old=o.data.materials[0].name
            # Four neutral overview materials, shared across all copies of a module.
            key='wood'if any(w in old.lower()for w in ['oak','grain','wood'])else 'glass'if 'glass'in old.lower()else 'steel'if any(w in old.lower()for w in ['graphite','liner','steel'])else 'white'
            o.data.materials.clear();o.data.materials.append(M[key])
        groups.setdefault((o.data.materials[0].name,'micro'if micro else 'detail'if detail else 'fixture'),[]).append(o)
    result=[]
    for (material,level),group in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:o.hide_set(False);o.select_set(True)
        bpy.context.view_layer.objects.active=group[0]
        if len(group)>1:bpy.ops.object.join()
        o=bpy.context.object;o.name=f'{name}_{level}_{material}';bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
        scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');result.append(o)
    return result
def export(name,obs):
    # Enforce the declared envelope even when a handle or trim changes in a builder.
    scene.view_layers[0].update()
    points=[o.matrix_world@Vector(c)for o in obs for c in o.bound_box]
    sx=1.7/(max(v.x for v in points)-min(v.x for v in points));sy=2.6/(max(v.y for v in points)-min(v.y for v in points))
    for o in obs:
        for v in o.data.vertices:v.co.x*=sx;v.co.y*=sy
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=obs[0]
    bpy.ops.export_scene.gltf(filepath=str(out/f'{name}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True)
    stats[name]={'bytes':(out/f'{name}.glb').stat().st_size,'meshes':len(obs),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in obs)}
    for o in obs:o.hide_set(True);o.hide_render=True
for name in manifest['assets']:
    random.seed(421);L.objects=[];builders[name]()
    originals=L.objects[:];copies=[]
    for o in originals:
        if o.name.startswith(('detail_','micro_')):continue
        c=o.copy();c.data=o.data.copy();scene.collection.objects.link(c);copies.append(c)
    low=batch(name+'-l0',copies,True)
    # Broad merchandise masses at overview, never the hundreds of focus products.
    if name not in ['table','entrance','display','checkout','self-checkout']:
        L.objects=[]
        stocking(name)
        low+=batch(name+'-l0',L.objects,False)
    full=batch(name,originals);modules[name]=full
    export(name+'-l0',low);export(name,full)

# Separate per-department preview scenes, with the actual CAD placement for every fixture.
world=bpy.data.worlds.new('Retail studio');world.use_nodes=True
bg=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.12,.16,.20,1);bg.inputs['Strength'].default_value=.5
scene.world=world
preview=bpy.data.collections.new('DEPARTMENT_PREVIEWS');scene.collection.children.link(preview)
def area_light(name,loc,target,power,size):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);preview.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return o
cam=bpy.data.cameras.new('Department camera');co=bpy.data.objects.new('Department camera',cam);preview.objects.link(co);cam.type='ORTHO';scene.camera=co
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
preview_dir=out/'previews';preview_dir.mkdir(exist_ok=True)
for dept in manifest['departments']:
    category=dept['category'];fs=[f for f in manifest['fixtures']if f['category']==category]
    if not fs:continue
    for o in list(preview.objects):
        if o!=co:bpy.data.objects.remove(o,do_unlink=True)
    for f in fs:
        spec=manifest['assets'][f['asset']];n=1 if f.get('tile')is False else max(1,round(f['length']/spec['length']))
        for j in range(n):
            offset=(j-(n-1)/2)*f['length']/n
            for proto in modules[f['asset']]:
                o=proto.copy();o.data=proto.data;preview.objects.link(o);o.hide_render=False;o.hide_set(False)
                o.location=(f['x']+math.sin(f['yaw'])*offset,-f['z']-math.cos(f['yaw'])*offset,0);o.rotation_euler.z=f['yaw'];o.scale=(f['width']/1.7,f['length']/n/2.6,1)
                o['cadIndex']=f['cadIndex'];o['category']=category
    xs=[v[0]for f in fs for v in f['polygon']];zs=[v[1]for f in fs for v in f['polygon']]
    cx,cz=(min(xs)+max(xs))/2,(min(zs)+max(zs))/2;span=max(max(xs)-min(xs),max(zs)-min(zs),5)
    L.objects=[];floor=cube('Render-only floor',(cx,-cz,-.09),(max(xs)-min(xs)+4,max(zs)-min(zs)+4,.16),'steel')
    for coll in list(floor.users_collection):coll.objects.unlink(floor)
    preview.objects.link(floor)
    target=(cx,-cz,.8);co.location=(cx+span*.85,-cz-span*.80,span*.85);co.rotation_euler=(Vector(target)-co.location).to_track_quat('-Z','Y').to_euler();cam.ortho_scale=span*1.3
    area_light('Soft key',(cx-4,-cz-4,span+8),target,2000+span*180,span*.8)
    area_light('Fill',(cx+8,-cz+3,span*.6+6),target,1800+span*80,span*.6)
    slug=category.lower().replace(' ','-').replace('&','and');scene.render.filepath=str(preview_dir/f'{slug}.png')
    if opt.previews:bpy.ops.render.render(write_still=True)
# Save editable mesh prototypes, materials and final mapped preview. Original Frutta .blend is preserved separately.
bpy.ops.wm.save_as_mainfile(filepath=str(out/'supermarket-library.blend'))
(out/'asset-stats.json').write_text(json.dumps({'blender':bpy.app.version_string,'assets':stats},indent=2))
print('SUPERMARKET_COMPLETE',len(modules),'modules')

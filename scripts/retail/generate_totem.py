"""Dedicated SkyRig Blender source; no existing department library is overwritten.
blender -b --python generate_totem.py -- --config config.json --out directory --manifest manifest.json
"""
import bpy, sys, json, math, argparse
from pathlib import Path
from mathutils import Vector
ap=argparse.ArgumentParser();ap.add_argument('--config',required=True);ap.add_argument('--out',required=True);ap.add_argument('--manifest');ap.add_argument('--sides',type=int,choices=[1,2],default=1);args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
cfg=json.loads(Path(args.config).read_text());d=cfg['dimensions'];s=cfg['screen'];out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
try:scene.render.engine='CYCLES'
except TypeError:pass
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Totem studio environment');scene.world.color=(.22,.22,.22)
objects=[]
def material(name,color,rough=.4,metal=.0,emission=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if emission:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 return m
black=material('Satin black enclosure',(.018,.022,.026),.32,.55);edge=material('Anodised edge highlight',(.045,.052,.06),.28,.65);rubber=material('Rubber contact feet',(.007,.009,.011),.8);rear=material('Rear service panel',(.028,.032,.038),.46,.4);dark=material('Vent recess',(.003,.004,.005),.8)
def cube(name,loc,dim,mat,bevel=.006):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
 if bevel:
  mod=o.modifiers.new('Machined rounded edge','BEVEL');mod.width=bevel;mod.segments=3;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
  mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
 objects.append(o);return o
# Blender front is -Y, exported glTF front is +Z. Floor datum is Z=0.
for x in [-d['baseWidth']*.36,d['baseWidth']*.36]:
 for y in [-d['baseDepth']*.32,d['baseDepth']*.32]:cube('Rubber floor pad',(x,y,.006),(.10,.08,.012),rubber,.004)
cube('Low weighted base',(0,0,.026),(d['baseWidth'],d['baseDepth'],.04),black,.012)
cube('Integrated cabinet',(0,0,(d['height']+.045)/2),(d['width'],d['depth'],d['height']-.045),black,.012)
cube('Recessed front bezel',(0,-d['depth']/2-.001,s['centerY']),(s['width']+.029,.006,s['height']+.030),edge,.006)
# Swappable image texture: a generated original typographic campaign, never a reference photograph.
# Draw with Blender text/shapes into a separate orthographic render and use it as a packed texture.
product=list(objects)
for o in product:o.hide_render=True
cream=material('Campaign ivory',(.93,.91,.83),1,0,1);green=material('Campaign forest',(.035,.13,.09),1,0,1);orange=material('Campaign citrus',(.96,.38,.05),1,0,1)
campaign=[]
def card_cube(name,loc,dim,mat):
 o=cube(name,loc,dim,mat,0);campaign.append(o);return o
card_cube('Campaign backdrop',(0,0,10),(.9,.02,1.6),cream)
def text(body,x,z,size,mat):
 bpy.ops.object.text_add(location=(x,-.018,z),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name='Campaign '+body;o.data.body=body;o.data.size=size;o.data.extrude=0;o.data.materials.append(mat);campaign.append(o)
text('H Y P E R S P A C E',-.37,10.65,.055,green);text('Fresh',-.37,10.34,.19,green);text('every day.',-.37,10.15,.14,green)
for x,z,r in [(-.13,9.89,.20),(.15,9.75,.22),(-.22,9.59,.12)]:
 bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=24,radius=r,location=(x,-.04,z));o=bpy.context.object;o.scale.y=.09;o.data.materials.append(orange);campaign.append(o)
text('A LITTLE COLOUR.',-.37,9.37,.05,green);text('A FRESH PERSPECTIVE.',-.37,9.29,.045,green)
bpy.ops.object.camera_add(location=(0,-5,10));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,10))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1.6;scene.camera=cam
scene.render.resolution_x=576;scene.render.resolution_y=1024;scene.view_settings.view_transform='Standard';scene.render.filepath=str(out/'campaign-fresh.png');bpy.ops.render.render(write_still=True)
for o in campaign:bpy.data.objects.remove(o,do_unlink=True)
objects=product
for o in product:o.hide_render=False
screenmat=material('Campaign Screen · replaceable',(.95,.95,.95),.27,0,.65);p=next(n for n in screenmat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');tex=screenmat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(out/'campaign-fresh.png'));tex.image.pack();screenmat.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);screenmat.node_tree.links.new(tex.outputs['Color'],p.inputs['Emission Color'])
bpy.ops.mesh.primitive_plane_add(size=1,location=(0,-s['frontZ'],s['centerY']),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name='CampaignScreen';o.scale=(s['width'],s['height'],1);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(screenmat);objects.append(o)
cube('Lower cabinet fascia',(0,-.093,.325),(d['width']-.025,.004,.52),black,.005)
if args.sides==2:
 cube('Rear recessed bezel',(0,d['depth']/2+.001,s['centerY']),(s['width']+.029,.006,s['height']+.030),edge,.006)
 bpy.ops.mesh.primitive_plane_add(size=1,location=(0,s['frontZ'],s['centerY']),rotation=(math.pi/2,0,math.pi));o=bpy.context.object;o.name='CampaignScreenRear';o.scale=(s['width'],s['height'],1);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(screenmat);objects.append(o)
 cube('Lower rear service door',(0,.093,.325),(d['width']-.065,.008,.52),rear,.005)
else:
 cube('Rear service door',(0,.093,.93),(d['width']-.065,.008,1.65),rear,.005)
for z in ([.18,.21,.24] if args.sides==2 else [.27,.30,.33,1.62,1.65,1.68]):
 for x in [-.22,-.11,0,.11,.22]:cube('Rear ventilation slot',(x,.099,z),(.084,.004,.009),dark,.003)
cube('Rear key lock',(.275,.104,.44 if args.sides==2 else 1.03),(.014,.005,.027),edge,.004)
cube('Cable exit',(0,.105,.13),(.05,.009,.035),dark,.008)
for x in [-.30,.30]:
 for z in ([.10,.54] if args.sides==2 else [.15,1.72]):cube('Service fastener',(x,.100,z),(.009,.004,.009),edge,.003)
# Keep editable components, but export a material-batched copy for few draw calls.
batches={}
for source in objects:
 o=source.copy();o.data=source.data.copy();bpy.context.collection.objects.link(o)
 key=source.name if source.name.startswith('CampaignScreen') else source.data.materials[0].name
 batches.setdefault(key,[]).append(o)
exports=[]
for name,group in batches.items():
 bpy.ops.object.select_all(action='DESELECT')
 for o in group:o.select_set(True)
 bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join();group[0].name=name;exports.append(group[0])
bpy.ops.object.select_all(action='DESELECT')
for o in exports:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'digital-totem.glb'),export_format='GLB',use_selection=True,export_apply=True)
for o in exports:bpy.data.objects.remove(o,do_unlink=True)
triangles=sum(len(o.data.polygons) for o in objects if o.type=='MESH')
(out/'stats.json').write_text(json.dumps({'blender':bpy.app.version_string,'sides':args.sides,'objects':len(objects),'exportMeshes':len(batches),'polygons':triangles,'dimensions':d,'screen':s,'front':'glTF +Z','units':'metres'},indent=2))
# Studio lighting and previews.
floorMat=material('Studio floor',(.17,.20,.22),.72)
floor=cube('Studio floor',(0,0,-.025),(200,200,.05),floorMat,0)
for loc,power,size in [((2,-3,4),450,3),((-2,-1,2),300,2),((1,2,3),600,2)]:
 bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(Vector((0,0,1))-l.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x=1000;scene.render.resolution_y=1100;scene.view_settings.view_transform='AgX';cam.data.type='PERSP';cam.data.lens=55
for name,loc in [('front-three-quarter',(2.7,-4.5,2.45)),('side',(4,-.6,2)),('rear',(-2.5,4.2,2.3))]:
 cam.location=loc;cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
# In-store view uses current mapped fixture proxies; full production view captured in browser.
if args.manifest:
 m=json.loads(Path(args.manifest).read_text());dev=cfg['devices'][1];c=math.cos(dev['yaw']);sn=math.sin(dev['yaw']);proxies=[]
 for f in m['fixtures']:
  dx=f['x']-dev['x'];dz=f['z']-dev['z']
  if f['asset']=='display' or math.hypot(dx,dz)>10:continue
  x=c*dx-sn*dz;zz=sn*dx+c*dz
  o=cube('Mapped store proxy '+str(f['cadIndex']),(x,-zz,.85),(f['width'],f['length'],1.7),floorMat,.015);o.rotation_euler.z=dev['yaw']-f['yaw'];proxies.append(o)
 cam.location=(3.6,-6.5,3.3);cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/'in-store.png');bpy.ops.render.render(write_still=True)
 for o in proxies:o.hide_render=True;o.hide_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'digital-totem.blend'))
print('TOTEM_COMPLETE',json.dumps({'glbBytes':(out/'digital-totem.glb').stat().st_size,'objects':len(product)}))
